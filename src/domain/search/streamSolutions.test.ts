import { describe, expect, it } from 'vitest'
import { createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import type {
  RestorationBonusSet,
  RouteOperation,
  TargetWeapon,
} from '../models/publicTypes'
import { evaluateTargetCandidate } from '../target'
import {
  buildBonusSolutionSet,
  buildSkillSolutionSet,
  compareBonusSolutions,
  selectBonusAxis,
  selectSkillAxis,
  type RouteBonusSolution,
  type RouteSkillSolution,
} from './streamSolutions'

const attackHigh = () => restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high')
const attackMiddle = () => restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.middle')
const elementMiddle = () => restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle')
const utilityLow = () => restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low')
const utilityHigh = () => restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.high')
const sharpnessHigh = () => restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.high')
const sharpnessLow = () => restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.low')

/** The fixture Target's `idealBonuses`. */
const idealBonuses = (): RestorationBonusSet => createRestorationBonusSet()
/** The same completed multiset in a different slot order. */
const idealBonusesReordered = (): RestorationBonusSet =>
  restorationBonusSet(sharpnessHigh(), attackHigh(), elementMiddle(), attackHigh(), utilityLow())
/** Satisfies the Practical bonus conditions without matching Ideal. */
const practicalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(attackHigh(), attackHigh(), elementMiddle(), utilityLow(), sharpnessLow())
const otherPracticalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(attackHigh(), attackHigh(), elementMiddle(), utilityHigh(), sharpnessLow())
/** A third Practical outcome with the same ideal closeness as `practicalBonuses`. */
const altPracticalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(
    attackHigh(),
    attackHigh(),
    elementMiddle(),
    utilityLow(),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.middle'),
  )
/** Fails the `attack >= high x2` Practical condition. */
const belowPracticalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(attackMiddle(), attackMiddle(), elementMiddle(), utilityLow(), sharpnessLow())

const resetOperation = (gogmaCounterBefore: number): RouteOperation => ({
  type: 'reset_bonuses',
  sourceOwnedWeaponId: null,
  gogmaCounterBefore,
  gogmaCounterAfter: gogmaCounterBefore + 1,
})

const resetSkillsOperation = (skillCounterBefore: number): RouteOperation => ({
  type: 'reset_skills',
  sourceOwnedWeaponId: null,
  skillCounterBefore,
  skillCounterAfter: skillCounterBefore + 1,
})

function skillSolution(
  resetCount: number,
  seriesSkillId: string | null,
  groupSkillId: string | null = null,
): RouteSkillSolution {
  return {
    resetCount,
    seriesSkillId,
    groupSkillId,
    estimatedSkillAdvance: resetCount,
    operations: Array.from({ length: resetCount }, (_, index) =>
      resetSkillsOperation(7 + index),
    ),
  }
}

function bonusSolution(
  gogmaAdvance: number,
  finalBonuses: RestorationBonusSet,
): RouteBonusSolution {
  return {
    gogmaAdvance,
    lastResetDepth: gogmaAdvance,
    finalBonuses,
    restorationBonusScope: 'gogma_artian',
    operations: Array.from({ length: gogmaAdvance }, (_, index) =>
      resetOperation(10 + index),
    ),
  }
}

function shuffled<T>(entries: readonly T[]): T[] {
  // A fixed, non-identity permutation: reversing plus a rotation.
  const reversed = [...entries].reverse()
  return [...reversed.slice(1), reversed[0]]
}

function searchInput() {
  return createCandidateSearchInput()
}

function targetWeapon(): TargetWeapon {
  return searchInput().targetWeapons[0]
}

describe('Skill stream-local solution set (SEARCH_SPEC 5.5.2)', () => {
  it('retains only the smallest resetCount per (seriesSkillId, groupSkillId)', () => {
    const set = buildSkillSolutionSet(targetWeapon(), [
      skillSolution(2, 'series_skill.fixture.a', 'group_skill.fixture.a'),
      skillSolution(5, 'series_skill.fixture.a', 'group_skill.fixture.a'),
      skillSolution(8, 'series_skill.fixture.a', 'group_skill.fixture.a'),
    ])

    expect(set).toHaveLength(1)
    expect(set[0].solution.resetCount).toBe(2)
  })

  it('keeps the zero-operation solution over a later identical one', () => {
    const set = buildSkillSolutionSet(targetWeapon(), [
      skillSolution(0, 'series_skill.fixture.a'),
      skillSolution(3, 'series_skill.fixture.a'),
      skillSolution(1, 'series_skill.fixture.b'),
    ])

    expect(set.map(({ solution }) => [solution.resetCount, solution.seriesSkillId]))
      .toEqual([
        [0, 'series_skill.fixture.a'],
        [1, 'series_skill.fixture.b'],
      ])
  })

  it('orders by resetCount, then ideal closeness, then a stable semantic key', () => {
    const target = targetWeapon()
    // Ideal specifies the series only, so a matching series is closer.
    const solutions = [
      skillSolution(1, 'series_skill.fixture.z'),
      skillSolution(1, 'series_skill.fixture.a'),
      skillSolution(1, 'series_skill.fixture.b'),
      skillSolution(0, 'series_skill.fixture.c'),
    ]
    const order = (entries: readonly RouteSkillSolution[]) =>
      buildSkillSolutionSet(target, entries).map(
        ({ solution }) => solution.seriesSkillId,
      )

    expect(order(solutions)).toEqual([
      'series_skill.fixture.c',
      'series_skill.fixture.a',
      'series_skill.fixture.b',
      'series_skill.fixture.z',
    ])
    expect(order(shuffled(solutions))).toEqual(order(solutions))
    expect(order([...solutions].reverse())).toEqual(order(solutions))
  })

  it('counts only the series / group actually specified by Ideal as closeness', () => {
    const target = targetWeapon()
    // `idealSkillCondition` is series `a` with a null group.
    const set = buildSkillSolutionSet(target, [
      skillSolution(1, 'series_skill.fixture.a', 'group_skill.fixture.x'),
      skillSolution(1, 'series_skill.fixture.other', 'group_skill.fixture.x'),
    ])
    const closeness = new Map(
      set.map((entry) => [entry.solution.seriesSkillId, entry.idealCloseness]),
    )

    expect(closeness.get('series_skill.fixture.a')).toBe(1)
    expect(closeness.get('series_skill.fixture.other')).toBe(0)
  })

  it('selects K(ideal) and K(practical) from the same ordered set', () => {
    const target = targetWeapon()
    const set = buildSkillSolutionSet(target, [
      skillSolution(0, 'series_skill.fixture.other'),
      skillSolution(1, 'series_skill.fixture.a'),
    ])

    // The fixture Target's Practical Skill condition is unconstrained.
    expect(selectSkillAxis(set, 'practical')).toHaveLength(2)
    expect(selectSkillAxis(set, 'ideal').map(({ solution }) => solution.resetCount))
      .toEqual([1])
    // Ideal implies Practical, so the Ideal solution is on both axes.
    expect(selectSkillAxis(set, 'practical').map(({ solution }) => solution.resetCount))
      .toContain(1)
  })
})

describe('Bonus stream-local solution set (SEARCH_SPEC 5.5.3)', () => {
  it('retains only the smallest gogmaAdvance per completed multiset', () => {
    const input = searchInput()
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [
      bonusSolution(3, practicalBonuses()),
      bonusSolution(7, practicalBonuses()),
      bonusSolution(9, practicalBonuses()),
    ])

    expect(set).toHaveLength(1)
    expect(set[0].solution.gogmaAdvance).toBe(3)
  })

  it('treats a slot-order-only difference as the same completed outcome', () => {
    const input = searchInput()
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [
      bonusSolution(2, idealBonuses()),
      bonusSolution(4, idealBonusesReordered()),
    ])

    expect(set).toHaveLength(1)
    expect(set[0].solution.gogmaAdvance).toBe(2)
  })

  it('retains Normal d=0 and Gogma d=1 exact-label outcomes with distinct Ideal semantics', () => {
    const input = searchInput()
    const inherited: RouteBonusSolution = {
      ...bonusSolution(0, idealBonuses()),
      restorationBonusScope: 'normal_artian',
    }
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [
      bonusSolution(2, idealBonusesReordered()),
      inherited,
      bonusSolution(1, idealBonuses()),
    ])

    expect(set.map(({ solution, idealMatch, practicalMatch, matchedIdealBonusCount }) => [
      solution.gogmaAdvance, solution.restorationBonusScope, idealMatch, practicalMatch, matchedIdealBonusCount,
    ])).toEqual([
      [0, 'normal_artian', false, true, 5],
      [1, 'gogma_artian', true, true, 5],
    ])
    expect(set[0].bonusKey).toBe(set[1].bonusKey)
    expect(set[0].retentionKey).not.toBe(set[1].retentionKey)
  })

  it('breaks an otherwise identical cross-scope tie independently of input order', () => {
    const input = searchInput()
    const gogma = bonusSolution(0, idealBonuses())
    const normal: RouteBonusSolution = { ...gogma, restorationBonusScope: 'normal_artian' }
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [normal, gogma])
    expect(set).toHaveLength(2)
    expect(compareBonusSolutions(set[0], set[1])).toBeLessThan(0)
    expect(compareBonusSolutions(set[1], set[0])).toBeGreaterThan(0)
    expect(buildBonusSolutionSet(input.targetWeapons[0], input, [gogma, normal])).toEqual(set)
  })

  it('does not collide two different (bonusTypeId, bonusRankId) pairs', () => {
    const input = searchInput()
    // A concatenating key would join both slots into `a/b/c`, folding two
    // different completed multisets into one solution.
    input.master.bonusRanks = [
      ...input.master.bonusRanks,
      {
        id: 'c',
        displayNameJa: 'c（fixture）',
        displayNameEn: 'c (fixture)',
        order: 1,
        isEx: false,
        isEnabled: true,
      },
      {
        id: 'b/c',
        displayNameJa: 'b/c（fixture）',
        displayNameEn: 'b/c (fixture)',
        order: 1,
        isEx: false,
        isEnabled: true,
      },
    ]
    const withSlot = (bonusTypeId: string, bonusRankId: string): RestorationBonusSet =>
      restorationBonusSet(
        attackHigh(),
        attackHigh(),
        elementMiddle(),
        utilityLow(),
        restorationBonus(bonusTypeId, bonusRankId),
      )
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [
      bonusSolution(1, withSlot('a/b', 'c')),
      bonusSolution(2, withSlot('a', 'b/c')),
    ])

    expect(set).toHaveLength(2)
    expect(set.map(({ solution }) => solution.gogmaAdvance)).toEqual([1, 2])
    expect(new Set(set.map(({ bonusKey }) => bonusKey)).size).toBe(2)
  })

  it('keeps the zero-operation solution over a later identical outcome', () => {
    const input = searchInput()
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [
      bonusSolution(0, practicalBonuses()),
      bonusSolution(2, practicalBonuses()),
      bonusSolution(1, otherPracticalBonuses()),
    ])

    expect(set.map(({ solution }) => solution.gogmaAdvance)).toEqual([0, 1])
  })

  it('orders by gogmaAdvance, then ideal closeness, then material total, then key', () => {
    const input = searchInput()
    input.master.materialCosts = [
      {
        id: 'cost.fixture.reset.bonus',
        operationType: 'reset_bonuses',
        weaponTypeId: null,
        materialId: 'material.fixture.a',
        quantity: 3,
        isEnabled: true,
      },
    ]
    // Same ideal closeness as `practicalBonuses`, but no amendment material.
    const cheapPractical: RouteBonusSolution = {
      ...bonusSolution(1, altPracticalBonuses()),
      operations: [],
    }
    const solutions = [
      bonusSolution(2, otherPracticalBonuses()),
      bonusSolution(1, practicalBonuses()),
      bonusSolution(1, idealBonuses()),
      cheapPractical,
    ]
    const order = (entries: readonly RouteBonusSolution[]) =>
      buildBonusSolutionSet(input.targetWeapons[0], input, entries).map(
        ({ solution, matchedIdealBonusCount, materialQuantity }) => [
          solution.gogmaAdvance,
          matchedIdealBonusCount,
          materialQuantity,
        ],
      )

    expect(order(solutions)).toEqual([
      // Ideal closeness 5 comes first at depth 1.
      [1, 5, 3],
      // Then the two depth-1 solutions with closeness 4, cheapest material first.
      [1, 4, 0],
      [1, 4, 3],
      [2, 3, 6],
    ])
    expect(order(shuffled(solutions))).toEqual(order(solutions))
    expect(order([...solutions].reverse())).toEqual(order(solutions))
  })

  it('selects B(ideal) and B(practical) from the same ordered set', () => {
    const input = searchInput()
    const set = buildBonusSolutionSet(input.targetWeapons[0], input, [
      bonusSolution(1, belowPracticalBonuses()),
      bonusSolution(2, practicalBonuses()),
      bonusSolution(3, idealBonuses()),
    ])

    expect(selectBonusAxis(set, 'ideal').map(({ solution }) => solution.gogmaAdvance))
      .toEqual([3])
    expect(selectBonusAxis(set, 'practical').map(({ solution }) => solution.gogmaAdvance))
      .toEqual([2, 3])
  })
})

