// ═══════════════════════════════════════════════════════════════════════════
// Server-side claim ledger — NO contract change (server is the authority)
// ───────────────────────────────────────────────────────────────────────────
// Anti-cheat design ("make sure the ransome is hit"):
//   1. Device grids are registered server-side at mint time (tied to the
//      on-chain mint digest, so you cannot register free fake tickets).
//   2. A claim is only recorded if the wallet's REGISTERED grid genuinely
//      satisfies the win pattern against the on-chain drawn numbers.
//   3. One claim per wallet per win type (dedupe + rate limit).
//   4. Payouts are batched and executed by the authority at round end via
//      /api/settle-claims (existing claim_win_split on-chain function).
//
// ⚠️ In-memory only — resets on Vercel cold starts / new instances.
//    For durable storage, swap the Maps for a DB (Vercel KV / Postgres) later.
// ═══════════════════════════════════════════════════════════════════════════

export type CellNum = number | null

// wallet → registered devices
const deviceRegistry = new Map<string, { nftId: string; grid: CellNum[][]; ts: number }[]>()

// winType (0-6) → set of wallets with a pending (unsettled) claim
const pendingClaims = new Map<number, Set<string>>()

// wallet → winTypes already claimed (dedupe per round)
const walletClaimed = new Map<string, Set<number>>()

// rate limiter: `${wallet}:${winType}` → timestamp
const rateMap = new Map<string, number>()
const RATE_WINDOW_MS = 60_000
const MAX_DEVICES_PER_WALLET = 20

// ─── Device registration (called by /api/mint-nft) ─────────────────────────
// NOTE: all ledger keys are normalized to lowercase — SUI addresses are
// lowercase hex, but clients may send mixed case. Normalizing once here (and
// in every lookup) prevents "No device registered" false negatives.
function normWallet(w: string) { return w.toLowerCase() }

export function registerDevices(wallet: string, devices: { nftId: string; grid: CellNum[][] }[]) {
  wallet = normWallet(wallet)
  const existing = deviceRegistry.get(wallet) || []
  const seen = new Set(existing.map((d) => d.nftId))
  for (const d of devices) {
    if (!seen.has(d.nftId)) {
      existing.push({ nftId: d.nftId, grid: d.grid, ts: Date.now() })
      seen.add(d.nftId)
    }
  }
  // Cap at the same limit the contract enforces per wallet
  deviceRegistry.set(wallet, existing.slice(-MAX_DEVICES_PER_WALLET))
}

export function getRegisteredDevices(wallet: string) {
  return deviceRegistry.get(normWallet(wallet)) || []
}

// ─── Win pattern verification (server-side truth) ──────────────────────────
// grid: 3 rows × 9 cols, 15 numbers (null = empty cell)
// drawn: on-chain drawn numbers (1-90)
// Pure pattern check — FH tier ORDER is enforced separately by
// canClaimFullHouse (the contract's bankrupt_count field is never advanced,
// so the frontend's per-wallet bankruptCount model is mirrored server-side).
export function verifyWin(grid: CellNum[][], drawn: number[], winType: number): boolean {
  const drawnSet = new Set(drawn)
  const nums = grid.flat().filter((n): n is number => n !== null)
  if (nums.length < 15) return false
  const rowOk = (r: number) => grid[r].filter((n): n is number => n !== null).every((n) => drawnSet.has(n))
  switch (winType) {
    case 0: return nums.filter((n) => drawnSet.has(n)).length >= 5          // EARLY_FIVE
    case 1: return rowOk(0)                                                  // TOP_LINE
    case 2: return rowOk(1)                                                  // MIDDLE_LINE
    case 3: return rowOk(2)                                                  // BOTTOM_LINE
    case 4: case 5: case 6: return nums.every((n) => drawnSet.has(n))        // FULL_HOUSE_1/2/3
    default: return false
  }
}

