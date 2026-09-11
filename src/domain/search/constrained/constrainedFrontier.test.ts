import { describe, expect, it } from 'vitest'
import {
  ConstrainedWorkFrontier,
  compareConstrainedWorkItems,
  constrainedPairKey,
  constrainedWorkSemanticKey,
  createConstrainedWorkPriority,
  type ConstrainedWorkItem,
} from './constrainedFrontier'
import {
  compareBonusSolutions,
  compareSkillSolutions,
  type EvaluatedBonusSolution,
  type EvaluatedSkillSolution,
} from '../streamSolutions'
import { compareStableKeys } from '../semanticKeys'
import type { RestorationBonusScope } from '../../models/publicTypes'
import { stableStringify } from '../../models/publicTypes'
import { practicalBonuses } from '../../../test/fixtures/constrainedEnumeration'

const BASE = { baseKey: 'base', operationUnits: 0, normalAdvance: null, preferredSourceRank: 0 }

interface BonusSpec {
  gogmaAdvance: number
  matchedIdealBonusCount?: number
  materialQuantity?: number
  bonusKey?: string
  operationTypeKey?: string
  scope?: RestorationBonusScope
}

/**
 * One evaluated Bonus solution with every canonical ordering field controllable.
 *
 * `retentionKey` is built the way the real stream builds it - scope first, then
 * the completed multiset - because that is what the pre-fix work comparator
 * fell through to.
 */
function bonusSolution(spec: BonusSpec): EvaluatedBonusSolution {
  const scope = spec.scope ?? 'gogma_artian'
  const bonusKey = spec.bonusKey ?? `bonus:${spec.gogmaAdvance}`
  return {
    index: 0,
    solution: {
      gogmaAdvance: spec.gogmaAdvance,
      lastResetDepth: spec.gogmaAdvance,
      finalBonuses: practicalBonuses(),
      restorationBonusScope: scope,
      operations: Array.from({ length: spec.gogmaAdvance }, () => ({
        type: 'reset_bonuses' as const,
        sourceOwnedWeaponId: null,
        gogmaCounterBefore: 0,
        gogmaCounterAfter: 1,
      })),
      amendmentResults: Array.from({ length: spec.gogmaAdvance }, () => ({
        restorationBonuses: practicalBonuses(),
        restorationBonusScope: scope,
      })),
    },
    idealMatch: false,
    practicalMatch: true,
    matchedIdealBonusCount: spec.matchedIdealBonusCount ?? 0,
    materialQuantity: spec.materialQuantity ?? 0,
    bonusKey,
    retentionKey: stableStringify([scope, bonusKey]),
    operationTypeKey: spec.operationTypeKey ?? 'reset_bonuses',
  }
}

interface SkillSpec {
  resetCount: number
  idealCloseness?: number
  semanticKey?: string
}

function skillSolution(spec: SkillSpec): EvaluatedSkillSolution {
  return {
    index: 0,
    solution: {
      resetCount: spec.resetCount,
      seriesSkillId: `series_skill.fixture.s${spec.resetCount}`,
      groupSkillId: null,
      estimatedSkillAdvance: spec.resetCount,
      operations: Array.from({ length: spec.resetCount }, () => ({
        type: 'reset_skills' as const,
        sourceOwnedWeaponId: null,
        skillCounterBefore: 0,
        skillCounterAfter: 1,
      })),
      amendmentResults: Array.from({ length: spec.resetCount }, () => ({
        seriesSkillId: `series_skill.fixture.s${spec.resetCount}`,
        groupSkillId: null,
      })),
    },
    idealMatch: false,
    practicalMatch: true,
    idealCloseness: spec.idealCloseness ?? 0,
    semanticKey: spec.semanticKey ?? `skill:${spec.resetCount}`,
  }
}

function cell(
  bonus: EvaluatedBonusSolution,
  skill: EvaluatedSkillSolution,
  position: { matrixIndex?: number; i?: number; j?: number; offAxis?: boolean } = {},
): ConstrainedWorkItem {
  const matrixIndex = position.matrixIndex ?? 0
  const i = position.i ?? 0
  const j = position.j ?? 0
  return {
    matrixIndex,
    categoryPredicate: 'practical',
    i,
    j,
    nodeKey: `${matrixIndex}:${i},${j}`,
    pairKey: constrainedPairKey(BASE.baseKey, bonus, skill),
    offAxis: position.offAxis ?? (i > 0 && j > 0),
    bonus,
    skill,
    priority: createConstrainedWorkPriority(BASE, bonus, skill),
  }
}

