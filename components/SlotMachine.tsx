'use client'
// ═══════════════════════════════════════════════════════════════════════════════
// CARNIVAL MODE — SLOT MACHINE CABINET (branch: carnival)
// ═══════════════════════════════════════════════════════════════════════════════
// Presentation-only retheme of the HackMatrix draw display. The game engine
// stays untouched upstream in page.tsx: the bingo draw (`currentNum`), the
// 60s window (`clickWindowOpen`), the lobby countdown (`preGameSecs`) and the
// 7 win tiers (`winStates`) are wired in exactly as before.
//
// What the player sees instead:
//   • TWO GIANT ROLLERS — tens drum + units drum. When the engine draws a
//     number the drums blur-spin and snap digit-by-digit (tens first, units
//     second) onto the winning number. Ambient slow drift between rounds.
//   • CARNIVAL LIGHT STATES — every playing state has its own light signature,
//     applying to the marquee bulbs, the side LED strips and the base lamps:
//       LOBBY  : rainbow hue-chase (round initiating)
//       SPIN   : amber strobe (reels are rolling)
//       OPEN   : green/gold pulse (click window is open)
//       CLAIM  : magenta jackpot frenzy (a win is claimable on your tickets)
//       PAID   : emerald steady (a win was paid this round)
//   • PAYLINE LAMPS — one lamp per win tier (FAST FIVE → FULL BANK III) with
//     the real on-chain vault percentages, dimmed when claimed, strobing when
//     claimable. Same CAPSULES contract as the CLAIM frame below the machine.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'

type WinType =
  | 'EARLY_FIVE' | 'TOP_LINE' | 'MIDDLE_LINE' | 'BOTTOM_LINE'
  | 'FULL_HOUSE_1' | 'FULL_HOUSE_2' | 'FULL_HOUSE_3'

