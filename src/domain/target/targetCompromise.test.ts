import { describe, expect, it } from 'vitest'
import { createValidTargetWeapon } from '../../test/fixtures/domainData'
import { targetEvaluationMaster as master } from '../../test/fixtures/targetEvaluation'
import type { RestorationBonusSet, TargetWeapon } from '../models/publicTypes'
import { evaluateTargetCandidate, hasTargetCompromise } from './targetEvaluator'
import { validateTargetIdealImpliesPractical } from './targetInvariantValidation'

const EX = 'bonus_rank.fixture.special'
const III = 'bonus_rank.fixture.high'
const II = 'bonus_rank.fixture.middle'
const bonuses = (...slots: Array<[string, string]>): RestorationBonusSet => slots.map(([bonusTypeId, bonusRankId]) => ({ bonusTypeId, bonusRankId })) as RestorationBonusSet
const ideal = () => bonuses(['sharp', EX], ['element', EX], ['element', EX], ['attack', EX], ['attack', EX])
const practical = () => bonuses(['sharp', EX], ['element', EX], ['element', II], ['attack', III], ['attack', EX])
const alternative = (rank = EX) => bonuses(['sharp', EX], ['element', EX], ['element', EX], ['attack', EX], ['affinity', rank])
function target(): TargetWeapon {
  return {
    ...createValidTargetWeapon(), idealBonuses: ideal(),
    practicalBonusConditions: [
      { id: 'attack', bonusTypeId: 'attack', minimumRankId: III, requiredExCount: 1 },
      { id: 'element', bonusTypeId: 'element', minimumRankId: II, requiredExCount: 1 },
    ],
    alternativeBonusRules: [{ id: 'replace', sourceBonusTypeId: 'attack', maxReplacementCount: 1, options: [{ alternativeBonusTypeId: 'affinity', minimumRankId: EX, requiredExCount: 1 }] }],
    idealSkillCondition: { seriesSkillId: 'series', groupSkillId: 'group', matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: 'series', groupSkillId: null, matchMode: 'all' },
  }
}
function evaluate(value: RestorationBonusSet, t = target(), skill: 'ideal' | 'practical' = 'ideal') {
  return evaluateTargetCandidate(t, value, 'gogma_artian', 'series', skill === 'ideal' ? 'group' : 'other', master, 0.6)
}

describe('Ideal-based compromise semantics', () => {
  it('matches Ideal as an unordered multiset with exact duplicate counts', () => {
    expect(evaluate(ideal().reverse() as RestorationBonusSet)).toMatchObject({ category: 'ideal', bonusMatch: 'ideal', skillMatch: 'ideal' })
    const changed = ideal(); changed[1] = { ...changed[3] }
    expect(evaluate(changed).category).toBeNull()
  })
  it('accepts the requested Practical example and rejects missing EX / unconfigured rank relaxation', () => {
    expect(evaluate(practical())).toMatchObject({ category: 'practical', bonusMatch: 'practical' })
    const noEx = ideal(); noEx[3].bonusRankId = III; noEx[4].bonusRankId = III
    expect(evaluate(noEx).category).toBeNull()
    const sharpRelaxed = practical(); sharpRelaxed[0].bonusRankId = III
    expect(evaluate(sharpRelaxed).category).toBeNull()
  })
  it('preserves a mixed Ideal rank multiset for an unconfigured type', () => {
    const t = target(); t.idealBonuses[3].bonusRankId = III
    t.practicalBonusConditions = t.practicalBonusConditions.filter((condition) => condition.bonusTypeId !== 'attack')
    expect(evaluate(t.idealBonuses, t).category).toBe('ideal')
    expect(evaluate(ideal(), t).category).toBeNull()
  })
  it('accepts one replacement but forbids rank relaxation elsewhere and excess replacements', () => {
    expect(evaluate(alternative())).toMatchObject({ category: 'practical', bonusMatch: 'alternative' })
    const relaxed = alternative(); relaxed[1].bonusRankId = II
    expect(evaluate(relaxed).category).toBeNull()
    const excess = alternative(); excess[3] = { ...excess[4] }
    expect(evaluate(excess).category).toBeNull()
  })
  it('relaxes replacement rank only; preserves unreplaced attack EX', () => {
    const t = target(); t.alternativeBonusRules[0].options[0] = { alternativeBonusTypeId: 'affinity', minimumRankId: III, requiredExCount: 0 }
    expect(evaluate(alternative(III), t).bonusMatch).toBe('alternative')
    const changed = alternative(III); changed[3].bonusRankId = III
    expect(evaluate(changed, t).category).toBeNull()
  })
  it('uses maximum as an upper bound and EX count within actual replacements', () => {
    const t = target(); t.alternativeBonusRules[0].maxReplacementCount = 2
    t.alternativeBonusRules[0].options[0].minimumRankId = III
    expect(evaluate(alternative(), t).bonusMatch).toBe('alternative')
    const two = alternative(); two[3] = { bonusTypeId: 'affinity', bonusRankId: III }
    expect(evaluate(two, t).bonusMatch).toBe('alternative')
    two[4].bonusRankId = III
    expect(evaluate(two, t).category).toBeNull()
  })
  it('never mixes source rules or options of one rule', () => {
    const t = target(); t.alternativeBonusRules.push({ id: 'element-rule', sourceBonusTypeId: 'element', maxReplacementCount: 1, options: [{ alternativeBonusTypeId: 'sharp', minimumRankId: EX, requiredExCount: 0 }] })
    const compound = alternative(); compound[1] = { ...compound[0] }
    expect(evaluate(compound, t).category).toBeNull()
    t.alternativeBonusRules[0].maxReplacementCount = 2
    t.alternativeBonusRules[0].options.push({ alternativeBonusTypeId: 'other', minimumRankId: EX, requiredExCount: 0 })
    const mixed = alternative(); mixed[3] = { bonusTypeId: 'other', bonusRankId: EX }
    expect(evaluate(mixed, t).category).toBeNull()
  })
  it('does not count original destination EX slots as replacement EX', () => {
    const t = target(); t.alternativeBonusRules[0].options[0] = { alternativeBonusTypeId: 'element', minimumRankId: III, requiredExCount: 1 }
    const slots = ideal(); slots[4] = { bonusTypeId: 'element', bonusRankId: III }
    expect(evaluate(slots, t).category).toBeNull()
    slots[4].bonusRankId = EX
    expect(evaluate(slots, t).bonusMatch).toBe('alternative')
  })
  it.each([
    ['ideal', 'practical'], ['practical', 'ideal'], ['practical', 'practical'],
    ['alternative', 'ideal'], ['alternative', 'practical'],
  ] as const)('combines Bonus %s with Skill %s', (bonus, skill) => {
    const slots = bonus === 'ideal' ? ideal() : bonus === 'practical' ? practical() : alternative()
    expect(evaluate(slots, target(), skill)).toMatchObject({ category: 'practical', bonusMatch: bonus, skillMatch: skill })
  })
  it('has no Skill wildcard when Practical Skill is unset', () => {
    const t = target(); t.practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'any' }
    expect(evaluate(ideal(), t, 'practical').category).toBeNull()
  })
  it('uses Ideal only when every compromise is unset', () => {
    const t = target(); t.practicalBonusConditions = []; t.alternativeBonusRules = []
    t.practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
    expect(hasTargetCompromise(t)).toBe(false)
    expect(evaluate(ideal(), t).category).toBe('ideal')
    expect(evaluate(practical(), t).category).toBeNull()
    expect(evaluate(alternative(), t).category).toBeNull()
    t.practicalSkillCondition.seriesSkillId = 'series'
    expect(hasTargetCompromise(t)).toBe(true)
    expect(evaluate(ideal(), t, 'practical').category).toBe('practical')
  })
  it.each([ideal, practical, alternative])('rejects normal scope regardless of matching labels', (slots) => {
    expect(evaluateTargetCandidate(target(), slots(), 'normal_artian', 'series', 'group', master, 0.6).category).toBeNull()
  })
})

