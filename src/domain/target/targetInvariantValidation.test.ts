import { describe, expect, it } from 'vitest'
import type {
  BonusCondition,
  SkillCondition,
  TargetWeapon,
} from '../models/publicTypes'
import { createValidTargetWeapon } from '../../test/fixtures/domainData'
import {
  restorationBonus,
  restorationBonusSet,
  targetEvaluationMaster,
} from '../../test/fixtures/targetEvaluation'
import { evaluateSkillCondition } from './skillConditionEvaluator'
import {
  skillConditionImplies,
  validateTargetIdealImpliesPractical,
} from './targetInvariantValidation'

const attack = 'bonus_type.fixture.attack'
const element = 'bonus_type.fixture.element'
const sharpness = 'bonus_type.fixture.sharpness'
const utility = 'bonus_type.fixture.utility'
const low = 'bonus_rank.fixture.low'
const middle = 'bonus_rank.fixture.middle'
const high = 'bonus_rank.fixture.high'
const special = 'bonus_rank.fixture.special'

const seriesA = 'series_skill.fixture.a'
const seriesB = 'series_skill.fixture.b'
const groupA = 'group_skill.fixture.a'
const groupB = 'group_skill.fixture.b'

/** Ideal: attack EX x2, element high, sharpness middle, utility low. */
const idealBonuses = restorationBonusSet(
  restorationBonus(attack, special),
  restorationBonus(attack, special),
  restorationBonus(element, high),
  restorationBonus(sharpness, middle),
  restorationBonus(utility, low),
)

function target(overrides: Partial<TargetWeapon> = {}): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    idealBonuses,
    practicalBonusConditions: [],
    practicalAlternativeGroups: [],
    idealSkillCondition: {
      seriesSkillId: null,
      groupSkillId: null,
      matchMode: 'all',
    },
    practicalSkillCondition: {
      seriesSkillId: null,
      groupSkillId: null,
      matchMode: 'all',
    },
    ...overrides,
  }
}

function condition(overrides: Partial<BonusCondition> = {}): BonusCondition {
  return {
    id: 'condition.fixture',
    bonusTypeId: attack,
    minimumRankId: middle,
    requiredCount: 2,
    requiredExCount: 0,
    ...overrides,
  }
}

function skill(
  seriesSkillId: string | null,
  groupSkillId: string | null,
  matchMode: SkillCondition['matchMode'],
): SkillCondition {
  return { seriesSkillId, groupSkillId, matchMode }
}

function validate(value: TargetWeapon) {
  return validateTargetIdealImpliesPractical(value, targetEvaluationMaster)
}

