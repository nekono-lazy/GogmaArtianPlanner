import { beforeAll, describe, expect, it } from 'vitest'
import type { BuildListEntryId, ProductionPlan, TargetWeaponId } from '../../models/publicTypes'
import {
  COMPLETED_ENTRY_ID,
  MIXED_KEEP_TARGET_ID,
  SKILL_ONLY_TARGET_ID,
  STALE_ENTRY_ID,
  STALE_ONLY_TARGET_ID,
  STALE_SECOND_ENTRY_ID,
  createBuildListOptimizationAdoptionFixture,
  replacedBuildList,
  type BuildListOptimizationAdoptionFixture,
} from '../../../test/fixtures/buildListOptimizationAdoptionFixtures'
import { createDeterministicPlannerDependencies } from '../../../test/fixtures/plannerSchedulerWorkloads'
import { validatePlannerInput } from '../plannerValidation'
import {
  checkBuildListOptimizationExclusionsInBuildList,
  checkBuildListOptimizationFinalSelection,
  checkPersistableBuildListOptimizationArtifact,
} from './buildListOptimizationAdoption'
import type { BuildListOptimizationArtifact } from './buildListOptimizationResult'

/**
 * [P1] of the Build List optimization adoption (`docs/PLANNER_SPEC.md` 17.7 / 17.11, Issue #260 PR-6A): the pure artifact checks,
 * over a real `optimized` artifact. The shared save-time helpers come first; every optimization condition is read from the typed
 * artifact. A warning is matched as a whole kind and message value against Stage 0's recorded exclusion warnings and is never parsed.
 */

let fixture: BuildListOptimizationAdoptionFixture
let plain: BuildListOptimizationAdoptionFixture

beforeAll(async () => {
  fixture = await createBuildListOptimizationAdoptionFixture('scoped')
  plain = await createBuildListOptimizationAdoptionFixture('plain')
})

function artifact(): BuildListOptimizationArtifact {
  return structuredClone(fixture.artifact)
}

