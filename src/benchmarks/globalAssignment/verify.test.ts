import { describe, expect, it } from 'vitest'
import { hashStableValue, type ProductionPlan } from '../../domain/models/publicTypes'
import { TARGET, scenarioAlternativeFirst, scenarioConversionFallback, scenarioSkillDependency } from './materializationTestFixture'
import {
  materializedEntriesFingerprint, physicalIdentityReasons, productionPlannerVerificationPort, summarizeVerificationPhysical, verifyPlannerCandidate, type PlannerVerificationPort,
} from './verify'
import {
  conflictingHandoff, editedResultPort, execution, heldCrossingHandoff, materializedHandoff, plannerDependencies, runtimeUnsupportedRetryHandoff, TEST_CONDITIONS, zeroOperationHandoff,
} from './verificationTestFixture'

/*
 * Issue #154 Global Assignment Phase D-1A: Phase D' in one process (design 9.5 / 9.6 / 13.1 Phase D'). The Production Planner, the
 * independent Trace Replay and the physical summary run over real materializations of the synthetic scenarios; every condition is
 * required, every failure keeps its own typed reason and nothing that fails is `conditions_met`. Ports that alter one aspect of the
 * Production result reach the cases the synthetic Planner never produces. No real Export.
 */

async function successCase(make: typeof scenarioConversionFallback = scenarioConversionFallback) {
  const scenario = await make()
  const handoff = await materializedHandoff(scenario)
  return { scenario, scene: scenario.scene, handoff }
}

