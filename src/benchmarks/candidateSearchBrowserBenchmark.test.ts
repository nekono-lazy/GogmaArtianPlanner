import { describe, expect, it, vi } from 'vitest'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { CandidateSearchResult, SearchWorkerResponse } from '../domain/search'
import {
  CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
  isCandidateSearchBenchmarkObservation,
  isCandidateSearchBenchmarkPing,
  type CandidateSearchBenchmarkObservation,
} from './candidateSearchBenchmarkProtocol'
import { createCandidateSearchBenchmarkHarness } from './candidateSearchBrowserBenchmark'
import { createCandidateSearchBenchmarkInput } from './candidateSearchBenchmarkFixtures'

type WorkerMessage = SearchWorkerResponse | CandidateSearchBenchmarkObservation

/** Minimal stand-in for the benchmark Worker's message plumbing. */
class FakeBenchmarkWorker {
  readonly posted: unknown[] = []
  readonly terminate = vi.fn()
  // Keyed by event type: the Production client also listens for the native
  // `error` / `messageerror` events, and a message must never reach those.
  private listeners = new Map<string, Array<(event: { data: WorkerMessage }) => void>>()

  postMessage(message: unknown) {
    this.posted.push(message)
    if (isCandidateSearchBenchmarkPing(message)) {
      this.emit({
        type: 'benchmark_observation',
        requestId: CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
        event: 'pong',
        targetRequestId: null,
        pingId: message.pingId,
        workerElapsedMs: null,
      })
    }
  }
  addEventListener(type: string, listener: (event: { data: WorkerMessage }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (event: { data: WorkerMessage }) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    )
  }
  emit(data: WorkerMessage) {
    for (const listener of [...(this.listeners.get('message') ?? [])]) listener({ data })
  }
}

function emptyResult(requestId: string): CandidateSearchResult {
  const { input } = createCandidateSearchBenchmarkInput('near_ideal_default_bounds', requestId)
  return {
    searchRunId: requestId,
    calculationContext: input.calculationContext,
    targetResult: { targetWeaponId: 'target.fixture.a' as never, candidate: null, searchedRoutes: [], skippedRoutes: [] },
    warnings: [],
    elapsedMs: 1,
  }
}

describe('B5 benchmark observation protocol', () => {
  it('recognizes only its own message shapes', () => {
    expect(isCandidateSearchBenchmarkObservation({ type: 'benchmark_observation' })).toBe(true)
    expect(isCandidateSearchBenchmarkObservation({ type: 'progress' })).toBe(false)
    expect(isCandidateSearchBenchmarkObservation(null)).toBe(false)
    expect(isCandidateSearchBenchmarkPing({ type: 'benchmark_ping', pingId: 1 })).toBe(true)
    expect(isCandidateSearchBenchmarkPing({ type: 'cancel' })).toBe(false)
  })

  it('uses a reserved requestId that no Production request can hold', () => {
    const { input } = createCandidateSearchBenchmarkInput(
      'near_ideal_default_bounds',
      'request.benchmark',
    )
    expect(input.searchRunId).not.toBe(CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID)
  })
})

describe('B5 benchmark harness seam', () => {
  it('collects Worker observations without disturbing the Production client', async () => {
    const worker = new FakeBenchmarkWorker()
    const harness = createCandidateSearchBenchmarkHarness('benchmark_seam', {
      createBenchmarkWorker: () => worker as unknown as Worker,
    })
    expect(harness.client.engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)

    const { input } = createCandidateSearchBenchmarkInput(
      'near_ideal_default_bounds',
      'request.seam',
    )
    const promise = harness.client.startSearch(input)
    // An observation must never settle the pending Production request.
    worker.emit({
      type: 'benchmark_observation',
      requestId: CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
      event: 'search_received',
      targetRequestId: input.searchRunId,
      pingId: null,
      workerElapsedMs: null,
    })
    let settled = false
    void promise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    const result = emptyResult(input.searchRunId)
    worker.emit({ type: 'candidate_search_result', requestId: input.searchRunId, result })
    await expect(promise).resolves.toEqual(result)
    expect(harness.observations).toEqual([
      expect.objectContaining({ event: 'search_received', targetRequestId: input.searchRunId }),
    ])
    harness.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('measures one Worker event-loop round trip through ping', async () => {
    const worker = new FakeBenchmarkWorker()
    const harness = createCandidateSearchBenchmarkHarness('benchmark_seam', {
      createBenchmarkWorker: () => worker as unknown as Worker,
    })
    await expect(harness.ping()).resolves.toBeGreaterThanOrEqual(0)
    expect(worker.posted.at(-1)).toEqual({
      type: 'benchmark_ping',
      requestId: CANDIDATE_SEARCH_BENCHMARK_OBSERVATION_ID,
      pingId: 1,
    })
    harness.dispose()
  })

  it('keeps the production mode on the unmodified Production client', () => {
    const dispose = vi.fn()
    const client = {
      engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      startSearch: vi.fn(),
      cancelSearch: vi.fn(),
      dispose,
    }
    const harness = createCandidateSearchBenchmarkHarness('production', {
      createProductionClient: () => client,
    })
    expect(harness.client).toBe(client)
    expect(harness.observations).toEqual([])
    harness.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
