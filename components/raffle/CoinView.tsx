'use client';

import React, { useMemo, useState } from 'react';
import {
  CREATOR_BPS,
  FEE_CLAIM,
  GRADUATION_ETH,
  JACKPOT_BPS,
  TOTAL_SUPPLY,
  TREASURY_BPS,
  fmtAge,
  fmtCompact,
  fmtEth,
  fmtPct,
  shortAddr,
  curveEthOut,
  curveTokensOut,
  feeFor,
  type LaunchCoin,
} from '@/lib/launchpad-demo';
import { CoinAvatar } from './BoardView';
import Sparkline from './Sparkline';

type Props = {
  coin: LaunchCoin;
  onBack: () => void;
  walletConnected: boolean;
  onConnect: () => void;
  live?: boolean;
  busy?: string | null;
  error?: string | null;
  wallet?: string | null;
  onClaimCreator?: (curve: `0x${string}`) => Promise<void>;
  onGraduate?: (curve: `0x${string}`) => Promise<void>;
  onBuy?: (curve: `0x${string}`, amountEth: number, minTokensOut: number) => Promise<void>;
  onSell?: (
    curve: `0x${string}`,
    token: `0x${string}`,
    tokensIn: number,
    minEthOut: number,
  ) => Promise<void>;
};

type Side = 'buy' | 'sell';

