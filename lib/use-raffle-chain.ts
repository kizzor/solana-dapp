/**
 * The gearing: chain → cabinet.
 *
 * `CabinetView` is presentation; `useCabinetGame` is the half that talks to
 * `RansomeGame` / `RansomeVault`. It is the mapping written down in
 * §6.19.2, implemented:
 *
 *   round / countdown / sessionSecs ← currentSessionId + getSession(id)
 *   currentNum / prevNum            ← getSession(id).drawnNumbersList
 *   tickets                         ← the local store (`lib/raffle-game.ts`),
 *                                     because the contract keeps only gridHash
 *   claimable*                      ← claimableOf(session, device, winType) 0..6
 *   vaultTotal                      ← prizePoolReserve × tokenPriceInUsd
 *   mint                            ← mintConsoles(X | USDG)
 *   claim                           ← claimConsoleWin(device, winType, board)
 *
 * Everything degrades to "not live" when the addresses are unset, and the
 * cabinet then runs its local SIMULATION clock. That boundary is deliberate:
 * nothing in this file can be reached without a deployed game.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { evmPublicClient } from './evm-client';
import { ROBINHOOD_CHAIN_ID, RANSOME_GAME_ADDRESS, RANSOME_VAULT_ADDRESS } from './robinhood-config';
import { RANSOME_GAME_ABI, RANSOME_VAULT_ABI } from './game-abi';
import type { EvmWallet } from './use-evm-wallet';
import {
  BOARD_COLS,
  BOARD_ROWS,
  type Board,
  type StoredTicket,
  type TierState,
  TIER_LABELS,
  addTickets,
  boardNumbers,
  generateColdBoard,
  isValidBoard,
  loadTickets,
  tierState,
} from './raffle-game';

const ZERO = '0x0000000000000000000000000000000000000000';

/** True when both core contracts have an address. */
export const CABINET_LIVE = RANSOME_GAME_ADDRESS !== ZERO && RANSOME_VAULT_ADDRESS !== ZERO;

const POLL_MS = 20_000;
/** One ball a minute; the contract itself enforces nothing about the cadence. */
const DRAW_SECONDS = 60;
/** Board tiers 0–3, then the three full-house rungs the contract derives. */
const WIN_TYPES = [0, 1, 2, 3, 4, 5, 6] as const;

export type SessionRead = {
  id: bigint;
  drawCount: number;
  active: boolean;
  startedAt: number;
  drawn: number[];
};

async function readSession(): Promise<SessionRead> {
  const id = BigInt(
    await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'currentSessionId',
    }),
  );
  const s = (await (evmPublicClient as any).readContract({
    address: RANSOME_GAME_ADDRESS,
    abi: RANSOME_GAME_ABI,
    functionName: 'getSession',
    args: [id],
  })) as [bigint, number, boolean, bigint, readonly number[]];

  return {
    id,
    drawCount: Number(s[1]),
    active: Boolean(s[2]),
    startedAt: Number(s[3]),
    drawn: Array.from(s[4]).map(Number),
  };
}

async function readPot(): Promise<{ tokens: bigint; usd: number }> {
  const [reserve, price8] = (await Promise.all([
    (evmPublicClient as any).readContract({
      address: RANSOME_VAULT_ADDRESS,
      abi: RANSOME_VAULT_ABI,
      functionName: 'prizePoolReserve',
    }),
    (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'tokenPriceInUsd',
    }),
  ])) as [bigint, bigint];

  const whole = Number(formatUnits(reserve as bigint, 18));
  // price8 is 8 dp; a USD figure is display-only, and the token rail re-quotes
  // from the contract for anything that moves money.
  const usd = whole * (Number(price8) / 1e8);
  return { tokens: reserve as bigint, usd };
}

/* ── the header number ──────────────────────────────────────────────────── */

export type RafflePot = {
  live: boolean;
  /** whole RAFFLE tokens in the prize pool */
  tokens: number;
  /** display value, USD; falls back to 0 when the price is unset */
  usd: number;
  refresh: () => void;
};

