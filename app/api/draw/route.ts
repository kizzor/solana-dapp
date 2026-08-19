export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { createSuiClient } from '../../../lib/sui-client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { executeSettlement, sweepRemaining, advanceSession } from '../../../lib/claim-settle'
import {
  fetchSuiPriceUsd,
  fetchHeistPriceUsdLive,
  isValidHeistPriceUsd,
  fullRawForCoin,
  SUI_COIN_TYPE,
  heistCoinTypeOf,
} from '../../../lib/heist-prices'

// ─── Constants ───────────────────────────────────────────────────────────────
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
// v6: SessionRegistry — holds current_session_id + pause state + treasury.
// When set, the draw route reads the active session from the registry instead
// of the env var. This enables automatic session rotation.
const SESSION_REGISTRY_ID = process.env.SESSION_REGISTRY_ID || ''
// v5: shared HeistAdmin (price table).
const HEIST_ADMIN_ID = process.env.HEIST_ADMIN_ID || ''
// Last prices (raw $0.50 amounts) written on-chain this process
let lastSuiRawWritten = 0n
let lastHeistRawWritten = 0n
// Network-aware: testnet/devnet for local dev testing with faucet SUI
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
// v6: MAX_DRAWS per session — must match the contract constant
const MAX_DRAWS = 59

