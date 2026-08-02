export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  registerDevices,
  isValidGrid,
} from '../../../lib/claim-ledger'

// ─── Constants ───────────────────────────────────────────────────────────────
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
const RPC_URL = `https://fullnode.${SUI_NETWORK}.sui.io:443`

const MAX_DEVICES = 20
// Anti-cheat: registration must happen shortly after the mint tx. A grid can
// only be crafted against numbers drawn BEFORE the mint — the window prevents
// "mint now, wait for future draws, then register a winning grid".
const REG_WINDOW_MS = Number(process.env.MINT_REGISTRATION_WINDOW_MS || 10 * 60 * 1000)

// Light per-mint rate limiter keyed on wallet:mintDigest. Keying on the digest
// (not just the wallet) means a legit user minting twice in quick succession
// (two txs) is NOT blocked — each mint registers once. Re-registering the SAME
// digest is what gets deduped. The mark is placed BEFORE validation (unlike
// /api/claim-sui's after-execution pattern) because this endpoint's cost is
// fullnode RPC calls on every attempt — we want to stop repeated spam of the
// same digest from burning RPC quota. The 10-min mint window is the real
// anti-cheat gate; this limiter is secondary.
const regRate = new Map<string, number>()
const REG_RATE_MS = 10_000
setInterval(() => {
  const now = Date.now()
  for (const [k, t] of regRate) if (now - t > 60_000) regRate.delete(k)
}, 60_000)

function isHex(s: string) { return /^0x[0-9a-fA-F]{64}$/.test(s) }
function normAddr(s: string) { return (s || '').toLowerCase() }

// Convert an on-chain grid (3×9 of u8, 0 = empty) to the ledger's (number|null)[][].
// Accepts numbers or numeric strings (u8/u64 may serialize either way).
function onChainGridToCells(grid: unknown): (number | null)[][] {
  if (!Array.isArray(grid) || grid.length !== 3) return []
  return grid.map((row: any) => {
    if (!Array.isArray(row) || row.length !== 9) return []
    return row.map((v: any) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= 1 && n <= 90 ? n : null
    })
  })
}

// Parse the mint tx timestamp from the raw proto JSON. google.protobuf.Timestamp
// serializes as an RFC3339 string ("2026-08-02T12:34:56.789Z") or { seconds, nanos }.
function parseMintTimestampMs(protoJson: any): number | null {
  const t = protoJson?.timestamp
  if (!t) return null
  if (typeof t === 'string') {
    const ms = Date.parse(t)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof t === 'object') {
    const s = Number(t.seconds)
    if (Number.isFinite(s)) return s * 1000 + Math.floor((Number(t.nanos) || 0) / 1e6)
  }
  return null
}

