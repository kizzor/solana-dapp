/**
 * The only deploy script that touches a live chain.
 *
 *   X_TOKEN_ADDRESS=0x… USDG_ADDRESS=0x… DEPLOYER_PRIVATE_KEY=0x… \
 *     npx hardhat run scripts/deploy-live.ts --network robinhood
 *
 * It deploys the core money path, wires every `set*` in the order the contracts
 * require, reads every wire back, and only then writes `deployments/<chainId>.json`
 * and prints the `NEXT_PUBLIC_*` block the app needs.
 *
 * Key handling: the signing key comes from the operator's own shell through
 * hardhat.config.ts. This script never opens a file for it, never prints it, and
 * never writes it anywhere. Run it yourself; do not paste the key into chat.
 *
 * Idempotent: re-running with the same X_TOKEN_ADDRESS reuses every deployed
 * address from `deployments/<chainId>.json` (when code still exists there) and
 * skips wiring that is already correct, so an interrupted run can be resumed.
 * A different token means a different vault set — pass FORCE=1 to start over.
 */

import { network } from 'hardhat'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { concatHex, encodeDeployData, keccak256, parseEther, toHex } from 'viem'

type Address = `0x${string}`

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function addressEnv(name: string, opts: { required?: boolean; fallback?: string } = {}): Address {
  const raw = process.env[name]?.trim()
  if (!raw) {
    if (opts.fallback) {
      console.log(`  · ${name} not set → using ${opts.fallback}`)
      return opts.fallback as Address
    }
    throw new Error(`Missing required env var ${name}. See the header of this script.`)
  }
  if (!ADDRESS_RE.test(raw)) throw new Error(`${name} is not a 0x-prefixed 20-byte address`)
  return raw as Address
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const { viem } = await network.connect()
const publicClient = await viem.getPublicClient()
const wallets = await viem.getWalletClients()
if (wallets.length === 0) {
  throw new Error(
    'No signing account on this network. Export DEPLOYER_PRIVATE_KEY in your own shell first ' +
      '(the config reads it at load time; nothing here prints it).',
  )
}
const admin = wallets[0].account.address

const chainId = await publicClient.getChainId()
const explorer = chainId === 4663 ? 'https://robinhoodchain.blockscout.com' : ''

// ---------------------------------------------------------------- inputs ----

console.log(`\nRANSOME live deploy · chain ${chainId} · admin ${admin}\n`)

// Verified on Robinhood Chain 4663 (docs.ponsfamily.com + bytecode checks,
// 2026-11-13): Pons launches tokens straight into a Uniswap V3 WETH pool at fee
// 10000, and its router is SwapRouter02. These are the defaults so the fee line
// comes up wired; override any of them with env vars.
const PONS =
  chainId === 4663
    ? {
        weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
        swapRouter: '0xCaf681a66D020601342297493863E78C959E5cb2',
        factory: '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB',
        // Canonical Global Dollar, 6 dp. Published by Paxos and by
        // docs.robinhood.com/chain/contracts, then read back on-chain here
        // (symbol "USDG", decimals 6, 170 bytes of code).
        usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      }
    : undefined

const ZERO = '0x0000000000000000000000000000000000000000' as const
const token = addressEnv('X_TOKEN_ADDRESS', { required: true })
const treasury = addressEnv('TREASURY_ADDRESS', { fallback: admin })

// The game needs one stablecoin rail. USDG is the chain's canonical stable and
// defaults to the published 4663 address; USDT and USDC are OPTIONAL rails that
// start at address(0) and can be attached later with setStablecoins() — they no
// longer have to exist before the deploy can happen. Without USDG the game is
// skipped and everything else still ships.
const usdg = process.env.USDG_ADDRESS?.trim()
  ? addressEnv('USDG_ADDRESS')
  : (PONS?.usdg as Address | undefined)
const usdt = process.env.USDT_ADDRESS?.trim() ? addressEnv('USDT_ADDRESS') : undefined
const usdc = process.env.USDC_ADDRESS?.trim() ? addressEnv('USDC_ADDRESS') : undefined
const deployGame = !!usdg

const weth = process.env.WETH_ADDRESS?.trim() || PONS?.weth
const swapRouter = process.env.SWAP_ROUTER_ADDRESS?.trim() || PONS?.swapRouter
const deployFeeLine = !!weth && !!swapRouter
const deployPerps = !!usdg && !!weth && !!swapRouter

const perpsBuilderBps = Number(process.env.PERPS_BUILDER_BPS ?? '5')
const perpsBridgeBps = Number(process.env.PERPS_BRIDGE_BPS ?? '25')
const perpsMaxEpochNotional = process.env.PERPS_MAX_EPOCH_NOTIONAL
  ? BigInt(process.env.PERPS_MAX_EPOCH_NOTIONAL)
  : 1000000000000n // $1M notional per epoch (6 dp)
const perpsOperator = process.env.PERPS_OPERATOR?.trim() || ''

const requiredLock = parseEther(process.env.REQUIRED_LOCK ?? '1000')

// No default price on purpose. A guessed price is worse than none: $0.50 would
// make one ticket cost one RAFFLE on a coin worth a fraction of a cent. Unset
// leaves the token rail closed until `npm run live:price` sets it from the pool.
const tokenPriceInUsd = process.env.TOKEN_PRICE_USD_8DP
  ? BigInt(process.env.TOKEN_PRICE_USD_8DP)
  : undefined

// USD value a lock must be worth for the discount (8 dp). Only applied when a
// price exists, because the requirement is derived from that price on-chain.
const lockUsd8dp = tokenPriceInUsd ? BigInt(process.env.LOCK_USD_8DP ?? '2500000000') : undefined

const poolFee = Number(process.env.POOL_FEE ?? '10000')
const stableHopFee = Number(process.env.STABLE_HOP_FEE ?? '100')
const flushThreshold = parseEther(process.env.FLUSH_THRESHOLD_ETH ?? '0.01')

const deployLaunchpad = process.env.DEPLOY_LAUNCHPAD === '1'
const poolManagerEnv = process.env.V4_POOL_MANAGER_ADDRESS?.trim() || ''

// --------------------------------------------------------- resume support ---

const deploymentsDir = 'deployments'
const deploymentPath = `${deploymentsDir}/${chainId}.json`

type Deployment = {
  chainId: number
  token: Address
  deployer: Address
  treasury: Address
  createdAt: string
  blockNumber: string
  config: Record<string, string | number>
  meta: Record<string, string>
  contracts: Record<string, Address>
}

let previous: Deployment | undefined
if (existsSync(deploymentPath)) {
  previous = JSON.parse(readFileSync(deploymentPath, 'utf8')) as Deployment
  if (process.env.FORCE === '1') {
    // Also the escape hatch when the CONTRACTS changed (new setters, new getters):
    // resuming would otherwise reuse bytecode that predates them.
    console.log(`  ! FORCE=1 — ignoring ${deploymentPath}; deploying a fresh set`)
    previous = undefined
  } else if (!same(previous.token, token)) {
    throw new Error(
      `${deploymentPath} belongs to token ${previous.token}, but X_TOKEN_ADDRESS=${token}.\n` +
        'The vaults are bound to one token at construction. Re-run with FORCE=1 to deploy a new set.',
    )
  } else {
    console.log(`  ↺ resuming from ${deploymentPath}`)
  }
}

const contracts: Record<string, Address> = { ...(previous?.contracts ?? {}) }
const meta: Record<string, string> = { ...(previous?.meta ?? {}) }

async function hasCode(address: string): Promise<boolean> {
  const code = await publicClient.getCode({ address: address as Address })
  return !!code && code !== '0x'
}

async function deploy(key: string, contractName: string, args: unknown[]): Promise<Address> {
  const recorded = contracts[key]
  if (recorded && (await hasCode(recorded))) {
    console.log(`  ↺ ${contractName.padEnd(15)} ${recorded}`)
    return recorded
  }
  if (recorded) console.log(`  ! ${key} recorded at ${recorded} but no code there — redeploying`)
  const contract = await viem.deployContract(contractName, args as never)
  contracts[key] = contract.address
  console.log(`  + ${contractName.padEnd(15)} ${contract.address}`)
  return contract.address
}

async function send(label: string, hash: `0x${string}`) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  console.log(`    ✓ ${label}`)
}