describe('compromise validation', () => {
  it('accepts the valid example', () => expect(validateTargetIdealImpliesPractical(target(), master).isValid).toBe(true))
  const invalid: Array<[string, (t: TargetWeapon) => void]> = [
    ['absent Practical type', t => { t.practicalBonusConditions[0].bonusTypeId = 'absent' }],
    ['duplicate Practical type', t => { t.practicalBonusConditions.push({ ...t.practicalBonusConditions[0] }) }],
    ['unknown minimum', t => { t.practicalBonusConditions[0].minimumRankId = 'missing' }],
    ['negative EX', t => { t.practicalBonusConditions[0].requiredExCount = -1 }],
    ['excess EX', t => { t.practicalBonusConditions[0].requiredExCount = 3 }],
    ['fractional EX', t => { t.practicalBonusConditions[0].requiredExCount = 0.5 }],
    ['Ideal below minimum', t => { t.idealBonuses[3].bonusRankId = II }],
    ['Ideal missing EX', t => { t.idealBonuses[3].bonusRankId = III; t.idealBonuses[4].bonusRankId = III }],
    ['absent source', t => { t.alternativeBonusRules[0].sourceBonusTypeId = 'absent' }],
    ['duplicate source', t => { t.alternativeBonusRules.push({ ...t.alternativeBonusRules[0] }) }],
    ['zero maximum', t => { t.alternativeBonusRules[0].maxReplacementCount = 0 }],
    ['excess maximum', t => { t.alternativeBonusRules[0].maxReplacementCount = 3 }],
    ['fractional maximum', t => { t.alternativeBonusRules[0].maxReplacementCount = 1.5 }],
    ['empty options', t => { t.alternativeBonusRules[0].options = [] }],
    ['same source and destination', t => { t.alternativeBonusRules[0].options[0].alternativeBonusTypeId = 'attack' }],
    ['duplicate option', t => { t.alternativeBonusRules[0].options.push({ ...t.alternativeBonusRules[0].options[0] }) }],
    ['unknown alternative rank', t => { t.alternativeBonusRules[0].options[0].minimumRankId = 'missing' }],
    ['excess alternative EX', t => { t.alternativeBonusRules[0].options[0].requiredExCount = 2 }],
    ['negative alternative EX', t => { t.alternativeBonusRules[0].options[0].requiredExCount = -1 }],
  ]
  it.each(invalid)('rejects %s', (_, mutate) => {
    const t = target(); mutate(t)
    expect(validateTargetIdealImpliesPractical(t, master).isValid).toBe(false)
  })
})
