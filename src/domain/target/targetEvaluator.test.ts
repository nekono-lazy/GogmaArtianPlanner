import { describe, expect, it } from 'vitest'
import type {
  IdealDifference,
  RestorationBonusSet,
  TargetWeapon,
} from '../models/publicTypes'
import { createValidTargetWeapon } from '../../test/fixtures/domainData'
import {
  restorationBonus,
  restorationBonusSet,
  targetEvaluationMaster,
} from '../../test/fixtures/targetEvaluation'
import { createIdealDifference } from './idealDifference'
import { calculateSimilarityScore, isSimilarToIdeal } from './similarity'
import { TargetEvaluationError } from './targetEvaluationTypes'
import {
  classifyCandidate,
  evaluateTargetCandidate,
  satisfiesIdealTarget,
} from './targetEvaluator'

const attack = 'bonus_type.fixture.attack'
const element = 'bonus_type.fixture.element'
const utility = 'bonus_type.fixture.utility'
const sharpness = 'bonus_type.fixture.sharpness'
const critical = 'bonus_type.fixture.critical'
const low = 'bonus_rank.fixture.low'
const middle = 'bonus_rank.fixture.middle'
const high = 'bonus_rank.fixture.high'
const special = 'bonus_rank.fixture.special'

function validTarget(): TargetWeapon {
  return createValidTargetWeapon()
}

function practicalOnlyBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus(attack, high),
    restorationBonus(attack, high),
    restorationBonus(element, middle),
    restorationBonus(utility, low),
    restorationBonus(critical, low),
  )
}

describe('Target candidate classification', () => {
  it('classifies ideal bonuses and ideal skills as ideal', () => {
    const target = validTarget()
    expect(
      classifyCandidate(
        target,
        target.idealBonuses,
        'series_skill.fixture.a',
        null,
        targetEvaluationMaster,
      ),
    ).toBe('ideal')
  })

  it('does not classify ideal bonuses as ideal when ideal skill mismatches', () => {
    const target = validTarget()
    expect(
      satisfiesIdealTarget(
        target,
        target.idealBonuses,
        'series_skill.fixture.other',
        null,
        targetEvaluationMaster,
      ),
    ).toBe(false)
  })

  it('throws an explicit Domain Error for an unknown result rank', () => {
    const target = validTarget()
    const unknownRankResult: RestorationBonusSet = [
      { ...target.idealBonuses[0], bonusRankId: 'bonus_rank.fixture.missing' },
      target.idealBonuses[1],
      target.idealBonuses[2],
      target.idealBonuses[3],
      target.idealBonuses[4],
    ]
    expect(() =>
      classifyCandidate(
        target,
        unknownRankResult,
        'series_skill.fixture.a',
        null,
        targetEvaluationMaster,
      ),
    ).toThrowError(/BonusRankMaster id 'bonus_rank.fixture.missing'/)
  })

  it('classifies a Practical-only result as practical', () => {
    expect(
      classifyCandidate(
        validTarget(),
        practicalOnlyBonuses(),
        null,
        null,
        targetEvaluationMaster,
      ),
    ).toBe('practical')
  })

  it('gives Ideal precedence when both Ideal and Practical match', () => {
    const target = validTarget()
    expect(
      classifyCandidate(
        target,
        target.idealBonuses,
        'series_skill.fixture.a',
        null,
        targetEvaluationMaster,
      ),
    ).toBe('ideal')
  })

  it('returns null when neither condition matches', () => {
    const result = restorationBonusSet(
      restorationBonus(utility, low),
      restorationBonus(utility, low),
      restorationBonus(utility, low),
      restorationBonus(utility, low),
      restorationBonus(utility, low),
    )
    expect(
      classifyCandidate(
        validTarget(),
        result,
        null,
        null,
        targetEvaluationMaster,
      ),
    ).toBeNull()
  })
})

