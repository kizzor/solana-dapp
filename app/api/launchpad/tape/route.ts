import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { getTapes } from '@/lib/launchpad-tape'

export const dynamic = 'force-dynamic'

/**
 * GET /api/launchpad/tape?curves=0xabc,0xdef
 * Returns { byCurve: { [curve.toLowerCase()]: TapeSummary } }.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('curves') ?? ''
  const curves = raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => isAddress(c))
    .slice(0, 24)

  if (curves.length === 0) {
    return NextResponse.json({ byCurve: {} })
  }

  try {
    const byCurve = await getTapes(curves)
    return NextResponse.json(
      { byCurve },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (e) {
    return NextResponse.json(
      { byCurve: {}, error: e instanceof Error ? e.message : 'tape unavailable' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  }
}