describe("Phase D-1A Phase D': the in-process conditions", () => {
  it('meets every condition for real materializations: all planning Targets completed, all Entries selected, physical = Plan steps = objective', async () => {
    for (const make of [scenarioConversionFallback, scenarioSkillDependency, scenarioAlternativeFirst]) {
      const { scene, handoff } = await successCase(make)
      expect(handoff.stage).toEqual({ kind: 'all_materialized' })
      const stages: string[] = []
      const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ onStage: event => { stages.push(`${event.stage}:${event.status}`) } }))
      const { semantic } = record
      expect(semantic.outcome).toEqual({ kind: 'conditions_met' })
      expect(Object.values(semantic.checks).every(value => value === true)).toBe(true)
      expect(semantic.planner).toMatchObject({ fullPlannerRuns: 1, error: null, planPresent: true, conflicts: [], rejected: [], warnings: [], termination: { status: 'completed', reachedLimits: [], completedTargetCount: 2, totalTargetCount: 2, limits: { maxPlanSteps: TEST_CONDITIONS.researchMaxPlanSteps } } })
      expect(semantic.planner!.selectedBuildListEntryIds).toEqual(semantic.planner!.expectedSelectedBuildListEntryIds)
      expect(semantic.traceReplay).toMatchObject({ ran: true, isValid: true, issueCodes: [], unsupportedInput: false, finalCountersMatchPlan: true, correspondence: { mismatches: 0, counterPositionMismatches: 0 } })
      // No zero-operation Target: no non-physical Step, so physical = Plan steps exactly as under the D-1A rule.
      expect(semantic.physical).toMatchObject({ error: null, nonPhysicalSteps: {}, nonPhysicalStepCount: 0, unexpectedNonPhysicalSteps: {}, identities: { stepCount: true, streamAdvance: true, objective: true } })
      expect(semantic.physical!.physicalOperations).toBe(semantic.physical!.planSteps)
      expect(semantic.physical!.physicalOperations).toBe(semantic.physical!.streamAdvanceSum)
      expect(semantic.physical!.physicalOperations).toBe(handoff.objective)
      expect(semantic.physical!.streamComparison.every(row => row.equal)).toBe(true)
      expect(semantic.candidate).toMatchObject({ objective: handoff.objective, planningTargetCount: 2, materializedEntryCount: 2, stage: 'all_materialized', entryFingerprint: materializedEntriesFingerprint(handoff.materializedEntries) })
      expect(stages).toEqual(['handoff:started', 'handoff:finished', 'final_input:started', 'final_input:finished', 'planner:started', 'planner:finished', 'physical:started', 'physical:finished', 'trace_replay:started', 'trace_replay:finished'])
      expect(Object.values(record.observed.elapsedMs).every(value => typeof value === 'number')).toBe(true)
    }
  }, 120_000)

  it('builds the final input with the Production replacement authority: each generated Entry replaces its one original, nothing else changes', async () => {
    const { scene, handoff } = await successCase()
    const original = structuredClone(scene.input)
    const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution())
    // The original input is never edited.
    expect(hashStableValue(scene.input)).toBe(hashStableValue(original))
    const finalInput = record.semantic.finalInput!
    expect(finalInput.replacements.map(replacement => replacement.targetWeaponId)).toEqual([TARGET.a, TARGET.b])
    expect(finalInput.replacements.map(replacement => replacement.replacedBuildListEntryId).sort()).toEqual(original.buildListEntries.map(entry => entry.id).sort())
    expect(finalInput.replacements.map(replacement => replacement.generatedBuildListEntryId).sort()).toEqual(handoff.materializedEntries.map(row => row.entry.id).sort())
    expect(finalInput).toMatchObject({ originalEntryCount: 2, finalEntryCount: 2, keptOriginalEntryIds: [], conflictResolutionCount: 0, maxPlanSteps: TEST_CONDITIONS.researchMaxPlanSteps })
    expect(Object.values(finalInput.sourceDataUnchanged).every(Boolean)).toBe(true)
    expect(finalInput.validation).toEqual({ isValid: true, issues: [], warningKinds: {}, excluded: [] })
    expect(finalInput.finalPlanningTargetIds).toEqual(finalInput.phase0PlanningTargetIds)
    // An original Entry of a Target outside the planning set is kept unchanged (here: a third Target whose only Entry is stale).
    const extraEntry = { ...structuredClone(original.buildListEntries[0]!), id: 'build-list.fixture.extra' as typeof original.buildListEntries[number]['id'], targetWeaponId: 'target.fixture.extra' as typeof TARGET.a, targetDefinitionHash: 'fnv1a32:00000000' }
    const extraTarget = { ...structuredClone(original.targetWeapons[0]!), id: 'target.fixture.extra' as typeof TARGET.a }
    const widened = { ...structuredClone(original), targetWeapons: [...original.targetWeapons, extraTarget], buildListEntries: [...original.buildListEntries, extraEntry] }
    const kept = await verifyPlannerCandidate(widened, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution())
    expect(kept.semantic.finalInput).toMatchObject({ originalEntryCount: 3, finalEntryCount: 3, keptOriginalEntryIds: ['build-list.fixture.extra'] })
    expect(kept.semantic.finalInput!.validation.excluded).toEqual([expect.objectContaining({ buildListEntryId: 'build-list.fixture.extra', generated: false })])
    expect(kept.semantic.finalInput!.finalPlanningTargetIds).toEqual([TARGET.a, TARGET.b])
    // Kept unchanged, the stale Entry still makes the Production Planner warn: condition 9 (warnings 0) is strict, never waived.
    expect(kept.semantic.outcome).toEqual({ kind: 'planner_rejected', reasons: [{ code: 'warnings', count: 1, kinds: { build_list_entry_stale: 1 } }] })
  }, 60_000)

  it('is deterministic: the same handoff with fresh dependencies gives the same semantic record', async () => {
    const { scene, handoff } = await successCase()
    const first = await verifyPlannerCandidate(scene.input, structuredClone(handoff), plannerDependencies(scene), TEST_CONDITIONS, execution())
    const second = await verifyPlannerCandidate(structuredClone(scene.input), structuredClone(handoff), plannerDependencies(scene), TEST_CONDITIONS, execution())
    expect(JSON.stringify(second.semantic)).toBe(JSON.stringify(first.semantic))
    expect(first.semantic.planner!.planHash).toMatch(/^fnv1a32:/)
  }, 60_000)
})

