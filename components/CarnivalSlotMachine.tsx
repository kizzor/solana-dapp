'use client'

import React, { useMemo, useEffect, useState } from 'react'
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

// Compute claimable status from matched numbers
// Early Five: 5+ matches
// Line: 3 matching numbers in a row
function computeClaimable(matched: number[], numbers: number[]): boolean {
  const matchedSet = new Set(matched)
  // Check for 5+ matches (Early Five)
  if (matchedSet.size >= 5) return true
  // Check for a line: 3 numbers that could be in a row
  // Tickets have 15 numbers in a 3x5 grid (3 rows of 5)
  // Check if any 3 matched numbers are in the same row of 5
  const sorted = [...matchedSet].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length - 2; i++) {
    // If 3 consecutive-ish numbers within a span of 15, likely a row
    if (sorted[i + 2] - sorted[i] <= 15) return true
  }
  return false
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

const LIGHT_TONE: Record<string, string> = {
  ff: 'cv-light-red',
  r1: 'cv-light-orange',
  r2: 'cv-light-yellow',
  r3: 'cv-light-green',
  fh1: 'cv-light-cyan',
  fh2: 'cv-light-blue',
  fh3: 'cv-light-pink',
}

export default function CarnivalSlotMachine({
  round, currentNum, prevNum, countdown, sessionSecs, preGameSecs,
  tickets, onClaim, vaultTotal, claimableCount, claimableTotal, lastWin, credits, bet = 10,
  onOpenVault, announcement, onTerminate, onSpin, onMaxBet, onCoin,
  lights = DEFAULT_LIGHTS,
}: CarnivalSlotMachineProps) {
  const [confirmKill, setConfirmKill] = React.useState(false)
  React.useEffect(() => {
    if (!confirmKill) return
    const t = setTimeout(() => setConfirmKill(false), 4000)
    return () => clearTimeout(t)
  }, [confirmKill])

  // Auto-update matched numbers state when currentNum changes
  const [updatedTickets, setUpdatedTickets] = useState(tickets)
  useEffect(() => {
    if (!currentNum) return
    const newTickets = updatedTickets.map(ticket => {
      const alreadyMatched = new Set(ticket.matched)
      // Add current number if it's in the ticket's numbers and not already matched
      if (ticket.numbers.includes(currentNum) && !alreadyMatched.has(currentNum)) {
        const newMatched = [...ticket.matched, currentNum]
        // Determine if this makes the ticket claimable
        const claimable = computeClaimable(newMatched, ticket.numbers)
        return {
          ...ticket,
          matched: newMatched,
          claimable,
          win: claimable ? true : ticket.win
        }
      }
      return ticket
    })
    setUpdatedTickets(newTickets)
  }, [currentNum, updatedTickets])

  // Recompute ranked tickets based on updated state
  const ranked = useMemo(() => {
    return [...updatedTickets].sort((a, b) => {
      if (a.claimable !== b.claimable) return a.claimable ? -1 : 1
      if (a.win !== b.win) return a.win ? -1 : 1
      return b.matched.length - a.matched.length
    })
  }, [updatedTickets])

  const windowTickets = ranked.slice(0, 2)
  const boardTickets = ranked.slice(0, 3)
  const warm = currentNum !== null && preGameSecs === 0
  const spinning = preGameSecs > 0 || !warm

  return (
    <div className="cv-shell cv-shell-arena">
      <header className="cv-arena-head">
        <div className="cv-arena-brand">
          <span className="cv-arena-live">● LIVE</span>
          <span className="cv-arena-session">SESSION {fmtMMSS(sessionSecs)}</span>
        </div>
        <div className="cv-arena-stats">
          <span>ROUND <strong>{round}</strong></span>
          <span>NEXT DRAW <strong className="cv-gold">{preGameSecs > 0 ? '--' : fmtMMSS(countdown)}</strong></span>
          <span>TICKETS <strong>{tickets.length}</strong></span>
        </div>
      </header>

      {/* ═══ CABINET (shared design: 1024×553 art, overlays in %) ═══ */}
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

        {/* 7 banner lights: FF / R1 / R2 / R3 / FH1 / FH2 / FH3 */}
        <div className="cv-slot cv-lights">
          {lights.map(l => (
            <div
              key={l.id}
              className={`cv-light ${LIGHT_TONE[l.id] || ''} ${l.lit ? 'cv-light-on' : ''}`}
              title={l.label}
            >
              <span className="cv-light-dome">
                <span className="cv-light-glare" />
                <span className="cv-light-label">{l.label}</span>
              </span>
            </div>
          ))}
        </div>

        {/* round plate */}
        <div className="cv-slot cv-slot-round">
          <span className="cv-slot-k">ROUND</span>
          <span className="cv-slot-v">{round}</span>
        </div>

        {/* vault plate */}
        <div className="cv-slot cv-slot-vault">
          <div className="cv-gold-bar"><span>999.9</span></div>
          <div className="cv-gold-bar cv-gold-bar-sm"><span>GOLD</span></div>
          <div className="cv-gold-bar cv-gold-bar-sm"><span>VAULT</span></div>
          <div className="cv-vault-amount cv-vault-amount-sm">
            ${(vaultTotal / 1_000_000).toFixed(2)}M
          </div>
        </div>

        {/* CRT screen — single roller */}
        <div className={`cv-slot cv-screen ${spinning ? 'cv-screen-waiting' : ''}`}>
          <div className="cv-crt" aria-hidden="true" />
          <div className="cv-scan" aria-hidden="true" />
          <div className="cv-raster" aria-hidden="true" />

          <div className="cv-roller">
            <div className="cv-roller-k">
              CARNIVAL ROLLER{warm ? ` · DRAW #${round}` : ''}
            </div>
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

        {/* ticket window — the 2 closest tickets, under the screen */}
        <div className={`cv-slot cv-window ${claimableCount > 0 ? 'cv-window-hot' : ''}`}>
          {windowTickets.length === 0 ? (
            <div className="cv-window-empty">NO TICKETS IN WINDOW</div>
          ) : (
            windowTickets.map(t => (
              <div key={t.id} className={`cv-window-ticket ${t.claimable ? 'cv-window-win' : ''}`}>
                <div className="cv-window-head">
                  <span className="cv-window-serial">{t.serial}</span>
                  <span className="cv-window-hits">{t.matched.length}/15</span>
                </div>
                <TicketNumbers numbers={t.numbers} matched={t.matched} />
                {t.claimable ? (
                  <button className="cv-window-claim" onClick={() => onClaim(t.id)}>CLAIM</button>
                ) : (
                  <span className="cv-window-state">{t.win ? 'BANKED' : 'CLOSEST'}</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* collect / coin / spin / max bet — the machine's own keys */}
        <button
          className={`cv-slot cv-key cv-key-collect ${claimableCount > 0 ? 'cv-collect-live' : ''}`}
          onClick={() => { const t = ranked.find(r => r.claimable); if (t) onClaim(t.id) }}
          title={claimableCount > 0 ? 'Collect winnings' : 'No claimable ticket'}
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
          <span><i>CLAIM</i>{claimableCount}</span>
        </div>

        {/* lever */}
        <div className="cv-slot cv-lever" aria-hidden="true">
          <span className="cv-lever-arm" />
        </div>
      </div>

      {/* ═══ readable ticket rail + actions ═══ */}
      <section className="cv-board">
        <div className="cv-board-head">
          <span className="cv-board-k">TICKET WINDOW — CLOSEST TO A WIN</span>
          <span className="cv-board-note">
            {claimableCount > 0
              ? `${claimableCount} WINNING TICKET${claimableCount > 1 ? 'S' : ''} — HIT CLAIM`
              : claimableTotal > 0
                ? `$${claimableTotal.toLocaleString()} pending`
                : 'claimed wins are banked in the decentralized vault'}
          </span>
        </div>
        <div className="cv-board-grid">
          {boardTickets.length === 0 && <div className="cv-empty">No tickets held — mint one in the lobby.</div>}
          {boardTickets.map((t, i) => (
            <div key={t.id} className={`cv-board-ticket ${t.claimable ? 'cv-board-win' : ''} cv-tk-${['ruby', 'gold', 'sapphire'][i % 3]}`}>
              <div className="cv-board-ticket-head">
                <span className="cv-ticket-serial">{t.serial}</span>
                <span className="cv-board-hits">{t.matched.length} HIT{t.matched.length === 1 ? '' : 'S'}</span>
              </div>
              <TicketNumbers numbers={t.numbers} matched={t.matched} />
              <div className="cv-board-ticket-foot">
                <span className="cv-board-state">
                  {t.claimable ? 'WIN — CLAIM NOW' : t.win ? 'BANKED' : 'IN PLAY'}
                </span>
                {t.claimable && <button className="cv-btn cv-btn-green" onClick={() => onClaim(t.id)}>CLAIM</button>}
                {!t.claimable && t.prizeLabel && <span className="cv-board-prize">{t.prizeLabel}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="cv-board-foot">
          <button className="cv-btn" onClick={onOpenVault}>⚿ VAULT CLAIMS</button>
          <span className="cv-board-tip">
            Numbers are marked automatically each draw. Winning tickets blink green until claimed.
          </span>
        </div>
      </section>

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
