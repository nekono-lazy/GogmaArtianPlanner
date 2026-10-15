import { describe, expect, it } from 'vitest'
import type { BuildListEntry, TargetWeapon } from '../../models/publicTypes'
import { stableStringify } from '../../models/publicTypes'
import { fixture, resetRoute, routeEntry, sourceWeapon, synchronizeEntry, target } from '../../../test/fixtures/plannerBeam'
import { roundUpPlannerMaxPlanSteps } from '../plannerStepBound'
import { validatePlannerInput } from '../plannerValidation'
import { BuildListOptimizationInvariantError } from './buildListOptimizationTypes'
import {
  BUILD_LIST_OPTIMIZATION_MAX_PLAN_STEPS_MARGIN, buildBuildListOptimizationFinalInput, buildListOptimizationInputExclusionsOf, deriveBuildListOptimizationMaxPlanSteps,
  unexplainedBuildListOptimizationWarnings,
} from './finalVerification'
import { countBuildListOptimizationOutOfScopeTargets } from './optimizationInputScope'
import { createBuildListOptimizationContext } from './planningContext'
import { collectReachTablePreconditionViolations } from './reachTable'

/*
 * Build List global optimization Stage D' (`docs/PLANNER_SPEC.md` 17.7 / 17.13): the final verification bound, the final input built
 * through the replacement authority, the out-of-scope Target classes, the typed exclusions and the Stage 0 preconditions. The Stage D /
 * D' pipeline over generated Routes is covered by the Production tests beside the Research fixtures
 * (`src/benchmarks/globalAssignment/production*.test.ts`).
 */

function invariantCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof BuildListOptimizationInvariantError) return error.code
    throw error
  }
  throw new Error('expected a BuildListOptimizationInvariantError')
}

describe('Stage D\' final verification bound (PLANNER_SPEC 17.13)', () => {
  it('derives roundUpPlannerMaxPlanSteps(structuralObjective + planningTargetCount) + 500 with the shared 500-step rounding', () => {
    expect(BUILD_LIST_OPTIMIZATION_MAX_PLAN_STEPS_MARGIN).toBe(500)
    // The D-1C candidate: objective 1,766 over 43 planning Targets -> 1,809 required actions -> 2,000 -> 2,500.
    expect(deriveBuildListOptimizationMaxPlanSteps(1766, 43)).toBe(2500)
    expect(deriveBuildListOptimizationMaxPlanSteps(0, 1)).toBe(1000)
    expect(deriveBuildListOptimizationMaxPlanSteps(499, 1)).toBe(1000)
    expect(deriveBuildListOptimizationMaxPlanSteps(500, 1)).toBe(1500)
    expect(deriveBuildListOptimizationMaxPlanSteps(1000, 500)).toBe(2000)
    // A zero-operation Target adds nothing to the objective and one action (its confirm_owned_ideal) to the required actions.
    expect(deriveBuildListOptimizationMaxPlanSteps(5, 3)).toBe(roundUpPlannerMaxPlanSteps(8) + 500)
    for (const [objective, count] of [[1, 1], [1234, 7], [10_000, 43]] as const) {
      expect(deriveBuildListOptimizationMaxPlanSteps(objective, count)).toBe(roundUpPlannerMaxPlanSteps(objective + count) + 500)
    }
  })

  it('fails closed on a value that is not a safe integer in range, never falling back to a guessed bound', () => {
    for (const objective of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(invariantCode(() => deriveBuildListOptimizationMaxPlanSteps(objective, 1))).toBe('step_bound_invalid')
    }
    for (const count of [0, -1, 2.5, Number.NaN]) {
      expect(invariantCode(() => deriveBuildListOptimizationMaxPlanSteps(10, count))).toBe('step_bound_invalid')
    }
    // The sum and the rounded result must stay safe integers too.
    expect(invariantCode(() => deriveBuildListOptimizationMaxPlanSteps(Number.MAX_SAFE_INTEGER, 1))).toBe('step_bound_invalid')
    expect(invariantCode(() => deriveBuildListOptimizationMaxPlanSteps(Number.MAX_SAFE_INTEGER - 10, 1))).toBe('step_bound_invalid')
  })
})

