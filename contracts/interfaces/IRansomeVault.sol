// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The one vault function the jackpot router needs.
/// @dev Deliberately narrower than RansomeVault so the router cannot reach
///      depositPrize (which skims 1%) or the treasury/ownership controls.
interface IRansomeVault {
    /// @notice Credits a jackpot injection to the prize reserve with NO treasury skim.
    /// @dev Tokens must already be in the vault when this is called.
    /// @return newReserve The prizePoolReserve after crediting.
    function creditJackpot(uint256 amount, bytes32 source) external returns (uint256 newReserve);

    /// @notice Pays an accrued staking yield to `user` out of the prize reserve.
    /// @dev Only the staking vault (XLockVault) may call this.
    function claimStakingReward(address user, uint256 amount) external returns (uint256 newReserve);

    function prizePoolReserve() external view returns (uint256);
}
