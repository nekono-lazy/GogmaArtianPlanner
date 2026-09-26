import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'
import {
  APP_SETTINGS_SCHEMA_VERSION,
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  RNG_STATE_SCHEMA_VERSION,
  validateAppSettings,
} from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import {
  createValidBuildListEntry,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
} from '../test/fixtures/domainData'
import { dataTransferSettings, legacyAppSettingsV1 } from '../test/fixtures/dataTransfer'

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

/** A database already at schema 8, so v9 is the only upgrade left to run. */
function openSchema8(name: string): Dexie {
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
  return old
}

const RECOMMENDED = { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }

describe('AppSettings Candidate Search defaults persistence migration (Dexie v8 -> v9)', () => {
  it('keeps the AppSettings step at Dexie 9 / Export 12 below the current Dexie 10 / Export 13, with AppSettings at 2', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(APP_SETTINGS_SCHEMA_VERSION).toBe(2)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(16)
    expect(RNG_STATE_SCHEMA_VERSION).toBe(2)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })

  it('gives an AppSettings v1 record the recommended 350 / 500 / 1500 and keeps every other field and table', async () => {
    const name = `app-settings-v9-migration-${crypto.randomUUID()}`
    const old = openSchema8(name)
    // A user who turned Debug Mode on and whose other settings are not the defaults.
    const legacy = legacyAppSettingsV1(dataTransferSettings({ debugMode: true, resultPageSize: 25, defaultSearchLimit: 4000 }))
    const target = createValidTargetWeapon()
    const weapon = createValidOwnedWeapon()
    const entry = createValidBuildListEntry()
    const plan = { ...createValidProductionPlan(), status: 'active' as const }
    const rngState = createValidRngState()
    await old.table('settings').put(legacy)
    await old.table('targetWeapons').put(target)
    await old.table('ownedWeapons').put(weapon)
    await old.table('buildListEntries').put(entry)
    await old.table('productionPlans').put(plan)
    await old.table('rngState').put(rngState)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(10)
      const migrated = await database.settings.get('settings')
      expect(migrated).toEqual({
        ...legacy,
        schemaVersion: 2,
        candidateSearchDefaults: RECOMMENDED,
      })
      // The old fixed Search screen values were never saved, and the Normal
      // Counter Identification's `defaultSearchLimit` keeps its own meaning.
      expect(migrated?.debugMode).toBe(true)
      expect(migrated?.defaultSearchLimit).toBe(4000)
      expect(migrated?.resultPageSize).toBe(25)
      expect(migrated?.createdAt).toBe(legacy.createdAt)
      expect(migrated?.updatedAt).toBe(legacy.updatedAt)
      expect(migrated && validateAppSettings(migrated).isValid).toBe(true)

      expect(await database.targetWeapons.get(target.id)).toEqual(target)
      expect(await database.ownedWeapons.get(weapon.id)).toEqual(weapon)
      expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
      expect(await database.rngState.get('current')).toEqual(rngState)
    } finally {
      database.close()
      await Dexie.delete(name)
    }
  })

  it('leaves a database without a settings record without one', async () => {
    const name = `app-settings-v9-empty-${crypto.randomUUID()}`
    openSchema8(name).close()
    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(await database.settings.count()).toBe(0)
    } finally {
      database.close()
      await Dexie.delete(name)
    }
  })

  it('never rewrites a record that is not an AppSettings v1 record', async () => {
    const name = `app-settings-v9-foreign-${crypto.randomUUID()}`
    const old = openSchema8(name)
    // Not a v1 record (already carries the field): kept exactly for validation to judge.
    const odd = { ...legacyAppSettingsV1(dataTransferSettings()), candidateSearchDefaults: { maxNormalAdvance: 9 } }
    await old.table('settings').put(odd)
    old.close()
    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(await database.settings.get('settings')).toEqual(odd)
    } finally {
      database.close()
      await Dexie.delete(name)
    }
  })
})
