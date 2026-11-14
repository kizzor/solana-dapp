// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

import {IERC20} from "./interfaces/IERC20.sol";
import {IV4PoolManager} from "./interfaces/IV4PoolManager.sol";
import {LaunchFeeHook} from "./LaunchFeeHook.sol";

interface ILaunchFactoryView {
    function curveOf(address token) external view returns (address);
}

interface ILaunchCurveConfig {
    function creatorFeeRecipient() external view returns (address);
    function treasury() external view returns (address);
    function feeCollector() external view returns (address);
}

/**
 * @title LaunchGraduator
 * @notice R2 — turns a finished curve into a Uniswap v4 market. The curve hands
 *         over its real ETH and its remaining tokens; this contract seeds a
 *         full-range ETH/coin position at the curve's own marginal price,
 *         registers the pool with `LaunchFeeHook`, and locks the position
 *         forever (there is no owner path that can remove liquidity).
 *
 * Value matching: the curve's virtual reserves are 5.2 ETH / 192.3M tokens at
 * the 4.2 ETH ceiling, but only 4.2 ETH is real. Seeding all remaining tokens
 * against 4.2 ETH would open the pool ~19% below the last curve price. Instead
 * the pool is opened at the curve price and seeded with
 * `tokensToSeed = realEth * virtualToken / virtualEth`; the unpaired remainder
 * stays locked here permanently (never sold, never withdrawable).
 */
