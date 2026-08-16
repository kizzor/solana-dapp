export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { createSuiClient } from '../../../lib/sui-client'
import {
  fetchSuiPriceUsd,
  fetchHeistPriceUsd,
  fetchHeistPriceUsdLive,
  fullRawForCoin,
  mtrxRawForCoin,
  USDT_COIN_TYPE,
} from '../../../lib/heist-prices'

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ AFTER PUBLISHING the new HEIST contract, set env vars in Vercel:
//   vercel env add SESSION_OBJECT_ID  ← Object ID from init_session output
// ═══════════════════════════════════════════════════════════════════════════
// ─── Constants ───────────────────────────────────────────────────────────────
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID || ''
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
// USDT defaults to the confirmed Wormhole mainnet type (see lib/heist-prices.ts);
// env override still wins. Kept as a guard so a future blank can hide the entry.
const USDT_COIN_TYPE_UNCONFIGURED = !USDT_COIN_TYPE
// ─── GET /api/session-state ──────────────────────────────────────────────────
// Reads the SUI on-chain session object and returns game state.
// Called by the frontend every ~2s during gameplay.
export async function GET() {
  // ── Guard: env vars must be set ──────────────────────────────────────────
  if (!SESSION_OBJECT_ID) {
    return NextResponse.json({ ok: false, error: 'SESSION_OBJECT_ID not set. Publish HEIST contract and init session first.' }, { status: 500 })
  }

  try {
    const sui = createSuiClient(SUI_NETWORK)

    // v2.22.x gRPC client: objectId + include.json, response is { object: { json } }
    const sessionObj = await sui.getObject({
      objectId: SESSION_OBJECT_ID,
      include: { json: true },
    })

    if (!sessionObj.object || !sessionObj.object.json) {
      return NextResponse.json({ ok: false, msg: 'Session object not found' })
    }

    const fields = sessionObj.object.json as any
    if (!fields) {
      return NextResponse.json({ ok: false, msg: 'Could not parse session fields' })
    }

    // ── Extract known fields ─────────────────────────────────────────────────
    const active = Boolean(fields.active)
    const paused = Boolean(fields.paused)

    // wins_claimed: vector<bool> (7 elements, one per win type)
    const winsClaimed: boolean[] = Array.isArray(fields.wins_claimed)
      ? fields.wins_claimed.map((b: any) => Boolean(b))
      : Array(7).fill(false)

    // vault: Balance<HEIST> (v4 - comes as string via `vault` field)
    const vaultTotal = Number(fields.vault || fields.vault_balance || 0)

    // ── Fields with snake_case/camelCase fallback ────────────────────────────
    // SUI Move uses snake_case; the SDK returns them verbatim
    const drawCount = Number(fields.draw_count ?? fields.drawCount ?? 0)
    const lastNumber = Number(fields.last_number ?? fields.lastNumber ?? 0)
    const bankruptCount = Number(fields.bankrupt_count ?? fields.bankruptCount ?? 0)

    // drawn_numbers: vector<u8>. ⚠️ The gRPC client returns vector<u8> as a
    // base64 BCS string (e.g. "BA==" = [4]), NOT a JS array — decode it.
    // Plain arrays (JSON-RPC path) are handled too.
    let drawn: number[] = []
    if (Array.isArray(fields.drawn_numbers)) {
      drawn = fields.drawn_numbers.map((n: any) => Number(n))
    } else if (typeof fields.drawn_numbers === 'string' && fields.drawn_numbers.length > 0) {
      try {
        drawn = Array.from(Buffer.from(fields.drawn_numbers, 'base64'))
      } catch {
        drawn = []
      }
    } else if (Array.isArray(fields.drawn)) {
      drawn = fields.drawn.map((n: any) => Number(n))
    }

    // ── v5: exact raw payment per accepted coin ($0.50 / $0.25 MTRX) ───────
    // Computed server-side so the frontend pays EXACTLY what the server (and
    // the on-chain price table) will accept. SUI is live-fetched (cached 60s);
    // HEIST resolves live-feed → env → placeholder ($0.0001) so it ALWAYS has
    // a price — mintable out of the box, auto-updating once a real feed is
    // configured. Stables are fixed. If the SUI feed fails we omit prices (the
    // frontend shows an error on mint).
    const prices: Record<string, { full: string; mtrx: string }> = {}
    let rates: Record<string, string> = {}
    let heistPriceSet = false
    // Stables (fixed $1) + HEIST (live-feed → env → placeholder, always priced)
    // never depend on the SUI feed — emit them even if CoinGecko is down. Only
    // the SUI entry needs the live price and is omitted when the feed fails.
    const heistUsd = (await fetchHeistPriceUsdLive()) ?? fetchHeistPriceUsd()
    for (const key of ['USDC', 'USDT', 'HEIST'] as const) {
      const full = fullRawForCoin(key, 0, heistUsd)
      prices[key] = { full: full.toString(), mtrx: mtrxRawForCoin(full).toString() }
    }
    // Only include coins that are actually accepted server-side
    if (USDT_COIN_TYPE_UNCONFIGURED) delete prices.USDT
    // Current USD price for the mint UI (1 HEIST = $X). More decimals for HEIST
    // so sub-$0.0001 prices don't display as "0.0000".
    rates = { HEIST: heistUsd < 0.001 ? heistUsd.toPrecision(4) : heistUsd.toFixed(4) }
    heistPriceSet = true
    try {
      const suiUsd = await fetchSuiPriceUsd()
      const suiFull = fullRawForCoin('SUI', suiUsd, heistUsd)
      prices.SUI = { full: suiFull.toString(), mtrx: mtrxRawForCoin(suiFull).toString() }
      rates.SUI = suiUsd.toFixed(4)
    } catch {
      // SUI feed down — omit only the SUI entry (stables + HEIST stay mintable)
    }

    return NextResponse.json({
      ok: true,
      session: SESSION_OBJECT_ID,
      active: active && !paused, // only active if not paused
      drawCount,
      lastNumber,
      drawn,
      vaultTotal,
      bankruptCount,
      winsClaimed,
      prices,
      rates,
      heistPriceSet,
      ts: Date.now(),
    })

  } catch (e: any) {
    console.error('Session state error:', e.message)
    return NextResponse.json({ ok: false, error: 'Session unavailable' }, { status: 500 })
  }
}