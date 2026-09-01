import { describe, expect, it, vi } from 'vitest'
import {
  identifySkillSeedAndCounter,
  type InclusiveNumberRange,
  type SkillIdentificationInput,
  type SkillIdentificationProgress,
  type SkillIdentificationResult,
} from '../../domain/rng/identification'
import { ProductionRngEngine } from '../../domain/rng/production/productionRngEngine'
import { referenceSkillCombinationFromIndex } from '../../domain/rng/production/referenceSkillPools'
import {
  SkillIdentificationCancelledError,
  SkillIdentificationDuplicateRequestError,
  SkillIdentificationWorkerError,
  SkillIdentificationWorkerUnavailableError,
  type SkillIdentificationWorkerClient,
  type SkillIdentificationWorkerClientCallbacks,
} from './skillIdentificationWorkerClient'
import {
  createMultiWorkerSkillIdentificationClient,
  createProductionMultiWorkerSkillIdentificationClient,
  selectSkillIdentificationWorkerCount,
  splitSkillIdentificationSeedRange,
} from './multiWorkerSkillIdentificationClient'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

interface FakeRequest {
  readonly requestId: string
  readonly input: SkillIdentificationInput
  readonly callbacks: SkillIdentificationWorkerClientCallbacks
  readonly deferred: Deferred<SkillIdentificationResult>
}

class FakeChildClient implements SkillIdentificationWorkerClient {
  readonly engineVersion: string
  readonly requests: FakeRequest[] = []
  readonly cancelledRequestIds: string[] = []
  readonly dispose = vi.fn()
  ignoreCancel = false

  constructor(engineVersion = 'fixture') {
    this.engineVersion = engineVersion
  }

  identify(
    requestId: string,
    input: SkillIdentificationInput,
    callbacks: SkillIdentificationWorkerClientCallbacks = {},
  ): Promise<SkillIdentificationResult> {
    const request = { requestId, input, callbacks, deferred: deferred<SkillIdentificationResult>() }
    this.requests.push(request)
    return request.deferred.promise
  }

  cancel(requestId: string): void {
    this.cancelledRequestIds.push(requestId)
    if (this.ignoreCancel) return
    this.requests.find((request) => request.requestId === requestId)?.deferred.reject(
      new SkillIdentificationCancelledError(),
    )
  }

  progress(index: number, progress: SkillIdentificationProgress): void {
    this.requests[index]?.callbacks.onProgress?.(progress)
  }
}

class KernelChildClient implements SkillIdentificationWorkerClient {
  readonly engineVersion = 'production-rng:c5-e2'
  private readonly cancelled = new Set<string>()

  identify(
    requestId: string,
    input: SkillIdentificationInput,
    callbacks: SkillIdentificationWorkerClientCallbacks = {},
  ): Promise<SkillIdentificationResult> {
    return identifySkillSeedAndCounter(input, new ProductionRngEngine(), {
      shouldCancel: () => this.cancelled.has(requestId),
      onProgress: callbacks.onProgress,
    })
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId)
  }

  dispose(): void {
    // No Worker resource is created by this test adapter.
  }
}

const goldenObservations = [275, 255, 245, 243]
  .map(referenceSkillCombinationFromIndex)
  .map(({ seriesSkillId, groupSkillId }) => ({ seriesSkillId, groupSkillId }))

const goldenInput: SkillIdentificationInput = {
  weaponTypeId: 'weapon.insect_glaive',
  elementId: 'element.thunder',
  observations: goldenObservations,
  seedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
  skillCounterRange: { startInclusive: 180, endInclusive: 190 },
}

function result(
  range: InclusiveNumberRange,
  matches: SkillIdentificationResult['matches'] = [],
): SkillIdentificationResult {
  return { matches, searchedSeedRange: range, isTruncated: false }
}