/** Write a setter only when the on-chain value differs. The read-back table below proves it. */
async function wire(
  label: string,
  current: unknown,
  expected: string | number | bigint,
  write: () => Promise<`0x${string}`>,
) {
  const actual = String(current)
  const wanted = String(expected)
  const ok = wanted.startsWith('0x') ? same(actual, wanted) : actual === wanted
  if (ok) {
    console.log(`    = ${label} already set`)
    return
  }
  await send(label, await write())
}

// ------------------------------------------------------------- core stack ---

console.log('\n[1/4] core contracts')

const vaultAddress = await deploy('vault', 'RansomeVault', [token, treasury])
const lockVaultAddress = await deploy('lockVault', 'XLockVault', [token, requiredLock])
const jackpotRouterAddress = await deploy('jackpotRouter', 'JackpotRouter', [token, vaultAddress])
const gameAddress = deployGame
  ? await deploy('game', 'RansomeGame', [
      token,
      usdg as Address,
      (usdt ?? ZERO) as Address,
      (usdc ?? ZERO) as Address,
      lockVaultAddress,
      vaultAddress,
      (swapRouter as Address | undefined) ?? ZERO,
      admin,
    ])
  : undefined

const vault = await viem.getContractAt('RansomeVault', vaultAddress)
const lockVault = await viem.getContractAt('XLockVault', lockVaultAddress)
const jackpotRouter = await viem.getContractAt('JackpotRouter', jackpotRouterAddress)
const game = gameAddress ? await viem.getContractAt('RansomeGame', gameAddress) : undefined

