import { describe, expect, it } from 'vitest'
import { BUILD_LIST_OPTIMIZATION_TEST_BOUNDS } from '../../../test/fixtures/buildListOptimizationWorkerFixtures'
import { createValidNormalArtianCounter, ownedWeaponId } from '../../../test/fixtures/domainData'
import {
  bonusPart,
  blindPart,
  checkpointPart,
  legacyDuplicateScenario,
  planCreationScenario as scenario,
  skillPart,
  withPlanCreationRngState as withRngState,
} from '../../../test/fixtures/planCreationMethod'
import { CONFLICT_GOGMA_COUNTER, CONFLICT_SKILL_COUNTER, type OrchestrationScenario } from '../../../test/fixtures/plannerConstrainedOrchestration'
import { validatePlannerInput } from '../plannerValidation'
import type { BuildListOptimizationDiagnostics, BuildListOptimizationResult, BuildListOptimizationUnsupportedReason } from './buildListOptimizationResult'
import { runBuildListOptimization } from './optimizeBuildList'
import {
  isOrdinaryPlannerAuxiliaryOfferedForResult,
  isOrdinaryPlannerAuxiliaryOfferedForUnsupported,
  planCreationMethodOf,
  selectPlanCreationMethod,
  type PlanCreationMethodSelection,
} from './planCreationMethod'

/*
 * Issue #260 PR-6B1: the plan creation method of the Build List screen (`docs/PLANNER_SPEC.md` 17.2 U1 / 17.4) over inputs the real
 * `validatePlannerInput()` judges (the constrained orchestration fixture: one weapon type and element, a fixture Engine whose support
 * follows its capabilities).
 */

function select(built: OrchestrationScenario): PlanCreationMethodSelection {
  return selectPlanCreationMethod(built.input, built.dependencies)
}

const NO_DIAGNOSTICS: BuildListOptimizationDiagnostics = { reachTable: null, structuralSearch: null, candidates: [], plannerVerifications: 0, elapsedMs: null }