describe("Phase D-1A Phase D': every failure keeps its typed reason and never meets the conditions", () => {
  it('refuses a candidate that is not all_materialized before any Planner run (a materialization outcome)', async () => {
    const { scene, handoff } = await successCase()
    const stopped = structuredClone(handoff)
    stopped.stage = { kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcome: { kind: 'unconfirmed', reason: 'shape_search_budget_reached', budgetExceeded: ['settledWork'], delivered: 0, closestMismatch: null } }
    stopped.materializedEntries = stopped.materializedEntries.filter(row => row.targetWeaponId !== TARGET.b)
    const port = countingPort()
    const record = await verifyPlannerCandidate(scene.input, stopped, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: port.port }))
    expect(record.semantic.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcomeKind: 'unconfirmed', outcomeReason: 'shape_search_budget_reached' })
    expect(record.semantic.planner).toBeNull()
    expect(port.calls).toEqual({ plan: 0, replay: 0 })
  }, 60_000)

  it('fails closed on a handoff with a duplicate Target, an Entry outside the planning set, or a planning Target without an Entry', async () => {
    const { scene, handoff } = await successCase()
    const port = countingPort()
    const run = (value: typeof handoff) => verifyPlannerCandidate(scene.input, value, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: port.port }))
    const duplicate = structuredClone(handoff)
    duplicate.materializedEntries.push(structuredClone(duplicate.materializedEntries[0]!))
    expect((await run(duplicate)).semantic.outcome).toEqual({ kind: 'planning_target_set_changed', reasons: [
      { code: 'duplicate_target_entries', source: 'handoff', targetWeaponIds: [duplicate.materializedEntries[0]!.targetWeaponId] },
      { code: 'duplicate_entry_ids', buildListEntryIds: [duplicate.materializedEntries[0]!.entry.id] },
    ] })
    const missing = structuredClone(handoff)
    missing.materializedEntries = missing.materializedEntries.slice(0, 1)
    expect((await run(missing)).semantic.outcome).toMatchObject({ kind: 'planning_target_set_changed', reasons: [{ code: 'planning_target_without_entry' }] })
    const outside = structuredClone(handoff)
    outside.planningTargetIds = outside.planningTargetIds.filter(id => id !== TARGET.b)
    expect((await run(outside)).semantic.outcome).toEqual({ kind: 'planning_target_set_changed', reasons: [{ code: 'entry_outside_planning_targets', targetWeaponIds: [TARGET.b] }] })
    const invalid = structuredClone(handoff)
    ;(invalid.materializedEntries[0]!.entry as { id: string }).id = ''
    expect((await run(invalid)).semantic.outcome).toMatchObject({ kind: 'planning_target_set_changed', reasons: [{ code: 'generated_entry_invalid' }] })
    expect(port.calls).toEqual({ plan: 0, replay: 0 })
  }, 60_000)

  it('reports a planning Target the final input adds, and a generated Entry Production validation excludes (the Target is removed)', async () => {
    const { scene, handoff } = await successCase()
    const port = countingPort()
    // Phase 0 named only a; b's original Entry stays in the final input and makes b a planning Target again.
    const narrowed = structuredClone(handoff)
    narrowed.planningTargetIds = [TARGET.a]
    narrowed.materializedEntries = narrowed.materializedEntries.filter(row => row.targetWeaponId === TARGET.a)
    const added = await verifyPlannerCandidate(scene.input, narrowed, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: port.port }))
    expect(added.semantic.outcome).toEqual({ kind: 'planning_target_set_changed', reasons: [{ code: 'planning_target_added', targetWeaponIds: [TARGET.b] }] })
    // A stale generated Entry (another Target definition hash) is excluded by validatePlannerInput(): its Target leaves the set.
    const stale = structuredClone(handoff)
    const row = stale.materializedEntries.find(value => value.targetWeaponId === TARGET.b)!
    row.entry.targetDefinitionHash = 'fnv1a32:00000000'
    const removed = await verifyPlannerCandidate(scene.input, stale, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: port.port }))
    expect(removed.semantic.outcome).toEqual({ kind: 'planning_target_set_changed', reasons: [
      { code: 'generated_entry_excluded', entries: [{ buildListEntryId: row.entry.id, targetWeaponId: TARGET.b, reason: expect.stringMatching(/target_definition_changed/) }] },
      { code: 'planning_target_removed', targetWeaponIds: [TARGET.b] },
    ] })
    expect(port.calls).toEqual({ plan: 0, replay: 0 })
  }, 60_000)

  it('fails closed when a Target holds two original Entries (the Production replacement names no unique Entry), never registering an Entry twice', async () => {
    const { scene, handoff } = await successCase()
    const doubled = structuredClone(scene.input)
    doubled.buildListEntries.push({ ...structuredClone(doubled.buildListEntries.find(entry => entry.targetWeaponId === TARGET.a)!), id: 'build-list.fixture.second' as typeof doubled.buildListEntries[number]['id'] })
    const record = await verifyPlannerCandidate(doubled, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution())
    expect(record.semantic.outcome).toEqual({ kind: 'planning_target_set_changed', reasons: [{ code: 'replacement_unresolved', entries: [{ targetWeaponId: TARGET.a, buildListEntryId: handoff.materializedEntries.find(row => row.targetWeaponId === TARGET.a)!.entry.id, reason: 'replaced_entry_ambiguous' }] }] })
    expect(record.semantic.planner).toBeNull()
  }, 60_000)

  it('rejects a real Planner conflict: two Entries of two real materializations need one Gogma position', async () => {
    const { scene, handoff } = await conflictingHandoff()
    const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution())
    const { semantic } = record
    expect(semantic.outcome.kind).toBe('planner_rejected')
    const codes = semantic.outcome.kind === 'planner_rejected' ? semantic.outcome.reasons.map(reason => reason.code) : []
    expect(codes).toEqual(expect.arrayContaining(['plan_null', 'termination_not_completed', 'completed_target_count_mismatch', 'conflicts']))
    expect(semantic.planner!.conflicts).toEqual([expect.objectContaining({ kind: 'same_gogma_counter', selectedBuildListEntryId: null })])
    expect(semantic.checks).toMatchObject({ noConflicts: false, planPresent: false, completedEqualsPlanningTargets: false })
    // No resolution is ever synthesized: the final input carries none.
    expect(semantic.finalInput!.conflictResolutionCount).toBe(0)
  }, 60_000)

  it('rejects a completed run whose Entry is rejected (same-Ideal Targets cross-satisfy): completed 2 / 2 is not enough', async () => {
    const { scenario, handoff } = await heldCrossingHandoff()
    const record = await verifyPlannerCandidate(scenario.scene.input, handoff, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution())
    expect(record.semantic.planner!.termination).toMatchObject({ status: 'completed', completedTargetCount: 2, totalTargetCount: 2 })
    expect(record.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: [
      { code: 'selected_entries_mismatch' }, { code: 'rejected_entries', count: 1, reasons: { already_satisfied: 1 }, resourceConflicts: 0 },
    ] })
    expect(record.semantic.checks).toMatchObject({ allPlanningEntriesSelected: false, noRejectedEntries: false, noResourceConflicts: true })
  }, 60_000)

  it('rejects a run maxPlanSteps truncated, and never raises the bound', async () => {
    const { scene, handoff } = await successCase()
    const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), { researchMaxPlanSteps: 1 }, execution())
    expect(record.semantic.planner!.termination).toMatchObject({ status: 'incomplete', reachedLimits: ['max_plan_steps'], limits: { maxPlanSteps: 1 } })
    expect(record.semantic.outcome).toMatchObject({ kind: 'planner_rejected' })
    const codes = record.semantic.outcome.kind === 'planner_rejected' ? record.semantic.outcome.reasons.map(reason => reason.code) : []
    expect(codes).toEqual(expect.arrayContaining(['termination_not_completed', 'max_plan_steps_reached']))
    expect(record.semantic.finalInput!.maxPlanSteps).toBe(1)
    await expect(verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), { researchMaxPlanSteps: 0 }, execution())).rejects.toThrow(/positive safe integer/)
  }, 60_000)

  it('rejects a null Plan, warnings and a Plan generation error', async () => {
    const { scene, handoff } = await successCase()
    const run = (planner: PlannerVerificationPort) => verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner }))
    const nullPlan = await run(editedResultPort(result => { result.plan = null }))
    expect(nullPlan.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: expect.arrayContaining([{ code: 'plan_null' }]) })
    expect(nullPlan.semantic.checks.planPresent).toBe(false)
    const warned = await run(editedResultPort(result => { result.warnings.push({ kind: 'rng_prediction_unsupported', message: 'fixture' }) }))
    expect(warned.semantic.outcome).toEqual({ kind: 'planner_rejected', reasons: [{ code: 'warnings', count: 1, kinds: { rng_prediction_unsupported: 1 } }] })
    expect(warned.semantic.checks.noWarnings).toBe(false)
    // D-1B: the number of full Planner runs is no reason of its own (the block below covers the retry rule).
    const thrown = await run({ ...productionPlannerVerificationPort, createProductionPlanWithObserver: async () => { throw new Error('Planner trace replay failed: fixture') } })
    expect(thrown.semantic.planner).toMatchObject({ error: { name: 'Error', message: 'Planner trace replay failed: fixture' }, planPresent: false, termination: null })
    expect(thrown.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: expect.arrayContaining([{ code: 'plan_generation_error', errorName: 'Error', message: 'Planner trace replay failed: fixture' }, { code: 'trace_replay_not_run' }]) })
  }, 60_000)

  it('rejects an invalid independent Trace Replay, and a replay that does not correspond to the Plan', async () => {
    const { scene, handoff } = await successCase()
    const run = (replay: PlannerVerificationPort['replayPlannerSearchTrace']) => verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: { ...productionPlannerVerificationPort, replayPlannerSearchTrace: replay } }))
    const invalid = await run((...args) => ({ ...productionPlannerVerificationPort.replayPlannerSearchTrace(...args), isValid: false, issues: [{ code: 'rng_before_mismatch', message: 'fixture', actionIndex: 0 }] }))
    expect(invalid.semantic.outcome).toEqual({ kind: 'planner_rejected', reasons: [{ code: 'trace_replay_invalid', issueCodes: ['rng_before_mismatch'] }] })
    expect(invalid.semantic.checks.traceReplayValid).toBe(false)
    // A replay whose drafts are not the Plan's Steps (one physical draft dropped): the correspondence fails.
    const shifted = await run((...args) => {
      const replay = productionPlannerVerificationPort.replayPlannerSearchTrace(...args)
      return { ...replay, drafts: replay.drafts.slice(1) }
    })
    expect(shifted.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: [{ code: 'trace_replay_correspondence_mismatch' }] })
    expect(shifted.semantic.traceReplay!.correspondence!.mismatches).toBeGreaterThan(0)
  }, 60_000)

  it('reports objective_mismatch when the physical operations are not the structural objective (no tolerance)', async () => {
    const { scene, handoff } = await successCase()
    const off = structuredClone(handoff)
    off.objective += 1
    const record = await verifyPlannerCandidate(scene.input, off, plannerDependencies(scene), TEST_CONDITIONS, execution())
    expect(record.semantic.outcome).toEqual({ kind: 'objective_mismatch', physicalOperations: handoff.objective, objective: handoff.objective + 1, reasons: [{ code: 'physical_objective_mismatch', physicalOperations: handoff.objective, objective: handoff.objective + 1 }] })
    expect(record.semantic.checks).toMatchObject({ physicalStepCountIdentity: true, physicalStreamAdvanceIdentity: true, physicalObjectiveIdentity: false })
    // A Plan whose Step breaks the one-Counter identity fails the physical summary itself.
    const broken = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: editedResultPort(result => { result.plan!.steps[0]!.rngAdvance = { ...result.plan!.steps[0]!.rngAdvance, skillCounterDelta: 2 } }) }))
    expect(broken.semantic.physical!.error).toMatch(/does not advance exactly one Counter by one/)
    expect(broken.semantic.outcome.kind).toBe('planner_rejected')
    expect(broken.semantic.checks).toMatchObject({ physicalStepCountIdentity: false, physicalStreamAdvanceIdentity: false, physicalObjectiveIdentity: false })
  }, 60_000)

  it('reports a cancellation as unmeasured(cancelled), never as a Planner result', async () => {
    const { scene, handoff } = await successCase()
    const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ shouldCancel: () => true }))
    expect(record.semantic.outcome).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
    expect(record.semantic.planner!.termination!.status).toBe('cancelled')
    expect(record.semantic.traceReplay).toBeNull()
  }, 60_000)
})

