// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GridLib
 * @notice A ticket is a 3×9 board holding exactly 15 numbers (5 per row), all
 *         unique, 1-90; an empty cell is 0. These are the pure rules that turn
 *         a revealed board plus the drawn numbers into a tier answer.
 * @dev Kept pure and separate from `RansomeGame` for two reasons: `claimWin`
 *      can be audited by reading one function, and the tier rules can be tested
 *      against arbitrary drawn sets instead of waiting for a lucky round.
 *
 *      Every function here must agree with the app's own checker in
 *      `lib/claim-ledger.ts` (verifyWin / isValidGrid). If the two ever
 *      disagree, an honest player is refused at the contract.
 */
library GridLib {
    uint256 internal constant CELLS = 27;
    uint256 internal constant PER_ROW = 5;

    /// @notice True when the board is a legal ticket: 5 numbers per row, 15
    ///         distinct numbers, all in 1-90.
    function validate(uint8[CELLS] memory grid) internal pure returns (bool) {
        uint256 seen;
        for (uint256 r = 0; r < 3; r++) {
            uint256 filled;
            for (uint256 c = 0; c < 9; c++) {
                uint8 n = grid[r * 9 + c];
                if (n == 0) continue;
                if (n > 90) return false;
                uint256 bit = uint256(1) << n;
                if (seen & bit != 0) return false;
                seen |= bit;
                filled++;
            }
            if (filled != PER_ROW) return false;
        }
        return true;
    }

    /**
     * @notice The draw (1-based) at which this tier first became true, or 0 if
     *         it never did.
     * @param drawn The numbers drawn so far, in draw order.
     * @param winType 0 = EARLY_FIVE (any five on the board), 1-3 = the top,
     *        middle and bottom lines, 4-6 = a full house (all fifteen). The
     *        full-house rung is NOT distinguishable by pattern — the ladder is
     *        decided by `RansomeGame.fullHouses`, exactly as in the app.
     */
    function completedAt(
        uint8[CELLS] memory grid,
        uint8[] memory drawn,
        uint8 winType
    ) internal pure returns (uint8) {
        if (winType == 0) {
            // The fifth-earliest hit: collect the five smallest hit draws.
            uint8[5] memory best;
            uint256 filled;
            for (uint256 i = 0; i < CELLS; i++) {
                uint8 n = grid[i];
                if (n == 0) continue;
                uint8 at = _firstDrawnAt(drawn, n);
                if (at == 0) continue;
                if (filled == 5 && at >= best[4]) continue;
                uint256 j = filled < 5 ? filled : 4;
                while (j > 0 && best[j - 1] > at) {
                    best[j] = best[j - 1];
                    j--;
                }
                best[j] = at;
                if (filled < 5) filled++;
            }
            return filled == 5 ? best[4] : 0;
        }

        uint256 from;
        uint256 to = CELLS;
        if (winType <= 3) {
            from = uint256(winType - 1) * 9;
            to = from + 9;
        }

        // A line needs its five numbers; a full house needs all fifteen.
        uint8 latest;
        for (uint256 i = from; i < to; i++) {
            uint8 n = grid[i];
            if (n == 0) continue;
            uint8 at = _firstDrawnAt(drawn, n);
            if (at == 0) return 0;
            if (at > latest) latest = at;
        }
        return latest;
    }

    function _firstDrawnAt(uint8[] memory drawn, uint8 n) private pure returns (uint8) {
        for (uint256 i = 0; i < drawn.length; i++) {
            if (drawn[i] == n) return uint8(i + 1);
        }
        return 0;
    }
}
