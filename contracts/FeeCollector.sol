// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IRansomeVault.sol";

interface IJackpotSink {
    function injectJackpot(uint256 amount, bytes32 source) external returns (uint256);
}

/**
 * @title FeeCollector
 * @notice Holds the jackpot slice of launchpad trade fees (29 of every 100 bps)
 *         in WETH and converts it to HEIST in ONE swap per threshold.
 *
 * Why accumulate instead of swapping per trade (deepseek §6.5 / §2.6):
 *   Per-trade swaps pay gas and slippage on dust and hand MEV a predictable
 *   trade. The real system (pump-amm) buffers fees and sweeps them too.
 *
 * Why a THRESHOLD and not a clock (deepseek §6.12.4):
 *   A fixed-minute flush is a predictable swap — that is MEV bait. `flush()` is
 *   permissionless and only callable once enough has accrued, so the timing is
 *   unknown in advance but the work is anyone's to do.
 *
 * Invariants:
 *   - `pending` always equals the unflushed WETH this contract controls.
 *   - `flush()` can never inject HEIST it did not just buy (approve is exact).
 *   - A failed swap reverts the whole flush; `pending` is never lost.
 */
contract FeeCollector {
    IWETH public immutable weth;
    IERC20 public immutable heist;
    ISwapRouter public swapRouter;
    IJackpotSink public jackpotSink;

    address public owner;
    uint24 public poolFee;          // Uniswap V3 fee tier of the WETH/HEIST pool
    uint256 public flushThreshold;  // WETH (18 dp) required before flush() is allowed
    bool public paused;

    uint256 public pending;         // accrued, not yet swapped
    uint256 public totalFlushedHeist;
    uint256 public totalTradesAccrued;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event FeeAccrued(address indexed from, uint256 wethAmount, uint256 pendingTotal);
    event Flushed(uint256 wethIn, uint256 heistOut, uint256 newReserve, bytes32 source);
    event RouterUpdated(address indexed router);
    event JackpotSinkUpdated(address indexed sink);
    event PoolFeeUpdated(uint24 poolFee);
    event FlushThresholdUpdated(uint256 threshold);
    event PausedStateChanged(bool isPaused);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "FeeCollector: not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "FeeCollector: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(
        address _weth,
        address _heist,
        address _swapRouter,
        address _jackpotSink,
        uint24 _poolFee,
        uint256 _flushThreshold
    ) {
        require(_weth != address(0), "FeeCollector: zero WETH");
        require(_heist != address(0), "FeeCollector: zero HEIST");
        require(_swapRouter != address(0), "FeeCollector: zero router");
        require(_jackpotSink != address(0), "FeeCollector: zero sink");
        require(_poolFee > 0, "FeeCollector: zero pool fee");
        require(_flushThreshold > 0, "FeeCollector: zero threshold");

        weth = IWETH(_weth);
        heist = IERC20(_heist);
        swapRouter = ISwapRouter(_swapRouter);
        jackpotSink = IJackpotSink(_jackpotSink);
        poolFee = _poolFee;
        flushThreshold = _flushThreshold;
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    /* ---------------- Accrual ---------------- */

    /// @notice Accrue WETH fee already held by the caller (the curve/venue).
    /// @dev Caller must approve this contract. Permissionless: anyone may donate.
    function accrue(uint256 wethAmount) external {
        require(wethAmount > 0, "FeeCollector: zero amount");
        require(weth.transferFrom(msg.sender, address(this), wethAmount), "FeeCollector: transfer failed");
        pending += wethAmount;
        totalTradesAccrued += 1;
        emit FeeAccrued(msg.sender, wethAmount, pending);
    }

    /// @notice Accrue native ETH by wrapping it into WETH.
    /// @dev Lets a venue pay the fee in the chain's native asset without pre-wrapping.
    receive() external payable {
        require(msg.value > 0, "FeeCollector: zero value");
        weth.deposit{value: msg.value}();
        pending += msg.value;
        totalTradesAccrued += 1;
        emit FeeAccrued(msg.sender, msg.value, pending);
    }

    /* ---------------- Flush ---------------- */

    /// @notice Swap all accrued WETH for HEIST and inject it into the jackpot.
    /// @dev Permissionless. Reverts below the threshold, when paused, or when the
    ///      swap would return less than `minHeistOut` (slippage / sandwich guard).
    /// @param minHeistOut Minimum HEIST out; pass 0 only in tests.
    function flush(uint256 minHeistOut) external nonReentrant returns (uint256 heistOut, uint256 newReserve) {
        require(!paused, "FeeCollector: paused");
        uint256 amount = pending;
        require(amount > 0, "FeeCollector: nothing to flush");
        require(amount >= flushThreshold, "FeeCollector: below threshold");

        // CEI: zero the ledger before any external call. A revert restores it.
        pending = 0;

        require(weth.approve(address(swapRouter), 0), "FeeCollector: approve reset failed");
        require(weth.approve(address(swapRouter), amount), "FeeCollector: approve failed");

        heistOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(heist),
                fee: poolFee,
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: minHeistOut,
                sqrtPriceLimitX96: 0
            })
        );
        require(heistOut > 0, "FeeCollector: zero HEIST out");

        // Approve exactly what we received — the sink can never pull more.
        require(heist.approve(address(jackpotSink), 0), "FeeCollector: approve reset failed");
        require(heist.approve(address(jackpotSink), heistOut), "FeeCollector: approve failed");

        newReserve = jackpotSink.injectJackpot(heistOut, bytes32("flush"));
        totalFlushedHeist += heistOut;

        emit Flushed(amount, heistOut, newReserve, bytes32("flush"));
    }

    function canFlush() external view returns (bool) {
        return !paused && pending > 0 && pending >= flushThreshold;
    }

    /* ---------------- Admin ---------------- */

    function setSwapRouter(address _router) external onlyOwner {
        require(_router != address(0), "FeeCollector: zero router");
        swapRouter = ISwapRouter(_router);
        emit RouterUpdated(_router);
    }

    function setJackpotSink(address _sink) external onlyOwner {
        require(_sink != address(0), "FeeCollector: zero sink");
        jackpotSink = IJackpotSink(_sink);
        emit JackpotSinkUpdated(_sink);
    }

    function setPoolFee(uint24 _poolFee) external onlyOwner {
        require(_poolFee > 0, "FeeCollector: zero pool fee");
        poolFee = _poolFee;
        emit PoolFeeUpdated(_poolFee);
    }

    function setFlushThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0, "FeeCollector: zero threshold");
        flushThreshold = _threshold;
        emit FlushThresholdUpdated(_threshold);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "FeeCollector: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
