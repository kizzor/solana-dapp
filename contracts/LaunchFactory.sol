// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LaunchToken.sol";
import "./LaunchCurve.sol";

/**
 * @title LaunchFactory
 * @notice Creates a launched coin, its curve, and the creator's optional first
 *         buy in a single transaction (§6.12.7). The launch fee is
 *         `0.0001 ETH` (§6.24 — 5x under Pons V1's 0.0005, and the only
 *         creation cost besides gas; mogz.fun charges 0 and lives on trades).
 *         Everything above it is the creator's first buy at the normal 1% fee,
 *         so the creator is not taxed like a block-0 bot.
 *
 * The factory is also the board's registry: `coinCount()` + `coins(i)` give the
 * UI one list, and `curveOf(token)` resolves a token back to its curve.
 *
 * Fee config is fixed at launch — `feeCollector` and `treasury` are read when
 * the curve is created. Changing them here only affects FUTURE launches, never
 * an existing coin.
 */
contract LaunchFactory {
    struct Coin {
        address token;
        address curve;
        address creator;
        address feeRecipient;
        string name;
        string symbol;
        string blurb;
        uint64 createdAt;
        uint256 initialBuyEth;
    }

    Coin[] private _coins;

    mapping(address => address) public curveOf;   // token => curve
    mapping(address => address) public creatorOf; // curve => creator

    address public owner;
    address public treasury;
    address public feeCollector;
    /// @notice R2 destination for every curve this factory creates. Fixed here
    ///         so no caller can pick where a coin graduates to.
    address public immutable graduator;

    /// @notice Flat creation fee, forwarded to treasury. Kept non-zero as a
    ///         spam filter: the board and tape read every coin, so free
    ///         launches would let one wallet bury the page.
    uint256 public constant LAUNCH_FEE = 0.0001 ether;

    event CoinLaunched(
        uint256 indexed coinId,
        address indexed token,
        address indexed curve,
        address creator,
        address feeRecipient
    );
    event TreasuryUpdated(address indexed treasury);
    event FeeCollectorUpdated(address indexed feeCollector);
    event OwnershipTransferred(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "LaunchFactory: not owner");
        _;
    }

    constructor(address _treasury, address _feeCollector, address _graduator) {
        require(_treasury != address(0), "LaunchFactory: zero treasury");
        require(_feeCollector != address(0), "LaunchFactory: zero collector");
        require(_graduator != address(0), "LaunchFactory: zero graduator");
        owner = msg.sender;
        treasury = _treasury;
        feeCollector = _feeCollector;
        graduator = _graduator;
    }

    /**
     * @notice Launch a coin.
     * @param name Token name.
     * @param symbol Token symbol.
     * @param blurb One-line description stored for the board.
     * @param feeRecipient Who can claim the creator's 70 bps.
     * @param minTokensOut Slippage floor for the first buy (0 if no first buy).
     * @dev `msg.value` must cover the launch fee + the first buy. The launch fee
     *      is forwarded to treasury, the rest is spent on the curve by
     *      `buyFor`, which pays the normal fee and skips the protection caps.
     */
    function createCoin(
        string calldata name,
        string calldata symbol,
        string calldata blurb,
        address feeRecipient,
        uint256 minTokensOut
    ) external payable returns (address token, address curve) {
        require(msg.value >= LAUNCH_FEE, "LaunchFactory: launch fee required");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "LaunchFactory: bad name");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 10, "LaunchFactory: bad symbol");
        require(bytes(blurb).length <= 140, "LaunchFactory: blurb too long");
        require(feeRecipient != address(0), "LaunchFactory: zero recipient");

        uint256 initialBuyEth = msg.value - LAUNCH_FEE;

        // Token first (it mints to this factory), then the curve, then the
        // supply is forwarded. Splitting it this way avoids a circular
        // constructor dependency on the curve's address.
        LaunchToken newToken = new LaunchToken(name, symbol);
        token = address(newToken);

        LaunchCurve newCurve = new LaunchCurve(
            token,
            msg.sender,
            feeRecipient,
            treasury,
            feeCollector,
            address(this),
            graduator
        );
        curve = address(newCurve);

        require(
            newToken.transfer(curve, newToken.totalSupply()),
            "LaunchFactory: supply transfer failed"
        );

        curveOf[token] = curve;
        creatorOf[curve] = msg.sender;

        _coins.push(
            Coin({
                token: token,
                curve: curve,
                creator: msg.sender,
                feeRecipient: feeRecipient,
                name: name,
                symbol: symbol,
                blurb: blurb,
                createdAt: uint64(block.timestamp),
                initialBuyEth: initialBuyEth
            })
        );

        if (initialBuyEth > 0) {
            newCurve.buyFor{value: initialBuyEth}(msg.sender, minTokensOut);
        }

        (bool ok, ) = treasury.call{value: LAUNCH_FEE}("");
        require(ok, "LaunchFactory: fee transfer failed");

        emit CoinLaunched(_coins.length - 1, token, curve, msg.sender, feeRecipient);
    }

    /* ---------------- Registry ---------------- */

    function coinCount() external view returns (uint256) {
        return _coins.length;
    }

    function coins(uint256 index) external view returns (Coin memory) {
        require(index < _coins.length, "LaunchFactory: no coin");
        return _coins[index];
    }

    /// @notice Newest-first page for the board, so one call fills a card grid.
    function recentCoins(uint256 limit, uint256 offset) external view returns (Coin[] memory page) {
        uint256 total = _coins.length;
        if (offset >= total || limit == 0) return new Coin[](0);

        uint256 remaining = total - offset;
        uint256 size = remaining < limit ? remaining : limit;
        page = new Coin[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = _coins[total - 1 - offset - i];
        }
    }

    /* ---------------- Admin ---------------- */

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "LaunchFactory: zero treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "LaunchFactory: zero collector");
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "LaunchFactory: zero owner");
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }
}
