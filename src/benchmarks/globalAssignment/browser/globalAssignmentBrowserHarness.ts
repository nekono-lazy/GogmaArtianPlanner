/**
 * Issue #154 Production準備 P-1 (Research only; never imported by the app).
 *
 * The main-thread harness of the Global Assignment Browser Worker (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 7.8 / 7.9 / 7.10
 * / 7.11 / 10): one harness owns one Worker and accepts exactly one request (fresh Worker policy). The request lifecycle here - never the
 * Worker's cancel flag - is what guarantees that a cancelled request's result is never adopted:
 *
 *   C1  a cancel is accepted synchronously: `running` -> `cancelling` (with its acceptance time), and only then is `gab_cancel` posted
 *   C2  a `gab_result` that reaches a `cancelling` request is never adopted, whatever its request ID or send time: its payload is dropped
 *       at once and only its arrival (`ignoredResultAfterCancel`) is recorded
 *   C3  `cancelling` never returns to `running`
 *   C4  a `cancelling` request settles as `cancelled` on the Worker's first terminal message (`gab_cancelled`, the dropped `gab_result`,
 *       or `gab_error`, kept as an observation)
 *   C5  without one within `cancelGraceMs` the Worker is terminated (`cancelled_terminated`); a cancel stops the wall-clock timer
 *   C6  every request settles exactly once, on every path, and the Worker is terminated right after it settles
 *   C7  a message after the settlement, or for an unknown request ID, is never applied: it is counted (`lateResponses`)
 *   C8  a cancel of a settled request does nothing (no state change, no `gab_cancel`, `cancel()` returns false)
 *   C9  a new run is a new harness, a new Worker and a new request ID (`run()` refuses a second request)
 *   C10 (the runner) only a `completed` first request hands its Entry set to a fresh Worker
 *
 * A native `error` / `messageerror`, a malformed `gab_` message and a failed post fail the request closed (`worker_error`). Nothing here
 * runs a Research calculation, persists anything or reads an expected value; the audit (`audit()`) lets tests prove C1 - C10.
 */
import {
  gabErrorMessage, gabErrorName, gabResponseIssues, gabRunRequestIssues, GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, isGabResponseType,
  type GabCancelledObservation, type GabExecutionOptions, type GabExportPayload, type GabHeartbeat, type GabProgressEvent, type GabRequest, type GabResponse,
  type GabRole, type GabRunRequest, type GabWorkerEnvironment, type GabWorkerError, type GabWorkerResult,
} from './globalAssignmentBrowserProtocol'
import type { ExportIdentity } from '../assignmentProtocol'
import type { D1aEntrySet } from '../verificationProtocol'

/** The Worker the harness drives (a real Dedicated Worker, or a test double). */
export interface GabWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  terminate(): void
}

