/**
 * Keep the economics honest with one command — no numbers to work out by hand.
 *
 *   npm run live:price -- --network robinhood
 *   TOKEN_PRICE_USD_8DP=1250000 npm run live:price -- --network robinhood   # override
 *
 * With nothing but the deployment record it reads:
 *   RAFFLE/WETH  pool  → price of one RAFFLE in WETH
 *   USDG/WETH    pool  → price of one WETH in USDG  (USDG is a dollar stablecoin)
 * and sets:
 *   RansomeGame.tokenPriceInUsd   → tickets cost a fixed $0.50 / $0.25 in RAFFLE
 *   XLockVault.requiredLockUsd8dp → the discount lock must be worth $25, not "1,000 tokens"
 *
 * Both are re-derived from the same number, so the lock and the ticket can never
 * disagree. Re-run it whenever the price has moved; it prints what changed.
 *
 * Owner-only setters, so this reads DEPLOYER_PRIVATE_KEY from hardhat.config.ts.
 * Nothing is printed but public addresses and prices.
 */
import { network } from 'hardhat'
import { erc20Abi, formatEther, formatUnits, parseAbi, type Address } from 'viem'
import { readFileSync } from 'node:fs'

const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
])

const factoryAbi = parseAbi(['function getPool(address a, address b, uint24 fee) view returns (address)'])
const vaultAbi = parseAbi([
  'function lockRequirement() view returns (uint256)',
  'function requiredLockUsd8dp() view returns (uint256)',
  'function priceSource() view returns (address)',
])

/** sqrtPriceX96 → token1 per token0, both scaled by their own decimals. */
async function poolPriceInToken1(publicClient: any, pool: Address): Promise<number> {
  const slot0 = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' })
  const ratio = Number(slot0[0]) / 2 ** 96
  return ratio * ratio
}

