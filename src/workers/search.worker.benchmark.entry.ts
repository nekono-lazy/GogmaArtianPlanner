import {
  CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
  isCandidateSearchBenchmarkPing,
  type CandidateSearchBenchmarkObservation,
  type CandidateSearchBenchmarkObservationEvent,
} from '../benchmarks/candidateSearchBenchmarkProtocol'
import type { SearchWorkerRequest, SearchWorkerResponse } from '../domain/search'
import { createSearchWorkerController } from './search.worker'
import { createProductionSearchRngEngine } from './search.worker.production'

/**
 * B5 benchmark-only Worker entry.
 *
 * It composes the same Production Engine and the same
 * `createSearchWorkerController` as `search.worker.entry.ts`, so the measured
 * search path is the Production path. The only difference is the out-of-band
 * observation messages defined in `candidateSearchBenchmarkProtocol.ts`, which
 * make the Worker's own event loop and stop time observable. The Production
 * Worker protocol is unchanged and the normal app never loads this entry.
 */
interface BenchmarkWorkerScope {
  postMessage: (message: SearchWorkerResponse | CandidateSearchBenchmarkObservation) => void
  addEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void
}

const scope = self as unknown as BenchmarkWorkerScope

const controller = createSearchWorkerController(
  createProductionSearchRngEngine(),
  (response) => scope.postMessage(response),
)

function observe(
  event: CandidateSearchBenchmarkObservationEvent,
  targetRequestId: string | null,
  pingId: number | null = null,
  workerElapsedMs: number | null = null,
): void {
  scope.postMessage({
    type: 'benchmark_observation',
    requestId: CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
    event,
    targetRequestId,
    pingId,
    workerElapsedMs,
  })
}

scope.addEventListener('message', (event) => {
  const data = event.data
  if (isCandidateSearchBenchmarkPing(data)) {
    observe('pong', null, data.pingId)
    return
  }
  const request = data as SearchWorkerRequest
  if (request.type === 'cancel') {
    // The controller records the cancellation synchronously, so this ack is
    // posted in the same task that processed the cancel message.
    void controller.handleMessage(request)
    observe('cancel_received', request.requestId)
    return
  }
  const startedAt = performance.now()
  observe('search_received', request.requestId)
  void controller.handleMessage(request).then(() => {
    observe('search_settled', request.requestId, null, performance.now() - startedAt)
  })
})
