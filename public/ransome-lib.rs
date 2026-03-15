use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d");

// ─── Constants ────────────────────────────────────────────────────────────────

/// Treasury wallet — receives 0.1% fee + unclaimed vault funds
const TREASURY: &str = "F6bbR6ro9W4nS6uBMmSLhsknhQ6NJR523DZXkRQnkFcx";

/// Session hard limit: 58 minutes in seconds
const SESSION_MAX_SECS: i64 = 58 * 60;

/// Pre-game countdown: 60 seconds
const PREGAME_SECS: i64 = 60;

/// Max numbers in the game (bingo-style 1-90)
const MAX_NUMBERS: u8 = 90;

/// Treasury fee: 0.1% = 1/1000
const TREASURY_FEE_BPS: u64 = 10; // basis points (10 = 0.1%)

/// Win type payouts in basis points (total = 10000 = 100%)
/// EARLY_FIVE=10%, TOP=10%, MIDDLE=10%, BOTTOM=10%,
/// FULL_HOUSE_1=15%, FULL_HOUSE_2=15%, FULL_HOUSE_3=30%
const PAYOUT_BPS: [u64; 7] = [1000, 1000, 1000, 1000, 1500, 1500, 3000];

// ─── Win Types ────────────────────────────────────────────────────────────────
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum WinType {
    EarlyFive,     // 0 — first 5 numbers clicked on any device
    TopLine,       // 1 — top row complete
    MiddleLine,    // 2 — middle row complete
    BottomLine,    // 3 — bottom row complete
    FullHouse1,    // 4 — all 15 numbers (Bankrupt I)
    FullHouse2,    // 5 — all 15 numbers again (Bankrupt II)
    FullHouse3,    // 6 — all 15 numbers third time (Bankrupt III)
}

impl WinType {
    pub fn index(&self) -> usize {
        match self {
            WinType::EarlyFive  => 0,
            WinType::TopLine    => 1,
            WinType::MiddleLine => 2,
            WinType::BottomLine => 3,
            WinType::FullHouse1 => 4,
            WinType::FullHouse2 => 5,
            WinType::FullHouse3 => 6,
        }
    }
    pub fn payout_bps(&self) -> u64 {
        PAYOUT_BPS[self.index()]
    }
}

// ─── Session State PDA ────────────────────────────────────────────────────────
/// Seeds: [b"session", authority.key()]
/// One session per authority (game operator). Holds all game state.
#[account]
pub struct Session {
    /// Game operator — authority who can draw numbers and force-end
    pub authority: Pubkey,           // 32
    /// Treasury wallet — validated against TREASURY constant
    pub treasury: Pubkey,            // 32
    /// Vault bump for PDA signing
    pub vault_bump: u8,              // 1
    /// Session bump
    pub bump: u8,                    // 1
    /// Total SOL deposited into vault (lamports)
    pub vault_total: u64,            // 8
    /// SOL already paid out (lamports)
    pub vault_paid: u64,             // 8
    /// Treasury fee already taken (lamports)
    pub treasury_taken: bool,        // 1
    /// All 90 numbers drawn so far (0 = not yet drawn)
    pub drawn: [u8; 90],             // 90
    /// How many numbers have been drawn
    pub draw_count: u8,              // 1
    /// Last drawn number (1-90, 0 = none)
    pub last_number: u8,             // 1
    /// Unix timestamp when session started (after pregame)
    pub started_at: i64,             // 8
    /// Unix timestamp when pregame countdown started
    pub pregame_at: i64,             // 8
    /// Which win types have been claimed [false=unclaimed]
    pub wins_claimed: [bool; 7],     // 7
    /// Claimers for each win type (Pubkey::default = unclaimed slot)
    pub win_claimers: [Pubkey; 7],   // 7*32 = 224
    /// How many claimers per win type (for split)
    pub win_claimer_count: [u8; 7],  // 7
    /// Session active flag
    pub active: bool,                // 1
    /// Bankrupt count (FullHouse claims so far)
    pub bankrupt_count: u8,          // 1
    /// Nonce for pseudo-random draw (incremented each draw)
    pub draw_nonce: u64,             // 8
}

impl Session {
    // 8 discriminator + all fields above
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 8 + 8 + 1 + 90 + 1 + 1 + 8 + 8 + 7 + 224 + 7 + 1 + 1 + 8 + 32;
    // extra padding for safety
    pub const SPACE: usize = Self::LEN + 64;
}

