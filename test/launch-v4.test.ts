import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { network } from 'hardhat'
import {
  concatHex,
  decodeEventLog,
  encodeDeployData,
  keccak256,
  parseEther,
  toHex,
} from 'viem'

const { viem } = await network.connect()

const BPS = 10_000n
const CREATOR_SHARE_BPS = 7_000n
const JACKPOT_SHARE_BPS = 2_000n
const HOOK_FLAGS = 0xccn // beforeSwap | afterSwap | both return-delta flags
const FLAG_MASK = 0x3fffn

const artifact = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const poolManagerArt = artifact('node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json')

const asKey = (k: any) => ({
  currency0: k[0] ?? k.currency0,
  currency1: k[1] ?? k.currency1,
  fee: k[2] ?? k.fee,
  tickSpacing: k[3] ?? k.tickSpacing,
  hooks: k[4] ?? k.hooks,
})

/** Deploys PoolManager + hook (mined CREATE2 address) + graduator + factory. */
async function deployV4() {
  const [owner, alice, bob, carol] = await viem.getWalletClients()
  const publicClient = await viem.getPublicClient()

  // Uniswap v4 PoolManager ships as a Foundry artifact; deploy its bytecode.
  const pmHash = await owner.deployContract({
    abi: poolManagerArt.abi,
    bytecode: poolManagerArt.bytecode.object as `0x${string}`,
    args: [owner.account.address],
  })
  const pmReceipt = await publicClient.waitForTransactionReceipt({ hash: pmHash })
  assert.equal(pmReceipt.status, 'success')
  const poolManager = pmReceipt.contractAddress!

  // The hook must sit at an address whose low 14 bits are 0xCC, otherwise v4
  // never calls it and the pool would silently take no fee.
  const hookArt = artifact('artifacts/contracts/LaunchFeeHook.sol/LaunchFeeHook.json')
  const hookInitCode = encodeDeployData({
    abi: hookArt.abi,
    bytecode: hookArt.bytecode as `0x${string}`,
    args: [poolManager, owner.account.address],
  })

  const hookDeployer = await viem.deployContract('HookDeployer')
  const initCodeHash = keccak256(hookInitCode)
  const create2Address = (s: `0x${string}`) =>
    ('0x' +
      keccak256(concatHex(['0xff', hookDeployer.address, s, initCodeHash])).slice(-40)) as `0x${string}`

  let salt = 0n
  let hookAddress = ''
  for (; salt < 500_000n; salt++) {
    const addr = create2Address(toHex(salt, { size: 32 }))
    if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) {
      hookAddress = addr
      break
    }
  }
  assert.ok(hookAddress, 'mined a hook address with the 0xCC permission flags')
  await hookDeployer.write.deploy([hookInitCode, toHex(salt, { size: 32 })])
  const hook = await viem.getContractAt('LaunchFeeHook', hookAddress)

  const graduator = await viem.deployContract('LaunchGraduator', [
    poolManager,
    hookAddress,
    owner.account.address,
  ])
  const router = await viem.deployContract('LaunchSwapRouter', [poolManager])

  // The fee stack the hook pays into.
  const raffle = await viem.deployContract('MockERC20', ['RAFFLE', 'RAFFLE', 18])
  const weth = await viem.deployContract('MockWETH')
  const vault = await viem.deployContract('RansomeVault', [raffle.address, owner.account.address])
  const jackpot = await viem.deployContract('JackpotRouter', [raffle.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])
  const swapRouter = await viem.deployContract('MockSwapRouter', [weth.address, raffle.address, parseEther('1000')])
  await raffle.write.mint([swapRouter.address, parseEther('100000')])
  const collector = await viem.deployContract('FeeCollector', [
    weth.address,
    raffle.address,
    swapRouter.address,
    jackpot.address,
    10000,
    parseEther('0.001'),
  ])

  const factory = await viem.deployContract('LaunchFactory', [
    owner.account.address,
    collector.address,
    graduator.address,
  ])
  await graduator.write.setFactory([factory.address])
  await hook.write.setRegistrar([graduator.address])
  await hook.write.lockRegistrar()

  return {
    owner,
    alice,
    bob,
    carol,
    poolManager,
    hook,
    graduator,
    router,
    factory,
    raffle,
    weth,
    vault,
    jackpot,
    collector,
  }
}

type Ctx = Awaited<ReturnType<typeof deployV4>>