export default function SlotMachine({
  currentNum,
  prev5,
  drawn,
  timer,
  preGameSecs,
  clickWindowOpen,
  liveBank,
  bankName,
  winStates,
  claimedWins,
}: {
  currentNum: number | null
  prev5: number[]
  drawn: number
  timer: number
  preGameSecs: number
  clickWindowOpen: boolean
  liveBank: number
  bankName: string
  winStates: Record<string, { claimed: boolean; claimable: boolean }>
  claimedWins: number
}) {
  const CELL = 118 // px height of one digit cell on the drums
  const STRIP = Array.from({ length: 30 }, (_, i) => i % 10) // 0-9 × 3 laps

  // ── Reel engine: { spinning, digit } ×2 — tens drum stops first ──────────
  const [tens, setTens] = useState<{ spinning: boolean; digit: number | null }>({ spinning: false, digit: null })
  const [units, setUnits] = useState<{ spinning: boolean; digit: number | null }>({ spinning: false, digit: null })
  const lastDrawRef = useRef<number | null>(null)

  useEffect(() => {
    if (currentNum === null || currentNum === lastDrawRef.current) return
    lastDrawRef.current = currentNum
    const t = Math.floor(currentNum / 10)
    const u = currentNum % 10
    setTens({ spinning: true, digit: t })
    setUnits({ spinning: true, digit: u })
    const t1 = setTimeout(() => setTens({ spinning: false, digit: t }), 1050)
    const t2 = setTimeout(() => setUnits({ spinning: false, digit: u }), 1800)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [currentNum])

  const anySpinning = tens.spinning || units.spinning

  // ── Light-state resolution (uniform decision for strips + lamps) ─────────
  const jackpotHit = Object.values(winStates).some(ws => ws?.claimable && !ws?.claimed)
  const paidThisRound = Object.values(winStates).some(ws => ws?.claimed)
  const inLobby = preGameSecs > 0
  const ledMode: 'jackpot' | 'roll' | 'open' | 'lobby' | 'idle' =
    jackpotHit ? 'jackpot' : anySpinning ? 'roll' : clickWindowOpen ? 'open' : inLobby ? 'lobby' : 'idle'

  // ── Drum transform math ──────────────────────────────────────────────────
  const LED_MODES: Record<typeof ledMode, { color: string; anim: string; label: string; hot: boolean }> = {
    jackpot: { color: '#ff007f', anim: 'carnivalStrobe 0.09s infinite', label: 'JACKPOT LINE — CLAIM', hot: true },
    roll: { color: '#ff7a18', anim: 'carnivalStrobe 0.1s infinite', label: 'REELS ROLLING…', hot: true },
    open: { color: '#6ee7b7', anim: 'carnivalStrobe 0.85s infinite', label: 'PLAY WINDOW OPEN', hot: true },
    lobby: { color: '#c084fc', anim: 'carnivalStrobe 1.3s infinite', label: 'ROUND INITIATING', hot: false },
    idle: { color: '#22d3ee', anim: 'carnivalStrobe 2.4s infinite', label: 'AWAITING DRAW', hot: false },
  }
  const led = LED_MODES[ledMode]

  // ── Payline lamps — one per win tier, wired to the live win states ────────
  const PAYLINE: { wt: WinType; code: string; label: string; pct: number; color: string }[] = [
    { wt: 'EARLY_FIVE', code: 'FF', label: 'FAST FIVE', pct: 5, color: '#f59e0b' },
    { wt: 'TOP_LINE', code: 'TA', label: 'TOP LINE', pct: 5, color: '#c084fc' },
    { wt: 'MIDDLE_LINE', code: 'CA', label: 'MID LINE', pct: 5, color: '#a78bfa' },
    { wt: 'BOTTOM_LINE', code: 'BA', label: 'BOTTOM', pct: 5, color: '#fbbf24' },
    { wt: 'FULL_HOUSE_1', code: 'FB1', label: 'FULL BANK I', pct: 19.5, color: '#f472b6' },
    { wt: 'FULL_HOUSE_2', code: 'FB2', label: 'FULL BANK II', pct: 19.5, color: '#ec4899' },
    { wt: 'FULL_HOUSE_3', code: 'FB3', label: 'JACKPOT', pct: 40, color: '#ff007f' },
  ]

  // ── Drum transform math ────────────────────────────────────────────────────
  // Strip = 30 cells (3 laps of 0-9). We window into the third lap so the
  // settled digit always has fresh cells below it for the drift animations.
  const settledTf = (digit: number) => `translateY(${-(20 + digit) * CELL}px)`
  const tensTf = tens.spinning || tens.digit === null ? undefined : settledTf(tens.digit)
  const unitsTf = units.spinning || units.digit === null ? undefined : settledTf(units.digit)

  return (
    <div
      className="carn-cabinet"
      style={{
        position: 'relative', zIndex: 2, borderRadius: 24, overflow: 'hidden',
        background: 'linear-gradient(180deg,#2a0a18 0%,#1d0714 45%,#14040e 100%)',
        border: '3px solid #b45309',
        boxShadow: `0 0 24px rgba(180,83,9,0.35), inset 0 0 60px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,196,0,0.25)`,
        display: 'flex', flexDirection: 'column', gap: 10,
        animation: jackpotHit ? 'carnivalJackpot 0.55s ease-in-out infinite' : 'none',
      }}
    >
      {/* ════ MARQUEE HEADER — arched gold fascia + chasing bulbs ════ */}
      <div style={{ position: 'relative', padding: '14px 14px 8px', background: 'linear-gradient(180deg,#431407,#2a0a18 70%)', borderBottom: '2px solid #92400e' }}>
        {/* title */}
        <div style={{ textAlign: 'center' }}>
          <span style={{
            fontFamily: 'Syne,sans-serif', fontWeight: 900, fontSize: 24, letterSpacing: '0.22em',
            background: 'linear-gradient(180deg,#fff7cc 10%,#ffc400 45%,#ff5e0a 90%)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            animation: 'carnivalMarqueeGlow 2.2s ease-in-out infinite',
          }}>
            ⚡ CARNIVAL MATRIX ⚡
          </span>
        </div>
        {/* bulb arch — alternating candy bulbs, chase delay staggering */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 9 }}>
          {Array.from({ length: 21 }, (_, i) => {
            const cols = ['#ffd166', '#ff7a18', '#22d3ee', '#ff007f']
            return <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%', color: cols[i % cols.length],
              background: 'currentColor',
              animation: 'carnivalBulb 0.9s ease-in-out infinite', animationDelay: `${(i % 2) * 0.45 + Math.floor(i / 2) * 0.05}s`,
            }} />
          })}
        </div>
      </div>

      {/* ════ MACHINE BODY — side LED strips + dual rollers + info screens ════ */}
      <div style={{ position: 'relative', display: 'flex', gap: 10, padding: '10px 12px 6px' }}>

        {/* LEFT vertical LED strip */}
        <LedStrip side="left" led={led} />

        {/* CENTER STACK */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>

          {/* ROLLER DECK — classic 4-window chassis: 2 reel windows (outer)
              + 2 stat windows (inner, wired up later: vault, players, …) */}
          <div style={{
            position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'stretch',
            background: 'linear-gradient(180deg,#16040c,#0d0208 90%)',
            border: '2px solid #78350f', borderRadius: 16, padding: '10px 12px',
            boxShadow: 'inset 0 0 30px rgba(0,0,0,0.7), 0 0 14px rgba(120,53,15,0.35)',
          }}>
            <Reel drum={tens} tf={tensTf} cell={CELL} strip={STRIP} side="TENS" />
            <StatSlab label="VAULT" cell={CELL} ledColor={led.color} />
            <StatSlab label="PLAYERS" cell={CELL} ledColor={led.color} />
            <Reel drum={units} tf={unitsTf} cell={CELL} strip={STRIP} side="UNITS" />
            {/* deck glass sheen */}
            <div style={{ position: 'absolute', inset: 6, borderRadius: 12, pointerEvents: 'none', background: 'linear-gradient(115deg,rgba(255,255,255,0.09) 0%,transparent 22%,transparent 70%,rgba(255,255,255,0.05) 100%)' }} />
          </div>

          {/* Status pill + last-hit chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 11px', borderRadius: 20,
              background: `rgba(0,0,0,0.5)`, border: `1px solid ${led.color}`,
              boxShadow: led.hot ? `0 0 10px ${led.color}66` : 'none',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: led.color, boxShadow: `0 0 6px ${led.color}`, animation: led.hot ? 'carnivalStrobe 0.5s infinite' : 'carnivalLampPulse 2s infinite' }} />
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', color: led.color }}>{led.label}</span>
            </div>
            {/* previous hits — popped tokens */}
            {prev5.length > 0 && (
              <div style={{ display: 'flex', gap: 4 }}>
                {prev5.map((n, i) => (
                  <div key={i} style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'radial-gradient(circle at 35% 30%,#fff3c4,#f59e0b 55%,#92400e)', border: '1px solid #fbbf24',
                    fontFamily: 'Syne,sans-serif', fontSize: 10, fontWeight: 800, color: '#3b1d04',
                    boxShadow: '0 0 7px rgba(245,158,11,0.55)', opacity: 0.85 - i * 0.13, margin: 1,
                  }}>{n}</div>
                ))}
              </div>
            )}
            {/* paid counter */}
            <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono,monospace', fontSize: 8, color: paidThisRound ? '#34d399' : '#6b4423', letterSpacing: '0.12em' }}>
              ✓ {claimedWins}/7 PAID
            </span>
          </div>
        </div>

        {/* RIGHT vertical LED strip */}
        <LedStrip side="right" led={led} />
      </div>

      {/* ════ CONTROL DECK — bank screen · rounds meter · 60s window clock ════ */}
      <div style={{ display: 'flex', gap: 8, padding: '0 12px 4px', alignItems: 'stretch' }}>
        {/* bank screen */}
        <div style={{ flex: '0 1 260px', minWidth: 0, background: '#08040a', border: '1px solid #78350f', borderRadius: 10, padding: '5px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, boxShadow: 'inset 0 0 16px rgba(0,0,0,0.8)' }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 7, color: '#92400e', letterSpacing: '0.1em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🎪 {bankName.toUpperCase()}</span>
          <span style={{ fontFamily: 'Syne,sans-serif', fontSize: 16, fontWeight: 800, color: '#ffc400', textShadow: '0 0 10px rgba(255,196,0,0.8)', whiteSpace: 'nowrap' }}>{drawn}/90</span>
        </div>
        {/* rounds progress meter */}
        <div style={{ flex: 1, minWidth: 90, display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '100%', height: 6, background: '#0d0208', borderRadius: 3, overflow: 'hidden', border: '1px solid #78350f' }}>
            <div style={{ height: '100%', width: `${Math.round((drawn / 90) * 100)}%`, borderRadius: 3, transition: 'width 0.6s ease', background: 'linear-gradient(90deg,#ffc400,#ff7a18,#ff007f)', boxShadow: '0 0 8px rgba(255,196,0,0.6)' }} />
          </div>
        </div>
        {/* 60s window clock */}
        <div style={{ marginLeft: 'auto', background: '#08040a', border: '1px solid #78350f', borderRadius: 10, padding: '3px 16px', boxShadow: 'inset 0 0 16px rgba(0,0,0,0.8)' }}>
          <span style={{ fontFamily: 'Syne,sans-serif', fontSize: 26, fontWeight: 800, lineHeight: 1.1, color: timer % 60 <= 10 ? '#ff4d6d' : '#ff7a18', textShadow: timer % 60 <= 10 ? '0 0 14px rgba(255,77,109,0.9)' : '0 0 14px rgba(255,122,24,0.85)' }}>{String(timer % 60).padStart(2, '0')}</span>
        </div>
      </div>

      {/* ════ PAYLINE LAMPS — one per win tier (same CAPSULES contract) ════ */}
      <div style={{ display: 'flex', gap: 5, padding: '4px 12px 10px' }}>
        {PAYLINE.map(pl => {
          const ws = winStates[pl.wt]
          const claimed = ws?.claimed, claimable = ws?.claimable && !ws?.claimed
          const on = !!claimable, dim = !!claimed
          return (
            <div key={pl.code} style={{
              flex: 1, minWidth: 0, textAlign: 'center', borderRadius: 8, padding: '5px 3px 6px',
              background: 'rgba(13,2,8,0.75)', border: `1px solid ${dim ? 'rgba(52,211,153,0.5)' : on ? pl.color : 'rgba(120,53,15,0.5)'}`,
              boxShadow: on ? `0 0 12px ${pl.color}88, inset 0 0 8px ${pl.color}44` : 'none',
              animation: on ? 'carnivalStrobe 0.09s infinite' : 'none', opacity: dim ? 0.55 : 1,
            }}>
              {/* lamp */}
              <div style={{ margin: '0 auto 3px', width: 10, height: 10, borderRadius: '50%', background: dim ? '#134e31' : on ? pl.color : '#3b1d0a', color: dim ? '#34d399' : on ? pl.color : '#80512a', boxShadow: `0 0 ${on ? 10 : 4}px currentColor`, animation: on ? 'none' : 'carnivalLampPulse 2.6s infinite' }} />
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 7, fontWeight: 700, color: dim ? '#34d399' : on ? '#fff' : '#b45309', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dim ? 'PAID ✓' : on ? 'HIT!' : pl.label}</div>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 6, color: on ? '#ffd166' : '#92400e' }}>{pl.pct}%</div>
            </div>
          )
        })}
      </div>

      {/* ════ LOBBY OVERLAY — reel deck covered until round initiates ════ */}
      {preGameSecs > 0 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 8, borderRadius: 21, background: 'rgba(13,2,8,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#ffd166', letterSpacing: '0.25em' }}>REELS SPIN IN</div>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 46, fontWeight: 900, color: '#ffc400', lineHeight: 1, textShadow: '0 0 26px rgba(255,196,0,0.95),0 0 66px rgba(255,122,24,0.5)' }}>{fmtClock(preGameSecs)}</div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b45309', letterSpacing: '0.14em' }}>ACTIVATE YOUR TICKETS NOW</div>
        </div>
      )}

      {/* base LED strip footer */}
      <div style={{ position: 'relative', height: 6, overflow: 'hidden', background: '#14040e' }}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg,${led.color},#ffc400 30%,#ff007f 60%,${led.color})`, opacity: 0.85, animation: led.anim, filter: 'blur(1px)' }} />
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtClock(total: number) {
  const m = Math.floor(total / 60), s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── LED strip ────────────────────────────────────────────────────────────────

function LedStrip({ side, led }: { side: 'left' | 'right'; led: { color: string; anim: string; label: string; hot: boolean } }) {
  return (
    <div style={{
      flex: '0 0 14px', alignSelf: 'stretch', position: 'relative', borderRadius: 7, overflow: 'hidden',
      background: `linear-gradient(180deg,${led.color}22,${led.color}44 40%,${led.color}22)`,
      border: `1px solid ${led.color}66`, boxShadow: `0 0 10px ${led.color}55`,
      display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', padding: '4px 0',
    }}>
      {/* bulb ladder */}
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{
          width: 5, height: 12, borderRadius: 3, background: led.color,
          boxShadow: `0 0 6px ${led.color}`, opacity: 0.75,
          animation: 'carnivalBulb 1.2s ease-in-out infinite', animationDelay: `${i * 0.13}s`,
        }} />
      ))}
      {/* sweeping highlight */}
      <div style={{
        position: 'absolute', left: 1, right: 1, height: 18, borderRadius: 4,
        background: `linear-gradient(180deg,transparent,${led.color},transparent)`,
        opacity: 0.9, animation: 'carnivalLedChase 1.5s linear infinite',
      }} />
    </div>
  )
}

