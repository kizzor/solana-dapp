// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

/**
 * @title XLockVault
 * @notice Allows users to lock 1,000 X tokens to qualify for a 50% discount on Ransome console mints.
 * Enforces a 24-hour unbonding cooldown to eliminate flash-mint and same-day lock/dump exploits.
 */
contract XLockVault {
    IERC20 public immutable xToken;
    address public owner;

    uint256 public requiredLockAmount;
    uint256 public constant UNBONDING_DURATION = 24 hours;

    struct LockState {
        uint256 amount;
        uint256 unlockTimestamp;
        bool isUnbonding;
    }

    mapping(address => LockState) public locks;

    event Locked(address indexed user, uint256 amount, uint256 totalLocked);
    event UnlockInitiated(address indexed user, uint256 availableAtTimestamp);
    event UnlockCancelled(address indexed user);
    event Withdrawn(address indexed user, uint256 amount);
    event LockRequirementUpdated(uint256 newAmount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "XLockVault: caller is not owner");
        _;
    }

    constructor(address _xToken, uint256 _requiredLockAmount) {
        require(_xToken != address(0), "XLockVault: invalid token address");
        xToken = IERC20(_xToken);
        owner = msg.sender;
        requiredLockAmount = _requiredLockAmount;
    }

    /**
     * @notice Lock X tokens to become eligible for the 50% console mint discount.
     * @param amount The quantity of X tokens to deposit and lock.
     */
    function lock(uint256 amount) external {
        require(amount > 0, "XLockVault: amount must be > 0");
        
        LockState storage userLock = locks[msg.sender];
        if (userLock.isUnbonding) {
            // Cancel unbonding if user deposits more
            userLock.isUnbonding = false;
            userLock.unlockTimestamp = 0;
            emit UnlockCancelled(msg.sender);
        }

        userLock.amount += amount;
        require(xToken.transferFrom(msg.sender, address(this), amount), "XLockVault: transfer failed");

        emit Locked(msg.sender, amount, userLock.amount);
    }

    /**
     * @notice Starts the 24-hour unbonding cooldown.
     * During unbonding, discount eligibility is immediately disabled.
     */
    function initiateUnlock() external {
        LockState storage userLock = locks[msg.sender];
        require(userLock.amount > 0, "XLockVault: no tokens locked");
        require(!userLock.isUnbonding, "XLockVault: unlock already in progress");

        userLock.isUnbonding = true;
        userLock.unlockTimestamp = block.timestamp + UNBONDING_DURATION;

        emit UnlockInitiated(msg.sender, userLock.unlockTimestamp);
    }

    /**
     * @notice Cancels an ongoing unbonding process, immediately restoring discount eligibility.
     */
    function cancelUnlock() external {
        LockState storage userLock = locks[msg.sender];
        require(userLock.isUnbonding, "XLockVault: not unbonding");

        userLock.isUnbonding = false;
        userLock.unlockTimestamp = 0;

        emit UnlockCancelled(msg.sender);
    }

    /**
     * @notice Withdraws locked X tokens after the 24-hour unbonding period has elapsed.
     */
    function withdraw() external {
        LockState storage userLock = locks[msg.sender];
        require(userLock.isUnbonding, "XLockVault: unlock not initiated");
        require(block.timestamp >= userLock.unlockTimestamp, "XLockVault: unbonding period active");
        
        uint256 amountToWithdraw = userLock.amount;
        require(amountToWithdraw > 0, "XLockVault: zero balance");

        userLock.amount = 0;
        userLock.isUnbonding = false;
        userLock.unlockTimestamp = 0;

        require(xToken.transfer(msg.sender, amountToWithdraw), "XLockVault: transfer failed");
        emit Withdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @notice View function to check if a user is eligible for the 50% discount ($0.25 USDG).
     * @param user Address of the user
     * @return bool True if locked amount >= required amount and not unbonding
     */
    function isDiscountEligible(address user) external view returns (bool) {
        LockState memory userLock = locks[user];
        return (userLock.amount >= requiredLockAmount && !userLock.isUnbonding);
    }

    /**
     * @notice Admin function to adjust the required lock amount (default: 1,000 X).
     */
    function setRequiredLockAmount(uint256 _newAmount) external onlyOwner {
        requiredLockAmount = _newAmount;
        emit LockRequirementUpdated(_newAmount);
    }

    /**
     * @notice Transfer ownership of the vault.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "XLockVault: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