/** The Planner warning of one excluded Entry (found by the record's typed Entry ID, never by reading a message). */
function warningIndexOf(value: BuildListOptimizationArtifact, buildListEntryId: string): number {
  const recorded = value.inputExclusions.find((exclusion) => exclusion.buildListEntryId === buildListEntryId)!
  const index = value.plannerResult.warnings.findIndex(({ kind, message }) => kind === recorded.warningKind && message === recorded.warningMessage)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

function planOf(value: BuildListOptimizationArtifact): ProductionPlan {
  return value.plannerResult.plan as ProductionPlan
}

function expectInvalid(value: BuildListOptimizationArtifact, message: RegExp | string) {
  const checked = checkPersistableBuildListOptimizationArtifact(value)
  expect(checked.adoption).toBeNull()
  expect(checked.issue).toMatchObject({ kind: 'result_invalid', message: expect.stringMatching(message) })
}

describe('checkPersistableBuildListOptimizationArtifact', () => {
  it('accepts the real artifact as it is: its Plan, generated Entries and replacements', () => {
    const value = artifact()
    // The fixture holds the exclusions (two of one kind with two messages), both replacements and the unchanged Target the cases below
    // rely on.
    expect(value.inputExclusions.map(({ buildListEntryId, warningKind }) => [buildListEntryId, warningKind]).sort()).toEqual([
      [COMPLETED_ENTRY_ID, 'completed_target_excluded'], [STALE_ENTRY_ID, 'build_list_entry_stale'], [STALE_SECOND_ENTRY_ID, 'build_list_entry_stale'],
    ])
    const staleMessages = value.inputExclusions.filter(({ warningKind }) => warningKind === 'build_list_entry_stale').map(({ warningMessage }) => warningMessage)
    expect(new Set(staleMessages).size).toBe(2)
    expect(value.plannerResult.warnings.map(({ kind }) => kind).sort()).toEqual(['build_list_entry_stale', 'build_list_entry_stale', 'completed_target_excluded'])
    expect(value.replacements).toHaveLength(2)
    expect(value.unchangedTargetWeaponIds).toEqual([SKILL_ONLY_TARGET_ID])

    const checked = checkPersistableBuildListOptimizationArtifact(value)
    expect(checked.issue).toBeNull()
    expect(checked.adoption?.plan).toBe(value.plannerResult.plan)
    expect(checked.adoption?.generatedEntries).toBe(value.generatedBuildListEntries)
    expect(checked.adoption?.replacements).toBe(value.replacements)
  })

  it('accepts an artifact without any excluded Entry or warning, and refuses any warning on it', () => {
    const value = structuredClone(plain.artifact)
    expect(value.inputExclusions).toEqual([])
    expect(value.plannerResult.warnings).toEqual([])
    expect(checkPersistableBuildListOptimizationArtifact(value).issue).toBeNull()
    value.plannerResult.warnings = [{ kind: 'build_list_entry_stale', message: "BuildListEntry 'x' is stale (rng_state_changed)." }]
    expect(checkPersistableBuildListOptimizationArtifact(value).issue).toMatchObject({ kind: 'result_invalid', message: expect.stringContaining('[build_list_entry_stale]') })
  })

  it("records exactly the exclusion warnings Stage D's final input validation produces, so a real result is never refused for them", () => {
    // The final input keeps every excluded Entry and the state, so its validation excludes the same Entries with the same kind and
    // message; the result's warnings are inside that multiset (Stage D') and therefore inside Stage 0's record ([P1]).
    const value = artifact()
    const finalValidation = validatePlannerInput(
      { ...structuredClone(fixture.input), buildListEntries: replacedBuildList(fixture.input, value) },
      createDeterministicPlannerDependencies(fixture.engine),
    )
    const finalWarnings = finalValidation.excludedBuildListEntryWarnings.map(({ buildListEntryId, warning }) => [buildListEntryId, warning.kind, warning.message])
    expect(value.inputExclusions.map(({ buildListEntryId, warningKind, warningMessage }) => [buildListEntryId, warningKind, warningMessage]).sort())
      .toEqual(finalWarnings.sort())
  })

  describe('the exclusion warnings: kind and message, multiplicity counted (17.7 item 3)', () => {
    it('refuses a warning whose message is not its recorded exclusion warning, though its kind is', () => {
      const value = artifact()
      const index = warningIndexOf(value, STALE_ENTRY_ID)
      value.plannerResult.warnings[index] = { ...value.plannerResult.warnings[index]!, message: 'rewritten' }
      expectInvalid(value, /no Stage 0 exclusion explains: \[build_list_entry_stale\]/)
    })

    it('refuses a warning of a kind no exclusion recorded', () => {
      const value = artifact()
      value.plannerResult.warnings.push({ kind: 'rng_prediction_unsupported', message: "BuildListEntry 'x' requires unsupported RNG input." })
      expectInvalid(value, /no Stage 0 exclusion explains: \[rng_prediction_unsupported\]/)
    })

    it("refuses one stale Entry's warning swapped for the other stale Entry's: the kinds still add up, the kind and message pairs do not", () => {
      const value = artifact()
      const replaced = warningIndexOf(value, STALE_ENTRY_ID)
      value.plannerResult.warnings[replaced] = structuredClone(value.plannerResult.warnings[warningIndexOf(value, STALE_SECOND_ENTRY_ID)]!)
      expect(value.plannerResult.warnings.map(({ kind }) => kind).sort()).toEqual(['build_list_entry_stale', 'build_list_entry_stale', 'completed_target_excluded'])
      expectInvalid(value, /no Stage 0 exclusion explains: \[build_list_entry_stale\]/)
    })

    it('refuses a recorded warning repeated beyond its multiplicity', () => {
      const value = artifact()
      value.plannerResult.warnings.push(structuredClone(value.plannerResult.warnings[warningIndexOf(value, COMPLETED_ENTRY_ID)]!))
      expectInvalid(value, /no Stage 0 exclusion explains: \[completed_target_excluded\]/)
    })

    it('refuses an exclusion record without its message, and a record whose message is not the warning the run reported', () => {
      for (const warningMessage of ['', undefined as unknown as string]) {
        const value = artifact()
        value.inputExclusions[0] = { ...value.inputExclusions[0]!, warningMessage }
        expectInvalid(value, /recorded without the message of its exclusion warning/)
      }
      const corrupted = artifact()
      const index = corrupted.inputExclusions.findIndex(({ buildListEntryId }) => buildListEntryId === COMPLETED_ENTRY_ID)
      corrupted.inputExclusions[index] = { ...corrupted.inputExclusions[index]!, warningMessage: 'another message' }
      expectInvalid(corrupted, /no Stage 0 exclusion explains: \[completed_target_excluded\]/)
    })

    it('refuses an excluded Entry recorded twice, even with a second warning that would explain the run', () => {
      const value = artifact()
      const completed = value.inputExclusions.find(({ buildListEntryId }) => buildListEntryId === COMPLETED_ENTRY_ID)!
      value.inputExclusions.push({ ...completed, warningKind: 'build_list_entry_stale', warningMessage: 'a second exclusion warning' })
      value.plannerResult.warnings.push({ kind: 'build_list_entry_stale', message: 'a second exclusion warning' })
      expectInvalid(value, new RegExp(`'${COMPLETED_ENTRY_ID}' is recorded with more than one exclusion warning`))
    })

    it('parses no message: a message naming another Entry decides nothing, the typed record does', () => {
      // The recorded message and the reported warning are rewritten together to name a generated Entry; the typed Entry ID of the
      // record still says which Entry was excluded, so nothing is read as excluding the generated Entry.
      const value = artifact()
      const index = warningIndexOf(value, STALE_ENTRY_ID)
      const recordIndex = value.inputExclusions.findIndex(({ buildListEntryId }) => buildListEntryId === STALE_ENTRY_ID)
      const misleading = `BuildListEntry '${value.generatedBuildListEntries[0]!.id}' is stale (rng_state_changed).`
      value.plannerResult.warnings[index] = { ...value.plannerResult.warnings[index]!, message: misleading }
      value.inputExclusions[recordIndex] = { ...value.inputExclusions[recordIndex]!, warningMessage: misleading }
      expect(checkPersistableBuildListOptimizationArtifact(value).issue).toBeNull()
    })
  })

  describe('the shared save-time helpers, with their contracts unchanged', () => {
    it('refuses an incomplete run whether or not it carries its Plan (checkPlannerRunTerminationPersistable)', () => {
      const value = artifact()
      value.plannerResult.termination = { ...value.plannerResult.termination, status: 'incomplete', reachedLimits: ['max_plan_steps'] }
      expectInvalid(value, /The Planner run did not complete/)
    })

    it('refuses a non-draft Plan and a Plan of an earlier repair chain (checkPersistablePlannerResultShape / checkPersistableOrdinaryPlannerResultShape)', () => {
      const active = artifact()
      planOf(active).status = 'active'
      expectInvalid(active, /must be saved as a draft ProductionPlan/)
      const lineage = artifact()
      planOf(lineage).conflictRepairLineage = { decisions: [] }
      expectInvalid(lineage, /must not carry a conflict repair lineage/)
    })

    it('refuses duplicated generated Entries and replacements that do not pair with them', () => {
      const duplicated = artifact()
      duplicated.generatedBuildListEntries = [duplicated.generatedBuildListEntries[0]!, duplicated.generatedBuildListEntries[0]!]
      expectInvalid(duplicated, /must be unique/)
      const otherTarget = artifact()
      otherTarget.replacements[0] = { ...otherTarget.replacements[0]!, targetWeaponId: SKILL_ONLY_TARGET_ID }
      expectInvalid(otherTarget, /replacements are malformed/)
    })

    it('refuses a Domain-invalid Plan', () => {
      const value = artifact()
      planOf(value).id = '' as ProductionPlan['id']
      const checked = checkPersistableBuildListOptimizationArtifact(value)
      expect(checked.issue).toMatchObject({ kind: 'entity_invalid', entityName: 'ProductionPlan' })
    })
  })

  describe("the optimization's own conditions (17.7)", () => {
    it('refuses a missing Plan', () => {
      const value = artifact()
      value.plannerResult.plan = null
      expectInvalid(value, /must carry the final Plan/)
    })

    it('refuses a run that ended exhausted although its Plan exists', () => {
      const value = artifact()
      value.plannerResult.termination = { ...value.plannerResult.termination, status: 'exhausted' }
      expectInvalid(value, /must come from a completed Planner run/)
    })

    it('refuses completion counts that are not the planning Target count', () => {
      const completed = artifact()
      completed.plannerResult.termination = { ...completed.plannerResult.termination, completedTargetCount: 2 }
      expectInvalid(completed, /completed 2 of 3 Targets/)
      const total = artifact()
      total.plannerResult.termination = { ...total.plannerResult.termination, completedTargetCount: 4, totalTargetCount: 4 }
      expectInvalid(total, /the optimization planned 3/)
    })

    it('refuses a Conflict on the result or on the Plan, and a rejected Entry', () => {
      const [first, second] = planOf(fixture.artifact).selectedBuildListEntryIds
      const conflict: ProductionPlan['conflicts'][number] = {
        id: 'conflict.fixture', kind: 'same_gogma_counter', buildListEntryIds: [first!, second!], reason: 'fixture',
        recommendedBuildListEntryId: null, selectedBuildListEntryId: null, resolutionNote: null, checkpointParticipants: [],
      }
      const onResult = artifact()
      onResult.plannerResult.conflicts = [conflict]
      expectInvalid(onResult, /holds no Conflict/)
      const onPlan = artifact()
      planOf(onPlan).conflicts = [conflict]
      expectInvalid(onPlan, /holds no Conflict/)
      const rejected = artifact()
      // A record as a newly calculated Plan writes it (Issue #121: with its Entry's Target), so the shared completeness check passes
      // and the optimization's own condition is what refuses it.
      const firstTarget = planOf(rejected).steps
        .flatMap((step) => step.executionEffects?.targetCompletions ?? [])
        .find(({ buildListEntryId }) => buildListEntryId === first)!.targetWeaponId
      planOf(rejected).rejectedBuildListEntries = [
        { buildListEntryId: first!, targetWeaponId: firstTarget, reason: 'lower_priority', detail: 'fixture' },
      ]
      expectInvalid(rejected, /rejects no BuildListEntry/)
      // A record without the Issue #121 field is refused by the shared check first.
      const unrecorded = artifact()
      planOf(unrecorded).rejectedBuildListEntries = [{ buildListEntryId: first!, reason: 'lower_priority', detail: 'fixture' }]
      expectInvalid(unrecorded, /does not record its targetWeaponId/)
    })

    it('refuses a selection that is not one Entry per planning Target with every generated Entry', () => {
      const missing = artifact()
      planOf(missing).selectedBuildListEntryIds = planOf(missing).selectedBuildListEntryIds.slice(1)
      expectInvalid(missing, /selects one Entry per planning Target/)
      const unselected = artifact()
      const generatedId = unselected.generatedBuildListEntries[0]!.id
      planOf(unselected).selectedBuildListEntryIds = planOf(unselected).selectedBuildListEntryIds
        .map((id) => (id === generatedId ? unselected.replacements[0]!.replacedBuildListEntryId : id))
      expectInvalid(unselected, /are not selected by the optimized Plan/)
    })

    it('refuses a partition of the planning Targets that names one twice, misses one or names another Target', () => {
      const twice = artifact()
      twice.unchangedTargetWeaponIds = [...twice.unchangedTargetWeaponIds, MIXED_KEEP_TARGET_ID]
      expectInvalid(twice, /either replaced or unchanged exactly once/)
      const missing = artifact()
      missing.unchangedTargetWeaponIds = []
      expectInvalid(missing, /either replaced or unchanged exactly once/)
      const outside = artifact()
      outside.unchangedTargetWeaponIds = [STALE_ONLY_TARGET_ID]
      expectInvalid(outside, /either replaced or unchanged exactly once/)
      const duplicatedPlanning = artifact()
      duplicatedPlanning.planningTargetWeaponIds = [...duplicatedPlanning.planningTargetWeaponIds, SKILL_ONLY_TARGET_ID]
      expectInvalid(duplicatedPlanning, /each planning Target exactly once/)
    })

    it('refuses an excluded Entry that belongs to a planning Target or that the optimization replaces', () => {
      const planningTarget = artifact()
      planningTarget.inputExclusions[0] = { ...planningTarget.inputExclusions[0]!, targetWeaponId: SKILL_ONLY_TARGET_ID }
      expectInvalid(planningTarget, /belongs to the planning Target/)
      const replaced = artifact()
      replaced.inputExclusions[0] = { ...replaced.inputExclusions[0]!, buildListEntryId: replaced.replacements[0]!.replacedBuildListEntryId }
      expectInvalid(replaced, /is generated, replaced or selected by the optimization/)
    })

    it('refuses a warning that no Stage 0 exclusion explains: another kind, another stale Entry, or an exclusion missing from the record', () => {
      const other = artifact()
      other.plannerResult.warnings = [...other.plannerResult.warnings, { kind: 'max_steps_reached', message: 'Planner reached maxPlanSteps.' }]
      expectInvalid(other, /no Stage 0 exclusion explains: \[max_steps_reached\]/)
      const repeated = artifact()
      repeated.plannerResult.warnings = [...repeated.plannerResult.warnings, { kind: 'build_list_entry_stale', message: 'another stale Entry' }]
      expectInvalid(repeated, /no Stage 0 exclusion explains: \[build_list_entry_stale\]/)
      const unexplained = artifact()
      unexplained.inputExclusions = unexplained.inputExclusions.filter(({ warningKind }) => warningKind !== 'completed_target_excluded')
      expectInvalid(unexplained, /no Stage 0 exclusion explains: \[completed_target_excluded\]/)
    })

    it('refuses a Plan whose physical identity does not hold', () => {
      const objective = artifact()
      objective.summary = { ...objective.summary, structuralObjective: objective.summary.structuralObjective + 1 }
      expectInvalid(objective, /physical identity does not hold/)
      const advance = artifact()
      const step = planOf(advance).steps[0]!
      step.rngAdvance = { ...step.rngAdvance, skillCounterDelta: step.rngAdvance.skillCounterDelta + 1 }
      expectInvalid(advance, /physical identity does not hold/)
      const steps = artifact()
      steps.summary = { ...steps.summary, planStepCount: steps.summary.planStepCount + 1 }
      expectInvalid(steps, /physical identity does not hold/)
    })

    it("refuses an input token that is not the final Plan's own", () => {
      const state = artifact()
      state.inputToken.initialExecutionState = { ...state.inputToken.initialExecutionState, rngStateHash: 'fnv1a32:ffffffff' }
      expectInvalid(state, /initialExecutionState is not the final Plan/)
      const targets = artifact()
      targets.inputToken.targetWeaponsHash = 'fnv1a32:ffffffff'
      expectInvalid(targets, /targetWeaponsHash is not the final Plan/)
      const context = artifact()
      context.inputToken.calculationContext = { ...context.inputToken.calculationContext, rngEngineVersion: 'other-engine' }
      expectInvalid(context, /CalculationContext is not the final Plan/)
    })
  })
})

describe('checkBuildListOptimizationExclusionsInBuildList', () => {
  it('accepts the record over the Build List it was taken from (the excluded Entries are untouched by the replacements)', () => {
    const value = artifact()
    expect(checkBuildListOptimizationExclusionsInBuildList(value.inputExclusions, replacedBuildList(fixture.input, value))).toBeNull()
    expect(checkBuildListOptimizationExclusionsInBuildList([], replacedBuildList(fixture.input, value))).toBeNull()
  })

  it('refuses a recorded Entry missing from the Build List or recorded with another Target', () => {
    const value = artifact()
    const finalEntries = replacedBuildList(fixture.input, value)
    const [first] = value.inputExclusions
    expect(checkBuildListOptimizationExclusionsInBuildList([{ ...first!, buildListEntryId: 'build-list.scope.ghost' as BuildListEntryId }], finalEntries))
      .toMatchObject({ kind: 'result_invalid', message: expect.stringContaining("'build-list.scope.ghost'") })
    expect(checkBuildListOptimizationExclusionsInBuildList([{ ...first!, targetWeaponId: SKILL_ONLY_TARGET_ID }], finalEntries))
      .toMatchObject({ kind: 'result_invalid', message: expect.stringContaining(`of TargetWeapon '${SKILL_ONLY_TARGET_ID}'`) })
  })
})

describe('checkBuildListOptimizationFinalSelection', () => {
  it("accepts the Plan over the replaced Build List: one Entry of each planning Target, the unchanged Target's current Entry included", () => {
    const value = artifact()
    const finalEntries = replacedBuildList(fixture.input, value)
    expect(checkBuildListOptimizationFinalSelection(planOf(value), finalEntries, value.planningTargetWeaponIds)).toBeNull()
  })

  it('refuses a selection naming an out-of-scope Entry, an Entry outside the final Build List or two Entries of one Target', () => {
    const value = artifact()
    const finalEntries = replacedBuildList(fixture.input, value)
    const unchangedEntryId = finalEntries.find(({ targetWeaponId }) => targetWeaponId === SKILL_ONLY_TARGET_ID)!.id
    const swap = (to: BuildListEntryId) => ({
      selectedBuildListEntryIds: planOf(value).selectedBuildListEntryIds.map((id) => (id === unchangedEntryId ? to : id)),
    })
    expect(checkBuildListOptimizationFinalSelection(swap(STALE_ENTRY_ID), finalEntries, value.planningTargetWeaponIds))
      .toMatchObject({ kind: 'result_invalid', message: expect.stringContaining('not exactly one Entry of each planning Target') })
    expect(checkBuildListOptimizationFinalSelection(swap('build-list.missing' as BuildListEntryId), finalEntries, value.planningTargetWeaponIds))
      .toMatchObject({ kind: 'result_invalid', message: expect.stringContaining('not part of the final Build List') })
    expect(checkBuildListOptimizationFinalSelection(planOf(value), finalEntries, [...value.planningTargetWeaponIds, STALE_ONLY_TARGET_ID as TargetWeaponId]))
      .toMatchObject({ kind: 'result_invalid' })
  })
})
