import { useState, useEffect, useCallback } from 'react';
import { createWalletClient, custom, parseUnits, formatUnits } from 'viem';
import { evmPublicClient } from './evm-client';
import {
  ROBINHOOD_CHAIN,
  ROBINHOOD_CHAIN_ID,
  SUPPORTED_EVM_CHAINS,
  EvmChainConfig,
  USDG_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  X_TOKEN_ADDRESS,
  RANSOME_GAME_ADDRESS,
  RANSOME_VAULT_ADDRESS,
  X_LOCK_VAULT_ADDRESS,
  REQUIRED_X_LOCK,
} from './robinhood-config';
import { ERC20_ABI, XLOCK_VAULT_ABI, RANSOME_GAME_ABI, RANSOME_VAULT_ABI, TEST_X_TOKEN_ABI } from './game-abi';

/** USD value of one ticket, 8 decimals — mirrors RansomeGame.TICKET_PRICE_USD. */
const TICKET_USD_FULL = 50_000_000n;    // $0.50
const TICKET_USD_DISCOUNT = 25_000_000n; // $0.25 with 1,000 tokens locked

/**
 * Tokens owed for ONE ticket at a given USD price, rounded UP.
 * Mirrors RansomeGame.ticketTokens exactly — the contract is the source of truth.
 */
export function tokensPerTicket(price8: bigint, discounted: boolean): bigint {
  if (price8 <= 0n) return 0n;
  const usd = discounted ? TICKET_USD_DISCOUNT : TICKET_USD_FULL;
  return (usd * 10n ** 18n + price8 - 1n) / price8;
}