// ─── FULL HOUSE progression helpers ─────────────────────────────────────────
// The contract initializes bankrupt_count to 0 and NEVER increments it, so FH
// tiers must be gated server-side. Two complementary rules:
//
//   1. canClaimFullHouse — per-wallet: a wallet can only claim FH tiers IN
//      ORDER (FH1 → FH2 → FH3), mirroring the frontend's local bankruptCount
//      model. This stops a bot from skipping straight to FH3 (the 40%
//      jackpot) without earning the earlier tiers.
//
//   2. getFirstUnclaimedFh — settlement: only the FIRST unclaimed on-chain FH
//      tier may settle/sweep this round. Future tiers stay in the vault so
//      FH1 → FH2 → FH3 progress across rounds instead of all three being
//      swept to the treasury in round 1 (which would kill the jackpots).

export function getFirstUnclaimedFh(winsClaimed: boolean[]): number | null {
  for (let wt = 4; wt <= 6; wt++) if (winsClaimed[wt] !== true) return wt
  return null
}

// A wallet may claim FH tier `winType` (4-6) only if every earlier FH tier is
// either settled on-chain or already claimed (pending) by this wallet.
export function canClaimFullHouse(
  wallet: string,
  winType: number,
  winsClaimedOnChain: boolean[],
): { ok: boolean; error?: string } {
  wallet = normWallet(wallet)
  if (winType < 4 || winType > 6) return { ok: true }
  for (let t = 4; t < winType; t++) {
    const walletHas = (walletClaimed.get(wallet)?.has(t) ?? false) || (pendingClaims.get(t)?.has(wallet) ?? false)
    if (!walletHas && winsClaimedOnChain[t] !== true) {
      return {
        ok: false,
        error: `FULL_HOUSE ${winType - 3} locked — claim FULL_HOUSE ${t - 3} first`,
      }
    }
  }
  return { ok: true }
}

// ─── Claims ────────────────────────────────────────────────────────────────
export function isClaimed(wallet: string, winType: number): boolean {
  return walletClaimed.get(normWallet(wallet))?.has(winType) ?? false
}

export function recordClaim(wallet: string, winType: number): { ok: boolean; error?: string } {
  wallet = normWallet(wallet)
  if (isClaimed(wallet, winType)) return { ok: false, error: 'Already claimed this round' }
  const key = `${wallet}:${winType}`
  const last = rateMap.get(key)
  if (last && Date.now() - last < RATE_WINDOW_MS) return { ok: false, error: 'Rate limited — wait a moment' }
  rateMap.set(key, Date.now())
  if (!pendingClaims.has(winType)) pendingClaims.set(winType, new Set())
  pendingClaims.get(winType)!.add(wallet)
  if (!walletClaimed.has(wallet)) walletClaimed.set(wallet, new Set())
  walletClaimed.get(wallet)!.add(winType)
  return { ok: true }
}

export function getClaimers(winType: number): string[] {
  return [...(pendingClaims.get(winType) || [])]
}

export function getWalletStatus(wallet: string): { claimed: number[]; pending: number[] } {
  wallet = normWallet(wallet)
  const claimed = [...(walletClaimed.get(wallet) || [])]
  const pending: number[] = []
  for (const [wt, wallets] of pendingClaims) if (wallets.has(wallet)) pending.push(wt)
  return { claimed, pending }
}

// Read all pending claims WITHOUT clearing (so a failed settlement tx doesn't
// lose them). The settlement route clears each win type only after its
// on-chain claim_win_split succeeds.
export function getAllPendingClaims(): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const [wt, set] of pendingClaims) out.set(wt, [...set])
  return out
}

export function clearPending(winType: number) {
  pendingClaims.delete(winType)
}

// ─── Round reset (called at the 59-min round boundary by settlement) ────────
// One claim per wallet per win type PER ROUND. On-chain wins_claimed is the
// real exhaustion authority, so clearing the per-round dedupe + rate map here
// is safe and lets wallets claim the same win type again next round.
export function resetRound() {
  walletClaimed.clear()
  rateMap.clear()
}

// ─── Cleanup (evict stale rate-limit entries) ──────────────────────────────
setInterval(() => {
  const now = Date.now()
  for (const [k, ts] of rateMap) if (now - ts > RATE_WINDOW_MS * 2) rateMap.delete(k)
  if (deviceRegistry.size > 5000) {
    // drop oldest entries (rough eviction by first insertion order)
    let drop = deviceRegistry.size - 4000
    for (const key of deviceRegistry.keys()) {
      if (drop <= 0) break
      deviceRegistry.delete(key)
      drop--
    }
  }
}, 120_000)