export interface GabTimers {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type GabSettleOutcome = 'completed' | 'cancelled' | 'cancelled_terminated' | 'timeout' | 'worker_error' | 'worker_reported_error' | 'page_left'
export type GabSettledBy =
  | 'gab_result' | 'gab_cancelled' | 'ignored_gab_result' | 'gab_error' | 'cancel_grace_terminate' | 'wall_timeout'
  | 'native_error' | 'native_messageerror' | 'protocol_violation' | 'post_failed' | 'pagehide' | 'dispose'
export type GabRequestState = 'running' | 'cancelling' | 'settled'

/** A failure the main thread observed (not a Worker report). */
export interface GabMainThreadError {
  code: 'native_error' | 'native_messageerror' | 'protocol_violation' | 'post_failed'
  stage: 'main'
  errorName: string
  message: string
}

export interface GabCancelObservation {
  /** Who asked (UI, console API, a cancel trigger, the runner). */
  source: string
  /** Main ms from the request post to the cancel's acceptance (C1). */
  acceptedAtMs: number
  /** Cancel acceptance -> `gab_cancel_ack` (the Worker dispatched the cancel; the remaining synchronous section). */
  ackMs: number | null
  /** Cancel acceptance -> settlement. */
  settledMs: number | null
  /** C2: a `gab_result` that arrived after the cancel was accepted (its payload was dropped): ms after the acceptance. */
  ignoredResultAfterCancel: { arrivedAfterCancelMs: number } | null
}

export interface GabRequestSettlement {
  requestId: string
  role: GabRole
  outcome: GabSettleOutcome
  settledBy: GabSettledBy
  /** The adopted result: `completed` only (C2: never for a cancelled request). */
  result: GabWorkerResult | null
  /** The Worker's own cancel observation (`gab_cancelled`). */
  cancelledObservation: GabCancelledObservation | null
  error: GabWorkerError | GabMainThreadError | null
  cancelRequested: boolean
  cancel: GabCancelObservation | null
  timing: { postToAcceptedMs: number | null; roundTripMs: number; acceptedAtEpochMs: number | null }
  progress: { events: number; heartbeats: number; lastEvent: GabProgressEvent | null; lastHeartbeat: GabHeartbeat | null; maxMessageGapMs: number | null }
  wall: { workerWallMs: number; cancelGraceMs: number; firedAtMs: number | null }
}

export interface GabRunOptions {
  requestId: string
  role: GabRole
  exportPayload: GabExportPayload
  exportIdentity: ExportIdentity
  entrySet: D1aEntrySet | null
  execution: GabExecutionOptions
  /** Wall-clock envelope of the request (main-thread timer; stops on a cancel). */
  workerWallMs: number
  /** How long a `cancelling` request waits for the Worker's terminal message before `terminate()` (C5). */
  cancelGraceMs: number
}

export interface GabRunHooks {
  onAccepted?(atMs: number): void
  onProgress?(event: GabProgressEvent, atMs: number): void
  onHeartbeat?(heartbeat: GabHeartbeat, atMs: number): void
}

export interface GabRequestAudit {
  requestId: string
  cancelAccepted: boolean
  /** Effective settlements (C6: exactly 1 once settled). */
  settleCount: number
  /** Later settle attempts that changed nothing (another terminal path arriving after the settlement). */
  ignoredSettleAttempts: number
  /** Results adopted (`completed`). A cancelled request must stay at 0 (C2). */
  adoptedResults: number
  outcome: GabSettleOutcome | null
}

export interface GabHarnessAudit {
  requests: GabRequestAudit[]
  lateResponses: number
  invalidResponses: number
  terminated: boolean
}

export interface GlobalAssignmentBrowserHarness {
  whenReady(timeoutMs?: number): Promise<{ createToReadyMs: number; environment: GabWorkerEnvironment }>
  /** Posts the request synchronously; resolves with its one settlement. A second request is refused (fresh Worker policy, C9). */
  run(options: GabRunOptions, hooks?: GabRunHooks): Promise<GabRequestSettlement>
  /** C1 / C8: true when the cancel was accepted now (the request was `running`), false otherwise (nothing changes). */
  cancel(requestId: string, source?: string): boolean
  state(requestId: string): GabRequestState | null
  ping(timeoutMs?: number): Promise<number | null>
  lateResponses(): number
  audit(): GabHarnessAudit
  /** Settles a pending request as `page_left` (`pagehide` / dispose), removes the listeners and terminates the Worker. */
  dispose(reason?: 'dispose' | 'page_left'): void
}

export interface GlobalAssignmentBrowserHarnessDependencies {
  readonly createWorker?: () => GabWorkerLike
  readonly now?: () => number
  readonly timers?: GabTimers
}

export const GAB_ENVELOPE_BOUNDS = Object.freeze({ minMs: 1, maxMs: 86_400_000 })

function createGlobalAssignmentBrowserWorker(): GabWorkerLike {
  return new Worker(new URL('./globalAssignment.worker.benchmark.entry.ts', import.meta.url), { type: 'module' }) as unknown as GabWorkerLike
}

const defaultTimers: GabTimers = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) }

