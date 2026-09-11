import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONSTRAINED_SIMILARITY_METADATA_THRESHOLD,
  createConstrainedMaterializer,
  type ConstrainedMaterializationContext,
} from './constrainedMaterializer'
import { ConstrainedMaterializationError } from './constrainedMaterializationErrors'
import { createConstrainedSearchIdentity } from './constrainedSearchIdentity'
import {
  createBuildCandidateMeaningFingerprint,
  createBuildListEntry,
  createTargetDefinitionHash,
} from '../../buildList'
import type { BuildCandidate, BuildListEntry } from '../../models/publicTypes'
import { validateBuildCandidate, validateBuildListEntry } from '../../models/publicTypes'
import {
  enumerateConstrainedCandidates,
  type ConstrainedCandidate,
} from '../../search'
import type { PlannerClock } from '../plannerTypes'
import {
  constrainedBounds,
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import { targetWeaponId } from '../../../test/fixtures/domainData'

const origin = createConstrainedSearchOrigin()

function clockAt(value: string): PlannerClock {
  return { now: () => value }
}

const CLOCK_A = clockAt('2026-09-01T00:00:00.000Z')
const CLOCK_B = clockAt('2027-03-04T05:06:07.000Z')

function context(
  overrides: Partial<ConstrainedMaterializationContext> = {},
): ConstrainedMaterializationContext {
  return {
    origin,
    targetWeaponId: origin.targetWeapons[0].id,
    bounds: constrainedBounds(),
    clock: CLOCK_A,
    ...overrides,
  }
}

let candidates: ConstrainedCandidate[] = []

beforeAll(async () => {
  const result = await enumerateConstrainedCandidates(
    constrainedInput(origin),
    createConstrainedEngine(origin, { resetResultAt: () => practicalBonuses() }),
  )
  candidates = result.candidates
  expect(candidates.length).toBeGreaterThan(1)
})

describe('constrained Candidate materialization', () => {
  it('produces a valid BuildCandidate whose semantic content is carried over unchanged', () => {
    const source = candidates[0]
    const candidate = createConstrainedMaterializer(context()).materializeCandidate(
      source,
    )

    expect(validateBuildCandidate(candidate, origin.ownedWeapons).isValid).toBe(true)
    expect(candidate).toMatchObject({
      targetWeaponId: source.targetWeaponId,
      category: source.category,
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
      similarityScore: source.similarityScore,
      searchStateHash: source.searchStateHash,
      referencedOwnedWeaponsHash: source.referencedOwnedWeaponsHash,
      calculationContext: source.calculationContext,
    })
    expect(candidate.route).not.toBe(source.route)
    expect(candidate.finalBonuses).not.toBe(source.finalBonuses)
  })

  it('never mutates the ConstrainedCandidate input', () => {
    const source = candidates[0]
    const before = structuredClone(source)
    const materializer = createConstrainedMaterializer(context())
    const candidate = materializer.materializeCandidate(source)
    candidate.route.operations.length = 0
    candidate.finalBonuses[0].bonusRankId = 'bonus_rank.fixture.low'
    expect(source).toEqual(before)
  })

  it('uses the deterministic constrained search identity as searchRunId', () => {
    const materializer = createConstrainedMaterializer(context())
    expect(materializer.searchIdentity).toBe(
      createConstrainedSearchIdentity({
        origin,
        targetWeaponId: origin.targetWeapons[0].id,
        bounds: constrainedBounds(),
      }),
    )
    expect(
      materializer.materializeCandidate(candidates[0]).searchRunId,
    ).toBe(materializer.searchIdentity)
  })

  it('keeps id and searchRunId stable across Clocks while createdAt follows the Clock', () => {
    const first = createConstrainedMaterializer(context()).materializeCandidate(
      candidates[0],
    )
    const second = createConstrainedMaterializer(
      context({ clock: CLOCK_B }),
    ).materializeCandidate(candidates[0])

    expect(second.id).toBe(first.id)
    expect(second.searchRunId).toBe(first.searchRunId)
    expect(first.createdAt).toBe('2026-09-01T00:00:00.000Z')
    expect(second.createdAt).toBe('2027-03-04T05:06:07.000Z')
    expect({ ...second, createdAt: first.createdAt }).toEqual(first)
  })

  it('changes the Candidate ID when the Candidate meaning changes', () => {
    const materializer = createConstrainedMaterializer(context())
    const first = materializer.materializeCandidate(candidates[0])
    const second = materializer.materializeCandidate(candidates[1])
    expect(second.id).not.toBe(first.id)
    expect(second.searchRunId).toBe(first.searchRunId)
  })

  it('changes both searchRunId and Candidate ID when the enumeration bounds change', () => {
    const first = createConstrainedMaterializer(context()).materializeCandidate(
      candidates[0],
    )
    const widened = createConstrainedMaterializer(
      context({ bounds: constrainedBounds({ maxGogmaAdvance: 30 }) }),
    ).materializeCandidate(candidates[0])

    expect(widened.searchRunId).not.toBe(first.searchRunId)
    expect(widened.id).not.toBe(first.id)
  })

  it('changes the Candidate ID when only the restoration bonus scope changes', () => {
    const materializer = createConstrainedMaterializer(context())
    const source = candidates[0]
    const flipped: ConstrainedCandidate = {
      ...structuredClone(source),
      restorationBonusScope:
        source.restorationBonusScope === 'gogma_artian'
          ? 'normal_artian'
          : 'gogma_artian',
    }
    // Historical snapshots may omit match metadata; scope remains semantic for their identity.
    delete flipped.conditionMatch
    const first = materializer.materializeCandidate(source)
    const second = materializer.materializeCandidate(flipped)

    expect(createBuildCandidateMeaningFingerprint(second)).not.toBe(
      createBuildCandidateMeaningFingerprint(first),
    )
    expect(second.id).not.toBe(first.id)
  })

  it('fails closed when the Candidate names another Target', () => {
    const materializer = createConstrainedMaterializer(context())
    const foreign: ConstrainedCandidate = {
      ...structuredClone(candidates[0]),
      targetWeaponId: targetWeaponId('target.fixture.b'),
    }
    expect(() => materializer.materializeCandidate(foreign)).toThrowError(
      expect.objectContaining({
        name: 'ConstrainedMaterializationError',
        code: 'target_mismatch',
      }) as unknown as Error,
    )
  })

  it('fails closed when the composed BuildCandidate is invalid', () => {
    const materializer = createConstrainedMaterializer(context())
    const broken: ConstrainedCandidate = {
      ...structuredClone(candidates[0]),
      estimatedOperationCount: -1,
    }
    expect(() => materializer.materializeCandidate(broken)).toThrowError(
      expect.objectContaining({ code: 'invalid_candidate' }) as unknown as Error,
    )
  })
})

describe('constrained Candidate similarity metadata', () => {
  it('applies the B6 default threshold 0.6 to isSimilarToIdeal only', () => {
    expect(CONSTRAINED_SIMILARITY_METADATA_THRESHOLD).toBe(0.6)
    const materializer = createConstrainedMaterializer(context())
    const practical = candidates.find(({ category }) => category === 'practical')
    expect(practical).toBeDefined()

    const atThreshold = materializer.materializeCandidate({
      ...structuredClone(practical as ConstrainedCandidate),
      similarityScore: 0.6,
    })
    const belowThreshold = materializer.materializeCandidate({
      ...structuredClone(practical as ConstrainedCandidate),
      similarityScore: 0.59,
    })

    expect(atThreshold.isSimilarToIdeal).toBe(true)
    expect(belowThreshold.isSimilarToIdeal).toBe(false)
    expect(belowThreshold.id).toBe(atThreshold.id)
    expect(belowThreshold.searchRunId).toBe(atThreshold.searchRunId)
  })

  it('carries the enumerator similarityScore through without recomputing it', () => {
    const materializer = createConstrainedMaterializer(context())
    candidates.forEach((source) => {
      expect(materializer.materializeCandidate(source).similarityScore).toBe(
        source.similarityScore,
      )
    })
  })
})

describe('generated BuildListEntry materialization', () => {
  function generate(
    source: ConstrainedCandidate,
    existing: readonly BuildListEntry[] = [],
    overrides: Partial<ConstrainedMaterializationContext> = {},
  ) {
    return createConstrainedMaterializer(
      context(overrides),
    ).materializeBuildListEntry(source, existing)
  }

  it('produces a valid ordinary-shape Entry with no extra provenance field', () => {
    const { entry, candidate, reusedExisting } = generate(candidates[0])
    expect(reusedExisting).toBe(false)
    expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(Object.keys(entry).sort()).toEqual(
      Object.keys(
        createBuildListEntry(candidate, origin.targetWeapons[0], {
          id: entry.id,
          createdAt: entry.createdAt,
        }),
      ).sort(),
    )
    expect(entry.candidateId).toBe(candidate.id)
    expect(entry.targetDefinitionHash).toBe(
      createTargetDefinitionHash(origin.targetWeapons[0]),
    )
    expect(entry.searchStateHash).toBe(candidate.searchStateHash)
    expect(entry.referencedOwnedWeaponsHash).toBe(candidate.referencedOwnedWeaponsHash)
    expect(entry.calculationContext).toEqual(candidate.calculationContext)
    expect(entry.isStale).toBe(false)
    expect(entry.staleReasons).toEqual([])
    expect(entry.createdAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('keeps the Entry ID stable across Clocks while createdAt follows the Clock', () => {
    const first = generate(candidates[0])
    const second = generate(candidates[0], [], { clock: CLOCK_B })

    expect(second.entry.id).toBe(first.entry.id)
    expect(second.candidate.id).toBe(first.candidate.id)
    expect(second.entry.createdAt).toBe('2027-03-04T05:06:07.000Z')
    expect(first.entry.createdAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('shares one Clock reading between the Candidate and the Entry', () => {
    let calls = 0
    const counting: PlannerClock = {
      now: () => {
        calls += 1
        return `2026-09-0${calls}T00:00:00.000Z`
      },
    }
    const { entry, candidate } = generate(candidates[0], [], { clock: counting })
    expect(calls).toBe(1)
    expect(entry.createdAt).toBe(candidate.createdAt)
  })

  it('gives different Entry IDs to different Candidate meanings', () => {
    expect(generate(candidates[1]).entry.id).not.toBe(generate(candidates[0]).entry.id)
  })

  it('reuses a current Entry carrying the same semantic content', () => {
    const first = generate(candidates[0])
    const second = generate(candidates[0], [first.entry], { clock: CLOCK_B })

    expect(second.reusedExisting).toBe(true)
    expect(second.entry).toEqual(first.entry)
    expect(second.entry.createdAt).toBe(first.entry.createdAt)
    expect(second.candidate).toEqual(first.entry.candidateSnapshot)
  })

  it('reuses a current Entry created by the ordinary Search path', () => {
    const first = generate(candidates[0])
    const ordinary = createBuildListEntry(
      {
        ...structuredClone(first.candidate),
        id: 'candidate.ordinary-run' as BuildCandidate['id'],
        searchRunId: 'search-run.ordinary',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      origin.targetWeapons[0],
      { createdAt: '2026-08-01T00:00:00.000Z' },
    )
    const reused = generate(candidates[0], [ordinary])

    expect(reused.reusedExisting).toBe(true)
    expect(reused.entry.id).toBe(ordinary.id)
    expect(reused.entry.id).not.toBe(first.entry.id)
    expect(reused.candidate.searchRunId).toBe('search-run.ordinary')
  })

  it('never mutates the existing Entry it inspects or reuses', () => {
    const first = generate(candidates[0])
    const existing = [first.entry, generate(candidates[1]).entry]
    const before = structuredClone(existing)
    const reused = generate(candidates[0], existing)
    reused.entry.staleReasons.push('rng_state_changed')
    reused.entry.candidateSnapshot.similarityScore = 0
    expect(existing).toEqual(before)
  })

  it.each([
    ['targetDefinitionHash', { targetDefinitionHash: 'fnv1a32:deadbeef' }],
    ['searchStateHash', { searchStateHash: 'fnv1a32:deadbeef' }],
    ['referencedOwnedWeaponsHash', { referencedOwnedWeaponsHash: 'fnv1a32:deadbeef' }],
    [
      'CalculationContext',
      {
        calculationContext: {
          ...origin.calculationContext,
          appSchemaVersion: origin.calculationContext.appSchemaVersion + 1,
        },
      },
    ],
  ])('does not reuse a same-meaning Entry whose %s diverged', (_label, override) => {
    const first = generate(candidates[0])
    // A diverged Entry has its own deterministic ID, so this is a historical
    // duplicate rather than an ID collision.
    const diverged: BuildListEntry = {
      ...structuredClone(first.entry),
      id: 'build-list.historical-duplicate' as BuildListEntry['id'],
      ...override,
    }
    const before = structuredClone(diverged)
    const result = generate(candidates[0], [diverged])

    expect(result.reusedExisting).toBe(false)
    expect(result.entry.id).toBe(first.entry.id)
    expect(result.entry.id).not.toBe(diverged.id)
    expect(diverged).toEqual(before)
  })

  it('keeps a stale same-meaning Entry as history instead of updating it', () => {
    const first = generate(candidates[0])
    const stale: BuildListEntry = {
      ...structuredClone(first.entry),
      id: 'build-list.historical' as BuildListEntry['id'],
      searchStateHash: 'fnv1a32:deadbeef',
      isStale: true,
      staleReasons: ['rng_state_changed'],
    }
    const before = structuredClone(stale)
    const result = generate(candidates[0], [stale])

    expect(result.reusedExisting).toBe(false)
    expect(result.entry.id).not.toBe(stale.id)
    expect(result.entry.isStale).toBe(false)
    expect(stale).toEqual(before)
  })

  it('fails closed on a deterministic Entry ID collision with different content', () => {
    const first = generate(candidates[0])
    const other = generate(candidates[1])
    const collision: BuildListEntry = {
      ...structuredClone(other.entry),
      id: first.entry.id,
    }
    expect(() => generate(candidates[0], [collision])).toThrowError(
      expect.objectContaining({
        name: 'ConstrainedMaterializationError',
        code: 'generated_entry_id_collision',
      }) as unknown as Error,
    )
    expect(collision.candidateSnapshot).toEqual(other.entry.candidateSnapshot)
  })

  it.each([
    ['matching first', (matching: BuildListEntry, conflicting: BuildListEntry) => [matching, conflicting]],
    ['conflicting first', (matching: BuildListEntry, conflicting: BuildListEntry) => [conflicting, matching]],
  ])(
    'fails closed whichever order a matching and a conflicting same-ID Entry arrive in (%s)',
    (_label, order) => {
      const first = generate(candidates[0])
      const other = generate(candidates[1])
      const conflicting: BuildListEntry = {
        ...structuredClone(other.entry),
        id: first.entry.id,
      }
      expect(() =>
        generate(candidates[0], order(first.entry, conflicting)),
      ).toThrowError(
        expect.objectContaining({
          code: 'generated_entry_id_collision',
        }) as unknown as Error,
      )
    },
  )

  it('reuses rather than fails when the colliding Entry holds the same content', () => {
    const first = generate(candidates[0])
    const result = generate(candidates[0], [first.entry], { clock: CLOCK_B })
    expect(result.reusedExisting).toBe(true)
    expect(result.entry.id).toBe(first.entry.id)
  })

  it('picks the lowest matching Entry ID regardless of input array order', () => {
    const first = generate(candidates[0])
    const alternate: BuildListEntry = {
      ...structuredClone(first.entry),
      id: 'build-list.aaa-alternate' as BuildListEntry['id'],
    }
    const forward = generate(candidates[0], [first.entry, alternate])
    const reversed = generate(candidates[0], [alternate, first.entry])
    expect(forward.entry.id).toBe(alternate.id)
    expect(reversed.entry.id).toBe(alternate.id)
  })

  it('fails closed on a Candidate that names another Target', () => {
    const foreign: ConstrainedCandidate = {
      ...structuredClone(candidates[0]),
      targetWeaponId: targetWeaponId('target.fixture.b'),
    }
    expect(() => generate(foreign)).toThrowError(ConstrainedMaterializationError)
  })
})
