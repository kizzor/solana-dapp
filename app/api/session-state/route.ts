export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ AFTER PUBLISHING the new HEIST contract, set env vars in Vercel:
//   vercel env add SESSION_OBJECT_ID  ← Object ID from init_session output
// ═══════════════════════════════════════════════════════════════════════════
// ─── Constants ───────────────────────────────────────────────────────────────
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
// gRPC endpoint derived from network (mainnet only in production, but supports testnet/devnet for dev)
const RPC_URL = `https://fullnode.${SUI_NETWORK}.sui.io:443`

// ─── GET /api/session-state ──────────────────────────────────────────────────
// Reads the SUI on-chain session object and returns game state.
// Called by the frontend every ~2s during gameplay.
export async function GET() {
  // ── Guard: env vars must be set ──────────────────────────────────────────
  if (!SESSION_OBJECT_ID) {
    return NextResponse.json({ ok: false, error: 'SESSION_OBJECT_ID not set. Publish HEIST contract and init session first.' }, { status: 500 })
  }

  try {
    const sui = new SuiGrpcClient({ network: SUI_NETWORK, baseUrl: RPC_URL })

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

    // vault: Balance<SUI> (comes as string from SUI SDK via `vault` field)
    const vaultTotal = Number(fields.vault || fields.vault_balance || 0)

    // ── Fields with snake_case/camelCase fallback ────────────────────────────
    // SUI Move uses snake_case; the SDK returns them verbatim
    const drawCount = Number(fields.draw_count ?? fields.drawCount ?? 0)
    const lastNumber = Number(fields.last_number ?? fields.lastNumber ?? 0)
    const bankruptCount = Number(fields.bankrupt_count ?? fields.bankruptCount ?? 0)

    // drawn_numbers: vector<u8>
    const drawn: number[] = (Array.isArray(fields.drawn_numbers)
      ? fields.drawn_numbers
      : Array.isArray(fields.drawn)
        ? fields.drawn
        : []
    ).map((n: any) => Number(n))

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
      ts: Date.now(),
    })

  } catch (e: any) {
    console.error('Session state error:', e.message)
    return NextResponse.json({ ok: false, error: 'Session unavailable' }, { status: 500 })
  }
}