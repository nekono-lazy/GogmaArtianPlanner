import { describe, expect, it } from 'vitest'
import {
  createGlobalAssignmentBrowserHarness, gabEnvironmentIssues,
  type GabRequestSettlement, type GabRunOptions, type GabTimers, type GlobalAssignmentBrowserHarness,
} from './globalAssignmentBrowserHarness'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION } from './globalAssignmentBrowserProtocol'
import { READY_ENVIRONMENT, ScriptedWorker, SYNTHETIC_EXECUTION, SYNTHETIC_IDENTITY, syntheticWorkerResult } from './globalAssignmentBrowserTestFixture'

/*
 * Issue #154 Production準備 P-1 (design 7.8 / 10 / 16.1): the main-thread request lifecycle is the only guarantee that a cancelled
 * request's result is never adopted. A scripted Worker lets each test decide when a message the Worker already sent reaches the main
 * thread, so every race of design 16.1 is reproduced deterministically. Every case asserts: results adopted from a request whose cancel
 * was accepted = 0, and exactly one settlement per request.
 */

const V = GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION
const IDENTITY = { fileName: 'synthetic.json', bytes: 4, sha256: 'a'.repeat(64) }

/** Timers the test fires by hand. */
function manualTimers(): GabTimers & { fire(ms: number): void; pending(): number[] } {
  let next = 1
  const timers = new Map<number, { callback: () => void; ms: number }>()
  return {
    setTimeout: (callback, ms) => { const id = next++; timers.set(id, { callback, ms }); return id },
    clearTimeout: handle => { timers.delete(handle as number) },
    fire: ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback() } },
    pending: () => [...timers.values()].map(timer => timer.ms),
  }
}

function setup() {
  const worker = new ScriptedWorker()
  const timers = manualTimers()
  let clock = 0
  const harness = createGlobalAssignmentBrowserHarness({ createWorker: () => worker, now: () => (clock += 10), timers })
  return { worker, timers, harness }
}

function options(requestId = 'gab.run-1.first', overrides: Partial<GabRunOptions> = {}): GabRunOptions {
  return {
    requestId, role: 'first', exportPayload: { kind: 'array_buffer', bytes: new ArrayBuffer(4) }, exportIdentity: { ...IDENTITY }, entrySet: null,
    execution: { ...SYNTHETIC_EXECUTION }, workerWallMs: 60_000, cancelGraceMs: 5_000, ...overrides,
  }
}

const result = (requestId: string) => ({ type: 'gab_result', protocolVersion: V, requestId, result: syntheticWorkerResult(requestId) })
const accepted = (requestId: string) => ({ type: 'gab_accepted', protocolVersion: V, requestId, role: 'first', acceptedAtEpochMs: 1 })
const ack = (requestId: string) => ({ type: 'gab_cancel_ack', protocolVersion: V, requestId })
const cancelled = (requestId: string) => ({ type: 'gab_cancelled', protocolVersion: V, requestId, observed: { stoppedAt: 'phase_a', via: 'cancel_point', elapsedMs: 1, yields: 1, maxSliceMs: 1 } })
const progress = (requestId: string) => ({ type: 'gab_progress', protocolVersion: V, requestId, event: { kind: 'input', stage: 'export_read', status: 'started' }, atMs: 1 })

/** The two invariants every cancel race asserts. */
function expectCancelSafety(harness: GlobalAssignmentBrowserHarness, settlement: GabRequestSettlement, requestId: string) {
  const audit = harness.audit().requests.find(request => request.requestId === requestId)!
  expect(audit.cancelAccepted).toBe(true)
  expect(audit.adoptedResults).toBe(0)
  expect(audit.settleCount).toBe(1)
  expect(settlement.result).toBeNull()
}

