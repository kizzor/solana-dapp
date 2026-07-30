export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

// ─── Constants ───────────────────────────────────────────────────────────────
// These are placeholders — user will provide actual addresses
const MTRX_CONTRACT_ADDRESS = process.env.MTRX_CONTRACT_ADDRESS || 'MTRX_PLACEHOLDER_ADDRESS'
const MTRX_DELEGATION_VAULT = process.env.MTRX_DELEGATION_VAULT || 'VAULT_PLACEHOLDER_ADDRESS'
const MTRX_DECIMALS = 9  // Solana SPL token standard (adjust if different)
const MTRX_DELEGATION_THRESHOLD = 1000
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

// ─── Cache delegation status (in-memory, resets on cold start) ──────────────
// In production, replace with a database or external indexer
const delegationCache = new Map<string, { delegated: boolean; balance: number; checkedAt: number }>()
const CACHE_TTL_MS = 60_000 // 1 minute

function getConnection(): Connection {
  return new Connection(SOLANA_RPC, 'confirmed')
}

/**
 * Check if a Solana wallet has delegated >= 1,000 MTRX to the vault.
 * "Delegation" means the wallet holds MTRX tokens in their wallet.
 * For a stricter check (actual transfer to vault), we'd use an indexer.
 *
 * For production: replace this with an on-chain program or subgraph query
 * that tracks actual MTRX transfers to the vault address.
 */
async function checkDelegation(solanaAddress: string): Promise<{
  delegated: boolean
  balance: number
  threshold: number
  vault: string
  tokenMint: string
}> {
  // Check cache first
  const cached = delegationCache.get(solanaAddress)
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return {
      delegated: cached.delegated,
      balance: cached.balance,
      threshold: MTRX_DELEGATION_THRESHOLD,
      vault: MTRX_DELEGATION_VAULT,
      tokenMint: MTRX_CONTRACT_ADDRESS,
    }
  }

  try {
    const connection = getConnection()
    const ownerPubkey = new PublicKey(solanaAddress)
    const mintPubkey = new PublicKey(MTRX_CONTRACT_ADDRESS)

    // Get the associated token account for this wallet + mint
    const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey)

    // Check if the token account exists and has balance
    const tokenAccountInfo = await connection.getTokenAccountBalance(ata)
    const rawBalance = Number(tokenAccountInfo.value.amount)
    // Convert to human-readable with decimals
    const humanBalance = rawBalance / Math.pow(10, MTRX_DECIMALS)
    const delegated = humanBalance >= MTRX_DELEGATION_THRESHOLD

    // Cache result
    delegationCache.set(solanaAddress, {
      delegated,
      balance: humanBalance,
      checkedAt: Date.now(),
    })

    return {
      delegated,
      balance: humanBalance,
      threshold: MTRX_DELEGATION_THRESHOLD,
      vault: MTRX_DELEGATION_VAULT,
      tokenMint: MTRX_CONTRACT_ADDRESS,
    }
  } catch (e: any) {
    // Token account may not exist — wallet doesn't hold MTRX
    if (e.message?.includes('could not find') || e.message?.includes('not found')) {
      delegationCache.set(solanaAddress, {
        delegated: false,
        balance: 0,
        checkedAt: Date.now(),
      })
      return {
        delegated: false,
        balance: 0,
        threshold: MTRX_DELEGATION_THRESHOLD,
        vault: MTRX_DELEGATION_VAULT,
        tokenMint: MTRX_CONTRACT_ADDRESS,
      }
    }
    throw e
  }
}

/**
 * GET /api/check-mtrx-delegation?address=<SOLANA_ADDRESS>
 * Returns whether the wallet has delegated 1k+ MTRX
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const address = searchParams.get('address')

    if (!address || typeof address !== 'string' || address.length < 32) {
      return NextResponse.json({ ok: false, error: 'Invalid Solana address' }, { status: 400 })
    }

    // Validate it looks like a Solana address
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return NextResponse.json({ ok: false, error: 'Invalid Solana address format' }, { status: 400 })
    }

    const result = await checkDelegation(address)

    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    console.error('MTRX delegation check error:', e.message)
    return NextResponse.json({ ok: false, error: e.message || 'Check failed' }, { status: 500 })
  }
}

/**
 * POST /api/check-mtrx-delegation
 * Same as GET but accepts JSON body
 */
export async function POST(req: Request) {
  try {
    const { address } = await req.json()

    if (!address || typeof address !== 'string' || address.length < 32) {
      return NextResponse.json({ ok: false, error: 'Invalid Solana address' }, { status: 400 })
    }

    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return NextResponse.json({ ok: false, error: 'Invalid Solana address format' }, { status: 400 })
    }

    const result = await checkDelegation(address)

    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    console.error('MTRX delegation check error:', e.message)
    return NextResponse.json({ ok: false, error: e.message || 'Check failed' }, { status: 500 })
  }
}
