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

export const ROBINHOOD_CHAIN_ID = 4663;

export const SUPPORTED_EVM_CHAINS: Record<number, EvmChainConfig> = {
  4663: {
    id: 4663,
    name: 'Robinhood Chain',
    shortName: 'Robinhood',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.robinhood.com'] },
      public: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.robinhood.com'] },
    },
    blockExplorers: {
      default: { name: 'Robinhood Explorer', url: 'https://explorer.robinhood.com' },
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

export const ROBINHOOD_CHAIN = SUPPORTED_EVM_CHAINS[ROBINHOOD_CHAIN_ID];

// Token Addresses (on Robinhood Chain)
export const USDG_ADDRESS = (process.env.NEXT_PUBLIC_USDG_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const USDT_ADDRESS = (process.env.NEXT_PUBLIC_USDT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const X_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_X_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;

// Deployed Contracts
export const RANSOME_GAME_ADDRESS = (process.env.NEXT_PUBLIC_RANSOME_GAME_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const RANSOME_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_RANSOME_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const X_LOCK_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_X_LOCK_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;

// Pricing Constants
export const STANDARD_MINT_PRICE_USD = 0.50;
export const DISCOUNTED_MINT_PRICE_USD = 0.25;
export const STANDARD_MINT_PRICE_USDG = 0.50;
export const DISCOUNTED_MINT_PRICE_USDG = 0.25;
export const STANDARD_MINT_PRICE_X = 50; // 50 X tokens
export const DISCOUNTED_MINT_PRICE_X = 25; // 25 X tokens
export const REQUIRED_X_LOCK = 1000;
export const MAX_DRAWS = 59;
