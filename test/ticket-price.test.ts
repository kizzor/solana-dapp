import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther, zeroAddress } from 'viem'

const { viem } = await network.connect()

/** Deploys the game stack needed to price a ticket. */
async function deployGame() {
  const [owner, player, stranger] = await viem.getWalletClients()

  const heist = await viem.deployContract('MockERC20', ['RAFFLE', 'RAFFLE', 18])
  const usdg = await viem.deployContract('MockERC20', ['USDG', 'USDG', 6])
  const usdc = await viem.deployContract('MockERC20', ['USDC', 'USDC', 6])
  const usdt = await viem.deployContract('MockERC20', ['USDT', 'USDT', 6])
  const lockVault = await viem.deployContract('XLockVault', [heist.address, parseEther('1000')])
  const vault = await viem.deployContract('RansomeVault', [heist.address, owner.account.address])

  const game = await viem.deployContract('RansomeGame', [
    heist.address,
    usdg.address,
    usdt.address,
    usdc.address,
    lockVault.address,
    vault.address,
    zeroAddress,
    owner.account.address,
  ])
  await vault.write.setGameContract([game.address])

  return { owner, player, stranger, heist, vault, game }
}

describe('RansomeGame — USD-denominated ticket pricing', () => {
  it('starts unset and refuses to quote a ticket', async () => {
    const { game } = await deployGame()
    assert.equal(await game.read.tokenPriceInUsd(), 0n)
    await assert.rejects(game.read.ticketTokens([false]))
  })

  it('converts $0.50 and $0.25 into tokens at the set price', async () => {
    const { game } = await deployGame()
    // $0.02 -> 2_000_000 (8 dp)
    await game.write.setTokenPriceInUsd([2_000_000n])

    assert.equal(await game.read.ticketTokens([false]), parseEther('25'), '$0.50 / $0.02 = 25 tokens')
    assert.equal(await game.read.ticketTokens([true]), parseEther('12.5'), '$0.25 / $0.02 = 12.5 tokens')
  })

  it('rounds the token amount UP so the house is never short-changed', async () => {
    const { game } = await deployGame()
    // $0.03 -> 0.5 / 0.03 = 16.666… tokens, must round up
    await game.write.setTokenPriceInUsd([3_000_000n])
    assert.equal(await game.read.ticketTokens([false]), 16_666_666_666_666_666_667n)
  })

  it('reprices as the market moves — no redeploy needed', async () => {
    const { game } = await deployGame()
    await game.write.setTokenPriceInUsd([2_000_000n])   // $0.02
    const cheap = await game.read.ticketTokens([false])
    await game.write.setTokenPriceInUsd([100_000_000n]) // $1.00
    const rich = await game.read.ticketTokens([false])

    assert.equal(cheap, parseEther('25'))
    assert.equal(rich, parseEther('0.5'))
  })

  it('only the authority may set the price', async () => {
    const { game, stranger } = await deployGame()
    await assert.rejects(
      game.write.setTokenPriceInUsd([2_000_000n], { account: stranger.account })
    )
  })

  it('mints at the USD price and credits the vault 99/1', async () => {
    const { game, heist, vault, player } = await deployGame()
    await game.write.setTokenPriceInUsd([2_000_000n]) // $0.02 → 25 tokens per ticket

    await heist.write.mint([player.account.address, parseEther('100')])
    await heist.write.approve([game.address, parseEther('50')], { account: player.account })

    // Two real, distinct cards: the mint validates the cells and refuses a
    // second copy of the same board in a round.
    const ticketA = [
      1, 11, 21, 31, 41, 0, 0, 0, 0,
      2, 12, 22, 32, 42, 0, 0, 0, 0,
      3, 13, 23, 33, 43, 0, 0, 0, 0,
    ]
    const ticketB = [
      4, 14, 24, 34, 44, 0, 0, 0, 0,
      5, 15, 25, 35, 45, 0, 0, 0, 0,
      6, 16, 26, 36, 46, 0, 0, 0, 0,
    ]
    await game.write.mintWithXToken([2, [ticketA, ticketB]], { account: player.account })

    const paid = parseEther('50') // 2 tickets × 25 tokens
    assert.equal(await heist.read.balanceOf([player.account.address]), parseEther('50'))
    assert.equal(await heist.read.balanceOf([vault.address]), paid)
    assert.equal(await vault.read.prizePoolReserve(), parseEther('49.5'), '99% of 50')
    assert.equal(await vault.read.treasuryReserve(), parseEther('0.5'), '1% treasury')
  })
})