describe('Decomposed evaluation parity with the Target evaluator (SEARCH_SPEC 5.4)', () => {
  const skills: Array<[string | null, string | null]> = [
    ['series_skill.fixture.a', 'group_skill.fixture.a'],
    ['series_skill.fixture.a', null],
    ['series_skill.fixture.other', 'group_skill.fixture.a'],
    ['series_skill.fixture.other', null],
    [null, null],
  ]
  const bonusSets: RestorationBonusSet[] = [
    idealBonuses(),
    idealBonusesReordered(),
    practicalBonuses(),
    otherPracticalBonuses(),
    belowPracticalBonuses(),
  ]

  const targets = (): Array<[string, TargetWeapon]> => {
    const base = targetWeapon()
    const allMode = structuredClone(base)
    allMode.practicalSkillCondition = {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: 'group_skill.fixture.a',
      matchMode: 'all',
    }
    allMode.idealSkillCondition = {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: 'group_skill.fixture.a',
      matchMode: 'all',
    }
    const anyMode = structuredClone(allMode)
    anyMode.practicalSkillCondition = {
      ...allMode.practicalSkillCondition,
      matchMode: 'any',
    }
    const alternativeGroups = structuredClone(base)
    alternativeGroups.practicalAlternativeGroups = [
      {
        id: 'alternative.fixture.parity',
        requiredCount: 2,
        options: [
          {
            bonusTypeId: 'bonus_type.fixture.element',
            minimumRankId: 'bonus_rank.fixture.middle',
          },
          {
            bonusTypeId: 'bonus_type.fixture.sharpness',
            minimumRankId: 'bonus_rank.fixture.low',
          },
        ],
      },
    ]
    const nullableSkills = structuredClone(base)
    nullableSkills.idealSkillCondition = {
      seriesSkillId: null,
      groupSkillId: 'group_skill.fixture.a',
      matchMode: 'all',
    }
    return [
      ['base', base],
      ['skill match all', allMode],
      ['skill match any', anyMode],
      ['alternative bonus group', alternativeGroups],
      ['nullable ideal series', nullableSkills],
    ]
  }

  it.each(targets())('matches the composed category for the %s Target', (_name, target) => {
    const input = searchInput()
    input.targetWeapons[0] = target

    for (const [bonuses, scope] of bonusSets.flatMap((bonuses) =>
      (['normal_artian', 'gogma_artian'] as const).map((scope) => [bonuses, scope] as const),
    )) {
      const [bonusEntry] = buildBonusSolutionSet(target, input, [
        { ...bonusSolution(1, bonuses), restorationBonusScope: scope },
      ])
      for (const [seriesSkillId, groupSkillId] of skills) {
        const [skillEntry] = buildSkillSolutionSet(target, [
          skillSolution(1, seriesSkillId, groupSkillId),
        ])
        const composed = evaluateTargetCandidate(
          target,
          bonuses,
          bonusEntry.solution.restorationBonusScope,
          seriesSkillId,
          groupSkillId,
          input.master,
          input.settings.similarityThreshold,
        )
        const decomposedIdeal = bonusEntry.idealMatch && skillEntry.idealMatch
        const decomposedPractical =
          bonusEntry.practicalMatch && skillEntry.practicalMatch
        const decomposedCategory = decomposedIdeal
          ? 'ideal'
          : decomposedPractical
            ? 'practical'
            : null

        expect(composed.category).toBe(decomposedCategory)
        expect(composed.idealDifference.matchedBonusCount)
          .toBe(bonusEntry.matchedIdealBonusCount)

        // The Skill halves of `IdealDifference` and the additive similarity
        // score also follow from the decomposed values alone.
        const specifiedIdealSkillCount =
          Number(target.idealSkillCondition.seriesSkillId !== null) +
          Number(target.idealSkillCondition.groupSkillId !== null)
        const matchedIdealSkillCount =
          Number(
            target.idealSkillCondition.seriesSkillId !== null &&
              composed.idealDifference.seriesSkillMatches,
          ) +
          Number(
            target.idealSkillCondition.groupSkillId !== null &&
              composed.idealDifference.groupSkillMatches,
          )
        expect(matchedIdealSkillCount).toBe(skillEntry.idealCloseness)
        expect(composed.similarityScore).toBeCloseTo(
          (bonusEntry.matchedIdealBonusCount + skillEntry.idealCloseness) /
            (5 + specifiedIdealSkillCount),
          10,
        )
        expect(composed.isSimilarToIdeal).toBe(
          composed.category === 'practical' &&
            composed.similarityScore >= input.settings.similarityThreshold,
        )
      }
    }
  })
})
