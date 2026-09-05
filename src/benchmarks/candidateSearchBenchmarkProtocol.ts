/**
 * B5 benchmark-only Worker observation messages.
 *
 * These exist because `SearchWorkerClient.cancelSearch()` rejects its pending
 * Promise locally before it posts the cancel message, so a fast Promise
 * rejection proves nothing about the Worker. The observations below are posted
 * from a benchmark-only Worker entry that runs the unmodified Production
 * controller; they add out-of-band messages and change no Production behavior.
 *
 * Every observation uses one constant `requestId` that no search request can
 * hold, so the Production `SearchWorkerClient` attached to the same Worker
 * finds no pending entry for it and ignores it.
 */
export const CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID =
  '__b5_candidate_search_benchmark__'

export type CandidateSearchBenchmarkObservationEvent =
  /** The Worker's event loop reached a `candidate_search` request. */
  | 'search_received'
  /** The controller's handling of that request finished, including cancel. */
  | 'search_settled'
  /** The Worker's event loop reached and processed a `cancel` request. */
  | 'cancel_received'
  /** Reply to a benchmark ping; measures Worker event-loop responsiveness. */
  | 'pong'

export interface CandidateSearchBenchmarkObservation {
  readonly type: 'benchmark_observation'
  readonly requestId: typeof CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID
  readonly event: CandidateSearchBenchmarkObservationEvent
  readonly targetRequestId: string | null
  readonly pingId: number | null
  /** Worker-local elapsed time; never compared against a main-thread clock. */
  readonly workerElapsedMs: number | null
}

export interface CandidateSearchBenchmarkPing {
  readonly type: 'benchmark_ping'
  readonly requestId: typeof CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID
  readonly pingId: number
}

export function isCandidateSearchBenchmarkObservation(
  value: unknown,
): value is CandidateSearchBenchmarkObservation {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'benchmark_observation'
  )
}

export function isCandidateSearchBenchmarkPing(
  value: unknown,
): value is CandidateSearchBenchmarkPing {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'benchmark_ping'
  )
}