export function useRafflePot(): RafflePot {
  const [tokens, setTokens] = useState(0);
  const [usd, setUsd] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    if (!CABINET_LIVE) return;
    readPot()
      .then((p) => {
        if (!alive.current) return;
        setTokens(Number(formatUnits(p.tokens, 18)));
        setUsd(p.usd);
      })
      .catch((e) => console.warn('Prize pool read failed:', e));
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!CABINET_LIVE) return () => { alive.current = false; };
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  return { live: CABINET_LIVE, tokens, usd, refresh };
}

/* ── the cabinet itself ─────────────────────────────────────────────────── */

export type CabinetClaim = { winType: number; amount: bigint; usd: number; label: string };

export type CabinetTicket = StoredTicket & {
  matched: number[];
  tiers: TierState;
  claims: CabinetClaim[];
};

export type CabinetGame = {
  live: boolean;
  loading: boolean;
  busy: 'mint' | 'claim' | null;
  error: string | null;
  note: string | null;
  session: SessionRead | null;
  countdown: number;
  sessionSecs: number;
  potUsd: number;
  potTokens: number;
  tickets: CabinetTicket[];
  claimableCount: number;
  claimableUsd: number;
  priceSet: boolean;
  mint: (count: number, rail: 'RAFFLE' | 'USDG') => Promise<void>;
  claim: (deviceId: number, winType: number) => Promise<void>;
  refresh: () => void;
};

const EMPTY_TIERS: TierState = {
  hits: 0,
  earlyFive: false,
  lines: [false, false, false],
  fullHouse: false,
};

