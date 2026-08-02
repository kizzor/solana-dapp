// ═══════════════════════════════════════════════════════════════════════════════
// HEIST — On-Chain Bingo / Hacking Game  (v2 — grid on-chain + claim authority)
// ───────────────────────────────────────────────────────────────────────────────
// 99% of device mint payments go to winners. 1% treasury fee.
// Payout split: FH3=40%, FH1/FH2=19.5% ea, Lines=5% ea, Early Five=5%
//
// v2 changes (2026-08-02):
//   1. Device.grid  — the 3×9 bingo ticket is GENERATED ON-CHAIN at mint time
//      from tx digest entropy and stored in the Device object. Neither the
//      client nor the server can choose the numbers, so a player cannot mint a
//      device and then register a grid that hits already-drawn numbers.
//   2. claim_win_split — now AUTHORITY-ONLY. The Session is a shared object; a
//      public claim function with no sender check let anyone call it directly
//      on-chain with their own address and drain the vault. Now only the
//      authority (the settlement server) can pay winners.
// ═══════════════════════════════════════════════════════════════════════════════

module heist::heist {

    // ─── Imports ───────────────────────────────────────────────────────────────
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::sui::SUI;
    use sui::event;
    use std::vector;

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── Token Economics ───────────────────────────────────────────────────────
    // DEVICE_PRICE removed — amount is passed dynamically from frontend
    // based on $0.50 USDC/USDT worth of SUI at current market price

    /// Treasury fee: 1% in basis points
    const TREASURY_FEE_BPS: u64 = 100;

    /// Max devices per wallet per session
    const MAX_DEVICES: u8 = 20;

    // ─── Win Type Indices ──────────────────────────────────────────────────────
    const WT_EARLY_FIVE:    u8 = 0;
    const WT_TOP_LINE:      u8 = 1;
    const WT_MIDDLE_LINE:   u8 = 2;
    const WT_BOTTOM_LINE:   u8 = 3;
    const WT_FULL_HOUSE_1:  u8 = 4;
    const WT_FULL_HOUSE_2:  u8 = 5;
    const WT_FULL_HOUSE_3:  u8 = 6;
    const NUM_WIN_TYPES:    u8 = 7;

    // ─── Payout Basis Points (99% total to winners) ────────────────────────────
    const EARLY_FIVE_BPS:    u64 = 500;   //  5%
    const TOP_LINE_BPS:      u64 = 500;   //  5%
    const MIDDLE_LINE_BPS:   u64 = 500;   //  5%
    const BOTTOM_LINE_BPS:   u64 = 500;   //  5%
    const FULL_HOUSE_1_BPS:  u64 = 1950;  // 19.5%
    const FULL_HOUSE_2_BPS:  u64 = 1950;  // 19.5%
    const FULL_HOUSE_3_BPS:  u64 = 4000;  // 40%
    // ───────────────────────────────────────────────────────────────────────────
    //                         Total: 9900 (99%)

    // ─── Grid Constants (bingo ticket shape) ───────────────────────────────────
    const GRID_ROWS: u64 = 3;
    const GRID_COLS: u64 = 9;

    // ─── Error Codes ───────────────────────────────────────────────────────────
    const ESessionNotActive:    u64 = 1;
    const ESessionPaused:       u64 = 2;
    const EWinAlreadyClaimed:   u64 = 3;
    const EInvalidWinType:      u64 = 4;
    const ENoWinners:           u64 = 5;
    const EInsufficientVault:   u64 = 6;
    const EInsufficientPayment: u64 = 7;
    const EDeviceLimitExceeded: u64 = 8;
    const ENotAuthorized:       u64 = 9;
    const ETooManyWinners:      u64 = 10;
    const EAllNumbersDrawn:     u64 = 11;

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// The game session — a shared object holding all game state.
    public struct Session has key, store {
        id: UID,
        /// Whether the game is active and accepting claims
        active: bool,
        /// Whether the game is paused (no claims, no mints)
        paused: bool,
        /// Which win types have already been claimed (7 bools)
        wins_claimed: vector<bool>,
        /// SUI vault — accumulates mint payments, pays out winners
        vault: Balance<SUI>,
        /// Treasury address receiving the 1% fee
        treasury: address,
        /// Game authority who can pause/resume/end the game
        authority: address,
        /// Treasury fee in basis points (hardcoded to 100 = 1%)
        treasury_fee_bps: u64,
        /// Number of numbers drawn so far
        draw_count: u8,
        /// The last number drawn (0-90, 0 = none yet)
        last_number: u8,
        /// All numbers drawn in this session (1-90)
        drawn_numbers: vector<u8>,
        /// Bankruptcy counter for FullHouse progression
        bankrupt_count: u8,
    }

