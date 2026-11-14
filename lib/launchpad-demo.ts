/**
 * Launchpad types, formatting and the fallback dataset.
 *
 * ⚠ This module holds NO money logic. When `NEXT_PUBLIC_LAUNCH_FACTORY_ADDRESS`
 * is set, `lib/use-launchpad.ts` reads every coin from `LaunchFactory` and its
 * `LaunchCurve`; the deterministic dataset here is only the offline fallback
 * (and the preview for portfolio placeholders). Both paths use `LaunchCoin`,
 * so the components never branch on the data source.
 *
 * The fee split itself is NOT demo data — it is the ratified one (§6.12.3):
 * 100 bps taken in the quote asset, 70 creator / 20 jackpot / 10 treasury.
 */

export const TRADE_FEE_BPS = 100; // 1.00% of the trade, in WETH
export const CREATOR_BPS = 70; // 0.70%
export const JACKPOT_BPS = 20; // 0.20% → JackpotRouter.injectJackpot (skim-free)
export const TREASURY_BPS = 10; // 0.10% (final, §6.32)

export const GRADUATION_ETH = 4.2; // paired ETH at graduation
export const TOTAL_SUPPLY = 1_000_000_000; // fixed, 18 dp
// §6.24: 5x cheaper than Pons V1 (0.0005 ETH); still non-zero as a spam filter
// (mogz.fun is free but pays Solana rent, and its 0.5% trade fee is the product).
export const LAUNCH_FEE_ETH = 0.0001;

export type FeeSlice = { key: 'creator' | 'jackpot' | 'treasury'; label: string; bps: number; tone: string };

export const FEE_SPLIT: FeeSlice[] = [
  { key: 'creator', label: 'Creator', bps: CREATOR_BPS, tone: 'creator' },
  { key: 'jackpot', label: 'Jackpot', bps: JACKPOT_BPS, tone: 'jackpot' },
  { key: 'treasury', label: 'Treasury', bps: TREASURY_BPS, tone: 'treasury' },
];

/** The sentence the confirm panel is allowed to print (§6.12.3, R6). */
export const FEE_CLAIM = '20 of every 30 bps of the platform fee funds the jackpot.';

export type TapeTrade = {
  id: string;
  side: 'buy' | 'sell';
  venue: 'curve' | 'pool';
  trader: string;
  eth: number;
  tokens: number;
  priceEth: number;
  ts: number;
};

export type TapeHolder = { address: string; pct: number; balance: number };

export type LaunchCoin = {
  id: string;
  name: string;
  ticker: string;
  blurb: string;
  creator: string;
  ageMinutes: number;
  mcapEth: number;
  bondedEth: number;
  change24h: number;
  volume24hEth: number;
  jackpotEth: number;
  holders: number;
  hue: number;
  series: number[];
  /** Present only on a live coin read from LaunchFactory/LaunchCurve. */
  live?: boolean;
  curve?: string;
  token?: string;
  virtualEth?: number;
  virtualToken?: number;
  realEth?: number;
  ready?: boolean;
  /** R2: the curve has migrated into a v4 pool and this coin trades there. */
  graduated?: boolean;
  graduatedEth?: number;
  /** Recent trades and ranked holders from /api/launchpad/tape. */
  trades?: TapeTrade[];
  holderRows?: TapeHolder[];
  /** Live v4 pool reserves, replayed from the tape (graduated coins only). */
  poolEth?: number;
  poolTokens?: number;
  /** The connected wallet's balance of this coin, in whole tokens. */
  balance?: number;
  creatorFull?: string;
};

