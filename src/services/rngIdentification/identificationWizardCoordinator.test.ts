import { describe, expect, it, vi } from 'vitest'
import type { RngState } from '../../domain/models/publicTypes'
import {
  SkillIdentificationCancelledError,
  SkillIdentificationDuplicateRequestError,
  SkillIdentificationWorkerError,
  SkillIdentificationWorkerUnavailableError,
} from './skillIdentificationWorkerClient'
import type { SkillIdentificationWorkerClient } from './skillIdentificationWorkerClient'
import type {
  SkillIdentificationInput,
  SkillIdentificationResult,
} from '../../domain/rng/identification/skillIdentificationTypes'
import {
  GogmaCounterIdentificationCancelledError,
  GogmaCounterIdentificationWorkerError,
} from './gogmaCounterIdentificationWorkerClient'
import type { GogmaCounterIdentificationWorkerClient } from './gogmaCounterIdentificationWorkerClient'
import type { GogmaCounterIdentificationResult } from '../../domain/rng/identification/gogmaCounterIdentificationTypes'
import {
  DefaultIdentificationWizardCoordinator,
  IdentificationWizardCoordinatorError,
  type GogmaIdentificationWizardInput,
  type IdentificationAdoptionPort,
} from './identificationWizardCoordinator'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

type SkillIdentifyOptions = Parameters<
  SkillIdentificationWorkerClient['identify']
>[2]

interface FakeSkillRequest {
  readonly requestId: string
  readonly input: SkillIdentificationInput
  readonly options: SkillIdentifyOptions
  readonly deferred: Deferred<SkillIdentificationResult>
}

class FakeSkillClient implements SkillIdentificationWorkerClient {
  readonly engineVersion = 'fake-skill-identification'
  readonly requests: FakeSkillRequest[] = []
  readonly cancelledRequestIds: string[] = []
  disposed = false
  ignoreCancel = false

  identify(
    requestId: string,
    input: SkillIdentificationInput,
    options: SkillIdentifyOptions,
  ): Promise<SkillIdentificationResult> {
    const request = {
      requestId,
      input,
      options,
      deferred: deferred<SkillIdentificationResult>(),
    }
    this.requests.push(request)
    return request.deferred.promise
  }

  cancel(requestId: string): void {
    this.cancelledRequestIds.push(requestId)
    if (!this.ignoreCancel) {
      this.requests
        .find((request) => request.requestId === requestId)
        ?.deferred.reject(new SkillIdentificationCancelledError())
    }
  }

  dispose(): void {
    this.disposed = true
  }
}

type GogmaIdentifyOptions = Parameters<
  GogmaCounterIdentificationWorkerClient['identify']
>[2]

interface FakeGogmaRequest {
  readonly requestId: string
  readonly input: Parameters<
    GogmaCounterIdentificationWorkerClient['identify']
  >[1]
  readonly options: GogmaIdentifyOptions
  readonly deferred: Deferred<GogmaCounterIdentificationResult>
}

class FakeGogmaClient implements GogmaCounterIdentificationWorkerClient {
  readonly engineVersion = 'fake-gogma-identification'
  readonly requests: FakeGogmaRequest[] = []
  readonly cancelledRequestIds: string[] = []
  disposed = false
  ignoreCancel = false

  identify(
    requestId: string,
    input: Parameters<
      GogmaCounterIdentificationWorkerClient['identify']
    >[1],
    options: GogmaIdentifyOptions,
  ): Promise<GogmaCounterIdentificationResult> {
    const request = {
      requestId,
      input,
      options,
      deferred: deferred<GogmaCounterIdentificationResult>(),
    }
    this.requests.push(request)
    return request.deferred.promise
  }

  cancel(requestId: string): void {
    this.cancelledRequestIds.push(requestId)
    if (!this.ignoreCancel) {
      this.requests
        .find((request) => request.requestId === requestId)
        ?.deferred.reject(new GogmaCounterIdentificationCancelledError())
    }
  }

  dispose(): void {
    this.disposed = true
  }
}