    /// An NFT representing a player's hacking device (bingo ticket).
    /// `grid` is a 3×9 ticket (GRID_ROWS × GRID_COLS) with 15 numbers, 5 per row;
    /// 0 = empty cell, 1-90 = number. Generated ON-CHAIN at mint — unforgeable.
    public struct Device has key, store {
        id: UID,
        /// The session this device belongs to
        session_id: ID,
        /// Device index within the owner's wallet (0-19)
        device_index: u8,
        /// 3×9 bingo grid, 0 = empty cell (generated on-chain at mint)
        grid: vector<vector<u8>>,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Emitted when a new session is created
    public struct SessionCreated has copy, drop {
        session_id: ID,
        authority: address,
        treasury: address,
        treasury_fee_bps: u64,
    }

    /// Emitted when a device is minted
    public struct DeviceMinted has copy, drop {
        session_id: ID,
        device_index: u8,
        owner: address,
        amount_paid: u64,
        treasury_fee: u64,
        vault_added: u64,
        /// The on-chain generated grid (flattened 3×9, 0 = empty)
        grid: vector<u8>,
    }

    /// Emitted when a win is claimed
    public struct WinClaimed has copy, drop {
        session_id: ID,
        win_type: u8,
        num_winners: u64,
        total_payout: u64,
        bps: u64,
    }

    /// Emitted when a number is drawn by the authority
    public struct NumberDrawn has copy, drop {
        session_id: ID,
        number: u8,
        draw_count: u8,
        remaining: u8,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── Session Management ────────────────────────────────────────────────────

    /// Initialize a new game session.
    /// The sender becomes the authority.
    /// `treasury` receives the 1% fee from each device mint.
    public fun initialize_session(treasury: address, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);

        // Build wins_claimed vector (all false)
        let mut wins_claimed = vector<bool>[];
        let mut i = 0;
        while (i < NUM_WIN_TYPES) {
            vector::push_back(&mut wins_claimed, false);
            i = i + 1;
        };

        let drawn: vector<u8> = vector[];

        let session = Session {
            id: object::new(ctx),
            active: true,
            paused: false,
            wins_claimed,
            vault: balance::zero<SUI>(),
            treasury,
            authority: sender,
            treasury_fee_bps: TREASURY_FEE_BPS,
            draw_count: 0,
            last_number: 0,
            drawn_numbers: drawn,
            bankrupt_count: 0,
        };

        let session_id = object::id(&session);
        transfer::share_object(session);

        event::emit(SessionCreated {
            session_id,
            authority: sender,
            treasury,
            treasury_fee_bps: TREASURY_FEE_BPS,
        });
    }

    // ─── Device Minting ────────────────────────────────────────────────────────

    /// Mint a device (bingo ticket) by paying `amount` MIST of SUI.
    /// `amount` should equal $0.50 USDC worth of SUI (varies with SUI price).
    /// The 3×9 grid is generated ON-CHAIN from tx digest entropy and stored in
    /// the Device — neither the client nor the server can influence it.
    /// Returns the Device NFT to the sender.
    /// 1% of `amount` goes to treasury, 99% goes to the vault.
    public fun mint_device(
        mut payment: Coin<SUI>,
        session: &mut Session,
        amount: u64,
        device_index: u8,
        ctx: &mut TxContext,
    ): Device {
        // Validate session state
        assert!(session.active, ESessionNotActive);
        assert!(!session.paused, ESessionPaused);
        assert!(device_index < MAX_DEVICES, EDeviceLimitExceeded);

        // Validate payment amount
        let payment_value = coin::value(&payment);
        assert!(payment_value >= amount, EInsufficientPayment);

        // Calculate splits using provided amount (variable — based on SUI price feed)
        let fee_amount = amount * session.treasury_fee_bps / 10000;
        let vault_amount = amount - fee_amount;

        // Split payment into treasury fee + vault deposit + change
        let fee_coin = coin::split(&mut payment, fee_amount, ctx);
        let vault_coin = coin::split(&mut payment, vault_amount, ctx);
        // Remaining `payment` coin is the change (overpayment)

        // Send treasury fee to treasury address
        transfer::public_transfer(fee_coin, session.treasury);

        // Add vault deposit to the session's balance
        balance::join(&mut session.vault, coin::into_balance(vault_coin));

        // Return change to the sender
        let sender = tx_context::sender(ctx);
        transfer::public_transfer(payment, sender);

        // Generate the ticket ON-CHAIN (unforgeable) and flatten for the event
        let grid = generate_grid(ctx);
        let flat = flatten_grid(&grid);

        // Emit event
        event::emit(DeviceMinted {
            session_id: object::id(session),
            device_index,
            owner: sender,
            amount_paid: amount,
            treasury_fee: fee_amount,
            vault_added: vault_amount,
            grid: flat,
        });

        // Create and return the Device NFT
        Device {
            id: object::new(ctx),
            session_id: object::id(session),
            device_index,
            grid,
        }
    }

