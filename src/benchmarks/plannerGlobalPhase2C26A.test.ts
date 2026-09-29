import { describe, expect, it } from 'vitest'
import oldC2Result from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { stableStringify } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { belowPracticalBonuses, idealBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
} from '../test/fixtures/plannerConstrainedOrchestration'
import {
  phase2c2KernelRequest,
  phase2c2ProductionDefaultConditions,
  runPhase2C2Kernel,
  type Phase2C2Conditions,
  type Phase2C2Orientation,
} from './plannerGlobalPhase2C2'
import {
  classifyPhase2C26AChildExit,
  createPhase2C26AMemoryTracker,
  phase2c26aKernelChildId,
  phase2c26aKernelTasks,
  runPhase2C26ABaseline,
  runPhase2C26AKernel,
  PHASE2C26A_CHILD_HEAP_MB,
  PHASE2C26A_CHILD_STATUSES,
  PHASE2C26A_CONCURRENCY,
  PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A_NODE_YIELD,
  PHASE2C26A_ORIENTATION_BUDGET_MS,
} from './plannerGlobalPhase2C26A'
import c26aSource from './plannerGlobalPhase2C26A.ts?raw'
import {
  comparePhase2C26ABaselineWithOldC2,
  comparePhase2C26AOldCompletedSemantics,
  comparePhase2C26AOrientationSets,
  compactPhase2C26AKernel,
  parsePhase2C26AOldC2Result,
  phase2c26aConclusion,
  phase2c26aParticipantCoverage,
  phase2c26aTransitions,
  summarizePhase2C26AKernels,
  comparePhase2C26AWithOldC2,
  validatePhase2C26AFormalRun,
  validatePhase2C26AOldC2Comparability,
  type Phase2C26AKernelTarget,
  type Phase2C26ARawKernel,
} from './plannerGlobalPhase2C26AAnalysis'
import analysisSource from './plannerGlobalPhase2C26AAnalysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26a.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26a.mjs?raw'

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.c26a.a'
const ENTRY_B = 'build-list.c26a.b'

