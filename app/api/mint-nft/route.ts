export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'

// SUI mainnet - mint is handled client-side via SUI TransactionBlock
export async function POST(req: Request) {
  return NextResponse.json({ ok: false, error: 'Mint is handled client-side on SUI' }, { status: 400 })
}