/* ── deterministic series, so the preview never flickers between renders ───── */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function series(seed: number, trend = 0, points = 48): number[] {
  const rand = lcg(seed);
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < points; i += 1) {
    v = Math.max(6, v + (rand() - 0.5) * 9 + trend);
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

type Seed = Omit<LaunchCoin, 'series'> & { trend?: number };

const SEEDS: Seed[] = [
  {
    id: 'last-ticket',
    name: 'Last Ticket',
    ticker: 'TICKET',
    blurb: 'One ticket, one draw, no refunds.',
    creator: '0x7A31…9fC2',
    ageMinutes: 3,
    mcapEth: 61.4,
    bondedEth: 3.62,
    change24h: 148.2,
    volume24hEth: 38.9,
    jackpotEth: 0.1128,
    holders: 412,
    hue: 152,
    trend: 1.6,
  },
  {
    id: 'ransom-note',
    name: 'Ransom Note',
    ticker: 'RANSOM',
    blurb: 'Payable in ninety seconds or your JPEG gets it.',
    creator: '0x2b90…14Ae',
    ageMinutes: 11,
    mcapEth: 47.8,
    bondedEth: 2.91,
    change24h: 62.4,
    volume24hEth: 21.4,
    jackpotEth: 0.0621,
    holders: 288,
    hue: 268,
    trend: 0.9,
  },
  {
    id: 'golden-ticket',
    name: 'Golden Ticket',
    ticker: 'GOLD',
    blurb: 'Trades like a coin, behaves like a lottery.',
    creator: '0x9C14…77Bd',
    ageMinutes: 4,
    mcapEth: 22.6,
    bondedEth: 1.44,
    change24h: 941.6,
    volume24hEth: 19.7,
    jackpotEth: 0.0571,
    holders: 197,
    hue: 44,
    trend: 2.4,
  },
  {
    id: 'carnival-coin',
    name: 'Carnival Coin',
    ticker: 'CVL',
    blurb: 'The house always wins. Hold the house.',
    creator: '0x51dE…03b9',
    ageMinutes: 26,
    mcapEth: 88.9,
    bondedEth: 4.18,
    change24h: 18.7,
    volume24hEth: 54.2,
    jackpotEth: 0.1572,
    holders: 733,
    hue: 330,
    trend: 0.4,
  },
  {
    id: 'vault-runner',
    name: 'Vault Runner',
    ticker: 'VAULT',
    blurb: 'Nine locked doors, one of them is the prize.',
    creator: '0x0f6A…bc81',
    ageMinutes: 39,
    mcapEth: 15.2,
    bondedEth: 0.96,
    change24h: -12.6,
    volume24hEth: 8.8,
    jackpotEth: 0.0255,
    holders: 121,
    hue: 192,
    trend: -0.5,
  },
  {
    id: 'lucky-sevens',
    name: 'Lucky Sevens',
    ticker: '777',
    blurb: '3 rows, 9 columns, 15 numbers. Sound familiar?',
    creator: '0x8e42…5C10',
    ageMinutes: 58,
    mcapEth: 34.1,
    bondedEth: 2.07,
    change24h: 33.9,
    volume24hEth: 14.3,
    jackpotEth: 0.0415,
    holders: 254,
    hue: 12,
    trend: 0.7,
  },
  {
    id: 'pigeon-heist',
    name: 'Pigeon Heist',
    ticker: 'PIGEON',
    blurb: 'Small bird. Large bag. No plan.',
    creator: '0x3b77…A2d4',
    ageMinutes: 74,
    mcapEth: 9.7,
    bondedEth: 0.58,
    change24h: -31.4,
    volume24hEth: 4.2,
    jackpotEth: 0.0122,
    holders: 88,
    hue: 218,
    trend: -1.1,
  },
  {
    id: 'busted-bank',
    name: 'Busted Bank',
    ticker: 'BANK',
    blurb: 'Filed for protection. Still trading.',
    creator: '0x6d19…eE52',
    ageMinutes: 91,
    mcapEth: 102.3,
    bondedEth: 4.19,
    change24h: 6.2,
    volume24hEth: 62.7,
    jackpotEth: 0.1818,
    holders: 908,
    hue: 100,
    trend: 0.2,
  },
  {
    id: 'neon-raffle',
    name: 'Neon Raffle',
    ticker: 'NEON',
    blurb: 'Every trade is a ticket you did not ask for.',
    creator: '0xad08…4F3b',
    ageMinutes: 122,
    mcapEth: 18.8,
    bondedEth: 1.14,
    change24h: 27.1,
    volume24hEth: 9.6,
    jackpotEth: 0.0278,
    holders: 163,
    hue: 288,
    trend: 0.6,
  },
  {
    id: 'jackpot-juice',
    name: 'Jackpot Juice',
    ticker: 'JUICE',
    blurb: 'Squeezed from the fee bucket.',
    creator: '0x4c63…8Ba1',
    ageMinutes: 167,
    mcapEth: 71.2,
    bondedEth: 3.88,
    change24h: 11.4,
    volume24hEth: 33.1,
    jackpotEth: 0.0960,
    holders: 501,
    hue: 84,
    trend: 0.3,
  },
];

export const DEMO_COINS: LaunchCoin[] = SEEDS.map((s, i) => ({
  ...s,
  series: series(1337 + i * 97, s.trend ?? 0),
}));

export function coinById(id: string | null): LaunchCoin | null {
  if (!id) return null;
  return DEMO_COINS.find((c) => c.id === id) ?? null;
}

/* ── formatting ────────────────────────────────────────────────────────────── */

export function fmtEth(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(dp);
}

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtAge(minutes: number): string {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Tokens a buy returns on the constant-product curve, mirroring
 *  LaunchCurve._settleBuy: fee first, then the curve on the net ETH. */
export function curveTokensOut(amountEth: number, virtualEth: number, virtualToken: number): number {
  const net = Math.max(0, amountEth - feeFor(amountEth).total);
  if (virtualEth <= 0) return 0;
  return (virtualToken * net) / (virtualEth + net);
}

/** ETH a sell returns, before/after the fee taken on the ETH leg. */
export function curveEthOut(tokensIn: number, virtualEth: number, virtualToken: number) {
  if (virtualToken <= 0 || tokensIn <= 0) return { gross: 0, net: 0, fee: 0 };
  const gross = (virtualEth * tokensIn) / (virtualToken + tokensIn);
  const fee = feeFor(gross).total;
  return { gross, net: Math.max(0, gross - fee), fee };
}

/** Fee owed on a trade, in the same unit as `amountEth`. Rounds UP on the fee
 *  (the curve's `ceil_div` behaviour, §2.6) so the accounting never under-books. */
export function feeFor(amountEth: number) {
  // Mirrors LaunchCurve._splitFee: fee rounds UP, the two named buckets round
  // DOWN, treasury takes the remainder so the three always sum to the fee.
  const total = Math.ceil(((amountEth * TRADE_FEE_BPS) / 10_000) * 1e9) / 1e9;
  const creator = Math.floor(((amountEth * CREATOR_BPS) / 10_000) * 1e9) / 1e9;
  const jackpot = Math.floor(((amountEth * JACKPOT_BPS) / 10_000) * 1e9) / 1e9;
  const treasury = Math.max(0, total - creator - jackpot);
  return { total, creator, jackpot, treasury };
}

/** Standing jackpot figure used by the header and the cabinet plate.
 *  Demo value until `RansomeVault.prizePoolReserve` is readable on a deployed
 *  chain — the components take it as a prop, so wiring is a one-line change. */
export const DEMO_JACKPOT_USD = 184_320;
