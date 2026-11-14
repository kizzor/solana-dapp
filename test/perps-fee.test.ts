import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther, parseUnits, zeroHash } from 'viem'

const { viem } = await network.connect()

const RATE = parseEther('1000') // HEIST per 1 WETH in the mock pool
const STABLE_PER_WETH = 2000n // mock: 2000 USDG (6 dp) per WETH

/** USDG amount for a notional (6 dp). */
function usdg6(n: number): bigint {
  return parseUnits(String(n), 6)
}

async function deployAll() {
  const [owner, payer, stranger, locker] = await viem.getWalletClients()

  const heist = await viem.deployContract('MockERC20', ['HEIST', 'HEIST', 18])
  const usdg = await viem.deployContract('MockERC20', ['USDG', 'USDG', 6])
  const weth = await viem.deployContract('MockWETH')

  const vault = await viem.deployContract('RansomeVault', [heist.address, owner.account.address])
  const jackpot = await viem.deployContract('JackpotRouter', [heist.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])

  const router = await viem.deployContract('MockSwapRouter', [weth.address, heist.address, RATE])
  await heist.write.mint([router.address, parseEther('1000000')])

  const lockVault = await viem.deployContract('XLockVault', [heist.address, parseEther('1000')])
  await lockVault.write.setJackpotSink([jackpot.address])
  await lockVault.write.setRansomeVault([vault.address])
  await vault.write.setStakingVault([lockVault.address])

  const maxEpoch = usdg6(1_000_000) // $1M notional cap per epoch
  const perps = await viem.deployContract('PerpsFeeRouter', [
    usdg.address,
    weth.address,
    heist.address,
    router.address,
    jackpot.address,
    owner.account.address,
    5, // builder bps (0.05%)
    25, // bridge bps (0.25%)
    maxEpoch,
    100, // stableHopFee
    10000, // dexPoolFee
  ])

  return { owner, payer, stranger, locker, heist, usdg, weth, vault, jackpot, router, lockVault, perps }
}

describe('PerpsFeeRouter — fee lands in the jackpot', () => {
  it('pulls USDG, swaps to HEIST, credits the vault with source perps', async () => {
    const ctx = await deployAll()
    const { owner, payer, usdg, vault, perps } = ctx

    // notional = $10,000 -> 10,000,000,000 (6 dp? no, $10k = 10,000 * 1e6 = 10,000,000,000? 10k*1e6=1e10)
    // keep small: $1,000 notional
    const notional = usdg6(1000) // 1_000_000_000
    const feeBps = 5 + 25
    const fee = (notional * BigInt(feeBps)) / 10000n // USDG 6 dp

    await usdg.write.mint([payer.account.address, fee])
    await usdg.write.approve([perps.address, fee], { account: payer.account })

    const before = await vault.read.prizePoolReserve()
    await perps.write.creditPerpFee([notional, payer.account.address])

    const after = await vault.read.prizePoolReserve()
    assert.ok(after > before, 'vault reserve grew')

    // expected HEIST: fee(6dp) -> WETH -> HEIST
    // mock: wethOut = fee * 1e12 / 2000 ; heist = wethOut * 1000 / 1e18
    const wethOut = (fee * 10n ** 12n) / STABLE_PER_WETH
    const expectedHeist = (wethOut * RATE) / 10n ** 18n
    assert.equal(after - before, expectedHeist, 'credited amount matches the swap output')
  })

  it('grows a locker\'s accrued yield and pays out on claimReward', async () => {
    const ctx = await deployAll()
    const { owner, payer, locker, heist, usdg, vault, lockVault, perps } = ctx

    // locker locks 1,000 HEIST
    await heist.write.mint([locker.account.address, parseEther('1000')])
    await heist.write.approve([lockVault.address, parseEther('1000')], { account: locker.account })
    await lockVault.write.lock([parseEther('1000')], { account: locker.account })

    const notional = usdg6(1000)
    const feeBps = 5 + 25
    const fee = (notional * BigInt(feeBps)) / 10000n
    await usdg.write.mint([payer.account.address, fee])
    await usdg.write.approve([perps.address, fee], { account: payer.account })

    await perps.write.creditPerpFee([notional, payer.account.address])

    const earned = await lockVault.read.earned([locker.account.address])
    assert.ok(earned > 0n, 'locker accrued yield from the perps fee')

    const beforeBal = await heist.read.balanceOf([locker.account.address])
    await lockVault.write.claimReward({ account: locker.account })
    const afterBal = await heist.read.balanceOf([locker.account.address])
    assert.ok(afterBal > beforeBal, 'claimReward paid out')
  })
})

