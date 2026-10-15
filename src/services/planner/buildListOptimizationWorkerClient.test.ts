import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BuildListOptimizationResult } from '../../domain/planner/buildListOptimization'
import {
  createBuildListOptimizationTestInput,
  createOptimizedBuildListOptimizationTestResult,
} from '../../test/fixtures/buildListOptimizationWorkerFixtures'
import {
  BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION,
  buildListOptimizationWorkerResponseIssues,
  type BuildListOptimizationWorkerRequest,
} from '../../workers/buildListOptimizationWorkerContracts'
import {
  BuildListOptimizationWorkerClientDisposedError,
  BuildListOptimizationWorkerUnavailableError,
  createBuildListOptimizationWorkerClient,
  createProductionBuildListOptimizationWorkerClient,
  type BuildListOptimizationPageLifecycle,
  type BuildListOptimizationRunOutcome,
  type BuildListOptimizationWorkerClientOptions,
  type BuildListOptimizationWorkerEvent,
  type BuildListOptimizationWorkerLike,
} from './buildListOptimizationWorkerClient'

type EventType = 'message' | 'error' | 'messageerror'
type Listener = (event: BuildListOptimizationWorkerEvent) => void

/** A deterministic stand-in for one dedicated Worker. */
class FakeWorker implements BuildListOptimizationWorkerLike {
  readonly posted: BuildListOptimizationWorkerRequest[] = []
  readonly listeners: Record<EventType, Set<Listener>> = { message: new Set(), error: new Set(), messageerror: new Set() }
  /** Every message listener ever added, kept after removal to model a message already queued before it. */
  readonly everAddedMessageListeners: Listener[] = []
  terminated = 0

  postMessage(message: BuildListOptimizationWorkerRequest): void {
    this.posted.push(structuredClone(message))
  }

  addEventListener(type: EventType, listener: Listener): void {
    this.listeners[type].add(listener)
    if (type === 'message') this.everAddedMessageListeners.push(listener)
  }

  removeEventListener(type: EventType, listener: Listener): void {
    this.listeners[type].delete(listener)
  }

  terminate(): void {
    this.terminated += 1
  }

  emit(type: EventType, event: BuildListOptimizationWorkerEvent = {}): void {
    for (const listener of [...this.listeners[type]]) listener(event)
  }

  message(data: unknown): void {
    this.emit('message', { data: structuredClone(data) })
  }

  /** Delivers to every message listener ever added, removed ones included. */
  lateMessage(data: unknown): void {
    for (const listener of this.everAddedMessageListeners) listener({ data: structuredClone(data) })
  }

  get listenerCount(): number {
    return this.listeners.message.size + this.listeners.error.size + this.listeners.messageerror.size
  }

  get requestId(): string {
    return this.posted[0]!.requestId
  }
}

