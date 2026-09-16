'use client';
import React, { useState } from 'react';
import { useEvmWallet } from '@/lib/use-evm-wallet';
import {
  ROBINHOOD_CHAIN_ID,
  SUPPORTED_EVM_CHAINS,
  STANDARD_MINT_PRICE_USD,
  DISCOUNTED_MINT_PRICE_USD,
  STANDARD_MINT_PRICE_X,
  DISCOUNTED_MINT_PRICE_X,
} from '@/lib/robinhood-config';

export function RobinhoodLockPanel({
  onSkipLobby,
  onMintSuccess,
}: {
  onSkipLobby?: () => void;
  onMintSuccess?: (count: number) => void;
}) {
  const {
    address,
    chainId,
    connecting,
    connect,
    disconnect,
    switchNetwork,
    ethBalance,
    usdgBalance,
    usdcBalance,
    usdtBalance,
    xBalance,
    vaultXBalance,
    lockedXAmount,
    isDiscountEligible,
    isUnbonding,
    unlockTimestamp,
    claimTestXFaucet,
    mintTestXWithEth,
    lockXTokens,
    initiateUnlockX,
    withdrawX,
    mintConsoles,
  } = useEvmWallet();

  const [selectedChainId, setSelectedChainId] = useState<number>(ROBINHOOD_CHAIN_ID);
  const [selectedToken, setSelectedToken] = useState<'ETH' | 'X' | 'USDG' | 'USDC' | 'USDT'>('ETH');
  const [consoleCount, setConsoleCount] = useState<number>(1);
  const [lockInput, setLockInput] = useState('1000');
  const [testEthInput, setTestEthInput] = useState('0.005');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const currentChain = chainId ? SUPPORTED_EVM_CHAINS[chainId] : null;
  const isRobinhood = chainId === ROBINHOOD_CHAIN_ID;

  // Generate random 5x5 bingo grid for minting
  const generateRandomGrid = (): number[][] => {
    const numbers: number[] = [];
    while (numbers.length < 25) {
      const n = Math.floor(Math.random() * 90) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }
    const grid: number[][] = [];
    for (let r = 0; r < 5; r++) {
      grid.push(numbers.slice(r * 5, (r + 1) * 5));
    }
    return grid;
  };

  const handleNetworkChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const targetId = Number(e.target.value);
    setSelectedChainId(targetId);
    if (address) {
      await switchNetwork(targetId);
    }
  };

  const handleMintConsoles = async () => {
    if (!address) {
      await connect();
      return;
    }
    try {
      setLoading(true);
      setMsg(`⚡ Minting ${consoleCount} console(s) via ${selectedToken}...`);
      
      const grids: number[][][] = [];
      for (let i = 0; i < consoleCount; i++) {
        grids.push(generateRandomGrid());
      }

      await mintConsoles(selectedToken, consoleCount, grids);
      setMsg(`✅ Successfully minted ${consoleCount} console(s) with ${selectedToken}!`);
      if (onMintSuccess) onMintSuccess(consoleCount);
    } catch (e: any) {
      setMsg(`❌ Mint failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFaucet = async () => {
    try {
      setLoading(true);
      setMsg('Requesting 5,000 Test X tokens from faucet...');
      await claimTestXFaucet();
      setMsg('🎁 5,000 Test X received in wallet!');
    } catch (e: any) {
      setMsg(`❌ Faucet failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMintWithEth = async () => {
    try {
      setLoading(true);
      setMsg(`Minting Test X with ${testEthInput} Test ETH...`);
      await mintTestXWithEth(testEthInput);
      setMsg('⚡ Test X tokens minted successfully!');
    } catch (e: any) {
      setMsg(`❌ Mint failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async () => {
    try {
      setLoading(true);
      setMsg('Approving & Locking X tokens...');
      await lockXTokens(Number(lockInput));
      setMsg('✅ 1,000 X Locked! 50% discount activated.');
    } catch (e: any) {
      setMsg(`❌ Lock failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInitiateUnlock = async () => {
    try {
      setLoading(true);
      setMsg('Initiating 24h unbonding cooldown...');
      await initiateUnlockX();
      setMsg('⏳ 24h unbonding clock started. Discount disabled.');
    } catch (e: any) {
      setMsg(`❌ Cooldown init failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    try {
      setLoading(true);
      setMsg('Withdrawing unlocked X tokens...');
      await withdrawX();
      setMsg('✅ Tokens returned to wallet.');
    } catch (e: any) {
      setMsg(`❌ Withdrawal failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const canWithdraw = isUnbonding && unlockTimestamp > 0 && now >= unlockTimestamp;
  const remainingSeconds = isUnbonding && unlockTimestamp > now ? unlockTimestamp - now : 0;
  const remainingHours = (remainingSeconds / 3600).toFixed(1);

  // Price estimate calculation
  const unitUsd = isDiscountEligible ? DISCOUNTED_MINT_PRICE_USD : STANDARD_MINT_PRICE_USD;
  const unitX = isDiscountEligible ? DISCOUNTED_MINT_PRICE_X : STANDARD_MINT_PRICE_X;

  return (
    <div style={{
      background: 'linear-gradient(180deg, #06101c 0%, #03080e 100%)',
      border: '1px solid #14324f',
      borderRadius: 12,
      padding: '16px',
      margin: '12px 0',
      fontFamily: 'DM Mono, monospace',
      color: '#e2f1ff',
    }}>
      {/* Top Bar: Chain Selector & Wallet Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#00e5a0' }}>🌐 EVM NETWORK:</span>
          <select
            value={chainId || selectedChainId}
            onChange={handleNetworkChange}
            style={{
              background: '#0a233a',
              color: '#00b8ff',
              border: '1px solid #144970',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
              fontFamily: 'inherit',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {Object.values(SUPPORTED_EVM_CHAINS).map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name} ({chain.shortName}) {chain.isTestnet ? '[Testnet]' : ''}
              </option>
            ))}
          </select>
        </div>

        {!address ? (
          <button
            onClick={connect}
            disabled={connecting}
            style={{
              background: 'linear-gradient(135deg, #00e5a0, #00b8ff)',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {connecting ? 'CONNECTING...' : 'CONNECT EVM WALLET'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#7ab3d6' }}>
              {address.slice(0, 6)}...{address.slice(-4)} ({currentChain ? currentChain.shortName : `ID ${chainId}`})
            </span>
            <button
              onClick={disconnect}
              style={{
                background: '#142535',
                color: '#ff4d6d',
                border: '1px solid #ff4d6d33',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              DISCONNECT
            </button>
          </div>
        )}
      </div>

      {/* Prize Vault & Balances */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 8,
        marginBottom: 14,
        background: '#040d16',
        padding: '10px',
        borderRadius: 8,
        border: '1px solid #0c2338',
      }}>
        <div>
          <div style={{ fontSize: 9, color: '#00e5a0', fontWeight: 700 }}>🏆 VAULT PRIZE POOL</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#00e5a0' }}>{Number(vaultXBalance).toLocaleString()} X</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#527c99' }}>ETH BALANCE</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#00b8ff' }}>{Number(ethBalance).toFixed(4)} ETH</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#527c99' }}>YOUR X BALANCE</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#00b8ff' }}>{Number(xBalance).toFixed(2)} X</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#527c99' }}>MINT DISCOUNT</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: isDiscountEligible ? '#00e5a0' : '#888' }}>
            {isDiscountEligible ? '50% OFF ($0.25 / 25 X)' : 'STANDARD ($0.50 / 50 X)'}
          </div>
        </div>
      </div>

      {/* CONSOLE MINTING INTERFACE */}
      <div style={{
        background: '#071524',
        border: '1px solid #112d47',
        borderRadius: 8,
        padding: '12px',
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#00e5a0', marginBottom: 8 }}>
          🎮 MINT HACKING CONSOLES (MULTI-CHAIN ETH & X TOKEN)
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {/* Payment Token Selection */}
          <div>
            <div style={{ fontSize: 9, color: '#6894b5', marginBottom: 4 }}>PAYMENT ASSET:</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['ETH', 'X', 'USDG', 'USDC', 'USDT'] as const).map((tok) => (
                <button
                  key={tok}
                  onClick={() => setSelectedToken(tok)}
                  style={{
                    background: selectedToken === tok ? 'linear-gradient(135deg, #00e5a0, #00b8ff)' : '#0b1d30',
                    color: selectedToken === tok ? '#000' : '#88a8c2',
                    border: '1px solid #1a4266',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tok === 'X' ? 'X (Robinhood)' : tok}
                </button>
              ))}
            </div>
          </div>

          {/* Console Quantity */}
          <div>
            <div style={{ fontSize: 9, color: '#6894b5', marginBottom: 4 }}>CONSOLES:</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 5, 10].map((num) => (
                <button
                  key={num}
                  onClick={() => setConsoleCount(num)}
                  style={{
                    background: consoleCount === num ? '#00e5a0' : '#0b1d30',
                    color: consoleCount === num ? '#000' : '#88a8c2',
                    border: '1px solid #1a4266',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {num}x
                </button>
              ))}
            </div>
          </div>

          {/* Cost Estimate & Mint Button */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: '#6894b5' }}>ESTIMATED TOTAL:</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#00e5a0' }}>
                {selectedToken === 'X'
                  ? `${unitX * consoleCount} X`
                  : `$${(unitUsd * consoleCount).toFixed(2)} USD (${selectedToken})`}
              </div>
            </div>
            <button
              onClick={handleMintConsoles}
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, #00e5a0, #00b8ff)',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {loading ? 'MINTING...' : `MINT ${consoleCount} CONSOLE(S)`}
            </button>
          </div>
        </div>
      </div>

      {/* DEV MODE TEST CONTROLS */}
      {address && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.05)',
          border: '1px dashed #f59e0b55',
          borderRadius: 8,
          padding: '10px 12px',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
            🛠️ DEV MODE TEST TOOLS (TESTNET / FAUCET)
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={handleFaucet}
              disabled={loading}
              style={{
                background: '#f59e0b',
                color: '#000',
                border: 'none',
                borderRadius: 5,
                padding: '5px 10px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🎁 CLAIM 5,000 TEST X (FREE)
            </button>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="text"
                value={testEthInput}
                onChange={(e) => setTestEthInput(e.target.value)}
                style={{
                  background: '#03080e',
                  border: '1px solid #1a4266',
                  borderRadius: 5,
                  padding: '4px 6px',
                  color: '#fff',
                  fontSize: 10,
                  width: '60px',
                }}
              />
              <button
                onClick={handleMintWithEth}
                disabled={loading}
                style={{
                  background: '#0a2a4a',
                  color: '#00b8ff',
                  border: '1px solid #00b8ff55',
                  borderRadius: 5,
                  padding: '5px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⚡ MINT WITH TEST ETH
              </button>
            </div>
            {onSkipLobby && (
              <button
                onClick={onSkipLobby}
                style={{
                  background: 'linear-gradient(135deg, #00e5a0, #00b8ff)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 5,
                  padding: '5px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🚀 ENTER MATRIX (SKIP LOBBY TIMER)
              </button>
            )}
          </div>
        </div>
      )}

      {/* 1,000 X Locking Section */}
      {address && isRobinhood && (
        <div style={{
          background: '#071524',
          border: '1px solid #112d47',
          borderRadius: 8,
          padding: '12px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#00b8ff', marginBottom: 6 }}>
            🔒 LOCK 1,000 "X" TOKENS FOR 50% MINT DISCOUNT ($0.25 / 25 X)
          </div>
          <p style={{ fontSize: 9, color: '#88a8c2', margin: '0 0 10px 0', lineHeight: 1.4 }}>
            Mint consoles in ETH, X tokens, USDG, USDC, or USDT. Unlocking requires a 24-hour unbonding cooldown.
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {!isDiscountEligible && !isUnbonding && (
              <>
                <input
                  type="number"
                  value={lockInput}
                  onChange={(e) => setLockInput(e.target.value)}
                  style={{
                    background: '#03080e',
                    border: '1px solid #1a4266',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    width: '100px',
                  }}
                />
                <button
                  onClick={handleLock}
                  disabled={loading}
                  style={{
                    background: 'linear-gradient(135deg, #00e5a0, #00b8ff)',
                    color: '#000',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {loading ? 'LOCKING...' : 'LOCK 1,000 X'}
                </button>
              </>
            )}

            {isDiscountEligible && !isUnbonding && (
              <button
                onClick={handleInitiateUnlock}
                disabled={loading}
                style={{
                  background: '#2d1419',
                  color: '#ff8597',
                  border: '1px solid #ff4d6d44',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                INITIATE 24H UNBONDING
              </button>
            )}

            {isUnbonding && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#f59e0b' }}>
                  {canWithdraw
                    ? '✅ Cooldown complete!'
                    : `⏳ Unbonding: ~${remainingHours} hours remaining`}
                </span>
                {canWithdraw && (
                  <button
                    onClick={handleWithdraw}
                    disabled={loading}
                    style={{
                      background: '#00e5a0',
                      color: '#000',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    WITHDRAW X
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 10, fontSize: 10, color: msg.startsWith('❌') ? '#ff6b8b' : '#00e5a0' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