function fmtClock(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const DEMO_HOLDERS = [
  { rank: 1, addr: '0x51dE…03b9', pct: 4.18, tag: 'creator' },
  { rank: 2, addr: '0x9C14…77Bd', pct: 2.91, tag: null },
  { rank: 3, addr: '0x2b90…14Ae', pct: 2.04, tag: null },
  { rank: 4, addr: '0x7A31…9fC2', pct: 1.77, tag: null },
  { rank: 5, addr: '0xad08…4F3b', pct: 1.21, tag: null },
];

export default function CoinView({
  coin,
  onBack,
  walletConnected,
  onConnect,
  live = false,
  busy,
  error,
  wallet,
  onClaimCreator,
  onGraduate,
  onBuy,
  onSell,
}: Props) {
  const [side, setSide] = useState<Side>('buy');
  const [amount, setAmount] = useState('0.1');

  // A live coin quotes against its real reserves; preview coins keep the flat
  // mcap estimate so nothing on this screen pretends to be a market feed.
  const isLive =
    live && !!coin.curve && !!coin.token && coin.virtualEth != null && coin.virtualToken != null;
  const decimals = coin.mcapEth >= 100 ? 6 : 7;
  const priceEth = isLive && !coin.graduated
    ? (coin.virtualEth as number) / Math.max(coin.virtualToken as number, 1e-18)
    : coin.mcapEth / TOTAL_SUPPLY;
  const amountNum = Number(amount) || 0;
  // A graduated coin quotes against the v4 pool reserves rebuilt by the tape
  // (constant liquidity across the locked full range, so CPMM is exact there).
  const inPool = coin.graduated && (coin.poolEth ?? 0) > 0 && (coin.poolTokens ?? 0) > 0;
  const sellQuote = inPool
    ? (() => {
        const poolEth = coin.poolEth as number;
        const poolTokens = coin.poolTokens as number;
        const gross = (poolEth * amountNum) / (poolTokens + amountNum || 1);
        const fee = feeFor(gross).total;
        return { gross, fee, net: Math.max(0, gross - fee) };
      })()
    : isLive
      ? curveEthOut(amountNum, coin.virtualEth as number, coin.virtualToken as number)
      : { gross: 0, fee: 0, net: 0 };
  const fees = useMemo(
    () => feeFor(side === 'sell' ? sellQuote.gross : amountNum),
    [side, sellQuote.gross, amountNum],
  );
  const net = Math.max(0, amountNum - fees.total);
  const tokensOut = inPool
    ? (net * (coin.poolTokens as number)) / ((coin.poolEth as number) + net || 1)
    : isLive
      ? curveTokensOut(amountNum, coin.virtualEth as number, coin.virtualToken as number)
      : priceEth > 0
        ? net / priceEth
        : 0;
  const ethOut = side === 'sell' ? sellQuote.net : net;
  const progress = Math.min(1, coin.bondedEth / GRADUATION_ETH);
  const up = coin.change24h >= 0;
  const graduated = !!coin.graduated;
  const canTrade = isLive && walletConnected && amountNum > 0 && !busy;

  return (
    <div className="rf-coin">
      <button className="rf-back" onClick={onBack}>
        <span aria-hidden="true">←</span> Board
      </button>

      <header className="rf-coin-head">
        <CoinAvatar coin={coin} size={54} radius={15} />
        <div className="rf-coin-id">
          <div className="rf-coin-title">
            <h2>{coin.name}</h2>
            <span className="rf-ticker">${coin.ticker}</span>
            {graduated ? (
              <span className="rf-chip is-live">GRADUATED · V4</span>
            ) : isLive ? (
              <span className="rf-chip is-live">LIVE · ON-CHAIN</span>
            ) : (
              <span className="rf-chip is-warn">PREVIEW DATA</span>
            )}
          </div>
          <p className="rf-coin-meta">{coin.blurb}</p>
          <p className="rf-coin-sub">
            launched {fmtAge(coin.ageMinutes)} ago by <code>{coin.creator}</code> ·{' '}
            {fmtCompact(coin.holders)} holders
          </p>
        </div>
        <div className="rf-coin-quote">
          <span>MCAP</span>
          <strong>
            {fmtEth(coin.mcapEth)} <em>ETH</em>
          </strong>
          <span className={`rf-delta ${up ? 'is-up' : 'is-down'}`}>
            {fmtPct(coin.change24h)} <em>24h</em>
          </span>
        </div>
      </header>

      <div className="rf-coin-body">
        <div className="rf-coin-main">
          <section className="rf-panel rf-chart-panel">
            <header className="rf-panel-head">
              <div>
                <span className="rf-panel-k">
                  Price · {graduated ? 'Uniswap v4 pool' : 'CRT curve'}
                </span>
                <strong className="rf-price">
                  {(priceEth * 1e9).toFixed(decimals > 6 ? 4 : 3)} <em>gwei / ${coin.ticker}</em>
                </strong>
              </div>
              <span className="rf-panel-note is-right">
                {graduated ? 'locked full-range pool · 1% hook' : 'curve price · 1% in ETH'}
              </span>
            </header>

            <div className="rf-chart">
              <Sparkline series={coin.series} height={228} strokeWidth={1.2} grid />
            </div>

            <footer className="rf-chart-foot">
              <div>
                <span>24H VOL</span>
                <strong>{fmtEth(coin.volume24hEth)} ETH</strong>
              </div>
              <div>
                <span>HOLDERS</span>
                <strong>{fmtCompact(coin.holders)}</strong>
              </div>
              <div>
                <span>{graduated ? 'VENUE' : 'BONDED'}</span>
                <strong>{graduated ? 'v4' : `${Math.round(progress * 100)}%`}</strong>
              </div>
              <div>
                <span>POT FUNDED</span>
                <strong className="is-gold">{coin.jackpotEth.toFixed(4)} ETH</strong>
              </div>
            </footer>
          </section>

          <section className="rf-panel rf-tape-panel">
            <header className="rf-panel-head">
              <h3>Trade tape</h3>
              <span className="rf-panel-k">
                {coin.trades?.length ?? 0} recent · on-chain
              </span>
            </header>
            {(coin.trades?.length ?? 0) === 0 ? (
              <p className="rf-panel-note">
                No trades indexed yet. The tape fills from <code>Bought</code> / <code>Sold</code>{' '}
                logs — curve before graduation, the v4 pool after.
              </p>
            ) : (
              <ul className="rf-tape">
                {coin.trades!.slice(0, 10).map((t) => (
                  <li key={t.id}>
                    <span className={`rf-tape-side is-${t.side}`}>{t.side}</span>
                    <code>{shortAddr(t.trader)}</code>
                    <em className={`rf-tape-venue is-${t.venue}`}>
                      {t.venue === 'pool' ? 'v4' : 'curve'}
                    </em>
                    <span className="rf-tape-in">
                      {t.side === 'buy' ? `${t.eth.toFixed(4)} ETH` : `${fmtCompact(t.tokens)}`}
                    </span>
                    <strong>
                      {t.side === 'buy' ? fmtCompact(t.tokens) : `${t.eth.toFixed(5)} ETH`}
                    </strong>
                    <time>{fmtClock(t.ts)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rf-panel">
            <header className="rf-panel-head">
              <h3>Bonding curve</h3>
              <span className="rf-panel-k">{fmtEth(coin.bondedEth)} / {GRADUATION_ETH} ETH</span>
            </header>
            <div className="rf-bond-track is-wide">
              <span style={{ width: `${Math.max(progress * 100, 1.5)}%` }} />
            </div>
            <div className="rf-bond-rows">
              <span>
                Bonded <strong>{fmtEth(coin.bondedEth)} ETH</strong>
              </span>
              <span>
                Graduates at <strong>{GRADUATION_ETH} ETH</strong>
              </span>
              <span>
                Jackpot funded <strong className="is-gold">{coin.jackpotEth.toFixed(4)} ETH</strong>
              </span>
            </div>
            {isLive && coin.ready && !graduated && (
              <>
                <p className="rf-panel-note">
                  The 4.2 ETH ceiling is reached. Graduation opens a Uniswap v4 pool at the curve
                  price and locks the LP forever; sellers are never trapped at the line.
                </p>
                <button
                  className="rf-cta is-inline"
                  disabled={busy === 'graduate'}
                  onClick={() => void onGraduate?.(coin.curve as `0x${string}`)}
                >
                  {busy === 'graduate' ? 'Opening the pool…' : 'Graduate to Uniswap v4'}
                </button>
              </>
            )}
            {isLive &&
              wallet &&
              coin.creatorFull?.toLowerCase() === wallet.toLowerCase() && (
                <button
                  className="rf-cta is-inline"
                  disabled={busy === 'claim'}
                  onClick={() => void onClaimCreator?.(coin.curve as `0x${string}`)}
                >
                  {busy === 'claim'
                    ? 'Claiming…'
                    : graduated
                      ? 'Claim pool creator fees'
                      : 'Claim creator fees'}
                </button>
              )}
          </section>

          <div className="rf-panels">
            <section className="rf-panel">
              <h3>Holders</h3>
              {isLive && (coin.holderRows?.length ?? 0) > 0 ? (
                <ul className="rf-rows">
                  {coin.holderRows!.slice(0, 6).map((h, i) => (
                    <li key={h.address}>
                      <span className="rf-rank">{i + 1}</span>
                      <code>{shortAddr(h.address)}</code>
                      <strong>{h.pct.toFixed(2)}%</strong>
                    </li>
                  ))}
                </ul>
              ) : isLive ? (
                <p className="rf-panel-note">
                  {fmtCompact(coin.holders)} addresses hold this coin. Ranked rows appear once the
                  token transfer tape is indexed.
                </p>
              ) : (
                <ul className="rf-rows">
                  {DEMO_HOLDERS.map((h) => (
                    <li key={h.addr}>
                      <span className="rf-rank">{h.rank}</span>
                      <code>{h.addr}</code>
                      {h.tag && <em className="rf-tag">{h.tag}</em>}
                      <strong>{h.pct.toFixed(2)}%</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rf-panel">
              <h3>Fees → jackpot</h3>
              <ul className="rf-rows">
                <li>
                  <span className="rf-rank">→</span>
                  <code>JackpotRouter.injectJackpot</code>
                  <strong>{JACKPOT_BPS} bps</strong>
                </li>
                <li>
                  <span className="rf-rank">→</span>
                  <code>RansomeVault.prizePoolReserve</code>
                  <strong>no skim</strong>
                </li>
                <li>
                  <span className="rf-rank">→</span>
                  <code>FeeCollector.flush()</code>
                  <strong>per threshold</strong>
                </li>
              </ul>
              <p className="rf-panel-note">
                One flush per threshold, never per trade — the header plate is event-sourced from{' '}
                <code>JackpotInjected</code>.
              </p>
            </section>
          </div>
        </div>

        <aside className="rf-trade">
          <header className="rf-trade-head">
            <span className="rf-panel-k">Trade</span>
            <strong>
              ${coin.ticker}<em>/ETH</em>
            </strong>
          </header>

          <div className="rf-seg" role="group" aria-label="Side">
            <button className={side === 'buy' ? 'is-on' : ''} onClick={() => setSide('buy')}>
              Buy
            </button>
            <button className={side === 'sell' ? 'is-on' : ''} onClick={() => setSide('sell')}>
              Sell
            </button>
          </div>

          <label className="rf-field">
            <span>{side === 'buy' ? 'You pay' : 'You sell'}</span>
            <div className="rf-input">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                aria-label={side === 'buy' ? 'Amount in ETH' : `Amount in ${coin.ticker}`}
              />
              <em>{side === 'buy' ? 'ETH' : `$${coin.ticker}`}</em>
            </div>
          </label>

          <div className="rf-quick">
            {side === 'buy'
              ? ['0.05', '0.1', '0.5', '1'].map((v) => (
                  <button key={v} onClick={() => setAmount(v)} className={amount === v ? 'is-on' : ''}>
                    {v}
                  </button>
                ))
              : [25, 50, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setAmount(String(((coin.balance ?? 0) * pct) / 100))}
                    className=""
                  >
                    {pct}%
                  </button>
                ))}
          </div>

          <div className="rf-receive">
            <span>You receive</span>
            <strong>
              {side === 'buy' ? (
                <>
                  {tokensOut > 0 ? fmtCompact(tokensOut) : '0'} <em>${coin.ticker}</em>
                </>
              ) : (
                <>
                  {ethOut > 0 ? ethOut.toFixed(6) : '0'} <em>ETH</em>
                </>
              )}
            </strong>
          </div>
          {side === 'sell' && (
            <p className="rf-panel-note">
              Balance {fmtCompact(coin.balance ?? 0)} ${coin.ticker} ·{' '}
              {graduated ? 'sells settle in the v4 pool.' : 'sells stay open after graduation.'}
            </p>
          )}

          {/* The split is printed HERE, on the confirm panel, not on an explainer page. */}
          <div className="rf-split">
            <div className="rf-split-bar" aria-hidden="true">
              <span className="rf-split-creator" style={{ width: `${CREATOR_BPS / 100}%` }} />
              <span className="rf-split-jackpot" style={{ width: `${JACKPOT_BPS / 100}%` }} />
              <span className="rf-split-treasury" style={{ width: `${TREASURY_BPS / 100}%` }} />
            </div>
            <ul>
              <li>
                <span className="rf-dot rf-dot-creator" /> Creator
                <strong>{fees.creator.toFixed(6)} ETH</strong>
                <em>0.70%</em>
              </li>
              <li>
                <span className="rf-dot rf-dot-jackpot" /> Jackpot
                <strong>{fees.jackpot.toFixed(6)} ETH</strong>
                <em>0.20%</em>
              </li>
              <li>
                <span className="rf-dot rf-dot-treasury" /> Treasury
                <strong>{fees.treasury.toFixed(6)} ETH</strong>
                <em>0.01%</em>
              </li>
            </ul>
            <p className="rf-split-note">{FEE_CLAIM}</p>
          </div>

          {!walletConnected ? (
            <button className="rf-cta" onClick={onConnect}>
              Connect wallet
            </button>
          ) : !isLive ? (
            <button className="rf-cta" disabled title="No LaunchFactory address configured">
              Curve not deployed
            </button>
          ) : (
            <button
              className="rf-cta"
              disabled={!canTrade}
              onClick={() => {
                if (side === 'buy') {
                  void onBuy?.(coin.curve as `0x${string}`, amountNum, Math.floor(tokensOut * 0.99));
                } else {
                  void onSell?.(
                    coin.curve as `0x${string}`,
                    coin.token as `0x${string}`,
                    amountNum,
                    ethOut * 0.99,
                  );
                }
              }}
            >
              {busy === 'buy' || busy === 'sell'
                ? 'Confirming…'
                : `${side === 'buy' ? 'Buy' : 'Sell'} $${coin.ticker}`}
            </button>
          )}
          {error && <p className="rf-err">{error}</p>}
          <p className="rf-panel-note">
            {isLive ? (
              <>
                {graduated ? (
                  <>
                    Settles in the v4 pool via <code>LaunchSwapRouter</code>; the{' '}
                    <code>LaunchFeeHook</code> takes 1% on the ETH leg only. 70% creator / 20%
                    jackpot / 10% treasury.
                  </>
                ) : (
                  <>
                    Settles on <code>LaunchCurve</code> in ETH. 70% of the fee is claimable by the
                    creator, 29% is already routed to the jackpot, 1% to treasury.
                  </>
                )}
              </>
            ) : (
              <>
                P1 lands <code>LaunchCurve</code> + <code>LaunchFactory</code>; this panel already
                carries the exact split the curve takes in-trade.
              </>
            )}
          </p>
        </aside>
      </div>
    </div>
  );
}