/** The Phase 2-C2 test scenario: A and B contend for Gogma 10; each has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.c26a.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.c26a.b', { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}
const SMALL: Phase2C2Conditions = { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }, bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 }, captureBound: 8 }

describe('conditions', () => {
  it('keeps the Phase 2-C2 formal Node conditions', () => {
    expect(PHASE2C26A_CHILD_HEAP_MB).toBe(8192)
    expect(PHASE2C26A_CONCURRENCY).toBe(3)
    expect(PHASE2C26A_ORIENTATION_BUDGET_MS).toBe(30 * 60 * 1000)
    expect(PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS).toBe(250)
    expect(PHASE2C26A_NODE_YIELD).toBe('setImmediate')
    expect([...PHASE2C26A_CHILD_STATUSES]).toEqual(['completed', 'out_of_memory', 'timeout', 'process_failure'])
    const old = parsePhase2C26AOldC2Result(oldC2Result)
    expect(PHASE2C26A_CHILD_HEAP_MB).toBe(old.childHeapLimitMb)
    expect(PHASE2C26A_CONCURRENCY).toBe(old.concurrency)
    expect(PHASE2C26A_ORIENTATION_BUDGET_MS).toBe(old.orientationBudgetMs)
  })

  it('changes no Production default, schema or version', () => {
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect(defaultPlannerAlternativeTrialBounds).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    // The current Production default is still the one Phase 2-C2 measured with.
    expect(parsePhase2C26AOldC2Result(oldC2Result).conditions).toEqual({ extent: defaultPlannerAlternativeSearchExtent, bounds: defaultPlannerAlternativeTrialBounds })
  })
})

describe('baseline, orientations and kernel tasks', () => {
  it('derives every orientation from the current baseline itself, one kernel task each, in order, with Production defaults as spread copies', async () => {
    const built = scenario()
    const deps = { createEngine: () => built.engine, now: () => 0 }
    const baseline = await runPhase2C26ABaseline(built.input, deps)
    expect(baseline.summary.conflicts).toBeGreaterThan(0)
    expect(baseline.orientations.map(o => o.orientationId)).toEqual(
      baseline.orientations.map(o => `c${o.conflictIndex}-p${o.participantBuildListEntryIds.indexOf(o.fixedBuildListEntryId)}`))
    const tasks = phase2c26aKernelTasks(baseline.orientations)
    expect(tasks.map(t => t.orientation)).toEqual(baseline.orientations)
    expect(tasks[0].orientation).not.toBe(baseline.orientations[0])
    for (const task of tasks) {
      expect(task.conditions).toEqual(phase2c2ProductionDefaultConditions())
      expect(task.conditions.extent).toEqual(defaultPlannerAlternativeSearchExtent)
      expect(task.conditions.extent).not.toBe(defaultPlannerAlternativeSearchExtent)
      expect(task.conditions.bounds).not.toBe(defaultPlannerAlternativeTrialBounds)
      const request = phase2c2KernelRequest(built.input, task.orientation, task.conditions)
      expect(request.decision).toEqual({ conflictKey: task.orientation.conflictKey, selectedBuildListEntryId: task.orientation.fixedBuildListEntryId })
      expect(request.priorFixedBuildListEntryIds).toEqual([])
      expect(request.priorExcludedRoutes).toEqual([])
    }
    expect(phase2c26aKernelChildId('c3-p1')).toBe('kernel-c3-p1')
  })

  it('runs exactly the unchanged Phase 2-C2 kernel for the task', async () => {
    const built = scenario()
    const deps = { createEngine: () => built.engine, now: () => 0 }
    const baseline = await runPhase2C26ABaseline(built.input, deps)
    const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
    const viaC26a = await runPhase2C26AKernel(built.input, { orientation, conditions: SMALL }, deps)
    const viaC2 = await runPhase2C2Kernel(built.input, orientation, SMALL, deps)
    expect(stableStringify(viaC26a)).toBe(stableStringify(viaC2))
    expect(viaC26a.kernel.status).toBe('completed')
  })

  it('classifies child exits without ever reading a timeout or an OOM as a completion', () => {
    const base = { code: 0, signal: null, timedOut: false, stderrTail: '', recordWritten: true }
    expect(classifyPhase2C26AChildExit(base)).toBe('completed')
    expect(classifyPhase2C26AChildExit({ ...base, timedOut: true, code: null, signal: 'SIGKILL' })).toBe('timeout')
    expect(classifyPhase2C26AChildExit({ ...base, code: 134, recordWritten: false, stderrTail: 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory' })).toBe('out_of_memory')
    expect(classifyPhase2C26AChildExit({ ...base, code: 1, recordWritten: false, stderrTail: 'Error: boom' })).toBe('process_failure')
    expect(classifyPhase2C26AChildExit({ ...base, recordWritten: false })).toBe('process_failure')
  })

  it('keeps running sampled maxima', () => {
    let t = 0
    const tracker = createPhase2C26AMemoryTracker(() => t)
    tracker.sample({ heapUsed: 10, rss: 50 })
    t = 5
    expect(tracker.sample({ heapUsed: 7, rss: 60 })).toEqual({ samples: 2, maxHeapUsedBytes: 10, maxRssBytes: 60, lastElapsedMs: 5 })
  })
})

// ---------------------------------------------------------------- post-hoc analysis

const old = parsePhase2C26AOldC2Result(oldC2Result)
const conditions = phase2c2ProductionDefaultConditions()
const expectations = { childHeapLimitMb: 8192, concurrency: 3, orientationBudgetMs: 1_800_000, conditions }

function completedRecord(orientation: Phase2C2Orientation, targets: Phase2C26AKernelTarget[], reruns = 1) {
  return { orientation, conditions, kernel: { status: 'completed' as const, plannerRerunsUsed: reruns, explicitDecisionBuildListEntryIds: [orientation.fixedBuildListEntryId], targets }, timing: { kernelMs: 1 } }
}
function target(targetWeaponId: string, outcome: string, trials: { candidateKey: string; result: string; reason: string | null; generatedSelected: boolean | null }[] = [], searched = true) {
  return { targetWeaponId, outcome, reservation: searched ? { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] } : null,
    search: searched ? { deliveredCandidates: trials.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: outcome === 'stopped_by_search_extent_bound', stoppedByConsumer: outcome === 'found' } : null,
    trials, found: outcome === 'found' ? { stableKey: trials.at(-1)!.candidateKey, generatedSelected: true, trialPlan: {}, summary: {} } : null, skippedExcludedRouteKeys: 0 }
}
function kernelEntry(orientation: Phase2C2Orientation, outcome: 'completed' | 'out_of_memory' | 'timeout' | 'process_failure', targets = orientation.participantTargetWeaponIds
  .filter(id => id !== orientation.fixedTargetWeaponId).map(id => target(id, 'stopped_by_search_extent_bound'))): Phase2C26ARawKernel {
  const completed = outcome === 'completed'
  return {
    orientationId: orientation.orientationId, task: { orientation: structuredClone(orientation), conditions: structuredClone(conditions) },
    process: { outcome, wallMs: completed ? 1000 : 60_000, exitCode: completed ? 0 : 134, signal: null, timedOut: outcome === 'timeout', stderrTail: completed ? null : 'x',
      lastIpcMemory: { samples: 4, maxHeapUsedBytes: completed ? 100 : 8_000_000_000, maxRssBytes: 200, lastElapsedMs: 1 }, lastIpcYields: 3, ...({ id: `kernel-${orientation.orientationId}`, role: 'kernel' }) } as Phase2C26ARawKernel['process'],
    childWallMs: completed ? 900 : null, memory: completed ? { samples: 4, sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 300, heapSizeLimitBytes: 8_800_000_000 } : null,
    record: completed ? completedRecord(orientation, targets) as unknown as Phase2C26ARawKernel['record'] : null,
  }
}
/** A complete synthetic formal series over the Phase 2-C2 orientation set (all orientations completed). */
function completeRun(outcomeOf: (o: Phase2C2Orientation) => 'completed' | 'out_of_memory' | 'timeout' | 'process_failure' = () => 'completed') {
  const kernels = old.orientations.map(o => kernelEntry(o, outcomeOf(o)))
  return {
    status: 'completed',
    environment: { smoke: null, uncommittedBenchmarkCode: false, childHeapLimitMb: 8192, concurrency: 3, orientationBudgetMs: 1_800_000 },
    conditions: structuredClone(conditions),
    baseline: { process: { outcome: 'completed' }, record: { summary: old.baseline, orientations: structuredClone(old.orientations) } },
    kernels,
    processes: [{ role: 'baseline' }, ...kernels.map(k => ({ role: 'kernel', id: `kernel-${k.orientationId}` }))],
  }
}