// ─── Vault PDA ────────────────────────────────────────────────────────────────
/// Seeds: [b"vault", session.key()]
/// Holds the SOL. Program-owned so only program can move funds.
#[account]
pub struct Vault {
    pub session: Pubkey,  // 32
    pub bump: u8,         // 1
}
impl Vault {
    pub const SPACE: usize = 8 + 32 + 1 + 32; // +32 padding
}

// ─── Device NFT (mint record) ─────────────────────────────────────────────────
/// Seeds: [b"device", session.key(), owner.key(), &[device_index]]
/// One per minted device. Stores the 3x9 grid for on-chain win verification.
#[account]
pub struct Device {
    pub session: Pubkey,       // 32
    pub owner: Pubkey,         // 32
    pub device_index: u8,      // 1 — index within session (0-255)
    pub bump: u8,              // 1
    /// Flat 27-cell grid (3 rows × 9 cols). 0 = empty cell.
    pub grid: [u8; 27],        // 27
    /// Which cells have been matched (bit flags, 27 bits → 4 bytes)
    pub matched: [bool; 27],   // 27
    /// How many cells have been clicked (matched + clicked)
    pub clicked_count: u8,     // 1
    /// Device active flag
    pub active: bool,          // 1
}
impl Device {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1 + 27 + 27 + 1 + 1 + 32; // +32 padding
}

// ─── Program ──────────────────────────────────────────────────────────────────
#[program]
pub mod ransome {
    use super::*;