/** Launches and pushes one coin over the 4.2 ETH ceiling. */
async function graduatingCoin(ctx: Ctx, creator = ctx.alice) {
  const fee = await ctx.factory.read.LAUNCH_FEE()
  await ctx.factory.write.createCoin(
    ['Neon Tube', 'TUBE', 'Graduates into a v4 pool.', creator.account.address, 0n],
    { account: creator.account, value: fee + parseEther('1') },
  )
  const coin = (await ctx.factory.read.coins([0n])) as any
  const curve = await viem.getContractAt('LaunchCurve', coin.curve)
  const token = await viem.getContractAt('LaunchToken', coin.token)

  await (await viem.getTestClient()).mine({ blocks: 3 })
  const q = await curve.read.quoteBuy([parseEther('3.25')])
  await curve.write.buy([q[0]], { account: ctx.bob.account, value: parseEther('3.25') })
  assert.equal(await curve.read.readyToGraduate(), true)

  return { coin, curve, token }
}

describe('R2 — graduation into a Uniswap v4 pool', () => {
  it('opens the pool at the curve price, locks the remainder, and freezes the curve', async () => {
    const ctx = await deployV4()
    const { coin, curve, token } = await graduatingCoin(ctx)

    const ethAtCeiling = await curve.read.realEthReserve()
    const tokensAtCeiling = await token.read.balanceOf([curve.address])
    const vEth = await curve.read.virtualEthReserve()
    const vToken = await curve.read.virtualTokenReserve()

    // Permissionless: a passer-by can run the migration.
    await curve.write.graduate({ account: ctx.bob.account })

    assert.equal(await curve.read.graduated(), true)
    assert.equal(await curve.read.realEthReserve(), 0n)
    assert.equal(await curve.read.graduatedEth(), ethAtCeiling)

    const g: any = await ctx.graduator.read.graduationOf([coin.token])
    const poolId = g.poolId ?? g[0]
    assert.ok(poolId && poolId !== `0x${'0'.repeat(64)}`, 'pool id is set')
    assert.equal(g.token ?? g[1], coin.token)

    // Value-matched seed: real ETH / curve price, not all remaining tokens.
    const sqrtP = (g.sqrtPriceX96 ?? g[3]) as bigint
    const expectedSeed = (ethAtCeiling * sqrtP * sqrtP) / (1n << 192n)
    // Public struct getters return an unnamed tuple; tokensSeeded is slot 5.
    const seeded = g[5] ?? g.tokensSeeded
    assert.ok(seeded > 0n)
    assert.ok(seeded <= expectedSeed, 'never seeds more than the ETH can pair')
    // Liquidity is floored to a uint128, so a few thousand wei of dust is expected.
    assert.ok(expectedSeed - seeded <= 1_000_000_000n, 'seeds the value-matched amount')

    const locked = await ctx.graduator.read.lockedTokens([coin.token])
    assert.equal(locked, tokensAtCeiling - seeded, 'the unpaired remainder is locked forever')
    assert.ok(locked > 0n)
    assert.equal(await token.read.balanceOf([ctx.graduator.address]), locked)

    const config: any = await ctx.hook.read.configOf([poolId])
    assert.equal(config.active ?? config[3], true, 'the pool is registered with the fee hook')

    // Curve directions close; the pool is the venue now.
    await (await viem.getTestClient()).mine({ blocks: 2 })
    await assert.rejects(
      curve.write.buy([0n], { account: ctx.carol.account, value: parseEther('0.1') }),
      /graduated/,
    )
    await assert.rejects(
      curve.write.sell([parseEther('1'), 0n], { account: ctx.bob.account }),
      /graduated/,
    )
  })

  it('takes 1% in ETH on a pool buy and splits it 70 / 20 / 10', async () => {
    const ctx = await deployV4()
    const { coin, curve, token } = await graduatingCoin(ctx)
    await curve.write.graduate()

    const g: any = await ctx.graduator.read.graduationOf([coin.token])
    const poolId = g.poolId ?? g[0]
    const key = asKey(await ctx.graduator.read.poolKeyOf([coin.token]))

    const pendingBefore = await ctx.collector.read.pending()
    const creatorBefore = await ctx.hook.read.creatorFees([poolId])
    const treasuryBefore = await ctx.hook.read.treasuryFees([poolId])
    const tokensBefore = await token.read.balanceOf([ctx.carol.account.address])

    const ethIn = parseEther('0.1')
    await ctx.router.write.buy([key, 0n, ctx.carol.account.address], {
      account: ctx.carol.account,
      value: ethIn,
    })

    const fee = (ethIn * 100n - 1n) / BPS + 1n
    const creatorCut = (fee * CREATOR_SHARE_BPS) / BPS
    const jackpotCut = (fee * JACKPOT_SHARE_BPS) / BPS
    const treasuryCut = fee - creatorCut - jackpotCut

    assert.equal((await ctx.hook.read.creatorFees([poolId])) - creatorBefore, creatorCut)
    assert.equal((await ctx.hook.read.treasuryFees([poolId])) - treasuryBefore, treasuryCut)
    assert.equal((await ctx.collector.read.pending()) - pendingBefore, jackpotCut)

    const tokensOut = (await token.read.balanceOf([ctx.carol.account.address])) - tokensBefore
    assert.ok(tokensOut > 0n, 'the buyer received coins')

    // The creator slice is claimable from the hook, not pushed blindly.
    const publicClient = await viem.getPublicClient()
    const creatorEthBefore = await publicClient.getBalance({ address: ctx.alice.account.address })
    const claimHash = await ctx.hook.write.claimCreatorFees([poolId], { account: ctx.alice.account })
    const claimReceipt = await publicClient.getTransactionReceipt({ hash: claimHash })
    const gas = claimReceipt.gasUsed * claimReceipt.effectiveGasPrice
    const creatorEthAfter = await publicClient.getBalance({ address: ctx.alice.account.address })
    assert.equal(creatorEthAfter - creatorEthBefore + gas, creatorCut, 'creator claims the 70% slice')
  })

  it('takes the fee on the ETH leg of a pool sell and never in the coin', async () => {
    const ctx = await deployV4()
    const { coin, curve, token } = await graduatingCoin(ctx)
    await curve.write.graduate()

    const g: any = await ctx.graduator.read.graduationOf([coin.token])
    const poolId = g.poolId ?? g[0]
    const key = asKey(await ctx.graduator.read.poolKeyOf([coin.token]))

    const amountIn = parseEther('1000000')
    await token.write.approve([ctx.router.address, amountIn], { account: ctx.bob.account })

    const creatorBefore = await ctx.hook.read.creatorFees([poolId])
    const treasuryBefore = await ctx.hook.read.treasuryFees([poolId])
    const pendingBefore = await ctx.collector.read.pending()
    const bobTokensBefore = await token.read.balanceOf([ctx.bob.account.address])

    const hash = await ctx.router.write.sell(
      [key, amountIn, 0n, ctx.bob.account.address],
      { account: ctx.bob.account },
    )
    const receipt = await viem.getPublicClient().then((c) => c.getTransactionReceipt({ hash }))

    const sold = receipt.logs
      .filter((l) => l.address.toLowerCase() === ctx.router.address.toLowerCase())
      .map((l) => {
        try {
          return decodeEventLog({ abi: ctx.router.abi as any, data: l.data, topics: l.topics })
        } catch {
          return null
        }
      })
      .find((e) => e?.eventName === 'Sold') as any

    assert.ok(sold, 'Sold event emitted')
    const ethOut = sold.args.ethOut as bigint
    assert.ok(ethOut > 0n, 'seller received ETH')

    assert.equal(
      await token.read.balanceOf([ctx.bob.account.address]),
      bobTokensBefore - amountIn,
      'coins left the seller',
    )

    const creatorDelta = (await ctx.hook.read.creatorFees([poolId])) - creatorBefore
    const treasuryDelta = (await ctx.hook.read.treasuryFees([poolId])) - treasuryBefore
    const jackpotDelta = (await ctx.collector.read.pending()) - pendingBefore

    // Reconstruct the fee from the net ETH out: net = gross - ceil(gross * 1%).
    const gross = (ethOut * BPS) / (BPS - 100n)
    const fee = (gross * 100n - 1n) / BPS + 1n
    assert.ok(creatorDelta > 0n && jackpotDelta > 0n && treasuryDelta > 0n)
    assert.equal(creatorDelta, (fee * CREATOR_SHARE_BPS) / BPS)
    assert.equal(jackpotDelta, (fee * JACKPOT_SHARE_BPS) / BPS)
    assert.equal(creatorDelta + jackpotDelta + treasuryDelta, fee, 'the three buckets sum to the fee')
  })
})
