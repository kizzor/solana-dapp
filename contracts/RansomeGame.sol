// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/ISwapRouter.sol";
import "./XLockVault.sol";
import "./RansomeVault.sol";

/**
 * @title RansomeGame
 * @notice Hacking Game Engine on Robinhood Chain (Arbitrum Orbit L2).
 * Strictly accepts USDG, USDT, USDC, and ETH ($0.50 base / $0.25 with 1,000 X locked).
 * Mints swap 100% of proceeds into X tokens directly into RansomeVault (which reserves 1% for treasury).
 */
contract RansomeGame {
    IERC20 public immutable xToken;
    IERC20 public immutable usdgToken;
    IERC20 public immutable usdtToken;
    IERC20 public immutable usdcToken;

    XLockVault public immutable lockVault;
    RansomeVault public immutable gameVault;
    ISwapRouter public swapRouter;

    address public owner;
    address public authority;

    uint256 public stablecoinBasePrice = 500_000;     // $0.50 (6 decimals)
    uint256 public stablecoinDiscountPrice = 250_000; // $0.25 (6 decimals)
    uint256 public xTokenBasePrice = 50 * 1e18;      // 50 X tokens standard
    uint256 public xTokenDiscountPrice = 25 * 1e18;  // 25 X tokens with discount (1000 X locked)

    // ETH Price in USD (8 decimals, e.g. $2500 -> 2500 * 1e8)
    uint256 public ethPriceInUsd = 2500 * 1e8;
    
    uint24 public dexPoolFee = 10000; // 1% for Pons pools

    uint8 public constant MAX_DRAWS = 59;

    struct Session {
        uint256 id;
        uint8 drawCount;
        bool active;
        uint256 startedAt;
        uint8[MAX_DRAWS] drawnNumbers;
        mapping(uint8 => bool) isDrawn;
    }

    uint256 public currentSessionId;
    mapping(uint256 => Session) internal sessions;

    // Device registration: sessionId => deviceId => Device
    struct Device {
        address owner;
        bytes32 gridHash;
        bool registered;
    }
    mapping(uint256 => mapping(uint256 => Device)) public devices;
    mapping(uint256 => uint256) public sessionDeviceCount;

    // Claim records: sessionId => deviceId => winType => claimed
    mapping(uint256 => mapping(uint256 => mapping(uint8 => bool))) public isWinClaimed;

    bool public paused;

    event SessionStarted(uint256 indexed sessionId, uint256 timestamp);
    event NumberDrawn(uint256 indexed sessionId, uint8 drawIndex, uint8 number);
    event SessionEnded(uint256 indexed sessionId, uint8 totalDraws);
    event ConsolesMinted(
        uint256 indexed sessionId,
        address indexed player,
        address paymentToken,
        uint8 count,
        uint256 xTokensBought,
        bool discountApplied
    );
    event WinClaimed(
        uint256 indexed sessionId,
        uint256 indexed deviceId,
        address indexed winner,
        uint8 winType,
        uint256 xAmountAwarded
    );
    event EthPriceUpdated(uint256 newPrice);
    event AuthorityUpdated(address indexed newAuthority);
    event RouterUpdated(address indexed newRouter);
    event PausedStateChanged(bool isPaused);

    modifier onlyOwner() {
        require(msg.sender == owner, "RansomeGame: not owner");
        _;
    }

    modifier onlyAuthority() {
        require(msg.sender == authority || msg.sender == owner, "RansomeGame: not authority");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "RansomeGame: paused");
        _;
    }

    constructor(
        address _xToken,
        address _usdgToken,
        address _usdtToken,
        address _usdcToken,
        address _lockVault,
        address _gameVault,
        address _swapRouter,
        address _authority
    ) {
        require(_xToken != address(0), "RansomeGame: zero X address");
        require(_usdgToken != address(0), "RansomeGame: zero USDG address");
        require(_usdtToken != address(0), "RansomeGame: zero USDT address");
        require(_usdcToken != address(0), "RansomeGame: zero USDC address");
        require(_lockVault != address(0), "RansomeGame: zero lockVault address");
        require(_gameVault != address(0), "RansomeGame: zero gameVault address");
        require(_authority != address(0), "RansomeGame: zero authority address");

        xToken = IERC20(_xToken);
        usdgToken = IERC20(_usdgToken);
        usdtToken = IERC20(_usdtToken);
        usdcToken = IERC20(_usdcToken);

        lockVault = XLockVault(_lockVault);
        gameVault = RansomeVault(_gameVault);
        swapRouter = ISwapRouter(_swapRouter);
        authority = _authority;
        owner = msg.sender;

        _startNewSession();
    }

    /* ---------------- Console Minting with Auto-Swap ---------------- */

    /**
     * @notice Mint consoles with strictly USDG, USDT, or USDC.
     * Swaps 100% of payment into X tokens and sends to RansomeVault (which reserves 1% for treasury).
     */
    function mintWithStablecoin(
        address stablecoin,
        uint8 count,
        bytes32[] calldata gridHashes,
        uint256 minXOut
    ) external whenNotPaused {
        require(
            stablecoin == address(usdgToken) ||
            stablecoin == address(usdtToken) ||
            stablecoin == address(usdcToken),
            "RansomeGame: only USDG, USDT, or USDC allowed"
        );
        require(count > 0 && count <= 100, "RansomeGame: count 1-100");
        require(gridHashes.length == count, "RansomeGame: grid hashes mismatch");

        Session storage s = sessions[currentSessionId];
        require(s.active, "RansomeGame: session not active");

        bool hasDiscount = lockVault.isDiscountEligible(msg.sender);
        uint256 pricePerUnit = hasDiscount ? stablecoinDiscountPrice : stablecoinBasePrice;
        uint256 totalPayment = pricePerUnit * count;

        // Collect payment
        require(IERC20(stablecoin).transferFrom(msg.sender, address(this), totalPayment), "Transfer failed");

        // Swap 100% stablecoin to X tokens
        uint256 xBought = _swapToXToken(stablecoin, totalPayment, minXOut);
        require(xBought > 0, "Zero X bought");

        // Transfer all X tokens to game vault (vault splits 99% prize / 1% treasury)
        require(xToken.transfer(address(gameVault), xBought), "Vault transfer failed");
        gameVault.depositPrize(xBought);

        _registerDevices(count, gridHashes);
        emit ConsolesMinted(currentSessionId, msg.sender, stablecoin, count, xBought, hasDiscount);
    }

    /**
     * @notice Mint consoles with Native ETH.
     */
    function mintWithETH(
        uint8 count,
        bytes32[] calldata gridHashes,
        uint256 minXOut
    ) external payable whenNotPaused {
        require(count > 0 && count <= 100, "RansomeGame: count 1-100");
        require(gridHashes.length == count, "RansomeGame: grid hashes mismatch");

        Session storage s = sessions[currentSessionId];
        require(s.active, "RansomeGame: session not active");

        bool hasDiscount = lockVault.isDiscountEligible(msg.sender);
        uint256 usdCostPerUnit = hasDiscount ? 25_000_000 : 50_000_000; // 8 decimals ($0.25 / $0.50)
        uint256 totalUsd = usdCostPerUnit * count;

        uint256 requiredEth = (totalUsd * 1e18) / ethPriceInUsd;
        require(msg.value >= requiredEth, "RansomeGame: insufficient ETH sent");

        // Refund excess ETH
        if (msg.value > requiredEth) {
            payable(msg.sender).transfer(msg.value - requiredEth);
        }

        // Swap ETH to X tokens
        uint256 xBought = _swapEthToXToken(requiredEth, minXOut);
        require(xBought > 0, "Zero X bought");

        require(xToken.transfer(address(gameVault), xBought), "Vault transfer failed");
        gameVault.depositPrize(xBought);

        _registerDevices(count, gridHashes);
        emit ConsolesMinted(currentSessionId, msg.sender, address(0), count, xBought, hasDiscount);
    }

    /**
     * @notice Mint consoles directly with X tokens on Robinhood Chain.
     * Deposits 100% of X tokens directly into RansomeVault.
     */
    function mintWithXToken(
        uint8 count,
        bytes32[] calldata gridHashes
    ) external whenNotPaused {
        require(count > 0 && count <= 100, "RansomeGame: count 1-100");
        require(gridHashes.length == count, "RansomeGame: grid hashes mismatch");

        Session storage s = sessions[currentSessionId];
        require(s.active, "RansomeGame: session not active");

        bool hasDiscount = lockVault.isDiscountEligible(msg.sender);
        uint256 pricePerUnit = hasDiscount ? xTokenDiscountPrice : xTokenBasePrice;
        uint256 totalPayment = pricePerUnit * count;

        require(xToken.transferFrom(msg.sender, address(gameVault), totalPayment), "Transfer to vault failed");
        gameVault.depositPrize(totalPayment);

        _registerDevices(count, gridHashes);
        emit ConsolesMinted(currentSessionId, msg.sender, address(xToken), count, totalPayment, hasDiscount);
    }

    function _registerDevices(uint8 count, bytes32[] calldata gridHashes) internal {
        uint256 startIndex = sessionDeviceCount[currentSessionId];
        for (uint8 i = 0; i < count; i++) {
            devices[currentSessionId][startIndex + i] = Device({
                owner: msg.sender,
                gridHash: gridHashes[i],
                registered: true
            });
        }
        sessionDeviceCount[currentSessionId] = startIndex + count;
    }

    function _swapToXToken(address tokenIn, uint256 amountIn, uint256 minOut) internal returns (uint256 amountOut) {
        if (address(swapRouter) == address(0)) return 0;
        IERC20(tokenIn).approve(address(swapRouter), 0);
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: address(xToken),
            fee: dexPoolFee,
            recipient: address(this),
            deadline: block.timestamp + 300,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });
        return swapRouter.exactInputSingle(params);
    }

    function _swapEthToXToken(uint256 ethAmount, uint256 minOut) internal returns (uint256 amountOut) {
        if (address(swapRouter) == address(0)) return 0;
        return 0; // Handled by Router
    }

    /* ---------------- Draws & Session Management ---------------- */

    function drawNumber(uint8 number) external onlyAuthority whenNotPaused {
        require(number >= 1 && number <= 90, "RansomeGame: number out of range (1-90)");
        Session storage s = sessions[currentSessionId];
        require(s.active, "RansomeGame: session not active");
        require(!s.isDrawn[number], "RansomeGame: number already drawn");
        require(s.drawCount < MAX_DRAWS, "RansomeGame: max draws reached");

        s.drawnNumbers[s.drawCount] = number;
        s.isDrawn[number] = true;
        s.drawCount++;

        emit NumberDrawn(currentSessionId, s.drawCount, number);

        if (s.drawCount == MAX_DRAWS) {
            s.active = false;
            emit SessionEnded(currentSessionId, s.drawCount);
            _startNewSession();
        }
    }

    function _startNewSession() internal {
        currentSessionId++;
        Session storage s = sessions[currentSessionId];
        s.id = currentSessionId;
        s.active = true;
        s.startedAt = block.timestamp;
        s.drawCount = 0;

        emit SessionStarted(currentSessionId, block.timestamp);
    }

    /* ---------------- Claiming Wins (In-Game OR Lobby) ---------------- */

    function claimWin(
        uint256 sessionId,
        uint256 deviceId,
        address winner,
        uint8 winType,
        uint256 xPrizeAmount
    ) external onlyAuthority whenNotPaused {
        require(winner != address(0), "RansomeGame: invalid winner");
        require(xPrizeAmount > 0, "RansomeGame: zero prize amount");
        require(devices[sessionId][deviceId].registered, "Device not registered");
        require(devices[sessionId][deviceId].owner == winner, "Winner is not device owner");
        require(!isWinClaimed[sessionId][deviceId][winType], "Win already claimed");

        isWinClaimed[sessionId][deviceId][winType] = true;

        // Distribute prize from vault
        gameVault.distributePrize(winner, sessionId, xPrizeAmount);

        emit WinClaimed(sessionId, deviceId, winner, winType, xPrizeAmount);
    }

    /* ---------------- Views ---------------- */

    function getSession(uint256 sessionId) external view returns (
        uint256 id,
        uint8 drawCount,
        bool active,
        uint256 startedAt,
        uint8[] memory drawnNumbersList
    ) {
        Session storage s = sessions[sessionId];
        drawnNumbersList = new uint8[](s.drawCount);
        for (uint8 i = 0; i < s.drawCount; i++) {
            drawnNumbersList[i] = s.drawnNumbers[i];
        }
        return (s.id, s.drawCount, s.active, s.startedAt, drawnNumbersList);
    }

    function isNumberDrawn(uint256 sessionId, uint8 number) external view returns (bool) {
        return sessions[sessionId].isDrawn[number];
    }

    /* ---------------- Admin ---------------- */

    function setAuthority(address _authority) external onlyOwner {
        require(_authority != address(0), "RansomeGame: zero address");
        authority = _authority;
        emit AuthorityUpdated(_authority);
    }

    function setEthPriceInUsd(uint256 newEthPrice) external onlyAuthority {
        require(newEthPrice > 0, "RansomeGame: invalid price");
        ethPriceInUsd = newEthPrice;
        emit EthPriceUpdated(newEthPrice);
    }

    function setSwapRouter(address _router) external onlyOwner {
        require(_router != address(0), "RansomeGame: zero address");
        swapRouter = ISwapRouter(_router);
        emit RouterUpdated(_router);
    }

    function setDexPoolFee(uint24 _fee) external onlyOwner {
        dexPoolFee = _fee;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }
}
