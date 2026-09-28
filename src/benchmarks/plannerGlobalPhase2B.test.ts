import { describe, expect, it } from 'vitest'
import type { PlanStep, ProductionPlan } from '../domain/models/publicTypes'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { createPlannerGlobalBenchmarkController } from '../workers/plannerGlobal.worker.benchmark'
import type { PlannerGlobalBenchmarkResponse, PlannerGlobalRunRequest, PlannerGlobalWorkerResult } from './plannerGlobalBrowserBenchmarkProtocol'
import { validatePlannerGlobalRunRequest } from './plannerGlobalBrowserBenchmarkProtocol'
import { phase2bRecordOf, PHASE2B_WORKLOADS } from './plannerGlobalBrowserBenchmarkRunner'
import { plannerGlobalBrowserRealFixture } from './plannerGlobalBrowserTestFixture'
import { GlobalRawBlockResearch } from './plannerGlobalRawBlocks'
import { analyzePhase2BGap, parseOptimumEvidence, type Phase2BOptimumEvidence } from './plannerGlobalPhase2BGapAnalysis'
import { summarizePlanPhysical, type Phase2BAutonomousPlanEvidence, type Phase2BRouteSummary } from './plannerGlobalPhase2BPlan'
import { attributeHeapSamples, finalCallTailSyncMs, medianOf, summarizePlannerCallsByKind } from './plannerGlobalPhase2BPerformance'
import { attributePingDelays, phase2bCallPhaseDurations, phase2bIntervals, Phase2BPlannerTimeline } from './plannerGlobalPhase2BTimeline'

/* Issue #154 Phase 2-B: Research-only decomposition. No Production behaviour, default, schema or version changes. */

function runRequest(input: PlannerInput, phase2b: PlannerGlobalRunRequest['phase2b']): PlannerGlobalRunRequest {
  return { type: 'pg2a_benchmark_run', requestId: 'r1', input, mode: 'control', fallbackAxis: null, rawCache: 'per-search', yieldMode: 'timer',
    maxPlanSteps: input.options.maxPlanSteps, fallbackBudgetMs: null, fallbackMaxEpisodes: null, attemptBudgetMs: null, attemptState: null,
    measurement: 'timing', profiler: false, ...(phase2b ? { phase2b } : {}) }
}
async function runController(input: PlannerInput, phase2b: PlannerGlobalRunRequest['phase2b']): Promise<PlannerGlobalWorkerResult> {
  const messages: PlannerGlobalBenchmarkResponse[] = []
  const controller = createPlannerGlobalBenchmarkController(m => messages.push(structuredClone(m)), {
    createEngine: () => new ProductionRngEngine(), createRawBlocks: mode => new GlobalRawBlockResearch(mode), yieldFor: () => async () => undefined,
  })
  await controller.handleMessage(runRequest(input, phase2b))
  const found = messages.find(m => m.type === 'pg2a_benchmark_result')
  if (!found || found.type !== 'pg2a_benchmark_result') throw new Error(JSON.stringify(messages.filter(m => m.type === 'pg2a_benchmark_error')))
  return found.result
}

