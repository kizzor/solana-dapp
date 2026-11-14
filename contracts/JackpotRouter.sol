// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/IRansomeVault.sol";

/**
 * @title JackpotRouter
 * @notice The ONLY door through which launchpad trading fees enter the prize pool.
 *
 * Why this exists as a separate contract (deepseek §6.12.3):
 *   `RansomeVault.depositPrize` skims 1% to the treasury. Ticket deposits SHOULD
 *   pay that 1% — jackpot injections must NOT, or the jackpot claim "29 of every
 *   30 bps" becomes 28.71 of 30. So the vault gets a second, skim-free door that
 *   only this contract can open.
 *
 * Flow:  FeeCollector --HEIST--> JackpotRouter.injectJackpot
 *          -> HEIST goes straight to the vault
 *          -> vault.creditJackpot(amount) credits 100% to prizePoolReserve
 *          -> JackpotInjected(source, amount, newReserve)
 *
 * The router holds no funds between calls and has no owner-controlled spend.
 * It can be pointed at a new vault by the owner (vault migration), nothing else.
 */
contract JackpotRouter {
    IERC20 public immutable heist;
    IRansomeVault public vault;
    address public owner;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    /// @param source  Caller-supplied tag for the inflow (e.g. "flush", a coin id)
    /// @param amount  HEIST credited to the prize reserve
    /// @param newReserve prizePoolReserve after the credit
    event JackpotInjected(address indexed caller, bytes32 indexed source, uint256 amount, uint256 newReserve);
    event VaultUpdated(address indexed vault);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "JackpotRouter: not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "JackpotRouter: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address _heist, address _vault) {
        require(_heist != address(0), "JackpotRouter: zero HEIST");
        require(_vault != address(0), "JackpotRouter: zero vault");
        heist = IERC20(_heist);
        vault = IRansomeVault(_vault);
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    /**
     * @notice Pull `amount` HEIST from the caller and credit it to the prize pool.
     * @dev Caller must approve this contract first. Permissionless on purpose:
     *      anyone may donate to the jackpot; nobody can withdraw from it.
     * @param amount HEIST amount (18 dp).
     * @param source Free-form tag emitted for indexers.
     */
    function injectJackpot(uint256 amount, bytes32 source) external nonReentrant returns (uint256 newReserve) {
        require(amount > 0, "JackpotRouter: zero amount");
        require(address(vault) != address(0), "JackpotRouter: vault unset");

        // Tokens go straight to the vault; the router never holds a balance.
        require(heist.transferFrom(msg.sender, address(vault), amount), "JackpotRouter: transfer failed");

        newReserve = vault.creditJackpot(amount, source);

        emit JackpotInjected(msg.sender, source, amount, newReserve);
    }

    /* ---------------- Admin ---------------- */

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "JackpotRouter: zero vault");
        vault = IRansomeVault(_vault);
        emit VaultUpdated(_vault);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "JackpotRouter: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