async function startChildren(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createFakeHarness(hardwareConcurrency = 4): {
  readonly client: SkillIdentificationWorkerClient
  readonly children: readonly FakeChildClient[]
} {
  const children: FakeChildClient[] = []
  const client = createMultiWorkerSkillIdentificationClient({
    hardwareConcurrency,
    workerClientFactory: () => {
      const child = new FakeChildClient()
      children.push(child)
      return child
    },
  })
  return { client, children }
}

describe('Skill Identification Seed chunking', () => {
  it.each([
    {
      name: 'full domain / 4',
      range: { startInclusive: 0, endInclusive: 99_999_999 },
      target: 4,
      expectedSizes: [25_000_000, 25_000_000, 25_000_000, 25_000_000],
    },
    {
      name: 'odd-sized range / 4',
      range: { startInclusive: 0, endInclusive: 10 },
      target: 4,
      expectedSizes: [3, 3, 3, 2],
    },
    {
      name: 'tiny range / 4',
      range: { startInclusive: 20, endInclusive: 21 },
      target: 4,
      expectedSizes: [1, 1],
    },
    {
      name: 'single element',
      range: { startInclusive: 42, endInclusive: 42 },
      target: 4,
      expectedSizes: [1],
    },
    {
      name: 'custom non-zero start',
      range: { startInclusive: 101, endInclusive: 109 },
      target: 4,
      expectedSizes: [3, 2, 2, 2],
    },
  ])('$name is contiguous, non-overlapping, gap-free, and covers the input', ({
    range,
    target,
    expectedSizes,
  }) => {
    const chunks = splitSkillIdentificationSeedRange(range, target)
    expect(chunks.map((chunk) => chunk.endInclusive - chunk.startInclusive + 1)).toEqual(
      expectedSizes,
    )
    expect(chunks[0]?.startInclusive).toBe(range.startInclusive)
    expect(chunks.at(-1)?.endInclusive).toBe(range.endInclusive)
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.startInclusive).toBe(chunks[index - 1]!.endInclusive + 1)
    }
  })

  it.each([
    [undefined, 1],
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 4],
    [8, 4],
    [16, 4],
  ])('maps hardwareConcurrency %s to %s Worker(s)', (hardwareConcurrency, expected) => {
    expect(selectSkillIdentificationWorkerCount(hardwareConcurrency)).toBe(expected)
  })
})

describe('Multi-Worker Skill Identification parity', () => {
  it.each([1, 2, 4])('matches the bounded golden with %s Worker(s)', async (workerCount) => {
    const expected = await identifySkillSeedAndCounter(goldenInput, new ProductionRngEngine())
    const client = createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: workerCount,
      workerClientFactory: () => new KernelChildClient(),
    })

    await expect(client.identify(`golden.${workerCount}`, goldenInput)).resolves.toEqual(expected)
    client.dispose()
  }, 30_000)

  it('matches ambiguous one-observation results and deterministic order', async () => {
    const input: SkillIdentificationInput = {
      ...goldenInput,
      observations: goldenObservations.slice(0, 1),
      seedRange: { startInclusive: 8_500_000, endInclusive: 8_505_000 },
    }
    const expected = await identifySkillSeedAndCounter(input, new ProductionRngEngine())
    const client = createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: 4,
      workerClientFactory: () => new KernelChildClient(),
    })

    const actual = await client.identify('ambiguous', input)
    expect(actual).toEqual(expected)
    expect(actual.matches.length).toBeGreaterThan(1)
    client.dispose()
  }, 30_000)

  it('finds a golden exactly at a chunk boundary', async () => {
    const input: SkillIdentificationInput = {
      ...goldenInput,
      seedRange: { startInclusive: 8_524_400, endInclusive: 8_524_465 },
    }
    const expected = await identifySkillSeedAndCounter(input, new ProductionRngEngine())
    const client = createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: 2,
      workerClientFactory: () => new KernelChildClient(),
    })

    await expect(client.identify('boundary', input)).resolves.toEqual(expected)
    expect(expected.matches).toEqual([{ baseSeed: 8_524_433, startSkillCounter: 186 }])
    client.dispose()
  }, 30_000)

  it('preserves global maxMatches, truncation, ordering, and searched prefix', async () => {
    const input: SkillIdentificationInput = {
      ...goldenInput,
      observations: goldenObservations.slice(0, 1),
      seedRange: { startInclusive: 8_500_000, endInclusive: 8_505_000 },
      maxMatches: 10,
    }
    const expected = await identifySkillSeedAndCounter(input, new ProductionRngEngine())
    const client = createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: 4,
      workerClientFactory: () => new KernelChildClient(),
    })

    await expect(client.identify('limited', input)).resolves.toEqual(expected)
    expect(expected.matches).toHaveLength(10)
    expect(expected.isTruncated).toBe(true)
    client.dispose()
  }, 30_000)
})

