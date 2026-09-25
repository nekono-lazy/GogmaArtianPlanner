import { assertPlannerOrchestrationBounds } from '../domain/planner'
import type { PlannerInput, PlannerOrchestrationBounds } from '../domain/planner'
import type {
  ConstrainedCandidateSearchInput,
  ConstrainedEnumerationBounds,
} from '../domain/search'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import { assertIssue101EnumerationBounds } from './issue101ConstrainedResearchFixtures'
import {
  isIssue101BenchmarkResponse,
  type Issue101BenchmarkRequest,
  type Issue101EnumerationMeasurement,
  type Issue101OrchestrationMeasurement,
} from './issue101ConstrainedResearchProtocol'

/**
 * Issue #101 benchmark main-thread harness.
 *
 * One harness owns one Worker; the page creates and disposes one per run, so
 * no run inherits a warmed Worker (the B8-B2 / B8-E1 fresh Worker policy).
 * Invalid bounds throw before any Worker exists. A native Worker `error` or
 * `messageerror` fails the pending run closed.
 *
 * `roundTripMs` starts immediately before the request `postMessage()`, so it
 * contains the request structured clone and whatever Worker module start-up is
 * still outstanding; the Worker-local measurement does not.
 */

export type Issue101RunOutcome =
  | {
      readonly status: 'enumeration_completed'
      readonly bounds: ConstrainedEnumerationBounds
      readonly measurement: Issue101EnumerationMeasurement
    }
  | {
      readonly status: 'orchestration_completed'
      readonly enumerationBounds: ConstrainedEnumerationBounds
      readonly orchestrationBounds: PlannerOrchestrationBounds
      readonly measurement: Issue101OrchestrationMeasurement
    }
  | {
      readonly status: 'cancelled'
      readonly workerElapsedMs: number | null
      readonly deliveredCandidates: number
      readonly settledAsResult: boolean
    }
  | { readonly status: 'error'; readonly message: string }

export interface Issue101CancelObservation {
  /** Run start to the cancel post. */
  readonly requestedAtMs: number
  /** Cancel post to the Worker's `cancel_ack`. */
  readonly ackMs: number | null
  /** Cancel post to the run settling. */
  readonly settledMs: number | null
}

export interface Issue101RunResult {
  readonly requestId: string
  readonly outcome: Issue101RunOutcome
  readonly roundTripMs: number
  readonly acceptedAtMs: number | null
  readonly cancel: Issue101CancelObservation | null
}

export type Issue101RunOptions =
  | {
      readonly kind: 'enumeration'
      readonly requestId: string
      readonly input: ConstrainedCandidateSearchInput
      readonly stopAfterCandidates?: number
      readonly cancelAfterMs?: number
      /** Post the cancel as soon as the first Candidate is reported. */
      readonly cancelOnFirstCandidate?: boolean
    }
  | {
      readonly kind: 'orchestration'
      readonly requestId: string
      readonly input: PlannerInput
      readonly enumerationBounds: ConstrainedEnumerationBounds
      readonly orchestrationBounds: PlannerOrchestrationBounds
      readonly cancelAfterMs?: number
      /** Post the cancel as soon as the first Candidate trial is reported. */
      readonly cancelOnFirstCandidate?: boolean
    }

export interface Issue101BenchmarkHarness {
  run(options: Issue101RunOptions): Promise<Issue101RunResult>
  ping(timeoutMs?: number): Promise<number | null>
  dispose(): void
}