const SKILL_INPUT = {
  marker: 'skill-input',
} as unknown as SkillIdentificationInput

const GOGMA_INPUT = {
  marker: 'gogma-input',
} as unknown as GogmaIdentificationWizardInput

function skillResult(
  matches: Array<{ baseSeed: number; startSkillCounter: number }>,
  isTruncated = false,
): SkillIdentificationResult {
  return {
    matches,
    isTruncated,
    searchedSeedRange: {
      startInclusive: 0,
      endInclusive: 99_999_999,
    },
  }
}

function gogmaResult(
  matches: Array<{ startGogmaCounter: number }>,
  isTruncated = false,
): GogmaCounterIdentificationResult {
  return {
    matches,
    isTruncated,
    searchedCounterRange: { startInclusive: 0, endInclusive: 10 },
  }
}

function savedState(marker = 'saved'): RngState {
  return { marker } as unknown as RngState
}

function createHarness() {
  const skillClient = new FakeSkillClient()
  const gogmaClient = new FakeGogmaClient()
  const adoptionService: IdentificationAdoptionPort = {
    adopt: vi.fn(async () => savedState()),
  }
  const coordinator = new DefaultIdentificationWizardCoordinator({
    skillClient,
    gogmaClient,
    adoptionService,
  })
  return { coordinator, skillClient, gogmaClient, adoptionService }
}

async function completeSkillUnique(
  harness: ReturnType<typeof createHarness>,
  baseSeed = 86_315_169,
  startingSkillCounter = 42,
): Promise<void> {
  const promise = harness.coordinator.identifySkill(SKILL_INPUT)
  harness.skillClient.requests.at(-1)?.deferred.resolve(
    skillResult([{ baseSeed, startSkillCounter: startingSkillCounter }]),
  )
  await promise
}

async function completeGogmaUnique(
  harness: ReturnType<typeof createHarness>,
  startingGogmaCounter = 84,
): Promise<void> {
  const promise = harness.coordinator.identifyGogma(GOGMA_INPUT)
  harness.gogmaClient.requests.at(-1)?.deferred.resolve(
    gogmaResult([{ startGogmaCounter: startingGogmaCounter }]),
  )
  await promise
}

async function completeReview(
  harness: ReturnType<typeof createHarness>,
): Promise<void> {
  await completeSkillUnique(harness)
  await completeGogmaUnique(harness)
}

