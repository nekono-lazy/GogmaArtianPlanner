import { describe, expect, it } from 'vitest'
import { createCandidateSearchInput, practicalOnlyBonuses } from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { createBuildListEntry, createBuildCandidateMeaningFingerprint } from '../buildList'
import { validateBuildCandidate } from '../models/validation'
import { createCandidateFromPrediction } from './candidateFactory'
import { createSearchExecutionContext } from './searchExecution'
import { candidateStableKey, candidateDeduplicationKey } from './candidateProcessing'

describe('Candidate acceptance is Ideal-only', () => {
  it.each(['practical', 'alternative'] as const)(
    'refuses a %s Bonus result as a Candidate of its own',
    (bonusMatch) => {
      const input = createCandidateSearchInput(), target = input.targetWeapons[0]
      input.ownedWeapons[0].isProtected = false
      const bonuses = bonusMatch === 'alternative' ? practicalOnlyBonuses() : createRestorationBonusSet()
      if (bonusMatch === 'practical') bonuses[4].bonusRankId = 'bonus_rank.fixture.low'
      // A compromise result is never an independent Candidate: it reaches the
      // user only as a checkpoint on a real Ideal Route
      // (`docs/SEARCH_SPEC.md` 5.5.4).
      expect(createCandidateFromPrediction(target, {
        finalBonuses: bonuses, restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: 'group_skill.fixture.a',
        route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] },
      }, input, createSearchExecutionContext())).toBeNull()
    },
  )

  it('accepts the Ideal result and carries no category or condition match at all', () => {
    const input = createCandidateSearchInput(), target = input.targetWeapons[0]
    input.ownedWeapons[0].isProtected = false
    const candidate = createCandidateFromPrediction(target, {
      finalBonuses: structuredClone(target.idealBonuses), restorationBonusScope: 'gogma_artian',
      seriesSkillId: 'series_skill.fixture.a', groupSkillId: null,
      route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] },
      bonusAmendmentResults: [{
        restorationBonuses: structuredClone(target.idealBonuses),
        restorationBonusScope: 'gogma_artian',
      }],
      skillAmendmentResults: [],
    }, input, createSearchExecutionContext())
    expect(candidate).not.toBeNull()
    if (!candidate) throw new Error('Expected accepted Candidate')
    const record = candidate as unknown as Record<string, unknown>
    expect(record.category).toBeUndefined()
    expect(record.conditionMatch).toBeUndefined()
    expect(record.similarityScore).toBeUndefined()
    expect(record.isSimilarToIdeal).toBeUndefined()
    expect(validateBuildCandidate(candidate, input.ownedWeapons).isValid).toBe(true)
    expect(createBuildListEntry(candidate, target).candidateSnapshot.checkpointGroups)
      .toEqual(candidate.checkpointGroups)
  })

  it('keeps checkpoint groups out of every Candidate identity', () => {
    const input = createCandidateSearchInput(), target = input.targetWeapons[0]
    input.ownedWeapons[0].isProtected = false
    const candidate = createCandidateFromPrediction(target, {
      finalBonuses: structuredClone(target.idealBonuses), restorationBonusScope: 'gogma_artian',
      seriesSkillId: 'series_skill.fixture.a', groupSkillId: null,
      route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: input.ownedWeapons[0].id, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] },
    }, input, createSearchExecutionContext())
    if (!candidate) throw new Error('Expected accepted Candidate')
    const historical = structuredClone(candidate)
    delete historical.checkpointGroups
    expect(candidateStableKey(historical)).toBe(candidateStableKey(candidate))
    expect(candidateDeduplicationKey(historical)).toBe(candidateDeduplicationKey(candidate))
    expect(createBuildCandidateMeaningFingerprint(historical)).toBe(createBuildCandidateMeaningFingerprint(candidate))
    expect(historical.searchStateHash).toBe(candidate.searchStateHash)
    expect(historical.referencedOwnedWeaponsHash).toBe(candidate.referencedOwnedWeaponsHash)
  })
})
