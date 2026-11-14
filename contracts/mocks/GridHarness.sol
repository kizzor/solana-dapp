// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../GridLib.sol";

/**
 * @title GridHarness
 * @notice Test-only surface for `GridLib`. Exposes the pure tier rules so they
 *         can be checked against arbitrary drawn sets — a full house cannot be
 *         produced by waiting for real draws (P ≈ 1/1300 per ticket), so
 *         without this the 40% rung would never be covered by a test.
 * @dev Never deployed, never holds funds.
 */
contract GridHarness {
    function validate(uint8[27] calldata grid) external pure returns (bool) {
        uint8[27] memory g = grid;
        return GridLib.validate(g);
    }

    function completedAt(
        uint8[27] calldata grid,
        uint8[] calldata drawn,
        uint8 winType
    ) external pure returns (uint8) {
        uint8[27] memory g = grid;
        uint8[] memory d = drawn;
        return GridLib.completedAt(g, d, winType);
    }
}