describe('IdealDifference', () => {
  function duplicateTarget(): TargetWeapon {
    const target = validTarget()
    return {
      ...target,
      idealBonuses: restorationBonusSet(
        restorationBonus(attack, special),
        restorationBonus(attack, special),
        restorationBonus(sharpness, special),
        restorationBonus(sharpness, special),
        restorationBonus(element, special),
      ),
      idealSkillCondition: {
        seriesSkillId: 'series.fixture.ideal',
        groupSkillId: 'group.fixture.ideal',
        matchMode: 'all',
      },
    }
  }

  it('reports a complete 5/5 multiset match regardless of slot order', () => {
    const target = duplicateTarget()
    const reordered = restorationBonusSet(
      target.idealBonuses[4],
      target.idealBonuses[2],
      target.idealBonuses[0],
      target.idealBonuses[3],
      target.idealBonuses[1],
    )
    const difference = createIdealDifference(
      target,
      reordered,
      'series.fixture.ideal',
      'group.fixture.ideal',
    )
    expect(difference.matchedBonusCount).toBe(5)
    expect(difference.missingBonuses).toEqual([])
    expect(difference.extraBonuses).toEqual([])
  })

  it('handles duplicate shortages and extras with correct multiplicity', () => {
    const target = duplicateTarget()
    const candidate = restorationBonusSet(
      restorationBonus(attack, special),
      restorationBonus(sharpness, special),
      restorationBonus(sharpness, special),
      restorationBonus(element, special),
      restorationBonus(critical, special),
    )
    const difference = createIdealDifference(
      target,
      candidate,
      'series.fixture.ideal',
      'group.fixture.other',
    )
    expect(difference.matchedBonusCount).toBe(4)
    expect(difference.missingBonuses).toEqual([
      restorationBonus(attack, special),
    ])
    expect(difference.extraBonuses).toEqual([
      restorationBonus(critical, special),
    ])
    expect(difference.seriesSkillMatches).toBe(true)
    expect(difference.groupSkillMatches).toBe(false)
    expect(difference.summary).toBe(
      'ボーナス一致 4/5、シリーズ一致、グループ不一致',
    )
  })

  it('treats unspecified Ideal skills as matches', () => {
    const target = validTarget()
    target.idealSkillCondition = {
      seriesSkillId: null,
      groupSkillId: null,
      matchMode: 'any',
    }
    const difference = createIdealDifference(
      target,
      target.idealBonuses,
      null,
      null,
    )
    expect(difference.seriesSkillMatches).toBe(true)
    expect(difference.groupSkillMatches).toBe(true)
  })
})

describe('Similarity', () => {
  function difference(
    matchedBonusCount: number,
    seriesSkillMatches: boolean,
    groupSkillMatches: boolean,
  ): IdealDifference {
    return {
      missingBonuses: [],
      extraBonuses: [],
      matchedBonusCount,
      seriesSkillMatches,
      groupSkillMatches,
      summary: 'fixture',
    }
  }

  it('uses five comparable items when no Ideal skill is specified', () => {
    const target = validTarget()
    target.idealSkillCondition = {
      seriesSkillId: null,
      groupSkillId: null,
      matchMode: 'all',
    }
    expect(calculateSimilarityScore(target, difference(4, true, true))).toBe(
      4 / 5,
    )
  })

  it('counts only a specified and matching Ideal skill', () => {
    const target = validTarget()
    target.idealSkillCondition = {
      seriesSkillId: 'series.fixture.a',
      groupSkillId: null,
      matchMode: 'all',
    }
    expect(calculateSimilarityScore(target, difference(4, true, true))).toBe(
      5 / 6,
    )
    expect(calculateSimilarityScore(target, difference(4, false, true))).toBe(
      4 / 6,
    )
  })

  it('counts two specified Ideal skills independently', () => {
    const target = validTarget()
    target.idealSkillCondition = {
      seriesSkillId: 'series.fixture.a',
      groupSkillId: 'group.fixture.a',
      matchMode: 'all',
    }
    expect(calculateSimilarityScore(target, difference(4, true, false))).toBe(
      5 / 7,
    )
  })

  it('only marks Practical candidates at or above threshold as Similar', () => {
    expect(isSimilarToIdeal('ideal', 1, 0.6)).toBe(false)
    expect(isSimilarToIdeal('practical', 0.6, 0.6)).toBe(true)
    expect(isSimilarToIdeal('practical', 0.59, 0.6)).toBe(false)
    expect(isSimilarToIdeal(null, 1, 0.6)).toBe(false)
  })

  it('keeps the score within 0 through 1', () => {
    const target = validTarget()
    expect(calculateSimilarityScore(target, difference(-1, false, false))).toBe(
      0,
    )
    expect(calculateSimilarityScore(target, difference(99, true, true))).toBe(1)
  })

  it('rejects an invalid similarity threshold explicitly', () => {
    expect(() => isSimilarToIdeal('practical', 0.5, 1.1)).toThrow(
      TargetEvaluationError,
    )
  })
})

describe('evaluateTargetCandidate integration', () => {
  it('returns category, difference, score, and Similar flag from a predicted fixture result', () => {
    const result = evaluateTargetCandidate(
      validTarget(),
      practicalOnlyBonuses(),
      null,
      null,
      targetEvaluationMaster,
      0.6,
    )
    expect(result.category).toBe('practical')
    expect(result.idealDifference.matchedBonusCount).toBe(4)
    expect(result.similarityScore).toBe(4 / 6)
    expect(result.isSimilarToIdeal).toBe(true)
  })

  it('never marks an Ideal result as Similar', () => {
    const target = validTarget()
    const result = evaluateTargetCandidate(
      target,
      target.idealBonuses,
      'series_skill.fixture.a',
      null,
      targetEvaluationMaster,
      0,
    )
    expect(result.category).toBe('ideal')
    expect(result.similarityScore).toBe(1)
    expect(result.isSimilarToIdeal).toBe(false)
  })
})
