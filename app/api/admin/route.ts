export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { createSuiClient } from '../../../lib/sui-client'
import { Transaction } from '@mysten/sui/transactions'
import { getAuthorityKeypair } from '../../../lib/claim-settle'

// ─── Constants ───────────────────────────────────────────────────────────────
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_REGISTRY_ID = process.env.SESSION_REGISTRY_ID || ''
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
const ADMIN_SECRET = process.env.ADMIN_SECRET || '' // simple password auth for admin ops

// ─── Auth check ──────────────────────────────────────────────────────────────
function verifyAdmin(req: Request): boolean {
  const auth = req.headers.get('authorization')
  if (!ADMIN_SECRET) return false // no secret configured = no admin access
  return auth === `Bearer ${ADMIN_SECRET}`
}

// ─── GET /api/admin ──────────────────────────────────────────────────────────
// Returns current registry state (pause status, treasury, current session).
export async function GET(req: Request) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUI_PROGRAM_ID || !SESSION_REGISTRY_ID) {
    return NextResponse.json({ ok: false, error: 'SUI_PROGRAM_ID and SESSION_REGISTRY_ID must be set' }, { status: 500 })
  }

  try {
    const sui = createSuiClient(SUI_NETWORK)
    const regObj = await sui.getObject({ objectId: SESSION_REGISTRY_ID, include: { json: true } })
    if (!regObj.object?.json) {
      return NextResponse.json({ ok: false, error: 'SessionRegistry not found' }, { status: 404 })
    }
    const fields = regObj.object.json as any
    return NextResponse.json({
      ok: true,
      authority: fields.authority,
      treasury: fields.treasury,
      currentSessionId: fields.current_session_id,
      paused: Boolean(fields.paused),
      pauseEndMs: Number(fields.pause_end_ms || 0),
      ts: Date.now(),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// ─── POST /api/admin ─────────────────────────────────────────────────────────
// Actions: pause, resume, change-treasury
// Body: { action: 'pause' | 'resume' | 'change-treasury', durationMs?, newTreasury? }
export async function POST(req: Request) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUI_PROGRAM_ID || !SESSION_REGISTRY_ID) {
    return NextResponse.json({ ok: false, error: 'SUI_PROGRAM_ID and SESSION_REGISTRY_ID must be set' }, { status: 500 })
  }

  try {
    const { action, durationMs, newTreasury } = await req.json()
    const keypair = getAuthorityKeypair()
    const senderAddr = keypair.toSuiAddress()
    const sui = createSuiClient(SUI_NETWORK)
    const txb = new Transaction()
    txb.setSender(senderAddr)

    switch (action) {
      case 'pause': {
        txb.moveCall({
          target: `${SUI_PROGRAM_ID}::heist::pause_game`,
          arguments: [txb.object(SESSION_REGISTRY_ID), txb.pure.u64(durationMs || 0)],
        })
        break
      }
      case 'resume': {
        txb.moveCall({
          target: `${SUI_PROGRAM_ID}::heist::resume_game`,
          arguments: [txb.object(SESSION_REGISTRY_ID)],
        })
        break
      }
      case 'change-treasury': {
        if (!newTreasury || !newTreasury.startsWith('0x')) {
          return NextResponse.json({ ok: false, error: 'newTreasury address required' }, { status: 400 })
        }
        txb.moveCall({
          target: `${SUI_PROGRAM_ID}::heist::set_treasury`,
          arguments: [txb.object(SESSION_REGISTRY_ID), txb.pure.address(newTreasury)],
        })
        break
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
    }

    txb.setGasBudget(10_000_000)
    txb.setGasPayment([])

    const result: any = await sui.signAndExecuteTransaction({
      signer: keypair,
      transaction: txb,
      include: { effects: true, objectTypes: true },
    })

    const txResult = result.Transaction ?? result.FailedTransaction
    const ok = result.$kind === 'Transaction'

    return NextResponse.json({
      ok,
      action,
      digest: txResult?.digest,
      error: ok ? undefined : txResult?.effects?.status?.error?.message,
      ts: Date.now(),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
