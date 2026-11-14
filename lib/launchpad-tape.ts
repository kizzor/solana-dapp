/**
 * Launchpad trade tape — a real index over `LaunchCurve.Bought/Sold` and
 * `LaunchSwapRouter.Bought/Sold`, plus ERC20 `Transfer` for ranked holders.
 *
 * Server-only (the route handler calls it). There is no database: the local
 * chain is short and the tape is small, so a bounded `getLogs` scan per request
 * with a 10s in-process cache is enough. On a public chain, move the scan into
 * a worker and keep this module's shape as the read model.
 */

import { createPublicClient, http, type Address } from 'viem'
import {
  LAUNCH_CURVE_ABI,
  LAUNCH_GRADUATOR_ABI,
  LAUNCH_ROUTER_ABI,
  LAUNCH_TOKEN_ABI,
} from './launch-abi'
import {
  LAUNCH_FACTORY_ADDRESS,
  LAUNCH_GRADUATOR_ADDRESS,
  LAUNCH_ROUTER_ADDRESS,
  ROBINHOOD_CHAIN,
} from './robinhood-config'

const TOTAL_SUPPLY = 1_000_000_000

export type TapeTrade = {
  id: string
  side: 'buy' | 'sell'
  venue: 'curve' | 'pool'
  trader: string
  eth: number
  tokens: number
  priceEth: number
  block: string
  ts: number
}

export type TapeHolder = { address: string; pct: number; balance: number }

export type TapeSummary = {
  curve: string
  token: string
  graduated: boolean
  trades: TapeTrade[]
  change24h: number
  volume24hEth: number
  series: number[]
  holders: TapeHolder[]
  holderCount: number
  pool: { eth: number; tokens: number; priceEth: number } | null
}

const client = createPublicClient({
  chain: ROBINHOOD_CHAIN as any,
  transport: http(process.env.ROBINHOOD_RPC_URL || ROBINHOOD_CHAIN.rpcUrls.default.http[0]),
})

const ZERO = '0x0000000000000000000000000000000000000000'
const FEE_BPS = 100n
const BPS = 10_000n

const toEth = (n: bigint | undefined | null) => (n ? Number(n) / 1e18 : 0)
const feeOn = (amount: bigint) => (amount > 0n ? (amount * FEE_BPS - 1n) / BPS + 1n : 0n)

const read = (args: any): Promise<any> => (client as any).readContract(args)

const cache = new Map<string, { at: number; data: TapeSummary }>()
const CACHE_MS = 10_000

async function logsFor(address: Address, abi: any, eventName: string, fromBlock: bigint) {
  try {
    // getContractEvents (not getLogs) because we need decoded `args`.
    const logs = (await (client as any).getContractEvents({
      address,
      abi,
      eventName,
      fromBlock,
      toBlock: 'latest',
    })) as any[]
    return logs
  } catch {
    return []
  }
}

