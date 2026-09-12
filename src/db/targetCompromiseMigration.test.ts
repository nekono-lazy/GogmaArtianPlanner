import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from './AppDatabase'
import { migrateLegacyTargetCompromise } from './migrateLegacyTargetCompromise'
import { createValidTargetWeapon, createValidBuildCandidate, createValidBuildListEntry, createValidOwnedWeapon, createValidProductionPlan } from '../test/fixtures/domainData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, isBuildResultCalculationContextCompatible, isCalculationContextCompatible } from '../domain/models/publicTypes'
import { hasTargetCompromise } from '../domain/target'

function legacyTarget() {
  const { alternativeBonusRules: _rules, ...target } = createValidTargetWeapon()
  void _rules
  return {
    ...target,
    practicalBonusConditions: [{ id: 'legacy', bonusTypeId: 'bonus_type.fixture.attack', minimumRankId: 'bonus_rank.fixture.high', requiredCount: 1, requiredExCount: 0 }],
    practicalAlternativeGroups: [{ id: 'legacy-or', requiredCount: 1, options: [{ bonusTypeId: 'bonus_type.fixture.element', minimumRankId: 'bonus_rank.fixture.middle' }] }],
  }
}

describe('fail-closed Target compromise migration', () => {
  it('is pure and preserves every Ideal/base field without inferring a replacement source', () => {
    const legacy = legacyTarget(); const before = structuredClone(legacy)
    const migrated = migrateLegacyTargetCompromise(legacy)
    expect(legacy).toEqual(before)
    expect(migrated).toMatchObject({ id: legacy.id, idealBonuses: legacy.idealBonuses, idealSkillCondition: legacy.idealSkillCondition, name: legacy.name, memo: legacy.memo, createdAt: legacy.createdAt, updatedAt: legacy.updatedAt, practicalBonusConditions: [], alternativeBonusRules: [], practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }, compromiseNeedsReview: true })
    expect(migrated).not.toHaveProperty('practicalAlternativeGroups')
  })
  it('upgrades a real schema-1 database atomically and preserves historical artifacts exactly', async () => {
    const name = `migration-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores({
      rngState: 'id', normalArtianCounters: 'id, [weaponTypeId+rarity], isConfirmed',
      ownedWeapons: 'id, weaponTypeId, elementId, status, isProtected, updatedAt',
      targetWeapons: 'id, weaponTypeId, elementId, priority, isEnabled, updatedAt',
      buildCandidates: 'id, targetWeaponId, category, searchStateHash, searchRunId, createdAt',
      buildListEntries: 'id, candidateId, targetWeaponId, searchStateHash, isStale, createdAt',
      productionPlans: 'id, status, createdAt, updatedAt', executionHistory: 'id, planId, planStepId, createdAt', settings: 'id',
    })
    const candidate = createValidBuildCandidate(), entry = createValidBuildListEntry(), plan = createValidProductionPlan()
    const practical = createValidOwnedWeapon()
    const legacy = legacyTarget()
    await old.table('targetWeapons').put(legacy)
    await old.table('buildCandidates').put(candidate)
    await old.table('buildListEntries').put(entry)
    await old.table('productionPlans').put(plan)
    await old.table('ownedWeapons').put(practical)
    old.close()
    const db = new AppDatabase(name)
    try {
      await db.open()
      const migrated = await db.targetWeapons.get(legacy.id)
      expect(db.verno).toBe(4)
      // v1 -> v2 -> v3 -> v4 runs in order: the compromise migration first,
      // then the preferred owned weapon field, which starts unset for every
      // Target, then the owned Gogma status rename.
      expect(migrated).toEqual({
        ...migrateLegacyTargetCompromise(legacy),
        preferredOwnedWeaponId: null,
      })
      expect(hasTargetCompromise(migrated!)).toBe(false)
      expect(await db.buildCandidates.get(candidate.id)).toEqual(candidate)
      expect(await db.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await db.productionPlans.get(plan.id)).toEqual(plan)
      expect(await db.ownedWeapons.get(practical.id)).toEqual(practical)
      db.close(); await db.open()
      expect(await db.targetWeapons.get(legacy.id)).toEqual(migrated)
    } finally { await db.delete() }
  })
})

describe('Target semantics calculation boundary', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('fails closed for every schema-%i calculation artifact', (version) => {
    const stored = { ...createValidBuildCandidate().calculationContext, appSchemaVersion: version }
    const current = { ...stored, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(9)
    expect(isBuildResultCalculationContextCompatible(stored, current)).toBe(false)
    expect(isCalculationContextCompatible(stored, current)).toBe(false)
    expect(isBuildResultCalculationContextCompatible(current, current)).toBe(true)
    expect(isCalculationContextCompatible(current, current)).toBe(true)
  })
})