describe('IdentificationWizardCoordinator STEP 1', () => {
  it('enables STEP 2 only for one non-truncated Skill match', async () => {
    const harness = createHarness()

    await completeSkillUnique(harness)

    expect(harness.coordinator.getState().skill).toMatchObject({
      status: 'completed',
      classification: 'unique',
      identified: {
        baseSeed: '86315169',
        startingSkillCounter: 42,
      },
    })

    const gogmaPromise = harness.coordinator.identifyGogma(GOGMA_INPUT)
    expect(harness.gogmaClient.requests[0]?.input.baseSeed).toBe('86315169')
    harness.gogmaClient.requests[0]?.deferred.resolve(gogmaResult([]))
    await gogmaPromise
  })

  it.each([
    ['zero', skillResult([])],
    [
      'multiple',
      skillResult([
        { baseSeed: 1, startSkillCounter: 2 },
        { baseSeed: 3, startSkillCounter: 4 },
      ]),
    ],
    [
      'incomplete',
      skillResult([{ baseSeed: 1, startSkillCounter: 2 }], true),
    ],
  ] as const)('classifies %s without enabling STEP 2', async (kind, result) => {
    const harness = createHarness()
    const promise = harness.coordinator.identifySkill(SKILL_INPUT)
    harness.skillClient.requests[0]?.deferred.resolve(result)

    await expect(promise).resolves.toBe(kind)
    expect(harness.coordinator.getState().skill.identified).toBeNull()
    await expect(
      harness.coordinator.identifyGogma(GOGMA_INPUT),
    ).rejects.toBeInstanceOf(IdentificationWizardCoordinatorError)
  })

  it('keeps cancellation distinct from zero and permits retry', async () => {
    const harness = createHarness()
    const first = harness.coordinator.identifySkill(SKILL_INPUT)

    harness.coordinator.cancelSkill()
    await expect(first).rejects.toBeInstanceOf(SkillIdentificationCancelledError)
    expect(harness.coordinator.getState().skill).toMatchObject({
      status: 'cancelled',
      classification: null,
      error: { kind: 'cancelled' },
    })

    await completeSkillUnique(harness)
    expect(harness.coordinator.getState().skill.classification).toBe('unique')
  })

  it('keeps unexpected Worker failure distinct from zero', async () => {
    const harness = createHarness()
    const failure = new Error('worker failed')
    const promise = harness.coordinator.identifySkill(SKILL_INPUT)
    harness.skillClient.requests[0]?.deferred.reject(failure)

    await expect(promise).rejects.toBe(failure)
    expect(harness.coordinator.getState().skill).toMatchObject({
      status: 'error',
      classification: null,
      error: { kind: 'unexpected_error', error: failure },
    })
  })

  it.each([
    [
      'invalid_input',
      new SkillIdentificationWorkerError('invalid', 'invalid_input', null),
    ],
    [
      'unsupported_input',
      new SkillIdentificationWorkerError(
        'unsupported',
        'unsupported_input',
        'reference_adapter_unsupported',
      ),
    ],
    ['worker_unavailable', new SkillIdentificationWorkerUnavailableError()],
    [
      'duplicate_request',
      new SkillIdentificationDuplicateRequestError('duplicate'),
    ],
  ] as const)('preserves the %s Worker error classification', async (kind, error) => {
    const harness = createHarness()
    const promise = harness.coordinator.identifySkill(SKILL_INPUT)
    harness.skillClient.requests[0]?.deferred.reject(error)

    await expect(promise).rejects.toBe(error)
    expect(harness.coordinator.getState().skill.error?.kind).toBe(kind)
    expect(harness.coordinator.getState().skill.classification).toBeNull()
  })
})

describe('IdentificationWizardCoordinator STEP 2 and review', () => {
  it('creates review only from one non-truncated Gogma match', async () => {
    const harness = createHarness()
    await completeReview(harness)

    expect(harness.coordinator.getState().review).toEqual({
      baseSeed: '86315169',
      startingSkillCounter: 42,
      startingGogmaCounter: 84,
    })
  })

  it.each([
    ['zero', gogmaResult([])],
    [
      'multiple',
      gogmaResult([
        { startGogmaCounter: 84 },
        { startGogmaCounter: 85 },
      ]),
    ],
    ['incomplete', gogmaResult([{ startGogmaCounter: 84 }], true)],
  ] as const)('classifies %s without creating review', async (kind, result) => {
    const harness = createHarness()
    await completeSkillUnique(harness)
    const promise = harness.coordinator.identifyGogma(GOGMA_INPUT)
    harness.gogmaClient.requests[0]?.deferred.resolve(result)

    await expect(promise).resolves.toBe(kind)
    expect(harness.coordinator.getState().review).toBeNull()
  })

  it('retains STEP 1 unique after STEP 2 cancellation and permits retry', async () => {
    const harness = createHarness()
    await completeSkillUnique(harness)
    const first = harness.coordinator.identifyGogma(GOGMA_INPUT)

    harness.coordinator.cancelGogma()
    await expect(first).rejects.toBeInstanceOf(
      GogmaCounterIdentificationCancelledError,
    )
    expect(harness.coordinator.getState().skill.classification).toBe('unique')
    expect(harness.coordinator.getState().gogma.status).toBe('cancelled')

    await completeGogmaUnique(harness)
    expect(harness.coordinator.getState().review).not.toBeNull()
  })

  it('preserves STEP 2 unsupported error instead of creating a result', async () => {
    const harness = createHarness()
    await completeSkillUnique(harness)
    const error = new GogmaCounterIdentificationWorkerError(
      'unsupported',
      'unsupported_input',
      'reference_adapter_unsupported',
    )
    const promise = harness.coordinator.identifyGogma(GOGMA_INPUT)
    harness.gogmaClient.requests[0]?.deferred.reject(error)

    await expect(promise).rejects.toBe(error)
    expect(harness.coordinator.getState().gogma.error?.kind).toBe(
      'unsupported_input',
    )
    expect(harness.coordinator.getState().review).toBeNull()
  })
})

