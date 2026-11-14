import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { network } from 'hardhat'

const { viem } = await network.connect()

const board = (rows: number[][]): number[] => rows.flat()

/** A legal ticket: 3 rows × 9 cells, five numbers per row, 1-90, unique. */
const LEGAL = board([
  [1, 2, 3, 4, 5, 0, 0, 0, 0],
  [6, 7, 8, 9, 10, 0, 0, 0, 0],
  [11, 12, 13, 14, 15, 0, 0, 0, 0],
])

/**
 * These are the rules `claimWin` runs on a revealed board. A real full house is
 * a ~1-in-1300 ticket (fifteen specific numbers inside fifty-nine draws), so
 * the contract path can never be exercised for the 40% rung by waiting for
 * draws — the pure rules are tested here instead, and `game.test.ts` proves the
 * wiring (hash, mint bound, window) with an EARLY_FIVE that actually completes.
 */
describe('GridLib — the tier rules claimWin enforces', () => {
  const harness = () => viem.deployContract('GridHarness', [])

  it('accepts a legal board and rejects every malformed one', async () => {
    const h = await harness()
    assert.equal(await h.read.validate([LEGAL]), true)

    const fourInARow = board([
      [1, 2, 3, 4, 0, 0, 0, 0, 0],
      [6, 7, 8, 9, 10, 0, 0, 0, 0],
      [11, 12, 13, 14, 15, 0, 0, 0, 0],
    ])
    assert.equal(await h.read.validate([fourInARow]), false, 'a row of four is not filled')

    const duplicate = board([
      [1, 2, 3, 4, 5, 0, 0, 0, 0],
      [5, 7, 8, 9, 10, 0, 0, 0, 0],
      [11, 12, 13, 14, 15, 0, 0, 0, 0],
    ])
    assert.equal(await h.read.validate([duplicate]), false, 'a number may not appear twice')

    const outOfRange = board([
      [1, 2, 3, 4, 91, 0, 0, 0, 0],
      [6, 7, 8, 9, 10, 0, 0, 0, 0],
      [11, 12, 13, 14, 15, 0, 0, 0, 0],
    ])
    assert.equal(await h.read.validate([outOfRange]), false, 'only 1-90 exist')

    const sixInARow = board([
      [1, 2, 3, 4, 5, 6, 0, 0, 0],
      [7, 8, 9, 10, 11, 0, 0, 0, 0],
      [12, 13, 14, 15, 16, 0, 0, 0, 0],
    ])
    assert.equal(await h.read.validate([sixInARow]), false, 'five per row, never six')
  })

  it('EARLY_FIVE is the fifth hit, wherever it lands', async () => {
    const h = await harness()
    assert.equal(await h.read.completedAt([LEGAL, [1, 2, 3, 4], 0]), 0, 'four hits is not five')
    assert.equal(await h.read.completedAt([LEGAL, [1, 2, 3, 4, 5], 0]), 5)

    // A hit from another row can be the fifth — the tier counts hits, not rows.
    assert.equal(await h.read.completedAt([LEGAL, [15, 1, 2, 3, 4], 0]), 5)
    // Later hits do not move the answer: it stays the first moment it was true.
    assert.equal(await h.read.completedAt([LEGAL, [15, 14, 1, 2, 3, 4], 0]), 5)
  })

  it('a line needs all five of its own numbers', async () => {
    const h = await harness()
    // Top row finishes on the seventh draw.
    assert.equal(await h.read.completedAt([LEGAL, [6, 7, 1, 2, 3, 4, 5], 1]), 7)
    // Middle row is untouched by that set.
    assert.equal(await h.read.completedAt([LEGAL, [6, 7, 1, 2, 3, 4, 5], 2]), 0)
    // Middle row finishes when its last number lands.
    assert.equal(await h.read.completedAt([LEGAL, [6, 7, 8, 9, 10, 1, 2, 3, 4, 5], 2]), 5)
    // Bottom row.
    assert.equal(await h.read.completedAt([LEGAL, [11, 12, 13, 14, 15], 3]), 5)
  })

  it('a full house is the last of the fifteen to arrive', async () => {
    const h = await harness()
    const fourteen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    assert.equal(await h.read.completedAt([LEGAL, fourteen, 4]), 0, 'fourteen of fifteen is nothing')
    assert.equal(await h.read.completedAt([LEGAL, [...fourteen, 15], 6]), 15)
    // All three rungs share the pattern; only the ladder decides FH1/2/3.
    assert.equal(await h.read.completedAt([LEGAL, [...fourteen, 15], 5]), 15)
    assert.equal(await h.read.completedAt([LEGAL, [...fourteen, 15], 4]), 15)
  })

  it('uses the first appearance of a number, not a later repeat', async () => {
    const h = await harness()
    const drawn = [1, 2, 3, 4, 5]
    for (let i = 0; i < 15; i++) drawn.push(5)
    assert.equal(
      await h.read.completedAt([LEGAL, drawn, 1]),
      5,
      'the top line completed when 5 first appeared',
    )
  })
})
