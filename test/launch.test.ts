import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { decodeFunctionResult, encodeFunctionData, parseEther, toHex } from 'viem'

const { viem, provider } = await network.connect()

const SUPPLY = parseEther('1000000000')
const GRADUATION = parseEther('4.2')
const JACKPOT_SHARE_BPS = 2_900n // 29% of the fee
const CREATOR_SHARE_BPS = 7_000n // 70% of the fee
const BPS = 10_000n

/** Deploys the fee stack the curve pays into, then the factory. */
async function deployAll() {
  const [owner, alice, bob, carol] = await viem.getWalletClients()

  const raffle = await viem.deployContract('MockERC20', ['RAFFLE', 'RAFFLE', 18])
  const weth = await viem.deployContract('MockWETH')
  const vault = await viem.deployContract('RansomeVault', [raffle.address, owner.account.address])
  const jackpot = await viem.deployContract('JackpotRouter', [raffle.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])

  const swapRouter = await viem.deployContract('MockSwapRouter', [
    weth.address,
    raffle.address,
    parseEther('1000'),
  ])
  await raffle.write.mint([swapRouter.address, parseEther('100000')])

  // Low threshold so a single launch fee is flushable in the end-to-end test.
  const collector = await viem.deployContract('FeeCollector', [
    weth.address,
    raffle.address,
    swapRouter.address,
    jackpot.address,
    10000,
    parseEther('0.001'),
  ])

  // P1 does not graduate in this suite; the address is only stored on each curve.
  const factory = await viem.deployContract('LaunchFactory', [
    owner.account.address, // treasury
    collector.address,
    owner.account.address, // graduator placeholder
  ])

  return { owner, alice, bob, carol, raffle, weth, vault, jackpot, swapRouter, collector, factory }
}

type Ctx = Awaited<ReturnType<typeof deployAll>>

/** Launches one coin from `creator` with `initialBuyEth` as the first buy. */
async function launch(
  ctx: Ctx,
  creator: any,
  initialBuyEth: bigint,
  opts: { name?: string; symbol?: string; recipient?: string } = {},
) {
  const fee = await ctx.factory.read.LAUNCH_FEE()
  await ctx.factory.write.createCoin(
    [opts.name ?? 'Ransom Note', opts.symbol ?? 'RANSOM', 'Payable in ninety seconds.', opts.recipient ?? creator.account.address, 0n],
    { account: creator.account, value: fee + initialBuyEth },
  )

  const coin = (await ctx.factory.read.coins([0n])) as any
  const curve = await viem.getContractAt('LaunchCurve', coin.curve)
  const token = await viem.getContractAt('LaunchToken', coin.token)
  return { coin, curve, token }
}

const split = (fee: bigint) => ({
  creator: (fee * CREATOR_SHARE_BPS) / BPS,
  jackpot: (fee * JACKPOT_SHARE_BPS) / BPS,
  treasury: fee - (fee * CREATOR_SHARE_BPS) / BPS - (fee * JACKPOT_SHARE_BPS) / BPS,
})

describe('LaunchFactory', () => {
  it('charges the launch fee, registers the coin, and funds it with the initial buy', async () => {
    const ctx = await deployAll()
    const fee = await ctx.factory.read.LAUNCH_FEE()
    const before = await viem.getPublicClient().then((c) => c.getBalance({ address: ctx.owner.account.address }))

    const { coin, curve, token } = await launch(ctx, ctx.alice, parseEther('1'))

    assert.equal(await ctx.factory.read.coinCount(), 1n)
    assert.equal(coin.name, 'Ransom Note')
    assert.equal(coin.symbol, 'RANSOM')
    assert.equal(coin.creator.toLowerCase(), ctx.alice.account.address.toLowerCase())
    assert.equal((await ctx.factory.read.curveOf([coin.token])) as string, coin.curve)

    const after = await viem.getPublicClient().then((c) => c.getBalance({ address: ctx.owner.account.address }))
    assert.equal(after - before, fee, 'launch fee lands in treasury')

    const aliceTokens = await token.read.balanceOf([ctx.alice.account.address])
    const supplyInCurve = await token.read.balanceOf([curve.address])
    assert.equal(supplyInCurve + aliceTokens, SUPPLY, 'the whole fixed supply is accounted for')
    assert.ok(aliceTokens > 0n, 'creator got tokens for the first buy')
    assert.equal(await token.read.totalSupply(), SUPPLY)
  })

  it('refuses a launch without the fee or with a bad symbol', async () => {
    const ctx = await deployAll()
    await assert.rejects(
      ctx.factory.write.createCoin(['No Fee', 'NOFEE', '', ctx.alice.account.address, 0n], {
        account: ctx.alice.account,
        value: 0n,
      }),
      /launch fee required/,
    )
    await assert.rejects(
      ctx.factory.write.createCoin(['Bad', 'toolongsymbol', '', ctx.alice.account.address, 0n], {
        account: ctx.alice.account,
        value: await ctx.factory.read.LAUNCH_FEE(),
      }),
      /bad symbol/,
    )
  })
})

