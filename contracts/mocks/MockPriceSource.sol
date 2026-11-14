// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Stands in for RansomeGame when testing `XLockVault.lockRequirement()`.
/// @dev Same getter the vault reads by staticcall: `tokenPriceInUsd()` (8 dp).
contract MockPriceSource {
    uint256 public tokenPriceInUsd;

    function setPrice(uint256 price8dp) external {
        tokenPriceInUsd = price8dp;
    }
}
