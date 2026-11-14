'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BUILDER_FEE,
  HL_TAKER_FEE,
  KIND_LABEL,
  fmtFunding,
  fmtPx,
  fmtUsd,
  fundingApr,
  positionPnl,
  ticketMath,
  type PerpCandle,
  type PerpKind,
  type PerpMarket,
  type Side,
} from '@/lib/perps';
import { useCandles, usePerps } from '@/lib/use-perps';
import {
  bookPnl,
  closePaper,
  loadBook,
  openPaper,
  saveBook,
  type PaperBook,
} from '@/lib/perps-paper';

const HL_URL = 'https://app.hyperliquid.xyz/trade/';

type KindFilter = 'all' | PerpKind;

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'stock', label: 'Stocks' },
  { id: 'commodity', label: 'Commodities' },
  { id: 'index', label: 'Indices' },
];

const INTERVALS: { id: string; label: string; hours: number }[] = [
  { id: '15m', label: '15m', hours: 20 },
  { id: '1h', label: '1H', hours: 48 },
  { id: '4h', label: '4H', hours: 240 },
  { id: '1d', label: '1D', hours: 480 },
];

function pctClass(n: number) {
  return n >= 0 ? 'is-up' : 'is-down';
}

// ── the chart ────────────────────────────────────────────────────────────────

function CandleChart({ candles, up }: { candles: PerpCandle[]; up: boolean }) {
  const W = 1000;
  const H = 300;

  const geom = useMemo(() => {
    if (!candles.length) return null;
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const span = max - min || max * 0.01 || 1;
    const pad = span * 0.06;
    const top = max + pad;
    const bottom = min - pad;
    const y = (v: number) => ((top - v) / (top - bottom)) * H;
    const step = W / candles.length;
    const bw = Math.max(1, step * 0.62);
    const bars = candles.map((c, i) => {
      const cx = step * i + step / 2;
      const rising = c.c >= c.o;
      return {
        cx,
        up: rising,
        yHigh: y(c.h),
        yLow: y(c.l),
        yOpen: y(c.o),
        yClose: y(c.c),
        bw,
      };
    });
    const last = candles[candles.length - 1].c;
    return { bars, last, lastY: y(last), top, bottom };
  }, [candles]);

  if (!geom) {
    return <div className="rf-perps-chart-empty">No candles for this market.</div>;
  }

  const tone = up ? 'var(--rf-mint)' : 'var(--rf-red)';

  return (
    <svg className="rf-perps-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price chart">
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0}
          x2={W}
          y1={H * f}
          y2={H * f}
          className="rf-perps-grid"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {geom.bars.map((b, i) => (
        <g key={i} className={b.up ? 'is-up' : 'is-down'}>
          <line
            x1={b.cx}
            x2={b.cx}
            y1={b.yHigh}
            y2={b.yLow}
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x={b.cx - b.bw / 2}
            y={Math.min(b.yOpen, b.yClose)}
            width={b.bw}
            height={Math.max(1, Math.abs(b.yClose - b.yOpen))}
            fill="currentColor"
            opacity={b.up ? 0.9 : 0.85}
          />
        </g>
      ))}
      <line
        x1={0}
        x2={W}
        y1={geom.lastY}
        y2={geom.lastY}
        stroke={tone}
        strokeDasharray="6 6"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        opacity={0.8}
      />
    </svg>
  );
}

// ── the ticket ───────────────────────────────────────────────────────────────