describe('Phase 2-C2 RESULT parser (post-hoc only)', () => {
  it('reads the committed Phase 2-C2 RESULT: 54 orientations, 11 completed and 43 OOM', () => {
    expect(old.orientations).toHaveLength(54)
    const outcomes = [...old.rows.values()].map(row => row.outcome)
    expect(outcomes.filter(o => o === 'completed')).toHaveLength(11)
    expect(outcomes.filter(o => o === 'out_of_memory')).toHaveLength(43)
    expect(old.trialRejectionReasons).toEqual({ explicit_decision_not_selected: 10 })
    expect(old.baseline).toMatchObject({ planningTargetCount: 43, completedTargetCount: 20, planSteps: 1465, conflicts: 21 })
  })

  it('fails closed on a malformed or partial RESULT', () => {
    expect(() => parsePhase2C26AOldC2Result(null)).toThrow()
    expect(() => parsePhase2C26AOldC2Result({ ...oldC2Result, provenance: undefined })).toThrow(/provenance/)
    const partial = structuredClone(oldC2Result) as { kernel: { results: unknown[] } }
    partial.kernel.results.pop()
    expect(() => parsePhase2C26AOldC2Result(partial)).toThrow(/exactly once/)
  })
})

describe('parity with Phase 2-C2', () => {
  it('matches an identical baseline and orientation set, and reports every difference', () => {
    expect(comparePhase2C26ABaselineWithOldC2(old.baseline, old.orientations.length, old).matches).toBe(true)
    const changed = comparePhase2C26ABaselineWithOldC2({ ...old.baseline, planSteps: 1464 }, 53, old)
    expect(changed.matches).toBe(false)
    expect(changed.checks.filter(c => !c.matches).map(c => c.field)).toEqual(['planSteps', 'orientationCount'])
    expect(comparePhase2C26AOrientationSets(old.orientations, old.orientations)).toMatchObject({ matches: true, mismatches: [], missingInCurrent: [], extraInCurrent: [] })
    const reordered = old.orientations.map(o => ({ ...o, participantTargetWeaponIds: [...o.participantTargetWeaponIds].reverse() }))
    expect(comparePhase2C26AOrientationSets(reordered, old.orientations).mismatches).toEqual([])
    const shifted = old.orientations.map((o, i) => (i === 0 ? { ...o, fixedTargetWeaponId: 'other', kind: 'same_skill_counter' as const } : o))
    expect(comparePhase2C26AOrientationSets(shifted, old.orientations).mismatches.map(m => m.field)).toEqual(['kind', 'fixedTargetWeaponId'])
    const missing = comparePhase2C26AOrientationSets(old.orientations.slice(1), old.orientations)
    expect(missing).toMatchObject({ matches: false, missingInCurrent: [old.orientations[0].orientationId] })
  })
})

