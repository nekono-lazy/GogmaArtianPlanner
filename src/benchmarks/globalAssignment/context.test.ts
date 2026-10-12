import { describe, expect, it } from 'vitest'
import type { BuildListEntry, TargetWeapon } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { comparePlanningTargetSet, createGlobalAssignmentContext } from './context'
import { createGlobalAssignmentFixture, createTableEngine } from './testFixture'

/*
 * Issue #154 Global Assignment Phase 0 (design 4.1 / 13.1): the planning Target set is exactly the
 * Production rule - validatePlannerInput().validBuildListEntries -> derivePlannerPlanningTargets() -
 * never every active Target and never the raw Build List.
 */
async function fixture() {
  const built = await createGlobalAssignmentFixture()
  const dependencies = globalResearchDependencies(createTableEngine().engine)
  return { ...built, dependencies }
}

function contextOf(input: PlannerInput, dependencies: ReturnType<typeof globalResearchDependencies>) {
  const result = createGlobalAssignmentContext(input, dependencies)
  if (result.kind !== 'context') throw new Error(`Expected a context, got ${result.kind}: ${result.detail}`)
  return result.context
}

describe('Phase 0 planning Target context', () => {
  it('(1) holds every active Target that has a valid Entry, in Target ID order, and freezes the set', async () => {
    const { input, dependencies, targets } = await fixture()
    const context = contextOf(input, dependencies)
    expect(context.planningTargets.map(target => target.id)).toEqual([targets.a.id, targets.b.id])
    expect([...context.planningTargetIds]).toEqual([targets.a.id, targets.b.id])
    expect(Object.isFrozen(context.planningTargets)).toBe(true)
    expect(context.validation.isValid).toBe(true)
    expect(context.validation.validBuildListEntries).toHaveLength(2)
    expect(context.plannerInput).toBe(input)
  })

  it('(2) leaves out an active Target with no Entry instead of planning every active Target', async () => {
    const { input, dependencies, targets } = await fixture()
    const d: TargetWeapon = { ...structuredClone(targets.a), id: 'target.fixture.d' as TargetWeapon['id'], elementId: 'element.fixture.d' as TargetWeapon['elementId'] }
    const context = contextOf({ ...input, targetWeapons: [...input.targetWeapons, d] }, dependencies)
    expect(context.planningTargets.map(target => target.id)).toEqual([targets.a.id, targets.b.id])
    expect(context.planningTargetIds.has(d.id)).toBe(false)
    expect(context.plannerInput.targetWeapons).toHaveLength(3)
  })

  it('(3) leaves out a Target whose only Entry is stale or carries an incompatible CalculationContext', async () => {
    const { input, dependencies, targets } = await fixture()
    // target_definition_changed: the Target's Ideal changed after its Entry was added.
    const changed = structuredClone(input) as PlannerInput
    const b = changed.targetWeapons.find(target => target.id === targets.b.id)!
    b.idealBonuses[3] = { ...b.idealBonuses[3], bonusRankId: 'bonus_rank.fixture.middle' } as typeof b.idealBonuses[3]
    const stale = contextOf(changed, dependencies)
    expect(stale.planningTargets.map(target => target.id)).toEqual([targets.a.id])
    expect(stale.validation.excludedBuildListEntries.map(({ entry, reason }) => [entry.targetWeaponId, reason.includes('target_definition_changed')])).toEqual([[targets.b.id, true]])
    // calculation_context_changed: a version 1 Entry is never reused as a current result.
    const outdated = structuredClone(input) as PlannerInput
    outdated.buildListEntries.find(entry => entry.targetWeaponId === targets.b.id)!.calculationContext.appSchemaVersion = 1
    const incompatible = contextOf(outdated, dependencies)
    expect(incompatible.planningTargets.map(target => target.id)).toEqual([targets.a.id])
    expect(incompatible.validation.excludedBuildListEntries.map(({ entry }) => entry.targetWeaponId)).toEqual([targets.b.id])
  })

  it('(4) leaves out a disabled and a completed Target even with a valid-looking Entry', async () => {
    const { input, dependencies, targets } = await fixture()
    const disabled = structuredClone(input) as PlannerInput
    disabled.targetWeapons.find(target => target.id === targets.b.id)!.isEnabled = false
    expect(contextOf(disabled, dependencies).planningTargets.map(target => target.id)).toEqual([targets.a.id])
    const completed = structuredClone(input) as PlannerInput
    const target = completed.targetWeapons.find(value => value.id === targets.b.id)!
    target.lifecycleStatus = 'completed'
    target.completedAt = '2026-10-01T00:00:00.000Z'
    expect(contextOf(completed, dependencies).planningTargets.map(value => value.id)).toEqual([targets.a.id])
  })

  it('(5) reports zero valid Entries as no_planning_target, for an empty Build List and for an all-excluded one alike', async () => {
    const { input, dependencies } = await fixture()
    const empty = createGlobalAssignmentContext({ ...input, buildListEntries: [] }, dependencies)
    expect(empty.kind).toBe('unsupported_input')
    expect(empty.kind === 'unsupported_input' && empty.reason).toBe('no_planning_target')
    const excluded = structuredClone(input) as PlannerInput
    for (const entry of excluded.buildListEntries) entry.calculationContext.appSchemaVersion = 1
    const allExcluded = createGlobalAssignmentContext(excluded, dependencies)
    expect(allExcluded.kind === 'unsupported_input' && allExcluded.reason).toBe('no_planning_target')
    expect(allExcluded.kind === 'unsupported_input' && allExcluded.validation.excludedBuildListEntries).toHaveLength(2)
    // Two enabled active Targets exist, yet none is a planning Target.
    expect(excluded.targetWeapons.filter(target => target.isEnabled && target.lifecycleStatus === 'active')).toHaveLength(2)
  })

  it('never continues an invalid Planner input as if it were valid', async () => {
    const { input, dependencies, targets } = await fixture()
    const first = input.buildListEntries.find(entry => entry.targetWeaponId === targets.a.id)!
    const duplicate: BuildListEntry = { ...structuredClone(first), id: 'build-list.fixture.duplicate' as BuildListEntry['id'] }
    const result = createGlobalAssignmentContext({ ...input, buildListEntries: [...input.buildListEntries, duplicate] }, dependencies)
    expect(result.kind).toBe('unsupported_input')
    expect(result.kind === 'unsupported_input' && result.reason).toBe('invalid_planner_input')
    expect(result.kind === 'unsupported_input' && result.detail).toMatch(/at most one Entry per Target/)
  })

  it('(6) compares the planning Target ID set of another input and never reads an invalid one as unchanged', async () => {
    const { input, dependencies, targets } = await fixture()
    const context = contextOf(input, dependencies)
    expect(comparePlanningTargetSet(context, structuredClone(input) as PlannerInput, dependencies)).toEqual({ unchanged: true, added: [], removed: [], otherIsValid: true })
    const withoutB = { ...input, buildListEntries: input.buildListEntries.filter(entry => entry.targetWeaponId !== targets.b.id) }
    expect(comparePlanningTargetSet(context, withoutB, dependencies)).toEqual({ unchanged: false, added: [], removed: [targets.b.id], otherIsValid: true })
    const first = input.buildListEntries[0]!
    const invalid = { ...input, buildListEntries: [...input.buildListEntries, { ...structuredClone(first), id: 'build-list.fixture.duplicate' as BuildListEntry['id'] }] }
    expect(comparePlanningTargetSet(context, invalid, dependencies)).toEqual({ unchanged: false, added: [], removed: [targets.a.id, targets.b.id], otherIsValid: false })
  })
})
