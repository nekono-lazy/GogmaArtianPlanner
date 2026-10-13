import { describe, expect, it } from 'vitest'
import type { GlobalAssignmentBrowserControllerOptions } from './globalAssignment.worker.benchmark'
import { createGlobalAssignmentBrowserHarness, type GabWorkerLike, type GlobalAssignmentBrowserHarness } from './globalAssignmentBrowserHarness'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, type GabResponse, type GabRunRequest } from './globalAssignmentBrowserProtocol'
import { d1aEntrySetIssues } from '../verificationProtocol'
import {
  createGlobalAssignmentBrowserRunner, gabLogicalRunOptionIssues, gabWebCryptoSha256Text, summarizeGabPings,
  type GabExportSource, type GabLogicalRunOptions, type GabLogicalRunRecord, type GabMemorySampler, type GlobalAssignmentBrowserRunnerDependencies,
} from './globalAssignmentBrowserRunner'
import {
  deferred, InProcessWorker, READY_ENVIRONMENT, SYNTHETIC_EXECUTION, SYNTHETIC_IDENTITY, SYNTHETIC_SPEC, syntheticControllerOptions, syntheticExport, syntheticWorkerResult,
  type SyntheticExport,
} from './globalAssignmentBrowserTestFixture'

/*
 * Issue #154 Production準備 P-1: the runner of logical runs. The first Worker settles and is terminated before a fresh Worker is
 * created; only a completed, intact first Worker with an Entry set hands that Entry set over (C10); nothing is carried from one logical
 * run to the next; a cancel, a page leave, an integrity issue or a Worker failure is never a measurement. The integration cases run the
 * real controller, stage module and Research calculation in this realm (a synthetic scenario and table Engine; no real Export).
 */

const V = GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION

/** Waits (macrotask by macrotask) until `predicate` holds. */
async function until(predicate: () => boolean, limit = 200): Promise<void> {
  for (let turn = 0; turn < limit && !predicate(); turn += 1) await new Promise(resolve => setTimeout(resolve, 0))
  if (!predicate()) throw new Error('The condition never held.')
}
const MAIN ={ isSecureContext: true, crossOriginIsolated: false, cryptoSubtle: true, build: null }

function runOptions(overrides: Partial<GabLogicalRunOptions> = {}): GabLogicalRunOptions {
  return {
    slot: { slotId: 'p1-test', purpose: 'pilot', planned: false, note: null }, execution: { ...SYNTHETIC_EXECUTION },
    envelope: { firstWallMs: 600_000, freshWallMs: 600_000, cancelGraceMs: 10_000, readyTimeoutMs: 10_000 }, exportTransport: 'array_buffer', ...overrides,
  }
}

function sourceOf(synthetic: Pick<SyntheticExport, 'bytes' | 'identity'>): GabExportSource {
  return { file: new File([synthetic.bytes.slice(0)], synthetic.identity.fileName, { type: 'application/json' }), identity: { ...synthetic.identity } }
}

/**
 * A runner whose harnesses run the real controller in this realm; it records every Worker it created. `transformFor` (tests of a
 * malformed Worker) replaces what the main thread receives from the Worker with that index.
 */
function inProcessRunner(controllerOptions: () => GlobalAssignmentBrowserControllerOptions, extra: Partial<GlobalAssignmentBrowserRunnerDependencies> = {}, transformFor: (index: number) => ((message: GabResponse) => unknown) | undefined = () => undefined) {
  const workers: InProcessWorker[] = []
  const harnesses: GlobalAssignmentBrowserHarness[] = []
  const created: { index: number; previousTerminated: boolean }[] = []
  const runner = createGlobalAssignmentBrowserRunner({
    createHarness: () => {
      const harness = createGlobalAssignmentBrowserHarness({
        createWorker: () => {
          created.push({ index: workers.length, previousTerminated: workers.every(worker => worker.terminated) })
          const worker = new InProcessWorker(controllerOptions(), undefined, transformFor(workers.length))
          workers.push(worker)
          return worker
        },
      })
      harnesses.push(harness)
      return harness
    },
    mainEnvironment: () => MAIN, canCloneBlob: () => false, visibilityState: () => 'visible', subscribeLifecycle: () => () => undefined, sleep: async () => undefined, clock: () => 'T',
    ...extra,
  })
  return { runner, workers, harnesses, created }
}

