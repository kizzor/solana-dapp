import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";

// Live signing key. Read from the operator's own shell at config load time and
// handed to Hardhat in memory only — no script ever prints it, and this file
// must never contain a literal key. Unset on machines that only run tests.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

export default defineConfig({
  plugins: [hardhatViem, hardhatNodeTestRunner],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    // `npx hardhat node` serves this chain; the app's local mode targets 31337.
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
    },
    // Robinhood Chain (Arbitrum Orbit L2). Chain id 4663.
    robinhood: {
      type: "http",
      // `rpc.robinhood.com` does not resolve; this is the public endpoint.
      url: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      ...(deployerKey ? { accounts: [deployerKey] } : {}),
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
});
