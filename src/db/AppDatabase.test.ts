import { describe, expect, it } from 'vitest'
import type { Table } from 'dexie'
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
import { AppDatabase, DATABASE_SCHEMA_VERSION } from './AppDatabase'

describe('AppDatabase schema', () => {
  it('defines every v1 table', () => {
    const database = new AppDatabase('schema-test')

    expect(database.tables.map((table) => table.name).sort()).toEqual([
      'buildCandidates',
      'buildListEntries',
      'executionHistory',
      'normalArtianCounters',
      'ownedWeapons',
      'productionPlans',
      'rngState',
      'settings',
      'targetWeapons',
    ])
    database.close()
  })

  it('uses schema version 4 and exposes tables with formal Domain types', () => {
    const database = new AppDatabase('schema-domain-types-test')
    const rngState: Table<RngState, 'current'> = database.rngState
    const normalCounters: Table<NormalArtianCounter, string> =
      database.normalArtianCounters
    const ownedWeapons: Table<OwnedWeapon, string> = database.ownedWeapons
    const targetWeapons: Table<TargetWeapon, string> = database.targetWeapons
    const candidates: Table<BuildCandidate, string> = database.buildCandidates
    const buildList: Table<BuildListEntry, string> = database.buildListEntries
    const plans: Table<ProductionPlan, string> = database.productionPlans
    const history: Table<ExecutionHistory, string> = database.executionHistory
    const settings: Table<AppSettings, 'settings'> = database.settings
    const typedTables = [
      rngState,
      normalCounters,
      ownedWeapons,
      targetWeapons,
      candidates,
      buildList,
      plans,
      history,
      settings,
    ]
    expect(DATABASE_SCHEMA_VERSION).toBe(4)
    expect(database.verno).toBe(4)
    expect(typedTables).toHaveLength(9)
    database.close()
  })
})