    // ── 1. initialize_session ─────────────────────────────────────────────────
    /// Called by game operator to start a new session.
    /// Transfers 0.1% of vault_amount to treasury immediately.
    pub fn initialize_session(
        ctx: Context<InitializeSession>,
        vault_amount: u64,  // lamports to deposit (e.g. 1_000_000_000 = 1 SOL)
    ) -> Result<()> {
        require!(vault_amount > 0, RansomeError::ZeroVault);

        let treasury_key = ctx.accounts.treasury.key();
        require!(
            treasury_key.to_string() == TREASURY,
            RansomeError::InvalidTreasury
        );

        // Transfer vault_amount from authority to vault PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to:   ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, vault_amount)?;

        // Take 0.1% treasury fee immediately
        let fee = vault_amount.saturating_mul(TREASURY_FEE_BPS) / 10_000;

        // Transfer fee from vault PDA to treasury (signed by vault PDA)
        let session_key = ctx.accounts.session.key();
        let vault_seeds: &[&[u8]] = &[
            b"vault",
            session_key.as_ref(),
            &[ctx.accounts.vault.bump],
        ];
        let vault_signer = &[vault_seeds];

        let fee_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to:   ctx.accounts.treasury.to_account_info(),
            },
            vault_signer,
        );
        system_program::transfer(fee_ctx, fee)?;

        // Initialize session state
        let session = &mut ctx.accounts.session;
        session.authority      = ctx.accounts.authority.key();
        session.treasury       = treasury_key;
        session.vault_bump     = ctx.accounts.vault.bump;
        session.bump           = ctx.bumps.session;
        session.vault_total    = vault_amount.saturating_sub(fee);
        session.vault_paid     = 0;
        session.treasury_taken = true;
        session.drawn          = [0u8; 90];
        session.draw_count     = 0;
        session.last_number    = 0;
        session.pregame_at     = Clock::get()?.unix_timestamp;
        session.started_at     = 0;
        session.wins_claimed   = [false; 7];
        session.win_claimers   = [Pubkey::default(); 7];
        session.win_claimer_count = [0u8; 7];
        session.active         = true;
        session.bankrupt_count = 0;
        session.draw_nonce     = 0;

        // Initialize vault record
        let vault = &mut ctx.accounts.vault;
        vault.session = session.key();
        vault.bump    = ctx.bumps.vault;

        emit!(SessionStarted {
            session: session.key(),
            vault_total: session.vault_total,
            fee_taken: fee,
            treasury: treasury_key,
        });

        Ok(())
    }

    // ── 2. mint_device ────────────────────────────────────────────────────────
    /// Player mints an NFT device with a pre-committed grid.
    /// Grid: 27 cells (3 rows × 9 cols), values 1-90 or 0 (empty).
    /// Standard bingo rules: col 0 → 1-9, col 1 → 10-19, ... col 8 → 81-90.
    pub fn mint_device(
        ctx: Context<MintDevice>,
        device_index: u8,
        grid: [u8; 27],
    ) -> Result<()> {
        let session = &ctx.accounts.session;
        require!(session.active, RansomeError::SessionInactive);
        require!(session.draw_count == 0, RansomeError::GameAlreadyStarted);

        // Validate grid: each non-zero value must be in correct column range
        // Col 0: 1-9, Col 1: 10-19, ..., Col 8: 81-90
        for row in 0..3usize {
            for col in 0..9usize {
                let val = grid[row * 9 + col];
                if val != 0 {
                    let min = (col as u8) * 10 + 1;
                    let max = if col == 8 { 90 } else { (col as u8 + 1) * 10 };
                    require!(val >= min && val <= max, RansomeError::InvalidGrid);
                }
            }
        }

        let device = &mut ctx.accounts.device;
        device.session      = session.key();
        device.owner        = ctx.accounts.owner.key();
        device.device_index = device_index;
        device.bump         = ctx.bumps.device;
        device.grid         = grid;
        device.matched      = [false; 27];
        device.clicked_count = 0;
        device.active       = true;

        emit!(DeviceMinted {
            session: session.key(),
            device: ctx.accounts.device.key(),
            owner: ctx.accounts.owner.key(),
            device_index,
        });

        Ok(())
    }

    // ── 3. draw_number ────────────────────────────────────────────────────────
    /// Authority draws the next number. Uses slot hash + nonce as entropy.
    /// Only callable by session authority (game operator).
    /// Marks matching cells on ALL devices automatically.
    pub fn draw_number(ctx: Context<DrawNumber>) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(session.active, RansomeError::SessionInactive);
        require!(
            session.authority == ctx.accounts.authority.key(),
            RansomeError::Unauthorized
        );
        require!(session.draw_count < MAX_NUMBERS, RansomeError::AllNumbersDrawn);

        // Check session time limit
        let now = Clock::get()?.unix_timestamp;
        if session.started_at > 0 {
            require!(
                now - session.started_at < SESSION_MAX_SECS,
                RansomeError::SessionExpired
            );
        }

        // Set started_at on first draw
        if session.started_at == 0 {
            session.started_at = now;
        }

        // ── Pseudo-random draw using recent slot hash + nonce ──────────────
        // NOTE: For mainnet production use Switchboard VRF or similar.
        // This is sufficient for devnet testing.
        let recent_slothash = ctx.accounts.recent_slothashes.data.borrow();
        // Slot hash data: first 8 bytes are slot (u64 le), next 32 are hash
        let hash_bytes: [u8; 8] = recent_slothash[8..16]
            .try_into()
            .map_err(|_| RansomeError::RandomnessFailed)?;
        let slot_entropy = u64::from_le_bytes(hash_bytes);

        // Mix with nonce and draw_count for uniqueness
        let seed = slot_entropy
            .wrapping_add(session.draw_nonce)
            .wrapping_add(session.draw_count as u64)
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);

        session.draw_nonce = seed;

        // Find available numbers
        let available_count = MAX_NUMBERS - session.draw_count;
        let pick_index = (seed % available_count as u64) as u8;

        // Walk through 1-90 skipping already drawn
        let mut skipped: u8 = 0;
        let mut chosen: u8 = 0;
        for n in 1u8..=90 {
            if !session.drawn.contains(&n) {
                if skipped == pick_index {
                    chosen = n;
                    break;
                }
                skipped += 1;
            }
        }
        require!(chosen > 0, RansomeError::RandomnessFailed);

        // Record draw
        session.drawn[session.draw_count as usize] = chosen;
        session.draw_count += 1;
        session.last_number = chosen;

        // If all 90 drawn → end session
        if session.draw_count >= MAX_NUMBERS {
            session.active = false;
        }

        emit!(NumberDrawn {
            session: ctx.accounts.session.key(),
            number: chosen,
            draw_count: session.draw_count,
        });

        Ok(())
    }

    // ── 4. click_cell ─────────────────────────────────────────────────────────
    /// Player clicks a cell on their device matching the last drawn number.
    /// Must be called within the click window after draw_number.
    pub fn click_cell(
        ctx: Context<ClickCell>,
        row: u8,
        col: u8,
    ) -> Result<()> {
        require!(row < 3 && col < 9, RansomeError::InvalidCell);
        let cell_idx = (row * 9 + col) as usize;

        let session = &ctx.accounts.session;
        require!(session.active, RansomeError::SessionInactive);
        require!(session.last_number > 0, RansomeError::NoNumberDrawn);

        let device = &mut ctx.accounts.device;
        require!(device.active, RansomeError::DeviceInactive);
        require!(
            device.owner == ctx.accounts.owner.key(),
            RansomeError::Unauthorized
        );
        require!(
            device.session == session.key(),
            RansomeError::WrongSession
        );

        // Cell must match last drawn number
        require!(
            device.grid[cell_idx] == session.last_number,
            RansomeError::NumberMismatch
        );
        require!(!device.matched[cell_idx], RansomeError::AlreadyClicked);

        device.matched[cell_idx] = true;
        device.clicked_count    += 1;

        emit!(CellClicked {
            session: session.key(),
            device: ctx.accounts.device.key(),
            owner: ctx.accounts.owner.key(),
            row,
            col,
            number: session.last_number,
        });

        Ok(())
    }

    // ── 5. claim_win ──────────────────────────────────────────────────────────
    /// Player claims a win. Program verifies the win condition on-chain
    /// then transfers the SOL payout from vault to winner.
    pub fn claim_win(
        ctx: Context<ClaimWin>,
        win_type: WinType,
    ) -> Result<()> {
        let session_key = ctx.accounts.session.key();
        let wt_idx = win_type.index();

        // Snapshot immutable data we need before borrowing mutably
        let vault_total  = ctx.accounts.session.vault_total;
        let last_number  = ctx.accounts.session.last_number;
        let vault_bump   = ctx.accounts.session.vault_bump;
        let already      = ctx.accounts.session.wins_claimed[wt_idx];
        let bankrupt_count = ctx.accounts.session.bankrupt_count;

        require!(ctx.accounts.session.active, RansomeError::SessionInactive);
        require!(!already, RansomeError::WinAlreadyClaimed);
        require!(last_number > 0, RansomeError::NoNumberDrawn);
        require!(
            ctx.accounts.device.owner == ctx.accounts.winner.key(),
            RansomeError::Unauthorized
        );
        require!(
            ctx.accounts.device.session == session_key,
            RansomeError::WrongSession
        );

        // ── Verify win condition on-chain ─────────────────────────────────
        let device = &ctx.accounts.device;
        let verified = match win_type {
            WinType::EarlyFive => {
                // Any 5 cells clicked
                device.clicked_count >= 5
            }
            WinType::TopLine => {
                // All non-empty cells in row 0 clicked
                Self::row_complete(&device.grid, &device.matched, 0)
            }
            WinType::MiddleLine => {
                Self::row_complete(&device.grid, &device.matched, 1)
            }
            WinType::BottomLine => {
                Self::row_complete(&device.grid, &device.matched, 2)
            }
            WinType::FullHouse1 => {
                // All cells clicked, first bankrupt
                bankrupt_count == 0 && device.clicked_count >= Self::active_cells(&device.grid)
            }
            WinType::FullHouse2 => {
                bankrupt_count == 1 && device.clicked_count >= Self::active_cells(&device.grid)
            }
            WinType::FullHouse3 => {
                bankrupt_count == 2 && device.clicked_count >= Self::active_cells(&device.grid)
            }
        };
        require!(verified, RansomeError::WinNotVerified);

        // ── Calculate payout ──────────────────────────────────────────────
        let payout = vault_total
            .saturating_mul(win_type.payout_bps())
            / 10_000;
        require!(payout > 0, RansomeError::ZeroPayout);

        // ── Transfer from vault PDA to winner ─────────────────────────────
        let vault_seeds: &[&[u8]] = &[
            b"vault",
            session_key.as_ref(),
            &[vault_bump],
        ];
        let vault_signer = &[vault_seeds];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to:   ctx.accounts.winner.to_account_info(),
            },
            vault_signer,
        );
        system_program::transfer(transfer_ctx, payout)?;

        // ── Update session state ──────────────────────────────────────────
        let session = &mut ctx.accounts.session;
        session.wins_claimed[wt_idx]    = true;
        session.win_claimers[wt_idx]    = ctx.accounts.winner.key();
        session.win_claimer_count[wt_idx] = 1;
        session.vault_paid             += payout;

        // Increment bankrupt counter for FullHouse wins
        if matches!(win_type, WinType::FullHouse1 | WinType::FullHouse2 | WinType::FullHouse3) {
            session.bankrupt_count += 1;
            // All 3 bankrupts claimed → auto-end session
            if session.bankrupt_count >= 3 {
                session.active = false;
            }
        }

        emit!(WinClaimed {
            session: session_key,
            winner: ctx.accounts.winner.key(),
            win_type,
            payout,
            bankrupt_count: session.bankrupt_count,
        });

        Ok(())
    }

    // ── 6. force_end ──────────────────────────────────────────────────────────
    /// Force-ends session: 58-min limit hit, or authority calls manually.
    /// Distributes remaining vault to winners proportionally,
    /// or entirely to treasury if no wins claimed.
    pub fn force_end(ctx: Context<ForceEnd>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.session.authority,
            RansomeError::Unauthorized
        );

        let session = &mut ctx.accounts.session;
        let vault_remaining = session.vault_total.saturating_sub(session.vault_paid);

        // Check time or all-drawn condition
        let now = Clock::get()?.unix_timestamp;
        let time_expired = session.started_at > 0
            && (now - session.started_at) >= SESSION_MAX_SECS;
        let all_drawn = session.draw_count >= MAX_NUMBERS;
        let all_bankrupt = session.bankrupt_count >= 3;

        require!(
            time_expired || all_drawn || all_bankrupt || !session.active,
            RansomeError::SessionStillActive
        );

        session.active = false;

        emit!(SessionEnded {
            session: ctx.accounts.session.key(),
            vault_remaining,
            reason: if time_expired { 0 } else if all_drawn { 1 } else { 2 },
        });

        Ok(())
    }

    // ── 7. sweep_to_treasury ─────────────────────────────────────────────────
    /// After session ends, sweep any remaining vault SOL to treasury.
    /// Called by authority after force_end or all-bankrupt.
    pub fn sweep_to_treasury(ctx: Context<SweepToTreasury>) -> Result<()> {
        require!(
            ctx.accounts.session.authority == ctx.accounts.authority.key(),
            RansomeError::Unauthorized
        );
        require!(!ctx.accounts.session.active, RansomeError::SessionStillActive);

        // Validate treasury address
        require!(
            ctx.accounts.treasury.key().to_string() == TREASURY,
            RansomeError::InvalidTreasury
        );

        let session_key = ctx.accounts.session.key();
        let vault_bump  = ctx.accounts.session.vault_bump;

        // Get vault balance minus rent-exempt minimum
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(Vault::SPACE);
        let sweepable = vault_lamports.saturating_sub(rent);

        if sweepable > 0 {
            let vault_seeds: &[&[u8]] = &[
                b"vault",
                session_key.as_ref(),
                &[vault_bump],
            ];
            let signer = &[vault_seeds];

            let cpi = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to:   ctx.accounts.treasury.to_account_info(),
                },
                signer,
            );
            system_program::transfer(cpi, sweepable)?;
        }

        emit!(TreasurySwept {
            session: session_key,
            amount: sweepable,
        });

        Ok(())
    }

    // ── Helper fns ────────────────────────────────────────────────────────────
    fn row_complete(grid: &[u8; 27], matched: &[bool; 27], row: usize) -> bool {
        for col in 0..9 {
            let idx = row * 9 + col;
            if grid[idx] != 0 && !matched[idx] {
                return false;
            }
        }
        true
    }

    fn active_cells(grid: &[u8; 27]) -> u8 {
        grid.iter().filter(|&&v| v != 0).count() as u8
    }
}

