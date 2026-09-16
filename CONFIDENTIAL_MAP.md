# CONFIDENTIAL_MAP — RANSOME DAPP
Last mapped: 2026-09-11 (graph metadata only; no source snippets read)
Project: C:\Users\admin\Desktop\markdowns\solana-dapp
Index: C-Users-admin-Desktop-markdowns-solana-dapp (6982 nodes)

Protocol: confidential-routing. Hermes must not read RED files. Delegate RED work to local Ollama. Ollama status at map time: DOWN.

## CRITICAL / RED
Do not read, paste, or send to cloud LLMs. User-run only for deploy/sign/env.

### Secrets / env / keys
- `.env`, `.env.local`, any keystore / wallet / authority key files
- Env vars: `SUI_PRIVATE_KEY`, `AUTHORITY_PRIVATE_KEY`, `CRON_SECRET`, `ADMIN_SECRET`, `SUI_RPC_TOKEN`
- Scripts that prompt for or consume keys: `phase1_rotate_secrets.py`, `init_session_sdk.mjs`, `set-usdt-price.mjs`, `publish-heist*.mjs`, `setup-heist.mjs`, `scripts/deploy-robinhood.mjs`

### Smart contracts (settlement / mint / swap / lock)
- `contracts/RansomeGame.sol` — mintWithStablecoin, mintWithETH, _swapToXToken, _swapEthToXToken, drawNumber, claimWin
- `contracts/RansomeVault.sol` — depositPrize, distributePrize, claimTreasuryReserve
- `contracts/XLockVault.sol` — lock / unbond / withdraw / isDiscountEligible
- `contracts/TestXToken.sol` — faucet / mintWithTestEth (testnet token mint authority)
- `contracts/MockPonsRouter.sol` — mock swap path (still settlement-adjacent)
- `heist-contract/sources/heist.move` — SUI production settlement (legacy live until EVM cutover)

### Wallet / signing / claim settlement
- `lib/use-evm-wallet.ts`
- `lib/claim-settle.ts`
- `lib/evm-client.ts` (RPC wiring; may carry private RPC)
- `app/api/draw/route.ts` — authority draw engine
- `app/api/claim-win/route.ts` — win verification + swap trigger
- `app/api/claim-sui/route.ts` — SUI claim (legacy)
- `app/api/admin/route.ts` — ADMIN_SECRET gated

## SENSITIVE / YELLOW
Structure OK; do not dump env values or RPC tokens.

- `lib/robinhood-config.ts` — chain ID, public token addresses, RPC URL names
- `lib/game-abi.ts`
- `lib/sui-client.ts` — `SUI_RPC_TOKEN` plumbing
- `lib/heist-prices.ts`
- `lib/claim-ledger.ts`
- `app/api/session-state/route.ts`
- `app/api/mint-nft/route.ts`
- `app/api/settle-claims/route.ts`
- `app/api/governance/route.ts`
- `app/turbolucent/` (admin UI; no secrets in source expected)
- Deployment: Vercel env, cron-job.org header, GitHub Actions secrets
- `DEVMODE_GUIDE.md`, `DEVMODE_REMOVAL.md`

## PUBLIC / GREEN
Safe for cloud analysis.

- `freebuff.md`, `solanamark.md` (redacted resume docs)
- `app/page.tsx` UI (avoid copying env literals if present)
- `app/components/RobinhoodLockPanel.tsx`
- `app/governance/page.tsx`
- `contracts/interfaces/IERC20.sol`, `contracts/interfaces/ISwapRouter.sol`
- Docs, CSS, public package IDs / session object IDs

## Env classification
RED: SUI_PRIVATE_KEY, AUTHORITY_PRIVATE_KEY, CRON_SECRET, ADMIN_SECRET, SUI_RPC_TOKEN
YELLOW: ROBINHOOD_RPC_URL, SUI_RPC_URL, SUI_RPC_TOKEN_HEADER, SOLANA_RPC_URL
GREEN / public IDs: NEXT_PUBLIC_* contract addresses, SUI_PROGRAM_ID, SESSION_OBJECT_ID, SESSION_REGISTRY_ID, coin types, price envs

## Current phase (from freebuff.md, not solanamark.md)
solanamark.md is STALE (2026-07-26 SUI/Solana audit). Live source of truth is freebuff.md.
Robinhood Chain (Arbitrum Orbit L2, chain 4663) architecture + TestXToken / MockPonsRouter / Dev tools are uncommitted local work, waiting on user test feedback.

## EXPOSURE LOG
- 2026-07-26: CRON_SECRET + testnet recovery phrase (solanamark.md). Phrase redacted. CRON_SECRET later rotated 2026-09-03.
- 2026-09-02: `.env` files exposed to an LLM. Rotation table in freebuff.md. Remaining: `SUI_PRIVATE_KEY` pending republish.
- 2026-09-11: This session did not read RED source or env files. Graph metadata only.
- 2026-09-14: No RED files read. `hardhat.config.ts` + `test/README.md` written (GREEN build scaffolding, no secrets).

## Ollama
localhost:11434 reachable (qwen2.5-coder:7b, MiniCPM5). RED-zone delegation AVAILABLE as of this session.
