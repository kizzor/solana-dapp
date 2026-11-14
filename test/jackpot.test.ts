import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther, zeroHash, pad } from 'viem'

const { viem } = await network.connect()

// HEIST per 1 ETH in the stub pool.
const RATE = parseEther('1000')
const THRESHOLD = parseEther('0.01')

/**
 * Deploys the whole P0 stack fresh:
 *   HEIST (MockERC20) · WETH (MockWETH) · RansomeVault · JackpotRouter
 *   MockSwapRouter (pre-funded) · FeeCollector
 */
async function deployAll() {
  const [owner, venue, stranger] = await viem.getWalletClients()

  const heist = await viem.deployContract('MockERC20', ['HEIST', 'HEIST', 18])
  const weth = await viem.deployContract('MockWETH')
  const vault = await viem.deployContract('RansomeVault', [heist.address, owner.account.address])
  const jackpot = await viem.deployContract('JackpotRouter', [heist.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])

  const router = await viem.deployContract('MockSwapRouter', [weth.address, heist.address, RATE])
  await heist.write.mint([router.address, parseEther('1000000')])

  const collector = await viem.deployContract('FeeCollector', [
    weth.address,
    heist.address,
    router.address,
    jackpot.address,
    10000,
    THRESHOLD,
  ])

  return { owner, venue, stranger, heist, weth, vault, jackpot, router, collector }
}

/** Gives `venue` WETH and lets the collector pull it. */
async function fundVenue(ctx, amount: bigint) {
  const { venue, weth, collector } = ctx
  await weth.write.mint([venue.account.address, amount])
  await weth.write.approve([collector.address, amount], { account: venue.account })
}

describe('RansomeVault — skim-free jackpot door', () => {
  it('credits 100% of an injection and takes no treasury cut', async () => {
    const { vault, jackpot, heist, owner } = await deployAll()
    const amount = parseEther('20')

    await heist.write.mint([owner.account.address, amount])
    await heist.write.approve([jackpot.address, amount])
    await jackpot.write.injectJackpot([amount, zeroHash])

    assert.equal(await vault.read.prizePoolReserve(), amount, 'prize reserve gets the full amount')
    assert.equal(await vault.read.treasuryReserve(), 0n, 'no 1% skim on jackpot inflows')
    assert.equal(await heist.read.balanceOf([vault.address]), amount, 'tokens actually landed in the vault')
  })

  it('rejects a credit from anyone but the router', async () => {
    const { vault, owner } = await deployAll()
    await assert.rejects(vault.write.creditJackpot([parseEther('1'), '0x0000000000000000000000000000000000000000000000000000000000000000'], { account: owner.account }))
  })

  it('rejects a credit when no router is configured', async () => {
    const { heist, owner } = await deployAll()
    const fresh = await viem.deployContract('RansomeVault', [heist.address, owner.account.address])
    await assert.rejects(fresh.write.creditJackpot([parseEther('1')], { account: owner.account }))
  })
})

describe('JackpotRouter', () => {
  it('pulls HEIST from the caller and forwards it to the vault', async () => {
    const { jackpot, vault, heist, stranger } = await deployAll()
    const amount = parseEther('5')

    await heist.write.mint([stranger.account.address, amount])
    await heist.write.approve([jackpot.address, amount], { account: stranger.account })
    await jackpot.write.injectJackpot([amount, pad('0x01', { size: 32 })], { account: stranger.account })

    assert.equal(await heist.read.balanceOf([stranger.account.address]), 0n)
    assert.equal(await heist.read.balanceOf([jackpot.address]), 0n, 'router holds nothing between calls')
    assert.equal(await vault.read.prizePoolReserve(), amount)
  })

  it('only the owner can repoint the vault', async () => {
    const { jackpot, vault, stranger } = await deployAll()
    await assert.rejects(jackpot.write.setVault([vault.address], { account: stranger.account }))
  })
})

describe('FeeCollector', () => {
  it('accrues WETH without touching the vault', async () => {
    const ctx = await deployAll()

    await fundVenue(ctx, parseEther('0.005'))
    await ctx.collector.write.accrue([parseEther('0.005')], { account: ctx.venue.account })

    assert.equal(await ctx.collector.read.pending(), parseEther('0.005'))
    assert.equal(await ctx.collector.read.flushThreshold(), THRESHOLD)
    assert.equal(await ctx.collector.read.canFlush(), false, 'below threshold')
    assert.equal(await ctx.vault.read.prizePoolReserve(), 0n, 'accrual alone never credits the jackpot')
  })

  it('wraps native ETH paid into it', async () => {
    const { collector, venue, weth } = await deployAll()
    await venue.sendTransaction({ to: collector.address, value: parseEther('0.02') })

    assert.equal(await collector.read.pending(), parseEther('0.02'))
    assert.equal(await weth.read.balanceOf([collector.address]), parseEther('0.02'), 'ETH is wrapped into WETH')
  })

  it('refuses to flush below the threshold', async () => {
    const ctx = await deployAll()
    await fundVenue(ctx, parseEther('0.005'))
    await ctx.collector.write.accrue([parseEther('0.005')], { account: ctx.venue.account })
    await assert.rejects(ctx.collector.write.flush([0n]))
  })

  it('flushes above the threshold: WETH -> HEIST -> prize reserve, pending reset', async () => {
    const ctx = await deployAll()
    await fundVenue(ctx, parseEther('0.02'))
    await ctx.collector.write.accrue([parseEther('0.02')], { account: ctx.venue.account })

    assert.equal(await ctx.collector.read.canFlush(), true)

    await ctx.collector.write.flush([0n])

    // 0.02 ETH at 1000 HEIST/ETH
    const expected = parseEther('20')
    assert.equal(await ctx.vault.read.prizePoolReserve(), expected)
    assert.equal(await ctx.collector.read.pending(), 0n, 'ledger cleared')
    assert.equal(await ctx.collector.read.totalFlushedHeist(), expected)
    assert.equal(await ctx.heist.read.balanceOf([ctx.collector.address]), 0n, 'collector keeps no HEIST')
    assert.equal(await ctx.heist.read.balanceOf([ctx.jackpot.address]), 0n, 'router keeps no HEIST')
    assert.equal(await ctx.heist.read.balanceOf([ctx.vault.address]), expected)
  })

  it('enforces the caller of flush as anyone, but respects minHeistOut', async () => {
    const ctx = await deployAll()
    await fundVenue(ctx, parseEther('0.02'))
    await ctx.collector.write.accrue([parseEther('0.02')], { account: ctx.venue.account })

    // Expecting more than the pool pays must revert, not silently under-fill.
    await assert.rejects(ctx.collector.write.flush([parseEther('21')], { account: ctx.stranger.account }))
    assert.equal(await ctx.collector.read.pending(), parseEther('0.02'), 'failed flush loses nothing')
  })

  it('anyone can trigger a flush once the threshold is met', async () => {
    const ctx = await deployAll()
    await fundVenue(ctx, parseEther('0.02'))
    await ctx.collector.write.accrue([parseEther('0.02')], { account: ctx.venue.account })

    await ctx.collector.write.flush([0n], { account: ctx.stranger.account })
    assert.equal(await ctx.vault.read.prizePoolReserve(), parseEther('20'))
  })

  it('blocks flush while paused', async () => {
    const ctx = await deployAll()
    await fundVenue(ctx, parseEther('0.02'))
    await ctx.collector.write.accrue([parseEther('0.02')], { account: ctx.venue.account })
    await ctx.collector.write.setPaused([true])
    await assert.rejects(ctx.collector.write.flush([0n]))
  })
})