if (!deployGame) {
  console.log('  ! USDG_ADDRESS unset — RansomeGame skipped. Vault, lock and jackpot still deploy;')
  console.log('    re-run with USDG_ADDRESS set to add the game and wire it (no redeploy of the rest).')
}

console.log('\n[2/4] wiring the money path')

await wire('RansomeVault.jackpotRouter', await vault.read.jackpotRouter(), jackpotRouterAddress, () =>
  vault.write.setJackpotRouter([jackpotRouterAddress]),
)
if (gameAddress) {
  await wire('RansomeVault.gameContract', await vault.read.gameContract(), gameAddress, () =>
    vault.write.setGameContract([gameAddress]),
  )
}
await wire('RansomeVault.stakingVault', await vault.read.stakingVault(), lockVaultAddress, () =>
  vault.write.setStakingVault([lockVaultAddress]),
)
await wire('XLockVault.jackpotSink', await lockVault.read.jackpotSink(), jackpotRouterAddress, () =>
  lockVault.write.setJackpotSink([jackpotRouterAddress]),
)
await wire('XLockVault.ransomeVault', await lockVault.read.ransomeVault(), vaultAddress, () =>
  lockVault.write.setRansomeVault([vaultAddress]),
)
await wire('XLockVault.lockFuelBps', await lockVault.read.lockFuelBps(), 1000n, () =>
  lockVault.write.setLockFuelBps([1000n]),
)
await wire(
  'XLockVault.requiredLockAmount',
  await lockVault.read.requiredLockAmount(),
  requiredLock,
  () => lockVault.write.setRequiredLockAmount([requiredLock]),
)
if (game) {
  if (tokenPriceInUsd !== undefined) {
    await wire('RansomeGame.tokenPriceInUsd', await game.read.tokenPriceInUsd(), tokenPriceInUsd, () =>
      game.write.setTokenPriceInUsd([tokenPriceInUsd]),
    )
  }
  if (swapRouter) {
    await wire('RansomeGame.swapRouter', await game.read.swapRouter(), swapRouter, () =>
      game.write.setSwapRouter([swapRouter as Address]),
    )
    await wire('RansomeGame.dexPoolFee', await game.read.dexPoolFee(), poolFee, () =>
      game.write.setDexPoolFee([poolFee]),
    )
  }
  // The stable → WETH → RAFFLE route. Without `weth` the game can only swap a
  // token that already has its own RAFFLE pool; with it, USDG/USDC/USDT work.
  if (weth) {
    await wire('RansomeGame.weth', await game.read.weth(), weth, () =>
      game.write.setWeth([weth as Address]),
    )
    await wire('RansomeGame.stableHopFee', await game.read.stableHopFee(), stableHopFee, () =>
      game.write.setStableHopFee([stableHopFee]),
    )
  }
  // Let the lock price itself against the game's live token price.
  if (gameAddress) {
    await wire('XLockVault.priceSource', await lockVault.read.priceSource(), gameAddress, () =>
      lockVault.write.setPriceSource([gameAddress]),
    )
  }
  if (lockUsd8dp !== undefined) {
    await wire('XLockVault.requiredLockUsd8dp', await lockVault.read.requiredLockUsd8dp(), lockUsd8dp, () =>
      lockVault.write.setRequiredLockUsd([lockUsd8dp]),
    )
  }
}

// ---------------------------------------------------------- optional fees ---

console.log(
  `\n[3/4] fee line${deployFeeLine ? '' : ' — skipped (WETH_ADDRESS / SWAP_ROUTER_ADDRESS unset)'}`,
)