describe('P-1 runner: one logical run', () => {
  it('runs first -> terminate -> fresh -> terminate and judges browser_nonformal_conditions_met (real controller, synthetic scenario)', async () => {
    const synthetic = await syntheticExport()
    const { runner, workers, created } = inProcessRunner(() => syntheticControllerOptions(synthetic))
    const record = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(workers).toHaveLength(2)
    expect(created).toEqual([{ index: 0, previousTerminated: true }, { index: 1, previousTerminated: true }])
    expect(workers.every(worker => worker.terminated)).toBe(true)
    expect(record.first).toMatchObject({ role: 'first', requestId: 'gab.run-1.first', settle: 'completed', exportTransport: 'array_buffer', environmentIssues: [] })
    expect(record.fresh).toMatchObject({ role: 'fresh', requestId: 'gab.run-1.fresh', settle: 'completed', notRunReason: null })
    expect(record.first.rehash).toMatchObject({ materialization: { matched: true }, verification: { matched: true }, entrySet: { matched: true } })
    expect(record.fresh.rehash).toMatchObject({ materialization: null, verification: { matched: true }, entrySet: null })
    expect(record.integrityIssues).toEqual([])
    expect(record.judgement.verdict).toMatchObject({ kind: 'browser_nonformal_conditions_met', planningTargetCount: 2, fullPlannerRuns: { first: 1, fresh: 1 } })
    expect(record.judgement.recordClassification).toBe('browser_nonformal_conditions_met')
    expect(record.judgement.crossWorker).toEqual({ compared: true, identical: true, differingFields: [] })
    // The fresh Worker received exactly the first Worker's Entry set, and each request settled once with no late message.
    const freshRequest = workers[1]!.posted.find(message => (message as { type: string }).type === 'gab_run') as GabRunRequest
    expect(freshRequest.entrySet).toEqual(record.first.settlement!.result!.entrySet!.value)
    for (const worker of [record.first, record.fresh]) expect(worker.audit!.requests).toEqual([expect.objectContaining({ settleCount: 1, cancelAccepted: false, adoptedResults: 1 })])
    expect(record).toMatchObject({ slot: { slotId: 'p1-test', purpose: 'pilot', planned: false }, formal: false, oracleFreeExecution: true, cancel: null, lifecycle: { interrupted: false } })
  }, 120_000)

  it('sends the Blob itself when the Browser can clone one, and its bytes otherwise, with the same semantic result', async () => {
    const synthetic = await syntheticExport()
    const viaBlob = inProcessRunner(() => syntheticControllerOptions(synthetic), { canCloneBlob: () => true })
    const blob = await viaBlob.runner.runLogicalRun(sourceOf(synthetic), runOptions({ exportTransport: 'auto' }))
    const viaBytes = inProcessRunner(() => syntheticControllerOptions(synthetic), { canCloneBlob: () => false })
    const bytes = await viaBytes.runner.runLogicalRun(sourceOf(synthetic), runOptions({ exportTransport: 'auto' }))
    expect(blob.first.exportTransport).toBe('blob')
    expect(bytes.first.exportTransport).toBe('array_buffer')
    expect(blob.first.settlement!.result!.verification!.semanticSha256).toBe(bytes.first.settlement!.result!.verification!.semanticSha256)
    expect(blob.judgement.verdict.kind).toBe('browser_nonformal_conditions_met')
  }, 120_000)

  it('C10: a first Worker without an Entry set (Phase 0 unsupported_input) starts no fresh Worker and is phase_d_prime_not_reached', async () => {
    const synthetic = await syntheticExport(SYNTHETIC_SPEC, input => ({ ...input, buildListEntries: [] }))
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic))
    const record = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(workers).toHaveLength(1)
    expect(record.fresh).toMatchObject({ settle: 'not_run', notRunReason: 'the first Worker returned no Entry set (no all_materialized handoff)', settlement: null })
    expect(record.judgement.verdict).toEqual({ kind: 'phase_d_prime_not_reached', run: 'first', materializationOutcome: { kind: 'unsupported_input', stage: 'context', reason: 'no_planning_target' } })
  }, 60_000)

  it('never carries anything from one logical run to the next: new Workers, new request IDs, the run\'s own Entry set, identical semantics', async () => {
    const synthetic = await syntheticExport()
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic))
    const one = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    const two = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(workers).toHaveLength(4)
    expect([one.first.requestId, one.fresh.requestId, two.first.requestId, two.fresh.requestId]).toEqual(['gab.run-1.first', 'gab.run-1.fresh', 'gab.run-2.first', 'gab.run-2.fresh'])
    const freshTwo = workers[3]!.posted.find(message => (message as { type: string }).type === 'gab_run') as GabRunRequest
    expect(freshTwo.entrySet).toEqual(two.first.settlement!.result!.entrySet!.value)
    // The second run materialized again (its own first Worker) and agrees with the first run.
    expect(two.first.settlement!.result!.materialization!.semanticSha256).toBe(one.first.settlement!.result!.materialization!.semanticSha256)
    expect(two.fresh.settlement!.result!.verification!.semanticSha256).toBe(one.fresh.settlement!.result!.verification!.semanticSha256)
    expect(runner.records().map(record => record.id)).toEqual(['run-1', 'run-2'])
  }, 120_000)

  it('race 8: after a cancelled logical run a new one completes, with no adopted result from the cancelled request and the same semantics as an uncancelled run', async () => {
    const synthetic = await syntheticExport()
    // Timer yields: the Worker dispatches the cancel between two calculation slices, like a real Worker.
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic, { yieldFor: () => () => new Promise(resolve => setTimeout(resolve, 0)) }), {
      setTimer: callback => { callback(); return null }, clearTimer: () => undefined,
    })
    const cancelledRun = await runner.runLogicalRun(sourceOf(synthetic), runOptions({ cancelTrigger: { role: 'first', onProgressKey: 'materialization:context', delayMs: 0 } }))
    expect(workers).toHaveLength(1)
    expect(cancelledRun.cancel).toMatchObject({ source: 'trigger', phase: 'request_running', acceptedByRequest: 'gab.run-1.first', triggered: { onProgressKey: 'materialization:context' } })
    expect(cancelledRun.first.settle).toBe('cancelled')
    expect(cancelledRun.first.audit!.requests).toEqual([expect.objectContaining({ cancelAccepted: true, adoptedResults: 0, settleCount: 1 })])
    expect(cancelledRun.first.settlement!.result).toBeNull()
    expect(cancelledRun.fresh).toMatchObject({ settle: 'not_run', notRunReason: 'the logical run was cancelled' })
    expect(cancelledRun.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled', browserSettle: 'cancelled' })
    const next = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    const reference = await inProcessRunner(() => syntheticControllerOptions(synthetic)).runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(next.judgement.verdict.kind).toBe('browser_nonformal_conditions_met')
    expect(next.fresh.settlement!.result!.verification!.semanticSha256).toBe(reference.fresh.settlement!.result!.verification!.semanticSha256)
    expect(next.first.settlement!.result!.materialization!.semanticSha256).toBe(reference.first.settlement!.result!.materialization!.semanticSha256)
    const freshNext = workers[2]!.posted.find(message => (message as { type: string }).type === 'gab_run') as GabRunRequest
    expect(freshNext.entrySet).toEqual(next.first.settlement!.result!.entrySet!.value)
  }, 120_000)
})

