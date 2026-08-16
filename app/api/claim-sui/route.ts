export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  getRegisteredDevices,
  verifyWin,
  canClaimFullHouse,
  isClaimed,
  recordClaim,
  getClaimers,
} from '../../../lib/claim-ledger'

// ─── Constants ───────────────────────────────────────────────────────────────
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
// Public fullnode by default; SUI_RPC_URL env overrides (dedicated provider
// avoids stale-read issues on the shared public endpoint from Vercel egress).
const RPC_URL = process.env.SUI_RPC_URL || `https://fullnode.${SUI_NETWORK}.sui.io:443`

// Win type payout basis points (for the estimated-payout response only;
// actual payouts are computed on-chain by the contract)
const WIN_PAYOUTS: Record<number, number> = {
  0: 500, 1: 500, 2: 500, 3: 500, 4: 1950, 5: 1950, 6: 4000,
}

const WIN_KEYS = ['EARLY_FIVE', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE_1', 'FULL_HOUSE_2', 'FULL_HOUSE_3']

// ─── POST /api/claim-sui ─────────────────────────────────────────────────────
// Records a server-verified claim. NO immediate on-chain payout — the claim is
// held in the server ledger and paid out (batched) at round end by
// /api/settle-claims. This lets winners claim from the vault during the game
// AND during the 59-min lobby before the next round, even after their console
// was trashed.
//
// Body: { wallet, winType (0-6) }
export async function POST(req: Request) {
  if (!SUI_PROGRAM_ID || !SESSION_OBJECT_ID) {
    return NextResponse.json({
      ok: false,
      error: 'SUI_PROGRAM_ID and SESSION_OBJECT_ID must be set in env vars',
    }, { status: 500 })
  }

  try {
    const { wallet, winType } = await req.json()

    // Validate inputs
    if (typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 20) {
      return NextResponse.json({ ok: false, error: 'Invalid wallet address' }, { status: 400 })
    }
    if (typeof winType !== 'number' || winType < 0 || winType > 6) {
      return NextResponse.json({ ok: false, error: 'Invalid win type (0-6)' }, { status: 400 })
    }

    // ── Anti-cheat: one claim per wallet per win type ─────────────────────
    if (isClaimed(wallet, winType)) {
      return NextResponse.json({ ok: false, error: 'Already claimed this round' }, { status: 400 })
    }

    const sui = new SuiGrpcClient({ network: SUI_NETWORK, baseUrl: RPC_URL })

    // ── Read on-chain session ─────────────────────────────────────────────
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

    // Win type exhausted on-chain → too late (already settled / swept)
    if (fields.wins_claimed?.[winType] === true) {
      return NextResponse.json({ ok: false, error: 'Win already claimed (exhausted)' }, { status: 400 })
    }

    // ── Anti-cheat core: verify the wallet's REGISTERED grid really hit the
    //    pattern against the ON-CHAIN drawn numbers ("make sure the ransome
    //    is hit"). The client cannot submit a fake grid — we use the grid it
    //    registered at mint time. ──────────────────────────────────────────
    const drawn: number[] = (Array.isArray(fields.drawn_numbers) ? fields.drawn_numbers : [])
      .map((n: any) => Number(n))
    // On-chain wins_claimed — used to enforce FULL HOUSE tier order
    // (a wallet can only claim FH1 → FH2 → FH3 in sequence).
    const winsClaimedOnChain: boolean[] = Array.isArray(fields.wins_claimed)
      ? fields.wins_claimed.map((b: any) => Boolean(b))
      : Array(7).fill(false)

    const devices = getRegisteredDevices(wallet)
    if (devices.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No device registered for this wallet — mint a device first',
      }, { status: 400 })
    }

    // ── Anti-cheat: FULL HOUSE tiers must be claimed in order (FH1→FH2→FH3),
    //    mirroring the frontend's local bankruptCount. Prevents skipping
    //    straight to the 40% jackpot without earning the earlier tiers.
    const fhGate = canClaimFullHouse(wallet, winType, winsClaimedOnChain)
    if (!fhGate.ok) {
      return NextResponse.json({ ok: false, error: fhGate.error }, { status: 400 })
    }

    // Any registered device of this wallet must genuinely hit the pattern
    // against the on-chain drawn numbers ("make sure the ransome is hit").
    const grid = devices.find((d) => verifyWin(d.grid, drawn, winType))?.grid
    if (!grid) {
      return NextResponse.json({
        ok: false,
        error: 'Win pattern not verified against on-chain draws — the ransome was not genuinely hit',
      }, { status: 400 })
    }

    // ── Record the claim (dedupe + rate limit handled inside ledger) ──────
    const rec = recordClaim(wallet, winType)
    if (!rec.ok) {
      return NextResponse.json({ ok: false, error: rec.error }, { status: 429 })
    }

    const vaultBalance = Number(fields.vault || 0)
    const totalPayout = Math.floor(vaultBalance * (WIN_PAYOUTS[winType] || 0) / 10000)
    const claimers = getClaimers(winType).length
    const perWinner = claimers > 0 ? Math.floor(totalPayout / claimers) : 0

    return NextResponse.json({
      ok: true,
      pending: true,
      winType,
      key: WIN_KEYS[winType],
      claimers,
      estPayout: perWinner,
      msg: 'Claim recorded — payout at round end (or from the vault anytime before the next round)',
    })

  } catch (e: any) {
    console.error('Claim SUI error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Claim failed' }, { status: 500 })
  }
}
