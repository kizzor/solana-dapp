// ═══════════════════════════════════════════════════════════════════════════
// heist-prices.ts — v5 any-coin mint pricing (server-side authority)
// ───────────────────────────────────────────────────────────────────────────
// The console mint costs $0.50 USD (or $0.25 for MTRX-delegated wallets) and
// can be paid in ANY registered coin (SUI / USDC / USDT / HEIST). The exact
// raw units required per coin:
//   SUI  → $0.50 worth of SUI in MIST  (live price from CoinGecko, cached)
//   USDC → $0.50 = 500_000 raw (6 decimals, fixed $1)
//   USDT → $0.50 = 500_000 raw (6 decimals, fixed $1)  [env USDT_COIN_TYPE]
//   HEIST→ $0.50 worth of HEIST at the OPERATOR-SET price (RULES below)
// The on-chain contract holds the authoritative price table (HeistAdmin) and
// the draw cron keeps the SUI entry fresh from the same live feed.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ HEIST PRICING RULES                                                       ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ 1. PRICE RESOLUTION ORDER (lowest → highest priority):                    ║
// ║      a) Placeholder $0.0001 — the default until a real market exists      ║
// ║      b) HEIST_PRICE_USD env — operator override (must be > 0, ≤ $1)        ║
// ║      c) Live feed — HEIST_COINGECKO_ID (CoinGecko) or HEIST_PRICE_API_URL  ║
// ║         (any JSON endpoint returning { price: <usd> }); fetched fresh by   ║
// ║         the draw cron + session-state, so once HEIST is listed somewhere   ║
// ║         the game picks up the REAL price automatically.                    ║
// ║ 2. The mint cost in HEIST = $0.50 / price (e.g. 250 HEIST at $0.002,       ║
// ║    or 5,000 HEIST at the $0.0001 placeholder).                             ║
// ║ 3. The on-chain price table (HeistAdmin) is seeded by setup-heist.mjs and  ║
// ║    kept fresh by the draw cron via set_price — the same resolution order.  ║
// ║ 4. The contract still fails any mint with a missing/zero HEIST table entry ║
// ║    (EPriceNotSet) — defense in depth.                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// ═══════════════════════════════════════════════════════════════════════════

export const HEIST_DECIMALS = 9
export const STABLE_DECIMALS = 6
export const FULL_PRICE_USD = 0.5

// Placeholder HEIST price until a real market exists. The user chose this
// value so HEIST mints work out-of-the-box; it is overridden by the env var
// and superseded by the live feed once configured.
const HEIST_PRICE_USD_PLACEHOLDER = 0.0001

// ─── Sanity bands (M3: configurable via env) ────────────────────────────────
// A price outside its band is treated as invalid (fall back to env/placeholder
// or skip the sync) — a garbage/out-of-range feed value must never collapse or
// explode the $0.50 mint amount. Defaults: HEIST ≤ $1, SUI ≤ $100. Override
// with HEIST_PRICE_MAX_USD / SUI_PRICE_MAX_USD if a real listing exceeds them.
function heistMaxUsd(): number {
  const m = Number(process.env.HEIST_PRICE_MAX_USD)
  return Number.isFinite(m) && m > 0 ? m : 1
}
function suiMaxUsd(): number {
  const m = Number(process.env.SUI_PRICE_MAX_USD)
  return Number.isFinite(m) && m > 0 ? m : 100
}

// Shared validators — used by the fetch helpers AND the draw cron / mint-nft
// so the on-chain sync and the server validation always agree on what is a
// sane price (single source of truth for the bands).
export function isValidHeistPriceUsd(p: number): boolean {
  return Number.isFinite(p) && p > 0 && p <= heistMaxUsd()
}
export function isValidSuiPriceUsd(p: number): boolean {
  return Number.isFinite(p) && p > 0 && p <= suiMaxUsd()
}

// Sync: env override or the $0.0001 placeholder. Never null — the placeholder
// guarantees every HEIST consumer has a price to work with.
export function fetchHeistPriceUsd(): number {
  const p = Number(process.env.HEIST_PRICE_USD)
  // Sanity band: HEIST is a sub-$1 token. A value outside (typo, e.g. 0.5
  // entered thinking it's the USDC price, or 100) is rejected → placeholder,
  // so the mint price can't silently collapse.
  if (isValidHeistPriceUsd(p)) return p
  return HEIST_PRICE_USD_PLACEHOLDER
}

