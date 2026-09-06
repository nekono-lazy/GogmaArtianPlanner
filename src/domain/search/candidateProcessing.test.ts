import { describe, expect, it } from 'vitest'
import type { BuildCandidate } from '../models/publicTypes'
import { createValidBuildCandidate, candidateId, ownedWeaponId } from '../../test/fixtures/domainData'
import {
  candidateStableKey,
  compareCandidates,
  compareDuplicateCandidates,
  deduplicateCandidates,
  filterCandidates,
  sortCandidates,
} from './candidateProcessing'
import { compareStableKeys } from './semanticKeys'
import { validateCandidateSearchSettings } from './searchValidation'

function candidate(
  id: string,
  overrides: Partial<BuildCandidate> = {},
): BuildCandidate {
  return {
    ...createValidBuildCandidate(),
    id: candidateId(id),
    ...overrides,
  }
}

describe('Candidate Search settings', () => {
  it('accepts the documented settings bounds', () => {
    expect(
      validateCandidateSearchSettings({
        maxNormalAdvance: 5000,
        maxGogmaAdvance: 5000,
        maxSkillAdvance: 5000,
        maxCandidatesPerTarget: 200,
        similarityThreshold: 0.6,
      }),
    ).toEqual([])
  })

  it('rejects invalid advances, limit, and threshold', () => {
    expect(
      validateCandidateSearchSettings({
        maxNormalAdvance: 0,
        maxGogmaAdvance: -1,
        maxSkillAdvance: 1.5,
        maxCandidatesPerTarget: 0,
        similarityThreshold: 1.1,
      }).map(({ path }) => path),
    ).toEqual([
      'maxNormalAdvance',
      'maxGogmaAdvance',
      'maxSkillAdvance',
      'maxCandidatesPerTarget',
      'similarityThreshold',
    ])
  })
})

describe('Candidate deduplication', () => {
  it('reduces complete semantic duplicates to one candidate', () => {
    // The surviving candidate is the first encountered, not the smallest ID:
    // a complete semantic duplicate has no run-independent difference to rank.
    expect(
      deduplicateCandidates([candidate('b'), candidate('a')]).map(({ id }) => id),
    ).toEqual(['b'])
    expect(
      deduplicateCandidates([candidate('a'), candidate('b')]).map(({ id }) => id),
    ).toEqual(['a'])
  })

  it('keeps operation differences as separate candidates', () => {
    const different = candidate('different')
    different.route = {
      ...different.route,
      operations: [...different.route.operations].reverse(),
    }
    expect(deduplicateCandidates([candidate('base'), different])).toHaveLength(2)
  })

  it('keeps source weapon differences as separate candidates', () => {
    const left = candidate('left')
    left.route = {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: ownedWeaponId('owned.a'),
      operations: [
        {
          type: 'reset_skills',
          sourceOwnedWeaponId: ownedWeaponId('owned.a'),
          skillCounterBefore: 1,
          skillCounterAfter: 2,
        },
      ],
    }
    const right = candidate('right', {
      route: {
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: ownedWeaponId('owned.b'),
        operations: [
          {
            type: 'reset_skills',
            sourceOwnedWeaponId: ownedWeaponId('owned.b'),
            skillCounterBefore: 1,
            skillCounterAfter: 2,
          },
        ],
      },
    })
    expect(deduplicateCandidates([left, right])).toHaveLength(2)
  })

  it('prefers fewer operations, then materials, then Counter advance', () => {
    const base = candidate('z')
    const fewerOperations = candidate('operations', { estimatedOperationCount: 1 })
    expect(deduplicateCandidates([base, fewerOperations])[0].id).toBe('operations')

    const fewerMaterials = candidate('materials', { requiredMaterials: [] })
    expect(deduplicateCandidates([base, fewerMaterials])[0].id).toBe('materials')

    const lessAdvance = candidate('advance', {
      estimatedGogmaAdvance: 0,
      estimatedSkillAdvance: 0,
      estimatedNormalAdvance: 0,
    })
    expect(deduplicateCandidates([base, lessAdvance])[0].id).toBe('advance')
  })

  it('breaks the final duplicate tie on the run-independent stable key, not the ID', () => {
    // Same semantics, different run-dependent identity: nothing left to order by.
    expect(compareDuplicateCandidates(candidate('z'), candidate('a'))).toBe(0)
    expect(compareDuplicateCandidates(candidate('a'), candidate('z'))).toBe(0)

    // A legitimate stable-key difference still decides the tie in both directions.
    const laterSkill = candidate('a', { seriesSkillId: null })
    const base = candidate('z')
    expect(candidateStableKey(laterSkill)).not.toBe(candidateStableKey(base))
    const expected = compareStableKeys(
      candidateStableKey(laterSkill),
      candidateStableKey(base),
    )
    expect(Math.sign(compareDuplicateCandidates(laterSkill, base))).toBe(expected)
    expect(
      Math.sign(
        compareDuplicateCandidates(
          { ...laterSkill, id: candidateId('zzz') },
          { ...base, id: candidateId('aaa') },
        ),
      ),
    ).toBe(expected)
  })
})

