// ============================================================================
// HEIST - On-Chain Bingo / Hacking Game  (v6 - AUTO SESSION ROTATION)
// ----------------------------------------------------------------------------
// 99% of device mint payments go to winners. 1% treasury fee.
// Payout split: FH3=40%, FH1/FH2=19.5% ea, Lines=5% ea, Early Five=5%
//
// v2 (2026-08-02): on-chain grids + authority-only claim_win_split.
// v3 (2026-08-04): HEIST becomes a REAL coin (create_currency) + MAX_SUPPLY.
// v4 (2026-08-04): FULL HEIST economy -
//     * Session vault now holds Balance<HEIST> (mints + payouts in HEIST)
//     * mint_device(Coin<HEIST>, amount) - 500 HEIST = $0.50
//       or 250 HEIST = $0.25 for MTRX holders (verified server-side)
//     * MAX_SUPPLY = 2,000,000,000 HEIST hard cap (2e9 coins x 9 decimals)
//     * Airdrop pool (500M) + Vesting (500M linear release) + 1B circulating
//     * mint_heist/burn_heist - TreasuryCap holder (authority) only
// v5 (2026-08-04): ANY-COIN mint, HEIST-only vault -
//     * HeistAdmin shared object holds the TreasuryCap + a per-coin price table
//       (coin type -> exact raw units accepted for a $0.50 mint payment)
//     * mint_device<T> accepts Coin<T> for any registered coin (SUI/USDC/USDT/
//       HEIST), validates the payment against the on-chain price table, sends
//       the 1% treasury fee in the paid coin, and MINTS HEIST into the vault
//       (99%) / treasury (1%) from the cap. Vault stays Balance<HEIST>.
//     * set_price<T> lets the authority update prices (SUI price refreshed by
//       the cron from a live feed) WITHOUT republishing.
// ============================================================================

module heist::heist {

    // --- Imports --------------------------------------------------------------
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::url::Url;
    use std::option;
    use std::string::{Self, String};
    use std::type_name::{Self, TypeName};
    use std::vector;

    // ==========================================================================
    // CONSTANTS
    // ==========================================================================

    // --- HEIST Token ----------------------------------------------------------
    const HEIST_DECIMALS: u8 = 9;
    /// Hard cap: 2,000,000,000 HEIST (raw = 2e9 coins * 1e9 decimals)
    const MAX_SUPPLY: u64 = 2_000_000_000_000_000_000;
    // v5 (floatable HEIST price): the per-coin payment amounts are NO LONGER
    // hardcoded — they live in the HeistAdmin price table (one entry per coin,
    // including HEIST itself). The authority refreshes them (e.g. the draw
    // cron from live feeds) so the $0.50/$0.25 mint price follows the market.

    /// Treasury fee: 1% in basis points
    const TREASURY_FEE_BPS: u64 = 100;

    /// Max devices per wallet per session
    const MAX_DEVICES: u8 = 20;

    // --- Win Type Indices -----------------------------------------------------
    const WT_EARLY_FIVE:    u8 = 0;
    const WT_TOP_LINE:      u8 = 1;
    const WT_MIDDLE_LINE:   u8 = 2;
    const WT_BOTTOM_LINE:   u8 = 3;
    const WT_FULL_HOUSE_1:  u8 = 4;
    const WT_FULL_HOUSE_2:  u8 = 5;
    const WT_FULL_HOUSE_3:  u8 = 6;
    const NUM_WIN_TYPES:    u8 = 7;

    // --- Game Parameters (v6) ------------------------------------------------
    /// Maximum numbers drawn per session. At ~1 draw/min, a session runs
    /// for ~59 minutes before auto-advancing to the next one.
    const MAX_DRAWS: u8 = 59;

    // --- Payout Basis Points (99% total to winners) ---------------------------
    const EARLY_FIVE_BPS:    u64 = 500;   //  5%
    const TOP_LINE_BPS:      u64 = 500;   //  5%
    const MIDDLE_LINE_BPS:   u64 = 500;   //  5%
    const BOTTOM_LINE_BPS:   u64 = 500;   //  5%
    const FULL_HOUSE_1_BPS:  u64 = 1950;  // 19.5%
    const FULL_HOUSE_2_BPS:  u64 = 1950;  // 19.5%
    const FULL_HOUSE_3_BPS:  u64 = 4000;  // 40%
    //                              Total: 9900 (99%)

