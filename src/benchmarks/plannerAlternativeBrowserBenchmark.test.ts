import { beforeAll, describe, expect, it } from 'vitest'
import { createProductionPlannerDependencies } from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import {
  assertPlannerAlternativeRunOptions,
  createPlannerAlternativeBenchmarkHarness,
  type PlannerAlternativeBenchmarkHarness,
  type PlannerAlternativeHarnessRunOptions,
  type PlannerAlternativeRunResult,
} from './plannerAlternativeBrowserBenchmark'
import {
  BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT,
  BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS,
  createIssue101KernelRequest,
  createIssue101RealFixture,
  createLongHeldFixture,
  BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT,
  type Issue101RealFixture,
} from './plannerAlternativeBenchmarkFixtures'
import {
  isPlannerAlternativeBenchmarkRequest,
  isPlannerAlternativeBenchmarkResponse,
  type PlannerAlternativeBenchmarkResponse,
} from './plannerAlternativeBenchmarkProtocol'
import {
  createPlannerAlternativeBenchmarkRunner,
  summarizePlannerAlternativeMeasurements,
  type PlannerAlternativeBenchmarkRecord,
} from './plannerAlternativeBenchmarkRunner'
import {
  attachPlannerAlternativeBenchmarkWorker,
  createPlannerAlternativeBenchmarkController,
} from '../workers/plannerAlternative.worker.benchmark'

const SLOW = 180_000

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
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent)
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0)
  }
}

function tinySearchInput() {
  // A one-position series: Skill 341 held and blocked, the Ideal anchored at 342.
  return createLongHeldFixture('long_skill_held', { heldLength: 1, heldMode: 'held_blocked' }, { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 2 }, { idealPosition: 342 }).input
}

function searchOptions(requestId = 'r1'): Extract<PlannerAlternativeHarnessRunOptions, { kind: 'search' }> {
  return { kind: 'search', requestId, input: tinySearchInput(), stopAfterCandidates: 1, recording: 'timing', instrumented: true }
}

function searchResult(requestId: string): PlannerAlternativeBenchmarkResponse {
  return {
    type: 'pa3_benchmark_search_result',
    requestId,
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 2 },
    measurement: {
      workerElapsedMs: 5, timeToFirstCandidateMs: 3, candidateTimesMs: [3], deliveredCandidates: 1,
      settledWorkItemsAtFirstCandidate: 2, settledWorkItemsTotal: 2, predictionCounts: null,
      predictionCountsAtFirstCandidate: null, skillStreams: null, gogmaStreams: null, firstCandidate: null,
      summary: { deliveredCandidates: 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false },
      stoppedByConsumer: true, parity: null,
    },
  }
}

describe('Planner Alternative benchmark protocol', () => {
  it('recognizes only its own prefixed messages', () => {
    expect(isPlannerAlternativeBenchmarkResponse({ type: 'pa3_benchmark_pong', pingId: 1 })).toBe(true)
    expect(isPlannerAlternativeBenchmarkResponse({ type: 'i101_benchmark_pong', pingId: 1 })).toBe(false)
    expect(isPlannerAlternativeBenchmarkResponse({ type: 'result' })).toBe(false)
    expect(isPlannerAlternativeBenchmarkResponse(null)).toBe(false)
    expect(isPlannerAlternativeBenchmarkRequest({ type: 'pa3_benchmark_ping', pingId: 1 })).toBe(true)
    expect(isPlannerAlternativeBenchmarkRequest({ type: 'pa3_benchmark_cancel', requestId: 'a' })).toBe(true)
    expect(isPlannerAlternativeBenchmarkRequest({ type: 'pa3_benchmark_cancel', requestId: '' })).toBe(false)
    expect(isPlannerAlternativeBenchmarkRequest({ type: 'pa3_benchmark_ping' })).toBe(false)
    expect(isPlannerAlternativeBenchmarkRequest({ type: 'plan', requestId: 'a' })).toBe(false)
    expect(isPlannerAlternativeBenchmarkRequest('x')).toBe(false)
  })

  it('refuses invalid run options before any Worker exists', () => {
    const input = tinySearchInput()
    expect(() => assertPlannerAlternativeRunOptions({ ...searchOptions(), input: { ...input, extent: { ...input.extent, maxGogmaAdvance: 0 } } })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeRunOptions({ ...searchOptions(), stopAfterCandidates: 0 })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeRunOptions({ ...searchOptions(), recording: 'fast' as never })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeRunOptions({ ...searchOptions(), cancelAfterMs: -1 })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeRunOptions({ ...searchOptions(), requestId: '' })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeRunOptions({ ...searchOptions(), stopAfterCandidates: null })).not.toThrow()
  })
})

