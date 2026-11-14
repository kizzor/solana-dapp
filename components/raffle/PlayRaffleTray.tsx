'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * THE PLAY RAFFLE RAIL — a small vertical vault, and the cabinet behind it.
 *
 * Closed, all this is is a 46 × 210 glass vault standing in the board's right
 * column, filling with the 59-second draw clock. It is the button.
 *
 * Open, it is a drawer: a right-hand panel on a desktop, the whole screen on a
 * phone (where the vault itself floats over the page instead of taking a
 * column). No modal, no second URL — the same element either way (§6.11.2 is
 * about one venue, not one window).
 *
 * The clock and the fill are local: this is the storefront's window, not a
 * chain read. The machine behind the drawer is what reads the chain.
 */

const CYCLE = 59; // seconds between draws on the demo clock
const DETACH_AT = '(max-width: 900px)'; // below this the vault floats

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the cabinet, mounted only while the drawer is open */
  renderCabinet: (close: () => void) => React.ReactNode;
};

export default function PlayRaffleTray({ open, onOpenChange, renderCabinet }: Props) {
  // One tick counter: the fill and the draw glow are derived from it, so a
  // re-render can never leave them disagreeing.
  const [ticks, setTicks] = useState(0);
  const [detached, setDetached] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTicks((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // The stylesheet does the geometry; this mirror is for the scroll lock.
  useEffect(() => {
    const mq = window.matchMedia(DETACH_AT);
    const sync = () => setDetached(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    // a full-screen drawer covers the page, so freeze the page under it
    const lock = detached;
    const prev = document.body.style.overflow;
    if (lock) document.body.style.overflow = 'hidden';
    return () => {
      if (lock) document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, detached, close]);

  const left = CYCLE - (ticks % CYCLE);
  const fill = ((ticks % CYCLE) / CYCLE) * 100;

  return (
    <div className={`rf-tray ${open ? 'is-open' : ''} ${detached ? 'is-detached' : ''}`}>
      {!open && (
        <button
          type="button"
          className={`rf-vtab ${left <= 6 ? 'is-draw' : ''}`}
          onClick={() => onOpenChange(true)}
          title={`Play Raffle — the vault is ${Math.round(fill)}% to the next draw`}
          aria-label={`Play Raffle: open the slot cabinet (${Math.round(fill)}% to the next draw, ${
            left
          }s)`}
        >
          <span className="rf-vtab-lid" aria-hidden="true" />
          <span className="rf-vtab-glass" aria-hidden="true">
            <span className="rf-vtab-fill" style={{ height: `${fill.toFixed(1)}%` }} />
            <span className="rf-vtab-ticks">
              <i />
              <i />
              <i />
            </span>
          </span>
          <span className="rf-vtab-word" aria-hidden="true">
            Play raffle
          </span>
          <span className="rf-vtab-pct" aria-hidden="true">
            {Math.round(fill)}%
          </span>
        </button>
      )}

      {open && (
        <div
          className="rf-tray-face rf-tray-back"
          role="dialog"
          aria-label="Play Raffle — the cabinet"
        >
          <div className="rf-tray-head rf-tray-head-back">
            <span className="rf-tray-tag">
              <i aria-hidden="true" />
              PLAY RAFFLE
            </span>
            <span className="rf-tray-cab-label">THE CABINET</span>
            <button
              type="button"
              className="rf-tray-x"
              onClick={close}
              aria-label="Close the cabinet"
              autoFocus
            >
              ×
            </button>
          </div>

          <div className="rf-tray-cab-body">{renderCabinet(close)}</div>
        </div>
      )}
    </div>
  );
}
