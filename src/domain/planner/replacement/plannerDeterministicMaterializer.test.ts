import { beforeAll, describe, expect, it } from 'vitest'
import { createBuildCandidateMeaningFingerprint, createTargetDefinitionHash } from '../../buildList'
import { validateBuildCandidate } from '../../models/validation'
import { enumerateConstrainedCandidates } from '../../search'
import type { ConstrainedCandidate } from '../../search'
import type { PlannerClock } from '../plannerTypes'
import {
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
} from '../../../test/fixtures/constrainedEnumeration'
import { targetWeaponId } from '../../../test/fixtures/domainData'
import {
  createDeterministicMaterializer,
  type DeterministicMaterializationCoreContext,
} from './plannerDeterministicMaterializer'

/**
 * The shared deterministic materialization core (Phase 6-B2a; formerly tested
 * through the B8 adapter only). Each adapter only chooses the search identity
 * and the Candidate ID prefix, so the core is driven here with fixed ones.
 */

const origin = createConstrainedSearchOrigin()

function clockAt(value: string): PlannerClock {
  return { now: () => value }
}

const CLOCK_A = clockAt('2026-09-01T00:00:00.000Z')
const CLOCK_B = clockAt('2027-03-04T05:06:07.000Z')

/**
 * The B8 constrained search identity of this very fixture
 * (`createConstrainedSearchIdentity()` over `constrainedBounds()`), pinned as
 * a literal so the core is tested without the legacy adapter.
 */
const B8_SEARCH_IDENTITY = 'constrained-search.fnv1a32-cdf1a4d6'
/** The Planner Alternative search identity the pin test below uses. */
const ALTERNATIVE_SEARCH_IDENTITY = 'planner-alternative-search.fnv1a32-c5e12f20'

function context(
  overrides: Partial<DeterministicMaterializationCoreContext> = {},
): DeterministicMaterializationCoreContext {
  return {
    origin,
    target: origin.targetWeapons[0],
    searchIdentity: B8_SEARCH_IDENTITY,
    candidateIdPrefix: 'candidate.constrained.',
    clock: CLOCK_A,
    ...overrides,
  }
}

function materializer(overrides: Partial<DeterministicMaterializationCoreContext> = {}) {
  return createDeterministicMaterializer<ConstrainedCandidate>(context(overrides))
}

let candidates: ConstrainedCandidate[] = []

beforeAll(async () => {
  const result = await enumerateConstrainedCandidates(
    constrainedInput(origin),
    createConstrainedEngine(origin),
  )
  candidates = result.candidates
  expect(candidates.length).toBeGreaterThan(1)
})

describe('deterministic materialization core', () => {
  it('produces a valid BuildCandidate whose semantic content is carried over unchanged', () => {
    const source = candidates[0]
    const candidate = materializer().materializeCandidate(source)

    expect(validateBuildCandidate(candidate, origin.ownedWeapons).isValid).toBe(true)
    expect(candidate).toMatchObject({
      targetWeaponId: source.targetWeaponId,
      finalBonuses: source.finalBonuses,
      restorationBonusScope: source.restorationBonusScope,
      seriesSkillId: source.seriesSkillId,
      groupSkillId: source.groupSkillId,
      route: source.route,
      estimatedOperationCount: source.estimatedOperationCount,
      estimatedGogmaAdvance: source.estimatedGogmaAdvance,
      estimatedSkillAdvance: source.estimatedSkillAdvance,
      estimatedNormalAdvance: source.estimatedNormalAdvance,
      requiredMaterials: source.requiredMaterials,
      idealDifference: source.idealDifference,
      searchStateHash: source.searchStateHash,
      referencedOwnedWeaponsHash: source.referencedOwnedWeaponsHash,
      calculationContext: source.calculationContext,
      searchRunId: B8_SEARCH_IDENTITY,
    })
    expect(candidate.route).not.toBe(source.route)
    expect(candidate.finalBonuses).not.toBe(source.finalBonuses)
  })

  it('never mutates the source', () => {
    const source = candidates[0]
    const before = structuredClone(source)
    const candidate = materializer().materializeCandidate(source)
    candidate.route.operations.length = 0
    candidate.finalBonuses[0].bonusRankId = 'bonus_rank.fixture.low'
    expect(source).toEqual(before)
  })

  it('keeps id and searchRunId stable across Clocks while createdAt follows the Clock', () => {
    const first = materializer().materializeCandidate(candidates[0])
    const second = materializer({ clock: CLOCK_B }).materializeCandidate(candidates[0])

    expect(second.id).toBe(first.id)
    expect(second.searchRunId).toBe(first.searchRunId)
    expect(first.createdAt).toBe('2026-09-01T00:00:00.000Z')
    expect(second.createdAt).toBe('2027-03-04T05:06:07.000Z')
    expect({ ...second, createdAt: first.createdAt }).toEqual(first)
  })

  it('changes the Candidate ID when the Candidate meaning changes', () => {
    const core = materializer()
    const first = core.materializeCandidate(candidates[0])
    const second = core.materializeCandidate(candidates[1])
    expect(second.id).not.toBe(first.id)
    expect(second.searchRunId).toBe(first.searchRunId)
  })

  it('changes the Candidate ID with the search identity and the prefix, never the Entry ID', () => {
    const base = materializer().materializeBuildListEntry(candidates[0], [])
    const otherIdentity = materializer({ searchIdentity: 'constrained-search.other' })
      .materializeBuildListEntry(candidates[0], [])
    const otherPrefix = materializer({ candidateIdPrefix: 'candidate.other.' })
      .materializeBuildListEntry(candidates[0], [])

    expect(otherIdentity.candidate.id).not.toBe(base.candidate.id)
    expect(otherPrefix.candidate.id).not.toBe(base.candidate.id)
    expect(otherPrefix.candidate.id.startsWith('candidate.other.')).toBe(true)
    // The generated Entry ID is the semantic content's own: which search found
    // the Candidate does not take part in it (PLANNER_SPEC 9.2.13).
    expect(otherIdentity.entry.id).toBe(base.entry.id)
    expect(otherPrefix.entry.id).toBe(base.entry.id)
  })

  it('changes the Candidate ID when only the restoration bonus scope changes', () => {
    const core = materializer()
    const source = candidates[0]
    const flipped: ConstrainedCandidate = {
      ...structuredClone(source),
      restorationBonusScope:
        source.restorationBonusScope === 'gogma_artian'
          ? 'normal_artian'
          : 'gogma_artian',
    }
    const first = core.materializeCandidate(source)
    const second = core.materializeCandidate(flipped)

    expect(createBuildCandidateMeaningFingerprint(second)).not.toBe(
      createBuildCandidateMeaningFingerprint(first),
    )
    expect(second.id).not.toBe(first.id)
  })

  it('fails closed when the Candidate names another Target', () => {
    const foreign: ConstrainedCandidate = {
      ...structuredClone(candidates[0]),
      targetWeaponId: targetWeaponId('target.fixture.b'),
    }
    expect(() => materializer().materializeCandidate(foreign)).toThrowError(
      expect.objectContaining({
        name: 'ConstrainedMaterializationError',
        code: 'target_mismatch',
      }) as unknown as Error,
    )
  })

  it('fails closed when the composed BuildCandidate is invalid', () => {
    const broken: ConstrainedCandidate = {
      ...structuredClone(candidates[0]),
      estimatedOperationCount: -1,
    }
    expect(() => materializer().materializeCandidate(broken)).toThrowError(
      expect.objectContaining({ code: 'invalid_candidate' }) as unknown as Error,
    )
  })

  it('carries no similarity metadata and an empty checkpoint set for a trace-free source', () => {
    const record = materializer().materializeCandidate(
      structuredClone(candidates[0]),
    ) as unknown as Record<string, unknown>
    expect(record.similarityScore).toBeUndefined()
    expect(record.isSimilarToIdeal).toBeUndefined()
    expect(record.category).toBeUndefined()
    // No observational trace means nothing can reconstruct intermediate
    // states: the result is an empty checkpoint set rather than an invented one
    // (`docs/PLANNER_SPEC.md` 9.2.13).
    expect(record.intermediateStateGroups).toEqual([])
  })
})

