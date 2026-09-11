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
} from '../test/fixtures/domainData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { isCalculationContextCompatible } from '../domain/models/domainRules'
import { validateProductionPlan } from '../domain/models/validation'

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

/** One pre-v4 owned weapon record, written through the raw schema-1 table. */
function legacyWeapon(
  id: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    id: ownedWeaponId(id),
    ...fields,
  } as unknown as Record<string, unknown>
}

/**
 * A schema-3 Target, i.e. already carrying `preferredOwnedWeaponId`, so the v4
 * upgrade is the only one with anything left to change about it.
 */
function legacyTarget(preferredOwnedWeaponId: string | null) {
  return {
    ...createValidTargetWeapon(),
    preferredOwnedWeaponId:
      preferredOwnedWeaponId === null
        ? null
        : ownedWeaponId(preferredOwnedWeaponId),
  } as unknown as Record<string, unknown>
}

describe('owned weapon status persistence migration', () => {
  it('uses DATABASE_SCHEMA_VERSION 4', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(4)
  })

  it('renames only material, keeps every other status, protection and preference', async () => {
    const name = `owned-status-migration-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)

    const material = legacyWeapon('owned.status.material', {
      status: 'material',
      isProtected: false,
    })
    // A formerly Material weapon the user had protected: the rename must not
    // quietly unprotect it.
    const protectedMaterial = legacyWeapon('owned.status.material-protected', {
      status: 'material',
      isProtected: true,
    })
    const practical = legacyWeapon('owned.status.practical', {
      status: 'practical',
      isProtected: false,
    })
    const ideal = legacyWeapon('owned.status.ideal', {
      status: 'ideal',
      isProtected: true,
    })
    const normal = legacyWeapon('owned.status.normal', {
      kind: 'normal',
      rarity: 8,
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    })
    const target = legacyTarget('owned.status.practical')

    const candidate = createValidBuildCandidate()
    const entry = createValidBuildListEntry()
    const plan = createValidProductionPlan()
    const history = createValidExecutionHistory()

    for (const weapon of [material, protectedMaterial, practical, ideal, normal]) {
      await old.table('ownedWeapons').put(weapon)
    }
    await old.table('targetWeapons').put(target)
    await old.table('buildCandidates').put(candidate)
    await old.table('buildListEntries').put(entry)
    await old.table('productionPlans').put(plan)
    await old.table('executionHistory').put(history)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      // v1 -> v2 -> v3 -> v4 all run, in order.
      expect(database.verno).toBe(4)

      const read = async (id: string) =>
        database.ownedWeapons.get(ownedWeaponId(id))

      expect((await read('owned.status.material'))?.status).toBe('unclassified')
      expect((await read('owned.status.material'))?.isProtected).toBe(false)

      const keptProtection = await read('owned.status.material-protected')
      expect(keptProtection?.status).toBe('unclassified')
      expect(keptProtection?.isProtected).toBe(true)

      expect((await read('owned.status.practical'))?.status).toBe('practical')
      expect((await read('owned.status.practical'))?.isProtected).toBe(false)
      expect((await read('owned.status.ideal'))?.status).toBe('ideal')
      expect((await read('owned.status.ideal'))?.isProtected).toBe(true)
      expect((await read('owned.status.normal'))?.status).toBeNull()

      // Past calculation artifacts keep their exact persisted contents. Nothing
      // guesses a legacy operation or status into a current one; the
      // CalculationContext boundary is what fails them closed.
      expect(await database.buildCandidates.get(candidate.id)).toEqual(candidate)
      expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
      expect(await database.executionHistory.get(history.id)).toEqual(history)
    } finally {
      await database.delete()
    }
  })

  it('leaves a schema-3 Target preference alone when only v4 runs', async () => {
    const name = `owned-status-preference-${crypto.randomUUID()}`
    // A database already at schema 3, so the v3 upgrade that clears every
    // preference is behind us and v4 is the only upgrade left to run.
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)
    old.version(2).stores({})
    old.version(3).stores({})
    const preferred = legacyWeapon('owned.preference.kept', {
      status: 'material',
      isProtected: false,
    })
    await old.table('ownedWeapons').put(preferred)
    await old.table('targetWeapons').put(legacyTarget('owned.preference.kept'))
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(4)
      const migratedTarget = await database.targetWeapons.get(
        createValidTargetWeapon().id,
      )
      expect(migratedTarget?.preferredOwnedWeaponId).toBe(
        ownedWeaponId('owned.preference.kept'),
      )
      expect(
        (await database.ownedWeapons.get(ownedWeaponId('owned.preference.kept')))
          ?.status,
      ).toBe('unclassified')
    } finally {
      await database.delete()
    }
  })

  it('never rewrites a legacy weapon-as-material artifact into a current one', async () => {
    const name = `owned-status-legacy-artifact-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores(V1_STORES)

    // A schema-8 Plan holding the removed operations and a `material` status
    // snapshot, exactly as an older runtime persisted it.
    const legacyPlan = createValidProductionPlan()
    legacyPlan.calculationContext = {
      ...legacyPlan.calculationContext,
      appSchemaVersion: 8,
    }
    const legacySteps = structuredClone(legacyPlan.steps) as unknown as Record<
      string,
      unknown
    >[]
    legacySteps[0].operationType = 'use_weapon_as_material'
    const persistedPlan = {
      ...legacyPlan,
      steps: legacySteps,
    } as unknown as Record<string, unknown>

    await old.table('productionPlans').put(persistedPlan)
    await old.table('ownedWeapons').put(
      legacyWeapon('owned.legacy.material', { status: 'material', isProtected: false }),
    )
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      const stored = await database.productionPlans.get(legacyPlan.id)
      // Readable and byte-identical: the migration touched nothing.
      expect(stored).toEqual(persistedPlan)
      expect(
        (stored?.steps[0] as unknown as Record<string, unknown>).operationType,
      ).toBe('use_weapon_as_material')

      // ... and not executable: it fails closed on both defences.
      expect(
        isCalculationContextCompatible(stored!.calculationContext, {
          ...stored!.calculationContext,
          appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
        }),
      ).toBe(false)
      expect(validateProductionPlan(stored!).issues).toContainEqual(
        expect.objectContaining({
          path: 'steps[0].operationType',
          code: 'invalid_literal',
        }),
      )

      // The owned weapon beside it was still relabelled.
      expect(
        (await database.ownedWeapons.get(ownedWeaponId('owned.legacy.material')))
          ?.status,
      ).toBe('unclassified')
    } finally {
      await database.delete()
    }
  })
})
