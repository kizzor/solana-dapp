// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";
import "./interfaces/ISwapRouter.sol";
import "./GridLib.sol";
import "./XLockVault.sol";
import "./RansomeVault.sol";

/**
 * @title RansomeGame
 * @notice Hacking Game Engine on Robinhood Chain (Arbitrum Orbit L2).
 * Strictly accepts USDG, USDT, USDC and X ($0.50 base / $0.25 with 1,000 X locked).
 * Mints swap 100% of proceeds into X tokens directly into RansomeVault (which reserves 1% for treasury).
 *
 * There is no ETH rail and there will not be one until it is built properly:
 * a USD ticket paid in ETH needs a WETH wrap plus a router that supports
 * `multicall`/`refundETH`, and the only ETH price the contract could use is
 * one the authority sets — the single manipulable price input in the whole
 * economy. Paying in a token priced in the same unit as the ticket keeps the
 * $0.50 exact with no oracle in the path.
 */
contract RansomeGame {
    IERC20 public immutable xToken;
    IERC20 public immutable usdgToken;
    /// @dev Optional rails. On Robinhood Chain only USDG is canonical today, so
    ///      these may be zero at construction and filled in later by `setStablecoins`
    ///      — requiring them up front would have blocked the whole deploy on two
    ///      addresses nobody uses yet. A zero rail is simply not accepted at mint.
    IERC20 public usdtToken;
    IERC20 public usdcToken;

    XLockVault public immutable lockVault;
    RansomeVault public immutable gameVault;
    ISwapRouter public swapRouter;

    address public owner;
    address public authority;

    // ─── USD-DENOMINATED TICKET PRICING (2026-11-01) ──────────────────────
    // A ticket costs a fixed $0.50 USD ($0.25 while 1,000 tokens are locked) in
    // ANY rail. The token rail converts that USD figure using `tokenPriceInUsd`,
    // which the authority keeps in step with the market.
    //
    // Previously this was a hardcoded "50 tokens". On a freshly launched coin
    // that is worth cents, so tickets were effectively free and — because there
    // was no setter — the only fix was redeploying the game and losing every
    // registered ticket and pending claim. Do not reintroduce a token-count price.
    uint256 public constant TICKET_PRICE_USD = 50_000_000;    // $0.50, 8 dp
    uint256 public constant TICKET_DISCOUNT_USD = 25_000_000; // $0.25, 8 dp
    uint256 public stablecoinBasePrice = 500_000;     // $0.50 (6 decimals)
    uint256 public stablecoinDiscountPrice = 250_000; // $0.25 (6 decimals)

    /// @notice USD price of the prize token, 8 decimals (e.g. $0.02 -> 2_000_000).
    /// @dev MUST be set before the token rail can mint; 0 makes ticketTokens revert.
    uint256 public tokenPriceInUsd;

    uint24 public dexPoolFee = 10000; // 1% for Pons pools

    /// @notice WETH — the routing hub. Pons launches pair ONLY against WETH, so a
    ///         stablecoin has no direct X pool and must be paid through here.
    /// @dev Zero means "single hop only"; deploy-live sets it to the Pons WETH.
    address public weth;

    /// @notice Fee tier of the stable -> WETH hop (USDG/WETH is 100 = 0.01 % on
    ///         Robinhood Chain, and the deepest of the four deployed tiers).
    uint24 public stableHopFee = 100;

    uint8 public constant MAX_DRAWS = 59;

    // ─── TIER BUCKETS (2026-11-04, §6.17.6f) ──────────────────────────────
    // These are BUCKETS of the round pot, NOT per-winner awards. A bucket is
    // divided equally among every grid that lands on that tier at the draw
    // that completed it, and an unclaimed cut goes BACK INTO THE POT when the
    // NEXT number is drawn — it is not paid to treasury and it is not lost
    // (changed 2026-11-04; the old rule was "forfeit to treasury").
    //
    // Sum = 9,900 bps (99%). The other 1% simply stays in the reserve until a
    // later bucket or a later round wins it. Never let this sum exceed 10,000 —
    // it is the solvency guard that makes it impossible for one draw to reserve
    // more than the pot holds.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Session {
        uint256 id;
        uint8 drawCount;
        bool active;
        bool settled;
        uint256 startedAt;
        /// @dev Outstanding (reserved, unpaid, unswept) allocations on this round.
        uint256 allocated;
        uint8[MAX_DRAWS] drawnNumbers;
        mapping(uint8 => bool) isDrawn;
    }

    uint256 public currentSessionId;
    mapping(uint256 => Session) internal sessions;

    /// @notice The entropy behind draw `drawIndex` of a session.
    /// @dev Stored (not just emitted) so a client can recompute the ball with
    ///      one RPC read: r = seed % remaining, then the r-th undrawn number.
    ///      A draw that does not match its seed is a provable lie.
    mapping(uint256 => mapping(uint8 => bytes32)) public drawSeeds;

    // Device registration: sessionId => deviceId => Device
    struct Device {
        address owner;
        bytes32 gridHash;
        bool registered;
        /// @dev Draws already made when this ticket was bought. A tier only
        ///      pays if it completed AFTER this — otherwise a sniper could
        ///      mint a board out of numbers already on the wall and claim a
        ///      win that had happened before the ticket existed.
        uint8 mintedAt;
    }
    mapping(uint256 => mapping(uint256 => Device)) public devices;
    mapping(uint256 => uint256) public sessionDeviceCount;

    /// @notice sessionId => board hash => already minted this round.
    /// @dev One board, one ticket, per round. Duplicates are worthless on
    ///      their own (the bucket just splits) but they are the first half of
    ///      the cloning attack: a revealed board is public calldata, so
    ///      anyone who saw a claim could re-mint an exact copy of a nearly
    ///      finished card and ride it to its next tier for free. Scoped per
    ///      session on purpose — the same card is a different proposition once
    ///      the wall is wiped.
    mapping(uint256 => mapping(bytes32 => bool)) public gridUsed;

    // Claim records: sessionId => deviceId => winType => claimed
    mapping(uint256 => mapping(uint256 => mapping(uint8 => bool))) public isWinClaimed;

    // ─── WIN / CLAIM PATH (2026-11-04) ────────────────────────────────────
    // A reserved tier win. Created at the draw that completed the tier, paid
    // by the winner pressing claim, released back into the pot when the next
    // number is drawn. These replace the old "authority authorises a number"
    // model.
    //
    // "Released" is pure accounting: the amount stops being reserved against
    // future winners, so `_availablePot()` goes back up. No tokens move, which
    // is why a missed claim can never break the round.
    struct Allocation {
        address owner;
        uint256 sessionId;
        uint256 deviceId;
        uint8 winType;
        uint256 amount;
        bool claimed;
        bool swept;
        /// @dev How many numbers existed when the authority declared this
        ///      tier. The reveal is checked against exactly those draws, so a
        ///      later ball cannot be smuggled into the proof.
        uint8 drawnUpTo;
    }

    /// @notice A tier completion the authority declares alongside a draw.
    /// @dev winType 0-3 are the board tiers (EARLY_FIVE, TOP/MIDDLE/BOTTOM
    ///      LINE). winType 4 means "this grid completed a full house" and the
    ///      contract derives the rung itself — the caller never names FH1/2/3.
    struct WinClaim {
        uint256 deviceId;
        uint8 winType;
    }

    /// @notice Lifetime full houses per wallet — the FH1 → FH2 → FH3 ladder.
    /// @dev The 4th full house restarts the ladder at FH1 (O9). Lifetime state
    ///      on purpose: it outlives every session and removes the authority's
    ///      ability to re-tier a completion.
    mapping(address => uint32) public fullHouses;

    /// @notice A grid that has completed all 15 numbers is terminal.
    mapping(uint256 => mapping(uint256 => bool)) public gridClosed;

    /// @notice allocationId => reserved win. Id 0 means "none".
    mapping(uint256 => Allocation) public allocations;
    /// @notice sessionId => deviceId => winType => allocationId
    mapping(uint256 => mapping(uint256 => mapping(uint8 => uint256))) public allocationIdOf;
    uint256 public allocationCount;

    /// @dev Sum of every outstanding allocation across every session. Payouts
    ///      size against `prizePoolReserve - totalAllocated` so two wins can
    ///      never be sized from the same token.
    uint256 public totalAllocated;

    /// @dev Allocations created at the most recent draw. The next draw sweeps
    ///      whatever is still unclaimed out of this list before it stores a
    ///      number.
    uint256[] internal _lastDrawAllocations;

    bool public paused;

    event SessionStarted(uint256 indexed sessionId, uint256 timestamp);
    event NumberDrawn(uint256 indexed sessionId, uint8 drawIndex, uint8 number, bytes32 seed);
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
    event WinAllocated(
        uint256 indexed sessionId,
        uint256 indexed deviceId,
        uint8 winType,
        address indexed winner,
        uint256 amount,
        uint256 splitWith,
        uint256 potAtDraw
    );
    event WinExpired(
        uint256 indexed sessionId,
        uint256 indexed deviceId,
        uint8 winType,
        address indexed winner,
        uint256 amount
    );
    event FullHouseRecorded(
        uint256 indexed sessionId,
        uint256 indexed deviceId,
        address indexed wallet,
        uint8 winType,
        uint32 lifetimeCount
    );
    /// @dev `carriedForward` is what stayed in the pot for the next round. It
    ///      is emitted rather than transferred: the reserve is never drained at
    ///      a round boundary.
    event RoundSettled(uint256 indexed sessionId, uint256 carriedForward);
    event TokenPriceUpdated(uint256 newPrice);
    event WethUpdated(address indexed newWeth);
    event StableHopFeeUpdated(uint24 newFee);
    event StablecoinsUpdated(address usdt, address usdc);
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
        // USDT/USDC may be zero: they are optional rails set later (see setStablecoins).
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
        uint8[27][] calldata boards,
        uint256 minXOut
    ) external whenNotPaused {
        require(
            stablecoin != address(0) &&
                (stablecoin == address(usdgToken) ||
                    stablecoin == address(usdtToken) ||
                    stablecoin == address(usdcToken)),
            "RansomeGame: only USDG, USDT, or USDC allowed"
        );
        require(count > 0 && count <= 100, "RansomeGame: count 1-100");
        require(boards.length == count, "RansomeGame: boards mismatch");

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

        _registerDevices(currentSessionId, count, boards);
        emit ConsolesMinted(currentSessionId, msg.sender, stablecoin, count, xBought, hasDiscount);
    }

    /**
     * @notice Mint consoles directly with X tokens on Robinhood Chain.
     * Deposits 100% of X tokens directly into RansomeVault.
     */
    function mintWithXToken(
        uint8 count,
        uint8[27][] calldata boards
    ) external whenNotPaused {
        require(count > 0 && count <= 100, "RansomeGame: count 1-100");
        require(boards.length == count, "RansomeGame: boards mismatch");

        Session storage s = sessions[currentSessionId];
        require(s.active, "RansomeGame: session not active");

        bool hasDiscount = lockVault.isDiscountEligible(msg.sender);
        uint256 pricePerUnit = ticketTokens(hasDiscount);
        uint256 totalPayment = pricePerUnit * count;

        require(xToken.transferFrom(msg.sender, address(gameVault), totalPayment), "Transfer to vault failed");
        gameVault.depositPrize(totalPayment);

        _registerDevices(currentSessionId, count, boards);
        emit ConsolesMinted(currentSessionId, msg.sender, address(xToken), count, totalPayment, hasDiscount);
    }

    /**
     * @notice Turns a player's boards into tickets.
     * @dev The board travels in the clear — not as a hash — so that three rules
     *      can be enforced BEFORE a ticket exists:
     *
     *        1. `GridLib.validate`: a real card — fifteen distinct numbers in
     *           1-90, five per row. `claimWin` re-checks the same array.
     *        2. Cold board: none of its fifteen numbers may already be on the
     *           wall. This is what kills sniping. A board built out of numbers
     *           already drawn starts the round with hits it did not earn — a
     *           complete board would start at fifteen.
     *        3. No second copy this round (`gridUsed`). A revealed board is
     *           public calldata, so without this anyone could re-mint a
     *           claimed 12-of-15 card and ride it to its next tier for free,
     *           and a full house could be stacked ten times over.
     *
     *      Accepting the cells instead of a hash is the whole fix: the contract
     *      is the only party that sees them, so the cold and duplicate rules
     *      cannot be sidestepped by sending a hash that does not describe the
     *      card. The hash is derived HERE and is what `claimWin` compares
     *      against, so a ticket can only ever be claimed with the board that
     *      was actually checked at mint.
     */
    function _registerDevices(uint256 sessionId, uint8 count, uint8[27][] calldata boards) internal {
        Session storage s = sessions[sessionId];
        uint256 startIndex = sessionDeviceCount[sessionId];
        uint8 mintedAt = s.drawCount;

        for (uint8 i = 0; i < count; i++) {
            uint8[27] calldata board = boards[i];
            require(GridLib.validate(board), "RansomeGame: malformed board");

            for (uint256 c = 0; c < 27; c++) {
                uint8 n = board[c];
                if (n == 0) continue;
                require(!s.isDrawn[n], "RansomeGame: board has a drawn number");
            }

            bytes32 gridHash = keccak256(abi.encodePacked(board));
            require(!gridUsed[sessionId][gridHash], "RansomeGame: board already minted");
            gridUsed[sessionId][gridHash] = true;

            devices[sessionId][startIndex + i] = Device({
                owner: msg.sender,
                gridHash: gridHash,
                registered: true,
                mintedAt: mintedAt
            });
        }
        sessionDeviceCount[sessionId] = startIndex + count;
    }

    /**
     * @notice Convert a payment token into X through the router.
     * @dev Two shapes, because the venue decides which one is possible:
     *
     *      - WETH in, or no hub configured: one direct `exactInputSingle` against
     *        the X pool at `dexPoolFee` (10000 on Pons). This is the Pons-issued
     *        token's own pool.
     *      - Any stablecoin: Pons pairs X with WETH ONLY, so a USDG→X pool does not
     *        exist. Route `stable → WETH → X` as one `exactInput`, with
     *        `stableHopFee` for the first hop and `dexPoolFee` for the second.
     *        Without this every stablecoin mint would revert on the real venue
     *        even though it works against the local mock.
     */
    function _swapToXToken(address tokenIn, uint256 amountIn, uint256 minOut) internal returns (uint256 amountOut) {
        if (address(swapRouter) == address(0)) return 0;
        IERC20(tokenIn).approve(address(swapRouter), 0);
        IERC20(tokenIn).approve(address(swapRouter), amountIn);

        if (tokenIn == weth || weth == address(0)) {
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(xToken),
                fee: dexPoolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            });
            return swapRouter.exactInputSingle(params);
        }

        bytes memory path = abi.encodePacked(tokenIn, stableHopFee, weth, dexPoolFee, address(xToken));
        return
            swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path: path,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: minOut
                })
            );
    }

    /* ---------------- Draws & Session Management ---------------- */

    /**
     * @notice Draws the next number from on-chain entropy and reserves every
     *         tier it completes.
     * @param completions Tier completions for THIS draw, declared by the
     *        authority. The contract computes every amount; the caller only
     *        says "this grid completed this tier". A full house is declared as
     *        winType 4 and the rung is derived on-chain.
     * @dev THE BALL IS NOT AN ARGUMENT. It is derived inside the transaction
     *      from `block.prevrandao`, which the chain fixes only once the
     *      transaction is being included — so the caller cannot compute which
     *      number it is about to draw, let alone pick a favourable one. The
     *      old signature took the ball as a parameter, which meant whoever
     *      held the authority key chose the outcome of every draw.
     *
     *      The seed is stored and emitted so the derivation is auditable:
     *      anyone can recompute the ball from `drawSeeds` and the already
     *      drawn set, and a mismatch is on-chain proof of tampering.
     *
     *      Trust note: `prevrandao` is the only ingredient unknown at signing
     *      time. If your chain pins it to a constant (some Orbit/AnyTrust
     *      configurations do), the seed falls back to being predictable from
     *      the previous blockhash — check it is non-constant before the pot is
     *      worth attacking.
     *
     *      Order of operations is the rule:
     *        1. release the previous draw's unclaimed cuts back into the pot,
     *        2. store the number,
     *        3. reserve this draw's buckets,
     *        4. at draw 59, seal the round and roll — the pot carries over whole.
     */
    function drawNumber(WinClaim[] calldata completions) external onlyAuthority whenNotPaused {
        Session storage s = sessions[currentSessionId];
        require(s.active, "RansomeGame: session not active");
        require(s.drawCount < MAX_DRAWS, "RansomeGame: max draws reached");

        uint8 drawIndex = s.drawCount;
        bytes32 seed = keccak256(
            abi.encodePacked(
                block.prevrandao,
                blockhash(block.number - 1),
                address(this),
                currentSessionId,
                drawIndex
            )
        );
        uint8 number = _pickUndrawn(s, seed);

        // Step 0 — the claim window of the previous draw closes here, before
        // the next number exists. An unclaimed cut is lost to the claimant and
        // returned to the pot: the player who slept gets nothing, the jackpot
        // gets everything.
        _releaseLastDraw();

        s.drawnNumbers[drawIndex] = number;
        s.isDrawn[number] = true;
        s.drawCount = drawIndex + 1;
        drawSeeds[currentSessionId][drawIndex] = seed;

        emit NumberDrawn(currentSessionId, s.drawCount, number, seed);

        // Step 1 — reserve the buckets this number completed.
        _allocate(currentSessionId, completions);

        if (s.drawCount == MAX_DRAWS) {
            s.active = false;
            emit SessionEnded(currentSessionId, s.drawCount);
            // Step 2 — the round's leftover leaves in the same transaction as
            // the roll, so no next-round deposit can be swept by accident.
            _settle(currentSessionId, s);
            _startNewSession();
        }
    }

    /// @dev Walks the undrawn numbers upward and returns the r-th one, with
    ///      r = seed mod remaining. Deterministic for a given seed and drawn
    ///      set, which is what makes the ball reproducible off-chain. The
    ///      modulo bias is at most 90/2^256 and is not exploitable.
    function _pickUndrawn(Session storage s, bytes32 seed) internal view returns (uint8) {
        uint256 target = uint256(seed) % (90 - s.drawCount);
        for (uint8 n = 1; n <= 90; n++) {
            if (s.isDrawn[n]) continue;
            if (target == 0) return n;
            target--;
        }
        revert("RansomeGame: no numbers left");
    }

    /* ---------------- Win allocation ---------------- */

    /// @notice A tier's bucket, in bps of the pot at the winning draw.
    function tierBucketBps(uint8 winType) public pure returns (uint256) {
        if (winType <= 3) return 500;        // EARLY_FIVE + the three lines, 5% each
        if (winType <= 5) return 1950;       // FULL_HOUSE_1 / FULL_HOUSE_2, 19.5% each
        if (winType == 6) return 4000;       // FULL_HOUSE_3, 40%
        revert("RansomeGame: invalid win type");
    }

    /// @dev Closes the previous draw's claim window by handing its unclaimed
    ///      cuts back to the pool. Nothing leaves the vault, so this step can
    ///      never revert, never needs a token transfer, and cannot be replayed:
    ///      the only effect is that `availablePot()` grows by what nobody took.
    function _releaseLastDraw() internal {
        uint256 len = _lastDrawAllocations.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 id = _lastDrawAllocations[i];
            Allocation storage a = allocations[id];
            if (a.claimed || a.swept) continue;

            a.swept = true;
            totalAllocated -= a.amount;
            sessions[a.sessionId].allocated -= a.amount;

            emit WinExpired(a.sessionId, a.deviceId, a.winType, a.owner, a.amount);
        }
        delete _lastDrawAllocations;
    }

    function _allocate(uint256 sessionId, WinClaim[] calldata completions) internal {
        uint256 n = completions.length;
        if (n == 0) return;

        uint8[] memory resolved = new uint8[](n);
        uint256[7] memory tierCount;

        // Pass 1 — resolve. The full-house rung is consumed in declaration
        // order, so a wallet completing twice in one draw is FH1 then FH2 and
        // never the other way around.
        for (uint256 i = 0; i < n; i++) {
            uint256 deviceId = completions[i].deviceId;
            uint8 declared = completions[i].winType;
            Device storage d = devices[sessionId][deviceId];

            require(d.registered, "RansomeGame: device not registered");
            require(!gridClosed[sessionId][deviceId], "RansomeGame: grid is closed");
            require(declared <= 4, "RansomeGame: invalid win type");

            uint8 wt = declared;
            if (declared == 4) {
                // A full house pays the wallet's NEXT rung, never a chosen one.
                wt = uint8(4 + (fullHouses[d.owner] % 3));
                fullHouses[d.owner] += 1;
                gridClosed[sessionId][deviceId] = true;
                emit FullHouseRecorded(sessionId, deviceId, d.owner, wt, fullHouses[d.owner]);
            }

            require(
                allocationIdOf[sessionId][deviceId][wt] == 0,
                "RansomeGame: tier already allocated"
            );

            resolved[i] = wt;
            tierCount[wt] += 1;
        }

        // Pass 2 — every bucket is sized against the pot as it stands now, so
        // a later draw can never spend the same tokens twice.
        uint256 pot = _availablePot();

        for (uint256 i = 0; i < n; i++) {
            _allocateOne(sessionId, completions[i].deviceId, resolved[i], pot, tierCount[resolved[i]]);
        }
    }

    function _allocateOne(
        uint256 sessionId,
        uint256 deviceId,
        uint8 wt,
        uint256 pot,
        uint256 count
    ) internal {
        uint256 bucket = (pot * tierBucketBps(wt)) / BPS_DENOMINATOR;
        uint256 share = bucket / count;

        if (share == 0) {
            // Dust pot: the tier is recorded so it cannot be re-declared, but
            // there is nothing to reserve.
            allocationIdOf[sessionId][deviceId][wt] = type(uint256).max;
            return;
        }

        uint256 id = ++allocationCount;
        Allocation storage a = allocations[id];
        a.owner = devices[sessionId][deviceId].owner;
        a.sessionId = sessionId;
        a.deviceId = deviceId;
        a.winType = wt;
        a.amount = share;
        a.drawnUpTo = sessions[sessionId].drawCount;

        allocationIdOf[sessionId][deviceId][wt] = id;
        sessions[sessionId].allocated += share;
        totalAllocated += share;
        _lastDrawAllocations.push(id);

        emit WinAllocated(sessionId, deviceId, wt, a.owner, share, count, pot);
    }

    /// @dev Tokens the pot can still commit: reserve minus everything already
    ///      reserved but unpaid. This is the number every payout is sized from.
    function _availablePot() internal view returns (uint256) {
        uint256 reserve = gameVault.prizePoolReserve();
        if (reserve <= totalAllocated) return 0;
        return reserve - totalAllocated;
    }

    /// @dev Round end: the pot carries forward whole. Every bucket nobody
    ///      claimed is already released by the next draw's release step (the
    ///      last one on the first draw of the new round), so `_availablePot()`
    ///      is the next round's opening jackpot — nothing is paid to treasury
    ///      and nothing is reset.
    ///
    ///      Consequence to keep in mind when reading the economics: the house's
    ///      take is now the 1% deposit skim only. An earlier rule sent the
    ///      leftover to treasury at the seal; that is gone on purpose.
    function _settle(uint256 sessionId, Session storage s) internal {
        if (s.settled) return;
        s.settled = true;

        emit RoundSettled(sessionId, _availablePot());
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

    /**
     * @notice The winner claims their reserved cut by revealing their board.
     * @param grid The board this ticket committed to at mint, as 27 cells in
     *        row-major order with 0 for an empty cell.
     * @dev Until this reveal existed a reserved tier was paid on the authority's
     *      word alone: it could declare `winType 4` for any ticket it liked and
     *      hand out 19.5% of the pot without a single number matching. The
     *      contract now recomputes the tier from the board and the draws that
     *      existed when the tier was declared, so a fabricated completion has
     *      nothing to claim and is released back into the pot at the next draw.
     *
     *      Three bounds make the proof airtight:
     *        1. the board must hash to the ticket's committed `gridHash`,
     *        2. the tier must be true within `drawnUpTo` draws — it cannot be
     *           repainted with numbers that arrived after the declaration,
     *        3. it must have completed AFTER the ticket was minted, and be
     *           declared within one draw of completing. Without (3) a sniper
     *           could mint a board out of numbers already on the wall and claim
     *           a win that predates the ticket, and the house could sit on a
     *           finished card until the pot peaked.
     *
     *      Claiming one tier does NOT remove the grid — it keeps playing, and a
     *      later full house is a second claim. Deliberately callable while
     *      paused: the money is already owed.
     */
    function claimWin(
        uint256 sessionId,
        uint256 deviceId,
        uint8 winType,
        uint8[27] calldata grid
    ) external {
        uint256 id = allocationIdOf[sessionId][deviceId][winType];
        require(id != 0 && id != type(uint256).max, "RansomeGame: nothing to claim");

        Allocation storage a = allocations[id];
        require(a.owner == msg.sender, "RansomeGame: not your win");
        require(!a.claimed, "RansomeGame: already claimed");
        require(!a.swept, "RansomeGame: claim window closed");

        Device storage d = devices[sessionId][deviceId];
        require(
            keccak256(abi.encodePacked(grid)) == d.gridHash,
            "RansomeGame: board does not match the ticket"
        );
        require(GridLib.validate(grid), "RansomeGame: malformed board");

        uint8 completedAt = GridLib.completedAt(
            grid,
            _drawnNumbersUpTo(sessionId, a.drawnUpTo),
            winType
        );
        require(completedAt != 0, "RansomeGame: that tier was never completed");
        require(completedAt > d.mintedAt, "RansomeGame: that board was already won at mint");
        require(a.drawnUpTo - completedAt <= 1, "RansomeGame: win declared too late");

        a.claimed = true;
        totalAllocated -= a.amount;
        sessions[sessionId].allocated -= a.amount;
        isWinClaimed[sessionId][deviceId][winType] = true;

        gameVault.distributePrize(msg.sender, sessionId, a.amount);

        emit WinClaimed(sessionId, deviceId, msg.sender, winType, a.amount);
    }

    /// @dev The session's numbers up to `upTo` draws, in draw order.
    function _drawnNumbersUpTo(uint256 sessionId, uint8 upTo) internal view returns (uint8[] memory list) {
        Session storage s = sessions[sessionId];
        list = new uint8[](upTo);
        for (uint8 i = 0; i < upTo; i++) list[i] = s.drawnNumbers[i];
    }

    /* ---------------- Views ---------------- */

    /**
     * @notice Exactly what `claimWin` checks, without moving money — for the
     *         cabinet to show why a RANSOM would be refused before it is signed.
     */
    function verifyReveal(
        uint256 sessionId,
        uint256 deviceId,
        uint8 winType,
        uint8[27] calldata grid
    )
        external
        view
        returns (
            bool boardMatches,
            bool boardValid,
            uint8 completedAt,
            bool afterMint,
            bool timely
        )
    {
        Device storage d = devices[sessionId][deviceId];
        uint256 id = allocationIdOf[sessionId][deviceId][winType];
        uint8 upTo = (id == 0 || id == type(uint256).max)
            ? sessions[sessionId].drawCount
            : allocations[id].drawnUpTo;

        boardMatches = keccak256(abi.encodePacked(grid)) == d.gridHash;
        boardValid = GridLib.validate(grid);
        completedAt = GridLib.completedAt(grid, _drawnNumbersUpTo(sessionId, upTo), winType);
        afterMint = completedAt > d.mintedAt;
        timely = completedAt != 0 && upTo - completedAt <= 1;
    }

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

    /// @notice Tokens the pot can still commit right now (reserve − reserved).
    function availablePot() external view returns (uint256) {
        return _availablePot();
    }

    /// @notice Outstanding reservations on a round.
    function sessionAllocated(uint256 sessionId) external view returns (uint256) {
        return sessions[sessionId].allocated;
    }

    function isRoundSettled(uint256 sessionId) external view returns (bool) {
        return sessions[sessionId].settled;
    }

    /// @notice What one grid can claim for a tier: amount, claimed, expired.
    function claimableOf(
        uint256 sessionId,
        uint256 deviceId,
        uint8 winType
    ) external view returns (uint256 amount, bool claimed, bool expired) {
        uint256 id = allocationIdOf[sessionId][deviceId][winType];
        if (id == 0 || id == type(uint256).max) return (0, false, true);
        Allocation memory a = allocations[id];
        return (a.amount, a.claimed, a.swept);
    }

    /// @notice Allocation ids created at the most recent draw (the live window).
    function lastDrawAllocationIds() external view returns (uint256[] memory) {
        return _lastDrawAllocations;
    }

    /* ---------------- Admin ---------------- */

    function setAuthority(address _authority) external onlyOwner {
        require(_authority != address(0), "RansomeGame: zero address");
        authority = _authority;
        emit AuthorityUpdated(_authority);
    }

    /**
     * @notice Keep the ticket price honest as the prize token trades.
     * @dev USD-denominated tickets: the token amount owed = $0.50 / tokenPriceInUsd.
     *      Set this BEFORE opening minting, and update it with the market.
     * @param newPrice Token price in USD with 8 decimals (e.g. $0.02 -> 2_000_000).
     */
    function setTokenPriceInUsd(uint256 newPrice) external onlyAuthority {
        require(newPrice > 0, "RansomeGame: invalid token price");
        tokenPriceInUsd = newPrice;
        emit TokenPriceUpdated(newPrice);
    }

    /**
     * @notice Tokens owed for ONE ticket at the current price, rounded UP.
     * @dev Rounding up keeps the house from under-charging dust on every mint.
     * @param discounted True for the 1,000-token-lock price ($0.25).
     */
    function ticketTokens(bool discounted) public view returns (uint256) {
        require(tokenPriceInUsd > 0, "RansomeGame: token price unset");
        uint256 usd = discounted ? TICKET_DISCOUNT_USD : TICKET_PRICE_USD;
        return (usd * 1e18 + tokenPriceInUsd - 1) / tokenPriceInUsd;
    }

    function setSwapRouter(address _router) external onlyOwner {
        require(_router != address(0), "RansomeGame: zero address");
        swapRouter = ISwapRouter(_router);
        emit RouterUpdated(_router);
    }

    function setDexPoolFee(uint24 _fee) external onlyOwner {
        dexPoolFee = _fee;
    }

    /// @notice Set the WETH routing hub used for the stablecoin two-hop path.
    function setWeth(address _weth) external onlyOwner {
        require(_weth != address(0), "RansomeGame: zero weth");
        weth = _weth;
        emit WethUpdated(_weth);
    }

    /// @notice Set the fee tier of the stable -> WETH hop (e.g. 100, 500, 3000, 10000).
    function setStableHopFee(uint24 _fee) external onlyOwner {
        require(_fee < 1_000_000, "RansomeGame: invalid fee");
        stableHopFee = _fee;
        emit StableHopFeeUpdated(_fee);
    }

    /// @notice Fill in the optional USDT/USDC rails after deploy. Zero disables a rail.
    function setStablecoins(address _usdt, address _usdc) external onlyOwner {
        usdtToken = IERC20(_usdt);
        usdcToken = IERC20(_usdc);
        emit StablecoinsUpdated(_usdt, _usdc);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }
}
