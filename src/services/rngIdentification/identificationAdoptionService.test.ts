import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { NormalArtianCounterRepository } from '../../db/repositories/normalArtianCounterRepository'
import { RngStateRepository } from '../../db/repositories/rngStateRepository'
import { createInitialRngState } from '../../domain/models/factories'
import type { RngState } from '../../domain/models/publicTypes'
import { ProductionRngEngine } from '../../domain/rng/production/productionRngEngine'
import {
  inspectPlanGuardedMutation,
  preparePlanGuardedMutation,
  type PlanGuardPersistedState,
} from '../../domain/execution'
import {
  createValidNormalArtianCounter,
  createValidRngState,
  domainFixtureContext,
} from '../../test/fixtures/domainData'
import {
  createPlanBreakingChangeGuard,
  type PlanGuardedPersistence,
} from '../execution/planBreakingChangeGuard'
import {
  IdentificationAdoptionError,
  IdentificationAdoptionService,
  type IdentificationAdoptionDependencies,
  type IdentificationAdoptionInput,
  type IdentificationAdoptionRepository,
} from './identificationAdoptionService'

const ADOPTION_TIME = '2026-09-01T12:34:56.000Z'
const reviewedInput: IdentificationAdoptionInput = {
  baseSeed: '086315169',
  startingSkillCounter: 186,
  startingGogmaCounter: 480,
}

function memoryFixture(
  initial: RngState = createValidRngState(),
  options: {
    putFailure?: Error
    seedNormalizer?: IdentificationAdoptionDependencies['seedNormalizer']
  } = {},
) {
  let current = structuredClone(initial)
  const repository: IdentificationAdoptionRepository = {
    ensureInitialRngState: vi.fn(async () => structuredClone(current)),
  }
  const writes = vi.fn((state: RngState) => {
    if (options.putFailure) throw options.putFailure
    current = structuredClone(state)
  })
  const persistence = guardedPersistenceOver(() => current, writes)
  const dependencies: IdentificationAdoptionDependencies = {
    repository,
    persistence,
    seedNormalizer: options.seedNormalizer ?? new ProductionRngEngine(),
    clock: { now: vi.fn(() => ADOPTION_TIME) },
  }
  return {
    service: new IdentificationAdoptionService(dependencies),
    repository,
    persistence,
    writes,
    current: () => structuredClone(current),
  }
}

/** The guarded save over one in-memory RngState, with no ProductionPlan. */
function guardedPersistenceOver(
  read: () => RngState,
  write: (state: RngState) => void,
): PlanGuardedPersistence {
  const state = (): PlanGuardPersistedState => ({
    rngState: structuredClone(read()),
    normalCounters: [],
    ownedWeapons: [],
    targetWeapons: [],
    buildListEntries: [],
    buildCandidates: [],
    productionPlans: [],
    executionHistory: [],
    executionSavePoints: [],
  })
  return {
    inspect: async (mutation) => inspectPlanGuardedMutation(state(), mutation),
    apply: async (mutation, approval = null) => {
      const prepared = preparePlanGuardedMutation({
        state: state(),
        mutation,
        approval,
        currentCalculationContext: domainFixtureContext,
        now: ADOPTION_TIME,
      })
      if (prepared.state.rngState !== null) write(prepared.state.rngState)
      return { result: prepared.result, planTermination: prepared.planTermination }
    },
  }
}

