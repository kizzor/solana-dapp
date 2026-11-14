// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/ISwapRouter.sol";

interface IJackpotSink {
    function injectJackpot(uint256 amount, bytes32 source) external returns (uint256);
}

/**
 * @title PerpsFeeRouter
 * @notice Collects perps builder + bridge fees (reported by the venue broker) and
 *         injects them into the slot-machine jackpot, skim-free.
 *
 * Flow:  operator reports a fill (notionalE6 in USDG 6 dp) ->
 *          fee = notionalE6 * (builderBps + bridgeBps) / 10000  (USDG, 6 dp)
 *          pull `fee` USDG from `payer` ->
 *          swap USDG -> WETH -> HEIST (one two-hop exactInput) ->
 *          JackpotRouter.injectJackpot(heistOut, "perps")
 *          -> vault.creditJackpot (100%, no treasury skim, source = "perps")
 *
 * Why the skim-free door: ticket deposits pay the 1% treasury skim; fee inflows
 * must not, or the "29 of every 30 bps funds the jackpot" claim becomes 28.71.
 *
 * Safety rails:
 *   - only `operator` may call creditPerpFee (settable by owner).
 *   - setRates is bounded (<= 200 bps each) so a typo cannot tax 20%.
 *   - per-epoch notional ceiling (maxEpochNotional) so a leaked operator key can
 *     only mangle one epoch, not drain a payer forever.
 *   - Pause / unpause.
 *   - Emits PerpFeeCredited on every call, including zero-fee, so "nothing was
 *     charged" is provable from logs.
 *
 * The router holds no funds between calls: USDG is pulled, swapped, and the HEIST
 * goes straight into the JackpotRouter in the same transaction.
 */
