import { describe, expect, it, vi } from 'vitest'
import type {
  SkillIdentificationInput,
  SkillIdentificationWorkerRequest,
  SkillIdentificationWorkerResponse,
} from '../../domain/rng/identification'
import { referenceSkillCombinationFromIndex } from '../../domain/rng/production/referenceSkillPools'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import {
  createProductionSkillIdentificationWorkerClient,
  createSkillIdentificationWorkerClient,
  SkillIdentificationCancelledError,
  SkillIdentificationDuplicateRequestError,
  SkillIdentificationWorkerError,
  SkillIdentificationWorkerUnavailableError,
  type SkillIdentificationWorkerLike,
} from './skillIdentificationWorkerClient'

class FakeWorker implements SkillIdentificationWorkerLike {
  readonly posted: SkillIdentificationWorkerRequest[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: SkillIdentificationWorkerResponse }) => void) | null = null

  postMessage(message: SkillIdentificationWorkerRequest): void {
    this.posted.push(message)
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: SkillIdentificationWorkerResponse }) => void,
  ): void {
    this.listener = listener
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { data: SkillIdentificationWorkerResponse }) => void,
  ): void {
    if (this.listener === listener) this.listener = null
  }

  emit(data: SkillIdentificationWorkerResponse): void {
    this.listener?.({ data })
  }
}

const observations = [275, 255, 245, 243]
  .map(referenceSkillCombinationFromIndex)
  .map(({ seriesSkillId, groupSkillId }) => ({ seriesSkillId, groupSkillId }))

const input: SkillIdentificationInput = {
  weaponTypeId: 'weapon.insect_glaive',
  elementId: 'element.thunder',
  observations,
  seedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
  skillCounterRange: { startInclusive: 180, endInclusive: 190 },
}

describe('SkillIdentificationWorkerClient', () => {
  it('forwards progress and resolves a result', async () => {
    const worker = new FakeWorker()
    const client = createSkillIdentificationWorkerClient(worker, 'fixture')
    const progress = vi.fn()
    const promise = client.identify('request.skill', input, { onProgress: progress })
    expect(worker.posted[0]).toEqual({
      type: 'identify_skill_seed_counter',
      requestId: 'request.skill',
      input,
    })
    worker.emit({
      type: 'progress',
      requestId: 'request.skill',
      progress: { searchedSeeds: 10, totalSeeds: 50_001, matchesFound: 0 },
    })
    const result = {
      matches: [{ baseSeed: 8_524_433, startSkillCounter: 186 }],
      searchedSeedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
      isTruncated: false,
    }
    worker.emit({
      type: 'skill_identification_result',
      requestId: 'request.skill',
      result,
    })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledOnce()
  })

  it('cancels locally, posts cancel, and ignores a late result', async () => {
    const worker = new FakeWorker()
    const client = createSkillIdentificationWorkerClient(worker, 'fixture')
    const promise = client.identify('request.cancel', input)
    client.cancel('request.cancel')
    await expect(promise).rejects.toBeInstanceOf(SkillIdentificationCancelledError)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', requestId: 'request.cancel' })
    worker.emit({
      type: 'skill_identification_result',
      requestId: 'request.cancel',
      result: {
        matches: [],
        searchedSeedRange: input.seedRange!,
        isTruncated: false,
      },
    })
  })

  it('rejects a duplicate active requestId without replacing the original request', async () => {
    const worker = new FakeWorker()
    const client = createSkillIdentificationWorkerClient(worker, 'fixture')
    const original = client.identify('request.duplicate', input)
    const duplicate = client.identify('request.duplicate', input)

    await expect(duplicate).rejects.toBeInstanceOf(SkillIdentificationDuplicateRequestError)
    expect(worker.posted).toHaveLength(1)

    const result = {
      matches: [{ baseSeed: 8_524_433, startSkillCounter: 186 }],
      searchedSeedRange: input.seedRange!,
      isTruncated: false,
    }
    worker.emit({
      type: 'skill_identification_result',
      requestId: 'request.duplicate',
      result,
    })
    await expect(original).resolves.toEqual(result)
  })

  it('ignores stale IDs and preserves Worker error classification', async () => {
    const worker = new FakeWorker()
    const client = createSkillIdentificationWorkerClient(worker, 'fixture')
    const promise = client.identify('request.error', input)
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
      message: 'unsupported weapon',
      code: 'unsupported_input',
      unsupportedReason: 'reference_adapter_unsupported',
    })
    const error = await promise.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SkillIdentificationWorkerError)
    expect(error).toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'reference_adapter_unsupported',
    })
  })

  it('keeps Worker runtime availability separate from Production capability', async () => {
    vi.stubGlobal('Worker', undefined)
    try {
      const client = createProductionSkillIdentificationWorkerClient()
      expect(client.engineVersion).toBe('production-engine-unavailable')
      await expect(client.identify('request.unavailable', input)).rejects.toBeInstanceOf(
        SkillIdentificationWorkerUnavailableError,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('constructs the inactive Production foundation with the shared Engine version', () => {
    vi.stubGlobal('Worker', FakeWorker)
    try {
      const client = createProductionSkillIdentificationWorkerClient()
      expect(client.engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
      client.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
