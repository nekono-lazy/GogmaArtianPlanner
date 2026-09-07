import type { ConstrainedEnumerationBounds } from '../domain/search'
import {
  isConstrainedEnumerationBenchmarkResponse,
  type ConstrainedEnumerationBenchmarkMeasurement,
  type ConstrainedEnumerationBenchmarkMode,
  type ConstrainedEnumerationBenchmarkRequest,
  type ConstrainedEnumerationBenchmarkResponse,
} from './constrainedEnumerationBenchmarkProtocol'

/**
 * Minimal Worker surface the harness needs. It matches the native `Worker` and
 * the fake used by the harness tests.
 */
export interface BenchmarkWorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  terminate(): void
}

export type ConstrainedEnumerationRunOutcome =
  | {
      readonly status: 'completed'
      readonly bounds: ConstrainedEnumerationBounds
      readonly measurement: ConstrainedEnumerationBenchmarkMeasurement
    }
  | {
      readonly status: 'cancelled'
      /** Null when the cancel landed before the Worker's measurement anchor. */
      readonly workerElapsedMs: number | null
      readonly deliveredCandidates: number
    }
  | { readonly status: 'error'; readonly message: string }

export interface ConstrainedEnumerationRunResult {
  readonly requestId: string
  readonly outcome: ConstrainedEnumerationRunOutcome
  /** `postMessage()` to settle, measured on the main-thread clock. */
  readonly roundTripMs: number
  /** `postMessage()` to the Worker's `accepted` reply. */
  readonly acceptedAtMs: number | null
}

export interface ConstrainedEnumerationRunOptions {
  readonly requestId: string
  readonly workloadId: string
  /**
   * `timing` (the default) runs the minimal recorder - no parity
   * instrumentation - and is the only mode whose elapsed time may be used as a
   * performance measurement. `parity` adds the digests and is for determinism
   * checks.
   */
  readonly mode?: ConstrainedEnumerationBenchmarkMode
  readonly boundsOverride?: ConstrainedEnumerationBounds
  readonly stopAfterCandidates?: number
  /** Cancel this run that many milliseconds after it is posted. */
  readonly cancelAfterMs?: number
}

export interface ConstrainedEnumerationCancelObservation {
  /** Main-thread offset from the run start at which cancel was posted. */
  readonly requestedAtMs: number
  /** Cancel post to the Worker's `cancel_ack`, on the main-thread clock. */
  readonly ackMs: number | null
  /** Cancel post to the run settling, on the main-thread clock. */
  readonly settledMs: number | null
}

export interface ConstrainedEnumerationBenchmarkHarness {
  run(
    options: ConstrainedEnumerationRunOptions,
  ): Promise<ConstrainedEnumerationRunResult>
  /** The cancel observation of the most recent cancelled run, if any. */
  readonly lastCancelObservation: ConstrainedEnumerationCancelObservation | null
  /** Round-trip time of one Worker event-loop turn. */
  ping(timeoutMs?: number): Promise<number | null>
  dispose(): void
}

