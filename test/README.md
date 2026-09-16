# test/ — Solidity contract test harness (Robinhood Chain migration)

## Setup (blocker: ESM)

Hardhat 3 **requires** ESM. Before running `npx hardhat compile` or any test:

```bash
# 1) Flip the project to ESM (affects Next.js, but v14 supports it)
npm pkg set type="module"

# 2) Update tsconfig if needed (Next.js 14 with ESM — usually just "module": "ESNext")
# Add or verify in tsconfig.json:
#   "module": "ESNext"  (or "nodenext")
#   "moduleResolution": "bundler" or "nodenext"

# 3) Compile contracts
npx hardhat compile
```

This should be safe since:
- All scripts are already `.mjs` (ESM-native)
- No raw `require()` calls in the TypeScript source
- Next.js 14 fully supports `"type": "module"`

## What the test harness proves

The goal is to run local Hardhat tests that verify the Robinhood EVM
migration contracts compile, deploy, and pass basic state checks:

1. **RansomeGame.sol** — deploys, connects to vault, initializes 59-draw session
2. **RansomeVault.sol** — accepts deposits, splits 99%/1% prize/treasury
3. **XLockVault.sol** — 1000-X lock, 24h unbonding cooldown enforced
4. **TestXToken.sol** — faucet works, 5000 free X minted to test wallets
5. **MockPonsRouter.sol** — fake swap path returns expected values

## Secrets (DO NOT COMMIT)

`.env.local` for local test:
```
ROBINHOOD_RPC_URL=<testnet RPC>
DEPLOYER_PRIVATE_KEY=<testnet deployer, not prod>
```

Hardhat config uses `configVariable()` — reads from env at runtime, never stored in code.

## Confidential protocol

- Contracts under `./contracts` are RED zone — never read by Hermes
- Test files are written by Ollama (local LLM) or written from public interfaces only
- `hardhat compile` / `npx hardhat test` are build commands (RED source read by Hardhat, not Hermes)
