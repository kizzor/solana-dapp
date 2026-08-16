export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { executeSettlement } from '../../../lib/claim-settle'

// ─── Constants ───────────────────────────────────────────────────────────────
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
// Public fullnode by default; SUI_RPC_URL env overrides (dedicated provider
// avoids stale-read issues on the shared public endpoint from Vercel egress).
const RPC_URL = process.env.SUI_RPC_URL || `https://fullnode.${SUI_NETWORK}.sui.io:443`

// ─── GET /api/settle-claims (cron) ──────────────────────────────────────────
// Settles every win type that has pending claimers by executing the existing
// on-chain claim_win_split(session, claimers, winType). Win types with NO
// claimers are swept to the treasury. Called at the round boundary (see
// /api/draw, which invokes the same executor) or manually.
export async function GET(req: Request) {
  // Mainnet: only the cron (CRON_SECRET) may settle. Testnet/devnet: open,
  // so the DEV ⏭ SETTLE button can verify the wallet split during testing.
  const auth = req.headers.get('authorization')
  // Fail closed: with a blank CRON_SECRET the template becomes the literal
  // string "Bearer " (trailing space), which passed auth. Require the secret
  // to actually be set AND to match.
  const cronSecret = process.env.CRON_SECRET
  if (SUI_NETWORK === 'mainnet' && (!cronSecret || auth !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUI_PROGRAM_ID || !SESSION_OBJECT_ID) {
    return NextResponse.json({ ok: false, error: 'SUI_PROGRAM_ID and SESSION_OBJECT_ID must be set' }, { status: 500 })
  }

  try {
    const sui = new SuiGrpcClient({ network: SUI_NETWORK, baseUrl: RPC_URL })
    const out = await executeSettlement(sui, SUI_PROGRAM_ID, SESSION_OBJECT_ID)
    return NextResponse.json(out)
  } catch (e: any) {
    console.error('Settle claims error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Settlement failed' }, { status: 500 })
  }
}

// Allow POST as well (some cron setups use POST)
export const POST = GET
