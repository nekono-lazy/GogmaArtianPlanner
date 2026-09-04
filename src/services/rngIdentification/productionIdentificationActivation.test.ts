import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { NormalArtianCounterRepository } from '../../db/repositories/normalArtianCounterRepository'
import { RngStateRepository } from '../../db/repositories/rngStateRepository'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { WeaponBonusDefinitionsMasterSubset } from '../../domain/master/masterSelectors'
import type { RestorationBonusSet, RngState } from '../../domain/models/publicTypes'
import {
  identifyGogmaCounter,
  identifySkillSeedAndCounter,
  type GogmaCounterIdentificationInput,
  type GogmaCounterIdentificationResult,
  type SkillIdentificationInput,
  type SkillIdentificationResult,
} from '../../domain/rng/identification'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../../domain/rng/production/productionRngEngine'
import { gameVerifiedSkillIdentificationVector } from '../../test/fixtures/gameVerifiedSkillVectors'
import {
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidProductionPlan,
} from '../../test/fixtures/domainData'
import {
  DefaultIdentificationWizardCoordinator,
  IdentificationWizardCoordinatorError,
  type IdentificationWizardCoordinator,
} from './identificationWizardCoordinator'
import { IdentificationAdoptionService } from './identificationAdoptionService'
import {
  SkillIdentificationWorkerError,
  type SkillIdentificationWorkerClient,
  type SkillIdentificationWorkerClientCallbacks,
} from './skillIdentificationWorkerClient'
import { createMultiWorkerSkillIdentificationClient } from './multiWorkerSkillIdentificationClient'
import type {
  GogmaCounterIdentificationWorkerClient,
  GogmaCounterIdentificationWorkerClientCallbacks,
} from './gogmaCounterIdentificationWorkerClient'

/**
 * C5-E2C10 Production Identification activation regression.
 *
 * jsdom cannot start a real Browser Worker, so only the Worker transport is
 * replaced, by child clients that run the same Production kernels with a
 * `ProductionRngEngine`. Everything else is the Production implementation: the
 * real multi-worker orchestration, the real Coordinator, the real Adoption
 * Service, and a real Dexie database. The Browser Worker transport itself is
 * covered by C5-E2C8 and by the Worker / Worker-client tests.
 */

const ADOPTION_TIME = '2026-09-05T00:00:00.000Z'
const live = gameVerifiedSkillIdentificationVector

function loadedMaster() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

function bonusMasterSubset(): WeaponBonusDefinitionsMasterSubset {
  const master = loadedMaster()
  return {
    weaponTypes: master.weaponTypes,
    elements: master.elements,
    bonusTypes: master.bonusTypes,
    weaponBonusDefinitions: master.weaponBonusDefinitions,
  }
}

class KernelSkillChildClient implements SkillIdentificationWorkerClient {
  readonly engineVersion = PRODUCTION_RNG_ENGINE_VERSION
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

class FailingSkillChildClient implements SkillIdentificationWorkerClient {
  readonly engineVersion = PRODUCTION_RNG_ENGINE_VERSION

  identify(): Promise<SkillIdentificationResult> {
    return Promise.reject(
      new SkillIdentificationWorkerError(
        'Skill Identification Worker terminated unexpectedly.',
        'unexpected_error',
        null,
      ),
    )
  }

  cancel(): void {
    // Nothing to cancel.
  }

  dispose(): void {
    // No Worker resource is created by this test adapter.
  }
}

class KernelGogmaClient implements GogmaCounterIdentificationWorkerClient {
  readonly engineVersion = PRODUCTION_RNG_ENGINE_VERSION
  readonly receivedInputs: GogmaCounterIdentificationInput[] = []
  private readonly cancelled = new Set<string>()