describe('IdentificationWizardCoordinator invalidation and lifecycle', () => {
  it('invalidates all downstream state for STEP 1 rerun', async () => {
    const harness = createHarness()
    await completeReview(harness)
    harness.coordinator.setGameRestoredConfirmed(true)

    const rerun = harness.coordinator.identifySkill(SKILL_INPUT)

    expect(harness.coordinator.getState()).toMatchObject({
      review: null,
      gameRestoredConfirmed: false,
      gogma: { status: 'idle', classification: null },
      adoption: { status: 'idle' },
    })
    harness.skillClient.requests.at(-1)?.deferred.resolve(skillResult([]))
    await rerun
  })

  it('invalidates review and confirmation but retains STEP 1 for STEP 2 rerun', async () => {
    const harness = createHarness()
    await completeReview(harness)
    harness.coordinator.setGameRestoredConfirmed(true)

    const rerun = harness.coordinator.identifyGogma(GOGMA_INPUT)

    expect(harness.coordinator.getState()).toMatchObject({
      skill: { classification: 'unique' },
      review: null,
      gameRestoredConfirmed: false,
      adoption: { status: 'idle' },
    })
    harness.gogmaClient.requests.at(-1)?.deferred.resolve(gogmaResult([]))
    await rerun
  })

  it('ignores a late STEP 1 response after cancel and retry', async () => {
    const harness = createHarness()
    harness.skillClient.ignoreCancel = true
    const first = harness.coordinator.identifySkill(SKILL_INPUT)
    harness.coordinator.cancelSkill()
    const second = harness.coordinator.identifySkill(SKILL_INPUT)

    harness.skillClient.requests[0]?.deferred.resolve(
      skillResult([{ baseSeed: 1, startSkillCounter: 2 }]),
    )
    await expect(first).rejects.toMatchObject({ code: 'stale_request' })
    expect(harness.coordinator.getState().skill.status).toBe('searching')

    harness.skillClient.requests[1]?.deferred.resolve(
      skillResult([{ baseSeed: 86_315_169, startSkillCounter: 42 }]),
    )
    await expect(second).resolves.toBe('unique')
    expect(harness.coordinator.getState().skill.identified?.baseSeed).toBe(
      '86315169',
    )
  })

  it('snapshots search input and forwards progress without changing semantics', async () => {
    const harness = createHarness()
    const mutable = {
      marker: 'before',
    } as unknown as SkillIdentificationInput
    const promise = harness.coordinator.identifySkill(mutable)
    ;(mutable as unknown as { marker: string }).marker = 'after'

    const request = harness.skillClient.requests[0]
    request?.options?.onProgress?.({
      searchedSeeds: 10,
      totalSeeds: 100,
      matchesFound: 0,
    })
    expect(
      (request?.input as unknown as { marker: string } | undefined)?.marker,
    ).toBe('before')
    expect(harness.coordinator.getState().skill.progress).toMatchObject({
      searchedSeeds: 10,
      totalSeeds: 100,
      matchesFound: 0,
    })

    request?.deferred.resolve(skillResult([]))
    await promise
  })

  it('restart cancels active work and clears only transient state', async () => {
    const harness = createHarness()
    const active = harness.coordinator.identifySkill(SKILL_INPUT)
    const requestId = harness.skillClient.requests[0]?.requestId

    harness.coordinator.restart()

    await expect(active).rejects.toBeInstanceOf(SkillIdentificationCancelledError)
    expect(harness.skillClient.cancelledRequestIds).toContain(requestId)
    expect(harness.coordinator.getState()).toEqual(
      expect.objectContaining({
        skill: expect.objectContaining({ status: 'idle' }),
        gogma: expect.objectContaining({ status: 'idle' }),
        review: null,
        gameRestoredConfirmed: false,
        disposed: false,
      }),
    )
  })

  it('dispose cancels work, disposes both owned clients, and blocks late updates', async () => {
    const harness = createHarness()
    harness.skillClient.ignoreCancel = true
    const active = harness.coordinator.identifySkill(SKILL_INPUT)

    harness.coordinator.dispose()
    harness.skillClient.requests[0]?.deferred.resolve(
      skillResult([{ baseSeed: 1, startSkillCounter: 2 }]),
    )

    await expect(active).rejects.toMatchObject({ code: 'stale_request' })
    expect(harness.skillClient.disposed).toBe(true)
    expect(harness.gogmaClient.disposed).toBe(true)
    expect(harness.coordinator.getState().disposed).toBe(true)
    expect(harness.coordinator.getState().skill.classification).toBeNull()
  })
})