    // --- Grid Constants (bingo ticket shape) ----------------------------------
    const GRID_ROWS: u64 = 3;
    const GRID_COLS: u64 = 9;

    // --- Error Codes ----------------------------------------------------------
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
    const EMaxSupplyExceeded:   u64 = 12;
    const EInvalidPrice:        u64 = 13;
    const ENotVested:           u64 = 14;
    const EAirdropExhausted:    u64 = 15;
    const EUnsupportedCoin:     u64 = 16;
    const EPriceNotSet:         u64 = 17;
    const ERegistryNotSet:      u64 = 18;

    // ==========================================================================
    // STRUCTS
    // ==========================================================================

    /// One-time witness for the HEIST coin (create_currency).
    public struct HEIST has drop {}

    /// The game session - a shared object holding all game state.
    public struct Session has key, store {
        id: UID,
        /// Whether the game is active and accepting claims
        active: bool,
        /// Whether the game is paused (no claims, no mints)
        paused: bool,
        /// Which win types have already been claimed (7 bools)
        wins_claimed: vector<bool>,
        /// HEIST vault - accumulates mint payments, pays out winners
        vault: Balance<HEIST>,
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
    /// `grid` is a 3x9 ticket (GRID_ROWS x GRID_COLS) with 15 numbers, 5 per row;
    /// 0 = empty cell, 1-90 = number. Generated ON-CHAIN at mint - unforgeable.
    public struct Device has key, store {
        id: UID,
        /// The session this device belongs to
        session_id: ID,
        /// Device index within the owner's wallet (0-19)
        device_index: u8,
        /// 3x9 bingo grid, 0 = empty cell (generated on-chain at mint)
        grid: vector<vector<u8>>,
    }

    /// Locked HEIST supply - releases linearly to `beneficiary` over time.
    /// Created by the authority at launch (500M HEIST), claimed gradually.
    public struct Vesting has key, store {
        id: UID,
        /// Address that receives released HEIST (the treasury/authority wallet)
        beneficiary: address,
        /// Total locked HEIST (raw units)
        total_locked: u64,
        /// HEIST already claimed/released (raw units)
        claimed: u64,
        /// Vesting start (unix milliseconds)
        start_ms: u64,
        /// Vesting duration in milliseconds (e.g. 24 months)
        duration_ms: u64,
        /// Locked balance being released
        vault: Balance<HEIST>,
    }

    /// HEIST airdrop pool - 500M HEIST reserved for MTRX holders.
    /// Claims are authority-gated: the server verifies the wallet's Solana
    /// MTRX holdings (snapshot) BEFORE calling claim_airdrop, so the SUI
    /// contract itself cannot be drained by non-holders.
    public struct AirdropPool has key, store {
        id: UID,
        /// Authority who may release airdrops
        authority: address,
        /// Remaining airdrop HEIST (raw units)
        remaining: u64,
        /// Pool balance
        vault: Balance<HEIST>,
    }

    // --- Session Registry (v6) ------------------------------------------------

    /// The game registry — a single shared object that holds the pointer to
    /// the CURRENT active session, the treasury address, and admin controls
    /// (pause/resume). The draw cron reads current_session_id to know which
    /// session to draw from, and calls advance_session() when it exhausts.
    /// This eliminates the need for manual env-var updates between sessions.
    public struct SessionRegistry has key, store {
        id: UID,
        /// Authority who can draw, settle, advance sessions, pause, etc.
        authority: address,
        /// Treasury address receiving unclaimed funds and fees
        treasury: address,
        /// Pointer to the current active Session object
        current_session_id: ID,
        /// Whether the game is paused (no draws, no mints, no claims)
        paused: bool,
        /// When the pause ends (unix ms). 0 = indefinite pause.
        pause_end_ms: u64,
    }

