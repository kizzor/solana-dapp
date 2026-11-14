import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther } from 'viem'

const { viem } = await network.connect()

const LOCK = parseEther('1000')

async function deployAll() {
  const [owner, userA, userB] = await viem.getWalletClients()

  const x = await viem.deployContract('MockERC20', ['X', 'X', 18])
  const vault = await viem.deployContract('RansomeVault', [x.address, owner.account.address])
  const jackpot = await viem.deployContract('JackpotRouter', [x.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])

  const lockVault = await viem.deployContract('XLockVault', [x.address, LOCK])
  await lockVault.write.setJackpotSink([jackpot.address], { account: owner.account })
  await lockVault.write.setRansomeVault([vault.address], { account: owner.account })
  await vault.write.setStakingVault([lockVault.address], { account: owner.account })

  return { owner, userA, userB, x, vault, jackpot, lockVault }
}

async function fundAndLock(ctx: any, who: any, amount = LOCK) {
  const { x, lockVault } = ctx
  await x.write.mint([who.account.address, amount])
  await x.write.approve([lockVault.address, amount], { account: who.account })
  await lockVault.write.lock([amount], { account: who.account })
}

describe('XLockVault - pro-rata staking yield (no inflation)', () => {
  it('a fee inflow accrues to stakers pro-rata', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx, ctx.userA)
    await fundAndLock(ctx, ctx.userB)

    // 900 X of swap/perps fees land in the vault -> notify yield (divides cleanly by 1800 retained)
    const fee = parseEther('900')
    await ctx.x.write.mint([ctx.vault.address, fee])
    await ctx.lockVault.write.notifyRewardAmount([fee], { account: ctx.owner.account })

    // total staked = 2 * 900 = 1800 retained
    const earnedA = await ctx.lockVault.read.earned([ctx.userA.account.address])
    const earnedB = await ctx.lockVault.read.earned([ctx.userB.account.address])
    assert.equal(earnedA, parseEther('450'), 'A gets half')
    assert.equal(earnedB, parseEther('450'), 'B gets half')
  })

  it('the 10% lock fuel does NOT fund yield (jackpot-only)', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx, ctx.userA) // this routes 100 X of fuel with source "lock"
    assert.equal(
      await ctx.lockVault.read.rewardPerTokenStored(),
      0n,
      'fuel leaves the yield index untouched'
    )
  })

  it('a swap/perps fee inflow DOES fund yield', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx, ctx.userA)

    const before = await ctx.lockVault.read.rewardPerTokenStored()
    const fee = parseEther('90') // 10% of 900
    await ctx.x.write.mint([ctx.owner.account.address, fee])
    await ctx.x.write.approve([ctx.jackpot.address, fee], { account: ctx.owner.account })
    await ctx.jackpot.write.injectJackpot([fee, '0x0000000000000000000000000000000000000000000000000000000000000000'], { account: ctx.owner.account })

    const after = await ctx.lockVault.read.rewardPerTokenStored()
    assert.ok(after > before, 'swap fee bumps the index')
  })

  it('claimReward transfers X from the vault to the staker', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx, ctx.userA)

    const fee = parseEther('90')
    await ctx.x.write.mint([ctx.vault.address, fee])
    await ctx.lockVault.write.notifyRewardAmount([fee], { account: ctx.owner.account })

    const before = await ctx.x.read.balanceOf([ctx.userA.account.address])
    await ctx.lockVault.write.claimReward({ account: ctx.userA.account })
    const after = await ctx.x.read.balanceOf([ctx.userA.account.address])

    assert.equal(after - before, fee, 'yield paid out')
    assert.equal(await ctx.lockVault.read.earned([ctx.userA.account.address]), 0n, 'accrued cleared')
  })

  it('no yield accrues when nobody is staked (fees stay in vault)', async () => {
    const ctx = await deployAll()
    const fee = parseEther('100')
    await ctx.x.write.mint([ctx.vault.address, fee])
    await ctx.lockVault.write.notifyRewardAmount([fee], { account: ctx.owner.account })
    assert.equal(await ctx.lockVault.read.rewardPerTokenStored(), 0n, 'index untouched')
  })

  it('withdrawing removes stake weight and stops future accrual', async () => {
    const ctx = await deployAll()
    await fundAndLock(ctx, ctx.userA)

    // unbond + wait
    await ctx.lockVault.write.initiateUnlock({ account: ctx.userA.account })
    const tc = await viem.getTestClient()
    await tc.request({ method: 'evm_increaseTime', params: [24 * 3600 + 1] })
    await tc.request({ method: 'evm_mine', params: [] })
    await ctx.lockVault.write.withdraw({ account: ctx.userA.account })

    const fee = parseEther('50')
    await ctx.x.write.mint([ctx.vault.address, fee])
    await ctx.lockVault.write.notifyRewardAmount([fee], { account: ctx.owner.account })
    // no stakers -> index stays 0
    assert.equal(await ctx.lockVault.read.rewardPerTokenStored(), 0n)
  })

  it('only owner or the vault may notify', async () => {
    const ctx = await deployAll()
    await assert.rejects(
      ctx.lockVault.write.notifyRewardAmount([parseEther('1')], { account: ctx.userA.account })
    )
  })
})
