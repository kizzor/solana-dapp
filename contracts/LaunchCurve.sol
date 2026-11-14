// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

interface ILaunchGraduator {
    function onGraduate(
        address token,
        uint256 tokenAmount,
        uint256 virtualEthReserve,
        uint256 virtualTokenReserve
    ) external payable returns (bytes32 poolId);
}

/**
 * @title LaunchCurve
 * @notice Pre-graduation constant-product curve for one launched coin, quoted
 *         in native ETH, with the ratified 1.00% trade fee split taken IN the
 *         trade (§6.12.3): 70 bps creator · 29 bps jackpot · 1 bp treasury.
 *
 * Ported from the only portable part of the pump.fun archive (§2.6,
 * `programs/pump-amm/src/curve/constant_product.rs`):
 *
 *   tokensOut = floor(tokenReserve * ethIn / (ethReserve + ethIn))
 *   ethOut    = floor(ethReserve * tokensIn / (tokenReserve + tokensIn))
 *   fee       = ceil(amount * bps / 10_000)
 *
 * The two properties that matter and that the tests pin:
 *
 *  1. **The fee is in the quote asset, never in the coin.** A fee paid in the
 *     launched coin can only be monetised by selling that coin, i.e. by dumping
 *     on the people who just bought it (§2.5, §6.5).
 *  2. **The 29 bps leaves for `FeeCollector` on every trade.** Plain ETH is
 *     sent to the collector's `receive()`, which wraps it to WETH and adds it
 *     to `pending`; `flush()` is the only thing that swaps it into the jackpot
 *     token. The curve never holds the jackpot slice between trades.
 *
 * Graduation is a CEILING and then a MIGRATION (R2, §6.16.2): reaching
 * `GRADUATION_ETH` stops new buys and emits `GraduationReady`, while sells stay
 * open so nobody is trapped at the line. `graduate()` hands the real ETH and
 * the remaining tokens to `LaunchGraduator`, which opens a Uniswap v4 pool at
 * the curve's own marginal price. After that the pool — not this curve — is the
 * venue, and both curve directions close.
 */