    /// Shared admin (v5): holds the HEIST TreasuryCap + the per-coin price
    /// table used by mint_device to validate any-coin payments. Authority can
    /// update prices (e.g. SUI price from a live feed) WITHOUT republishing.
    public struct HeistAdmin has key, store {
        id: UID,
        /// Authority who manages the cap + prices
        authority: address,
        /// HEIST TreasuryCap (mints vault emissions + airdrops/vesting)
        treasury_cap: TreasuryCap<HEIST>,
        /// Coin type -> exact raw units accepted as a FULL-price ($0.50) mint
        /// payment in that coin (discount = half for MTRX holders)
        prices: Table<TypeName, u64>,
    }

    // ==========================================================================
    // EVENTS
    // ==========================================================================

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
        /// HEIST tier paid in raw units (from the price table: $0.50 worth,
        /// or half for MTRX-discounted mints)
        amount_paid: u64,
        /// Raw units actually required in the payment coin (from the price table)
        payment_value: u64,
        /// Whether this was a discounted (MTRX-holder) mint
        discounted: bool,
        /// The coin type used for payment (e.g. 0x2::sui::SUI)
        coin: String,
        treasury_fee: u64,
        vault_added: u64,
        /// The on-chain generated grid (flattened 3x9, 0 = empty)
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

    /// Emitted when HEIST tokens are minted (rewards/airdrop)
    public struct HeistMinted has copy, drop {
        amount: u64,
        to: address,
    }

    /// Emitted when HEIST tokens are burned
    public struct HeistBurned has copy, drop {
        amount: u64,
    }

    /// Emitted when HEIST is released from vesting
    public struct VestedReleased has copy, drop {
        amount: u64,
        to: address,
    }

    /// Emitted when HEIST is airdropped to an MTRX holder
    public struct AirdropClaimed has copy, drop {
        amount: u64,
        to: address,
        remaining: u64,
    }
    // ==========================================================================
    // PUBLIC FUNCTIONS
    // ==========================================================================

    // --- One-time init: create the HEIST coin ---------------------------------

    /// Runs automatically at publish. Creates the HEIST coin (create_currency)
    /// and transfers the TreasuryCap to the publisher (the authority) - only
    /// it can mint/burn HEIST. CoinMetadata is frozen (immutable).
    fun init(witness: HEIST, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency<HEIST>(
            witness,
            HEIST_DECIMALS,
            b"HEIST",
            b"HEIST",
            b"HEIST - RANSOME gaming token",
            option::none<Url>(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
    }

    // --- HEIST Token (v3/v4) --------------------------------------------------

    /// Mint HEIST as rewards/airdrops. HARD MAX_SUPPLY CAP enforced here:
    /// aborts (EMaxSupplyExceeded) if total supply would exceed MAX_SUPPLY.
    /// v5: the TreasuryCap lives in the shared HeistAdmin - authority only.
    public fun mint_heist(
        admin: &mut HeistAdmin,
        amount: u64,
        to: address,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == admin.authority, ENotAuthorized);
        assert!(coin::total_supply(&admin.treasury_cap) + amount <= MAX_SUPPLY, EMaxSupplyExceeded);
        let coin = coin::mint(&mut admin.treasury_cap, amount, ctx);
        transfer::public_transfer(coin, to);
        event::emit(HeistMinted { amount, to });
    }

    /// Burn HEIST (deflation). Only the TreasuryCap holder can call this.
    public fun burn_heist(cap: &mut TreasuryCap<HEIST>, coin: Coin<HEIST>) {
        let amount = coin::burn(cap, coin);
        event::emit(HeistBurned { amount });
    }

    // --- Vesting (500M locked HEIST) ------------------------------------------

    /// Create a locked HEIST balance that releases linearly to `beneficiary`
    /// over `duration_ms`. Authority-only (needs the TreasuryCap to mint).
    /// The locked amount is minted from the cap and sealed in a shared Vesting
    /// object - it CANNOT be touched until claim_vested releases it.
    public fun create_vesting(
        admin: &mut HeistAdmin,
        beneficiary: address,
        amount: u64,
        duration_ms: u64,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == admin.authority, ENotAuthorized);
        assert!(coin::total_supply(&admin.treasury_cap) + amount <= MAX_SUPPLY, EMaxSupplyExceeded);
        let balance = coin::into_balance(coin::mint(&mut admin.treasury_cap, amount, ctx));
        let vesting = Vesting {
            id: object::new(ctx),
            beneficiary,
            total_locked: amount,
            claimed: 0,
            start_ms: tx_context::epoch_timestamp_ms(ctx),
            duration_ms,
            vault: balance,
        };
        transfer::share_object(vesting);
    }

