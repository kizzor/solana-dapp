'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TicketNumbers, fmtMMSS } from './CarnivalHeader'

export type MachineTicket = {
  id: number
  serial: string
  numbers: number[]
  matched: number[]
  win: boolean
  claimable: boolean
  prizeLabel?: string
  payout?: number
}

export type BannerLight = {
  id: string
  label: string
  lit?: boolean
}

export type CarnivalSlotMachineProps = {
  round: number
  currentNum: number | null
  prevNum: number | null
  countdown: number
  sessionSecs: number
  preGameSecs: number
  tickets: MachineTicket[]
  onClaim: (id: number) => void
  vaultTotal: number
  claimableCount: number
  claimableTotal: number
  /** USD value of each vault brick position, in banner-light order */
  brickShares?: number[]
  lastWin: number
  credits: number
  bet?: number
  onOpenVault: () => void
  announcement: string | null
  onTerminate: () => void
  onSpin?: () => void
  onMaxBet?: () => void
  onCoin?: () => void
  lights?: BannerLight[]
}

function pad(n: number | null) {
  if (n === null || n === undefined) return '--'
  return n < 10 ? `0${n}` : String(n)
}

// compact money for the brick segments: $480K / $1.2M
function usd(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

// pyramid slice taper: a virtual apex 0.35 heights above the plate keeps every
// slice wide enough to print its value (a needle point could not)
const PYRAMID_APEX = 0.35
const sliceClip = (i: number) => {
  const f0 = (50 * (i / 7 + PYRAMID_APEX)) / (1 + PYRAMID_APEX)
  const f1 = (50 * ((i + 1) / 7 + PYRAMID_APEX)) / (1 + PYRAMID_APEX)
  return `polygon(${50 - f0}% 0, ${50 + f0}% 0, ${50 + f1}% 100%, ${50 - f1}% 100%)`
}

const DEFAULT_LIGHTS: BannerLight[] = [
  { id: 'ff', label: 'FF' },
  { id: 'r1', label: 'R1' },
  { id: 'r2', label: 'R2' },
  { id: 'r3', label: 'R3' },
  { id: 'fh1', label: 'FH1' },
  { id: 'fh2', label: 'FH2' },
  { id: 'fh3', label: 'FH3' },
]

// one colour per indicator — the same run is stacked as bricks in the vault plate
const LIGHT_TONE: Record<string, string> = {
  ff: 'cv-light-red',
  r1: 'cv-light-orange',
  r2: 'cv-light-yellow',
  r3: 'cv-light-green',
  fh1: 'cv-light-cyan',
  fh2: 'cv-light-blue',
  fh3: 'cv-light-pink',
}
const BRICK_TONE = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'pink']