describe('formal series completeness', () => {
  const validate = (raw: unknown) => validatePhase2C26AFormalRun(raw, expectations)

  it('accepts a complete series; the expected count comes from the raw baseline', () => {
    const result = validate(completeRun())
    expect(result).toMatchObject({ valid: true, failures: [], expectedOrientations: old.orientations.length, actualKernelRecords: old.orientations.length })
    const three = completeRun()
    three.baseline.record.orientations = three.baseline.record.orientations.slice(0, 3)
    three.kernels = three.kernels.slice(0, 3)
    three.processes = three.processes.slice(0, 4)
    expect(validate(three)).toMatchObject({ valid: true, expectedOrientations: 3 })
  })

  it('accepts OOM / timeout / process failure children as complete records (a failure is a result, not a gap)', () => {
    const outcomes = ['completed', 'out_of_memory', 'timeout', 'process_failure'] as const
    expect(validate(completeRun(o => outcomes[o.conflictIndex % 4])).valid).toBe(true)
  })

  it('rejects a missing baseline', () => {
    const raw = completeRun() as Record<string, unknown>
    raw.baseline = { process: { outcome: 'out_of_memory' }, record: null }
    const result = validate(raw)
    expect(result.valid).toBe(false)
    expect(result.baselineCompleted).toBe(false)
  })

  it('rejects a missing, a duplicate and a foreign orientation', () => {
    const missing = completeRun(); missing.kernels.splice(5, 1); missing.processes.splice(6, 1)
    expect(validate(missing).missingOrientations).toEqual([old.orientations[5].orientationId])
    const duplicate = completeRun(); duplicate.kernels.push(structuredClone(duplicate.kernels[0])); duplicate.processes.push({ role: 'kernel', id: 'dup' })
    expect(validate(duplicate)).toMatchObject({ valid: false, duplicateOrientations: [old.orientations[0].orientationId] })
    const foreign = completeRun(); foreign.kernels.push({ ...structuredClone(foreign.kernels[0]), orientationId: 'c99-p0' })
    expect(validate(foreign)).toMatchObject({ valid: false, foreignOrientations: ['c99-p0'] })
  })

  it('rejects task metadata mismatches (orientation, conditions, child id, record orientation)', () => {
    const orientationMismatch = completeRun(); orientationMismatch.kernels[0].task.orientation.fixedTargetWeaponId = 'other'
    expect(validate(orientationMismatch).metadataMismatches).toContainEqual({ orientationId: old.orientations[0].orientationId, field: 'task.orientation' })
    const conditionsMismatch = completeRun(); conditionsMismatch.kernels[1].task.conditions.extent.maxGogmaAdvance = 300
    expect(validate(conditionsMismatch).metadataMismatches).toContainEqual({ orientationId: old.orientations[1].orientationId, field: 'task.conditions' })
    const idMismatch = completeRun(); (idMismatch.kernels[2].process as unknown as { id: string }).id = 'kernel-c0-p0'
    expect(validate(idMismatch).valid).toBe(false)
    const recordMismatch = completeRun(); (recordMismatch.kernels[3].record as unknown as { orientation: Phase2C2Orientation }).orientation = old.orientations[4]
    expect(validate(recordMismatch).metadataMismatches).toContainEqual({ orientationId: old.orientations[3].orientationId, field: 'record.orientation' })
    const failedWithRecord = completeRun(o => (o.orientationId === old.orientations[0].orientationId ? 'out_of_memory' : 'completed'))
    failedWithRecord.kernels[0].record = completeRun().kernels[0].record
    expect(validate(failedWithRecord).valid).toBe(false)
  })

  it('rejects an unknown child status, a smoke / subset run, uncommitted code and other formal conditions', () => {
    const unknown = completeRun(); (unknown.kernels[0].process as unknown as { outcome: string }).outcome = 'no_candidate'
    expect(validate(unknown).unknownStatuses).toEqual([{ orientationId: old.orientations[0].orientationId, status: 'no_candidate' }])
    const smoke = completeRun(); (smoke.environment as Record<string, unknown>).smoke = { orientationIds: ['c2-p0'] }
    expect(validate(smoke).valid).toBe(false)
    const uncommitted = completeRun(); uncommitted.environment.uncommittedBenchmarkCode = true
    expect(validate(uncommitted).valid).toBe(false)
    for (const [field, value] of [['childHeapLimitMb', 24576], ['concurrency', 1], ['orientationBudgetMs', 3_600_000]] as const) {
      const raw = completeRun(); (raw.environment as Record<string, unknown>)[field] = value
      expect(validate(raw).valid).toBe(false)
    }
    const baselineFailed = completeRun(); baselineFailed.status = 'baseline_failed'
    expect(validate(baselineFailed).valid).toBe(false)
  })
})