describe('IdentificationWizardCoordinator adoption', () => {
  it('requires review and explicit game-restored confirmation', async () => {
    const harness = createHarness()

    await expect(harness.coordinator.adopt()).rejects.toMatchObject({
      code: 'invalid_state',
    })
    await completeReview(harness)
    await expect(harness.coordinator.adopt()).rejects.toMatchObject({
      code: 'confirmation_required',
    })
    expect(harness.adoptionService.adopt).not.toHaveBeenCalled()
  })

  it('adopts exact starting values through C4 and prevents duplicate adoption', async () => {
    const harness = createHarness()
    const expectedSavedState = savedState('adopted')
    vi.mocked(harness.adoptionService.adopt).mockResolvedValue(expectedSavedState)
    await completeReview(harness)
    harness.coordinator.setGameRestoredConfirmed(true)

    await expect(harness.coordinator.adopt()).resolves.toBe(expectedSavedState)

    expect(harness.adoptionService.adopt).toHaveBeenCalledTimes(1)
    expect(harness.adoptionService.adopt).toHaveBeenCalledWith({
      baseSeed: '86315169',
      startingSkillCounter: 42,
      startingGogmaCounter: 84,
    })
    expect(harness.coordinator.getState().adoption).toEqual({
      status: 'adopted',
      savedRngState: expectedSavedState,
      error: null,
    })
    await expect(harness.coordinator.adopt()).rejects.toMatchObject({
      code: 'already_adopted',
    })
    expect(harness.adoptionService.adopt).toHaveBeenCalledTimes(1)
  })

  it('rejects a concurrent adoption while the first call is pending', async () => {
    const harness = createHarness()
    const pending = deferred<RngState>()
    vi.mocked(harness.adoptionService.adopt).mockReturnValue(pending.promise)
    await completeReview(harness)
    harness.coordinator.setGameRestoredConfirmed(true)

    const first = harness.coordinator.adopt()
    await expect(harness.coordinator.adopt()).rejects.toMatchObject({
      code: 'adoption_in_progress',
    })
    pending.resolve(savedState())
    await first
    expect(harness.adoptionService.adopt).toHaveBeenCalledTimes(1)
  })

  it('retains review and confirmation after adoption failure for explicit retry', async () => {
    const harness = createHarness()
    const failure = new Error('put failed')
    vi.mocked(harness.adoptionService.adopt)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(savedState())
    await completeReview(harness)
    harness.coordinator.setGameRestoredConfirmed(true)

    await expect(harness.coordinator.adopt()).rejects.toBe(failure)
    expect(harness.coordinator.getState()).toMatchObject({
      review: {
        baseSeed: '86315169',
        startingSkillCounter: 42,
        startingGogmaCounter: 84,
      },
      gameRestoredConfirmed: true,
      adoption: { status: 'error', error: { kind: 'adoption_error' } },
    })

    await expect(harness.coordinator.adopt()).resolves.toBeDefined()
    expect(harness.adoptionService.adopt).toHaveBeenCalledTimes(2)
  })
})