/** Re-indexes an axis the way `evaluate*Solutions()` does after sorting. */
function reindex<T extends { index: number }>(solutions: T[]): T[] {
  return solutions.map((solution, index) => ({ ...solution, index }))
}

function grid(i: number, j: number): ConstrainedWorkItem {
  return cell(
    bonusSolution({ gogmaAdvance: i }),
    skillSolution({ resetCount: j }),
    { i, j },
  )
}

describe('Constrained work item ordering', () => {
  it('prefers the cheaper cell over a distant axis cell', () => {
    // `(B1, K1)` costs two operations, `(B3, k0)` costs three, so best-first
    // must not run every axis cell before the first off-axis cell.
    expect(compareConstrainedWorkItems(grid(1, 1), grid(3, 0))).toBeLessThan(0)
  })

  it('prefers an axis cell over the very same pair reached off-axis', () => {
    const bonus = bonusSolution({ gogmaAdvance: 2 })
    const skill = skillSolution({ resetCount: 0 })
    const axis = cell(bonus, skill, { i: 2, j: 0 })
    const offAxis = cell(bonus, skill, { matrixIndex: 1, i: 2, j: 0, offAxis: true })
    // Same actual pair, so every semantic priority is equal. Ranking the axis
    // instance first is what keeps an axis-reachable pair out of the off-axis
    // budget.
    expect(compareConstrainedWorkItems(axis, offAxis)).toBeLessThan(0)
  })

  it('never ties two distinct cells of one matrix', () => {
    const cells = [grid(1, 2), grid(2, 1), grid(0, 3)]
    for (const left of cells) {
      for (const right of cells) {
        if (left.nodeKey === right.nodeKey) continue
        expect(compareConstrainedWorkItems(left, right)).not.toBe(0)
      }
    }
  })

  it('ranks the canonically cheaper Bonus solution first even when its multiset key sorts later', () => {
    // Everything the leading work priorities look at is equal: same depth, so
    // same operation count and Gogma advance, and the same matched Ideal slot
    // count, so the same Ideal closeness. Only the canonical material quantity
    // separates them.
    const cheaper = bonusSolution({
      gogmaAdvance: 1,
      matchedIdealBonusCount: 4,
      materialQuantity: 1,
      bonusKey: 'bonus:z',
    })
    const dearer = bonusSolution({
      gogmaAdvance: 1,
      matchedIdealBonusCount: 4,
      materialQuantity: 5,
      bonusKey: 'bonus:a',
    })
    const skill = skillSolution({ resetCount: 0 })
    expect(compareBonusSolutions(cheaper, dearer)).toBeLessThan(0)
    // The pre-fix comparator fell through to the stable semantic key, whose
    // Bonus part is the scope plus the completed multiset, so it put the dearer
    // solution first and made the child of a lattice row outrank its parent.
    expect(
      compareStableKeys(
        constrainedWorkSemanticKey(BASE.baseKey, dearer, skill),
        constrainedWorkSemanticKey(BASE.baseKey, cheaper, skill),
      ),
    ).toBeLessThan(0)
    expect(
      compareConstrainedWorkItems(cell(cheaper, skill), cell(dearer, skill)),
    ).toBeLessThan(0)
  })
})

