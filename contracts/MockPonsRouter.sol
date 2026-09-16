// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/ISwapRouter.sol";
import "./TestXToken.sol";

/**
 * @title MockPonsRouter
 * @notice Mock DEX Router for testing on Robinhood Chain testnet and local dev mode.
 * Swaps incoming USDG/USDC/USDT/ETH to TestXToken without needing real external liquidity.
 */
contract MockPonsRouter is ISwapRouter {
    TestXToken public immutable testXToken;

    constructor(address _testXToken) {
        testXToken = TestXToken(_testXToken);
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        // Collect tokenIn from caller
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        // Calculate amountOut: for 6-dec stablecoin (500,000 = $0.50), return equivalent X (e.g. 5,000 X with 18 decimals)
        amountOut = (params.amountIn * 1e12) * 10000; // 1 USD = 10,000 X
        if (amountOut < params.amountOutMinimum) {
            amountOut = params.amountOutMinimum;
        }

        // Faucet / send X tokens to recipient
        testXToken.faucet();
        testXToken.transfer(params.recipient, amountOut);
        return amountOut;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        amountOut = (params.amountIn * 1e12) * 10000;
        testXToken.faucet();
        testXToken.transfer(params.recipient, amountOut);
        return amountOut;
    }

    receive() external payable {}
}
