import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther } from 'viem'

const { viem } = await network.connect()

async function stack() {
  const [owner, user, stranger] = await viem.getWalletClients()

  const x = await viem.deployContract('MockERC20', ['RAFFLE', 'RAFFLE', 18])
  const lockVault = await viem.deployContract('XLockVault', [x.address, parseEther('1000')])
  const price = await viem.deployContract('MockPriceSource')

  await x.write.mint([user.account.address, parseEther('5000')])
  await x.write.approve([lockVault.address, parseEther('5000')], { account: user.account })

  return { owner, user, stranger, x, lockVault, price }
}

describe('XLockVault — the discount lock is worth money, not a token count', () => {
  it('falls back to the fixed token amount while nothing is wired', async () => {
    const { lockVault } = await stack()
    assert.equal(await lockVault.read.lockRequirement(), parseEther('1000'))
  })

  it('re-derives the requirement from the live price', async () => {
    const { lockVault, price } = await stack()
    await price.write.setPrice([2_000_000n]) // $0.02
    await lockVault.write.setPriceSource([price.address])
    await lockVault.write.setRequiredLockUsd([2_500_000_000n]) // $25

    assert.equal(await lockVault.read.lockRequirement(), parseEther('1250'), '$25 / $0.02')
  })

  it('refuses a 1,000-token lock once the coin is cheap, accepts the real amount', async () => {
    const { lockVault, price, user } = await stack()
    await price.write.setPrice([2_000_000n])
    await lockVault.write.setPriceSource([price.address])
    await lockVault.write.setRequiredLockUsd([2_500_000_000n])

    await lockVault.write.lock([parseEther('1000')], { account: user.account })
    assert.equal(
      await lockVault.read.isDiscountEligible([user.account.address]),
      false,
      '1,000 tokens is only $20 at this price — not the $25 the lock is meant to prove',
    )

    await lockVault.write.lock([parseEther('250')], { account: user.account })
    assert.equal(await lockVault.read.isDiscountEligible([user.account.address]), true)
  })

  it('lowers the bar when the coin appreciates — same money, fewer tokens', async () => {
    const { lockVault, price } = await stack()
    await price.write.setPrice([2_000_000n])
    await lockVault.write.setPriceSource([price.address])
    await lockVault.write.setRequiredLockUsd([2_500_000_000n])

    await price.write.setPrice([100_000_000n]) // $1.00
    assert.equal(await lockVault.read.lockRequirement(), parseEther('25'))
  })

  it('a broken price source degrades to the fixed amount instead of locking everyone out', async () => {
    const { lockVault, x } = await stack()
    await lockVault.write.setRequiredLockUsd([2_500_000_000n])
    await lockVault.write.setPriceSource([x.address]) // a token: no tokenPriceInUsd()

    assert.equal(await lockVault.read.lockRequirement(), parseEther('1000'))
  })

  it('setting the USD target to zero restores the token count', async () => {
    const { lockVault, price } = await stack()
    await price.write.setPrice([2_000_000n])
    await lockVault.write.setPriceSource([price.address])
    await lockVault.write.setRequiredLockUsd([2_500_000_000n])
    await lockVault.write.setRequiredLockUsd([0n])

    assert.equal(await lockVault.read.lockRequirement(), parseEther('1000'))
  })

  it('only the owner can retarget the lock', async () => {
    const { lockVault, price, stranger } = await stack()
    await assert.rejects(lockVault.write.setRequiredLockUsd([2_500_000_000n], { account: stranger.account }))
    await assert.rejects(lockVault.write.setPriceSource([price.address], { account: stranger.account }))
  })
})