contract LaunchCurve {
    IERC20 public immutable token;
    address public immutable creator;
    /// @notice Receives the creator's 70 bps. Fixed at launch, never changed.
    address public immutable creatorFeeRecipient;
    address public immutable treasury;
    address public immutable feeCollector;
    address public immutable factory;
    address public immutable graduator;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant TOTAL_FEE_BPS = 100;   // 1.00% of the trade
    // The split is of the FEE, not of the trade: 70% / 29% / 1% of 100 bps
    // gives 70 / 29 / 1 bps of trade volume. Treasury is the remainder so the
    // three buckets always sum to the fee exactly.
    uint256 public constant CREATOR_SHARE_BPS = 7_000; // 70% of the fee
    uint256 public constant JACKPOT_SHARE_BPS = 2_900; // 29% of the fee
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    /// @dev Starting FDV = virtual ETH reserve = 1 ETH. Kept as a constant so
    ///      every coin starts on the same terms.
    uint256 public constant INITIAL_VIRTUAL_ETH = 1 ether;
    uint256 public constant GRADUATION_ETH = 4.2 ether;

    /// @dev Launch protection (§6.12.5 / R4): the creation block is
    ///      creator-only, and for the next two blocks a wallet may hold at most
    ///      5% of supply and buy at most 5.5%.
    uint256 public constant PROTECTION_BLOCKS = 2;
    uint256 public constant PROTECTION_MAX_HOLD_BPS = 500; // 5.0%
    uint256 public constant PROTECTION_MAX_BUY_BPS = 550;  // 5.5%

    /// @dev Public buys in the creation block pay the sniper tax. The creator's
    ///      first buy rides inside the creation transaction (`buyFor`) and pays
    ///      the normal 1%.
    uint256 public constant CREATION_SLOT_FEE_BPS = 9_900; // 99%

    uint256 public virtualEthReserve;
    uint256 public virtualTokenReserve;
    /// @dev ETH that actually backs sells. Fees live outside this number.
    uint256 public realEthReserve;

    uint256 public creatorFees;
    uint256 public treasuryFees;
    uint256 public jackpotFees;      // cumulative, already forwarded
    uint256 public totalVolumeEth;
    uint32 public holderCount;

    uint256 public immutable launchBlock;
    bool public readyToGraduate;
    bool public graduated;
    /// @notice Real ETH at the moment `graduate()` ran (kept for the UI; the
    ///         live `realEthReserve` moves to the pool and goes to zero).
    uint256 public graduatedEth;

    mapping(address => bool) public hasBought;
    mapping(address => uint256) public boughtDuringProtection;

    event Bought(
        address indexed buyer,
        uint256 ethIn,
        uint256 fee,
        uint256 tokensOut,
        uint256 realEthAfter
    );
    event Sold(
        address indexed seller,
        uint256 tokensIn,
        uint256 grossEth,
        uint256 fee,
        uint256 ethOut
    );
    event CreatorFeesClaimed(address indexed recipient, uint256 amount);
    event TreasuryFeesClaimed(address indexed recipient, uint256 amount);
    event GraduationReady(uint256 realEthReserve, uint256 tokensRemaining);
    event Graduated(address indexed graduator, bytes32 indexed poolId, uint256 ethIn, uint256 tokensIn);

    modifier onlyFactory() {
        require(msg.sender == factory, "LaunchCurve: not factory");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "LaunchCurve: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor(
        address _token,
        address _creator,
        address _creatorFeeRecipient,
        address _treasury,
        address _feeCollector,
        address _factory,
        address _graduator
    ) {
        require(_token != address(0), "LaunchCurve: zero token");
        require(_creator != address(0), "LaunchCurve: zero creator");
        require(_creatorFeeRecipient != address(0), "LaunchCurve: zero recipient");
        require(_treasury != address(0), "LaunchCurve: zero treasury");
        require(_feeCollector != address(0), "LaunchCurve: zero collector");
        require(_factory != address(0), "LaunchCurve: zero factory");
        require(_graduator != address(0), "LaunchCurve: zero graduator");

        token = IERC20(_token);
        creator = _creator;
        creatorFeeRecipient = _creatorFeeRecipient;
        treasury = _treasury;
        feeCollector = _feeCollector;
        factory = _factory;
        graduator = _graduator;

        virtualEthReserve = INITIAL_VIRTUAL_ETH;
        virtualTokenReserve = TOTAL_SUPPLY;
        launchBlock = block.number;

        _status = _NOT_ENTERED;
    }

    /* ---------------- Trading ---------------- */

    /**
     * @notice Buy the launched coin with ETH.
     * @dev The fee is charged on `msg.value` and the net ETH moves the curve.
     *      The creation block is creator-only; from the next block the ordinary
     *      curve is open to everyone.
     */
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(msg.value > 0, "LaunchCurve: zero ETH");
        require(!graduated, "LaunchCurve: graduated");
        require(!readyToGraduate, "LaunchCurve: curve complete");

        uint256 feeBps = TOTAL_FEE_BPS;
        if (block.number == launchBlock) {
            require(msg.sender == creator, "LaunchCurve: launch block is creator only");
            feeBps = CREATION_SLOT_FEE_BPS;
        }

        uint256 fee = _ceilDiv(msg.value * feeBps, BPS_DENOMINATOR);
        uint256 netEth = msg.value - fee;
        tokensOut = _tokensForEth(netEth);
        require(tokensOut > 0, "LaunchCurve: zero tokens");
        require(tokensOut >= minTokensOut, "LaunchCurve: slippage");

        _enforceProtection(msg.sender, tokensOut);
        _settleBuy(msg.sender, msg.value, fee, netEth, tokensOut);
    }

    /**
     * @notice The creator's first buy, executed inside `LaunchFactory.createCoin`.
     * @dev Pays the normal fee (the anti-bot 99% is only for public trades in
     *      the creation block) and skips the launch-protection caps, because the
     *      factory sizes this buy itself.
     */
    function buyFor(
        address buyer,
        uint256 minTokensOut
    ) external payable onlyFactory nonReentrant returns (uint256 tokensOut) {
        require(msg.value > 0, "LaunchCurve: zero ETH");
        require(!graduated, "LaunchCurve: graduated");
        require(!readyToGraduate, "LaunchCurve: curve complete");

        uint256 fee = _ceilDiv(msg.value * TOTAL_FEE_BPS, BPS_DENOMINATOR);
        uint256 netEth = msg.value - fee;
        tokensOut = _tokensForEth(netEth);
        require(tokensOut > 0, "LaunchCurve: zero tokens");
        require(tokensOut >= minTokensOut, "LaunchCurve: slippage");

        _settleBuy(buyer, msg.value, fee, netEth, tokensOut);
    }

    function _settleBuy(
        address buyer,
        uint256 grossEth,
        uint256 fee,
        uint256 netEth,
        uint256 tokensOut
    ) internal {
        require(tokensOut <= token.balanceOf(address(this)), "LaunchCurve: sold out");

        _splitFee(fee);

        virtualEthReserve += netEth;
        virtualTokenReserve -= tokensOut;
        realEthReserve += netEth;
        totalVolumeEth += grossEth;

        if (!hasBought[buyer]) {
            hasBought[buyer] = true;
            holderCount += 1;
        }

        require(token.transfer(buyer, tokensOut), "LaunchCurve: token transfer failed");

        if (!readyToGraduate && realEthReserve >= GRADUATION_ETH) {
            readyToGraduate = true;
            emit GraduationReady(realEthReserve, token.balanceOf(address(this)));
        }

        emit Bought(buyer, grossEth, fee, tokensOut, realEthReserve);
    }

    /**
     * @notice Sell the coin back into the curve.
     * @dev Stays open after the graduation ceiling so holders are never stuck;
     *      only new buys stop.
     */
    function sell(
        uint256 tokenAmount,
        uint256 minEthOut
    ) external nonReentrant returns (uint256 ethOut) {
        require(tokenAmount > 0, "LaunchCurve: zero tokens");
        require(!graduated, "LaunchCurve: graduated");

        uint256 grossEth = _ethForTokens(tokenAmount);
        require(grossEth > 0, "LaunchCurve: zero ETH out");
        require(grossEth <= realEthReserve, "LaunchCurve: insufficient curve ETH");

        uint256 fee = _ceilDiv(grossEth * TOTAL_FEE_BPS, BPS_DENOMINATOR);
        ethOut = grossEth - fee;
        require(ethOut >= minEthOut, "LaunchCurve: slippage");

        _splitFee(fee);

        virtualEthReserve -= grossEth;
        virtualTokenReserve += tokenAmount;
        realEthReserve -= grossEth;
        totalVolumeEth += grossEth;

        require(
            token.transferFrom(msg.sender, address(this), tokenAmount),
            "LaunchCurve: token transfer failed"
        );

        (bool ok, ) = msg.sender.call{value: ethOut}("");
        require(ok, "LaunchCurve: ETH transfer failed");

        emit Sold(msg.sender, tokenAmount, grossEth, fee, ethOut);
    }

    /* ---------------- Graduation (R2) ---------------- */

    /**
     * @notice Migrate the finished curve into its Uniswap v4 pool.
     * @dev Permissionless once the 4.2 ETH ceiling is reached: the destination
     *      is fixed at construction, so there is nothing for a caller to choose.
     *      The curve's accrued creator/treasury fees stay here and remain
     *      claimable; only the `realEthReserve` backing the market moves.
     */
    function graduate() external nonReentrant returns (bytes32 poolId) {
        require(readyToGraduate, "LaunchCurve: not ready");
        require(!graduated, "LaunchCurve: already graduated");

        uint256 eth = realEthReserve;
        uint256 tokens = token.balanceOf(address(this));
        require(eth > 0 && tokens > 0, "LaunchCurve: nothing to migrate");

        graduated = true;
        graduatedEth = eth;
        realEthReserve = 0;

        require(token.transfer(graduator, tokens), "LaunchCurve: token transfer failed");

        poolId = ILaunchGraduator(graduator).onGraduate{value: eth}(
            address(token),
            tokens,
            virtualEthReserve,
            virtualTokenReserve
        );

        emit Graduated(graduator, poolId, eth, tokens);
    }

    /* ---------------- Fees ---------------- */

    /// @dev creator / jackpot floored, treasury takes the remainder. The three
    ///      always sum to `fee`, so no wei is invented or lost.
    function _splitFee(uint256 fee) internal {
        if (fee == 0) return;

        uint256 creatorCut = (fee * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 jackpotCut = (fee * JACKPOT_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryCut = fee - creatorCut - jackpotCut;

        creatorFees += creatorCut;
        treasuryFees += treasuryCut;
        jackpotFees += jackpotCut;

        if (jackpotCut > 0) {
            // FeeCollector.receive() wraps this to WETH and adds it to `pending`.
            // It is the only path the 29 bps takes; the curve never keeps it.
            (bool ok, ) = feeCollector.call{value: jackpotCut}("");
            require(ok, "LaunchCurve: jackpot accrual failed");
        }
    }

    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        require(msg.sender == creatorFeeRecipient, "LaunchCurve: not fee recipient");
        amount = creatorFees;
        require(amount > 0, "LaunchCurve: nothing to claim");
        creatorFees = 0;

        (bool ok, ) = creatorFeeRecipient.call{value: amount}("");
        require(ok, "LaunchCurve: claim failed");
        emit CreatorFeesClaimed(creatorFeeRecipient, amount);
    }

    function claimTreasuryFees() external nonReentrant returns (uint256 amount) {
        require(msg.sender == treasury, "LaunchCurve: not treasury");
        amount = treasuryFees;
        require(amount > 0, "LaunchCurve: nothing to claim");
        treasuryFees = 0;

        (bool ok, ) = treasury.call{value: amount}("");
        require(ok, "LaunchCurve: claim failed");
        emit TreasuryFeesClaimed(treasury, amount);
    }

    /* ---------------- Launch protection ---------------- */

    function _enforceProtection(address buyer, uint256 tokensOut) internal {
        if (block.number <= launchBlock) return; // creation handled by buyFor
        if (block.number > launchBlock + PROTECTION_BLOCKS) return;

        uint256 maxHold = (TOTAL_SUPPLY * PROTECTION_MAX_HOLD_BPS) / BPS_DENOMINATOR;
        uint256 maxBuy = (TOTAL_SUPPLY * PROTECTION_MAX_BUY_BPS) / BPS_DENOMINATOR;

        uint256 bought = boughtDuringProtection[buyer] + tokensOut;
        require(bought <= maxBuy, "LaunchCurve: protection buy cap");

        uint256 held = token.balanceOf(buyer) + tokensOut;
        require(held <= maxHold, "LaunchCurve: protection hold cap");

        boughtDuringProtection[buyer] = bought;
    }

    function protectionActive() external view returns (bool) {
        return block.number > launchBlock && block.number <= launchBlock + PROTECTION_BLOCKS;
    }

    /* ---------------- Curve math / views ---------------- */

    function _tokensForEth(uint256 ethIn) internal view returns (uint256) {
        if (ethIn == 0) return 0;
        return (virtualTokenReserve * ethIn) / (virtualEthReserve + ethIn);
    }

    function _ethForTokens(uint256 tokensIn) internal view returns (uint256) {
        if (tokensIn == 0) return 0;
        return (virtualEthReserve * tokensIn) / (virtualTokenReserve + tokensIn);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : ((a - 1) / b) + 1;
    }

    /// @notice Wei per token, 18 dp — the curve's marginal price before fees.
    function currentPrice() public view returns (uint256) {
        if (virtualTokenReserve == 0) return 0;
        return (virtualEthReserve * 1e18) / virtualTokenReserve;
    }

    /// @notice Quote a buy at the normal 1% fee (the creation block is not quotable).
    function quoteBuy(uint256 ethIn) external view returns (uint256 tokensOut, uint256 fee) {
        fee = _ceilDiv(ethIn * TOTAL_FEE_BPS, BPS_DENOMINATOR);
        tokensOut = _tokensForEth(ethIn - fee);
    }

    /// @notice Quote a sell at the normal 1% fee.
    function quoteSell(uint256 tokensIn) external view returns (uint256 ethOut, uint256 fee) {
        uint256 gross = _ethForTokens(tokensIn);
        fee = _ceilDiv(gross * TOTAL_FEE_BPS, BPS_DENOMINATOR);
        ethOut = gross - fee;
    }

    function graduationProgressBps() external view returns (uint256) {
        if (graduated || realEthReserve >= GRADUATION_ETH) return BPS_DENOMINATOR;
        return (realEthReserve * BPS_DENOMINATOR) / GRADUATION_ETH;
    }

    /// @notice Tokens the curve still holds and can sell.
    function tokensAvailable() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    receive() external payable {
        revert("LaunchCurve: use buy");
    }
}
