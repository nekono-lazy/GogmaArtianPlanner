import { describe, expect, it } from 'vitest'
import type { BuildListEntry, TargetWeapon } from '../models/publicTypes'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import { IDEAL_SERIES_SKILL_ID, idealBonuses } from '../../test/fixtures/constrainedEnumeration'
import {
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { derivePlannerPlanningTargets } from './plannerPlanningTargets'
import { validatePlannerInput } from './plannerValidation'
import { createProductionPlan } from './productionPlanGeneration'
import type { PlannerBuildListCardinality, PlannerDependencies, PlannerInput } from './plannerTypes'

/**
 * Issue #102: the goal set of one Planner run is the planning Targets - the
 * unique planning-eligible Targets of the *valid* BuildListEntries - never
 * every active Target of `PlannerInput.targetWeapons` (`docs/PLANNER_SPEC.md`
 * 4 / 7.2.1, `docs/REQUIREMENTS.md` 18 / 19).
 */

/**
 * An active Target the Build List gives no Route. Its element differs from the
 * fixture weapons, so no Route of the run can ever satisfy it: under the old
 * "every active Target" contract it made completion unreachable.
 */
function unlistedTarget(id: string): TargetWeapon {
  return { ...target(id), elementId: 'element.fixture.b' }
}

function readyContext(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  cardinality: PlannerBuildListCardinality = 'persisted',
) {
  const prepared = preparePlannerInitialContext(input, dependencies, cardinality)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context
}

/** One planning Target with a one-Reset Route, plus Targets outside the Build List. */
function listedAndUnlisted(unlistedCount: number) {
  const goal = target('target.scope.listed')
  const source = sourceWeapon('owned.scope.listed')
  const entry = routeEntry('entry.scope.listed', goal, resetRoute(source.id))
  const unlisted = Array.from({ length: unlistedCount }, (_unused, index) =>
    unlistedTarget(`target.scope.unlisted.${index}`),
  )
  return { goal, entry, unlisted, ...fixture([goal, ...unlisted], [entry], [source]) }
}

function markStale(entry: BuildListEntry) {
  // Staleness is recalculated from current data: a stored Target definition
  // hash that no longer matches excludes the Entry as target_definition_changed.
  entry.targetDefinitionHash = 'hash.scope.stale'
}

describe('derivePlannerPlanningTargets', () => {
  it('returns the unique planning-eligible Targets of the valid Entries in stable ID order', () => {
    const b = target('target.derive.b')
    const a = target('target.derive.a')
    const unlisted = target('target.derive.unlisted')
    const disabled = { ...target('target.derive.disabled'), isEnabled: false }
    const entries = [
      routeEntry('entry.derive.b', b, resetRoute('owned.derive.b')),
      routeEntry('entry.derive.a1', a, resetRoute('owned.derive.a1')),
      routeEntry('entry.derive.a2', a, resetRoute('owned.derive.a2')),
      routeEntry('entry.derive.disabled', disabled, resetRoute('owned.derive.d')),
    ].map((entry) => ({ entry, missingRngRequirements: [] }))

    expect(
      derivePlannerPlanningTargets([b, unlisted, disabled, a], entries).map(({ id }) => id),
    ).toEqual([a.id, b.id])
    expect(derivePlannerPlanningTargets([a, b, unlisted], [])).toEqual([])
  })
})

describe('Planner planning Target scope (#102)', () => {
  it('21.1: never counts an active Target that has no BuildListEntry', async () => {
    const { input, dependencies, goal, unlisted } = listedAndUnlisted(1)

    const context = readyContext(input, dependencies)
    expect(context.planningTargetIds).toEqual([goal.id])
    expect(context.planningTargets.map(({ id }) => id)).toEqual([goal.id])
    expect([...context.planningTargetsById.keys()]).toEqual([goal.id])
    expect(Object.keys(context.initialState.targetSatisfaction)).toEqual([goal.id])

    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 1,
      totalTargetCount: 1,
    })
    expect(result.completed).toBe(true)
    expect(result.bestState?.targetSatisfaction[unlisted[0].id]).toBeUndefined()
    // The planning input keeps every Target: only the goal set is narrowed.
    expect(input.targetWeapons.map(({ id }) => id)).toEqual([goal.id, unlisted[0].id])
  })

  it('21.2: counts the Build List Targets, not every active Target, as the denominator', async () => {
    // Five Build List Targets among eight active Targets. Every Build List
    // Target shares one definition, so the first secured weapon satisfies all
    // of them; the three unlisted Targets could never be satisfied.
    const listed = Array.from({ length: 5 }, (_unused, index) =>
      target(`target.scope.many.${index}`),
    )
    const unlisted = Array.from({ length: 3 }, (_unused, index) =>
      unlistedTarget(`target.scope.many.unlisted.${index}`),
    )
    const sources = listed.map((_goal, index) => sourceWeapon(`owned.scope.many.${index}`))
    const entries = listed.map((goal, index) =>
      routeEntry(`entry.scope.many.${index}`, goal, resetRoute(sources[index].id, 10 + index)),
    )
    const { input, dependencies } = fixture([...listed, ...unlisted], entries, sources)

    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.termination.totalTargetCount).toBe(5)
    expect(result.termination.totalTargetCount).not.toBe(input.targetWeapons.length)
    expect(result.termination.status).toBe('completed')
    expect(result.termination.completedTargetCount).toBe(5)
  })

  it('21.3: counts a Target with several valid Entries of a trial input once', async () => {
    const a = target('target.scope.multi.a')
    const b = target('target.scope.multi.b')
    const sources = ['a1', 'a2', 'b1'].map((suffix) => sourceWeapon(`owned.scope.multi.${suffix}`))
    const entries = [
      routeEntry('entry.scope.multi.a1', a, resetRoute(sources[0].id)),
      routeEntry('entry.scope.multi.a2', a, resetRoute(sources[1].id, 11)),
      routeEntry('entry.scope.multi.b1', b, resetRoute(sources[2].id, 12)),
    ]
    const { input, dependencies } = fixture(
      [a, b, unlistedTarget('target.scope.multi.unlisted')],
      entries,
      sources,
    )

    // Only a B8 / what-if trial input may hold several Entries of one Target
    // (`docs/PLANNER_SPEC.md` 9.2.18).
    const context = readyContext(input, dependencies, 'temporary_augmented')
    expect(context.validBuildListEntries).toHaveLength(3)
    expect(context.planningTargetIds).toEqual([a.id, b.id])

    const result = await runPlannerBeamSearch(input, dependencies, {}, 'temporary_augmented')
    expect(result.termination.totalTargetCount).toBe(2)
    expect(result.termination.status).toBe('completed')
    expect(result.termination.completedTargetCount).toBe(2)

    // The ordinary persisted input fails closed on the same legacy duplicate
    // (`docs/PLANNER_SPEC.md` 4.1), still counting each planning Target once
    // in its unsearched termination.
    const ordinary = await runPlannerBeamSearch(input, dependencies)
    expect(ordinary.bestState).toBeNull()
    expect(ordinary.warnings.map(({ kind }) => kind)).toContain(
      'duplicate_build_list_entries_for_target',
    )
    expect(ordinary.termination).toMatchObject({
      status: 'exhausted',
      expandedStates: 0,
      completedTargetCount: 0,
      totalTargetCount: 2,
    })
  })

  it('21.4: never makes a Target whose only Entry is excluded a planning Target', async () => {
    const a = target('target.scope.stale.a')
    const b = { ...target('target.scope.stale.b'), elementId: 'element.fixture.b' }
    const sourceA = sourceWeapon('owned.scope.stale.a')
    const sourceB = sourceWeapon('owned.scope.stale.b')
    const entryA = routeEntry('entry.scope.stale.a', a, resetRoute(sourceA.id))
    const entryB = routeEntry('entry.scope.stale.b', b, resetRoute(sourceB.id, 11))
    const { input, dependencies } = fixture([a, b], [entryA, entryB], [sourceA, sourceB])
    markStale(input.buildListEntries[1])

    const context = readyContext(input, dependencies)
    expect(context.excludedBuildListEntries.map(({ entry }) => entry.id)).toEqual([entryB.id])
    expect(context.warnings.map(({ kind }) => kind)).toContain('build_list_entry_stale')
    expect(context.planningTargetIds).toEqual([a.id])

    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 1,
      totalTargetCount: 1,
    })
  })

  it('21.5: plans nothing and falls back to no active Target when every Entry is excluded', async () => {
    const { input, dependencies } = listedAndUnlisted(2)
    markStale(input.buildListEntries[0])

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(true)
    expect(validation.validBuildListEntries).toEqual([])
    const context = readyContext(input, dependencies)
    expect(context.planningTargetIds).toEqual([])
    expect(context.initialState.targetSatisfaction).toEqual({})

    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.expandedStates).toBe(0)
    expect(result.completed).toBe(false)
    expect(result.bestState?.trace).toEqual([])
    expect(result.termination).toEqual({
      status: 'exhausted',
      reachedLimits: [],
      limits: input.options,
      expandedStates: 0,
      completedTargetCount: 0,
      totalTargetCount: 0,
    })
    const kinds = result.warnings.map(({ kind }) => kind)
    expect(kinds.filter((kind) => kind === 'no_build_list_entries')).toHaveLength(1)
    expect(kinds).toContain('build_list_entry_stale')
    expect(kinds).not.toContain('all_targets_already_satisfied')

    const planned = await createProductionPlan(input, dependencies)
    expect(planned.plan).toBeNull()
    expect(planned.termination.totalTargetCount).toBe(0)
  })

  it('21.5: treats an empty raw Build List exactly like an all-excluded one', async () => {
    const { input, dependencies } = listedAndUnlisted(2)
    input.buildListEntries = []

    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.expandedStates).toBe(0)
    expect(result.termination).toMatchObject({
      status: 'exhausted',
      completedTargetCount: 0,
      totalTargetCount: 0,
    })
    expect(
      result.warnings.filter(({ kind }) => kind === 'no_build_list_entries'),
    ).toHaveLength(1)
  })

  it('21.6: keeps confirm_owned_ideal for a Build List Target that is already Ideal', async () => {
    const goal = orchestrationTarget('target.scope.zero')
    const unlisted = orchestrationTarget('target.scope.zero.unlisted', {
      elementId: 'element.fixture.b',
    })
    const source = orchestrationSource('owned.scope.zero', {
      restorationBonuses: idealBonuses(),
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
    })
    const entry = orchestrationEntry('entry.scope.zero', goal, {
      kind: 'existing_gogma_current',
      sourceOwnedWeaponId: source.id,
      operations: [],
    })
    const built = orchestrationScenario({
      targets: [goal, unlisted],
      entries: [entry],
      ownedWeapons: [source],
    })

    const result = await createProductionPlan(built.input, built.dependencies)

    expect(result.plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'confirm_owned_ideal',
    ])
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 1,
      totalTargetCount: 1,
    })
  })
})