describe('P-1 harness: lifecycle, timings and fresh Worker policy', () => {
  it('measures create -> ready, request -> accepted and the round trip, adopts a running request\'s result and terminates the Worker right after', async () => {
    const { worker, harness } = setup()
    worker.emit({ type: 'gab_ready', protocolVersion: V, environment: READY_ENVIRONMENT })
    const ready = await harness.whenReady()
    expect(ready.createToReadyMs).toBeGreaterThan(0)
    expect(ready.environment).toEqual(READY_ENVIRONMENT)
    const pending = harness.run(options())
    expect(worker.postedOfType('gab_run')).toHaveLength(1)
    expect(worker.transfers[0]).toHaveLength(1)
    worker.emit(accepted('gab.run-1.first'))
    worker.emit(progress('gab.run-1.first'))
    worker.emit(result('gab.run-1.first'))
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'completed', settledBy: 'gab_result', cancelRequested: false, cancel: null, progress: { events: 1 } })
    expect(settlement.result).toEqual(syntheticWorkerResult('gab.run-1.first'))
    expect(settlement.timing.postToAcceptedMs).toBeGreaterThan(0)
    expect(settlement.timing.roundTripMs).toBeGreaterThan(settlement.timing.postToAcceptedMs!)
    expect(worker.terminated).toBe(1)
    expect(harness.audit().requests).toEqual([{ requestId: 'gab.run-1.first', cancelAccepted: false, settleCount: 1, ignoredSettleAttempts: 0, adoptedResults: 1, outcome: 'completed' }])
    // C9: one harness, one request.
    await expect(harness.run(options('gab.run-1.again'))).rejects.toThrow(/terminated|Fresh Worker policy/)
  })

  it('refuses an invalid request before posting it (role / Entry set, envelope), and posts no condition field', async () => {
    const { worker, harness } = setup()
    await expect(harness.run(options('gab.run-1.fresh', { role: 'fresh' }))).rejects.toThrow(/fresh request needs/)
    await expect(harness.run(options('gab.run-1.first', { workerWallMs: 0 }))).rejects.toThrow(/workerWallMs/)
    await expect(harness.run(options('bad id'))).rejects.toThrow(/requestId/)
    expect(worker.posted).toHaveLength(0)
    void harness.run(options())
    expect(Object.keys(worker.postedOfType('gab_run')[0]!).sort()).toEqual(['entrySet', 'execution', 'exportIdentity', 'exportPayload', 'protocolVersion', 'requestId', 'role', 'type'])
  })

  it('settles a running request as timeout on the wall-clock timer and terminates the Worker', async () => {
    const { worker, timers, harness } = setup()
    const pending = harness.run(options('gab.run-1.first', { workerWallMs: 1_234 }))
    worker.emit(accepted('gab.run-1.first'))
    timers.fire(1_234)
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'timeout', settledBy: 'wall_timeout', result: null, wall: { workerWallMs: 1_234 } })
    expect(settlement.wall.firedAtMs).not.toBeNull()
    expect(worker.terminated).toBe(1)
    // A result after the timeout is late, never adopted.
    worker.emit(result('gab.run-1.first'))
    expect(harness.lateResponses()).toBe(1)
    expect(harness.audit().requests[0]).toMatchObject({ settleCount: 1, adoptedResults: 0, outcome: 'timeout' })
  })

  it('fails closed on a native error, a messageerror (also while cancelling) and a malformed response', async () => {
    for (const type of ['error', 'messageerror'] as const) {
      const { worker, harness } = setup()
      const pending = harness.run(options())
      worker.fail(type)
      const settlement = await pending
      expect(settlement).toMatchObject({ outcome: 'worker_error', settledBy: type === 'error' ? 'native_error' : 'native_messageerror', result: null, cancelRequested: false })
      expect(await harness.ping(10)).toBeNull()
    }
    const during = setup()
    const pending = during.harness.run(options())
    expect(during.harness.cancel('gab.run-1.first', 'test')).toBe(true)
    during.worker.fail('messageerror')
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'worker_error', settledBy: 'native_messageerror', cancelRequested: true })
    expectCancelSafety(during.harness, settlement, 'gab.run-1.first')
    const malformed = setup()
    const malformedRun = malformed.harness.run(options())
    malformed.worker.emit({ type: 'gab_result', protocolVersion: 'global-assignment-browser:0', requestId: 'gab.run-1.first', result: syntheticWorkerResult('gab.run-1.first') })
    expect(await malformedRun).toMatchObject({ outcome: 'worker_error', settledBy: 'protocol_violation', result: null })
    expect(malformed.harness.audit()).toMatchObject({ invalidResponses: 1, requests: [{ adoptedResults: 0, settleCount: 1 }] })
  })

  it('reports a Worker gab_error as worker_reported_error, an unrequested gab_cancelled as a protocol violation, and a failed post as worker_error', async () => {
    const reported = setup()
    const reportedRun = reported.harness.run(options())
    reported.worker.emit({ type: 'gab_error', protocolVersion: V, requestId: 'gab.run-1.first', error: { code: 'input_build_failed', stage: 'json_parse', errorName: 'SyntaxError', message: 'x' } })
    expect(await reportedRun).toMatchObject({ outcome: 'worker_reported_error', settledBy: 'gab_error', error: { code: 'input_build_failed' } })
    const unrequested = setup()
    const unrequestedRun = unrequested.harness.run(options())
    unrequested.worker.emit(cancelled('gab.run-1.first'))
    expect(await unrequestedRun).toMatchObject({ outcome: 'worker_reported_error', settledBy: 'protocol_violation', cancelRequested: false })
    const worker = new ScriptedWorker()
    worker.postMessage = () => { throw new DOMException('could not be cloned', 'DataCloneError') }
    const failing = createGlobalAssignmentBrowserHarness({ createWorker: () => worker, timers: manualTimers() })
    expect(await failing.run(options())).toMatchObject({ outcome: 'worker_error', settledBy: 'post_failed', error: { code: 'post_failed', errorName: 'DataCloneError' } })
    // A request-less error before acceptance can only be about the request just posted.
    const requestless = setup()
    const requestlessRun = requestless.harness.run(options())
    requestless.worker.emit({ type: 'gab_error', protocolVersion: V, requestId: null, error: { code: 'invalid_request', stage: 'message', errorName: 'MessageError', message: 'x' } })
    expect(await requestlessRun).toMatchObject({ outcome: 'worker_reported_error', settledBy: 'gab_error' })
  })

  it('settles a pending request as page_left on pagehide / dispose, and removes its listeners', async () => {
    for (const reason of ['page_left', 'dispose'] as const) {
      const { worker, harness } = setup()
      const pending = harness.run(options())
      worker.emit(accepted('gab.run-1.first'))
      harness.dispose(reason)
      const settlement = await pending
      expect(settlement).toMatchObject({ outcome: 'page_left', settledBy: reason === 'page_left' ? 'pagehide' : 'dispose', result: null })
      expect(worker.terminated).toBe(1)
      worker.emit(result('gab.run-1.first'))
      expect(harness.audit().requests[0]).toMatchObject({ settleCount: 1, adoptedResults: 0 })
    }
  })

  it('answers pings, loses a pending ping at the settlement (the Worker is terminated), and checks the environment before a run', async () => {
    const { worker, harness } = setup()
    const ping = harness.ping(1_000)
    const posted = worker.postedOfType('gab_ping')[0]!
    worker.emit({ type: 'gab_pong', protocolVersion: V, pingId: posted.pingId as number })
    expect(await ping).toEqual(expect.any(Number))
    const running = harness.run(options())
    const unanswered = harness.ping(60_000)
    worker.emit(result('gab.run-1.first'))
    await running
    // Resolved at once as lost (null), never left waiting for its 60 s timeout; a later ping is refused at once.
    expect(await unanswered).toBeNull()
    expect(await harness.ping(60_000)).toBeNull()
    expect(gabEnvironmentIssues({ ...READY_ENVIRONMENT, capabilities: { ...READY_ENVIRONMENT.capabilities } }, SYNTHETIC_EXECUTION, { isSecureContext: true, cryptoSubtle: true })).toEqual([])
    expect(gabEnvironmentIssues({ ...READY_ENVIRONMENT, isSecureContext: false, capabilities: { ...READY_ENVIRONMENT.capabilities, cryptoSubtle: false, messageChannel: false } },
      { ...SYNTHETIC_EXECUTION, yieldMode: 'message-channel' }, { isSecureContext: false, cryptoSubtle: true })).toEqual([
      'The page is not a secure context (Web Crypto needs one).', 'The Worker is not a secure context.', 'The Worker has no Web Crypto (crypto.subtle).', 'The Worker has no MessageChannel (the message-channel yield cannot run).',
    ])
  })
})