contract LaunchGraduator is IUnlockCallback {
    uint160 private constant Q96 = 0x1000000000000000000000000;
    uint160 private constant MIN_SQRT_PRICE = TickMath.MIN_SQRT_PRICE;
    uint160 private constant MAX_SQRT_PRICE = TickMath.MAX_SQRT_PRICE;
    int24 public constant TICK_SPACING = 200;

    IV4PoolManager public immutable poolManager;
    LaunchFeeHook public immutable hook;
    address public owner;
    address public factory;

    struct Graduation {
        bytes32 poolId;
        address token;
        int24 tick;
        uint160 sqrtPriceX96;
        uint256 ethSeeded;
        uint256 tokensSeeded;
        uint256 tokensLocked;
        uint64 at;
    }

    mapping(address token => Graduation) public graduationOf;
    mapping(address token => PoolKey) public poolKeyOf;
    mapping(address token => uint256) public lockedTokens;
    uint256 public ethDust;

    event Graduated(
        address indexed token,
        bytes32 indexed poolId,
        int24 tick,
        uint256 ethSeeded,
        uint256 tokensSeeded,
        uint256 tokensLocked
    );
    event FactoryUpdated(address indexed factory);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "LaunchGraduator: not owner");
        _;
    }

    constructor(address _poolManager, address _hook, address _owner) {
        require(_poolManager != address(0), "LaunchGraduator: zero manager");
        require(_hook != address(0), "LaunchGraduator: zero hook");
        require(_owner != address(0), "LaunchGraduator: zero owner");
        poolManager = IV4PoolManager(_poolManager);
        hook = LaunchFeeHook(payable(_hook));
        owner = _owner;
    }

    function setFactory(address _factory) external onlyOwner {
        require(factory == address(0), "LaunchGraduator: factory set");
        require(_factory != address(0), "LaunchGraduator: zero factory");
        factory = _factory;
        emit FactoryUpdated(_factory);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LaunchGraduator: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Called by a LaunchCurve at the 4.2 ETH ceiling. The tokens have
     *         already been transferred here; `msg.value` is the curve's real ETH.
     */
    function onGraduate(
        address token,
        uint256 tokenAmount,
        uint256 virtualEthReserve,
        uint256 virtualTokenReserve
    ) external payable returns (bytes32 poolId) {
        require(factory != address(0), "LaunchGraduator: factory unset");
        require(ILaunchFactoryView(factory).curveOf(token) == msg.sender, "LaunchGraduator: not a curve");
        require(tokenAmount > 0, "LaunchGraduator: no tokens");
        require(msg.value > 0, "LaunchGraduator: no ETH");
        require(virtualEthReserve > 0 && virtualTokenReserve > 0, "LaunchGraduator: bad reserves");
        require(graduationOf[token].at == 0, "LaunchGraduator: already graduated");
        require(IERC20(token).balanceOf(address(this)) >= tokenAmount, "LaunchGraduator: tokens missing");

        PoolKey memory key = _poolKey(token);
        poolId = PoolId.unwrap(key.toId());

        uint160 sqrtPriceX96 = _openPrice(virtualTokenReserve, virtualEthReserve);
        uint128 liquidity = _seedLiquidity(sqrtPriceX96, msg.value, tokenAmount);
        require(liquidity > 0, "LaunchGraduator: zero liquidity");

        (uint256 ethUsed, uint256 tokUsed) = _seed(key, sqrtPriceX96, liquidity, msg.value, token);

        // Fee recipients are read from the curve, not passed in: a caller cannot
        // redirect a pool's creator/treasury slice.
        _record(token, key, poolId, sqrtPriceX96, ethUsed, tokUsed, tokenAmount);
    }

    function _poolKey(address token) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    /// @dev sqrt price at the curve's marginal price, floored to tick spacing
    function _openPrice(uint256 virtualTokenReserve, uint256 virtualEthReserve) internal pure returns (uint160) {
        int24 tick = _alignTick(
            TickMath.getTickAtSqrtPrice(_sqrtX96(virtualTokenReserve, virtualEthReserve))
        );
        return TickMath.getSqrtPriceAtTick(tick);
    }

    function _seedLiquidity(
        uint160 sqrtPriceX96,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal pure returns (uint128) {
        // Only the tokens the real ETH pairs with at the (aligned) open price:
        // price = sqrtP^2 / 2^192 (token wei per ETH wei), tokens = eth * price.
        uint256 tokensToSeed = FullMath.mulDiv(
            ethAmount,
            uint256(sqrtPriceX96) * sqrtPriceX96,
            1 << 192
        );
        if (tokensToSeed > tokenAmount) tokensToSeed = tokenAmount;

        return _liquidityFor(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(TICK_SPACING)),
            TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(TICK_SPACING)),
            ethAmount,
            tokensToSeed
        );
    }

    function _seed(
        PoolKey memory key,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 ethAmount,
        address token
    ) internal returns (uint256 ethUsed, uint256 tokUsed) {
        bytes memory result = poolManager.unlock(
            abi.encode(
                key,
                sqrtPriceX96,
                TickMath.minUsableTick(TICK_SPACING),
                TickMath.maxUsableTick(TICK_SPACING),
                liquidity,
                ethAmount,
                token
            )
        );
        return abi.decode(result, (uint256, uint256));
    }

    function _record(
        address token,
        PoolKey memory key,
        bytes32 poolId,
        uint160 sqrtPriceX96,
        uint256 ethUsed,
        uint256 tokUsed,
        uint256 tokenAmount
    ) internal {
        ILaunchCurveConfig curve = ILaunchCurveConfig(msg.sender);
        hook.registerPool(key, curve.creatorFeeRecipient(), curve.treasury(), curve.feeCollector());

        uint256 locked = tokenAmount - tokUsed;
        lockedTokens[token] = locked;
        ethDust += msg.value - ethUsed;
        poolKeyOf[token] = key;

        graduationOf[token] = Graduation({
            poolId: poolId,
            token: token,
            tick: _alignTick(TickMath.getTickAtSqrtPrice(sqrtPriceX96)),
            sqrtPriceX96: sqrtPriceX96,
            ethSeeded: ethUsed,
            tokensSeeded: tokUsed,
            tokensLocked: locked,
            at: uint64(block.timestamp)
        });

        emit Graduated(token, poolId, _alignTick(TickMath.getTickAtSqrtPrice(sqrtPriceX96)), ethUsed, tokUsed, locked);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "LaunchGraduator: not pool manager");

        (
            PoolKey memory key,
            uint160 sqrtPriceX96,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 ethAmount,
            address token
        ) = abi.decode(data, (PoolKey, uint160, int24, int24, uint128, uint256, address));

        poolManager.initialize(key, sqrtPriceX96);

        BalanceDelta delta = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        uint256 ethUsed = d0 < 0 ? uint256(uint128(-d0)) : 0;
        uint256 tokUsed = d1 < 0 ? uint256(uint128(-d1)) : 0;
        require(ethUsed <= ethAmount, "LaunchGraduator: ETH overrun");
        require(tokUsed <= IERC20(token).balanceOf(address(this)), "LaunchGraduator: token overrun");

        if (ethUsed > 0) {
            poolManager.sync(Currency.wrap(address(0)));
            poolManager.settle{value: ethUsed}();
        }
        if (tokUsed > 0) {
            poolManager.sync(Currency.wrap(token));
            require(IERC20(token).transfer(address(poolManager), tokUsed), "LaunchGraduator: transfer failed");
            poolManager.settle();
        }

        return abi.encode(ethUsed, tokUsed);
    }

    /* ---------------- Math ---------------- */

    /// @dev floor to the pool's tick spacing, including negative ticks
    function _alignTick(int24 tick) internal pure returns (int24) {
        int24 spacing = TICK_SPACING;
        int24 q = tick / spacing;
        if (tick < 0 && tick % spacing != 0) q -= 1;
        int24 aligned = q * spacing;
        if (aligned < TickMath.minUsableTick(spacing)) aligned = TickMath.minUsableTick(spacing);
        if (aligned > TickMath.maxUsableTick(spacing)) aligned = TickMath.maxUsableTick(spacing);
        return aligned;
    }

    /// @dev sqrt(price) in Q64.96, where price = tokenWei per ethWei
    function _sqrtX96(uint256 numerator, uint256 denominator) internal pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(numerator, 1 << 192, denominator);
        uint160 sqrtPrice = uint160(_sqrt(ratioX192));
        if (sqrtPrice < MIN_SQRT_PRICE) sqrtPrice = MIN_SQRT_PRICE;
        if (sqrtPrice >= MAX_SQRT_PRICE) sqrtPrice = MAX_SQRT_PRICE - 1;
        return sqrtPrice;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function _liquidityFor(
        uint160 sqrtP,
        uint160 sqrtLower,
        uint160 sqrtUpper,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal pure returns (uint128) {
        uint256 l0 = FullMath.mulDiv(
            ethAmount,
            FullMath.mulDiv(sqrtP, sqrtUpper, Q96),
            sqrtUpper - sqrtP
        );
        uint256 l1 = FullMath.mulDiv(tokenAmount, Q96, sqrtP - sqrtLower);
        uint256 l = l0 < l1 ? l0 : l1;
        if (l > type(uint128).max) l = type(uint128).max;
        return uint128(l);
    }
}