/*
 * Issue #154 Global Assignment Phase D-1B (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md 3 / 4): condition 11 is three exact identities
 * (physical = Plan steps − non-physical steps = Σ stream advances; 12: = structural objective), a `confirm_owned_ideal` Step is the one
 * non-physical Step, and the number of full Planner runs is recorded but never a reason of its own. The Plans below are real Production
 * Plans of real materializations; where a test edits a Plan or a record after the real run, the comment names the edit.
 */
describe('Phase D-1B: non-physical Steps and the physical identities', () => {
  /** The Production result of one verification, captured unedited (`editedResultPort` with a no-op edit that keeps a copy). */
  async function capturedRun(make: () => ReturnType<typeof zeroOperationHandoff>) {
    const { scenario, handoff } = await make()
    let plan: ProductionPlan | null = null
    const record = await verifyPlannerCandidate(scenario.scene.input, handoff, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution({ planner: editedResultPort(result => { plan = structuredClone(result.plan) }) }))
    return { scenario, handoff, record, plan: plan as ProductionPlan | null }
  }

  it('meets every condition with one confirm_owned_ideal Step: physical = Plan steps − 1 = Σ advances = objective (the D-1A rule would refuse it)', async () => {
    const { handoff, record } = await capturedRun(() => zeroOperationHandoff(['a']))
    const { semantic } = record
    expect(semantic.outcome).toEqual({ kind: 'conditions_met' })
    expect(Object.values(semantic.checks).every(value => value === true)).toBe(true)
    expect(semantic.physical).toMatchObject({ planSteps: 6, physicalOperations: 5, nonPhysicalSteps: { confirm_owned_ideal: 1 }, nonPhysicalStepCount: 1, unexpectedNonPhysicalSteps: {}, streamAdvanceSum: 5, objective: 5, identities: { stepCount: true, streamAdvance: true, objective: true } })
    expect(handoff.objective).toBe(5)
    // Before D-1B condition 11 was `physical === plan.steps.length`: 5 !== 6 would have been objective_mismatch(physical_steps_mismatch).
    expect(semantic.physical!.physicalOperations).not.toBe(semantic.physical!.planSteps)
    // The Planner selected both Entries and completed both Targets; the zero-operation Target's completion is its confirm_owned_ideal.
    expect(semantic.planner).toMatchObject({ fullPlannerRuns: 1, conflicts: [], rejected: [], warnings: [], termination: { status: 'completed', completedTargetCount: 2, totalTargetCount: 2 } })
    // Trace Replay still faces the 5 physical Steps one to one; the confirm_owned_ideal is one of the reserve drafts.
    expect(semantic.traceReplay).toMatchObject({ isValid: true, drafts: { total: 7, physical: 5, reserve: 2 }, correspondence: { planPhysicalSteps: 5, replayPhysicalDrafts: 5, mismatches: 0, counterPositionMismatches: 0 }, finalCountersMatchPlan: true })
  }, 60_000)

  it('meets every condition with several confirm_owned_ideal Steps, and non-physical Steps never raise the objective', async () => {
    const one = await capturedRun(() => zeroOperationHandoff(['a']))
    const two = await capturedRun(() => zeroOperationHandoff(['a', 'c']))
    expect(two.record.semantic.outcome).toEqual({ kind: 'conditions_met' })
    expect(two.record.semantic.physical).toMatchObject({ planSteps: 7, physicalOperations: 5, nonPhysicalSteps: { confirm_owned_ideal: 2 }, nonPhysicalStepCount: 2, identities: { stepCount: true, streamAdvance: true, objective: true } })
    expect(two.plan!.steps.filter(step => step.operationType === 'confirm_owned_ideal').every(step => step.rngAdvance.skillCounterDelta === 0 && step.rngAdvance.gogmaCounterDelta === 0 && (step.rngAdvance.normalCounterDelta ?? 0) === 0)).toBe(true)
    // One more zero-operation Target adds one Plan Step and nothing to the objective or the physical operations.
    expect(two.handoff.objective).toBe(one.handoff.objective)
    expect(two.record.semantic.physical!.physicalOperations).toBe(one.record.semantic.physical!.physicalOperations)
    expect(two.record.semantic.physical!.planSteps).toBe(one.record.semantic.physical!.planSteps! + 1)
    expect(two.record.semantic.planner!.termination).toMatchObject({ status: 'completed', completedTargetCount: 3, totalTargetCount: 3 })
  }, 60_000)

  it('separates verified-capable from objective_mismatch over the same Plan with non-physical Steps (no tolerance)', async () => {
    const { scenario, handoff } = await zeroOperationHandoff(['a'])
    const off = structuredClone(handoff)
    off.objective += 1
    const record = await verifyPlannerCandidate(scenario.scene.input, off, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution())
    expect(record.semantic.outcome).toEqual({ kind: 'objective_mismatch', physicalOperations: 5, objective: 6, reasons: [{ code: 'physical_objective_mismatch', physicalOperations: 5, objective: 6 }] })
    expect(record.semantic.checks).toMatchObject({ physicalStepCountIdentity: true, physicalStreamAdvanceIdentity: true, physicalObjectiveIdentity: false })
    // The objective of the same handoff minus one: still a mismatch, never absorbed by the non-physical Step.
    const below = structuredClone(handoff)
    below.objective -= 1
    expect((await verifyPlannerCandidate(scenario.scene.input, below, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution())).semantic.outcome).toMatchObject({ kind: 'objective_mismatch', physicalOperations: 5, objective: 4 })
  }, 60_000)

  it('fails closed when a non-physical Step advances a Counter, or a physical Step advances the wrong Counter', async () => {
    const { scenario, handoff } = await zeroOperationHandoff(['a'])
    const run = (edit: (plan: ProductionPlan) => void) => verifyPlannerCandidate(scenario.scene.input, handoff, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution({ planner: editedResultPort(result => edit(result.plan!)) }))
    // Edit: the real Plan's confirm_owned_ideal Step is given one Gogma Counter advance.
    const advancing = await run(plan => { const step = plan.steps.find(value => value.operationType === 'confirm_owned_ideal')!; step.rngAdvance = { ...step.rngAdvance, gogmaCounterDelta: 1 } })
    expect(advancing.semantic.physical!.error).toMatch(/Unknown physical operation confirm_owned_ideal/)
    expect(advancing.semantic.outcome).toEqual({ kind: 'objective_mismatch', physicalOperations: null, objective: 5, reasons: [{ code: 'physical_summary_error', message: expect.stringMatching(/confirm_owned_ideal/) }] })
    expect(advancing.semantic.checks).toMatchObject({ physicalStepCountIdentity: false, physicalStreamAdvanceIdentity: false, physicalObjectiveIdentity: false })
    // Edit: the real Plan's first reset_bonuses Step advances the Skill Counter instead of the Gogma Counter.
    const wrongStream = await run(plan => { const step = plan.steps.find(value => value.operationType === 'reset_bonuses')!; step.rngAdvance = { ...step.rngAdvance, gogmaCounterDelta: 0, skillCounterDelta: 1 } })
    expect(wrongStream.semantic.physical!.error).toMatch(/Operation reset_bonuses advanced skill/)
    expect(wrongStream.semantic.outcome.kind).not.toBe('conditions_met')
    expect(wrongStream.semantic.checks.physicalStepCountIdentity).toBe(false)
    // Edit: the real Plan's confirm_owned_ideal Step is relabelled as the legacy reserve_weapon (zero advance): no non-physical Step of a
    // current Plan, so it breaks the step-count identity (and the replay correspondence, which takes it for a physical Step).
    const legacy = await run(plan => { plan.steps.find(value => value.operationType === 'confirm_owned_ideal')!.operationType = 'reserve_weapon' })
    expect(legacy.semantic.physical).toMatchObject({ error: null, nonPhysicalSteps: { reserve_weapon: 1 }, nonPhysicalStepCount: 0, unexpectedNonPhysicalSteps: { reserve_weapon: 1 }, identities: { stepCount: false, streamAdvance: true, objective: true } })
    expect(physicalIdentityReasons(legacy.semantic.physical!)).toEqual([{ code: 'physical_steps_mismatch', physicalOperations: 5, planSteps: 6, nonPhysicalSteps: 0, unexpectedNonPhysicalSteps: { reserve_weapon: 1 } }])
    expect(legacy.semantic.outcome.kind).toBe('planner_rejected')
    expect(legacy.semantic.checks.physicalStepCountIdentity).toBe(false)
  }, 60_000)

  it('counts a shared physical Step once and breaks the stream-advance identity on any difference (pure summary)', async () => {
    const { scenario, handoff, plan } = await capturedRun(() => zeroOperationHandoff(['a']))
    const input = scenario.scene.input
    // Edit: one physical Step of the real Plan is recorded as progressing both Targets (a shared physical Step).
    const shared = structuredClone(plan!)
    const step = shared.steps.find(value => value.operationType === 'reset_bonuses')!
    step.progressedTargetWeaponIds = [TARGET.a, TARGET.b]
    const summary = summarizeVerificationPhysical(shared, input, handoff).record
    expect(summary).toMatchObject({ planSteps: 6, physicalOperations: 5, sharedPhysicalSteps: 1, streamAdvanceSum: 5, identities: { stepCount: true, streamAdvance: true, objective: true } })
    expect(physicalIdentityReasons(summary)).toEqual([])
    // Edit: the summary record says Σ advances 4 for 5 physical operations (summarizePlanPhysical() itself never produces this).
    const broken = { ...summary, streamAdvanceSum: 4, identities: { ...summary.identities, streamAdvance: false } }
    expect(physicalIdentityReasons(broken)).toEqual([{ code: 'physical_identity_broken', physicalOperations: 5, streamAdvanceSum: 4 }])
    // Every identity is exact: each one alone is a reason.
    expect(physicalIdentityReasons({ ...summary, identities: { stepCount: false, streamAdvance: true, objective: true } }).map(reason => reason.code)).toEqual(['physical_steps_mismatch'])
    expect(physicalIdentityReasons({ ...summary, identities: { stepCount: true, streamAdvance: true, objective: false } }).map(reason => reason.code)).toEqual(['physical_objective_mismatch'])
    expect(summarizeVerificationPhysical(null, input, handoff).record.identities).toEqual({ stepCount: null, streamAdvance: null, objective: null })
  }, 60_000)

  it('keeps the Trace Replay correspondence check with non-physical Steps: a dropped physical draft still fails', async () => {
    const { scenario, handoff } = await zeroOperationHandoff(['a'])
    const shifted = await verifyPlannerCandidate(scenario.scene.input, handoff, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution({
      planner: { ...productionPlannerVerificationPort, replayPlannerSearchTrace: (...args) => { const replay = productionPlannerVerificationPort.replayPlannerSearchTrace(...args); return { ...replay, drafts: replay.drafts.filter(draft => draft.actionKind !== 'route_operation').concat(replay.drafts.filter(draft => draft.actionKind === 'route_operation').slice(1)) } } },
    }))
    expect(shifted.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: [{ code: 'trace_replay_correspondence_mismatch' }] })
    expect(shifted.semantic.traceReplay!.correspondence).toMatchObject({ planPhysicalSteps: 5, replayPhysicalDrafts: 4 })
    expect(shifted.semantic.checks.traceReplayValid).toBe(false)
  }, 60_000)
})

