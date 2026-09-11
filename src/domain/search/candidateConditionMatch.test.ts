import { describe, expect, it } from 'vitest'
import { createCandidateSearchInput, practicalOnlyBonuses } from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { createBuildListEntry, createBuildCandidateMeaningFingerprint } from '../buildList'
import { validateBuildCandidate } from '../models/validation'
import { createCandidateFromPrediction } from './candidateFactory'
import { createSearchExecutionContext } from './searchExecution'
import { candidateStableKey, candidateDeduplicationKey } from './candidateProcessing'

describe('Candidate condition match metadata', () => {
  it.each(['ideal', 'practical', 'alternative'] as const)('preserves %s Bonus and independent Skill acceptance in Build List snapshots', (bonusMatch) => {
    const input = createCandidateSearchInput(), target = input.targetWeapons[0]
    input.ownedWeapons[0].isProtected = false
    const bonuses = bonusMatch === 'alternative' ? practicalOnlyBonuses() : createRestorationBonusSet()
    if (bonusMatch === 'practical') bonuses[4].bonusRankId = 'bonus_rank.fixture.low'
    const candidate = createCandidateFromPrediction(target, {
      finalBonuses: bonuses, restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: 'group_skill.fixture.a',
      route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] },
    }, input, createSearchExecutionContext())
    expect(candidate).not.toBeNull()
    if (!candidate) throw new Error('Expected accepted Candidate')
    expect(candidate.category).toBe('practical')
    expect(candidate.conditionMatch).toEqual({ bonus: bonusMatch, skill: 'practical' })
    expect(createBuildListEntry(candidate, target).candidateSnapshot.conditionMatch).toEqual(candidate.conditionMatch)
    const historical = structuredClone(candidate)
    delete historical.conditionMatch
    expect(validateBuildCandidate(historical).isValid).toBe(true)
    expect(candidateStableKey(historical)).toBe(candidateStableKey(candidate))
    expect(candidateDeduplicationKey(historical)).toBe(candidateDeduplicationKey(candidate))
    expect(createBuildCandidateMeaningFingerprint(historical)).toBe(createBuildCandidateMeaningFingerprint(candidate))
    expect(historical.searchStateHash).toBe(candidate.searchStateHash)
    const invalid = { ...candidate, category: 'ideal' as const }
    expect(validateBuildCandidate(invalid).isValid).toBe(false)
  })
})
