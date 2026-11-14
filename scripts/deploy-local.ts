/**
 * Deploy the whole RANSOME stack to a local JSON-RPC node (chain 31337).
 *
 *   npx hardhat node                       # terminal 1
 *   npx hardhat run scripts/deploy-local.ts --network localhost
 *
 * No key is read, written or printed: Hardhat's own local accounts sign the
 * deploy. The resulting addresses are written to `.tmp-explore/local-deployment.json`
 * and printed as a ready-to-paste environment block for `next dev`.
 */

import { network } from 'hardhat'
import { mkdirSync, writeFileSync } from 'node:fs'
import { deployLocalStack, TOKEN_PRICE_USD_8DP } from './local-stack'

const { viem } = await network.connect()
const stack = await deployLocalStack(viem)

const publicClient = await viem.getPublicClient()
const chainId = await publicClient.getChainId()
const block = await publicClient.getBlock()

const deployment = {
  chainId,
  rpcUrl: 'http://127.0.0.1:8545',
  deployer: stack.deployer.account.address,
  tokenPriceInUsd: TOKEN_PRICE_USD_8DP.toString(),
  blockNumber: block.number.toString(),
  contracts: {
    raffle: stack.raffle.address,
    weth: stack.weth.address,
    usdg: stack.usdg.address,
    usdc: stack.usdc.address,
    usdt: stack.usdt.address,
    vault: stack.vault.address,
    lockVault: stack.lockVault.address,
    game: stack.game.address,
    jackpotRouter: stack.jackpotRouter.address,
    feeCollector: stack.feeCollector.address,
    ponsRouter: stack.ponsRouter.address,
    swapRouter: stack.swapRouter.address,
    launchFactory: stack.launchFactory.address,
    launchGraduator: stack.launchGraduator.address,
    launchRouter: stack.launchRouter.address,
    launchHook: stack.launchHook.address,
    poolManager: stack.poolManager,
  },
}

mkdirSync('.tmp-explore', { recursive: true })
writeFileSync('.tmp-explore/local-deployment.json', `${JSON.stringify(deployment, null, 2)}\n`)

const env = {
  NEXT_PUBLIC_CHAIN_ID: String(chainId),
  NEXT_PUBLIC_ROBINHOOD_RPC_URL: deployment.rpcUrl,
  ROBINHOOD_RPC_URL: deployment.rpcUrl,
  NEXT_PUBLIC_X_TOKEN_ADDRESS: deployment.contracts.raffle,
  NEXT_PUBLIC_RANSOME_VAULT_ADDRESS: deployment.contracts.vault,
  NEXT_PUBLIC_RANSOME_GAME_ADDRESS: deployment.contracts.game,
  NEXT_PUBLIC_X_LOCK_VAULT_ADDRESS: deployment.contracts.lockVault,
  NEXT_PUBLIC_USDG_ADDRESS: deployment.contracts.usdg,
  NEXT_PUBLIC_USDC_ADDRESS: deployment.contracts.usdc,
  NEXT_PUBLIC_USDT_ADDRESS: deployment.contracts.usdt,
  NEXT_PUBLIC_LAUNCH_FACTORY_ADDRESS: deployment.contracts.launchFactory,
  NEXT_PUBLIC_LAUNCH_GRADUATOR_ADDRESS: deployment.contracts.launchGraduator,
  NEXT_PUBLIC_LAUNCH_ROUTER_ADDRESS: deployment.contracts.launchRouter,
  NEXT_PUBLIC_LAUNCH_HOOK_ADDRESS: deployment.contracts.launchHook,
  NEXT_PUBLIC_V4_POOL_MANAGER_ADDRESS: deployment.contracts.poolManager,
}

console.log('\nLocal stack deployed on chain', chainId)
console.log(JSON.stringify(deployment.contracts, null, 2))
console.log('\nAddresses written to .tmp-explore/local-deployment.json')
console.log('\nStart the app against it (same shell, then open /raffle):\n')
console.log(
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
)
console.log('')