describe('IdentificationAdoptionService', () => {
  it('atomically adopts canonical Seed and starting Counters while preserving all other state', async () => {
    const before = createValidRngState()
    before.baseSeed = {
      value: '111',
      isConfirmed: true,
      source: 'manual',
    }
    before.skillCounter = {
      value: 20,
      isConfirmed: true,
      source: 'manual',
    }
    before.gogmaCounter = {
      value: 30,
      isConfirmed: true,
      source: 'manual',
    }
    before.counterGate = { value: 200, isConfirmed: true, source: 'manual' }
    before.notes = 'Preserve this diagnostic note.'
    const fixture = memoryFixture(before)

    const saved = await fixture.service.adopt(reviewedInput)

    expect(saved).toEqual({
      ...before,
      baseSeed: { value: '86315169', isConfirmed: true, source: 'observation' },
      skillCounter: { value: 186, isConfirmed: true, source: 'observation' },
      gogmaCounter: { value: 480, isConfirmed: true, source: 'observation' },
      updatedAt: ADOPTION_TIME,
    })
    expect(saved.counterGate).toEqual(before.counterGate)
    expect(saved.createdAt).toBe(before.createdAt)
    expect(saved.notes).toBe(before.notes)
    expect(fixture.writes).toHaveBeenCalledOnce()
  })

  it.each([
    { value: null, isConfirmed: false, source: null },
    { value: 54, isConfirmed: true, source: 'manual' as const },
    { value: 200, isConfirmed: true, source: 'observation' as const },
  ])('does not require or modify legacy Counter Gate %#', async (counterGate) => {
    const before = createValidRngState()
    before.counterGate = counterGate
    const fixture = memoryFixture(before)
    const saved = await fixture.service.adopt(reviewedInput)
    expect(saved.counterGate).toEqual(counterGate)
    expect(saved.baseSeed.value).toBe('86315169')
    expect(saved.skillCounter.value).toBe(reviewedInput.startingSkillCounter)
    expect(saved.gogmaCounter.value).toBe(reviewedInput.startingGogmaCounter)
  })

  it('keeps the persisted Counter domain separate from Identification search limits', async () => {
    const fixture = memoryFixture()
    const saved = await fixture.service.adopt({
      baseSeed: '1',
      startingSkillCounter: Number.MAX_SAFE_INTEGER,
      startingGogmaCounter: Number.MAX_SAFE_INTEGER,
    })
    expect(saved.skillCounter.value).toBe(Number.MAX_SAFE_INTEGER)
    expect(saved.gogmaCounter.value).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    { name: 'invalid Skill Counter', patch: { startingSkillCounter: -1 } },
    { name: 'non-integer Skill Counter', patch: { startingSkillCounter: 1.5 } },
    { name: 'invalid Gogma Counter', patch: { startingGogmaCounter: -1 } },
    { name: 'non-integer Gogma Counter', patch: { startingGogmaCounter: 1.5 } },
  ])('rejects $name before reading or writing persistence', async ({ patch }) => {
    const fixture = memoryFixture()
    await expect(fixture.service.adopt({ ...reviewedInput, ...patch }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(fixture.repository.ensureInitialRngState).not.toHaveBeenCalled()
    expect(fixture.writes).not.toHaveBeenCalled()
  })

  it('rejects invalid Seed and a Production normalization failure before persistence', async () => {
    const invalid = memoryFixture()
    await expect(invalid.service.adopt({ ...reviewedInput, baseSeed: 'invalid' }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(invalid.repository.ensureInitialRngState).not.toHaveBeenCalled()
    expect(invalid.writes).not.toHaveBeenCalled()

    const failedNormalizer = memoryFixture(createValidRngState(), {
      seedNormalizer: {
        normalizeSeed: vi.fn(() => {
          throw new RangeError('normalization failed')
        }),
      },
    })
    await expect(failedNormalizer.service.adopt(reviewedInput))
      .rejects.toBeInstanceOf(IdentificationAdoptionError)
    expect(failedNormalizer.repository.ensureInitialRngState).not.toHaveBeenCalled()
    expect(failedNormalizer.writes).not.toHaveBeenCalled()
  })

  it('rejects an invalid persisted RngState without writing', async () => {
    const invalid = createValidRngState()
    invalid.counterGate = { value: -1, isConfirmed: true, source: 'manual' }
    const fixture = memoryFixture(invalid)
    await expect(fixture.service.adopt(reviewedInput)).rejects.toMatchObject({
      code: 'invalid_persistent_state',
      validationIssues: expect.arrayContaining([
        expect.objectContaining({ path: 'counterGate.value' }),
      ]),
    })
    expect(fixture.writes).not.toHaveBeenCalled()
  })

  it('propagates repository write failure without reporting success', async () => {
    const failure = new Error('persistence failed')
    const before = createValidRngState()
    const fixture = memoryFixture(before, { putFailure: failure })
    await expect(fixture.service.adopt(reviewedInput)).rejects.toBe(failure)
    expect(fixture.writes).toHaveBeenCalledOnce()
    expect(fixture.current()).toEqual(before)
  })

  it('reports an unavailable current state without attempting a write', async () => {
    const repository: IdentificationAdoptionRepository = {
      ensureInitialRngState: vi.fn(async () => undefined as unknown as RngState),
    }
    const fixture = memoryFixture()
    const service = new IdentificationAdoptionService({
      repository,
      persistence: fixture.persistence,
      seedNormalizer: new ProductionRngEngine(),
      clock: { now: () => ADOPTION_TIME },
    })
    await expect(service.adopt(reviewedInput)).rejects.toMatchObject({
      code: 'persistent_state_unavailable',
    })
    expect(fixture.writes).not.toHaveBeenCalled()
  })

  it('uses the existing ensure contract to create and adopt into a missing state', async () => {
    const initial = createInitialRngState('2026-09-01T00:00:00.000Z')
    const fixture = memoryFixture(initial)
    const saved = await fixture.service.adopt(reviewedInput)
    expect(saved).toMatchObject({
      id: 'current',
      baseSeed: { value: '86315169', isConfirmed: true, source: 'observation' },
      skillCounter: { value: 186, isConfirmed: true, source: 'observation' },
      gogmaCounter: { value: 480, isConfirmed: true, source: 'observation' },
      counterGate: { value: null, isConfirmed: false, source: null },
    })
  })

  it('is value-idempotent and never advances counters on repeated adoption', async () => {
    const fixture = memoryFixture()
    const first = await fixture.service.adopt(reviewedInput)
    const second = await fixture.service.adopt(reviewedInput)
    expect(second).toEqual(first)
    expect(second.skillCounter.value).toBe(186)
    expect(second.gogmaCounter.value).toBe(480)
    expect(fixture.writes).toHaveBeenCalledTimes(2)
  })

  it('preserves Normal Artian Counters in the real persistence tables', async () => {
    const database = new AppDatabase('identification-adoption-normal-preservation')
    await database.open()
    try {
      const rngRepository = new RngStateRepository(database)
      const normalRepository = new NormalArtianCounterRepository(database)
      const normalBefore = createValidNormalArtianCounter()
      await normalRepository.putNormalArtianCounter(normalBefore)
      const service = new IdentificationAdoptionService({
        repository: rngRepository,
        persistence: createPlanBreakingChangeGuard(domainFixtureContext, database),
        seedNormalizer: new ProductionRngEngine(),
        clock: { now: () => ADOPTION_TIME },
      })

      const saved = await service.adopt(reviewedInput)

      await expect(rngRepository.getCurrentRngState()).resolves.toEqual(saved)
      await expect(normalRepository.getAllNormalArtianCounters())
        .resolves.toEqual([normalBefore])
      expect(await database.buildCandidates.count()).toBe(0)
      expect(await database.buildListEntries.count()).toBe(0)
      expect(await database.productionPlans.count()).toBe(0)
    } finally {
      database.close()
      await Dexie.delete('identification-adoption-normal-preservation')
    }
  })
})
