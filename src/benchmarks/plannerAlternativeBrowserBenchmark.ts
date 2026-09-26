import type {
  PlannerAlternativeKernelRequest,
  PlannerAlternativeTrialBounds,
} from '../domain/planner'
import type {
  PlannerAlternativeSearchExtent,
  PlannerAlternativeSearchInput,
} from '../domain/search'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import {
  assertPlannerAlternativeBenchmarkExtent,
  assertPlannerAlternativeBenchmarkTrialBounds,
} from './plannerAlternativeBenchmarkFixtures'
import {
  isPlannerAlternativeBenchmarkResponse,
  type PlannerAlternativeBenchmarkRequest,
  type PlannerAlternativeKernelMeasurement,
  type PlannerAlternativeRecordingMode,
  type PlannerAlternativeSearchMeasurement,
} from './plannerAlternativeBenchmarkProtocol'

/**
 * Planner Alternative Search Phase 3-A main-thread harness.
 *
 * One harness owns one Worker; the page creates and disposes one per run, so
 * no recorded run inherits a warmed Worker (the B5 / B8 / B9 fresh Worker
 * policy). The Worker constructor is outside the timing.
 *
 * `roundTripMs` starts immediately before the request `postMessage()` and ends
 * when the run settles on the main thread, so it contains the request
 * structured clone, any outstanding Worker module initialization, the Worker
 * calculation and the response structured clone. The Worker-local
 * `workerElapsedMs` is reported separately; no "CPU time" is derived from the
 * difference.
 *
 * Invalid extent / bounds / stop values throw before any Worker exists. A
 * native Worker `error` or `messageerror` fails every pending run closed.
 */

export type PlannerAlternativeRunOutcome =
  | {
      readonly status: 'search_completed'
      readonly extent: PlannerAlternativeSearchExtent
      readonly measurement: PlannerAlternativeSearchMeasurement
    }
  | {
      readonly status: 'kernel_completed'
      readonly extent: PlannerAlternativeSearchExtent
      readonly bounds: PlannerAlternativeTrialBounds
      readonly measurement: PlannerAlternativeKernelMeasurement
    }
  | {
      readonly status: 'cancelled'
      readonly workerElapsedMs: number
      readonly deliveredCandidates: number
    }
  | { readonly status: 'error'; readonly message: string }

export interface PlannerAlternativeCancelObservation {
  /** Run start to the cancel post. */
  readonly requestedAtMs: number
  /** Cancel post to the Worker's `cancel_ack`. */
  readonly ackMs: number | null
  /** Cancel post to the run settling. */
  readonly settledMs: number | null
}

export interface PlannerAlternativeRunResult {
  readonly requestId: string
  readonly outcome: PlannerAlternativeRunOutcome
  readonly roundTripMs: number
  readonly acceptedAtMs: number | null
  /** Main-thread arrival of the first-Candidate notice, from run start; null when not requested. */
  readonly firstCandidateNoticeAtMs: number | null
  readonly cancel: PlannerAlternativeCancelObservation | null
}

interface CommonRunOptions {
  readonly requestId: string
  readonly instrumented: boolean
  readonly cancelAfterMs?: number
  /** Post the cancel as soon as the first Candidate (Search) or trial (Kernel) is reported. */
  readonly cancelOnFirstCandidate?: boolean
  /** Ask the Worker for the first-Candidate notice without cancelling. */
  readonly notifyFirstCandidate?: boolean
}

export type PlannerAlternativeHarnessRunOptions =
  | (CommonRunOptions & {
      readonly kind: 'search'
      readonly input: PlannerAlternativeSearchInput
      readonly stopAfterCandidates: number | null
      readonly recording: PlannerAlternativeRecordingMode
    })
  | (CommonRunOptions & {
      readonly kind: 'kernel'
      readonly request: PlannerAlternativeKernelRequest
    })

export interface PlannerAlternativeBenchmarkHarness {
  /** Posts the run request synchronously, before the returned Promise exists. */
  run(options: PlannerAlternativeHarnessRunOptions): Promise<PlannerAlternativeRunResult>
  /** Posts the cancel of a running request now; false when it is not running. */
  cancel(requestId: string): boolean
  ping(timeoutMs?: number): Promise<number | null>
  dispose(): void
}

