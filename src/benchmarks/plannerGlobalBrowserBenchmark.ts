import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import {
  isPlannerGlobalBenchmarkResponse,
  validatePlannerGlobalRunRequest,
  type PlannerGlobalBenchmarkRequest,
  type PlannerGlobalProgressObservation,
  type PlannerGlobalRunRequest,
  type PlannerGlobalWorkerEnvironment,
  type PlannerGlobalWorkerResult,
} from './plannerGlobalBrowserBenchmarkProtocol'

/**
 * Issue #154 Phase 2-A main-thread harness. One harness owns one Worker and accepts exactly one run
 * (fresh Worker policy): the runner creates and disposes one per attempt, so no attempt inherits a
 * warmed Worker, a cache, a Candidate or a Planner state. The main thread runs no Research calculation.
 *
 * Timing boundaries (main-thread clock):
 * - `createToReadyMs`: immediately before `new Worker()` -> the Worker's `ready` (module evaluated)
 * - `acceptedAtMs`: request `postMessage()` -> `accepted` (request structured clone + validation)
 * - `roundTripMs`: request `postMessage()` -> the run settling (calculation, evidence, response clone)
 *
 * A native Worker `error` / `messageerror` fails the run closed as `worker_error`. A response for a
 * settled or unknown request is never applied; it is only counted (`lateResponses`).
 */
export type PlannerGlobalRunOptions = Omit<PlannerGlobalRunRequest, 'type'>

export type PlannerGlobalRunOutcome =
  | { readonly status: 'completed'; readonly result: PlannerGlobalWorkerResult }
  | { readonly status: 'cancelled'; readonly result: PlannerGlobalWorkerResult }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'worker_error'; readonly message: string }

export interface PlannerGlobalCancelObservation {
  /** Request post -> cancel post. */
  readonly requestedAtMs: number
  /** Cancel post -> the Worker's `cancel_ack` (the cancel message was dispatched in the Worker). */
  readonly ackMs: number | null
  /** Cancel post -> the run settling. */
  readonly settledMs: number | null
}

export interface PlannerGlobalRunResult {
  readonly requestId: string
  readonly outcome: PlannerGlobalRunOutcome
  readonly acceptedAtMs: number | null
  readonly roundTripMs: number
  readonly priorityEntries: PlannerGlobalWorkerResult['priorityEntries'] | null
  readonly progressCount: number
  readonly lastProgress: PlannerGlobalProgressObservation | null
  readonly cancel: PlannerGlobalCancelObservation | null
}

export interface PlannerGlobalRunHooks {
  /** `atMs`: main-thread ms since the request post. */
  onProgress?(observation: PlannerGlobalProgressObservation, atMs: number): void
  onAccepted?(atMs: number): void
}

export interface PlannerGlobalBrowserHarness {
  whenReady(timeoutMs?: number): Promise<{ readonly createToReadyMs: number; readonly environment: PlannerGlobalWorkerEnvironment }>
  /** Posts the run request synchronously. A second run on the same harness is refused (fresh Worker policy). */
  run(options: PlannerGlobalRunOptions, hooks?: PlannerGlobalRunHooks): Promise<PlannerGlobalRunResult>
  /** Posts the cancel of the running request now; false when it is not running. */
  cancel(requestId: string): boolean
  /** Main-thread RTT of one ping (Worker event loop responsiveness), or null on timeout / broken Worker. */
  ping(timeoutMs?: number): Promise<number | null>
  lateResponses(): number
  dispose(): void
}

export interface PlannerGlobalHarnessDependencies {
  readonly createWorker?: () => BenchmarkWorkerLike
  readonly now?: () => number
}

function createPlannerGlobalWorker(): BenchmarkWorkerLike {
  return new Worker(new URL('../workers/plannerGlobal.worker.benchmark.entry.ts', import.meta.url), { type: 'module' }) as unknown as BenchmarkWorkerLike
}