describe('LaunchCurve — 70 / 29 / 1 taken in the quote asset', () => {
  it('splits the first buy exactly and sends the jackpot slice to FeeCollector', async () => {
    const ctx = await deployAll()
    const { curve } = await launch(ctx, ctx.alice, parseEther('1'))

    const fee = parseEther('0.01') // 1% of 1 ETH
    const cuts = split(fee)
    assert.equal(await curve.read.creatorFees(), cuts.creator)
    assert.equal(await curve.read.treasuryFees(), cuts.treasury)
    assert.equal(await curve.read.jackpotFees(), cuts.jackpot)

    assert.equal(
      await ctx.collector.read.pending(),
      cuts.jackpot,
      'the 29 bps is waiting in FeeCollector as WETH',
    )
    assert.equal(await ctx.vault.read.prizePoolReserve(), 0n, 'nothing reaches the pot before a flush')
  })

  it('quotes a buy, takes the fee, and moves the price up', async () => {
    const ctx = await deployAll()
    const { curve, token } = await launch(ctx, ctx.alice, parseEther('1'))
    await (await viem.getTestClient()).mine({ blocks: 3 }) // clear the protection window
    const priceBefore = await curve.read.currentPrice()

    const quote = await curve.read.quoteBuy([parseEther('0.5')])
    await curve.write.buy([quote[0]], { account: ctx.bob.account, value: parseEther('0.5') })

    assert.equal(await token.read.balanceOf([ctx.bob.account.address]), quote[0])
    assert.ok((await curve.read.currentPrice()) > priceBefore, 'price rises after a buy')

    const fee = parseEther('0.005')
    assert.equal(await curve.read.creatorFees(), split(fee).creator + split(parseEther('0.01')).creator)
    assert.equal(await curve.read.totalVolumeEth(), parseEther('1.5'))
    assert.equal(await curve.read.holderCount(), 2)
  })

  it('sells back at the quoted amount and splits the fee on the ETH leg', async () => {
    const ctx = await deployAll()
    const { curve, token } = await launch(ctx, ctx.alice, parseEther('1'))
    await (await viem.getTestClient()).mine({ blocks: 3 }) // clear the protection window

    // Bob buys, then sells half of what he received.
    const q = await curve.read.quoteBuy([parseEther('0.5')])
    await curve.write.buy([q[0]], { account: ctx.bob.account, value: parseEther('0.5') })
    const half = q[0] / 2n

    const sellQuote = await curve.read.quoteSell([half])
    await token.write.approve([curve.address, half], { account: ctx.bob.account })
    const before = await viem.getPublicClient().then((c) => c.getBalance({ address: ctx.bob.account.address }))
    await curve.write.sell([half, sellQuote[0]], { account: ctx.bob.account })
    const after = await viem.getPublicClient().then((c) => c.getBalance({ address: ctx.bob.account.address }))

    assert.ok(after > before, 'seller received ETH (gas is paid by bob too, so only direction is asserted)')
    assert.equal(await token.read.balanceOf([ctx.bob.account.address]), q[0] - half)
    assert.ok(sellQuote[0] > 0n)
  })

  it('lets the creator claim the 70 bps and the treasury claim its remainder', async () => {
    const ctx = await deployAll()
    const { curve } = await launch(ctx, ctx.alice, parseEther('1'))

    const creatorAccrued = await curve.read.creatorFees()
    const treasuryAccrued = await curve.read.treasuryFees()
    const kid = await viem.getPublicClient().then((c) => c.getBalance({ address: curve.address }))

    await curve.write.claimCreatorFees({ account: ctx.alice.account })
    assert.equal(await curve.read.creatorFees(), 0n)
    assert.equal(
      await viem.getPublicClient().then((c) => c.getBalance({ address: curve.address })),
      kid - creatorAccrued,
      'the claim leaves the contract',
    )

    await curve.write.claimTreasuryFees({ account: ctx.owner.account })
    assert.equal(await curve.read.treasuryFees(), 0n)
    assert.equal(
      await viem.getPublicClient().then((c) => c.getBalance({ address: curve.address })),
      kid - creatorAccrued - treasuryAccrued,
    )
  })

  it('rejects a claim from anyone but the fee recipient', async () => {
    const ctx = await deployAll()
    const { curve } = await launch(ctx, ctx.alice, parseEther('1'))
    await assert.rejects(curve.write.claimCreatorFees({ account: ctx.bob.account }), /not fee recipient/)
  })
})

