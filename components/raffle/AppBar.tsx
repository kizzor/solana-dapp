'use client';

import React from 'react';
import { fmtCompact, shortAddr } from '@/lib/launchpad-demo';
import { REQUIRED_X_LOCK } from '@/lib/robinhood-config';

export type LaunchView = 'board' | 'perps' | 'portfolio' | 'create';

type Props = {
  view: LaunchView;
  onView: (v: LaunchView) => void;
  jackpotUsd: number;
  wallet: string | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  lockEligible: boolean;
  lockedAmount: string;
  /** Live lock requirement from the vault (USD-priced, so it moves). */
  requiredLock?: number;
  onOpenLock: () => void;
};

const NAV: { id: LaunchView; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'perps', label: 'Perps' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'create', label: 'Create' },
];

export default function AppBar({
  view,
  onView,
  jackpotUsd,
  wallet,
  connecting,
  onConnect,
  onDisconnect,
  lockEligible,
  lockedAmount,
  requiredLock,
  onOpenLock,
}: Props) {
  const lockTarget = fmtCompact(Math.ceil(requiredLock ?? REQUIRED_X_LOCK));
  return (
    <header className="rf-bar">
      <div className="rf-bar-inner">
        <button className="rf-brand" onClick={() => onView('board')} aria-label="raffle.fun board">
          <span className="rf-brand-mark" aria-hidden="true">
            7
          </span>
          <span className="rf-brand-text">
            <strong>raffle.fun</strong>
            <em>trade the coin · play the draw</em>
          </span>
        </button>

        <nav className="rf-nav" aria-label="Launchpad">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`rf-nav-btn ${view === n.id ? 'is-on' : ''}`}
              onClick={() => onView(n.id)}
              aria-current={view === n.id ? 'page' : undefined}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="rf-bar-right">
          {/* The one number that must never leave the screen (§6.11.2). */}
          <div className="rf-jackpot" title="Prize pool — funded by 29 of every 30 bps of the platform fee">
            <span className="rf-jackpot-k">
              <i aria-hidden="true" />
              JACKPOT
            </span>
            <strong className="rf-jackpot-v">${fmtCompact(jackpotUsd)}</strong>
          </div>

          <button
            className={`rf-lock-chip ${lockEligible ? 'is-on' : ''}`}
            onClick={onOpenLock}
            title={
              lockEligible
                ? 'Locked — tickets are half price'
                : `Lock ${lockTarget} RAFFLE to mint tickets at $0.25 instead of $0.50`
            }
          >
            <span className="rf-lock-dot" aria-hidden="true" />
            {lockEligible ? (
              <>
                LOCKED {fmtCompact(Number(lockedAmount) || 0)} <em>50% OFF</em>
              </>
            ) : (
              <>
                LOCK {lockTarget} <em>½-PRICE TICKETS</em>
              </>
            )}
          </button>

          {wallet ? (
            <button className="rf-wallet is-on" onClick={onDisconnect} title="Disconnect">
              <span className="rf-wallet-dot" aria-hidden="true" />
              {shortAddr(wallet)}
            </button>
          ) : (
            <button className="rf-wallet" onClick={onConnect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
