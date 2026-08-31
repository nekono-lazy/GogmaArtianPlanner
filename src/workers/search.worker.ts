import type { RngEngine } from '../domain/rng/rngEngine'
import { searchCandidates } from '../domain/search/candidateSearch'
import { CandidateSearchError } from '../domain/search/searchTypes'
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '../domain/search/searchTypes'

export type SearchWorkerPostMessage = (response: SearchWorkerResponse) => void
export type SearchWorkerRngEngineFactory = () => RngEngine

export interface SearchWorkerController {
  handleMessage: (request: SearchWorkerRequest) => Promise<void>
  isCancelled: (requestId: string) => boolean
}

function workerYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function createSearchWorkerController(
  engine: RngEngine,
  postMessage: SearchWorkerPostMessage,
): SearchWorkerController {
  const cancelledRequestIds = new Set<string>()

  return {
    isCancelled: (requestId) => cancelledRequestIds.has(requestId),
    handleMessage: async (request) => {
      if (request.type === 'cancel') {
        cancelledRequestIds.add(request.requestId)
        return
      }

      cancelledRequestIds.delete(request.requestId)
      try {
        const result = await searchCandidates(request.input, engine, {
          shouldCancel: () => cancelledRequestIds.has(request.requestId),
          yieldControl: workerYield,
          onProgress: (progress) => {
            if (!cancelledRequestIds.has(request.requestId)) {
              postMessage({
                type: 'progress',
                requestId: request.requestId,
                ...progress,
              })
            }
          },
        })
        if (!cancelledRequestIds.has(request.requestId)) {
          postMessage({
            type: 'candidate_search_result',
            requestId: request.requestId,
            result,
          })
        }
      } catch (error: unknown) {
        if (
          cancelledRequestIds.has(request.requestId) ||
          (error instanceof CandidateSearchError && error.code === 'cancelled')
        ) {
          return
        }
        postMessage({
          type: 'error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : 'Unknown search error.',
        })
      }
    },
  }
}

export interface CandidateSearchWorkerScope {
  postMessage: SearchWorkerPostMessage
  addEventListener: (
    type: 'message',
    listener: (event: { data: SearchWorkerRequest }) => void,
  ) => void
}

/**
 * Creates the worker-local Engine from the entry composition and attaches the
 * structured-clone message contract.
 */
export function attachSearchWorker(
  scope: CandidateSearchWorkerScope,
  createEngine: SearchWorkerRngEngineFactory,
): SearchWorkerController {
  const engine = createEngine()
  const controller = createSearchWorkerController(engine, (response) =>
    scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    void controller.handleMessage(event.data)
  })
  return controller
}
