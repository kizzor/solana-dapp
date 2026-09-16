import { useState, useEffect, useCallback } from 'react';
import { createWalletClient, custom, parseUnits, formatUnits, keccak256, encodePacked } from 'viem';
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
  STANDARD_MINT_PRICE_X,
  DISCOUNTED_MINT_PRICE_X,
} from './robinhood-config';
import { ERC20_ABI, XLOCK_VAULT_ABI, RANSOME_GAME_ABI, RANSOME_VAULT_ABI, TEST_X_TOKEN_ABI } from './game-abi';

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
  const [isDiscountEligible, setIsDiscountEligible] = useState<boolean>(false);
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

      // 4. Lock status
      if (X_LOCK_VAULT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const eligible = await (evmPublicClient as any).readContract({
          address: X_LOCK_VAULT_ADDRESS,
          abi: XLOCK_VAULT_ABI,
          functionName: 'isDiscountEligible',
          args: [address],
        });
        setIsDiscountEligible(eligible);

        const lockState = await (evmPublicClient as any).readContract({
          address: X_LOCK_VAULT_ADDRESS,
          abi: XLOCK_VAULT_ABI,
          functionName: 'locks',
          args: [address],
        });
        setLockedXAmount(formatUnits(lockState[0], 18));
        setUnlockTimestamp(Number(lockState[1]));
        setIsUnbonding(lockState[2]);
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
  const lockXTokens = async (amount: number = REQUIRED_X_LOCK) => {
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

  // Mint Consoles with any supported token (USDG, USDC, USDT, ETH, X)
  const mintConsoles = async (
    tokenSymbol: 'USDG' | 'USDC' | 'USDT' | 'ETH' | 'X',
    count: number,
    grids: number[][][]
  ) => {
    if (!address || typeof window === 'undefined') throw new Error('Wallet not connected');
    
    const targetChain = chainId ? SUPPORTED_EVM_CHAINS[chainId] || ROBINHOOD_CHAIN : ROBINHOOD_CHAIN;
    const walletClient = createWalletClient({
      chain: targetChain as any,
      transport: custom((window as any).ethereum),
    });

    const gridHashes = grids.map((grid) => {
      const flattened = grid.flat();
      return keccak256(encodePacked(['uint8[]'], [flattened]));
    });

    // 1. Direct X Token Minting (Robinhood Chain)
    if (tokenSymbol === 'X') {
      const pricePerUnit = isDiscountEligible ? DISCOUNTED_MINT_PRICE_X : STANDARD_MINT_PRICE_X;
      const totalX = parseUnits((pricePerUnit * count).toString(), 18);

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
        args: [count, gridHashes],
        chain: ROBINHOOD_CHAIN,
      });
      const receipt = await (evmPublicClient as any).waitForTransactionReceipt({ hash: mintTx });
      await refreshBalances();
      return { receipt, mintTx, gridHashes };
    }

    // 2. Native ETH Minting (Supports All Major Chains)
    if (tokenSymbol === 'ETH') {
      const usdPrice = isDiscountEligible ? 0.25 : 0.50;
      const totalUsd = usdPrice * count;
      const estEth = (totalUsd / 2500) * 1.05;
      const ethWei = parseUnits(estEth.toFixed(6), 18);

      // On Robinhood Chain, call contract mintWithETH
      if (chainId === ROBINHOOD_CHAIN_ID && RANSOME_GAME_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        const tx = await (walletClient as any).writeContract({
          account: address,
          address: RANSOME_GAME_ADDRESS,
          abi: RANSOME_GAME_ABI,
          functionName: 'mintWithETH',
          args: [count, gridHashes, 1n],
          value: ethWei,
          chain: ROBINHOOD_CHAIN,
        });
        const receipt = await (evmPublicClient as any).waitForTransactionReceipt({ hash: tx });
        await refreshBalances();
        return { receipt, tx, gridHashes };
      } else {
        // Multi-chain ETH payment fallback
        const targetVault = RANSOME_VAULT_ADDRESS !== '0x0000000000000000000000000000000000000000' 
          ? RANSOME_VAULT_ADDRESS 
          : address;
        
        const tx = await (walletClient as any).sendTransaction({
          account: address,
          to: targetVault,
          value: ethWei,
          chain: targetChain,
        });
        await refreshBalances();
        return { tx, gridHashes };
      }
    } 
    
    // 3. Stablecoin Minting (USDG, USDC, USDT)
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
      args: [tokenAddress, count, gridHashes, 1n],
      chain: ROBINHOOD_CHAIN,
    });
    const receipt = await (evmPublicClient as any).waitForTransactionReceipt({ hash: mintTx });
    await refreshBalances();
    return { receipt, mintTx, gridHashes };
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
    isDiscountEligible,
    isUnbonding,
    unlockTimestamp,
    claimTestXFaucet,
    mintTestXWithEth,
    lockXTokens,
    initiateUnlockX,
    withdrawX,
    mintConsoles,
    refreshBalances,
  };
}
