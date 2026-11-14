'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* ────────────────────────────────────────────────────────────────────────────
   SEGMENT 1 — JACKPOT CONSOLE (demo)

   This page is a faithful *shape* of the money loop, running on a local feed:

     trade → 1.00% fee → 0.60% platform fee → USDG buffer
           → buffer crosses threshold → ONE swap → injectJackpot()
           → prizePoolReserve grows → pyramid + total

   Everything on screen is derived from the `feed` array — the running total is
   the sum of emitted events, never an animation timeline. When the real
   contract lands, `emitFlush` becomes a `JackpotInjected` log subscription and
   nothing else changes. A decorative counter would destroy the one property
   this page exists to prove.

   DEMO banner stays until the feed is real.
   ──────────────────────────────────────────────────────────────────────────── */

type Source = 'LAUNCHPAD_FEE' | 'TICKET_MINT' | 'CREATOR_PATRON' | 'SEED'

type JackpotEvent = {
  id: number
  source: Source
  usd: number
  heist: number
  tx: string
  block: number
  at: number
}

/** Demo price. The real feed reads the same oracle the ticket price uses. */
const HEIST_PRICE_USD = 0.0042
/** Platform fee paid to the jackpot is 60 bps of trade volume. */
const PLATFORM_FEE_BPS = 60
/** Creator keeps 30 bps — the launch incentive, untouched. */
const CREATOR_FEE_BPS = 30
/** LP keeps 10 bps — this is where the operator earns, not from the trade fee. */
const LP_FEE_BPS = 10
/** Buffer flush threshold. One swap per crossing, never per trade. */
const FLUSH_THRESHOLD_USD = 120

/** Unclaimed positions at round end go to treasury; 99% is allocated to tiers. */
const TIERS: { code: string; label: string; bps: number; tone: string }[] = [
  { code: 'FF', label: 'FAST FIVE', bps: 500, tone: 'red' },
  { code: 'TA', label: 'TOP ACCOUNTS', bps: 500, tone: 'orange' },
  { code: 'MA', label: 'MIDDLE ACCOUNTS', bps: 500, tone: 'yellow' },
  { code: 'BA', label: 'BOTTOM ACCOUNTS', bps: 500, tone: 'green' },
  { code: 'FH1', label: 'FULL HOUSE I', bps: 1950, tone: 'cyan' },
  { code: 'FH2', label: 'FULL HOUSE II', bps: 1950, tone: 'blue' },
  { code: 'FH3', label: 'FULL HOUSE III', bps: 4000, tone: 'pink' },
]

const SOURCE_LABEL: Record<Source, string> = {
  LAUNCHPAD_FEE: 'LAUNCHPAD FEE',
  TICKET_MINT: 'TICKET MINT',
  CREATOR_PATRON: 'CREATOR PATRON',
  SEED: 'FOUNDER SEED',
}

/* ── formatting ─────────────────────────────────────────────────────────────── */

function usd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function usdFull(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  return `$${Math.floor(n).toLocaleString('en-US')}`
}

function heist(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString('en-US')
}

