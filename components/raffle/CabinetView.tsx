'use client';

import React, { useMemo, useState } from 'react';
import CarnivalSlotMachine, { type MachineTicket } from '@/components/CarnivalSlotMachine';
import { USDG_ADDRESS, X_TOKEN_ADDRESS } from '@/lib/robinhood-config';
import type { EvmWallet } from '@/lib/use-evm-wallet';
import { useCabinetGame } from '@/lib/use-raffle-chain';
import { boardNumbers } from '@/lib/raffle-game';

/**
 * THE CABINET — the slot machine as the launchpad's side B.
 *
 * `CarnivalSlotMachine` is presentation only (411 lines, no chain imports); this
 * component is the adapter. With both core contracts deployed it reads the
 * real round, the real drawn list and the real prize reserve, mints tickets
 * against `RansomeGame` and claims through it (see `lib/use-raffle-chain.ts`
 * for the prop → contract table). With no addresses set it falls back to the
 * local SIMULATION clock and no button can move value — the boundary §6.18.12
 * draws.
 *
 * Two constraints worth keeping in view while reading this file:
 *   · a ticket's board is generated COLD (no number already on the wall) or the
 *     mint reverts; and
 *   · the contract stores only `gridHash`, so the boards live in this browser —
 *     a claim needs the reveal, and the reveal is local.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const RAFFLE_RAIL_ON = X_TOKEN_ADDRESS !== ZERO_ADDRESS;
const USDG_RAIL_ON = USDG_ADDRESS !== ZERO_ADDRESS;

const DEMO_ROUND_LENGTH = 59; // seconds per draw on the demo clock
const DEMO_TICKET_COUNT = 59; // draws per round

/* ── the simulation clock (only used when the game is not deployed) ─────── */

