/**
 * End-to-end smoke against a running local node:
 *
 *   npx hardhat node
 *   npx hardhat run scripts/smoke-local.ts --network localhost
 *
 * Deploys the full stack, mints a batch of cold boards, draws until a tier
 * completes, declares it on the next draw (the one-draw window the contract
 * allows), then claims from the player's wallet and checks the balance delta
 * against the reservation. Exits non-zero on the first mismatch.
 *
 * Nothing secret is read: Hardhat's local node signs with its own unlocked
 * accounts, which only exist on chain 31337.
 */

import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { formatEther, parseEther } from 'viem'
import { deployLocalStack, TOKEN_PRICE_USD_8DP } from './local-stack'

const { viem } = await network.connect()
const stack = await deployLocalStack(viem)
const { game, vault, raffle, player } = stack
const playerAddress = player.account.address

/**
 * Six boards covering 1..90 exactly once. Every drawn number belongs to one
 * board, so after 25 draws some board holds at least five hits — the tier
 * completion is guaranteed, not left to luck.
 */
function boardsCoveringAll(): number[][] {
  const boards: number[][] = []
  for (let g = 0; g < 6; g++) {
    const numbers = Array.from({ length: 15 }, (_, i) => g * 15 + i + 1)
    const cells: number[] = []
    for (let row = 0; row < 3; row++) {
      cells.push(...numbers.slice(row * 5, row * 5 + 5), 0, 0, 0, 0)
    }
    boards.push(cells)
  }
  return boards
}

/** Mirrors GridLib.completedAt for winType 0 (EARLY_FIVE), 1-based draw. */
function earlyFiveAt(board: number[], drawn: number[]): number {
  const hits: number[] = []
  for (const n of board) {
    if (n === 0) continue
    const at = drawn.indexOf(n) + 1
    if (at > 0) hits.push(at)
  }
  if (hits.length < 5) return 0
  hits.sort((a, b) => a - b)
  return hits[4]
}

async function session() {
  const sessionId = await game.read.currentSessionId()
  const s = await game.read.getSession([sessionId])
  return { sessionId, drawCount: Number(s[1]), drawn: Array.from(s[4]) as number[] }
}

const draw = async (completions: { deviceId: bigint; winType: number }[] = []) =>
  game.write.drawNumber([completions])

console.log('\n=== RANSOME local smoke ===')
console.log('RAFFLE      ', raffle.address)
console.log('game        ', game.address)
console.log('vault       ', vault.address)
console.log('player      ', playerAddress)

const boards = boardsCoveringAll()
const ticketCost = (TOKEN_PRICE_USD_8DP * 10n ** 18n + TOKEN_PRICE_USD_8DP - 1n) / TOKEN_PRICE_USD_8DP
const totalCost = ticketCost * BigInt(boards.length)
console.log(
  `\nmint: ${boards.length} cold boards @ ${formatEther(ticketCost)} RAFFLE = ${formatEther(totalCost)} RAFFLE`
)

await raffle.write.transfer([playerAddress, parseEther('1000')])
await raffle.write.approve([game.address, totalCost], { account: player.account })
await game.write.mintWithXToken([boards.length, boards], { account: player.account })

const minted = await session()
const deviceIds = boards.map((_, i) => i)
console.log(
  `minted: session ${minted.sessionId}, ${boards.length} tickets, wall has ${minted.drawCount} numbers`
)

// Draw until a board's fifth hit, then declare it on the following draw.
let completedAt = 0
let winningBoard = -1
for (let i = 0; i < 30 && winningBoard < 0; i++) {
  await draw()
  const now = await session()
  for (let b = 0; b < boards.length; b++) {
    if (earlyFiveAt(boards[b], now.drawn) === now.drawCount) {
      completedAt = now.drawCount
      winningBoard = b
      break
    }
  }
}
assert.ok(winningBoard >= 0, 'no board reached five hits within 30 draws')

console.log(
  `\nEARLY_FIVE: board ${winningBoard} completed at draw ${completedAt}; declaring on draw ${completedAt + 1}`
)
await draw([{ deviceId: BigInt(deviceIds[winningBoard]), winType: 0 }])

const { sessionId, drawn } = await session()
const board = boards[winningBoard]

const reveal = await game.read.verifyReveal([
  sessionId,
  BigInt(deviceIds[winningBoard]),
  0,
  board,
])
console.log('verifyReveal:', {
  boardMatches: reveal[0],
  boardValid: reveal[1],
  completedAt: Number(reveal[2]),
  afterMint: reveal[3],
  timely: reveal[4],
})
assert.equal(reveal[0], true, 'revealed board matches the committed hash')
assert.equal(reveal[1], true, 'revealed board is a legal card')
assert.equal(reveal[3], true, 'the tier completed after the ticket was minted')
assert.equal(reveal[4], true, 'the declaration is inside the one-draw window')

const [reserved, alreadyClaimed, expired] = await game.read.claimableOf([
  sessionId,
  BigInt(deviceIds[winningBoard]),
  0,
])
assert.equal(alreadyClaimed, false)
assert.equal(expired, false)
assert.ok(reserved > 0n, 'the tier reserved a non-zero cut')
console.log(`reserved: ${formatEther(reserved)} RAFFLE (draws on the wall: ${drawn.length})`)

const before = await raffle.read.balanceOf([playerAddress])
const vaultBefore = await vault.read.prizePoolReserve()

await game.write.claimWin([sessionId, BigInt(deviceIds[winningBoard]), 0, board], {
  account: player.account,
})

const after = await raffle.read.balanceOf([playerAddress])
const vaultAfter = await vault.read.prizePoolReserve()

console.log(`\nclaim: player ${formatEther(before)} → ${formatEther(after)} RAFFLE`)
console.log(`vault reserve: ${formatEther(vaultBefore)} → ${formatEther(vaultAfter)} RAFFLE`)

assert.equal(after - before, reserved, 'balance delta equals the reserved cut')
assert.equal(vaultBefore - vaultAfter, reserved, 'the vault paid exactly what it reserved')
assert.equal(
  await game.read.claimableOf([sessionId, BigInt(deviceIds[winningBoard]), 0]).then((r) => r[1]),
  true,
  'the tier is marked claimed'
)

console.log('\nSMOKE PASS — cold mint → draw → RANSOM → balance delta verified on chain', await viem.getPublicClient().then((c) => c.getChainId()))
