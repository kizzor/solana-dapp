// Hyperliquid perps, read straight from the public info endpoint (§6.30).
//
// This app is a *front end*: matching, margin, funding and liquidations all
// belong to HyperCore. Nothing here places an order — see the note in
// PerpsView about builder approval — but every number on the screen is the
// venue's own: mark, oracle, funding, open interest and 24h volume.

export type PerpKind = 'crypto' | 'stock' | 'commodity' | 'index' | 'fx' | 'other';

export type PerpMarket = {
  /** Hyperliquid's name, e.g. `BTC` or `xyz:SP500`. */
  coin: string;
  /** What we print, e.g. `BTC` or `SP500`. */
  display: string;
  /** HIP-3 dex the market was deployed on, e.g. `xyz` — null on the first dex. */
  dex: string | null;
  szDecimals: number;
  maxLeverage: number;
  mark: number;
  oracle: number;
  prevDay: number;
  change24h: number;
  funding: number;
  openInterestUsd: number;
  dayVolumeUsd: number;
  kind: PerpKind;
};

export type PerpCandle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Taker fee on Hyperliquid perps; the builder surcharge sits on top. */
export const HL_TAKER_FEE = 0.00045;
/** Builder fee we charge on each perp fill (Hyperliquid builder code). Cap is 0.1% (10 bp). */
export const BUILDER_FEE = 0.0005;
/** Assumed maintenance margin for the liquidation estimate. */
const MAINT_MARGIN = 0.005;

const INDEX = new Set(['SP500', 'XYZ100', 'JP225', 'US500', 'NAS100', 'DE40', 'UK100', 'HK50']);
const STOCK = new Set([
  'TSLA', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'INTC', 'COIN', 'MSTR',
  'PLTR', 'ORCL', 'NFLX', 'BABA', 'SPCX', 'SNDK', 'SKHX', 'SKHYNIX', 'HOOD', 'CRCL',
]);
const COMMODITY = new Set(['CL', 'BRENTOIL', 'GOLD', 'SILVER', 'NATGAS', 'COPPER', 'WTI', 'PLATINUM']);
const FX = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']);

export function kindOf(coin: string): PerpKind {
  const base = (coin.includes(':') ? coin.split(':')[1] : coin).toUpperCase();
  if (INDEX.has(base)) return 'index';
  if (STOCK.has(base)) return 'stock';
  if (COMMODITY.has(base)) return 'commodity';
  if (FX.has(base)) return 'fx';
  return coin.includes(':') ? 'other' : 'crypto';
}

export const KIND_LABEL: Record<PerpKind, string> = {
  crypto: 'Crypto',
  stock: 'Stocks',
  commodity: 'Commodities',
  index: 'Indices',
  fx: 'FX',
  other: 'Other',
};

type UniverseItem = { name: string; szDecimals: number; maxLeverage: number };
type AssetCtx = {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  oraclePx?: string;
  markPx?: string;
};

/**
 * `metaAndAssetCtxs` returns `[meta, ctxs]` with the two arrays positionally
 * aligned — the ctx entry carries no coin of its own, so a market only exists
 * when both sides have the same index.
 */
export function normalizeMarkets(raw: unknown): PerpMarket[] {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const meta = raw[0] as { universe?: UniverseItem[] };
  const ctxs = raw[1] as AssetCtx[];
  const universe = meta?.universe ?? [];
  const out: PerpMarket[] = [];

  for (let i = 0; i < universe.length; i++) {
    const u = universe[i];
    const c = ctxs[i];
    if (!u?.name || !c) continue;
    const mark = Number(c.markPx ?? 0);
    const prevDay = Number(c.prevDayPx ?? 0);
    if (!Number.isFinite(mark) || mark <= 0) continue;
    out.push({
      coin: u.name,
      display: u.name.includes(':') ? u.name.split(':')[1] : u.name,
      dex: u.name.includes(':') ? u.name.split(':')[0] : null,
      szDecimals: Number(u.szDecimals ?? 0),
      maxLeverage: Number(u.maxLeverage ?? 1),
      mark,
      oracle: Number(c.oraclePx ?? 0),
      prevDay,
      change24h: prevDay > 0 ? ((mark - prevDay) / prevDay) * 100 : 0,
      funding: Number(c.funding ?? 0),
      openInterestUsd: Number(c.openInterest ?? 0) * mark,
      dayVolumeUsd: Number(c.dayNtlVlm ?? 0),
      kind: kindOf(u.name),
    });
  }
  return out;
}