// ── Lights: the strip cabinet refreshes its sweep on every mode change ─────

// ── Reel drum ────────────────────────────────────────────────────────────────

// Reserved stat window — same glass-frame dims as a reel, hosts a live stat
// readout later (vault amount, player count, …). For now it glows with the
// cabinet's state color so the light system covers it too.
function StatSlab({ label, cell, ledColor }: { label: string; cell: number; ledColor: string }) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{
        position: 'relative', height: cell, borderRadius: 12, overflow: 'hidden',
        background: 'linear-gradient(180deg,#050207 0%,#180413 20%,#0b020e 100%)',
        border: '2px solid #b45309',
        boxShadow: 'inset 0 8px 22px rgba(0,0,0,0.85), inset 0 -8px 22px rgba(0,0,0,0.85), inset 0 0 18px rgba(255,0,127,0.08)',
      }}>
        {/* amber screen scanlines */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg,transparent 0 2px,rgba(255,196,0,0.05) 2px 4px)', pointerEvents: 'none' }} />
        {/* corner bulbs tracking the cabinet state light */}
        {(['tl', 'tr'] as const).map(c => (
          <div key={c} style={{
            position: 'absolute', top: 5, [c === 'tl' ? 'left' : 'right']: 5, width: 6, height: 6, borderRadius: '50%',
            background: ledColor, boxShadow: `0 0 6px ${ledColor}`, animation: 'carnivalBulb 1.1s infinite',
          } as React.CSSProperties} />
        ))}
        {/* placeholder readout — swaps out when the real stat renders */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
          <span style={{ fontFamily: 'Syne,sans-serif', fontWeight: 900, fontSize: cell * 0.14, letterSpacing: '0.2em', color: 'rgba(255,196,0,0.4)', animation: 'carnivalLampPulse 2.8s infinite' }}>— ▯▯▯ —</span>
        </div>
      </div>
      {/* slab footer tag */}
      <div style={{ textAlign: 'center', marginTop: 4, fontFamily: 'DM Mono,monospace', fontSize: 7, letterSpacing: '0.3em', color: '#92400e' }}>STAT·{label}</div>
    </div>
  )
}

