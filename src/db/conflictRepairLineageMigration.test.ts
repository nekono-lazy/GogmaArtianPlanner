import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'
import {
  EXPORT_SCHEMA_VERSION,
  validateProductionPlan,
  type ExecutionHistory,
  type ExecutionSavePoint,
  type PlannerConflictRepairLineage,
  type ProductionPlan,
} from '../domain/models/publicTypes'
import {
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  productionPlanId,
} from '../test/fixtures/domainData'
import { fixtureSavePoint, withoutConflictRepairLineage } from '../test/fixtures/dataTransfer'

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

/** A database already at schema 9, so v10 is the only upgrade left to run. */
function openSchema9(name: string): Dexie {
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
  old.version(7).stores({})
  old.version(8).stores({})
  old.version(9).stores({})
  return old
}

/** A ProductionPlan body as schema 9 stored it: no `conflictRepairLineage`. */
function schema9Plan(plan: ProductionPlan): ProductionPlan {
  const body = structuredClone(plan) as Partial<ProductionPlan>
  delete body.conflictRepairLineage
  return body as ProductionPlan
}

/**
 * The Dexie v9 -> v10 upgrade (`docs/DATA_MODEL.md` 11.1.1 / 14.2,
 * `docs/PLANNER_SPEC.md` 9.2.19.15): every ProductionPlan body - the table, a
 * game save point, an Undo snapshot and the save point an Undo snapshot holds -
 * gets `conflictRepairLineage = null` and nothing else changes. No repair
 * decision is reconstructed from selected Conflicts, Entries or history.
 */
describe('ProductionPlan repair lineage persistence migration (Dexie v9 -> v10)', () => {
  it('uses the current DATABASE_SCHEMA_VERSION 10 with the Export schema 13', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
  })

  it('fills null into every Plan body, infers no decision and keeps every other field and table', async () => {
    const name = `repair-lineage-v10-migration-${crypto.randomUUID()}`
    const old = openSchema9(name)
    const base = createValidProductionPlan()
    // A Draft whose persisted Conflict carries an explicit selection: exactly
    // what a repair decision would look like, and still never read as one.
    const draft = schema9Plan({
      ...base,
      conflicts: [{
        id: 'conflict.selected',
        kind: 'same_skill_counter',
        buildListEntryIds: [createValidBuildListEntry().id],
        reason: 'fixture',
        recommendedBuildListEntryId: null,
        selectedBuildListEntryId: createValidBuildListEntry().id,
        resolutionNote: null,
      }],
    })
    const active = schema9Plan({ ...base, id: productionPlanId('plan.active'), status: 'active' })
    const savePoint = withoutConflictRepairLineage({
      executionSavePoints: [fixtureSavePoint(active.id, null)],
    }).executionSavePoints[0] as ExecutionSavePoint
    const history = createValidExecutionHistory()
    const withNestedSavePoint: ExecutionHistory = {
      ...history,
      undoSnapshot: {
        ...history.undoSnapshot,
        productionPlanBefore: schema9Plan(history.undoSnapshot.productionPlanBefore),
        executionSavePointBefore: savePoint,
      },
    }
    const entry = createValidBuildListEntry()
    const target = createValidTargetWeapon()
    const rngState = createValidRngState()
    await old.table('productionPlans').bulkPut([draft, active])
    await old.table('executionSavePoints').put(savePoint)
    await old.table('executionHistory').put(withNestedSavePoint)
    await old.table('buildListEntries').put(entry)
    await old.table('targetWeapons').put(target)
    await old.table('rngState').put(rngState)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(10)
      expect(await database.productionPlans.get(draft.id)).toEqual({ ...draft, conflictRepairLineage: null })
      expect(await database.productionPlans.get(active.id)).toEqual({ ...active, conflictRepairLineage: null })
      const storedSavePoint = await database.executionSavePoints.get(savePoint.id)
      expect(storedSavePoint).toEqual({ ...savePoint, productionPlan: { ...savePoint.productionPlan, conflictRepairLineage: null } })
      const storedHistory = await database.executionHistory.get(history.id)
      expect(storedHistory?.undoSnapshot.productionPlanBefore).toEqual({
        ...withNestedSavePoint.undoSnapshot.productionPlanBefore,
        conflictRepairLineage: null,
      })
      expect(storedHistory?.undoSnapshot.executionSavePointBefore?.productionPlan).toEqual({
        ...savePoint.productionPlan,
        conflictRepairLineage: null,
      })
      // Every filled body is a valid current Plan body.
      for (const plan of await database.productionPlans.toArray()) {
        expect(validateProductionPlan(plan).issues.filter(({ path }) => path.startsWith('conflictRepairLineage'))).toEqual([])
      }
      // Nothing else changed.
      expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await database.targetWeapons.get(target.id)).toEqual(target)
      expect(await database.rngState.get('current')).toEqual(rngState)
    } finally {
      database.close()
      await Dexie.delete(name)
    }
  })

  it('never overwrites a body that already carries the field', async () => {
    const name = `repair-lineage-v10-existing-${crypto.randomUUID()}`
    const old = openSchema9(name)
    const lineage: PlannerConflictRepairLineage = {
      decisions: [{
        conflictKind: 'same_gogma_counter',
        fixedBuildListEntryId: createValidBuildListEntry().id,
        fixedTargetWeaponId: createValidTargetWeapon().id,
        invalidatedRoutes: [],
      }],
    }
    const plan = { ...createValidProductionPlan(), conflictRepairLineage: lineage }
    await old.table('productionPlans').put(plan)
    old.close()
    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
    } finally {
      database.close()
      await Dexie.delete(name)
    }
  })
})
