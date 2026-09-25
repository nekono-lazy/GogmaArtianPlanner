import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  RNG_STATE_SCHEMA_VERSION,
  executionSavePointIdForPlan,
  validateExecutionHistory,
  validateExecutionSavePoint,
  validateNormalArtianCounter,
  validateRngState,
} from '../domain/models/publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  productionPlanId,
} from '../test/fixtures/domainData'

const V1_STORES = {
  rngState: 'id',
  normalArtianCounters: 'id, [weaponTypeId+rarity], isConfirmed',
  ownedWeapons: 'id, weaponTypeId, elementId, status, isProtected, updatedAt',
  targetWeapons: 'id, weaponTypeId, elementId, priority, isEnabled, updatedAt',
  buildCandidates: 'id, targetWeaponId, category, searchStateHash, searchRunId, createdAt',
  buildListEntries: 'id, candidateId, targetWeaponId, searchStateHash, isStale, createdAt',
  productionPlans: 'id, status, createdAt, updatedAt',
  executionHistory: 'id, planId, planStepId, createdAt',
  settings: 'id',
}

/** A database already at schema 6, so v7 is the only upgrade left to run. */
function openSchema6(name: string): Dexie {
  const old = new Dexie(name)
  old.version(1).stores(V1_STORES)
  old.version(2).stores({})
  old.version(3).stores({})
  old.version(4).stores({})
  old.version(5).stores({
    targetWeapons: 'id, weaponTypeId, elementId, priority, isEnabled, lifecycleStatus, updatedAt',
    executionSavePoints: 'id, &productionPlanId, recordedAt',
  })
  old.version(6).stores({})
  return old
}

/** A RngState as schema 6 stored it: record schema version 1, no provenance. */
function schema6RngState(): Record<string, unknown> {
  const state: Record<string, unknown> = { ...createValidRngState(), schemaVersion: 1 }
  delete state.lastIdentifiedAt
  // An adoption before the provenance existed left `observation` sources and a
  // recent `updatedAt`; neither is read back as an adoption time.
  state.baseSeed = { value: 'fixture-seed', isConfirmed: true, source: 'observation' }
  state.updatedAt = '2026-09-18T12:00:00.000Z'
  return state
}

function schema6Counter(id = 'weapon.fixture.a:8', weaponTypeId = 'weapon.fixture.a'): Record<string, unknown> {
  const counter: Record<string, unknown> = { ...createValidNormalArtianCounter(), id, weaponTypeId }
  delete counter.lastIdentifiedAt
  return counter
}

