import { describe, expect, it, vi } from 'vitest'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import type { SearchWorkerRequest, SearchWorkerResponse } from '../../domain/search'
import { createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import {
  createProductionSearchWorkerClient,
  createSearchWorkerClient,
  SearchCancelledError,
  SearchWorkerRuntimeError,
  type SearchWorkerEventListenerMap,
  type SearchWorkerNativeErrorEvent,
  type WorkerLike,
} from './searchWorkerClient'

type MessageListener = SearchWorkerEventListenerMap['message']
type NativeListener = SearchWorkerEventListenerMap['error']

class FakeWorker implements WorkerLike {
  readonly posted: SearchWorkerRequest[] = []
  readonly terminate = vi.fn()
  private message: MessageListener | null = null
  private error: NativeListener | null = null
  private messageError: NativeListener | null = null

  postMessage(message: SearchWorkerRequest) { this.posted.push(message) }

  addEventListener<K extends keyof SearchWorkerEventListenerMap>(
    type: K,
    listener: SearchWorkerEventListenerMap[K],
  ) {
    if (type === 'message') this.message = listener as MessageListener
    if (type === 'error') this.error = listener as NativeListener
    if (type === 'messageerror') this.messageError = listener as NativeListener
  }

  removeEventListener<K extends keyof SearchWorkerEventListenerMap>(
    type: K,
    listener: SearchWorkerEventListenerMap[K],
  ) {
    if (type === 'message' && this.message === listener) this.message = null
    if (type === 'error' && this.error === listener) this.error = null
    if (type === 'messageerror' && this.messageError === listener) this.messageError = null
  }

  get listenerCount(): number {
    return [this.message, this.error, this.messageError].filter((listener) => listener !== null).length
  }

  emit(data: SearchWorkerResponse) { this.message?.({ data }) }
  emitError(event: SearchWorkerNativeErrorEvent = {}) { this.error?.(event) }
  emitMessageError(event: SearchWorkerNativeErrorEvent = {}) { this.messageError?.(event) }
}

function fixtureResult(searchRunId: string, calculationContext: ReturnType<typeof createCandidateSearchInput>['calculationContext']) {
  return { searchRunId, calculationContext, targetResults: [], relaxationSuggestions: [], warnings: [], elapsedMs: 1, isTruncated: false }
}

describe('SearchWorkerClient', () => {
  it('uses the Production RNG version for the production Worker client', () => {
    vi.stubGlobal('Worker', FakeWorker)
    try {
      const client = createProductionSearchWorkerClient()
      expect(client.engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
      client.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves requestId, forwards progress, and resolves a result', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fake-fixture:candidate-search-v1')
    const input = createCandidateSearchInput()
    const progress = vi.fn()
    const promise = client.startSearch(input, { onProgress: progress })
    expect(worker.posted[0]).toEqual({ type: 'candidate_search', requestId: input.searchRunId, input })
    worker.emit({
      type: 'progress', requestId: input.searchRunId, completedTargets: 1, totalTargets: 2,
      currentTargetWeaponId: input.targetWeaponIds[0], phase: 'searching', processedWorkItems: 300,
    })
    const result = fixtureResult(input.searchRunId, input.calculationContext)
    worker.emit({ type: 'candidate_search_result', requestId: input.searchRunId, result })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith({
      completedTargets: 1, totalTargets: 2, currentTargetWeaponId: input.targetWeaponIds[0],
      phase: 'searching', processedWorkItems: 300,
    })
  })

  it('cancels locally, sends cancel, and ignores a late result', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fixture')
    const input = createCandidateSearchInput()
    const promise = client.startSearch(input)
    client.cancelSearch(input.searchRunId)
    await expect(promise).rejects.toBeInstanceOf(SearchCancelledError)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', requestId: input.searchRunId })
    worker.emit({ type: 'candidate_search_result', requestId: input.searchRunId, result: fixtureResult(input.searchRunId, input.calculationContext) })
  })

  it('ignores stale response IDs and converts protocol Worker errors', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fixture')
    const input = createCandidateSearchInput()
    const promise = client.startSearch(input)
    worker.emit({ type: 'error', requestId: 'stale', message: 'old error' })
    worker.emit({ type: 'error', requestId: input.searchRunId, message: 'worker failed' })
    await expect(promise).rejects.toThrow('worker failed')
    // A protocol error is a handled search failure; the Worker stays usable.
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(worker.listenerCount).toBe(3)
    const next = createCandidateSearchInput()
    const reused = client.startSearch(next)
    expect(worker.posted.at(-1)).toEqual({ type: 'candidate_search', requestId: next.searchRunId, input: next })
    client.cancelSearch(next.searchRunId)
    await expect(reused).rejects.toBeInstanceOf(SearchCancelledError)
  })

  it.each([
    ['error', (worker: FakeWorker) => worker.emitError({ message: 'boom' }), 'worker_error'],
    ['messageerror', (worker: FakeWorker) => worker.emitMessageError({ message: 'boom' }), 'worker_message_error'],
  ] as const)('fails closed on a native %s event', async (_type, emit, code) => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fixture')
    const first = client.startSearch(createCandidateSearchInput())
    const second = client.startSearch({ ...createCandidateSearchInput(), searchRunId: 'search.second' })
    emit(worker)

    for (const pending of [first, second]) {
      await expect(pending).rejects.toBeInstanceOf(SearchWorkerRuntimeError)
      await expect(pending).rejects.toMatchObject({ code, detail: 'boom' })
      await expect(pending).rejects.toThrow('Search Workerでエラーが発生したため検索を続行できません。')
    }
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.listenerCount).toBe(0)

    const posted = worker.posted.length
    await expect(client.startSearch(createCandidateSearchInput())).rejects.toBeInstanceOf(SearchWorkerRuntimeError)
    expect(worker.posted).toHaveLength(posted)

    // A later native event and dispose() must not terminate the Worker twice.
    worker.emitError()
    client.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('drops every listener and rejects pending searches on dispose', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fixture')
    const promise = client.startSearch(createCandidateSearchInput())
    client.dispose()
    await expect(promise).rejects.toBeInstanceOf(SearchCancelledError)
    expect(worker.listenerCount).toBe(0)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
