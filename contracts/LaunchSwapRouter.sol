// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

import {IERC20} from "./interfaces/IERC20.sol";
import {IV4PoolManager} from "./interfaces/IV4PoolManager.sol";

/**
 * @title LaunchSwapRouter
 * @notice The user-facing door into a graduated launchpad pool. A v4 swap must
 *         happen inside `PoolManager.unlock` and settle its deltas in the same
 *         callback; this contract is that callback, so the browser never has to
 *         encode an unlock.
 *
 * Exact-input only, which is what the storefront trades:
 *   buy  — ETH in (fee taken by LaunchFeeHook), coin out to `recipient`.
 *   sell — coin in, ETH out (fee taken by the hook on the ETH leg).
 */
contract LaunchSwapRouter is IUnlockCallback {
    IV4PoolManager public immutable poolManager;

    event Bought(address indexed buyer, address indexed token, uint256 ethIn, uint256 tokensOut, address recipient);
    event Sold(address indexed seller, address indexed token, uint256 tokensIn, uint256 ethOut, address recipient);

    constructor(address _poolManager) {
        require(_poolManager != address(0), "LaunchSwapRouter: zero manager");
        poolManager = IV4PoolManager(_poolManager);
    }

    function buy(
        PoolKey calldata key,
        uint256 minTokensOut,
        address recipient
    ) external payable returns (uint256 tokensOut) {
        require(msg.value > 0, "LaunchSwapRouter: zero ETH");
        require(recipient != address(0), "LaunchSwapRouter: zero recipient");

        bytes memory result = poolManager.unlock(
            abi.encode(true, key, msg.value, minTokensOut, recipient)
        );
        tokensOut = abi.decode(result, (uint256));
        emit Bought(msg.sender, Currency.unwrap(key.currency1), msg.value, tokensOut, recipient);
    }

    function sell(
        PoolKey calldata key,
        uint256 amountIn,
        uint256 minEthOut,
        address recipient
    ) external returns (uint256 ethOut) {
        require(amountIn > 0, "LaunchSwapRouter: zero tokens");
        require(recipient != address(0), "LaunchSwapRouter: zero recipient");

        address token = Currency.unwrap(key.currency1);
        require(IERC20(token).transferFrom(msg.sender, address(this), amountIn), "LaunchSwapRouter: pull failed");

        bytes memory result = poolManager.unlock(
            abi.encode(false, key, amountIn, minEthOut, recipient)
        );
        ethOut = abi.decode(result, (uint256));
        emit Sold(msg.sender, token, amountIn, ethOut, recipient);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "LaunchSwapRouter: not pool manager");

        (
            bool isBuy,
            PoolKey memory key,
            uint256 amountIn,
            uint256 minOut,
            address recipient
        ) = abi.decode(data, (bool, PoolKey, uint256, uint256, address));

        address token = Currency.unwrap(key.currency1);

        if (isBuy) {
            BalanceDelta delta = poolManager.swap(
                key,
                SwapParams({
                    zeroForOne: true,
                    amountSpecified: -int256(amountIn),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                ""
            );
            int128 out = delta.amount1();
            require(out > 0, "LaunchSwapRouter: zero tokens out");
            uint256 tokensOut = uint256(uint128(out));
            require(tokensOut >= minOut, "LaunchSwapRouter: slippage");

            poolManager.sync(Currency.wrap(address(0)));
            poolManager.settle{value: amountIn}();
            poolManager.take(Currency.wrap(token), recipient, tokensOut);
            return abi.encode(tokensOut);
        }

        // Settle the coin leg before swapping: the pool owes the router nothing
        // on that side, and the router owes the pool the exact input.
        poolManager.sync(Currency.wrap(token));
        require(IERC20(token).transfer(address(poolManager), amountIn), "LaunchSwapRouter: settle failed");
        poolManager.settle();

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 out = delta.amount0();
        require(out > 0, "LaunchSwapRouter: zero ETH out");
        uint256 ethOut = uint256(uint128(out));
        require(ethOut >= minOut, "LaunchSwapRouter: slippage");

        poolManager.take(Currency.wrap(address(0)), recipient, ethOut);
        return abi.encode(ethOut);
    }

    receive() external payable {
        revert("LaunchSwapRouter: no plain ETH");
    }
}
