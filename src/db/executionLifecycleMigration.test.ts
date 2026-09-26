import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'
import {
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { validateOwnedWeapon, validateTargetWeapon } from '../domain/models/validation'

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

/** A database already at schema 4, so v5 is the only upgrade left to run. */
function openSchema4(name: string): Dexie {
  const old = new Dexie(name)
  old.version(1).stores(V1_STORES)
  old.version(2).stores({})
  old.version(3).stores({})
  old.version(4).stores({})
  return old
}

/** A schema-4 OwnedWeapon: the current fixture without the v5 field. */
function schema4Weapon(id: string, fields: Record<string, unknown> = {}) {
  const weapon: Record<string, unknown> = {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    ...fields,
  }
  delete weapon.executionInProgress
  return weapon
}

/** A schema-4 TargetWeapon: the current fixture without the v5 fields. */
function schema4Target(id: string) {
  const target: Record<string, unknown> = {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
  }
  delete target.lifecycleStatus
  delete target.completedAt
  delete target.completedByProductionPlanId
  return target
}

describe('Execution lifecycle persistence migration (Dexie v4 -> v5)', () => {
  it('uses DATABASE_SCHEMA_VERSION 5 independently of the calculation schema', () => {
    // The v5 upgrade moved no calculation schema; the later Execution Plan
    // contract moved the calculation schema to 12 without a Dexie upgrade.
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(16)
  })

  it('writes only the deterministic defaults and infers nothing', async () => {
    const name = `execution-lifecycle-migration-${crypto.randomUUID()}`
    const old = openSchema4(name)

    // The fixture weapon holds exactly the fixture Target's Ideal five slots
    // and Skills: the user already owns its Ideal. That must not complete it.
    const idealTarget = schema4Target('target.migration.ideal-owned')
    const plainTarget = schema4Target('target.migration.plain')
    const idealWeapon = schema4Weapon('owned.migration.ideal', {
      status: 'ideal',
      isProtected: true,
    })
    const normalWeapon = schema4Weapon('owned.migration.normal', {
      kind: 'normal',
      rarity: 8,
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    })
    // An active Plan with history exists: neither implies a weapon in progress
    // nor a recorded game save.
    const plan = { ...createValidProductionPlan(), status: 'active' as const }
    const history = createValidExecutionHistory()
    const candidate = createValidBuildCandidate()
    const entry = createValidBuildListEntry()

    await old.table('targetWeapons').bulkPut([idealTarget, plainTarget])
    await old.table('ownedWeapons').bulkPut([idealWeapon, normalWeapon])
    await old.table('productionPlans').put(plan)
    await old.table('executionHistory').put(history)
    await old.table('buildCandidates').put(candidate)
    await old.table('buildListEntries').put(entry)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(10)

      const targets = await database.targetWeapons.toArray()
      expect(targets).toHaveLength(2)
      for (const target of targets) {
        expect(target.lifecycleStatus).toBe('active')
        expect(target.completedAt).toBeNull()
        expect(target.completedByProductionPlanId).toBeNull()
        expect(validateTargetWeapon(target).isValid).toBe(true)
      }
      // Only the three lifecycle fields were added.
      expect(await database.targetWeapons.get(targetWeaponId('target.migration.plain')))
        .toEqual({
          ...plainTarget,
          lifecycleStatus: 'active',
          completedAt: null,
          completedByProductionPlanId: null,
        })

      const weapons = await database.ownedWeapons.toArray()
      expect(weapons).toHaveLength(2)
      for (const weapon of weapons) {
        expect(weapon.executionInProgress).toBeNull()
        expect(validateOwnedWeapon(weapon).isValid).toBe(true)
      }
      expect(await database.ownedWeapons.get(ownedWeaponId('owned.migration.ideal')))
        .toEqual({ ...idealWeapon, executionInProgress: null })

      expect(await database.executionSavePoints.count()).toBe(0)

      // The new lifecycle index is usable.
      expect(
        await database.targetWeapons.where('lifecycleStatus').equals('active').count(),
      ).toBe(2)
      expect(
        await database.targetWeapons.where('lifecycleStatus').equals('completed').count(),
      ).toBe(0)

      // Past calculation artifacts keep their exact persisted contents.
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
      expect(await database.executionHistory.get(history.id)).toEqual(history)
      expect(await database.buildCandidates.get(candidate.id)).toEqual(candidate)
      expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
    } finally {
      await database.delete()
    }
  })
})
