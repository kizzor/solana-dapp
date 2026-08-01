export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  registerDevices,
} from '../../../lib/claim-ledger'

// ─── Constants ───────────────────────────────────────────────────────────────
const SESSION_OBJECT_ID = process.env.SESSION_OBJECT_ID
const SUI_NETWORK = (process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet' | 'devnet'
const RPC_URL = `https://fullnode.${SUI_NETWORK}.sui.io:443`

const MAX_DEVICES = 20

function isHex(s: string) { return /^0x[0-9a-fA-F]{64}$/.test(s) }

// ─── POST /api/mint-nft ──────────────────────────────────────────────────────
// Registers the device grids server-side at mint time so claims can be
// verified against a real on-chain mint + the on-chain drawn numbers.
// Body: { wallet, mintDigest, devices: [{ nftId, grid: (number|null)[][] }] }
export async function POST(req: Request) {
  if (!SESSION_OBJECT_ID) {
    return NextResponse.json({ ok: false, error: 'SESSION_OBJECT_ID not set' }, { status: 500 })
  }

  try {
    const body = await req.json()
    const wallet: string = body.wallet || ''
    const mintDigest: string = body.mintDigest || ''
    const devices: { nftId: string; grid: (number | null)[][] }[] = Array.isArray(body.devices) ? body.devices : []

    if (!wallet.startsWith('0x') || wallet.length < 20) {
      return NextResponse.json({ ok: false, error: 'Invalid wallet address' }, { status: 400 })
    }
    if (!isHex(mintDigest)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing mint transaction digest' }, { status: 400 })
    }
    if (devices.length === 0 || devices.length > MAX_DEVICES) {
      return NextResponse.json({ ok: false, error: `devices must be 1-${MAX_DEVICES} entries` }, { status: 400 })
    }
    for (const d of devices) {
      if (!d.nftId || !Array.isArray(d.grid) || d.grid.length !== 3 || d.grid.some((r) => !Array.isArray(r) || r.length !== 9)) {
        return NextResponse.json({ ok: false, error: 'Each device needs a 3x9 grid' }, { status: 400 })
      }
    }

    const sui = new SuiGrpcClient({ network: SUI_NETWORK, baseUrl: RPC_URL })

    // ── Anti-cheat: verify the mint digest really came from this wallet ──
    // Reads the on-chain tx. Requirements:
    //   • the digest must EXIST on-chain (rejects fabricated digests)
    //   • the tx must have succeeded
    //   • the sender must match the wallet (when the shape is parseable)
    let verified = false
    let senderFound = ''
    try {
      const tx: any = await sui.getTransaction({
        digest: mintDigest,
        include: { transaction: true, effects: true },
      })
      const tr = tx?.Transaction ?? tx?.transaction ?? tx
      const proto = tx?.protoJson ?? {}
      senderFound = String(
        tr?.transaction?.data?.sender ??
        proto?.transaction?.data?.sender ??
        tr?.transaction?.sender ??
        tr?.data?.sender ??
        ''
      ).toLowerCase()
      const status =
        tr?.effects?.status?.status ??
        proto?.effects?.status?.status ??
        tr?.effects?.status ??
        ''
      const success = status === 'success' || status === 'SUCCESS' || status === true
      const raw = JSON.stringify({ tr, proto }).toLowerCase()
      const isMint = raw.includes('heist::mint_device') || raw.includes('mint_device')
      const senderOk =
        senderFound !== ''
          ? senderFound === wallet.toLowerCase()
          : raw.includes(wallet.toLowerCase()) || raw.includes(wallet.toLowerCase().replace('0x', ''))
      const isMainnet = SUI_NETWORK === 'mainnet'
      if (isMainnet) {
        // Mainnet anti-cheat (hard): the digest must be a REAL heist::mint_device
        // tx from THIS wallet. Fabricated digests fail getTransaction; non-mint
        // txs fail the mint_device check; other wallets' txs fail sender match.
        // Sender MUST be parseable + match — no fuzzy raw-JSON fallback, because
        // a different wallet's address could legitimately appear in the tx payload.
        verified = success && isMint && senderFound !== '' && senderFound === wallet.toLowerCase()
      } else {
        // Testnet/devnet (faucet dev testing): hard gate = tx exists + succeeded.
        // mint_device + sender checks are best-effort — proto shapes vary and
        // we must NOT block the user's claim-flow testing here.
        verified = success && (senderFound === '' || senderFound === wallet.toLowerCase())
        if (!isMint) console.warn('[mint-nft dev] mint_device not found in raw tx JSON — proceeding (best-effort on testnet)')
      }
    } catch (e: any) {
      console.error('Mint digest verification failed (digest may not exist):', e?.message)
      verified = false
    }

    if (!verified) {
      return NextResponse.json({
        ok: false,
        error: `Mint digest ${mintDigest.slice(0, 10)}… was not verified on-chain for ${wallet.slice(0, 10)}…`,
      }, { status: 400 })
    }

    // ── Register grids in the server-side ledger ──────────────────────────
    registerDevices(wallet, devices)

    return NextResponse.json({ ok: true, registered: devices.length, wallet })
  } catch (e: any) {
    console.error('Mint-nft registration error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Registration failed' }, { status: 500 })
  }
}
