import { describe, expect, it } from 'vitest'
import type { BuildCandidate } from '../models/publicTypes'
import { createValidBuildCandidate, candidateId, ownedWeaponId } from '../../test/fixtures/domainData'
import {
  candidateStableKey,
  compareCanonicalIdeals,
  compareDuplicateCandidates,
  deduplicateCandidates,
} from './candidateProcessing'
import { compareStableKeys } from './semanticKeys'
import { validateCandidateSearchSettings } from './searchValidation'
import { defaultCandidateSearchSettings } from './searchTypes'

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
      }),
    ).toEqual([])
  })

  it('rejects invalid advances', () => {
    expect(
      validateCandidateSearchSettings({
        maxNormalAdvance: 0,
        maxGogmaAdvance: -1,
        maxSkillAdvance: 1.5,
      }).map(({ path }) => path),
    ).toEqual([
      'maxNormalAdvance',
      'maxGogmaAdvance',
      'maxSkillAdvance',
    ])
  })

  it('carries no output cap and no similarity threshold', () => {
    // A Search result is at most one canonical Ideal Candidate, so nothing
    // bounds a retained set and nothing ranks results by closeness
    // (`docs/SEARCH_SPEC.md` 4.2).
    const settings: Record<string, unknown> = {
      maxNormalAdvance: 1,
      maxGogmaAdvance: 1,
      maxSkillAdvance: 1,
    }
    expect(settings.maxCandidatesPerTarget).toBeUndefined()
    expect(settings.similarityThreshold).toBeUndefined()
    expect(Object.keys(defaultCandidateSearchSettings).sort()).toEqual([
      'maxGogmaAdvance',
      'maxNormalAdvance',
      'maxSkillAdvance',
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

describe('Canonical Ideal ordering', () => {
  it('applies every documented canonical ordering tie-breaker', () => {
    const base = candidate('base')
    expect(compareCanonicalIdeals(candidate('ops', { estimatedOperationCount: 1 }), base)).toBeLessThan(0)
    expect(compareCanonicalIdeals(candidate('gogma', { estimatedGogmaAdvance: 0 }), candidate('base-gogma', { estimatedGogmaAdvance: 1 }))).toBeLessThan(0)
    expect(compareCanonicalIdeals(candidate('skill', { estimatedSkillAdvance: 0 }), base)).toBeLessThan(0)
    expect(compareCanonicalIdeals(candidate('normal', { estimatedNormalAdvance: 0 }), candidate('null', { estimatedNormalAdvance: null }))).toBeLessThan(0)
  })

  it('ignores checkpoint availability entirely', () => {
    // Checkpoints are derived from the chosen Route, so letting them choose the
    // Route would make the canonical Ideal depend on its own output
    // (`docs/SEARCH_SPEC.md` 5.8.6).
    const withCheckpoints = candidate('with', { checkpointGroups: [] })
    const base = candidate('without')
    delete base.checkpointGroups
    expect(compareCanonicalIdeals(withCheckpoints, base)).toBe(0)
    expect(compareCanonicalIdeals(base, withCheckpoints)).toBe(0)
  })

  it('breaks the final tie on candidateStableKey instead of the Candidate ID', () => {
    // IDs are deliberately the reverse of the semantic stable-key order.
    const first = candidate('z', { seriesSkillId: null })
    const second = candidate('a')
    const [lower, higher] =
      compareStableKeys(candidateStableKey(first), candidateStableKey(second)) < 0
        ? [first, second]
        : [second, first]
    expect(candidateStableKey(lower)).not.toBe(candidateStableKey(higher))
    expect([higher, lower].sort(compareCanonicalIdeals).map(candidateStableKey)).toEqual(
      [lower, higher].map(candidateStableKey),
    )

    // Changing only the run-dependent IDs must not change the ordering.
    const renamed = [higher, lower].map((value, index) => ({
      ...value,
      id: candidateId(`rerun.${index}`),
      searchRunId: 'another-run',
    }))
    expect(renamed.sort(compareCanonicalIdeals).map(candidateStableKey)).toEqual(
      [lower, higher].map(candidateStableKey),
    )
  })

  it('leaves complete semantic duplicates unordered by ID', () => {
    expect(compareCanonicalIdeals(candidate('z'), candidate('a'))).toBe(0)
    expect(compareCanonicalIdeals(candidate('a'), candidate('z'))).toBe(0)
  })

  it('exposes no result filter at all', async () => {
    // A Search result is one canonical Ideal or nothing, so there is nothing to
    // filter by category or by closeness (`docs/SEARCH_SPEC.md` 4.2).
    const processing = (await import('./candidateProcessing')) as Record<string, unknown>
    expect(processing.filterCandidates).toBeUndefined()
    expect(processing.compareCandidates).toBeUndefined()
    expect(processing.sortCandidates).toBeUndefined()
    expect(processing.compareCandidateSelection).toBeUndefined()
  })
})
