import { describe, expect, it } from 'vitest'
import { MasterDataDomainError } from '../master/masterSelectors'
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
  satisfiesIdealBonuses,
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
  const target = createValidTargetWeapon()
  target.alternativeBonusRules[0].options.push({ alternativeBonusTypeId: critical, minimumRankId: low, requiredExCount: 0 })
  return target
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
  it('rejects a normal-scope exact-label result despite full similarity', () => {
    const target = validTarget()
    expect(satisfiesIdealBonuses(target, target.idealBonuses, 'normal_artian', targetEvaluationMaster)).toBe(false)
    expect(satisfiesIdealTarget(target, target.idealBonuses, 'normal_artian', 'series_skill.fixture.a', null, targetEvaluationMaster)).toBe(false)
    const result = evaluateTargetCandidate(
      target, target.idealBonuses, 'normal_artian',
      'series_skill.fixture.a', null, targetEvaluationMaster, 0.6,
    )
    expect(result).toMatchObject({
      category: null,
      idealDifference: { matchedBonusCount: 5, seriesSkillMatches: true, groupSkillMatches: true },
      similarityScore: 1,
      isSimilarToIdeal: false,
    })
  })

  it.each(['target', 'result'] as const)('validates unknown %s ranks before rejecting normal scope', (side) => {
    const target = validTarget()
    const result = structuredClone(target.idealBonuses)
    const bonuses = side === 'target' ? target.idealBonuses : result
    bonuses[0].bonusRankId = 'bonus_rank.fixture.missing'
    expect(() => satisfiesIdealBonuses(target, result, 'normal_artian', targetEvaluationMaster))
      .toThrow(MasterDataDomainError)
    expect(() => evaluateTargetCandidate(
      target, result, 'normal_artian', null, null, targetEvaluationMaster, 0.6,
    )).toThrow(/BonusRankMaster id 'bonus_rank.fixture.missing'/)
  })

  it('classifies ideal bonuses and ideal skills as ideal', () => {
    const target = validTarget()
    expect(
      classifyCandidate(
        target,
        target.idealBonuses,
        'gogma_artian',
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
        'gogma_artian',
        'series_skill.fixture.other',
        null,
        targetEvaluationMaster,
      ),
    ).toBe(false)
  })

  it.each(['normal_artian', 'gogma_artian'] as const)('throws an explicit Domain Error for an unknown result rank in %s', (scope) => {
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
        scope,
        'series_skill.fixture.a',
        null,
        targetEvaluationMaster,
      ),
    ).toThrowError(/BonusRankMaster id 'bonus_rank.fixture.missing'/)
  })

  it.each(['normal_artian', 'gogma_artian'] as const)('classifies a Practical-only result in %s as practical', (scope) => {
    expect(
      classifyCandidate(
        validTarget(),
        practicalOnlyBonuses(),
        scope,
        null,
        'group_skill.fixture.a',
        targetEvaluationMaster,
      ),
    ).toBe(scope === 'gogma_artian' ? 'practical' : null)
  })

  it('gives Ideal precedence when both Ideal and Practical match', () => {
    const target = validTarget()
    expect(
      classifyCandidate(
        target,
        target.idealBonuses,
        'gogma_artian',
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
        'gogma_artian',
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
      'gogma_artian',
      null,
      'group_skill.fixture.a',
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
      'gogma_artian',
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
