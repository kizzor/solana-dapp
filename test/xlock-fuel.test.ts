import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther } from 'viem'

const { viem } = await network.connect()

const LOCK = parseEther('1000')
const FUEL = LOCK / 10n // 10%
const RETAINED = LOCK - FUEL

async function deployAll() {
  const [owner, user, stranger] = await viem.getWalletClients()

  const x = await viem.deployContract('MockERC20', ['X', 'X', 18])
  const vault = await viem.deployContract('RansomeVault', [x.address, owner.account.address])
  const jackpot = await viem.deployContract('JackpotRouter', [x.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])

  const lockVault = await viem.deployContract('XLockVault', [x.address, LOCK])
  await lockVault.write.setJackpotSink([jackpot.address], { account: owner.account })

  return { owner, user, stranger, x, vault, jackpot, lockVault }
}

async function fundAndLock(ctx: any, amount = LOCK) {
  const { x, lockVault, user } = ctx
  await x.write.mint([user.account.address, amount])
  await x.write.approve([lockVault.address, amount], { account: user.account })
  await lockVault.write.lock([amount], { account: user.account })
}

describe('XLockVault - 10% of the discount lock fuels the jackpot', () => {
  it('forwards exactly 10% to the prize reserve and retains the rest', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx)

    assert.equal(await ctx.vault.read.prizePoolReserve(), FUEL, '10% lands in the prize reserve')
    assert.equal(await ctx.x.read.balanceOf([ctx.lockVault.address]), RETAINED, 'vault holds 90%')
    assert.equal(await ctx.lockVault.read.totalFuelInjected(), FUEL, 'fuel is accounted')
  })

  it('still grants the discount on a full 1,000 lock (fuel does not raise the bar)', async () => {
    const ctx = await deployAll()
    assert.equal(await ctx.lockVault.read.isDiscountEligible([ctx.user.account.address]), false)
    await fundAndLock(ctx)
    assert.equal(await ctx.lockVault.read.isDiscountEligible([ctx.user.account.address]), true)

    const info = await ctx.lockVault.read.lockInfo([ctx.user.account.address])
    assert.equal(info[0], RETAINED, 'retained principal')
    assert.equal(info[1], LOCK, 'deposited counts the full lock')
  })

  it('withdraw returns the retained 90% after unbonding, the fuel is gone for good', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx)
    await ctx.lockVault.write.initiateUnlock({ account: ctx.user.account })

    await assert.rejects(ctx.lockVault.write.withdraw({ account: ctx.user.account }))
    const testClient = await viem.getTestClient()
    await testClient.request({ method: 'evm_increaseTime', params: [24 * 3600 + 1] })
    await testClient.request({ method: 'evm_mine', params: [] })

    const before = await ctx.x.read.balanceOf([ctx.user.account.address])
    await ctx.lockVault.write.withdraw({ account: ctx.user.account })
    const after = await ctx.x.read.balanceOf([ctx.user.account.address])

    assert.equal(after - before, RETAINED, 'principal back, 10% stays in the jackpot')
    assert.equal(await ctx.lockVault.read.isDiscountEligible([ctx.user.account.address]), false)
  })

  it('takes no fuel at all while no sink is wired', async () => {
    const { owner, x, user } = await deployAll()
    const bare = await viem.deployContract('XLockVault', [x.address, LOCK])
    void owner

    await x.write.mint([user.account.address, LOCK])
    await x.write.approve([bare.address, LOCK], { account: user.account })
    await bare.write.lock([LOCK], { account: user.account })

    assert.equal(await x.read.balanceOf([bare.address]), LOCK, 'whole lock retained')
    assert.equal(await bare.read.totalFuelInjected(), 0n)

    const [fuel, retained] = await bare.read.fuelFor([LOCK])
    assert.equal(fuel, 0n)
    assert.equal(retained, LOCK)
  })

  it('respects a changed fuel bps and caps it at 50%', async () => {
    const ctx = await deployAll()
    await ctx.lockVault.write.setLockFuelBps([500], { account: ctx.owner.account })
    await assert.rejects(
      ctx.lockVault.write.setLockFuelBps([5001], { account: ctx.owner.account })
    )

    await fundAndLock(ctx)
    assert.equal(await ctx.vault.read.prizePoolReserve(), LOCK / 20n, '5% fuel')
  })

  it('only the owner may wire the sink or change the slice', async () => {
    const ctx = await deployAll()
    await assert.rejects(
      ctx.lockVault.write.setJackpotSink([ctx.jackpot.address], { account: ctx.stranger.account })
    )
    await assert.rejects(
      ctx.lockVault.write.setLockFuelBps([100], { account: ctx.stranger.account })
    )
  })

  it('a second lock cancels unbonding and fuels again', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx)
    await ctx.lockVault.write.initiateUnlock({ account: ctx.user.account })

    await fundAndLock(ctx)

    assert.equal(await ctx.vault.read.prizePoolReserve(), FUEL * 2n)
    const info = await ctx.lockVault.read.lockInfo([ctx.user.account.address])
    assert.equal(info[0], RETAINED * 2n, 'retained principal accumulates')
    assert.equal(info[3], false, 'unbonding cancelled')
    assert.equal(
      await ctx.lockVault.read.isDiscountEligible([ctx.user.account.address]),
      true,
      'discount restored'
    )
  })
})
