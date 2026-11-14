import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther, parseUnits, zeroAddress } from 'viem'

const { viem } = await network.connect()

/** One real card: five numbers per row, zeroes padded to the 27-cell shape. */
const CARD = [
  1, 11, 21, 31, 41, 0, 0, 0, 0,
  2, 12, 22, 32, 42, 0, 0, 0, 0,
  3, 13, 23, 33, 43, 0, 0, 0, 0,
]

/**
 * Game stack with the STRICT router: `MockSwapRouter` only accepts WETH on the
 * single-hop path and only accepts `stable → WETH → RAFFLE` on `exactInput`.
 * So a mint that succeeds here proves which route the contract actually took.
 * USDT/USDC are deployed as zero on purpose — the optional rails.
 */
async function stack() {
  const [owner, player, stranger] = await viem.getWalletClients()

  const heist = await viem.deployContract('MockERC20', ['RAFFLE', 'RAFFLE', 18])
  const usdg = await viem.deployContract('MockERC20', ['USDG', 'USDG', 6])
  const weth = await viem.deployContract('MockWETH')

  const router = await viem.deployContract('MockSwapRouter', [
    weth.address,
    heist.address,
    parseEther('1000'), // 1,000 RAFFLE per WETH
  ])
  await heist.write.mint([router.address, parseEther('100000')])

  const lockVault = await viem.deployContract('XLockVault', [heist.address, parseEther('1000')])
  const vault = await viem.deployContract('RansomeVault', [heist.address, owner.account.address])
  const game = await viem.deployContract('RansomeGame', [
    heist.address,
    usdg.address,
    zeroAddress, // USDT: optional rail, not deployed yet
    zeroAddress, // USDC: optional rail, not deployed yet
    lockVault.address,
    vault.address,
    router.address,
    owner.account.address,
  ])

  await vault.write.setGameContract([game.address])
  await heist.write.mint([player.account.address, parseEther('1')])
  await usdg.write.mint([player.account.address, parseUnits('10', 6)])
  await usdg.write.approve([game.address, parseUnits('10', 6)], { account: player.account })

  return { owner, player, stranger, heist, usdg, weth, router, lockVault, vault, game }
}

describe('RansomeGame — stablecoin two-hop route (USDG → WETH → RAFFLE)', () => {
  it('without a WETH hub the venue rejects the single-hop stable swap', async () => {
    const { game, usdg, player } = await stack()

    assert.equal(await game.read.weth(), zeroAddress, 'hub starts unset')
    await assert.rejects(
      game.write.mintWithStablecoin([usdg.address, 1, [CARD], 0n], { account: player.account }),
      /tokenIn != WETH/,
      'a stablecoin has no direct RAFFLE pool on Pons, so the direct call must fail',
    )
  })

  it('pays through WETH once the hub is set, and the vault gets the RAFFLE', async () => {
    const { game, usdg, weth, vault, player } = await stack()
    await game.write.setWeth([weth.address])

    await game.write.mintWithStablecoin([usdg.address, 1, [CARD], 0n], { account: player.account })

    // 0.5 USDG → 0.00025 WETH (2,000 USDG/WETH) → 0.25 RAFFLE at 1,000 RAFFLE/WETH.
    assert.equal((await game.read.weth()).toLowerCase(), weth.address.toLowerCase())
    assert.equal(await vault.read.getVaultBalance(), parseEther('0.25'), '99 % of the swap lands in the prize reserve')
    assert.equal(await usdg.read.balanceOf([player.account.address]), parseUnits('9.5', 6), 'exactly $0.50 was taken')
  })

  it('routes the discounted ticket too — the lock path and the route path compose', async () => {
    const { game, usdg, weth, heist, lockVault, player } = await stack()
    await game.write.setWeth([weth.address])

    await heist.write.mint([player.account.address, parseEther('1000')])
    await heist.write.approve([lockVault.address, parseEther('1000')], { account: player.account })
    await lockVault.write.lock([parseEther('1000')], { account: player.account })
    assert.equal(await lockVault.read.isDiscountEligible([player.account.address]), true)

    await game.write.mintWithStablecoin([usdg.address, 1, [CARD], 0n], { account: player.account })
    assert.equal(await usdg.read.balanceOf([player.account.address]), parseUnits('9.75', 6), '$0.25 with the lock')
  })

  it('zero address is never a payment rail, even before the optional tokens are set', async () => {
    const { game, player } = await stack()
    await assert.rejects(
      game.write.mintWithStablecoin([zeroAddress, 1, [CARD], 0n], { account: player.account }),
      /only USDG, USDT, or USDC/,
    )
  })

  it('USDC/USDT can be attached later without redeploying the game', async () => {
    const { game, owner, stranger, player, router } = await stack()
    const usdc = await viem.deployContract('MockERC20', ['USDC', 'USDC', 6])
    await usdc.write.mint([player.account.address, parseUnits('10', 6)])
    await usdc.write.approve([game.address, parseUnits('10', 6)], { account: player.account })

    await assert.rejects(game.write.setStablecoins([zeroAddress, usdc.address], { account: stranger.account }))

    await game.write.setStablecoins([zeroAddress, usdc.address], { account: owner.account })
    assert.equal((await game.read.usdcToken()).toLowerCase(), usdc.address.toLowerCase())
    assert.equal((await game.read.swapRouter()).toLowerCase(), router.address.toLowerCase())

    // The rail is accepted by the gate; the route still needs the hub, so this
    // reverts at the venue rather than at the allow-list — proving the gate opened.
    await assert.rejects(
      game.write.mintWithStablecoin([usdc.address, 1, [CARD], 0n], { account: player.account }),
      /tokenIn != WETH/,
    )
  })

  it('the stable hop fee is owner-only and sanity-bounded', async () => {
    const { game, stranger } = await stack()
    assert.equal(await game.read.stableHopFee(), 100, 'USDG/WETH is the 0.01 % tier on Robinhood Chain')

    await assert.rejects(game.write.setStableHopFee([1_000_000], { account: stranger.account }))
    await game.write.setStableHopFee([500])
    assert.equal(await game.read.stableHopFee(), 500)

    await assert.rejects(game.write.setStableHopFee([1_000_000]), /invalid fee/)
  })
})