describe('aggregation, transitions and conclusion', () => {
  const [o0, o1, o2, o3] = old.orientations
  const others = (o: Phase2C2Orientation) => o.participantTargetWeaponIds.filter(id => id !== o.fixedTargetWeaponId)

  it('counts Target outcomes, trials, rejection reasons and reruns from completed kernels only; unknown outcomes stay their own category', () => {
    const kernels = [
      kernelEntry(o0, 'completed', others(o0).map(id => target(id, 'found', [{ candidateKey: 'k1', result: 'found', reason: null, generatedSelected: true }]))),
      kernelEntry(o1, 'completed', others(o1).map(id => target(id, 'stopped_by_candidate_trial_bound', [
        { candidateKey: 'k2', result: 'rejected', reason: 'explicit_decision_not_selected', generatedSelected: null },
        { candidateKey: 'k3', result: 'rejected', reason: 'explicit_decision_not_selected', generatedSelected: null }]))),
      kernelEntry(o2, 'completed', others(o2).map(id => target(id, 'some_future_status', [], false))),
      kernelEntry(o3, 'out_of_memory'),
    ]
    const summary = summarizePhase2C26AKernels(kernels)
    expect(summary.childStatus).toEqual({ completed: 3, out_of_memory: 1, timeout: 0, process_failure: 0 })
    expect(summary.targetOutcomes.found).toBe(others(o0).length)
    expect(summary.targetOutcomes.stopped_by_candidate_trial_bound).toBe(others(o1).length)
    expect(summary.otherTargetOutcomes).toEqual({ some_future_status: others(o2).length })
    expect(summary.trials.rejectionReasons).toEqual({ explicit_decision_not_selected: 2 * others(o1).length })
    expect(summary.trials.generatedSelected).toEqual({ true: others(o0).length })
    expect(summary.trials.unsearchedTargets).toBe(others(o2).length)
    expect(summary.plannerRerunsUsed.distribution).toEqual({ 1: 3 })
    // The OOM child contributes its last IPC sample to memory and its wall time, never a Target outcome.
    expect(summary.memory.maxSampledHeapUsedBytes).toBe(8_000_000_000)
    expect(summary.memory.sources).toEqual({ last_ipc_sample: 1, record: 3 })
    expect(summary.targetResults).toBe(others(o0).length + others(o1).length + others(o2).length)
  })

  it('never reads a timeout or an OOM as "no Candidate"', () => {
    const summary = summarizePhase2C26AKernels([kernelEntry(o0, 'timeout'), kernelEntry(o1, 'out_of_memory')])
    expect(summary.targetResults).toBe(0)
    expect(Object.values(summary.targetOutcomes).every(n => n === 0)).toBe(true)
    expect(summary.targetOutcomes.not_found_within_search_extent).toBe(0)
    const coverage = phase2c26aParticipantCoverage([o0, o1], [kernelEntry(o0, 'timeout'), kernelEntry(o1, 'out_of_memory')], null)
    expect(coverage.participantsSearched).toBe(0)
    expect(coverage.allParticipantsSearched).toBe(false)
    const row = compactPhase2C26AKernel(kernelEntry(o0, 'timeout'), old.rows.get(o0.orientationId)!, value => `h(${value})`, null)
    expect(row.kernel).toEqual({ status: 'process_timeout' })
    expect(row.transition).toBe(`${old.rows.get(o0.orientationId)!.outcome} -> timeout`)
  })

  it('builds the old -> current transition matrix, including the old OOM and old completed groups', () => {
    const currentOf = (o: Phase2C2Orientation) => (o.conflictIndex === 0 ? 'timeout' : o.conflictIndex === 1 ? 'out_of_memory' : 'completed')
    const kernels = old.orientations.map(o => kernelEntry(o, currentOf(o)))
    const transitions = phase2c26aTransitions(old, kernels)
    expect(transitions.oldOutOfMemory.total).toBe(43)
    expect(transitions.oldCompleted.total).toBe(11)
    const total = (group: Record<string, number>) => Object.values(group).reduce((a, b) => a + b, 0)
    expect(total(transitions.matrix.out_of_memory)).toBe(43)
    expect(total(transitions.matrix.completed)).toBe(11)
    for (const row of transitions.rows) expect(row.current).toBe(currentOf(old.orientations.find(o => o.orientationId === row.orientationId)!))
  })

  it('compares the old completed kernels semantically through key SHA-256s', () => {
    const sha = (value: string) => `sha(${value})`
    const row = [...old.rows.values()].find(r => r.kernelStatus === 'completed')!
    const orientation = old.orientations.find(o => o.orientationId === row.orientationId)!
    // Rebuild the same judgement with raw keys whose "hash" is the recorded SHA-256.
    const unsha = (value: string) => value.replace(/^sha\((.*)\)$/, '$1')
    const same = kernelEntry(orientation, 'completed', row.targets.map(t => ({ ...target(t.targetWeaponId, t.outcome, t.trials.map(trial => ({ candidateKey: trial.candidateKeySha256, result: trial.result, reason: trial.reason, generatedSelected: trial.generatedSelected })), t.searched),
      found: t.foundStableKeySha256 === null ? null : { stableKey: t.foundStableKeySha256, generatedSelected: true, trialPlan: {}, summary: {} } })))
    ;(same.record!.kernel as { plannerRerunsUsed: number }).plannerRerunsUsed = row.plannerRerunsUsed!
    expect(comparePhase2C26AOldCompletedSemantics(old, [same], value => unsha(sha(value)))).toEqual({ compared: 1, identical: 1, differing: [] })
    ;(same.record!.kernel as { plannerRerunsUsed: number }).plannerRerunsUsed = row.plannerRerunsUsed! + 1
    expect(comparePhase2C26AOldCompletedSemantics(old, [same], value => value).differing).toEqual([row.orientationId])
  })

  it('applies the pre-registered conclusion rule: OOM first, then timeout, then other failures', () => {
    expect(phase2c26aConclusion({ completed: 54, out_of_memory: 0, timeout: 0, process_failure: 0 }, 54, 43).case).toBe('all_completed')
    expect(phase2c26aConclusion({ completed: 54, out_of_memory: 0, timeout: 0, process_failure: 0 }, 54, 43).nextPhase).toMatch(/Phase 2-C2\.6-B/)
    expect(phase2c26aConclusion({ completed: 50, out_of_memory: 1, timeout: 3, process_failure: 0 }, 54, 43)).toMatchObject({ case: 'residual_out_of_memory' })
    expect(phase2c26aConclusion({ completed: 50, out_of_memory: 1, timeout: 3, process_failure: 0 }, 54, 43).nextPhase).toMatch(/residual localization/)
    expect(phase2c26aConclusion({ completed: 51, out_of_memory: 0, timeout: 3, process_failure: 0 }, 54, 43).case).toBe('timeout_without_out_of_memory')
    expect(phase2c26aConclusion({ completed: 53, out_of_memory: 0, timeout: 0, process_failure: 1 }, 54, 43).case).toBe('process_failure_only')
    expect(() => phase2c26aConclusion({ completed: 53, out_of_memory: 0, timeout: 0, process_failure: 0 }, 54, 43)).toThrow()
    for (const kase of [{ completed: 54, out_of_memory: 0, timeout: 0, process_failure: 0 }]) {
      const conclusion = phase2c26aConclusion(kase, 54, 43)
      expect(conclusion.statement).not.toMatch(/完全(に)?解決/)
      expect(conclusion.statement).toMatch(/旧Phase 2-C2で43件発生したkernel child OOM/)
      expect(conclusion.cannotSay.join('')).toMatch(/完全に解決/)
    }
    const timeout = phase2c26aConclusion({ completed: 45, out_of_memory: 0, timeout: 9, process_failure: 0 }, 54, 43)
    expect(timeout.statement).toMatch(/旧Phase 2-C2で43件発生したkernel child OOMはcurrent Productionでは再現しなかった.*timeoutが9件残った.*runtime bottleneck/)
    // Without a comparable Phase 2-C2 RESULT the statement makes no old-run claim.
    expect(phase2c26aConclusion({ completed: 45, out_of_memory: 0, timeout: 9, process_failure: 0 }, 54, null).statement).not.toMatch(/旧Phase 2-C2/)
  })
})

