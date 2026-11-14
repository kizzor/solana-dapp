import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'
import { parseEther, zeroAddress, zeroHash } from 'viem'

const { viem } = await network.connect()

// $0.50 / 50_000_000 = 1 token per ticket, so ticket maths stays trivial.
const ONE_TOKEN_PER_TICKET = 50_000_000n

/**
 * A ticket board is 27 cells, row-major, 0 = empty: exactly five numbers per
 * row, fifteen unique numbers in 1-90. This is the same array the cabinet sends
 * at mint (`grid.map(r => r.map(c => c.num ?? 0)).flat()`).
 *
 * The mint takes the CELLS, not a hash: the contract validates them, refuses a
 * card holding a number that is already on the wall, and refuses a second copy
 * of the same card in the round. Every board below therefore has to be cold
 * and unique — which is the point of the rules, not a limitation of the tests.
 */
type Board = number[]

const board = (rows: number[][]): Board => rows.flat()

/** A legal card bought at draw 0, when the wall is empty: cold by construction. */
const EARLY_BOARD = board([
  [1, 11, 21, 31, 41, 0, 0, 0, 0],
  [2, 12, 22, 32, 42, 0, 0, 0, 0],
  [3, 13, 23, 33, 43, 0, 0, 0, 0],
])

/**
 * The same fifteen numbers in a different arrangement: a DIFFERENT board hash
 * but an identical hit count at every draw, which is the only way left to
 * produce a genuine same-draw tie now that a duplicate card is refused.
 */
const MIRROR_BOARD = board([
  [2, 12, 22, 32, 42, 0, 0, 0, 0],
  [3, 13, 23, 33, 43, 0, 0, 0, 0],
  [1, 11, 21, 31, 41, 0, 0, 0, 0],
])

/**
 * Deploys the whole game stack:
 *   RAFFLE (MockERC20) · RansomeVault · XLockVault · RansomeGame · JackpotRouter
 * The authority is the owner wallet, so it can draw.
 */
async function deployGame() {
  const [owner, alice, bob, carol] = await viem.getWalletClients()

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
    zeroAddress, // no swap router needed: the token rail is direct
    owner.account.address,
  ])
  await vault.write.setGameContract([game.address])

  const jackpot = await viem.deployContract('JackpotRouter', [heist.address, vault.address])
  await vault.write.setJackpotRouter([jackpot.address])

  await game.write.setTokenPriceInUsd([ONE_TOKEN_PER_TICKET])

  return { owner, alice, bob, carol, heist, vault, game, jackpot }
}

type Ctx = Awaited<ReturnType<typeof deployGame>>

/** Mints one ticket per board and returns the on-chain device ids, in order. */
async function mintBoards(ctx: Ctx, player: any, boards: Board[]): Promise<number[]> {
  const sessionId = await ctx.game.read.currentSessionId()
  const start = Number(await ctx.game.read.sessionDeviceCount([sessionId]))
  const cost = parseEther(String(boards.length)) // 1 token per ticket at the price set above
  await ctx.heist.write.mint([player.account.address, cost])
  await ctx.heist.write.approve([ctx.game.address, cost], { account: player.account })
  await ctx.game.write.mintWithXToken([boards.length, boards], {
    account: player.account,
  })
  return boards.map((_, i) => start + i)
}

/** Funds the pot the honest way — a jackpot injection carries no treasury skim. */
async function seedPot(ctx: Ctx, amount: bigint) {
  await ctx.heist.write.mint([ctx.owner.account.address, amount])
  await ctx.heist.write.approve([ctx.jackpot.address, amount])
  await ctx.jackpot.write.injectJackpot([amount, zeroHash])
}

const claim = (deviceId: number, winType: number) => ({ deviceId: BigInt(deviceId), winType })

async function draw(ctx: Ctx, completions: { deviceId: bigint; winType: number }[] = []) {
  await ctx.game.write.drawNumber([completions])
}

/** The session and its numbers in draw order. */
async function drawn(ctx: Ctx) {
  const sessionId = await ctx.game.read.currentSessionId()
  const s = await ctx.game.read.getSession([sessionId])
  return { sessionId, numbers: Array.from(s[4]) as number[] }
}