function Ticket({
  market,
  onBooked,
}: {
  market: PerpMarket;
  onBooked: (b: PaperBook) => void;
}) {
  const [side, setSide] = useState<Side>('long');
  const [leverage, setLeverage] = useState(() => Math.min(10, market.maxLeverage));
  const [margin, setMargin] = useState('250');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');

  useEffect(() => {
    setLeverage((l) => Math.min(l, market.maxLeverage));
  }, [market.maxLeverage]);

  const marginNum = Number(margin) || 0;
  const math = ticketMath({ side, leverage, marginUsd: marginNum }, market.mark);
  const valid = marginNum > 0 && marginNum <= 1_000_000;
  const tpNum = Number(tp) || 0;
  const slNum = Number(sl) || 0;

  const book = () => {
    if (!valid) return;
    const current = loadBook();
    const next = openPaper(current, {
      coin: market.coin,
      display: market.display,
      side,
      entry: market.mark,
      notional: math.notional,
      margin: marginNum,
      leverage,
      liq: math.liqPrice,
      tp: tpNum > 0 ? tpNum : null,
      sl: slNum > 0 ? slNum : null,
    });
    saveBook(next);
    onBooked(next);
  };

  return (
    <div className="rf-perps-ticket">
      <div className="rf-perps-ticket-side">
        <button
          className={`rf-perps-side is-long ${side === 'long' ? 'is-on' : ''}`}
          onClick={() => setSide('long')}
        >
          Long
        </button>
        <button
          className={`rf-perps-side is-short ${side === 'short' ? 'is-on' : ''}`}
          onClick={() => setSide('short')}
        >
          Short
        </button>
      </div>

      <div className="rf-perps-ticket-row">
        <span>Leverage</span>
        <strong className="is-gold">{leverage}×</strong>
      </div>
      <input
        className="rf-perps-range"
        type="range"
        min={1}
        max={market.maxLeverage}
        step={1}
        value={leverage}
        onChange={(e) => setLeverage(Number(e.target.value))}
        aria-label="Leverage"
      />
      <div className="rf-perps-quick">
        {[1, 5, 10, 25].filter((l) => l <= market.maxLeverage).map((l) => (
          <button key={l} onClick={() => setLeverage(l)} className={leverage === l ? 'is-on' : ''}>
            {l}×
          </button>
        ))}
        <button onClick={() => setLeverage(market.maxLeverage)} className={leverage === market.maxLeverage ? 'is-on' : ''}>
          Max
        </button>
      </div>

      <label className="rf-perps-field">
        <span>Margin · USDC (isolated)</span>
        <span className="rf-perps-input">
          <em>$</em>
          <input
            value={margin}
            onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            aria-label="Margin in USDC"
          />
        </span>
      </label>
      <div className="rf-perps-quick">
        {[50, 250, 1000].map((m) => (
          <button key={m} onClick={() => setMargin(String(m))} className={marginNum === m ? 'is-on' : ''}>
            ${m}
          </button>
        ))}
      </div>

      <div className="rf-perps-calc">
        <div>
          <span>Size</span>
          <strong>{fmtUsd(math.notional)}</strong>
        </div>
        <div>
          <span>Qty · {market.display}</span>
          <strong>{math.qty.toLocaleString('en-US', { maximumFractionDigits: market.szDecimals > 2 ? 4 : market.szDecimals })}</strong>
        </div>
        <div>
          <span>Entry (mark)</span>
          <strong>{fmtPx(market.mark)}</strong>
        </div>
        <div>
          <span>Est. liq.</span>
          <strong className="is-down">{fmtPx(math.liqPrice)}</strong>
        </div>
        <div>
          <span>Builder (to vault) · {(BUILDER_FEE * 100).toFixed(2)}%</span>
          <strong>{fmtUsd(math.feeBuilder, 2)}</strong>
        </div>
        <div>
          <span>Venue taker · {(HL_TAKER_FEE * 100).toFixed(3)}%</span>
          <strong>{fmtUsd(math.feeVenue, 2)}</strong>
        </div>
        <div>
          <span>To jackpot vault · {(BUILDER_FEE * 100).toFixed(2)}%</span>
          <strong className="is-gold">{fmtUsd(math.feeBuilder, 2)}</strong>
        </div>
      </div>

      <div className="rf-perps-tpsl">
        <label className="rf-perps-field">
          <span>Take profit</span>
          <span className="rf-perps-input">
            <em>px</em>
            <input value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" />
          </span>
        </label>
        <label className="rf-perps-field">
          <span>Stop loss</span>
          <span className="rf-perps-input">
            <em>px</em>
            <input value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" />
          </span>
        </label>
      </div>

      <button className={`rf-cta rf-perps-submit is-${side}`} onClick={book} disabled={!valid}>
        Book paper {side} · {fmtUsd(math.notional)}
      </button>

      <p className="rf-perps-note">
        Paper book only — no order leaves this browser. Real fills need a graduated broker ID on
        Orderly Network (one-time $10) with your custom fee rate (0.05%) so the builder fee can
        fund the jackpot vault; orders are then signed by your wallet. Max loss on the book is the
        {fmtUsd(marginNum)} margin.
      </p>

      <a className="rf-perps-link" href={`${HL_URL}${market.coin}`} target="_blank" rel="noreferrer">
        Trade {market.display} on Hyperliquid <em aria-hidden="true">↗</em>
      </a>
    </div>
  );
}