function Reel({
  drum, tf, cell, strip, side,
}: {
  drum: { spinning: boolean; digit: number | null }
  tf: string | undefined
  cell: number
  strip: number[]
  side: 'TENS' | 'UNITS'
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{
        position: 'relative', height: cell, borderRadius: 12, overflow: 'hidden',
        background: 'linear-gradient(180deg,#050207 0%,#1b0713 18%,#fff0 55%,#1b0713 84%,#050207 100%)',
        border: '2px solid #b45309', boxShadow: 'inset 0 8px 22px rgba(0,0,0,0.85), inset 0 -8px 22px rgba(0,0,0,0.85)',
        // CSS var consumed by the carnival drum keyframes
        ...( { ['--carn-cell' as string]: `${cell}px` } as React.CSSProperties),
      }}>
        {/* digit strip */}
        <div style={{
          transform: tf,
          transition: !drum.spinning && tf ? 'transform 0.42s cubic-bezier(.2,1.4,.35,1)' : 'none',
          animation: drum.spinning ? 'carnivalReelSpin 0.16s linear infinite' : drum.digit === null ? 'carnivalReelIdle 3.2s linear infinite' : 'none',
          filter: drum.spinning ? 'blur(2px)' : 'none',        }}>          {strip.map((d, i) => (
            <div key={i} style={{
              height: cell, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(180deg,#241022,#12060d)',
              borderBottom: '1px solid rgba(180,83,9,0.25)',
            }}>
              <span style={{
                fontFamily: 'Syne,sans-serif', fontWeight: 900, fontSize: cell * 0.52, lineHeight: 1,
                background: 'linear-gradient(180deg,#fff3c4 5%,#ffc400 48%,#b45309 100%)',
                WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                textShadow: '0 0 24px rgba(255,196,0,0.35)',
              }}>{d}</span>
            </div>
          ))}
        </div>
        {/* center payline notch — where the winning digit rests */}
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', height: '42%', border: '2px solid rgba(255,196,0,0.4)', borderRadius: 8, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', left: 6, right: 6, transform: 'translateY(-50%)', height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,196,0,0.55),transparent)', pointerEvents: 'none' }} />
      </div>
      {/* drum label */}
      <div style={{ textAlign: 'center', marginTop: 4, fontFamily: 'DM Mono,monospace', fontSize: 7, letterSpacing: '0.3em', color: drum.spinning || drum.digit === null ? '#92400e' : '#ffc400' }}>{side}{side === 'TENS' ? ' ✕10' : ' ✕1'}</div>
    </div>
  )
}