describe('Multi-Worker Skill Identification progress and lifecycle', () => {
  const smallInput: SkillIdentificationInput = {
    ...goldenInput,
    seedRange: { startInclusive: 0, endInclusive: 3 },
  }

  it('uses unique child IDs, removes local maxMatches, and aggregates monotonic progress', async () => {
    const { client, children } = createFakeHarness(2)
    const progress: SkillIdentificationProgress[] = []
    const parent = client.identify('parent', { ...smallInput, maxMatches: 1 }, {
      onProgress: (value) => progress.push(value),
    })
    await startChildren()

    const first = children[0]!.requests[0]!
    const second = children[1]!.requests[0]!
    expect(first.requestId).toBe('parent.parallel1.chunk0')
    expect(second.requestId).toBe('parent.parallel1.chunk1')
    expect(first.input.maxMatches).toBeUndefined()
    expect(second.input.maxMatches).toBeUndefined()

    children[1]!.progress(0, { searchedSeeds: 1, totalSeeds: 2, matchesFound: 2 })
    children[0]!.progress(0, { searchedSeeds: 1, totalSeeds: 2, matchesFound: 1 })
    children[1]!.progress(0, { searchedSeeds: 0, totalSeeds: 2, matchesFound: 0 })

    first.deferred.resolve(result(first.input.seedRange!, [
      { baseSeed: 0, startSkillCounter: 180 },
    ]))
    second.deferred.resolve(result(second.input.seedRange!, [
      { baseSeed: 2, startSkillCounter: 180 },
      { baseSeed: 3, startSkillCounter: 180 },
    ]))

    await expect(parent).resolves.toEqual({
      matches: [{ baseSeed: 0, startSkillCounter: 180 }],
      searchedSeedRange: { startInclusive: 0, endInclusive: 0 },
      isTruncated: true,
    })
    expect(progress.map(({ searchedSeeds }) => searchedSeeds)).toEqual([1, 2, 2, 3, 4])
    expect(progress.every(({ searchedSeeds, totalSeeds }) =>
      searchedSeeds >= 0 && searchedSeeds <= totalSeeds && totalSeeds === 4,
    )).toBe(true)
    expect(progress.at(-1)).toEqual({ searchedSeeds: 4, totalSeeds: 4, matchesFound: 3 })
    client.dispose()
  })

  it('cancels every child, rejects the parent, ignores late events, and permits ID reuse', async () => {
    const { client, children } = createFakeHarness(2)
    children.forEach((child) => {
      child.ignoreCancel = true
    })
    const progress = vi.fn()
    const firstParent = client.identify('reusable', smallInput, { onProgress: progress })
    await startChildren()
    const firstGenerationRequests = children.map((child) => child.requests[0]!)

    client.cancel('reusable')
    await expect(firstParent).rejects.toBeInstanceOf(SkillIdentificationCancelledError)
    expect(children.every((child) => child.cancelledRequestIds.length === 1)).toBe(true)

    children[0]!.progress(0, { searchedSeeds: 2, totalSeeds: 2, matchesFound: 1 })
    firstGenerationRequests.forEach((request) => request.deferred.resolve(
      result(request.input.seedRange!),
    ))
    expect(progress).not.toHaveBeenCalled()

    const secondParent = client.identify('reusable', smallInput)
    await startChildren()
    const secondGenerationRequests = children.map((child) => child.requests[1]!)
    expect(secondGenerationRequests[0]!.requestId).toContain('.parallel2.chunk0')
    secondGenerationRequests.forEach((request) => request.deferred.resolve(
      result(request.input.seedRange!),
    ))
    await expect(secondParent).resolves.toEqual(result({ startInclusive: 0, endInclusive: 3 }))
    client.dispose()
  })

  it('does not start child work when the parent is cancelled immediately', async () => {
    const { client, children } = createFakeHarness(4)
    const parent = client.identify('immediate-cancel', smallInput)
    client.cancel('immediate-cancel')

    await expect(parent).rejects.toBeInstanceOf(SkillIdentificationCancelledError)
    await startChildren()
    expect(children.every((child) => child.requests.length === 0)).toBe(true)
    client.dispose()
  })

  it('rejects a duplicate parent ID without interrupting the original request', async () => {
    const { client, children } = createFakeHarness(2)
    const original = client.identify('duplicate', smallInput)
    const duplicate = client.identify('duplicate', smallInput)
    await expect(duplicate).rejects.toBeInstanceOf(SkillIdentificationDuplicateRequestError)
    await startChildren()
    expect(children.every((child) => child.requests.length === 1)).toBe(true)

    children.forEach((child) => {
      const request = child.requests[0]!
      request.deferred.resolve(result(request.input.seedRange!))
    })
    await expect(original).resolves.toEqual(result({ startInclusive: 0, endInclusive: 3 }))

    const reused = client.identify('duplicate', smallInput)
    await startChildren()
    children.forEach((child) => {
      const request = child.requests[1]!
      request.deferred.resolve(result(request.input.seedRange!))
    })
    await expect(reused).resolves.toEqual(result({ startInclusive: 0, endInclusive: 3 }))
    client.dispose()
  })

  it('supports simultaneous distinct parent requests without child ID collisions', async () => {
    const { client, children } = createFakeHarness(2)
    const first = client.identify('first', smallInput)
    const second = client.identify('second', smallInput)
    await startChildren()

    const childIds = children.flatMap((child) => child.requests.map(({ requestId }) => requestId))
    expect(new Set(childIds).size).toBe(4)
    children.forEach((child) => child.requests.forEach((request) => {
      request.deferred.resolve(result(request.input.seedRange!))
    }))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    client.dispose()
  })

  it('fails the whole request and cancels siblings when one child fails', async () => {
    const { client, children } = createFakeHarness(4)
    const failure = new SkillIdentificationWorkerError(
      'worker crashed',
      'unexpected_error',
      null,
    )
    const parent = client.identify('failure', smallInput)
    await startChildren()
    children[1]!.requests[0]!.deferred.reject(failure)

    await expect(parent).rejects.toBe(failure)
    expect(children.every((child) => child.cancelledRequestIds.length === 1)).toBe(true)

    const retry = client.identify('failure', smallInput)
    await startChildren()
    children.forEach((child) => {
      const request = child.requests[1]!
      request.deferred.resolve(result(request.input.seedRange!))
    })
    await expect(retry).resolves.toEqual(result({ startInclusive: 0, endInclusive: 3 }))
    client.dispose()
  })

  it('fails globally when one child is unavailable', async () => {
    const { client, children } = createFakeHarness(2)
    const unavailable = new SkillIdentificationWorkerUnavailableError()
    const parent = client.identify('unavailable', smallInput)
    await startChildren()
    children[0]!.requests[0]!.deferred.reject(unavailable)

    await expect(parent).rejects.toBe(unavailable)
    expect(children[1]!.cancelledRequestIds).toHaveLength(1)
    client.dispose()
  })

  it('maps incomplete child output to incomplete_parallel_chunk instead of partial success', async () => {
    const { client, children } = createFakeHarness(2)
    const parent = client.identify('incomplete', smallInput)
    await startChildren()
    const first = children[0]!.requests[0]!
    const second = children[1]!.requests[0]!
    first.deferred.resolve({
      ...result(first.input.seedRange!),
      isTruncated: true,
    })
    second.deferred.resolve(result(second.input.seedRange!))

    await expect(parent).rejects.toMatchObject({ code: 'incomplete_parallel_chunk' })
    client.dispose()
  })

  it('rejects a non-truncated result that does not cover its assigned chunk', async () => {
    const { client, children } = createFakeHarness(2)
    const parent = client.identify('wrong-range', smallInput)
    await startChildren()
    const first = children[0]!.requests[0]!
    const second = children[1]!.requests[0]!
    first.deferred.resolve(result({
      startInclusive: first.input.seedRange!.startInclusive + 1,
      endInclusive: first.input.seedRange!.endInclusive + 1,
    }))
    second.deferred.resolve(result(second.input.seedRange!))

    await expect(parent).rejects.toMatchObject({ code: 'incomplete_parallel_chunk' })
    client.dispose()
  })

  it('rejects an out-of-chunk match without returning partial success', async () => {
    const { client, children } = createFakeHarness(2)
    const parent = client.identify('out-of-chunk-match', smallInput)
    await startChildren()
    const first = children[0]!.requests[0]!
    const second = children[1]!.requests[0]!
    first.deferred.resolve(result(first.input.seedRange!, [{
      baseSeed: first.input.seedRange!.endInclusive + 1,
      startSkillCounter: smallInput.skillCounterRange.startInclusive,
    }]))
    second.deferred.resolve(result(second.input.seedRange!))

    await expect(parent).rejects.toMatchObject({ code: 'incomplete_parallel_chunk' })
    expect(children.every((child) => child.cancelledRequestIds.length === 1)).toBe(true)
    client.dispose()
  })

  it('rejects a match outside the caller Skill Counter range', async () => {
    const { client, children } = createFakeHarness(2)
    const parent = client.identify('out-of-counter-range-match', smallInput)
    await startChildren()
    const first = children[0]!.requests[0]!
    const second = children[1]!.requests[0]!
    first.deferred.resolve(result(first.input.seedRange!, [{
      baseSeed: first.input.seedRange!.startInclusive,
      startSkillCounter: smallInput.skillCounterRange.endInclusive + 1,
    }]))
    second.deferred.resolve(result(second.input.seedRange!))

    await expect(parent).rejects.toMatchObject({ code: 'incomplete_parallel_chunk' })
    expect(children.every((child) => child.cancelledRequestIds.length === 1)).toBe(true)
    client.dispose()
  })

  it('disposes all children, cancels active work, ignores late events, and rejects future work', async () => {
    const { client, children } = createFakeHarness(4)
    children.forEach((child) => {
      child.ignoreCancel = true
    })
    const progress = vi.fn()
    const parent = client.identify('dispose', smallInput, { onProgress: progress })
    await startChildren()

    client.dispose()
    await expect(parent).rejects.toBeInstanceOf(SkillIdentificationCancelledError)
    expect(children.every((child) => child.cancelledRequestIds.length === 1)).toBe(true)
    expect(children.every((child) => child.dispose.mock.calls.length === 1)).toBe(true)

    children[0]!.progress(0, { searchedSeeds: 1, totalSeeds: 1, matchesFound: 1 })
    expect(progress).not.toHaveBeenCalled()
    await expect(client.identify('after-dispose', smallInput)).rejects.toThrow('disposed')
  })
})