function getAuthorityKeypair(): Ed25519Keypair {
  const privKey = process.env.SUI_PRIVATE_KEY
  if (privKey) {
    try {
      const { secretKey } = decodeSuiPrivateKey(privKey)
      return Ed25519Keypair.fromSecretKey(secretKey)
    } catch {}
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
  const cronSecret = process.env.CRON_SECRET
  if (SUI_NETWORK === 'mainnet' && (!cronSecret || auth !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Guard: env vars must be set ────────────────────────────────
  if (!SUI_PROGRAM_ID) {
    return NextResponse.json({
      ok: false,
      error: 'SUI_PROGRAM_ID must be set in env vars',
    }, { status: 500 })
  }

  try {
    const keypair = getAuthorityKeypair()
    const senderAddr = keypair.toSuiAddress()
    const sui = createSuiClient(SUI_NETWORK)

    // ── Resolve current session ID ──────────────────────────────────────
    // v6: If SESSION_REGISTRY_ID is set, read current_session_id from the
    // on-chain SessionRegistry. Otherwise, fall back to SESSION_OBJECT_ID env var.
    let sessionId = SESSION_OBJECT_ID || ''
    let registryFields: any = null

    if (SESSION_REGISTRY_ID) {
      const regObj = await sui.getObject({
        objectId: SESSION_REGISTRY_ID,
        include: { json: true },
      })
      if (!regObj.object || !regObj.object.json) {
        return NextResponse.json({ ok: false, error: 'SessionRegistry not found' }, { status: 404 })
      }
      registryFields = regObj.object.json as any
      sessionId = registryFields.current_session_id
      if (!sessionId || sessionId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        return NextResponse.json({ ok: false, error: 'No session registered — run register_initial_session first' }, { status: 500 })
      }

      // v6: Check if game is paused (auto-resume if pause_end_ms reached)
      if (registryFields.paused) {
        const now = Date.now()
        const pauseEnd = Number(registryFields.pause_end_ms || 0)
        if (pauseEnd === 0 || now < pauseEnd) {
          // Still paused (indefinite or countdown not reached)
          return NextResponse.json({
            ok: false,
            paused: true,
            pauseEndMs: pauseEnd,
            msg: 'Game is paused — under maintenance',
          }, { status: 400 })
        }
        // Pause expired — auto-resume will happen on next draw
        console.log('Draw: pause expired (pause_end_ms', pauseEnd, '), resuming automatically')
      }
    }

    if (!sessionId) {
      return NextResponse.json({
        ok: false,
        error: 'SESSION_OBJECT_ID must be set (or SESSION_REGISTRY_ID with a registered session)',
      }, { status: 500 })
    }

    // ── Read current session ────────────────────────────────────────────
    const sessionObj = await sui.getObject({
      objectId: sessionId,
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

    const drawnNumbers: number[] = (Array.isArray(fields.drawn_numbers)
      ? fields.drawn_numbers
      : typeof fields.drawn_numbers === 'string'
        ? Array.from(Buffer.from(fields.drawn_numbers, 'base64'))
        : []
    ).map((n: any) => Number(n))
    const drawCount = drawnNumbers.length

    // ── v6: Session exhaustion detection ────────────────────────────────
    // When all MAX_DRAWS numbers are drawn, auto-settle + advance to next session.
    if (drawCount >= MAX_DRAWS) {
      console.log(`Draw: session ${sessionId.slice(0, 10)}… exhausted (${drawCount}/${MAX_DRAWS}) — settling + advancing`)

      // Step 1: Settle all pending claims
      let settled = null
      try {
        settled = await executeSettlement(sui, SUI_PROGRAM_ID, sessionId)
      } catch (e: any) {
        console.error('Settlement at exhaustion failed:', e)
        settled = { ok: false, error: e?.message || 'settle failed', results: [] }
      }

      // Step 2: Sweep remaining vault to treasury
      let swept = null
      try {
        swept = await sweepRemaining(sui, SUI_PROGRAM_ID, sessionId)
      } catch (e: any) {
        console.error('Sweep at exhaustion failed:', e)
        swept = { ok: false, error: e?.message || 'sweep failed' }
      }

      // Step 3: Advance to next session (if registry is configured)
      let advanced = null
      if (SESSION_REGISTRY_ID) {
        try {
          advanced = await advanceSession(sui, SUI_PROGRAM_ID, SESSION_REGISTRY_ID)
        } catch (e: any) {
          console.error('Advance session failed:', e)
          advanced = { ok: false, error: e?.message || 'advance failed' }
        }
      }

      return NextResponse.json({
        ok: true,
        exhausted: true,
        drawCount,
        settled,
        swept,
        advanced,
        msg: `Session exhausted (${drawCount}/${MAX_DRAWS}). ${SESSION_REGISTRY_ID ? 'Advanced to next session.' : 'Set SESSION_OBJECT_ID to new session manually.'}`,
        ts: Date.now(),
      })
    }

    // ── Normal draw ─────────────────────────────────────────────────────
    // Build PTB: draw_number(session, ctx) [+ live SUI price sync (v5)]
    const txb = new Transaction()
    txb.setSender(senderAddr)

    txb.moveCall({
      target: `${SUI_PROGRAM_ID}::heist::draw_number`,
      arguments: [
        txb.object(sessionId),
      ],
    })

    // Live prices → on-chain price table (only when they moved materially)
    let suiSyncedTx = false
    let heistSyncedTx = false
    if (HEIST_ADMIN_ID) {
      try {
        const suiUsd = await fetchSuiPriceUsd()
        const raw = fullRawForCoin('SUI', suiUsd, 0)
        const drift = lastSuiRawWritten === 0n ? 1n : (raw > lastSuiRawWritten ? raw - lastSuiRawWritten : lastSuiRawWritten - raw)
        if (drift * 400n > (lastSuiRawWritten || 1n)) {
          txb.moveCall({
            target: `${SUI_PROGRAM_ID}::heist::set_price`,
            typeArguments: [SUI_COIN_TYPE],
            arguments: [txb.object(HEIST_ADMIN_ID), txb.pure.u64(raw)],
          })
          suiSyncedTx = true
          lastSuiRawWritten = raw
        }
        const heistLive = await fetchHeistPriceUsdLive()
        const heistEnv = Number(process.env.HEIST_PRICE_USD)
        const heistUsd = heistLive !== null ? heistLive : (isValidHeistPriceUsd(heistEnv) ? heistEnv : null)
        if (heistUsd !== null) {
          const heistRaw = fullRawForCoin('HEIST', suiUsd, heistUsd)
          if (heistRaw !== lastHeistRawWritten) {
            txb.moveCall({
              target: `${SUI_PROGRAM_ID}::heist::set_price`,
              typeArguments: [heistCoinTypeOf(SUI_PROGRAM_ID || '')],
              arguments: [txb.object(HEIST_ADMIN_ID), txb.pure.u64(heistRaw)],
            })
            heistSyncedTx = true
            lastHeistRawWritten = heistRaw
          }
        }
      } catch (e: any) {
        console.error('Draw: price sync skipped:', e?.message)
      }
    }

    txb.setGasBudget(10_000_000)
    txb.setGasPayment([])

    // Sign and execute
    const result = await sui.signAndExecuteTransaction({
      signer: keypair,
      transaction: txb,
      include: { effects: true, objectTypes: true },
    })

    const txResult = result.Transaction ?? result.FailedTransaction
    const isSuccess = result.$kind === 'Transaction'

    if (!isSuccess) {
      if (suiSyncedTx) lastSuiRawWritten = 0n
      if (heistSyncedTx) lastHeistRawWritten = 0n
      return NextResponse.json({
        ok: false,
        error: `On-chain error: ${txResult?.effects?.status?.error?.message || 'unknown'}`,
        digest: txResult?.digest,
      }, { status: 500 })
    }

    // Read the new session state after draw
    const updatedSession = await sui.getObject({
      objectId: sessionId,
      include: { json: true },
    })
    const updatedFields = (updatedSession.object?.json as any) || {}
    const newDrawCount = Number(updatedFields.draw_count || 0)
    const newDrawnLen = (updatedFields.drawn_numbers || []).length

    return NextResponse.json({
      ok: true,
      digest: txResult?.digest,
      sessionId,
      number: Number(updatedFields.last_number || 0),
      drawCount: newDrawCount,
      drawnCount: newDrawnLen,
      remaining: MAX_DRAWS - newDrawnLen,
      nextDrawIsExhaustion: newDrawnLen >= MAX_DRAWS,
      settled: null,
      suiPriceSynced: suiSyncedTx || heistSyncedTx,
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