class FakePageLifecycle implements BuildListOptimizationPageLifecycle {
  readonly listeners = new Set<() => void>()
  addEventListener(_type: 'pagehide', listener: () => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'pagehide', listener: () => void): void {
    this.listeners.delete(listener)
  }
  hide(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

const NOT_FOUND: BuildListOptimizationResult = {
  status: 'not_found',
  reason: 'candidates_rejected',
  diagnostics: { reachTable: null, structuralSearch: null, candidates: [], plannerVerifications: 1, elapsedMs: null },
}

let optimized: Extract<BuildListOptimizationResult, { status: 'optimized' }>
beforeAll(async () => {
  optimized = await createOptimizedBuildListOptimizationTestResult()
})

function setUp(overrides: Partial<BuildListOptimizationWorkerClientOptions> = {}) {
  const workers: FakeWorker[] = []
  const page = new FakePageLifecycle()
  let sequence = 0
  const client = createBuildListOptimizationWorkerClient({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    createRequestId: () => `run-${++sequence}`,
    pageLifecycle: page,
    ...overrides,
  })
  return { client, workers, page }
}

/** Records when the outcome Promise settles, and with what. */
function track(outcome: Promise<BuildListOptimizationRunOutcome>) {
  const settled: BuildListOptimizationRunOutcome[] = []
  void outcome.then((value) => {
    settled.push(value)
  })
  return settled
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Build List optimization Worker Client: a normal run', () => {
  it('posts one well-formed request on a new Worker, reports the stages in order, and completes once with the checked result', async () => {
    const { client, workers, page } = setUp()
    const stages: string[] = []
    const input = createBuildListOptimizationTestInput()
    const handle = client.run(input, { onStage: stage => stages.push(stage) })
    expect(client.getState()).toBe('running')
    expect(workers).toHaveLength(1)
    const [worker] = workers
    expect(worker!.posted).toEqual([{ type: 'blo_run', protocolVersion: BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION, requestId: 'run-1', input }])
    expect(Object.keys(worker!.posted[0]!).sort()).toEqual(['input', 'protocolVersion', 'requestId', 'type'])
    expect(handle.requestId).toBe('run-1')
    expect(page.listeners.size).toBe(1)

    for (const stage of ['input_check', 'reach_table', 'assignment_search', 'route_generation', 'plan_verification']) {
      worker!.message({ type: 'blo_progress', requestId: 'run-1', stage })
    }
    expect(stages).toEqual(['input_check', 'reach_table', 'assignment_search', 'route_generation', 'plan_verification'])
    expect(client.getState()).toBe('running')

    worker!.message({ type: 'blo_result', requestId: 'run-1', result: optimized })
    // Settled synchronously: terminated and released at once.
    expect(client.getState()).toBe('completed')
    expect(worker!.terminated).toBe(1)
    expect(worker!.listenerCount).toBe(0)
    expect(page.listeners.size).toBe(0)
    const outcome = await handle.outcome
    expect(outcome).toEqual({ status: 'completed', requestId: 'run-1', result: optimized })

    // A second result for the settled run is never applied.
    const settled = track(handle.outcome)
    worker!.lateMessage({ type: 'blo_result', requestId: 'run-1', result: NOT_FOUND })
    await Promise.resolve()
    expect(settled).toEqual([outcome])
    expect(worker!.terminated).toBe(1)
  })

  it('ignores a message naming another requestId, and a progress after the result', async () => {
    const { client, workers } = setUp()
    const stages: string[] = []
    const handle = client.run(createBuildListOptimizationTestInput(), { onStage: stage => stages.push(stage) })
    const worker = workers[0]!
    worker.message({ type: 'blo_progress', requestId: 'run-0', stage: 'reach_table' })
    worker.message({ type: 'blo_result', requestId: 'another', result: NOT_FOUND })
    worker.message({ type: 'blo_error', requestId: 'another', stage: null, code: 'calculation_failed', domainCode: null, message: 'x' })
    expect(client.getState()).toBe('running')
    expect(stages).toEqual([])
    worker.message({ type: 'blo_result', requestId: 'run-1', result: NOT_FOUND })
    worker.lateMessage({ type: 'blo_progress', requestId: 'run-1', stage: 'plan_verification' })
    expect(stages).toEqual([])
    expect(await handle.outcome).toEqual({ status: 'completed', requestId: 'run-1', result: NOT_FOUND })
  })

  it('never ends a run by itself: no wall-clock timeout', async () => {
    vi.useFakeTimers()
    const { client, workers } = setUp()
    const handle = client.run(createBuildListOptimizationTestInput())
    const settled = track(handle.outcome)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(client.getState()).toBe('running')
    expect(settled).toEqual([])
    expect(workers[0]!.terminated).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Build List optimization Worker Client: cancel and re-run', () => {
  it('cancels synchronously and terminates at once, without waiting for any acknowledgement', async () => {
    const { client, workers } = setUp()
    const handle = client.run(createBuildListOptimizationTestInput())
    const worker = workers[0]!
    handle.cancel()
    expect(client.getState()).toBe('cancelled')
    expect(worker.terminated).toBe(1)
    expect(worker.listenerCount).toBe(0)
    // The Worker was never sent a cancel message: termination is the cancel.
    expect(worker.posted.map(message => message.type)).toEqual(['blo_run'])
    // A result that was already queued is never applied: the cancelled run adopts nothing.
    worker.lateMessage({ type: 'blo_result', requestId: 'run-1', result: optimized })
    worker.lateMessage({ type: 'blo_progress', requestId: 'run-1', stage: 'plan_verification' })
    expect(await handle.outcome).toEqual({ status: 'cancelled', requestId: 'run-1', reason: 'cancelled' })
    expect(client.getState()).toBe('cancelled')
    handle.cancel()
    expect(worker.terminated).toBe(1)
  })

  it('cancels the current run through the Client too, and does nothing when idle', async () => {
    const { client, workers } = setUp()
    client.cancel()
    expect(client.getState()).toBe('idle')
    const handle = client.run(createBuildListOptimizationTestInput())
    client.cancel()
    expect(workers[0]!.terminated).toBe(1)
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'cancelled' })
  })

  it('runs each run on a new Worker with a new requestId; a new run supersedes the running one and old messages never reach it', async () => {
    const { client, workers } = setUp()
    const stages: string[] = []
    const first = client.run(createBuildListOptimizationTestInput(), { onStage: stage => stages.push(`first:${stage}`) })
    const second = client.run(createBuildListOptimizationTestInput(), { onStage: stage => stages.push(`second:${stage}`) })
    expect(workers).toHaveLength(2)
    expect(first.requestId).not.toBe(second.requestId)
    expect(workers[0]!.terminated).toBe(1)
    expect(await first.outcome).toEqual({ status: 'cancelled', requestId: 'run-1', reason: 'superseded' })
    expect(client.getState()).toBe('running')

    // A late message of the first Worker, under either requestId, never reaches the second run.
    workers[0]!.lateMessage({ type: 'blo_result', requestId: 'run-1', result: optimized })
    workers[0]!.lateMessage({ type: 'blo_result', requestId: 'run-2', result: optimized })
    workers[0]!.lateMessage({ type: 'blo_progress', requestId: 'run-2', stage: 'reach_table' })
    expect(client.getState()).toBe('running')
    // The second Worker's message for the first requestId is ignored too.
    workers[1]!.message({ type: 'blo_result', requestId: 'run-1', result: optimized })
    expect(client.getState()).toBe('running')

    workers[1]!.message({ type: 'blo_progress', requestId: 'run-2', stage: 'input_check' })
    workers[1]!.message({ type: 'blo_result', requestId: 'run-2', result: NOT_FOUND })
    expect(await second.outcome).toEqual({ status: 'completed', requestId: 'run-2', result: NOT_FOUND })
    expect(stages).toEqual(['second:input_check'])

    // A re-run after completion starts fresh: no result is carried over.
    const third = client.run(createBuildListOptimizationTestInput())
    expect(client.getState()).toBe('running')
    expect(workers).toHaveLength(3)
    expect(third.requestId).toBe('run-3')
    third.cancel()
  })

  it('cancels on pagehide and releases the pagehide listener with the run', async () => {
    const { client, workers, page } = setUp()
    const handle = client.run(createBuildListOptimizationTestInput())
    page.hide()
    expect(client.getState()).toBe('cancelled')
    expect(workers[0]!.terminated).toBe(1)
    expect(page.listeners.size).toBe(0)
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'page_hidden' })
  })

