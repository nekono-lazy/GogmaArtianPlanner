import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, candidateId, ownedWeaponId } from '../../test/fixtures/domainData'
import { createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import type { BuildCandidate, RestorationBonusSet } from '../models/publicTypes'
import { candidateStableKey, compareCanonicalIdeals, compareCandidateSelection, candidateDeduplicationKey } from './candidateProcessing'
import { isDestructiveCandidateRoute, practicalDominates, retainInitialCandidates } from './candidateRetention'
import { bonusOutcomeKey } from './semanticKeys'

function candidate(key = 'a', overrides: Partial<BuildCandidate> = {}): BuildCandidate {
  const c = createValidBuildCandidate()
  return { ...c, id: candidateId(key), category: 'practical', restorationBonusScope: 'gogma_artian',
    estimatedOperationCount: 5, estimatedGogmaAdvance: 2, estimatedSkillAdvance: 2,
    estimatedNormalAdvance: null, requiredMaterials: [], ...overrides }
}
function masterFor(...candidates: BuildCandidate[]) {
  const master = createCandidateSearchInput().master
  const types = new Set(candidates.flatMap((c) => c.finalBonuses.map((b) => b.bonusTypeId)))
  master.bonusTypes = [...types].map((id) => ({ id, displayNameJa: id, displayNameEn: id, sortOrder: 0, category: 'offense', isEnabled: true }))
  master.weaponBonusDefinitions = [...types].flatMap((bonusTypeId) => master.bonusRanks.map((rank) => ({
    id: bonusTypeId + rank.id, weaponTypeId: 'weapon.fixture.a', bonusTypeId, bonusRankId: rank.id,
    scope: 'gogma_artian' as const, displayNameJa: '', displayNameEn: '', effectValue: '', sortOrder: 0, isEnabled: true,
  })))
  return master
}
function dominates(b: BuildCandidate, a: BuildCandidate) {
  return practicalDominates(b, a, masterFor(a, b), 'weapon.fixture.a')
}
function ranked(orders: string[]): RestorationBonusSet {
  return orders.map((rank) => ({ bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.' + rank })) as RestorationBonusSet
}

describe('B4 canonical Ideal and semantic keys', () => {
  it.each([
    ['operations', { estimatedOperationCount: 4 }],
    ['Gogma', { estimatedGogmaAdvance: 1 }],
    ['Skill', { estimatedSkillAdvance: 1 }],
    ['Normal null last', { estimatedNormalAdvance: 0 }],
  ] as const)('prefers smaller %s before semantic identity', (_, override) => {
    const a = candidate('a', { category: 'ideal' })
    const b = candidate('z', { ...override, category: 'ideal' })
    expect(compareCanonicalIdeals(b, a)).toBeLessThan(0)
  })

  it('orders numeric Normal advances and ignores Ideal quality attributes', () => {
    expect(compareCanonicalIdeals(candidate('z', { estimatedNormalAdvance: 1 }), candidate('a', { estimatedNormalAdvance: 2 }))).toBeLessThan(0)
    const a = candidate()
    const b = candidate('z', { category: 'ideal', similarityScore: 0,
      idealDifference: { ...a.idealDifference, matchedBonusCount: 0 } })
    expect(compareCanonicalIdeals(a, b)).toBe(0)
  })

  it('uses the stable route key even with reversed IDs, runs, times and input order', () => {
    const a = candidate('z', { category: 'ideal' })
    const b = structuredClone(a)
    b.route.sourceOwnedWeaponId = ownedWeaponId('another-source')
    b.id = candidateId('a')
    const expected = [a, b].sort(compareCanonicalIdeals)[0]
    const master = masterFor(a)
    for (const values of [[a, b], [b, a]]) {
      const changed = values.map((c, i) => ({ ...c, id: candidateId(String(1 - i)), searchRunId: 'another-run',
        createdAt: '2026-09-05T00:00:00.000Z' }))
      expect(candidateStableKey(retainInitialCandidates(changed, master, 'weapon.fixture.a', 1).canonicalIdeal!))
        .toBe(candidateStableKey(expected))
    }
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
})

describe('B4 conservative Practical dominance', () => {
  it('compares ranks per type as descending vectors, ignoring slot order', () => {
    const a = candidate('a', { finalBonuses: ranked(['high', 'middle', 'low', 'low', 'low']) })
    const b = candidate('b', { finalBonuses: ranked(['low', 'special', 'low', 'middle', 'low']) })
    expect(dominates(b, a)).toBe(true)
    b.finalBonuses = ranked(['special', 'low', 'low', 'low', 'low'])
    expect(dominates(b, a)).toBe(false)
    expect(dominates(a, b)).toBe(false)
  })

  it.each([
    ['Bonus type counts', (c: BuildCandidate) => { c.finalBonuses[0].bonusTypeId = 'different' }],
    ['Series', (c: BuildCandidate) => { c.seriesSkillId = 'different' }],
    ['Group', (c: BuildCandidate) => { c.groupSkillId = 'different' }],
    ['source', (c: BuildCandidate) => { c.route.sourceOwnedWeaponId = ownedWeaponId('different') }],
    ['destructive class', (c: BuildCandidate) => { c.route.operations.push({ type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 0, gogmaCounterAfter: 1 }) }],
    ['operation cost', (c: BuildCandidate) => { c.estimatedOperationCount = 6 }],
    ['Gogma advance', (c: BuildCandidate) => { c.estimatedGogmaAdvance = 3 }],
    ['Skill advance', (c: BuildCandidate) => { c.estimatedSkillAdvance = 3 }],
    ['Normal null/number', (c: BuildCandidate) => { c.estimatedNormalAdvance = 0 }],
    ['scope', (c: BuildCandidate) => { c.restorationBonusScope = 'normal_artian' }],
    ['material IDs', (c: BuildCandidate) => { c.requiredMaterials = [{ materialId: 'Y', quantity: 1 }] }],
  ])('does not dominate when %s is incomparable or worse', (_, change) => {
    const a = candidate()
    const b = structuredClone(a)
    b.estimatedOperationCount = 4
    change(b)
    expect(dominates(b, a)).toBe(false)
  })

  it('compares numeric Normal advance and demands at least one strict improvement', () => {
    const a = candidate('a', { estimatedNormalAdvance: 2 })
    expect(dominates(structuredClone(a), a)).toBe(false)
    expect(dominates({ ...a, estimatedNormalAdvance: 1 }, a)).toBe(true)
    expect(dominates({ ...a, estimatedNormalAdvance: 3, estimatedOperationCount: 4 }, a)).toBe(false)
    expect(dominates({ ...a, estimatedOperationCount: 4 }, a)).toBe(true)
  })

  it('uses the materialId union, missing zero, duplicate sums, and preserves trade-offs', () => {
    const a = candidate('a', { requiredMaterials: [{ materialId: 'X', quantity: 2 }] })
    const b = candidate('b', { requiredMaterials: [{ materialId: 'X', quantity: 1 }] })
    expect(dominates(b, a)).toBe(true)
    b.requiredMaterials = [{ materialId: 'Y', quantity: 1 }]
    expect(dominates(b, a)).toBe(false)
    a.requiredMaterials.push({ materialId: 'Y', quantity: 1 })
    b.requiredMaterials = [{ materialId: 'X', quantity: 1 }, { materialId: 'Y', quantity: 2 }]
    expect(dominates(b, a)).toBe(false)
    expect(dominates(a, b)).toBe(false)
    b.requiredMaterials = [{ materialId: 'X', quantity: 1 }, { materialId: 'X', quantity: 1 }, { materialId: 'Y', quantity: 1 }]
    expect(dominates(b, a)).toBe(false)
    b.requiredMaterials = []
    expect(dominates(b, a)).toBe(true)
  })

  it('does not guess missing, disabled, ambiguous, or unsafe Master ordering', () => {
    const a = candidate()
    const b = { ...a, estimatedOperationCount: 4 }
    for (const mutate of [
      (m: ReturnType<typeof masterFor>) => { m.bonusRanks = [] },
      (m: ReturnType<typeof masterFor>) => { m.bonusRanks.forEach((r) => { r.isEnabled = false }) },
      (m: ReturnType<typeof masterFor>) => { m.weaponBonusDefinitions = [] },
      (m: ReturnType<typeof masterFor>) => { m.bonusRanks.push(...m.bonusRanks) },
      (m: ReturnType<typeof masterFor>) => { m.bonusRanks.forEach((r) => { r.order = NaN }) },
    ]) {
      const master = masterFor(a)
      mutate(master)
      expect(practicalDominates(b, a, master, 'weapon.fixture.a')).toBe(false)
    }
  })

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

describe('B4 horizon and bounded retention', () => {
  function distinct(cost: number, key: string) {
    const c = candidate(key, { estimatedOperationCount: cost })
    c.route.sourceOwnedWeaponId = ownedWeaponId(key)
    return c
  }
  it('includes Practical at 2 and D=5, excludes 6 regardless of discovery order', () => {
    const ideal = distinct(5, 'ideal')
    ideal.category = 'ideal'
    const values = [distinct(6, 'far'), ideal, distinct(2, 'near'), distinct(5, 'edge')]
    for (const list of [values, [...values].reverse()]) {
      const retained = retainInitialCandidates(list, masterFor(ideal), 'weapon.fixture.a', 200)
      expect(retained.horizon.map((c) => c.estimatedOperationCount).sort()).toEqual([2, 5])
      expect(retained.bounded.map((c) => c.id)).toEqual(['ideal', 'near', 'edge'])
    }
  })
  it('applies dominance only to horizon Practical', () => {
    const a = distinct(5, 'same')
    const b = { ...a, id: candidateId('better'), estimatedOperationCount: 4,
      finalBonuses: ranked(['special', 'high', 'middle', 'low', 'low']) }
    a.finalBonuses = ranked(['high', 'high', 'middle', 'low', 'low'])
    const result = retainInitialCandidates([a, b], masterFor(a,b), 'weapon.fixture.a', 200)
    expect(result.horizon).toHaveLength(2)
    expect(result.bounded).toEqual([b])
  })
  it('keeps top three without Ideal; reserves one Ideal slot under Practical overflow', () => {
    const values = [distinct(5, 'd'), distinct(4, 'c'), distinct(3, 'b'), distinct(2, 'a')]
    const master = masterFor(...values)
    expect(retainInitialCandidates(values, master, 'weapon.fixture.a', 3).bounded.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    const ideal = distinct(5, 'ideal')
    ideal.category = 'ideal'
    const withIdeal = retainInitialCandidates([...values, ideal], master, 'weapon.fixture.a', 3)
    expect(withIdeal.bounded.map((c) => c.id)).toEqual(['ideal', 'a', 'b'])
    expect(retainInitialCandidates([...values, ideal], master, 'weapon.fixture.a', 1).bounded).toEqual([ideal])
  })
  it('bounds Practical using stable ties, independently of Candidate IDs', () => {
    const values = ['a', 'b', 'c', 'd'].map((id) => distinct(4, id))
    const expected = [...values].sort(compareCandidateSelection).slice(0,3).map(candidateStableKey)
    const changed = values.reverse().map((c, i) => ({ ...c, id: candidateId(String(3-i)), searchRunId: 'other' }))
    expect(retainInitialCandidates(changed, masterFor(...values), 'weapon.fixture.a', 3).bounded.map(candidateStableKey)).toEqual(expected)
  })
})