  identify(
    requestId: string,
    input: GogmaCounterIdentificationInput,
    callbacks: GogmaCounterIdentificationWorkerClientCallbacks = {},
  ): Promise<GogmaCounterIdentificationResult> {
    this.receivedInputs.push(input)
    return identifyGogmaCounter(input, new ProductionRngEngine(), {
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

/** Narrow C10 wiring window. Not a C9 re-verification and not a Wizard default. */
const SKILL_SEED_RANGE = {
  startInclusive: live.baseSeed - 40,
  endInclusive: live.baseSeed + 40,
}
const SKILL_COUNTER_RANGE = {
  startInclusive: live.startSkillCounter - 2,
  endInclusive: live.startSkillCounter + 2,
}
const STARTING_GOGMA_COUNTER = 480
const GOGMA_COUNTER_RANGE = { startInclusive: 478, endInclusive: 483 }

const skillInput: SkillIdentificationInput = {
  weaponTypeId: live.weaponTypeId,
  elementId: live.elementId,
  observations: live.observations.map(({ seriesSkillId, groupSkillId }) => ({
    seriesSkillId,
    groupSkillId,
  })),
  seedRange: SKILL_SEED_RANGE,
  skillCounterRange: SKILL_COUNTER_RANGE,
}

/**
 * The STEP 2 observations are derived from the Production Engine at the STEP 1
 * Base Seed so one composed Wizard session can run both steps. Live-game Gogma
 * evidence stays in `gameVerifiedGogmaVectors` and its own kernel / Worker
 * tests; this exercises the composed STEP 2 wiring only.
 */
function gogmaObservations(): RestorationBonusSet[] {
  const engine = new ProductionRngEngine()
  const master = loadedMaster()
  return Array.from({ length: 4 }, (_, offset) => engine.predictGogmaBonus({
    baseSeed: String(live.baseSeed),
    weaponTypeId: live.weaponTypeId,
    elementId: live.elementId,
    gogmaCounter: STARTING_GOGMA_COUNTER + offset,
    operation: { type: 'reset_bonuses' },
    master,
  }))
}

interface Harness {
  readonly coordinator: IdentificationWizardCoordinator
  readonly gogmaClient: KernelGogmaClient
  readonly database: AppDatabase
  readonly rngRepository: RngStateRepository
  readonly close: () => Promise<void>
}

let databaseSequence = 0

async function createHarness(
  options: { readonly failSkillWorker?: boolean } = {},
): Promise<Harness> {
  databaseSequence += 1
  const databaseName = `c10-identification-activation-${databaseSequence}`
  const database = new AppDatabase(databaseName)
  await database.open()
  const rngRepository = new RngStateRepository(database)
  const gogmaClient = new KernelGogmaClient()
  const coordinator = new DefaultIdentificationWizardCoordinator({
    skillClient: createMultiWorkerSkillIdentificationClient({
      hardwareConcurrency: 4,
      workerClientFactory: () => (
        options.failSkillWorker
          ? new FailingSkillChildClient()
          : new KernelSkillChildClient()
      ),
    }),
    gogmaClient,
    adoptionService: new IdentificationAdoptionService({
      repository: rngRepository,
      seedNormalizer: new ProductionRngEngine(),
      clock: { now: () => ADOPTION_TIME },
    }),
  })
  return {
    coordinator,
    gogmaClient,
    database,
    rngRepository,
    close: async () => {
      coordinator.dispose()
      database.close()
      await Dexie.delete(databaseName)
    },
  }
}

describe('C5-E2C10 Production Identification activation', () => {
  it('identifies the live-game Base Seed and starting Skill Counter through the composed path', async () => {
    const harness = await createHarness()
    try {
      await expect(harness.coordinator.identifySkill(skillInput)).resolves.toBe('unique')
      const state = harness.coordinator.getState()
      expect(state.skill.result?.isTruncated).toBe(false)
      expect(state.skill.result?.matches).toEqual([
        { baseSeed: live.baseSeed, startSkillCounter: live.startSkillCounter },
      ])
      // Four observations were supplied; the retained Counter is the starting one.
      expect(state.skill.identified).toEqual({
        baseSeed: String(live.baseSeed),
        startingSkillCounter: live.startSkillCounter,
      })
    } finally {
      await harness.close()
    }
  }, 30_000)

  it('blocks STEP 2 until STEP 1 has one complete non-truncated result', async () => {
    const harness = await createHarness()
    try {
      await expect(harness.coordinator.identifyGogma({
        weaponTypeId: live.weaponTypeId,
        elementId: live.elementId,
        observations: gogmaObservations(),
        gogmaCounterRange: GOGMA_COUNTER_RANGE,
        master: bonusMasterSubset(),
      })).rejects.toBeInstanceOf(IdentificationWizardCoordinatorError)
      expect(harness.gogmaClient.receivedInputs).toHaveLength(0)
    } finally {
      await harness.close()
    }
  }, 30_000)

  it('runs STEP 1 through adoption and persists only Seed and starting Counters', async () => {
    const harness = await createHarness()
    try {
      const normalRepository = new NormalArtianCounterRepository(harness.database)
      const normalBefore = createValidNormalArtianCounter()
      const candidateBefore = createValidBuildCandidate()
      const entryBefore = createValidBuildListEntry()
      const planBefore = createValidProductionPlan()
      await normalRepository.putNormalArtianCounter(normalBefore)
      await harness.database.buildCandidates.put(candidateBefore)
      await harness.database.buildListEntries.put(entryBefore)
      await harness.database.productionPlans.put(planBefore)

      const before = await harness.rngRepository.ensureInitialRngState()
      const seeded: RngState = {
        ...before,
        counterGate: { value: 123, isConfirmed: true, source: 'manual' },
        notes: 'C10 preserved note',
      }
      await harness.rngRepository.putRngState(seeded)

      await expect(harness.coordinator.identifySkill(skillInput)).resolves.toBe('unique')
      await expect(harness.coordinator.identifyGogma({
        weaponTypeId: live.weaponTypeId,
        elementId: live.elementId,
        observations: gogmaObservations(),
        gogmaCounterRange: GOGMA_COUNTER_RANGE,
        master: bonusMasterSubset(),
      })).resolves.toBe('unique')

      // The Coordinator injects the STEP 1 Seed; STEP 2 never re-enters it.
      expect(harness.gogmaClient.receivedInputs).toHaveLength(1)
      expect(harness.gogmaClient.receivedInputs[0]?.baseSeed).toBe(String(live.baseSeed))
      expect(harness.coordinator.getState().gogma.result?.isTruncated).toBe(false)

      expect(harness.coordinator.getState().review).toEqual({
        baseSeed: String(live.baseSeed),
        startingSkillCounter: live.startSkillCounter,
        startingGogmaCounter: STARTING_GOGMA_COUNTER,
      })

      await expect(harness.coordinator.adopt()).rejects.toBeInstanceOf(
        IdentificationWizardCoordinatorError,
      )
      await expect(harness.rngRepository.getCurrentRngState()).resolves.toEqual(seeded)

      harness.coordinator.setGameRestoredConfirmed(true)
      const saved = await harness.coordinator.adopt()

      expect(saved.baseSeed).toEqual({
        value: String(live.baseSeed),
        isConfirmed: true,
        source: 'observation',
      })
      expect(saved.skillCounter).toEqual({
        value: live.startSkillCounter,
        isConfirmed: true,
        source: 'observation',
      })
      expect(saved.gogmaCounter).toEqual({
        value: STARTING_GOGMA_COUNTER,
        isConfirmed: true,
        source: 'observation',
      })
      expect(saved.counterGate).toEqual(seeded.counterGate)
      expect(saved.notes).toBe('C10 preserved note')
      expect(saved.createdAt).toBe(seeded.createdAt)
      await expect(harness.rngRepository.getCurrentRngState()).resolves.toEqual(saved)

      await expect(normalRepository.getAllNormalArtianCounters())
        .resolves.toEqual([normalBefore])
      await expect(harness.database.buildCandidates.get(candidateBefore.id))
        .resolves.toEqual(candidateBefore)
      await expect(harness.database.buildListEntries.get(entryBefore.id))
        .resolves.toEqual(entryBefore)
      await expect(harness.database.productionPlans.get(planBefore.id))
        .resolves.toEqual(planBefore)
    } finally {
      await harness.close()
    }
  }, 60_000)

  it('surfaces a child Worker failure as an error instead of a zero-match result', async () => {
    const harness = await createHarness({ failSkillWorker: true })
    try {
      await expect(harness.coordinator.identifySkill(skillInput)).rejects.toBeInstanceOf(
        SkillIdentificationWorkerError,
      )
      const state = harness.coordinator.getState()
      expect(state.skill.status).toBe('error')
      expect(state.skill.classification).toBeNull()
      expect(state.skill.result).toBeNull()
      expect(state.skill.error?.kind).toBe('unexpected_error')
    } finally {
      await harness.close()
    }
  }, 30_000)
})
