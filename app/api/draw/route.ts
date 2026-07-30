export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// ─── Constants ───────────────────────────────────────────────────────────────
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const RPC_URL = 'https://fullnode.mainnet.sui.io:443'

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

export async function GET(req: Request) {
  // ── Auth check ─────────────────────────────────────────────────
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
      network: 'mainnet',
      baseUrl: RPC_URL,
    })

    // Check session is active
    const sessionObj = await sui.getObject({
      id: SESSION_OBJECT_ID,
      options: { showContent: true },
    })
    if (!sessionObj.data) {
      return NextResponse.json({ ok: false, error: 'Session object not found' }, { status: 404 })
    }
    const fields = (sessionObj.data.content as any)?.fields
    if (!fields?.active) {
      return NextResponse.json({ ok: false, error: 'Session is not active' }, { status: 400 })
    }
    if (fields.paused) {
      return NextResponse.json({ ok: false, error: 'Session is paused' }, { status: 400 })
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
      id: SESSION_OBJECT_ID,
      options: { showContent: true },
    })
    const updatedFields = (updatedSession.data?.content as any)?.fields || {}

    return NextResponse.json({
      ok: true,
      digest: txResult?.digest,
      number: Number(updatedFields.last_number || 0),
      drawCount: Number(updatedFields.draw_count || 0),
      drawnCount: (updatedFields.drawn_numbers || []).length,
      remaining: 90 - (updatedFields.drawn_numbers || []).length,
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
