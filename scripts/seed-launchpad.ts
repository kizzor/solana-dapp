/**
 * Seed the local launchpad with real trades, including one coin that graduates
 * into its Uniswap v4 pool — the tape, the sparkline and the pool quotes all
 * read these logs, nothing here is faked on the client.
 *
 *   npx hardhat run scripts/seed-launchpad.ts --network localhost
 */

import { readFileSync } from 'node:fs'
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

async function mine(blocks = 2) {
  await (await viem.getTestClient()).mine({ blocks })
}

async function launch(
  name: string,
  symbol: string,
  blurb: string,
  creator: any,
  initialBuyEth: string,
) {
  const hash = await factory.write.createCoin(
    [name, symbol, blurb, creator.account.address, 0n],
    { account: creator.account, value: fee + parseEther(initialBuyEth) },
  )
  await publicClient.waitForTransactionReceipt({ hash })
  const id = (await factory.read.coinCount()) - 1n
  const coin: any = await factory.read.coins([id])
  const token: any = await viem.getContractAt('LaunchToken', coin[0] ?? coin.token)
  const curve: any = await viem.getContractAt('LaunchCurve', coin[1] ?? coin.curve)
  console.log(`launched ${name} (${symbol}) at ${curve.address}`)
  return { token, curve }
}

// 1. A coin that graduates: 1.0 initial + a 3.3 buy crosses the 4.2 ceiling.
const tube = await launch(
  'Neon Tube',
  'TUBE',
  'A full-range v4 pool behind a 1% hook.',
  deployer,
  '1.0',
)
await mine()
await tube.curve.write.buy([0n], { account: player.account, value: parseEther('3.3') })
await mine()
console.log('tube ready:', await tube.curve.read.readyToGraduate())
await tube.curve.write.graduate({ account: player.account })
console.log('tube graduated:', await tube.curve.read.graduated())

// Trade in the new pool: a buy and a sell, so the tape has both venues.
const key: any = await graduator.read.poolKeyOf([tube.token.address])
const poolKey = {
  currency0: key[0] ?? key.currency0,
  currency1: key[1] ?? key.currency1,
  fee: Number(key[2] ?? key.fee),
  tickSpacing: Number(key[3] ?? key.tickSpacing),
  hooks: key[4] ?? key.hooks,
}
await mine()
await router.write.buy([poolKey, 0n, venue.account.address], {
  account: venue.account,
  value: parseEther('0.05'),
})
const sellAmount = parseEther('3000000')
await tube.token.write.approve([router.address, sellAmount], { account: player.account })
await mine()
await router.write.sell([poolKey, sellAmount, 0n, player.account.address], {
  account: player.account,
})

// 2 + 3. Coins still on their curves, with buys and a sell for the tape.
const ransom = await launch(
  'Ransom Note',
  'RANSOM',
  'Payable in ninety seconds or the JPEG gets it.',
  player,
  '0.6',
)
await mine()
await ransom.curve.write.buy([0n], { account: venue.account, value: parseEther('0.15') })
const ransomSell = parseEther('5000000')
await ransom.token.write.approve([ransom.curve.address, ransomSell], { account: player.account })
await ransom.curve.write.sell([ransomSell, 0n], { account: player.account })

const carnival = await launch(
  'Carnival Coin',
  'CVL',
  'The house always wins. Hold the house.',
  venue,
  '0.9',
)
await mine()
await carnival.curve.write.buy([0n], { account: deployer.account, value: parseEther('0.4') })
await carnival.curve.write.buy([0n], { account: player.account, value: parseEther('0.1') })

console.log('\nSeeded', await factory.read.coinCount(), 'coins on', deployment.contracts.launchFactory)