describe('Candidate sorting and filters', () => {
  it('applies every documented sort tie-breaker', () => {
    const base = candidate('base')
    expect(compareCandidates(candidate('ideal', { category: 'ideal' }), base)).toBeLessThan(0)
    expect(compareCandidates(candidate('ops', { estimatedOperationCount: 1 }), base)).toBeLessThan(0)
    expect(compareCandidates(candidate('gogma', { estimatedGogmaAdvance: 0 }), candidate('base-gogma', { estimatedGogmaAdvance: 1 }))).toBeLessThan(0)
    expect(compareCandidates(candidate('skill', { estimatedSkillAdvance: 0 }), base)).toBeLessThan(0)
    expect(compareCandidates(candidate('normal', { estimatedNormalAdvance: 0 }), candidate('null', { estimatedNormalAdvance: null }))).toBeLessThan(0)
    expect(compareCandidates(candidate('similar', { similarityScore: 1 }), base)).toBeLessThan(0)
    expect(
      compareCandidates(
        candidate('matched', {
          idealDifference: { ...base.idealDifference, matchedBonusCount: 5 },
        }),
        candidate('fewer-matches', {
          idealDifference: { ...base.idealDifference, matchedBonusCount: 4 },
        }),
      ),
    ).toBeLessThan(0)
  })

  it('breaks the final sort tie on candidateStableKey instead of the Candidate ID', () => {
    // IDs are deliberately the reverse of the semantic stable-key order.
    const first = candidate('z', { seriesSkillId: null })
    const second = candidate('a')
    const [lower, higher] =
      compareStableKeys(candidateStableKey(first), candidateStableKey(second)) < 0
        ? [first, second]
        : [second, first]
    expect(candidateStableKey(lower)).not.toBe(candidateStableKey(higher))
    expect(sortCandidates([higher, lower]).map(candidateStableKey)).toEqual(
      [lower, higher].map(candidateStableKey),
    )

    // Changing only the run-dependent IDs must not change the ordering.
    const renamed = [higher, lower].map((value, index) => ({
      ...value,
      id: candidateId(`rerun.${index}`),
      searchRunId: 'another-run',
    }))
    expect(sortCandidates(renamed).map(candidateStableKey)).toEqual(
      [lower, higher].map(candidateStableKey),
    )
  })

  it('leaves complete semantic duplicates unordered by ID', () => {
    expect(compareCandidates(candidate('z'), candidate('a'))).toBe(0)
    expect(compareCandidates(candidate('a'), candidate('z'))).toBe(0)
  })

  it('filters all, ideal, practical, and Similar without a Similar category', () => {
    const ideal = candidate('ideal', { category: 'ideal', isSimilarToIdeal: false })
    const practical = candidate('practical', { category: 'practical', isSimilarToIdeal: false })
    const similar = candidate('similar', { category: 'practical', isSimilarToIdeal: true })
    const values = [ideal, practical, similar]
    expect(filterCandidates(values, 'all')).toHaveLength(3)
    expect(filterCandidates(values, 'ideal').map(({ id }) => id)).toEqual(['ideal'])
    expect(filterCandidates(values, 'practical').map(({ id }) => id)).toEqual(['practical', 'similar'])
    expect(filterCandidates(values, 'similar').map(({ id }) => id)).toEqual(['similar'])
  })
})