function clock(at: number): string {
  const d = new Date(at)
  const p = (v: number) => (v < 10 ? `0${v}` : String(v))
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function shortTx(): string {
  let s = '0x'
  for (let i = 0; i < 8; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]
  return s
}

/* Pyramid slice taper — same geometry as the cabinet, kept in sync by eye. */
const PYRAMID_APEX = 0.35
const sliceClip = (i: number) => {
  const f0 = (50 * (i / 7 + PYRAMID_APEX)) / (1 + PYRAMID_APEX)
  const f1 = (50 * ((i + 1) / 7 + PYRAMID_APEX)) / (1 + PYRAMID_APEX)
  return `polygon(${50 - f0}% 0, ${50 + f0}% 0, ${50 + f1}% 100%, ${50 - f1}% 100%)`
}

const SEED_TOTAL_USD = 8_640

function seedFeed(): JackpotEvent[] {
  const now = Date.now()
  const rows: { source: Source; usd: number; at: number }[] = [
    { source: 'SEED', usd: 5_000, at: now - 3_600_000 * 6 },
    { source: 'LAUNCHPAD_FEE', usd: 1_240, at: now - 3_600_000 * 4 },
    { source: 'TICKET_MINT', usd: 2_400, at: now - 3_600_000 * 2 },
  ]
  return rows.map((r, i) => ({
    id: i + 1,
    source: r.source,
    usd: r.usd,
    heist: r.usd / HEIST_PRICE_USD,
    tx: shortTx(),
    block: 4_182_000 + i * 137,
    at: r.at,
  }))
}

/* ── component ──────────────────────────────────────────────────────────────── */

export default function JackpotConsole() {
  const [feed, setFeed] = useState<JackpotEvent[]>(seedFeed)
  const [pending, setPending] = useState(41.8)
  const [running, setRunning] = useState(true)
  const [pulse, setPulse] = useState<{ id: number; usd: number } | null>(null)
  const [trades, setTrades] = useState(0)

  const pendingRef = useRef(41.8)
  const nextId = useRef(4)
  const blockRef = useRef(4_182_411)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tradeCounter = useRef(0)

  useEffect(() => () => { if (pulseTimer.current) clearTimeout(pulseTimer.current) }, [])

  const emit = useCallback((source: Source, amountUsd: number) => {
    const id = nextId.current++
    blockRef.current += 1 + Math.floor(Math.random() * 3)
    const event: JackpotEvent = {
      id,
      source,
      usd: amountUsd,
      heist: amountUsd / HEIST_PRICE_USD,
      tx: shortTx(),
      block: blockRef.current,
      at: Date.now(),
    }
    setFeed(prev => [event, ...prev].slice(0, 40))
    setPulse({ id, usd: amountUsd })
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulse(null), 1100)
  }, [])

  /** A trade pays 1.00%; only the 60 bps platform slice enters the buffer. */
  const simulateTrade = useCallback(() => {
    const size = 420 + Math.random() * 2_600
    const platformFee = (size * PLATFORM_FEE_BPS) / 10_000
    setTrades(t => t + 1)

    tradeCounter.current += 1
    // every so often a player also mints a ticket: that door skips the buffer
    if (tradeCounter.current % 6 === 0) {
      emit('TICKET_MINT', 0.5)
    }

    const next = pendingRef.current + platformFee
    if (next >= FLUSH_THRESHOLD_USD) {
      pendingRef.current = next - FLUSH_THRESHOLD_USD
      setPending(pendingRef.current)
      emit('LAUNCHPAD_FEE', next)
    } else {
      pendingRef.current = next
      setPending(next)
    }
  }, [emit])

  useEffect(() => {
    if (!running) return
    const t = setInterval(simulateTrade, 900)
    return () => clearInterval(t)
  }, [running, simulateTrade])

  const totalUsd = useMemo(() => feed.reduce((s, e) => s + e.usd, 0), [feed])

  const bySource = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const e of feed) acc[e.source] = (acc[e.source] ?? 0) + e.usd
    return acc
  }, [feed])

  const prizePoolUsd = totalUsd * 0.99
  const treasuryUsd = totalUsd - prizePoolUsd
  const totalHeist = totalUsd / HEIST_PRICE_USD
  const flushPct = Math.min(100, (pending / FLUSH_THRESHOLD_USD) * 100)

  return (
    <div className="jc-shell">
      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <header className="jc-top">
        <div>
          <div className="jc-kicker">HEIST CASINO · SEGMENT 1</div>
          <h1 className="jc-title">JACKPOT CONSOLE</h1>
          <p className="jc-sub">
            Every coin launched here pays the slot jackpot. This is where you watch it land.
          </p>
        </div>
        <div className="jc-chips">
          <span className="jc-chip jc-chip-demo">DEMO FEED</span>
          <button
            type="button"
            className={`jc-chip jc-chip-btn ${running ? 'jc-on' : ''}`}
            onClick={() => setRunning(r => !r)}
          >
            {running ? '● STREAMING' : '❚❚ PAUSED'}
          </button>
        </div>
      </header>

      {/* ── hero ────────────────────────────────────────────────────────── */}
      <section className={`jc-hero ${pulse ? 'jc-hero-pulse' : ''}`}>
        <div className="jc-hero-left">
          <div className="jc-hero-k">PRIZE POOL — PAID IN HEIST</div>
          <div className="jc-hero-v">{usdFull(prizePoolUsd)}</div>
          <div className="jc-hero-heist">
            ≈ {heist(totalHeist * 0.99)} HEIST <span className="jc-dim">at ${HEIST_PRICE_USD}</span>
          </div>
          {pulse && (
            <div key={pulse.id} className="jc-float">
              +{usd(pulse.usd)}
            </div>
          )}
        </div>

        <div className="jc-hero-right">
          <div className="jc-mini">
            <span className="jc-mini-k">TREASURY (1%)</span>
            <span className="jc-mini-v">{usdFull(treasuryUsd)}</span>
          </div>
          <div className="jc-mini">
            <span className="jc-mini-k">EVENTS</span>
            <span className="jc-mini-v">{feed.length}</span>
          </div>
          <div className="jc-mini">
            <span className="jc-mini-k">TRADES SIMULATED</span>
            <span className="jc-mini-v">{trades.toLocaleString('en-US')}</span>
          </div>
        </div>
      </section>

      {/* ── flow ────────────────────────────────────────────────────────── */}
      <section className="jc-flow">
        {[
          { k: '01', t: 'SOMEONE TRADES', d: 'a coin launched here' },
          { k: '02', t: '1.00% FEE', d: 'creator .30 · jackpot .60 · LP .10' },
          { k: '03', t: 'BUFFER', d: 'USDG waits for the threshold' },
          { k: '04', t: 'ONE SWAP', d: 'USDG → HEIST, not per trade' },
          { k: '05', t: 'JACKPOT', d: 'injectJackpot — 100%, no skim' },
        ].map((s, i, arr) => (
          <div className="jc-flow-step" key={s.k}>
            <span className="jc-flow-k">{s.k}</span>
            <span className="jc-flow-t">{s.t}</span>
            <span className="jc-flow-d">{s.d}</span>
            {i < arr.length - 1 && <span className="jc-flow-arrow">→</span>}
          </div>
        ))}
      </section>

      {/* ── main grid ───────────────────────────────────────────────────── */}
      <div className="jc-grid">
        {/* left: pyramid */}
        <section className="jc-panel">
          <div className="jc-panel-head">
            <h2>WHERE IT PAYS OUT</h2>
            <span className="jc-panel-note">99% allocated · 1% treasury</span>
          </div>

          <div className="jc-pyramid">
            {TIERS.map((tier, i) => (
              <div key={tier.code} className={`jc-slice jc-slice-${tier.tone}`} style={{ clipPath: sliceClip(i) }}>
                <span className="jc-slice-code">{tier.code}</span>
                <span className="jc-slice-usd">{usd((prizePoolUsd * tier.bps) / 10_000)}</span>
              </div>
            ))}
          </div>

          <div className="jc-legend">
            {TIERS.map(t => (
              <div key={t.code} className="jc-legend-row">
                <span className={`jc-dot jc-dot-${t.tone}`} />
                <span className="jc-legend-label">{t.label}</span>
                <span className="jc-legend-bps">{(t.bps / 100).toFixed(0)}%</span>
                <span className="jc-legend-usd">{usd((prizePoolUsd * t.bps) / 10_000)}</span>
              </div>
            ))}
          </div>

          <div className="jc-actions">
            <button type="button" className="jc-btn jc-btn-primary" onClick={simulateTrade}>
              SIMULATE A TRADE
            </button>
            <button type="button" className="jc-btn" onClick={() => setRunning(r => !r)}>
              {running ? 'PAUSE STREAM' : 'RESUME STREAM'}
            </button>
          </div>
        </section>

        {/* right: buffer + feed */}
        <div className="jc-right">
          <section className="jc-panel">
            <div className="jc-panel-head">
              <h2>BUFFER</h2>
              <span className="jc-panel-note">flush at {usdFull(FLUSH_THRESHOLD_USD)}</span>
            </div>

            <div className="jc-buffer">
              <div className="jc-buffer-bar">
                <div className="jc-buffer-fill" style={{ width: `${flushPct}%` }} />
              </div>
              <div className="jc-buffer-rows">
                <span>{usd(pending)} waiting</span>
                <span className="jc-dim">{flushPct.toFixed(0)}% to next swap</span>
              </div>
            </div>

            <p className="jc-note">
              Fees never touch the market one trade at a time. They collect here, and one swap
              converts the whole batch — which is exactly how the real launchpad avoids being
              sandwich-attacked on every buy.
            </p>
          </section>

          <section className="jc-panel jc-panel-feed">
            <div className="jc-panel-head">
              <h2>JACKPOT INJECTIONS</h2>
              <span className="jc-panel-note">JackpotInjected</span>
            </div>

            <div className="jc-feed">
              {feed.map(e => (
                <div key={e.id} className={`jc-feed-row ${pulse?.id === e.id ? 'jc-feed-new' : ''}`}>
                  <span className={`jc-tag jc-tag-${e.source.toLowerCase().replace(/_/g, '-')}`}>
                    {SOURCE_LABEL[e.source]}
                  </span>
                  <span className="jc-feed-usd">+{usd(e.usd)}</span>
                  <span className="jc-feed-heist">{heist(e.heist)} HEIST</span>
                  <span className="jc-feed-tx">{e.tx}</span>
                  <span className="jc-feed-time">{clock(e.at)}</span>
                </div>
              ))}
            </div>

            <div className="jc-totals">
              {(['LAUNCHPAD_FEE', 'TICKET_MINT', 'SEED'] as Source[]).map(s => (
                <div key={s} className="jc-total-row">
                  <span className="jc-total-k">{SOURCE_LABEL[s]}</span>
                  <span className="jc-total-v">{usdFull(bySource[s] ?? 0)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* ── plain-english ───────────────────────────────────────────────── */}
      <section className="jc-panel jc-explain">
        <div className="jc-panel-head">
          <h2>WHAT YOU ARE LOOKING AT</h2>
          <span className="jc-panel-note">no jargon</span>
        </div>
        <ol className="jc-steps">
          <li>
            <strong>A coin launches.</strong> It is priced in USDG, so every trade pays its fee
            in USDG — never in the new coin. Nobody has to sell the coin to fund a prize.
          </li>
          <li>
            <strong>The fee splits three ways.</strong> 0.30% to whoever launched it (that is
            why people bother launching), 0.10% to the liquidity pool, and <strong>0.60% — the
            entire platform fee — to the jackpot.</strong>
          </li>
          <li>
            <strong>It waits, then swaps once.</strong> Small fees pile up in a buffer. When the
            buffer is big enough, one swap turns it into HEIST and pushes it into the vault.
          </li>
          <li>
            <strong>The vault pays players.</strong> 99% becomes prizes, 1% becomes treasury.
            The pyramid splits that 99% across the seven win tiers you can see here.
          </li>
          <li>
            <strong>Nothing about that number is decorative.</strong> The total above is the sum
            of real events. When the contract is live, these rows are on-chain transactions and
            anyone can check them.
          </li>
        </ol>
        <p className="jc-warn">
          This page currently runs on a <strong>local demo feed</strong>. The loop it draws is
          the real one; the numbers are simulated until <code>JackpotRouter</code> is deployed
          and this table subscribes to <code>JackpotInjected</code>.
        </p>
      </section>

      <footer className="jc-foot">
        <span>SEGMENT 1 of 5 · Jackpot Console</span>
        <span className="jc-dim">next: contracts → curve → launchpad UI → live wiring</span>
      </footer>
    </div>
  )
}
