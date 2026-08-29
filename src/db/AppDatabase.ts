import Dexie, { type Table } from 'dexie'
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
export const DATABASE_SCHEMA_VERSION = 1

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
    this.version(DATABASE_SCHEMA_VERSION).stores({
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
  }
}

export const appDatabase = new AppDatabase()
