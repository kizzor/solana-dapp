import { NextResponse } from 'next/server';
import { fetchOrderlyMarkets } from '@/lib/orderly-perps';

export const dynamic = 'force-dynamic';

/**
 * Orderly Network perps market-data proxy. Public endpoint, no API key needed.
 * Returns the same shape as /api/perps so the UI swaps sources transparently.
 *
 *   GET /api/perps/orderly  → { live, at, markets, source: 'orderly' }
 */
export async function GET() {
  const markets = await fetchOrderlyMarkets();
  if (!markets) {
    return NextResponse.json(
      { live: false, at: Date.now(), error: 'Orderly markets unavailable', source: 'orderly' },
      { status: 502 },
    );
  }
  return NextResponse.json({ live: true, at: Date.now(), markets, source: 'orderly' });
}