describe('P-1 harness: C1 - C10, the cancel contract of the main thread', () => {
  it('C1 / C3 / C5: a cancel turns running into cancelling synchronously before gab_cancel is posted, stops the wall timer and never returns to running', async () => {
    const { worker, timers, harness } = setup()
    const pending = harness.run(options())
    expect(harness.state('gab.run-1.first')).toBe('running')
    expect(timers.pending()).toEqual([60_000])
    expect(harness.cancel('gab.run-1.first', 'ui')).toBe(true)
    expect(harness.state('gab.run-1.first')).toBe('cancelling')
    expect(worker.postedOfType('gab_cancel')).toEqual([{ type: 'gab_cancel', protocolVersion: V, requestId: 'gab.run-1.first' }])
    expect(timers.pending()).toEqual([5_000])
    // Nothing brings it back to running: progress, an ack, another cancel.
    worker.emit(progress('gab.run-1.first'))
    worker.emit(ack('gab.run-1.first'))
    expect(harness.cancel('gab.run-1.first')).toBe(false)
    expect(harness.state('gab.run-1.first')).toBe('cancelling')
    expect(worker.postedOfType('gab_cancel')).toHaveLength(1)
    worker.emit(cancelled('gab.run-1.first'))
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'cancelled', settledBy: 'gab_cancelled', cancel: { source: 'ui', ackMs: expect.any(Number), ignoredResultAfterCancel: null } })
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
  })

  it('race 1: a result the Worker already sent (not yet received) when the cancel is accepted is never adopted', async () => {
    const { worker, harness } = setup()
    const pending = harness.run(options())
    worker.emit(accepted('gab.run-1.first'))
    worker.enqueue(result('gab.run-1.first'))
    expect(harness.cancel('gab.run-1.first', 'ui')).toBe(true)
    worker.deliver()
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'cancelled', settledBy: 'ignored_gab_result', cancel: { ignoredResultAfterCancel: { arrivedAfterCancelMs: expect.any(Number) } } })
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
    expect(JSON.stringify(settlement)).not.toContain('the-calculation')
  })

  it('race 2: a result with the same request ID that arrives after cancelling is never adopted (the Worker never saw the cancel)', async () => {
    const { worker, harness } = setup()
    const pending = harness.run(options())
    worker.emit(accepted('gab.run-1.first'))
    expect(harness.cancel('gab.run-1.first')).toBe(true)
    worker.emit(progress('gab.run-1.first'))
    worker.emit(result('gab.run-1.first'))
    const settlement = await pending
    expect(settlement.settledBy).toBe('ignored_gab_result')
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
  })

  it('race 3: a result that arrives before the cancel ack is not adopted; the later ack is a late response', async () => {
    const { worker, harness } = setup()
    const pending = harness.run(options())
    expect(harness.cancel('gab.run-1.first')).toBe(true)
    worker.enqueue(result('gab.run-1.first'))
    worker.enqueue(ack('gab.run-1.first'))
    worker.deliver()
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'cancelled', settledBy: 'ignored_gab_result', cancel: { ackMs: null } })
    expect(harness.lateResponses()).toBe(1)
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
  })

  it('race 4: gab_cancelled settles a cancelling request as cancelled (a later result is late and never adopted)', async () => {
    const { worker, harness } = setup()
    const pending = harness.run(options())
    expect(harness.cancel('gab.run-1.first')).toBe(true)
    worker.emit(ack('gab.run-1.first'))
    worker.emit(cancelled('gab.run-1.first'))
    worker.emit(result('gab.run-1.first'))
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'cancelled', settledBy: 'gab_cancelled', cancelledObservation: { stoppedAt: 'phase_a', via: 'cancel_point' } })
    expect(harness.lateResponses()).toBe(1)
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
    // A Worker error while cancelling also settles as cancelled (kept as an observation, design C4).
    const errored = setup()
    const erroredRun = errored.harness.run(options())
    errored.harness.cancel('gab.run-1.first')
    errored.worker.emit({ type: 'gab_error', protocolVersion: V, requestId: 'gab.run-1.first', error: { code: 'calculation_failed', stage: 'phase_a', errorName: 'Error', message: 'x' } })
    const erroredSettlement = await erroredRun
    expect(erroredSettlement).toMatchObject({ outcome: 'cancelled', settledBy: 'gab_error', error: { code: 'calculation_failed' } })
    expectCancelSafety(errored.harness, erroredSettlement, 'gab.run-1.first')
  })

  it('race 5: past the cancel grace the Worker is terminated (cancelled_terminated); messages after it are late', async () => {
    const { worker, timers, harness } = setup()
    const pending = harness.run(options())
    expect(harness.cancel('gab.run-1.first')).toBe(true)
    timers.fire(60_000) // the wall timer was stopped by the cancel: nothing happens
    expect(harness.state('gab.run-1.first')).toBe('cancelling')
    timers.fire(5_000)
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'cancelled_terminated', settledBy: 'cancel_grace_terminate' })
    expect(worker.terminated).toBeGreaterThanOrEqual(1)
    worker.emit(result('gab.run-1.first'))
    worker.emit(cancelled('gab.run-1.first'))
    expect(harness.lateResponses()).toBe(2)
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
  })

  it('race 6 / C8: a cancel of a settled (completed) request does nothing: false, no gab_cancel, the adopted result unchanged', async () => {
    const { worker, harness } = setup()
    const pending = harness.run(options())
    worker.emit(result('gab.run-1.first'))
    const settlement = await pending
    expect(harness.cancel('gab.run-1.first', 'ui')).toBe(false)
    expect(harness.cancel('gab.unknown.first')).toBe(false)
    expect(worker.postedOfType('gab_cancel')).toHaveLength(0)
    expect(settlement).toMatchObject({ outcome: 'completed', cancelRequested: false })
    expect(settlement.result).toEqual(syntheticWorkerResult('gab.run-1.first'))
    expect(harness.audit().requests[0]).toMatchObject({ cancelAccepted: false, settleCount: 1, adoptedResults: 1 })
  })

  it('race 7 / C7 / C9: an earlier request\'s messages reaching a later run are never applied', async () => {
    const first = setup()
    const firstRun = first.harness.run(options('gab.run-1.first'))
    expect(first.harness.cancel('gab.run-1.first')).toBe(true)
    first.worker.emit(cancelled('gab.run-1.first'))
    expectCancelSafety(first.harness, await firstRun, 'gab.run-1.first')
    // The next run is a new harness and a new Worker; the old Worker's late messages reach the old harness only.
    const second = setup()
    const secondRun = second.harness.run(options('gab.run-2.first'))
    first.worker.emit(result('gab.run-1.first'))
    first.worker.emit(progress('gab.run-1.first'))
    expect(first.harness.lateResponses()).toBe(2)
    // Even a stray message of the old request reaching the new harness is not applied.
    second.worker.emit(progress('gab.run-1.first'))
    second.worker.emit(result('gab.run-1.first'))
    expect(second.harness.lateResponses()).toBe(2)
    expect(second.harness.state('gab.run-2.first')).toBe('running')
    second.worker.emit(result('gab.run-2.first'))
    const settlement = await secondRun
    expect(settlement).toMatchObject({ requestId: 'gab.run-2.first', outcome: 'completed', progress: { events: 0 } })
    expect(settlement.result).toEqual(syntheticWorkerResult('gab.run-2.first'))
    expect(second.harness.audit().requests).toEqual([{ requestId: 'gab.run-2.first', cancelAccepted: false, settleCount: 1, ignoredSettleAttempts: 0, adoptedResults: 1, outcome: 'completed' }])
  })

  it('C6: a second terminal path after the settlement changes nothing (settled exactly once)', async () => {
    const { worker, timers, harness } = setup()
    const pending = harness.run(options())
    harness.cancel('gab.run-1.first')
    worker.emit(cancelled('gab.run-1.first'))
    timers.fire(5_000)
    worker.fail('error')
    harness.dispose('page_left')
    const settlement = await pending
    expect(settlement.outcome).toBe('cancelled')
    expectCancelSafety(harness, settlement, 'gab.run-1.first')
  })
})