async function main() {
  const { viem } = await network.connect()
  const publicClient = await viem.getPublicClient()
  const chainId = await publicClient.getChainId()

  const record = JSON.parse(readFileSync(`deployments/${chainId}.json`, 'utf8'))
  const token = record.token as Address
  const gameAddress = record.contracts?.game as Address | undefined
  const lockVaultAddress = record.contracts?.lockVault as Address | undefined

  if (!gameAddress || !lockVaultAddress) {
    throw new Error(`deployments/${chainId}.json has no game/lockVault — run live:deploy first.`)
  }

  const game = await viem.getContractAt('RansomeGame', gameAddress)
  const lockVault = await viem.getContractAt('XLockVault', lockVaultAddress)

  const weth = (await game.read.weth()) as Address
  if (!weth || weth === '0x0000000000000000000000000000000000000000') {
    throw new Error('RansomeGame.weth is unset — run live:deploy (or setWeth) first.')
  }

  const override = process.env.TOKEN_PRICE_USD_8DP

  // ---- RAFFLE price in WETH, straight from its own pool -------------------
  // A Pons launch token answers `liquidityPool()`. Anything else (a bridged
  // coin, a mock) cannot be priced here, so the env override takes over.
  const tokenAbi = parseAbi(['function liquidityPool() view returns (address)'])
  let tokenInWeth = 0
  try {
    const tokenPool = (await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'liquidityPool',
    })) as Address
    const tokenPoolToken0 = (await publicClient.readContract({
      address: tokenPool,
      abi: poolAbi,
      functionName: 'token0',
    })) as Address
    const ratio = await poolPriceInToken1(publicClient, tokenPool)
    const isToken0 = tokenPoolToken0.toLowerCase() === token.toLowerCase()
    tokenInWeth = isToken0 ? ratio : 1 / ratio
  } catch {
    if (!override) {
      throw new Error(
        `${token} has no readable liquidityPool() — pass TOKEN_PRICE_USD_8DP=<usd × 1e8> explicitly.`,
      )
    }
    console.log(`  ! ${token} has no readable pool — using TOKEN_PRICE_USD_8DP`)
  }

  // ---- WETH price in USDG (6 dp): USDG is a $1 stablecoin ----------------
  const usdg = (await game.read.usdgToken()) as Address

  const factory = (process.env.V3_FACTORY_ADDRESS?.trim() ||
    record.meta?.ponsFactory ||
    '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA') as Address

  // USDG has 6 decimals, WETH 18, so a raw ratio needs a 1e12 rescale either way.
  let wethInUsdg = 0
  for (const fee of [100, 500, 3000, 10000]) {
    try {
      const pool = (await publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'getPool',
        args: [weth, usdg, fee],
      })) as Address
      if (!pool || pool === '0x0000000000000000000000000000000000000000') continue
      const t0 = (await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'token0' })) as Address
      const wethIsToken0 = t0.toLowerCase() === (weth as string).toLowerCase()
      const r = await poolPriceInToken1(publicClient, pool)
      const human = (wethIsToken0 ? r : 1 / r) * 1e12
      if (human > 1 && human < 1e7) {
        wethInUsdg = human
        break
      }
    } catch {
      // No factory / no pool at this tier (e.g. a local chain). Try the next tier.
    }
  }

  let price8dp: bigint
  if (override) {
    price8dp = BigInt(override)
  } else {
    if (wethInUsdg === 0) {
      throw new Error(
        'Could not read a WETH/USDG pool to convert to dollars. Pass TOKEN_PRICE_USD_8DP explicitly.',
      )
    }
    const usd = tokenInWeth * wethInUsdg
    if (!(usd > 0)) throw new Error('Pool price came back zero — the pool is probably empty.')
    price8dp = BigInt(Math.max(1, Math.round(usd * 1e8)))
  }

  const lockUsd8dp = BigInt(process.env.LOCK_USD_8DP ?? '2500000000') // $25

  console.log(`\nchain ${chainId} · ${token}`)
  if (tokenInWeth > 0) console.log(`  pool price           ${tokenInWeth.toPrecision(6)} WETH per RAFFLE`)
  if (wethInUsdg > 0) console.log(`  WETH                 ${wethInUsdg.toPrecision(6)} USDG`)
  console.log(`  → token price        $${(Number(price8dp) / 1e8).toPrecision(6)} (${price8dp} at 8 dp)`)

  console.log('\nwriting…')
  if ((await game.read.tokenPriceInUsd()) !== price8dp) {
    const hash = await game.write.setTokenPriceInUsd([price8dp])
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`  ✓ RansomeGame.tokenPriceInUsd = ${price8dp}`)
  } else {
    console.log('  = RansomeGame.tokenPriceInUsd already set')
  }

  if ((await lockVault.read.priceSource()).toLowerCase() !== gameAddress.toLowerCase()) {
    const hash = await lockVault.write.setPriceSource([gameAddress])
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('  ✓ XLockVault.priceSource = RansomeGame')
  }

  if ((await lockVault.read.requiredLockUsd8dp()) !== lockUsd8dp) {
    const hash = await lockVault.write.setRequiredLockUsd([lockUsd8dp])
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`  ✓ XLockVault.requiredLockUsd8dp = ${lockUsd8dp} ($${Number(lockUsd8dp) / 1e8})`)
  }

  // ---- what the numbers mean now ----------------------------------------
  const ticket = await game.read.ticketTokens([false])
  const discountTicket = await game.read.ticketTokens([true])
  const requirement = await lockVault.read.lockRequirement()

  const supply = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' })
  const shareBps = supply > 0n ? Number((requirement * 10_000n) / supply) : 0

  console.log('\neffect on players')
  console.log(`  ticket               ${formatEther(ticket)} RAFFLE  ($0.50)`)
  console.log(`  discounted ticket    ${formatEther(discountTicket)} RAFFLE  ($0.25)`)
  console.log(`  discount lock        ${formatEther(requirement)} RAFFLE  ($${Number(lockUsd8dp) / 1e8})`)
  console.log(`  lock as share        ${(shareBps / 100).toFixed(2)} % of supply`)

  if (shareBps > 500) {
    console.log('\n  ! The lock is >5 % of supply — on a thin launch that may be more than a')
    console.log('    normal player can buy. Lower it with LOCK_USD_8DP=<dollars × 1e8>.')
  }
  if (Number(lockUsd8dp) === 0) console.log('\n  ! LOCK_USD_8DP=0 → the lock falls back to the fixed token count.')
  console.log('')
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).message}\n`)
  process.exitCode = 1
})
