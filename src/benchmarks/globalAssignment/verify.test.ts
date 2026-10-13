import { describe, expect, it } from 'vitest'
import { hashStableValue } from '../../domain/models/publicTypes'
import { TARGET, scenarioAlternativeFirst, scenarioConversionFallback, scenarioSkillDependency } from './materializationTestFixture'
import { materializedEntriesFingerprint, productionPlannerVerificationPort, verifyPlannerCandidate, type PlannerVerificationPort } from './verify'
import {
  conflictingHandoff, editedResultPort, execution, heldCrossingHandoff, materializedHandoff, plannerDependencies, TEST_CONDITIONS,
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
      expect(semantic.physical).toMatchObject({ error: null, identityHolds: true, nonPhysicalStepCount: 0 })
      expect(semantic.physical!.physicalOperations).toBe(semantic.physical!.planSteps)
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

  it('rejects a null Plan, warnings, a runtime-unsupported retry and a Plan generation error', async () => {
    const { scene, handoff } = await successCase()
    const run = (planner: PlannerVerificationPort) => verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner }))
    const nullPlan = await run(editedResultPort(result => { result.plan = null }))
    expect(nullPlan.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: expect.arrayContaining([{ code: 'plan_null' }]) })
    expect(nullPlan.semantic.checks.planPresent).toBe(false)
    const warned = await run(editedResultPort(result => { result.warnings.push({ kind: 'rng_prediction_unsupported', message: 'fixture' }) }))
    expect(warned.semantic.outcome).toEqual({ kind: 'planner_rejected', reasons: [{ code: 'warnings', count: 1, kinds: { rng_prediction_unsupported: 1 } }] })
    expect(warned.semantic.checks.noWarnings).toBe(false)
    const retried = await run({ ...productionPlannerVerificationPort, createProductionPlanWithObserver: (input, deps, options, observer) => { observer?.beforePlannerRun(); return productionPlannerVerificationPort.createProductionPlanWithObserver(input, deps, options, observer) } })
    expect(retried.semantic.planner!.fullPlannerRuns).toBe(2)
    expect(retried.semantic.outcome).toEqual({ kind: 'planner_rejected', reasons: [{ code: 'runtime_unsupported_retry', fullPlannerRuns: 2 }] })
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
    expect(record.semantic.checks).toMatchObject({ physicalEqualsPlanSteps: true, physicalEqualsObjective: false })
    // A Plan whose Step breaks the one-Counter identity fails the physical summary itself.
    const broken = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ planner: editedResultPort(result => { result.plan!.steps[0]!.rngAdvance = { ...result.plan!.steps[0]!.rngAdvance, skillCounterDelta: 2 } }) }))
    expect(broken.semantic.physical!.error).toMatch(/does not advance exactly one Counter by one/)
    expect(broken.semantic.outcome.kind).toBe('planner_rejected')
    expect(broken.semantic.checks.physicalEqualsPlanSteps).toBe(false)
  }, 60_000)

  it('reports a cancellation as unmeasured(cancelled), never as a Planner result', async () => {
    const { scene, handoff } = await successCase()
    const record = await verifyPlannerCandidate(scene.input, handoff, plannerDependencies(scene), TEST_CONDITIONS, execution({ shouldCancel: () => true }))
    expect(record.semantic.outcome).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
    expect(record.semantic.planner!.termination!.status).toBe('cancelled')
    expect(record.semantic.traceReplay).toBeNull()
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
