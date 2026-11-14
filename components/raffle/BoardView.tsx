'use client';

import React, { useMemo, useState } from 'react';
import {
  GRADUATION_ETH,
  fmtAge,
  fmtEth,
  fmtPct,
  fmtCompact,
  type LaunchCoin,
} from '@/lib/launchpad-demo';
import Sparkline from './Sparkline';
import PlayRaffleTray from './PlayRaffleTray';
import Callouts from './Callouts';

type Props = {
  coins: LaunchCoin[];
  jackpotUsd: number;
  onOpen: (id: string) => void;
  /** The tray is flipped to the cabinet (state lives in the shell). */
  cabinetOpen: boolean;
  onCabinetChange: (open: boolean) => void;
  /** The cabinet itself — mounted inside the tray, not in a popup. */
  renderCabinet: (close: () => void) => React.ReactNode;
  /** True when the coins came from LaunchFactory, not the local dataset. */
  live?: boolean;
  error?: string | null;
};

type Tab = 'trending' | 'movers' | 'mayhem' | 'new' | 'graduated' | 'holders' | 'soon';

type TimeWindow = '1h' | '4h' | '12h' | '24h';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'trending', label: 'Trending', hint: 'Most traded in the window' },
  { id: 'movers', label: 'Movers', hint: 'Biggest move in the window' },
  { id: 'mayhem', label: 'Mayhem', hint: 'Highest volatility' },
  { id: 'new', label: 'New', hint: 'Launched in the last hour' },
  { id: 'graduated', label: 'Graduated', hint: 'Migrated to the v4 pool' },
  { id: 'holders', label: 'Most holders', hint: 'Widest holder base' },
  { id: 'soon', label: 'Soon', hint: 'Closest to graduating' },
];

export function CoinAvatar({
  coin,
  size = 40,
  radius,
}: {
  coin: LaunchCoin;
  size?: number;
  radius?: number;
}) {
  return (
    <span
      className="rf-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.28),
        background: `radial-gradient(120% 120% at 30% 18%, hsl(${coin.hue} 82% 62%), hsl(${
          (coin.hue + 40) % 360
        } 74% 34%) 58%, hsl(${(coin.hue + 84) % 360} 58% 12%) 100%)`,
      }}
      aria-hidden="true"
    >
      {coin.ticker.slice(0, 3)}
    </span>
  );
}

export function CoinCard({ coin, onOpen }: { coin: LaunchCoin; onOpen: (id: string) => void }) {
  const progress = Math.min(1, coin.bondedEth / GRADUATION_ETH);
  const up = coin.change24h >= 0;

  return (
    <button className="rf-card" onClick={() => onOpen(coin.id)}>
      <div className="rf-card-head">
        <CoinAvatar coin={coin} size={36} />
        <span className="rf-card-id">
          <strong>{coin.name}</strong>
          <span>
            ${coin.ticker} <em>·</em> {fmtAge(coin.ageMinutes)}
            {coin.graduated && <em className="rf-card-v4">v4</em>}
          </span>
        </span>
        <span className={`rf-delta ${up ? 'is-up' : 'is-down'}`}>{fmtPct(coin.change24h)}</span>
      </div>

      <div className="rf-card-chart">
        <Sparkline series={coin.series} height={48} strokeWidth={1.4} />
      </div>      <div className="rf-card-rows">
        <div>
          <span>MCAP</span>
          <strong>
            {fmtEth(coin.mcapEth)} <em>ETH</em>
          </strong>
        </div>
        <div>
          <span>24H VOL</span>
          <strong>
            {fmtEth(coin.volume24hEth)} <em>ETH</em>
          </strong>
        </div>
        <div>
          <span>HOLDERS</span>
          <strong>{fmtCompact(coin.holders)}</strong>
        </div>
      </div>

      <div className="rf-card-bond">
        <div className="rf-card-bond-label">
          <span>{progress >= 1 ? 'Graduated' : `${fmtEth(coin.bondedEth)} / ${GRADUATION_ETH} ETH`}</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <div className="rf-bond-track">
          <span style={{ width: `${Math.max(progress * 100, 1.5)}%` }} />
        </div>
      </div>

      <div className="rf-card-foot">
        <span className="rf-card-pot">
          <i aria-hidden="true" />+{coin.jackpotEth.toFixed(4)} ETH to pot
        </span>
        <span className="rf-card-go">
          Trade <em aria-hidden="true">→</em>
        </span>
      </div>
    </button>
  );
}

