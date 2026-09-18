import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  executionSavePointIdForPlan,
  validateExecutionHistory,
  validateProductionPlan,
  type ProductionPlan,
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

/** A database already at schema 5, so v6 is the only upgrade left to run. */
function openSchema5(name: string): Dexie {
  const old = new Dexie(name)
  old.version(1).stores(V1_STORES)
  old.version(2).stores({})
  old.version(3).stores({})
  old.version(4).stores({})
  old.version(5).stores({
    targetWeapons: 'id, weaponTypeId, elementId, priority, isEnabled, lifecycleStatus, updatedAt',
    executionSavePoints: 'id, &productionPlanId, recordedAt',
  })
  return old
}

/** A Plan record as schema 5 stored it: without the lifecycle metadata. */
function schema5Plan(id: string, status: ProductionPlan['status']): Record<string, unknown> {
  const plan: Record<string, unknown> = {
    ...createValidProductionPlan(),
    id: productionPlanId(id),
    status,
  }
  delete plan.abandonmentReason
  delete plan.abandonedAt
  delete plan.completedAt
  return plan
}

describe('ProductionPlan lifecycle persistence migration (Dexie v5 -> v6)', () => {
  it('uses DATABASE_SCHEMA_VERSION 6 independently of the calculation schema', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(7)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(13)
  })

  it('fills only non-terminal Plans and leaves terminal Plans and history exactly as persisted', async () => {
    const name = `plan-lifecycle-migration-${crypto.randomUUID()}`
    const old = openSchema5(name)
    const draft = schema5Plan('plan.migration.draft', 'draft')
    const active = schema5Plan('plan.migration.active', 'active')
    const stale = schema5Plan('plan.migration.stale', 'stale')
    // No runtime before v6 wrote these; their completion time or abandonment
    // reason is unknown, so they are never guessed.
    const completed = schema5Plan('plan.migration.completed', 'completed')
    const abandoned = schema5Plan('plan.migration.abandoned', 'abandoned')
    // A history record whose Undo snapshot predates the Target / save point fields.
    const legacyHistory = structuredClone(createValidExecutionHistory()) as unknown as Record<string, unknown>
    const legacySnapshot = legacyHistory.undoSnapshot as Record<string, unknown>
    delete legacySnapshot.affectedTargetWeaponsBefore
    delete legacySnapshot.executionSavePointBefore
    const savePoint = {
      id: executionSavePointIdForPlan(productionPlanId('plan.migration.active')),
      productionPlanId: productionPlanId('plan.migration.active'),
      lastExecutionHistoryId: null,
      rngState: createValidRngState(),
      normalCounters: [createValidNormalArtianCounter()],
      ownedWeapons: [],
      targetWeapons: [],
      productionPlan: active,
      recordedAt: DOMAIN_FIXTURE_TIME,
    }

    await old.table('productionPlans').bulkPut([draft, active, stale, completed, abandoned])
    await old.table('executionHistory').put(legacyHistory)
    await old.table('executionSavePoints').put(savePoint)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(7)
      const nulls = { abandonmentReason: null, abandonedAt: null, completedAt: null }
      for (const plan of [draft, active, stale]) {
        const migrated = await database.productionPlans.get(plan.id as string)
        expect(migrated).toEqual({ ...plan, ...nulls })
        expect(validateProductionPlan(migrated as ProductionPlan).isValid).toBe(true)
      }
      for (const plan of [completed, abandoned]) {
        const kept = await database.productionPlans.get(plan.id as string)
        expect(kept).toEqual(plan)
        // Left for validation to refuse rather than completed with a guess.
        expect(validateProductionPlan(kept as ProductionPlan).isValid).toBe(false)
      }
      const history = await database.executionHistory.get(legacyHistory.id as string)
      expect(history).toEqual(legacyHistory)
      expect(validateExecutionHistory(history as never).isValid).toBe(false)
      expect((await database.executionSavePoints.get(savePoint.id))?.productionPlan)
        .toEqual({ ...active, ...nulls })
    } finally {
      await database.delete()
    }
  })
})
