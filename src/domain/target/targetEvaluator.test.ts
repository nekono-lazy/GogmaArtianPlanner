import { describe, expect, it } from 'vitest'
import { MasterDataDomainError } from '../master/masterSelectors'
import type {
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
import {
  evaluateCompromiseCheckpointCondition,
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

/**
 * The old `classifyCandidate()` meaning, rebuilt from the two axes the Target
 * evaluator still exposes.
 *
 * A state matching both axes at Ideal is an Ideal result; a state matching both
 * axes with at least one compromise is a checkpoint state; a state matching
 * neither is not accepted at all. Candidate Search now composes only the first
 * of the three, and the second reaches the user as a checkpoint on the
 * canonical Ideal Route (`docs/SEARCH_SPEC.md` 5.8).
 */
function classifyResult(
  ...args: Parameters<typeof evaluateCompromiseCheckpointCondition>
): 'ideal' | 'practical' | null {
  const [target, bonuses, scope, series, group, master] = args
  if (satisfiesIdealTarget(target, bonuses, scope, series, group, master)) return 'ideal'
  return evaluateCompromiseCheckpointCondition(target, bonuses, scope, series, group, master) === null
    ? null
    : 'practical'
}

describe('Target candidate classification', () => {
  it('rejects a normal-scope exact-label result despite full similarity', () => {
    const target = validTarget()
    expect(satisfiesIdealBonuses(target, target.idealBonuses, 'normal_artian', targetEvaluationMaster)).toBe(false)
    expect(satisfiesIdealTarget(target, target.idealBonuses, 'normal_artian', 'series_skill.fixture.a', null, targetEvaluationMaster)).toBe(false)
    const result = evaluateTargetCandidate(
      target, target.idealBonuses, 'normal_artian',
      'series_skill.fixture.a', null, targetEvaluationMaster,
    )
    // Every Bonus match requires Gogma scope, so a Normal-scope result matching
    // all five labels is neither an Ideal Candidate nor a checkpoint state.
    expect(result).toMatchObject({
      bonusMatch: null,
      idealDifference: { matchedBonusCount: 5, seriesSkillMatches: true, groupSkillMatches: true },
    })
    expect(classifyResult(
      target, target.idealBonuses, 'normal_artian',
      'series_skill.fixture.a', null, targetEvaluationMaster,
    )).toBeNull()
  })

  it.each(['target', 'result'] as const)('validates unknown %s ranks before rejecting normal scope', (side) => {
    const target = validTarget()
    const result = structuredClone(target.idealBonuses)
    const bonuses = side === 'target' ? target.idealBonuses : result
    bonuses[0].bonusRankId = 'bonus_rank.fixture.missing'
    expect(() => satisfiesIdealBonuses(target, result, 'normal_artian', targetEvaluationMaster))
      .toThrow(MasterDataDomainError)
    expect(() => evaluateTargetCandidate(
      target, result, 'normal_artian', null, null, targetEvaluationMaster,
    )).toThrow(/BonusRankMaster id 'bonus_rank.fixture.missing'/)
  })

  it('classifies ideal bonuses and ideal skills as ideal', () => {
    const target = validTarget()
    expect(
      classifyResult(
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
      classifyResult(
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
      classifyResult(
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
      classifyResult(
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
      classifyResult(
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

describe('evaluateTargetCandidate integration', () => {
  it('returns the two axis matches and the ideal difference, and carries no similarity metadata', () => {
    const result = evaluateTargetCandidate(
      validTarget(),
      practicalOnlyBonuses(),
      'gogma_artian',
      null,
      'group_skill.fixture.a',
      targetEvaluationMaster,
    )
    // This five-slot result matches through the Target's Alternative Rule,
    // which is a compromise match on the Bonus axis just like `practical`.
    expect(result.bonusMatch).toBe('alternative')
    expect(result.skillMatch).toBe('practical')
    expect(result.idealDifference.matchedBonusCount).toBe(4)
    // The similarity concept is gone: the compromise conditions themselves
    // decide a checkpoint, never a closeness score (`docs/SEARCH_SPEC.md` 5.3).
    expect(Object.keys(result).sort()).toEqual([
      'bonusMatch',
      'idealDifference',
      'skillMatch',
    ])
  })

  it('reports a full Ideal result on both axes and offers it as no checkpoint', () => {
    const target = validTarget()
    const result = evaluateTargetCandidate(
      target,
      target.idealBonuses,
      'gogma_artian',
      'series_skill.fixture.a',
      null,
      targetEvaluationMaster,
    )
    expect(result.bonusMatch).toBe('ideal')
    expect(result.skillMatch).toBe('ideal')
    // The Ideal result completes the Route, so it is never a checkpoint.
    expect(evaluateCompromiseCheckpointCondition(
      target,
      target.idealBonuses,
      'gogma_artian',
      'series_skill.fixture.a',
      null,
      targetEvaluationMaster,
    )).toBeNull()
  })
})
