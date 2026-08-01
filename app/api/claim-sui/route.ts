export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// ─── Constants + Simple Rate Limiter ───────────────────────────────────────
// In-memory rate limiter — maps "wallet:winType" → unix timestamp
// Prevents rapid re-claims within the same round (window = 60s)
const claimRateMap = new Map<string, number>()
const RATE_WINDOW_MS = 60_000 // 60s per win type per wallet

const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID

// Win type payout basis points (must match contract after redeploy)
// 99% of vault goes to winners; 1% treasury fee deducted upfront
const WIN_PAYOUTS: Record<number, number> = {
  0: 500,   // EarlyFive:   5%
  1: 500,   // TopLine:     5%
  2: 500,   // MiddleLine:  5%
  3: 500,   // BottomLine:  5%
  4: 1950,  // FullHouse1: 19.5%
  5: 1950,  // FullHouse2: 19.5%
  6: 4000,  // FullHouse3:  40%
}  // Total: 9900 (99%)

function getAuthorityKeypair(): Ed25519Keypair {
  // Try SUI_PRIVATE_KEY env var (hex-encoded or Base64)
  const privKey = process.env.SUI_PRIVATE_KEY
  if (privKey) {
    // Hex-encoded (64 bytes = 128 hex chars)
    if (/^[0-9a-fA-F]{128}$/.test(privKey)) {
      const bytes = Uint8Array.from(Buffer.from(privKey, 'hex'))
      return Ed25519Keypair.fromSecretKey(bytes)
    }
    // Base64-encoded
    try {
      const bytes = Uint8Array.from(Buffer.from(privKey, 'base64'))
      return Ed25519Keypair.fromSecretKey(bytes)
    } catch {}
  }

  // Try reading from SUI keystore file
  const fs = require('fs')
  const path = require('path')
  const os = require('os')
  const keystorePath = path.join(os.homedir(), '.sui', 'sui_config', 'sui.keystore')
  if (fs.existsSync(keystorePath)) {
    const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'))
    // Keystore is an array of Base64-encoded keys
    // Find the one matching our authority address
    for (const key of keystore) {
      try {
        const bytes = Uint8Array.from(Buffer.from(key, 'base64'))
        // Ed25519 secret key is 32 bytes, but SUI stores 33 bytes (flag + key)
        const secretKey = bytes.length === 33 ? bytes.slice(1) : bytes
        const kp = Ed25519Keypair.fromSecretKey(secretKey)
        // Return first key (or match against authority address)
        return kp
      } catch {}
    }
  }

  throw new Error('No SUI authority keypair found. Set SUI_PRIVATE_KEY env var or ensure sui.keystore exists.')
}

export async function POST(req: Request) {
  // ── Guard: env vars must be set (new HEIST contract) ───────────────
  if (!SUI_PROGRAM_ID || !SESSION_OBJECT_ID) {
    return NextResponse.json({
      ok: false,
      error: 'SUI_PROGRAM_ID and SESSION_OBJECT_ID must be set in env vars after publishing the HEIST contract',
    }, { status: 500 })
  }

  // ── Auth check — prevent unauthorized claim signing ────────────────
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { winners, winType } = await req.json()

    // Validate inputs
    if (!Array.isArray(winners) || winners.length === 0) {
      return NextResponse.json({ ok: false, error: 'winners must be a non-empty array of addresses' }, { status: 400 })
    }
    if (typeof winType !== 'number' || winType < 0 || winType > 6) {
      return NextResponse.json({ ok: false, error: 'Invalid win type (0-6)' }, { status: 400 })
    }

    // Validate all addresses are valid SUI addresses
    for (const w of winners) {
      if (typeof w !== 'string' || !w.startsWith('0x') || w.length < 10) {
        return NextResponse.json({ ok: false, error: `Invalid address: ${w}` }, { status: 400 })
      }
    }

    // ── Anti-cheat: rate limit per wallet per win type ─────────────────────
    for (const w of winners) {
      const rateKey = `${w}:${winType}`
      const lastClaim = claimRateMap.get(rateKey)
      if (lastClaim && Date.now() - lastClaim < RATE_WINDOW_MS) {
        return NextResponse.json({
          ok: false,
          error: `Rate limited: ${w} already claimed winType ${winType} within ${RATE_WINDOW_MS / 1000}s window`,
        }, { status: 429 })
      }
    }

    // ── Anti-cheat: cap claimers at 10 to prevent abuse ────────────────────
    if (winners.length > 10) {
      return NextResponse.json({ ok: false, error: 'Maximum 10 claimers per win type' }, { status: 400 })
    }

    // Get authority keypair
    const keypair = getAuthorityKeypair()
    const senderAddr = keypair.toSuiAddress()

    // Connect to SUI mainnet via gRPC
    const sui = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })

    // Check session is active
    // v2.22.x gRPC client: objectId + include.json, response is { object: { json } }
    const sessionObj = await sui.getObject({ objectId: SESSION_OBJECT_ID, include: { json: true } })
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

    // Check win not already claimed
    const winsClaimed = fields.wins_claimed
    if (winsClaimed?.[winType] === true) {
      return NextResponse.json({ ok: false, error: 'Win already claimed (exhausted)' }, { status: 400 })
    }

    // Calculate expected payout for info
    const vaultBalance = parseInt(fields.vault || fields.vault_balance || '0')
    const payoutBps = WIN_PAYOUTS[winType] || 0
    const totalPayout = Math.floor(vaultBalance * payoutBps / 10000)
    const perWinner = Math.floor(totalPayout / winners.length)

    // Build PTB: claim_win_split(session, winners, win_type)
    const txb = new Transaction()
    txb.setSender(senderAddr)

    txb.moveCall({
      target: `${SUI_PROGRAM_ID}::heist::claim_win_split`,
      arguments: [
        txb.object(SESSION_OBJECT_ID),
        txb.pure.vector('address', winners),
        txb.pure.u8(winType),
      ],
    })

    // Sign and execute
    const result = await sui.signAndExecuteTransaction({
      transaction: txb,
      signer: keypair,
      // SuiGrpcClient uses `include` (not `options`)
      include: { effects: true, objectTypes: true },
    })

    // Unwrap gRPC response (SuiGrpcClient returns { $kind: "Transaction", Transaction: { ... } })
    const txResult = result.Transaction ?? result.FailedTransaction;
    const isSuccess = result.$kind === 'Transaction';

    if (!isSuccess) {
      return NextResponse.json({
        ok: false,
        error: `On-chain error: ${txResult?.effects?.status?.error?.message || 'unknown'}`,
        digest: txResult?.digest,
      }, { status: 500 })
    }

    // ── Mark rate limit AFTER successful execution ─────────────────────────
    for (const w of winners) {
      claimRateMap.set(`${w}:${winType}`, Date.now())
    }
    // Cleanup: evict stale entries when map grows large
    if (claimRateMap.size > 1000) {
      const now = Date.now()
      for (const [k, ts] of claimRateMap) {
        if (now - ts > RATE_WINDOW_MS * 2) claimRateMap.delete(k)
      }
    }

    return NextResponse.json({
      ok: true,
      digest: txResult?.digest,
      winType,
      winners: winners.length,
      totalPayout,
      perWinner,
      vaultBefore: vaultBalance,
      dust: totalPayout - (perWinner * winners.length),
    })

  } catch (e: any) {
    console.error('Claim SUI error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Claim failed' }, { status: 500 })
  }
}