describe('LaunchCurve — launch protection and the graduation ceiling', () => {
  it('caps a wallet for two blocks after creation, then opens the curve', async () => {
    const ctx = await deployAll()
    const { curve } = await launch(ctx, ctx.alice, parseEther('1'))
    const testClient = await viem.getTestClient()

    // Creation is block N; these are N+1 and N+2 — both inside the window.
    await assert.rejects(
      curve.write.buy([0n], { account: ctx.bob.account, value: parseEther('0.5') }),
      /protection/,
    )
    await assert.rejects(
      curve.write.buy([0n], { account: ctx.bob.account, value: parseEther('0.5') }),
      /protection/,
    )

    // Clear the window regardless of whether the reverted txs mined a block.
    await testClient.mine({ blocks: 3 })
    const quote = await curve.read.quoteBuy([parseEther('0.1')])
    await curve.write.buy([quote[0]], { account: ctx.bob.account, value: parseEther('0.1') })
    assert.equal(await curve.read.protectionActive(), false)
  })

  it('makes the creation block creator-only: a stranger cannot buy into it', async () => {
    const ctx = await deployAll()
    const testClient = await viem.getTestClient()
    const publicClient = await viem.getPublicClient()
    const fee = await ctx.factory.read.LAUNCH_FEE()

    // Raw provider txs: hardhat-viem's `.write` waits for a receipt, which
    // never arrives while automine is off.
    await testClient.setAutomine(false)
    try {
      const createTx = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: ctx.alice.account.address,
            to: ctx.factory.address,
            data: encodeFunctionData({
              abi: ctx.factory.abi,
              functionName: 'createCoin',
              args: ['Block Zero', 'ZERO', '', ctx.alice.account.address, 0n],
            }),
            value: toHex(fee + parseEther('1')),
          },
        ],
      })) as `0x${string}`

      // The creation is queued, not mined. Read the pending state to get the
      // curve address so the stranger's buy can be mined into the SAME block.
      const raw = (await provider.request({
        method: 'eth_call',
        params: [
          {
            to: ctx.factory.address,
            data: encodeFunctionData({ abi: ctx.factory.abi, functionName: 'coins', args: [0n] }),
          },
          'pending',
        ],
      })) as `0x${string}`
      const coin = decodeFunctionResult({
        abi: ctx.factory.abi,
        functionName: 'coins',
        data: raw,
      }) as any
      const curve = await viem.getContractAt('LaunchCurve', coin.curve)

      const strangerTx = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: ctx.bob.account.address,
            to: curve.address,
            data: encodeFunctionData({ abi: curve.abi, functionName: 'buy', args: [0n] }),
            value: toHex(parseEther('0.1')),
            // Explicit gas: estimation would execute the call and throw before
            // the block is mined, and we need the reverted receipt instead.
            gas: toHex(500_000),
          },
        ],
      })) as `0x${string}`

      await testClient.mine({ blocks: 1 })

      const block = await publicClient.getBlock()
      assert.equal(await curve.read.launchBlock(), block.number)
      assert.equal((await publicClient.getTransactionReceipt({ hash: createTx })).status, 'success')
      assert.equal(
        (await publicClient.getTransactionReceipt({ hash: strangerTx })).status,
        'reverted',
        'a stranger cannot buy in the creation block, even at 99%',
      )

      // The creator's own first buy rode the creation transaction at 1%.
      assert.equal(await curve.read.creatorFees(), split(parseEther('0.01')).creator)
    } finally {
      await testClient.setAutomine(true)
    }
  })

  it('stops new buys at 4.2 ETH and keeps sells open', async () => {
    const ctx = await deployAll()
    const { curve, token } = await launch(ctx, ctx.alice, parseEther('1'))
    const testClient = await viem.getTestClient()
    await testClient.mine({ blocks: 3 }) // clear the protection window

    const quote = await curve.read.quoteBuy([parseEther('3.25')])
    await curve.write.buy([quote[0]], { account: ctx.bob.account, value: parseEther('3.25') })

    assert.equal(await curve.read.readyToGraduate(), true)
    assert.ok((await curve.read.realEthReserve()) >= GRADUATION)
    await assert.rejects(
      curve.write.buy([0n], { account: ctx.carol.account, value: parseEther('0.1') }),
      /curve complete/,
    )

    // Sells still work: nobody is trapped by the missing migration module (R2).
    const half = quote[0] / 2n
    const sellQuote = await curve.read.quoteSell([half])
    await token.write.approve([curve.address, half], { account: ctx.bob.account })
    await curve.write.sell([half, sellQuote[0]], { account: ctx.bob.account })
  })
})

describe('Launchpad → FeeCollector → vault', () => {
  it('flushes the launch fees into the prize reserve with no treasury skim', async () => {
    const ctx = await deployAll()
    await launch(ctx, ctx.alice, parseEther('1'))

    const jackpotPending = await ctx.collector.read.pending()
    assert.ok(jackpotPending >= parseEther('0.001'), `pending=${jackpotPending}`)

    const before = await ctx.vault.read.prizePoolReserve()
    await ctx.collector.write.flush([1n])
    const after = await ctx.vault.read.prizePoolReserve()
    const swapped = await ctx.collector.read.totalFlushedHeist()

    assert.equal(await ctx.collector.read.pending(), 0n)
    assert.equal(after - before, swapped, 'the whole swapped amount credits the reserve')
    assert.equal(await ctx.vault.read.treasuryReserve(), 0n, 'no 1% skim on the jackpot door')
  })
})
