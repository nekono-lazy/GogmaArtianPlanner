import { describe, expect, it } from 'vitest'
import { belowPracticalBonuses } from '../../../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationScenario,
  orchestrationSource,
  skillConstrainedTarget,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import type { OwnedWeaponId } from '../../models/publicTypes'
import {
  emptyPlannerAlternativeReservation,
  extractIntermediateStateGroups,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
} from '../../search'
import { ConstrainedMaterializationError } from '../constrained/constrainedMaterializationErrors'
import {
  createPlannerAlternativeMaterializer,
  createPlannerAlternativeSearchIdentity,
  type PlannerAlternativeMaterializationContext,
} from './plannerAlternativeMaterializer'

/*
 * PLANNER_SPEC 9.2.13 / SEARCH_SPEC 5.6.8: the Planner Alternative adapter of
 * the shared deterministic materializer.
 */

const TARGET = 'target.materializer.b'
const reservation: PlannerAlternativeReservation = {
  ...emptyPlannerAlternativeReservation,
  gogma: { held: [10], blocked: [10] },
  exclusiveOwnedWeaponIds: [ORCHESTRATION_SOURCE_A as OwnedWeaponId],
}

async function setup() {
  const target = skillConstrainedTarget(TARGET, { priority: 1 })
  const built = orchestrationScenario({
    targets: [target],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: 'series_skill.fixture.b-source' }),
    ],
    entries: [],
  })
  const extent = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }
  const candidates: PlannerAlternativeCandidate[] = []
  await visitPlannerAlternativeCandidates(
    { origin: built.origin, targetWeaponId: target.id, extent, reservation, excludedRouteKeys: [] },
    built.engine,
    (candidate) => {
      candidates.push(candidate)
      return 'continue'
    },
  )
  const context: PlannerAlternativeMaterializationContext = {
    origin: built.origin,
    targetWeaponId: target.id,
    extent,
    reservation,
    excludedRouteKeys: [],
    clock: { now: () => '2026-09-26T00:00:00.000Z' },
  }
  return { built, candidates, context }
}

describe('Planner Alternative deterministic search identity (PLANNER_SPEC 9.2.13)', () => {
  it('ignores reservation and excluded-key array order and duplicates', async () => {
    const { context } = await setup()
    const one = createPlannerAlternativeSearchIdentity({ ...context, excludedRouteKeys: ['b', 'a'] })
    const two = createPlannerAlternativeSearchIdentity({
      ...context,
      reservation: { ...reservation, gogma: { held: [10, 10], blocked: [10] }, exclusiveOwnedWeaponIds: [...reservation.exclusiveOwnedWeaponIds, ...reservation.exclusiveOwnedWeaponIds] },
      excludedRouteKeys: ['a', 'b', 'a'],
    })
    expect(two).toBe(one)
    expect(one.startsWith('planner-alternative-search.')).toBe(true)
  })

  it('changes with the extent, the reservation and the excluded keys', async () => {
    const { context } = await setup()
    const base = createPlannerAlternativeSearchIdentity(context)
    expect(createPlannerAlternativeSearchIdentity({ ...context, extent: { ...context.extent, maxGogmaAdvance: 6 } })).not.toBe(base)
    expect(createPlannerAlternativeSearchIdentity({ ...context, reservation: emptyPlannerAlternativeReservation })).not.toBe(base)
    expect(createPlannerAlternativeSearchIdentity({ ...context, excludedRouteKeys: ['route'] })).not.toBe(base)
  })
})

describe('Planner Alternative materializer (PLANNER_SPEC 9.2.13 / 9.2.19.6)', () => {
  it('carries the observational traces and derives the intermediate states from them', async () => {
    const { candidates, context } = await setup()
    expect(candidates.length).toBeGreaterThan(0)
    const source = candidates.find((candidate) => candidate.bonusAmendmentTrace.length > 0)!
    const materialized = createPlannerAlternativeMaterializer(context).materializeCandidate(source)
    expect(materialized.bonusAmendmentTrace).toEqual(source.bonusAmendmentTrace)
    expect(materialized.skillAmendmentTrace).toEqual(source.skillAmendmentTrace)
    expect(materialized.conversionSkillTrace).toEqual(source.conversionSkillTrace)
    expect(materialized.route).toEqual(source.route)
    expect(materialized.searchRunId).toBe(createPlannerAlternativeSearchIdentity(context))
    expect(materialized.id.startsWith('candidate.planner-alternative.')).toBe(true)
    expect(materialized.intermediateStateGroups).toEqual(extractIntermediateStateGroups(materialized, {
      target: context.origin.targetWeapons[0],
      master: context.origin.master,
      ownedWeapons: context.origin.ownedWeapons,
    }))
  })

  it('keeps every ID when only the Clock changes, and only createdAt moves', async () => {
    const { candidates, context } = await setup()
    const first = createPlannerAlternativeMaterializer(context).materializeBuildListEntry(candidates[0], [])
    const second = createPlannerAlternativeMaterializer({
      ...context,
      clock: { now: () => '2031-01-01T00:00:00.000Z' },
    }).materializeBuildListEntry(candidates[0], [])
    expect(second.entry.id).toBe(first.entry.id)
    expect(second.candidate.id).toBe(first.candidate.id)
    expect(second.entry.createdAt).not.toBe(first.entry.createdAt)
    expect(first.reusedExisting).toBe(false)
  })

  it('reuses a current Entry of the same semantic content and fails closed on an ID collision', async () => {
    const { candidates, context } = await setup()
    const materializer = createPlannerAlternativeMaterializer(context)
    const { entry } = materializer.materializeBuildListEntry(candidates[0], [])
    const reused = materializer.materializeBuildListEntry(candidates[0], [entry])
    expect(reused.reusedExisting).toBe(true)
    expect(reused.entry.id).toBe(entry.id)

    const divergent = structuredClone(entry)
    divergent.targetDefinitionHash = 'target-definition.other'
    expect(() => materializer.materializeBuildListEntry(candidates[0], [divergent]))
      .toThrow(ConstrainedMaterializationError)
  })
})
