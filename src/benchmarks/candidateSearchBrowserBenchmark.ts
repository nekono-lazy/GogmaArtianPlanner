import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { CandidateSearchInput } from '../domain/search'
import {
  createProductionSearchWorkerClient,
  createSearchWorkerClient,
  type SearchWorkerClient,
  type WorkerLike,
} from '../services/search/searchWorkerClient'
import {
  CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
  isCandidateSearchBenchmarkObservation,
  type CandidateSearchBenchmarkObservation,
  type CandidateSearchBenchmarkObservationEvent,
} from './candidateSearchBenchmarkProtocol'

/**
 * `production` runs the unmodified `createProductionSearchWorkerClient()` path
 * and is the source of every throughput number. `benchmark_seam` runs the same
 * Production controller through the benchmark Worker entry, which additionally
 * exposes the Worker's own event loop, so cancellation and Worker
 * responsiveness can be observed rather than inferred from a local Promise.
 */
export type CandidateSearchBenchmarkMode = 'production' | 'benchmark_seam'

export interface CandidateSearchBenchmarkObservationRecord {
  readonly event: CandidateSearchBenchmarkObservationEvent
  readonly targetRequestId: string | null
  readonly pingId: number | null
  readonly workerElapsedMs: number | null
  /** Main-thread arrival time, so every latency stays on one clock. */
  readonly receivedAtMs: number
}

export interface CandidateSearchBenchmarkHarness {
  readonly mode: CandidateSearchBenchmarkMode
  readonly client: SearchWorkerClient
  readonly observations: readonly CandidateSearchBenchmarkObservationRecord[]
  /** Round-trip time of one Worker event-loop turn, or null outside the seam. */
  ping(timeoutMs?: number): Promise<number | null>
  dispose(): void
}

export interface CandidateSearchBenchmarkHarnessDependencies {
  readonly createProductionClient?: () => SearchWorkerClient
  readonly createBenchmarkWorker?: () => Worker
}

function createBenchmarkWorker(): Worker {
  return new Worker(
    new URL('../workers/search.worker.benchmark.entry.ts', import.meta.url),
    { type: 'module' },
  )
}

export function createCandidateSearchBenchmarkHarness(
  mode: CandidateSearchBenchmarkMode,
  dependencies: CandidateSearchBenchmarkHarnessDependencies = {},
): CandidateSearchBenchmarkHarness {
  if (mode === 'production') {
    const client = (
      dependencies.createProductionClient ?? createProductionSearchWorkerClient
    )()
    return {
      mode,
      client,
      observations: [],
      ping: () => Promise.resolve(null),
      dispose: () => client.dispose(),
    }
  }

  const worker = (dependencies.createBenchmarkWorker ?? createBenchmarkWorker)()
  const observations: CandidateSearchBenchmarkObservationRecord[] = []
  const pongs = new Map<number, (receivedAtMs: number) => void>()
  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isCandidateSearchBenchmarkObservation(data)) return
    const observation: CandidateSearchBenchmarkObservation = data
    const record: CandidateSearchBenchmarkObservationRecord = {
      event: observation.event,
      targetRequestId: observation.targetRequestId,
      pingId: observation.pingId,
      workerElapsedMs: observation.workerElapsedMs,
      receivedAtMs: performance.now(),
    }
    observations.push(record)
    if (observation.event === 'pong' && observation.pingId !== null) {
      pongs.get(observation.pingId)?.(record.receivedAtMs)
      pongs.delete(observation.pingId)
    }
  }
  worker.addEventListener('message', listener)
  const client = createSearchWorkerClient(
    worker as unknown as WorkerLike,
    PRODUCTION_RNG_ENGINE_VERSION,
  )
  let nextPingId = 1

  return {
    mode,
    client,
    observations,
    ping: (timeoutMs = 5_000) =>
      new Promise<number | null>((resolve) => {
        const pingId = nextPingId++
        const startedAt = performance.now()
        const timer = globalThis.setTimeout(() => {
          pongs.delete(pingId)
          resolve(null)
        }, timeoutMs)
        pongs.set(pingId, (receivedAtMs) => {
          globalThis.clearTimeout(timer)
          resolve(receivedAtMs - startedAt)
        })
        worker.postMessage({
          type: 'benchmark_ping',
          requestId: CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
          pingId,
        })
      }),
    dispose: () => {
      worker.removeEventListener('message', listener)
      client.dispose()
    },
  }
}

export type WorkerErrorProbeOutcome =
  | 'rejected'
  | 'resolved'
  | 'pending_after_timeout'

export interface WorkerErrorProbeResult {
  readonly outcome: WorkerErrorProbeOutcome
  readonly errorEvents: number
  readonly messageErrorEvents: number
  readonly elapsedMs: number
  readonly detail: string
}

/**
 * Observes what the Production `SearchWorkerClient` does when its Worker fails
 * instead of replying. At B5 the client registered only a `message` listener,
 * so a Worker-level `error` never reached the pending request and the probe
 * reported `pending_after_timeout`. B6 made the client fail closed on a native
 * `error` / `messageerror`, so the same probe now reports `rejected` with a
 * `SearchWorkerRuntimeError`. The B5 record keeps its measured outcome.
 *
 * The URL is a same-origin path that does not exist, built at runtime so the
 * bundler leaves it alone and the Worker genuinely fails to load. This probe
 * only observes; it changes nothing.
 */
export function probeSearchWorkerErrorHandling(
  input: CandidateSearchInput,
  timeoutMs = 3_000,
): Promise<WorkerErrorProbeResult> {
  const missingUrl = new URL(
    `b5-missing-worker-${Date.now()}.js`,
    globalThis.location.href,
  ).href
  const worker = new Worker(missingUrl, { type: 'module' })
  let errorEvents = 0
  let messageErrorEvents = 0
  worker.addEventListener('error', () => {
    errorEvents += 1
  })
  worker.addEventListener('messageerror', () => {
    messageErrorEvents += 1
  })
  const client = createSearchWorkerClient(
    worker as unknown as WorkerLike,
    PRODUCTION_RNG_ENGINE_VERSION,
  )
  const startedAt = performance.now()

  return new Promise<WorkerErrorProbeResult>((resolve) => {
    let settled = false
    const finish = (outcome: WorkerErrorProbeOutcome, detail: string) => {
      if (settled) return
      settled = true
      const elapsedMs = performance.now() - startedAt
      client.dispose()
      resolve({ outcome, errorEvents, messageErrorEvents, elapsedMs, detail })
    }
    globalThis.setTimeout(
      () => finish('pending_after_timeout', 'startSearch never settled.'),
      timeoutMs,
    )
    client
      .startSearch(input)
      .then(() => finish('resolved', 'startSearch resolved unexpectedly.'))
      .catch((error: unknown) =>
        finish(
          'rejected',
          error instanceof Error ? error.message : 'Unknown rejection.',
        ),
      )
  })
}
