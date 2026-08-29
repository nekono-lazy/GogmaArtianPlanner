import { describe, expect, it } from 'vitest'
import { MasterDataDomainError } from '../master/masterSelectors'
import type {
  AlternativeBonusConditionGroup,
  BonusCondition,
  SkillCondition,
} from '../models/publicTypes'
import {
  restorationBonus,
  restorationBonusSet,
  targetEvaluationMaster,
} from '../../test/fixtures/targetEvaluation'
import {
  evaluateAlternativeBonusConditionGroup,
  evaluateBonusCondition,
} from './bonusConditionEvaluator'
import { evaluateSkillCondition } from './skillConditionEvaluator'

const attack = 'bonus_type.fixture.attack'
const element = 'bonus_type.fixture.element'
const sharpness = 'bonus_type.fixture.sharpness'
const low = 'bonus_rank.fixture.low'
const middle = 'bonus_rank.fixture.middle'
const high = 'bonus_rank.fixture.high'
const special = 'bonus_rank.fixture.special'

const bonuses = restorationBonusSet(
  restorationBonus(attack, low),
  restorationBonus(attack, middle),
  restorationBonus(attack, special),
  restorationBonus(sharpness, special),
  restorationBonus(element, special),
)

function bonusCondition(
  overrides: Partial<BonusCondition> = {},
): BonusCondition {
  return {
    id: 'condition.fixture',
    bonusTypeId: attack,
    minimumRankId: middle,
    requiredCount: 2,
    requiredExCount: 1,
    ...overrides,
  }
}

describe('BonusCondition evaluation', () => {
  it('counts minimum rank and higher, but not lower ranks or other types', () => {
    expect(
      evaluateBonusCondition(bonusCondition(), bonuses, targetEvaluationMaster),
    ).toBe(true)
  })

  it('rejects when requiredCount is not reached', () => {
    expect(
      evaluateBonusCondition(
        bonusCondition({ requiredCount: 3 }),
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(false)
  })

  it('rejects when requiredExCount is not reached', () => {
    expect(
      evaluateBonusCondition(
        bonusCondition({ requiredExCount: 2 }),
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(false)
  })

  it('counts duplicate bonus slots independently', () => {
    const duplicates = restorationBonusSet(
      restorationBonus(attack, high),
      restorationBonus(attack, high),
      restorationBonus(element, low),
      restorationBonus(element, low),
      restorationBonus(element, low),
    )
    expect(
      evaluateBonusCondition(
        bonusCondition({ requiredExCount: 0 }),
        duplicates,
        targetEvaluationMaster,
      ),
    ).toBe(true)
  })

  it('uses Master isEx rather than rank ID or display name', () => {
    expect(
      evaluateBonusCondition(
        bonusCondition({ minimumRankId: special, requiredCount: 1 }),
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(true)
  })

  it('throws an explicit Domain Error for an unknown rank ID', () => {
    expect(() =>
      evaluateBonusCondition(
        bonusCondition({ minimumRankId: 'bonus_rank.fixture.missing' }),
        bonuses,
        targetEvaluationMaster,
      ),
    ).toThrow(MasterDataDomainError)
  })
})

describe('AlternativeBonusConditionGroup evaluation', () => {
  const group: AlternativeBonusConditionGroup = {
    id: 'alternative.fixture',
    requiredCount: 1,
    options: [
      { bonusTypeId: element, minimumRankId: special },
      { bonusTypeId: attack, minimumRankId: special },
    ],
  }

  it('matches option A', () => {
    expect(
      evaluateAlternativeBonusConditionGroup(
        { ...group, options: [group.options[0]] },
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(true)
  })

  it('matches option B', () => {
    expect(
      evaluateAlternativeBonusConditionGroup(
        { ...group, options: [group.options[1]] },
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(true)
  })

  it('combines slots matching different options for requiredCount', () => {
    expect(
      evaluateAlternativeBonusConditionGroup(
        { ...group, requiredCount: 2 },
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(true)
  })

  it('rejects when matching slot count is insufficient', () => {
    expect(
      evaluateAlternativeBonusConditionGroup(
        { ...group, requiredCount: 3 },
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(false)
  })

  it('does not count bonuses outside every option', () => {
    expect(
      evaluateAlternativeBonusConditionGroup(
        {
          ...group,
          options: [{ bonusTypeId: sharpness, minimumRankId: special }],
          requiredCount: 2,
        },
        bonuses,
        targetEvaluationMaster,
      ),
    ).toBe(false)
  })
})

describe('SkillCondition evaluation', () => {
  const both: SkillCondition = {
    seriesSkillId: 'series.fixture.a',
    groupSkillId: 'group.fixture.a',
    matchMode: 'all',
  }

  it('requires both specified skills in all mode', () => {
    expect(
      evaluateSkillCondition(both, 'series.fixture.a', 'group.fixture.a'),
    ).toBe(true)
    expect(
      evaluateSkillCondition(both, 'series.fixture.a', 'group.fixture.b'),
    ).toBe(false)
  })

  it('accepts either specified skill in any mode', () => {
    const any = { ...both, matchMode: 'any' as const }
    expect(
      evaluateSkillCondition(any, 'series.fixture.a', 'group.fixture.b'),
    ).toBe(true)
    expect(
      evaluateSkillCondition(any, 'series.fixture.b', 'group.fixture.a'),
    ).toBe(true)
    expect(
      evaluateSkillCondition(any, 'series.fixture.b', 'group.fixture.b'),
    ).toBe(false)
  })

  it('evaluates only a specified series skill', () => {
    expect(
      evaluateSkillCondition(
        { ...both, groupSkillId: null },
        'series.fixture.a',
        null,
      ),
    ).toBe(true)
  })

  it('evaluates only a specified group skill', () => {
    expect(
      evaluateSkillCondition(
        { ...both, seriesSkillId: null },
        null,
        'group.fixture.a',
      ),
    ).toBe(true)
  })

  it('always matches when both condition fields are null', () => {
    expect(
      evaluateSkillCondition(
        { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
        'series.fixture.other',
        'group.fixture.other',
      ),
    ).toBe(true)
    expect(
      evaluateSkillCondition(
        { seriesSkillId: null, groupSkillId: null, matchMode: 'any' },
        null,
        null,
      ),
    ).toBe(true)
  })
})