export default function CarnivalSlotMachine({
  round, currentNum, prevNum, countdown, sessionSecs, preGameSecs,
  tickets, onClaim, vaultTotal, claimableCount, claimableTotal, lastWin, credits, bet = 10,
  onOpenVault, announcement, onTerminate, onSpin, onMaxBet, onCoin,
  brickShares = [],
  lights = DEFAULT_LIGHTS,
}: CarnivalSlotMachineProps) {
  const [confirmKill, setConfirmKill] = React.useState(false)
  React.useEffect(() => {
    if (!confirmKill) return
    const t = setTimeout(() => setConfirmKill(false), 4000)
    return () => clearTimeout(t)
  }, [confirmKill])

  // ── round bookkeeping: winners are remembered, missed ones get torn out ─────
  const [tornIds, setTornIds] = useState<number[]>([])
  const [tearingIds, setTearingIds] = useState<number[]>([])
  const [roundWinners, setRoundWinners] = useState<number[]>([])
  const [collected, setCollected] = useState(false)
  const prevCountdown = useRef<number | null>(null)
  const tearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tearTimer.current) clearTimeout(tearTimer.current) }, [])

  // Remember every winner as it happens: the parent expires a win on the very
  // tick the clock rolls, so by tear time they no longer read as claimable.
  useEffect(() => {
    const ids = tickets.filter(t => t.claimable && !tornIds.includes(t.id)).map(t => t.id)
    if (!ids.length) return
    setRoundWinners(prev => {
      const merged = [...new Set([...prev, ...ids])]
      return merged.length === prev.length ? prev : merged
    })
  }, [tickets, tornIds])

  // Clock rolled into a fresh round (or hit zero): a win nobody collected is
  // torn out of the roll, and the button re-arms for the new round.
  useEffect(() => {
    const prev = prevCountdown.current
    prevCountdown.current = countdown
    if (prev === null) return
    const rolled = countdown > prev || (prev > 0 && countdown === 0)
    if (!rolled) return
    const missed = collected ? [] : [...roundWinners]
    setRoundWinners([])
    setCollected(false)
    if (!missed.length) return
    setTearingIds(missed)
    if (tearTimer.current) clearTimeout(tearTimer.current)
    tearTimer.current = setTimeout(() => {
      setTornIds(p => [...new Set([...p, ...missed])])
      setTearingIds([])
      tearTimer.current = null
    }, 700)
  }, [countdown, collected, roundWinners])

  // Ranked closest-to-a-win first — this is the order the strips page through.
  const ranked = useMemo(() => {
    return [...tickets].sort((a, b) => {
      if (a.claimable !== b.claimable) return a.claimable ? -1 : 1
      if (a.win !== b.win) return a.win ? -1 : 1
      return b.matched.length - a.matched.length
    })
  }, [tickets])

  const visible = useMemo(() => ranked.filter(t => !tornIds.includes(t.id)), [ranked, tornIds])
  const claimables = useMemo(() => visible.filter(t => t.claimable), [visible])
  // armed = a win is sitting there uncollected: lights flicker, button flashes red
  const armed = claimables.length > 0 && !collected
  // round finished with a win banked: the lights settle into a steady glow
  const holdGlow = !armed && roundWinners.length > 0

  // ── window pager: two closest tickets per window, swipe for the next pair ──
  const STRIPS_PER_PAGE = 2
  const stripsRef = useRef<HTMLDivElement | null>(null)
  const [stripPage, setStripPage] = useState(1)

  useEffect(() => {
    const el = stripsRef.current
    if (!el) return
    const onScroll = () => {
      const w = el.clientWidth || 1
      setStripPage(Math.round(el.scrollLeft / w) + 1)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [visible.length])

  const pages = useMemo(() => {
    const out: MachineTicket[][] = []
    for (let i = 0; i < visible.length; i += STRIPS_PER_PAGE) out.push(visible.slice(i, i + STRIPS_PER_PAGE))
    return out
  }, [visible])
  const pageCount = Math.max(1, pages.length)

  useEffect(() => {
    setStripPage(p => Math.min(p, pageCount))
  }, [pageCount])

  const goPage = (dir: number) => {
    const el = stripsRef.current
    if (!el) return
    const w = el.clientWidth || 1
    const p = Math.min(pageCount, Math.max(1, stripPage + dir))
    el.scrollTo({ left: (p - 1) * w, behavior: 'smooth' })
  }

  const collect = () => {
    const t = claimables[0]
    if (!t) return
    onClaim(t.id)
    setCollected(true)
  }

  const warm = currentNum !== null && preGameSecs === 0
  const spinning = preGameSecs > 0 || !warm
  const clock = preGameSecs > 0 ? preGameSecs : countdown

  return (
    <div className="cv-shell cv-shell-arena">
      <header className="cv-arena-head">
        <div className="cv-arena-brand">
          <span className="cv-arena-live">● LIVE</span>
          <span className="cv-arena-session">SESSION {fmtMMSS(sessionSecs)}</span>
        </div>
        <div className="cv-arena-stats">
          <span>TIMER <strong className="cv-gold">{clock}</strong></span>
          <span>TICKETS <strong>{tickets.length}</strong></span>
          <span>CLAIMABLE <strong>{claimables.length}</strong></span>
          <button className="cv-head-vault" onClick={onOpenVault}>⚿ VAULT CLAIMS</button>
        </div>
      </header>

      {/* ═══ MACHINE ═══ */}
      <div className="cv-machine">
        <div className="cv-cab">
          <img className="cv-cab-art" src="/assets/aistudio/carnival-cabinet.jfif" alt="" aria-hidden="true" />

          {/* bulb frame */}
          <div className="cv-bulbs cv-bulbs-top" aria-hidden="true">
            {['gold', 'ruby', 'emerald', 'cyan', 'magenta', 'amber', 'violet', 'gold', 'ruby', 'emerald', 'cyan'].map((c, i) => (
              <span key={i} className={`cv-bulb cv-bulb-${c}`} />
            ))}
          </div>
          <div className="cv-bulbs cv-bulbs-left" aria-hidden="true">
            {['ruby', 'cyan', 'gold', 'emerald', 'magenta', 'amber'].map((c, i) => (
              <span key={i} className={`cv-bulb cv-bulb-${c}`} />
            ))}
          </div>
          <div className="cv-bulbs cv-bulbs-right" aria-hidden="true">
            {['cyan', 'magenta', 'gold', 'ruby', 'emerald', 'violet'].map((c, i) => (
              <span key={i} className={`cv-bulb cv-bulb-${c}`} />
            ))}
          </div>

          {/* 7 banner lights: coloured glass at rest, a rapid flicker when a win
              engages, a permanent glow once the round is finished */}
          <div className="cv-slot cv-lights">
            {lights.map(l => (
              <div
                key={l.id}
                className={`cv-light ${LIGHT_TONE[l.id] || ''} ${armed ? 'cv-light-on cv-light-flicker' : holdGlow ? 'cv-light-on cv-light-hold' : ''}`}
                title={armed ? `${l.label} — WIN DETECTED` : holdGlow ? `${l.label} — ROUND COMPLETE` : l.label}
              >
                <span className="cv-light-dome">
                  <span className="cv-light-glare" />
                  <span className="cv-light-label">{l.label}</span>
                </span>
              </div>
            ))}
          </div>

          {/* timer plate — the round counter is gone, the clock owns this space */}
          <div className="cv-slot cv-slot-round">
            <span className="cv-slot-k">TIMER</span>
            <span className="cv-slot-v">{clock}</span>
          </div>

          {/* vault plate: a transparent coloured-glass pyramid — seven slices,
              each carrying that win's cut of the vault */}
          <div className="cv-slot cv-slot-vault">
            <div className="cv-vault-bricks">
              {BRICK_TONE.map((c, i) => (
                <span key={c} className={`cv-brick cv-brick-${c}`} style={{ clipPath: sliceClip(i) }}>
                  <span className="cv-brick-usd">{usd(brickShares[i] ?? 0)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* bridges the vault plate to the window edge — masks the art's paytable */}
          <div className="cv-slot cv-vault-fill" aria-hidden="true" />

          {/* the vault total owns the space above the COLLECT key */}
          <div className="cv-slot cv-vault-total" aria-label="Vault total">
            <span className="cv-vault-total-k">TOTAL</span>
            <span className="cv-vault-total-v">${(vaultTotal / 1_000_000).toFixed(2)}M</span>
          </div>

          {/* CRT screen — single roller (no heading: the number owns the glass) */}
          <div className={`cv-slot cv-screen ${spinning ? 'cv-screen-waiting' : ''}`}>
            <div className="cv-crt" aria-hidden="true" />
            <div className="cv-scan" aria-hidden="true" />
            <div className="cv-raster" aria-hidden="true" />

            <div className="cv-roller">
              <div className="cv-roller-window">
                <div className="cv-payline" aria-hidden="true" />
                {!warm ? (
                  <div className="cv-roller-idle">
                    <span className="cv-roller-num cv-dimming">{pad(null)}</span>
                    <span className="cv-roller-hint">
                      {preGameSecs > 0 ? `FIRST DRAW IN ${preGameSecs}s` : 'AWAITING DRAW'}
                    </span>
                  </div>
                ) : (
                  <div key={currentNum} className="cv-reel-track">
                    <div className="cv-reel-cell">
                      <span className="cv-roller-num cv-roller-ghost">{pad(prevNum ?? currentNum)}</span>
                    </div>
                    <div className="cv-reel-cell">
                      <span className="cv-roller-num">{pad(currentNum)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ticket window — red strips, two closest to a win in the glass */}
          <div className={`cv-slot cv-window ${claimables.length > 0 ? 'cv-window-hot' : ''}`}>
            <div className="cv-strips" ref={stripsRef} aria-label="Closest tickets">
              {visible.length === 0 ? (
                <div className="cv-strips-empty">
                  {ranked.length === 0 ? 'NO TICKETS — MINT IN LOBBY' : 'ALL STRIPS TORN — MINT ANOTHER'}
                </div>
              ) : pages.map((page, pi) => (
                <div className="cv-strip-page" key={pi}>
                  {page.map(t => (
                    <article
                      key={t.id}
                      className={[
                        'cv-sticker',
                        (t.claimable || (roundWinners.includes(t.id) && !collected)) ? 'cv-sticker-win' : '',
                        tearingIds.includes(t.id) ? 'cv-sticker-torn' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <TicketNumbers numbers={t.numbers} matched={t.matched} />
                    </article>
                  ))}
                </div>
              ))}
            </div>

            {pageCount > 1 && (
              <>
                <button
                  className="cv-win-arrow cv-win-prev"
                  onClick={() => goPage(-1)}
                  disabled={stripPage <= 1}
                  aria-label="Previous tickets"
                >‹</button>
                <button
                  className="cv-win-arrow cv-win-next"
                  onClick={() => goPage(1)}
                  disabled={stripPage >= pageCount}
                  aria-label="Next tickets"
                >›</button>
                <div className="cv-window-dots" aria-hidden="true">
                  {Array.from({ length: pageCount }).map((_, i) => (
                    <span key={i} className={`cv-window-dot ${stripPage === i + 1 ? 'is-on' : ''}`} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* COLLECT — 3D key: red while a win waits, green once banked */}
          <button
            className={`cv-slot cv-key cv-key-collect ${armed ? 'cv-collect-armed' : ''} ${collected ? 'cv-collect-done' : ''}`}
            onClick={collect}
            disabled={!armed}
            title={armed ? `Collect ${claimables.length} winning ticket${claimables.length === 1 ? '' : 's'}` : collected ? 'Winnings banked this round' : 'No claimable ticket'}
          />
          <button className="cv-slot cv-key cv-key-coin" onClick={onCoin} title="Coin slot" />
          <button className="cv-slot cv-key cv-key-spin" onClick={onSpin} title="Spin" />
          <button className="cv-slot cv-key cv-key-max" onClick={onMaxBet} title="Max bet" />

          {/* LCD */}
          <div className="cv-slot cv-lcd">
            <span><i>CRED</i>{credits > 0 ? credits.toLocaleString() : '0'}</span>
            <span className="cv-lcd-sep" />
            <span><i>WIN</i>{lastWin > 0 ? lastWin.toLocaleString() : '0'}</span>
            <span className="cv-lcd-sep" />
            <span><i>BET</i>{bet}</span>
            <span className="cv-lcd-sep" />
            <span><i>CLAIM</i>{claimables.length}</span>
          </div>

          {/* lever */}
          <div className="cv-slot cv-lever" aria-hidden="true">
            <span className="cv-lever-arm" />
          </div>
        </div>
      </div>

      <button
        className={`cv-kill ${confirmKill ? 'cv-kill-armed' : ''}`}
        onClick={() => { if (confirmKill) { setConfirmKill(false); onTerminate() } else setConfirmKill(true) }}
        title={confirmKill ? 'Click again to terminate the session' : 'Terminate this session and return to the lobby'}
      >
        {confirmKill ? '⚠ CONFIRM TERMINATE' : '⏻ TERMINATE SESSION'}
      </button>

      {announcement && <div className="cv-toast cv-toast-arena">{announcement}</div>}
    </div>
  )
}
