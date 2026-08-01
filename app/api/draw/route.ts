export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { executeSettlement } from '../../../lib/claim-settle'

// ─── Constants ───────────────────────────────────────────────────────────────
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
// Network-aware: testnet/devnet for local dev testing with faucet SUI
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
const RPC_URL = `https://fullnode.${SUI_NETWORK}.sui.io:443`
// 59-minute lobby cycle — same formula as the frontend (useLobbyCountdown)
const LOBBY_CYCLE = 59 * 60

function getAuthorityKeypair(): Ed25519Keypair {
  const privKey = process.env.SUI_PRIVATE_KEY
  if (privKey) {
    if (/^[0-9a-fA-F]{128}$/.test(privKey)) {
      const bytes = Uint8Array.from(Buffer.from(privKey, 'hex'))
      return Ed25519Keypair.fromSecretKey(bytes)
    }
    try {
      const bytes = Uint8Array.from(Buffer.from(privKey, 'base64'))
      return Ed25519Keypair.fromSecretKey(bytes)
    } catch {}
  }
  throw new Error('No SUI authority keypair found. Set SUI_PRIVATE_KEY env var.')
}

// ─── Round-boundary helper ──────────────────────────────────────────────────
// Returns true during the first minute of a new 59-min UTC cycle — i.e. right
// when the previous round's lobby countdown hit zero and a new round begins.
// That is the moment claims from the previous round (game + lobby) close and
// the vault settles: winners paid, unclaimed win types swept to treasury.
function atRoundBoundary(): boolean {
  const now = new Date()
  const elapsed = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()
  return elapsed % LOBBY_CYCLE < 60
}

export async function GET(req: Request) {
  // ── Auth check ─────────────────────────────────────────────────
  // Mainnet: only the cron (CRON_SECRET) may draw. Testnet/devnet: open,
  // so the in-game DEV ⏩ FORWARD button can drive the hack matrix while
  // testing the claim/split flow with faucet SUI.
  const auth = req.headers.get('authorization')
  if (SUI_NETWORK === 'mainnet' && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Guard: env vars must be set ────────────────────────────────
  if (!SUI_PROGRAM_ID || !SESSION_OBJECT_ID) {
    return NextResponse.json({
      ok: false,
      error: 'SUI_PROGRAM_ID and SESSION_OBJECT_ID must be set in env vars after publishing the HEIST contract',
    }, { status: 500 })
  }

  try {
    const keypair = getAuthorityKeypair()
    const senderAddr = keypair.toSuiAddress()

    const sui = new SuiGrpcClient({
      network: SUI_NETWORK,
      baseUrl: RPC_URL,
    })

    // Check session is active
    // v2.22.x gRPC client: objectId + include.json, response is { object: { json } }
    const sessionObj = await sui.getObject({
      objectId: SESSION_OBJECT_ID,
      include: { json: true },
    })
    if (!sessionObj.object || !sessionObj.object.json) {
      return NextResponse.json({ ok: false, error: 'Session object not found' }, { status: 404 })
    }
    const fields = sessionObj.object.json as any
    if (!fields?.active) {
      return NextResponse.json({ ok: false, error: 'Session is not active' }, { status: 400 })
    }
    if (fields.paused) {
      return NextResponse.json({ ok: false, error: 'Session is paused' }, { status: 400 })
    }

    // ── Round-boundary settlement ───────────────────────────────────────────
    // At the start of each new 59-min cycle, pay all pending claims from the
    // previous round (and sweep unclaimed win types to the treasury) before
    // drawing the first number of the new round.
    let settled = null
    if (atRoundBoundary()) {
      try {
        settled = await executeSettlement(sui, SUI_PROGRAM_ID, SESSION_OBJECT_ID)
      } catch (e: any) {
        console.error('Auto-settle at round boundary failed:', e)
        settled = { ok: false, error: e?.message || 'settle failed', results: [] }
      }
    }

    // Check not all numbers drawn
    const drawnNumbers = fields.drawn_numbers || []
    if (drawnNumbers.length >= 90) {
      return NextResponse.json({ ok: false, error: 'All 90 numbers already drawn' }, { status: 400 })
    }

    // Build PTB: draw_number(session, ctx)
    const txb = new Transaction()
    txb.setSender(senderAddr)

    txb.moveCall({
      target: `${SUI_PROGRAM_ID}::heist::draw_number`,
      arguments: [
        txb.object(SESSION_OBJECT_ID),
      ],
    })

    txb.setGasBudget(10_000_000)
    txb.setGasPayment([]) // use address-balance accumulator for gas

    // Sign and execute
    const result = await sui.signAndExecuteTransaction({
      signer: keypair,
      transaction: txb,
      include: { effects: true, objectTypes: true },
    })

    // Unwrap gRPC response
    const txResult = result.Transaction ?? result.FailedTransaction
    const isSuccess = result.$kind === 'Transaction'

    if (!isSuccess) {
      return NextResponse.json({
        ok: false,
        error: `On-chain error: ${txResult?.effects?.status?.error?.message || 'unknown'}`,
        digest: txResult?.digest,
      }, { status: 500 })
    }

    // Read the new session state after draw
    const updatedSession = await sui.getObject({
      objectId: SESSION_OBJECT_ID,
      include: { json: true },
    })
    const updatedFields = (updatedSession.object?.json as any) || {}

    return NextResponse.json({
      ok: true,
      digest: txResult?.digest,
      number: Number(updatedFields.last_number || 0),
      drawCount: Number(updatedFields.draw_count || 0),
      drawnCount: (updatedFields.drawn_numbers || []).length,
      remaining: 90 - (updatedFields.drawn_numbers || []).length,
      settled,
      ts: Date.now(),
    })

  } catch (e: any) {
    console.error('Draw error:', e)
    return NextResponse.json({
      ok: false,
      error: e.message || 'Draw failed',
    }, { status: 500 })
  }
}