/** Targets a / b (each with one Entry on its own source) and an out-of-scope Target c with one Entry. */
function scene() {
  const targets = { a: target('target.final.a'), b: target('target.final.b'), c: target('target.final.c') }
  const sources = { a: sourceWeapon('owned.final.a'), b: sourceWeapon('owned.final.b'), c: sourceWeapon('owned.final.c') }
  const entries = (['a', 'b', 'c'] as const).map(key => routeEntry(`entry.final.${key}`, targets[key], resetRoute(sources[key].id)))
  const built = fixture(Object.values(targets), entries, Object.values(sources))
  return { ...built, targets, sources, entries }
}

/** A generated Entry for `targetWeapon` on its own source with another Reset position (a different Route). */
function generated(id: string, input: ReturnType<typeof scene>['input'], targetWeapon: TargetWeapon, sourceId: string, counter = 11): BuildListEntry {
  const entry = routeEntry(id, targetWeapon, resetRoute(sourceId, counter))
  synchronizeEntry(input, entry)
  return entry
}

describe('Stage D\' final input (the replacement authority, PLANNER_SPEC 17.7 / 17.11)', () => {
  it('replaces each Target\'s one persisted Entry with its generated Entry, keeps every other Entry, and carries no resolution', () => {
    const { input, targets, sources, entries } = scene()
    input.conflictResolutions = []
    const before = stableStringify(input)
    const ga = generated('build-list.constrained.fixture-a', input, targets.a, sources.a.id)
    const gb = generated('build-list.constrained.fixture-b', input, targets.b, sources.b.id)
    const final = buildBuildListOptimizationFinalInput(input, [gb, ga], 2500)
    expect(final.replacements).toEqual([
      { targetWeaponId: targets.b.id, replacedBuildListEntryId: entries[1]!.id, generatedBuildListEntryId: gb.id },
      { targetWeaponId: targets.a.id, replacedBuildListEntryId: entries[0]!.id, generatedBuildListEntryId: ga.id },
    ])
    expect(final.generatedBuildListEntries.map(entry => entry.id)).toEqual([gb.id, ga.id])
    expect(final.unchangedTargetWeaponIds).toEqual([])
    expect(final.routeEntryIds).toEqual([gb.id, ga.id])
    // The out-of-scope Target c keeps its Entry; the generated Entries are appended once, in materialization order.
    expect(final.input.buildListEntries.map(entry => entry.id)).toEqual([entries[2]!.id, gb.id, ga.id])
    expect(final.input.conflictResolutions).toEqual([])
    expect(final.input.options).toEqual({ maxPlanSteps: 2500 })
    for (const key of ['targetWeapons', 'ownedWeapons', 'rngState', 'normalCounters', 'calculationContext', 'master'] as const) {
      expect(stableStringify(final.input[key])).toBe(stableStringify(input[key]))
    }
    // The original input is never edited.
    expect(stableStringify(input)).toBe(before)
  })

  it('keeps a Target unchanged when its generated Entry is its persisted Entry (the materializer\'s same-semantic reuse)', () => {
    const { input, targets, sources, entries } = scene()
    const gb = generated('build-list.constrained.fixture-b', input, targets.b, sources.b.id)
    const final = buildBuildListOptimizationFinalInput(input, [structuredClone(entries[0]!), gb], 1000)
    expect(final.unchangedTargetWeaponIds).toEqual([targets.a.id])
    expect(final.replacements.map(value => value.targetWeaponId)).toEqual([targets.b.id])
    expect(final.generatedBuildListEntries.map(entry => entry.id)).toEqual([gb.id])
    expect(final.routeEntryIds).toEqual([entries[0]!.id, gb.id])
    expect(final.input.buildListEntries.map(entry => entry.id)).toEqual([entries[0]!.id, entries[2]!.id, gb.id])
  })

  it('fails closed when Stage D did not hand over one Route per Target through the replacement authority', () => {
    const { input, targets, sources, entries } = scene()
    const ga = generated('build-list.constrained.fixture-a', input, targets.a, sources.a.id)
    // Two Routes for one Target.
    expect(invariantCode(() => buildBuildListOptimizationFinalInput(input, [ga, generated('build-list.constrained.fixture-a2', input, targets.a, sources.a.id, 12)], 1000))).toBe('final_input_invariant')
    // A "reused" Entry whose content differs from the persisted Entry of the same ID.
    const edited = structuredClone(entries[0]!)
    edited.intermediateStateSelection = { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'skill_first' }
    expect(invariantCode(() => buildBuildListOptimizationFinalInput(input, [edited], 1000))).toBe('final_input_invariant')
    // A generated Entry of a Target without a persisted Entry.
    const other = target('target.final.other')
    const orphan = routeEntry('build-list.constrained.fixture-orphan', other, resetRoute(sources.a.id, 13))
    expect(invariantCode(() => buildBuildListOptimizationFinalInput(input, [orphan], 1000))).toBe('final_input_invariant')
    // A Target holding two persisted Entries never names the replaced one.
    const duplicate = routeEntry('entry.final.a2', targets.a, resetRoute(sources.a.id, 14))
    const withDuplicate = { ...input, buildListEntries: [...input.buildListEntries, duplicate] }
    expect(invariantCode(() => buildBuildListOptimizationFinalInput(withDuplicate, [ga], 1000))).toBe('final_input_invariant')
  })
})