describe('comparability with Phase 2-C2 (post-hoc, fail closed)', () => {
  const oldEnvironment = (oldC2Result as unknown as { provenance: { environment: Record<string, unknown> } }).provenance.environment
  /** The complete synthetic series, carrying exactly the Phase 2-C2 Export, conditions and execution environment. */
  function comparableRun() {
    const raw = completeRun()
    Object.assign(raw.environment, { exportSha256: old.exportSha256, nodeYield: oldEnvironment.nodeYield })
    Object.assign(raw.baseline, { researchMaxPlanSteps: oldEnvironment.researchMaxPlanSteps, calculationContext: structuredClone(oldEnvironment.calculationContext) })
    return raw
  }
  type Run = ReturnType<typeof comparableRun>
  const check = (raw: unknown) => validatePhase2C26AOldC2Comparability(raw, old)
  const environmentOf = (raw: Run) => raw.environment as Record<string, unknown>

  it('A. accepts the same measurement: every condition matches', () => {
    const result = check(comparableRun())
    expect(result).toMatchObject({ valid: true, issues: [], searchConditionsMatch: true, executionConditionsMatch: true, currentTaskConditionsUniform: true })
    expect(result.exportSha256.matches).toBe(true)
    expect(result.baseline).toMatchObject({ matches: true, failedFields: [] })
    expect(result.orientations).toMatchObject({ matches: true, countMatches: true, orderedIdsMatch: true, identityMismatches: [], metadataMismatches: [],
      metadataMismatchCounts: { conflictKey: 0, fixedBuildListEntryId: 0, participantBuildListEntryIds: 0, participantTargetWeaponIds: 0 } })
    for (const field of ['extent', 'bounds', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'researchMaxPlanSteps', 'nodeYield', 'calculationContext'] as const) {
      expect(result[field].matches).toBe(true)
    }
    // The lineage is not recorded by Phase 2-C2: it is listed, never compared against a guessed value.
    expect(result.notMachineVerifiable.map(n => n.condition)).toEqual([expect.stringMatching(/lineage/)])
  })

  it('B. rejects another Export', () => {
    const raw = comparableRun(); environmentOf(raw).exportSha256 = '0'.repeat(64)
    expect(check(raw)).toMatchObject({ valid: false, exportSha256: { matches: false } })
    const missing = comparableRun(); delete environmentOf(missing).exportSha256
    expect(check(missing).valid).toBe(false)
  })

  it('C. rejects a different baseline', () => {
    const raw = comparableRun(); raw.baseline.record.summary = { ...raw.baseline.record.summary, planSteps: 1464 }
    expect(check(raw)).toMatchObject({ valid: false, baseline: { matches: false, failedFields: ['planSteps'] } })
  })

  it('D. rejects a missing orientation and a different order', () => {
    const missing = comparableRun(); missing.baseline.record.orientations.splice(3, 1)
    const result = check(missing)
    expect(result.valid).toBe(false)
    expect(result.orientations).toMatchObject({ countMatches: false, missingInCurrent: [old.orientations[3].orientationId] })
    const reordered = comparableRun(); const list = reordered.baseline.record.orientations; [list[0], list[1]] = [list[1], list[0]]
    expect(check(reordered)).toMatchObject({ valid: false, orientations: { orderedIdsMatch: false } })
  })

  it('E. rejects another fixed Entry', () => {
    const raw = comparableRun(); raw.baseline.record.orientations[0].fixedBuildListEntryId = 'build-list.other'
    expect(check(raw)).toMatchObject({ valid: false, orientations: { metadataMismatchCounts: { fixedBuildListEntryId: 1 } } })
  })

  it('F. rejects other participant Entries', () => {
    const raw = comparableRun(); const o = raw.baseline.record.orientations[1]
    o.participantBuildListEntryIds = [...o.participantBuildListEntryIds].reverse()
    expect(check(raw)).toMatchObject({ valid: false, orientations: { metadataMismatchCounts: { participantBuildListEntryIds: 1 } } })
  })

  it('G. rejects another Conflict key', () => {
    const raw = comparableRun(); raw.baseline.record.orientations[2].conflictKey = 'plan-conflict:other'
    expect(check(raw)).toMatchObject({ valid: false, orientations: { metadataMismatchCounts: { conflictKey: 1 } } })
  })

  it('H / I / J. rejects another extent, candidate trial bound or planner rerun bound', () => {
    const changes: ['extent' | 'bounds', (c: Phase2C2Conditions) => void][] = [
      ['extent', c => { c.extent.maxGogmaAdvance = 300 }],
      ['bounds', c => { c.bounds.maxCandidateTrialsPerTarget = 3 }],
      ['bounds', c => { c.bounds.maxPlannerReruns = 9 }],
    ]
    for (const [field, change] of changes) {
      // The whole run changed: the run conditions and every task carry the changed value.
      const raw = comparableRun(); change(raw.conditions); for (const kernel of raw.kernels) change(kernel.task.conditions)
      const result = check(raw)
      expect(result).toMatchObject({ valid: false, searchConditionsMatch: false, currentTaskConditionsUniform: true })
      expect(result[field].matches).toBe(false)
      // A single task differing from the run conditions is rejected too.
      const one = comparableRun(); change(one.kernels[0].task.conditions)
      expect(check(one)).toMatchObject({ valid: false, currentTaskConditionsUniform: false })
    }
  })

  it('K / L / M. rejects another heap, concurrency or orientation budget (and Research maxPlanSteps / yield)', () => {
    for (const [field, value] of [['childHeapLimitMb', 16384], ['concurrency', 1], ['orientationBudgetMs', 3_600_000]] as const) {
      const raw = comparableRun(); environmentOf(raw)[field] = value
      const result = check(raw)
      expect(result).toMatchObject({ valid: false, executionConditionsMatch: false })
      expect(result[field].matches).toBe(false)
    }
    const steps = comparableRun(); (steps.baseline as Record<string, unknown>).researchMaxPlanSteps = 1000
    expect(check(steps)).toMatchObject({ valid: false, executionConditionsMatch: false })
    const yieldChange = comparableRun(); environmentOf(yieldChange).nodeYield = 'setTimeout'
    expect(check(yieldChange)).toMatchObject({ valid: false, executionConditionsMatch: false })
  })

  it('N. produces no old comparison from an incomparable RESULT, and the analyzer gates on it before any transition', () => {
    const raw = comparableRun(); environmentOf(raw).concurrency = 1
    const invalid = check(raw)
    expect(() => comparePhase2C26AWithOldC2(invalid, old, raw.kernels, raw.baseline.record.orientations, value => value)).toThrow(/not comparable/)
    const valid = check(comparableRun())
    expect(comparePhase2C26AWithOldC2(valid, old, completeRun().kernels, old.orientations, value => value).transitions.oldOutOfMemory.total).toBe(43)
    const gate = analyzerSource.indexOf('if (!oldC2Comparability.valid && !allowNonformal) throw')
    expect(gate).toBeGreaterThan(0)
    expect(analyzerSource.indexOf('validatePhase2C26AFormalRun(')).toBeLessThan(analyzerSource.indexOf('validatePhase2C26AOldC2Comparability('))
    expect(analyzerSource.indexOf('validatePhase2C26AOldC2Comparability(')).toBeLessThan(gate)
    expect(gate).toBeLessThan(analyzerSource.indexOf('comparePhase2C26AWithOldC2('))
    expect(gate).toBeLessThan(analyzerSource.indexOf('writeFile('))
    // Old comparisons are reached only through the gated comparison, never directly.
    expect(analyzerSource).not.toMatch(/phase2c26aTransitions\(|comparePhase2C26AOldCompletedSemantics\(/)
    expect(analyzerSource).toMatch(/formal: formalRunValidation\.valid && comparable &&/)
  })
})

describe('isolation', () => {
  it('is never imported by Production and fixes no ID', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26A/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [c26aSource, analysisSource]) {
      expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
      expect(source).not.toMatch(/\b54\b|\b43\b/)
    }
  })

  it('runs kernel only and reads no earlier Phase result or oracle in the runner', () => {
    expect(runnerSource).not.toMatch(/PHASE2C2_RESULT|_RESULT\.json|ORACLE|1657|optimum|--old-c2|--c1/)
    expect(runnerSource).not.toMatch(/runPhase2C2PortfolioContext|visitPlannerAlternativeCandidates|phase2c2ProbeDecision|BENCHMARK_ONLY_EXTENT_GRID|captureBound/)
    expect(runnerSource).not.toMatch(/plannerGlobalPhase2C26AAnalysis/)
    expect(runnerSource).toMatch(/--smoke-orientations is a non-formal smoke option and needs --allow-uncommitted/)
    expect(analyzerSource).toMatch(/validatePhase2C26AFormalRun/)
    expect(analyzerSource).not.toMatch(/ORACLE_RESULT|--optimum|--c1|visitPlannerAlternativeCandidates|createProductionPlan/)
  })
})
