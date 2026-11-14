// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC20.sol";
import "../interfaces/ISwapRouter.sol";

/// @notice Fixed-rate router for tests and local dev.
/// @dev Must be pre-funded with HEIST. Rate is HEIST per 1e18 WETH.
///
///      Two hops exist so the stablecoin route can be proven, not assumed:
///        - `exactInputSingle` accepts WETH only (the Pons-shaped X pool).
///        - `exactInput` accepts stable → WETH → HEIST and rejects anything else,
///          so a game that forgets the hop reverts here instead of in production.
///      A stable is priced at 2,000 per WETH, 6 decimals.
contract MockSwapRouter is ISwapRouter {
    IERC20 public immutable weth;
    IERC20 public immutable heist;
    uint256 public immutable rate;

    constructor(address _weth, address _heist, uint256 _rate) {
        weth = IERC20(_weth);
        heist = IERC20(_heist);
        rate = _rate;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        require(params.tokenIn == address(weth), "MockSwapRouter: tokenIn != WETH");
        require(params.tokenOut == address(heist), "MockSwapRouter: tokenOut != HEIST");

        weth.transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = (params.amountIn * rate) / 1e18;
        require(amountOut >= params.amountOutMinimum, "MockSwapRouter: slippage");
        heist.transfer(params.recipient, amountOut);
        return amountOut;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        (address tokenIn, address mid, address tokenOut) = _decodePath(params.path);
        require(tokenIn != address(weth), "MockSwapRouter: WETH is a single hop");
        require(mid == address(weth), "MockSwapRouter: mid hop must be WETH");
        require(tokenOut == address(heist), "MockSwapRouter: tokenOut != HEIST");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        // stable (6 dp) -> WETH (18 dp) at 2,000 stable per WETH, then WETH -> HEIST.
        uint256 wethOut = (params.amountIn * 1e12) / 2000;
        amountOut = (wethOut * rate) / 1e18;
        require(amountOut >= params.amountOutMinimum, "MockSwapRouter: slippage");
        heist.transfer(params.recipient, amountOut);
        return amountOut;
    }

    /// @dev path = tokenIn(20) | fee(3) | mid(20) | fee(3) | tokenOut(20)
    function _decodePath(bytes calldata path) internal pure returns (address tokenIn, address mid, address tokenOut) {
        require(path.length == 66, "MockSwapRouter: bad path");
        bytes calldata p = path;
        assembly {
            tokenIn := shr(96, calldataload(p.offset))
            mid := shr(96, calldataload(add(p.offset, 23)))
            tokenOut := shr(96, calldataload(add(p.offset, 46)))
        }
    }

    receive() external payable {}
}