    /// Claim any HEIST that has vested so far. Linear release:
    ///   released = total_locked * elapsed / duration_ms
    /// Anyone may call this, but tokens always go to `beneficiary`.
    /// Math is done in u128 to avoid u64 overflow (total_locked up to 5e17
    /// times an epoch-ms elapsed ~1e12 far exceeds u64 max).
    public fun claim_vested(vesting: &mut Vesting, ctx: &mut TxContext) {
        let now = tx_context::epoch_timestamp_ms(ctx);
        let elapsed = if (now > vesting.start_ms) { now - vesting.start_ms } else { 0 };
        let vested = if (elapsed >= vesting.duration_ms) {
            vesting.total_locked
        } else {
            ((vesting.total_locked as u128) * (elapsed as u128) / (vesting.duration_ms as u128)) as u64
        };
        let release = vested - vesting.claimed;
        assert!(release > 0, ENotVested);
        vesting.claimed = vested;
        let coin = coin::take(&mut vesting.vault, release, ctx);
        transfer::public_transfer(coin, vesting.beneficiary);
        event::emit(VestedReleased { amount: release, to: vesting.beneficiary });
    }


    // --- Airdrop pool (500M for MTRX holders) ---------------------------------

    /// Create the 500M airdrop pool. Authority-only (needs the TreasuryCap).
    public fun create_airdrop_pool(
        admin: &mut HeistAdmin,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == admin.authority, ENotAuthorized);
        assert!(coin::total_supply(&admin.treasury_cap) + amount <= MAX_SUPPLY, EMaxSupplyExceeded);
        let balance = coin::into_balance(coin::mint(&mut admin.treasury_cap, amount, ctx));
        let pool = AirdropPool {
            id: object::new(ctx),
            authority: tx_context::sender(ctx),
            remaining: amount,
            vault: balance,
        };
        transfer::share_object(pool);
    }