function createIssue101Worker(): BenchmarkWorkerLike {
  return new Worker(
    new URL('../workers/issue101ConstrainedResearch.worker.benchmark.entry.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as BenchmarkWorkerLike
}

export interface Issue101BenchmarkHarnessDependencies {
  readonly createWorker?: () => BenchmarkWorkerLike
  readonly now?: () => number
}

/** Validates every bound of a run before a Worker is created. Nothing is repaired. */
export function assertIssue101RunOptions(options: Issue101RunOptions): void {
  if (options.kind === 'enumeration') {
    assertIssue101EnumerationBounds(options.input.bounds)
    return
  }
  assertIssue101EnumerationBounds(options.enumerationBounds)
  assertPlannerOrchestrationBounds(options.orchestrationBounds)
}

export function createIssue101BenchmarkHarness(
  dependencies: Issue101BenchmarkHarnessDependencies = {},
): Issue101BenchmarkHarness {
  const now = dependencies.now ?? (() => performance.now())
  const worker = (dependencies.createWorker ?? createIssue101Worker)()
  const pending = new Map<
    string,
    {
      settle: (outcome: Issue101RunOutcome) => void
      accepted: (atMs: number) => void
      cancelAcked: (atMs: number) => void
      firstCandidate: () => void
    }
  >()
  const pongs = new Map<number, (atMs: number) => void>()
  let nextPingId = 1

  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isIssue101BenchmarkResponse(data)) return
    const at = now()
    if (data.type === 'i101_benchmark_pong') {
      pongs.get(data.pingId)?.(at)
      pongs.delete(data.pingId)
      return
    }
    const entry = pending.get(data.requestId)
    if (!entry) return
    switch (data.type) {
      case 'i101_benchmark_accepted':
        entry.accepted(at)
        return
      case 'i101_benchmark_cancel_ack':
        entry.cancelAcked(at)
        return
      case 'i101_benchmark_first_candidate':
        entry.firstCandidate()
        return
      case 'i101_benchmark_enumeration_result':
        entry.settle({
          status: 'enumeration_completed',
          bounds: data.bounds,
          measurement: data.measurement,
        })
        return
      case 'i101_benchmark_orchestration_result':
        entry.settle({
          status: 'orchestration_completed',
          enumerationBounds: data.enumerationBounds,
          orchestrationBounds: data.orchestrationBounds,
          measurement: data.measurement,
        })
        return
      case 'i101_benchmark_cancelled':
        entry.settle({
          status: 'cancelled',
          workerElapsedMs: data.workerElapsedMs,
          deliveredCandidates: data.deliveredCandidates,
          settledAsResult: data.settledAsResult,
        })
        return
      case 'i101_benchmark_error':
        entry.settle({ status: 'error', message: data.message })
    }
  }
  const failClosed = (message: string) => {
    for (const [, entry] of pending) entry.settle({ status: 'error', message })
    pending.clear()
  }
  const errorListener = () => failClosed('The Issue #101 benchmark Worker failed.')
  worker.addEventListener('message', listener)
  worker.addEventListener('error', errorListener)
  worker.addEventListener('messageerror', errorListener)
  const post = (request: Issue101BenchmarkRequest) => worker.postMessage(request)

  return {
    ping: (timeoutMs = 30_000) =>
      new Promise<number | null>((resolve) => {
        const pingId = nextPingId++
        const startedAt = now()
        const timer = globalThis.setTimeout(() => {
          pongs.delete(pingId)
          resolve(null)
        }, timeoutMs)
        pongs.set(pingId, (atMs) => {
          globalThis.clearTimeout(timer)
          resolve(atMs - startedAt)
        })
        post({ type: 'i101_benchmark_ping', pingId })
      }),
    run: (options) => {
      assertIssue101RunOptions(options)
      return new Promise<Issue101RunResult>((resolve) => {
        const startedAt = now()
        let acceptedAtMs: number | null = null
        let cancelRequestedAt: number | null = null
        let cancelAckAt: number | null = null
        let cancelTimer: ReturnType<typeof setTimeout> | null = null
        const requestCancel = () => {
          if (cancelRequestedAt !== null) return
          cancelRequestedAt = now()
          post({ type: 'i101_benchmark_cancel', requestId: options.requestId })
        }
        pending.set(options.requestId, {
          firstCandidate: () => {
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
        if (options.cancelAfterMs !== undefined) {
          cancelTimer = globalThis.setTimeout(requestCancel, options.cancelAfterMs)
        }
        if (options.kind === 'enumeration') {
          post({
            type: 'i101_benchmark_enumeration',
            requestId: options.requestId,
            input: options.input,
            stopAfterCandidates: options.stopAfterCandidates ?? null,
            notifyFirstCandidate: options.cancelOnFirstCandidate === true,
          })
        } else {
          post({
            type: 'i101_benchmark_orchestration',
            requestId: options.requestId,
            input: options.input,
            enumerationBounds: options.enumerationBounds,
            orchestrationBounds: options.orchestrationBounds,
            notifyFirstCandidate: options.cancelOnFirstCandidate === true,
          })
        }
      })
    },
    dispose: () => {
      worker.removeEventListener('message', listener)
      worker.removeEventListener('error', errorListener)
      worker.removeEventListener('messageerror', errorListener)
      failClosed('The Issue #101 benchmark harness was disposed.')
      worker.terminate()
    },
  }
}