function useDemoRound() {
  const [pool] = useState<number[]>(() => Array.from({ length: 90 }, (_, i) => i + 1));
  const [drawn, setDrawn] = useState<number[]>([]);
  const [countdown, setCountdown] = useState(DEMO_ROUND_LENGTH);
  const [sessionSecs, setSessionSecs] = useState(0);
  const [round, setRound] = useState(1284);

  React.useEffect(() => {
    let clock = 0;
    const t = setInterval(() => {
      clock += 1;
      setSessionSecs(clock);
      setCountdown((c) => {
        if (c > 1) return c - 1;
        setDrawn((d) => {
          const next = [...d, pool.shift() ?? 1];
          if (next.length >= DEMO_TICKET_COUNT) {
            setRound((r) => r + 1);
            setSessionSecs(0);
            clock = 0;
            return [];
          }
          return next;
        });
        return DEMO_ROUND_LENGTH;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pool]);

  return { round, countdown, sessionSecs, drawn };
}

function demoBoard(seed: number): number[] {
  const out: number[] = [];
  let v = seed;
  while (out.length < 15) {
    v = (v * 1103515245 + 12345) % 90;
    const n = (v % 90) + 1;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/* ── props ─────────────────────────────────────────────────────────────── */

type Props = {
  jackpotUsd: number;
  lockEligible: boolean;
  wallet: EvmWallet;
  onConnect: () => void;
  onClose: () => void;
};

export default function CabinetView({ jackpotUsd, lockEligible, wallet, onConnect, onClose }: Props) {
  const game = useCabinetGame(wallet);
  const demo = useDemoRound();

  const live = game.live;

  /* round / clock / drawn — the chain when it exists, the demo otherwise */
  const round = live ? Number(game.session?.id ?? 0) : demo.round;
  const drawn = live ? game.session?.drawn ?? [] : demo.drawn;
  const countdown = live ? game.countdown : demo.countdown;
  const sessionSecs = live ? game.sessionSecs : demo.sessionSecs;
  const currentNum = drawn.length ? drawn[drawn.length - 1] : null;
  const prevNum = drawn.length > 1 ? drawn[drawn.length - 2] : null;
  const pot = live ? game.potUsd : jackpotUsd;

  /* tickets — real ones from the store, or two static preview boards */
  const tickets: MachineTicket[] = useMemo(() => {
    if (live) {
      return game.tickets.map((t) => {
        const top = t.claims[0];
        return {
          id: t.deviceId,
          serial: `#${t.deviceId}`,
          numbers: boardNumbers(t.board),
          matched: t.matched,
          win: t.claims.length > 0,
          claimable: t.claims.length > 0,
          prizeLabel: top ? top.label : undefined,
          payout: top ? top.usd : undefined,
        } satisfies MachineTicket;
      });
    }
    return [1337, 90210].map((seed, i) => {
      const numbers = demoBoard(seed);
      return {
        id: i + 1,
        serial: `DEMO-${i + 1}`,
        numbers,
        matched: numbers.filter((n) => drawn.includes(n)),
        win: false,
        claimable: false,
      } satisfies MachineTicket;
    });
  }, [live, game.tickets, drawn]);

  const brickShares = useMemo(
    () => [500, 500, 500, 500, 1950, 1950, 4000].map((bps) => (pot * bps) / 10_000),
    [pot],
  );

  const price = lockEligible ? 0.25 : 0.5;
  const tokenPriceKnown = wallet.tokenPriceInUsd > 0n;
  // One button, so the rail is picked rather than chosen: RAFFLE when its price
  // is set on chain, USDG otherwise. The button's title says which one.
  const raffleRail = RAFFLE_RAIL_ON && tokenPriceKnown;
  const rail: 'RAFFLE' | 'USDG' = raffleRail ? 'RAFFLE' : 'USDG';
  const mintReady = raffleRail || USDG_RAIL_ON;

  const announcement =
    game.error ??
    game.note ??
    (!live
      ? 'Local clock, no wallet, no payouts. Play switches on when the game address is set.'
      : game.claimableCount > 0
        ? `${game.claimableCount} ransom${game.claimableCount === 1 ? '' : 's'} reserved — press COLLECT.`
        : null);

  const onClaim = (id: number) => {
    if (!live) return;
    const t = game.tickets.find((x) => x.deviceId === id);
    const claim = t?.claims[0];
    if (!claim) return;
    game.claim(id, claim.winType);
  };

  /** The machine's VAULT CLAIMS key: pay the first claim reserved in this browser. */
  const claimFirst = () => {
    const t = game.tickets.find((x) => x.claims.length > 0);
    if (t) game.claim(t.deviceId, t.claims[0].winType);
    else onClose();
  };

  return (
    <div className="rf-cabinet">
      <div className={`rf-cabinet-banner ${live ? 'is-live' : ''}`}>
        <div className="rf-cabinet-flag">
          <strong>{live ? 'LIVE' : 'SIMULATION'}</strong>
          <span>
            {live
              ? game.loading && !game.session
                ? 'Reading the deployed game…'
                : 'Boards are generated cold and saved in this browser.'
              : 'Local clock, no wallet, no payouts.'}
          </span>
        </div>

        {/* one action beside LIVE: mint one raffle on whichever rail is funded */}
        <button
          className="rf-cta is-small"
          onClick={() => (wallet.address ? game.mint(1, rail) : onConnect())}
          disabled={!!wallet.address && (!live || game.busy !== null || !mintReady)}
          title={
            !live
              ? 'RANSOME_GAME_ADDRESS is unset — there is nothing to mint against'
              : mintReady
                ? `One ticket on the ${rail} rail · boards are made from numbers not yet called`
                : 'Neither rail is configured on this deployment'
          }
        >
          {game.busy === 'mint'
            ? 'Minting…'
            : wallet.address
              ? `Mint raffle · $${price.toFixed(2)}`
              : 'Mint raffle'}
        </button>
      </div>

      <div className="rf-cabinet-body">
        <div className="rf-cabinet-stage">
          <CarnivalSlotMachine
            round={round}
            currentNum={currentNum}
            prevNum={prevNum}
            countdown={countdown}
            sessionSecs={sessionSecs}
            preGameSecs={0}
            tickets={tickets}
            onClaim={onClaim}
            vaultTotal={pot}
            claimableCount={live ? game.claimableCount : 0}
            claimableTotal={live ? game.claimableUsd : 0}
            brickShares={brickShares}
            lastWin={0}
            credits={0}
            bet={10}
            onOpenVault={claimFirst}
            announcement={announcement}
            onTerminate={onClose}
            onSpin={live ? () => game.refresh() : undefined}
            onMaxBet={undefined}
            onCoin={undefined}
          />
        </div>

      </div>
    </div>
  );
}
