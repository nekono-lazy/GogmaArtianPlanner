import { describe, expect, it } from 'vitest'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import { createPlannerGlobalBrowserHarness, type PlannerGlobalRunOptions } from './plannerGlobalBrowserBenchmark'
import type { PlannerGlobalBenchmarkResponse, PlannerGlobalWorkerResult } from './plannerGlobalBrowserBenchmarkProtocol'
import { createPlannerGlobalBrowserRunner, phase2aAttemptConfig, PHASE2A_WORKLOADS, summarizePings, type PlannerGlobalMemorySampler } from './plannerGlobalBrowserBenchmarkRunner'
import { EXTENT_AXES } from './plannerGlobalOptimizationExtentProbe'
import { GLOBAL_RESEARCH_EXTENT } from './plannerGlobalOptimizationResearch'
import { discoverySignature } from './plannerGlobalOptimizationRetry'

class FakeWorker implements BenchmarkWorkerLike {
  readonly posted: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  private readonly onPost: (message: unknown, worker: FakeWorker) => void
  constructor(onPost: (message: unknown, worker: FakeWorker) => void = () => undefined) { this.onPost = onPost }
  postMessage(message: unknown) { this.posted.push(structuredClone(message)); this.onPost(message, this) }
  addEventListener(type: string, listener: (event: Event) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener) }
  terminate() { this.terminated = true }
  emit(data: PlannerGlobalBenchmarkResponse) { for (const l of this.listeners.get('message') ?? []) l({ data } as MessageEvent) }
  fail(type: 'error' | 'messageerror' = 'error') { for (const l of this.listeners.get(type) ?? []) l({ type, message: 'boom' } as unknown as Event) }
}

const input = { options: { maxPlanSteps: 20000 } } as PlannerInput
const ENV = { protocolVersion: 'planner-global-phase2a', crossOriginIsolated: true, hardwareConcurrency: 16, userAgent: 'test', workerPerformanceMemory: false, rngEngineVersion: 'v' }
const options = (requestId = 'r1'): PlannerGlobalRunOptions => ({ requestId, input, mode: 'control', fallbackAxis: null, rawCache: 'per-search', yieldMode: 'message-channel',
  maxPlanSteps: 20000, fallbackBudgetMs: null, fallbackMaxEpisodes: null, attemptBudgetMs: null, attemptState: null, measurement: 'timing', profiler: false })
