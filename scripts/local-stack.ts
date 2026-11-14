/**
 * One deployment of the full RANSOME stack, shared by the local deploy script
 * and the end-to-end harness test so the two can never drift apart.
 *
 * Money path (deepseek §6.12):
 *   RAFFLE (ERC20) ─ mint ─▶ RansomeVault (99% prize / 1% treasury)
 *   WETH ─ FeeCollector.accrue ─ flush ─▶ JackpotRouter ─▶ vault (skim-free)
 *
 * Test doubles only: TestXToken is the RAFFLE token (it has the public faucet
 * the dev UI calls), MockPonsRouter fakes the stablecoin rail, MockWETH and
 * MockSwapRouter fake the fee flush. Nothing here belongs on a live chain.
 */

import { readFileSync } from 'node:fs'
import { concatHex, encodeDeployData, keccak256, parseEther, toHex } from 'viem'

const poolManagerArtifact = JSON.parse(
  readFileSync('node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json', 'utf8'),
)
const hookArtifact = JSON.parse(
  readFileSync('artifacts/contracts/LaunchFeeHook.sol/LaunchFeeHook.json', 'utf8'),
)

/** The hook must sit at an address whose low 14 bits are 0xCC (v4 reads hook
 *  permissions from the address): beforeSwap | afterSwap | both return deltas. */
const HOOK_FLAGS = 0xccn
const FLAG_MASK = 0x3fffn

/** $0.50 per token, 8 dp — makes one ticket exactly 1 RAFFLE. */
export const TOKEN_PRICE_USD_8DP = 50_000_000n
/** RAFFLE per 1 WETH in the stub fee pool. */
export const WETH_TO_RAFFLE_RATE = parseEther('1000')
/** WETH that must accrue before FeeCollector.flush() will run. */
export const FLUSH_THRESHOLD = parseEther('0.01')

export async function deployLocalStack(viem: any) {
  const [deployer, player, venue] = await viem.getWalletClients()
  const admin = deployer.account.address

  // Core token: the app's dev faucet mints 5,000 RAFFLE per call.
  const raffle = await viem.deployContract('TestXToken')
  const weth = await viem.deployContract('MockWETH')

  // Stablecoin rail (6 dp, public mint for tests).
  const usdg = await viem.deployContract('MockERC20', ['USDG', 'USDG', 6])
  const usdc = await viem.deployContract('MockERC20', ['USDC', 'USDC', 6])
  const usdt = await viem.deployContract('MockERC20', ['USDT', 'USDT', 6])

  const vault = await viem.deployContract('RansomeVault', [raffle.address, admin])
  const lockVault = await viem.deployContract('XLockVault', [raffle.address, parseEther('1000')])
  const ponsRouter = await viem.deployContract('MockPonsRouter', [raffle.address])

  const game = await viem.deployContract('RansomeGame', [
    raffle.address,
    usdg.address,
    usdt.address,
    usdc.address,
    lockVault.address,
    vault.address,
    ponsRouter.address,
    admin,
  ])
  await vault.write.setGameContract([game.address])

  const jackpotRouter = await viem.deployContract('JackpotRouter', [raffle.address, vault.address])
  await vault.write.setJackpotRouter([jackpotRouter.address])

  // Fee side: WETH accrues, one flush swaps it into RAFFLE and injects it.
  const swapRouter = await viem.deployContract('MockSwapRouter', [
    weth.address,
    raffle.address,
    WETH_TO_RAFFLE_RATE,
  ])
  // The stub pool must already hold the RAFFLE it pays out.
  await raffle.write.transfer([swapRouter.address, parseEther('5000')])

  const feeCollector = await viem.deployContract('FeeCollector', [
    weth.address,
    raffle.address,
    swapRouter.address,
    jackpotRouter.address,
    10000,
    FLUSH_THRESHOLD,
  ])

  // R2: a real Uniswap v4 PoolManager (shipped Foundry artifact), the fee hook
  // at a mined CREATE2 address, the graduator that opens the pool, and the
  // router the storefront calls. PoolManager needs transient storage, so the
  // local node must be a Cancun+ build (current Hardhat node is).
  const publicClient = await viem.getPublicClient()
  const poolManagerHash = await deployer.deployContract({
    abi: poolManagerArtifact.abi,
    bytecode: poolManagerArtifact.bytecode.object as `0x${string}`,
    args: [admin],
  })
  const poolManagerReceipt = await publicClient.waitForTransactionReceipt({ hash: poolManagerHash })
  const poolManagerAddress = poolManagerReceipt.contractAddress!

  const hookInitCode = encodeDeployData({
    abi: hookArtifact.abi,
    bytecode: hookArtifact.bytecode as `0x${string}`,
    args: [poolManagerAddress, admin],
  })
  const hookDeployer = await viem.deployContract('HookDeployer')
  const initCodeHash = keccak256(hookInitCode)
  const create2Address = (salt: `0x${string}`) =>
    ('0x' + keccak256(concatHex(['0xff', hookDeployer.address, salt, initCodeHash])).slice(-40)) as `0x${string}`

  let hookSalt = 0n
  let hookAddress = '' as `0x${string}` | ''
  for (; hookSalt < 500_000n; hookSalt++) {
    const candidate = create2Address(toHex(hookSalt, { size: 32 }))
    if ((BigInt(candidate) & FLAG_MASK) === HOOK_FLAGS) {
      hookAddress = candidate
      break
    }
  }
  if (!hookAddress) throw new Error('could not mine a 0xCC hook address')
  await hookDeployer.write.deploy([hookInitCode, toHex(hookSalt, { size: 32 })])
  const launchHook = await viem.getContractAt('LaunchFeeHook', hookAddress)

  const launchGraduator = await viem.deployContract('LaunchGraduator', [
    poolManagerAddress,
    hookAddress,
    admin,
  ])
  const launchRouter = await viem.deployContract('LaunchSwapRouter', [poolManagerAddress])

  // P1 launchpad: the factory owns the fee config for every curve it creates.
  // Treasury here is the deployer (launch fees), the jackpot path is the same
  // FeeCollector used by the rest of the stack. R2 fixes the graduator at
  // construction so no caller can choose where a coin graduates.
  const launchFactory = await viem.deployContract('LaunchFactory', [
    admin,
    feeCollector.address,
    launchGraduator.address,
  ])
  await launchGraduator.write.setFactory([launchFactory.address])
  await launchHook.write.setRegistrar([launchGraduator.address])
  await launchHook.write.lockRegistrar()

  // USD-denominated tickets: $0.50 / $0.50-per-token = 1 RAFFLE.
  await game.write.setTokenPriceInUsd([TOKEN_PRICE_USD_8DP])

  return {
    deployer,
    player,
    venue,
    raffle,
    weth,
    usdg,
    usdc,
    usdt,
    vault,
    lockVault,
    game,
    jackpotRouter,
    swapRouter,
    feeCollector,
    ponsRouter,
    launchFactory,
    poolManager: poolManagerAddress as `0x${string}`,
    launchHook,
    launchGraduator,
    launchRouter,
  }
}

export type LocalStack = Awaited<ReturnType<typeof deployLocalStack>>
