// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

/**
 * @title RansomeVault
 * @notice Holds the accumulated X token prize pool and the 1% treasury reserve.
 * 100% of mint auto-swaps land here:
 *  - 99% is credited to prizePoolReserve (claimable by winners).
 *  - 1% is credited to treasuryReserve (claimable only by Admin / Treasury).
 */
contract RansomeVault {
    IERC20 public immutable xToken;
    address public owner;
    address public gameContract;
    address public treasuryWallet;

    uint256 public prizePoolReserve;
    uint256 public treasuryReserve;

    uint256 public totalXPrizeAccumulated;
    uint256 public totalXPrizeClaimed;
    uint256 public totalTreasuryClaimed;

    uint256 public constant PROTOCOL_FEE_BPS = 100; // 1%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Mutex
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event PrizeDeposited(address indexed depositor, uint256 totalX, uint256 prizeShare, uint256 treasuryShare);
    event PrizeClaimed(address indexed winner, uint256 indexed sessionId, uint256 xAmount);
    event TreasuryClaimed(address indexed recipient, uint256 xAmount);
    event GameContractUpdated(address indexed newGameContract);
    event TreasuryWalletUpdated(address indexed newTreasuryWallet);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "RansomeVault: not owner");
        _;
    }

    modifier onlyGame() {
        require(msg.sender == gameContract, "RansomeVault: not game contract");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "RansomeVault: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address _xToken, address _treasuryWallet) {
        require(_xToken != address(0), "RansomeVault: zero X token address");
        require(_treasuryWallet != address(0), "RansomeVault: zero treasury address");
        xToken = IERC20(_xToken);
        treasuryWallet = _treasuryWallet;
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    /**
     * @notice Receives 100% of swapped X tokens from console mints.
     * Allocates 99% to the game prize pool and 1% to the treasury reserve.
     */
    function depositPrize(uint256 totalXAmount) external onlyGame {
        require(totalXAmount > 0, "RansomeVault: zero deposit");

        uint256 fee = (totalXAmount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 prizeShare = totalXAmount - fee;

        treasuryReserve += fee;
        prizePoolReserve += prizeShare;
        totalXPrizeAccumulated += totalXAmount;

        emit PrizeDeposited(msg.sender, totalXAmount, prizeShare, fee);
    }

    /**
     * @notice Releases X tokens directly to a verified winner.
     */
    function distributePrize(
        address winner,
        uint256 sessionId,
        uint256 xAmount
    ) external onlyGame nonReentrant {
        require(winner != address(0), "RansomeVault: invalid winner");
        require(xAmount > 0, "RansomeVault: zero prize");
        require(prizePoolReserve >= xAmount, "RansomeVault: insufficient prize reserve");
        require(xToken.balanceOf(address(this)) >= xAmount, "RansomeVault: insufficient X balance");

        prizePoolReserve -= xAmount;
        totalXPrizeClaimed += xAmount;
        require(xToken.transfer(winner, xAmount), "RansomeVault: transfer failed");

        emit PrizeClaimed(winner, sessionId, xAmount);
    }

    /**
     * @notice Admin function to withdraw the accumulated 1% treasury reserve.
     */
    function claimTreasuryReserve(address recipient) external onlyOwner nonReentrant {
        address target = recipient != address(0) ? recipient : treasuryWallet;
        uint256 amountToClaim = treasuryReserve;
        require(amountToClaim > 0, "RansomeVault: no treasury reserve to claim");
        require(xToken.balanceOf(address(this)) >= amountToClaim, "RansomeVault: insufficient X balance");

        treasuryReserve = 0;
        totalTreasuryClaimed += amountToClaim;
        require(xToken.transfer(target, amountToClaim), "RansomeVault: treasury transfer failed");

        emit TreasuryClaimed(target, amountToClaim);
    }

    function getVaultBalance() external view returns (uint256) {
        return xToken.balanceOf(address(this));
    }

    /* ---------------- Admin Functions ---------------- */

    function setGameContract(address _gameContract) external onlyOwner {
        require(_gameContract != address(0), "RansomeVault: zero address");
        gameContract = _gameContract;
        emit GameContractUpdated(_gameContract);
    }

    function setTreasuryWallet(address _treasuryWallet) external onlyOwner {
        require(_treasuryWallet != address(0), "RansomeVault: zero address");
        treasuryWallet = _treasuryWallet;
        emit TreasuryWalletUpdated(_treasuryWallet);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "RansomeVault: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(xToken), "RansomeVault: cannot rescue prize token");
        require(IERC20(token).transfer(owner, amount), "RansomeVault: rescue failed");
    }
}