describe('Stage 0 scope: the out-of-scope Targets and the typed exclusions', () => {
  it('puts every registered Target that is no planning Target into exactly one class (completed, disabled, excluded Entry only, no Entry)', () => {
    const { input, targets } = scene()
    const completed: TargetWeapon = { ...target('target.scope.completed'), lifecycleStatus: 'completed', completedAt: '2026-08-01T00:00:00.000Z', completedByProductionPlanId: null }
    const completedAndDisabled: TargetWeapon = { ...completed, id: target('target.scope.completed-disabled').id, isEnabled: false }
    const disabled: TargetWeapon = { ...target('target.scope.disabled'), isEnabled: false }
    const staleOnly = target('target.scope.stale-only')
    const noEntry = target('target.scope.no-entry')
    const scoped = {
      targetWeapons: [...input.targetWeapons, completed, completedAndDisabled, disabled, staleOnly, noEntry],
      buildListEntries: [...input.buildListEntries, routeEntry('entry.scope.disabled', disabled, resetRoute('owned.final.a')), routeEntry('entry.scope.stale', staleOnly, resetRoute('owned.final.a'))],
    }
    const planning = new Set([targets.a.id, targets.b.id])
    expect(countBuildListOptimizationOutOfScopeTargets(scoped, planning)).toEqual({ noEntry: 1, excludedEntryOnly: 2, disabled: 1, completed: 2 })
    // The planning Targets are never counted: the classes never add to the planning denominator.
    expect(countBuildListOptimizationOutOfScopeTargets(scoped, new Set([...planning, targets.c.id]))).toEqual({ noEntry: 1, excludedEntryOnly: 1, disabled: 1, completed: 2 })
  })

  it('reports each excluded Entry with the very warning its exclusion added (kind and message copied as values, never parsed)', () => {
    const { input, dependencies, targets, entries } = scene()
    // c's Target completed; a's Entry stale.
    input.targetWeapons = input.targetWeapons.map(value => (value.id === targets.c.id ? { ...value, lifecycleStatus: 'completed', completedAt: '2026-08-01T00:00:00.000Z', completedByProductionPlanId: null } : value))
    input.buildListEntries = input.buildListEntries.map(entry => (entry.id === entries[0]!.id ? { ...entry, searchStateHash: 'fnv1a32:00000000' } : entry))
    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(true)
    expect(validation.excludedBuildListEntryWarnings.map(({ buildListEntryId, warning }) => [buildListEntryId, warning.kind]).sort()).toEqual([
      [entries[0]!.id, 'build_list_entry_stale'], [entries[2]!.id, 'completed_target_excluded'],
    ].sort())
    // The same values the validation added to its warnings, one per excluded Entry, in the excluded Entries' order.
    expect(validation.excludedBuildListEntryWarnings.map(({ buildListEntryId }) => buildListEntryId)).toEqual(validation.excludedBuildListEntries.map(({ entry }) => entry.id))
    for (const { warning } of validation.excludedBuildListEntryWarnings) expect(validation.warnings).toContainEqual(warning)
    const messageOf = (id: string) => validation.excludedBuildListEntryWarnings.find(({ buildListEntryId }) => buildListEntryId === id)!.warning.message
    expect(buildListOptimizationInputExclusionsOf(validation)).toEqual(validation.excludedBuildListEntries.map(({ entry }) => ({
      buildListEntryId: entry.id, targetWeaponId: entry.targetWeaponId,
      warningKind: entry.id === entries[0]!.id ? 'build_list_entry_stale' : 'completed_target_excluded',
      warningMessage: messageOf(entry.id),
    })))
  })
})

