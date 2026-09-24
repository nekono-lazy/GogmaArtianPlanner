import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../models/publicTypes'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { validatePlannerInput } from './plannerValidation'
import { createProductionPlan } from './productionPlanGeneration'

/**
 * The ordinary persisted Planner input inherits the Build List cardinality
 * contract: at most one BuildListEntry per planning Target
 * (`docs/DATA_MODEL.md` 9.4.1, `docs/PLANNER_SPEC.md` 4.1). A legacy duplicate
 * fails the whole input closed; only a B8 / what-if trial input may hold
 * several Entries of one Target (9.2.18).
 */

function markStale(entry: BuildListEntry) {
  // Staleness is recalculated from current data: a stored Target definition
  // hash that no longer matches excludes the Entry as target_definition_changed.
  entry.targetDefinitionHash = 'hash.cardinality.stale'
}

/**
 * Target A with two Routes (A1, A2), Target B with one (B1), each Route at its
 * own Gogma Counter position (`counters` = A1, A2, B1).
 */
function duplicateScenario(counters: readonly [number, number, number] = [10, 11, 12]) {
  const a = target('target.cardinality.a')
  const b = target('target.cardinality.b')
  const sources = ['a1', 'a2', 'b1'].map((suffix) => sourceWeapon(`owned.cardinality.${suffix}`))
  const entries = [
    routeEntry('entry.cardinality.a1', a, resetRoute(sources[0].id, counters[0])),
    routeEntry('entry.cardinality.a2', a, resetRoute(sources[1].id, counters[1])),
    routeEntry('entry.cardinality.b1', b, resetRoute(sources[2].id, counters[2])),
  ]
  return { a, b, ...fixture([a, b], entries, sources) }
}

describe('Planner input Build List cardinality', () => {
  it('plans a valid one-Entry-per-Target input as before', async () => {
    const a = target('target.cardinality.single.a')
    const b = target('target.cardinality.single.b')
    const sources = ['a', 'b'].map((suffix) => sourceWeapon(`owned.cardinality.single.${suffix}`))
    const { input, dependencies } = fixture([a, b], [
      routeEntry('entry.cardinality.single.a', a, resetRoute(sources[0].id)),
      routeEntry('entry.cardinality.single.b', b, resetRoute(sources[1].id, 11)),
    ], sources)

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(true)
    expect(validation.warnings.map(({ kind }) => kind)).not.toContain(
      'duplicate_build_list_entries_for_target',
    )
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.bestState).not.toBeNull()
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 2,
      totalTargetCount: 2,
    })
  })

  it('fails a planning Target with two Entries closed before the Beam Search, choosing neither', async () => {
    const { input, dependencies, a } = duplicateScenario()

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(false)
    const message = `TargetWeapon '${a.id}' has 2 BuildListEntries (entry.cardinality.a1, entry.cardinality.a2)`
    expect(validation.issues).toContainEqual(expect.objectContaining({
      path: 'buildListEntries',
      code: 'invalid_structure',
      message: expect.stringContaining(message) as string,
    }))
    expect(validation.warnings).toContainEqual({
      kind: 'duplicate_build_list_entries_for_target',
      message: expect.stringContaining(message) as string,
    })
    expect(preparePlannerInitialContext(input, dependencies).status).toBe('invalid')

    const beam = await runPlannerBeamSearch(input, dependencies)
    expect(beam.bestState).toBeNull()
    expect(beam.expandedStates).toBe(0)
    const result = await createProductionPlan(input, dependencies)
    expect(result.plan).toBeNull()
    expect(result.conflicts).toEqual([])
    // The unsearched termination still counts the planning Targets once.
    expect(result.termination).toMatchObject({
      status: 'exhausted',
      reachedLimits: [],
      expandedStates: 0,
      completedTargetCount: 0,
      totalTargetCount: 2,
    })
  })

  it('counts a stale Entry beside a valid one, so the valid one is never picked silently', async () => {
    const { input, dependencies } = duplicateScenario()
    markStale(input.buildListEntries[1])

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.validBuildListEntries.map(({ entry }) => entry.id)).toEqual([
      'entry.cardinality.a1',
      'entry.cardinality.b1',
    ])
    expect(validation.isValid).toBe(false)
    expect(validation.warnings.map(({ kind }) => kind)).toContain(
      'duplicate_build_list_entries_for_target',
    )
    expect((await createProductionPlan(input, dependencies)).plan).toBeNull()
  })

  it('leaves a duplicate of a Target that is no planning Target to the Build List', async () => {
    const { input, dependencies, b } = duplicateScenario([11, 12, 10])
    // Every Entry of Target A is excluded, so the run plans Target B alone and
    // chooses nothing for A.
    markStale(input.buildListEntries[0])
    markStale(input.buildListEntries[1])

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(true)
    expect(validation.warnings.map(({ kind }) => kind)).not.toContain(
      'duplicate_build_list_entries_for_target',
    )
    expect(preparePlannerInitialContext(input, dependencies).status).toBe('ready')
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 1,
      totalTargetCount: 1,
    })
    expect(Object.keys(result.bestState?.targetSatisfaction ?? {})).toEqual([b.id])
  })

  it('does not apply the persisted contract to a B8 / what-if trial input', async () => {
    const { input, dependencies } = duplicateScenario()

    const validation = validatePlannerInput(input, dependencies, 'temporary_augmented')
    expect(validation.isValid).toBe(true)
    expect(validation.warnings.map(({ kind }) => kind)).not.toContain(
      'duplicate_build_list_entries_for_target',
    )
    const beam = await runPlannerBeamSearch(input, dependencies, {}, 'temporary_augmented')
    expect(beam.bestState).not.toBeNull()
  })
})
