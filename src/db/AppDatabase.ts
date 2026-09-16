import Dexie, { type Table } from 'dexie'
import { migrateLegacyTargetCompromise } from './migrateLegacyTargetCompromise'
import type {
  AppSettings,
  BuildCandidate,
  BuildListEntry,
  ExecutionHistory,
  ExecutionSavePoint,
  NormalArtianCounter,
  OwnedWeapon,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../domain/models/publicTypes'

export const DATABASE_NAME = 'mh-wilds-gogma-artian-planner'
export const DATABASE_SCHEMA_VERSION = 5

export class AppDatabase extends Dexie {
  rngState!: Table<RngState, 'current'>
  normalArtianCounters!: Table<NormalArtianCounter, string>
  ownedWeapons!: Table<OwnedWeapon, string>
  targetWeapons!: Table<TargetWeapon, string>
  buildCandidates!: Table<BuildCandidate, string>
  buildListEntries!: Table<BuildListEntry, string>
  productionPlans!: Table<ProductionPlan, string>
  executionHistory!: Table<ExecutionHistory, string>
  executionSavePoints!: Table<ExecutionSavePoint, string>
  settings!: Table<AppSettings, 'settings'>

  constructor(name = DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      rngState: 'id',
      normalArtianCounters: 'id, [weaponTypeId+rarity], isConfirmed',
      ownedWeapons: 'id, weaponTypeId, elementId, status, isProtected, updatedAt',
      targetWeapons: 'id, weaponTypeId, elementId, priority, isEnabled, updatedAt',
      buildCandidates: 'id, targetWeaponId, category, searchStateHash, searchRunId, createdAt',
      buildListEntries: 'id, candidateId, targetWeaponId, searchStateHash, isStale, createdAt',
      productionPlans: 'id, status, createdAt, updatedAt',
      executionHistory: 'id, planId, planStepId, createdAt',
      settings: 'id',
    })
    this.version(2).stores({}).upgrade(async (transaction) => {
      await transaction.table('targetWeapons').toCollection().modify((target: Record<string, unknown>) => {
        const migrated = migrateLegacyTargetCompromise(target)
        delete target.practicalAlternativeGroups
        Object.assign(target, migrated)
      })
    })
    // v3 replaces `OwnedWeapon.relatedTargetWeaponIds` with the Target-side
    // `preferredOwnedWeaponId`. The old field recorded which Targets a weapon
    // had been created in connection with - provenance metadata that could be
    // one-to-many - while the new one states which weapon a Target wants to
    // start from. The two meanings do not correspond, so nothing is converted:
    // every Target starts with no preference and the user sets it explicitly.
    // Past calculation artifacts (BuildCandidate, BuildListEntry,
    // ProductionPlan, ExecutionHistory) keep their exact persisted contents and
    // fail closed through CalculationContext instead
    // (`docs/DATA_MODEL.md` 14.2).
    this.version(3).stores({}).upgrade(async (transaction) => {
      await transaction.table('targetWeapons').toCollection().modify((target: Record<string, unknown>) => {
        target.preferredOwnedWeaponId = null
      })
      await transaction.table('ownedWeapons').toCollection().modify((weapon: Record<string, unknown>) => {
        delete weapon.relatedTargetWeaponIds
      })
    })
    // v4 renames the owned Gogma `material` status to `unclassified`. The
    // "consume an owned Artian weapon as material" model is gone, so the value
    // no longer means anything about how the weapon may be used; it is now a
    // user-facing organisation label like the other two. Only the literal is
    // converted: `practical` and `ideal` keep their values, a Normal Artian
    // keeps `status: null`, `isProtected` is never touched (a formerly Material
    // weapon that the user had protected stays protected), and
    // `TargetWeapon.preferredOwnedWeaponId` is left alone.
    //
    // Past calculation artifacts (BuildCandidate, BuildListEntry,
    // ProductionPlan, ExecutionHistory) are deliberately NOT rewritten. Their
    // stored `use_weapon_as_material` / `create_material_gogma` /
    // `change_owned_weapon_status` operations and `status: 'material'` snapshots
    // keep their exact persisted contents and fail closed through
    // CalculationContext version 9 instead of being guessed into current
    // operations (`docs/DATA_MODEL.md` 14.2).
    this.version(4).stores({}).upgrade(async (transaction) => {
      await transaction.table('ownedWeapons').toCollection().modify((weapon: Record<string, unknown>) => {
        if (weapon.kind === 'gogma' && weapon.status === 'material') {
          weapon.status = 'unclassified'
        }
      })
    })
    // v5 adds the Execution lifecycle persisted state (`docs/DATA_MODEL.md`
    // 7.1 / 8.1 / 12.1 / 14.3). Every value it writes is the deterministic
    // "no Execution has happened yet" value, never an inference:
    //
    // - every Target becomes `active` with no completion metadata, even when
    //   the user already owns a weapon meeting its Ideal
    // - every OwnedWeapon gets `executionInProgress = null`, whatever Plans
    //   exist
    // - the new `executionSavePoints` table starts empty; no game save is
    //   guessed from ExecutionHistory
    //
    // `targetWeapons` gains a `lifecycleStatus` index, and `executionSavePoints`
    // is keyed by the Plan-derived ID with a unique `productionPlanId` index as
    // a second guard of the one-save-point-per-Plan rule. Past calculation
    // artifacts (BuildCandidate, BuildListEntry, ProductionPlan,
    // ExecutionHistory) keep their exact persisted contents. None of this moves
    // `CURRENT_CALCULATION_APP_SCHEMA_VERSION`: no calculation semantics change.
    this.version(DATABASE_SCHEMA_VERSION).stores({
      targetWeapons: 'id, weaponTypeId, elementId, priority, isEnabled, lifecycleStatus, updatedAt',
      executionSavePoints: 'id, &productionPlanId, recordedAt',
    }).upgrade(async (transaction) => {
      await transaction.table('targetWeapons').toCollection().modify((target: Record<string, unknown>) => {
        target.lifecycleStatus = 'active'
        target.completedAt = null
        target.completedByProductionPlanId = null
      })
      await transaction.table('ownedWeapons').toCollection().modify((weapon: Record<string, unknown>) => {
        weapon.executionInProgress = null
      })
    })
  }
}

export const appDatabase = new AppDatabase()