/** A Worker double answering like the controller with a scripted terminal message (C10 / integrity cases without a calculation). */
function scriptedRunner(script: (request: GabRunRequest) => (GabResponse | Record<string, unknown>)[], extra: Partial<GlobalAssignmentBrowserRunnerDependencies> = {}) {
  const workers: string[] = []
  const runner = createGlobalAssignmentBrowserRunner({
    createHarness: () => createGlobalAssignmentBrowserHarness({
      createWorker: () => {
        const listeners = new Set<(event: Event) => void>()
        const emit = (data: unknown) => { for (const listener of [...listeners]) listener({ data } as MessageEvent) }
        const worker: GabWorkerLike = {
          postMessage: message => {
            const request = message as GabRunRequest
            if (request.type === 'gab_run') { workers.push(request.role); queueMicrotask(() => { for (const response of script(request)) emit(response) }) }
            if ((message as { type: string }).type === 'gab_ping') queueMicrotask(() => emit({ type: 'gab_pong', protocolVersion: V, pingId: (message as { pingId: number }).pingId }))
            if ((message as { type: string }).type === 'gab_cancel') {
              const requestId = (message as { requestId: string }).requestId
              queueMicrotask(() => {
                emit({ type: 'gab_cancel_ack', protocolVersion: V, requestId })
                emit({ type: 'gab_cancelled', protocolVersion: V, requestId, observed: { stoppedAt: 'phase_a', via: 'cancel_point', elapsedMs: 1, yields: 0, maxSliceMs: 1 } })
              })
            }
          },
          addEventListener: (type, listener) => { if (type === 'message') listeners.add(listener) },
          removeEventListener: (type, listener) => { if (type === 'message') listeners.delete(listener) },
          terminate: () => undefined,
        }
        queueMicrotask(() => emit({ type: 'gab_ready', protocolVersion: V, environment: READY_ENVIRONMENT }))
        return worker
      },
    }),
    mainEnvironment: () => MAIN, canCloneBlob: () => false, visibilityState: () => 'visible', subscribeLifecycle: () => () => undefined, sleep: async () => undefined, clock: () => 'T',
    ...extra,
  })
  return { runner, workers }
}

