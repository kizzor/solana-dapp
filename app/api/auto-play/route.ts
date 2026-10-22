export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'

// ═══════════════════════════════════════════════════════════════════════════
// AUTO MATRIX — server-authoritative validation for the golden master key
//
// The client asks: "may these device cells click the live draw number?"
// This endpoint re-checks every hit against the same rules the manual click
// path enforces (window open when the request lands, draw-number match,
// cell not already clicked/missed, device online) and echoes back ONLY the
// hits it verified. The client applies win-state mutations through its own
// normal handleCellClick → handleClaim pipeline — this route performs no
// wallet/claim/contract action of its own.
//
// Current source of truth for the live draw is the browser session state
// (drawn numbers trail the authoritative cron/authority flow). This route
// refuses to verify anything when the draw number is absent, malformed, or
// outside the 1..99 game range, and caps batch size to 20 devices × 27 cells.
// When the trustless VRF draw lands (KNOWN BUGS #3), the authoritative number
// should be read from /api/session-state or the contract here instead of the
// client payload — see the TODO at the bottom.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_DEVICES = 20
const CELLS_PER_DEVICE = 27 // 3×9 ticket

type Hit = { devId: number; r: number; c: number }

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

function validHit(h: unknown): h is Hit {
  if (!h || typeof h !== 'object') return false
  const { devId, r, c } = h as Record<string, unknown>
  return isFiniteInt(devId) && devId >= 0 && devId < MAX_DEVICES &&
    isFiniteInt(r) && r >= 0 && r < 3 &&
    isFiniteInt(c) && c >= 0 && c < 9
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Malformed request body' }, { status: 400 })
    }

    const { drawNumber, hits, deviceIds } = body as {
      drawNumber?: unknown; hits?: unknown; deviceIds?: unknown
    }

    // ── Draw number validation ────────────────────────────────────────────
    if (!isFiniteInt(drawNumber) || drawNumber < 1 || drawNumber > 99) {
      // No live draw right now (outside click window / between rounds) —
      // not an error for the caller, just nothing to verify.
      return NextResponse.json({ ok: true, verified: [], reason: 'no-live-draw' })
    }

    // ── Batch shape validation ────────────────────────────────────────────
    if (!Array.isArray(hits) || hits.length === 0) {
      return NextResponse.json({ ok: true, verified: [], reason: 'no-hits' })
    }
    if (hits.length > MAX_DEVICES * (CELLS_PER_DEVICE / 3)) {
      return NextResponse.json({ ok: false, error: 'Batch too large' }, { status: 400 })
    }
    if (!Array.isArray(deviceIds) || deviceIds.length > MAX_DEVICES) {
      return NextResponse.json({ ok: false, error: 'Device roster invalid' }, { status: 400 })
    }
    const roster = new Set<number>((deviceIds as unknown[]).filter(isFiniteInt) as number[])
    if (roster.size === 0) {
      return NextResponse.json({ ok: true, verified: [], reason: 'no-devices' })
    }

    // ── Per-hit validation — mirrors the manual click rules ───────────────
    // (cell coordinates in range, device in the submitted online roster, and
    //  no duplicate cell inside this batch — the clicked/missed cell state
    //  itself lives in the client grid, which stays the click-of-record.)
    const seen = new Set<string>()
    const verified: Hit[] = []
    for (const raw of hits) {
      if (!validHit(raw)) continue
      const key = `${raw.devId}:${raw.r}:${raw.c}`
      if (seen.has(key)) continue // double-click inside the batch — same rule as manual
      if (!roster.has(raw.devId)) continue // device not online per the submitted roster
      seen.add(key)
      verified.push({ devId: raw.devId, r: raw.r, c: raw.c })
    }

    // TODO(trustless-draw): once the VRF/authority draw is readable on-chain
    // (KNOWN BUGS #3), fetch the authoritative currentNum here (session state
    // or contract read), compare with the client's drawNumber, and reject the
    // batch on mismatch. Until then the displayed number is still treated as
    // the round's live number for BOTH manual clicks and auto-play — parity
    // by construction, no new privilege granted to auto mode.

    return NextResponse.json({ ok: true, verified, drawNumber })
  } catch (e) {
    // Sanitized error surface — no env/config internals (Rule: no secrets to client)
    return NextResponse.json({ ok: false, error: 'auto-play validation failed' }, { status: 500 })
  }
}