function createBenchmarkWorker(): BenchmarkWorkerLike {
  return new Worker(
    new URL('../workers/constrainedEnumeration.worker.benchmark.entry.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as BenchmarkWorkerLike
}

export interface ConstrainedEnumerationBenchmarkHarnessDependencies {
  readonly createWorker?: () => BenchmarkWorkerLike
}

/**
 * Drives the B8-B2 benchmark Worker from the main thread.
 *
 * One harness owns one Worker for its whole lifetime, and `dispose()` ends
 * both. The benchmark page creates and disposes a harness per run, as the B5
 * page does, so in practice every warm-up and every measurement runs in a
 * freshly created Worker: Worker start-up is not amortized across runs, and it
 * lands in `roundTripMs` rather than in the Worker-local measurement. Driving
 * several runs through one harness is supported and shares that Worker, but
 * that is not how the recorded measurements were taken.
 *
 * A native Worker `error` fails the pending run closed, so a broken Worker is
 * never silently waited on.
 */
export function createConstrainedEnumerationBenchmarkHarness(
  dependencies: ConstrainedEnumerationBenchmarkHarnessDependencies = {},
): ConstrainedEnumerationBenchmarkHarness {
  const worker = (dependencies.createWorker ?? createBenchmarkWorker)()
  const pending = new Map<
    string,
    {
      settle: (outcome: ConstrainedEnumerationRunOutcome) => void
      accepted: (atMs: number) => void
      cancelAcked: (atMs: number) => void
    }
  >()
  const pongs = new Map<number, (atMs: number) => void>()
  let nextPingId = 1
  let lastCancelObservation: ConstrainedEnumerationCancelObservation | null = null

  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isConstrainedEnumerationBenchmarkResponse(data)) return
    const response: ConstrainedEnumerationBenchmarkResponse = data
    const now = performance.now()
    if (response.type === 'b8_benchmark_pong') {
      pongs.get(response.pingId)?.(now)
      pongs.delete(response.pingId)
      return
    }
    const entry = pending.get(response.requestId)
    if (!entry) return
    switch (response.type) {
      case 'b8_benchmark_accepted':
        entry.accepted(now)
        return
      case 'b8_benchmark_cancel_ack':
        entry.cancelAcked(now)
        return
      case 'b8_benchmark_result':
        entry.settle({
          status: 'completed',
          bounds: response.bounds,
          measurement: response.measurement,
        })
        return
      case 'b8_benchmark_cancelled':
        entry.settle({
          status: 'cancelled',
          workerElapsedMs: response.workerElapsedMs,
          deliveredCandidates: response.deliveredCandidates,
        })
        return
      case 'b8_benchmark_error':
        entry.settle({ status: 'error', message: response.message })
    }
  }

  const failClosed = (message: string) => {
    for (const [, entry] of pending) entry.settle({ status: 'error', message })
    pending.clear()
  }
  const errorListener = () => failClosed('The benchmark Worker failed.')

  worker.addEventListener('message', listener)
  worker.addEventListener('error', errorListener)
  worker.addEventListener('messageerror', errorListener)

  function post(request: ConstrainedEnumerationBenchmarkRequest): void {
    worker.postMessage(request)
  }

  return {
    get lastCancelObservation() {
      return lastCancelObservation
    },
    ping: (timeoutMs = 30_000) =>
      new Promise<number | null>((resolve) => {
        const pingId = nextPingId++
        const startedAt = performance.now()
        const timer = globalThis.setTimeout(() => {
          pongs.delete(pingId)
          resolve(null)
        }, timeoutMs)
        pongs.set(pingId, (atMs) => {
          globalThis.clearTimeout(timer)
          resolve(atMs - startedAt)
        })
        post({ type: 'b8_benchmark_ping', pingId })
      }),
    run: (options) =>
      new Promise<ConstrainedEnumerationRunResult>((resolve) => {
        const startedAt = performance.now()
        let acceptedAtMs: number | null = null
        let cancelRequestedAt: number | null = null
        let cancelAckAt: number | null = null
        let cancelTimer: number | null = null
        pending.set(options.requestId, {
          accepted: (atMs) => {
            acceptedAtMs = atMs - startedAt
          },
          cancelAcked: (atMs) => {
            cancelAckAt = atMs
          },
          settle: (outcome) => {
            const settledAt = performance.now()
            pending.delete(options.requestId)
            if (cancelTimer !== null) globalThis.clearTimeout(cancelTimer)
            if (cancelRequestedAt !== null) {
              lastCancelObservation = {
                requestedAtMs: cancelRequestedAt - startedAt,
                ackMs: cancelAckAt === null ? null : cancelAckAt - cancelRequestedAt,
                settledMs: settledAt - cancelRequestedAt,
              }
            }
            resolve({
              requestId: options.requestId,
              outcome,
              roundTripMs: settledAt - startedAt,
              acceptedAtMs,
            })
          },
        })
        if (options.cancelAfterMs !== undefined) {
          cancelTimer = globalThis.setTimeout(() => {
            cancelRequestedAt = performance.now()
            post({ type: 'b8_benchmark_cancel', requestId: options.requestId })
          }, options.cancelAfterMs) as unknown as number
        }
        post({
          type: 'b8_benchmark_run',
          requestId: options.requestId,
          workloadId: options.workloadId,
          mode: options.mode ?? 'timing',
          boundsOverride: options.boundsOverride ?? null,
          stopAfterCandidates: options.stopAfterCandidates ?? null,
        })
      }),
    dispose: () => {
      worker.removeEventListener('message', listener)
      worker.removeEventListener('error', errorListener)
      worker.removeEventListener('messageerror', errorListener)
      failClosed('The benchmark harness was disposed.')
      worker.terminate()
    },
  }
}