describe('selectPlanCreationMethod: the method by the valid Entry count of validatePlannerInput() (PLANNER_SPEC 17.2)', () => {
  it('creates nothing from no Entry, the ordinary Planner from one valid Entry and the optimization from two or more', () => {
    const none = select(scenario([]))
    expect(none.kind).toBe('no_valid_build_list_entry')
    expect(none.validation.validBuildListEntries).toEqual([])
    const one = select(scenario([bonusPart('a')]))
    expect(one).toMatchObject({ kind: 'ordinary_planner', validation: { isValid: true } })
    expect(one.validation.validBuildListEntries).toHaveLength(1)
    expect(planCreationMethodOf(one)).toBe('ordinary_planner')
    const two = select(scenario([bonusPart('a'), bonusPart('b')]))
    expect(two.kind).toBe('build_list_optimization')
    expect(planCreationMethodOf(two)).toBe('build_list_optimization')
    const three = select(scenario([bonusPart('a'), bonusPart('b'), skillPart('c')]))
    expect(three.kind).toBe('build_list_optimization')
    expect(three.validation.validBuildListEntries).toHaveLength(3)
    expect(planCreationMethodOf(none)).toBeNull()
  })

  it('counts valid Entries only: a stale Entry, a completed Target and a disabled Target do not count, and the raw count never decides', () => {
    // Raw 2, valid 1: the ordinary Planner.
    const stale = scenario([bonusPart('a'), bonusPart('b')])
    stale.input.buildListEntries[1]!.targetDefinitionHash = 'fnv1a32:00000000'
    const staleSelection = select(stale)
    expect(staleSelection.kind).toBe('ordinary_planner')
    expect(staleSelection.validation.excludedBuildListEntries.map(({ entry }) => entry.id)).toEqual(['build-list.method.b'])
    expect(staleSelection.validation.excludedBuildListEntryWarnings.map(({ warning }) => warning.kind)).toEqual(['build_list_entry_stale'])

    const completed = select(scenario([bonusPart('a'), bonusPart('done', { lifecycleStatus: 'completed', completedAt: '2026-10-01T00:00:00.000Z' })]))
    expect(completed.kind).toBe('ordinary_planner')
    expect(completed.validation.excludedBuildListEntryWarnings.map(({ warning }) => warning.kind)).toEqual(['completed_target_excluded'])

    const disabled = select(scenario([bonusPart('a'), bonusPart('off', { isEnabled: false })]))
    expect(disabled.kind).toBe('ordinary_planner')

    // Raw 4, valid 2: the optimization; every excluded Entry stays named with its typed warning.
    const mixed = scenario([bonusPart('a'), bonusPart('b'), bonusPart('c'), bonusPart('done', { lifecycleStatus: 'completed', completedAt: '2026-10-01T00:00:00.000Z' })])
    mixed.input.buildListEntries[2]!.targetDefinitionHash = 'fnv1a32:00000000'
    const mixedSelection = select(mixed)
    expect(mixedSelection.kind).toBe('build_list_optimization')
    expect(mixedSelection.validation.validBuildListEntries.map(({ entry }) => entry.id)).toEqual(['build-list.method.a', 'build-list.method.b'])

    // Every Entry excluded: nothing can be created, and the reasons stay typed.
    const allStale = scenario([bonusPart('a'), bonusPart('b')])
    allStale.input.buildListEntries.forEach((entry) => { entry.targetDefinitionHash = 'fnv1a32:00000000' })
    const empty = select(allStale)
    expect(empty.kind).toBe('no_valid_build_list_entry')
    expect(empty.validation.excludedBuildListEntryWarnings.map(({ buildListEntryId }) => buildListEntryId)).toEqual(['build-list.method.a', 'build-list.method.b'])
  })

  it('fails closed on a whole-input violation before counting, keeping the typed issues', () => {
    // A legacy duplicate: two Entries of one Target (with one other valid Target the count alone would be 3).
    const duplicateSelection = select(legacyDuplicateScenario())
    expect(duplicateSelection.kind).toBe('invalid_planner_input')
    expect(duplicateSelection.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'buildListEntries', code: 'invalid_structure' })]))
    expect(duplicateSelection.validation.warnings.map(({ kind }) => kind)).toContain('duplicate_build_list_entries_for_target')
    expect(planCreationMethodOf(duplicateSelection)).toBeNull()

    // A broken intermediate state selection on the only valid Entry: judged before the count of 1.
    const broken = scenario([bonusPart('a')])
    broken.input.buildListEntries[0]!.intermediateStateSelection = { skillOpportunityId: 'opportunity.method.unknown' as never, bonusOpportunityId: null, improvementPreference: 'planner' }
    const brokenSelection = select(broken)
    expect(brokenSelection.kind).toBe('invalid_planner_input')
    expect(brokenSelection.validation.issues.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'buildListEntries.build-list.method.a.intermediateStateSelection', code: 'invalid_state' },
    ])

    // A preferred owned weapon that does not exist.
    const preference = scenario([bonusPart('a', { preferredOwnedWeaponId: ownedWeaponId('owned.method.missing') }), bonusPart('b')])
    const preferenceSelection = select(preference)
    expect(preferenceSelection.kind).toBe('invalid_planner_input')
    expect(preferenceSelection.validation.issues.length).toBeGreaterThan(0)
    // The same issues the Planner's own validation reports: the judgement adds and drops none.
    expect(preferenceSelection.validation.issues).toEqual(validatePlannerInput(preference.input, preference.dependencies).issues)
  })

  it('reads no option: neither the user setting nor an invalid value of it decides the method', () => {
    for (const parts of [[bonusPart('a')], [bonusPart('a'), bonusPart('b')]]) {
      const reference = select(scenario(parts))
      for (const maxPlanSteps of [1, 7, 1000, 0, -3, 1.5, Number.NaN]) {
        const built = scenario(parts)
        built.input.options = { maxPlanSteps }
        const selection = select(built)
        expect(selection.kind, String(maxPlanSteps)).toBe(reference.kind)
        expect(selection.validation.isValid, String(maxPlanSteps)).toBe(true)
        expect(selection.validation.issues).toEqual([])
      }
    }
  })

  it('runs the ordinary Planner for one valid Entry whatever its selection and improvement preference (the optimization never judges it)', () => {
    const selected = select(scenario([checkpointPart('a')]))
    expect(selected.kind).toBe('ordinary_planner')
    expect(selected.validation.validBuildListEntries[0]!.entry.intermediateStateSelection?.bonusOpportunityId).not.toBeNull()
    const preferred = scenario([bonusPart('a')])
    preferred.input.buildListEntries[0]!.intermediateStateSelection = { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'skill_first' }
    expect(select(preferred).kind).toBe('ordinary_planner')
    // A partly unconfirmed RNG state the ordinary Planner handles: the Entry depending on the missing Gogma Counter is excluded, the
    // Skill Entry stays, and one valid Entry is the ordinary Planner (never "nothing can be created" for the whole input).
    const partial = withRngState(scenario([bonusPart('a'), skillPart('b')]), (state) => {
      state.gogmaCounter = { value: CONFLICT_GOGMA_COUNTER, isConfirmed: false, source: 'manual' }
    })
    const partialSelection = select(partial)
    expect(partialSelection.kind).toBe('ordinary_planner')
    expect(partialSelection.validation.validBuildListEntries.map(({ entry }) => entry.id)).toEqual(['build-list.method.b'])
  })

  it('refuses an input carrying conflict resolutions (the caller contract of a fresh input)', () => {
    const built = scenario([bonusPart('a'), bonusPart('b')])
    built.input.conflictResolutions = [{ conflictKey: 'conflict.x', selectedBuildListEntryId: built.input.buildListEntries[0]!.id }]
    expect(() => select(built)).toThrow(RangeError)
  })
})