describe('deterministic materialization core: generated BuildListEntry', () => {
  it('derives the Entry from the Candidate with the Target definition hash and the Clock', () => {
    const { entry, candidate, reusedExisting } = materializer()
      .materializeBuildListEntry(candidates[0], [])
    expect(reusedExisting).toBe(false)
    expect(entry.targetWeaponId).toBe(origin.targetWeapons[0].id)
    expect(entry.targetDefinitionHash).toBe(createTargetDefinitionHash(origin.targetWeapons[0]))
    expect(entry.candidateSnapshot).toEqual(candidate)
    expect(entry.createdAt).toBe('2026-09-01T00:00:00.000Z')
    expect(entry.id.startsWith('build-list.constrained.')).toBe(true)
  })

  it('reuses a current Entry of the same semantic content with its own ID and createdAt', () => {
    const first = materializer().materializeBuildListEntry(candidates[0], [])
    const again = materializer({ clock: CLOCK_B }).materializeBuildListEntry(
      candidates[0],
      [first.entry],
    )
    expect(again.reusedExisting).toBe(true)
    expect(again.entry).toEqual(first.entry)
    expect(again.entry).not.toBe(first.entry)
  })

  it('fails closed when the deterministic Entry ID holds different semantic content', () => {
    const first = materializer().materializeBuildListEntry(candidates[0], [])
    const divergent = {
      ...structuredClone(first.entry),
      searchStateHash: 'search-state.divergent',
    }
    expect(() =>
      materializer().materializeBuildListEntry(candidates[0], [divergent]),
    ).toThrowError(
      expect.objectContaining({ code: 'generated_entry_id_collision' }) as unknown as Error,
    )
  })
})

describe('deterministic materialization core: pinned IDs (Phase 6-B2a)', () => {
  // Pinned from the pre-Phase 6-B2a implementation over this fixture: moving
  // the core must change no generated Entry ID and no Candidate ID.
  it('keeps the generated Entry ID and the B8-prefixed Candidate ID', () => {
    const { entry, candidate } = materializer().materializeBuildListEntry(candidates[0], [])
    expect(entry.id).toBe('build-list.constrained.fnv1a32-db54f4cd')
    expect(candidate.id).toBe('candidate.constrained.fnv1a32-46a2a19b')
  })

  it('keeps the Planner Alternative-prefixed Candidate ID and the same Entry ID', () => {
    const { entry, candidate } = materializer({
      searchIdentity: ALTERNATIVE_SEARCH_IDENTITY,
      candidateIdPrefix: 'candidate.planner-alternative.',
    }).materializeBuildListEntry(candidates[0], [])
    expect(entry.id).toBe('build-list.constrained.fnv1a32-db54f4cd')
    expect(candidate.id).toBe('candidate.planner-alternative.fnv1a32-0e8ff2a0')
  })
})
