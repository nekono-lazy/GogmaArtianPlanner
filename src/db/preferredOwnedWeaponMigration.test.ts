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
} from '../test/fixtures/domainData'
import type { ExportRoot } from '../domain/models/exportModel'

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

/**
 * A schema-2 Target: already compromise-migrated, still carrying no preferred
 * owned weapon field, alongside a schema-2 OwnedWeapon still carrying the old
 * `relatedTargetWeaponIds` provenance list.
 */
function legacyRecords() {
  const target = createValidTargetWeapon()
  const { preferredOwnedWeaponId: _preferred, ...schema2Target } = target
  void _preferred
  const weapon = createValidOwnedWeapon()
  return {
    target: schema2Target as unknown as Record<string, unknown>,
    targetId: target.id,
    weaponId: weapon.id,
    weapon: {
      ...weapon,
      relatedTargetWeaponIds: [target.id, target.id],
    } as unknown as Record<string, unknown>,
  }
}

describe('preferred owned weapon persistence migration', () => {
  it('uses DATABASE_SCHEMA_VERSION 4', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(4)
  })

  it('declares Export schema version 4', () => {
    const schemaVersion: ExportRoot['schemaVersion'] = 4
    expect(schemaVersion).toBe(4)
  })

  it('runs v1 -> v2 -> v3 -> v4 in order and clears every Target preference', async () => {
    const name = `preferred-migration-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    const { target, targetId, weapon, weaponId } = legacyRecords()
    // The legacy Target still carries the schema-1 compromise shape, so the v2
    // migration must run before v3 rather than being skipped.
    const schema1Target = {
      ...target,
      practicalAlternativeGroups: [
        { id: 'legacy-or', requiredCount: 1, options: [] },
      ],
    }
    const candidate = createValidBuildCandidate()
    const entry = createValidBuildListEntry()
    const plan = createValidProductionPlan()
    const history = createValidExecutionHistory()
    await old.table('targetWeapons').put(schema1Target)
    await old.table('ownedWeapons').put(weapon)
    await old.table('buildCandidates').put(candidate)
    await old.table('buildListEntries').put(entry)
    await old.table('productionPlans').put(plan)
    await old.table('executionHistory').put(history)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(4)

      const migratedTarget = await database.targetWeapons.get(targetId)
      expect(migratedTarget?.preferredOwnedWeaponId).toBeNull()
      // The v2 compromise migration still ran on the way through.
      expect(migratedTarget).not.toHaveProperty('practicalAlternativeGroups')
      expect(migratedTarget?.compromiseNeedsReview).toBe(true)

      const migratedWeapon = await database.ownedWeapons.get(weaponId)
      expect(migratedWeapon).not.toHaveProperty('relatedTargetWeaponIds')
      // Nothing else about the weapon changed.
      expect(migratedWeapon?.isProtected).toBe(true)
      expect(migratedWeapon?.createdAt).toBe(weapon.createdAt)

      // Past calculation artifacts keep their exact persisted contents; the
      // CalculationContext boundary is what fails them closed.
      expect(await database.buildCandidates.get(candidate.id)).toEqual(candidate)
      expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
      expect(await database.executionHistory.get(history.id)).toEqual(history)
    } finally {
      await database.delete()
    }
  })

  it('never infers a preference from the old relatedTargetWeaponIds list', async () => {
    const name = `preferred-no-inference-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    const { target, targetId, weapon, weaponId } = legacyRecords()
    // The old field named exactly this Target, and the weapon is compatible and
    // unprotected - still nothing is converted. The old field was provenance
    // metadata, not a statement about which weapon a Target wants to start
    // from, and it could be one-to-many (`docs/DATA_MODEL.md` 14.2).
    await old.table('targetWeapons').put(target)
    await old
      .table('ownedWeapons')
      .put({ ...weapon, isProtected: false })
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      const migrated = await database.targetWeapons.get(targetId)
      expect(migrated?.preferredOwnedWeaponId).toBeNull()
      expect(migrated?.preferredOwnedWeaponId).not.toBe(weaponId)
    } finally {
      await database.delete()
    }
  })
})