function createPlannerAlternativeWorker(): BenchmarkWorkerLike {
  return new Worker(
    new URL('../workers/plannerAlternative.worker.benchmark.entry.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as BenchmarkWorkerLike
}

export interface PlannerAlternativeHarnessDependencies {
  readonly createWorker?: () => BenchmarkWorkerLike
  readonly now?: () => number
}

function assertNonNegative(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(`${name} must be a finite number greater than or equal to 0.`)
  }
}

/** Validates a run before a Worker is created. Nothing is repaired or defaulted. */
export function assertPlannerAlternativeRunOptions(options: PlannerAlternativeHarnessRunOptions): void {
  if (typeof options.requestId !== 'string' || options.requestId.length === 0) {
    throw new RangeError('requestId must be a non-empty string.')
  }
  if (typeof options.instrumented !== 'boolean') throw new RangeError('instrumented must be a boolean.')
  assertNonNegative(options.cancelAfterMs, 'cancelAfterMs')
  if (options.kind === 'search') {
    assertPlannerAlternativeBenchmarkExtent(options.input.extent)
    if (options.stopAfterCandidates !== null &&
      (!Number.isInteger(options.stopAfterCandidates) || options.stopAfterCandidates < 1)) {
      throw new RangeError('stopAfterCandidates must be null or an integer greater than or equal to 1.')
    }
    if (options.recording !== 'timing' && options.recording !== 'parity') {
      throw new RangeError(`Unknown recording mode '${String(options.recording)}'.`)
    }
    return
  }
  if (options.kind === 'kernel') {
    assertPlannerAlternativeBenchmarkExtent(options.request.extent)
    assertPlannerAlternativeBenchmarkTrialBounds(options.request.bounds)
    return
  }
  throw new RangeError(`Unknown run kind '${String((options as { kind?: unknown }).kind)}'.`)
}

export function createPlannerAlternativeBenchmarkHarness(
  dependencies: PlannerAlternativeHarnessDependencies = {},
): PlannerAlternativeBenchmarkHarness {
  const now = dependencies.now ?? (() => performance.now())
  const worker = (dependencies.createWorker ?? createPlannerAlternativeWorker)()
  const pending = new Map<
    string,
    {
      settle: (outcome: PlannerAlternativeRunOutcome) => void
      accepted: (atMs: number) => void
      cancelAcked: (atMs: number) => void
      firstCandidate: (atMs: number) => void
      requestCancel: () => void
    }
  >()
  const pongs = new Map<number, { pong: (atMs: number) => void; abort: () => void }>()
  let nextPingId = 1
  let broken: string | null = null

  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isPlannerAlternativeBenchmarkResponse(data)) return
    const at = now()
    if (data.type === 'pa3_benchmark_pong') {
      pongs.get(data.pingId)?.pong(at)
      pongs.delete(data.pingId)
      return
    }
    const entry = pending.get(data.requestId)
    if (!entry) return
    switch (data.type) {
      case 'pa3_benchmark_accepted':
        entry.accepted(at)
        return
      case 'pa3_benchmark_cancel_ack':
        entry.cancelAcked(at)
        return
      case 'pa3_benchmark_first_candidate':
        entry.firstCandidate(at)
        return
      case 'pa3_benchmark_search_result':
        entry.settle({ status: 'search_completed', extent: data.extent, measurement: data.measurement })
        return
      case 'pa3_benchmark_kernel_result':
        entry.settle({
          status: 'kernel_completed',
          extent: data.extent,
          bounds: data.bounds,
          measurement: data.measurement,
        })
        return
      case 'pa3_benchmark_cancelled':
        entry.settle({
          status: 'cancelled',
          workerElapsedMs: data.workerElapsedMs,
          deliveredCandidates: data.deliveredCandidates,
        })
        return
      case 'pa3_benchmark_error':
        entry.settle({ status: 'error', message: data.message })
    }
  }
  const failClosed = (message: string) => {
    for (const [, entry] of [...pending]) entry.settle({ status: 'error', message })
    pending.clear()
  }
  const errorListener = () => {
    broken = 'The Planner Alternative benchmark Worker failed.'
    failClosed(broken)
  }
  worker.addEventListener('message', listener)
  worker.addEventListener('error', errorListener)
  worker.addEventListener('messageerror', errorListener)
  const post = (request: PlannerAlternativeBenchmarkRequest) => worker.postMessage(request)

  return {
    ping: (timeoutMs = 30_000) =>
      new Promise<number | null>((resolve) => {
        if (broken !== null) {
          resolve(null)
          return
        }
        const pingId = nextPingId++
        const startedAt = now()
        const timer = globalThis.setTimeout(() => {
          pongs.delete(pingId)
          resolve(null)
        }, timeoutMs)
        pongs.set(pingId, {
          pong: (atMs) => {
            globalThis.clearTimeout(timer)
            resolve(atMs - startedAt)
          },
          abort: () => {
            globalThis.clearTimeout(timer)
            resolve(null)
          },
        })
        post({ type: 'pa3_benchmark_ping', pingId })
      }),
    run: (options) => {
      assertPlannerAlternativeRunOptions(options)
      if (broken !== null) return Promise.reject(new Error(broken))
      if (pending.has(options.requestId)) {
        return Promise.reject(new Error(`Request '${options.requestId}' is already running.`))
      }
      return new Promise<PlannerAlternativeRunResult>((resolve) => {
        let startedAt = 0
        let acceptedAtMs: number | null = null
        let firstCandidateNoticeAtMs: number | null = null
        let cancelRequestedAt: number | null = null
        let cancelAckAt: number | null = null
        let cancelTimer: ReturnType<typeof setTimeout> | null = null
        const requestCancel = () => {
          if (cancelRequestedAt !== null || !pending.has(options.requestId)) return
          cancelRequestedAt = now()
          post({ type: 'pa3_benchmark_cancel', requestId: options.requestId })
        }
        pending.set(options.requestId, {
          requestCancel,
          firstCandidate: (atMs) => {
            firstCandidateNoticeAtMs = atMs - startedAt
            if (options.cancelOnFirstCandidate === true) requestCancel()
          },
          accepted: (atMs) => {
            acceptedAtMs = atMs - startedAt
          },
          cancelAcked: (atMs) => {
            cancelAckAt = atMs
          },
          settle: (outcome) => {
            const settledAt = now()
            pending.delete(options.requestId)
            if (cancelTimer !== null) globalThis.clearTimeout(cancelTimer)
            resolve({
              requestId: options.requestId,
              outcome,
              roundTripMs: settledAt - startedAt,
              acceptedAtMs,
              firstCandidateNoticeAtMs,
              cancel:
                cancelRequestedAt === null
                  ? null
                  : {
                      requestedAtMs: cancelRequestedAt - startedAt,
                      ackMs: cancelAckAt === null ? null : cancelAckAt - cancelRequestedAt,
                      settledMs: settledAt - cancelRequestedAt,
                    },
            })
          },
        })
        const notifyFirstCandidate =
          options.cancelOnFirstCandidate === true || options.notifyFirstCandidate === true
        const request: PlannerAlternativeBenchmarkRequest = options.kind === 'search'
          ? {
              type: 'pa3_benchmark_search',
              requestId: options.requestId,
              input: options.input,
              stopAfterCandidates: options.stopAfterCandidates,
              recording: options.recording,
              instrumented: options.instrumented,
              notifyFirstCandidate,
            }
          : {
              type: 'pa3_benchmark_kernel',
              requestId: options.requestId,
              request: options.request,
              instrumented: options.instrumented,
              notifyFirstCandidate,
            }
        // The round trip starts immediately before the request post.
        startedAt = now()
        if (options.cancelAfterMs !== undefined) {
          cancelTimer = globalThis.setTimeout(requestCancel, options.cancelAfterMs)
        }
        post(request)
      })
    },
    cancel: (requestId) => {
      const entry = pending.get(requestId)
      if (!entry) return false
      entry.requestCancel()
      return true
    },
    dispose: () => {
      worker.removeEventListener('message', listener)
      worker.removeEventListener('error', errorListener)
      worker.removeEventListener('messageerror', errorListener)
      failClosed('The Planner Alternative benchmark harness was disposed.')
      for (const [pingId, { abort }] of [...pongs]) {
        pongs.delete(pingId)
        abort()
      }
      worker.terminate()
    },
  }
}
