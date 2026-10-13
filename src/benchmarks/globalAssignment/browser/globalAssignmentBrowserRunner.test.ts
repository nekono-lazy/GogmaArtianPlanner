import { describe, expect, it } from 'vitest'
import type { GlobalAssignmentBrowserControllerOptions } from './globalAssignment.worker.benchmark'
import { createGlobalAssignmentBrowserHarness, type GabWorkerLike, type GlobalAssignmentBrowserHarness } from './globalAssignmentBrowserHarness'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, type GabResponse, type GabRunRequest } from './globalAssignmentBrowserProtocol'
import {
  createGlobalAssignmentBrowserRunner, gabLogicalRunOptionIssues, summarizeGabPings,
  type GabExportSource, type GabLogicalRunOptions, type GlobalAssignmentBrowserRunnerDependencies,
} from './globalAssignmentBrowserRunner'
import { InProcessWorker, READY_ENVIRONMENT, SYNTHETIC_EXECUTION, SYNTHETIC_SPEC, syntheticControllerOptions, syntheticExport, type SyntheticExport } from './globalAssignmentBrowserTestFixture'

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

/** A runner whose harnesses run the real controller in this realm; it records every Worker it created. */
function inProcessRunner(controllerOptions: () => GlobalAssignmentBrowserControllerOptions, extra: Partial<GlobalAssignmentBrowserRunnerDependencies> = {}) {
  const workers: InProcessWorker[] = []
  const harnesses: GlobalAssignmentBrowserHarness[] = []
  const created: { index: number; previousTerminated: boolean }[] = []
  const runner = createGlobalAssignmentBrowserRunner({
    createHarness: () => {
      const harness = createGlobalAssignmentBrowserHarness({
        createWorker: () => {
          created.push({ index: workers.length, previousTerminated: workers.every(worker => worker.terminated) })
          const worker = new InProcessWorker(controllerOptions())
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
    expect(cancelledRun.cancel).toMatchObject({ source: 'trigger', acceptedByRequest: 'gab.run-1.first', triggered: { onProgressKey: 'materialization:context' } })
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

    const tampered = scriptedRunner(request => [{ type: 'gab_result', protocolVersion: V, requestId: request.requestId, result: {
      protocolVersion: V, requestId: request.requestId, role: 'first', environment: READY_ENVIRONMENT, exportObservation: { ...synthetic.identity, matchesRequest: true },
      calculationContext: {}, rngEngineVersion: 'v', materialization: { semantic: { outcome: { kind: 'scan_cancelled' } }, semanticSha256: 'f'.repeat(64) }, entrySet: null, verification: null, integrityIssues: [],
    } }])
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
    expect(hanging.runner.cancel('ui')).toBe(true)
    const record = await pending
    expect(hanging.workers).toEqual(['first'])
    expect(record.first).toMatchObject({ settle: 'cancelled', settlement: { settledBy: 'gab_cancelled', cancel: { source: 'ui' } } })
    expect(record.first.audit!.requests).toEqual([expect.objectContaining({ cancelAccepted: true, adoptedResults: 0, settleCount: 1 })])
    expect(record.fresh.notRunReason).toBe('the logical run was cancelled')
    expect(record.cancel).toMatchObject({ source: 'ui', acceptedByRequest: 'gab.run-1.first' })
    // Idle: a cancel does nothing.
    expect(hanging.runner.cancel('ui')).toBe(false)
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