function fakeResult(stop: PlannerGlobalWorkerResult['stop'] = 'completed', status: 'completed' | 'partial' | 'cancelled' = 'completed'): PlannerGlobalWorkerResult {
  const state = { retainedEntryIds: ['e1'], pendingTargetIds: ['t2'], extent: { ...GLOBAL_RESEARCH_EXTENT } }
  const final = { status: status === 'completed' ? 'completed' : 'exhausted', completedTargetCount: status === 'completed' ? 2 : 1, conflicts: status === 'completed' ? 0 : 1,
    rejected: 0, resourceConflictRejected: 0, steps: 10, traceReplay: 'passed' }
  return { rngEngineVersion: 'v', inputFingerprint: 'f', priorityEntries: [{ id: 'e1', targetWeaponId: 't1' }, { id: 'e2', targetWeaponId: 't2' }], state,
    signature: discoverySignature(state), signals: { notFound: [], resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [] }, stop,
    report: { status, error: null, planningTargetCount: 2, retainedOriginalEntryIds: ['e1'], searches: [], final } as unknown as PlannerGlobalWorkerResult['report'],
    fallbacks: [], evidence: { searchEvidence: [], fallbackSearchEvidence: [], generatedEntries: [], finalSelectedEntryIds: [], planSha256: 'p', finalResultSha256: 'f', resultSha256: 'r' },
    semantic: {}, semanticSha256: `s-${stop}`, timing: { workerElapsedMs: 1, calculationElapsedMs: 1, evidenceElapsedMs: 0, searchElapsedMs: 0, fallbackSearchElapsedMs: 0,
      plannerElapsedMs: 0, totalElapsedMs: 1, candidateSearches: 0, fallbackEpisodes: 0 }, rawBlockSummary: null, predictionProfile: null, workerHeapAfter: null }
}
/** A Worker that answers like the real controller: ready, accepted, then the given result. */
function autoWorker(result: (message: { requestId: string; mode: string; fallbackAxis: string | null }) => PlannerGlobalWorkerResult | 'error' | 'crash') {
  const worker = new FakeWorker((message, w) => {
    const m = message as { type: string; requestId: string; pingId: number; mode: string; fallbackAxis: string | null }
    queueMicrotask(() => {
      if (m.type === 'pg2a_benchmark_ping') { w.emit({ type: 'pg2a_benchmark_pong', pingId: m.pingId }); return }
      if (m.type !== 'pg2a_benchmark_run') return
      w.emit({ type: 'pg2a_benchmark_accepted', requestId: m.requestId, priorityEntries: [{ id: 'e1', targetWeaponId: 't1' }, { id: 'e2', targetWeaponId: 't2' }] })
      const r = result(m)
      if (r === 'crash') w.fail()
      else if (r === 'error') w.emit({ type: 'pg2a_benchmark_error', requestId: m.requestId, message: 'bad' })
      else w.emit({ type: 'pg2a_benchmark_result', requestId: m.requestId, result: r })
    })
  })
  queueMicrotask(() => worker.emit({ type: 'pg2a_benchmark_ready', environment: ENV }))
  return worker
}
const noMemory: PlannerGlobalMemorySampler = { availability: () => ({ measureUserAgentSpecificMemory: false, performanceMemory: false, crossOriginIsolated: false }),
  sample: async (label, atMs) => ({ label, atMs, userAgentSpecific: { status: 'unavailable', reason: 'not crossOriginIsolated' }, mainRealm: null }) }
const runnerDeps = { visibilityState: () => 'visible', onVisibilityChange: () => () => undefined, memory: noMemory, sleep: async () => undefined, clock: () => 'T' }