describe('PerpsFeeRouter — access and caps', () => {
  it('reverts when a non-operator calls creditPerpFee', async () => {
    const ctx = await deployAll()
    const { stranger, payer, usdg, perps } = ctx
    const notional = usdg6(100)
    const fee = (notional * 30n) / 10000n
    await usdg.write.mint([payer.account.address, fee])
    await usdg.write.approve([perps.address, fee], { account: payer.account })
    await assert.rejects(
      perps.write.creditPerpFee([notional, payer.account.address], { account: stranger.account }),
    )
  })

  it('setRates rejects out-of-bounds values', async () => {
    const ctx = await deployAll()
    const { owner, perps } = ctx
    await assert.rejects(perps.write.setRates([201, 0], { account: owner.account }))
    await assert.rejects(perps.write.setRates([0, 201], { account: owner.account }))
    // valid
    await perps.write.setRates([10, 10], { account: owner.account })
    assert.equal(await perps.read.builderBps(), 10)
    assert.equal(await perps.read.bridgeBps(), 10)
  })

  it('enforces the per-epoch notional cap', async () => {
    const ctx = await deployAll()
    const { payer, usdg, perps } = ctx
    // cap is $1M notional; exceed it
    const notional = usdg6(1_000_001)
    const fee = (notional * 30n) / 10000n
    await usdg.write.mint([payer.account.address, fee])
    await usdg.write.approve([perps.address, fee], { account: payer.account })
    await assert.rejects(perps.write.creditPerpFee([notional, payer.account.address]))
  })

  it('zero notional is a no-op that still emits', async () => {
    const ctx = await deployAll()
    const { payer, vault, perps } = ctx
    const before = await vault.read.prizePoolReserve()
    // should not revert
    await perps.write.creditPerpFee([0n, payer.account.address])
    const after = await vault.read.prizePoolReserve()
    assert.equal(after, before, 'no credit on zero notional')
  })

  it('paused blocks creditPerpFee', async () => {
    const ctx = await deployAll()
    const { owner, payer, usdg, perps } = ctx
    await perps.write.setPaused([true], { account: owner.account })
    const notional = usdg6(100)
    await assert.rejects(perps.write.creditPerpFee([notional, payer.account.address]))
  })
})

describe('PerpsFeeRouter — 6-dp USDG handling', () => {
  it('handles USDG with 6 decimals without the 1e12 scaling bug', async () => {
    const ctx = await deployAll()
    const { payer, usdg, perps } = ctx
    // notional $100 => 100,000,000 (6 dp). Fee at 30 bps = 30,000 (6 dp) = 0.03 USDG.
    const notional = usdg6(100)
    const fee = (notional * 30n) / 10000n // 30000 (6 dp)
    // payer holds EXACTLY the 6-dp fee — no 1e12 headroom.
    await usdg.write.mint([payer.account.address, fee])
    await usdg.write.approve([perps.address, fee], { account: payer.account })
    // must succeed: code uses fee in 6 dp directly, not fee * 1e12
    await perps.write.creditPerpFee([notional, payer.account.address])
    // payer fully drained
    assert.equal(await usdg.read.balanceOf([payer.account.address]), 0n)
  })
})
