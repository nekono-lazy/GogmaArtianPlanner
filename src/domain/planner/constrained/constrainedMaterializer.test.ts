import { beforeAll, describe, expect, it } from 'vitest'
import {
  createConstrainedMaterializer,
  type ConstrainedMaterializationContext,
} from './constrainedMaterializer'
import { createConstrainedSearchIdentity } from './constrainedSearchIdentity'
import { enumerateConstrainedCandidates } from '../../search'
import type { ConstrainedCandidate } from '../../search'
import type { PlannerClock } from '../plannerTypes'
import { createDeterministicMaterializer } from '../replacement/plannerDeterministicMaterializer'
import { ConstrainedMaterializationError } from './constrainedMaterializationErrors'
import {
  constrainedBounds,
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
} from '../../../test/fixtures/constrainedEnumeration'
import { targetWeaponId } from '../../../test/fixtures/domainData'

/**
 * The legacy B8 adapter of the shared deterministic materialization core
 * (Phase 6-B2a). What the core does - semantic carry-over, Clock, meaning and
 * scope in the Candidate ID, Entry reuse and collision, fail-closed checks - is
 * tested in `../replacement/plannerDeterministicMaterializer.test.ts`; only
 * what this adapter chooses is tested here.
 */

const origin = createConstrainedSearchOrigin()

function clockAt(value: string): PlannerClock {
  return { now: () => value }
}

const CLOCK_A = clockAt('2026-09-01T00:00:00.000Z')

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
    createConstrainedEngine(origin),
  )
  candidates = result.candidates
  expect(candidates.length).toBeGreaterThan(1)
})

describe('constrained Candidate materialization (B8 adapter)', () => {
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

  it('is exactly the shared core with the B8 identity and the candidate.constrained. prefix', () => {
    const adapter = createConstrainedMaterializer(context())
    const core = createDeterministicMaterializer<ConstrainedCandidate>({
      origin,
      target: origin.targetWeapons[0],
      searchIdentity: adapter.searchIdentity,
      candidateIdPrefix: 'candidate.constrained.',
      clock: CLOCK_A,
    })
    expect(adapter.target).toBe(core.target)
    expect(adapter.materializeBuildListEntry(candidates[0], []))
      .toEqual(core.materializeBuildListEntry(candidates[0], []))
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

  it('fails closed when the Target is not part of the origin', () => {
    expect(() =>
      createConstrainedMaterializer(
        context({ targetWeaponId: targetWeaponId('target.fixture.missing') }),
      ),
    ).toThrowError(ConstrainedMaterializationError)
  })

  it('keeps the pre-Phase 6-B2a runtime error contract', () => {
    // Parity authority for Phase 6-B2a: the same failures still throw the
    // legacy constructor, with its name, code and message.
    const caught = (run: () => unknown): Error => {
      try {
        run()
      } catch (error) {
        return error as Error
      }
      throw new Error('Expected a materialization failure.')
    }
    const missingTarget = caught(() =>
      createConstrainedMaterializer(
        context({ targetWeaponId: targetWeaponId('target.fixture.missing') }),
      ),
    )
    expect(missingTarget).toBeInstanceOf(ConstrainedMaterializationError)
    expect(missingTarget.name).toBe('ConstrainedMaterializationError')
    expect(missingTarget.constructor.name).toBe('ConstrainedMaterializationError')
    expect(missingTarget).toMatchObject({
      code: 'target_mismatch',
      message: "TargetWeapon 'target.fixture.missing' is not part of the constrained search origin.",
    })

    const materializer = createConstrainedMaterializer(context())
    const foreign = caught(() =>
      materializer.materializeCandidate({
        ...structuredClone(candidates[0]),
        targetWeaponId: targetWeaponId('target.fixture.b'),
      }),
    )
    expect(foreign).toBeInstanceOf(ConstrainedMaterializationError)
    expect(foreign.name).toBe('ConstrainedMaterializationError')
    expect(foreign).toMatchObject({
      code: 'target_mismatch',
      message: `The materialized Candidate targets "target.fixture.b", not "${origin.targetWeapons[0].id}".`,
    })

    const invalid = caught(() =>
      materializer.materializeCandidate({
        ...structuredClone(candidates[0]),
        estimatedOperationCount: -1,
      }),
    )
    expect(invalid).toBeInstanceOf(ConstrainedMaterializationError)
    expect(invalid.name).toBe('ConstrainedMaterializationError')
    expect(invalid).toMatchObject({ code: 'invalid_candidate' })

    const { entry } = materializer.materializeBuildListEntry(candidates[0], [])
    const collision = caught(() =>
      materializer.materializeBuildListEntry(candidates[0], [
        { ...structuredClone(entry), searchStateHash: 'search-state.divergent' },
      ]),
    )
    expect(collision).toBeInstanceOf(ConstrainedMaterializationError)
    expect(collision.name).toBe('ConstrainedMaterializationError')
    expect(collision).toMatchObject({
      code: 'generated_entry_id_collision',
      message: `BuildListEntry "${entry.id}" already exists with different current semantic content.`,
    })
  })

  it('is deterministic across identical materializations', () => {
    const first = createConstrainedMaterializer(context())
      .materializeCandidate(structuredClone(candidates[0]))
    const second = createConstrainedMaterializer(context())
      .materializeCandidate(structuredClone(candidates[0]))
    expect(second.id).toBe(first.id)
    expect(second.searchRunId).toBe(first.searchRunId)
  })

  it('keeps the pinned B8 search identity and IDs (Phase 6-B2a)', () => {
    const materializer = createConstrainedMaterializer(context())
    const { entry, candidate } = materializer.materializeBuildListEntry(candidates[0], [])
    expect(materializer.searchIdentity).toBe('constrained-search.fnv1a32-cdf1a4d6')
    expect(entry.id).toBe('build-list.constrained.fnv1a32-db54f4cd')
    expect(candidate.id).toBe('candidate.constrained.fnv1a32-46a2a19b')
  })
})