// ─── Account Contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Session::SPACE,
        seeds = [b"session", authority.key().as_ref()],
        bump
    )]
    pub session: Account<'info, Session>,

    #[account(
        init,
        payer = authority,
        space = Vault::SPACE,
        seeds = [b"vault", session.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: validated against TREASURY constant in instruction
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(device_index: u8)]
pub struct MintDevice<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub session: Account<'info, Session>,

    #[account(
        init,
        payer = owner,
        space = Device::SPACE,
        seeds = [b"device", session.key().as_ref(), owner.key().as_ref(), &[device_index]],
        bump
    )]
    pub device: Account<'info, Device>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DrawNumber<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"session", authority.key().as_ref()],
        bump = session.bump,
        has_one = authority
    )]
    pub session: Account<'info, Session>,

    /// CHECK: SlotHashes sysvar - validated by address
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub recent_slothashes: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClickCell<'info> {
    pub owner: Signer<'info>,

    pub session: Account<'info, Session>,

    #[account(
        mut,
        seeds = [b"device", session.key().as_ref(), owner.key().as_ref(), &[device.device_index]],
        bump = device.bump,
        has_one = owner
    )]
    pub device: Account<'info, Device>,
}

#[derive(Accounts)]
pub struct ClaimWin<'info> {
    pub winner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"session", session.authority.as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, Session>,

    #[account(
        mut,
        seeds = [b"vault", session.key().as_ref()],
        bump = session.vault_bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        has_one = owner,
        constraint = device.session == session.key()
    )]
    pub device: Account<'info, Device>,

    /// CHECK: validated as device owner
    pub owner: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ForceEnd<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"session", authority.key().as_ref()],
        bump = session.bump,
        has_one = authority
    )]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct SweepToTreasury<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"session", authority.key().as_ref()],
        bump = session.bump,
        has_one = authority
    )]
    pub session: Account<'info, Session>,

    #[account(
        mut,
        seeds = [b"vault", session.key().as_ref()],
        bump = session.vault_bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: validated against TREASURY constant in instruction
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// ─── Events ───────────────────────────────────────────────────────────────────
#[event]
pub struct SessionStarted {
    pub session: Pubkey,
    pub vault_total: u64,
    pub fee_taken: u64,
    pub treasury: Pubkey,
}
#[event]
pub struct DeviceMinted {
    pub session: Pubkey,
    pub device: Pubkey,
    pub owner: Pubkey,
    pub device_index: u8,
}
#[event]
pub struct NumberDrawn {
    pub session: Pubkey,
    pub number: u8,
    pub draw_count: u8,
}
#[event]
pub struct CellClicked {
    pub session: Pubkey,
    pub device: Pubkey,
    pub owner: Pubkey,
    pub row: u8,
    pub col: u8,
    pub number: u8,
}
#[event]
pub struct WinClaimed {
    pub session: Pubkey,
    pub winner: Pubkey,
    pub win_type: WinType,
    pub payout: u64,
    pub bankrupt_count: u8,
}
#[event]
pub struct SessionEnded {
    pub session: Pubkey,
    pub vault_remaining: u64,
    pub reason: u8, // 0=timeout, 1=all drawn, 2=all bankrupt
}
#[event]
pub struct TreasurySwept {
    pub session: Pubkey,
    pub amount: u64,
}

