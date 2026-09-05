import { describe, expect, it } from 'vitest'
import { crossStreamSolutions } from './crossComposition'

/** Minimal axis entries; the Cross rule only reads positions, never contents. */
const axis = (prefix: string, length: number) =>
  Array.from({ length }, (_, index) => ({ id: `${prefix}${index}` }))

const pairIds = (
  pairs: readonly { bonus: { id: string }; skill: { id: string } }[],
) => pairs.map(({ bonus, skill }) => `${bonus.id},${skill.id}`)

describe('Cross rule composition (SEARCH_SPEC 5.5.4)', () => {
  it('produces |B| + |K| - 1 pairs, never |B| x |K|', () => {
    const pairs = crossStreamSolutions(axis('b', 4), axis('k', 5))

    expect(pairs).toHaveLength(4 + 5 - 1)
    expect(pairs).toHaveLength(8)
    expect(pairs.length).not.toBe(4 * 5)
  })

  it.each([
    [1, 1, 1],
    [1, 6, 6],
    [6, 1, 6],
    [3, 3, 5],
    [4, 5, 8],
    [10, 7, 16],
  ])('composes %i Bonus and %i Skill solutions into %i pairs', (
    bonusCount,
    skillCount,
    expected,
  ) => {
    expect(crossStreamSolutions(axis('b', bonusCount), axis('k', skillCount)))
      .toHaveLength(expected)
  })

  it('fixes the Skill anchor on the Bonus axis and the Bonus anchor on the Skill axis', () => {
    const pairs = crossStreamSolutions(axis('b', 3), axis('k', 3))

    expect(pairIds(pairs).sort()).toEqual([
      'b0,k0',
      'b0,k1',
      'b0,k2',
      'b1,k0',
      'b2,k0',
    ])
  })

  it('never produces an off-axis pair', () => {
    const ids = pairIds(crossStreamSolutions(axis('b', 3), axis('k', 3)))

    expect(ids).not.toContain('b1,k1')
    expect(ids).not.toContain('b1,k2')
    expect(ids).not.toContain('b2,k1')
    expect(ids).not.toContain('b2,k2')
  })

  it('emits the anchor pair exactly once', () => {
    const ids = pairIds(crossStreamSolutions(axis('b', 4), axis('k', 4)))

    expect(ids.filter((id) => id === 'b0,k0')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces nothing when either axis is empty', () => {
    expect(crossStreamSolutions([], axis('k', 3))).toEqual([])
    expect(crossStreamSolutions(axis('b', 3), [])).toEqual([])
    expect(crossStreamSolutions([], [])).toEqual([])
  })

  it('keeps the pair count linear in the axis lengths', () => {
    const linear = crossStreamSolutions(axis('b', 20), axis('k', 20)).length
    const quadratic = 20 * 20

    expect(linear).toBe(39)
    expect(linear).toBeLessThan(quadratic)
  })
})
