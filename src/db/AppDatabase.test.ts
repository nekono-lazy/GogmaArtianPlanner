import { describe, expect, it } from 'vitest'
import { AppDatabase } from './AppDatabase'

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
})