    /// Release an airdrop to a verified MTRX holder. AUTHORITY-ONLY: the server
    /// must verify the wallet's Solana MTRX holdings (snapshot) before calling
    /// this - the SUI contract cannot read Solana, so the authority is the gate.
    public fun claim_airdrop(
        pool: &mut AirdropPool,
        amount: u64,
        to: address,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == pool.authority, ENotAuthorized);
        assert!(amount <= pool.remaining, EAirdropExhausted);
        let coin = coin::take(&mut pool.vault, amount, ctx);
        pool.remaining = pool.remaining - amount;
        transfer::public_transfer(coin, to);
        event::emit(AirdropClaimed { amount, to, remaining: pool.remaining });
    }

    // --- HeistAdmin: treasury cap + per-coin prices (v5) -----------------------

    /// Create the shared HeistAdmin. Called ONCE at setup (right after
    /// publish): the TreasuryCap handed to the publisher in `init` is moved
    /// into the admin, so mint_device can mint vault emissions from it.
    /// The sender becomes the admin authority (use the SAME key as the
    /// session authority).
    public fun create_admin(cap: TreasuryCap<HEIST>, ctx: &mut TxContext) {
        let admin = HeistAdmin {
            id: object::new(ctx),
            authority: tx_context::sender(ctx),
            treasury_cap: cap,
            prices: table::new(ctx),
        };
        transfer::share_object(admin);
    }

    /// Register or update the exact raw units of coin T accepted as a
    /// FULL-price ($0.50) mint payment. Authority only - e.g. the cron
    /// refreshes the SUI price from a live feed without republishing.
    public fun set_price<T>(admin: &mut HeistAdmin, price: u64, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == admin.authority, ENotAuthorized);
        assert!(price > 0, EInvalidPrice);
        let key = type_name::with_original_ids<T>();
        if (table::contains(&admin.prices, key)) {
            *table::borrow_mut(&mut admin.prices, key) = price;
        } else {
            table::add(&mut admin.prices, key, price);
        };
    }

    // --- Session Management ---------------------------------------------------

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
            vault: balance::zero<HEIST>(),
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

    // --- Device Minting -------------------------------------------------------

    /// Mint a device (bingo ticket) by paying $0.50 worth of ANY registered
    /// coin, or $0.25 for MTRX holders (discounted = true). v5:
    ///   * The exact raw payment for coin T comes from the on-chain price table
    ///     (set at setup + refreshed by the authority via set_price). HEIST has
    ///     a FLOATABLE price: the table entry for HEIST itself defines how many
    ///     HEIST a $0.50 mint costs (e.g. 250 HEIST when 1 HEIST = $0.002).
    ///   * The 1% treasury fee + 99% conversion proceeds are captured in the
    ///     PAID COIN and sent to treasury (excess over `required` returned as
    ///     change).
    ///   * HEIST is minted from the HeistAdmin TreasuryCap (the table's HEIST
    ///     tier, 99% -> vault / 1% -> treasury). The vault ALWAYS holds only
    ///     HEIST.
    /// The 3x9 grid is generated ON-CHAIN from tx digest entropy and stored in
    /// the Device - neither the client nor the server can influence it.
    /// Returns the Device NFT to the sender.
    public fun mint_device<T>(
        mut payment: Coin<T>,
        session: &mut Session,
        admin: &mut HeistAdmin,
        discounted: bool,
        device_index: u8,
        ctx: &mut TxContext,
    ): Device {
        // Validate session state
        assert!(session.active, ESessionNotActive);
        assert!(!session.paused, ESessionPaused);
        assert!(device_index < MAX_DEVICES, EDeviceLimitExceeded);

        // HEIST tier = $0.50 (or $0.25) worth of HEIST, from the price table.
        // This is the vault HEIST minted for ANY payment coin, so the vault
        // always holds exactly the USD equivalent of what was paid.
        let heist_tname = type_name::with_original_ids<HEIST>();
        assert!(table::contains(&admin.prices, heist_tname), EPriceNotSet);
        let heist_full = *table::borrow(&admin.prices, heist_tname);
        // Defense-in-depth: a sane HEIST tier must be set (set_price already
        // rejects 0, but a corrupted entry must never allow free vault minting).
        assert!(heist_full > 0, EPriceNotSet);
        let heist_tier = if (discounted) { heist_full / 2 } else { heist_full };

        // Required raw payment in THIS coin for a full-price mint (price table)
        let tname = type_name::with_original_ids<T>();
        assert!(table::contains(&admin.prices, tname), EUnsupportedCoin);
        let full = *table::borrow(&admin.prices, tname);
        let required = if (discounted) { full / 2 } else { full };

        // Validate payment amount (>= required; excess is returned as change)
        let payment_value = coin::value(&payment);
        assert!(payment_value >= required, EInsufficientPayment);

        // Capture the exact required payment: 1% treasury fee + the remaining
        // 99% as the conversion proceeds. The $0.50 worth of the paid coin is
        // "converted" into HEIST in the vault below (minted from the cap); the
        // treasury collects the paid coin + the HEIST fee. Excess over
        // `required` (e.g. the client's SUI buffer) is returned as change.
        let mut required_coin = coin::split(&mut payment, required, ctx);
        let fee_amount = required / 100;
        let fee_coin = coin::split(&mut required_coin, fee_amount, ctx);
        transfer::public_transfer(fee_coin, session.treasury);
        transfer::public_transfer(required_coin, session.treasury);

        // Return change (overpayment) to the sender. When the payment was
        // EXACTLY `required` (e.g. stablecoin mints with no buffer), the
        // leftover coin has zero value — destroy it instead of dusting the
        // payer's wallet with a 0-balance coin.
        let sender = tx_context::sender(ctx);
        if (coin::value(&payment) == 0) {
            coin::destroy_zero(payment);
        } else {
            transfer::public_transfer(payment, sender);
        };

        // Mint HEIST from the cap (checked once for the tier): 99% vault,
        // 1% treasury. Vault stays Balance<HEIST>.
        // u128 math: the table's heist_tier has NO upper bound (set_price only
        // rejects 0), so `heist_tier * 99` could overflow u64 for a corrupt or
        // absurd table entry — compute in u128 before casting back (M1 fix).
        assert!(
            (coin::total_supply(&admin.treasury_cap) as u128) + (heist_tier as u128) <= (MAX_SUPPLY as u128),
            EMaxSupplyExceeded
        );
        let vault_amount = ((heist_tier as u128) * 99 / 100) as u64;
        let treasury_amount = (heist_tier / 100);
        let vault_coin = coin::mint(&mut admin.treasury_cap, vault_amount, ctx);
        balance::join(&mut session.vault, coin::into_balance(vault_coin));
        let treasury_coin = coin::mint(&mut admin.treasury_cap, treasury_amount, ctx);
        transfer::public_transfer(treasury_coin, session.treasury);

        // Generate the ticket ON-CHAIN (unforgeable) and flatten for the event
        let grid = generate_grid(ctx);
        let flat = flatten_grid(&grid);

        // Emit event
        event::emit(DeviceMinted {
            session_id: object::id(session),
            device_index,
            owner: sender,
            amount_paid: heist_tier,
            payment_value,
            discounted,
            // with_defining_ids (formerly get; NOT with_original_ids) so the
            // emitted coin type carries the real published package address — the
            // server matches it against ${SUI_PROGRAM_ID}::heist::HEIST / known
            // types exactly. The table lookups above keep using
            // with_original_ids (internally consistent).
            coin: string::from_ascii(type_name::into_string(type_name::with_defining_ids<T>())),
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

    // --- Win Claims (authority-only - anti-drain) -----------------------------

    /// Claim a win for a group of winners, splitting the payout equally.
    /// Dust (remainder from uneven splits) goes to the last winner.
    /// AUTHORITY-ONLY: only the game authority (settlement server) may pay out.
    public fun claim_win_split(
        session: &mut Session,
        winners: vector<address>,
        win_type: u8,
        ctx: &mut TxContext,
    ) {
        // Authority check (v2 - CRITICAL anti-drain fix)
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

    // ==========================================================================
    // PRIVATE / INTERNAL HELPERS
    // ==========================================================================

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

    // --- On-Chain Grid Generation (v2 - unforgeable tickets) ------------------

    /// Draw the next entropy byte from the tx digest (cycled).
    fun next_entropy(digest: &vector<u8>, pos: &mut u64): u8 {
        let dl = vector::length(digest);
        let b = *vector::borrow(digest, *pos % dl);
        *pos = *pos + 1;
        b
    }

    /// Generate a random 3x9 ticket: vector of 3 rows x 9 cols, 0 = empty cell.
    fun generate_grid(ctx: &TxContext): vector<vector<u8>> {
        let digest = tx_context::digest(ctx);
        let mut pos: u64 = 0;

        // Decide which 6 of the 9 columns carry 2 numbers (rest carry 1) -> 15 total.
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

        // Empty grid: 3 rows x 9 cols of 0
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

        // Row fill counts - greedy placement keeps rows balanced at 5 each
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

    /// Flatten a 3x9 grid into a 27-length vector for the mint event.
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

    // --- Number Drawing -------------------------------------------------------

    /// Draw the next number using on-chain entropy (tx digest).
    /// Authority-only. Picks an unused number from 1-90.
    /// v6: limit is MAX_DRAWS (59) per session, not 90.
    public fun draw_number(
        session: &mut Session,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        assert!(session.active, ESessionNotActive);
        assert!(!session.paused, ESessionPaused);

        let drawn_len = vector::length(&session.drawn_numbers);
        assert!(drawn_len < (MAX_DRAWS as u64), EAllNumbersDrawn);

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

    // ==========================================================================
    // ADMIN FUNCTIONS (authority-only)
    // ==========================================================================

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

    /// End the session - disables mints and claims.
    /// Unclaimed vault balance stays in the session object.
    public fun end_session(session: &mut Session, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        session.active = false;
    }

    // ==========================================================================
    // SESSION REGISTRY (v6) — Auto-rotation, pause, treasury management
    // ==========================================================================

    /// Create the session registry. Called ONCE at setup (right after publish).
    /// The authority becomes the game operator. The first session should be
    /// created separately via initialize_session, then registered via
    /// register_initial_session.
    public fun create_registry(ctx: &mut TxContext) {
        let registry = SessionRegistry {
            id: object::new(ctx),
            authority: tx_context::sender(ctx),
            treasury: tx_context::sender(ctx), // default: authority is treasury
            current_session_id: object::id_from_address(@0x0), // placeholder
            paused: false,
            pause_end_ms: 0,
        };
        transfer::share_object(registry);
    }

    /// Register the initial (or any) session in the registry.
    /// Authority-only. Use this after initialize_session to set the first
    /// current_session_id, or to manually point at an existing session.
    public fun register_initial_session(
        registry: &mut SessionRegistry,
        session_id: ID,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == registry.authority, ENotAuthorized);
        registry.current_session_id = session_id;
    }

    /// Set the treasury address. Authority-only.
    public fun set_treasury(
        registry: &mut SessionRegistry,
        treasury: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == registry.authority, ENotAuthorized);
        registry.treasury = treasury;
    }

    /// Advance to the next session. Authority-only.
    /// Creates a fresh Session with vault=0, draw_count=0, and updates the
    /// registry pointer. Called by the draw cron when the current session
    /// exhausts all MAX_DRAWS numbers.
    public fun advance_session(
        registry: &mut SessionRegistry,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == registry.authority, ENotAuthorized);

        // Build wins_claimed vector (all false)
        let mut wins_claimed = vector<bool>[];
        let mut i = 0;
        while (i < NUM_WIN_TYPES) {
            vector::push_back(&mut wins_claimed, false);
            i = i + 1;
        };

        let session = Session {
            id: object::new(ctx),
            active: true,
            paused: false,
            wins_claimed,
            vault: balance::zero<HEIST>(),
            treasury: registry.treasury,
            authority: registry.authority,
            treasury_fee_bps: TREASURY_FEE_BPS,
            draw_count: 0,
            last_number: 0,
            drawn_numbers: vector[],
            bankrupt_count: 0,
        };

        let session_id = object::id(&session);
        transfer::share_object(session);
        registry.current_session_id = session_id;

        event::emit(SessionCreated {
            session_id,
            authority: registry.authority,
            treasury: registry.treasury,
            treasury_fee_bps: TREASURY_FEE_BPS,
        });
    }

    /// Pause the game. Authority-only.
    /// Sets paused=true and pause_end_ms = now + duration_ms.
    /// Frontend reads this to show 'Under Construction' overlay.
    /// Draw cron skips drawing while paused.
    /// duration_ms = 0 means indefinite pause (resume manually).
    public fun pause_game(
        registry: &mut SessionRegistry,
        duration_ms: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == registry.authority, ENotAuthorized);
        registry.paused = true;
        if (duration_ms > 0) {
            registry.pause_end_ms = tx_context::epoch_timestamp_ms(ctx) + duration_ms;
        } else {
            registry.pause_end_ms = 0; // indefinite
        };
    }

    /// Resume the game. Authority-only.
    /// Sets paused=false and pause_end_ms=0.
    public fun resume_game(
        registry: &mut SessionRegistry,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == registry.authority, ENotAuthorized);
        registry.paused = false;
        registry.pause_end_ms = 0;
    }

    /// Sweep remaining vault balance to treasury. Authority-only.
    /// Called AFTER all 7 win types have been settled (claim_win_split)
    /// to move any leftover HEIST (the 1% not allocated to win positions,
    /// plus rounding dust) to the treasury wallet.
    public fun sweep_remaining(
        session: &mut Session,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == session.authority, ENotAuthorized);
        let remaining = balance::value(&session.vault);
        if (remaining > 0) {
            let coin = coin::take(&mut session.vault, remaining, ctx);
            transfer::public_transfer(coin, session.treasury);
        };
    }
}