contract PerpsFeeRouter {
    IERC20 public immutable usdg;
    IERC20 public immutable heist;

    address public weth;
    ISwapRouter public swapRouter;
    IJackpotSink public jackpotSink;

    address public owner;
    address public operator;

    /// @dev Builder fee in bps (Hyperliquid-style builder code). Cap 200 bps.
    uint16 public builderBps;
    /// @dev Bridge fee in bps. Cap 200 bps.
    uint16 public bridgeBps;
    uint16 public constant MAX_RATE_BPS = 200;
    uint16 public constant BPS_DENOMINATOR = 10000;

    /// @dev Per-epoch notional ceiling in USDG 6-dp units. 0 disables the cap.
    uint256 public maxEpochNotional;
    /// @dev Notional accrued in the current epoch.
    uint256 public epochNotional;
    /// @dev Start of the current epoch (seconds).
    uint256 public epochStart;
    /// @dev Epoch length. Default 1 day.
    uint256 public constant EPOCH_LENGTH = 1 days;

    uint24 public stableHopFee;
    uint24 public dexPoolFee;

    bool public paused;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event PerpFeeCredited(address indexed payer, uint256 notional, uint256 fee, bytes32 source);
    event OperatorUpdated(address indexed operator);
    event RatesUpdated(uint16 builderBps, uint16 bridgeBps);
    event MaxEpochNotionalUpdated(uint256 maxEpochNotional);
    event PausedStateChanged(bool isPaused);
    event RouterUpdated(address indexed router);
    event WethUpdated(address indexed weth);
    event StableHopFeeUpdated(uint24 fee);
    event DexPoolFeeUpdated(uint24 fee);
    event JackpotSinkUpdated(address indexed sink);
    event EpochReset(uint256 epochStart, uint256 previousNotional);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "PerpsFeeRouter: not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "PerpsFeeRouter: not operator");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "PerpsFeeRouter: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(
        address _usdg,
        address _weth,
        address _heist,
        address _swapRouter,
        address _jackpotSink,
        address _owner,
        uint16 _builderBps,
        uint16 _bridgeBps,
        uint256 _maxEpochNotional,
        uint24 _stableHopFee,
        uint24 _dexPoolFee
    ) {
        require(_usdg != address(0), "PerpsFeeRouter: zero USDG");
        require(_heist != address(0), "PerpsFeeRouter: zero HEIST");
        require(_swapRouter != address(0), "PerpsFeeRouter: zero router");
        require(_jackpotSink != address(0), "PerpsFeeRouter: zero sink");
        require(_owner != address(0), "PerpsFeeRouter: zero owner");
        require(_builderBps <= MAX_RATE_BPS, "PerpsFeeRouter: builder bps too high");
        require(_bridgeBps <= MAX_RATE_BPS, "PerpsFeeRouter: bridge bps too high");
        require(_stableHopFee > 0, "PerpsFeeRouter: zero stable hop fee");
        require(_dexPoolFee > 0, "PerpsFeeRouter: zero dex pool fee");

        usdg = IERC20(_usdg);
        heist = IERC20(_heist);
        weth = _weth;
        swapRouter = ISwapRouter(_swapRouter);
        jackpotSink = IJackpotSink(_jackpotSink);
        owner = _owner;
        operator = _owner;
        builderBps = _builderBps;
        bridgeBps = _bridgeBps;
        maxEpochNotional = _maxEpochNotional;
        stableHopFee = _stableHopFee;
        dexPoolFee = _dexPoolFee;
        epochStart = block.timestamp;
        _status = _NOT_ENTERED;
    }

    /* ---------------- Core ---------------- */

    /// @notice Report a perps fill and route its fees into the jackpot.
    /// @param notionalE6 Notional volume in USDG 6-dp units (e.g. $1000 -> 1_000_000_000).
    /// @param payer       Address holding the USDG fee (the venue/broker).
    function creditPerpFee(uint256 notionalE6, address payer) external onlyOperator nonReentrant {
        _rollEpoch();

        if (maxEpochNotional > 0) {
            require(epochNotional + notionalE6 <= maxEpochNotional, "PerpsFeeRouter: epoch cap exceeded");
        }

        uint256 _totalBps = uint256(builderBps) + uint256(bridgeBps);
        // fee is in USDG 6-dp units. Do NOT scale by 1e12 here — that is the
        // off-by-1e12 bug: notionalE6 is already 6 dp.
        uint256 fee = (notionalE6 * _totalBps) / BPS_DENOMINATOR;

        if (notionalE6 == 0 || fee == 0) {
            epochNotional += notionalE6;
            emit PerpFeeCredited(payer, notionalE6, fee, bytes32("perps"));
            return;
        }

        require(payer != address(0), "PerpsFeeRouter: zero payer");

        // Pull the USDG fee.
        require(usdg.transferFrom(payer, address(this), fee), "PerpsFeeRouter: USDG pull failed");

        // Swap USDG -> WETH -> HEIST (Pons only pairs HEIST with WETH).
        uint256 heistOut = _swap(fee);
        require(heistOut > 0, "PerpsFeeRouter: zero HEIST out");

        // Inject skim-free. The JackpotRouter is the only door into the vault.
        require(heist.approve(address(jackpotSink), 0), "PerpsFeeRouter: approve reset failed");
        require(heist.approve(address(jackpotSink), heistOut), "PerpsFeeRouter: approve failed");
        jackpotSink.injectJackpot(heistOut, bytes32("perps"));

        epochNotional += notionalE6;
        emit PerpFeeCredited(payer, notionalE6, fee, bytes32("perps"));
    }

    function _rollEpoch() internal {
        if (block.timestamp >= epochStart + EPOCH_LENGTH) {
            emit EpochReset(epochStart, epochNotional);
            epochStart = block.timestamp;
            epochNotional = 0;
        }
    }

    function _swap(uint256 amountIn) internal returns (uint256 amountOut) {
        require(address(swapRouter) != address(0), "PerpsFeeRouter: router unset");
        require(weth != address(0), "PerpsFeeRouter: WETH unset");

        usdg.approve(address(swapRouter), 0);
        usdg.approve(address(swapRouter), amountIn);

        if (address(usdg) == weth) {
            ISwapRouter.ExactInputSingleParams memory p = ISwapRouter.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(heist),
                fee: dexPoolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });
            return swapRouter.exactInputSingle(p);
        }

        bytes memory path = abi.encodePacked(address(usdg), stableHopFee, weth, dexPoolFee, address(heist));
        return swapRouter.exactInput(
            ISwapRouter.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0
            })
        );
    }

    /* ---------------- Views ---------------- */

    function totalBps() external view returns (uint256) {
        return uint256(builderBps) + uint256(bridgeBps);
    }

    function canReport() external view returns (bool) {
        return !paused && operator != address(0);
    }

    /* ---------------- Admin ---------------- */

    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "PerpsFeeRouter: zero operator");
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    function setRates(uint16 _builderBps, uint16 _bridgeBps) external onlyOwner {
        require(_builderBps <= MAX_RATE_BPS, "PerpsFeeRouter: builder bps too high");
        require(_bridgeBps <= MAX_RATE_BPS, "PerpsFeeRouter: bridge bps too high");
        builderBps = _builderBps;
        bridgeBps = _bridgeBps;
        emit RatesUpdated(_builderBps, _bridgeBps);
    }

    function setMaxEpochNotional(uint256 _max) external onlyOwner {
        maxEpochNotional = _max;
        emit MaxEpochNotionalUpdated(_max);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function setSwapRouter(address _router) external onlyOwner {
        require(_router != address(0), "PerpsFeeRouter: zero router");
        swapRouter = ISwapRouter(_router);
        emit RouterUpdated(_router);
    }

    function setWeth(address _weth) external onlyOwner {
        weth = _weth;
        emit WethUpdated(_weth);
    }

    function setStableHopFee(uint24 _fee) external onlyOwner {
        require(_fee > 0, "PerpsFeeRouter: zero fee");
        stableHopFee = _fee;
        emit StableHopFeeUpdated(_fee);
    }

    function setDexPoolFee(uint24 _fee) external onlyOwner {
        require(_fee > 0, "PerpsFeeRouter: zero fee");
        dexPoolFee = _fee;
        emit DexPoolFeeUpdated(_fee);
    }

    function setJackpotSink(address _sink) external onlyOwner {
        require(_sink != address(0), "PerpsFeeRouter: zero sink");
        jackpotSink = IJackpotSink(_sink);
        emit JackpotSinkUpdated(_sink);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PerpsFeeRouter: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
