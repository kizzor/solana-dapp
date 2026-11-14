'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createWalletClient, custom, decodeEventLog, parseEther } from 'viem';
import { evmPublicClient } from './evm-client';
import {
  LAUNCH_FACTORY_ADDRESS,
  LAUNCH_GRADUATOR_ADDRESS,
  LAUNCH_HOOK_ADDRESS,
  LAUNCH_ROUTER_ADDRESS,
  ROBINHOOD_CHAIN,
  ROBINHOOD_CHAIN_ID,
} from './robinhood-config';
import {
  LAUNCH_CURVE_ABI,
  LAUNCH_FACTORY_ABI,
  LAUNCH_GRADUATOR_ABI,
  LAUNCH_HOOK_ABI,
  LAUNCH_ROUTER_ABI,
  LAUNCH_TOKEN_ABI,
} from './launch-abi';
import {
  DEMO_COINS,
  LAUNCH_FEE_ETH,
  TOTAL_SUPPLY,
  type LaunchCoin,
  type TapeHolder,
  type TapeTrade,
} from './launchpad-demo';

/** A live coin carries the curve/token addresses and the reserves the panel
 *  needs to quote a trade without another round-trip. */
export type CurveCoin = LaunchCoin & {
  live: true;
  curve: `0x${string}`;
  token: `0x${string}`;
  virtualEth: number;
  virtualToken: number;
  realEth: number;
  ready: boolean;
  graduated: boolean;
  graduatedEth: number;
  trades: TapeTrade[];
  holderRows: TapeHolder[];
  poolKey?: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` };
  /** Set once the coin is in its v4 pool; the hook's fee ledger is keyed by it. */
  poolId?: `0x${string}`;
};

export type CreateInput = {
  name: string;
  ticker: string;
  blurb: string;
  recipient: `0x${string}`;
  initialBuyEth: number;
};

const ZERO = '0x0000000000000000000000000000000000000000';
const FACTORY = LAUNCH_FACTORY_ADDRESS;
const MAX_COINS = 24;

export const LAUNCHPAD_LIVE = FACTORY.toLowerCase() !== ZERO;

// The repo's pinned viem generics don't accept the generated `as const` ABIs
// through the typed overload (same reason use-raffle-chain casts), so keep the
// read boundary untyped and treat every result as bigint.
const readContract = (args: any): Promise<any> => (evmPublicClient as any).readContract(args);

function eth(n: bigint | undefined): number {
  return n ? Number(n) / 1e18 : 0;
}

function friendlyError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  const msg = err?.shortMessage || err?.message || 'Transaction failed';
  return msg.length > 180 ? `${msg.slice(0, 177)}…` : msg;
}

function hueOf(address: string): number {
  return parseInt(address.slice(2, 8), 16) % 360;
}

export function useLaunchpad(wallet: `0x${string}` | null) {
  const [coins, setCoins] = useState<CurveCoin[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'create' | 'buy' | 'sell' | 'claim' | 'graduate' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!LAUNCHPAD_LIVE) return;
    setLoading(true);
    try {
      const count = await readContract({
        address: FACTORY,
        abi: LAUNCH_FACTORY_ABI,
        functionName: 'coinCount',
      });
      const limit = Math.min(Number(count), MAX_COINS);
      if (limit === 0) {
        setCoins([]);
        return;
      }
      const page = await readContract({
        address: FACTORY,
        abi: LAUNCH_FACTORY_ABI,
        functionName: 'recentCoins',
        args: [BigInt(limit), 0n],
      });

      const now = Math.floor(Date.now() / 1000);
      const mapped = await Promise.all(
        page.map(async (c) => {
          const curve = c.curve as `0x${string}`;
          const [virtualEth, virtualToken, realEth, jackpot, volume, holders, ready, graduated, graduatedEth, balance] =
            await Promise.all([
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'virtualEthReserve',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'virtualTokenReserve',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'realEthReserve',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'jackpotFees',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'totalVolumeEth',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'holderCount',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'readyToGraduate',
              }),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'graduated',
              }).catch(() => false),
              readContract({
                address: curve,
                abi: LAUNCH_CURVE_ABI,
                functionName: 'graduatedEth',
              }).catch(() => 0n),
              wallet
                ? readContract({
                    address: c.token as `0x${string}`,
                    abi: LAUNCH_TOKEN_ABI,
                    functionName: 'balanceOf',
                    args: [wallet],
                  })
                : Promise.resolve(0n),
            ]);

          const priceEth = virtualToken > 0n ? Number(virtualEth) / Number(virtualToken) : 0;
          const migrated = Boolean(graduated);
          let poolKey: CurveCoin['poolKey'];
          let poolId: `0x${string}` | undefined;
          if (migrated && LAUNCH_GRADUATOR_ADDRESS.toLowerCase() !== ZERO) {
            const g: any = await readContract({
              address: LAUNCH_GRADUATOR_ADDRESS,
              abi: LAUNCH_GRADUATOR_ABI,
              functionName: 'graduationOf',
              args: [c.token],
            }).catch(() => null);
            if (g) poolId = (g[0] ?? g.poolId) as `0x${string}`;
            const k: any = await readContract({
              address: LAUNCH_GRADUATOR_ADDRESS,
              abi: LAUNCH_GRADUATOR_ABI,
              functionName: 'poolKeyOf',
              args: [c.token],
            }).catch(() => null);
            if (k) {
              poolKey = {
                currency0: k[0] ?? k.currency0,
                currency1: k[1] ?? k.currency1,
                fee: Number(k[2] ?? k.fee),
                tickSpacing: Number(k[3] ?? k.tickSpacing),
                hooks: k[4] ?? k.hooks,
              };
            }
          }
          const createdAt = Number(c.createdAt);
          const ageMinutes = Math.max(0, Math.round((now - createdAt) / 60));
          const coin: CurveCoin = {
            id: curve,
            name: c.name,
            ticker: c.symbol,
            blurb: c.blurb,
            creator: `${c.creator.slice(0, 6)}…${c.creator.slice(-4)}`,
            creatorFull: c.creator,
            ageMinutes,
            mcapEth: priceEth * TOTAL_SUPPLY,
            bondedEth: migrated ? 4.2 : eth(realEth),
            // Filled by the tape below; zero until the first trade is indexed.
            change24h: 0,
            volume24hEth: eth(volume),
            jackpotEth: eth(jackpot),
            holders: Number(holders),
            hue: hueOf(curve),
            series: priceEth > 0 ? [100, 100] : [0, 0],
            live: true,
            curve,
            token: c.token as `0x${string}`,
            virtualEth: Number(virtualEth) / 1e18,
            virtualToken: Number(virtualToken) / 1e18,
            realEth: eth(realEth),
            ready,
            graduated: migrated,
            graduatedEth: eth(graduatedEth),
            trades: [],
            holderRows: [],
            poolKey,
            poolId,
            balance: Number(balance) / 1e18,
          };
          return coin;
        }),
      );

      // The tape is the market: 24h change, volume, sparkline, ranked holders.
      // A tape failure must not blank the board, so it degrades to the values
      // already read from each curve.
      try {
        const res = await fetch(
          `/api/launchpad/tape?curves=${mapped.map((c) => c.curve).join(',')}`,
          { cache: 'no-store' },
        );
        if (res.ok) {
          const { byCurve } = (await res.json()) as { byCurve?: Record<string, any> };
          for (const coin of mapped) {
            const tape = byCurve?.[coin.curve.toLowerCase()];
            if (!tape) continue;
            coin.trades = tape.trades ?? [];
            coin.holderRows = tape.holders ?? [];
            coin.change24h = Number(tape.change24h) || 0;
            if (tape.volume24hEth != null) coin.volume24hEth = Number(tape.volume24hEth);
            if (Array.isArray(tape.series) && tape.series.length > 1) coin.series = tape.series;
            coin.holders = Math.max(Number(tape.holderCount) || 0, coin.holders);
            if (tape.graduated) coin.graduated = true;
            if (tape.pool?.priceEth > 0) {
              coin.mcapEth = tape.pool.priceEth * TOTAL_SUPPLY;
              coin.poolEth = Number(tape.pool.eth);
              coin.poolTokens = Number(tape.pool.tokens);
            }
          }
        }
      } catch {
        // keep curve-sourced values
      }

      setCoins(mapped);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    void refresh();
    if (!LAUNCHPAD_LIVE) return;
    const timer = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const walletClient = useCallback(async () => {
    const ethProvider = typeof window !== 'undefined' ? (window as any).ethereum : null;
    if (!ethProvider) throw new Error('Install an EVM wallet to trade.');
    if (!wallet) throw new Error('Connect a wallet first.');
    const current = parseInt(await ethProvider.request({ method: 'eth_chainId' }), 16);
    if (current !== ROBINHOOD_CHAIN_ID) {
      try {
        await ethProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${ROBINHOOD_CHAIN_ID.toString(16)}` }],
        });
      } catch (e) {
        throw new Error(`Switch your wallet to ${ROBINHOOD_CHAIN.name} to continue.`);
      }
    }
    return createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom(ethProvider),
      account: wallet,
    });
  }, [wallet]);

  const createCoin = useCallback(
    async (input: CreateInput): Promise<`0x${string}` | null> => {
      if (!LAUNCHPAD_LIVE) return null;
      setBusy('create');
      setError(null);
      try {
        const client = await walletClient();
        const hash = await client.writeContract({
          address: FACTORY,
          abi: LAUNCH_FACTORY_ABI,
          functionName: 'createCoin',
          args: [input.name.trim(), input.ticker, input.blurb.trim(), input.recipient, 0n],
          value: parseEther((LAUNCH_FEE_ETH + Math.max(0, input.initialBuyEth)).toFixed(18)),
          account: wallet!,
          chain: ROBINHOOD_CHAIN as any,
        });
        const receipt = await evmPublicClient.waitForTransactionReceipt({ hash });
        const log = receipt.logs.find((l) => l.address.toLowerCase() === FACTORY.toLowerCase());
        let curve: `0x${string}` | null = null;
        if (log) {
          const decoded = decodeEventLog({
            abi: LAUNCH_FACTORY_ABI,
            eventName: 'CoinLaunched',
            data: log.data,
            topics: log.topics,
          });
          curve = (decoded.args as any).curve as `0x${string}`;
        }
        await refresh();
        return curve;
      } catch (e) {
        setError(friendlyError(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [refresh, wallet, walletClient],
  );

  const buy = useCallback(
    async (curve: `0x${string}`, amountEth: number, minTokensOut: number) => {
      setBusy('buy');
      setError(null);
      try {
        const client = await walletClient();
        const coin = coins.find((c) => c.curve?.toLowerCase() === curve.toLowerCase());
        const minOut = parseEther(Math.max(0, minTokensOut).toFixed(18));
        const value = parseEther(amountEth.toFixed(18));

        // A graduated coin is a Uniswap v4 pool now; buying the frozen curve
        // would revert. The router settles the swap inside PoolManager.unlock.
        const target = coin?.graduated && coin.poolKey ? LAUNCH_ROUTER_ADDRESS : curve;
        const hash = await client.writeContract({
          address: target,
          abi: (target === curve ? LAUNCH_CURVE_ABI : LAUNCH_ROUTER_ABI) as any,
          functionName: 'buy',
          args: target === curve ? [minOut] : [coin!.poolKey, minOut, wallet!],
          value,
          account: wallet!,
          chain: ROBINHOOD_CHAIN as any,
        });
        await evmPublicClient.waitForTransactionReceipt({ hash });
        await refresh();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(null);
      }
    },
    [coins, refresh, wallet, walletClient],
  );

  const sell = useCallback(
    async (curve: `0x${string}`, token: `0x${string}`, tokensIn: number, minEthOut: number) => {
      setBusy('sell');
      setError(null);
      try {
        const client = await walletClient();
        const amount = parseEther(Math.max(0, tokensIn).toFixed(18));
        const coin = coins.find((c) => c.curve?.toLowerCase() === curve.toLowerCase());
        const viaPool = Boolean(coin?.graduated && coin.poolKey);
        const spender = viaPool ? LAUNCH_ROUTER_ADDRESS : curve;
        const approval = await client.writeContract({
          address: token,
          abi: LAUNCH_TOKEN_ABI,
          functionName: 'approve',
          args: [spender, amount],
          account: wallet!,
          chain: ROBINHOOD_CHAIN as any,
        });
        await evmPublicClient.waitForTransactionReceipt({ hash: approval });
        const hash = await client.writeContract({
          address: spender,
          abi: (viaPool ? LAUNCH_ROUTER_ABI : LAUNCH_CURVE_ABI) as any,
          functionName: 'sell',
          args: viaPool
            ? [coin!.poolKey, amount, parseEther(Math.max(0, minEthOut).toFixed(18)), wallet!]
            : [amount, parseEther(Math.max(0, minEthOut).toFixed(18))],
          account: wallet!,
          chain: ROBINHOOD_CHAIN as any,
        });
        await evmPublicClient.waitForTransactionReceipt({ hash });
        await refresh();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh, wallet, walletClient],
  );

  const claimCreator = useCallback(
    async (curve: `0x${string}`) => {
      setBusy('claim');
      setError(null);
      try {
        const client = await walletClient();
        const coin = coins.find((c) => c.curve?.toLowerCase() === curve.toLowerCase());
        // Post-graduation, trade fees accrue in LaunchFeeHook, not the curve.
        const viaHook = Boolean(
          coin?.graduated && coin.poolId && LAUNCH_HOOK_ADDRESS.toLowerCase() !== ZERO,
        );
        const hash = viaHook
          ? await client.writeContract({
              address: LAUNCH_HOOK_ADDRESS,
              abi: LAUNCH_HOOK_ABI,
              functionName: 'claimCreatorFees',
              args: [coin!.poolId!],
              account: wallet!,
              chain: ROBINHOOD_CHAIN as any,
            })
          : await client.writeContract({
              address: curve,
              abi: LAUNCH_CURVE_ABI,
              functionName: 'claimCreatorFees',
              args: [],
              account: wallet!,
              chain: ROBINHOOD_CHAIN as any,
            });
        await evmPublicClient.waitForTransactionReceipt({ hash });
        await refresh();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(null);
      }
    },
    [coins, refresh, wallet, walletClient],
  );

  /** R2 migration is permissionless once the 4.2 ETH ceiling is reached. */
  const graduate = useCallback(
    async (curve: `0x${string}`) => {
      setBusy('graduate');
      setError(null);
      try {
        const client = await walletClient();
        const hash = await client.writeContract({
          address: curve,
          abi: LAUNCH_CURVE_ABI,
          functionName: 'graduate',
          args: [],
          account: wallet!,
          chain: ROBINHOOD_CHAIN as any,
        });
        await evmPublicClient.waitForTransactionReceipt({ hash });
        await refresh();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh, wallet, walletClient],
  );

  const byId = useMemo(() => new Map(coins.map((c) => [c.id, c])), [coins]);

  return {
    live: LAUNCHPAD_LIVE,
    coins: LAUNCHPAD_LIVE ? coins : DEMO_COINS,
    coinById: (id: string | null) =>
      id ? (LAUNCHPAD_LIVE ? byId.get(id) ?? null : DEMO_COINS.find((c) => c.id === id) ?? null) : null,
    loading,
    busy,
    error,
    refresh,
    createCoin,
    buy,
    sell,
    graduate,
    claimCreator,
  };
}