describe('Multi-Worker Skill Identification initialization safety', () => {
  it.each([
    [undefined, 1],
    [16, 4],
  ] as const)('creates the Production pool safely for hardwareConcurrency %s', (
    hardwareConcurrency,
    expectedWorkers,
  ) => {
    const workers: Array<{ terminate: ReturnType<typeof vi.fn> }> = []
    class ProductionWorkerStub {
      readonly terminate = vi.fn()

      constructor() {
        workers.push(this)
      }

      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }

    vi.stubGlobal('Worker', ProductionWorkerStub)
    vi.stubGlobal(
      'navigator',
      hardwareConcurrency === undefined ? undefined : { hardwareConcurrency },
    )
    try {
      const client = createProductionMultiWorkerSkillIdentificationClient()
      expect(client.engineVersion).toBe('production-rng:c5-e2')
      expect(workers).toHaveLength(expectedWorkers)
      client.dispose()
      expect(workers.every(({ terminate }) => terminate.mock.calls.length === 1)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails closed and disposes created children when factory creation fails', async () => {
    const first = new FakeChildClient()
    let calls = 0
    const client = createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: 4,
      workerClientFactory: () => {
        calls += 1
        if (calls === 2) throw new Error('creation failed')
        return first
      },
    })

    expect(first.dispose).toHaveBeenCalledOnce()
    await expect(client.identify('factory-failure', goldenInput)).rejects.toBeInstanceOf(
      SkillIdentificationWorkerUnavailableError,
    )
  })

  it('fails closed and disposes every child on Engine version mismatch', async () => {
    const first = new FakeChildClient('production-rng:c5-e2')
    const second = new FakeChildClient('different-version')
    const factoryQueue = [first, second]
    const client = createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: 2,
      workerClientFactory: () => factoryQueue.shift()!,
    })

    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.dispose).toHaveBeenCalledOnce()
    await expect(client.identify('version-mismatch', goldenInput)).rejects.toBeInstanceOf(
      SkillIdentificationWorkerUnavailableError,
    )
  })
})