// Live-feed hook (real market data): tries CoinGecko (by coin id) or a custom
// JSON price API. Returns null when no source is configured or the feed is
// down — callers then fall back to fetchHeistPriceUsd() (env/placeholder).
// Once HEIST is listed on an exchange, set HEIST_COINGECKO_ID or
// HEIST_PRICE_API_URL and the game starts using the real price automatically.
// 60s in-memory cache (like SUI) — session-state polls every ~2s, so the feed
// is fetched at most once per minute per cold instance, never per request.
let cachedHeistLive: number | null = null
let cachedHeistLiveAt = 0
export async function fetchHeistPriceUsdLive(): Promise<number | null> {
  const now = Date.now()
  if (cachedHeistLive !== null && now - cachedHeistLiveAt < 60_000) return cachedHeistLive
  const cgId = (process.env.HEIST_COINGECKO_ID || '').trim()
  const apiUrl = (process.env.HEIST_PRICE_API_URL || '').trim()
  if (!cgId && !apiUrl) return null
  try {
    let price = NaN
    if (apiUrl) {
      const r = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
      if (r.ok) {
        const j = await r.json()
        price = Number(j?.price ?? j?.usd ?? j?.data?.price ?? j?.priceUsd)
      }
    } else if (cgId) {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cgId)}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(8000) },
      )
      if (r.ok) {
        const j = (await r.json()) as Record<string, { usd?: number }>
        price = Number(j?.[cgId]?.usd)
      }
    }
    if (isValidHeistPriceUsd(price)) {
      cachedHeistLive = price
      cachedHeistLiveAt = now
      return price
    }
  } catch {
    /* feed down — fall back to env/placeholder */
  }
  return cachedHeistLive
}

// Accepted coins (verified on mainnet 2026-08-04 via getCoinMetadata):
export const SUI_COIN_TYPE = '0x2::sui::SUI'
export const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' // Circle native
// USDT is NOT defaulted — the address needs final confirmation at deploy.
// Set USDT_COIN_TYPE (server + NEXT_PUBLIC_USDT_COIN_TYPE) once confirmed;
// setup-heist.mjs validates every configured coin against real metadata.
export const USDT_COIN_TYPE = (process.env.USDT_COIN_TYPE || '').trim()

export function heistCoinTypeOf(pkg: string): string {
  return `${pkg}::heist::HEIST`
}

export type CoinKey = 'SUI' | 'USDC' | 'USDT' | 'HEIST'

// Map a full coin type string to its key (HEIST needs the package id).
export function coinKeyOf(type: string, suiProgramId?: string): CoinKey | null {
  if (!type) return null
  if (type === SUI_COIN_TYPE) return 'SUI'
  if (type === USDC_COIN_TYPE) return 'USDC'
  if (USDT_COIN_TYPE && type === USDT_COIN_TYPE) return 'USDT'
  if (suiProgramId && type === heistCoinTypeOf(suiProgramId)) return 'HEIST'
  return null
}

// ─── Live SUI price (CoinGecko, 60s cache; env SUI_PRICE_USD fallback) ─────
let cachedSuiUsd: number | null = null
let cachedAt = 0
export async function fetchSuiPriceUsd(): Promise<number> {
  const now = Date.now()
  if (cachedSuiUsd !== null && now - cachedAt < 60_000) return cachedSuiUsd
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd', {
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) {
      const j = (await r.json()) as { sui?: { usd?: number } }
      const p = Number(j?.sui?.usd)
      // Sanity band (0, max]: SUI is a ~$1-5 asset; a garbage feed value must
      // never collapse the $0.50 mint amount. Out-of-band → fall through.
      if (isValidSuiPriceUsd(p)) {
        cachedSuiUsd = p
        cachedAt = now
        return p
      }
    }
  } catch {
    /* fall through */
  }
  if (cachedSuiUsd !== null) return cachedSuiUsd
  const envP = Number(process.env.SUI_PRICE_USD)
  if (isValidSuiPriceUsd(envP)) return envP
  throw new Error('Could not fetch SUI price (CoinGecko) — set SUI_PRICE_USD env fallback')
}

// Exact raw units required for a FULL-price ($0.50) mint in a coin key.
// HEIST is floatable: 0.5 / HEIST price × 1e9 raw (e.g. 250 HEIST at $0.002).
export function fullRawForCoin(key: CoinKey, suiPriceUsd: number, heistPriceUsd: number): bigint {
  switch (key) {
    case 'SUI': {
      const mist = Math.floor((FULL_PRICE_USD / suiPriceUsd) * 1e9)
      return BigInt(mist)
    }
    case 'USDC':
    case 'USDT':
      return 500_000n
    case 'HEIST': {
      // Guard: a 0/invalid price would produce Infinity → obscure BigInt crash.
      if (!Number.isFinite(heistPriceUsd) || heistPriceUsd <= 0) {
        throw new Error('HEIST price is not set (HEIST_PRICE_USD) — cannot price a HEIST mint')
      }
      const raw = Math.floor((FULL_PRICE_USD / heistPriceUsd) * 1e9)
      return BigInt(raw)
    }
  }
}

// MTRX-discounted raw amount ($0.25) = exactly half.
export function mtrxRawForCoin(fullRaw: bigint): bigint {
  return fullRaw / 2n
}
