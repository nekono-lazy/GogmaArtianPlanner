import { describe, expect, it, vi } from 'vitest'
import {
  normalArtianAttributeClassFromElementId,
  type NormalArtianCounterIdentificationInput,
  type NormalArtianCounterIdentificationWorkerRequest,
  type NormalArtianCounterIdentificationWorkerResponse,
} from '../../domain/rng/identification'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { gameVerifiedHeavyBowgunFireNormalVectors as live } from '../../test/fixtures/gameVerifiedNormalVectors'
import {
  createNormalArtianCounterIdentificationWorkerClient,
  createProductionNormalArtianCounterIdentificationWorkerClient,
  NormalArtianCounterIdentificationCancelledError,
  NormalArtianCounterIdentificationDuplicateRequestError,
  NormalArtianCounterIdentificationWorkerError,
  NormalArtianCounterIdentificationWorkerUnavailableError,
  type NormalArtianCounterIdentificationWorkerLike,
} from './normalArtianCounterIdentificationWorkerClient'

class FakeWorker implements NormalArtianCounterIdentificationWorkerLike {
  readonly posted: NormalArtianCounterIdentificationWorkerRequest[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: NormalArtianCounterIdentificationWorkerResponse }) => void) | null = null

  postMessage(message: NormalArtianCounterIdentificationWorkerRequest): void {
    this.posted.push(message)
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: NormalArtianCounterIdentificationWorkerResponse }) => void,
  ): void {
    this.listener = listener
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { data: NormalArtianCounterIdentificationWorkerResponse }) => void,
  ): void {
    if (this.listener === listener) this.listener = null
  }

  emit(data: NormalArtianCounterIdentificationWorkerResponse): void {
    this.listener?.({ data })
  }

  get hasListener(): boolean {
    return this.listener !== null
  }
}

function input(): NormalArtianCounterIdentificationInput {
  return {
    baseSeed: String(live[0].baseSeed),
    weaponTypeId: 'weapon.heavy_bowgun',
    rarity: 8,
    observations: live.map((vector) => ({
      attributeClass: normalArtianAttributeClassFromElementId(vector.elementId),
      bonuses: vector.bonuses,
    })),
    normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
  }
}

const result = {
  matches: [{ startNormalCounter: 4 }],
  searchedCounterRange: { startInclusive: 0, endInclusive: 5_000 },
  isTruncated: false,
}

describe('NormalArtianCounterIdentificationWorkerClient', () => {
  it('posts the typed request, forwards progress, and resolves a result', async () => {
    const worker = new FakeWorker()
    const client = createNormalArtianCounterIdentificationWorkerClient(worker, 'fixture')
    const progress = vi.fn()
    const promise = client.identify('request.normal', input(), { onProgress: progress })
    expect(worker.posted).toEqual([
      { type: 'identify_normal_artian_counter', requestId: 'request.normal', input: input() },
    ])
    worker.emit({
      type: 'progress',
      requestId: 'request.normal',
      progress: { searchedCounters: 1_000, totalCounters: 5_001, matchesFound: 1 },
    })
    worker.emit({
      type: 'normal_artian_counter_identification_result',
      requestId: 'request.normal',
      result,
    })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledWith({ searchedCounters: 1_000, totalCounters: 5_001, matchesFound: 1 })
    expect(client.engineVersion).toBe('fixture')
  })

  it('cancels locally, posts cancel, and ignores late responses', async () => {
    const worker = new FakeWorker()
    const client = createNormalArtianCounterIdentificationWorkerClient(worker, 'fixture')
    const progress = vi.fn()
    const promise = client.identify('request.cancel', input(), { onProgress: progress })
    client.cancel('request.cancel')
    await expect(promise).rejects.toBeInstanceOf(NormalArtianCounterIdentificationCancelledError)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', requestId: 'request.cancel' })
    worker.emit({
      type: 'progress',
      requestId: 'request.cancel',
      progress: { searchedCounters: 1, totalCounters: 2, matchesFound: 0 },
    })
    worker.emit({
      type: 'normal_artian_counter_identification_result',
      requestId: 'request.cancel',
      result,
    })
    expect(progress).not.toHaveBeenCalled()
    client.cancel('request.cancel')
    expect(worker.posted.filter((message) => message.type === 'cancel')).toHaveLength(1)
  })

  it('rejects duplicate active IDs without replacing the original request, and allows reuse afterwards', async () => {
    const worker = new FakeWorker()
    const client = createNormalArtianCounterIdentificationWorkerClient(worker, 'fixture')
    const original = client.identify('request.duplicate', input())
    await expect(client.identify('request.duplicate', input())).rejects.toBeInstanceOf(
      NormalArtianCounterIdentificationDuplicateRequestError,
    )
    expect(worker.posted).toHaveLength(1)
    worker.emit({
      type: 'normal_artian_counter_identification_result',
      requestId: 'request.duplicate',
      result,
    })
    await expect(original).resolves.toEqual(result)
    const reused = client.identify('request.duplicate', input())
    expect(worker.posted).toHaveLength(2)
    worker.emit({
      type: 'normal_artian_counter_identification_result',
      requestId: 'request.duplicate',
      result,
    })
    await expect(reused).resolves.toEqual(result)
  })

  it('ignores stale IDs and preserves Worker error classification including normal_pool_unverified', async () => {
    const worker = new FakeWorker()
    const client = createNormalArtianCounterIdentificationWorkerClient(worker, 'fixture')
    const promise = client.identify('request.error', input())
    worker.emit({
      type: 'error',
      requestId: 'stale',
      message: 'old error',
      code: 'unexpected_error',
      unsupportedReason: null,
    })
    worker.emit({
      type: 'error',
      requestId: 'request.error',
      message: 'pool unverified',
      code: 'unsupported_input',
      unsupportedReason: 'normal_pool_unverified',
    })
    const error = await promise.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NormalArtianCounterIdentificationWorkerError)
    expect(error).toMatchObject({
      message: 'pool unverified',
      code: 'unsupported_input',
      unsupportedReason: 'normal_pool_unverified',
    })

    const unexpected = client.identify('request.unexpected', input())
    worker.emit({
      type: 'error',
      requestId: 'request.unexpected',
      message: 'boom',
      code: 'unexpected_error',
      unsupportedReason: null,
    })
    await expect(unexpected).rejects.toMatchObject({ code: 'unexpected_error', unsupportedReason: null })
  })

  it('rejects pending requests, detaches, and terminates on dispose', async () => {
    const worker = new FakeWorker()
    const client = createNormalArtianCounterIdentificationWorkerClient(worker, 'fixture')
    const pending = client.identify('request.dispose', input())
    client.dispose()
    await expect(pending).rejects.toBeInstanceOf(NormalArtianCounterIdentificationCancelledError)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.hasListener).toBe(false)
    await expect(client.identify('request.after', input())).rejects.toThrow('disposed')
    client.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('keeps Worker runtime unavailability separate from Production capability', async () => {
    vi.stubGlobal('Worker', undefined)
    try {
      const client = createProductionNormalArtianCounterIdentificationWorkerClient()
      expect(client.engineVersion).toBe('production-engine-unavailable')
      await expect(client.identify('request.unavailable', input())).rejects.toBeInstanceOf(
        NormalArtianCounterIdentificationWorkerUnavailableError,
      )
      expect(() => client.cancel('request.unavailable')).not.toThrow()
      expect(() => client.dispose()).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('constructs the inactive Production foundation with the shared Engine version', () => {
    vi.stubGlobal('Worker', FakeWorker)
    try {
      const client = createProductionNormalArtianCounterIdentificationWorkerClient()
      expect(client.engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
      client.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
