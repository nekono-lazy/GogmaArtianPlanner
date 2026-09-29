import { describe, expect, it } from 'vitest'
import c26aResult from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json'
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
import { createCountingRngEngine } from './plannerAlternativeBenchmarkInstrumentation'
import type { Phase2C2Conditions, Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { phase2c26aKernelTasks, runPhase2C26ABaseline, runPhase2C26AKernel } from './plannerGlobalPhase2C26A'
import {
  classifyPhase2C26A2Stage,
  createPhase2C26A2KernelProgress,
  parsePhase2C26AAuthority,
  phase2c26a2ResultClass,
  PHASE2C26A2_CHILD_HEAP_MB,
  PHASE2C26A2_CONCURRENCY,
  PHASE2C26A2_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A2_NODE_YIELD,
  PHASE2C26A2_ORIENTATION_BUDGET_MS,
  PHASE2C26A2_REGISTERED_AUTHORITY,
  runPhase2C26A2Kernel,
  selectPhase2C26A2Tasks,
  validatePhase2C26A2BaselineParity,
  validatePhase2C26A2ConditionParity,
  validatePhase2C26A2Selection,
  type Phase2C26A2Authority,
  type Phase2C26A2LifecycleRecord,
} from './plannerGlobalPhase2C26A2'
import a2Source from './plannerGlobalPhase2C26A2.ts?raw'
import {
  analyzePhase2C26A2Kernel,
  phase2c26a2NextCase,
  summarizePhase2C26A2,
  validatePhase2C26A2FormalRun,
  type Phase2C26A2OrientationAnalysis,
} from './plannerGlobalPhase2C26A2Analysis'
import analysisSource from './plannerGlobalPhase2C26A2Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26a2.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26a2.mjs?raw'

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.c26a2.a'
const ENTRY_B = 'build-list.c26a2.b'

/** A and B contend for Gogma 10; with A fixed, B has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.c26a2.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.c26a2.b', { priority: 1 })
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

function authority(): Phase2C26A2Authority {
  const parsed = parsePhase2C26AAuthority(structuredClone(c26aResult))
  if (!parsed.authority) throw new Error(parsed.issues.join('; '))
  return parsed.authority
}
const mutated = (change: (json: typeof c26aResult) => void) => {
  const json = structuredClone(c26aResult)
  change(json)
  return parsePhase2C26AAuthority(json)
}

// ---------------------------------------------------------------- conditions

describe('conditions', () => {
  it('keeps every Phase 2-C2.6-A run condition', () => {
    const a = authority()
    expect(PHASE2C26A2_CHILD_HEAP_MB).toBe(a.conditions.childHeapLimitMb)
    expect(PHASE2C26A2_CONCURRENCY).toBe(a.conditions.concurrency)
    expect(PHASE2C26A2_ORIENTATION_BUDGET_MS).toBe(a.conditions.orientationBudgetMs)
    expect(PHASE2C26A2_NODE_YIELD).toBe(a.conditions.nodeYield)
    expect(PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS).toBe(250)
    expect(PHASE2C26A2_HEARTBEAT_INTERVAL_MS).toBe(5000)
    expect(a.conditions.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(a.conditions.bounds).toEqual(defaultPlannerAlternativeTrialBounds)
  })

  it('changes no Production default, schema or version', () => {
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect(defaultPlannerAlternativeTrialBounds).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})

// ---------------------------------------------------------------- authority

describe('Phase 2-C2.6-A authority', () => {
  it('reads the committed RESULT as the registered authority and derives the timeout set from its rows', () => {
    const parsed = parsePhase2C26AAuthority(structuredClone(c26aResult))
    expect(parsed.issues).toEqual([])
    const a = parsed.authority!
    expect(a.orientations).toHaveLength(PHASE2C26A2_REGISTERED_AUTHORITY.orientations)
    expect(a.timeoutOrientationIds).toHaveLength(PHASE2C26A2_REGISTERED_AUTHORITY.childStatus.timeout)
    expect(a.timeoutOrientationIds).toEqual(c26aResult.perOrientation.filter(row => row.child.outcome === 'timeout').map(row => row.orientationId))
    for (const id of a.timeoutOrientationIds) expect(a.outcomeById.get(id)).toBe('timeout')
    // Orientation order is the RESULT's.
    expect(a.timeoutOrientationIds).toEqual(a.orientations.map(o => o.orientationId).filter(id => a.timeoutOrientationIds.includes(id)))
    expect(a.conditions.exportSha256).toBe(c26aResult.provenance.exportSha256)
  })

  it('fails closed on anything but the registered formal result', () => {
    expect(mutated(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutated(json => { json.formalRunValidation.valid = false }).valid).toBe(false)
    expect(mutated(json => { json.oldC2Comparability.valid = false }).valid).toBe(false)
    expect(mutated(json => { json.kernel.childStatus.timeout = 8 }).valid).toBe(false)
    expect(mutated(json => { json.kernel.childStatus.out_of_memory = 1 }).valid).toBe(false)
    expect(mutated(json => { json.conclusion.case = 'all_completed' }).valid).toBe(false)
    // A row's outcome disagreeing with the counts, a duplicate row, a missing row, a row whose metadata differs.
    expect(mutated(json => { json.perOrientation.find(row => row.child.outcome === 'timeout')!.child.outcome = 'completed' }).valid).toBe(false)
    expect(mutated(json => { json.perOrientation.push(json.perOrientation[0]) }).valid).toBe(false)
    expect(mutated(json => { json.perOrientation.pop() }).valid).toBe(false)
    expect(mutated(json => { json.perOrientation[0].conflictKey = 'plan-conflict:other' }).valid).toBe(false)
    expect(mutated(json => { Reflect.deleteProperty(json.conditions, 'lineage') }).valid).toBe(false)
    expect(parsePhase2C26AAuthority(null).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- parity and selection

describe('baseline and condition parity', () => {
  it('accepts the recorded baseline and orientations and refuses any difference', () => {
    const a = authority()
    expect(validatePhase2C26A2BaselineParity(a.baseline, a.orientations, a).valid).toBe(true)
    const reordered = [...a.orientations].reverse()
    const byOrder = validatePhase2C26A2BaselineParity(a.baseline, reordered, a)
    expect(byOrder.valid).toBe(false)
    expect(byOrder.orderedIdsMatch).toBe(false)
    const timeoutId = a.timeoutOrientationIds[0]
    const changed = a.orientations.map(o => (o.orientationId === timeoutId ? { ...o, participantBuildListEntryIds: [...o.participantBuildListEntryIds].reverse() } : o))
    const byMetadata = validatePhase2C26A2BaselineParity(a.baseline, changed, a)
    expect(byMetadata.valid).toBe(false)
    expect(byMetadata.timeoutOrientationMismatches.map(m => m.orientationId)).toEqual([timeoutId])
    expect(validatePhase2C26A2BaselineParity({ ...a.baseline, planSteps: (a.baseline.planSteps ?? 0) + 1 }, a.orientations, a).valid).toBe(false)
    expect(validatePhase2C26A2BaselineParity(a.baseline, a.orientations.slice(1), a).valid).toBe(false)
  })

  it('accepts the recorded run conditions and refuses a lengthened, shortened or relaxed one', () => {
    const a = authority()
    const current = structuredClone(a.conditions)
    expect(validatePhase2C26A2ConditionParity(current, a)).toMatchObject({ valid: true, issues: [] })
    for (const [key, value] of Object.entries({
      orientationBudgetMs: 60 * 60 * 1000, childHeapLimitMb: 16384, concurrency: 1, researchMaxPlanSteps: 1000, nodeYield: 'setTimeout', exportSha256: '0'.repeat(64),
      extent: { maxNormalAdvance: 4, maxGogmaAdvance: 100, maxSkillAdvance: 4 }, bounds: { maxCandidateTrialsPerTarget: 3, maxPlannerReruns: 8 },
      calculationContext: { ...(current.calculationContext as object), appSchemaVersion: 16 }, lineage: { priorFixedBuildListEntryIds: ['x'], priorExcludedRoutes: [] },
    })) {
      const check = validatePhase2C26A2ConditionParity({ ...current, [key]: value }, a)
      expect(check.valid, key).toBe(false)
      expect(check.issues).toEqual([`${key} differs`])
    }
  })
})

describe('targeted selection', () => {
  const tasksOf = (orientations: readonly Phase2C2Orientation[]) => phase2c26aKernelTasks(orientations)

  it('selects exactly the timeout orientations from the current baseline, in its order', () => {
    const a = authority()
    const selected = selectPhase2C26A2Tasks(tasksOf(a.orientations), a)
    expect(selected.map(task => task.orientation.orientationId)).toEqual(a.timeoutOrientationIds)
    expect(validatePhase2C26A2Selection(selected.map(task => task.orientation), a)).toMatchObject({ valid: true, expected: a.timeoutOrientationIds.length, actual: a.timeoutOrientationIds.length })
  })

  it('refuses a missing, duplicate, foreign, completed or changed orientation', () => {
    const a = authority()
    const selected = selectPhase2C26A2Tasks(tasksOf(a.orientations), a).map(task => task.orientation)
    const completed = a.orientations.find(o => a.outcomeById.get(o.orientationId) === 'completed')!
    const subset = validatePhase2C26A2Selection(selected.slice(1), a)
    expect(subset).toMatchObject({ valid: false, missing: [selected[0].orientationId] })
    expect(validatePhase2C26A2Selection([...selected, selected[0]], a)).toMatchObject({ valid: false, duplicate: [selected[0].orientationId] })
    expect(validatePhase2C26A2Selection([...selected, { ...selected[0], orientationId: 'c99-p0' }], a)).toMatchObject({ valid: false, foreign: ['c99-p0'] })
    expect(validatePhase2C26A2Selection([...selected, completed], a)).toMatchObject({ valid: false, nonTimeout: [completed.orientationId] })
    const changed = validatePhase2C26A2Selection(selected.map((o, i) => (i === 0 ? { ...o, conflictKey: 'plan-conflict:other' } : o)), a)
    expect(changed.valid).toBe(false)
    expect(changed.metadataMismatches).toEqual([{ orientationId: selected[0].orientationId, fields: ['conflictKey'] }])
  })
})

// ---------------------------------------------------------------- stages

describe('stage classification', () => {
  it('reads the stage from the last lifecycle event only', () => {
    expect(classifyPhase2C26A2Stage(null)).toBe('kernel_preparation')
    for (const type of ['search_started', 'candidate_delivered', 'trial_completed']) expect(classifyPhase2C26A2Stage(type)).toBe('search_running')
    for (const type of ['trial_started', 'preflight_started', 'preflight_completed']) expect(classifyPhase2C26A2Stage(type)).toBe('trial_preflight')
    expect(classifyPhase2C26A2Stage('full_planner_run_started')).toBe('full_planner_run')
    expect(classifyPhase2C26A2Stage('full_planner_run_completed')).toBe('trial_postprocessing')
    for (const type of ['target_started', 'target_skipped_checkpoint', 'target_stopped_rerun_bound', 'search_completed', 'target_completed']) {
      expect(classifyPhase2C26A2Stage(type)).toBe('between_targets')
    }
    expect(classifyPhase2C26A2Stage('kernel_completed')).toBe('after_kernel')
    expect(classifyPhase2C26A2Stage('something_else')).toBe('unknown')
  })

  it('classifies results without reading a timeout as a completion', () => {
    expect(phase2c26a2ResultClass('completed', 'after_kernel')).toBe('completed')
    expect(phase2c26a2ResultClass('timeout', 'search_running')).toBe('timeout_in_search')
    expect(phase2c26a2ResultClass('timeout', 'trial_preflight')).toBe('timeout_in_preflight')
    expect(phase2c26a2ResultClass('timeout', 'full_planner_run')).toBe('timeout_in_full_planner_run')
    for (const stage of ['between_targets', 'trial_postprocessing', 'kernel_preparation', 'after_kernel', 'unknown'] as const) {
      expect(phase2c26a2ResultClass('timeout', stage)).toBe('timeout_elsewhere')
    }
    expect(phase2c26a2ResultClass('out_of_memory', 'search_running')).toBe('out_of_memory')
    expect(phase2c26a2ResultClass('process_failure', 'search_running')).toBe('process_failure')
  })
})

// ---------------------------------------------------------------- child progress on a real kernel

async function profiledRun() {
  const built = scenario()
  const baseline = await runPhase2C26ABaseline(built.input, { createEngine: () => built.engine, now: () => 0 })
  const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
  let clock = 0
  const counting = createCountingRngEngine(built.engine)
  const records: Phase2C26A2LifecycleRecord[] = []
  const progress = createPhase2C26A2KernelProgress({ now: () => (clock += 1), predictionCounts: () => counting.counts(), emit: record => records.push(record) })
  progress.start()
  const record = await runPhase2C26A2Kernel(built.input, { orientation, conditions: SMALL }, { createEngine: () => counting.engine, now: () => 0 }, progress.instrumentation)
  return { built, orientation, record, records, heartbeat: progress.heartbeat(), counting }
}

describe('in-child progress', () => {
  it('leaves the kernel record identical to the uninstrumented kernel', async () => {
    const { built, orientation, record } = await profiledRun()
    const plain = await runPhase2C26AKernel(scenario().input, { orientation, conditions: SMALL }, { createEngine: () => scenario().engine, now: () => 0 })
    expect(stableStringify(record)).toBe(stableStringify(plain))
    expect(built.input).toBeDefined()
  })

  it('emits one record per lifecycle event, in order, with Research time, counts and the Target Search snapshot', async () => {
    const { records, heartbeat, counting } = await profiledRun()
    expect(records.map(r => r.seq)).toEqual(records.map((_, index) => index + 1))
    expect(records.map(r => r.event.type)).toEqual([
      'target_started', 'search_started', 'candidate_delivered', 'trial_started', 'preflight_started', 'preflight_completed',
      'full_planner_run_started', 'full_planner_run_completed', 'trial_completed', 'search_completed', 'target_completed', 'kernel_completed',
    ])
    for (let index = 1; index < records.length; index += 1) expect(records[index].elapsedMs).toBeGreaterThan(records[index - 1].elapsedMs)
    const searchDone = records.find(r => r.event.type === 'search_completed')!
    expect(searchDone.search?.settledWorkItems).toBeGreaterThan(0)
    expect(searchDone.searchDepths).not.toBeNull()
    expect(records.filter(r => r.searchDepths !== null)).toHaveLength(1)
    expect(records.at(-1)?.predictionCounts).toEqual(counting.counts())
    // The heartbeat keeps the last event.
    expect(heartbeat).toMatchObject({ lastEventSeq: records.length, lastEventType: 'kernel_completed', stage: 'after_kernel',
      counters: { startedTargets: 1, completedTargets: 1, deliveredCandidates: 1, trialsStarted: 1, trialsCompleted: 1, fullPlannerRunsStarted: 1, fullPlannerRunsCompleted: 1 },
      rerunBudget: { used: 1, limit: 8 } })
    expect(heartbeat.searches).toHaveLength(1)
  })

  it('keeps the last event and the in-progress Search in a heartbeat taken mid-kernel', async () => {
    const built = scenario()
    const baseline = await runPhase2C26ABaseline(built.input, { createEngine: () => built.engine, now: () => 0 })
    const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
    let clock = 0
    const beats: ReturnType<ReturnType<typeof createPhase2C26A2KernelProgress>['heartbeat']>[] = []
    const counting = createCountingRngEngine(built.engine)
    const progress: ReturnType<typeof createPhase2C26A2KernelProgress> = createPhase2C26A2KernelProgress({ now: () => (clock += 1), predictionCounts: () => counting.counts(),
      emit: record => { if (record.event.type === 'full_planner_run_started') beats.push(progress.heartbeat()) } })
    progress.start()
    await runPhase2C26A2Kernel(built.input, { orientation, conditions: SMALL }, { createEngine: () => counting.engine, now: () => 0 }, progress.instrumentation)
    expect(beats).toHaveLength(1)
    expect(beats[0]).toMatchObject({ lastEventType: 'full_planner_run_started', stage: 'full_planner_run', activeTarget: { targetOrdinal: 0, targetCount: 1 },
      counters: { fullPlannerRunsStarted: 1, fullPlannerRunsCompleted: 0 } })
    expect(beats[0].activeSearchDepths).not.toBeNull()
  })
})

// ---------------------------------------------------------------- post-hoc analysis of killed streams

const sha = (value: string) => `hash-of-${value.length}-chars`
let seqCounter = 0
function lifecycle(elapsedMs: number, event: Record<string, unknown>, counts = { predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }, search: unknown = null) {
  seqCounter += 1
  return { kind: 'lifecycle', seq: seqCounter, elapsedMs, event, predictionCounts: counts, search, searchDepths: null }
}
const budget = (used: number) => ({ used, limit: 8 })
const target = (ordinal: number, extra: Record<string, unknown> = {}) => ({ targetWeaponId: `t${ordinal}`, targetOrdinal: ordinal, targetCount: 2, budget: budget(0), ...extra })
const snap = (settled: number) => ({ settledWorkItems: settled, skill: { streams: 1, maxDepth: 2, totalStates: 3, totalTransitions: 4 }, gogma: { streams: 2, maxDepth: 9, totalGeneratedStates: 50, totalFrontierStates: 40 } })
const ORIENTATION = { orientationId: 'x1-p0', conflictIndex: 1, conflictKey: 'k', kind: 'same_skill_counter', participantBuildListEntryIds: ['e0', 'e1', 'e2'],
  participantTargetWeaponIds: ['fixed', 't0', 't1'], fixedBuildListEntryId: 'e0', fixedTargetWeaponId: 'fixed' }

function killedKernel(events: unknown[], heartbeat: Record<string, unknown> | null, outcome = 'timeout') {
  return { orientationId: ORIENTATION.orientationId, task: { orientation: ORIENTATION, conditions: SMALL }, process: { outcome, lastHeartbeatAgeAtEndMs: 1200, ipc: { kernelInvoked: { childProcessMs: 900 } } },
    events, heartbeats: heartbeat ? [heartbeat] : [], memory: null, yields: null }
}

describe('post-hoc analysis', () => {
  it('attributes a timeout to the full Planner run it was killed in, with the per-Target timeline', () => {
    seqCounter = 0
    const events = [
      lifecycle(100, { type: 'target_started', ...target(0) }),
      lifecycle(101, { type: 'search_started', ...target(0) }),
      lifecycle(1000, { type: 'search_completed', ...target(0), deliveredCandidates: 0, exhausted: false, stoppedByExtent: true, stoppedByConsumer: false }, undefined, snap(10)),
      lifecycle(1001, { type: 'target_completed', ...target(0), outcome: 'stopped_by_search_extent_bound' }),
      lifecycle(1002, { type: 'target_started', ...target(1) }),
      lifecycle(1003, { type: 'search_started', ...target(1) }),
      lifecycle(3000, { type: 'candidate_delivered', ...target(1), deliveryIndex: 0, candidateKey: 'raw-key' }),
      lifecycle(3000, { type: 'trial_started', ...target(1), trialIndex: 0, candidateKey: 'raw-key' }),
      lifecycle(3010, { type: 'preflight_started', ...target(1), trialIndex: 0, candidateKey: 'raw-key' }),
      lifecycle(3500, { type: 'preflight_completed', ...target(1), trialIndex: 0, candidateKey: 'raw-key', status: 'ready' }),
      lifecycle(3501, { type: 'full_planner_run_started', ...target(1), trialIndex: 0, candidateKey: 'raw-key' }, { predictNormalArtian: 0, predictSkills: 5, resetBonuses: 0, keepBonuses: 0 }),
    ]
    const heartbeat = { kind: 'heartbeat', elapsedMs: 9000, predictionCounts: { predictNormalArtian: 0, predictSkills: 905, resetBonuses: 0, keepBonuses: 0 },
      activeTarget: { targetWeaponId: 't1', targetOrdinal: 1, targetCount: 2, startedMs: 1002 }, searches: [], rerunBudget: budget(0), memory: { maxima: { maxHeapUsedBytes: 7, maxRssBytes: 9 } }, yields: 42 }
    const row = analyzePhase2C26A2Kernel(killedKernel(events, heartbeat), sha)
    expect(row).toMatchObject({ resultClass: 'timeout_in_full_planner_run', lastStage: 'full_planner_run_started', stageAtEnd: 'full_planner_run',
      activeTargetOrdinal: 1, activeTargetWeaponId: 't1', elapsedInKernelObservedMs: 9000, elapsedInCurrentStageMs: 9000 - 3501, elapsedInCurrentTargetMs: 9000 - 1002,
      lastHeartbeatAgeAtEndMs: 1200, kernelStartedAtChildProcessMs: 900, dominantStage: 'full_planner_run', yields: 42,
      memory: { source: 'last_heartbeat', sampledMaxHeapUsedBytes: 7, sampledMaxRssBytes: 9 } })
    expect(row.counters).toEqual({ startedTargets: 2, completedTargets: 1, deliveredCandidates: 1, trialsStarted: 1, trialsCompleted: 0, fullPlannerRunsStarted: 1, fullPlannerRunsCompleted: 0 })
    expect(row.stageTimeMs.full_planner_run).toBe(9000 - 3501)
    expect(row.stageTimeMs.search_running).toBe((1000 - 101) + (3000 - 1003))
    expect(row.stageTimeMs.trial_preflight).toBe(3501 - 3000)
    expect(row.stagePredictionCounts.full_planner_run.predictSkills).toBe(900)
    expect(row.targets.map(t => [t.targetOrdinal, t.state, t.searchOwnMs])).toEqual([[0, 'completed', 899], [1, 'active_at_end', (9000 - 1003) - (9000 - 3000)]])
    expect(row.targets[1].trials[0]).toMatchObject({ candidateKeySha256: 'hash-of-7-chars', preflight: { status: 'ready' }, fullRun: { endMs: null, rerunOrdinal: 1 } })
    expect(row.fullPlannerRuns).toEqual([{ targetOrdinal: 1, trialIndex: 0, rerunOrdinal: 1, durationMs: null, completed: false }])
    expect(JSON.stringify(row)).not.toContain('raw-key')
  })

  it('attributes a Search timeout to the Search, keeps the heartbeat Search snapshot and lists unreached Targets', () => {
    seqCounter = 0
    const events = [
      lifecycle(50, { type: 'target_started', ...target(0) }),
      lifecycle(51, { type: 'search_started', ...target(0) }),
    ]
    const heartbeat = { kind: 'heartbeat', elapsedMs: 1_790_000, predictionCounts: { predictNormalArtian: 1, predictSkills: 2, resetBonuses: 3, keepBonuses: 4 },
      activeTarget: { targetWeaponId: 't0', targetOrdinal: 0, targetCount: 2, startedMs: 50 }, searches: [{ targetWeaponId: 't0', targetOrdinal: 0, snapshot: snap(777) }],
      activeSearchDepths: { skill: [], gogma: [[1, 2, 3, 4, 5]] }, rerunBudget: budget(0) }
    const row = analyzePhase2C26A2Kernel(killedKernel(events, heartbeat), sha)
    expect(row).toMatchObject({ resultClass: 'timeout_in_search', activeTargetOrdinal: 0, dominantStage: 'search_running' })
    expect(row.targets[0].search?.settledWorkItems).toBe(777)
    expect(row.targets[0].searchDepths).toEqual({ skill: [], gogma: [[1, 2, 3, 4, 5]] })
    expect(row.targets[1]).toMatchObject({ targetOrdinal: 1, state: 'not_started', targetWeaponId: '' })
    expect(row.predictionCounts).toEqual({ predictNormalArtian: 1, predictSkills: 2, resetBonuses: 3, keepBonuses: 4 })
  })

  it('reads a timeout before any event as the kernel preparation (elsewhere)', () => {
    const row = analyzePhase2C26A2Kernel(killedKernel([], { kind: 'heartbeat', elapsedMs: 100, predictionCounts: {}, searches: [] }), sha)
    expect(row).toMatchObject({ resultClass: 'timeout_elsewhere', stageAtEnd: 'kernel_preparation', lastStage: null })
  })

  it('picks the next phase by the pre-registered rule', () => {
    const row = (childOutcome: string, dominantStage: Phase2C26A2OrientationAnalysis['dominantStage'], searchOwn: number[] = [1]) =>
      ({ childOutcome, dominantStage, targets: searchOwn.map(ms => ({ searchOwnMs: ms })) }) as unknown as Phase2C26A2OrientationAnalysis
    expect(phase2c26a2NextCase([row('completed', 'after_kernel'), row('completed', 'after_kernel'), row('timeout', 'search_running')]).case).toBe('D_many_completed_suspect_variance')
    expect(phase2c26a2NextCase([row('timeout', 'full_planner_run'), row('timeout', 'full_planner_run'), row('timeout', 'search_running')]).case).toBe('B_full_planner_rerun')
    expect(phase2c26a2NextCase([row('timeout', 'search_running', [100]), row('timeout', 'search_running', [90, 10]), row('timeout', 'full_planner_run')]).case).toBe('A_search_runtime')
    expect(phase2c26a2NextCase([row('timeout', 'search_running', [40, 40, 20]), row('timeout', 'search_running', [30, 30, 40]), row('timeout', 'full_planner_run')]).case).toBe('C_serial_target_search_accumulation')
    expect(phase2c26a2NextCase([row('timeout', 'search_running'), row('timeout', 'full_planner_run'), row('timeout', 'trial_preflight'), row('timeout', 'between_targets')]).case).toBe('mixed')
  })

  it('summarizes result classes by kind', () => {
    seqCounter = 0
    const rows = [analyzePhase2C26A2Kernel(killedKernel([lifecycle(1, { type: 'target_started', ...target(0) }), lifecycle(2, { type: 'search_started', ...target(0) })],
      { kind: 'heartbeat', elapsedMs: 10, predictionCounts: {}, searches: [] }), sha)]
    const summary = summarizePhase2C26A2(rows)
    expect(summary.resultClass.timeout_in_search).toBe(1)
    expect(summary.resultClassByKind).toEqual({ same_skill_counter: expect.objectContaining({ timeout_in_search: 1, completed: 0 }) })
  })
})

// ---------------------------------------------------------------- formal validation

function formalRaw(a: Phase2C26A2Authority) {
  seqCounter = 0
  const kernels = a.timeoutOrientationIds.map(id => {
    const orientation = a.orientations.find(o => o.orientationId === id)!
    return { orientationId: id, task: { orientation, conditions: { extent: a.conditions.extent, bounds: a.conditions.bounds, captureBound: 8 } },
      process: { outcome: 'timeout' }, events: [{ ...lifecycle(1, { type: 'target_started' }), seq: 1 }], heartbeats: [{ kind: 'heartbeat', elapsedMs: 5 }] }
  })
  return {
    status: 'completed',
    environment: { smoke: null, uncommittedBenchmarkCode: false, c26aResultSha256: 'auth-sha', exportSha256: a.conditions.exportSha256, childHeapLimitMb: a.conditions.childHeapLimitMb,
      concurrency: a.conditions.concurrency, orientationBudgetMs: a.conditions.orientationBudgetMs, nodeYield: a.conditions.nodeYield, heartbeatIntervalMs: 5000 },
    currentConditions: structuredClone(a.conditions),
    baseline: { summary: a.baseline, orientations: a.orientations },
    kernels,
  }
}

describe('formal series validation', () => {
  it('accepts exactly the timeout set against the same authority, and refuses every other run', () => {
    const a = authority()
    expect(validatePhase2C26A2FormalRun(formalRaw(a), a, 'auth-sha')).toMatchObject({ valid: true, failures: [] })
    const refused = (change: (raw: ReturnType<typeof formalRaw>) => void) => {
      const raw = formalRaw(a)
      change(raw)
      return validatePhase2C26A2FormalRun(raw, a, 'auth-sha').valid
    }
    expect(refused(raw => { raw.environment.smoke = { orientationIds: [] } as never })).toBe(false)
    expect(refused(raw => { raw.environment.uncommittedBenchmarkCode = true })).toBe(false)
    expect(refused(raw => { raw.environment.c26aResultSha256 = 'other' })).toBe(false)
    expect(refused(raw => { raw.kernels.pop() })).toBe(false)
    expect(refused(raw => { raw.kernels.push(raw.kernels[0]) })).toBe(false)
    expect(refused(raw => { raw.currentConditions.orientationBudgetMs = 3_600_000 })).toBe(false)
    expect(refused(raw => { raw.environment.concurrency = 1 })).toBe(false)
    expect(refused(raw => { raw.kernels[0].task.conditions.extent = { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 } as never })).toBe(false)
    expect(refused(raw => { raw.kernels[0].events = [] })).toBe(false)
    expect(refused(raw => { raw.kernels[0].events[0].seq = 2 })).toBe(false)
    expect(refused(raw => { raw.kernels[0].heartbeats = [] })).toBe(false)
    expect(refused(raw => { raw.kernels[0].process.outcome = 'completed' })).toBe(false)
    expect(refused(raw => { raw.baseline.orientations = [...raw.baseline.orientations].reverse() })).toBe(false)
    expect(refused(raw => { raw.status = 'parity_failed' })).toBe(false)
  })
})

// ---------------------------------------------------------------- isolation

describe('isolation', () => {
  it('is never imported by Production and fixes no orientation, Target, Entry or Conflict ID', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26A2/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [a2Source, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    for (const source of [a2Source, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('selects from the authority, runs each task once, and runs no portfolio, probe or oracle', () => {
    expect(runnerSource).toMatch(/parsePhase2C26AAuthority/)
    expect(runnerSource).toMatch(/selectPhase2C26A2Tasks/)
    expect(runnerSource).toMatch(/validatePhase2C26A2BaselineParity/)
    expect(runnerSource).toMatch(/validatePhase2C26A2ConditionParity/)
    expect(runnerSource).toMatch(/validatePhase2C26A2Selection/)
    expect(runnerSource).toMatch(/appendFileSync/)
    expect(runnerSource).toMatch(/once each \(no retry\)/)
    expect(runnerSource).not.toMatch(/ORACLE|1657|runPhase2C2PortfolioContext|visitPlannerAlternativeCandidates|phase2c2ProbeDecision|captureBound/)
    // The authority is never a calculation input: the tasks come from the current baseline's own orientations.
    expect(runnerSource).toMatch(/phase2c26aKernelTasks\(baseline\.orientations\)/)
    expect(runnerSource).not.toMatch(/phase2c26aKernelTasks\(authority/)
    expect(analyzerSource).toMatch(/validatePhase2C26A2FormalRun/)
    expect(analyzerSource).not.toMatch(/visitPlannerAlternativeCandidates|createProductionPlan|runPhase2C2Kernel/)
  })
})