    // ─── Win Claims (authority-only — anti-drain) ──────────────────────────────

    /// Claim a win for a group of winners, splitting the payout equally.
    /// Dust (remainder from uneven splits) goes to the last winner.
    /// AUTHORITY-ONLY: only the game authority (settlement server) may pay out.
    /// Without this check, anyone could call this directly on the shared
    /// Session and drain the vault to their own address.
    public fun claim_win_split(
        session: &mut Session,
        winners: vector<address>,
        win_type: u8,
        ctx: &mut TxContext,
    ) {
        // ── Authority check (v2 — CRITICAL anti-drain fix) ─────────────────
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);

        // Validate session state
        assert!(session.active, ESessionNotActive);
        assert!(!session.paused, ESessionPaused);

        // Validate win type
        assert!(win_type < NUM_WIN_TYPES, EInvalidWinType);

        // Validate winners
        let num_winners = vector::length(&winners);
        assert!(num_winners > 0, ENoWinners);
        assert!(num_winners <= 100, ETooManyWinners);

        // Check win not already claimed
        let claimed = vector::borrow_mut(&mut session.wins_claimed, win_type as u64);
        assert!(!*claimed, EWinAlreadyClaimed);
        *claimed = true;

        // Calculate payout
        let bps = get_win_bps(win_type);
        let vault_value = balance::value(&session.vault);
        let total_payout = vault_value * bps / 10000;
        assert!(total_payout > 0, EInsufficientVault);

        // Calculate per-winner split
        let per_winner = total_payout / num_winners;
        let dust = total_payout - (per_winner * num_winners);

        // Pay each winner
        let mut i: u64 = 0;
        while (i < num_winners) {
            let amount = if (i == num_winners - 1) {
                per_winner + dust
            } else {
                per_winner
            };

            let winner = *vector::borrow(&winners, i);
            let payout_coin = coin::take(&mut session.vault, amount, ctx);
            transfer::public_transfer(payout_coin, winner);

            i = i + 1;
        };