export function useEvmWallet() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  
  const [ethBalance, setEthBalance] = useState<string>('0');
  const [usdgBalance, setUsdgBalance] = useState<string>('0');
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [usdtBalance, setUsdtBalance] = useState<string>('0');
  const [xBalance, setXBalance] = useState<string>('0');
  const [vaultXBalance, setVaultXBalance] = useState<string>('0');
  const [lockedXAmount, setLockedXAmount] = useState<string>('0');
  // Tokens needed for the discount, read from the vault. USD-denominated on-chain
  // when a price source is wired, so it is a number that moves — never hardcode it.
  const [requiredLock, setRequiredLock] = useState<number>(REQUIRED_X_LOCK);
  const [isDiscountEligible, setIsDiscountEligible] = useState<boolean>(false);
  const [yieldBalance, setYieldBalance] = useState<string>('0');
  // Prize-token USD price (8 dp) read from the game contract. 0 = unset → the
  // token rail refuses to mint rather than charging a wrong amount.
  const [tokenPriceInUsd, setTokenPriceInUsd] = useState<bigint>(0n);
  const [isUnbonding, setIsUnbonding] = useState<boolean>(false);
  const [unlockTimestamp, setUnlockTimestamp] = useState<number>(0);

  // Connect EVM wallet
  const connect = async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      alert('Please install an EVM wallet (MetaMask, Rabby, Coinbase Wallet) to connect.');
      return;
    }
    try {
      setConnecting(true);
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts[0]) {
        setAddress(accounts[0]);
      }
      const currentChain = await (window as any).ethereum.request({ method: 'eth_chainId' });
      const currentChainNum = parseInt(currentChain, 16);
      setChainId(currentChainNum);
    } catch (err: any) {
      console.error('Wallet connection failed:', err);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
  };

  // Switch to any supported EVM chain
  const switchNetwork = async (targetChainId: number = ROBINHOOD_CHAIN_ID) => {
    if (typeof window === 'undefined' || !(window as any).ethereum) return;
    const targetChain = SUPPORTED_EVM_CHAINS[targetChainId];
    if (!targetChain) return;

    try {
      await (window as any).ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
      setChainId(targetChainId);
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await (window as any).ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${targetChainId.toString(16)}`,
                chainName: targetChain.name,
                nativeCurrency: targetChain.nativeCurrency,
                rpcUrls: targetChain.rpcUrls.default.http,
                blockExplorerUrls: [targetChain.blockExplorers.default.url],
              },
            ],
          });
          setChainId(targetChainId);
        } catch (addError) {
          console.error('Failed to add EVM chain:', addError);
        }
      }
    }
  };

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!address || typeof window === 'undefined' || !(window as any).ethereum) return;
    try {
      // 0. ETH Balance
      const rawEth = await (window as any).ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });
      if (rawEth) {
        setEthBalance(formatUnits(BigInt(rawEth), 18));
      }

      // 1. Stablecoins on Robinhood Chain
      if (USDG_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const uBal = await (evmPublicClient as any).readContract({
          address: USDG_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setUsdgBalance(formatUnits(uBal, 6));
      }
      if (USDC_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const cBal = await (evmPublicClient as any).readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setUsdcBalance(formatUnits(cBal, 6));
      }
      if (USDT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const tBal = await (evmPublicClient as any).readContract({
          address: USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setUsdtBalance(formatUnits(tBal, 6));
      }

      // 2. X Token balance
      if (X_TOKEN_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const xBal = await (evmPublicClient as any).readContract({
          address: X_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setXBalance(formatUnits(xBal, 18));
      }

      // 3. Vault X Token balance
      if (RANSOME_VAULT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const vBal = await (evmPublicClient as any).readContract({
          address: RANSOME_VAULT_ADDRESS,
          abi: RANSOME_VAULT_ABI,
          functionName: 'getVaultBalance',
        });
        setVaultXBalance(formatUnits(vBal, 18));
      }

      // 3b. Ticket price in USD (8 dp) — converts $0.50 into a token amount
      if (RANSOME_GAME_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const priceRaw = await (evmPublicClient as any).readContract({
          address: RANSOME_GAME_ADDRESS,
          abi: RANSOME_GAME_ABI,
          functionName: 'tokenPriceInUsd',
        });
        setTokenPriceInUsd(BigInt(priceRaw));
      }

      // 4. Lock status
      if (X_LOCK_VAULT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const eligible = await (evmPublicClient as any).readContract({
          address: X_LOCK_VAULT_ADDRESS,
          abi: XLOCK_VAULT_ABI,
          functionName: 'isDiscountEligible',
          args: [address],
        });
        setIsDiscountEligible(eligible);

        try {
          const req = await (evmPublicClient as any).readContract({
            address: X_LOCK_VAULT_ADDRESS,
            abi: XLOCK_VAULT_ABI,
            functionName: 'lockRequirement',
          });
          setRequiredLock(Number(formatUnits(req, 18)));
        } catch {
          setRequiredLock(REQUIRED_X_LOCK);
        }

        // `lockInfo` returns named fields: amount (retained), deposited (lifetime,
        // drives eligibility), unlockTimestamp, isUnbonding. The 10% fuel slice is
        // already gone from `amount`, so the UI shows the retained principal.
        const lockState = await (evmPublicClient as any).readContract({
          address: X_LOCK_VAULT_ADDRESS,
          abi: XLOCK_VAULT_ABI,
          functionName: 'lockInfo',
          args: [address],
        });
        setLockedXAmount(formatUnits(lockState[0], 18));
        setUnlockTimestamp(Number(lockState[2]));
        setIsUnbonding(lockState[3]);

        try {
          const earned = await (evmPublicClient as any).readContract({
            address: X_LOCK_VAULT_ADDRESS,
            abi: XLOCK_VAULT_ABI,
            functionName: 'earned',
            args: [address],
          });
          setYieldBalance(formatUnits(earned, 18));
        } catch {
          setYieldBalance('0');
        }
      }
    } catch (e) {
      console.warn('Failed to refresh balances:', e);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      refreshBalances();
      const interval = setInterval(refreshBalances, 10000);
      return () => clearInterval(interval);
    }
  }, [address, refreshBalances]);

  // Dev mode: Free faucet (mints 5,000 Test X)
  const claimTestXFaucet = async () => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    const tx = await (walletClient as any).writeContract({
      account: address,
      address: X_TOKEN_ADDRESS,
      abi: TEST_X_TOKEN_ABI,
      functionName: 'faucet',
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
    await refreshBalances();
    return tx;
  };

  // Dev mode: Mint Test X with Test ETH
  const mintTestXWithEth = async (ethAmount: string = '0.005') => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    const tx = await (walletClient as any).writeContract({
      account: address,
      address: X_TOKEN_ADDRESS,
      abi: TEST_X_TOKEN_ABI,
      functionName: 'mintWithTestEth',
      value: parseUnits(ethAmount, 18),
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
    await refreshBalances();
    return tx;
  };

  // Lock 1,000 X
  const lockXTokens = async (amount: number = requiredLock) => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    const parsedAmount = parseUnits(amount.toString(), 18);
    const approveTx = await (walletClient as any).writeContract({
      account: address,
      address: X_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [X_LOCK_VAULT_ADDRESS, parsedAmount],
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: approveTx });

    const lockTx = await (walletClient as any).writeContract({
      account: address,
      address: X_LOCK_VAULT_ADDRESS,
      abi: XLOCK_VAULT_ABI,
      functionName: 'lock',
      args: [parsedAmount],
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: lockTx });
    await refreshBalances();
    return lockTx;
  };

  const initiateUnlockX = async () => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    const tx = await (walletClient as any).writeContract({
      account: address,
      address: X_LOCK_VAULT_ADDRESS,
      abi: XLOCK_VAULT_ABI,
      functionName: 'initiateUnlock',
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
    await refreshBalances();
    return tx;
  };

  const withdrawX = async () => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    const tx = await (walletClient as any).writeContract({
      account: address,
      address: X_LOCK_VAULT_ADDRESS,
      abi: XLOCK_VAULT_ABI,
      functionName: 'withdraw',
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
    await refreshBalances();
    return tx;
  };

  const claimYield = async () => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    const tx = await (walletClient as any).writeContract({
      account: address,
      address: X_LOCK_VAULT_ADDRESS,
      abi: XLOCK_VAULT_ABI,
      functionName: 'claimReward',
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
    await refreshBalances();
    return tx;
  };

  /**
   * Which on-chain device ids did MY mint just produce?
   * Ids are assigned in mint order per session, so I walk back from the newest
   * id and keep the ones this wallet owns. Doing it by ownership (instead of
   * `count - 1`) survives another wallet minting in the same block.
   */
  const resolveMintIds = async (count: number): Promise<{ sessionId: bigint; deviceIds: number[] } | null> => {
    if (!address) return null;
    try {
      const sessionId = BigInt(await (evmPublicClient as any).readContract({
        address: RANSOME_GAME_ADDRESS,
        abi: RANSOME_GAME_ABI,
        functionName: 'currentSessionId',
      }));
      const total = Number(await (evmPublicClient as any).readContract({
        address: RANSOME_GAME_ADDRESS,
        abi: RANSOME_GAME_ABI,
        functionName: 'sessionDeviceCount',
        args: [sessionId],
      }));
      const mine: number[] = [];
      for (let id = total - 1; id >= 0 && mine.length < count; id--) {
        const [owner] = (await (evmPublicClient as any).readContract({
          address: RANSOME_GAME_ADDRESS,
          abi: RANSOME_GAME_ABI,
          functionName: 'devices',
          args: [sessionId, BigInt(id)],
        })) as [string, string, boolean];
        if (String(owner).toLowerCase() === address.toLowerCase()) mine.unshift(id);
      }
      return { sessionId, deviceIds: mine };
    } catch (e) {
      console.warn('Could not resolve on-chain device ids:', e);
      return null;
    }
  };

  // Mint Consoles with a stablecoin or X.
  //
  // There is no ETH rail, by design: the contract has no `mintWithETH` (it
  // reverted on every call), and a USD ticket paid in ETH is the only price in
  // the economy that would have to come from an authority-set FX rate.
  const mintConsoles = async (
    tokenSymbol: 'USDG' | 'USDC' | 'USDT' | 'X',
    count: number,
    grids: number[][][]
  ) => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    
    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });

    // The board goes on-chain IN THE CLEAR, not as a hash. The contract checks
    // it (15 numbers, five per row), refuses a card holding a number that is
    // already on the wall, and refuses a second copy of the same card in the
    // round — which is what stops a revealed ticket from being cloned.
    // 27 cells, row-major, 0 = empty: `uint8[27][]`, one board per ticket.
    const boards = grids.map((grid) => grid.flat());
    if (boards.length !== count) throw new Error('One board is required per ticket');
    for (const board of boards) {
      if (board.length !== 27) throw new Error('A board is 27 cells (3 rows × 9)');
    }

    // 1. Direct X Token Minting (Robinhood Chain)
    if (tokenSymbol === 'X') {
      // USD-denominated ticket: tokens owed = $0.50 (or $0.25) / tokenPriceInUsd.
      const perTicket = tokensPerTicket(tokenPriceInUsd, isDiscountEligible);
      if (perTicket === 0n) {
        throw new Error('Ticket price not set on chain — authority must call setTokenPriceInUsd first');
      }
      const totalX = perTicket * BigInt(count);

      const approveTx = await (walletClient as any).writeContract({
        account: address,
        address: X_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [RANSOME_GAME_ADDRESS, totalX],
        chain: ROBINHOOD_CHAIN,
      });
      await (evmPublicClient as any).waitForTransactionReceipt({ hash: approveTx });

      const mintTx = await (walletClient as any).writeContract({
        account: address,
        address: RANSOME_GAME_ADDRESS,
        abi: RANSOME_GAME_ABI,
        functionName: 'mintWithXToken',
        args: [count, boards],
        chain: ROBINHOOD_CHAIN,
      });
      const receipt = await (evmPublicClient as any).waitForTransactionReceipt({ hash: mintTx });
      const minted = await resolveMintIds(count);
      await refreshBalances();
      return { receipt, mintTx, boards, ...(minted ?? {}) };
    }

    // 2. Stablecoin Minting (USDG, USDC, USDT)
    const tokenMap: Record<string, `0x${string}`> = {
      USDG: USDG_ADDRESS,
      USDC: USDC_ADDRESS,
      USDT: USDT_ADDRESS,
    };
    const tokenAddress = tokenMap[tokenSymbol];
    const priceRaw = isDiscountEligible ? 250_000n : 500_000n;
    const totalPayment = priceRaw * BigInt(count);

    const approveTx = await (walletClient as any).writeContract({
      account: address,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [RANSOME_GAME_ADDRESS, totalPayment],
      chain: ROBINHOOD_CHAIN,
    });
    await (evmPublicClient as any).waitForTransactionReceipt({ hash: approveTx });

    const mintTx = await (walletClient as any).writeContract({
      account: address,
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'mintWithStablecoin',
      args: [tokenAddress, count, boards, 1n],
      chain: ROBINHOOD_CHAIN,
    });
    const receipt = await (evmPublicClient as any).waitForTransactionReceipt({ hash: mintTx });
    const minted = await resolveMintIds(count);
    await refreshBalances();
    return { receipt, mintTx, boards, ...(minted ?? {}) };
  };

  // ─── COLD-BOARD SUPPORT ──────────────────────────────────────────────────
  // The mint refuses a board that holds a number already on the wall, so the
  // cabinet must know the wall BEFORE it prints a card. One extra RPC read per
  // mint batch; without it a late-round mint reverts on the first drawn number
  // it happens to pick.
  const readDrawnNumbers = async (): Promise<{ sessionId: bigint; drawn: number[] }> => {
    if (RANSOME_GAME_ADDRESS === '0x0000000000000000000000000000000000000000') {
      throw new Error('Game contract not configured');
    }
    const sessionId = BigInt(await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'currentSessionId',
    }));
    const s = (await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'getSession',
      args: [sessionId],
    })) as [bigint, number, boolean, bigint, readonly number[]];
    return { sessionId, drawn: Array.from(s[4]).map(Number) };
  };

  // ─── CLAIM: the RANSOM actuator signs this with the PLAYER's wallet ──────
  // `claimWin` is amount-free: the contract reserved the cut at the winning
  // draw, so there is nothing for the client to state and nothing to trust it
  // for. It also never needs the authority key — which is the whole point.
  /**
   * Press RANSOM. The board is revealed in the same call so the contract can
   * recompute the tier itself — `claimWin` pays nothing on the authority's
   * word, and the amount never leaves the chain.
   *
   * `grid` is the ticket's 27 cells, row-major, 0 for an empty cell — exactly
   * the array that was hashed into `gridHash` at mint.
   */
  const claimConsoleWin = async (
    deviceId: number | bigint,
    winType: number,
    grid: number[],
    sessionIdArg?: bigint
  ) => {
    if (grid.length !== 27) throw new Error('A board is 27 cells (3 rows × 9)');
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    if (RANSOME_GAME_ADDRESS === '0x0000000000000000000000000000000000000000') {
      throw new Error('Game contract not configured');
    }

    const sessionId = sessionIdArg ?? BigInt(await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'currentSessionId',
    }));

    const [amount, claimed, expired] = (await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'claimableOf',
      args: [sessionId, BigInt(deviceId), winType],
    })) as [bigint, boolean, boolean];

    if (claimed) throw new Error('This tier is already claimed');
    if (expired || amount === 0n) {
      throw new Error('No ransom reserved for this tier — it went to the treasury at the next draw');
    }

    const walletClient = createWalletClient({
      chain: ROBINHOOD_CHAIN as any,
      transport: custom((window as any).ethereum),
    });
    const tx = await (walletClient as any).writeContract({
      account: address,
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'claimWin',
      args: [sessionId, BigInt(deviceId), winType, grid],
      chain: ROBINHOOD_CHAIN,
    });
    const receipt = await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
    await refreshBalances();
    return { tx, receipt, amount, sessionId, deviceId: BigInt(deviceId), winType };
  };

  return {
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
    requiredLock,
    isDiscountEligible,
    yieldBalance,
    tokenPriceInUsd,
    xTokensPerTicket: tokensPerTicket(tokenPriceInUsd, isDiscountEligible),
    isUnbonding,
    unlockTimestamp,
    claimTestXFaucet,
    mintTestXWithEth,
    lockXTokens,
    initiateUnlockX,
    withdrawX,
    claimYield,
    mintConsoles,
    readDrawnNumbers,
    claimConsoleWin,
    refreshBalances,
  };
}

/**
 * The hook's own return type, so the cabinet can receive the SAME instance the
 * shell already connected. A second `useEvmWallet()` inside a modal would keep
 * its own `address: null` and refuse to mint, which is exactly the kind of
 * subtle disconnect bug that looks like a contract problem.
 */
export type EvmWallet = ReturnType<typeof useEvmWallet>;