describe('Planner Alternative main-thread harness', () => {
  it('times the round trip from immediately before the post to the main-thread settle', async () => {
    const worker = new FakeWorker()
    let clock = 0
    const harness = createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker, now: () => clock })
    clock = 100
    const promise = harness.run(searchOptions())
    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0]).toMatchObject({ type: 'pa3_benchmark_search', requestId: 'r1', stopAfterCandidates: 1, recording: 'timing', instrumented: true, notifyFirstCandidate: false })
    clock = 104
    worker.emit('message', { type: 'pa3_benchmark_accepted', requestId: 'r1' })
    worker.emit('message', { type: 'i101_benchmark_accepted', requestId: 'r1' })
    clock = 130
    worker.emit('message', searchResult('r1'))
    const result = await promise
    expect(result.roundTripMs).toBe(30)
    expect(result.acceptedAtMs).toBe(4)
    expect(result.cancel).toBeNull()
    expect(result.outcome).toMatchObject({ status: 'search_completed', measurement: { workerElapsedMs: 5 } })
  })

  it('posts the cancel on the first-Candidate notice and records ack and settle latencies', async () => {
    const worker = new FakeWorker()
    let clock = 0
    const harness = createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker, now: () => clock })
    const promise = harness.run({ ...searchOptions(), stopAfterCandidates: null, cancelOnFirstCandidate: true })
    expect(worker.posted[0]).toMatchObject({ notifyFirstCandidate: true })
    clock = 10
    worker.emit('message', { type: 'pa3_benchmark_first_candidate', requestId: 'r1' })
    expect(worker.posted[1]).toEqual({ type: 'pa3_benchmark_cancel', requestId: 'r1' })
    clock = 12
    worker.emit('message', { type: 'pa3_benchmark_cancel_ack', requestId: 'r1' })
    clock = 15
    worker.emit('message', { type: 'pa3_benchmark_cancelled', requestId: 'r1', workerElapsedMs: 14, deliveredCandidates: 1 })
    const result = await promise
    expect(result.outcome).toEqual({ status: 'cancelled', workerElapsedMs: 14, deliveredCandidates: 1 })
    expect(result.firstCandidateNoticeAtMs).toBe(10)
    expect(result.cancel).toEqual({ requestedAtMs: 10, ackMs: 2, settledMs: 5 })
  })

  it('cancels a running request on demand only', async () => {
    const worker = new FakeWorker()
    const harness = createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker, now: () => 0 })
    expect(harness.cancel('missing')).toBe(false)
    const promise = harness.run(searchOptions())
    expect(harness.cancel('r1')).toBe(true)
    expect(harness.cancel('r1')).toBe(true)
    expect(worker.posted.filter((message) => (message as { type: string }).type === 'pa3_benchmark_cancel')).toHaveLength(1)
    worker.emit('message', { type: 'pa3_benchmark_cancelled', requestId: 'r1', workerElapsedMs: 1, deliveredCandidates: 0 })
    await promise
  })

  it('measures ping latency and gives up on a timeout', async () => {
    const worker = new FakeWorker()
    let clock = 0
    const harness = createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker, now: () => clock })
    const ping = harness.ping()
    const posted = worker.posted[0] as { pingId: number }
    clock = 7
    worker.emit('message', { type: 'pa3_benchmark_pong', pingId: posted.pingId })
    expect(await ping).toBe(7)
    expect(await harness.ping(1)).toBeNull()
  })

  it('fails every pending run closed on a native Worker error and refuses later runs', async () => {
    for (const type of ['error', 'messageerror']) {
      const worker = new FakeWorker()
      const harness = createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker, now: () => 0 })
      const pending = harness.run(searchOptions())
      worker.emit(type)
      expect((await pending).outcome).toEqual({ status: 'error', message: 'The Planner Alternative benchmark Worker failed.' })
      await expect(harness.run(searchOptions('r2'))).rejects.toThrow('failed')
      expect(await harness.ping(1)).toBeNull()
    }
  })

  it('disposes: removes listeners, fails pending runs and terminates the Worker', async () => {
    const worker = new FakeWorker()
    const harness = createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker, now: () => 0 })
    const pending = harness.run(searchOptions())
    const ping = harness.ping()
    harness.dispose()
    expect((await pending).outcome.status).toBe('error')
    expect(await ping).toBeNull()
    expect(worker.listenerCount()).toBe(0)
    expect(worker.terminated).toBe(true)
  })
})