describe('Identification provenance persistence migration (Dexie v6 -> v7)', () => {
  it('uses the current DATABASE_SCHEMA_VERSION 9 and RngState record schema 2 independently of the calculation schema', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(9)
    expect(RNG_STATE_SCHEMA_VERSION).toBe(2)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(14)
  })

  it('fills every RngState / Normal Counter body with null provenance and infers nothing', async () => {
    const name = `identification-provenance-migration-${crypto.randomUUID()}`
    const old = openSchema6(name)
    const rngState = schema6RngState()
    const counterA = schema6Counter()
    const counterB = schema6Counter('weapon.fixture.b:8', 'weapon.fixture.b')
    const plan = { ...createValidProductionPlan(), id: productionPlanId('plan.provenance.active'), status: 'active' as const }
    const history = structuredClone(createValidExecutionHistory()) as unknown as Record<string, unknown>
    const snapshot = history.undoSnapshot as Record<string, unknown>
    snapshot.rngStateBefore = schema6RngState()
    snapshot.normalCountersBefore = [schema6Counter()]
    // A compromise finish deleted the Plan's save point into the Undo snapshot
    // before the provenance existed: its bodies are schema 6 too.
    const nestedSavePoint = {
      id: executionSavePointIdForPlan(plan.id),
      productionPlanId: plan.id,
      lastExecutionHistoryId: null,
      rngState: schema6RngState(),
      normalCounters: [schema6Counter()],
      ownedWeapons: [],
      targetWeapons: [],
      productionPlan: plan,
      recordedAt: DOMAIN_FIXTURE_TIME,
    }
    history.planId = plan.id
    ;(snapshot.productionPlanBefore as Record<string, unknown>).id = plan.id
    snapshot.executionSavePointBefore = nestedSavePoint
    const savePoint = {
      id: executionSavePointIdForPlan(plan.id),
      productionPlanId: plan.id,
      lastExecutionHistoryId: null,
      rngState: schema6RngState(),
      normalCounters: [schema6Counter()],
      ownedWeapons: [],
      targetWeapons: [],
      productionPlan: plan,
      recordedAt: DOMAIN_FIXTURE_TIME,
    }

    await old.table('rngState').put(rngState)
    await old.table('normalArtianCounters').bulkPut([counterA, counterB])
    await old.table('productionPlans').put(plan)
    await old.table('executionHistory').put(history)
    await old.table('executionSavePoints').put(savePoint)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(9)

      const migratedState = await database.rngState.get('current')
      expect(migratedState).toEqual({ ...rngState, schemaVersion: 2, lastIdentifiedAt: null })
      expect(validateRngState(migratedState as never).isValid).toBe(true)
      // The `observation` source and the recent `updatedAt` stay as they were and prove no adoption.
      expect(migratedState?.baseSeed.source).toBe('observation')

      for (const counter of [counterA, counterB]) {
        const migrated = await database.normalArtianCounters.get(counter.id as string)
        expect(migrated).toEqual({ ...counter, lastIdentifiedAt: null })
        expect(validateNormalArtianCounter(migrated as never).isValid).toBe(true)
      }

      const migratedHistory = await database.executionHistory.get(history.id as string)
      expect(migratedHistory?.undoSnapshot.rngStateBefore).toEqual({ ...snapshot.rngStateBefore as object, schemaVersion: 2, lastIdentifiedAt: null })
      expect(migratedHistory?.undoSnapshot.normalCountersBefore).toEqual([{ ...(snapshot.normalCountersBefore as object[])[0], lastIdentifiedAt: null }])
      // The save point nested inside the Undo snapshot is filled the same way.
      const migratedNested = migratedHistory?.undoSnapshot.executionSavePointBefore
      expect(migratedNested?.rngState).toEqual({ ...nestedSavePoint.rngState, schemaVersion: 2, lastIdentifiedAt: null })
      expect(migratedNested?.normalCounters).toEqual([{ ...nestedSavePoint.normalCounters[0], lastIdentifiedAt: null }])
      expect(validateExecutionSavePoint(migratedNested as never).isValid).toBe(true)
      expect(validateExecutionHistory(migratedHistory as never).issues).toEqual([])

      const migratedSavePoint = await database.executionSavePoints.get(savePoint.id)
      expect(migratedSavePoint?.rngState).toEqual({ ...savePoint.rngState, schemaVersion: 2, lastIdentifiedAt: null })
      expect(migratedSavePoint?.normalCounters).toEqual([{ ...savePoint.normalCounters[0], lastIdentifiedAt: null }])
      expect(validateExecutionSavePoint(migratedSavePoint as never).isValid).toBe(true)
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
    } finally {
      await database.delete()
    }
  })

  it('leaves a body that already carries the provenance exactly as it is', async () => {
    const name = `identification-provenance-migration-kept-${crypto.randomUUID()}`
    const old = openSchema6(name)
    const identified = { ...createValidRngState(), lastIdentifiedAt: '2026-09-18T00:00:00.000Z' }
    const counter = { ...createValidNormalArtianCounter(), lastIdentifiedAt: '2026-09-18T00:00:00.000Z' }
    await old.table('rngState').put(identified)
    await old.table('normalArtianCounters').put(counter)
    old.close()
    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(await database.rngState.get('current')).toEqual(identified)
      expect(await database.normalArtianCounters.get(counter.id)).toEqual(counter)
    } finally {
      await database.delete()
    }
  })
})
