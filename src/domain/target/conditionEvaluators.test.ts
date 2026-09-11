import { describe, expect, it } from 'vitest'
import type { SkillCondition } from '../models/publicTypes'
import { evaluateSkillCondition } from './skillConditionEvaluator'

// Bonus acceptance and validation are covered by targetCompromise.test.ts.
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