// ─── POST /api/mint-nft ──────────────────────────────────────────────────────
// Registers the device grids server-side so claims can be verified against a
// real on-chain mint + the on-chain drawn numbers.
//
// Body: { wallet, mintDigest, devices: [{ grid }] }
//
// Anti-cheat (grid-spoofing fix):
//   1. The mint digest must exist on-chain, be a successful heist::mint_device
//      tx, and come from the submitting wallet.
//   2. The number of submitted devices must EXACTLY equal the number of
//      heist::Device objects CREATED by that mint tx. (One real mint cannot be
//      stretched into 20 fabricated grids.)
//   3. Each on-chain grid is validated for the strict 3×9 bingo shape (exactly
//      15 numbers, 5 per row, unique, 1-90) — kills the empty-row LINE exploit.
//   4. Registration must happen within REG_WINDOW_MS of the mint tx (verified
//      against the on-chain tx timestamp, not the client clock).
//   5. v2 contract ONLY: the on-chain Device object's OWN grid is used as the
//      authoritative ticket. There is NO client-grid fallback — on the current
//      deployed v1 contract (no on-chain grid) registration is rejected with a
//      "republish required" error. The client cannot craft a grid after mint.
export async function POST(req: Request) {
  if (!SESSION_OBJECT_ID) {
    return NextResponse.json({ ok: false, error: 'SESSION_OBJECT_ID not set' }, { status: 500 })
  }

  try {
    const body = await req.json()
    const walletRaw: string = body.wallet || ''
    const wallet = normAddr(walletRaw)
    const mintDigest: string = body.mintDigest || ''
    const devices: { grid: unknown }[] = Array.isArray(body.devices) ? body.devices : []

    if (!wallet.startsWith('0x') || wallet.length < 20) {
      return NextResponse.json({ ok: false, error: 'Invalid wallet address' }, { status: 400 })
    }
    const rateKey = `${wallet}:${mintDigest}`
    const lastReg = regRate.get(rateKey)
    if (lastReg && Date.now() - lastReg < REG_RATE_MS) {
      return NextResponse.json({ ok: false, error: 'Registration rate limited — try again shortly' }, { status: 429 })
    }
    regRate.set(rateKey, Date.now())
    if (!isHex(mintDigest)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing mint transaction digest' }, { status: 400 })
    }
    if (devices.length === 0 || devices.length > MAX_DEVICES) {
      return NextResponse.json({ ok: false, error: `devices must be 1-${MAX_DEVICES} entries` }, { status: 400 })
    }

    const sui = new SuiGrpcClient({ network: SUI_NETWORK, baseUrl: RPC_URL })

    // ── 1) Fetch + verify the mint tx ──────────────────────────────────────
    let tx: any
    try {
      tx = await sui.getTransaction({
        digest: mintDigest,
        include: { transaction: true, effects: true, objectTypes: true, protoJson: true },
      })
    } catch (e: any) {
      return NextResponse.json({
        ok: false,
        error: `Mint digest ${mintDigest.slice(0, 10)}… not found on-chain`,
      }, { status: 400 })
    }
    const tr = tx?.Transaction ?? tx?.transaction ?? tx
    const proto = tx?.protoJson ?? {}
    const status =
      tr?.effects?.status?.success ?? tr?.effects?.status?.status ?? ''
    const success = status === true || status === 'success' || status === 'SUCCESS'
    const sender = normAddr(
      tr?.transaction?.sender ??
      proto?.transaction?.data?.sender ??
      tr?.transaction?.data?.sender ??
      tr?.data?.sender ??
      ''
    )
    const raw = JSON.stringify({ tr, proto }).toLowerCase()
    const isMint = raw.includes('heist::mint_device') || raw.includes('mint_device')

    if (!success) {
      return NextResponse.json({ ok: false, error: 'Mint transaction did not succeed' }, { status: 400 })
    }
    if (!isMint) {
      return NextResponse.json({ ok: false, error: 'Digest is not a heist::mint_device transaction' }, { status: 400 })
    }
    if (!sender || sender !== wallet) {
      return NextResponse.json({ ok: false, error: `Mint sender ${sender.slice(0, 10)}… does not match wallet` }, { status: 400 })
    }

    // ── 2) Anti-cheat: extract the REAL created Device object IDs ──────────
    // Only objects whose type is `::heist::Device` and whose idOperation is
    // Created belong to this mint. Their on-chain IDs are the only valid nftIds.
    const changed: { objectId?: string; idOperation?: string | null }[] =
      tr?.effects?.changedObjects ?? []
    const objectTypes: Record<string, string> = tr?.objectTypes ?? {}
    const createdDeviceIds = changed
      .filter((c) => c?.idOperation === 'Created')
      .map((c) => normAddr(c?.objectId || ''))
      .filter((id) => id && (objectTypes[id] || '').endsWith('::heist::Device'))

    // ProtoJson fallback for created objects (raw proto uses changed_objects)
    if (createdDeviceIds.length === 0) {
      const pc: { objectId?: string; objectType?: string }[] =
        proto?.effects?.changedObjects ?? proto?.effects?.created ?? []
      for (const c of pc) {
        const type = String(c?.objectType || '')
        const id = normAddr(c?.objectId || '')
        if (type.endsWith('::heist::Device') && id) createdDeviceIds.push(id)
      }
    }

    // Exactly one registered grid per real on-chain Device — kills the
    // "1 mint → 20 fabricated grids" exploit.
    if (createdDeviceIds.length !== devices.length) {
      return NextResponse.json({
        ok: false,
        error: `Mint created ${createdDeviceIds.length} device(s) but ${devices.length} submitted — one grid per real device`,
      }, { status: 400 })
    }

    // ── 3) Anti-cheat: registration must be shortly after the mint ─────────
    // Uses the ON-CHAIN tx timestamp (not the client's clock).
    const mintMs = parseMintTimestampMs(proto)
    if (mintMs == null) {
      return NextResponse.json({
        ok: false,
        error: 'Could not determine mint timestamp — retry registration now',
      }, { status: 400 })
    }
    if (Date.now() - mintMs > REG_WINDOW_MS) {
      return NextResponse.json({
        ok: false,
        error: `Registration too late — must be within ${Math.round(REG_WINDOW_MS / 60000)} min of mint`,
      }, { status: 400 })
    }

    // ── 4) Read the on-chain Device objects (authoritative grids) ──────────
    // v2 contract ONLY: Device.grid holds the on-chain generated ticket and is
    // the authoritative source. There is NO client-grid fallback — accepting a
    // client-supplied grid on the v1 contract would keep the spoofing hole open
    // until republish. If the object has no grid, registration is REJECTED.
    let objs: any
    try {
      objs = await sui.getObjects({ objectIds: createdDeviceIds, include: { json: true } })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `Failed to read created devices: ${e.message}` }, { status: 500 })
    }

    const registered: { nftId: string; grid: (number | null)[][] }[] = []
    for (let i = 0; i < createdDeviceIds.length; i++) {
      const id = createdDeviceIds[i]
      const obj = objs?.objects?.[i]
      const json = (obj instanceof Error) ? null : (obj?.json as any)

      // Fail closed: a missing/unreadable object or one without an on-chain
      // grid means this is a v1 mint or a read failure — reject rather than
      // fall back to any client-supplied data.
      if (!json || !Array.isArray(json.grid)) {
        return NextResponse.json({
          ok: false,
          error: `Device ${id.slice(0, 10)}… has no on-chain grid — this contract version must be republished (grid is generated on-chain in v2)`,
        }, { status: 400 })
      }

      const grid = onChainGridToCells(json.grid)
      const deviceSession = normAddr(String(json.session_id || ''))
      if (deviceSession && deviceSession !== normAddr(SESSION_OBJECT_ID)) {
        return NextResponse.json({ ok: false, error: `Device ${id.slice(0, 10)}… belongs to a different session` }, { status: 400 })
      }

      if (!isValidGrid(grid)) {
        return NextResponse.json({
          ok: false,
          error: `Invalid grid for device ${id.slice(0, 10)}… — must be 3×9, 15 numbers, 5 per row, unique 1-90`,
        }, { status: 400 })
      }
      registered.push({ nftId: id, grid })
    }

    // ── 5) Register grids in the server-side ledger ────────────────────────
    registerDevices(wallet, registered)

    return NextResponse.json({
      ok: true,
      registered: registered.length,
      wallet,
      // Return the authoritative devices so the frontend can display the real
      // on-chain tickets (they may differ from the client's pre-mint preview).
      devices: registered.map((d) => ({ objectId: d.nftId, grid: d.grid })),
    })
  } catch (e: any) {
    console.error('Mint-nft registration error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Registration failed' }, { status: 500 })
  }
}
