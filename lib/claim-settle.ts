// ═══════════════════════════════════════════════════════════════════════════
// Round-boundary settlement executor — shared by /api/settle-claims (manual
// cron) and /api/draw (auto-settle at each 59-min round boundary).
//
// For every win type not yet claimed on-chain:
//   • has pending claimers → pay them via claim_win_split
//   • no claimers          → sweep the win type's share to the treasury
// Pending claims are only dropped from the ledger AFTER the on-chain tx
// succeeds (failed txs keep the claims for the next attempt).
// ═══════════════════════════════════════════════════════════════════════════

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { getAllPendingClaims, clearPending, resetRound, getFirstUnclaimedFh } from './claim-ledger'

export function getAuthorityKeypair(): Ed25519Keypair {
  const privKey = process.env.SUI_PRIVATE_KEY
  if (privKey) {
    // Prefer decodeSuiPrivateKey — accepts the `suiprivkey` bech32 format (same
    // parser as the confidential scripts) AND legacy 128-hex / base64.
    try {
      const { secretKey } = decodeSuiPrivateKey(privKey)
      return Ed25519Keypair.fromSecretKey(secretKey)
    } catch {}
    if (/^[0-9a-fA-F]{128}$/.test(privKey)) {
      return Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(privKey, 'hex')))
    }
    try {
      return Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(privKey, 'base64')))
    } catch {}
  }
  throw new Error('No SUI authority keypair found. Set SUI_PRIVATE_KEY env var.')
}

export async function executeSettlement(sui: SuiGrpcClient, programId: string, sessionId: string) {
  const keypair = getAuthorityKeypair()
  const senderAddr = keypair.toSuiAddress()

  const sessionObj = await sui.getObject({ objectId: sessionId, include: { json: true } })
  if (!sessionObj.object || !sessionObj.object.json) {
    return { ok: false, error: 'Session object not found', results: [] }
  }
  const fields = sessionObj.object.json as any
  const winsClaimed: boolean[] = Array.isArray(fields.wins_claimed)
    ? fields.wins_claimed.map((b: any) => Boolean(b))
    : Array(7).fill(false)
  // Only the FIRST unclaimed FULL HOUSE tier may settle/sweep this round.
  // Future FH tiers stay in the vault so FH1→FH2→FH3 progress across rounds;
  // sweeping them now (they have no claimers because they aren't claimable
  // yet) would flip wins_claimed and kill the jackpots for the session.
  const firstUnclaimedFh = getFirstUnclaimedFh(winsClaimed)
  const treasury: string = fields.treasury || ''

  const pending = getAllPendingClaims()
  const results: any[] = []

  for (let wt = 0; wt < 7; wt++) {
    if (winsClaimed[wt]) continue // already settled on-chain

    const claimers = pending.get(wt) || []
    // FH tiers above the live tier: DON'T sweep them (not claimable yet —
    // sweeping would flip wins_claimed and kill FH2/FH3 for the session).
    // But DO still pay them if a wallet legitimately claimed FH1→FH2→FH3
    // in the same round (canClaimFullHouse allows the cascade).
    if (wt >= 4 && wt <= 6 && firstUnclaimedFh !== null && wt > firstUnclaimedFh && claimers.length === 0) continue

    // If nobody claimed this win type, sweep its share to the treasury.
    const winners = claimers.length > 0 ? claimers : treasury ? [treasury] : []
    if (winners.length === 0) continue

    const txb = new Transaction()
    txb.setSender(senderAddr)
    txb.moveCall({
      target: `${programId}::heist::claim_win_split`,
      arguments: [txb.object(sessionId), txb.pure.vector('address', winners), txb.pure.u8(wt)],
    })
    txb.setGasBudget(10_000_000)
    txb.setGasPayment([])

    try {
      const result: any = await sui.signAndExecuteTransaction({
        transaction: txb,
        signer: keypair,
        include: { effects: true, objectTypes: true },
      })
      const txResult = result.Transaction ?? result.FailedTransaction
      const ok = result.$kind === 'Transaction'
      if (ok) clearPending(wt) // only drop claims after on-chain success
      results.push({
        winType: wt,
        winners: winners.length,
        swept: claimers.length === 0,
        ok,
        digest: txResult?.digest,
        error: ok ? undefined : txResult?.effects?.status?.error?.message,
      })
    } catch (e: any) {
      results.push({
        winType: wt,
        winners: winners.length,
        swept: claimers.length === 0,
        ok: false,
        error: e?.message,
      })
    }
  }

  // ── Round boundary: start the new round fresh ──────────────────────────
  // Runs AFTER the on-chain txs so a mid-round manual settle (testnet DEV ⏭
  // button) doesn't wipe the per-round dedupe while claims are still possible.
  // On-chain wins_claimed is the real exhaustion authority, so clearing the
  // per-round dedupe + rate map is safe — wallets can claim the same win type
  // again in the next round.
  resetRound()

  return { ok: true, results, ts: Date.now() }
}
