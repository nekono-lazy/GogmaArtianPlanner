import { beforeAll, describe, expect, it } from 'vitest'
import {
  createConstrainedMaterializer,
  type ConstrainedMaterializationContext,
} from './constrainedMaterializer'
import { createConstrainedSearchIdentity } from './constrainedSearchIdentity'
import { createBuildCandidateMeaningFingerprint } from '../../buildList'
import { validateBuildCandidate } from '../../models/validation'
import { enumerateConstrainedCandidates } from '../../search'
import type { ConstrainedCandidate } from '../../search'
import type { PlannerClock } from '../plannerTypes'
import {
  constrainedBounds,
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
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
    createConstrainedEngine(origin),
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
describe('constrained Candidate metadata', () => {
  it('carries no similarity metadata and an empty checkpoint set', () => {
    const materializer = createConstrainedMaterializer(context())
    const materialized = materializer.materializeCandidate(
      structuredClone(candidates[0]),
    )
    const record = materialized as unknown as Record<string, unknown>
    // The similarity concept is gone with the independent Practical Candidate.
    expect(record.similarityScore).toBeUndefined()
    expect(record.isSimilarToIdeal).toBeUndefined()
    expect(record.category).toBeUndefined()
    // A `ConstrainedCandidate` carries no observational trace at all, so
    // nothing can reconstruct its intermediate states: the result is an empty
    // checkpoint set rather than an invented one
    // (`docs/PLANNER_SPEC.md` 9.2.13).
    expect(materialized.checkpointGroups).toEqual([])
  })

  it('is deterministic across identical materializations', () => {
    const first = createConstrainedMaterializer(context())
      .materializeCandidate(structuredClone(candidates[0]))
    const second = createConstrainedMaterializer(context())
      .materializeCandidate(structuredClone(candidates[0]))
    expect(second.id).toBe(first.id)
    expect(second.searchRunId).toBe(first.searchRunId)
  })
})
