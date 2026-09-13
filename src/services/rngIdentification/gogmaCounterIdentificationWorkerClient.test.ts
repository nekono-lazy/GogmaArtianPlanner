import { describe, expect, it, vi } from 'vitest'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type {
  GogmaCounterIdentificationInput,
  GogmaCounterIdentificationWorkerRequest,
  GogmaCounterIdentificationWorkerResponse,
} from '../../domain/rng/identification'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { gameVerifiedGogmaCounterIdentificationVector as live } from '../../test/fixtures/gameVerifiedGogmaVectors'
import {
  createGogmaCounterIdentificationWorkerClient,
  createProductionGogmaCounterIdentificationWorkerClient,
  GogmaCounterIdentificationCancelledError,
  GogmaCounterIdentificationDuplicateRequestError,
  GogmaCounterIdentificationWorkerError,
  GogmaCounterIdentificationWorkerUnavailableError,
  type GogmaCounterIdentificationWorkerLike,
} from './gogmaCounterIdentificationWorkerClient'

class FakeWorker implements GogmaCounterIdentificationWorkerLike {
  readonly posted: GogmaCounterIdentificationWorkerRequest[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: GogmaCounterIdentificationWorkerResponse }) => void) | null = null

  postMessage(message: GogmaCounterIdentificationWorkerRequest): void {
    this.posted.push(message)
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: GogmaCounterIdentificationWorkerResponse }) => void,
  ): void {
    this.listener = listener
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { data: GogmaCounterIdentificationWorkerResponse }) => void,
  ): void {
    if (this.listener === listener) this.listener = null
  }

  emit(data: GogmaCounterIdentificationWorkerResponse): void {
    this.listener?.({ data })
  }
}

function input(): GogmaCounterIdentificationInput {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
  return {
    baseSeed: String(live.baseSeed),
    weaponTypeId: live.weaponTypeId,
    elementId: live.elementId,
    observations: live.observations,
    gogmaCounterRange: { startInclusive: 50, endInclusive: 65 },
    master: {
      weaponTypes: loaded.data.weaponTypes,
      elements: loaded.data.elements,
      bonusTypes: loaded.data.bonusTypes,
      weaponBonusDefinitions: loaded.data.weaponBonusDefinitions,
    },
  }
}

const result = {
  matches: [{ startGogmaCounter: 55 }],
  searchedCounterRange: { startInclusive: 50, endInclusive: 65 },
  isTruncated: false,
}

describe('GogmaCounterIdentificationWorkerClient', () => {
  it('forwards progress and resolves a result', async () => {
    const worker = new FakeWorker()
    const client = createGogmaCounterIdentificationWorkerClient(worker, 'fixture')
    const progress = vi.fn()
    const promise = client.identify('request.gogma', input(), { onProgress: progress })
    worker.emit({
      type: 'progress',
      requestId: 'request.gogma',
      progress: { searchedCounters: 5, totalCounters: 11, matchesFound: 0 },
    })
    worker.emit({
      type: 'gogma_counter_identification_result',
      requestId: 'request.gogma',
      result,
    })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledOnce()
  })

  it('cancels locally, posts cancel, and ignores late responses', async () => {
    const worker = new FakeWorker()
    const client = createGogmaCounterIdentificationWorkerClient(worker, 'fixture')
    const promise = client.identify('request.cancel', input())
    client.cancel('request.cancel')
    await expect(promise).rejects.toBeInstanceOf(GogmaCounterIdentificationCancelledError)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', requestId: 'request.cancel' })
    worker.emit({
      type: 'gogma_counter_identification_result',
      requestId: 'request.cancel',
      result,
    })
  })

  it('rejects duplicate active IDs without replacing the original request', async () => {
    const worker = new FakeWorker()
    const client = createGogmaCounterIdentificationWorkerClient(worker, 'fixture')
    const original = client.identify('request.duplicate', input())
    await expect(client.identify('request.duplicate', input())).rejects.toBeInstanceOf(
      GogmaCounterIdentificationDuplicateRequestError,
    )
    expect(worker.posted).toHaveLength(1)
    worker.emit({
      type: 'gogma_counter_identification_result',
      requestId: 'request.duplicate',
      result,
    })
    await expect(original).resolves.toEqual(result)
  })

  it('ignores stale IDs and preserves Worker error classification', async () => {
    const worker = new FakeWorker()
    const client = createGogmaCounterIdentificationWorkerClient(worker, 'fixture')
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
      message: 'master unavailable',
      code: 'unsupported_input',
      unsupportedReason: 'master_data_unavailable',
    })
    const error = await promise.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GogmaCounterIdentificationWorkerError)
    expect(error).toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'master_data_unavailable',
    })
  })

  it('keeps Worker runtime unavailability separate from Production capability', async () => {
    vi.stubGlobal('Worker', undefined)
    try {
      const client = createProductionGogmaCounterIdentificationWorkerClient()
      expect(client.engineVersion).toBe('production-engine-unavailable')
      await expect(client.identify('request.unavailable', input())).rejects.toBeInstanceOf(
        GogmaCounterIdentificationWorkerUnavailableError,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('constructs the inactive Production foundation with the shared Engine version', () => {
    vi.stubGlobal('Worker', FakeWorker)
    try {
      const client = createProductionGogmaCounterIdentificationWorkerClient()
      expect(client.engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
      client.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
