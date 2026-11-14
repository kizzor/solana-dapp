import { NextResponse } from 'next/server';
import { normalizeCandles, normalizeMarkets } from '@/lib/perps';

export const dynamic = 'force-dynamic';

const INFO_URL = 'https://api.hyperliquid.xyz/info';

/**
 * A thin read-only proxy to Hyperliquid's public `info` endpoint (§6.30).
 *
 * The venue is a front end's data source, not its backend: the browser cannot
 * POST there directly (no CORS grant), and caching here keeps a 235-market
 * payload off every poll. Order placement is NOT proxied — that would need a
 * signed L1 action with an approved agent wallet, and this route holds no keys.
 *
 *   GET /api/perps                     → { live, at, markets }
 *   GET /api/perps?coin=BTC&interval=1h&hours=24 → { live, at, candles }
 */

async function hl(body: unknown): Promise<unknown> {
  const res = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // the venue updates continuously; a few seconds of staleness is free
    next: { revalidate: 8 },
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  return res.json();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const coin = url.searchParams.get('coin');

  try {
    if (coin) {
      const interval = url.searchParams.get('interval') || '1h';
      const hours = Math.max(1, Math.min(720, Number(url.searchParams.get('hours')) || 24));
      const endTime = Date.now();
      const startTime = endTime - hours * 3_600_000;
      const raw = await hl({
        type: 'candleSnapshot',
        req: { coin, interval, startTime, endTime },
      });
      const candles = normalizeCandles(raw);
      if (!candles.length) throw new Error('No candles for that market');
      return NextResponse.json({ live: true, at: endTime, candles });
    }

    const raw = await hl({ type: 'metaAndAssetCtxs' });
    const markets = normalizeMarkets(raw);
    if (!markets.length) throw new Error('Empty universe');
    return NextResponse.json({ live: true, at: Date.now(), markets });
  } catch (err) {
    return NextResponse.json(
      { live: false, at: Date.now(), error: err instanceof Error ? err.message : 'Hyperliquid unreachable' },
      { status: 502 },
    );
  }
}
