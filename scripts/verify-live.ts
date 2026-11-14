/**
 * Independent, read-only health check of a deployed RANSOME stack.
 *
 *   npx hardhat run scripts/verify-live.ts --network robinhood
 *   npx hardhat run scripts/verify-live.ts --network localhost   # after a dry run
 *
 * Reads `deployments/<chainId>.json` (written by deploy-live.ts) and checks that
 * every contract has code, every cross-contract wire points where the app
 * assumes, and the token is a real ERC20. Sends nothing, needs no key, prints no
 * secrets. Exit code 1 means the deployment is not safe to point the app at.
 *
 * Optional: DEPLOYMENTS_FILE=path/to/file.json to check a specific record.
 */

import { network } from 'hardhat'
import { readFileSync } from 'node:fs'
import { erc20Abi, formatUnits } from 'viem'

type Address = `0x${string}`
type Deployment = {
  chainId: number
  token: Address
  deployer: Address
  treasury: Address
  blockNumber: string
  createdAt: string
  contracts: Record<string, Address>
}

const { viem } = await network.connect()
const publicClient = await viem.getPublicClient()
const chainId = await publicClient.getChainId()

const file = process.env.DEPLOYMENTS_FILE || `deployments/${chainId}.json`
const deployment = JSON.parse(readFileSync(file, 'utf8')) as Deployment

if (deployment.chainId !== chainId) {
  console.error(`✗ ${file} is for chain ${deployment.chainId}, but the node reports ${chainId}`)
  process.exitCode = 1
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const results: Array<{ ok: boolean; label: string; detail: string }> = []
const check = (ok: boolean, label: string, detail: string) => results.push({ ok, label, detail })
const checkAddr = (label: string, actual: string, expected: string) =>
  check(same(actual, expected), label, `${actual}${same(actual, expected) ? '' : ` (expected ${expected})`}`)
const checkEq = (label: string, actual: unknown, expected: unknown) =>
  check(
    String(actual) === String(expected),
    label,
    `${String(actual)}${String(actual) === String(expected) ? '' : ` (expected ${String(expected)})`}`,
  )

const addresses = deployment.contracts
console.log(`\nVerifying ${file} on chain ${chainId}\n`)

// ---------------------------------------------------------------- code ----

for (const [name, address] of Object.entries(addresses)) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue
  const code = await publicClient.getCode({ address })
  check(!!code && code !== '0x', `${name} has code`, address)
}

// ---------------------------------------------------------------- token ----

const [symbol, name, decimals] = await Promise.all([
  publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: 'symbol' }),
  publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: 'name' }),
  publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: 'decimals' }),
])
console.log(`Token: ${name} (${symbol}), ${decimals} decimals, ${deployment.token}\n`)

// ---------------------------------------------------------------- wires ----

const vault = await viem.getContractAt('RansomeVault', addresses.vault)
const lockVault = await viem.getContractAt('XLockVault', addresses.lockVault)
const jackpotRouter = await viem.getContractAt('JackpotRouter', addresses.jackpotRouter)
const game = addresses.game ? await viem.getContractAt('RansomeGame', addresses.game) : undefined

checkAddr('RansomeVault.xToken', await vault.read.xToken(), deployment.token)
checkAddr('RansomeVault.treasuryWallet', await vault.read.treasuryWallet(), deployment.treasury)
checkAddr('RansomeVault.jackpotRouter', await vault.read.jackpotRouter(), addresses.jackpotRouter)
if (addresses.game) {
  checkAddr('RansomeVault.gameContract', await vault.read.gameContract(), addresses.game)
} else {
  checkAddr(
    'RansomeVault.gameContract (no game yet)',
    await vault.read.gameContract(),
    '0x0000000000000000000000000000000000000000',
  )
}
checkAddr('RansomeVault.stakingVault', await vault.read.stakingVault(), addresses.lockVault)

checkAddr('XLockVault.xToken', await lockVault.read.xToken(), deployment.token)
checkAddr('XLockVault.jackpotSink', await lockVault.read.jackpotSink(), addresses.jackpotRouter)
checkAddr('XLockVault.ransomeVault', await lockVault.read.ransomeVault(), addresses.vault)
checkEq('XLockVault.lockFuelBps', await lockVault.read.lockFuelBps(), 1000n)