export function normalizeCandles(raw: unknown): PerpCandle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((k: any) => ({
      t: Number(k?.t ?? 0),
      o: Number(k?.o ?? 0),
      h: Number(k?.h ?? 0),
      l: Number(k?.l ?? 0),
      c: Number(k?.c ?? 0),
      v: Number(k?.v ?? 0),
    }))
    .filter((k) => k.t > 0 && k.c > 0);
}

// ── formatting ───────────────────────────────────────────────────────────────

export function fmtPx(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtUsd(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(dp)}`;
}

export function fmtFunding(n: number): string {
  const pct = n * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
}

/** Hourly funding × 24, the number a trader actually compares. */
export function fundingApr(n: number): string {
  return `${(n * 24 * 365 * 100).toFixed(1)}%`;
}

// ── order maths (the same numbers the ticket shows) ──────────────────────────

export type Side = 'long' | 'short';

export type Ticket = {
  side: Side;
  leverage: number;
  marginUsd: number;
};

export type TicketMath = {
  notional: number;
  qty: number;
  liqPrice: number;
  fee: number;
  feeBuilder: number;
  feeVenue: number;
};

export function ticketMath(t: Ticket, entry: number): TicketMath {
  const leverage = Math.max(1, t.leverage);
  const notional = Math.max(0, t.marginUsd) * leverage;
  const qty = entry > 0 ? notional / entry : 0;
  const move = 1 / leverage - MAINT_MARGIN;
  const liqPrice = entry > 0 ? entry * (t.side === 'long' ? 1 - move : 1 + move) : 0;
  const feeBuilder = notional * BUILDER_FEE;
  const feeVenue = notional * HL_TAKER_FEE;
  return { notional, qty, liqPrice, feeBuilder, feeVenue, fee: feeBuilder + feeVenue };
}

export function positionPnl(
  p: { side: Side; entry: number; notional: number },
  mark: number,
): number {
  if (!(p.entry > 0) || !(mark > 0)) return 0;
  const qty = p.notional / p.entry;
  return (mark - p.entry) * qty * (p.side === 'long' ? 1 : -1);
}

/**
 * Used only when the venue cannot be reached: a clearly-labelled snapshot so
 * the page still renders. Prices are stale by construction and the UI says so.
 */
export const PREVIEW_MARKETS: PerpMarket[] = [
  ['BTC', 74694, 74151, 40, 0.0000125],
  ['ETH', 3120.4, 3088.2, 25, 0.0000094],
  ['SOL', 168.22, 171.9, 20, -0.000021],
  ['HYPE', 41.58, 40.11, 20, 0.0000125],
  ['ZEC', 62.1, 58.4, 10, 0.0000125],
  ['xyz:SP500', 6482.5, 6450.0, 50, 0.0000041],
  ['xyz:TSLA', 412.8, 405.4, 20, 0.0000033],
  ['xyz:CL', 68.42, 69.05, 20, -0.0000042],
].map(([coin, mark, prevDay, maxLeverage, funding]) => {
  const name = String(coin);
  return {
    coin: name,
    display: name.includes(':') ? name.split(':')[1] : name,
    dex: name.includes(':') ? name.split(':')[0] : null,
    szDecimals: 2,
    maxLeverage: Number(maxLeverage),
    mark: Number(mark),
    oracle: Number(mark),
    prevDay: Number(prevDay),
    change24h: ((Number(mark) - Number(prevDay)) / Number(prevDay)) * 100,
    funding: Number(funding),
    openInterestUsd: Number(mark) * 1200,
    dayVolumeUsd: 48_000_000,
    kind: kindOf(name),
  };
});
