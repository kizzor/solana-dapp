export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { createSuiClient } from '../../../lib/sui-client'
import {
  getRegisteredDevices,
  verifyWin,
  canClaimFullHouse,
  getWalletStatus,
} from '../../../lib/claim-ledger'

// ─── Constants ───────────────────────────────────────────────────────────────
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
const WIN_KEYS = ['EARLY_FIVE', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE_1', 'FULL_HOUSE_2', 'FULL_HOUSE_3']
const WIN_LABELS = ['EARLY FIVE', 'TOP LINE', 'MIDDLE LINE', 'BOTTOM LINE', 'FULL HOUSE 1', 'FULL HOUSE 2', 'FULL HOUSE 3']
const WIN_PAYOUTS: Record<number, number> = { 0: 500, 1: 500, 2: 500, 3: 500, 4: 1950, 5: 1950, 6: 4000 }

// ─── GET /api/claims?wallet=0x… ─────────────────────────────────────────────
// Powers the vault claim panel: shows which win types this wallet can still
// claim (patterns verified against on-chain draws), which are pending, and
// which are already settled.
export async function GET(req: Request) {
  if (!SESSION_OBJECT_ID) {
    return NextResponse.json({ ok: false, error: 'SESSION_OBJECT_ID not set' }, { status: 500 })
  }

  try {
    const url = new URL(req.url)
    const wallet = (url.searchParams.get('wallet') || '').toLowerCase()

    if (!wallet.startsWith('0x') || wallet.length < 20) {
      return NextResponse.json({ ok: false, error: 'Invalid wallet address' }, { status: 400 })
    }

    const sui = createSuiClient(SUI_NETWORK)
    const sessionObj = await sui.getObject({ objectId: SESSION_OBJECT_ID, include: { json: true } })
    const fields = (sessionObj.object?.json as any) || {}

    const drawn: number[] = (Array.isArray(fields.drawn_numbers) ? fields.drawn_numbers : [])
      .map((n: any) => Number(n))
    const winsClaimedOnChain: boolean[] = Array.isArray(fields.wins_claimed)
      ? fields.wins_claimed.map((b: any) => Boolean(b))
      : Array(7).fill(false)
    const vaultTotal = Number(fields.vault || 0)
    const active = Boolean(fields.active)

    const devices = getRegisteredDevices(wallet)
    const { claimed, pending } = getWalletStatus(wallet)

    // claimable = pattern genuinely hit against on-chain draws, not yet
    // claimed by this wallet, and the win type is not exhausted on-chain
    const claimable: { winType: number; key: string; label: string; estPayout: number }[] = []
    for (let wt = 0; wt < 7; wt++) {
      if (claimed.includes(wt)) continue
      if (winsClaimedOnChain[wt]) continue
      // FULL HOUSE tiers must be claimed in order (FH1→FH2→FH3)
      if (wt >= 4 && !canClaimFullHouse(wallet, wt, winsClaimedOnChain).ok) continue
      const hit = devices.some((d) => verifyWin(d.grid, drawn, wt))
      if (!hit) continue
      const totalPayout = Math.floor(vaultTotal * (WIN_PAYOUTS[wt] || 0) / 10000)
      claimable.push({
        winType: wt,
        key: WIN_KEYS[wt],
        label: WIN_LABELS[wt],
        estPayout: totalPayout,
      })
    }

    return NextResponse.json({
      ok: true,
      wallet,
      active,
      vaultTotal,
      drawnCount: drawn.length,
      claimable,
      claimed: claimed.map((wt) => ({ winType: wt, key: WIN_KEYS[wt], label: WIN_LABELS[wt], status: pending.includes(wt) ? 'pending' : 'recorded' })),
      exhausted: winsClaimedOnChain.map((c, i) => (c ? WIN_KEYS[i] : null)).filter(Boolean),
      ts: Date.now(),
    })

  } catch (e: any) {
    console.error('Claims status error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Claims status failed' }, { status: 500 })
  }
}