if (deployFeeLine) {
  const feeCollectorAddress = await deploy('feeCollector', 'FeeCollector', [
    weth as Address,
    token,
    swapRouter as Address,
    jackpotRouterAddress,
    poolFee,
    flushThreshold,
  ])
  const feeCollector = await viem.getContractAt('FeeCollector', feeCollectorAddress)
  await wire('FeeCollector.jackpotSink', await feeCollector.read.jackpotSink(), jackpotRouterAddress, () =>
    feeCollector.write.setJackpotSink([jackpotRouterAddress]),
  )
} else {
  console.log('  · the jackpot is still funded by the 10% lock fuel; the 20% swap slice')
  console.log('    starts once a WETH→RAFFLE route exists (deepseek.md §6.46).')
}

// ------------------------------------------------------ optional perps fees ---

console.log(
  `\n[3b/4] perps fee router${deployPerps ? '' : ' — skipped (USDG/WETH/swap router unset)'}`,
)

if (deployPerps) {
  const perpsAddress = await deploy('perpsFeeRouter', 'PerpsFeeRouter', [
    usdg as Address,
    weth as Address,
    token,
    swapRouter as Address,
    jackpotRouterAddress,
    admin,
    perpsBuilderBps,
    perpsBridgeBps,
    perpsMaxEpochNotional,
    stableHopFee,
    poolFee,
  ])
  const perps = await viem.getContractAt('PerpsFeeRouter', perpsAddress)
  if (perpsOperator) {
    await wire('PerpsFeeRouter.operator', await perps.read.operator(), perpsOperator, () =>
      perps.write.setOperator([perpsOperator as Address]),
    )
  }
  await wire('PerpsFeeRouter.builderBps', await perps.read.builderBps(), perpsBuilderBps, () =>
    perps.write.setRates([perpsBuilderBps, perpsBridgeBps]),
  )
  await wire('PerpsFeeRouter.weth', await perps.read.weth(), weth as Address, () =>
    perps.write.setWeth([weth as Address]),
  )
} else {
  console.log('  · perps fees start once USDG + WETH + a swap router exist.')
}

// ------------------------------------------------------ optional launchpad ---

console.log(`\n[4/4] launchpad${deployLaunchpad ? '' : ' — skipped (DEPLOY_LAUNCHPAD!=1)'}`)

if (deployLaunchpad) {
  if (!contracts.feeCollector) {
    throw new Error('DEPLOY_LAUNCHPAD=1 needs the fee line: set WETH_ADDRESS and SWAP_ROUTER_ADDRESS.')
  }

  let manager = poolManagerEnv as Address | ''
  if (!manager) {
    if (chainId !== 31337) throw new Error('V4_POOL_MANAGER_ADDRESS is required on a live chain.')
    const artifact = JSON.parse(
      readFileSync('node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json', 'utf8'),
    )
    const hash = await wallets[0].deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object as `0x${string}`,
      args: [admin],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    manager = receipt.contractAddress as Address
    console.log(`  + PoolManager     ${manager} (local only)`)
  }
  contracts.poolManager = manager

  const hookArtifact = JSON.parse(
    readFileSync('artifacts/contracts/LaunchFeeHook.sol/LaunchFeeHook.json', 'utf8'),
  )
  const hookInitCode = encodeDeployData({
    abi: hookArtifact.abi,
    bytecode: hookArtifact.bytecode as `0x${string}`,
    args: [manager, admin],
  })
  const hookDeployerAddress = await deploy('hookDeployer', 'HookDeployer', [])
  const initCodeHash = keccak256(hookInitCode)
  const create2 = (salt: `0x${string}`) =>
    ('0x' + keccak256(concatHex(['0xff', hookDeployerAddress, salt, initCodeHash])).slice(-40)) as Address

  let hookAddress = contracts.launchHook
  if (hookAddress && !(await hasCode(hookAddress))) hookAddress = undefined
  if (!hookAddress) {
    // v4 reads hook permissions from the address: the low 14 bits must be 0xcc.
    const FLAGS = 0xccn
    const MASK = 0x3fffn
    let salt = 0n
    for (; salt < 2_000_000n; salt++) {
      const candidate = create2(toHex(salt, { size: 32 }))
      if ((BigInt(candidate) & MASK) === FLAGS) {
        hookAddress = candidate
        break
      }
    }
    if (!hookAddress) throw new Error('could not mine a 0xCC hook address')
    const hookDeployer = await viem.getContractAt('HookDeployer', hookDeployerAddress)
    await send(
      'HookDeployer.deploy',
      await hookDeployer.write.deploy([hookInitCode, toHex(salt, { size: 32 })]),
    )
    if (!(await hasCode(hookAddress))) {
      throw new Error('hook deploy did not produce code at the mined address')
    }
    contracts.launchHook = hookAddress
    meta.hookSalt = salt.toString()
    console.log(`  + LaunchFeeHook   ${hookAddress}`)
  }

  const graduatorAddress = await deploy('launchGraduator', 'LaunchGraduator', [
    manager,
    hookAddress,
    admin,
  ])
  const launchRouterAddress = await deploy('launchRouter', 'LaunchSwapRouter', [manager])
  const factoryAddress = await deploy('launchFactory', 'LaunchFactory', [
    treasury,
    contracts.feeCollector,
    graduatorAddress,
  ])

  const hook = await viem.getContractAt('LaunchFeeHook', hookAddress)
  const graduator = await viem.getContractAt('LaunchGraduator', graduatorAddress)
  await wire('LaunchGraduator.factory', await graduator.read.factory(), factoryAddress, () =>
    graduator.write.setFactory([factoryAddress]),
  )

  const registrarLocked = await hook.read.registrarLocked()
  const registrar = await hook.read.registrar()
  if (registrarLocked && same(registrar, graduatorAddress)) {
    console.log('    = LaunchFeeHook.registrar already locked')
  } else if (!registrarLocked) {
    await wire('LaunchFeeHook.registrar', registrar, graduatorAddress, () =>
      hook.write.setRegistrar([graduatorAddress]),
    )
    await send('LaunchFeeHook.lockRegistrar', await hook.write.lockRegistrar())
  } else {
    throw new Error(`LaunchFeeHook.registrar is locked to ${registrar}, expected ${graduatorAddress}`)
  }

  console.log('  · the board reads the factory; graduated pools land in the v4 PoolManager above.')
}