checkAddr('JackpotRouter.heist', await jackpotRouter.read.heist(), deployment.token)
checkAddr('JackpotRouter.vault', await jackpotRouter.read.vault(), addresses.vault)

const perps = addresses.perpsFeeRouter
  ? await viem.getContractAt('PerpsFeeRouter', addresses.perpsFeeRouter)
  : undefined
if (perps) {
  checkAddr('PerpsFeeRouter.heist', await perps.read.heist(), deployment.token)
  checkAddr('PerpsFeeRouter.jackpotSink', await perps.read.jackpotSink(), addresses.jackpotRouter)
  const perpsWeth = await perps.read.weth()
  check(
    !!perpsWeth && perpsWeth !== '0x0000000000000000000000000000000000000000',
    'PerpsFeeRouter.weth set',
    perpsWeth,
  )
  const perpsOp = await perps.read.operator()
  check(
    !!perpsOp && perpsOp !== '0x0000000000000000000000000000000000000000',
    'PerpsFeeRouter.operator set',
    perpsOp,
  )
  const perpsUsdg = await perps.read.usdg()
  const usdgCode = await publicClient.getCode({ address: perpsUsdg })
  check(!!usdgCode && usdgCode !== '0x', 'PerpsFeeRouter.usdg has code', perpsUsdg)
}

if (game) {
  checkAddr('RansomeGame.xToken', await game.read.xToken(), deployment.token)
  checkAddr('RansomeGame.lockVault', await game.read.lockVault(), addresses.lockVault)
  checkAddr('RansomeGame.gameVault', await game.read.gameVault(), addresses.vault)

  // The stablecoin rail only works through the WETH hub: Pons pairs RAFFLE with
  // WETH alone, so no USDG→RAFFLE pool exists at any fee tier.
  const weth = await game.read.weth()
  const hubSet = !!weth && weth !== '0x0000000000000000000000000000000000000000'
  check(hubSet, 'RansomeGame.weth set (stablecoin two-hop)', weth)
  if (hubSet) {
    checkAddr('XLockVault.priceSource', await lockVault.read.priceSource(), addresses.game)
    const priceNow = await game.read.tokenPriceInUsd()
    check(
      priceNow > 0n,
      'RansomeGame.tokenPriceInUsd set (RAFFLE rail open)',
      priceNow.toString(),
    )
  }
}

// --- the live numbers the app shows (informational, never a failure) ---
const prizeReserve = await vault.read.prizePoolReserve()
const treasuryReserve = await vault.read.treasuryReserve()
const totalStaked = await lockVault.read.totalStaked()
const totalFuel = await lockVault.read.totalFuelInjected()
const tokenPrice = game ? await game.read.tokenPriceInUsd() : 0n
const feeCollector = addresses.feeCollector

console.log('State:')
console.log(`  prize reserve      ${formatUnits(prizeReserve, Number(decimals))} ${symbol}`)
console.log(`  treasury reserve   ${formatUnits(treasuryReserve, Number(decimals))} ${symbol}`)
console.log(`  staked (yield wt.) ${formatUnits(totalStaked, Number(decimals))} ${symbol}`)
console.log(`  fuel injected      ${formatUnits(totalFuel, Number(decimals))} ${symbol}`)
console.log(
  `  ticket price ref   ${game ? `$${(Number(tokenPrice) / 1e8).toFixed(4)} / token` : 'game not deployed'}`,
)
console.log(`  fee collector      ${feeCollector ?? 'not deployed (jackpot runs on lock fuel only)'}`)
console.log('')

// --------------------------------------------------------------- report ----

let failures = 0
for (const result of results) {
  if (!result.ok) failures += 1
  console.log(`  ${result.ok ? '✓' : '✗'} ${result.label.padEnd(34)} ${result.detail}`)
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} of ${results.length} checks failed — do not point the app at this deployment.`)
  process.exitCode = 1
} else {
  console.log(`✓ all ${results.length} checks passed — ${file} is wired correctly.`)
}