export function useCabinetGame(wallet: EvmWallet): CabinetGame {
  const [session, setSession] = useState<SessionRead | null>(null);
  const [tickets, setTickets] = useState<CabinetTicket[]>([]);
  const [potUsd, setPotUsd] = useState(0);
  const [potTokens, setPotTokens] = useState(0);
  const [price8, setPrice8] = useState<bigint>(0n);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'mint' | 'claim' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const alive = useRef(true);

  const address = wallet.address;

  /** Everything the cabinet prints, in one sweep. */
  const load = useCallback(
    async (announce = false) => {
      if (!CABINET_LIVE) return;
      if (!address) {
        setSession(null);
        setTickets([]);
        return;
      }
      try {
        setLoading(true);
        const s = await readSession();
        const [pot, price] = await Promise.all([
          readPot(),
          (evmPublicClient as any).readContract({
            address: RANSOME_GAME_ADDRESS,
            abi: RANSOME_GAME_ABI,
            functionName: 'tokenPriceInUsd',
          }) as Promise<bigint>,
        ]);

        const stored = loadTickets(ROBINHOOD_CHAIN_ID, address).filter(
          (t) => t.sessionId === s.id.toString(),
        );

        const priced = await Promise.all(
          stored.map(async (t) => {
            const claims: CabinetClaim[] = [];
            for (const winType of WIN_TYPES) {
              const [amount, claimed, expired] = (await (evmPublicClient as any).readContract({
                address: RANSOME_GAME_ADDRESS,
                abi: RANSOME_GAME_ABI,
                functionName: 'claimableOf',
                args: [s.id, BigInt(t.deviceId), winType],
              })) as [bigint, boolean, boolean];

              if (amount > 0n && !claimed && !expired) {
                claims.push({
                  winType,
                  amount,
                  usd: Number(formatUnits(amount, 18)) * (Number(price) / 1e8),
                  label: TIER_LABELS[winType] ?? 'Win',
                });
              }
            }

            const wall = s.drawn;
            const hitSet = new Set(wall);
            return {
              ...t,
              matched: boardNumbers(t.board).filter((n) => hitSet.has(n)),
              tiers: t.board.length === 27 ? tierState(t.board, wall) : EMPTY_TIERS,
              claims,
            } satisfies CabinetTicket;
          }),
        );

        if (!alive.current) return;
        setSession(s);
        setTickets(priced);
        setPotUsd(pot.usd);
        setPotTokens(Number(formatUnits(pot.tokens, 18)));
        setPrice8(price);
        if (announce) setNote(null);
      } catch (e: any) {
        if (!alive.current) return;
        setError(e?.shortMessage || e?.message || 'Could not read the game');
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [address],
  );

  useEffect(() => {
    alive.current = true;
    load();
    const poll = setInterval(() => load(), POLL_MS);
    const clock = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  // ── mint ────────────────────────────────────────────────────────────────
  const mint = useCallback(
    async (count: number, rail: 'RAFFLE' | 'USDG') => {
      if (!CABINET_LIVE) return;
      if (!address) {
        setError('Connect a wallet to mint');
        return;
      }
      setBusy('mint');
      setError(null);
      setNote(null);
      try {
        // The wall is read *now*: a board that holds a number already drawn is
        // refused by the contract, and a round can advance between renders.
        const { sessionId, drawn } = await wallet.readDrawnNumbers();

        const boards: Board[] = [];
        const taken = [...drawn];
        for (let i = 0; i < count; i++) {
          const b = generateColdBoard(taken);
          if (!isValidBoard(b)) throw new Error('Generated an illegal board');
          boards.push(b);
          // keep this batch internally unique too — two identical boards in one
          // mint are the same gridHash, and `gridUsed` refuses the second
          taken.push(...boardNumbers(b));
        }

        const grids = boards.map((b) =>
          Array.from({ length: BOARD_ROWS }, (_, r) => b.slice(r * BOARD_COLS, (r + 1) * BOARD_COLS)),
        );

        const out = (await wallet.mintConsoles(rail === 'RAFFLE' ? 'X' : 'USDG', count, grids)) as {
          deviceIds?: number[];
        };

        const ids = out?.deviceIds ?? [];
        if (ids.length === boards.length) {
          addTickets(
            ROBINHOOD_CHAIN_ID,
            address,
            boards.map((board, i) => ({
              sessionId: sessionId.toString(),
              deviceId: ids[i],
              board,
              rail,
              at: Date.now(),
            })),
          );
          setNote(`Minted ${ids.length} ticket${ids.length === 1 ? '' : 's'} — boards saved in this browser.`);
        } else {
          setNote('Minted, but the device ids could not be resolved. Reload to pick them up.');
        }

        await load(true);
      } catch (e: any) {
        setError(e?.shortMessage || e?.message || 'Mint failed');
      } finally {
        setBusy(null);
      }
    },
    [address, load, wallet],
  );

  // ── claim ───────────────────────────────────────────────────────────────
  const claim = useCallback(
    async (deviceId: number, winType: number) => {
      if (!CABINET_LIVE) return;
      const ticket = tickets.find((t) => t.deviceId === deviceId);
      if (!ticket) {
        setError('That ticket is not in this browser’s store');
        return;
      }
      setBusy('claim');
      setError(null);
      setNote(null);
      try {
        const res = await wallet.claimConsoleWin(
          deviceId,
          winType,
          ticket.board,
          BigInt(ticket.sessionId),
        );
        setNote(
          `${TIER_LABELS[winType] ?? 'Win'} collected — ${Number(formatUnits(res.amount, 18)).toLocaleString(
            undefined,
            { maximumFractionDigits: 2 },
          )} RAFFLE.`,
        );
        await load();
      } catch (e: any) {
        setError(e?.shortMessage || e?.message || 'Claim failed');
      } finally {
        setBusy(null);
      }
    },
    [tickets, load, wallet],
  );

  const countdown = session ? Math.max(0, session.startedAt + (session.drawCount + 1) * DRAW_SECONDS - now) : 0;
  const sessionSecs = session ? Math.max(0, now - session.startedAt) : 0;

  const claimableCount = tickets.reduce((n, t) => n + t.claims.length, 0);
  const claimableUsd = tickets.reduce((n, t) => n + t.claims.reduce((s, c) => s + c.usd, 0), 0);

  return {
    live: CABINET_LIVE,
    loading,
    busy,
    error,
    note,
    session,
    countdown,
    sessionSecs,
    potUsd,
    potTokens,
    tickets,
    claimableCount,
    claimableUsd,
    priceSet: price8 > 0n,
    mint,
    claim,
    refresh: () => load(),
  };
}