describe('Phase 2-B timeline recorder', () => {
  it('forwards shouldCancel / yieldControl unchanged and keeps an absent hook absent', async () => {
    let clock = 0
    const timeline = new Phase2BPlannerTimeline({ nowMs: () => clock })
    const call = timeline.begin('final')
    let yielded = 0
    const wrapped = call.wrapExecution({ shouldCancel: () => true, yieldControl: async () => { yielded += 1 } })
    call.beforePlannerRun()
    clock = 5
    expect(wrapped.shouldCancel?.()).toBe(true)
    clock = 9
    await wrapped.yieldControl?.()
    clock = 20
    expect(wrapped.shouldCancel?.()).toBe(true)
    clock = 30
    call.afterPlannerRun()
    call.onPlanGenerationPhase('trace_replay'); clock = 40
    call.onPlanGenerationPhase('post_processing'); call.onPlanGenerationPhase('execution_projection'); clock = 70
    call.onPlanGenerationPhase('completed'); call.end()
    expect(yielded).toBe(1)
    expect(call.wrapExecution({})).toEqual({})
    expect('yieldControl' in call.wrapExecution({ shouldCancel: () => false })).toBe(false)
    const [recorded] = timeline.calls
    expect(recorded.schedulerRuns).toEqual([{ checks: 2, firstCheckAtMs: 5, lastCheckAtMs: 20, yields: 1, maxSyncSegmentMs: 21, maxSyncSegmentStartAtMs: 9, lastSegmentStartAtMs: 9 }])
    const durations = phase2bCallPhaseDurations(recorded)
    expect(durations).toMatchObject({ scheduler_prepare: 5, scheduler_loop: 15, scheduler_finish: 10, trace_replay: 10, execution_projection: 30 })
    expect(Object.values(durations).reduce((a, b) => a + b, 0)).toBe(70)
    expect(finalCallTailSyncMs(recorded)).toEqual({ fromMs: 9, toMs: 70, durationMs: 61 })
    expect(summarizePlannerCallsByKind(timeline.calls).find(k => k.kind === 'final')).toMatchObject({ calls: 1, elapsedMs: 70, maxSchedulerSyncSegmentMs: 21, schedulerLoopIterations: 2 })
  })

  it('attributes slow pings and heap samples to the intervals they overlap, without inventing coverage', () => {
    const intervals = [{ name: 'a', startMs: 0, endMs: 10 }, { name: 'b', startMs: 10, endMs: 30 }]
    const attributed = attributePingDelays([{ sentAtMs: 5, receivedAtMs: 40 }, { sentAtMs: 1, receivedAtMs: 2 }, { sentAtMs: 3, receivedAtMs: null }], intervals, 5)
    expect(attributed).toEqual([{ sentAtMs: 5, rttMs: 35, overlapMs: { a: 5, b: 20, unattributed: 10 } }])
    const heap = attributeHeapSamples([{ atMs: 0, usedBytes: 1 }, { atMs: 12, usedBytes: 9 }, { atMs: 31, usedBytes: 4 }], intervals)
    expect(heap[1]).toEqual({ name: 'b', durationMs: 20, samples: 1, beforeBytes: 1, afterBytes: 4, maxInsideBytes: 9, deltaBytes: 3 })
    expect(medianOf([3, 1, 2])).toBe(2)
    expect(medianOf([])).toBeNull()
  })
})

describe('Phase 2-B observation leaves the Research result unchanged', () => {
  it('produces the same semantic evidence with and without the timeline and Plan evidence', async () => {
    const input = await plannerGlobalBrowserRealFixture()
    const plain = await runController(structuredClone(input), undefined)
    const observed = await runController(structuredClone(input), { timeline: true, planEvidence: true })
    expect(plain.phase2b).toBeUndefined()
    expect(observed.semanticSha256).toBe(plain.semanticSha256)
    expect(observed.evidence).toEqual(plain.evidence)
    expect(observed.semantic).toEqual(plain.semantic)
    const phase2b = observed.phase2b!
    // Every full Planner call of the run is in the timeline, and the call phases cover the Research's own Planner time.
    expect(phase2b.timeline!.length).toBe(observed.report.plannerFullRunCount)
    expect(phase2b.timeline!.map(c => c.kind)).toEqual(expect.arrayContaining(['baseline', 'retained_prefix', 'final']))
    const plan = phase2b.autonomousPlan!
    expect(plan.physical.identityHolds).toBe(true)
    expect(plan.physical.physicalOperations).toBe(observed.report.final!.steps - Object.values(plan.physical.nonPhysicalSteps).reduce((a, b) => a + b, 0))
    expect(plan.routes.map(r => r.targetWeaponId).sort()).toEqual(input.targetWeapons.map(t => t.id).sort())
    expect(phase2bIntervals(phase2b.timeline!).length).toBeGreaterThan(0)
    expect(phase2b.heapProbe).toBeNull()
  })

  it('validates the optional Phase 2-B request field and keeps the Phase 2-A request valid without it', async () => {
    const input = await plannerGlobalBrowserRealFixture()
    expect(validatePlannerGlobalRunRequest(runRequest(input, undefined))).toEqual([])
    expect(validatePlannerGlobalRunRequest(runRequest(input, { timeline: true, planEvidence: false }))).toEqual([])
    expect(validatePlannerGlobalRunRequest({ ...runRequest(input, undefined), phase2b: { timeline: 'yes' } as never })).toHaveLength(1)
    expect(PHASE2B_WORKLOADS.timing()).toMatchObject({ mode: 'fallback', fallbackAxis: 'normal', phase2b: { timeline: true, planEvidence: true } })
    expect(PHASE2B_WORKLOADS.timing().memory).toBeUndefined()
    expect(PHASE2B_WORKLOADS.memory().memory?.intervalMs).toBeGreaterThan(24 * 3600 * 1000)
    expect(phase2bRecordOf(null, null, null)).toEqual({ acceptedClockCheckMs: null, ping: null })
  })
})