describe('Constrained work priority coordinate monotonicity', () => {
  // A single-seed lazy lattice only reproduces best-first order when moving
  // right or down never yields a strictly better cell. Both axes are held in
  // their canonical stream order, and `idealMatch` is uniform so `categoryRank`
  // is constant: a Practical matrix cell only reaches rank 0 when the same
  // actual pair is also a cell of that base's Ideal matrix, which drains first.
  const bonusAxis = reindex(
    [
      bonusSolution({ gogmaAdvance: 2, matchedIdealBonusCount: 5 }),
      bonusSolution({ gogmaAdvance: 1, matchedIdealBonusCount: 3 }),
      bonusSolution({
        gogmaAdvance: 1,
        matchedIdealBonusCount: 4,
        materialQuantity: 6,
        bonusKey: 'bonus:b',
        operationTypeKey: 'reset_bonuses,keep_bonuses',
      }),
      bonusSolution({
        gogmaAdvance: 1,
        matchedIdealBonusCount: 4,
        materialQuantity: 6,
        bonusKey: 'bonus:b',
      }),
      bonusSolution({
        gogmaAdvance: 1,
        matchedIdealBonusCount: 4,
        materialQuantity: 6,
        bonusKey: 'bonus:a',
      }),
      bonusSolution({
        gogmaAdvance: 1,
        matchedIdealBonusCount: 4,
        materialQuantity: 2,
        bonusKey: 'bonus:m',
      }),
      bonusSolution({
        gogmaAdvance: 1,
        matchedIdealBonusCount: 4,
        materialQuantity: 6,
        bonusKey: 'bonus:b',
        scope: 'normal_artian',
      }),
    ].sort(compareBonusSolutions),
  )
  const skillAxis = reindex(
    [
      skillSolution({ resetCount: 2 }),
      skillSolution({ resetCount: 0 }),
      // Two solutions at one reset count cannot occur in the production stream;
      // they pin the canonical semantic-key tie-break explicitly.
      skillSolution({ resetCount: 1, idealCloseness: 1, semanticKey: 'skill:1b' }),
      skillSolution({ resetCount: 1, idealCloseness: 1, semanticKey: 'skill:1a' }),
      skillSolution({ resetCount: 1, idealCloseness: 0, semanticKey: 'skill:1c' }),
    ].sort(compareSkillSolutions),
  )

  it('holds both axes in their canonical stream order', () => {
    expect(bonusAxis.map(({ solution, materialQuantity, bonusKey }) => [
      solution.gogmaAdvance,
      materialQuantity,
      bonusKey,
    ])).toEqual([
      [1, 2, 'bonus:m'],
      [1, 6, 'bonus:a'],
      [1, 6, 'bonus:b'],
      [1, 6, 'bonus:b'],
      [1, 6, 'bonus:b'],
      [1, 0, 'bonus:1'],
      [2, 0, 'bonus:2'],
    ])
    expect(skillAxis.map(({ semanticKey }) => semanticKey)).toEqual([
      'skill:0',
      'skill:1a',
      'skill:1b',
      'skill:1c',
      'skill:2',
    ])
  })

  it('never ranks a right neighbour above its parent', () => {
    for (let i = 0; i + 1 < bonusAxis.length; i += 1) {
      for (let j = 0; j < skillAxis.length; j += 1) {
        const parent = cell(bonusAxis[i], skillAxis[j], { i, j })
        const child = cell(bonusAxis[i + 1], skillAxis[j], { i: i + 1, j })
        expect(compareConstrainedWorkItems(parent, child)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('never ranks a lower neighbour above its parent', () => {
    for (let i = 0; i < bonusAxis.length; i += 1) {
      for (let j = 0; j + 1 < skillAxis.length; j += 1) {
        const parent = cell(bonusAxis[i], skillAxis[j], { i, j })
        const child = cell(bonusAxis[i], skillAxis[j + 1], { i, j: j + 1 })
        expect(compareConstrainedWorkItems(parent, child)).toBeLessThanOrEqual(0)
      }
    }
  })
})

describe('Constrained work frontier', () => {
  const coordinates: Array<[number, number]> = [
    [0, 1], [3, 0], [1, 1], [2, 2], [0, 0], [1, 0], [0, 2], [2, 0], [1, 2],
  ]

  function popAll(order: Array<[number, number]>): string[] {
    const frontier = new ConstrainedWorkFrontier()
    order.forEach(([i, j]) => frontier.push(grid(i, j)))
    const popped: string[] = []
    let next = frontier.pop()
    while (next !== null) {
      popped.push(next.nodeKey)
      next = frontier.pop()
    }
    return popped
  }

  it('pops in comparator order regardless of push order', () => {
    const forward = popAll(coordinates)
    const reversed = popAll([...coordinates].reverse())
    const rotated = popAll([...coordinates.slice(4), ...coordinates.slice(0, 4)])
    expect(reversed).toEqual(forward)
    expect(rotated).toEqual(forward)
    expect(forward).toHaveLength(coordinates.length)
  })

  it('orders by operation count before the lattice coordinates', () => {
    expect(popAll(coordinates)).toEqual([
      '0:0,0',
      '0:0,1',
      '0:1,0',
      '0:0,2',
      '0:1,1',
      '0:2,0',
      '0:1,2',
      '0:3,0',
      '0:2,2',
    ])
  })

  it('reports an empty frontier instead of throwing', () => {
    const frontier = new ConstrainedWorkFrontier()
    expect(frontier.size).toBe(0)
    expect(frontier.pop()).toBeNull()
  })
})