describe('selectPlanCreationMethod: the optimization unsupported reasons before any calculation (PLANNER_SPEC 17.4)', () => {
  it('refuses an explicit checkpoint selection on a planning Target and never clears it', () => {
    const built = scenario([checkpointPart('a'), bonusPart('b')])
    const before = structuredClone(built.input.buildListEntries)
    const selection = select(built)
    expect(selection).toMatchObject({
      kind: 'build_list_optimization_unsupported',
      reasons: [{ kind: 'checkpoint_selection', entries: [{ buildListEntryId: 'build-list.method.a', targetWeaponId: 'target.method.a' }] }],
      ordinaryPlannerAuxiliary: true,
    })
    expect(planCreationMethodOf(selection)).toBeNull()
    expect(built.input.buildListEntries).toEqual(before)
  })

  it('refuses an unconfirmed RNG value when two valid Entries do not need it', () => {
    const built = withRngState(scenario([bonusPart('a'), bonusPart('b')]), (state) => {
      state.skillCounter = { value: CONFLICT_SKILL_COUNTER, isConfirmed: false, source: 'manual' }
    })
    const selection = select(built)
    expect(selection.validation.validBuildListEntries).toHaveLength(2)
    expect(selection).toMatchObject({ kind: 'build_list_optimization_unsupported', reasons: [{ kind: 'unconfirmed_rng_state', missing: ['skill_counter'] }], ordinaryPlannerAuxiliary: true })
  })

  it('refuses Targets with no owned source and no confirmed Normal Counter, and Targets only a blind Route can reach', () => {
    const withoutCounter = select(scenario([blindPart('a'), blindPart('b')], { normalCounters: [] }))
    expect(withoutCounter.validation.validBuildListEntries).toHaveLength(2)
    expect(withoutCounter).toMatchObject({
      kind: 'build_list_optimization_unsupported',
      reasons: [{ kind: 'target_without_source', targetWeaponIds: ['target.method.a', 'target.method.b'] }],
      ordinaryPlannerAuxiliary: true,
    })
    const unconfirmed = select(scenario([blindPart('a'), blindPart('b')], { normalCounters: [{ ...createValidNormalArtianCounter(), isConfirmed: false }] }))
    expect(unconfirmed).toMatchObject({ kind: 'build_list_optimization_unsupported', reasons: [{ kind: 'target_without_source' }] })
    const blind = select(scenario([blindPart('a'), blindPart('b')], { normalCounters: [createValidNormalArtianCounter()], normalSupported: false }))
    expect(blind.validation.validBuildListEntries).toHaveLength(2)
    expect(blind).toMatchObject({
      kind: 'build_list_optimization_unsupported',
      reasons: [{ kind: 'blind_route_required', targetWeaponIds: ['target.method.a', 'target.method.b'] }],
      ordinaryPlannerAuxiliary: true,
    })
  })

  it('names every reason at once, in the order Stage 0 checks them, exactly as the calculation does', async () => {
    const built = withRngState(scenario([checkpointPart('a'), bonusPart('b')]), (state) => {
      state.skillCounter = { value: CONFLICT_SKILL_COUNTER, isConfirmed: false, source: 'manual' }
    })
    const selection = select(built)
    expect(selection.kind).toBe('build_list_optimization_unsupported')
    if (selection.kind !== 'build_list_optimization_unsupported') return
    expect(selection.reasons.map(({ kind }) => kind)).toEqual(['unconfirmed_rng_state', 'checkpoint_selection'])
    // Stage 0 of the calculation returns the very same reasons (one rule: deriveBuildListOptimizationUnsupportedReasons()).
    const run = await runBuildListOptimization(built.input, built.dependencies, structuredClone(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS))
    expect(run).toEqual({ kind: 'result', result: { status: 'unsupported', reasons: selection.reasons } })
  })

  it('never refuses for an improvement preference, a Practical condition or an offered intermediate state alone', () => {
    const preferred = scenario([bonusPart('a'), bonusPart('b'), checkpointPart('c', false)])
    preferred.input.buildListEntries[0]!.intermediateStateSelection = { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'bonus_first' }
    preferred.input.buildListEntries[1]!.intermediateStateSelection = { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'skill_first' }
    // Every Target carries Practical Bonus, Alternative and Practical Skill conditions, and Entry c offers intermediate states.
    expect(preferred.input.targetWeapons.every((target) => target.practicalBonusConditions.length > 0 && target.alternativeBonusRules.length > 0 && target.practicalSkillCondition !== null)).toBe(true)
    expect(preferred.input.buildListEntries[2]!.candidateSnapshot.intermediateStateGroups?.length).toBeGreaterThan(0)
    expect(select(preferred).kind).toBe('build_list_optimization')
  })
})