export default function BoardView({
  coins,
  jackpotUsd,
  onOpen,
  cabinetOpen,
  onCabinetChange,
  renderCabinet,
  live = false,
  error,
}: Props) {
  const [tab, setTab] = useState<Tab>('trending');
  const [window, setWindow] = useState<TimeWindow>('24h');
  const [q, setQ] = useState('');
  // Mobile (<=1100px): pump.fun leads with the Callouts feed, so default to it.
  const [mobileView, setMobileView] = useState<'coins' | 'callouts'>('callouts');

  const volume = useMemo(() => coins.reduce((sum, c) => sum + c.volume24hEth, 0), [coins]);
  const fresh = useMemo(() => coins.filter((c) => c.ageMinutes <= 60).length, [coins]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = coins.filter(
      (c) => !needle || c.name.toLowerCase().includes(needle) || c.ticker.toLowerCase().includes(needle),
    );
    const sorted = [...filtered];
    if (tab === 'new') sorted.sort((a, b) => a.ageMinutes - b.ageMinutes);
    if (tab === 'trending') sorted.sort((a, b) => b.volume24hEth - a.volume24hEth);
    if (tab === 'movers') sorted.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
    if (tab === 'mayhem') sorted.sort((a, b) => Math.abs(b.change24h) * b.volume24hEth - Math.abs(a.change24h) * a.volume24hEth);
    if (tab === 'graduated') sorted.sort((a, b) => Number(b.graduated) - Number(a.graduated) || b.bondedEth - a.bondedEth);
    if (tab === 'holders') sorted.sort((a, b) => b.holders - a.holders);
    if (tab === 'soon') sorted.sort((a, b) => b.bondedEth / GRADUATION_ETH - a.bondedEth / GRADUATION_ETH);
    return sorted;
  }, [coins, tab, q]);

  return (
    <div className="rf-board">
      <div className="rf-board-main">
        <div className="rf-board-head">
          <div className="rf-board-title">
            <span className="rf-kicker">FEED · 1.00% PER TRADE</span>
            <h1>Coins</h1>
            <p className="rf-board-meta">
              <strong>{list.length}</strong> coins
              <em>·</em>
              <strong>{fmtEth(volume, 1)} ETH</strong> 24h
              <em>·</em>
              <strong>{fresh}</strong> new this hour
              <em>·</em>
              <strong className="is-gold">${fmtCompact(jackpotUsd)}</strong> jackpot
            </p>
          </div>

          <div className="rf-board-tools">
            {live ? (
              <span className="rf-chip is-live" title="Read from LaunchFactory and each coin's LaunchCurve">
                LIVE · ON-CHAIN
              </span>
            ) : (
              <span
                className="rf-chip is-warn"
                title="No LaunchFactory address — this board renders a local dataset"
              >
                PREVIEW DATA
              </span>
            )}
            <label className="rf-search">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search ticker or name"
                aria-label="Search coins"
              />
            </label>
          </div>
        </div>

        <div className="rf-board-bar">
          <div className="rf-tabs" role="tablist" aria-label="Board filters">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`rf-tab ${tab === t.id ? 'is-on' : ''}`}
                onClick={() => setTab(t.id)}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
            <span className="rf-tab-count">{list.length}</span>
          </div>
          <div className="rf-timefilter" role="tablist" aria-label="Time window">
            {(['1h', '4h', '12h', '24h'] as TimeWindow[]).map((w) => (
              <button
                key={w}
                className={window === w ? 'is-on' : ''}
                onClick={() => setWindow(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rf-err">{error}</p>}

        {/* mobile-only switcher: pump.fun mobile leads with the Callouts feed */}
        <div className="rf-mobile-tabs" role="tablist" aria-label="Mobile feed view">
          <button
            role="tab"
            aria-selected={mobileView === 'coins'}
            className={`rf-mobile-tab ${mobileView === 'coins' ? 'is-on' : ''}`}
            onClick={() => setMobileView('coins')}
          >
            Coins
          </button>
          <button
            role="tab"
            aria-selected={mobileView === 'callouts'}
            className={`rf-mobile-tab ${mobileView === 'callouts' ? 'is-on' : ''}`}
            onClick={() => setMobileView('callouts')}
          >
            Callouts
          </button>
        </div>

        <div className={`rf-board-split is-${mobileView}`}>
          <div className="rf-board-coins">
            {list.length === 0 ? (
              <div className="rf-empty">
                {q ? `No coin matches “${q}”.` : live ? 'No coins launched yet.' : 'No coins in the preview dataset.'}
              </div>
            ) : (
              <div className="rf-grid">
                {list.map((c) => (
                  <CoinCard key={c.id} coin={c} onOpen={onOpen} />
                ))}
              </div>
            )}
          </div>
          <aside className="rf-board-callouts">
            <Callouts coins={coins} onOpenCoin={onOpen} />
          </aside>
        </div>
      </div>

      {/* the right column: the vault, which opens the machine */}
      <PlayRaffleTray
        open={cabinetOpen}
        onOpenChange={onCabinetChange}
        renderCabinet={renderCabinet}
      />
    </div>
  );
}