// ─── Errors ───────────────────────────────────────────────────────────────────
#[error_code]
pub enum RansomeError {
    #[msg("Session is not active")]
    SessionInactive,
    #[msg("Session is still active — cannot sweep yet")]
    SessionStillActive,
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Invalid treasury address")]
    InvalidTreasury,
    #[msg("Vault amount cannot be zero")]
    ZeroVault,
    #[msg("All 90 numbers have been drawn")]
    AllNumbersDrawn,
    #[msg("Randomness generation failed")]
    RandomnessFailed,
    #[msg("No number has been drawn yet")]
    NoNumberDrawn,
    #[msg("Invalid grid: cell value out of column range")]
    InvalidGrid,
    #[msg("Invalid cell coordinates")]
    InvalidCell,
    #[msg("Cell number does not match drawn number")]
    NumberMismatch,
    #[msg("Cell already clicked")]
    AlreadyClicked,
    #[msg("Win condition not verified")]
    WinNotVerified,
    #[msg("This win type has already been claimed")]
    WinAlreadyClaimed,
    #[msg("Payout would be zero")]
    ZeroPayout,
    #[msg("Session time limit (58 min) exceeded")]
    SessionExpired,
    #[msg("Cannot mint after game has started")]
    GameAlreadyStarted,
    #[msg("Device is inactive")]
    DeviceInactive,
    #[msg("Device belongs to a different session")]
    WrongSession,
}