describe('Ideal implies Practical containment: Bonus side', () => {
  it('accepts an Ideal set that satisfies a lower practical bonus condition', () => {
    const result = validate(
      target({
        practicalBonusConditions: [
          condition({ minimumRankId: high, requiredCount: 2 }),
        ],
      }),
    )
    expect(result.isValid).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('rejects an Ideal set that does not satisfy a practical bonus condition', () => {
    const result = validate(
      target({
        practicalBonusConditions: [
          condition({
            bonusTypeId: element,
            minimumRankId: high,
            requiredCount: 3,
          }),
        ],
      }),
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toEqual([
      {
        path: 'practicalBonusConditions[0]',
        code: 'invalid_structure',
        message: expect.stringContaining('Bonus side'),
      },
    ])
  })

  it('uses the Master rank order rather than the rank ID when comparing', () => {
    const satisfied = validate(
      target({
        practicalBonusConditions: [
          condition({
            bonusTypeId: sharpness,
            minimumRankId: low,
            requiredCount: 1,
          }),
        ],
      }),
    )
    const unsatisfied = validate(
      target({
        practicalBonusConditions: [
          condition({
            bonusTypeId: sharpness,
            minimumRankId: high,
            requiredCount: 1,
          }),
        ],
      }),
    )
    expect(satisfied.isValid).toBe(true)
    expect(unsatisfied.isValid).toBe(false)
  })

  it('accepts and rejects requiredExCount using the Master isEx flag', () => {
    const satisfied = validate(
      target({
        practicalBonusConditions: [
          condition({ requiredCount: 2, requiredExCount: 2 }),
        ],
      }),
    )
    const unsatisfied = validate(
      target({
        practicalBonusConditions: [
          condition({
            bonusTypeId: element,
            minimumRankId: middle,
            requiredCount: 1,
            requiredExCount: 1,
          }),
        ],
      }),
    )
    expect(satisfied.isValid).toBe(true)
    expect(unsatisfied.isValid).toBe(false)
  })

  it('accepts an Ideal set that satisfies an alternative group', () => {
    const result = validate(
      target({
        practicalAlternativeGroups: [
          {
            id: 'alternative.fixture',
            requiredCount: 3,
            options: [
              { bonusTypeId: attack, minimumRankId: high },
              { bonusTypeId: element, minimumRankId: middle },
            ],
          },
        ],
      }),
    )
    expect(result.isValid).toBe(true)
  })

  it('rejects an Ideal set that does not satisfy an alternative group', () => {
    const result = validate(
      target({
        practicalAlternativeGroups: [
          {
            id: 'alternative.fixture',
            requiredCount: 2,
            options: [{ bonusTypeId: sharpness, minimumRankId: high }],
          },
        ],
      }),
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toEqual([
      {
        path: 'practicalAlternativeGroups[0]',
        code: 'invalid_structure',
        message: expect.stringContaining('Bonus side'),
      },
    ])
  })

  it('requires every plain condition AND every alternative group', () => {
    const result = validate(
      target({
        practicalBonusConditions: [
          condition({ minimumRankId: high, requiredCount: 2 }),
          condition({
            bonusTypeId: sharpness,
            minimumRankId: high,
            requiredCount: 1,
          }),
        ],
        practicalAlternativeGroups: [
          {
            id: 'alternative.satisfied',
            requiredCount: 1,
            options: [{ bonusTypeId: element, minimumRankId: high }],
          },
          {
            id: 'alternative.unsatisfied',
            requiredCount: 5,
            options: [{ bonusTypeId: element, minimumRankId: high }],
          },
        ],
      }),
    )
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'practicalBonusConditions[1]',
      'practicalAlternativeGroups[1]',
    ])
  })

  it('reports an unresolvable Bonus Rank reference instead of throwing', () => {
    const result = validate(
      target({
        practicalBonusConditions: [
          condition({ minimumRankId: 'bonus_rank.fixture.missing' }),
        ],
      }),
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toEqual([
      {
        path: 'idealBonuses',
        code: 'invalid_reference',
        message: expect.stringContaining('bonus_rank.fixture.missing'),
      },
    ])
  })
})

interface SkillImplicationCase {
  name: string
  ideal: SkillCondition
  practical: SkillCondition
  implies: boolean
}

const skillCases: SkillImplicationCase[] = [
  {
    name: 'practical unconstrained (both null, all) always contains Ideal',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(null, null, 'all'),
    implies: true,
  },
  {
    name: 'practical unconstrained (both null, any) always contains Ideal',
    ideal: skill(seriesA, groupB, 'any'),
    practical: skill(null, null, 'any'),
    implies: true,
  },
  {
    name: 'Ideal series=A, Practical series=A',
    ideal: skill(seriesA, null, 'all'),
    practical: skill(seriesA, null, 'all'),
    implies: true,
  },
  {
    name: 'Ideal series=A, Practical series=B',
    ideal: skill(seriesA, null, 'all'),
    practical: skill(seriesB, null, 'all'),
    implies: false,
  },
  {
    name: 'Ideal series=A AND group=B, Practical series=A',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(seriesA, null, 'all'),
    implies: true,
  },
  {
    name: 'Ideal series=A AND group=B, Practical group=B',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(null, groupB, 'any'),
    implies: true,
  },
  {
    name: 'Ideal series=A AND group=B, Practical series=A OR group=B',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(seriesA, groupB, 'any'),
    implies: true,
  },
  {
    name: 'Ideal series=A AND group=B, Practical series=A AND group=B',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(seriesA, groupB, 'all'),
    implies: true,
  },
  {
    name: 'Ideal series=A OR group=B, Practical series=A AND group=B',
    ideal: skill(seriesA, groupB, 'any'),
    practical: skill(seriesA, groupB, 'all'),
    implies: false,
  },
  {
    name: 'Ideal series=A OR group=B, Practical series=A',
    ideal: skill(seriesA, groupB, 'any'),
    practical: skill(seriesA, null, 'all'),
    implies: false,
  },
  {
    name: 'Ideal series=A OR group=B, Practical series=A OR group=B',
    ideal: skill(seriesA, groupB, 'any'),
    practical: skill(seriesA, groupB, 'any'),
    implies: true,
  },
  {
    name: 'Ideal series=A OR group=B, Practical group=B',
    ideal: skill(seriesA, groupB, 'any'),
    practical: skill(null, groupB, 'all'),
    implies: false,
  },
  {
    name: 'Ideal unconstrained, Practical series=A',
    ideal: skill(null, null, 'all'),
    practical: skill(seriesA, null, 'all'),
    implies: false,
  },
  {
    name: 'Ideal unconstrained, Practical unconstrained',
    ideal: skill(null, null, 'any'),
    practical: skill(null, null, 'all'),
    implies: true,
  },
  {
    name: 'a single specified slot ignores matchMode: any behaves like all',
    ideal: skill(seriesA, null, 'any'),
    practical: skill(seriesA, null, 'all'),
    implies: true,
  },
  {
    name: 'Ideal series=A AND group=B, Practical series=B OR group=B',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(seriesB, groupB, 'any'),
    implies: true,
  },
  {
    name: 'Ideal series=A AND group=B, Practical series=B OR group=A',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(seriesB, groupA, 'any'),
    implies: false,
  },
  {
    name: 'Ideal group=B, Practical group=B',
    ideal: skill(null, groupB, 'any'),
    practical: skill(null, groupB, 'all'),
    implies: true,
  },
  {
    name: 'Ideal group=B, Practical series=A OR group=B',
    ideal: skill(null, groupB, 'all'),
    practical: skill(seriesA, groupB, 'any'),
    implies: true,
  },
  {
    name: 'Ideal group=B, Practical series=A AND group=B',
    ideal: skill(null, groupB, 'all'),
    practical: skill(seriesA, groupB, 'all'),
    implies: false,
  },
  {
    name: 'Ideal series=A AND group=B, Practical series=A AND group=A',
    ideal: skill(seriesA, groupB, 'all'),
    practical: skill(seriesA, groupA, 'all'),
    implies: false,
  },
]

describe('Ideal implies Practical containment: Skill side', () => {
  it.each(skillCases)('$name', ({ ideal, practical, implies }) => {
    expect(skillConditionImplies(ideal, practical)).toBe(implies)
    expect(
      validate(
        target({
          idealSkillCondition: ideal,
          practicalSkillCondition: practical,
        }),
      ).isValid,
    ).toBe(implies)
  })

  it('agrees with evaluateSkillCondition over independent skill values', () => {
    const seriesValues = [seriesA, seriesB, 'series_skill.fixture.other', null]
    const groupValues = [groupA, groupB, 'group_skill.fixture.other', null]
    skillCases.forEach(({ ideal, practical, implies }) => {
      const holds = seriesValues.every((seriesSkillId) =>
        groupValues.every((groupSkillId) => {
          if (!evaluateSkillCondition(ideal, seriesSkillId, groupSkillId)) {
            return true
          }
          return evaluateSkillCondition(practical, seriesSkillId, groupSkillId)
        }),
      )
      expect(holds).toBe(implies)
    })
  })

  it('reports the Skill side with an identifiable path', () => {
    const result = validate(
      target({
        idealSkillCondition: skill(seriesA, groupB, 'any'),
        practicalSkillCondition: skill(seriesA, groupB, 'all'),
      }),
    )
    expect(result.issues).toEqual([
      {
        path: 'practicalSkillCondition',
        code: 'invalid_structure',
        message: expect.stringContaining('Skill side'),
      },
    ])
  })
})

describe('Ideal implies Practical containment: whole Target', () => {
  it('accepts the shared valid Target fixture', () => {
    expect(validate(createValidTargetWeapon()).isValid).toBe(true)
  })

  it('reports Bonus and Skill violations together', () => {
    const result = validate(
      target({
        practicalBonusConditions: [
          condition({ bonusTypeId: element, requiredCount: 3 }),
        ],
        idealSkillCondition: skill(seriesA, groupB, 'any'),
        practicalSkillCondition: skill(seriesA, groupB, 'all'),
      }),
    )
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'practicalBonusConditions[0]',
      'practicalSkillCondition',
    ])
  })
})
