'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useEvmWallet } from '@/lib/use-evm-wallet';
import { DEMO_JACKPOT_USD } from '@/lib/launchpad-demo';
import { useRafflePot } from '@/lib/use-raffle-chain';
import { useLaunchpad } from '@/lib/use-launchpad';
import AppBar, { type LaunchView } from './AppBar';
import BoardView from './BoardView';
import CoinView from './CoinView';
import CreateView from './CreateView';
import PortfolioView from './PortfolioView';
import PerpsView from './PerpsView';
import LockPanel from './LockPanel';
import CabinetView from './CabinetView';

export default function RaffleApp() {
  const wallet = useEvmWallet();
  const launch = useLaunchpad(wallet.address);
  // The one number that lives in the header in both modes (§6.11.2). Read from
  // the vault when the core contracts exist; the preview figure is only shown
  // when there is no chain to read.
  const pot = useRafflePot();
  const jackpotUsd = pot.live ? pot.usd : DEMO_JACKPOT_USD;
  const [view, setView] = useState<LaunchView>('board');
  const [coinId, setCoinId] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(false);

  const coin = launch.coinById(coinId);

  const openCoin = useCallback((id: string) => {
    setCoinId(id);
    setView('board');
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    document.title = 'raffle.fun — trade the coin, play the draw';
  }, []);

  const goView = useCallback((v: LaunchView) => {
    setCoinId(null);
    setCabinetOpen(false);
    setView(v);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  // The cabinet lives in the board's tray (§6.28) — the same element in the
  // same place on every view, so there is no second surface to keep in sync.
  const renderCabinet = useCallback(
    (close: () => void) => (
      <CabinetView
        jackpotUsd={jackpotUsd}
        lockEligible={wallet.isDiscountEligible}
        wallet={wallet}
        onConnect={wallet.connect}
        onClose={close}
      />
    ),
    [jackpotUsd, wallet],
  );

  return (
    <div className="rf-app">
      <div className="rf-glow" aria-hidden="true" />

      <AppBar
        view={view}
        onView={goView}
        jackpotUsd={jackpotUsd}
        wallet={wallet.address}
        connecting={wallet.connecting}
        onConnect={wallet.connect}
        onDisconnect={wallet.disconnect}
        lockEligible={wallet.isDiscountEligible}
        lockedAmount={wallet.lockedXAmount}
        requiredLock={wallet.requiredLock}
        onOpenLock={() => setLockOpen(true)}
      />

      <main className="rf-main">
        {coin ? (
          <CoinView
            coin={coin}
            onBack={() => setCoinId(null)}
            walletConnected={!!wallet.address}
            onConnect={wallet.connect}
            live={launch.live}
            busy={launch.busy}
            error={launch.error}
            wallet={wallet.address}
            onClaimCreator={launch.claimCreator}
            onGraduate={launch.graduate}
            onBuy={launch.buy}
            onSell={launch.sell}
          />
        ) : view === 'portfolio' ? (
          <PortfolioView
            coins={launch.coins}
            live={launch.live}
            wallet={wallet.address}
            lockedAmount={wallet.lockedXAmount}
            lockEligible={wallet.isDiscountEligible}
            isUnbonding={wallet.isUnbonding}
            onConnect={wallet.connect}
            onOpenLock={() => setLockOpen(true)}
            onOpenCoin={openCoin}
            onOpenCabinet={() => {
              setView('board');
              setCabinetOpen(true);
              window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
            }}
          />
        ) : view === 'perps' ? (
          <PerpsView wallet={wallet.address} />
        ) : view === 'create' ? (
          <CreateView
            wallet={wallet.address}
            onConnect={wallet.connect}
            live={launch.live}
            busy={launch.busy}
            error={launch.error}
            onCreate={launch.createCoin}
            onLaunched={openCoin}
          />
        ) : (
          <BoardView
            coins={launch.coins}
            jackpotUsd={jackpotUsd}
            onOpen={openCoin}
            cabinetOpen={cabinetOpen}
            onCabinetChange={setCabinetOpen}
            renderCabinet={renderCabinet}
            live={launch.live}
            error={launch.error}
          />
        )}
      </main>

      <footer className="rf-foot">
        <span>raffle.fun — the board is the venue, the cabinet is side B.</span>
        <span>
          59 draws · numbers 1–90 · the jackpot is funded by 29 of every 30 bps of the platform fee,
          never printed as 100%
        </span>
      </footer>

      {/* mobile-only bottom nav mirroring pump.fun */}
      <nav className="rf-mobilenav" aria-label="Mobile navigation">
        <button
          className={`rf-mobilenav-btn ${view === 'board' && !coinId ? 'is-on' : ''}`}
          onClick={() => goView('board')}
          aria-label="Home"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
        </button>
        <button
          className={`rf-mobilenav-btn ${view === 'perps' ? 'is-on' : ''}`}
          onClick={() => goView('perps')}
          aria-label="Perps"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
        </button>
        <button
          className={`rf-mobilenav-btn ${view === 'create' ? 'is-on' : ''}`}
          onClick={() => goView('create')}
          aria-label="Create"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
        </button>
        <button
          className={`rf-mobilenav-btn ${view === 'portfolio' ? 'is-on' : ''}`}
          onClick={() => goView('portfolio')}
          aria-label="Activity"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V5M4 19h16M8 15v-4M12 15V9M16 15v-6" /></svg>
        </button>
        <button
          className={`rf-mobilenav-btn ${cabinetOpen ? 'is-on' : ''}`}
          onClick={() => {
            if (view !== 'board') goView('board');
            setCabinetOpen(true);
          }}
          aria-label="More"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1.5" /><circle cx="6" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></svg>
        </button>
      </nav>

      <LockPanel
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        wallet={wallet.address}
        onConnect={wallet.connect}
        lockedAmount={wallet.lockedXAmount}
        xBalance={wallet.xBalance}
        lockEligible={wallet.isDiscountEligible}
        requiredLock={wallet.requiredLock}
        isUnbonding={wallet.isUnbonding}
        unlockTimestamp={wallet.unlockTimestamp}
        onLock={wallet.lockXTokens}
        onUnlock={wallet.initiateUnlockX}
        onWithdraw={wallet.withdrawX}
        yieldBalance={wallet.yieldBalance}
        onClaimYield={wallet.claimYield}
      />
    </div>
  );
}
