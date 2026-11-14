'use client';

import React, { useMemo } from 'react';
import { TOTAL_SUPPLY, fmtCompact, fmtEth, fmtPct, shortAddr, type LaunchCoin } from '@/lib/launchpad-demo';
import { CoinAvatar } from './BoardView';

type Props = {
  coins: LaunchCoin[];
  live?: boolean;
  wallet: string | null;
  lockedAmount: string;
  lockEligible: boolean;
  isUnbonding: boolean;
  onConnect: () => void;
  onOpenLock: () => void;
  onOpenCoin: (id: string) => void;
  onOpenCabinet: () => void;
};

export default function PortfolioView({
  coins,
  live = false,
  wallet,
  lockedAmount,
  lockEligible,
  isUnbonding,
  onConnect,
  onOpenLock,
  onOpenCoin,
  onOpenCabinet,
}: Props) {
  // Live: only coins this wallet actually holds. Preview: the first three
  // coins with deterministic balances, labelled as such.
  const holdings = useMemo(() => {
    if (live) {
      return coins
        .filter((c) => (c.balance ?? 0) > 0)
        .map((c) => {
          const balance = c.balance ?? 0;
          const price =
            c.virtualEth && c.virtualToken
              ? c.virtualEth / c.virtualToken
              : c.mcapEth / TOTAL_SUPPLY;
          return { coin: c, balance, valueEth: balance * price };
        });
    }
    return coins.slice(0, 3).map((c, i) => {
      const balance = [14_200_000, 3_650_000, 880_000][i] ?? 0;
      const price = c.mcapEth / TOTAL_SUPPLY;
      return { coin: c, balance, valueEth: balance * price };
    });
  }, [coins, live]);

  const lockedNum = Number(lockedAmount) || 0;

  return (
    <div className="rf-portfolio">
      <header className="rf-page-head">
        <div>
          <span className="rf-kicker">Account</span>
          <h1 className="rf-page-title">Portfolio</h1>
          <p className="rf-lede">
            {wallet ? (
              <>
                <code>{shortAddr(wallet)}</code> · one wallet for the board and the cabinet
              </>
            ) : (
              'Connect a wallet to see balances, locks and creator fees.'
            )}
          </p>
        </div>
        {!wallet && (
          <button className="rf-cta is-inline" onClick={onConnect}>
            Connect wallet
          </button>
        )}
      </header>

      <div className="rf-tiles">
        <button className="rf-tile" onClick={onOpenLock}>
          <span className="rf-tile-k">LOCKED RAFFLE</span>
          <strong className="rf-tile-v">{fmtCompact(lockedNum)}</strong>
          <span className={`rf-tile-state ${lockEligible ? 'is-up' : ''}`}>
            {isUnbonding
              ? 'unbonding — discount paused'
              : lockEligible
                ? '50% ticket discount active'
                : 'lock 1,000 for half-price tickets'}
          </span>
        </button>

        <button className="rf-tile" onClick={onOpenCabinet}>
          <span className="rf-tile-k">TICKETS</span>
          <strong className="rf-tile-v">0</strong>
          <span className="rf-tile-state">open the cabinet to mint</span>
        </button>

        <div className="rf-tile is-static">
          <span className="rf-tile-k">CREATOR FEES</span>
          <strong className="rf-tile-v">{live ? '—' : '0.0000'}</strong>
          <span className="rf-tile-state">
            {live ? 'claim on each coin page' : 'claimable any time, in ETH'}
          </span>
        </div>
      </div>

      <section className="rf-panel">
        <header className="rf-panel-head">
          <h3>Holdings</h3>
          <span className="rf-panel-k">{live ? 'on-chain balances' : 'preview balances'}</span>
        </header>
        {holdings.length === 0 ? (
          <div className="rf-empty">{live ? 'No coin balances in this wallet yet.' : 'Nothing yet.'}</div>
        ) : (
          <table className="rf-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Balance</th>
                <th>Value</th>
                <th>24h</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map(({ coin, balance, valueEth }) => (
                <tr key={coin.id} onClick={() => onOpenCoin(coin.id)}>
                  <td>
                    <span className="rf-table-coin">
                      <CoinAvatar coin={coin} size={26} radius={8} />
                      <span>
                        <strong>{coin.name}</strong>
                        <em>${coin.ticker}</em>
                      </span>
                    </span>
                  </td>
                  <td>{fmtCompact(balance)}</td>
                  <td>{fmtEth(valueEth, 4)} ETH</td>
                  <td>
                    <span className={`rf-delta ${coin.change24h >= 0 ? 'is-up' : 'is-down'}`}>
                      {fmtPct(coin.change24h)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="rf-panel-note">
          {live ? (
            <>
              Balances are read from each <code>LaunchToken</code>; values use the curve price. The
              lock figures come from <code>XLockVault</code>.
            </>
          ) : (
            <>
              Preview balances — the board is a local dataset until <code>LaunchFactory</code> is
              deployed. The lock figures are read from <code>XLockVault</code> and are real.
            </>
          )}
        </p>
      </section>
    </div>
  );
}