interface ActiveRequest {
  requestId: string
  role: GabRole
  state: GabRequestState
  postedAt: number
  acceptedAt: number | null
  acceptedAtEpochMs: number | null
  lastMessageAt: number | null
  maxMessageGapMs: number | null
  events: number
  heartbeats: number
  lastEvent: GabProgressEvent | null
  lastHeartbeat: GabHeartbeat | null
  cancel: { source: string; acceptedAt: number; ackAt: number | null; ignoredResultAt: number | null } | null
  wallTimer: unknown
  graceTimer: unknown
  wallFiredAt: number | null
  options: GabRunOptions
  hooks: GabRunHooks
  audit: GabRequestAudit
  resolve: (settlement: GabRequestSettlement) => void
}

export function createGlobalAssignmentBrowserHarness(dependencies: GlobalAssignmentBrowserHarnessDependencies = {}): GlobalAssignmentBrowserHarness {
  const now = dependencies.now ?? (() => performance.now())
  const timers = dependencies.timers ?? defaultTimers
  const createdAt = now()
  const worker = (dependencies.createWorker ?? createGlobalAssignmentBrowserWorker)()
  const version = GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION
  let broken: string | null = null
  let used = false
  let terminated = false
  let disposed = false
  let late = 0
  let invalid = 0
  let ready: { atMs: number; environment: GabWorkerEnvironment } | null = null
  const readyWaiters: { resolve: () => void; reject: (error: Error) => void }[] = []
  const pongs = new Map<number, (atMs: number | null) => void>()
  let nextPingId = 1
  const audits: GabRequestAudit[] = []
  let current: ActiveRequest | null = null

  const terminate = () => {
    if (terminated) return
    terminated = true
    broken ??= 'The Worker was terminated.'
    worker.terminate()
  }

  /** C6: the one settlement of a request (later attempts change nothing), then the Worker is terminated. */
  const settle = (request: ActiveRequest, outcome: GabSettleOutcome, settledBy: GabSettledBy, extra: { result?: GabWorkerResult; cancelledObservation?: GabCancelledObservation; error?: GabWorkerError | GabMainThreadError } = {}) => {
    if (request.state === 'settled') { request.audit.ignoredSettleAttempts += 1; return }
    request.state = 'settled'
    timers.clearTimeout(request.wallTimer)
    timers.clearTimeout(request.graceTimer)
    const settledAt = now()
    request.audit.settleCount += 1
    request.audit.outcome = outcome
    const adopted = outcome === 'completed' && extra.result !== undefined ? extra.result : null
    if (adopted !== null) request.audit.adoptedResults += 1
    terminate()
    // A terminated Worker answers no ping: the pending ones are lost now, not at their timeout.
    for (const [pingId, resolve] of [...pongs]) { pongs.delete(pingId); resolve(null) }
    const cancel = request.cancel
    request.resolve({
      requestId: request.requestId, role: request.role, outcome, settledBy,
      result: adopted,
      cancelledObservation: extra.cancelledObservation ?? null,
      error: extra.error ?? null,
      cancelRequested: cancel !== null,
      cancel: cancel === null ? null : {
        source: cancel.source, acceptedAtMs: cancel.acceptedAt - request.postedAt, ackMs: cancel.ackAt === null ? null : cancel.ackAt - cancel.acceptedAt, settledMs: settledAt - cancel.acceptedAt,
        ignoredResultAfterCancel: cancel.ignoredResultAt === null ? null : { arrivedAfterCancelMs: cancel.ignoredResultAt - cancel.acceptedAt },
      },
      timing: { postToAcceptedMs: request.acceptedAt === null ? null : request.acceptedAt - request.postedAt, roundTripMs: settledAt - request.postedAt, acceptedAtEpochMs: request.acceptedAtEpochMs },
      progress: { events: request.events, heartbeats: request.heartbeats, lastEvent: request.lastEvent, lastHeartbeat: request.lastHeartbeat, maxMessageGapMs: request.maxMessageGapMs },
      wall: { workerWallMs: request.options.workerWallMs, cancelGraceMs: request.options.cancelGraceMs, firedAtMs: request.wallFiredAt === null ? null : request.wallFiredAt - request.postedAt },
    })
  }

  const pending = () => (current !== null && current.state !== 'settled' ? current : null)

  const fail = (code: GabMainThreadError['code'], message: string) => {
    broken ??= message
    for (const waiter of readyWaiters.splice(0)) waiter.reject(new Error(message))
    for (const [pingId, resolve] of [...pongs]) { pongs.delete(pingId); resolve(null) }
    const request = pending()
    if (request !== null) settle(request, 'worker_error', code === 'native_messageerror' ? 'native_messageerror' : code === 'native_error' ? 'native_error' : code, { error: { code, stage: 'main', errorName: code, message } })
  }

  const noteMessage = (request: ActiveRequest, at: number) => {
    if (request.lastMessageAt !== null) request.maxMessageGapMs = Math.max(request.maxMessageGapMs ?? 0, at - request.lastMessageAt)
    request.lastMessageAt = at
  }

  const onRequestMessage = (request: ActiveRequest, data: Extract<GabResponse, { requestId: string | null }>, at: number) => {
    switch (data.type) {
      case 'gab_accepted':
        request.acceptedAt ??= at
        request.acceptedAtEpochMs ??= data.acceptedAtEpochMs
        noteMessage(request, at)
        request.hooks.onAccepted?.(at - request.postedAt)
        return
      case 'gab_progress':
        request.events += 1
        request.lastEvent = data.event
        noteMessage(request, at)
        request.hooks.onProgress?.(data.event, at - request.postedAt)
        return
      case 'gab_heartbeat':
        request.heartbeats += 1
        request.lastHeartbeat = data.heartbeat
        noteMessage(request, at)
        request.hooks.onHeartbeat?.(data.heartbeat, at - request.postedAt)
        return
      case 'gab_cancel_ack':
        // An ack belongs to a cancel this harness posted; one in `running` was never asked for (not applied).
        if (request.state === 'cancelling' && request.cancel !== null) request.cancel.ackAt ??= at
        else late += 1
        return
      case 'gab_result':
        if (request.state === 'cancelling') {
          // C2 / C4: never adopted, whatever its request ID or send time; the payload is not kept.
          request.cancel!.ignoredResultAt = at
          settle(request, 'cancelled', 'ignored_gab_result')
          return
        }
        settle(request, 'completed', 'gab_result', { result: data.result })
        return
      case 'gab_cancelled':
        if (request.state === 'cancelling') { settle(request, 'cancelled', 'gab_cancelled', { cancelledObservation: data.observed }); return }
        // The Worker reports a cancel this harness never asked for: a protocol violation, never a cancellation outcome.
        settle(request, 'worker_reported_error', 'protocol_violation', { cancelledObservation: data.observed, error: { code: 'protocol_violation', stage: 'main', errorName: 'UnrequestedCancel', message: 'gab_cancelled without a cancel request.' } })
        return
      case 'gab_error':
        if (request.state === 'cancelling') { settle(request, 'cancelled', 'gab_error', { error: data.error }); return }
        settle(request, 'worker_reported_error', 'gab_error', { error: data.error })
    }
  }

  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isGabResponseType(data)) return
    const at = now()
    const issues = gabResponseIssues(data)
    if (issues.length > 0) {
      invalid += 1
      const request = pending()
      // Fail closed: a malformed response is never interpreted.
      if (request !== null) settle(request, 'worker_error', 'protocol_violation', { error: { code: 'protocol_violation', stage: 'main', errorName: 'MalformedResponse', message: issues.join(' ') } })
      return
    }
    const message = data as GabResponse
    if (message.type === 'gab_ready') {
      ready ??= { atMs: at, environment: message.environment }
      for (const waiter of readyWaiters.splice(0)) waiter.resolve()
      return
    }
    if (message.type === 'gab_pong') {
      pongs.get(message.pingId)?.(at)
      pongs.delete(message.pingId)
      return
    }
    const request = pending()
    if (request === null || request.requestId !== message.requestId) {
      // A request-less error before acceptance can only be about the request just posted; anything else is not applied (C7 / C9).
      if (message.type === 'gab_error' && message.requestId === null && request !== null && request.state === 'running' && request.acceptedAt === null) {
        settle(request, 'worker_reported_error', 'gab_error', { error: message.error })
        return
      }
      late += 1
      return
    }
    onRequestMessage(request, message, at)
  }
  const errorListener = (event: Event) => {
    const detail = (event as ErrorEvent).message
    fail(event.type === 'messageerror' ? 'native_messageerror' : 'native_error', `The Global Assignment Browser Worker failed (${event.type}${detail ? `: ${detail}` : ''}).`)
  }
  worker.addEventListener('message', listener)
  worker.addEventListener('error', errorListener)
  worker.addEventListener('messageerror', errorListener)

  const post = (message: GabRequest, transfer?: Transferable[]) => (transfer === undefined ? worker.postMessage(message) : worker.postMessage(message, transfer))

  return {
    whenReady: (timeoutMs = 120_000) => new Promise((resolve, reject) => {
      const done = () => resolve({ createToReadyMs: ready!.atMs - createdAt, environment: ready!.environment })
      if (ready) { done(); return }
      if (broken !== null) { reject(new Error(broken)); return }
      const timer = timers.setTimeout(() => reject(new Error('The Global Assignment Browser Worker did not become ready.')), timeoutMs)
      readyWaiters.push({ resolve: () => { timers.clearTimeout(timer); done() }, reject: error => { timers.clearTimeout(timer); reject(error) } })
    }),

    ping: (timeoutMs = 60_000) => new Promise<number | null>(resolve => {
      if (broken !== null) { resolve(null); return }
      const pingId = nextPingId++
      const startedAt = now()
      const timer = timers.setTimeout(() => { pongs.delete(pingId); resolve(null) }, timeoutMs)
      pongs.set(pingId, atMs => { timers.clearTimeout(timer); resolve(atMs === null ? null : atMs - startedAt) })
      try { post({ type: 'gab_ping', protocolVersion: version, pingId }) } catch { timers.clearTimeout(timer); pongs.delete(pingId); resolve(null) }
    }),

    run: (options, hooks = {}) => {
      if (broken !== null) return Promise.reject(new Error(broken))
      if (used) return Promise.reject(new Error('Fresh Worker policy: this harness already ran a request; create a new one.'))
      const request: GabRunRequest = {
        type: 'gab_run', protocolVersion: version, requestId: options.requestId, role: options.role, exportPayload: options.exportPayload,
        exportIdentity: options.exportIdentity, entrySet: options.entrySet, execution: options.execution,
      }
      const issues = gabRunRequestIssues(request)
      for (const key of ['workerWallMs', 'cancelGraceMs'] as const) {
        const value = options[key]
        if (!Number.isSafeInteger(value) || value < GAB_ENVELOPE_BOUNDS.minMs || value > GAB_ENVELOPE_BOUNDS.maxMs) issues.push(`${key} must be an integer in ${GAB_ENVELOPE_BOUNDS.minMs}..${GAB_ENVELOPE_BOUNDS.maxMs}.`)
      }
      if (issues.length > 0) return Promise.reject(new RangeError(`Invalid Global Assignment Browser request: ${issues.join(' / ')}`))
      used = true
      return new Promise<GabRequestSettlement>(resolve => {
        const audit: GabRequestAudit = { requestId: options.requestId, cancelAccepted: false, settleCount: 0, ignoredSettleAttempts: 0, adoptedResults: 0, outcome: null }
        audits.push(audit)
        const active: ActiveRequest = {
          requestId: options.requestId, role: options.role, state: 'running', postedAt: now(), acceptedAt: null, acceptedAtEpochMs: null, lastMessageAt: null, maxMessageGapMs: null,
          events: 0, heartbeats: 0, lastEvent: null, lastHeartbeat: null, cancel: null, wallTimer: null, graceTimer: null, wallFiredAt: null, options, hooks, audit, resolve,
        }
        current = active
        active.wallTimer = timers.setTimeout(() => {
          if (active.state !== 'running') return
          active.wallFiredAt = now()
          settle(active, 'timeout', 'wall_timeout')
        }, options.workerWallMs)
        try {
          post(request, options.exportPayload.kind === 'array_buffer' ? [options.exportPayload.bytes] : undefined)
        } catch (error) {
          // A payload the Browser cannot structured-clone (e.g. a Blob in an old engine) never runs: the request fails closed.
          settle(active, 'worker_error', 'post_failed', { error: { code: 'post_failed', stage: 'main', errorName: gabErrorName(error), message: gabErrorMessage(error) } })
        }
      })
    },

    cancel: (requestId, source = 'api') => {
      const request = pending()
      // C8: a settled, cancelling or unknown request is left exactly as it is.
      if (request === null || request.requestId !== requestId || request.state !== 'running') return false
      // C1: synchronous, before anything is posted.
      request.state = 'cancelling'
      request.cancel = { source, acceptedAt: now(), ackAt: null, ignoredResultAt: null }
      request.audit.cancelAccepted = true
      // C5: the wall-clock timer stops; only the grace timer runs.
      timers.clearTimeout(request.wallTimer)
      request.graceTimer = timers.setTimeout(() => {
        if (request.state !== 'cancelling') return
        terminate()
        settle(request, 'cancelled_terminated', 'cancel_grace_terminate')
      }, request.options.cancelGraceMs)
      try { post({ type: 'gab_cancel', protocolVersion: version, requestId }) } catch { /* the grace timer terminates the Worker */ }
      return true
    },

    state: requestId => (current !== null && current.requestId === requestId ? current.state : null),

    lateResponses: () => late,

    audit: () => ({ requests: audits.map(audit => ({ ...audit })), lateResponses: late, invalidResponses: invalid, terminated }),

    dispose: (reason = 'dispose') => {
      if (disposed) return
      disposed = true
      const request = pending()
      if (request !== null) settle(request, 'page_left', reason === 'page_left' ? 'pagehide' : 'dispose')
      worker.removeEventListener('message', listener)
      worker.removeEventListener('error', errorListener)
      worker.removeEventListener('messageerror', errorListener)
      for (const [pingId, resolve] of [...pongs]) { pongs.delete(pingId); resolve(null) }
      broken ??= 'disposed'
      for (const waiter of readyWaiters.splice(0)) waiter.reject(new Error(broken))
      terminate()
    },
  }
}

/** Whether the environment can run a request at all (design 7.11 `environment_unsupported`): `[]` = it can. */
export function gabEnvironmentIssues(environment: GabWorkerEnvironment, execution: GabExecutionOptions, main: { isSecureContext: boolean | null; cryptoSubtle: boolean }): string[] {
  const issues: string[] = []
  if (environment.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`The Worker speaks ${String(environment.protocolVersion)}, not ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
  if (main.isSecureContext !== true) issues.push('The page is not a secure context (Web Crypto needs one).')
  if (!main.cryptoSubtle) issues.push('The page has no Web Crypto (crypto.subtle).')
  if (environment.isSecureContext !== true) issues.push('The Worker is not a secure context.')
  if (!environment.capabilities.cryptoSubtle) issues.push('The Worker has no Web Crypto (crypto.subtle).')
  if (!environment.capabilities.textDecoder) issues.push('The Worker has no TextDecoder.')
  if (!environment.capabilities.structuredClone) issues.push('The Worker has no structuredClone.')
  if (execution.yieldMode === 'message-channel' && !environment.capabilities.messageChannel) issues.push('The Worker has no MessageChannel (the message-channel yield cannot run).')
  return issues
}