describe('Planner Alternative benchmark Worker controller', () => {
  const dependencies = () => createProductionPlannerDependencies(new ProductionRngEngine())

  function collectResponses() {
    const responses: PlannerAlternativeBenchmarkResponse[] = []
    return { responses, post: (response: PlannerAlternativeBenchmarkResponse) => responses.push(response) }
  }

  it('answers ping, acknowledges cancel and runs a Search measurement with aggregates only', async () => {
    const { responses, post } = collectResponses()
    let clock = 0
    const controller = createPlannerAlternativeBenchmarkController(dependencies, post, { now: () => (clock += 1) })
    await controller.handleMessage({ type: 'pa3_benchmark_ping', pingId: 3 })
    await controller.handleMessage({ type: 'pa3_benchmark_cancel', requestId: 'other' })
    await controller.handleMessage({
      type: 'pa3_benchmark_search', requestId: 's1', input: tinySearchInput(), stopAfterCandidates: 1,
      recording: 'timing', instrumented: true, notifyFirstCandidate: true,
    })
    expect(responses.map(({ type }) => type)).toEqual([
      'pa3_benchmark_pong', 'pa3_benchmark_cancel_ack', 'pa3_benchmark_accepted',
      'pa3_benchmark_first_candidate', 'pa3_benchmark_search_result',
    ])
    const result = responses.at(-1)
    if (result?.type !== 'pa3_benchmark_search_result') throw new Error('no result')
    const m = result.measurement
    expect(m.deliveredCandidates).toBe(1)
    expect(m.timeToFirstCandidateMs).not.toBeNull()
    expect(m.workerElapsedMs).toBeGreaterThanOrEqual(m.timeToFirstCandidateMs!)
    expect(m.settledWorkItemsAtFirstCandidate).toBeGreaterThan(0)
    expect(m.settledWorkItemsTotal).toBeGreaterThanOrEqual(m.settledWorkItemsAtFirstCandidate!)
    expect(m.predictionCounts).toEqual({ predictNormalArtian: 0, predictSkills: 1, resetBonuses: 0, keepBonuses: 0 })
    expect(m.predictionCountsAtFirstCandidate).toEqual(m.predictionCounts)
    expect(m.skillStreams?.depths[0]).toMatchObject({ depth: 1, states: 1 })
    expect(m.firstCandidate).toMatchObject({ kind: 'existing_gogma_reset_skills', resetSkillsCount: 1 })
    expect(m.stoppedByConsumer).toBe(true)
    expect(m.parity).toBeNull()
    expect(JSON.stringify(result)).not.toContain('"operations"')
  })

  it('runs the exact Production call path when not instrumented, and adds a digest only in parity mode', async () => {
    const run = async (recording: 'timing' | 'parity', instrumented: boolean) => {
      const { responses, post } = collectResponses()
      const controller = createPlannerAlternativeBenchmarkController(dependencies, post)
      await controller.handleMessage({
        type: 'pa3_benchmark_search', requestId: 'p', recording, instrumented, notifyFirstCandidate: false,
        input: createLongHeldFixture('long_gogma_held', { heldLength: 4, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 6, maxSkillAdvance: 1 }, { idealPosition: 59 }).input,
        stopAfterCandidates: 6,
      })
      const result = responses.at(-1)
      if (result?.type !== 'pa3_benchmark_search_result') throw new Error(JSON.stringify(result))
      return result.measurement
    }
    const bare = await run('timing', false)
    expect(bare.settledWorkItemsTotal).toBeNull()
    expect(bare.predictionCounts).toBeNull()
    expect(bare.skillStreams).toBeNull()
    expect(bare.gogmaStreams).toBeNull()
    const parityA = await run('parity', true)
    const parityB = await run('parity', false)
    expect(parityA.parity?.candidateKeyDigest).toBe(parityB.parity?.candidateKeyDigest)
    expect(parityA.parity?.leadingCandidateKeys.length).toBeGreaterThan(0)
    expect(parityA.summary).toEqual(bare.summary)
    expect(parityA.deliveredCandidates).toBe(bare.deliveredCandidates)
  })

  it('cancels a running Search through shouldCancel at the macrotask yield', async () => {
    const { responses, post } = collectResponses()
    let controller: ReturnType<typeof createPlannerAlternativeBenchmarkController> | null = null
    let yields = 0
    controller = createPlannerAlternativeBenchmarkController(dependencies, post, {
      yieldControl: async () => {
        yields += 1
        if (yields === 1) await controller!.handleMessage({ type: 'pa3_benchmark_cancel', requestId: 'c1' })
      },
    })
    await controller.handleMessage({
      type: 'pa3_benchmark_search', requestId: 'c1', recording: 'timing', instrumented: true, notifyFirstCandidate: false,
      input: createLongHeldFixture('long_skill_held', { heldLength: 200, heldMode: 'held' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT).input,
      stopAfterCandidates: null,
    })
    expect(yields).toBeGreaterThan(0)
    expect(responses.map(({ type }) => type)).toEqual(['pa3_benchmark_accepted', 'pa3_benchmark_cancel_ack', 'pa3_benchmark_cancelled'])
  })

  it('reports an invalid request as an error without running anything', async () => {
    const { responses, post } = collectResponses()
    const controller = createPlannerAlternativeBenchmarkController(dependencies, post)
    const input = tinySearchInput()
    await controller.handleMessage({
      type: 'pa3_benchmark_search', requestId: 'e1', recording: 'timing', instrumented: true, notifyFirstCandidate: false,
      input: { ...input, extent: { ...input.extent, maxSkillAdvance: 0 } }, stopAfterCandidates: 1,
    })
    expect(responses.map(({ type }) => type)).toEqual(['pa3_benchmark_accepted', 'pa3_benchmark_error'])
    expect((responses[1] as { message: string }).message).toContain('maxSkillAdvance')
  })

  it('ignores a message that is not a benchmark request when attached', () => {
    const listeners: Array<(event: { data: unknown }) => void> = []
    const posted: unknown[] = []
    attachPlannerAlternativeBenchmarkWorker(
      { postMessage: (message) => posted.push(message), addEventListener: (_type, listener) => listeners.push(listener) },
      dependencies,
      isPlannerAlternativeBenchmarkRequest,
    )
    listeners[0]({ data: { type: 'plan', requestId: 'x' } })
    listeners[0]({ data: { type: 'pa3_benchmark_ping', pingId: 9 } })
    expect(posted).toEqual([{ type: 'pa3_benchmark_pong', pingId: 9 }])
  })

  describe('Kernel measurement', () => {
    let fixture: Issue101RealFixture
    beforeAll(async () => {
      fixture = await createIssue101RealFixture()
    }, SLOW)

    it('runs the Production Kernel, notifies the first trial and aggregates the found outcome', async () => {
      const { responses, post } = collectResponses()
      const controller = createPlannerAlternativeBenchmarkController(dependencies, post)
      await controller.handleMessage({
        type: 'pa3_benchmark_kernel', requestId: 'k1', instrumented: true, notifyFirstCandidate: true,
        request: createIssue101KernelRequest(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS),
      })
      expect(responses.map(({ type }) => type)).toEqual(['pa3_benchmark_accepted', 'pa3_benchmark_first_candidate', 'pa3_benchmark_kernel_result'])
      const result = responses[2]
      if (result.type !== 'pa3_benchmark_kernel_result') throw new Error('no result')
      expect(result.bounds).toEqual(BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS)
      expect(result.measurement.timeToFirstTrialMs).not.toBeNull()
      expect(result.measurement.predictionCounts?.predictSkills).toBeGreaterThan(0)
      expect(result.measurement.result).toMatchObject({
        status: 'completed', plannerRerunsUsed: 1, candidateTrials: 1,
        targets: [{ outcome: 'found', trials: 1, found: { generatedSelected: true, planStepCount: 444, trialConflictCount: 0 } }],
      })
    }, SLOW)

    it('cancels a Kernel at its first trial and reports the trials started', async () => {
      const { responses, post } = collectResponses()
      let controller: ReturnType<typeof createPlannerAlternativeBenchmarkController> | null = null
      controller = createPlannerAlternativeBenchmarkController(dependencies, (response) => {
        post(response)
        if (response.type === 'pa3_benchmark_first_candidate') {
          void controller!.handleMessage({ type: 'pa3_benchmark_cancel', requestId: 'k2' })
        }
      })
      await controller.handleMessage({
        type: 'pa3_benchmark_kernel', requestId: 'k2', instrumented: false, notifyFirstCandidate: true,
        request: createIssue101KernelRequest(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS),
      })
      const types = responses.map(({ type }) => type)
      expect(types).toContain('pa3_benchmark_cancel_ack')
      const last = responses.at(-1)
      expect(last).toMatchObject({ type: 'pa3_benchmark_cancelled', requestId: 'k2', deliveredCandidates: 1 })
    }, SLOW)
  })
})

describe('Planner Alternative benchmark runner', () => {
  interface FakeHarness extends PlannerAlternativeBenchmarkHarness {
    readonly runs: PlannerAlternativeHarnessRunOptions[]
    disposed: boolean
    cancelled: string[]
  }

  function fakeHarnessFactory(onRun?: (options: PlannerAlternativeHarnessRunOptions) => void) {
    const created: FakeHarness[] = []
    const createHarness = () => {
      const harness: FakeHarness = {
        runs: [],
        disposed: false,
        cancelled: [],
        run: async (options) => {
          harness.runs.push(options)
          onRun?.(options)
          const result: PlannerAlternativeRunResult = {
            requestId: options.requestId,
            // Contract stub only; never measurement evidence.
            outcome: { status: 'cancelled', workerElapsedMs: 1, deliveredCandidates: 0 },
            roundTripMs: 2,
            acceptedAtMs: 0,
            firstCandidateNoticeAtMs: null,
            cancel: null,
          }
          return result
        },
        cancel: (requestId) => {
          harness.cancelled.push(requestId)
          return true
        },
        ping: async () => 1,
        dispose: () => {
          harness.disposed = true
        },
      }
      created.push(harness)
      return harness
    }
    return { created, createHarness }
  }

  it('runs warm-up then measurements serially, each on a fresh disposed harness', async () => {
    const { created, createHarness } = fakeHarnessFactory()
    let id = 0
    const runner = createPlannerAlternativeBenchmarkRunner({
      createHarness,
      loadIssue101Fixture: () => Promise.reject(new Error('not needed')),
      createRequestId: () => `req-${++id}`,
      visibilityState: () => 'visible',
    })
    const records = await runner.runMeasurements({
      mode: 'search', workload: 'long_skill_held', extent: BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT,
      longHeld: { heldLength: 4, heldMode: 'held' }, stopAfterCandidates: 1, warmUp: 1, measurements: 3,
    })
    expect(records.map(({ phase }) => phase)).toEqual(['warm-up', 'measurement', 'measurement', 'measurement'])
    expect(new Set(records.map(({ id: recordId }) => recordId)).size).toBe(4)
    expect(created).toHaveLength(4)
    expect(created.every(({ disposed, runs }) => disposed && runs.length === 1)).toBe(true)
    expect(records[0]).toMatchObject({ mode: 'search', recording: 'timing', instrumented: true, bounds: null, longHeld: { heldLength: 4, heldMode: 'held' } })
    expect(runner.records()).toHaveLength(4)
    const summary = summarizePlannerAlternativeMeasurements(runner.records())
    expect(summary.measurementRecords).toBe(3)
    const parsed = JSON.parse(runner.exportJson({ userAgent: 'test' })) as { records: PlannerAlternativeBenchmarkRecord[]; environment: unknown }
    expect(parsed.records).toHaveLength(4)
    expect(parsed.environment).toEqual({ userAgent: 'test' })
    runner.clear()
    expect(runner.records()).toEqual([])
  })

  it('sends the run request as the first message of every fresh Worker, and only then pings', async () => {
    const workers: FakeWorker[] = []
    const types = (worker: FakeWorker) => worker.posted.map((message) => (message as { type: string }).type)
    const runner = createPlannerAlternativeBenchmarkRunner({
      createHarness: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        // Answer each run shortly after it is posted, leaving the pings unanswered.
        const post = worker.postMessage.bind(worker)
        worker.postMessage = (message: unknown) => {
          post(message)
          const request = message as { type: string; requestId?: string }
          if (request.type === 'pa3_benchmark_search' || request.type === 'pa3_benchmark_kernel') {
            globalThis.setTimeout(() => worker.emit('message', {
              type: 'pa3_benchmark_cancelled', requestId: request.requestId, workerElapsedMs: 1, deliveredCandidates: 0,
            }), 5)
          }
        }
        return createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker })
      },
      loadIssue101Fixture: () => Promise.reject(new Error('not needed')),
    })
    const records = await runner.runMeasurements({
      mode: 'search', workload: 'long_skill_held', extent: BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT,
      longHeld: { heldLength: 4, heldMode: 'held' }, stopAfterCandidates: 1, pingIntervalMs: 0, warmUp: 1, measurements: 2,
    })
    expect(records.map(({ phase }) => phase)).toEqual(['warm-up', 'measurement', 'measurement'])
    // One fresh Worker per run, each terminated after its run.
    expect(workers).toHaveLength(3)
    for (const worker of workers) {
      expect(types(worker)[0]).toBe('pa3_benchmark_search')
      expect(types(worker)[1]).toBe('pa3_benchmark_ping')
      expect(types(worker).slice(1).every((type) => type === 'pa3_benchmark_ping')).toBe(true)
      expect(worker.terminated).toBe(true)
      expect(worker.listenerCount()).toBe(0)
    }
    // The unanswered pings were released by dispose: nothing is left running.
    expect(runner.running()).toBe(false)
    expect(records.every(({ workerPings }) => workerPings === 0)).toBe(true)
  })

  it('posts the Kernel run request before the first ping too', async () => {
    const fixture = await createIssue101RealFixture()
    const worker = new FakeWorker()
    const runner = createPlannerAlternativeBenchmarkRunner({
      createHarness: () => createPlannerAlternativeBenchmarkHarness({ createWorker: () => worker }),
      loadIssue101Fixture: async () => fixture,
    })
    const running = runner.run({
      mode: 'kernel', workload: 'issue101_prefer_dragon_normal', extent: BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT,
      bounds: BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS, pingIntervalMs: 0,
    })
    for (let index = 0; index < 50 && worker.posted.length < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    const [first, second] = worker.posted as Array<{ type: string; requestId?: string; pingId?: number }>
    expect(first.type).toBe('pa3_benchmark_kernel')
    expect(second.type).toBe('pa3_benchmark_ping')
    worker.emit('message', { type: 'pa3_benchmark_pong', pingId: second.pingId })
    worker.emit('message', { type: 'pa3_benchmark_cancelled', requestId: first.requestId, workerElapsedMs: 1, deliveredCandidates: 0 })
    const record = await running
    expect(record.workerPings).toBeGreaterThanOrEqual(1)
    expect(worker.terminated).toBe(true)
  }, SLOW)

  it('never mixes warm-up into the medians', () => {
    const record = (phase: PlannerAlternativeBenchmarkRecord['phase'], workerElapsedMs: number): PlannerAlternativeBenchmarkRecord => {
      const response = searchResult('x')
      if (response.type !== 'pa3_benchmark_search_result') throw new Error('unreachable')
      return {
        id: `${phase}-${workerElapsedMs}`, sequence: 1, protocolVersion: 'x', mode: 'search', workload: 'long_skill_held', phase,
        extent: response.extent, bounds: null, longHeld: null, stopAfterCandidates: 1, recording: 'timing', instrumented: true,
        roundTripMs: workerElapsedMs + 1, acceptedAtMs: 0, firstCandidateNoticeAtMs: null, cancel: null, workerPings: 0,
        longestWorkerPingMs: null, visibilityState: 'visible',
        outcome: {
          status: 'search_completed',
          extent: response.extent,
          measurement: { ...response.measurement, workerElapsedMs, timeToFirstCandidateMs: workerElapsedMs },
        },
      }
    }
    const summary = summarizePlannerAlternativeMeasurements([record('warm-up', 1000), record('measurement', 10), record('measurement', 30), record('probe', 500)])
    expect(summary).toEqual({ measurementRecords: 2, completedRecords: 2, medianWorkerElapsedMs: 20, medianRoundTripMs: 21, medianTimeToFirstCandidateMs: 20 })
  })

  it('validates every option and builds the fixture before a Worker exists', async () => {
    const { created, createHarness } = fakeHarnessFactory()
    const runner = createPlannerAlternativeBenchmarkRunner({ createHarness, loadIssue101Fixture: () => Promise.reject(new Error('fixture failed')) })
    const extent = BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT
    await expect(runner.run({ mode: 'search', workload: 'long_skill_held', extent: { ...extent, maxSkillAdvance: 0 }, longHeld: { heldLength: 4, heldMode: 'held' }, stopAfterCandidates: 1 })).rejects.toThrow(RangeError)
    await expect(runner.run({ mode: 'search', workload: 'long_skill_held', extent, longHeld: { heldLength: 4, heldMode: 'held' } } as never)).rejects.toThrow('stopAfterCandidates')
    await expect(runner.run({ mode: 'search', workload: 'nope' as never, extent, stopAfterCandidates: 1 })).rejects.toThrow('Unknown Search workload')
    await expect(runner.run({ mode: 'kernel', workload: 'issue101_prefer_dragon_normal', extent, bounds: BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS })).rejects.toThrow('fixture failed')
    await expect(runner.runMeasurements({ mode: 'search', workload: 'long_skill_held', extent, longHeld: { heldLength: 4, heldMode: 'held' }, stopAfterCandidates: 1, warmUp: 0, measurements: 0 })).rejects.toThrow(RangeError)
    await expect(runner.run({ mode: 'search', workload: 'long_skill_held', extent, longHeld: { heldLength: 4, heldMode: 'held' }, stopAfterCandidates: 1, pingIntervalMs: -1 })).rejects.toThrow(RangeError)
    expect(created).toHaveLength(0)
  })

  it('loads the Issue #101 fixture once for every run that needs it', async () => {
    const { createHarness } = fakeHarnessFactory()
    const fixture = await createIssue101RealFixture()
    let loads = 0
    const runner = createPlannerAlternativeBenchmarkRunner({ createHarness, loadIssue101Fixture: async () => { loads += 1; return fixture } })
    await runner.run({ mode: 'search', workload: 'issue101_fire_dragon_fixed', extent: BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, stopAfterCandidates: 1 })
    await runner.run({ mode: 'kernel', workload: 'issue101_prefer_dragon_normal', extent: BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, bounds: BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS })
    expect(loads).toBe(1)
    expect(runner.records().map(({ mode, bounds }) => [mode, bounds])).toEqual([
      ['search', null], ['kernel', BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS],
    ])
  }, SLOW)

  it('cancel stops the running run and the rest of the series', async () => {
    let runner: ReturnType<typeof createPlannerAlternativeBenchmarkRunner> | null = null
    const { created, createHarness } = fakeHarnessFactory(() => {
      expect(runner!.running()).toBe(true)
      expect(runner!.cancel()).toBe(true)
    })
    runner = createPlannerAlternativeBenchmarkRunner({ createHarness, loadIssue101Fixture: () => Promise.reject(new Error('x')) })
    const records = await runner.runMeasurements({
      mode: 'search', workload: 'long_skill_held', extent: BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT,
      longHeld: { heldLength: 2, heldMode: 'held' }, stopAfterCandidates: 1, warmUp: 1, measurements: 3,
    })
    expect(records).toHaveLength(1)
    expect(created[0].cancelled).toHaveLength(1)
    expect(runner.running()).toBe(false)
    expect(runner.cancel()).toBe(false)
  })

  it('refuses a second concurrent run', async () => {
    let release: () => void = () => undefined
    const createHarness = (): PlannerAlternativeBenchmarkHarness => ({
      run: (options) => new Promise((resolve) => {
        release = () => resolve({ requestId: options.requestId, outcome: { status: 'error', message: 'stub' }, roundTripMs: 0, acceptedAtMs: null, firstCandidateNoticeAtMs: null, cancel: null })
      }),
      cancel: () => false,
      ping: async () => null,
      dispose: () => undefined,
    })
    const runner = createPlannerAlternativeBenchmarkRunner({ createHarness, loadIssue101Fixture: () => Promise.reject(new Error('x')) })
    const options = { mode: 'search' as const, workload: 'long_skill_held' as const, extent: BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT, longHeld: { heldLength: 1, heldMode: 'held' as const }, stopAfterCandidates: 1 }
    const first = runner.run(options)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(runner.run(options)).rejects.toThrow('already in progress')
    release()
    await first
  })
})

