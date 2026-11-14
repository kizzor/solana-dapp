// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {IV4PoolManager} from "./interfaces/IV4PoolManager.sol";

/**
 * @title LaunchFeeHook
 * @notice R2 — the post-graduation fee path. A Uniswap v4 hook that takes the
 *         ratified 1.00% trade fee at swap time, always in ETH (the quote
 *         asset), and splits it 70% creator / 29% jackpot / 1% treasury.
 *
 * Why a hook instead of a locked V3 LP (§6.16.2):
 *   A V3-shaped launch collects fees from an LP position, which means a locker,
 *   a batched harvest, and a second fee mechanism after graduation. A v4 pool
 *   with `fee = 0` and this hook charges the same 100 bps on every swap before
 *   and after graduation. One path, no locker, no harvest.
 *
 * Where the fee is taken:
 *   - ETH is the specified currency (buy exact-in, sell exact-out): `beforeSwap`
 *     takes the fee from the input side and returns a hook delta, so the swapper
 *     pays fee + net swap.
 *   - ETH is the unspecified currency (sell exact-in): `afterSwap` takes the fee
 *     from the ETH the swapper is about to receive, and returns the unspecified
 *     hook delta. The coin is never used to pay the fee.
 *
 * Fee destinations: the jackpot slice is pushed to `FeeCollector.receive()`
 * (native ETH -> WETH -> pending, skim-free). Creator and treasury slices accrue
 * here and are claimed by their registered addresses; pushing to an arbitrary
 * creator contract would let a hostile recipient brick every swap in the pool.
 */
