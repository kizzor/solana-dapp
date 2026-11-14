/**
 * End-to-end trade flow against the deployed local stack:
 *   create → curve buy → curve sell → ceiling → graduate → v4 pool buy/sell
 *   → tape API.
 *
 *   npx hardhat run scripts/e2e-launchpad.ts --network localhost
 * (the app must be running on :3012 for the tape step; the rest is pure chain)
 */

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther } from 'viem'

const deployment = JSON.parse(readFileSync('.tmp-explore/local-deployment.json', 'utf8'))
const { viem } = await network.connect()
const [deployer, player, venue] = await viem.getWalletClients()
const publicClient = await viem.getPublicClient()

const factory: any = await viem.getContractAt('LaunchFactory', deployment.contracts.launchFactory)
const graduator: any = await viem.getContractAt('LaunchGraduator', deployment.contracts.launchGraduator)
const router: any = await viem.getContractAt('LaunchSwapRouter', deployment.contracts.launchRouter)
const fee = await factory.read.LAUNCH_FEE()

const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash })
const mine = async () => (await viem.getTestClient()).mine({ blocks: 2 })

console.log('1. create a coin with a 1.0 ETH initial buy')
await wait(
  await factory.write.createCoin(
    ['E2E Tape', 'E2E', 'Built by the end-to-end trade flow.', player.account.address, 0n],
    { account: player.account, value: fee + parseEther('1') },
  ),
)
const id = (await factory.read.coinCount()) - 1n
const coin: any = await factory.read.coins([id])
const token: any = await viem.getContractAt('LaunchToken', coin[0] ?? coin.token)
const curve: any = await viem.getContractAt('LaunchCurve', coin[1] ?? coin.curve)
console.log('   curve', curve.address)

console.log('2. curve buy (venue, 0.2 ETH) and curve sell (creator, 10M)')
await mine()
await wait(await curve.write.buy([0n], { account: venue.account, value: parseEther('0.2') }))
const sellCurve = parseEther('10000000')
await wait(await token.write.approve([curve.address, sellCurve], { account: player.account }))
await wait(await curve.write.sell([sellCurve, 0n], { account: player.account }))

console.log('3. push over the 4.2 ETH ceiling and graduate')
await mine()
await wait(await curve.write.buy([0n], { account: venue.account, value: parseEther('3.3') }))
assert.equal(await curve.read.readyToGraduate(), true, 'curve reached the ceiling')
await wait(await curve.write.graduate({ account: venue.account }))
assert.equal(await curve.read.graduated(), true, 'graduated')

const g: any = await graduator.read.graduationOf([coin[0] ?? coin.token])
const ethSeeded = g[4] ?? g.ethSeeded
const tokensSeeded = g[5] ?? g.tokensSeeded
const locked = await graduator.read.lockedTokens([coin[0] ?? coin.token])
console.log('   seeded', Number(ethSeeded) / 1e18, 'ETH /', Number(tokensSeeded) / 1e6, 'M tokens')
assert.ok(ethSeeded > parseEther('4.2'), 'the pool got the curve ETH')
assert.ok(tokensSeeded > 0n && locked > 0n, 'value-matched seed with a locked remainder')

const key: any = await graduator.read.poolKeyOf([coin[0] ?? coin.token])
const poolKey = {
  currency0: key[0] ?? key.currency0,
  currency1: key[1] ?? key.currency1,
  fee: Number(key[2] ?? key.fee),
  tickSpacing: Number(key[3] ?? key.tickSpacing),
  hooks: key[4] ?? key.hooks,
}

console.log('4. v4 pool buy (deployer, 0.03) and pool sell (venue, 1M)')
const before = await token.read.balanceOf([deployer.account.address])
await mine()
await wait(
  await router.write.buy([poolKey, 0n, deployer.account.address], {
    account: deployer.account,
    value: parseEther('0.03'),
  }),
)
assert.ok(
  (await token.read.balanceOf([deployer.account.address])) > before,
  'pool buy delivered tokens',
)

const sellPool = parseEther('1000000')
await wait(await token.write.approve([router.address, sellPool], { account: venue.account }))
await mine()
const venueEthBefore = await publicClient.getBalance({ address: venue.account.address })
const sellHash = await router.write.sell([poolKey, sellPool, 0n, venue.account.address], {
  account: venue.account,
})
const receipt = await wait(sellHash)
const gas = receipt.gasUsed * receipt.effectiveGasPrice
const venueEthAfter = await publicClient.getBalance({ address: venue.account.address })
assert.ok(venueEthAfter + gas > venueEthBefore, 'pool sell paid ETH')

console.log('5. the frozen curve rejects both directions')
await assert.rejects(curve.write.buy([0n], { account: deployer.account, value: parseEther('0.01') }))

const hookFees: any = await viem.getContractAt('LaunchFeeHook', deployment.contracts.launchHook)
const poolId = g[0] ?? g.poolId
const creatorFees = await hookFees.read.creatorFees([poolId])
console.log('   creator fees accrued in the hook:', Number(creatorFees) / 1e18, 'ETH')
assert.ok(creatorFees > 0n, 'the hook split the pool fees')

console.log('6. tape API returns the same trades')
const api = `http://localhost:3012/api/launchpad/tape?curves=${curve.address}`
const res = await fetch(api)
assert.equal(res.status, 200, 'tape route responded')
const body: any = await res.json()
const tape = body.byCurve?.[String(curve.address).toLowerCase()]
assert.ok(tape, 'tape has the coin')
assert.equal(tape.graduated, true)
assert.ok(tape.trades.length >= 6, `tape indexed ${tape.trades.length} trades`)
assert.equal(tape.trades[0].venue, 'pool', 'newest trade is from the pool')
assert.ok(tape.pool?.priceEth > 0, 'pool price rebuilt')
assert.ok(tape.holders.length >= 3, 'ranked holders from transfers')

console.log('\nE2E OK —', tape.trades.length, 'trades,', tape.holders.length, 'holders, pool', tape.pool)