describe("the exclusion warning rule Stage D' and the adoption share (PLANNER_SPEC 17.7 item 3)", () => {
  const stale = (id: string) => ({ kind: 'build_list_entry_stale' as const, message: `BuildListEntry '${id}' is stale (rng_state_changed).` })
  const completed = { kind: 'completed_target_excluded' as const, message: "BuildListEntry 'entry.c' references a completed TargetWeapon." }

  it('explains each warning by one allowed warning of the same kind and message, multiplicity counted, and leaves no allowed warning required', () => {
    const allowed = [stale('entry.a'), stale('entry.b'), completed]
    expect(unexplainedBuildListOptimizationWarnings([stale('entry.b'), completed, stale('entry.a')], allowed)).toEqual([])
    // An allowed warning that does not occur is no issue (containment, not equality).
    expect(unexplainedBuildListOptimizationWarnings([completed], allowed)).toEqual([])
    expect(unexplainedBuildListOptimizationWarnings([], allowed)).toEqual([])
    // A repeated allowed value explains as many warnings as it occurs.
    expect(unexplainedBuildListOptimizationWarnings([stale('entry.a'), stale('entry.a')], [stale('entry.a'), stale('entry.a')])).toEqual([])
  })

  it('leaves unexplained a warning of the same kind with another message, a new kind, and a warning beyond its multiplicity', () => {
    const allowed = [stale('entry.a'), stale('entry.b')]
    expect(unexplainedBuildListOptimizationWarnings([stale('entry.a'), { ...stale('entry.b'), message: 'rewritten' }], allowed))
      .toEqual([{ ...stale('entry.b'), message: 'rewritten' }])
    expect(unexplainedBuildListOptimizationWarnings([stale('entry.a'), stale('entry.a')], allowed)).toEqual([stale('entry.a')])
    expect(unexplainedBuildListOptimizationWarnings([stale('entry.a'), completed], allowed)).toEqual([completed])
    expect(unexplainedBuildListOptimizationWarnings([stale('entry.a')], [])).toEqual([stale('entry.a')])
  })
})

describe('Stage 0 preconditions (PLANNER_SPEC 17.4): every reason, apart from the scan\'s first-reason stop', () => {
  it('names the unconfirmed RNG value a still valid input lacks, and the first-reason order the ReachTable reports is the same value', () => {
    const { input, dependencies, targets, sources } = scene()
    // Reset Skills Entries stay valid without a confirmed Gogma Counter (the Planner excludes only the Entries that need it).
    input.buildListEntries = (['a', 'b'] as const).map(key => routeEntry(`entry.final.skill.${key}`, targets[key], {
      kind: 'existing_gogma_reset_skills', sourceOwnedWeaponId: sources[key].id,
      operations: [{ type: 'reset_skills', sourceOwnedWeaponId: sources[key].id, skillCounterBefore: 7, skillCounterAfter: 8 }],
    }))
    input.rngState.gogmaCounter = { ...input.rngState.gogmaCounter, value: null, isConfirmed: false }
    input.buildListEntries.forEach(entry => synchronizeEntry(input, entry))
    const created = createBuildListOptimizationContext(input, dependencies)
    if (created.kind !== 'context') throw new Error(created.detail)
    const all = collectReachTablePreconditionViolations(created.context, dependencies.rngEngine, { all: true })
    expect(all).toEqual([{ reason: 'unconfirmed_rng_state', missing: ['gogma_counter'], detail: 'No confirmed value for: Gogma Counter.' }])
    expect(collectReachTablePreconditionViolations(created.context, dependencies.rngEngine, { all: false })).toEqual(all)
  })

  it('reports nothing for an input every precondition holds for', () => {
    const { input, dependencies } = scene()
    const created = createBuildListOptimizationContext(input, dependencies)
    if (created.kind !== 'context') throw new Error(created.detail)
    expect(collectReachTablePreconditionViolations(created.context, dependencies.rngEngine, { all: true })).toEqual([])
  })
})
