/**
 * Close the loop between "the coin exists on Pons" and "the app is wired to it".
 *
 *   X_TOKEN_ADDRESS=0x… npx hardhat run scripts/inspect-coin.ts --network robinhood
 *
 * Reads the token, proves it came out of the Pons factory, and prints every value
 * a live deploy needs (paired WETH, pool, pool fee, price in WETH). Read-only: no
 * key, no transaction, nothing written.
 *
 * Unknowns it cannot invent: the USD price of the token (needs an ETH/USD oracle —
 * the app stores that as TOKEN_PRICE_USD_8DP) and the USDG address.
 */

import { network } from 'hardhat'
import { erc20Abi, formatEther, parseAbi } from 'viem'

const PONS_FACTORY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB'
const PONS_SWAP_ROUTER = '0xCaf681a66D020601342297493863E78C959E5cb2'

const launchedAbi = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount) launched)',
])
const tokenAbi = parseAbi([
  'function deployer() view returns (address)',
  'function liquidityPool() view returns (address)',
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
])

/** A failed precondition — printed without a stack trace, exit code 1. */
class CheckFailed extends Error {
  constructor(readonly lines: string[]) {
    super('inspect-coin check failed')
  }
}

async function main() {
  const { viem } = await network.connect()
  const publicClient = await viem.getPublicClient()
  const chainId = await publicClient.getChainId()

  const raw = process.env.X_TOKEN_ADDRESS?.trim()
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new CheckFailed(['Set X_TOKEN_ADDRESS to the token address pons gave you.'])
  }
  const token = raw as `0x${string}`

  console.log(`\nInspecting ${token} on chain ${chainId}\n`)

  const code = await publicClient.getCode({ address: token })
  if (!code || code === '0x') {
    throw new CheckFailed([`✗ No contract at ${token} on chain ${chainId}.`])
  }

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
  ])

  console.log(`${name} (${symbol}) · ${decimals} decimals · supply ${formatEther(totalSupply)}`)

  let launched
  try {
    launched = await publicClient.readContract({
      address: PONS_FACTORY,
      abi: launchedAbi,
      functionName: 'getLaunchedToken',
      args: [token],
    })
  } catch {
    throw new CheckFailed([
      '',
      '✗ The Pons factory does not know this token (no data at the active factory).',
      '  Either it launched elsewhere, or it is on the legacy factory (0x0c37…77a4).',
      '  The app works with any WETH-paired V3 token, but the fee-split assumptions differ.',
    ])
  }

  if (!launched.exists) {
    throw new CheckFailed(['', '✗ Factory returned exists=false — this is not a Pons launch token.', ''])
  }

  const pool = await publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: 'liquidityPool',
  })
  const { isToken0 } = launched

  console.log('✓ Pons launch confirmed')
  console.log(`  creator       ${launched.deployer}`)
  console.log(`  paired token  ${launched.pairedToken} (WETH)`)
  console.log(`  pool          ${pool}`)
  console.log(`  pool fee      ${launched.poolFee}`)
  console.log(`  token is      token${isToken0 ? '0' : '1'}`)
  console.log(`  restrictions  until block ${launched.restrictionsEndBlock}`)
  console.log(`  position      #${launched.positionId} via ${launched.positionManager}`)

  let priceInWeth = 0
  try {
    const [sqrtPriceX96] = await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: 'slot0',
    })
    const ratio = Number(sqrtPriceX96) / 2 ** 96
    const token1PerToken0 = ratio * ratio
    priceInWeth = isToken0 ? token1PerToken0 : 1 / token1PerToken0
    console.log(`  price         ${priceInWeth.toPrecision(6)} WETH per ${symbol}`)
  } catch {
    console.log('  price         unreadable (pool not initialised yet)')
  }

  const usdg = process.env.USDG_ADDRESS?.trim()

  console.log('\nRun the live deploy with:\n')
  console.log(
    [
      `X_TOKEN_ADDRESS=${token}`,
      `WETH_ADDRESS=${launched.pairedToken}`,
      `SWAP_ROUTER_ADDRESS=${PONS_SWAP_ROUTER}`,
      `POOL_FEE=${launched.poolFee}`,
      usdg ? `USDG_ADDRESS=${usdg}` : 'USDG_ADDRESS=<the chain’s stablecoin>',
      'DEPLOYER_PRIVATE_KEY=<your key, in your own shell>',
      'npx hardhat run scripts/deploy-live.ts --network robinhood',
    ].join(' \\\n  '),
  )

  console.log('\nAlso set TOKEN_PRICE_USD_8DP to the current USD price of one token × 1e8')
  console.log('(the app reads it on-chain to price tickets; it is not a fixed constant).')
  if (priceInWeth > 0) {
    console.log(`Hint: this pool prices one ${symbol} at ${priceInWeth.toPrecision(4)} WETH.`)
  }
  console.log('')
}

main().catch((error) => {
  if (error instanceof CheckFailed) {
    for (const line of error.lines) console.log(line)
    process.exitCode = 1
    return
  }
  throw error
})
