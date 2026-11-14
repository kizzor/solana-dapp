'use client';

import React, { useEffect, useState } from 'react';
import { REQUIRED_X_LOCK } from '@/lib/robinhood-config';
import { fmtCompact } from '@/lib/launchpad-demo';

type Props = {
  open: boolean;
  onClose: () => void;
  wallet: string | null;
  onConnect: () => void;
  lockedAmount: string;
  xBalance: string;
  lockEligible: boolean;
  /** Live requirement from XLockVault.lockRequirement() (USD-denominated). */
  requiredLock?: number;
  isUnbonding: boolean;
  unlockTimestamp: number;
  onLock: (amount: number) => Promise<unknown>;
  onUnlock: () => Promise<unknown>;
  onWithdraw: () => Promise<unknown>;
  yieldBalance?: string;
  onClaimYield?: () => Promise<unknown>;
};

/** 10% of the required lock is forwarded to the jackpot as fuel (lockFuelBps = 1000). */
const fuelSliceFor = (required: number) => Math.round(required / 10);

function countdown(ts: number, now: number): string {
  const left = ts * 1000 - now;
  if (left <= 0) return 'ready to withdraw';
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return `${h}h ${m}m left`;
}

export default function LockPanel({
  open,
  onClose,
  wallet,
  onConnect,
  lockedAmount,
  xBalance,
  lockEligible,
  requiredLock,
  isUnbonding,
  unlockTimestamp,
  onLock,
  onUnlock,
  onWithdraw,
  yieldBalance,
  onClaimYield,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Transaction failed');
    } finally {
      setBusy(null);
    }
  };

  const lockedNum = Number(lockedAmount) || 0;
  const balanceNum = Number(xBalance) || 0;
  // The lock requirement is priced in dollars on-chain, so it changes with the
  // token price. Round up a hair so the button always clears the requirement.
  const required = Math.ceil(requiredLock ?? REQUIRED_X_LOCK);
  const fuelSlice = fuelSliceFor(required);
  const canLock = wallet && !busy && balanceNum >= required;

  return (
    <div className="rf-drawer-root" role="dialog" aria-modal="true" aria-label="Lock RAFFLE">
      <button className="rf-drawer-scrim" onClick={onClose} aria-label="Close" />
      <aside className="rf-drawer">
        <header className="rf-drawer-head">
          <h3>Lock RAFFLE</h3>
          <button className="rf-drawer-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="rf-drawer-lead">
          Lock <strong>{required.toLocaleString()} RAFFLE</strong> and every ticket costs
          $0.25 instead of $0.50 — a real utility sink, not a price promise. Unbonding takes 24
          hours, and the discount pauses the moment you start.
        </p>

        <p className="rf-drawer-note">
          <strong>10% of every lock is staked straight into the jackpot vault.</strong> Lock
          {fmtCompact(required)} and {fmtCompact(fuelSlice)} goes to the prize reserve while{' '}
          {fmtCompact(required - fuelSlice)} stays yours and comes back after the 24h unbond. The
          discount still turns on at the full {fmtCompact(required)}.
        </p>

        <div className="rf-drawer-stats">
          <div>
            <span>Locked</span>
            <strong>{fmtCompact(lockedNum)}</strong>
          </div>
          <div>
            <span>Wallet balance</span>
            <strong>{fmtCompact(balanceNum)}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong className={lockEligible ? 'is-up' : ''}>
              {isUnbonding ? 'unbonding' : lockEligible ? 'discount on' : 'not locked'}
            </strong>
          </div>
        </div>

        {!wallet ? (
          <button className="rf-cta" onClick={onConnect}>
            Connect wallet
          </button>
        ) : isUnbonding ? (
          <>
            <p className="rf-drawer-note">
              {unlockTimestamp > 0 ? countdown(unlockTimestamp, now) : 'Unbonding started.'}
            </p>
            <button
              className="rf-cta"
              disabled={!!busy}
              onClick={() => run('withdraw', onWithdraw)}
            >
              {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw RAFFLE'}
            </button>
          </>
        ) : lockedNum >= required ? (
          <>
            <p className="rf-drawer-note">
              The lock is active. Starting an unbond removes the discount immediately — the 24h is
              the exit, not a grace period.
            </p>
            <button className="rf-cta is-ghost" disabled={!!busy} onClick={() => run('unlock', onUnlock)}>
              {busy === 'unlock' ? 'Starting unbond…' : 'Start 24h unbond'}
            </button>
          </>
        ) : (
          <>
            <button
              className="rf-cta"
              disabled={!canLock}
              onClick={() => run('lock', () => onLock(required))}
              title={balanceNum < required ? `You need ${required} RAFFLE` : undefined}
            >
              {busy === 'lock'
                ? 'Locking…'
                : balanceNum < required
                  ? `Need ${required.toLocaleString()} RAFFLE`
                  : `Lock ${required.toLocaleString()} RAFFLE`}
            </button>
            <p className="rf-trade-note">
              Approve + lock are two transactions, both signed by you.
            </p>
          </>
        )}

        <section className="rf-drawer-stake" aria-label="Staking split">
          <h4>Staking · the 10% slice</h4>
          <p className="rf-drawer-note">
            {lockedNum > 0
              ? `${fmtCompact(lockedNum)} RAFFLE is your withdrawable principal. ${fmtCompact(
                  Math.round(lockedNum / 9),
                )} has already been staked into the jackpot vault and is not returned.`
              : `Nothing staked yet. A ${required.toLocaleString()} lock sends ${fmtCompact(
                  fuelSlice,
                )} to the prize reserve and keeps ${fmtCompact(
                  required - fuelSlice,
                )} withdrawable.`}
          </p>
          <p className="rf-drawer-note">
            Staking and the jackpot are the same sink: every RAFFLE that enters the reserve makes
            the next board bigger. On top of that, real fee inflows (swap slice + perps bridge/
            builder) accrue to stakers pro-rata — no fixed APR, no minting. Your accrued yield:{' '}
            <strong>{yieldBalance ?? '0'} RAFFLE</strong>.
          </p>
          {onClaimYield && (
            <button
              className="rf-cta is-ghost"
              disabled={!wallet || busy !== null || !(Number(yieldBalance) > 0)}
              onClick={() => run('claim-yield', onClaimYield)}
            >
              {busy === 'claim-yield' ? 'Claiming…' : 'Claim staking yield'}
            </button>
          )}
        </section>

        {err && <p className="rf-err is-block">{err}</p>}
      </aside>
    </div>
  );
}