describe('Phase D-1B: full Planner runs are recorded, never a reason of their own', () => {
  /** A Production port that announces one extra full run (a modelled retry) before the real run; nothing else of the result changes. */
  const modelledRetryPort = (edit: (result: Awaited<ReturnType<PlannerVerificationPort['createProductionPlanWithObserver']>>) => void = () => {}): PlannerVerificationPort => ({
    ...productionPlannerVerificationPort,
    createProductionPlanWithObserver: async (input, deps, options, observer) => {
      observer?.beforePlannerRun()
      const result = await productionPlannerVerificationPort.createProductionPlanWithObserver(input, deps, options, observer)
      edit(result)
      return result
    },
  })

  it('records one full run for a run without retry', async () => {
    const { scene, handoff } = await successCase()
    const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution())
    expect(record.semantic.planner!.fullPlannerRuns).toBe(1)
    expect(record.semantic.outcome).toEqual({ kind: 'conditions_met' })
  }, 60_000)

  it('rejects a real Production runtime-unsupported retry through the conditions it breaks (warning, excluded Entry, completion), not its count', async () => {
    const { scenario, handoff, port, switch: flag } = await runtimeUnsupportedRetryHandoff()
    const record = await verifyPlannerCandidate(scenario.scene.input, handoff, plannerDependencies(scenario.scene), TEST_CONDITIONS, execution({ planner: port }))
    expect(flag.on).toBe(true)
    const { semantic } = record
    // The Production retry ran: two full runs, b's Entry excluded with the rng_prediction_unsupported warning, the final run incomplete.
    expect(semantic.planner!.fullPlannerRuns).toBe(2)
    expect(semantic.planner!.warnings).toEqual([{ kind: 'rng_prediction_unsupported', message: expect.stringContaining('requires unsupported RNG input (skill: reference_adapter_unsupported)') }])
    expect(semantic.outcome.kind).toBe('planner_rejected')
    const reasons = semantic.outcome.kind === 'planner_rejected' ? semantic.outcome.reasons : []
    expect(reasons.map(reason => reason.code)).toEqual(expect.arrayContaining(['termination_not_completed', 'completed_target_count_mismatch', 'total_target_count_mismatch', 'warnings']))
    expect(reasons).toContainEqual({ code: 'warnings', count: 1, kinds: { rng_prediction_unsupported: 1 } })
    // No reason names the run count: the record keeps it as an observation.
    expect(JSON.stringify(reasons)).not.toMatch(/retry|fullPlannerRuns/)
    expect(semantic.checks).toMatchObject({ noWarnings: false, terminationCompleted: false, completedEqualsPlanningTargets: false })
  }, 60_000)

  it('meets every condition for a modelled retry whose other conditions all hold, and rejects it on a warning alone', async () => {
    const { scene, handoff } = await successCase()
    const run = (port: PlannerVerificationPort) => verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: port }))
    // Modelled (not a Production retry): the count is 2, the Production result is the ordinary one.
    const counted = await run(modelledRetryPort())
    expect(counted.semantic.planner!.fullPlannerRuns).toBe(2)
    expect(counted.semantic.outcome).toEqual({ kind: 'conditions_met' })
    expect(Object.values(counted.semantic.checks).every(value => value === true)).toBe(true)
    // The same modelled retry with a warning: rejected by condition 9 only, whatever the count.
    const warned = await run(modelledRetryPort(result => { result.warnings.push({ kind: 'rng_prediction_unsupported', message: 'fixture' }) }))
    expect(warned.semantic.planner!.fullPlannerRuns).toBe(2)
    expect(warned.semantic.outcome).toEqual({ kind: 'planner_rejected', reasons: [{ code: 'warnings', count: 1, kinds: { rng_prediction_unsupported: 1 } }] })
    // A warning with one full run is rejected the same way: the warning decides, never the count.
    const single = await run(editedResultPort(result => { result.warnings.push({ kind: 'rng_prediction_unsupported', message: 'fixture' }) }))
    expect(single.semantic.planner!.fullPlannerRuns).toBe(1)
    expect(single.semantic.outcome).toEqual(warned.semantic.outcome)
  }, 60_000)
})

function countingPort(): { port: PlannerVerificationPort; calls: { plan: number; replay: number } } {
  const calls = { plan: 0, replay: 0 }
  return {
    calls,
    port: {
      createProductionPlanWithObserver: (...args) => { calls.plan += 1; return productionPlannerVerificationPort.createProductionPlanWithObserver(...args) },
      replayPlannerSearchTrace: (...args) => { calls.replay += 1; return productionPlannerVerificationPort.replayPlannerSearchTrace(...args) },
    },
  }
}