export function createPlannerGlobalBrowserHarness(dependencies: PlannerGlobalHarnessDependencies = {}): PlannerGlobalBrowserHarness {
  const now = dependencies.now ?? (() => performance.now())
  const createdAt = now()
  const worker = (dependencies.createWorker ?? createPlannerGlobalWorker)()
  let broken: string | null = null
  let used = false
  let late = 0
  let ready: { atMs: number; environment: PlannerGlobalWorkerEnvironment } | null = null
  const readyWaiters: { resolve: () => void; reject: (error: Error) => void }[] = []
  const pongs = new Map<number, (atMs: number | null) => void>()
  let nextPingId = 1
  const settled = new Set<string>()
  let active: {
    requestId: string
    startedAt: number
    accepted: (at: number, entries: PlannerGlobalWorkerResult['priorityEntries']) => void
    progress: (observation: PlannerGlobalProgressObservation, at: number) => void
    cancelAck: (at: number) => void
    settle: (outcome: PlannerGlobalRunOutcome) => void
    requestCancel: () => void
  } | null = null

  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isPlannerGlobalBenchmarkResponse(data)) return
    const at = now()
    if (data.type === 'pg2a_benchmark_ready') {
      ready ??= { atMs: at, environment: data.environment }
      for (const waiter of readyWaiters.splice(0)) waiter.resolve()
      return
    }
    if (data.type === 'pg2a_benchmark_pong') {
      pongs.get(data.pingId)?.(at)
      pongs.delete(data.pingId)
      return
    }
    if (!active || active.requestId !== data.requestId) {
      // Never applied: a response after the run settled (e.g. a result after `cancelled`) or for a foreign request.
      if (settled.has(data.requestId) || data.type === 'pg2a_benchmark_result' || data.type === 'pg2a_benchmark_cancelled') late += 1
      return
    }
    switch (data.type) {
      case 'pg2a_benchmark_accepted': active.accepted(at, data.priorityEntries); return
      case 'pg2a_benchmark_progress': active.progress(data.observation, at); return
      case 'pg2a_benchmark_cancel_ack': active.cancelAck(at); return
      case 'pg2a_benchmark_result': active.settle({ status: 'completed', result: data.result }); return
      case 'pg2a_benchmark_cancelled': active.settle({ status: 'cancelled', result: data.result }); return
      case 'pg2a_benchmark_error': active.settle({ status: 'error', message: data.message })
    }
  }
  const fail = (message: string) => {
    broken ??= message
    for (const waiter of readyWaiters.splice(0)) waiter.reject(new Error(message))
    active?.settle({ status: 'worker_error', message })
    for (const [pingId, resolve] of [...pongs]) { pongs.delete(pingId); resolve(null) }
  }
  const errorListener = (event: Event) => {
    const detail = (event as ErrorEvent).message
    fail(`The Phase 2-A benchmark Worker failed (${event.type}${detail ? `: ${detail}` : ''}).`)
  }
  worker.addEventListener('message', listener)
  worker.addEventListener('error', errorListener)
  worker.addEventListener('messageerror', errorListener)
  const post = (request: PlannerGlobalBenchmarkRequest) => worker.postMessage(request)

  return {
    whenReady: (timeoutMs = 120_000) => new Promise((resolve, reject) => {
      const done = () => resolve({ createToReadyMs: ready!.atMs - createdAt, environment: ready!.environment })
      if (ready) { done(); return }
      if (broken !== null) { reject(new Error(broken)); return }
      const timer = globalThis.setTimeout(() => reject(new Error('The Phase 2-A benchmark Worker did not become ready.')), timeoutMs)
      readyWaiters.push({ resolve: () => { globalThis.clearTimeout(timer); done() }, reject: error => { globalThis.clearTimeout(timer); reject(error) } })
    }),
    ping: (timeoutMs = 60_000) => new Promise<number | null>(resolve => {
      if (broken !== null) { resolve(null); return }
      const pingId = nextPingId++
      const startedAt = now()
      const timer = globalThis.setTimeout(() => { pongs.delete(pingId); resolve(null) }, timeoutMs)
      pongs.set(pingId, atMs => { globalThis.clearTimeout(timer); resolve(atMs === null ? null : atMs - startedAt) })
      post({ type: 'pg2a_benchmark_ping', pingId })
    }),
    run: (options, hooks = {}) => {
      if (broken !== null) return Promise.reject(new Error(broken))
      if (used) return Promise.reject(new Error('Fresh Worker policy: this harness already ran an attempt; create a new one.'))
      const issues = validatePlannerGlobalRunRequest({ ...options, type: 'pg2a_benchmark_run' })
      if (issues.length) return Promise.reject(new RangeError(`Invalid Phase 2-A run: ${issues.join(' / ')}`))
      used = true
      return new Promise<PlannerGlobalRunResult>(resolve => {
        let acceptedAtMs: number | null = null, priorityEntries: PlannerGlobalRunResult['priorityEntries'] = null
        let progressCount = 0, lastProgress: PlannerGlobalProgressObservation | null = null
        let cancelRequestedAt: number | null = null, cancelAckAt: number | null = null
        const startedAt = now()
        active = {
          requestId: options.requestId, startedAt,
          accepted: (at, entries) => { acceptedAtMs = at - startedAt; priorityEntries = entries; hooks.onAccepted?.(acceptedAtMs) },
          progress: (observation, at) => { progressCount += 1; lastProgress = observation; hooks.onProgress?.(observation, at - startedAt) },
          cancelAck: at => { cancelAckAt ??= at },
          requestCancel: () => {
            if (cancelRequestedAt !== null) return
            cancelRequestedAt = now()
            post({ type: 'pg2a_benchmark_cancel', requestId: options.requestId })
          },
          settle: outcome => {
            const settledAt = now()
            settled.add(options.requestId)
            active = null
            resolve({ requestId: options.requestId, outcome, acceptedAtMs, roundTripMs: settledAt - startedAt, priorityEntries, progressCount, lastProgress,
              cancel: cancelRequestedAt === null ? null : { requestedAtMs: cancelRequestedAt - startedAt,
                ackMs: cancelAckAt === null ? null : cancelAckAt - cancelRequestedAt, settledMs: settledAt - cancelRequestedAt } })
          },
        }
        post({ ...options, type: 'pg2a_benchmark_run' })
      })
    },
    cancel: requestId => {
      if (!active || active.requestId !== requestId) return false
      active.requestCancel()
      return true
    },
    lateResponses: () => late,
    dispose: () => {
      worker.removeEventListener('message', listener)
      worker.removeEventListener('error', errorListener)
      worker.removeEventListener('messageerror', errorListener)
      if (active) active.settle({ status: 'error', message: 'The Phase 2-A benchmark harness was disposed.' })
      for (const [pingId, resolve] of [...pongs]) { pongs.delete(pingId); resolve(null) }
      broken ??= 'disposed'
      worker.terminate()
    },
  }
}
