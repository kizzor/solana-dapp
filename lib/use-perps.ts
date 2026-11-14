'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PREVIEW_MARKETS, type PerpCandle, type PerpMarket } from './perps';

type MarketsState = {
  markets: PerpMarket[];
  live: boolean;
  at: number;
  error: string | null;
  loading: boolean;
};

const EMPTY: MarketsState = { markets: [], live: false, at: 0, error: null, loading: true };

/** Polls /api/perps; falls back to the labelled snapshot if the venue is away. */
export function usePerps(enabled = true) {
  const [state, setState] = useState<MarketsState>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const tick = async () => {
      // Prefer Orderly Network perps (omnichain orderbook, builder fee via a
      // $10 broker ID, no 100 USDC min); fall back to direct Hyperliquid.
      const tryOrderly = async () => {
        const res = await fetch('/api/perps/orderly', { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok || !Array.isArray(body?.markets) || !body.markets.length) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return body;
      };
      const tryHl = async () => {
        const res = await fetch('/api/perps', { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok || !Array.isArray(body?.markets) || !body.markets.length) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return body;
      };
      try {
        if (!alive) return;
        let body: any;
        try {
          body = await tryOrderly();
        } catch {
          body = await tryHl();
        }
        if (!alive) return;
        setState({ markets: body.markets, live: true, at: body.at ?? Date.now(), error: null, loading: false });
      } catch (err) {
        if (!alive) return;
        setState((prev) => ({
          markets: prev.markets.length ? prev.markets : PREVIEW_MARKETS,
          live: false,
          at: Date.now(),
          error: err instanceof Error ? err.message : 'Perps venue unreachable',
          loading: false,
        }));
      }
    };

    tick();
    const id = setInterval(tick, 12_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  return state;
}

type CandlesState = { candles: PerpCandle[]; live: boolean; error: string | null; loading: boolean };

/** 1h of candles by default; refetches when the market or interval changes. */
export function useCandles(coin: string | null, interval = '1h', hours = 48) {
  const [state, setState] = useState<CandlesState>({ candles: [], live: false, error: null, loading: true });
  const keyRef = useRef('');

  const load = useCallback(
    async (alive: () => boolean) => {
      if (!coin) return;
      const key = `${coin}|${interval}|${hours}`;
      if (keyRef.current !== key) setState((s) => ({ ...s, loading: true }));
      keyRef.current = key;
      try {
        const res = await fetch(
          `/api/perps?coin=${encodeURIComponent(coin)}&interval=${interval}&hours=${hours}`,
          { cache: 'no-store' },
        );
        const body = await res.json();
        if (!alive()) return;
        if (!res.ok || !Array.isArray(body?.candles) || !body.candles.length) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        setState({ candles: body.candles, live: true, error: null, loading: false });
      } catch (err) {
        if (!alive()) return;
        setState({
          candles: [],
          live: false,
          error: err instanceof Error ? err.message : 'No candles',
          loading: false,
        });
      }
    },
    [coin, interval, hours],
  );

  useEffect(() => {
    let on = true;
    const alive = () => on;
    load(alive);
    const id = setInterval(() => load(alive), 30_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [load]);

  return state;
}
