'use client';

import React, { useEffect, useState } from 'react';
import {
  CREATOR_BPS,
  FEE_CLAIM,
  JACKPOT_BPS,
  LAUNCH_FEE_ETH,
  TOTAL_SUPPLY,
  TREASURY_BPS,
} from '@/lib/launchpad-demo';

type Props = {
  wallet: string | null;
  onConnect: () => void;
  live?: boolean;
  busy?: string | null;
  error?: string | null;
  onCreate?: (input: {
    name: string;
    ticker: string;
    blurb: string;
    recipient: `0x${string}`;
    initialBuyEth: number;
  }) => Promise<`0x${string}` | null>;
  onLaunched?: (curve: `0x${string}`) => void;
};

export default function CreateView({ wallet, onConnect, live, busy, error, onCreate, onLaunched }: Props) {
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [blurb, setBlurb] = useState('');
  const [recipient, setRecipient] = useState(wallet ?? '');
  const [initialBuy, setInitialBuy] = useState('0.05');

  useEffect(() => {
    if (!recipient && wallet) setRecipient(wallet);
  }, [wallet, recipient]);

  const tickerOk = /^[A-Z0-9]{2,10}$/.test(ticker);
  const nameOk = name.trim().length >= 2;
  const recipientOk = /^0x[a-fA-F0-9]{40}$/.test(recipient);
  const buyNum = Number(initialBuy) || 0;
  const ready = tickerOk && nameOk && recipientOk && !!wallet && !!live && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !onCreate) return;
    const curve = await onCreate({
      name,
      ticker,
      blurb,
      recipient: recipient as `0x${string}`,
      initialBuyEth: buyNum,
    });
    if (curve) onLaunched?.(curve);
  };

  return (
    <div className="rf-create">
      <header className="rf-page-head">
        <div>
          <span className="rf-kicker">Launch</span>
          <h1 className="rf-page-title">Launch a coin</h1>
          <p className="rf-lede">
            Fixed supply of {TOTAL_SUPPLY.toLocaleString()}, quoted in ETH. 0.20% of every trade goes
            to the jackpot whether you like it or not. That is the whole pitch.
          </p>
        </div>
        {live ? (
          <span className="rf-chip is-live">FACTORY LIVE</span>
        ) : (
          <span className="rf-chip is-warn">FACTORY NOT DEPLOYED</span>
        )}
      </header>

      <div className="rf-create-body">
        <form className="rf-form" onSubmit={submit}>
          <div className="rf-form-row">
            <label className="rf-field">
              <span>Name</span>
              <div className="rf-input">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Last Ticket"
                  maxLength={32}
                />
              </div>
            </label>

            <label className="rf-field">
              <span>Ticker</span>
              <div className="rf-input">
                <input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="TICKET"
                  maxLength={10}
                />
                <em>${ticker || '—'}</em>
              </div>
              {ticker && !tickerOk && <small className="rf-err">2–10 letters or digits.</small>}
            </label>
          </div>

          <label className="rf-field">
            <span>
              Description <em className="rf-optional">optional</em>
            </span>
            <div className="rf-input is-area">
              <textarea
                value={blurb}
                onChange={(e) => setBlurb(e.target.value)}
                rows={3}
                maxLength={140}
                placeholder="One sentence a stranger would repeat."
              />
            </div>
          </label>

          <div className="rf-form-row">
            <label className="rf-field">
              <span>
                Image URL <em className="rf-optional">optional</em>
              </span>
              <div className="rf-input">
                <input placeholder="https://…" inputMode="url" />
              </div>
            </label>

            <label className="rf-field">
              <span>Creator fee recipient</span>
              <div className="rf-input">
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={wallet ?? '0x…'}
                  spellCheck={false}
                />
              </div>
            </label>
          </div>

          <p className="rf-panel-note">
            0.70% of every trade lands in the recipient address, claimable at any time. This is the
            launch incentive — it is never skimmed toward the jackpot.
          </p>

          <label className="rf-field">
            <span>Your first buy <em className="rf-optional">optional</em></span>
            <div className="rf-input">
              <input
                value={initialBuy}
                onChange={(e) => setInitialBuy(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
              />
              <em>ETH</em>
            </div>
            {buyNum > 0 && (
              <small className="rf-panel-note">
                Rides inside the creation transaction at the normal 1% fee.
              </small>
            )}
          </label>

          <div className="rf-launch-fee">
            <div>
              <span>Launch fee</span>
              <strong>{LAUNCH_FEE_ETH} ETH</strong>
            </div>
            <div>
              <span>Due now</span>
              <strong>{(LAUNCH_FEE_ETH + buyNum).toFixed(4)} ETH</strong>
            </div>
            <div>
              <span>Creation-slot fee</span>
              <strong>99%</strong>
            </div>
            <p>
              A trade in the block the coin is created pays 99% instead of 1%. Your own first buy
              rides inside the creation transaction, so it pays the normal fee — only block-0 bots
              get taxed.
            </p>
          </div>

          {!wallet ? (
            <button className="rf-cta" type="button" onClick={onConnect}>
              Connect wallet to launch
            </button>
          ) : !live ? (
            <button className="rf-cta" type="submit" disabled title="No LaunchFactory address configured">
              Factory not deployed
            </button>
          ) : (
            <button className="rf-cta" type="submit" disabled={!ready}>
              {busy === 'create' ? 'Launching…' : `Launch for ${(LAUNCH_FEE_ETH + buyNum).toFixed(4)} ETH`}
            </button>
          )}
          {error && <p className="rf-err">{error}</p>}
          <p className="rf-panel-note">
            <code>LaunchFactory</code> creates the coin, its curve and the creator escrow in one
            transaction. The 70 bps claim vests to the recipient address above.
          </p>
        </form>

        <aside className="rf-create-side">
          <section className="rf-panel">
            <h3>Where every 1.00% goes</h3>
            <div className="rf-split-bar is-tall" aria-hidden="true">
              <span className="rf-split-creator" style={{ width: `${CREATOR_BPS / 100}%` }} />
              <span className="rf-split-jackpot" style={{ width: `${JACKPOT_BPS / 100}%` }} />
              <span className="rf-split-treasury" style={{ width: `${TREASURY_BPS / 100}%` }} />
            </div>
            <ul className="rf-rows">
              <li>
                <span className="rf-dot rf-dot-creator" /> Creator
                <strong>{(CREATOR_BPS / 100).toFixed(2)}%</strong>
              </li>
              <li>
                <span className="rf-dot rf-dot-jackpot" /> Jackpot
                <strong>{(JACKPOT_BPS / 100).toFixed(2)}%</strong>
              </li>
              <li>
                <span className="rf-dot rf-dot-treasury" /> Treasury
                <strong>{(TREASURY_BPS / 100).toFixed(2)}%</strong>
              </li>
            </ul>
            <p className="rf-split-note">{FEE_CLAIM}</p>
          </section>

          <section className="rf-panel">
            <h3>Terms</h3>
            <ul className="rf-rows">
              <li>
                <span>Graduation</span>
                <strong>4.2 ETH paired</strong>
              </li>
              <li>
                <span>After graduation</span>
                <strong>Uni V3 · 1% pool</strong>
              </li>
              <li>
                <span>Supply</span>
                <strong>1B · fixed</strong>
              </li>
              <li>
                <span>Creator fee</span>
                <strong>any time</strong>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