contract LaunchFeeHook is IHooks {
    using Hooks for IHooks;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant TOTAL_FEE_BPS = 100;     // 1.00% of the trade
    uint256 public constant CREATOR_SHARE_BPS = 7_000; // of the fee
    uint256 public constant JACKPOT_SHARE_BPS = 2_000; // of the fee (0.20% of trade)
    uint256 public constant TREASURY_SHARE_BPS = 1_000; // of the fee (0.10% of trade)
    uint24 public constant POOL_FEE = 0;
    int24 public constant TICK_SPACING = 200;

    Currency public constant ETH = Currency.wrap(address(0));

    IV4PoolManager public immutable poolManager;

    address public owner;
    /// @notice Only this address may register a pool's fee config (the graduator).
    address public registrar;
    bool public registrarLocked;

    struct PoolConfig {
        address creatorRecipient;
        address treasury;
        address feeCollector;
        bool active;
    }

    mapping(PoolId => PoolConfig) public configOf;
    mapping(PoolId => uint256) public creatorFees;
    mapping(PoolId => uint256) public treasuryFees;
    mapping(PoolId => uint256) public totalFeesTaken;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event PoolRegistered(
        PoolId indexed poolId,
        address indexed token,
        address creatorRecipient,
        address treasury,
        address feeCollector
    );
    event FeeTaken(
        PoolId indexed poolId,
        uint256 fee,
        uint256 creatorCut,
        uint256 jackpotCut,
        uint256 treasuryCut
    );
    event CreatorFeesClaimed(PoolId indexed poolId, address indexed recipient, uint256 amount);
    event TreasuryFeesClaimed(PoolId indexed poolId, address indexed recipient, uint256 amount);
    event RegistrarUpdated(address indexed registrar);
    event RegistrarLocked();
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "LaunchFeeHook: not owner");
        _;
    }

    modifier onlyPoolManager() {
        require(msg.sender == address(poolManager), "LaunchFeeHook: not pool manager");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "LaunchFeeHook: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address _poolManager, address _owner) {
        require(_poolManager != address(0), "LaunchFeeHook: zero manager");
        require(_owner != address(0), "LaunchFeeHook: zero owner");
        poolManager = IV4PoolManager(_poolManager);
        owner = _owner;
        _status = _NOT_ENTERED;

        // The hook may only be deployed at an address whose low 14 bits are
        // exactly 0xCC (before/after swap + both return-delta flags). The
        // deployer mines a salt; this makes a wrong address a deploy-time error
        // instead of a silently fee-less pool.
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    /* ---------------- Registration ---------------- */

    /// @notice Bind a graduated pool to its fee recipients. Called by the graduator.
    function registerPool(
        PoolKey calldata key,
        address creatorRecipient,
        address treasury,
        address feeCollector
    ) external {
        require(msg.sender == registrar, "LaunchFeeHook: not registrar");
        require(Currency.unwrap(key.currency0) == address(0), "LaunchFeeHook: quote must be ETH");
        require(Currency.unwrap(key.currency1) != address(0), "LaunchFeeHook: zero token");
        require(key.fee == POOL_FEE, "LaunchFeeHook: pool fee must be 0");
        require(key.tickSpacing == TICK_SPACING, "LaunchFeeHook: tick spacing");
        require(address(key.hooks) == address(this), "LaunchFeeHook: wrong hook");
        require(creatorRecipient != address(0), "LaunchFeeHook: zero creator");
        require(treasury != address(0), "LaunchFeeHook: zero treasury");
        require(feeCollector != address(0), "LaunchFeeHook: zero collector");

        PoolId id = key.toId();
        require(!configOf[id].active, "LaunchFeeHook: already registered");
        configOf[id] = PoolConfig({
            creatorRecipient: creatorRecipient,
            treasury: treasury,
            feeCollector: feeCollector,
            active: true
        });
        emit PoolRegistered(id, Currency.unwrap(key.currency1), creatorRecipient, treasury, feeCollector);
    }

    function setRegistrar(address _registrar) external onlyOwner {
        require(!registrarLocked, "LaunchFeeHook: registrar locked");
        require(_registrar != address(0), "LaunchFeeHook: zero registrar");
        registrar = _registrar;
        emit RegistrarUpdated(_registrar);
    }

    /// @notice One-way: after this the registrar can never change.
    function lockRegistrar() external onlyOwner {
        require(registrar != address(0), "LaunchFeeHook: registrar unset");
        registrarLocked = true;
        emit RegistrarLocked();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LaunchFeeHook: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /* ---------------- Swap fee ---------------- */

    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId id = key.toId();
        PoolConfig memory cfg = configOf[id];

        if (cfg.active) {
            // ETH is currency0. It is the specified currency on an exact-input
            // buy (zeroForOne) and on an exact-output sell (!zeroForOne).
            bool ethSpecified = params.zeroForOne
                ? params.amountSpecified < 0
                : params.amountSpecified > 0;

            if (ethSpecified) {
                uint256 base = params.amountSpecified < 0
                    ? uint256(-params.amountSpecified)
                    : uint256(params.amountSpecified);
                uint256 fee = _fee(base);
                if (fee > 0) {
                    poolManager.take(ETH, address(this), fee);
                    _distribute(id, cfg, fee);
                    return (
                        IHooks.beforeSwap.selector,
                        toBeforeSwapDelta(int128(uint128(fee)), 0),
                        0
                    );
                }
            }
        }

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        PoolId id = key.toId();
        PoolConfig memory cfg = configOf[id];

        if (cfg.active) {
            // ETH is unspecified on an exact-input sell (token in, ETH out).
            bool ethUnspecified = params.zeroForOne
                ? params.amountSpecified > 0
                : params.amountSpecified < 0;

            if (ethUnspecified) {
                int128 ethOut = delta.amount0();
                if (ethOut > 0) {
                    uint256 fee = _fee(uint256(uint128(ethOut)));
                    if (fee > 0) {
                        poolManager.take(ETH, address(this), fee);
                        _distribute(id, cfg, fee);
                        return (IHooks.afterSwap.selector, int128(uint128(fee)));
                    }
                }
            }
        }

        return (IHooks.afterSwap.selector, 0);
    }

    function _fee(uint256 amount) internal pure returns (uint256) {
        return amount == 0 ? 0 : ((amount * TOTAL_FEE_BPS - 1) / BPS_DENOMINATOR) + 1;
    }

    function _distribute(PoolId id, PoolConfig memory cfg, uint256 fee) internal {
        uint256 creatorCut = (fee * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 jackpotCut = (fee * JACKPOT_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryCut = fee - creatorCut - jackpotCut;

        creatorFees[id] += creatorCut;
        treasuryFees[id] += treasuryCut;
        totalFeesTaken[id] += fee;

        if (jackpotCut > 0) {
            // FeeCollector.receive() wraps the ETH to WETH and adds it to
            // `pending`; it is the only path the 20 bps takes.
            (bool ok, ) = cfg.feeCollector.call{value: jackpotCut}("");
            require(ok, "LaunchFeeHook: jackpot accrual failed");
        }

        emit FeeTaken(id, fee, creatorCut, jackpotCut, treasuryCut);
    }

    /* ---------------- Claims ---------------- */

    function claimCreatorFees(PoolId id) external nonReentrant returns (uint256 amount) {
        PoolConfig memory cfg = configOf[id];
        require(msg.sender == cfg.creatorRecipient, "LaunchFeeHook: not creator");
        amount = creatorFees[id];
        require(amount > 0, "LaunchFeeHook: nothing to claim");
        creatorFees[id] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "LaunchFeeHook: claim failed");
        emit CreatorFeesClaimed(id, msg.sender, amount);
    }

    function claimTreasuryFees(PoolId id) external nonReentrant returns (uint256 amount) {
        PoolConfig memory cfg = configOf[id];
        require(msg.sender == cfg.treasury, "LaunchFeeHook: not treasury");
        amount = treasuryFees[id];
        require(amount > 0, "LaunchFeeHook: nothing to claim");
        treasuryFees[id] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "LaunchFeeHook: claim failed");
        emit TreasuryFeesClaimed(id, msg.sender, amount);
    }

    /* ---------------- Unused hook callbacks ---------------- */

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IHooks.afterDonate.selector;
    }

    /// @dev `PoolManager.take` pays the hook from the manager itself; plain
    ///      transfers from anyone else are rejected.
    receive() external payable {
        require(msg.sender == address(poolManager), "LaunchFeeHook: only manager ETH");
    }
}
