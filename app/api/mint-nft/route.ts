export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  registerDevices,
  isValidGrid,
} from '../../../lib/claim-ledger'
import {
  coinKeyOf,
  fetchSuiPriceUsd,
  fetchHeistPriceUsd,
  fetchHeistPriceUsdLive,
  fullRawForCoin,
  mtrxRawForCoin,
} from '../../../lib/heist-prices'

// ─── Constants ───────────────────────────────────────────────────────────────
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_PROGRAM_ID = process.env.SUI_PROGRAM_ID || ''
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
// Public fullnode by default; SUI_RPC_URL env overrides (dedicated provider
// avoids stale-read issues on the shared public endpoint from Vercel egress).
const RPC_URL = process.env.SUI_RPC_URL || `https://fullnode.${SUI_NETWORK}.sui.io:443`

const MAX_DEVICES = 20
// v5: the mint is $0.50 USD in ANY registered coin (SUI/USDC/USDT/HEIST);
// $0.25 with MTRX delegation. HEIST has a FLOATABLE price — the mint cost in
// HEIST follows HEIST_PRICE_USD (e.g. 250 HEIST at $0.002). The contract
// validates against the on-chain price table (HeistAdmin); THIS route
// re-validates against the same economics (live SUI price + configured HEIST
// price) and enforces the MTRX discount (the contract cannot read Solana
// MTRX) — fails closed on any mismatch.
const MTRX_THRESHOLD = 1000
const MTRX_CONTRACT_ADDRESS = process.env.MTRX_CONTRACT_ADDRESS || 'MTRX_PLACEHOLDER_ADDRESS'
const MTRX_DECIMALS = 9
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
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

// v4: verify a wallet holds >= MTRX_THRESHOLD MTRX on Solana. If MTRX env
// vars are unset (placeholders), verification FAILS CLOSED so nobody can
// claim the discount against a non-existent token.
async function hasMtrx(solAddress: string): Promise<boolean> {
  if (!solAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solAddress)) return false
  if (MTRX_CONTRACT_ADDRESS.startsWith('MTRX_PLACEHOLDER')) return false
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress } = await import('@solana/spl-token')
    const conn = new Connection(SOLANA_RPC, 'confirmed')
    const ata = await getAssociatedTokenAddress(new PublicKey(MTRX_CONTRACT_ADDRESS), new PublicKey(solAddress))
    const bal = await conn.getTokenAccountBalance(ata)
    return Number(bal.value.amount) / Math.pow(10, MTRX_DECIMALS) >= MTRX_THRESHOLD
  } catch (e) {
    console.error('[mint-nft] MTRX check failed:', e?.message)
    return false
  }
}

// Extract payment details from the mint tx events (DeviceMinted).
// v5 event carries: amount_paid (HEIST tier), payment_value (raw units of the
// paid coin), discounted (MTRX tier flag), coin (the coin type string used).
function extractPaymentDetails(tr: any, proto: any): {
  amountPaid: number | null
  paymentValue: number | null
  discounted: boolean
  coin: string
} {
  const events = tr?.events ?? proto?.effects?.events ?? []
  for (const ev of events) {
    const t = String(ev?.type || ev?.typeName || '')
    if (!t.endsWith('::heist::DeviceMinted')) continue
    const f = ev?.parsedJson ?? ev?.parsed ?? {}
    const amountPaid = Number(f?.amount_paid)
    const paymentValue = Number(f?.payment_value)
    return {
      amountPaid: Number.isFinite(amountPaid) && amountPaid > 0 ? amountPaid : null,
      paymentValue: Number.isFinite(paymentValue) && paymentValue > 0 ? paymentValue : null,
      discounted: f?.discounted === true,
      coin: String(f?.coin || ''),
    }
  }
  return { amountPaid: null, paymentValue: null, discounted: false, coin: '' }
}

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
    const solAddress: string = body.solAddress || ''
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

    // ── v5 anti-cheat: enforce the $0.50/$0.25 USD payment in ANY coin ──
    const { amountPaid, paymentValue, discounted, coin } = extractPaymentDetails(tr, proto)
    if (amountPaid === null || amountPaid <= 0) {
      return NextResponse.json({ ok: false, error: 'Could not read mint payment amount — retry' }, { status: 400 })
    }

    // The payment coin must be one we accept (SUI/USDC/USDT/HEIST).
    const key = coinKeyOf(coin, SUI_PROGRAM_ID)
    if (!key) {
      return NextResponse.json({ ok: false, error: `Payment coin not accepted: ${coin || 'unknown'}` }, { status: 400 })
    }

    // Expected raw payment in that coin ($0.50, or $0.25 for discounted mints).
    // RULES: HEIST price resolves live-feed → env → placeholder ($0.0001), so
    // it always has a price; real market data flows in automatically once the
    // live feed is configured. Only the SUI entry needs the live SUI price —
    // stables (fixed $1) and HEIST (its own price) stay mintable even if the
    // CoinGecko feed is down.
    let requiredRaw: bigint
    try {
      const heistUsd = (await fetchHeistPriceUsdLive()) ?? fetchHeistPriceUsd()
      if (key === 'SUI') {
        requiredRaw = fullRawForCoin('SUI', await fetchSuiPriceUsd(), heistUsd)
      } else {
        requiredRaw = fullRawForCoin(key, 0, heistUsd)
      }
    } catch {
      const coinName = key === 'SUI' ? 'SUI' : 'HEIST'
      return NextResponse.json({ ok: false, error: `Could not fetch ${coinName} price — retry in a moment` }, { status: 503 })
    }
    const required = discounted ? mtrxRawForCoin(requiredRaw) : requiredRaw
    const pv = BigInt(paymentValue ?? 0)
    // SUI + HEIST payments get a ±3% tolerance (the client pads ~0.5% for SUI
    // and the prices are cron-synced, so a tiny lag after a price change
    // shouldn't reject a valid mint); stables get a small ±0.5% so a rounding
    // overpay (e.g. an exact 500_000 USDC payment that the client split into
    // a slightly larger coin) can't fail registration of an already-accepted
    // on-chain mint.
    // NOTE: the event's amount_paid (on-chain HEIST vault credit) is NOT
    // cross-checked against the server's current HEIST price — it is a
    // point-in-time credit from the on-chain table, so a >3% HEIST price move
    // between cron syncs would permanently block registration of an otherwise
    // valid mint (the credit never retroactively changes). The payment check
    // above + the authority-only price table already cover the money path.
    const tolerant = key === 'SUI' || key === 'HEIST'
    const maxAllowed = tolerant ? (required * 103n) / 100n : (required * 1005n) / 1000n
    if (pv < required || pv > maxAllowed) {
      return NextResponse.json({
        ok: false,
        error: `Payment mismatch: paid ${pv} ${key} raw, expected ${required}${tolerant ? ' (±3%)' : ' (±0.5%)'}`,
      }, { status: 400 })
    }

    // MTRX discount gate — the contract can't read Solana MTRX, so this route
    // is the gate. Fails closed.
    if (discounted) {
      const okMtrx = await hasMtrx(solAddress)
      if (!okMtrx) {
        return NextResponse.json({ ok: false, error: 'Discounted mint requires 1000+ MTRX — send your Solana MTRX address' }, { status: 403 })
      }
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
