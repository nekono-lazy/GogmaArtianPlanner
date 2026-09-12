import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, candidateId, ownedWeaponId } from '../../test/fixtures/domainData'
import type { BuildCandidate, RestorationBonusSet } from '../models/publicTypes'
import { candidateStableKey, compareCanonicalIdeals, candidateDeduplicationKey } from './candidateProcessing'
import { isDestructiveCandidateRoute, selectCanonicalIdealCandidate } from './candidateRetention'
import { bonusOutcomeKey } from './semanticKeys'

function candidate(key = 'a', overrides: Partial<BuildCandidate> = {}): BuildCandidate {
  const c = createValidBuildCandidate()
  return { ...c, id: candidateId(key), restorationBonusScope: 'gogma_artian',
    estimatedOperationCount: 5, estimatedGogmaAdvance: 2, estimatedSkillAdvance: 2,
    estimatedNormalAdvance: null, requiredMaterials: [], ...overrides }
}

describe('canonical Ideal selection and semantic keys', () => {
  it.each([
    ['operations', { estimatedOperationCount: 4 }],
    ['Gogma', { estimatedGogmaAdvance: 1 }],
    ['Skill', { estimatedSkillAdvance: 1 }],
    ['Normal null last', { estimatedNormalAdvance: 0 }],
  ] as const)('prefers smaller %s before semantic identity', (_, override) => {
    const a = candidate('a')
    const b = candidate('z', { ...override })
    expect(compareCanonicalIdeals(b, a)).toBeLessThan(0)
  })

  it('orders numeric Normal advances and ignores non-cost quality attributes', () => {
    expect(compareCanonicalIdeals(candidate('z', { estimatedNormalAdvance: 1 }), candidate('a', { estimatedNormalAdvance: 2 }))).toBeLessThan(0)
    const a = candidate()
    const b = candidate('z', {
      idealDifference: { ...a.idealDifference, matchedBonusCount: 0 },
    })
    expect(compareCanonicalIdeals(a, b)).toBe(0)
  })

  it('uses the stable route key even with reversed IDs, runs, times and input order', () => {
    const a = candidate('z')
    const b = structuredClone(a)
    b.route.sourceOwnedWeaponId = ownedWeaponId('another-source')
    b.id = candidateId('a')
    const expected = [a, b].sort(compareCanonicalIdeals)[0]
    for (const values of [[a, b], [b, a]]) {
      const changed = values.map((c, i) => ({ ...c, id: candidateId(String(1 - i)), searchRunId: 'another-run',
        createdAt: '2026-09-05T00:00:00.000Z' }))
      expect(candidateStableKey(selectCanonicalIdealCandidate(changed)!))
        .toBe(candidateStableKey(expected))
    }
  })

  it('returns null when the search found no Ideal at all', () => {
    // No Ideal inside the configured extent means no Candidate and no
    // checkpoint: a compromise state found on the way is never returned,
    // because only a strict prefix of a real Ideal Route can be one
    // (`docs/SEARCH_SPEC.md` 5.7).
    expect(selectCanonicalIdealCandidate([])).toBeNull()
  })

  it('places the Target preferred source last, after every cost comparison', () => {
    const preferred = ownedWeaponId('owned.preferred')
    const cheaper = candidate('cheaper', { estimatedOperationCount: 4 })
    const preferredRoute = candidate('preferred')
    preferredRoute.route.sourceOwnedWeaponId = preferred
    // A cheaper non-preferred Route still wins.
    expect(selectCanonicalIdealCandidate([preferredRoute, cheaper], preferred)).toBe(cheaper)
    const tied = candidate('tied')
    tied.route.sourceOwnedWeaponId = ownedWeaponId('owned.other')
    expect(selectCanonicalIdealCandidate([tied, preferredRoute], preferred)).toBe(preferredRoute)
  })

  it('normalizes duplicate-aware multisets without delimiter collisions in all three consumers', () => {
    const a = candidate()
    const reordered = { ...a, finalBonuses: [...a.finalBonuses].reverse() as RestorationBonusSet }
    expect(candidateStableKey(reordered)).toBe(candidateStableKey(a))
    expect(candidateDeduplicationKey(reordered)).toBe(candidateDeduplicationKey(a))
    expect(bonusOutcomeKey(reordered.finalBonuses)).toBe(bonusOutcomeKey(a.finalBonuses))
    const b = structuredClone(a)
    a.finalBonuses[0] = { bonusTypeId: 'a/b', bonusRankId: 'c' }
    b.finalBonuses[0] = { bonusTypeId: 'a', bonusRankId: 'b/c' }
    expect(candidateStableKey(a)).not.toBe(candidateStableKey(b))
    expect(candidateDeduplicationKey(a)).not.toBe(candidateDeduplicationKey(b))
    expect(bonusOutcomeKey(a.finalBonuses)).not.toBe(bonusOutcomeKey(b.finalBonuses))
    b.finalBonuses[0] = b.finalBonuses[1]
    expect(bonusOutcomeKey(a.finalBonuses)).not.toBe(bonusOutcomeKey(b.finalBonuses))
  })

  it('no longer exposes a Practical dominance or an output cap', async () => {
    // Independent Practical Candidates do not exist, so nothing bounds a
    // retained Practical set and nothing conservatively drops one.
    const retention = (await import('./candidateRetention')) as Record<string, unknown>
    expect(retention.practicalDominates).toBeUndefined()
    expect(retention.retainInitialCandidates).toBeUndefined()
  })
})

describe('destructive route classification', () => {
  it('classifies operations from the Domain protection contract, never source presence alone', () => {
    const source = ownedWeaponId('owned.source')
    expect(isDestructiveCandidateRoute({ kind: 'existing_gogma_reset_skills', sourceOwnedWeaponId: source,
      operations: [{ type: 'reset_skills', sourceOwnedWeaponId: source, skillCounterBefore: 0, skillCounterAfter: 1 }] })).toBe(false)
    for (const type of ['reset_bonuses', 'keep_bonuses'] as const) {
      expect(isDestructiveCandidateRoute({ kind: 'existing_gogma_mixed', sourceOwnedWeaponId: null,
        operations: [{ type, sourceOwnedWeaponId: null, gogmaCounterBefore: 0, gogmaCounterAfter: 1 }] })).toBe(true)
    }
    const conversion = { type: 'convert_normal_to_gogma' as const, weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 0, skillCounterAfter: 1 }
    expect(isDestructiveCandidateRoute({ kind: 'owned_normal_artian_to_gogma', sourceOwnedWeaponId: source, operations: [conversion] })).toBe(true)
    expect(isDestructiveCandidateRoute({ kind: 'normal_artian_to_gogma', sourceOwnedWeaponId: null, operations: [conversion] })).toBe(false)
  })
})