describe('P-1 runner: C10, integrity and the unmeasured paths (scripted Workers)', () => {
  const synthetic = { bytes: new ArrayBuffer(4), identity: { fileName: 'synthetic.json', bytes: 4, sha256: 'a'.repeat(64) } }

  it('starts no fresh Worker after a first Worker error, an export_changed refusal, a rehash mismatch or an environment refusal', async () => {
    const error = scriptedRunner(request => [{ type: 'gab_error', protocolVersion: V, requestId: request.requestId, error: { code: 'calculation_failed', stage: 'phase_a', errorName: 'Error', message: 'x' } }])
    const errored = await error.runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(error.workers).toEqual(['first'])
    expect(errored.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'process_failure', browserSettle: 'worker_reported_error' })
    expect(errored.fresh.notRunReason).toBe('the first Worker settled as worker_reported_error')

    const changed = scriptedRunner(request => [{ type: 'gab_error', protocolVersion: V, requestId: request.requestId, error: { code: 'export_changed', stage: 'export_hash', errorName: 'GlobalAssignmentBrowserStageError', message: 'other bytes' } }])
    const refused = await changed.runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(changed.workers).toEqual(['first'])
    expect(refused.judgement.verdict).toEqual({ kind: 'invalid_run_integrity', issues: ['first: the Worker refused the run (export_changed): other bytes'] })

    // A structurally valid result whose recorded materialization SHA-256 is not the hash of its record.
    const tampered = scriptedRunner(request => [{ type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: syntheticWorkerResult(request.requestId) }])
    const mismatched = await tampered.runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(tampered.workers).toEqual(['first'])
    expect(mismatched.first.rehash.materialization).toMatchObject({ worker: 'f'.repeat(64), matched: false })
    expect(mismatched.judgement.verdict.kind).toBe('invalid_run_integrity')

    const unsupported = scriptedRunner(() => [], { mainEnvironment: () => ({ ...MAIN, isSecureContext: false }) })
    const refusedEnvironment = await unsupported.runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(unsupported.workers).toEqual([])
    expect(refusedEnvironment.first).toMatchObject({ settle: 'environment_unsupported', environmentIssues: ['The page is not a secure context (Web Crypto needs one).'] })
    expect(refusedEnvironment.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'environment_unsupported', browserSettle: 'environment_unsupported' })
  })

  it('records a page leave as page_left (no fresh Worker), a ready failure as worker_error, and a hidden page as an interrupted run', async () => {
    let lifecycle: ((type: string) => void) | null = null
    let visibility = 'visible'
    const left = scriptedRunner(() => [], { subscribeLifecycle: listener => { lifecycle = listener; return () => { lifecycle = null } }, visibilityState: () => visibility })
    const pending = left.runner.runLogicalRun(sourceOf(synthetic), runOptions())
    await until(() => left.workers.length === 1)
    visibility = 'hidden'
    lifecycle!('visibilitychange')
    lifecycle!('pagehide')
    const record = await pending
    expect(left.workers).toEqual(['first'])
    expect(record.first.settle).toBe('page_left')
    expect(record.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled', browserSettle: 'page_left' })
    expect(record.lifecycle).toMatchObject({ interrupted: true, pageLeft: true, events: [{ type: 'visibilitychange', visibilityState: 'hidden' }, { type: 'pagehide' }] })
    expect(lifecycle).toBeNull()

    const neverReady = createGlobalAssignmentBrowserRunner({
      createHarness: () => createGlobalAssignmentBrowserHarness({ createWorker: () => ({ postMessage: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, terminate: () => undefined }) }),
      mainEnvironment: () => MAIN, subscribeLifecycle: () => () => undefined, sleep: async () => undefined,
    })
    const notReady = await neverReady.runLogicalRun(sourceOf(synthetic), runOptions({ envelope: { firstWallMs: 1_000, freshWallMs: 1_000, cancelGraceMs: 1_000, readyTimeoutMs: 1 } }))
    expect(notReady.first).toMatchObject({ settle: 'worker_error', harnessError: expect.stringContaining('never became ready') })
  })

  it('refuses a second logical run while one runs and invalid options; a UI cancel ends the run with no fresh Worker', async () => {
    const hanging = scriptedRunner(request => [{ type: 'gab_accepted', protocolVersion: V, requestId: request.requestId, role: request.role, acceptedAtEpochMs: 1 }])
    const pending = hanging.runner.runLogicalRun(sourceOf(synthetic), runOptions())
    await expect(hanging.runner.runLogicalRun(sourceOf(synthetic), runOptions())).rejects.toThrow(/already running \(concurrency 1\)/)
    await until(() => hanging.workers.length === 1)
    expect(hanging.runner.running()).toBe(true)
    expect(hanging.runner.cancel('ui')).toEqual({ kind: 'request_cancel_accepted', role: 'first', requestId: 'gab.run-1.first' })
    const record = await pending
    expect(hanging.workers).toEqual(['first'])
    expect(record.first).toMatchObject({ settle: 'cancelled', settlement: { settledBy: 'gab_cancelled', cancel: { source: 'ui' } } })
    expect(record.first.audit!.requests).toEqual([expect.objectContaining({ cancelAccepted: true, adoptedResults: 0, settleCount: 1 })])
    expect(record.fresh.notRunReason).toBe('the logical run was cancelled')
    expect(record.cancel).toMatchObject({ source: 'ui', phase: 'request_running', role: 'first', acceptedByRequest: 'gab.run-1.first' })
    // Idle: a cancel does nothing.
    expect(hanging.runner.cancel('ui')).toEqual({ kind: 'idle' })
    expect(gabLogicalRunOptionIssues(runOptions({ slot: { slotId: 'x y', purpose: 'other' as never, planned: false, note: null } }))).toEqual([
      'slot.slotId must be 1..64 characters of [A-Za-z0-9._:-].', 'slot.purpose must be one of timing, rerun, responsiveness, memory, cancel, pilot.',
    ])
    await expect(hanging.runner.runLogicalRun(sourceOf(synthetic), runOptions({ envelope: { firstWallMs: 0, freshWallMs: 1, cancelGraceMs: 1, readyTimeoutMs: 1 } }))).rejects.toThrow(/envelope.firstWallMs/)
  })

  it('exports the raw records as JSON for a git-ignored file only, and summarizes pings without inventing values', async () => {
    const synthetic = await syntheticExport()
    const { runner } = inProcessRunner(() => syntheticControllerOptions(synthetic))
    const record = await runner.runLogicalRun(sourceOf(synthetic), runOptions({ ping: { timeoutMs: 5_000 } }))
    expect(record.first.ping!.count).toBeGreaterThan(0)
    // Only a ping still pending when the request settled can be lost; none is sent to the terminated Worker afterwards.
    expect(record.first.ping!.lost).toBeLessThanOrEqual(1)
    const exported = JSON.parse(runner.exportJson({ note: 'env' }))
    expect(exported).toMatchObject({ kind: 'global-assignment-browser-raw', protocolVersion: V, formal: false, exportedAt: 'T', environment: { note: 'env' } })
    expect(exported.handling).toMatch(/git-ignored \.local\/ directory, never commit/)
    expect(exported.records).toHaveLength(1)
    expect(JSON.stringify(exported)).not.toMatch(/"exportPayload"|"bytes":\{\}/)
    expect(summarizeGabPings([3, null, 1, 2])).toEqual({ count: 4, lost: 1, medianMs: 2, p95Ms: 3, maxMs: 3, samplesMs: [3, 1, 2] })
    expect(summarizeGabPings([])).toMatchObject({ count: 0, medianMs: null, maxMs: null })
    runner.clear()
    expect(runner.records()).toEqual([])
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------------------------------
// PR #257 Required fixes: every async boundary before the post is driven by hand (Deferred), so a cancel or a page leave lands
// exactly while the Export is read, while the Worker starts, or between the Workers.
// ---------------------------------------------------------------------------------------------------------------------

/** A Worker double the test drives: it answers a request with `respond(request)`, a cancel with gab_cancelled, and is ready when told. */
interface DrivenWorker extends GabWorkerLike {
  posted: Record<string, unknown>[]
  terminated: number
  emit(data: unknown): void
  ready(): void
}

function drivenRunner(options: { autoReady?: boolean; respond?: (request: GabRunRequest) => unknown[] } = {}, extra: Partial<GlobalAssignmentBrowserRunnerDependencies> = {}) {
  const workers: DrivenWorker[] = []
  const runner = createGlobalAssignmentBrowserRunner({
    createHarness: () => createGlobalAssignmentBrowserHarness({
      createWorker: () => {
        const listeners = new Set<(event: Event) => void>()
        const worker: DrivenWorker = {
          posted: [], terminated: 0,
          emit: data => { for (const listener of [...listeners]) listener({ data } as MessageEvent) },
          ready: () => worker.emit({ type: 'gab_ready', protocolVersion: V, environment: READY_ENVIRONMENT }),
          postMessage: message => {
            const record = message as Record<string, unknown>
            worker.posted.push(record)
            if (record.type === 'gab_run' && options.respond) queueMicrotask(() => { for (const response of options.respond!(message as GabRunRequest)) worker.emit(response) })
            if (record.type === 'gab_cancel') {
              queueMicrotask(() => worker.emit({ type: 'gab_cancelled', protocolVersion: V, requestId: record.requestId, observed: { stoppedAt: 'phase_a', via: 'cancel_point', elapsedMs: 1, yields: 0, maxSliceMs: 1 } }))
            }
          },
          addEventListener: (type, listener) => { if (type === 'message') listeners.add(listener) },
          removeEventListener: (type, listener) => { if (type === 'message') listeners.delete(listener) },
          terminate: () => { worker.terminated += 1 },
        }
        workers.push(worker)
        if (options.autoReady !== false) queueMicrotask(() => worker.ready())
        return worker
      },
    }),
    mainEnvironment: () => MAIN, canCloneBlob: () => false, visibilityState: () => 'visible', subscribeLifecycle: () => () => undefined, sleep: async () => undefined, clock: () => 'T',
    ...extra,
  })
  return { runner, workers }
}

/** An Export whose n-th `arrayBuffer()` read waits for `gates[n]` (the main thread's read before a request is posted). */
function gatedSource(synthetic: Pick<SyntheticExport, 'bytes' | 'identity'>, gates: Record<number, Promise<void>> = {}) {
  let reads = 0
  const file = { arrayBuffer: async () => { reads += 1; await gates[reads]; return synthetic.bytes.slice(0) } } as unknown as Blob
  return { source: { file, identity: { ...synthetic.identity } } as GabExportSource, reads: () => reads }
}

/** A memory sampler whose fixed point `label` waits for `gates[label]` (a place between the runner's steps the test can stop at). */
function gatedMemory(gates: Record<string, Promise<void>> = {}) {
  const requested: string[] = []
  const sampler: GabMemorySampler = {
    availability: () => ({ measureUserAgentSpecificMemory: false, performanceMemory: false, crossOriginIsolated: false }),
    sample: async (label, atMs) => { requested.push(label); await gates[label]; return { label, atMs, userAgentSpecific: { status: 'unavailable', reason: 'test' }, mainRealm: null } },
  }
  return { sampler, requested }
}

const runsPosted = (worker: { posted: unknown[] }) => worker.posted.filter(message => (message as { type?: string }).type === 'gab_run')
const acceptedFor = (request: GabRunRequest) => ({ type: 'gab_accepted', protocolVersion: V, requestId: request.requestId, role: request.role, acceptedAtEpochMs: 1 })

/** A request that was never posted: no settlement, no audit entry, nothing adopted (no settlement is invented for it). */
function expectNeverPosted(record: GabLogicalRunRecord, role: 'first' | 'fresh', stop: 'cancel' | 'page_left') {
  expect(record[role]).toMatchObject({ settle: 'not_run', stoppedBeforeRequest: stop, requestStarted: false, settlement: null, harnessError: null, runnerError: null })
  expect(record[role].audit?.requests ?? []).toEqual([])
}

describe('PR #257 Required fix 1: no request is posted after a cancel or a page leave', () => {
  const synthetic = { bytes: new ArrayBuffer(4), identity: { ...SYNTHETIC_IDENTITY } }

  it('(1) / (6) / (7) / (8) a cancel during the main thread\'s Export read posts no gab_run, disposes that Worker at once and starts no other', async () => {
    const read = deferred()
    const { source, reads } = gatedSource(synthetic, { 1: read.promise })
    const { runner, workers } = drivenRunner({ respond: request => [acceptedFor(request), { type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: syntheticWorkerResult(request.requestId) }] })
    const pending = runner.runLogicalRun(source, runOptions())
    await until(() => reads() === 1)
    expect(workers).toHaveLength(1)
    expect(runner.cancel('ui')).toEqual({ kind: 'logical_run_stop_recorded', phase: 'before_request', role: 'first' })
    // The Worker without a request goes now, not after the read; a second cancel changes nothing.
    expect(workers[0]!.terminated).toBe(1)
    expect(runner.cancel('ui')).toEqual({ kind: 'already_stopping', reason: 'cancel' })
    read.resolve()
    const record = await pending
    expect(runsPosted(workers[0]!)).toEqual([])
    expectNeverPosted(record, 'first', 'cancel')
    expect(record.first.notRunReason).toBe('the logical run was cancelled while the Export was read; no request was posted')
    expect(record.fresh).toMatchObject({ settle: 'not_run', notRunReason: 'the logical run was cancelled', settlement: null })
    expect(record.cancel).toEqual({ source: 'ui', requestedAtMs: expect.any(Number), phase: 'before_request', role: 'first', acceptedByRequest: null, triggered: null })
    expect(record.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled', browserSettle: 'not_run' })
    expect(workers).toHaveLength(1)
    expect([runner.running(), runner.current()]).toEqual([false, null])
    expect(runner.cancel('ui')).toEqual({ kind: 'idle' })
  })

  it('(2) a page leave during the Export read posts no gab_run and disposes that Worker at once', async () => {
    const read = deferred()
    const { source, reads } = gatedSource(synthetic, { 1: read.promise })
    let lifecycle: ((type: string) => void) | null = null
    const { runner, workers } = drivenRunner({ respond: () => [] }, { subscribeLifecycle: listener => { lifecycle = listener; return () => { lifecycle = null } } })
    const pending = runner.runLogicalRun(source, runOptions())
    await until(() => reads() === 1)
    lifecycle!('pagehide')
    expect(workers[0]!.terminated).toBe(1)
    expect(runner.cancel('ui')).toEqual({ kind: 'already_stopping', reason: 'page_left' })
    read.resolve()
    const record = await pending
    expect(runsPosted(workers[0]!)).toEqual([])
    expectNeverPosted(record, 'first', 'page_left')
    expect(record.first.notRunReason).toBe('the page was left while the Export was read; no request was posted')
    expect(record).toMatchObject({ cancel: null, lifecycle: { pageLeft: true, interrupted: true }, fresh: { settle: 'not_run', notRunReason: 'the page was left' } })
    expect(record.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled', browserSettle: 'not_run' })
    expect(lifecycle).toBeNull()
    expect(runner.running()).toBe(false)
  })

  it('(3) a cancel while the Worker starts ends its ready wait at once (no ready timeout), posts nothing and is no Worker failure', async () => {
    const { runner, workers } = drivenRunner({ autoReady: false, respond: () => [] })
    const pending = runner.runLogicalRun(gatedSource(synthetic).source, runOptions({ envelope: { firstWallMs: 600_000, freshWallMs: 600_000, cancelGraceMs: 10_000, readyTimeoutMs: 600_000 } }))
    await until(() => workers.length === 1)
    expect(runner.cancel('ui')).toEqual({ kind: 'logical_run_stop_recorded', phase: 'before_request', role: 'first' })
    expect(workers[0]!.terminated).toBe(1)
    const record = await pending
    // A ready message after the cancel reaches nothing (the listeners are gone).
    workers[0]!.ready()
    expect(runsPosted(workers[0]!)).toEqual([])
    expectNeverPosted(record, 'first', 'cancel')
    expect(record.first.notRunReason).toBe('the logical run was cancelled while the Worker was starting; no request was posted')
    expect(record.first.createToReadyMs).toBeNull()
    expect(record.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled', browserSettle: 'not_run' })
    expect(workers).toHaveLength(1)
    expect(runner.running()).toBe(false)
  })

  it('(4) / (7) / (8) a cancel after the first Worker completed and before the fresh one is created creates no fresh Worker', async () => {
    const synthetic = await syntheticExport()
    for (const [label, expected] of [
      ['fresh:before_worker_create', { kind: 'logical_run_stop_recorded', phase: 'between_workers', role: null }],
      ['first:after_dispose', { kind: 'logical_run_stop_recorded', phase: 'between_workers', role: null }],
      ['first:settled', { kind: 'logical_run_stop_recorded', phase: 'after_request_settled', role: 'first' }],
    ] as const) {
      const gate = deferred()
      const { sampler, requested } = gatedMemory({ [label]: gate.promise })
      const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic), { memory: sampler })
      const pending = runner.runLogicalRun(gatedSource(synthetic).source, runOptions({ memory: { gcWaitMs: 0 } }))
      await until(() => requested.includes(label), 2_000)
      expect(runner.cancel('ui'), label).toEqual(expected)
      gate.resolve()
      const record = await pending
      expect(workers, label).toHaveLength(1)
      expect(workers[0]!.terminated, label).toBe(true)
      // The first request's result was adopted before the cancel and stands as recorded; the logical run is no measurement.
      expect(record.first, label).toMatchObject({ settle: 'completed', requestStarted: true })
      expect(record.first.audit!.requests, label).toEqual([expect.objectContaining({ adoptedResults: 1, settleCount: 1, cancelAccepted: false })])
      expect(record.fresh.settle, label).toBe('not_run')
      expect(record.fresh.audit, label).toBeNull()
      expect(record.fresh.requestStarted, label).toBe(false)
      expect(record.judgement.verdict, label).toEqual({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled', browserSettle: 'not_run' })
      expect(record.cancel, label).toMatchObject({ phase: expected.phase, role: expected.role, acceptedByRequest: null })
      expect(runner.running(), label).toBe(false)
    }
  }, 120_000)

  it('(5) / (9) / (10) a cancel during the fresh Worker\'s Export read posts no fresh gab_run; the next logical run completes with its own Entry set and the same semantics', async () => {
    const synthetic = await syntheticExport()
    const read = deferred()
    const gated = gatedSource(synthetic, { 2: read.promise })
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic))
    const pending = runner.runLogicalRun(gated.source, runOptions())
    await until(() => gated.reads() === 2, 2_000)
    expect(workers).toHaveLength(2)
    expect(runner.cancel('ui')).toEqual({ kind: 'logical_run_stop_recorded', phase: 'before_request', role: 'fresh' })
    expect(workers[1]!.terminated).toBe(true)
    read.resolve()
    const cancelled = await pending
    expect(runsPosted(workers[1]!)).toEqual([])
    expectNeverPosted(cancelled, 'fresh', 'cancel')
    expect(cancelled.fresh.notRunReason).toBe('the logical run was cancelled while the Export was read; no request was posted')
    expect(cancelled.first.settle).toBe('completed')
    expect(cancelled.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled', browserSettle: 'not_run' })
    // (9) / (10): the next logical run starts from nothing of the cancelled one and meets the conditions like an uncancelled run.
    const next = await runner.runLogicalRun(gatedSource(synthetic).source, runOptions())
    const reference = await inProcessRunner(() => syntheticControllerOptions(synthetic)).runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(workers).toHaveLength(4)
    expect(next.judgement.verdict.kind).toBe('browser_nonformal_conditions_met')
    expect(next.cancel).toBeNull()
    expect([next.first.requestId, next.fresh.requestId]).toEqual(['gab.run-2.first', 'gab.run-2.fresh'])
    const freshRequest = runsPosted(workers[3]!)[0] as unknown as GabRunRequest
    expect(freshRequest.entrySet).toEqual(next.first.settlement!.result!.entrySet!.value)
    expect(next.first.settlement!.result!.materialization!.semanticSha256).toBe(reference.first.settlement!.result!.materialization!.semanticSha256)
    expect(next.fresh.settlement!.result!.verification!.semanticSha256).toBe(reference.fresh.settlement!.result!.verification!.semanticSha256)
  }, 120_000)

  it('(8) a cancel recorded after both requests completed (before the run ended) still never makes the logical run conditions_met', async () => {
    const synthetic = await syntheticExport()
    const gate = deferred()
    const { sampler, requested } = gatedMemory({ 'fresh:settled': gate.promise })
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic), { memory: sampler })
    const pending = runner.runLogicalRun(gatedSource(synthetic).source, runOptions({ memory: { gcWaitMs: 0 } }))
    await until(() => requested.includes('fresh:settled'), 2_000)
    expect(runner.cancel('ui')).toEqual({ kind: 'logical_run_stop_recorded', phase: 'after_request_settled', role: 'fresh' })
    gate.resolve()
    const record = await pending
    expect(workers).toHaveLength(2)
    expect([record.first.settle, record.fresh.settle]).toEqual(['completed', 'completed'])
    expect(record.judgement.verdict).toEqual({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled', browserSettle: 'completed' })
    expect(record.judgement.crossWorker).toEqual({ compared: true, identical: true, differingFields: [] })
  }, 120_000)
})

describe('PR #257 Required fix 2: a malformed Worker response or a failing check fails the logical run closed and leaves nothing behind', () => {
  const synthetic = { bytes: new ArrayBuffer(4), identity: { ...SYNTHETIC_IDENTITY } }
  const POISON = 'poisoned-payload'

  it('adopts no malformed result or body, records it as worker_error + invalid_run_integrity, restores the runner, and runs again', async () => {
    const semanticSha256 = await gabWebCryptoSha256Text(JSON.stringify(syntheticWorkerResult('x').materialization!.semantic))
    const good = (request: GabRunRequest) => {
      const valid = syntheticWorkerResult(request.requestId)
      return [acceptedFor(request), { type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: { ...valid, materialization: { ...valid.materialization!, semanticSha256 } } }]
    }
    const poisoned = (request: GabRunRequest) => syntheticWorkerResult(request.requestId, POISON) as unknown as Record<string, unknown>
    const withResult = (request: GabRunRequest, value: unknown) => [acceptedFor(request), { type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: value }]
    const without = (request: GabRunRequest, key: string) => { const value = poisoned(request); delete value[key]; return value }
    const cases: [string, (request: GabRunRequest) => unknown[]][] = [
      ['result null', request => withResult(request, null)],
      ['result primitive', request => withResult(request, 42)],
      ['exportObservation missing', request => withResult(request, without(request, 'exportObservation'))],
      ['exportObservation fields missing', request => withResult(request, { ...poisoned(request), exportObservation: { fileName: 'synthetic.json' } })],
      ['materialization malformed', request => withResult(request, { ...poisoned(request), materialization: { semantic: { outcome: null }, semanticSha256: 'x' } })],
      ['verification malformed', request => withResult(request, { ...poisoned(request), verification: { semantic: { outcome: { kind: 'conditions_met' } } } })],
      ['entrySet malformed', request => withResult(request, { ...poisoned(request), entrySet: { value: { kind: 'other' }, sha256: 'x' } })],
      ['integrityIssues not an array', request => withResult(request, { ...poisoned(request), integrityIssues: { count: 0 } })],
      ['gab_progress without its event', request => [acceptedFor(request), { type: 'gab_progress', protocolVersion: V, requestId: request.requestId, atMs: 1 }, ...good(request).slice(1)]],
      ['gab_heartbeat without its numbers', request => [acceptedFor(request), { type: 'gab_heartbeat', protocolVersion: V, requestId: request.requestId, heartbeat: { stage: 'phase_a' } }, ...good(request).slice(1)]],
    ]
    for (const [name, bad] of cases) {
      let respond = bad
      const states: boolean[] = []
      const { runner, workers } = drivenRunner({ respond: request => respond(request) }, { onChange: state => { states.push(state.running) } })
      const record = await runner.runLogicalRun(gatedSource(synthetic).source, runOptions())
      expect(record.first, name).toMatchObject({ settle: 'worker_error', requestStarted: true, settlement: { outcome: 'worker_error', settledBy: 'protocol_violation', result: null } })
      expect(record.first.audit!.requests, name).toEqual([expect.objectContaining({ adoptedResults: 0, settleCount: 1 })])
      expect(record.first.audit!.invalidResponses, name).toBe(1)
      expect(record.integrityIssues[0], name).toMatch(/^first: the Worker sent a malformed or unrequested response \(Malformed(Result|Response)\): Malformed gab_/)
      expect(record.judgement.verdict.kind, name).toBe('invalid_run_integrity')
      expect(record.fresh, name).toMatchObject({ settle: 'not_run', notRunReason: 'the first Worker settled as worker_error' })
      expect(JSON.stringify(record), name).not.toContain(POISON)
      // Nothing is left behind: not running, no current request, the Worker terminated, the last notification says idle.
      expect(workers, name).toHaveLength(1)
      expect(workers[0]!.terminated, name).toBeGreaterThanOrEqual(1)
      expect([runner.running(), runner.current(), states.at(-1)], name).toEqual([false, null, false])
      // The next logical run works and adopts its own result.
      respond = good
      const next = await runner.runLogicalRun(gatedSource(synthetic).source, runOptions())
      expect(next.first, name).toMatchObject({ settle: 'completed', requestId: 'gab.run-2.first' })
      expect(next.integrityIssues, name).toEqual([])
      expect(next.judgement.verdict, name).toEqual({ kind: 'phase_d_prime_not_reached', run: 'first', materializationOutcome: { kind: 'no_structural_candidate', reason: 'the-calculation' } })
    }
  })

  it('records a re-hash that throws (or cannot hash a record at all) as an integrity issue, never as a result', async () => {
    const respond = (request: GabRunRequest) => [acceptedFor(request), { type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: syntheticWorkerResult(request.requestId) }]
    const failing = drivenRunner({ respond }, { sha256Text: async () => { throw new Error('digest failed') } })
    const failed = await failing.runner.runLogicalRun(gatedSource(synthetic).source, runOptions())
    expect(failed.first).toMatchObject({ settle: 'completed', rehashError: 'Error: digest failed', runnerError: null })
    expect(failed.integrityIssues).toContain('first: the main thread could not re-hash the adopted result: Error: digest failed')
    expect(failed.judgement.verdict.kind).toBe('invalid_run_integrity')
    expect(failed.fresh.notRunReason).toBe('the first Worker\'s record has integrity issues')
    expect([failing.runner.running(), failing.workers[0]!.terminated >= 1]).toEqual([false, true])
    // A record the main thread cannot serialize (a cycle the structured clone kept) is the same integrity failure.
    const cyclicResult = (request: GabRunRequest) => {
      const value = syntheticWorkerResult(request.requestId) as unknown as { materialization: { semantic: Record<string, unknown> } }
      value.materialization.semantic.self = value.materialization.semantic
      return [acceptedFor(request), { type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: value }]
    }
    const cyclic = drivenRunner({ respond: cyclicResult })
    const unhashable = await cyclic.runner.runLogicalRun(gatedSource(synthetic).source, runOptions())
    expect(unhashable.first.rehashError).toMatch(/^TypeError: /)
    expect(unhashable.judgement.verdict.kind).toBe('invalid_run_integrity')
    expect(cyclic.runner.running()).toBe(false)
  })

  it('records an integrity check that throws (the Entry set check) as an integrity issue, starts no fresh Worker, and the next run carries nothing over', async () => {
    const synthetic = await syntheticExport()
    let failCheck = true
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic), {
      entrySetIssues: (...args) => { if (failCheck) throw new Error('check failed'); return d1aEntrySetIssues(...args) },
    })
    const failed = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(failed.integrityIssues).toEqual(['first: the Entry set check failed: Error: check failed'])
    expect(failed.judgement.verdict).toEqual({ kind: 'invalid_run_integrity', issues: ['first: the Entry set check failed: Error: check failed'] })
    expect(failed.fresh.notRunReason).toBe('the first Worker\'s record has integrity issues')
    expect(workers).toHaveLength(1)
    expect(runner.running()).toBe(false)
    failCheck = false
    const next = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(next.judgement.verdict.kind).toBe('browser_nonformal_conditions_met')
    const freshRequest = workers[2]!.posted.find(message => (message as { type: string }).type === 'gab_run') as GabRunRequest
    expect(freshRequest.entrySet).toEqual(next.first.settlement!.result!.entrySet!.value)
  }, 120_000)

  it('drops a malformed result of the real controller path, and the next logical run hands over only its own Entry set', async () => {
    const synthetic = await syntheticExport()
    // The first logical run's first Worker sends a result whose integrityIssues is not an array (everything else is the real result).
    const corrupt = (message: GabResponse) => (message.type === 'gab_result' ? { ...message, result: { ...message.result, integrityIssues: 'none' } } : message)
    const { runner, workers } = inProcessRunner(() => syntheticControllerOptions(synthetic), {}, index => (index === 0 ? corrupt : undefined))
    const bad = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(bad.first).toMatchObject({ settle: 'worker_error', settlement: { settledBy: 'protocol_violation', result: null } })
    expect(bad.judgement.verdict.kind).toBe('invalid_run_integrity')
    expect(workers).toHaveLength(1)
    expect(workers[0]!.terminated).toBe(true)
    expect(runner.running()).toBe(false)
    const next = await runner.runLogicalRun(sourceOf(synthetic), runOptions())
    const reference = await inProcessRunner(() => syntheticControllerOptions(synthetic)).runner.runLogicalRun(sourceOf(synthetic), runOptions())
    expect(next.judgement.verdict.kind).toBe('browser_nonformal_conditions_met')
    const freshRequest = workers[2]!.posted.find(message => (message as { type: string }).type === 'gab_run') as GabRunRequest
    expect(freshRequest.entrySet).toEqual(next.first.settlement!.result!.entrySet!.value)
    expect(next.fresh.settlement!.result!.verification!.semanticSha256).toBe(reference.fresh.settlement!.result!.verification!.semanticSha256)
  }, 120_000)
})