describe('the ordinary Planner auxiliary offer (PLANNER_SPEC 17.2 「通常Plannerの補助導線」)', () => {
  it('is offered for not_found, search_bound_reached and an unsupported the ordinary Planner can run despite, never for optimized', () => {
    expect(isOrdinaryPlannerAuxiliaryOfferedForResult({ status: 'not_found', reason: 'candidates_rejected', diagnostics: NO_DIAGNOSTICS })).toBe(true)
    expect(isOrdinaryPlannerAuxiliaryOfferedForResult({ status: 'not_found', reason: 'no_structural_candidate', diagnostics: NO_DIAGNOSTICS })).toBe(true)
    expect(isOrdinaryPlannerAuxiliaryOfferedForResult({ status: 'search_bound_reached', bounds: [{ kind: 'structural_search_node_budget', nodeBudget: 1 }], diagnostics: NO_DIAGNOSTICS })).toBe(true)
    expect(isOrdinaryPlannerAuxiliaryOfferedForResult({ status: 'optimized', artifact: {} as never })).toBe(false)
    const runnable: BuildListOptimizationResult = {
      status: 'unsupported',
      reasons: [
        { kind: 'checkpoint_selection', entries: [] },
        { kind: 'unconfirmed_rng_state', missing: ['base_seed'] },
        { kind: 'target_without_source', targetWeaponIds: [] },
        { kind: 'blind_route_required', targetWeaponIds: [] },
      ],
    }
    expect(isOrdinaryPlannerAuxiliaryOfferedForResult(runnable)).toBe(true)
  })

  it('is not offered when a reason stops the ordinary Planner too, or with no reason', () => {
    const blockingReasons: BuildListOptimizationUnsupportedReason[] = [{ kind: 'running_plan_exists' }, { kind: 'invalid_planner_input', issues: [] }, { kind: 'no_planning_target' }]
    for (const blocking of blockingReasons) {
      expect(isOrdinaryPlannerAuxiliaryOfferedForUnsupported([blocking]), blocking.kind).toBe(false)
      expect(isOrdinaryPlannerAuxiliaryOfferedForUnsupported([{ kind: 'checkpoint_selection', entries: [] }, blocking]), blocking.kind).toBe(false)
      expect(isOrdinaryPlannerAuxiliaryOfferedForResult({ status: 'unsupported', reasons: [blocking] }), blocking.kind).toBe(false)
    }
    expect(isOrdinaryPlannerAuxiliaryOfferedForUnsupported([])).toBe(false)
  })
})