function step(order: number, operationType: PlanStep['operationType'], target: string, advance: Partial<PlanStep['rngAdvance']>): PlanStep {
  return { id: `step.${order}`, order, operationType, title: '', instruction: '', targetWeaponId: target, buildListEntryId: null, candidateId: null, ownedWeaponId: null,
    expectedResult: null, expectedStateBefore: {} as never, expectedStateAfter: {} as never, inventoryChange: null,
    rngAdvance: { gogmaCounterDelta: 0, skillCounterDelta: 0, normalCounterDelta: null, affectedNormalCounterId: null, ...advance },
    requiresUserConfirmation: true, isCompleted: false, completedAt: null, debug: null } as unknown as PlanStep
}
function planInput(): PlannerInput {
  return { rngState: { skillCounter: { value: 10 }, gogmaCounter: { value: 50 } }, normalCounters: [{ id: 'counter.x', weaponTypeId: 'weapon.x', counter: 3 }] } as unknown as PlannerInput
}

describe('Phase 2-B physical operation summary', () => {
  it('counts physical operations by the Counter they advance and never counts confirm_owned_ideal', () => {
    const plan = { steps: [step(1, 'create_normal_artian', 't1', { normalCounterDelta: 1, affectedNormalCounterId: 'counter.x' }),
      step(2, 'convert_normal_to_gogma', 't1', { skillCounterDelta: 1 }), step(3, 'confirm_owned_ideal', 't2', {}),
      step(4, 'reset_bonuses', 't1', { gogmaCounterDelta: 1 }), step(5, 'keep_bonuses', 't2', { gogmaCounterDelta: 1 })] } as unknown as ProductionPlan
    const physical = summarizePlanPhysical(plan, planInput())
    expect(physical.planSteps).toBe(5)
    expect(physical.physicalOperations).toBe(4)
    expect(physical.nonPhysicalSteps).toEqual({ confirm_owned_ideal: 1 })
    expect(physical.operationCounts).toEqual({ create_normal_artian: 1, convert_normal_to_gogma: 1, reset_skills: 0, reset_bonuses: 1, keep_bonuses: 1 })
    expect(physical.streams).toMatchObject({ skill: { start: 10, end: 11, advance: 1 }, gogma: { start: 50, end: 52, advance: 2 }, 'normal:counter.x': { start: 3, end: 4, weaponTypeId: 'weapon.x' } })
    expect(physical.identityHolds).toBe(true)
    expect(physical.executed.rows.map(row => row[1])).toEqual([3, 10, 50, 51])
  })

  it('fails closed on a Step that advances two Counters, a physical operation that advances none, or a debug position mismatch', () => {
    const bad = (s: PlanStep) => () => summarizePlanPhysical({ steps: [s] } as unknown as ProductionPlan, planInput())
    expect(bad(step(1, 'reset_bonuses', 't', { gogmaCounterDelta: 1, skillCounterDelta: 1 }))).toThrow(/exactly one Counter/)
    expect(bad(step(1, 'reset_skills', 't', {}))).toThrow(/advanced no Counter/)
    expect(bad({ ...step(1, 'reset_skills', 't', { skillCounterDelta: 1 }), debug: { startSkillCounter: 99 } as never })).toThrow(/debug start/)
  })
})

