import type {
  CandidateSearchInput,
  CandidateSearchProgress,
  CandidateSearchResult,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '../../domain/search'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'

export class SearchCancelledError extends Error {
  constructor() {
    super('Candidate search was cancelled.')
    this.name = 'SearchCancelledError'
  }
}

export class ProductionRngEngineUnavailableError extends Error {
  constructor() {
    super('この環境ではSearch Workerを利用できないため、現在は実検索を開始できません。')
    this.name = 'ProductionRngEngineUnavailableError'
  }
}

export interface SearchWorkerClientCallbacks {
  onProgress?: (progress: CandidateSearchProgress) => void
}

export interface SearchWorkerClient {
  readonly engineVersion: string
  startSearch: (
    input: CandidateSearchInput,
    callbacks?: SearchWorkerClientCallbacks,
  ) => Promise<CandidateSearchResult>
  cancelSearch: (requestId: string) => void
  dispose: () => void
}

export interface WorkerLike {
  postMessage(message: SearchWorkerRequest): void
  addEventListener(
    type: 'message',
    listener: (event: { data: SearchWorkerResponse }) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: { data: SearchWorkerResponse }) => void,
  ): void
  terminate(): void
}

interface PendingSearch {
  resolve: (result: CandidateSearchResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: CandidateSearchProgress) => void
}

export function createSearchWorkerClient(
  worker: WorkerLike,
  engineVersion: string,
): SearchWorkerClient {
  const pending = new Map<string, PendingSearch>()
  let disposed = false

  const handleMessage = ({ data }: { data: SearchWorkerResponse }) => {
    const current = pending.get(data.requestId)
    if (!current) return
    if (data.type === 'progress') {
      current.onProgress?.({
        completedTargets: data.completedTargets,
        totalTargets: data.totalTargets,
        currentTargetWeaponId: data.currentTargetWeaponId,
      })
      return
    }
    pending.delete(data.requestId)
    if (data.type === 'error') {
      current.reject(new Error(data.message))
      return
    }
    current.resolve(data.result)
  }
  worker.addEventListener('message', handleMessage)

  return {
    engineVersion,
    startSearch: (input, callbacks = {}) => {
      if (disposed) return Promise.reject(new Error('Search Worker Client is disposed.'))
      const requestId = input.searchRunId
      const existing = pending.get(requestId)
      existing?.reject(new SearchCancelledError())
      pending.delete(requestId)
      return new Promise<CandidateSearchResult>((resolve, reject) => {
        pending.set(requestId, {
          resolve,
          reject,
          onProgress: callbacks.onProgress,
        })
        worker.postMessage({ type: 'candidate_search', requestId, input })
      })
    },
    cancelSearch: (requestId) => {
      const current = pending.get(requestId)
      if (!current) return
      pending.delete(requestId)
      current.reject(new SearchCancelledError())
      worker.postMessage({ type: 'cancel', requestId })
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      pending.forEach(({ reject }) => reject(new SearchCancelledError()))
      pending.clear()
      worker.removeEventListener('message', handleMessage)
      worker.terminate()
    },
  }
}

export function createUnavailableSearchWorkerClient(): SearchWorkerClient {
  return {
    engineVersion: 'production-engine-unavailable',
    startSearch: () => Promise.reject(new ProductionRngEngineUnavailableError()),
    cancelSearch: () => undefined,
    dispose: () => undefined,
  }
}

export function createProductionSearchWorkerClient(): SearchWorkerClient {
  if (typeof Worker === 'undefined') return createUnavailableSearchWorkerClient()
  const worker = new Worker(
    new URL('../../workers/search.worker.entry.ts', import.meta.url),
    { type: 'module' },
  )
  return createSearchWorkerClient(
    worker as unknown as WorkerLike,
    PRODUCTION_RNG_ENGINE_VERSION,
  )
}