        // Emit event
        event::emit(WinClaimed {
            session_id: object::id(session),
            win_type,
            num_winners,
            total_payout,
            bps,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE / INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Get the payout basis points for a win type.
    fun get_win_bps(win_type: u8): u64 {
        if (win_type == WT_EARLY_FIVE) {
            EARLY_FIVE_BPS
        } else if (win_type == WT_TOP_LINE) {
            TOP_LINE_BPS
        } else if (win_type == WT_MIDDLE_LINE) {
            MIDDLE_LINE_BPS
        } else if (win_type == WT_BOTTOM_LINE) {
            BOTTOM_LINE_BPS
        } else if (win_type == WT_FULL_HOUSE_1) {
            FULL_HOUSE_1_BPS
        } else if (win_type == WT_FULL_HOUSE_2) {
            FULL_HOUSE_2_BPS
        } else if (win_type == WT_FULL_HOUSE_3) {
            FULL_HOUSE_3_BPS
        } else {
            abort EInvalidWinType
        }
    }

    // ─── On-Chain Grid Generation (v2 — unforgeable tickets) ─────────────────
    // Uses tx digest bytes as entropy (same source as draw_number). Produces a
    // standard 3×9 bingo ticket: 15 numbers, 5 per row, 1-2 numbers per column,
    // each number within its column's decade range (col 0: 1-10 … col 8: 81-90).
    // The client cannot predict or choose the ticket, so grids cannot be crafted
    // to match already-drawn numbers.

    /// Draw the next entropy byte from the tx digest (cycled).
    /// `digest` is already a &vector<u8> (tx_context::digest returns a reference).
    fun next_entropy(digest: &vector<u8>, pos: &mut u64): u8 {
        let dl = vector::length(digest);
        let b = *vector::borrow(digest, *pos % dl);
        *pos = *pos + 1;
        b
    }

    /// Generate a random 3×9 ticket: vector of 3 rows × 9 cols, 0 = empty cell.
    fun generate_grid(ctx: &TxContext): vector<vector<u8>> {
        let digest = tx_context::digest(ctx);
        let mut pos: u64 = 0;

        // Decide which 6 of the 9 columns carry 2 numbers (rest carry 1) → 15 total.
        let mut col_two = vector<u8>[0, 0, 0, 0, 0, 0, 0, 0, 0];
        let mut picked_two: u64 = 0;
        while (picked_two < 6) {
            let e = next_entropy(digest, &mut pos);
            let col = (e as u64) % GRID_COLS;
            if (*vector::borrow(&col_two, col) == 0) {
                *vector::borrow_mut(&mut col_two, col) = 1;
                picked_two = picked_two + 1;
            };
        };

        // Empty grid: 3 rows × 9 cols of 0
        let mut grid = vector<vector<u8>>[];
        let mut r: u64 = 0;
        while (r < GRID_ROWS) {
            let mut row = vector<u8>[];
            let mut c: u64 = 0;
            while (c < GRID_COLS) {
                vector::push_back(&mut row, 0);
                c = c + 1;
            };
            vector::push_back(&mut grid, row);
            r = r + 1;
        };

        // Row fill counts — greedy placement keeps rows balanced at 5 each
        let mut row_fill = vector<u8>[0, 0, 0];

        let mut c: u64 = 0;
        while (c < GRID_COLS) {
            let count: u8 = 1 + *vector::borrow(&col_two, c);
            let lo = (c as u64) * 10 + 1; // column range: [lo, lo+9]

            // Numbers available in this column's decade range
            let mut avail = vector<u8>[];
            let mut n: u64 = 0;
            while (n < 10) {
                vector::push_back(&mut avail, ((lo + n) as u8));
                n = n + 1;
            };

            let mut k: u64 = 0;
            while (k < (count as u64)) {
                // Pick a number from the column range
                let e = next_entropy(digest, &mut pos);
                let idx = (e as u64) % vector::length(&avail);
                let num = *vector::borrow(&avail, idx);
                vector::remove(&mut avail, idx);

                // Place into the least-filled row that has a free cell in this column
                let mut best: u64 = 0;
                let mut best_fill: u8 = 255;
                let mut rr: u64 = 0;
                while (rr < GRID_ROWS) {
                    if (*vector::borrow(vector::borrow(&grid, rr), c) == 0) {
                        let f = *vector::borrow(&row_fill, rr);
                        if (f < best_fill) {
                            best_fill = f;
                            best = rr;
                        };
                    };
                    rr = rr + 1;
                };
                *vector::borrow_mut(vector::borrow_mut(&mut grid, best), c) = num;
                let f = *vector::borrow(&row_fill, best);
                *vector::borrow_mut(&mut row_fill, best) = f + 1;

                k = k + 1;
            };

            c = c + 1;
        };

        grid
    }

    /// Flatten a 3×9 grid into a 27-length vector for the mint event.
    fun flatten_grid(grid: &vector<vector<u8>>): vector<u8> {
        let mut flat = vector<u8>[];
        let mut r: u64 = 0;
        while (r < GRID_ROWS) {
            let row = vector::borrow(grid, r);
            let mut c: u64 = 0;
            while (c < GRID_COLS) {
                vector::push_back(&mut flat, *vector::borrow(row, c));
                c = c + 1;
            };
            r = r + 1;
        };
        flat
    }

    // ─── Number Drawing ────────────────────────────────────────────────────

    /// Draw the next number using on-chain entropy (tx digest).
    /// Authority-only. Picks an unused number from 1-90.
    public fun draw_number(
        session: &mut Session,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        assert!(session.active, ESessionNotActive);
        assert!(!session.paused, ESessionPaused);

        let drawn_len = vector::length(&session.drawn_numbers);
        assert!(drawn_len < 90, EAllNumbersDrawn);

        // Use tx digest bytes as entropy source
        let digest = tx_context::digest(ctx);
        let remaining = 90 - drawn_len;

        // Build list of available numbers (1-90 minus already drawn)
        let mut available = vector<u8>[];
        let mut n: u8 = 1;
        while (n <= 90) {
            let mut already_drawn = false;
            let mut j: u64 = 0;
            while (j < drawn_len) {
                if (*vector::borrow(&session.drawn_numbers, j) == n) {
                    already_drawn = true;
                    break
                };
                j = j + 1;
            };
            if (!already_drawn) {
                vector::push_back(&mut available, n);
            };
            n = n + 1;
        };

        // Pick one using entropy from tx digest (first byte)
        let entropy = *vector::borrow(digest, 0);
        let pick_index = (entropy as u64) % remaining;
        let picked = *vector::borrow(&available, pick_index);

        // Update session state
        session.last_number = picked;
        session.draw_count = session.draw_count + 1;
        vector::push_back(&mut session.drawn_numbers, picked);

        // Emit event
        event::emit(NumberDrawn {
            session_id: object::id(session),
            number: picked,
            draw_count: session.draw_count,
            remaining: (remaining - 1) as u8,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS (authority-only)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Pause the session (no mints, no claims).
    public fun pause_session(session: &mut Session, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        session.paused = true;
    }

    /// Resume a paused session.
    public fun resume_session(session: &mut Session, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        session.paused = false;
    }

    /// End the session — disables mints and claims.
    /// Unclaimed vault balance stays in the session object.
    public fun end_session(session: &mut Session, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        session.active = false;
    }
}
