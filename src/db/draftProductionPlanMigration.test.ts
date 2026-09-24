import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'
import type { ProductionPlan } from '../domain/models/publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  RNG_STATE_SCHEMA_VERSION,
  executionSavePointIdForPlan,
} from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import {
  DOMAIN_FIXTURE_TIME,
  buildListEntryId,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  productionPlanId,
} from '../test/fixtures/domainData'
import { dataTransferSettings } from '../test/fixtures/dataTransfer'

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

/** A database already at schema 7, so v8 is the only upgrade left to run. */
function openSchema7(name: string): Dexie {
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
  return old
}

function plan(id: string, status: ProductionPlan['status']): ProductionPlan {
  return {
    ...createValidProductionPlan(),
    id: productionPlanId(id),
    status,
    abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
    abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
    completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
  }
}

/** The reported real case: a Draft naming a Build List Entry that no longer exists. */
const MISSING_ENTRY_ID = buildListEntryId('build-list.fnv1a32-7ab0e079')

describe('Draft ProductionPlan persistence migration (Dexie v7 -> v8)', () => {
  it('uses DATABASE_SCHEMA_VERSION 8 and Export schema 11 without moving any calculation authority', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(8)
    expect(EXPORT_SCHEMA_VERSION).toBe(11)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(14)
    expect(RNG_STATE_SCHEMA_VERSION).toBe(2)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })

  it('A / B / C: deletes every accumulated Draft, keeps every other Plan and cascades nothing', async () => {
    const name = `draft-plan-migration-${crypto.randomUUID()}`
    const old = openSchema7(name)
    // Three Drafts of the old accumulating contract. Their timestamps and IDs
    // are deliberately ordered so that no "latest" rule could be read into the
    // result: none of them survives, whatever `createdAt`, `updatedAt` or ID says.
    const draftA = { ...plan('plan.draft.a', 'draft'), createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }
    const draftB = {
      ...plan('plan.draft.b', 'draft'),
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      // The reported real case: the Draft names an Entry the user has since removed.
      selectedBuildListEntryIds: [MISSING_ENTRY_ID],
      steps: createValidProductionPlan().steps.map((step) => ({ ...step, buildListEntryId: MISSING_ENTRY_ID })),
    }
    const draftC = { ...plan('plan.draft.c', 'draft'), createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }
    const active = plan('plan.running.active', 'active')
    const completed = plan('plan.done.completed', 'completed')
    const abandoned = plan('plan.done.abandoned', 'abandoned')
    // The Entry draft A and the active Plan reference: a Draft owns no Entry,
    // so deleting the Draft must not cascade to it.
    const entry = createValidBuildListEntry()
    const candidate = createValidBuildCandidate()
    const target = createValidTargetWeapon()
    const weapon = { ...createValidOwnedWeapon(), executionInProgress: { productionPlanId: active.id, startedAt: DOMAIN_FIXTURE_TIME } }
    const rngState = { ...createValidRngState(), lastIdentifiedAt: '2026-09-10T00:00:00.000Z' }
    const counter = { ...createValidNormalArtianCounter(), lastIdentifiedAt: null }
    const history = { ...createValidExecutionHistory(), planId: active.id }
    history.undoSnapshot.productionPlanBefore = { ...active }
    const savePoint = {
      id: executionSavePointIdForPlan(active.id),
      productionPlanId: active.id,
      lastExecutionHistoryId: null,
      rngState,
      normalCounters: [counter],
      ownedWeapons: [weapon],
      targetWeapons: [target],
      productionPlan: { ...active },
      recordedAt: DOMAIN_FIXTURE_TIME,
    }
    const settings = dataTransferSettings()

    await old.table('productionPlans').bulkPut([draftA, draftB, draftC, active, completed, abandoned])
    await old.table('buildListEntries').put(entry)
    await old.table('buildCandidates').put(candidate)
    await old.table('targetWeapons').put(target)
    await old.table('ownedWeapons').put(weapon)
    await old.table('rngState').put(rngState)
    await old.table('normalArtianCounters').put(counter)
    await old.table('executionHistory').put(history)
    await old.table('executionSavePoints').put(savePoint)
    await old.table('settings').put(settings)
    old.close()

    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(database.verno).toBe(8)

      // A: every Draft is gone, and no Draft was chosen to survive.
      expect(await database.productionPlans.where('status').equals('draft').count()).toBe(0)
      for (const draft of [draftA, draftB, draftC]) {
        expect(await database.productionPlans.get(draft.id)).toBeUndefined()
      }
      // ... while every other status keeps its whole body.
      expect(await database.productionPlans.get(active.id)).toEqual(active)
      expect(await database.productionPlans.get(completed.id)).toEqual(completed)
      expect(await database.productionPlans.get(abandoned.id)).toEqual(abandoned)
      expect(await database.productionPlans.count()).toBe(3)

      // B: the Entry a Draft referenced is not cascaded.
      expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await database.buildListEntries.count()).toBe(1)

      // C: no other collection is deleted or repaired.
      expect(await database.buildCandidates.get(candidate.id)).toEqual(candidate)
      expect(await database.targetWeapons.get(target.id)).toEqual(target)
      expect(await database.ownedWeapons.get(weapon.id)).toEqual(weapon)
      expect(await database.rngState.get('current')).toEqual(rngState)
      expect(await database.normalArtianCounters.get(counter.id)).toEqual(counter)
      expect(await database.executionHistory.get(history.id)).toEqual(history)
      expect(await database.executionSavePoints.get(savePoint.id)).toEqual(savePoint)
      expect(await database.settings.get('settings')).toEqual(settings)
    } finally {
      await database.delete()
    }
  })

  it('leaves a schema 7 database that holds no Draft exactly as it is', async () => {
    const name = `draft-plan-migration-none-${crypto.randomUUID()}`
    const old = openSchema7(name)
    const stale = { ...plan('plan.running.stale', 'stale'), recalculationReasons: ['rng_state_changed' as const] }
    const completed = plan('plan.done.completed', 'completed')
    await old.table('productionPlans').bulkPut([stale, completed])
    old.close()
    const database = new AppDatabase(name)
    try {
      await database.open()
      expect(await database.productionPlans.get(stale.id)).toEqual(stale)
      expect(await database.productionPlans.get(completed.id)).toEqual(completed)
      expect(await database.productionPlans.count()).toBe(2)
    } finally {
      await database.delete()
    }
  })
})
