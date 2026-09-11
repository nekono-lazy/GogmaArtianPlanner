import { describe, expect, it, vi } from 'vitest'
import type { BuildCandidate, OwnedWeaponId } from '../models/publicTypes'
import {
  candidateId,
  createValidBuildCandidate,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import { compareStableKeys } from './semanticKeys'
import {
  candidateDeduplicationKey,
  candidateStableKey,
  compareCandidateSelection,
  compareCandidates,
  compareCanonicalIdeals,
  sortCandidates,
} from './candidateProcessing'
import { retainInitialCandidates } from './candidateRetention'
import { createBuildCandidateMeaningFingerprint } from '../buildList'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
  searchMasterFixture,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { searchCandidates } from './candidateSearch'
import type { RngEngine } from '../rng/rngEngine'

const FIXTURE_WEAPON_TYPE = 'weapon.fixture.a'

const PREFERRED = ownedWeaponId('owned.preferred')
const OTHER = ownedWeaponId('owned.other')

/**
 * Two Candidates that differ only by which owned weapon their Route starts
 * from, so every existing ordering priority ties and the Target's preference is
 * the only thing left to separate them.
 */
function candidate(
  id: string,
  sourceOwnedWeaponId: OwnedWeaponId | null,
  overrides: Partial<BuildCandidate> = {},
): BuildCandidate {
  const base = createValidBuildCandidate()
  return {
    ...base,
    id: candidateId(id),
    route: {
      ...base.route,
      kind: sourceOwnedWeaponId === null
        ? 'normal_artian_to_gogma'
        : 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId,
      operations: [],
    },
    ...overrides,
  }
}

describe('preferred owned weapon as a Candidate ordering preference', () => {
  it('prefers the preferred source when every existing priority ties', () => {
    const preferred = candidate('candidate.preferred', PREFERRED)
    const other = candidate('candidate.other', OTHER)
    expect(compareCandidates(other, preferred, PREFERRED)).toBeGreaterThan(0)
    expect(compareCandidateSelection(other, preferred, PREFERRED)).toBeGreaterThan(0)
    expect(compareCanonicalIdeals(other, preferred, PREFERRED)).toBeGreaterThan(0)
    expect(sortCandidates([other, preferred], PREFERRED)[0].id).toBe(preferred.id)
  })

  it('never reverses a cheaper Route', () => {
    // Preferred but four operations; non-preferred but two. Cost decides, and
    // the preference sits strictly below it (`docs/SEARCH_SPEC.md` 8.1).
    const preferred = candidate('candidate.preferred.far', PREFERRED, {
      estimatedOperationCount: 4,
    })
    const cheaper = candidate('candidate.other.near', OTHER, {
      estimatedOperationCount: 2,
    })
    expect(compareCandidates(preferred, cheaper, PREFERRED)).toBeGreaterThan(0)
    expect(compareCanonicalIdeals(preferred, cheaper, PREFERRED)).toBeGreaterThan(0)
    expect(sortCandidates([preferred, cheaper], PREFERRED)[0].id).toBe(cheaper.id)
  })

  it('never treats a new-Normal route as preferred: its source is null', () => {
    const newNormal = candidate('candidate.new.normal', null)
    const preferred = candidate('candidate.preferred.source', PREFERRED)
    expect(compareCandidates(newNormal, preferred, PREFERRED)).toBeGreaterThan(0)
    // A new-Normal route is not preferred even when the Target's preference is
    // itself null: `preferredOwnedWeaponId === null` disables the preference
    // rather than matching every null source, so the stable key decides.
    expect(compareCandidates(newNormal, preferred, null)).toBe(
      compareStableKeys(
        candidateStableKey(newNormal),
        candidateStableKey(preferred),
      ),
    )
  })

  it('chooses the preferred source as the canonical Ideal at equal cost', () => {
    const preferred = candidate('candidate.ideal.preferred', PREFERRED, {
      category: 'ideal',
    })
    const other = candidate('candidate.ideal.other', OTHER, {
      category: 'ideal',
    })
    const retained = retainInitialCandidates(
      [other, preferred],
      searchMasterFixture,
      FIXTURE_WEAPON_TYPE,
      200,
      PREFERRED,
    )
    expect(retained.canonicalIdeal?.id).toBe(preferred.id)
  })

  it('keeps a cheaper non-preferred Ideal as the canonical Ideal', () => {
    const preferred = candidate('candidate.ideal.preferred.far', PREFERRED, {
      category: 'ideal',
      estimatedOperationCount: 4,
    })
    const cheaper = candidate('candidate.ideal.other.near', OTHER, {
      category: 'ideal',
      estimatedOperationCount: 2,
    })
    const retained = retainInitialCandidates(
      [preferred, cheaper],
      searchMasterFixture,
      FIXTURE_WEAPON_TYPE,
      200,
      PREFERRED,
    )
    expect(retained.canonicalIdeal?.id).toBe(cheaper.id)
  })

  it('orders a fully tied bounded Practical selection preferred-first', () => {
    const preferred = candidate('candidate.practical.preferred', PREFERRED, {
      category: 'practical',
    })
    const other = candidate('candidate.practical.other', OTHER, {
      category: 'practical',
    })
    const retained = retainInitialCandidates(
      [other, preferred],
      searchMasterFixture,
      FIXTURE_WEAPON_TYPE,
      200,
      PREFERRED,
    )
    // Both are kept - differing source weapons are incomparable, so dominance
    // never drops either - and the preferred one is offered first.
    expect(retained.retained.map(({ id }) => id)).toEqual([
      preferred.id,
      other.id,
    ])
  })

  it('leaves Candidate identity untouched', () => {
    const preferred = candidate('candidate.identity', PREFERRED)
    // The preference belongs to the Target, not to the Candidate's own meaning,
    // so no identity authority can even accept it: each takes the Candidate
    // alone, and none of their contents mentions it
    // (`docs/SEARCH_SPEC.md` 8.1).
    expect(candidateStableKey).toHaveLength(1)
    expect(candidateDeduplicationKey).toHaveLength(1)
    expect(createBuildCandidateMeaningFingerprint).toHaveLength(1)
    expect(Object.keys(JSON.parse(candidateStableKey(preferred)))).toEqual([
      'finalBonuses',
      'groupSkillId',
      'operations',
      'restorationBonusScope',
      'routeKind',
      'seriesSkillId',
      'sourceOwnedWeaponId',
    ])
    expect(candidateStableKey(preferred)).not.toContain('preferredOwnedWeaponId')
    expect(candidateDeduplicationKey(preferred)).not.toContain(
      'preferredOwnedWeaponId',
    )
  })
})

/**
 * A preference must not change what a Search does, only how equally rated
 * results are ordered (`docs/SEARCH_SPEC.md` 8.1, AGENTS.md Search termination).
 */
describe('preferred owned weapon never changes Search extent', () => {
  const deterministicExecution = {
    now: () => SEARCH_FIXTURE_TIME,
    nowMs: () => 100,
  }

  function countingEngine(engine: RngEngine) {
    const counts = { normal: 0, skill: 0, gogma: 0 }
    const counted: RngEngine = {
      version: engine.version,
      capabilities: engine.capabilities,
      getPredictionSupport: engine.getPredictionSupport.bind(engine),
      normalizeSeed: engine.normalizeSeed.bind(engine),
      predictNormalArtian: vi.fn((...args: Parameters<RngEngine['predictNormalArtian']>) => {
        counts.normal += 1
        return engine.predictNormalArtian(...args)
      }),
      predictSkills: vi.fn((...args: Parameters<RngEngine['predictSkills']>) => {
        counts.skill += 1
        return engine.predictSkills(...args)
      }),
      predictGogmaBonus: vi.fn((...args: Parameters<RngEngine['predictGogmaBonus']>) => {
        counts.gogma += 1
        return engine.predictGogmaBonus(...args)
      }),
      advanceGogmaCounter: engine.advanceGogmaCounter.bind(engine),
      advanceSkillCounter: engine.advanceSkillCounter.bind(engine),
      advanceNormalCounter: engine.advanceNormalCounter.bind(engine),
    }
    return { counted, counts }
  }

  async function runSearch(preferOwnedSource: boolean) {
    const input = createCandidateSearchInput()
    const ownedSourceId = input.ownedWeapons[0].id
    input.ownedWeapons[0] = { ...input.ownedWeapons[0], isProtected: false }
    input.targetWeapons[0] = {
      ...input.targetWeapons[0],
      preferredOwnedWeaponId: preferOwnedSource ? ownedSourceId : null,
    }
    const { counted, counts } = countingEngine(
      createCandidateSearchEngine(input, {
        resetResult: createRestorationBonusSet(),
      }),
    )
    const result = await searchCandidates(input, counted, deterministicExecution)
    return { result, counts, ownedSourceId }
  }

  it('searches the same routes and makes the same prediction calls', async () => {
    const without = await runSearch(false)
    const withPreference = await runSearch(true)

    expect(withPreference.result.targetResults[0].searchedRoutes).toEqual(
      without.result.targetResults[0].searchedRoutes,
    )
    // Non-preferred routes are still searched in full: the preference is not a
    // filter on the route scope.
    expect(withPreference.result.targetResults[0].searchedRoutes.length)
      .toBeGreaterThan(1)
    expect(withPreference.counts).toEqual(without.counts)
  })

  it('retains the same Candidate set', async () => {
    const without = await runSearch(false)
    const withPreference = await runSearch(true)

    const keys = (run: typeof without) =>
      [...run.result.targetResults[0].candidates]
        .map(candidateStableKey)
        .sort()
    // The horizon, the dominance, and the cap are untouched, so exactly the
    // same set comes back; only its order may differ. Ordering itself is
    // covered above, on explicit Candidates that tie on every other priority.
    expect(keys(withPreference)).toEqual(keys(without))
    expect(keys(withPreference).length).toBeGreaterThan(0)
  })

  it('produces the same ordering on a rerun of the same input', async () => {
    const first = await runSearch(true)
    const second = await runSearch(true)
    expect(
      second.result.targetResults[0].candidates.map(candidateStableKey),
    ).toEqual(first.result.targetResults[0].candidates.map(candidateStableKey))
  })
})
