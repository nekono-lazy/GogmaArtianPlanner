import { describe, expect, it } from 'vitest'
import {
  createProductionPlannerDependencies,
  defaultPlannerOrchestrationBounds,
  type PlannerOrchestrationResult,
} from '../domain/planner'
import type { ProductionPlanId } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import {
  assertIssue101RunOptions,
  createIssue101BenchmarkHarness,
} from './issue101ConstrainedResearchBrowserBenchmark'
import {
  createIssue101EnumerationInput,
  ISSUE_101_BASELINE_BOUNDS,
  issue101GogmaBounds,
} from './issue101ConstrainedResearchFixtures'
import {
  isIssue101BenchmarkResponse,
  type Issue101BenchmarkRequest,
  type Issue101BenchmarkResponse,
} from './issue101ConstrainedResearchProtocol'
import {
  createIssue101BenchmarkController,
  observeIssue101PlannerDependencies,
  summarizeIssue101Orchestration,
} from '../workers/issue101ConstrainedResearch.worker.benchmark'

class FakeWorker implements BenchmarkWorkerLike {
  readonly posted: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  terminate(): void {
    this.terminated = true
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent)
    }
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0)
  }
}

function tinyNoIdealInput() {
  return createIssue101EnumerationInput('issue101_no_ideal', {
    ...ISSUE_101_BASELINE_BOUNDS,
    maxNormalForgeCount: 1,
    maxGogmaAdvance: 1,
  })
}

describe('Issue #101 benchmark protocol', () => {
  it('recognizes only its own prefixed responses', () => {
    expect(isIssue101BenchmarkResponse({ type: 'i101_benchmark_pong', pingId: 1 })).toBe(true)
    expect(isIssue101BenchmarkResponse({ type: 'b8_benchmark_pong', pingId: 1 })).toBe(false)
    expect(isIssue101BenchmarkResponse({ type: 'result' })).toBe(false)
    expect(isIssue101BenchmarkResponse(null)).toBe(false)
  })
})