/** Synthetic two-Target evidence: IDs are arbitrary fixture strings, never real Export IDs. */
function route(targetWeaponId: string, overrides: Partial<Phase2BRouteSummary>): Phase2BRouteSummary {
  return { targetWeaponId, weaponTypeId: 'weapon.x', elementId: 'element.y', buildListEntryId: `entry.${targetWeaponId}`, entryOrigin: 'generated_base_search',
    routeKind: 'existing_gogma_mixed', sourceKind: 'owned', sourceOwnedWeaponId: `w.${targetWeaponId}`, normalPosition: null, normalCounterId: null, conversionPosition: null,
    estimatedOperationCount: 0, estimatedAdvances: { normal: null, gogma: 0, skill: 0 }, routeOperationCount: 0, operationTypes: {}, normal: null, gogma: null, skill: null, ...overrides }
}
function syntheticEvidence(): { autonomous: Phase2BAutonomousPlanEvidence; optimum: Phase2BOptimumEvidence } {
  // Autonomous: A resets Gogma 50..54 (5), B keeps at 55..57 (3) = 8 physical; Route units 5 + 4 (B's 54 shared with A) = 9.
  const rows: [number, number, number, number][] = [50, 51, 52, 53, 54].map(p => [0, p, 3, 0] as [number, number, number, number])
    .concat([55, 56, 57].map(p => [0, p, 4, 1] as [number, number, number, number]))
  const autonomous: Phase2BAutonomousPlanEvidence = {
    origin: { skill: 10, gogma: 50, normal: {} },
    physical: { planSteps: 8, physicalOperations: 8, nonPhysicalSteps: {}, operationCounts: { create_normal_artian: 0, convert_normal_to_gogma: 0, reset_skills: 0, reset_bonuses: 5, keep_bonuses: 3 },
      streams: { skill: { start: 10, end: 10, advance: 0, weaponTypeId: null }, gogma: { start: 50, end: 58, advance: 8, weaponTypeId: null } }, streamAdvanceSum: 8, identityHolds: true,
      sharedPhysicalSteps: 0, executed: { streams: ['gogma'], targets: ['target.a', 'target.b'], rows }, perTarget: {} },
    routes: [route('target.a', { entryOrigin: 'retained_original', routeOperationCount: 5, gogma: { first: 50, last: 54, operations: 5, required: [54], contiguous: true } }),
      route('target.b', { routeOperationCount: 4, gogma: { first: 54, last: 57, operations: 4, required: [57], contiguous: true } })],
    routeOperationSum: 9, selectedBuildListEntryIds: [], discoveryOrder: [{ targetWeaponId: 'target.b', status: 'found', targetOutcome: null, generatedEntryId: 'entry.target.b' }],
  }
  const optimum = parseOptimumEvidence({ verdict: 'proven_minimum', environment: { exportSha256: 'x' },
    summary: { physicalOperations: 3, routeOperationSum: 3, stageC: { stepOperationCounts: { reset_bonuses: 2, keep_bonuses: 1 } },
      skill: { start: 10, end: 10 }, gogma: { start: 50, end: 53 }, normal: {} },
    lowerBound: { origins: { normal: {} }, targets: [{ targetWeaponId: 'target.a', minSkillThreshold: null, minGogmaThreshold: 51, minNormalThreshold: null, firstIdealSkillPosition: null }] },
    routes: [
      { targetWeaponId: 'target.a', weaponTypeId: 'weapon.x', elementId: 'element.y', sourceKind: 'owned', sourceOwnedWeaponId: 'w.target.a', normalPosition: null, conversionPosition: null,
        normal: null, gogma: { first: 50, last: 50, operations: 1, required: [50] }, skill: null, routeOperationCount: 1,
        materialization: { method: 'candidate_search', routeKind: 'existing_gogma_reset_bonuses', estimated: { operations: 1 } } },
      { targetWeaponId: 'target.b', weaponTypeId: 'weapon.x', elementId: 'element.y', sourceKind: 'owned', sourceOwnedWeaponId: 'w.target.b', normalPosition: null, conversionPosition: null,
        normal: null, gogma: { first: 51, last: 52, operations: 2, required: [51, 52] }, skill: null, routeOperationCount: 2,
        materialization: { method: 'planner_alternative_search', routeKind: 'existing_gogma_mixed', estimated: { operations: 2 } } }],
  })
  return { autonomous, optimum }
}