describe('Phase 2-A main-thread harness', () => {
  it('measures create->ready, accepted and round trip, and refuses a second run on the same Worker (fresh Worker policy)', async () => {
    let t = 0
    const worker = autoWorker(() => fakeResult())
    const harness = createPlannerGlobalBrowserHarness({ createWorker: () => worker, now: () => (t += 5) })
    const ready = await harness.whenReady()
    expect(ready.createToReadyMs).toBeGreaterThan(0)
    expect(ready.environment).toEqual(ENV)
    const result = await harness.run(options())
    expect(result.outcome.status).toBe('completed')
    expect(result.acceptedAtMs).toBeGreaterThan(0)
    expect(result.roundTripMs).toBeGreaterThanOrEqual(result.acceptedAtMs!)
    expect(result.priorityEntries).toHaveLength(2)
    await expect(harness.run(options('r2'))).rejects.toThrow('Fresh Worker policy')
    await expect(createPlannerGlobalBrowserHarness({ createWorker: () => autoWorker(() => fakeResult()) }).run({ ...options(), maxPlanSteps: 5 })).rejects.toThrow('maxPlanSteps')
    harness.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('never applies a result that arrives after the run settled as cancelled, and counts it', async () => {
    const worker = new FakeWorker()
    const harness = createPlannerGlobalBrowserHarness({ createWorker: () => worker })
    const pending = harness.run(options())
    worker.emit({ type: 'pg2a_benchmark_accepted', requestId: 'r1', priorityEntries: [] })
    expect(harness.cancel('r1')).toBe(true)
    expect(harness.cancel('other')).toBe(false)
    worker.emit({ type: 'pg2a_benchmark_cancel_ack', requestId: 'r1' })
    worker.emit({ type: 'pg2a_benchmark_cancelled', requestId: 'r1', result: fakeResult('cancelled', 'cancelled') })
    worker.emit({ type: 'pg2a_benchmark_result', requestId: 'r1', result: fakeResult() })
    const result = await pending
    expect(result.outcome.status).toBe('cancelled')
    expect(result.cancel).toMatchObject({ ackMs: expect.any(Number), settledMs: expect.any(Number) })
    expect(harness.lateResponses()).toBe(1)
    expect(worker.posted.filter(m => (m as { type: string }).type === 'pg2a_benchmark_cancel')).toHaveLength(1)
  })

  it('answers ping / pong and fails closed on a native Worker error', async () => {
    const worker = autoWorker(() => fakeResult())
    const harness = createPlannerGlobalBrowserHarness({ createWorker: () => worker })
    await harness.whenReady()
    expect(await harness.ping()).toEqual(expect.any(Number))
    const broken = new FakeWorker()
    const failing = createPlannerGlobalBrowserHarness({ createWorker: () => broken })
    const pending = failing.run(options())
    broken.fail('messageerror')
    expect((await pending).outcome).toMatchObject({ status: 'worker_error', message: expect.stringContaining('messageerror') })
    await expect(failing.run(options('r2'))).rejects.toThrow('failed')
    expect(await failing.ping(10)).toBeNull()
    await expect(failing.whenReady()).rejects.toThrow('failed')
  })
})

describe('Phase 2-A runner', () => {
  it('creates a fresh Worker per attempt, runs a series warm-up first, and never mixes records', async () => {
    const workers: FakeWorker[] = []
    const runner = createPlannerGlobalBrowserRunner({ ...runnerDeps, createHarness: () => createPlannerGlobalBrowserHarness({ createWorker: () => { const w = autoWorker(() => fakeResult()); workers.push(w); return w } }) })
    const series = await runner.runSeries(input, PHASE2A_WORKLOADS.normalWinner(), 1, 3)
    expect(series.map(r => r.kind)).toEqual(['warmup', 'measurement', 'measurement', 'measurement'])
    expect(workers).toHaveLength(4)
    expect(workers.every(w => w.terminated && w.posted.filter(m => (m as { type: string }).type === 'pg2a_benchmark_run').length === 1)).toBe(true)
    expect(new Set(workers.map(w => (w.posted[0] as { requestId: string }).requestId)).size).toBe(4)
    // Memory is unavailable here: the benchmark still completes and records exactly that.
    const memory = await runner.runAttempt(input, PHASE2A_WORKLOADS.memory())
    expect(memory.status).toBe('completed')
    expect(memory.memory?.map(s => s.label)).toEqual(['before_worker_create', 'worker_ready', 'result_received', 'after_dispose', 'after_gc_wait_reference'])
    expect(memory.memory?.every(s => s.userAgentSpecific.status === 'unavailable')).toBe(true)
    const exported = JSON.parse(runner.exportJson({ note: 'env' }))
    expect(exported.records).toHaveLength(5)
    expect(JSON.stringify(exported)).not.toContain('"input"')
  })

  it('runs the Phase 1-E controller on fresh Workers in EXTENT_AXES order and starts no retry after an initial success', async () => {
    const runs: { mode: string; axis: string | null }[] = []
    const runner = createPlannerGlobalBrowserRunner({ ...runnerDeps, createHarness: () => createPlannerGlobalBrowserHarness({ createWorker: () => autoWorker(m => {
      runs.push({ mode: m.mode, axis: m.fallbackAxis })
      return m.fallbackAxis === 'normal' ? fakeResult('completed', 'completed') : fakeResult(null, 'partial')
    }) }) })
    let first: number | null = null
    const controller = await runner.runController(input, { label: 'c', onFirstCompleted: ms => { first = ms } })
    expect(runs).toEqual([{ mode: 'control', axis: null }, ...EXTENT_AXES.map(axis => ({ mode: 'fallback', axis }))])
    expect(controller).toMatchObject({ outcome: 'completed', initialSuccess: true, retryStarted: false, winner: { axis: 'normal', stage: 'initial' } })
    expect(controller.firstCompleted).toMatchObject({ axis: 'normal', stage: 'initial' })
    expect(first).not.toBeNull()
    expect(controller.recordIds).toHaveLength(4)
  })

  it('never starts the retry from a Worker failure or error initial attempt (they are not partial results)', async () => {
    const runner = createPlannerGlobalBrowserRunner({ ...runnerDeps, createHarness: () => createPlannerGlobalBrowserHarness({ createWorker: () => autoWorker(m =>
      m.fallbackAxis === 'gogma' ? 'crash' : m.fallbackAxis === 'skill' ? 'error' : fakeResult(null, 'partial')) }) })
    const controller = await runner.runController(input, { label: 'c' })
    expect(controller.retryStarted).toBe(false)
    expect(controller.nonRetryableInitial).toEqual([{ axis: 'gogma', stop: 'process_error', status: 'error' }, { axis: 'skill', stop: 'attempt_error', status: 'error' }])
    expect(controller.outcome).toBe('not_completed')
    expect(runner.records().map(r => r.status)).toEqual(['completed', 'completed', 'worker_error', 'error'])
  })

  it('arms a benchmark-only cancel on the fallback start and records ack, settle and late responses', async () => {
    const createWorker = () => {
      const worker = new FakeWorker((message, w) => {
        const m = message as { type: string; requestId: string }
        queueMicrotask(() => {
          if (m.type === 'pg2a_benchmark_run') {
            w.emit({ type: 'pg2a_benchmark_accepted', requestId: m.requestId, priorityEntries: [] })
            w.emit({ type: 'pg2a_benchmark_progress', requestId: m.requestId, observation: { stage: 'discovery', status: 'partial', searchIndex: 0, searchStatus: 'searching',
              fallbackStatus: null, fallbackEpisodes: 0, generatedReplacements: 0, elapsedMs: 1, workerHeap: null } })
            w.emit({ type: 'pg2a_benchmark_progress', requestId: m.requestId, observation: { stage: 'discovery', status: 'partial', searchIndex: 0, searchStatus: 'not_found_within_extent',
              fallbackStatus: 'searching', fallbackEpisodes: 0, generatedReplacements: 0, elapsedMs: 2, workerHeap: null } })
          }
          if (m.type === 'pg2a_benchmark_cancel') {
            w.emit({ type: 'pg2a_benchmark_cancel_ack', requestId: m.requestId })
            w.emit({ type: 'pg2a_benchmark_cancelled', requestId: m.requestId, result: fakeResult('cancelled', 'cancelled') })
          }
        })
      })
      // Ready only after the harness listens, as a real Worker's module evaluation would.
      queueMicrotask(() => worker.emit({ type: 'pg2a_benchmark_ready', environment: ENV }))
      return worker
    }
    const runner = createPlannerGlobalBrowserRunner({ ...runnerDeps, createHarness: () => createPlannerGlobalBrowserHarness({ createWorker }) })
    const record = await runner.runAttempt(input, { ...PHASE2A_WORKLOADS.cancelFallback(), cancel: { trigger: 'fallback', delayMs: 0 } })
    expect(record.status).toBe('cancelled')
    expect(record.cancel).toMatchObject({ trigger: 'fallback', triggerObservation: { fallbackStatus: 'searching' }, lateResponses: 0, ackMs: expect.any(Number) })
  })

  it('summarizes chained pings without inventing values, and builds Phase 1-E configs', () => {
    expect(summarizePings([3, null, 1, 2])).toEqual({ count: 4, lost: 1, medianMs: 2, p95Ms: 3, maxMs: 3, samplesMs: [3, 1, 2] })
    expect(summarizePings([])).toMatchObject({ count: 0, medianMs: null, p95Ms: null, maxMs: null })
    expect(phase2aAttemptConfig('x', 'probe', null)).toMatchObject({ mode: 'control', fallbackAxis: null, fallbackBudgetMs: null, fallbackMaxEpisodes: null, rawCache: 'per-search', yieldMode: 'message-channel', profiler: false })
    expect(phase2aAttemptConfig('x', 'probe', 'skill')).toMatchObject({ mode: 'fallback', fallbackAxis: 'skill', fallbackBudgetMs: 180000, fallbackMaxEpisodes: 3, attemptBudgetMs: 900000 })
    expect(PHASE2A_WORKLOADS.normalCacheOff()).toMatchObject({ rawCache: 'off', fallbackAxis: 'normal' })
  })
})
