// Orderly Network — omnichain orderbook perps (EVM + Solana), self-custodial.
// Builder revenue: graduate a broker ID (one-time $10) and set your own fee
// rates on top of Orderly's base fee; you keep 100% of the custom fee. No
// 100 USDC minimum. Market data is public (zero auth) at api.orderly.org.
//
// https://api.orderly.org  (mainnet)  |  https://testnet-api.orderly.org

export const ORDERLY_BASE = 'https://api.orderly.org';

type RawMarket = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Strip "PERP_" prefix and "_USDC..." suffix → base token symbol. */
function baseToken(symbol: string): string {
  let s = symbol.toUpperCase();
  if (s.startsWith('PERP_')) s = s.slice(5);
  const idx = s.indexOf('_USDC');
  if (idx >= 0) s = s.slice(0, idx);
  return s;
}

const INDEX = new Set(['SP500', 'XYZ100', 'JP225', 'US500', 'NAS100', 'DE40', 'UK100', 'HK50', '1000SHIB', '1000BONK']);
const STOCK = new Set(['TSLA', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'INTC', 'COIN', 'MSTR', 'PLTR', 'ORCL', 'NFLX', 'BABA', 'AAOI', 'TSM', 'AVGO']);
const COMMODITY = new Set(['CL', 'BRENTOIL', 'GOLD', 'SILVER', 'NATGAS', 'COPPER', 'WTI', 'PLATINUM']);
const FX = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']);

function kindFor(base: string): import('./perps').PerpKind {
  if (INDEX.has(base)) return 'index';
  if (STOCK.has(base)) return 'stock';
  if (COMMODITY.has(base)) return 'commodity';
  if (FX.has(base)) return 'fx';
  return 'crypto';
}

export function normalizeOrderlyMarket(raw: RawMarket): import('./perps').PerpMarket | null {
  const symbol = str(raw.symbol);
  if (!symbol) return null;
  const base = baseToken(symbol);
  if (!base) return null;
  const mark = num(raw.mark_price);
  if (!Number.isFinite(mark) || mark <= 0) return null;
  const open = num(raw['24h_open']);
  const close = num(raw['24h_close']);
  const high = num(raw['24h_high']);
  const low = num(raw['24h_low']);
  const oi = num(raw.open_interest);
  const vol = num(raw['24h_amount']);
  const funding = num(raw.est_funding_rate ?? raw.last_funding_rate);
  const maxLeverage = Math.max(1, num(raw.max_leverage) || 10);
  const coin = base;
  const prevDay = open > 0 ? open : mark;
  const index = num(raw.index_price) || mark;

  return {
    coin,
    display: coin,
    dex: null,
    szDecimals: 2,
    maxLeverage,
    mark,
    oracle: index,
    prevDay,
    change24h: prevDay > 0 ? ((mark - prevDay) / prevDay) * 100 : 0,
    funding,
    openInterestUsd: oi * mark,
    dayVolumeUsd: vol,
    kind: kindFor(base),
  };
}

export function normalizeOrderlyMarkets(raw: unknown): import('./perps').PerpMarket[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.markets)) list = o.markets;
    else if (Array.isArray(o.data)) list = o.data;
    else if (o.data && typeof o.data === 'object' && Array.isArray((o.data as any).markets)) {
      list = (o.data as any).markets;
    }
  }
  const out: import('./perps').PerpMarket[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const n = normalizeOrderlyMarket(m as RawMarket);
    if (n) out.push(n);
  }
  return out;
}

/** Server-side: fetch market summary from Orderly (no auth). */
export async function fetchOrderlyMarkets(): Promise<import('./perps').PerpMarket[] | null> {
  try {
    const res = await fetch(`${ORDERLY_BASE}/v1/public/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'marketSummary' }),
      next: { revalidate: 8 },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const markets = normalizeOrderlyMarkets(body);
    return markets.length ? markets : null;
  } catch {
    return null;
  }
}