describe('Phase 2-B gap reconciliation (post-hoc)', () => {
  it('reconciles the physical difference by operation type and by stream, separately from Route operations', () => {
    const { autonomous, optimum } = syntheticEvidence()
    const result = analyzePhase2BGap(autonomous, optimum, 6)
    expect(result.totals).toEqual({ autonomous: 8, optimum: 3, delta: 5, historicalValidatedOracle: 6, historicalMinusOptimum: 3, autonomousMinusHistorical: 2 })
    expect(result.operationTypes.find(r => r.operationType === 'reset_bonuses')).toEqual({ operationType: 'reset_bonuses', autonomous: 5, optimum: 2, delta: 3 })
    expect(result.operationTypeDeltaSum).toBe(5)
    expect(result.streamDeltaSum).toBe(5)
    expect(result.streamSummary).toMatchObject({ skill: 0, gogma: 5, normal: 0 })
    // Route operations are never the physical authority.
    expect(result.routeVersusPhysical.autonomous).toEqual({ routeOperationSum: 9, physicalOperations: 8, sharedOrFastForwarded: 1 })
    expect(result.staticEndModel).toEqual({ autonomousHolds: true, optimumHolds: true, mismatches: [] })
    const [excess] = result.excess
    expect(excess.region).toEqual({ from: 53, toExclusive: 58 })
    expect(excess.executorByTarget).toEqual({ 'target.a': 2, 'target.b': 3 })
    expect(excess.forcingTargets).toEqual([{ targetWeaponId: 'target.b', lastRequired: 57, requiredInRegion: 1 }, { targetWeaponId: 'target.a', lastRequired: 54, requiredInRegion: 1 }])
    expect(excess.peel.map(p => p.endAfter)).toEqual([55, 53])
    // Targets come from the evidence, not from embedded IDs.
    expect(result.targets.map(t => [t.targetWeaponId, t.sourceRelation, t.routeKindChanged, t.optimum.crossesHeldPositions])).toEqual([
      ['target.a', 'same_owned_weapon', true, false], ['target.b', 'same_owned_weapon', false, false]])
    expect(result.targets[0].singleTargetMinimum?.minGogmaThreshold).toBe(51)
    expect(result.stacking.rows).toEqual([{ discoveryIndex: 0, targetWeaponId: 'target.b', stream: 'gogma', frontierBefore: 55, first: 54, last: 57, operations: 4, startsAtOrAfterFrontier: false }])
    expect(result.physicalByEntryOrigin.all).toEqual({ retained_original: 5, generated_base_search: 3 })
  })

  it('fails closed when the operation types, the streams or the Targets do not reconcile', () => {
    const { autonomous, optimum } = syntheticEvidence()
    expect(() => analyzePhase2BGap(autonomous, { ...optimum, stepOperationCounts: { reset_bonuses: 3, keep_bonuses: 1 } }, 6)).toThrow(/Step operation counts/)
    expect(() => analyzePhase2BGap(autonomous, { ...optimum, gogma: { start: 50, end: 54 } }, 6)).toThrow(/Stream deltas|add up/)
    expect(() => analyzePhase2BGap(autonomous, { ...optimum, routes: optimum.routes.slice(0, 1) }, 6)).toThrow(/different Targets/)
    expect(() => analyzePhase2BGap({ ...autonomous, physical: { ...autonomous.physical, identityHolds: false } }, optimum, 6)).toThrow(/sum of Counter advances/)
  })
})

const benchmarkSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const workerSources = import.meta.glob('../workers/plannerGlobal.worker.benchmark.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2b*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// Built from parts so that this test itself never names the oracle modules (their own isolation test scans every Research file).
const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT'].join('|'))
const ORACLE_MANIFEST = new RegExp('plannerGlobal' + 'Oracle1657Manifest')

describe('Phase 2-B isolation', () => {
  const phase2bRuntime = Object.entries(benchmarkSources).filter(([path]) => /plannerGlobalPhase2B(?!.*\.test)/.test(path))
  it('keeps the oracle out of every calculation: only the analysis reads the optimum evidence, as an explicit file', () => {
    expect(phase2bRuntime.map(([path]) => path).sort()).toEqual(['./plannerGlobalPhase2BGapAnalysis.ts', './plannerGlobalPhase2BPerformance.ts',
      './plannerGlobalPhase2BPlan.ts', './plannerGlobalPhase2BTimeline.ts'])
    const algorithm = { ...Object.fromEntries(phase2bRuntime), ...workerSources, './plannerGlobalOptimizationResearch.ts': benchmarkSources['./plannerGlobalOptimizationResearch.ts'],
      './plannerGlobalBrowserBenchmarkRunner.ts': benchmarkSources['./plannerGlobalBrowserBenchmarkRunner.ts'] }
    for (const [path, source] of Object.entries(algorithm)) {
      expect(source, path).not.toMatch(ORACLE_NAMES)
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source, path).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]/)
    }
    // The calculation side (Research, Worker, timeline, Plan summary) never imports the post-hoc gap analysis.
    for (const path of ['./plannerGlobalOptimizationResearch.ts', './plannerGlobalPhase2BTimeline.ts', './plannerGlobalPhase2BPlan.ts']) {
      expect(benchmarkSources[path], path).not.toMatch(/plannerGlobalPhase2BGapAnalysis/)
    }
    expect(workerSources['../workers/plannerGlobal.worker.benchmark.ts']).not.toMatch(/plannerGlobalPhase2BGapAnalysis/)
    const runnerScript = Object.entries(scriptSources).find(([path]) => path.endsWith('run-planner-global-phase2b.mjs'))![1]
    expect(runnerScript).not.toMatch(/ORACLE|1657|plannerGlobalPhase2BGapAnalysis|--optimum/)
    const analysisScript = Object.entries(scriptSources).find(([path]) => path.endsWith('analyze-planner-global-phase2b.mjs'))![1]
    expect(analysisScript).toMatch(/option\('--optimum'\)/)
    expect(analysisScript).not.toMatch(/runGlobalPlannerResearch|createProductionPlan|searchCandidates/)
    expect(analysisScript).not.toMatch(ORACLE_MANIFEST)
  })

  it('is reached by no Production module, and Production keeps its defaults', () => {
    const paths = Object.keys(production).filter(path => !/\.test\.tsx?$|\.worker\.benchmark|BenchmarkPage|\/pages\/BenchmarkApp/.test(path))
    expect(paths.filter(path => /plannerGlobalPhase2B|Phase2BPlannerTimeline/.test(production[path]))).toEqual([])
    // The only Production change is the optional, semantics-neutral tail phase observer.
    expect(production['../domain/planner/productionPlanGeneration.ts']).toMatch(/observer\?\.onPlanGenerationPhase\?\.\('execution_projection'\)/)
    expect(production['../domain/planner/plannerDeterministicScheduler.ts']).not.toMatch(/onPlanGenerationPhase|Phase 2-B/)
  })
})