async function tapeFor(curve: Address): Promise<TapeSummary> {
  const cached = cache.get(curve)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data

  const token = (await read({
    address: curve,
    abi: LAUNCH_CURVE_ABI,
    functionName: 'token',
  })) as Address

  const [curveBn, curveSn, routerBn, routerSn, transfers, graduated, grad] = await Promise.all([
    logsFor(curve, LAUNCH_CURVE_ABI, 'Bought', 0n),
    logsFor(curve, LAUNCH_CURVE_ABI, 'Sold', 0n),
    logsFor(LAUNCH_ROUTER_ADDRESS, LAUNCH_ROUTER_ABI, 'Bought', 0n),
    logsFor(LAUNCH_ROUTER_ADDRESS, LAUNCH_ROUTER_ABI, 'Sold', 0n),
    logsFor(token, LAUNCH_TOKEN_ABI, 'Transfer', 0n),
    read({ address: curve, abi: LAUNCH_CURVE_ABI, functionName: 'graduated' }).catch(
      () => false,
    ) as Promise<boolean>,
    read({
      address: LAUNCH_GRADUATOR_ADDRESS,
      abi: LAUNCH_GRADUATOR_ABI,
      functionName: 'graduationOf',
      args: [token],
    }).catch(() => null) as Promise<any>,
  ])

  // Blocks are fetched once each; the tape is ordered by (block, logIndex).
  const blockNumbers = new Set<string>()
  for (const l of [...curveBn, ...curveSn, ...routerBn, ...routerSn]) {
    if (l.blockNumber != null) blockNumbers.add(String(l.blockNumber))
  }
  const timestamps = new Map<string, number>()
  await Promise.all(
    [...blockNumbers].slice(-200).map(async (bn) => {
      const block = await client.getBlock({ blockNumber: BigInt(bn) }).catch(() => null)
      if (block) timestamps.set(bn, Number(block.timestamp))
    }),
  )
  const tsOf = (log: any) => timestamps.get(String(log.blockNumber)) ?? 0

  const raw: TapeTrade[] = []

  for (const l of curveBn) {
    const a = l.args ?? {}
    if (a.ethIn == null || a.tokensOut == null) continue
    const net = a.ethIn - (a.fee ?? 0n)
    raw.push({
      id: `${l.transactionHash}-${l.logIndex}`,
      side: 'buy',
      venue: 'curve',
      trader: a.buyer,
      eth: toEth(a.ethIn),
      tokens: Number(a.tokensOut) / 1e18,
      priceEth: a.tokensOut > 0n ? Number(net) / 1e18 / (Number(a.tokensOut) / 1e18) : 0,
      block: String(l.blockNumber),
      ts: tsOf(l),
    })
  }

  for (const l of curveSn) {
    const a = l.args ?? {}
    if (a.tokensIn == null || a.ethOut == null) continue
    raw.push({
      id: `${l.transactionHash}-${l.logIndex}`,
      side: 'sell',
      venue: 'curve',
      trader: a.seller,
      eth: toEth(a.ethOut),
      tokens: Number(a.tokensIn) / 1e18,
      priceEth: a.tokensIn > 0n ? Number(a.ethOut) / 1e18 / (Number(a.tokensIn) / 1e18) : 0,
      block: String(l.blockNumber),
      ts: tsOf(l),
    })
  }

  for (const l of routerBn) {
    const a = l.args ?? {}
    if (a.ethIn == null || a.tokensOut == null) continue
    if (String(a.token).toLowerCase() !== String(token).toLowerCase()) continue
    const net = a.ethIn - feeOn(a.ethIn)
    raw.push({
      id: `${l.transactionHash}-${l.logIndex}`,
      side: 'buy',
      venue: 'pool',
      trader: a.buyer,
      eth: toEth(a.ethIn),
      tokens: Number(a.tokensOut) / 1e18,
      priceEth: a.tokensOut > 0n ? Number(net) / 1e18 / (Number(a.tokensOut) / 1e18) : 0,
      block: String(l.blockNumber),
      ts: tsOf(l),
    })
  }

  for (const l of routerSn) {
    const a = l.args ?? {}
    if (a.tokensIn == null || a.ethOut == null) continue
    if (String(a.token).toLowerCase() !== String(token).toLowerCase()) continue
    const gross = a.ethOut + feeOn(a.ethOut)
    raw.push({
      id: `${l.transactionHash}-${l.logIndex}`,
      side: 'sell',
      venue: 'pool',
      trader: a.seller,
      eth: toEth(gross),
      tokens: Number(a.tokensIn) / 1e18,
      priceEth: a.tokensIn > 0n ? Number(gross) / 1e18 / (Number(a.tokensIn) / 1e18) : 0,
      block: String(l.blockNumber),
      ts: tsOf(l),
    })
  }

  raw.sort((a, b) => Number(BigInt(b.block) - BigInt(a.block)) || (a.id < b.id ? 1 : -1))
  const trades = raw.slice(0, 60)

  const now = Math.floor(Date.now() / 1000)
  const dayAgo = now - 86_400
  const chronological = [...raw].reverse()
  const inWindow = chronological.filter((t) => t.ts >= dayAgo)
  const volume24hEth = inWindow.reduce((sum, t) => sum + t.eth, 0)

  // Pool reserves: graduation seed, then replay only pool trades.
  let pool: TapeSummary['pool'] = null
  if (graduated && grad) {
    let eth = toEth(grad.ethSeeded ?? grad[4])
    let tokens = Number(grad.tokensSeeded ?? grad[5]) / 1e18
    for (const t of chronological.filter((x) => x.venue === 'pool')) {
      if (t.side === 'buy') {
        eth += t.eth * 0.99
        tokens -= t.tokens
      } else {
        eth -= t.eth
        tokens += t.tokens
      }
    }
    eth = Math.max(eth, 0)
    tokens = Math.max(tokens, 0)
    if (eth > 0 && tokens > 0) pool = { eth, tokens, priceEth: eth / tokens }
  }

  const lastPrice = pool?.priceEth ?? trades[0]?.priceEth ?? 0
  const baseline =
    inWindow.length > 0
      ? inWindow[0].priceEth
      : chronological[0]?.priceEth ?? lastPrice
  const change24h = baseline > 0 ? ((lastPrice - baseline) / baseline) * 100 : 0

  // Sparkline: up to 40 trade prices, oldest first; repeat the last point so a
  // one-trade coin draws a flat line instead of an empty chart.
  const points = chronological.slice(-40).map((t) => t.priceEth).filter((p) => p > 0)
  if (points.length > 0 && lastPrice > 0) points.push(lastPrice)
  const first = points[0] ?? 1
  const series = points.length > 1 ? points.map((p) => Number(((p / first) * 100).toFixed(3))) : [100, 100]

  // Ranked holders from ERC20 transfers. Exclude the market plumbing so the
  // table reads as people, not contracts.
  const excluded = new Set(
    [ZERO, curve, token, LAUNCH_GRADUATOR_ADDRESS, LAUNCH_FACTORY_ADDRESS].map((a) =>
      String(a).toLowerCase(),
    ),
  )
  const balances = new Map<string, bigint>()
  for (const l of transfers) {
    const a = l.args ?? {}
    if (!a.from || !a.to) continue
    const value: bigint = a.value ?? 0n
    if (String(a.from).toLowerCase() !== ZERO) {
      const key = String(a.from).toLowerCase()
      balances.set(key, (balances.get(key) ?? 0n) - value)
    }
    if (String(a.to).toLowerCase() !== ZERO) {
      const key = String(a.to).toLowerCase()
      balances.set(key, (balances.get(key) ?? 0n) + value)
    }
  }
  const ranked = [...balances.entries()]
    .filter(([addr, bal]) => bal > 0n && !excluded.has(addr))
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
  const holders = ranked.slice(0, 10).map(([address, balance]) => ({
    address,
    balance: Number(balance) / 1e18,
    pct: (Number(balance) / 1e18 / TOTAL_SUPPLY) * 100,
  }))

  const summary: TapeSummary = {
    curve,
    token,
    graduated: !!graduated,
    trades,
    change24h,
    volume24hEth,
    series,
    holders,
    holderCount: ranked.length,
    pool,
  }

  cache.set(curve, { at: Date.now(), data: summary })
  return summary
}

export async function getTapes(curves: string[]): Promise<Record<string, TapeSummary>> {
  if (LAUNCH_GRADUATOR_ADDRESS.toLowerCase() === ZERO || !curves.length) return {}
  const out: Record<string, TapeSummary> = {}
  await Promise.all(
    curves.slice(0, 24).map(async (curve) => {
      try {
        const summary = await tapeFor(curve as Address)
        out[curve.toLowerCase()] = summary
      } catch {
        // One unreadable coin must not blank the whole board.
      }
    }),
  )
  return out
}
