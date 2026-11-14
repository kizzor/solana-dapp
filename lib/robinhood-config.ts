/**
 * Multi-Chain EVM & Robinhood Chain Configuration
 */

export interface EvmChainConfig {
  id: number;
  name: string;
  shortName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    default: { http: readonly string[] };
    public: { http: readonly string[] };
  };
  blockExplorers: {
    default: { name: string; url: string };
  };
  isTestnet?: boolean;
}

// The app's default chain. Point it at 31337 to run against the local harness
// (`npx hardhat node` + scripts/deploy-local.ts) without touching the real config.
export const ROBINHOOD_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 4663);

export const SUPPORTED_EVM_CHAINS: Record<number, EvmChainConfig> = {
  31337: {
    id: 31337,
    name: 'Hardhat Local',
    shortName: 'Local',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'http://127.0.0.1:8545'] },
      public: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'http://127.0.0.1:8545'] },
    },
    blockExplorers: {
      default: { name: 'Local node', url: 'http://127.0.0.1:8545' },
    },
    isTestnet: true,
  },
  4663: {
    id: 4663,
    name: 'Robinhood Chain',
    shortName: 'Robinhood',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    // `rpc.robinhood.com` / `explorer.robinhood.com` do not resolve (checked
    // 2026-11-13: TLS connect fails). These are the endpoints pons publishes for
    // the same chain, and both answer eth_chainId 0x1237.
    rpcUrls: {
      default: {
        http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'],
      },
      public: {
        http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'],
      },
    },
    blockExplorers: {
      default: { name: 'Robinhood Chain explorer', url: 'https://robinhoodchain.blockscout.com' },
    },
  },
  1: {
    id: 1,
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://cloudflare-eth.com', 'https://eth.llamarpc.com'] },
      public: { http: ['https://cloudflare-eth.com', 'https://eth.llamarpc.com'] },
    },
    blockExplorers: {
      default: { name: 'Etherscan', url: 'https://etherscan.io' },
    },
  },
  42161: {
    id: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'] },
      public: { http: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'] },
    },
    blockExplorers: {
      default: { name: 'Arbiscan', url: 'https://arbiscan.io' },
    },
  },
  8453: {
    id: 8453,
    name: 'Base',
    shortName: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://mainnet.base.org', 'https://base.llamarpc.com'] },
      public: { http: ['https://mainnet.base.org', 'https://base.llamarpc.com'] },
    },
    blockExplorers: {
      default: { name: 'BaseScan', url: 'https://basescan.org' },
    },
  },
  10: {
    id: 10,
    name: 'Optimism (OP Mainnet)',
    shortName: 'Optimism',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com'] },
      public: { http: ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com'] },
    },
    blockExplorers: {
      default: { name: 'OP Etherscan', url: 'https://optimistic.etherscan.io' },
    },
  },
  137: {
    id: 137,
    name: 'Polygon Mainnet',
    shortName: 'Polygon',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://polygon-rpc.com', 'https://polygon.llamarpc.com'] },
      public: { http: ['https://polygon-rpc.com', 'https://polygon.llamarpc.com'] },
    },
    blockExplorers: {
      default: { name: 'PolygonScan', url: 'https://polygonscan.com' },
    },
  },
  56: {
    id: 56,
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://bsc-dataseed.binance.org', 'https://binance.llamarpc.com'] },
      public: { http: ['https://bsc-dataseed.binance.org', 'https://binance.llamarpc.com'] },
    },
    blockExplorers: {
      default: { name: 'BscScan', url: 'https://bscscan.com' },
    },
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia Testnet',
    shortName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://rpc.sepolia.org', 'https://sepolia.gateway.tenderly.co'] },
      public: { http: ['https://rpc.sepolia.org', 'https://sepolia.gateway.tenderly.co'] },
    },
    blockExplorers: {
      default: { name: 'Sepolia Etherscan', url: 'https://sepolia.etherscan.io' },
    },
    isTestnet: true,
  },
  421614: {
    id: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] },
      public: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] },
    },
    blockExplorers: {
      default: { name: 'Arbiscan Sepolia', url: 'https://sepolia.arbiscan.io' },
    },
    isTestnet: true,
  },
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    shortName: 'Base Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://sepolia.base.org'] },
      public: { http: ['https://sepolia.base.org'] },
    },
    blockExplorers: {
      default: { name: 'BaseScan Sepolia', url: 'https://sepolia.basescan.org' },
    },
    isTestnet: true,
  },
};

export const ROBINHOOD_CHAIN =
  SUPPORTED_EVM_CHAINS[ROBINHOOD_CHAIN_ID] ?? SUPPORTED_EVM_CHAINS[4663];

// Token Addresses (on Robinhood Chain)
//
// Canonical Global Dollar (6 dp). Read back on-chain 2026-11-13: symbol "USDG",
// decimals 6, 170 bytes of code — and published both by Paxos (USDG on main
// networks) and by docs.robinhood.com/chain/contracts. WETH is the only quote
// asset Pons launches against, which is why a stablecoin swap needs a WETH hop.
export const ROBINHOOD_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
export const ROBINHOOD_WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as const;

export const USDG_ADDRESS = (process.env.NEXT_PUBLIC_USDG_ADDRESS ||
  (ROBINHOOD_CHAIN_ID === 4663 ? ROBINHOOD_USDG : '0x0000000000000000000000000000000000000000')) as `0x${string}`;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const USDT_ADDRESS = (process.env.NEXT_PUBLIC_USDT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const X_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_X_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;

// Deployed Contracts
export const RANSOME_GAME_ADDRESS = (process.env.NEXT_PUBLIC_RANSOME_GAME_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const RANSOME_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_RANSOME_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const X_LOCK_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_X_LOCK_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;

// P1 launchpad. Zero address = the board falls back to the local dataset.
export const LAUNCH_FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_LAUNCH_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
// R2: a graduated coin trades in a Uniswap v4 pool. The graduator holds the
// pool key + locked liquidity; the router is the only swap entry point the app uses.
export const LAUNCH_GRADUATOR_ADDRESS = (process.env.NEXT_PUBLIC_LAUNCH_GRADUATOR_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const LAUNCH_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_LAUNCH_ROUTER_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const LAUNCH_HOOK_ADDRESS = (process.env.NEXT_PUBLIC_LAUNCH_HOOK_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const V4_POOL_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_V4_POOL_MANAGER_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;

// Pricing Constants
export const STANDARD_MINT_PRICE_USD = 0.50;
export const DISCOUNTED_MINT_PRICE_USD = 0.25;
export const STANDARD_MINT_PRICE_USDG = 0.50;
export const DISCOUNTED_MINT_PRICE_USDG = 0.25;
// Token-rail ticket prices are USD-denominated and live ON-CHAIN:
// RansomeGame.TICKET_PRICE_USD ($0.50) / TICKET_DISCOUNT_USD ($0.25), converted
// with RansomeGame.tokenPriceInUsd. Do NOT reintroduce a fixed token count —
// on a freshly launched coin it made tickets free and could not be corrected.
// Fallback only. The live number is XLockVault.lockRequirement(), which is
// USD-denominated when a price source is wired, so it moves with the token price.
export const REQUIRED_X_LOCK = 1000;
export const MAX_DRAWS = 59;