// ----------------------------------------------------------- read it back ---

console.log('\nVerifying every wire on-chain…')

const checks: Array<{ label: string; actual: string; expected: string }> = []
const push = (label: string, actual: unknown, expected: unknown) =>
  checks.push({ label, actual: String(actual), expected: String(expected) })

push('RansomeVault.xToken', await vault.read.xToken(), token)
push('RansomeVault.treasuryWallet', await vault.read.treasuryWallet(), treasury)
push('RansomeVault.jackpotRouter', await vault.read.jackpotRouter(), jackpotRouterAddress)
if (gameAddress) push('RansomeVault.gameContract', await vault.read.gameContract(), gameAddress)
push('RansomeVault.stakingVault', await vault.read.stakingVault(), lockVaultAddress)
push('XLockVault.xToken', await lockVault.read.xToken(), token)
push('XLockVault.jackpotSink', await lockVault.read.jackpotSink(), jackpotRouterAddress)
push('XLockVault.ransomeVault', await lockVault.read.ransomeVault(), vaultAddress)
push('XLockVault.lockFuelBps', await lockVault.read.lockFuelBps(), '1000')
push('XLockVault.requiredLockAmount', await lockVault.read.requiredLockAmount(), requiredLock)
if (gameAddress)
  push('XLockVault.priceSource', await lockVault.read.priceSource(), gameAddress)
if (lockUsd8dp !== undefined)
  push('XLockVault.requiredLockUsd8dp', await lockVault.read.requiredLockUsd8dp(), lockUsd8dp)
push('JackpotRouter.heist', await jackpotRouter.read.heist(), token)
push('JackpotRouter.vault', await jackpotRouter.read.vault(), vaultAddress)
if (contracts.perpsFeeRouter) {
  const perps = await viem.getContractAt('PerpsFeeRouter', contracts.perpsFeeRouter)
  push('PerpsFeeRouter.usdg', await perps.read.usdg(), usdg as Address)
  push('PerpsFeeRouter.heist', await perps.read.heist(), token)
  push('PerpsFeeRouter.jackpotSink', await perps.read.jackpotSink(), jackpotRouterAddress)
  push('PerpsFeeRouter.operator', await perps.read.operator(), perpsOperator || admin)
  push('PerpsFeeRouter.builderBps', await perps.read.builderBps(), perpsBuilderBps)
  push('PerpsFeeRouter.bridgeBps', await perps.read.bridgeBps(), perpsBridgeBps)
  push('PerpsFeeRouter.weth', await perps.read.weth(), weth as Address)
}
if (game) {
  push('RansomeGame.xToken', await game.read.xToken(), token)
  push('RansomeGame.lockVault', await game.read.lockVault(), lockVaultAddress)
  push('RansomeGame.gameVault', await game.read.gameVault(), vaultAddress)
  if (weth) {
    push('RansomeGame.weth', await game.read.weth(), weth)
    push('RansomeGame.stableHopFee', await game.read.stableHopFee(), stableHopFee)
  }
  if (tokenPriceInUsd !== undefined) push('RansomeGame.tokenPriceInUsd', await game.read.tokenPriceInUsd(), tokenPriceInUsd)
}

