'use client';

import React, { useMemo, useState } from 'react';
import { type LaunchCoin } from '@/lib/launchpad-demo';
import { usePerps } from '@/lib/use-perps';
import { KIND_LABEL as kindLabel } from '@/lib/perps';

function CoinAvatar({ coin, size = 32 }: { coin: LaunchCoin; size?: number }) {
  return (
    <span
      className="rf-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: `radial-gradient(120% 120% at 30% 18%, hsl(${coin.hue} 82% 62%), hsl(${
          (coin.hue + 40) % 360
        } 74% 34%) 58%, hsl(${(coin.hue + 84) % 360} 58% 12%) 100%)`,
        fontSize: Math.round(size * 0.32),
      }}
      aria-hidden="true"
    >
      {coin.ticker.slice(0, 3)}
    </span>
  );
}

type CoinCallout = {
  id: string;
  handle: string;
  verified: boolean;
  age: string;
  side: 'long' | 'short';
  lev: number;
  thesis: string;
  coin: LaunchCoin;
  calledAt: number; // ETH mcap at call time
  now: number; // ETH mcap now
  views: number;
  tailed: number;
};

type PerpCallout = {
  id: string;
  handle: string;
  verified: boolean;
  age: string;
  side: 'long' | 'short';
  lev: number;
  thesis: string;
  coin: string; // ticker
  name: string;
  entry: number;
  now: number;
  tailed: number;
};

const HANDLES = [
  'degenvy',
  'ghostlight',
  '0xSable',
  'mira_onchain',
  'trenchbrat',
  'cupsey',
  'slingoor',
  'mickeymantled',
  'chad_ansem',
  'daddychilllll',
];
const VERIFIED = new Set(['degenvy', 'mira_onchain', '0xSable', 'chad_ansem']);
const AGES = ['51s', '2m', '18m', '29m', '1h', '2h', '15h', '48m', '38m', '5m'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function multiple(entry: number, now: number): number {
  if (entry <= 0) return 1;
  return now / entry;
}

function fmtMcap(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function buildCoinCallouts(coins: LaunchCoin[]): CoinCallout[] {
  return coins.map((coin, i) => {
    const h = hash(coin.id + coin.ticker);
    const handle = HANDLES[h % HANDLES.length];
    const age = AGES[(h >>> 4) % AGES.length];
    const side: 'long' | 'short' = (h >>> 8) % 3 === 0 ? 'short' : 'long';
    const lev = [5, 10, 20, 25, 40][(h >>> 12) % 5];
    const factor = 0.48 + ((h >>> 16) % 45) / 100; // 0.48..0.92
    const calledAt = coin.mcapEth * factor;
    const theses = [
      'first pullback held the curve midpoint, adding here',
      'dev still holds, curve filled in 40 seconds and nobody has sold the first leg',
      'pot is thinner than the float implies, any buy moves this',
      'graduated clean, now trading on the v4 pool',
      'volume is real, holders are climbing, staying long',
      'rejected the range high twice, funding still pays shorts',
    ];
    const thesis = theses[h % theses.length];
    return {
      id: coin.id,
      handle,
      verified: VERIFIED.has(handle),
      age,
      side,
      lev,
      thesis,
      coin,
      calledAt,
      now: coin.mcapEth,
      views: 4200 + ((h >>> 20) % 18000),
      tailed: 24 + ((h >>> 24) % 260),
    };
  });
}

const PERP_THESIS = [
  'rejected the range high twice, funding still pays shorts.',
  'bid holds above the previous day close – scaling in with a stop under the sweep.',
  'open interest climbing into a thin book, watching for the squeeze.',
  'funding flipped positive, longs paying, fading the rip.',
  'clean breakout of the consolidation, riding with a trailing stop.',
  'range-bound, scalping the edges until a level breaks.',
];

function buildPerpCallouts(markets: ReturnType<typeof usePerps>['markets']): PerpCallout[] {
  return markets.slice(0, 6).map((m, i) => {
    const h = hash(m.coin + m.kind);
    const handle = HANDLES[(h + i * 3) % HANDLES.length];
    const age = AGES[(h >>> 3) % AGES.length];
    const side: 'long' | 'short' = m.change24h >= 0 ? 'long' : 'short';
    const lev = [5, 10, 20, 25, 40][i % 5];
    const entry = m.prevDay > 0 ? m.prevDay : m.mark;
    return {
      id: m.coin,
      handle,
      verified: VERIFIED.has(handle),
      age,
      side,
      lev,
      thesis: PERP_THESIS[i % PERP_THESIS.length],
      coin: m.coin,
      name: kindLabel[m.kind] + ' perp',
      entry,
      now: m.mark,
      tailed: 13 + ((h >>> 11) % 90),
    };
  });
}

function Avatar({ handle, verified }: { handle: string; verified: boolean }) {
  const hue = (hash(handle) % 360) | 0;
  return (
    <span className="rf-callout-avatar" style={{ background: `hsl(${hue} 70% 48%)` }}>
      {handle.slice(0, 2).toUpperCase()}
      {verified && <span className="rf-callout-vtick" aria-label="verified">✓</span>}
    </span>
  );
}

type Props = {
  coins: LaunchCoin[];
  onOpenCoin: (id: string) => void;
};

type Tab = 'coins' | 'perps';
type Sort = 'for-you' | 'recent' | 'best';

export default function Callouts({ coins, onOpenCoin }: Props) {
  const [tab, setTab] = useState<Tab>('coins');
  const [sort, setSort] = useState<Sort>('recent');
  const [expanded, setExpanded] = useState(false);

  const coinCalls = useMemo(() => buildCoinCallouts(coins), [coins]);
  const { markets, live } = usePerps(tab === 'perps');
  const perpCalls = useMemo(() => buildPerpCallouts(markets), [markets]);

  const list = tab === 'coins' ? coinCalls : perpCalls;

  const sorted = useMemo(() => {
    const arr = [...list];
    if (sort === 'best') {
      arr.sort((a, b) => {
        const ma =
          'calledAt' in a
            ? (a as CoinCallout).now / (a as CoinCallout).calledAt
            : (a as PerpCallout).side === 'long'
              ? (a as PerpCallout).now / (a as PerpCallout).entry
              : 1 + ((a as PerpCallout).entry - (a as PerpCallout).now) / (a as PerpCallout).entry;
        const mb =
          'calledAt' in b
            ? (b as CoinCallout).now / (b as CoinCallout).calledAt
            : (b as PerpCallout).side === 'long'
              ? (b as PerpCallout).now / (b as PerpCallout).entry
              : 1 + ((b as PerpCallout).entry - (b as PerpCallout).now) / (b as PerpCallout).entry;
        return mb - ma;
      });
    }
    return arr;
  }, [list, sort]);

  const visible = expanded ? sorted : sorted.slice(0, 4);

  return (
    <section className="rf-callouts">
      <div className="rf-callouts-head">
        <div>
          <span className="rf-kicker">SOCIAL LAYER</span>
          <h2>Callouts</h2>
          <p className="rf-callouts-sub">
            Entry market cap is recorded when the call is posted, so the multiple is the caller's, not the chart's.
          </p>
        </div>
        <div className="rf-callouts-ctrl">
          <div className="rf-seg" role="tablist" aria-label="Callout feed">
            <button
              className={`rf-seg-btn ${tab === 'coins' ? 'is-on' : ''}`}
              onClick={() => setTab('coins')}
            >
              Coins
            </button>
            <button
              className={`rf-seg-btn ${tab === 'perps' ? 'is-on' : ''}`}
              onClick={() => setTab('perps')}
            >
              Perps
            </button>
          </div>
          <div className="rf-seg rf-seg-soft" role="tablist" aria-label="Sort callouts">
            {(['for-you', 'recent', 'best'] as Sort[]).map((s) => (
              <button
                key={s}
                className={`rf-seg-btn ${sort === s ? 'is-on' : ''}`}
                onClick={() => setSort(s)}
              >
                {s === 'for-you' ? 'For you' : s === 'recent' ? 'Most recent' : 'Best'}
              </button>
            ))}
          </div>
          <span className="rf-callouts-sample">sample callers</span>
        </div>
      </div>

      {tab === 'perps' && !live && (
        <p className="rf-callouts-note">Venue unreachable — showing preview markets.</p>
      )}

      <div className="rf-callout-feed">
        {visible.map((c) => {
          if (tab === 'coins') {
            const cc = c as CoinCallout;
            const mult = multiple(cc.calledAt, cc.now);
            const up = mult >= 1;
            return (
              <article key={cc.id} className="rf-callout-row">
                <Avatar handle={cc.handle} verified={cc.verified} />
                <div className="rf-callout-body">
                  <header className="rf-callout-row-head">
                    <span className="rf-callout-handle">@{cc.handle}</span>
                    {cc.verified && <span className="rf-callout-v">✓</span>}
                    <span className="rf-callout-age">{cc.age}</span>
                    <span className={`rf-callout-side ${cc.side === 'long' ? 'is-long' : 'is-short'}`}>
                      {cc.side.toUpperCase()} {cc.lev}×
                    </span>
                  </header>
                  <p className="rf-callout-text">{cc.thesis}</p>
                  <div className="rf-callout-coin">
                    <CoinAvatar coin={cc.coin} size={32} />
                    <div className="rf-callout-coin-meta">
                      <strong>${cc.coin.ticker}</strong>
                      <span>{cc.coin.name}</span>
                    </div>
                    <div className="rf-callout-coin-nums">
                      <span>
                        Position <strong>{fmtMcap(cc.calledAt)} ETH</strong>
                      </span>
                      <span>
                        Profit <strong className={up ? 'is-up' : 'is-down'}>{mult.toFixed(2)}×</strong>
                      </span>
                    </div>
                    <div className="rf-callout-coin-tail">
                      <span>{cc.tailed}</span>
                      <span>{fmtMcap(cc.now)}K MC</span>
                    </div>
                  </div>
                  <footer className="rf-callout-foot">
                    <span>{cc.views.toLocaleString()} views</span>
                    <span>{cc.tailed} tailed</span>
                    <button className="rf-callout-open" onClick={() => onOpenCoin(cc.coin.id)}>
                      Open coin →
                    </button>
                  </footer>
                </div>
              </article>
            );
          }
          const pc = c as PerpCallout;
          const mult =
            pc.side === 'long'
              ? multiple(pc.entry, pc.now)
              : pc.entry > 0
                ? 1 + (pc.entry - pc.now) / pc.entry
                : 1;
          const up = mult >= 1;
          return (
            <article key={pc.id} className="rf-callout-row">
              <Avatar handle={pc.handle} verified={pc.verified} />
              <div className="rf-callout-body">
                <header className="rf-callout-row-head">
                  <span className="rf-callout-handle">@{pc.handle}</span>
                  {pc.verified && <span className="rf-callout-v">✓</span>}
                  <span className="rf-callout-age">{pc.age}</span>
                  <span className={`rf-callout-side ${pc.side === 'long' ? 'is-long' : 'is-short'}`}>
                    {pc.side.toUpperCase()} {pc.lev}×
                  </span>
                </header>
                <p className="rf-callout-text">{pc.thesis}</p>
                <div className="rf-callout-coin is-perp">
                  <span className="rf-callout-perp-tick">{pc.coin}</span>
                  <div className="rf-callout-coin-meta">
                    <strong>{pc.coin}-PERP</strong>
                    <span>{pc.name}</span>
                  </div>
                  <div className="rf-callout-coin-nums">
                    <span>
                      Entry <strong>{pc.entry.toLocaleString()}</strong>
                    </span>
                    <span>
                      Mark <strong>{pc.now.toLocaleString()}</strong>
                    </span>
                  </div>
                  <div className="rf-callout-coin-tail">
                    <span>{pc.tailed}</span>
                    <span>{mult.toFixed(3)}×</span>
                  </div>
                </div>
                <footer className="rf-callout-foot">
                  <span>{pc.tailed} tailed</span>
                  <span className={up ? 'is-up' : 'is-down'}>{mult.toFixed(3)}×</span>
                  <span className="rf-callout-open is-link">Hyperliquid →</span>
                </footer>
              </div>
            </article>
          );
        })}
      </div>

      {sorted.length > 4 && (
        <button className="rf-callout-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer callouts' : 'Show more callouts'}
        </button>
      )}
    </section>
  );
}

