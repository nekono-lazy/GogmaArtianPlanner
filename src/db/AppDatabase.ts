import Dexie, { type Table } from 'dexie'
import { migrateLegacyTargetCompromise } from './migrateLegacyTargetCompromise'
import type {
  AppSettings,
  BuildCandidate,
  BuildListEntry,
  ExecutionHistory,
  NormalArtianCounter,
  OwnedWeapon,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../domain/models/publicTypes'

export const DATABASE_NAME = 'mh-wilds-gogma-artian-planner'
export const DATABASE_SCHEMA_VERSION = 3

export class AppDatabase extends Dexie {
  rngState!: Table<RngState, 'current'>
  normalArtianCounters!: Table<NormalArtianCounter, string>
  ownedWeapons!: Table<OwnedWeapon, string>
  targetWeapons!: Table<TargetWeapon, string>
  buildCandidates!: Table<BuildCandidate, string>
  buildListEntries!: Table<BuildListEntry, string>
  productionPlans!: Table<ProductionPlan, string>
  executionHistory!: Table<ExecutionHistory, string>
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
    this.version(DATABASE_SCHEMA_VERSION).stores({}).upgrade(async (transaction) => {
      await transaction.table('targetWeapons').toCollection().modify((target: Record<string, unknown>) => {
        target.preferredOwnedWeaponId = null
      })
      await transaction.table('ownedWeapons').toCollection().modify((weapon: Record<string, unknown>) => {
        delete weapon.relatedTargetWeaponIds
      })
    })
  }
}

export const appDatabase = new AppDatabase()
