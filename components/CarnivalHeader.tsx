'use client'

import React, { useMemo } from 'react'

export type CarnivalHeaderProps = {
  wallet: string | null
  chain: 'evm' | 'solana'
  walletSlot: React.ReactNode
  connectSlot: React.ReactNode
  countdown: number
  vaultTotal: number
  devMode: boolean
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
  onOpenVault: () => void
  onToggleMenu?: () => void
  menuOpen?: boolean
}

export function fmtMMSS(s: number) {
  const m = Math.floor(Math.max(0, s) / 60)
  const ss = Math.max(0, s) % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function TicketNumbers({ numbers, matched }: { numbers: number[]; matched?: number[] }) {
  const hit = useMemo(() => new Set(matched ?? []), [matched])
  return (
    <div className="cv-tk-nums">
      {numbers.map(n => (
        <span key={n} className={`cv-tk-num ${hit.has(n) ? 'cv-tk-num-hit' : ''}`}>
          {n < 10 ? `0${n}` : n}
        </span>
      ))}
    </div>
  )
}

export default function CarnivalHeader({
  wallet, chain, walletSlot, connectSlot, countdown, vaultTotal, devMode, theme = 'dark', onToggleTheme, onOpenVault,
  onToggleMenu, menuOpen,
}: CarnivalHeaderProps) {
  const fill = Math.min(1, Math.max(0, 1 - countdown / (59 * 60)))
  return (
    <header className="cv-lobby-head">
      <div className="cv-lampline cv-lampline-top" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className={`cv-bulb ${i % 3 === 0 ? 'cv-bulb-gold' : i % 3 === 1 ? 'cv-bulb-ruby' : 'cv-bulb-cyan'}`} />
        ))}
      </div>

      <div className="cv-head">
        <div className="cv-brand">
          {onToggleMenu && (
            <button className="cv-menu-btn" onClick={onToggleMenu} aria-expanded={!!menuOpen} aria-label={menuOpen ? 'Close lobby menu' : 'Open lobby menu'}>
              <span /><span /><span />
            </button>
          )}
          <div className="cv-brand-mark">🎰</div>
          <div>
            <h1 className="cv-title">CARNIVAL</h1>
            <p className="cv-sub">15-NUMBER RAFFLE · RETRO SLOT ARENA</p>
          </div>
          {devMode && <span className="cv-dev">DEV MODE</span>}
        </div>

        <div className="cv-head-right">
          <button className="cv-stat cv-stat-btn" onClick={onOpenVault} title="Open decentralized vault claims">
            <span className="cv-stat-k">VAULT</span>
            <strong className="cv-stat-v cv-stat-gold">${vaultTotal.toLocaleString()}</strong>
          </button>
          <div className="cv-stat">
            <span className="cv-stat-k">NEXT DRAW</span>
            <strong className="cv-stat-v">{fmtMMSS(countdown)}</strong>
          </div>
          {onToggleTheme && (
            <button className="cv-icon-btn" onClick={onToggleTheme} title="Light / dark mode">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          )}
          <div className="cv-wallet">{wallet ? walletSlot : connectSlot}</div>
        </div>
      </div>

      <div className="cv-track" aria-hidden="true">
        <div className="cv-track-fill" style={{ width: `${fill * 100}%` }} />
        <span className="cv-track-label">
          Vault filling — {chain === 'evm' ? 'EVM' : 'SOL'} · entries close when the clock hits zero
        </span>
      </div>
    </header>
  )
}
