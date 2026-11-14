/**
 * The cabinet's board rules + the local ticket store.
 *
 * Two things live here, both mirroring the chain exactly:
 *
 *  1. **The board shape.** `GridLib.validate` (contracts/GridLib.sol) accepts a
 *     3×9 card holding exactly 15 distinct numbers, 1–90, five per row; an empty
 *     cell is 0. `isValidBoard` is the same check, client-side, so a card is
 *     never shipped to a mint that would revert.
 *
 *  2. **The cold-board rule.** `RansomeGame.mint*` refuses a board holding a
 *     number that is already on the wall (§6.18.13). The generator therefore
 *     draws from `1..90 − drawn`, which is a hard constraint on this UI, not a
 *     preference.
 *
 * The ticket store exists because the contract keeps only `keccak(gridHash)`:
 * `claimWin` needs the revealed board, so the player's own boards must be
 * remembered between visits. It is a *convenience* store, never an authority —
 * a lost or corrupt entry can only make a claim unavailable in this browser,
 * never mint value.
 */

export const BOARD_ROWS = 3;
export const BOARD_COLS = 9;
export const BOARD_CELLS = BOARD_ROWS * BOARD_COLS; // 27
export const NUMBERS_PER_BOARD = 15;
export const NUMBERS_PER_ROW = 5;
export const MAX_NUMBER = 90;

/** 27 cells, row-major, 0 = empty. */
export type Board = number[];

export type TierState = {
  hits: number;
  earlyFive: boolean;
  lines: [boolean, boolean, boolean];
  fullHouse: boolean;
};

/* ── rules ──────────────────────────────────────────────────────────────── */

export function boardNumbers(board: Board): number[] {
  return board.filter((n) => n > 0);
}

/** Mirrors GridLib.validate: 5 per row, 15 distinct, all 1–90. */
export function isValidBoard(board: Board): boolean {
  if (board.length !== BOARD_CELLS) return false;
  const seen = new Set<number>();
  for (let r = 0; r < BOARD_ROWS; r++) {
    let filled = 0;
    for (let c = 0; c < BOARD_COLS; c++) {
      const n = board[r * BOARD_COLS + c];
      if (!n) continue;
      if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) return false;
      if (seen.has(n)) return false;
      seen.add(n);
      filled++;
    }
    if (filled !== NUMBERS_PER_ROW) return false;
  }
  return seen.size === NUMBERS_PER_BOARD;
}

/**
 * A fresh card containing none of the numbers already drawn. Randomness is
 * injectable so a test (or a deterministic preview) can pin it.
 */
export function generateColdBoard(
  drawn: readonly number[] = [],
  rnd: () => number = Math.random,
): Board {
  const taken = new Set(drawn);
  const pool: number[] = [];
  for (let n = 1; n <= MAX_NUMBER; n++) if (!taken.has(n)) pool.push(n);

  if (pool.length < NUMBERS_PER_BOARD) {
    throw new Error('Too many numbers drawn to print a cold board');
  }

  const board: Board = new Array(BOARD_CELLS).fill(0);
  for (let r = 0; r < BOARD_ROWS; r++) {
    // pick 5 numbers for this row
    const nums: number[] = [];
    for (let i = 0; i < NUMBERS_PER_ROW; i++) {
      const idx = Math.floor(rnd() * pool.length);
      nums.push(pool.splice(idx, 1)[0]);
    }
    nums.sort((a, b) => a - b);

    // scatter them across the row's 9 cells, printed left to right
    const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const chosen = slots.slice(0, NUMBERS_PER_ROW).sort((a, b) => a - b);
    chosen.forEach((col, i) => {
      board[r * BOARD_COLS + col] = nums[i];
    });
  }
  return board;
}

/** Numbers on this board that are on the wall. Used to refuse a clone-by-hand. */
export function boardHits(board: Board, drawn: readonly number[]): number[] {
  const wall = new Set(drawn);
  return boardNumbers(board).filter((n) => wall.has(n));
}

/**
 * The tiers this board has actually completed, recomputed from the wall.
 * EARLY_FIVE is the fifth-earliest hit; the lines are per row; the full house is
 * all fifteen — exactly `GridLib.completedAt`'s arithmetic.
 */
export function tierState(board: Board, drawn: readonly number[]): TierState {
  const wall = new Set(drawn);
  const hits = boardNumbers(board).filter((n) => wall.has(n)).length;

  const lines: [boolean, boolean, boolean] = [true, true, true];
  for (let r = 0; r < BOARD_ROWS; r++) {
    let filled = 0;
    let hit = 0;
    for (let c = 0; c < BOARD_COLS; c++) {
      const n = board[r * BOARD_COLS + c];
      if (!n) continue;
      filled++;
      if (wall.has(n)) hit++;
    }
    lines[r] = filled === NUMBERS_PER_ROW && hit === filled;
  }

  return {
    hits,
    earlyFive: hits >= 5,
    lines,
    fullHouse: hits >= NUMBERS_PER_BOARD,
  };
}

/** winType → the rung labels the cabinet can print. 4–6 are the FH ladder. */
export const TIER_LABELS: Record<number, string> = {
  0: 'Early five',
  1: 'Top line',
  2: 'Middle line',
  3: 'Bottom line',
  4: 'Full house',
  5: 'Full house',
  6: 'Full house',
};

/* ── the local ticket store ─────────────────────────────────────────────── */

export type TicketRail = 'RAFFLE' | 'USDG';

export type StoredTicket = {
  /** decimal string — device ids are per session, and a session id is a uint256 */
  sessionId: string;
  /** the contract's device id (never the app's local counter) */
  deviceId: number;
  board: Board;
  rail: TicketRail;
  at: number;
};

const STORE_PREFIX = 'raffle.fun/tickets';

function storeKey(chainId: number, address: string): string {
  return `${STORE_PREFIX}/${chainId}/${address.toLowerCase()}`;
}

export function loadTickets(chainId: number, address: string | null): StoredTicket[] {
  if (!address || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storeKey(chainId, address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredTicket[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) =>
        t &&
        typeof t.deviceId === 'number' &&
        typeof t.sessionId === 'string' &&
        Array.isArray(t.board) &&
        t.board.length === BOARD_CELLS,
    );
  } catch {
    return [];
  }
}

export function saveTickets(chainId: number, address: string, tickets: StoredTicket[]): void {
  if (!address || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storeKey(chainId, address), JSON.stringify(tickets));
  } catch {
    // A full or disabled localStorage must not break a mint that already landed:
    // the ticket is on chain, only this browser's copy is missing.
  }
}

/** Appends freshly minted tickets, replacing any stale record of the same device id. */
export function addTickets(
  chainId: number,
  address: string,
  added: StoredTicket[],
): StoredTicket[] {
  const existing = loadTickets(chainId, address);
  const byId = new Map<string, StoredTicket>();
  for (const t of existing) byId.set(`${t.sessionId}:${t.deviceId}`, t);
  for (const t of added) byId.set(`${t.sessionId}:${t.deviceId}`, t);
  const next = Array.from(byId.values()).sort((a, b) => a.at - b.at);
  saveTickets(chainId, address, next);
  return next;
}