describe('PR #257 Required fix 2: a malformed Worker response is never adopted (the harness fails closed)', () => {
  const POISON = 'poisoned-payload'
  const poisoned = () => syntheticWorkerResult('gab.run-1.first', POISON) as unknown as Record<string, unknown>
  const without = (key: string) => { const value = poisoned(); delete value[key]; return value }

  /** One request receiving `message`: it settles once as worker_error / protocol_violation, adopts nothing and leaves the Worker terminated. */
  async function expectFailedClosed(message: Record<string, unknown>, errorName: 'MalformedResult' | 'MalformedResponse', issue: RegExp) {
    const { worker, harness } = setup()
    const onProgress: unknown[] = []
    const pending = harness.run(options(), { onProgress: event => { onProgress.push(event) } })
    worker.emit(accepted('gab.run-1.first'))
    worker.emit(message)
    const settlement = await pending
    expect(settlement).toMatchObject({ outcome: 'worker_error', settledBy: 'protocol_violation', result: null, error: { code: 'protocol_violation', errorName } })
    expect(settlement.error!.message).toMatch(issue)
    expect(harness.audit()).toMatchObject({ invalidResponses: 1, terminated: true, requests: [{ settleCount: 1, adoptedResults: 0, outcome: 'worker_error' }] })
    expect(worker.terminated).toBe(1)
    expect(onProgress).toEqual([])
    // The payload is dropped: nothing of it is kept in the settlement.
    expect(JSON.stringify(settlement)).not.toContain(POISON)
    // A later valid result is never adopted, and the Worker is not trusted again (no ping, no second request).
    worker.emit(result('gab.run-1.first'))
    expect(harness.audit().requests[0]).toMatchObject({ settleCount: 1, adoptedResults: 0 })
    expect(await harness.ping(10)).toBeNull()
    await expect(harness.run(options('gab.run-1.again'))).rejects.toThrow()
  }

  it('refuses a gab_result whose result is not a readable Worker result (null, a primitive, missing or malformed parts)', async () => {
    const body = (value: unknown) => ({ type: 'gab_result', protocolVersion: V, requestId: 'gab.run-1.first', result: value })
    // Not even an object: refused at the envelope.
    await expectFailedClosed(body(null), 'MalformedResponse', /gab_result\.result must be an object/)
    await expectFailedClosed(body(42), 'MalformedResponse', /gab_result\.result must be an object/)
    await expectFailedClosed(body('the result'), 'MalformedResponse', /gab_result\.result must be an object/)
    // An object the runner cannot read safely: refused before it is adopted.
    await expectFailedClosed(body(without('exportObservation')), 'MalformedResult', /result\.exportObservation must be an object/)
    await expectFailedClosed(body({ ...poisoned(), exportObservation: { fileName: 'synthetic.json', matchesRequest: true } }), 'MalformedResult', /exportObservation\.bytes .*exportObservation\.sha256/)
    await expectFailedClosed(body({ ...poisoned(), exportObservation: { ...SYNTHETIC_IDENTITY, bytes: 4.5, matchesRequest: 'yes' } }), 'MalformedResult', /exportObservation\.bytes .*exportObservation\.matchesRequest/)
    await expectFailedClosed(body({ ...poisoned(), materialization: { semantic: null, semanticSha256: 'x' } }), 'MalformedResult', /materialization\.semantic must be an object/)
    await expectFailedClosed(body({ ...poisoned(), materialization: { ...(poisoned().materialization as object), semantic: { outcome: { kind: 'invented' }, input: {}, candidates: [], integrityIssues: [] } } }), 'MalformedResult', /materialization\.semantic\.outcome needs a known kind/)
    await expectFailedClosed(body({ ...poisoned(), verification: { semantic: {}, semanticSha256: 'f'.repeat(64), observed: {} } }), 'MalformedResult', /verification\.semantic\.outcome needs a known kind/)
    await expectFailedClosed(body({ ...poisoned(), verification: 'conditions_met' }), 'MalformedResult', /verification must be an object or null/)
    await expectFailedClosed(body({ ...poisoned(), entrySet: { value: {}, sha256: 'f'.repeat(64), entryFingerprint: 'x', entryCount: 0 } }), 'MalformedResult', /entrySet\.value must be a/)
    await expectFailedClosed(body({ ...poisoned(), integrityIssues: 'none' }), 'MalformedResult', /integrityIssues must be an array of strings/)
    await expectFailedClosed(body({ ...poisoned(), integrityIssues: [1] }), 'MalformedResult', /integrityIssues must be an array of strings/)
    await expectFailedClosed(body(without('verification')), 'MalformedResult', /result\.verification is required/)
    await expectFailedClosed(body(without('observed')), 'MalformedResult', /result\.observed must be an object/)
    await expectFailedClosed(body({ ...poisoned(), calculationContext: {} }), 'MalformedResult', /calculationContext needs/)
    // Another request's or role's result is never adopted for this one.
    await expectFailedClosed(body({ ...poisoned(), requestId: 'gab.run-0.first' }), 'MalformedResult', /result is for first \/ gab\.run-0\.first/)
    await expectFailedClosed(body({ ...poisoned(), role: 'fresh' }), 'MalformedResult', /result is for fresh/)
    // A first result must carry its materialization; one with an Entry set must carry its verification.
    await expectFailedClosed(body({ ...poisoned(), materialization: null }), 'MalformedResult', /a first result needs its materialization record/)
  })

  it('refuses the other responses whose body lacks the fields the main thread reads', async () => {
    const id = 'gab.run-1.first'
    await expectFailedClosed({ type: 'gab_progress', protocolVersion: V, requestId: id, atMs: 1 }, 'MalformedResponse', /gab_progress\.event must be an object/)
    await expectFailedClosed({ type: 'gab_progress', protocolVersion: V, requestId: id, event: { kind: 'materialization', event: { kind: 1 } }, atMs: 1 }, 'MalformedResponse', /materialization event needs event\.kind/)
    await expectFailedClosed({ type: 'gab_progress', protocolVersion: V, requestId: id, event: { kind: 'input', stage: 'nowhere', status: 'started' }, atMs: 1 }, 'MalformedResponse', /input event needs a known stage/)
    await expectFailedClosed({ type: 'gab_progress', protocolVersion: V, requestId: id, event: { kind: 'input', stage: 'export_read', status: 'started' }, atMs: 'soon' }, 'MalformedResponse', /atMs must be a finite number/)
    await expectFailedClosed({ type: 'gab_heartbeat', protocolVersion: V, requestId: id, heartbeat: 'beat' }, 'MalformedResponse', /heartbeat must be an object/)
    await expectFailedClosed({ type: 'gab_heartbeat', protocolVersion: V, requestId: id, heartbeat: { stage: 'phase_a', elapsedMs: 1, yields: 1, maxSliceMs: null, maxSliceSinceLastHeartbeatMs: 1, workerHeap: null } }, 'MalformedResponse', /maxSliceMs must be a finite number/)
    await expectFailedClosed({ type: 'gab_accepted', protocolVersion: V, requestId: id, role: 'first', acceptedAtEpochMs: 'now' }, 'MalformedResponse', /acceptedAtEpochMs must be a finite number/)
    await expectFailedClosed({ type: 'gab_cancelled', protocolVersion: V, requestId: id, observed: { stoppedAt: 'phase_a' } }, 'MalformedResponse', /observed\.via/)
    await expectFailedClosed({ type: 'gab_error', protocolVersion: V, requestId: id, error: { code: 'calculation_failed' } }, 'MalformedResponse', /gab_error\.error\.stage must be a string/)
  })

  it('fails a ready wait on a malformed gab_ready and refuses a malformed pong without adopting it', async () => {
    const ready = setup()
    const waiting = ready.harness.whenReady(60_000)
    ready.worker.emit({ type: 'gab_ready', protocolVersion: V, environment: { ...READY_ENVIRONMENT, capabilities: null } })
    await expect(waiting).rejects.toThrow(/Malformed gab_ready: gab_ready\.environment\.capabilities must be an object/)
    await expect(ready.harness.run(options())).rejects.toThrow(/Malformed gab_ready/)
    expect(ready.worker.postedOfType('gab_run')).toHaveLength(0)
    const pong = setup()
    const ping = pong.harness.ping(60_000)
    pong.worker.emit({ type: 'gab_pong', protocolVersion: V, pingId: 'one' })
    expect(await ping).toBeNull()
    expect(pong.harness.audit().invalidResponses).toBe(1)
  })
})