/**
 * Mints the cold standard card at draw 0 and hands it back ready to be drawn
 * for. Fifteen numbers means the fifth hit lands around draw 30 on average and
 * sooner as the wall thins, so a miss across 55 draws is rare.
 */
async function mintEarlyBoard(ctx: Ctx, player: any): Promise<{ cells: Board; deviceId: number }> {
  const [deviceId] = await mintBoards(ctx, player, [EARLY_BOARD])
  return { cells: EARLY_BOARD, deviceId }
}

/**
 * Draws until the board's fifth hit lands, then declares EARLY_FIVE on the very
 * next draw — the one-draw window the contract allows. Returns the draw count
 * at which the tier completed.
 */
async function drawUntilCompleted(
  ctx: Ctx,
  deviceIds: number[],
  cells: Board,
  winType = 0,
): Promise<number> {
  const onBoard = new Set(cells.filter(n => n !== 0))
  for (let i = 0; i < 55; i++) {
    await draw(ctx)
    const { numbers } = await drawn(ctx)
    if (numbers.filter(n => onBoard.has(n)).length >= 5) {
      await draw(ctx, deviceIds.map(id => claim(id, winType)))
      return numbers.length
    }
  }
  throw new Error('board never reached five hits in 55 draws')
}

describe('RansomeGame — win allocation and the live claim window', () => {
  it('pays the whole bucket to a winner whose board proves the tier', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))
    const { cells, deviceId } = await mintEarlyBoard(ctx, ctx.alice)
    await drawUntilCompleted(ctx, [deviceId], cells)

    const { sessionId } = await drawn(ctx)
    const pot = await ctx.vault.read.prizePoolReserve()
    const bucket = (pot * 500n) / 10000n // 5% of the pot, the EARLY_FIVE bucket

    const [reserved] = await ctx.game.read.claimableOf([sessionId, BigInt(deviceId), 0])
    assert.equal(reserved, bucket, 'the whole bucket is reserved for a solo winner')

    await ctx.game.write.claimWin([sessionId, BigInt(deviceId), 0, cells], {
      account: ctx.alice.account,
    })

    // She minted exactly the 1 token the ticket cost, so the claim is her
    // whole balance now.
    assert.equal(await ctx.heist.read.balanceOf([ctx.alice.account.address]), bucket)
  })

  it('splits the bucket evenly between boards that land the tier on the same draw', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))

    // Two cards holding the SAME fifteen numbers in a different arrangement:
    // different hashes (so the duplicate rule allows both) but an identical
    // hit count at every draw, which is the only way left to produce a tie.
    const ids = await mintBoards(ctx, ctx.alice, [EARLY_BOARD, MIRROR_BOARD])
    await drawUntilCompleted(ctx, ids, EARLY_BOARD)

    const { sessionId } = await drawn(ctx)
    const pot = await ctx.vault.read.prizePoolReserve()
    const shared = ((pot * 500n) / 10000n) / 2n

    const [a] = await ctx.game.read.claimableOf([sessionId, BigInt(ids[0]), 0])
    const [b] = await ctx.game.read.claimableOf([sessionId, BigInt(ids[1]), 0])
    assert.equal(a, shared)
    assert.equal(b, shared)
    assert.equal(a + b, (pot * 500n) / 10000n, 'the bucket is fully divided, never overpaid')
  })

  it('returns an unclaimed cut to the pot at the next draw, and the claim then reverts', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [
      board([
        [1, 2, 3, 4, 5, 0, 0, 0, 0],
        [6, 7, 8, 9, 10, 0, 0, 0, 0],
        [11, 12, 13, 14, 15, 0, 0, 0, 0],
      ]),
    ])
    await seedPot(ctx, parseEther('10000'))

    const pot = await ctx.vault.read.prizePoolReserve()
    const expected = (pot * 500n) / 10000n

    await draw(ctx, [claim(0, 1)]) // declared; nothing has to be proven to reserve
    assert.equal(await ctx.game.read.availablePot(), pot - expected, 'the cut is reserved')

    // The window closes before the next number is displayed.
    await draw(ctx)

    assert.equal(await ctx.vault.read.prizePoolReserve(), pot, 'nothing left the vault')
    assert.equal(await ctx.game.read.sessionAllocated([1n]), 0n, 'the reservation was released')
    assert.equal(await ctx.game.read.availablePot(), pot, 'and the whole pot is winnable again')

    await assert.rejects(
      ctx.game.write.claimWin([1n, 0n, 1, new Array(27).fill(0)], { account: ctx.alice.account }),
      /claim window closed/,
    )
  })

  it('a proven claim leaves the grid alive, and the same grid can still be closed by a full house', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))
    const { cells, deviceId } = await mintEarlyBoard(ctx, ctx.alice)
    await drawUntilCompleted(ctx, [deviceId], cells)

    let { sessionId } = await drawn(ctx)
    await ctx.game.write.claimWin([sessionId, BigInt(deviceId), 0, cells], {
      account: ctx.alice.account,
    })
    assert.equal(await ctx.game.read.gridClosed([sessionId, BigInt(deviceId)]), false,
      'claiming a proved win does not drop the raffle')

    // A full house is a separate, terminal reservation on the same grid.
    await draw(ctx, [claim(deviceId, 4)])
    assert.equal(await ctx.game.read.gridClosed([sessionId, BigInt(deviceId)]), true)
    assert.equal(await ctx.game.read.fullHouses([ctx.alice.account.address]), 1)
    const [, claimed, expired] = await ctx.game.read.claimableOf([sessionId, BigInt(deviceId), 4])
    assert.equal(claimed, false)
    assert.equal(expired, false, 'the full house is a second, separate reservation')
  })

  it('a full house closes the grid — no further tier of any kind', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [
      board([
        [1, 2, 3, 4, 5, 0, 0, 0, 0],
        [6, 7, 8, 9, 10, 0, 0, 0, 0],
        [11, 12, 13, 14, 15, 0, 0, 0, 0],
      ]),
    ])
    await seedPot(ctx, parseEther('10000'))

    await draw(ctx, [claim(0, 4)])
    await assert.rejects(draw(ctx, [claim(0, 2)]), /grid is closed/)
  })

  it('locks the full-house rung in completion order: a second grid is FH2, not FH1', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [
      board([
        [1, 2, 3, 4, 5, 0, 0, 0, 0],
        [6, 7, 8, 9, 10, 0, 0, 0, 0],
        [11, 12, 13, 14, 15, 0, 0, 0, 0],
      ]),
      board([
        [16, 17, 18, 19, 20, 0, 0, 0, 0],
        [21, 22, 23, 24, 25, 0, 0, 0, 0],
        [26, 27, 28, 29, 30, 0, 0, 0, 0],
      ]),
    ])
    await seedPot(ctx, parseEther('10000'))

    const pot = await ctx.vault.read.prizePoolReserve()
    await draw(ctx, [claim(0, 4), claim(1, 4)])

    const [first] = await ctx.game.read.claimableOf([1n, 0n, 4]) // FH1
    const [second] = await ctx.game.read.claimableOf([1n, 1n, 5]) // FH2
    assert.equal(first, (pot * 1950n) / 10000n, 'first grid takes the FH1 bucket')
    assert.equal(second, (pot * 1950n) / 10000n, 'second grid takes the FH2 bucket')
    assert.equal(await ctx.game.read.fullHouses([ctx.alice.account.address]), 2)
    assert.equal(await ctx.game.read.fullHouses([ctx.bob.account.address]), 0)
  })

  it('sizes a later bucket against what an earlier claim actually removed', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('1000'))
    const { cells, deviceId } = await mintEarlyBoard(ctx, ctx.alice)
    await drawUntilCompleted(ctx, [deviceId], cells)

    const { sessionId } = await drawn(ctx)
    const pot = await ctx.vault.read.prizePoolReserve()
    const earlyBucket = (pot * 500n) / 10000n

    await ctx.game.write.claimWin([sessionId, BigInt(deviceId), 0, cells], {
      account: ctx.alice.account,
    })
    assert.equal(
      await ctx.vault.read.prizePoolReserve(),
      pot - earlyBucket,
      'a claim is the only thing that takes money out of the pot',
    )

    // The next tier is sized against what is actually left, not the old pot.
    await draw(ctx, [claim(deviceId, 1)]) // a line, declared only to size it
    const [line] = await ctx.game.read.claimableOf([sessionId, BigInt(deviceId), 1])
    assert.equal(line, ((pot - earlyBucket) * 500n) / 10000n)
    assert.ok(line <= (await ctx.game.read.availablePot()), 'never reserves more than exists')
  })

  it('restarts the ladder at FH1 on the fourth full house', async () => {
    const ctx = await deployGame()
    const boards = [0, 1, 2, 3].map(i =>
      board([
        [i * 20 + 1, i * 20 + 2, i * 20 + 3, i * 20 + 4, i * 20 + 5, 0, 0, 0, 0],
        [i * 20 + 6, i * 20 + 7, i * 20 + 8, i * 20 + 9, i * 20 + 10, 0, 0, 0, 0],
        [i * 20 + 11, i * 20 + 12, i * 20 + 13, i * 20 + 14, i * 20 + 15, 0, 0, 0, 0],
      ]),
    )
    await mintBoards(ctx, ctx.alice, boards) // one grid per full house — each is terminal
    await seedPot(ctx, parseEther('10000'))

    for (let i = 0; i < 3; i++) await draw(ctx, [claim(i, 4)])
    await draw(ctx, [claim(3, 4)])

    const [fourth] = await ctx.game.read.claimableOf([1n, 3n, 4])
    assert.ok(fourth > 0n, 'the 4th full house pays FH1 again')
    assert.equal(await ctx.game.read.fullHouses([ctx.alice.account.address]), 4)
  })

  it('seals the round at draw 59 and carries the whole pot into the next one', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [
      board([
        [1, 2, 3, 4, 5, 0, 0, 0, 0],
        [6, 7, 8, 9, 10, 0, 0, 0, 0],
        [11, 12, 13, 14, 15, 0, 0, 0, 0],
      ]),
    ])
    await seedPot(ctx, parseEther('10000'))

    const sessionId = await ctx.game.read.currentSessionId()
    for (let n = 1; n <= 58; n++) await draw(ctx)
    const potBeforeSeal = await ctx.vault.read.prizePoolReserve()

    await draw(ctx, [claim(0, 1)])
    const [reserved] = await ctx.game.read.claimableOf([sessionId, 0n, 1])
    assert.ok(reserved > 0n)

    assert.equal(
      await ctx.vault.read.prizePoolReserve(),
      potBeforeSeal,
      'the seal moves nothing: there is no treasury sweep',
    )
    assert.equal(await ctx.game.read.isRoundSettled([sessionId]), true)
    assert.equal(await ctx.game.read.currentSessionId(), sessionId + 1n, 'the round rolled')

    // The draw-59 reservation keeps one inter-draw window, then returns to the
    // pot — the first draw of the new round releases it.
    const newSessionId = await ctx.game.read.currentSessionId()
    await draw(ctx)
    assert.equal(await ctx.vault.read.prizePoolReserve(), potBeforeSeal, 'still nothing left')
    assert.equal(
      await ctx.game.read.availablePot(),
      potBeforeSeal,
      'the whole pot is winnable in the new round',
    )
    await assert.rejects(
      ctx.game.write.claimWin([sessionId, 0n, 1, new Array(27).fill(0)], { account: ctx.alice.account }),
      /claim window closed/,
    )
    assert.ok(newSessionId > sessionId)
  })

  it('only the owner of an allocation can claim it', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [
      board([
        [1, 2, 3, 4, 5, 0, 0, 0, 0],
        [6, 7, 8, 9, 10, 0, 0, 0, 0],
        [11, 12, 13, 14, 15, 0, 0, 0, 0],
      ]),
    ])
    await seedPot(ctx, parseEther('10000'))

    await draw(ctx, [claim(0, 1)])
    const cells = board([
      [1, 2, 3, 4, 5, 0, 0, 0, 0],
      [6, 7, 8, 9, 10, 0, 0, 0, 0],
      [11, 12, 13, 14, 15, 0, 0, 0, 0],
    ])
    await assert.rejects(
      ctx.game.write.claimWin([1n, 0n, 1, cells], { account: ctx.bob.account }),
      /not your win/,
    )
    await assert.rejects(
      ctx.game.write.claimWin([1n, 0n, 2, cells], { account: ctx.alice.account }),
      /nothing to claim/,
    )
  })

  it('nobody but the authority can draw, and a duplicate declaration is rejected', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [
      board([
        [1, 2, 3, 4, 5, 0, 0, 0, 0],
        [6, 7, 8, 9, 10, 0, 0, 0, 0],
        [11, 12, 13, 14, 15, 0, 0, 0, 0],
      ]),
    ])

    await assert.rejects(
      ctx.game.write.drawNumber([[]], { account: ctx.alice.account }),
      /not authority/,
    )

    await seedPot(ctx, parseEther('10000'))
    await draw(ctx, [claim(0, 1)])
    await assert.rejects(draw(ctx, [claim(0, 1)]), /tier already allocated/)
  })

  it('refuses to pay a tier the board never completed', async () => {
    const ctx = await deployGame()
    const cells = board([
      [1, 2, 3, 4, 5, 0, 0, 0, 0],
      [6, 7, 8, 9, 10, 0, 0, 0, 0],
      [11, 12, 13, 14, 15, 0, 0, 0, 0],
    ])
    const [deviceId] = await mintBoards(ctx, ctx.alice, [cells])
    await seedPot(ctx, parseEther('10000'))

    // The authority declares a full house for a board where nothing matched.
    await draw(ctx, [claim(deviceId, 4)])
    const [reserved] = await ctx.game.read.claimableOf([1n, BigInt(deviceId), 4])
    assert.ok(reserved > 0n, 'the reservation exists…')

    await assert.rejects(
      ctx.game.write.claimWin([1n, BigInt(deviceId), 4, cells], { account: ctx.alice.account }),
      /never completed/,
    )
    assert.equal(await ctx.game.read.gridClosed([1n, BigInt(deviceId)]), true,
      '…but the fabricated tier still closed the grid, so it can never be re-declared')
  })

  it('refuses a claim whose revealed board is not the minted one', async () => {
    const ctx = await deployGame()
    const cells = board([
      [1, 2, 3, 4, 5, 0, 0, 0, 0],
      [6, 7, 8, 9, 10, 0, 0, 0, 0],
      [11, 12, 13, 14, 15, 0, 0, 0, 0],
    ])
    const [deviceId] = await mintBoards(ctx, ctx.alice, [cells])
    await seedPot(ctx, parseEther('10000'))
    await draw(ctx, [claim(deviceId, 0)])

    const impostor = board([
      [16, 17, 18, 19, 20, 0, 0, 0, 0],
      [21, 22, 23, 24, 25, 0, 0, 0, 0],
      [26, 27, 28, 29, 30, 0, 0, 0, 0],
    ])
    await assert.rejects(
      ctx.game.write.claimWin([1n, BigInt(deviceId), 0, impostor], { account: ctx.alice.account }),
      /does not match the ticket/,
    )
  })

  it('refuses at MINT a board holding a number that is already on the wall', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))

    // The sniping recipe: wait, then buy a card built out of numbers that are
    // already out. It can no longer become a ticket at all.
    for (let i = 0; i < 6; i++) await draw(ctx)
    const { numbers } = await drawn(ctx)
    const taken = new Set(numbers)
    const free: number[] = []
    for (let n = 1; n <= 90 && free.length < 10; n++) if (!taken.has(n)) free.push(n)
    const cells = board([
      [numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], 0, 0, 0, 0],
      [free[0], free[1], free[2], free[3], free[4], 0, 0, 0, 0],
      [free[5], free[6], free[7], free[8], free[9], 0, 0, 0, 0],
    ])

    await assert.rejects(
      mintBoards(ctx, ctx.alice, [cells]),
      /board has a drawn number/,
    )
  })

  it('refuses a second copy of a board already minted this round (the clone)', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))

    // A revealed board is public calldata. Before this rule anyone could
    // re-mint a nearly finished card — even one already claimed — and ride it
    // to its next tier, or stack the full-house ladder with ten copies.
    await mintBoards(ctx, ctx.alice, [EARLY_BOARD])
    await assert.rejects(
      mintBoards(ctx, ctx.bob, [EARLY_BOARD]),
      /board already minted/,
    )
  })

  it('refuses a malformed board: wrong shape or a repeated number', async () => {
    const ctx = await deployGame()

    // Four numbers in the top row: not a card.
    const short = board([
      [1, 11, 21, 31, 0, 0, 0, 0, 0],
      [2, 12, 22, 32, 42, 0, 0, 0, 0],
      [3, 13, 23, 33, 43, 44, 0, 0, 0],
    ])
    await assert.rejects(mintBoards(ctx, ctx.alice, [short]), /malformed board/)

    // The same number twice: not a card either.
    const repeated = board([
      [1, 11, 21, 31, 41, 0, 0, 0, 0],
      [1, 12, 22, 32, 42, 0, 0, 0, 0],
      [3, 13, 23, 33, 43, 0, 0, 0, 0],
    ])
    await assert.rejects(mintBoards(ctx, ctx.alice, [repeated]), /malformed board/)
  })

  it('lets the same card be bought again once the round has rolled', async () => {
    const ctx = await deployGame()
    await mintBoards(ctx, ctx.alice, [EARLY_BOARD])

    const firstSession = await ctx.game.read.currentSessionId()
    for (let n = 0; n < 59; n++) await draw(ctx)
    const nextSession = await ctx.game.read.currentSessionId()
    assert.equal(nextSession, firstSession + 1n, 'the round rolled')

    // A wiped wall means the old card is cold and unique again.
    await mintBoards(ctx, ctx.alice, [EARLY_BOARD])
    assert.equal(await ctx.game.read.sessionDeviceCount([nextSession]), 1n)
  })

  it('refuses a win declared more than one draw after it completed', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))
    const { cells, deviceId } = await mintEarlyBoard(ctx, ctx.alice)

    // Find the completing draw, then let one whole draw go by before saying so.
    const onBoard = new Set(cells.filter(n => n !== 0))
    let completedAt = 0
    for (let i = 0; i < 55 && completedAt === 0; i++) {
      await draw(ctx)
      const { numbers } = await drawn(ctx)
      if (numbers.filter(n => onBoard.has(n)).length >= 5) completedAt = numbers.length
    }
    assert.ok(completedAt > 0, 'the fixture board completed')

    await draw(ctx) // the window the authority is allowed
    await draw(ctx, [claim(deviceId, 0)]) // …and one draw too late

    const { sessionId } = await drawn(ctx)
    await assert.rejects(
      ctx.game.write.claimWin([sessionId, BigInt(deviceId), 0, cells], { account: ctx.alice.account }),
      /declared too late/,
    )
  })

  it('derives the ball from on-chain entropy, so the drawer cannot choose it', async () => {
    const ctx = await deployGame()
    await seedPot(ctx, parseEther('10000'))

    /** Mirrors _pickUndrawn: the r-th undrawn number, r = seed mod remaining. */
    const pickUndrawn = (seed: `0x${string}`, drawnSoFar: number[]) => {
      const remaining = 90 - drawnSoFar.length
      let target = Number(BigInt(seed) % BigInt(remaining))
      for (let n = 1; n <= 90; n++) {
        if (drawnSoFar.includes(n)) continue
        if (target === 0) return n
        target--
      }
      throw new Error('no numbers left')
    }

    const sessionId = await ctx.game.read.currentSessionId()

    await draw(ctx)
    const seed0 = await ctx.game.read.drawSeeds([sessionId, 0])
    assert.notEqual(seed0, zeroHash, 'the draw stores a real seed, not an empty one')

    const first = pickUndrawn(seed0, [])
    assert.equal(
      await ctx.game.read.isNumberDrawn([sessionId, first]),
      true,
      'the first ball is exactly the one the seed dictates',
    )

    await draw(ctx)
    const seed1 = await ctx.game.read.drawSeeds([sessionId, 1])
    assert.notEqual(seed1, seed0, 'the seed advances on every draw')

    const second = pickUndrawn(seed1, [first])
    assert.equal(
      await ctx.game.read.isNumberDrawn([sessionId, second]),
      true,
      'the second ball is reproducible from its own seed and the drawn set',
    )
    assert.notEqual(second, first, 'and a drawn number never comes back')
  })
})