// ── the view ─────────────────────────────────────────────────────────────────

export default function PerpsView({ wallet }: { wallet: string | null }) {
  const { markets, live, error, loading } = usePerps();
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');
  const [coin, setCoin] = useState<string | null>(null);
  const [interval, setIntervalId] = useState('1h');
  const [book, setBook] = useState<PaperBook>({ positions: [], closed: [], realized: 0 });

  useEffect(() => setBook(loadBook()), []);

  const list = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return markets
      .filter((m) => (kind === 'all' ? true : m.kind === kind))
      .filter((m) => !needle || m.display.includes(needle) || m.coin.toUpperCase().includes(needle))
      .sort((a, b) => b.dayVolumeUsd - a.dayVolumeUsd);
  }, [markets, kind, q]);

  const active = useMemo(() => {
    if (!markets.length) return null;
    const found = markets.find((m) => m.coin === coin);
    return found ?? list[0] ?? markets[0];
  }, [markets, list, coin]);

  const hours = INTERVALS.find((i) => i.id === interval)?.hours ?? 48;
  const candles = useCandles(active?.coin ?? null, interval, hours);

  const markOf = useMemo(() => {
    const map = new Map(markets.map((m) => [m.coin, m.mark]));
    return (c: string) => map.get(c);
  }, [markets]);

  const openPnl = bookPnl(book, markOf);
  const totalOi = markets.reduce((s, m) => s + m.openInterestUsd, 0);
  const totalVol = markets.reduce((s, m) => s + m.dayVolumeUsd, 0);

  return (
    <div className="rf-perps">
      <aside className="rf-perps-markets">
        <div className="rf-perps-mhead">
          <span className="rf-kicker">Hyperliquid · builder route</span>
          <h1>Perps</h1>
          <p className="rf-perps-sub">
            <strong>{markets.length || '—'}</strong> markets
            <em>·</em>
            <strong>{fmtUsd(totalOi)}</strong> OI
            <em>·</em>
            <strong>{fmtUsd(totalVol)}</strong> 24h
          </p>
          {live ? (
            <span className="rf-chip is-live" title="Mark, funding and open interest read from the configured perps venue (Orderly Network or Hyperliquid)">
              LIVE · PERPS
            </span>
          ) : (
            <span className="rf-chip is-warn" title={error ?? 'Snapshot'}>
              {loading ? 'CONNECTING…' : 'PREVIEW SNAPSHOT'}
            </span>
          )}
        </div>

        <label className="rf-search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search market"
            aria-label="Search perp markets"
          />
        </label>

        <div className="rf-perps-kinds">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={kind === k.id ? 'is-on' : ''}
              onClick={() => setKind(k.id)}
              aria-pressed={kind === k.id}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="rf-perps-rows" role="listbox" aria-label="Perp markets">
          {list.slice(0, 200).map((m) => (
            <button
              key={m.coin}
              role="option"
              aria-selected={active?.coin === m.coin}
              className={`rf-perps-row ${active?.coin === m.coin ? 'is-on' : ''}`}
              onClick={() => setCoin(m.coin)}
            >
              <span className="rf-perps-row-id">
                <strong>{m.display}</strong>
                <span>
                  {m.dex ? `${m.dex} · ` : ''}
                  {KIND_LABEL[m.kind]} · {m.maxLeverage}×
                </span>
              </span>
              <span className="rf-perps-row-px">
                <strong>{fmtPx(m.mark)}</strong>
                <span className={pctClass(m.change24h)}>
                  {m.change24h >= 0 ? '+' : ''}
                  {m.change24h.toFixed(2)}%
                </span>
              </span>
            </button>
          ))}
          {!list.length && <p className="rf-perps-empty">{loading ? 'Loading markets…' : 'No market matches that.'}</p>}
        </div>
      </aside>

      <section className="rf-perps-main">
        {active ? (
          <>
            <div className="rf-perps-head">
              <div className="rf-perps-title">
                <h2>
                  {active.display}
                  <em>-PERP</em>
                  {active.dex && <span className="rf-perps-dex">{active.dex}</span>}
                </h2>
                <span className={`rf-perps-change ${pctClass(active.change24h)}`}>
                  {active.change24h >= 0 ? '+' : ''}
                  {active.change24h.toFixed(2)}% <em>24h</em>
                </span>
              </div>
              <div className="rf-perps-price">
                <strong>{fmtPx(active.mark)}</strong>
                <span>
                  oracle {fmtPx(active.oracle)} <em>·</em> max {active.maxLeverage}×
                </span>
              </div>
            </div>

            <div className="rf-perps-stats">
              <div>
                <span>24h volume</span>
                <strong>{fmtUsd(active.dayVolumeUsd)}</strong>
              </div>
              <div>
                <span>Open interest</span>
                <strong>{fmtUsd(active.openInterestUsd)}</strong>
              </div>
              <div>
                <span>Funding / 1h</span>
                <strong className={pctClass(-active.funding)}>{fmtFunding(active.funding)}</strong>
              </div>
              <div>
                <span>Funding APR</span>
                <strong>{fundingApr(active.funding)}</strong>
              </div>
            </div>

            <div className="rf-perps-chart-head">
              {INTERVALS.map((i) => (
                <button
                  key={i.id}
                  className={interval === i.id ? 'is-on' : ''}
                  onClick={() => setIntervalId(i.id)}
                  aria-pressed={interval === i.id}
                >
                  {i.label}
                </button>
              ))}
              <span className="rf-perps-chart-meta">
                {candles.live ? 'live candles' : candles.loading ? 'loading…' : 'no candles'}
              </span>
            </div>
            <CandleChart candles={candles.candles} up={active.change24h >= 0} />

            <div className="rf-perps-book">
              <div className="rf-perps-book-head">
                <h3>Paper book</h3>
                <span className={pctClass(openPnl)}>
                  open {openPnl >= 0 ? '+' : '−'}
                  {fmtUsd(Math.abs(openPnl), 2)}
                </span>
                <span className={pctClass(book.realized)}>
                  realized {book.realized >= 0 ? '+' : '−'}
                  {fmtUsd(Math.abs(book.realized), 2)}
                </span>
                <em>{wallet ? 'marked live · local only' : 'connect not required'}</em>
              </div>

              {book.positions.length === 0 ? (
                <p className="rf-perps-book-empty">
                  No positions. Open the ticket on the right — fills are booked in this browser and
                  marked against Hyperliquid&rsquo;s live price.
                </p>
              ) : (
                <div className="rf-perps-ptable">
                  <div className="rf-perps-prow is-head">
                    <span>Market</span>
                    <span>Side</span>
                    <span>Size</span>
                    <span>Entry</span>
                    <span>Mark</span>
                    <span>Liq.</span>
                    <span>PnL</span>
                    <span />
                  </div>
                  {book.positions.map((p) => {
                    const mark = markOf(p.coin) ?? p.entry;
                    const pnl = positionPnl(p, mark);
                    return (
                      <div className="rf-perps-prow" key={p.id}>
                        <span className="rf-perps-pmkt">{p.display}</span>
                        <span className={`rf-perps-pside is-${p.side}`}>
                          {p.side} {p.leverage}×
                        </span>
                        <span>{fmtUsd(p.notional)}</span>
                        <span>{fmtPx(p.entry)}</span>
                        <span>{fmtPx(mark)}</span>
                        <span className="is-down">{fmtPx(p.liq)}</span>
                        <span className={pctClass(pnl)}>
                          {pnl >= 0 ? '+' : '−'}
                          {fmtUsd(Math.abs(pnl), 2)}
                        </span>
                        <span>
                          <button
                            className="rf-perps-close"
                            onClick={() => {
                              const next = closePaper(book, p.id, mark);
                              saveBook(next);
                              setBook(next);
                            }}
                          >
                            Close
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="rf-perps-empty">{loading ? 'Reading Hyperliquid…' : 'No markets available.'}</p>
        )}
      </section>

      {active ? (
        <Ticket market={active} onBooked={setBook} />
      ) : (
        <div className="rf-perps-ticket rf-perps-ticket-empty">Pick a market to open the ticket.</div>
      )}
    </div>
  );
}
