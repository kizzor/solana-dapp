export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'

/**
 * @deprecated Solana dead route — claim_win was handled by the Solana program.
 * On SUI mainnet, claims are handled by /api/claim-sui which signs
 * claim_win_split on the SUI Move contract with the authority key.
 * This route is preserved for reference only.
 */
export async function POST(req: Request) {
  return NextResponse.json({
    ok: false,
    error: 'Claims are handled on-chain via /api/claim-sui. This Solana route is deprecated.',
    migrated: true,
  }, { status: 410 })
}