  it('cancels on dispose and refuses every later run', async () => {
    const { client, workers } = setUp()
    const handle = client.run(createBuildListOptimizationTestInput())
    client.dispose()
    expect(client.getState()).toBe('disposed')
    expect(workers[0]!.terminated).toBe(1)
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'disposed' })
    expect(() => client.run(createBuildListOptimizationTestInput())).toThrow(BuildListOptimizationWorkerClientDisposedError)
    expect(workers).toHaveLength(1)
    client.dispose()
    expect(client.getState()).toBe('disposed')
  })
})

describe('Build List optimization Worker Client: failures', () => {
  it('fails closed on the Worker error and messageerror events without presuming their cause', async () => {
    const errored = setUp()
    const first = errored.client.run(createBuildListOptimizationTestInput())
    errored.workers[0]!.emit('error', { message: 'Uncaught RangeError: Array buffer allocation failed' })
    expect(errored.client.getState()).toBe('failed')
    expect(errored.workers[0]!.terminated).toBe(1)
    expect(await first.outcome).toEqual({ status: 'failed', requestId: 'run-1', failure: { kind: 'worker_error', message: 'Uncaught RangeError: Array buffer allocation failed' } })

    const silent = setUp()
    const second = silent.client.run(createBuildListOptimizationTestInput())
    silent.workers[0]!.emit('error', {})
    expect(await second.outcome).toMatchObject({ status: 'failed', failure: { kind: 'worker_error', message: null } })

    const messageError = setUp()
    const third = messageError.client.run(createBuildListOptimizationTestInput())
    messageError.workers[0]!.emit('messageerror')
    expect(messageError.workers[0]!.terminated).toBe(1)
    expect(await third.outcome).toMatchObject({ status: 'failed', failure: { kind: 'worker_message_error' } })
  })

  it('keeps a calculation error an error with its code, never an unsupported or not_found result', async () => {
    const { client, workers } = setUp()
    const handle = client.run(createBuildListOptimizationTestInput())
    workers[0]!.message({ type: 'blo_error', requestId: 'run-1', stage: 'plan_verification', code: 'invariant_violation', domainCode: 'objective_mismatch', message: 'identity broken' })
    expect(await handle.outcome).toEqual({
      status: 'failed', requestId: 'run-1',
      failure: { kind: 'calculation_error', code: 'invariant_violation', domainCode: 'objective_mismatch', stage: 'plan_verification', message: 'identity broken' },
    })
  })

  it('fails closed on a malformed message for this run and on a result body that fails the structural check', async () => {
    const malformed = setUp()
    const first = malformed.client.run(createBuildListOptimizationTestInput())
    malformed.workers[0]!.message({ type: 'blo_progress', requestId: 'run-1', stage: 'reach_table', completionRate: 0.4 })
    expect(malformed.workers[0]!.terminated).toBe(1)
    expect(await first.outcome).toMatchObject({ status: 'failed', failure: { kind: 'protocol_violation', issues: ['progress.completionRate is not a protocol field.'] } })

    const invalid = setUp()
    const second = invalid.client.run(createBuildListOptimizationTestInput())
    const broken = structuredClone(optimized)
    broken.artifact.plannerResult.termination.status = 'incomplete'
    invalid.workers[0]!.message({ type: 'blo_result', requestId: 'run-1', result: broken })
    const outcome = await second.outcome
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed' || outcome.failure.kind !== 'invalid_result') throw new Error('expected invalid_result')
    expect(outcome.failure.issues).toContain('result.artifact.plannerResult.termination.status must be completed.')

    const application = setUp()
    const third = application.client.run(createBuildListOptimizationTestInput())
    application.workers[0]!.message({ type: 'blo_result', requestId: 'run-1', result: { status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] } })
    expect(await third.outcome).toMatchObject({ status: 'failed', failure: { kind: 'invalid_result' } })
  })

  it('ignores only a message validly addressed to another request: the current run continues and completes', async () => {
    const { client, workers } = setUp()
    const stages: string[] = []
    const handle = client.run(createBuildListOptimizationTestInput(), { onStage: stage => stages.push(stage) })
    const worker = workers[0]!
    worker.message({ type: 'blo_result', requestId: 'run-0', result: optimized })
    worker.message({ type: 'blo_error', requestId: 'another-run', stage: null, code: 'calculation_failed', domainCode: null, message: 'x' })
    // Even a malformed body is someone else's when it validly names another request.
    worker.message({ type: 'blo_progress', requestId: 'another-run', stage: 'not_a_stage' })
    expect(client.getState()).toBe('running')
    expect(worker.terminated).toBe(0)
    worker.message({ type: 'blo_progress', requestId: 'run-1', stage: 'input_check' })
    worker.message({ type: 'blo_result', requestId: 'run-1', result: optimized })
    expect(stages).toEqual(['input_check'])
    expect(await handle.outcome).toEqual({ status: 'completed', requestId: 'run-1', result: optimized })
  })

  it('fails closed on a message addressed to nobody: protocol violation, terminated, released, settled once', async () => {
    const result = NOT_FOUND
    const unaddressed: [string, unknown][] = [
      ['null', null],
      ['a string', 'blo_result'],
      ['a number', 42],
      ['an array', [{ type: 'blo_result', requestId: 'run-1', result }]],
      ['no requestId', { type: 'blo_result', result }],
      ['a null requestId', { type: 'blo_result', requestId: null, result }],
      ['an empty requestId', { type: 'blo_result', requestId: '', result }],
      ['a numeric requestId', { type: 'blo_result', requestId: 1, result }],
      ['a broken envelope for this run', { type: 'blo_result', requestId: 'run-1' }],
    ]
    for (const [label, data] of unaddressed) {
      const { client, workers, page } = setUp()
      const stages: string[] = []
      const handle = client.run(createBuildListOptimizationTestInput(), { onStage: stage => stages.push(stage) })
      const settled = track(handle.outcome)
      const worker = workers[0]!
      worker.message(data)
      expect(client.getState(), label).toBe('failed')
      expect(worker.terminated, label).toBe(1)
      expect(worker.listenerCount, label).toBe(0)
      expect(page.listeners.size, label).toBe(0)
      // Neither a later valid result nor a progress of the same Worker is applied, and the outcome stays the first one.
      worker.lateMessage({ type: 'blo_progress', requestId: 'run-1', stage: 'reach_table' })
      worker.lateMessage({ type: 'blo_result', requestId: 'run-1', result: optimized })
      worker.emit('error', { message: 'late' })
      const outcome = await handle.outcome
      await Promise.resolve()
      expect(outcome, label).toEqual({ status: 'failed', requestId: 'run-1', failure: { kind: 'protocol_violation', issues: buildListOptimizationWorkerResponseIssues(data) } })
      expect(outcome.status === 'failed' && outcome.failure.kind === 'protocol_violation' && outcome.failure.issues.length > 0, label).toBe(true)
      expect(settled, label).toEqual([outcome])
      expect(stages, label).toEqual([])
      expect(client.getState(), label).toBe('failed')
      expect(worker.terminated, label).toBe(1)
    }
  })

  it('fails an optimized result reporting a Conflict as invalid_result, terminates and adopts nothing later', async () => {
    const { client, workers } = setUp()
    const handle = client.run(createBuildListOptimizationTestInput())
    const settled = track(handle.outcome)
    const worker = workers[0]!
    const broken = structuredClone(optimized)
    broken.artifact.plannerResult.plan!.conflicts = [{ id: 'conflict.x' } as never]
    worker.message({ type: 'blo_result', requestId: 'run-1', result: broken })
    expect(client.getState()).toBe('failed')
    expect(worker.terminated).toBe(1)
    expect(worker.listenerCount).toBe(0)
    worker.lateMessage({ type: 'blo_result', requestId: 'run-1', result: optimized })
    const outcome = await handle.outcome
    await Promise.resolve()
    if (outcome.status !== 'failed' || outcome.failure.kind !== 'invalid_result') throw new Error('expected invalid_result')
    expect(outcome.failure.issues).toContain('result.artifact.plannerResult.plan.conflicts must be empty.')
    expect(settled).toEqual([outcome])
  })

  it('reports a missing Web Worker explicitly and never calculates on the main thread', async () => {
    const original = (globalThis as { Worker?: unknown }).Worker
    delete (globalThis as { Worker?: unknown }).Worker
    try {
      const client = createProductionBuildListOptimizationWorkerClient()
      const handle = client.run(createBuildListOptimizationTestInput())
      expect(client.getState()).toBe('failed')
      expect(await handle.outcome).toMatchObject({ status: 'failed', failure: { kind: 'worker_unavailable', message: new BuildListOptimizationWorkerUnavailableError().message } })
    } finally {
      if (original !== undefined) (globalThis as { Worker?: unknown }).Worker = original
    }
  })

  it('reports a Worker that cannot be created or posted to as a start failure, and releases it', async () => {
    const creation = setUp({ createWorker: () => { throw new Error('blocked by policy') } })
    expect(await creation.client.run(createBuildListOptimizationTestInput()).outcome).toMatchObject({ status: 'failed', failure: { kind: 'worker_start_failed', message: 'blocked by policy' } })

    const posting = new FakeWorker()
    posting.postMessage = () => { throw new DOMException('could not be cloned', 'DataCloneError') }
    const post = setUp({ createWorker: () => posting })
    const handle = post.client.run(createBuildListOptimizationTestInput())
    expect(posting.terminated).toBe(1)
    expect(posting.listenerCount).toBe(0)
    expect(await handle.outcome).toMatchObject({ status: 'failed', failure: { kind: 'worker_start_failed' } })
  })

  it('needs no window: with no page lifecycle the run still starts and settles', async () => {
    const { client, workers } = setUp({ pageLifecycle: null })
    const handle = client.run(createBuildListOptimizationTestInput())
    workers[0]!.message({ type: 'blo_result', requestId: 'run-1', result: NOT_FOUND })
    expect(await handle.outcome).toMatchObject({ status: 'completed' })
  })
})
