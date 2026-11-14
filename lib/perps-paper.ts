'use client';

import { positionPnl, type Side } from './perps';

/**
 * The ticket's fill goes here, not to the venue (§6.30).
 *
 * Placing a Hyperliquid order needs an approved agent wallet and a signed L1
 * action; this build holds no keys and the connected wallet is a local EVM
 * test account. So the ticket books a PAPER position in localStorage, marked
 * against the venue's live prices, and the panel says so on the button. The
 * maths is the same maths a real position would use.
 */

export type PaperPosition = {
  id: string;
  coin: string;
  display: string;
  side: Side;
  entry: number;
  notional: number;
  margin: number;
  leverage: number;
  liq: number;
  tp: number | null;
  sl: number | null;
  openedAt: number;
};

export type PaperClosed = PaperPosition & { exit: number; pnl: number; closedAt: number };

export type PaperBook = { positions: PaperPosition[]; closed: PaperClosed[]; realized: number };

const KEY = 'rf.perps.paper.v1';
const EMPTY: PaperBook = { positions: [], closed: [], realized: 0 };

export function loadBook(): PaperBook {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as PaperBook;
    return {
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      closed: Array.isArray(parsed.closed) ? parsed.closed.slice(0, 25) : [],
      realized: Number(parsed.realized) || 0,
    };
  } catch {
    return EMPTY;
  }
}

export function saveBook(book: PaperBook) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    /* storage full or blocked — the panel keeps its in-memory copy */
  }
}

export function openPaper(
  book: PaperBook,
  pos: Omit<PaperPosition, 'id' | 'openedAt'>,
): PaperBook {
  const next: PaperPosition = {
    ...pos,
    id: `${pos.coin}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    openedAt: Date.now(),
  };
  return { ...book, positions: [next, ...book.positions] };
}

export function closePaper(book: PaperBook, id: string, exit: number): PaperBook {
  const pos = book.positions.find((p) => p.id === id);
  if (!pos) return book;
  const pnl = positionPnl(pos, exit);
  return {
    positions: book.positions.filter((p) => p.id !== id),
    closed: [{ ...pos, exit, pnl, closedAt: Date.now() }, ...book.closed].slice(0, 25),
    realized: book.realized + pnl,
  };
}

/** Total unrealised PnL of the book at the given marks. */
export function bookPnl(book: PaperBook, markOf: (coin: string) => number | undefined): number {
  return book.positions.reduce((sum, p) => {
    const mark = markOf(p.coin);
    return sum + (mark ? positionPnl(p, mark) : 0);
  }, 0);
}
