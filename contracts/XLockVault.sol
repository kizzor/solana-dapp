// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/IRansomeVault.sol";

interface IJackpotSink {
    function injectJackpot(uint256 amount, bytes32 source) external returns (uint256);
}

/**
 * @title XLockVault
 * @notice Lock 1,000 X to qualify for the 50% discount on Ransome console mints.
 *         24h unbonding removes flash-mint and same-day lock/dump exploits.
 *
 * Staking fuel (deepseek 6.45):
 *   A slice of every lock - `lockFuelBps`, default 1000 bps = 10% - is forwarded to
 *   the jackpot vault through the permissionless `injectJackpot` door. The same
 *   RAFFLE that buys discounted-play status also feeds the prize pool.
 *
 *   The fuel is NOT withdrawable: it leaves the vault for the prize reserve at lock
 *   time. Principal accounting stays exact:
 *     deposited = lifetime RAFFLE the user sent in (drives discount eligibility)
 *     amount    = RAFFLE still held here for the user (what `withdraw` returns)
 *
 *   When no sink is wired (`jackpotSink == address(0)`) the split is skipped and the
 *   whole lock is retained, so nothing is ever stranded.
 */
contract XLockVault {
    IERC20 public immutable xToken;
    address public owner;

    /// @dev JackpotRouter. Zero address => fuel is disabled entirely.
    IJackpotSink public jackpotSink;
    /// @dev Bps of each lock forwarded to the jackpot. Default 1000 = 10%.
    uint256 public lockFuelBps;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_FUEL_BPS = 5000;

    /// @dev RansomeVault — pays accrued staking yield out of the prize reserve.
    address public ransomeVault;

    uint256 public requiredLockAmount;

    /// @notice USD value a lock must be worth to unlock the discount, 8 dp. 0 = off.
    /// @dev A fixed token count is only a barrier while the token is expensive. On a
    ///      fresh launch 1,000 tokens is cents, so "lock 1,000" was free status for
    ///      everyone. With this set (and a price source wired) the requirement is
    ///      re-derived from the live token price on every read, so it keeps meaning
    ///      the same amount of money however the coin trades.
    uint256 public requiredLockUsd8dp;

    /// @notice Contract exposing `tokenPriceInUsd()` (8 dp) — RansomeGame, normally.
    /// @dev Read by low-level staticcall, so a broken or unset source can only ever
    ///      fall back to `requiredLockAmount`; it can never lock mints out.
    address public priceSource;

    uint256 public constant UNBONDING_DURATION = 24 hours;

    struct LockState {
        uint256 amount;
        uint256 deposited;
        uint256 unlockTimestamp;
        bool isUnbonding;
    }

    mapping(address => LockState) public locks;

    uint256 public totalFuelInjected;

    // ---- staking yield (Synthetix reward-per-token, funded by real fee inflows) ----
    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Locked(address indexed user, uint256 amount, uint256 fuel, uint256 totalLocked);
    event UnlockInitiated(address indexed user, uint256 availableAtTimestamp);
    event UnlockCancelled(address indexed user);
    event Withdrawn(address indexed user, uint256 amount);
    event FuelInjected(address indexed user, uint256 amount, uint256 newSinkBalance);
    event RewardNotified(uint256 amount, uint256 newRewardPerToken);
    event RewardClaimed(address indexed user, uint256 amount);
    event RansomeVaultUpdated(address indexed vault);
    event LockRequirementUpdated(uint256 newAmount);
    event LockRequirementUsdUpdated(uint256 newUsd8dp);
    event PriceSourceUpdated(address indexed source);
    event JackpotSinkUpdated(address indexed sink);
    event LockFuelBpsUpdated(uint256 bps);
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
        lockFuelBps = 1000;
    }

    function lock(uint256 amount) external {
        require(amount > 0, "XLockVault: amount must be > 0");

        _updateReward(msg.sender);

        LockState storage userLock = locks[msg.sender];
        if (userLock.isUnbonding) {
            userLock.isUnbonding = false;
            userLock.unlockTimestamp = 0;
            emit UnlockCancelled(msg.sender);
        }

        require(xToken.transferFrom(msg.sender, address(this), amount), "XLockVault: transfer failed");

        uint256 fuel = (amount * lockFuelBps) / BPS_DENOMINATOR;
        uint256 retained = amount - fuel;

        userLock.deposited += amount;
        userLock.amount += retained;
        totalStaked += retained;

        if (fuel > 0 && address(jackpotSink) != address(0)) {
            require(xToken.approve(address(jackpotSink), 0), "XLockVault: approve reset failed");
            require(xToken.approve(address(jackpotSink), fuel), "XLockVault: approve failed");
            uint256 newReserve = jackpotSink.injectJackpot(fuel, bytes32("lock"));
            totalFuelInjected += fuel;
            emit FuelInjected(msg.sender, fuel, newReserve);
        }

        emit Locked(msg.sender, retained, fuel, userLock.amount);
    }

    function initiateUnlock() external {
        LockState storage userLock = locks[msg.sender];
        require(userLock.amount > 0, "XLockVault: no tokens locked");
        require(!userLock.isUnbonding, "XLockVault: unlock already in progress");

        userLock.isUnbonding = true;
        userLock.unlockTimestamp = block.timestamp + UNBONDING_DURATION;

        emit UnlockInitiated(msg.sender, userLock.unlockTimestamp);
    }

    function cancelUnlock() external {
        LockState storage userLock = locks[msg.sender];
        require(userLock.isUnbonding, "XLockVault: not unbonding");

        userLock.isUnbonding = false;
        userLock.unlockTimestamp = 0;

        emit UnlockCancelled(msg.sender);
    }

    function withdraw() external {
        _updateReward(msg.sender);

        LockState storage userLock = locks[msg.sender];
        require(userLock.isUnbonding, "XLockVault: unlock not initiated");
        require(block.timestamp >= userLock.unlockTimestamp, "XLockVault: unbonding period active");

        uint256 amountToWithdraw = userLock.amount;
        require(amountToWithdraw > 0, "XLockVault: zero balance");

        if (totalStaked >= amountToWithdraw) totalStaked -= amountToWithdraw;

        userLock.amount = 0;
        userLock.deposited = 0;
        userLock.isUnbonding = false;
        userLock.unlockTimestamp = 0;

        require(xToken.transfer(msg.sender, amountToWithdraw), "XLockVault: transfer failed");
        emit Withdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @notice True when the user locked enough (lifetime deposits) and is not unbonding.
     * @dev Eligibility keys on `deposited`, not the retained balance, so the fuel slice
     *      does not silently raise the entry price of the discount.
     */
    function isDiscountEligible(address user) external view returns (bool) {
        LockState memory userLock = locks[user];
        return (userLock.deposited >= lockRequirement() && !userLock.isUnbonding);
    }

    /**
     * @notice Tokens a lock must hold right now to qualify for the discount.
     * @dev USD-denominated when both `requiredLockUsd8dp` and a working
     *      `priceSource` are set; otherwise the plain `requiredLockAmount`. Reads
     *      round UP so the barrier is never a hair below the target value.
     */
    function lockRequirement() public view returns (uint256) {
        if (requiredLockUsd8dp == 0 || priceSource == address(0)) return requiredLockAmount;

        (bool ok, bytes memory data) = priceSource.staticcall(abi.encodeWithSignature("tokenPriceInUsd()"));
        if (!ok || data.length < 32) return requiredLockAmount;

        uint256 price = abi.decode(data, (uint256));
        if (price == 0) return requiredLockAmount;

        return (requiredLockUsd8dp * 1e18 + price - 1) / price;
    }

    /// @notice Named-field view of a user's lock (the mapping getter is an unnamed tuple).
    function lockInfo(address user)
        external
        view
        returns (uint256 amount, uint256 deposited, uint256 unlockTimestamp, bool isUnbonding)
    {
        LockState memory l = locks[user];
        return (l.amount, l.deposited, l.unlockTimestamp, l.isUnbonding);
    }

    /// @notice Splits `amount` into the jackpot fuel and the retained principal.
    function fuelFor(uint256 amount) external view returns (uint256 fuel, uint256 retained) {
        if (address(jackpotSink) == address(0)) return (0, amount);
        fuel = (amount * lockFuelBps) / BPS_DENOMINATOR;
        retained = amount - fuel;
    }

    // ---- staking yield views + actions ----

    /// @notice Lifetime retained stake currently held (sum of all `amount`).
    function totalStakedAmount() external view returns (uint256) {
        return totalStaked;
    }

    /// @notice Accrued but unclaimed yield for `user`.
    function earned(address user) public view returns (uint256) {
        LockState memory l = locks[user];
        uint256 accrued = l.amount * (rewardPerTokenStored - userRewardPerTokenPaid[user]) / 1e18;
        return rewards[user] + accrued;
    }

    function _updateReward(address account) internal {
        if (account == address(0)) return;
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }

    /// @notice Called by RansomeVault (or owner) when a real fee inflow lands.
    /// @dev The 10% lock fuel path never calls this, so the fuel stays jackpot-only.
    function notifyRewardAmount(uint256 amount) external {
        require(msg.sender == owner || msg.sender == ransomeVault, "XLockVault: not authorized");
        if (amount == 0 || totalStaked == 0) return;
        rewardPerTokenStored += (amount * 1e18) / totalStaked;
        emit RewardNotified(amount, rewardPerTokenStored);
    }

    /// @notice Claims accrued yield: pulls X out of RansomeVault to the caller.
    function claimReward() external {
        _updateReward(msg.sender);
        uint256 amount = rewards[msg.sender];
        require(amount > 0, "XLockVault: nothing to claim");
        rewards[msg.sender] = 0;
        userRewardPerTokenPaid[msg.sender] = rewardPerTokenStored;

        require(ransomeVault != address(0), "XLockVault: vault unset");
        IRansomeVault(ransomeVault).claimStakingReward(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    /// @notice Wire the RansomeVault that pays yields.
    function setRansomeVault(address _vault) external onlyOwner {
        require(_vault != address(0), "XLockVault: zero vault");
        ransomeVault = _vault;
        emit RansomeVaultUpdated(_vault);
    }

    function setRequiredLockAmount(uint256 _newAmount) external onlyOwner {
        requiredLockAmount = _newAmount;
        emit LockRequirementUpdated(_newAmount);
    }

    /// @notice Require a lock worth `_usd8dp` (8 dp, e.g. $25 = 2_500_000_000) instead
    ///         of a fixed token count. Pass 0 to go back to `requiredLockAmount`.
    function setRequiredLockUsd(uint256 _usd8dp) external onlyOwner {
        requiredLockUsd8dp = _usd8dp;
        emit LockRequirementUsdUpdated(_usd8dp);
    }

    /// @notice Wire the contract that answers `tokenPriceInUsd()` (RansomeGame).
    /// @dev address(0) clears it, restoring the fixed `requiredLockAmount`.
    function setPriceSource(address _source) external onlyOwner {
        priceSource = _source;
        emit PriceSourceUpdated(_source);
    }

    /// @notice Wire the JackpotRouter. Once set, locks start fuelling the prize pool.
    function setJackpotSink(address _sink) external onlyOwner {
        require(_sink != address(0), "XLockVault: zero sink");
        jackpotSink = IJackpotSink(_sink);
        emit JackpotSinkUpdated(_sink);
    }

    /// @notice Change the fuel slice. 1000 = 10%; hard-capped at 50%.
    function setLockFuelBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_FUEL_BPS, "XLockVault: fuel bps too high");
        lockFuelBps = _bps;
        emit LockFuelBpsUpdated(_bps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "XLockVault: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
