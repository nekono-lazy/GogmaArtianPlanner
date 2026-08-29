import { describe, expect, it, vi } from 'vitest'
import type { SearchWorkerRequest, SearchWorkerResponse } from '../../domain/search'
import { createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import { createSearchWorkerClient, SearchCancelledError, type WorkerLike } from './searchWorkerClient'

class FakeWorker implements WorkerLike {
  readonly posted: SearchWorkerRequest[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: SearchWorkerResponse }) => void) | null = null
  postMessage(message: SearchWorkerRequest) { this.posted.push(message) }
  addEventListener(_type: 'message', listener: (event: { data: SearchWorkerResponse }) => void) { this.listener = listener }
  removeEventListener(_type: 'message', listener: (event: { data: SearchWorkerResponse }) => void) { if (this.listener === listener) this.listener = null }
  emit(data: SearchWorkerResponse) { this.listener?.({ data }) }
}

describe('SearchWorkerClient', () => {
  it('preserves requestId, forwards progress, and resolves a result', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fake-fixture:candidate-search-v1')
    const input = createCandidateSearchInput()
    const progress = vi.fn()
    const promise = client.startSearch(input, { onProgress: progress })
    expect(worker.posted[0]).toEqual({ type: 'candidate_search', requestId: input.searchRunId, input })
    worker.emit({ type: 'progress', requestId: input.searchRunId, completedTargets: 1, totalTargets: 2, currentTargetWeaponId: input.targetWeaponIds[0] })
    const result = { searchRunId: input.searchRunId, calculationContext: input.calculationContext, targetResults: [], relaxationSuggestions: [], warnings: [], elapsedMs: 1, isTruncated: false }
    worker.emit({ type: 'candidate_search_result', requestId: input.searchRunId, result })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledOnce()
  })

  it('cancels locally, sends cancel, and ignores a late result', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fixture')
    const input = createCandidateSearchInput()
    const promise = client.startSearch(input)
    client.cancelSearch(input.searchRunId)
    await expect(promise).rejects.toBeInstanceOf(SearchCancelledError)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', requestId: input.searchRunId })
    worker.emit({ type: 'candidate_search_result', requestId: input.searchRunId, result: { searchRunId: input.searchRunId, calculationContext: input.calculationContext, targetResults: [], relaxationSuggestions: [], warnings: [], elapsedMs: 1, isTruncated: false } })
  })

  it('ignores stale response IDs and converts Worker errors', async () => {
    const worker = new FakeWorker()
    const client = createSearchWorkerClient(worker, 'fixture')
    const input = createCandidateSearchInput()
    const promise = client.startSearch(input)
    worker.emit({ type: 'error', requestId: 'stale', message: 'old error' })
    worker.emit({ type: 'error', requestId: input.searchRunId, message: 'worker failed' })
    await expect(promise).rejects.toThrow('worker failed')
  })
})
