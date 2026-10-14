import { describe, expect, it } from 'vitest'
import type { BuildListEntry, TargetWeapon } from '../../models/publicTypes'
import { fixture, resetRoute, routeEntry, sourceWeapon, target } from '../../../test/fixtures/plannerBeam'
import type { PlannerDependencies, PlannerInput } from '../plannerTypes'
import { comparePlanningTargetSet, createBuildListOptimizationContext } from './planningContext'

/*
 * Build List global optimization Stage 0 (`docs/PLANNER_SPEC.md` 17.3 / 17.6, design P-3 4.2 / 19.1): the planning Target set
 * is exactly the Production rule - `validatePlannerInput().validBuildListEntries` -> `derivePlannerPlanningTargets()` - never
 * every active Target, never the raw Build List, and never `targetWeapons.length`. An invalid input is never continued.
 */

/** Listed Targets a / b / c, each with a valid one-Reset Entry on its own source, plus one active Target with no Entry. */
function scene(edit: (targets: Record<'a' | 'b' | 'c' | 'unlisted', TargetWeapon>) => void = () => undefined) {
  const targets = { a: target('target.stage0.a'), b: target('target.stage0.b'), c: target('target.stage0.c'), unlisted: { ...target('target.stage0.unlisted'), elementId: 'element.fixture.b' } }
  edit(targets)
  const sources = { a: sourceWeapon('owned.stage0.a'), b: sourceWeapon('owned.stage0.b'), c: sourceWeapon('owned.stage0.c') }
  const entries = (['a', 'b', 'c'] as const).map(key => routeEntry(`entry.stage0.${key}`, targets[key], resetRoute(sources[key].id)))
  const built = fixture([targets.a, targets.b, targets.c, targets.unlisted], entries, Object.values(sources))
  return { ...built, targets, entries }
}

function contextOf(input: PlannerInput, dependencies: PlannerDependencies) {
  const result = createBuildListOptimizationContext(input, dependencies)
  if (result.kind !== 'context') throw new Error(`Expected a context, got ${result.kind}: ${result.detail}`)
  return result.context
}

const idsOf = (targets: readonly TargetWeapon[]) => targets.map(target => target.id)

describe('Stage 0 planning Target context', () => {
  it('holds the Targets with a valid Entry in Target ID order, frozen, and never counts a Target without an Entry', () => {
    const { input, dependencies, targets } = scene()
    const context = contextOf(input, dependencies)
    expect(idsOf(context.planningTargets)).toEqual([targets.a.id, targets.b.id, targets.c.id])
    expect([...context.planningTargetIds]).toEqual([targets.a.id, targets.b.id, targets.c.id])
    expect(Object.isFrozen(context.planningTargets)).toBe(true)
    // The denominator is the planning Target set, not every registered Target.
    expect(input.targetWeapons).toHaveLength(4)
    expect(context.planningTargets).toHaveLength(3)
    expect(context.planningTargetIds.has(targets.unlisted.id)).toBe(false)
    expect(context.validation.isValid).toBe(true)
    expect(context.plannerInput).toBe(input)
  })

  it('leaves out a Target whose only Entry is stale, and keeps the other Targets (partly valid input)', () => {
    const { input, dependencies, targets, entries } = scene()
    // Staleness is recalculated from current data: a stored Target definition hash that no longer matches excludes the Entry.
    entries[1]!.targetDefinitionHash = 'hash.stage0.stale'
    const context = contextOf(input, dependencies)
    expect(idsOf(context.planningTargets)).toEqual([targets.a.id, targets.c.id])
    expect(context.validation.excludedBuildListEntries.map(({ entry }) => entry.targetWeaponId)).toEqual([targets.b.id])
  })

  it('leaves out a disabled and a completed Target even with a valid-looking Entry', () => {
    const disabled = scene(targets => { targets.b = { ...targets.b, isEnabled: false } })
    expect(idsOf(contextOf(disabled.input, disabled.dependencies).planningTargets)).toEqual([disabled.targets.a.id, disabled.targets.c.id])
    const completed = scene(targets => {
      targets.c = { ...targets.c, lifecycleStatus: 'completed', completedAt: '2026-10-01T00:00:00.000Z', completedByProductionPlanId: null, preferredOwnedWeaponId: null }
    })
    expect(idsOf(contextOf(completed.input, completed.dependencies).planningTargets)).toEqual([completed.targets.a.id, completed.targets.b.id])
  })

  it('reports zero valid Entries as no_planning_target, for an empty Build List and for an all-stale one alike', () => {
    const { input, dependencies, entries } = scene()
    const empty = createBuildListOptimizationContext({ ...input, buildListEntries: [] }, dependencies)
    expect(empty).toMatchObject({ kind: 'unsupported_input', reason: 'no_planning_target' })
    for (const entry of entries) entry.targetDefinitionHash = 'hash.stage0.stale'
    const allStale = createBuildListOptimizationContext(input, dependencies)
    expect(allStale).toMatchObject({ kind: 'unsupported_input', reason: 'no_planning_target' })
    expect(allStale.kind === 'unsupported_input' && allStale.validation.excludedBuildListEntries).toHaveLength(3)
  })

  it('never continues an invalid input: a legacy duplicate is invalid_planner_input, not a smaller planning set', () => {
    const { input, dependencies, entries } = scene()
    const duplicate: BuildListEntry = { ...structuredClone(entries[0]!), id: 'build-list.stage0.duplicate' as BuildListEntry['id'] }
    const result = createBuildListOptimizationContext({ ...input, buildListEntries: [...input.buildListEntries, duplicate] }, dependencies)
    expect(result).toMatchObject({ kind: 'unsupported_input', reason: 'invalid_planner_input' })
    expect(result.kind === 'unsupported_input' && result.validation.isValid).toBe(false)
  })

  it('compares the planning Target ID set of another input and never reads an invalid one as unchanged', () => {
    const { input, dependencies, targets, entries } = scene()
    const context = contextOf(input, dependencies)
    expect(comparePlanningTargetSet(context, structuredClone(input), dependencies)).toEqual({ unchanged: true, added: [], removed: [], otherIsValid: true })
    const withoutB = { ...input, buildListEntries: input.buildListEntries.filter(entry => entry.targetWeaponId !== targets.b.id) }
    expect(comparePlanningTargetSet(context, withoutB, dependencies)).toEqual({ unchanged: false, added: [], removed: [targets.b.id], otherIsValid: true })
    const invalid = { ...input, buildListEntries: [...input.buildListEntries, { ...structuredClone(entries[0]!), id: 'build-list.stage0.duplicate' as BuildListEntry['id'] }] }
    expect(comparePlanningTargetSet(context, invalid, dependencies)).toEqual({ unchanged: false, added: [], removed: [targets.a.id, targets.b.id, targets.c.id], otherIsValid: false })
  })
})
