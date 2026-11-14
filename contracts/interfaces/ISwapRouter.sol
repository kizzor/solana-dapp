// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Uniswap **SwapRouter02** surface — the one Pons actually deploys on
 *         Robinhood Chain (0xCaf681a66D020601342297493863E78C959E5cb2).
 * @dev Verified 2026-11-13 by reading the deployed router's bytecode: it carries
 *      exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
 *      == 0x04e45aaf and does NOT carry the classic
 *      exactInputSingle((...,uint256 deadline,...)) == 0x414bf389.
 *      SwapRouter02 drops `deadline` from the params and wraps any deadline in
 *      multicall(deadline, calls), so callers here pass no deadline at all.
 *      Building calldata against the classic ABI reverts on this venue.
 */
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps `amountIn` of one token for as much as possible of another
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Swaps `amountIn` along an encoded multi-hop `path`
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