describe('Issue #101 benchmark harness', () => {
  it('posts an enumeration request and settles on its result', async () => {
    const worker = new FakeWorker()
    let clock = 0
    const harness = createIssue101BenchmarkHarness({ createWorker: () => worker, now: () => clock })
    const input = tinyNoIdealInput()
    const pending = harness.run({ kind: 'enumeration', requestId: 'r1', input })
    const [request] = worker.posted as Issue101BenchmarkRequest[]
    expect(request).toMatchObject({
      type: 'i101_benchmark_enumeration',
      requestId: 'r1',
      stopAfterCandidates: null,
      notifyFirstCandidate: false,
    })
    clock = 5
    worker.emit('message', { type: 'i101_benchmark_accepted', requestId: 'r1' })
    clock = 12
    worker.emit('message', {
      type: 'i101_benchmark_enumeration_result',
      requestId: 'r1',
      bounds: input.bounds,
      measurement: {
        workerElapsedMs: 3,
        deliveredCandidates: 0,
        timeToFirstCandidateMs: null,
        candidateTimesMs: [],
        firstCandidate: null,
        summary: { examinedCandidates: 0, evaluatedOffAxisPairs: 0, exhausted: false, stoppedByBound: true },
        stoppedByConsumer: false,
      },
    } satisfies Issue101BenchmarkResponse)
    const result = await pending
    expect(result.outcome.status).toBe('enumeration_completed')
    expect(result.acceptedAtMs).toBe(5)
    expect(result.roundTripMs).toBe(12)
    expect(result.cancel).toBeNull()
    harness.dispose()
    expect(worker.terminated).toBe(true)
    expect(worker.listenerCount()).toBe(0)
  })

  it('posts the caller enumeration and orchestration bounds unchanged', () => {
    const worker = new FakeWorker()
    const harness = createIssue101BenchmarkHarness({ createWorker: () => worker })
    const bounds = issue101GogmaBounds(250)
    const orchestrationBounds = { maxCandidateTrialsPerConflict: 20, maxGeneratedBuildListEntries: 1, maxPlannerReruns: 30 }
    void harness.run({
      kind: 'orchestration',
      requestId: 'r2',
      input: {} as never,
      enumerationBounds: bounds,
      orchestrationBounds,
    })
    expect(worker.posted[0]).toMatchObject({
      type: 'i101_benchmark_orchestration',
      enumerationBounds: bounds,
      orchestrationBounds,
    })
    harness.dispose()
  })

  it('fails closed on invalid bounds before posting anything', () => {
    const worker = new FakeWorker()
    const harness = createIssue101BenchmarkHarness({ createWorker: () => worker })
    const input = { ...tinyNoIdealInput(), bounds: { ...ISSUE_101_BASELINE_BOUNDS, maxGogmaAdvance: 0 } }
    expect(() => harness.run({ kind: 'enumeration', requestId: 'bad', input })).toThrow(RangeError)
    expect(() =>
      assertIssue101RunOptions({
        kind: 'orchestration',
        requestId: 'bad',
        input: {} as never,
        enumerationBounds: ISSUE_101_BASELINE_BOUNDS,
        orchestrationBounds: { ...defaultPlannerOrchestrationBounds, maxPlannerReruns: 0 },
      }),
    ).toThrow()
    expect(worker.posted).toHaveLength(0)
    harness.dispose()
  })

  it('fails a pending run closed on a native Worker error', async () => {
    const worker = new FakeWorker()
    const harness = createIssue101BenchmarkHarness({ createWorker: () => worker })
    const pending = harness.run({ kind: 'enumeration', requestId: 'r3', input: tinyNoIdealInput() })
    worker.emit('error')
    const result = await pending
    expect(result.outcome).toEqual({ status: 'error', message: 'The Issue #101 benchmark Worker failed.' })
    harness.dispose()
  })

  it('posts a cancel when the Worker reports the first Candidate, once', () => {
    const worker = new FakeWorker()
    const harness = createIssue101BenchmarkHarness({ createWorker: () => worker })
    void harness.run({ kind: 'enumeration', requestId: 'r5', input: tinyNoIdealInput(), cancelOnFirstCandidate: true })
    expect(worker.posted[0]).toMatchObject({ notifyFirstCandidate: true })
    worker.emit('message', { type: 'i101_benchmark_first_candidate', requestId: 'r5' })
    worker.emit('message', { type: 'i101_benchmark_first_candidate', requestId: 'r5' })
    expect(worker.posted.slice(1)).toEqual([{ type: 'i101_benchmark_cancel', requestId: 'r5' }])
    harness.dispose()
  })

  it('posts a cancel after the requested delay and records the observation', async () => {
    const worker = new FakeWorker()
    let clock = 0
    const harness = createIssue101BenchmarkHarness({ createWorker: () => worker, now: () => clock })
    const pending = harness.run({ kind: 'enumeration', requestId: 'r4', input: tinyNoIdealInput(), cancelAfterMs: 0 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(worker.posted[1]).toEqual({ type: 'i101_benchmark_cancel', requestId: 'r4' })
    clock = 2
    worker.emit('message', { type: 'i101_benchmark_cancel_ack', requestId: 'r4' })
    clock = 7
    worker.emit('message', {
      type: 'i101_benchmark_cancelled',
      requestId: 'r4',
      workerElapsedMs: 4,
      deliveredCandidates: 0,
      settledAsResult: false,
    })
    const result = await pending
    expect(result.outcome.status).toBe('cancelled')
    expect(result.cancel).toEqual({ requestedAtMs: 0, ackMs: 2, settledMs: 7 })
    harness.dispose()
  })
})

describe('Issue #101 benchmark Worker controller', () => {
  function controller() {
    const responses: Issue101BenchmarkResponse[] = []
    const instance = createIssue101BenchmarkController(
      () => createProductionPlannerDependencies(new ProductionRngEngine()),
      (response) => responses.push(response),
    )
    return { instance, responses }
  }

  it('answers a ping', async () => {
    const { instance, responses } = controller()
    await instance.handleMessage({ type: 'i101_benchmark_ping', pingId: 7 })
    expect(responses).toEqual([{ type: 'i101_benchmark_pong', pingId: 7 }])
  })

  it('runs a real enumeration with the request bounds and reports the typed summary', async () => {
    const { instance, responses } = controller()
    const input = tinyNoIdealInput()
    await instance.handleMessage({ type: 'i101_benchmark_enumeration', requestId: 'e1', input, stopAfterCandidates: null, notifyFirstCandidate: false })
    expect(responses[0]).toEqual({ type: 'i101_benchmark_accepted', requestId: 'e1' })
    const result = responses[1]
    expect(result.type).toBe('i101_benchmark_enumeration_result')
    if (result.type !== 'i101_benchmark_enumeration_result') return
    expect(result.bounds).toEqual(input.bounds)
    expect(result.measurement.deliveredCandidates).toBe(0)
    expect(result.measurement.summary).toEqual({
      examinedCandidates: 0,
      evaluatedOffAxisPairs: 0,
      exhausted: false,
      stoppedByBound: true,
    })
  }, 60_000)

  it('reports invalid bounds as an error instead of running', async () => {
    const { instance, responses } = controller()
    const input = { ...tinyNoIdealInput(), bounds: { ...ISSUE_101_BASELINE_BOUNDS, maxSkillResetCount: 0 } }
    await instance.handleMessage({ type: 'i101_benchmark_enumeration', requestId: 'e2', input, stopAfterCandidates: null, notifyFirstCandidate: false })
    expect(responses.map(({ type }) => type)).toEqual(['i101_benchmark_accepted', 'i101_benchmark_error'])
    await instance.handleMessage({
      type: 'i101_benchmark_orchestration',
      requestId: 'e3',
      input: {} as never,
      enumerationBounds: ISSUE_101_BASELINE_BOUNDS,
      orchestrationBounds: { ...defaultPlannerOrchestrationBounds, maxCandidateTrialsPerConflict: -1 },
      notifyFirstCandidate: false,
    })
    expect(responses.at(-1)?.type).toBe('i101_benchmark_error')
  })

  it('settles a cancelled enumeration as cancelled', async () => {
    const { instance, responses } = controller()
    const input = createIssue101EnumerationInput('issue101_real_fire', ISSUE_101_BASELINE_BOUNDS)
    const running = instance.handleMessage({ type: 'i101_benchmark_enumeration', requestId: 'c1', input, stopAfterCandidates: null, notifyFirstCandidate: false })
    await instance.handleMessage({ type: 'i101_benchmark_cancel', requestId: 'c1' })
    await running
    expect(responses.map(({ type }) => type)).toEqual([
      'i101_benchmark_accepted',
      'i101_benchmark_cancel_ack',
      'i101_benchmark_cancelled',
    ])
  }, 60_000)
})

describe('Issue #101 orchestration observation', () => {
  it('labels a clock read followed by a ProductionPlan ID as a Plan, every other read as a trial', () => {
    const production = createProductionPlannerDependencies(new ProductionRngEngine())
    let at = 0
    const observed = observeIssue101PlannerDependencies(
      {
        ...production,
        clock: { now: () => '2026-09-25T00:00:00.000Z' },
        idFactory: { ...production.idFactory, productionPlanId: () => 'plan.fixed' as ProductionPlanId },
      },
      () => at,
    )
    at = 1
    observed.dependencies.clock.now()
    expect(observed.dependencies.idFactory.productionPlanId()).toBe('plan.fixed')
    at = 2
    expect(observed.dependencies.clock.now()).toBe('2026-09-25T00:00:00.000Z')
    at = 3
    observed.dependencies.clock.now()
    observed.dependencies.idFactory.productionPlanId()
    expect(observed.events()).toEqual([
      { kind: 'plan_generated', atMs: 1 },
      { kind: 'candidate_materialized', atMs: 2 },
      { kind: 'plan_generated', atMs: 3 },
    ])
    expect(observed.dependencies.rngEngine).toBe(production.rngEngine)
  })

  it('derives trials, Plan generations and the adopted trial from the timeline', () => {
    const adopted = {
      plan: { steps: [{}, {}], selectedBuildListEntryIds: ['b', 'a'] },
      conflicts: [],
      warnings: [],
      termination: { status: 'completed' },
      generatedBuildListEntries: [
        {
          candidateSnapshot: {
            route: { kind: 'normal_artian_to_gogma', sourceOwnedWeaponId: null, operations: [] },
            estimatedGogmaAdvance: 0,
            estimatedSkillAdvance: 0,
            estimatedNormalAdvance: null,
          },
        },
      ],
      generatedBuildListEntryReplacements: [],
    } as unknown as PlannerOrchestrationResult
    const events = [
      { kind: 'plan_generated' as const, atMs: 5 },
      { kind: 'candidate_materialized' as const, atMs: 100 },
      { kind: 'candidate_materialized' as const, atMs: 150 },
      { kind: 'plan_generated' as const, atMs: 180 },
    ]
    const measurement = summarizeIssue101Orchestration(events, adopted, 200)
    expect(measurement).toMatchObject({
      workerElapsedMs: 200,
      candidateTrials: 2,
      planGenerations: 2,
      initialPlannerRunMs: 5,
      timeToFirstCandidateMs: 100,
      timeToAdoptedCandidateMs: 180,
      adoptedCandidateOrdinal: 2,
      planStepCount: 2,
      selectedBuildListEntryIds: ['a', 'b'],
      generatedBuildListEntryCount: 1,
    })
    const rejected = summarizeIssue101Orchestration(
      events,
      { ...adopted, generatedBuildListEntries: [] },
      200,
    )
    expect(rejected.timeToAdoptedCandidateMs).toBeNull()
    expect(rejected.adoptedCandidateOrdinal).toBeNull()
  })
})

describe('Issue #101 benchmark isolation', () => {
  it('is reachable from no Production module and leaves the Production adapter default in place', () => {
    const sources = {
      ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages}/**/*.{ts,tsx}', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
      ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>
    const paths = Object.keys(sources)
    expect(paths.length).toBeGreaterThan(100)
    const benchmarkOnly = [
      /^\.\.\/benchmark\.tsx$/,
      /^\.\.\/pages\/BenchmarkApp(\.test)?\.tsx$/,
      /^\.\.\/pages\/Issue101ConstrainedResearchBenchmarkPage\.tsx$/,
      /^\.\.\/workers\/issue101ConstrainedResearch\.worker\.benchmark(\.entry)?\.ts$/,
      // The Planner Alternative Phase 3-A harness reuses the Issue #101 fixture and route summary.
      /^\.\.\/pages\/PlannerAlternativeBenchmarkPage\.tsx$/,
      /^\.\.\/workers\/plannerAlternative\.worker\.benchmark(\.entry)?\.ts$/,
      /\.test\.tsx?$/,
    ]
    const offenders = paths.filter(
      (path) =>
        !benchmarkOnly.some((pattern) => pattern.test(path)) &&
        /issue101|Issue101/.test(sources[path]),
    )
    expect(offenders).toEqual([])
    expect(sources['../workers/planner.worker.production.ts']).toContain(
      'enumerationBounds: defaultConstrainedEnumerationBounds',
    )
  })
})