let failed = 0
for (const check of checks) {
  const ok = check.expected.startsWith('0x')
    ? same(check.actual, check.expected)
    : check.actual === check.expected
  console.log(
    `  ${ok ? '✓' : '✗'} ${check.label} = ${check.actual}${ok ? '' : `  (expected ${check.expected})`}`,
  )
  if (!ok) failed += 1
}

if (failed > 0) {
  throw new Error(
    `${failed} wiring check(s) failed — ${deploymentPath} was NOT updated. Fix the cause and re-run.`,
  )
}

// ---------------------------------------------------------------- persist ---

const block = await publicClient.getBlock()
const deployment: Deployment = {
  chainId,
  token,
  deployer: admin,
  treasury,
  createdAt: new Date().toISOString(),
  blockNumber: block.number.toString(),
  config: {
    requiredLock: requiredLock.toString(),
    tokenPriceInUsd: tokenPriceInUsd?.toString() ?? '',
    lockUsd8dp: lockUsd8dp?.toString() ?? '',
    lockFuelBps: 1000,
    poolFee,
    stableHopFee,
    weth: weth ?? '',
  },
  meta,
  contracts,
}

mkdirSync(deploymentsDir, { recursive: true })
writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`)

const link = (address: string) => (explorer ? `${explorer}/address/${address}` : address)

console.log(`\nDeployment written to ${deploymentPath}\n`)
for (const [name, address] of Object.entries(contracts)) {
  if (!ADDRESS_RE.test(address)) continue
  console.log(`  ${name.padEnd(16)} ${link(address)}`)
}

const envLines = [
  `NEXT_PUBLIC_CHAIN_ID=${chainId}`,
  `NEXT_PUBLIC_X_TOKEN_ADDRESS=${token}`,
  `NEXT_PUBLIC_RANSOME_VAULT_ADDRESS=${vaultAddress}`,
  gameAddress ? `NEXT_PUBLIC_RANSOME_GAME_ADDRESS=${gameAddress}` : '',
  `NEXT_PUBLIC_X_LOCK_VAULT_ADDRESS=${lockVaultAddress}`,
  usdg ? `NEXT_PUBLIC_USDG_ADDRESS=${usdg}` : '',
  usdt ? `NEXT_PUBLIC_USDT_ADDRESS=${usdt}` : '',
  usdc ? `NEXT_PUBLIC_USDC_ADDRESS=${usdc}` : '',
  `NEXT_PUBLIC_TREASURY_ADDRESS=${treasury}`,
  contracts.launchFactory ? `NEXT_PUBLIC_LAUNCH_FACTORY_ADDRESS=${contracts.launchFactory}` : '',
  contracts.launchGraduator
    ? `NEXT_PUBLIC_LAUNCH_GRADUATOR_ADDRESS=${contracts.launchGraduator}`
    : '',
  contracts.launchRouter ? `NEXT_PUBLIC_LAUNCH_ROUTER_ADDRESS=${contracts.launchRouter}` : '',
  contracts.launchHook ? `NEXT_PUBLIC_LAUNCH_HOOK_ADDRESS=${contracts.launchHook}` : '',
  contracts.poolManager ? `NEXT_PUBLIC_V4_POOL_MANAGER_ADDRESS=${contracts.poolManager}` : '',
].filter(Boolean)

console.log('\nPaste this into your host’s environment variables:\n')
console.log(envLines.join('\n'))
if (gameAddress && tokenPriceInUsd === undefined) {
  console.log('\n! Token price is unset, so the RAFFLE rail and the USD-based lock threshold are')
  console.log('  inactive until you run:')
  console.log('    TOKEN_PRICE_USD_8DP=<usd × 1e8> npm run live:price -- --network robinhood')
  console.log('  (it reads the pool price for you and prints the derived ticket and lock sizes)')
}

console.log('\nNext: npm run live:verify -- --network robinhood && npm run build\n')
