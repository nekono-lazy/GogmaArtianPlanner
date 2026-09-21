import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import type {
  ExportRoot,
  ExportRootV6,
  ExportRootV7,
  ExportRootV8,
  ExportRootV9,
  OwnedWeapon,
} from '../../domain/models/publicTypes'
import { createDefaultAppSettings } from '../../domain/models/publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  createValidBuildListEntry,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidTargetWeapon,
  ownedWeaponId,
  productionPlanId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  dataTransferMaster,
  dataTransferRoot,
  dataTransferSettings,
} from '../../test/fixtures/dataTransfer'
import {
  confirmCurrent,
  dump,
  executionService,
  existingGogmaFixture,
  seed,
} from '../../test/fixtures/executionRuntime'
import { DataTransferError, ImportExportService } from './importExportService'

const NOW = '2026-09-21T09:00:00.000Z'
const USER_TABLES = [
  'rngState',
  'normalArtianCounters',
  'ownedWeapons',
  'targetWeapons',
  'buildCandidates',
  'buildListEntries',
  'productionPlans',
  'executionHistory',
  'executionSavePoints',
  'settings',
] as const

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `import-export-${databaseSequence}-${crypto.randomUUID()}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

function service(database: AppDatabase, now = NOW): ImportExportService {
  return new ImportExportService({ database, master: dataTransferMaster(), clock: { now: () => now } })
}

/** Every user table, including settings, sorted by primary key. */
async function fullDump(database: AppDatabase) {
  return { ...(await dump(database)), settings: await database.settings.toArray() }
}

/** Seeds a root through the raw tables, bypassing the service under test. */
async function seedRoot(database: AppDatabase, root: ExportRoot): Promise<void> {
  if (root.rngState) await database.rngState.put(structuredClone(root.rngState))
  await database.normalArtianCounters.bulkPut(structuredClone(root.normalArtianCounters))
  await database.ownedWeapons.bulkPut(structuredClone(root.ownedWeapons))
  await database.targetWeapons.bulkPut(structuredClone(root.targetWeapons))
  await database.buildCandidates.bulkPut(structuredClone(root.buildCandidates))
  await database.buildListEntries.bulkPut(structuredClone(root.buildListEntries))
  await database.productionPlans.bulkPut(structuredClone(root.productionPlans))
  await database.executionHistory.bulkPut(structuredClone(root.executionHistory))
  await database.executionSavePoints.bulkPut(structuredClone(root.executionSavePoints))
  await database.settings.put(structuredClone(root.settings))
}

function without<T extends object>(value: T, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>
  keys.forEach((key) => delete copy[key])
  return copy
}

/** A different persisted state, so a replacement is observable table by table. */
function otherRoot(): ExportRoot {
  // A running Plan referencing nothing of the other root's Build List / Targets.
  const plan = { ...createValidProductionPlan(), id: productionPlanId('plan.other'), status: 'active' as const, selectedBuildListEntryIds: [], steps: [], currentStepId: null }
  return dataTransferRoot({
    rngState: null,
    normalArtianCounters: [],
    ownedWeapons: [{ ...createValidOwnedWeapon(ownedWeaponId('owned.other')), executionInProgress: null }],
    targetWeapons: [{ ...createValidTargetWeapon(), id: targetWeaponId('target.other'), preferredOwnedWeaponId: null }],
    buildCandidates: [],
    buildListEntries: [],
    productionPlans: [plan],
    executionHistory: [],
    executionSavePoints: [],
    settings: dataTransferSettings({ debugMode: false, resultPageSize: 10 }),
  })
}

async function expectUnchanged(database: AppDatabase, run: () => Promise<unknown>, code: DataTransferError['code']) {
  const before = await fullDump(database)
  await expect(run()).rejects.toMatchObject({ name: 'DataTransferError', code })
  expect(await fullDump(database)).toEqual(before)
}

describe('ImportExportService export', () => {
  it('builds the schema 10 root from every table with the service-owned version, app name and clock', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    await seedRoot(database, root)

    const exported = await service(database).exportRoot()

    expect(exported.schemaVersion).toBe(10)
    expect(exported.appName).toBe('mh-wilds-gogma-artian-planner')
    expect(exported.exportedAt).toBe(NOW)
    expect(without(exported, ['exportedAt'])).toEqual(without(root, ['exportedAt']))
  }))

  it('orders the top-level collections by ID and leaves every nested order as persisted', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    const reversedSlots = [...root.ownedWeapons[0].restorationBonuses].reverse() as OwnedWeapon['restorationBonuses']
    root.ownedWeapons = [
      { ...createValidOwnedWeapon(ownedWeaponId('owned.z')), executionInProgress: null, restorationBonuses: reversedSlots },
      { ...root.ownedWeapons[0], id: ownedWeaponId('owned.a') },
    ]
    root.targetWeapons = [root.targetWeapons[1], root.targetWeapons[0]]
    const plan = root.productionPlans[0]
    plan.steps = [
      { ...plan.steps[0], id: 'step.fixture.b' as never, order: 1 },
      { ...plan.steps[0], id: 'step.fixture.a' as never, order: 2 },
    ]
    plan.currentStepId = 'step.fixture.b' as never
    root.executionHistory[0].planStepId = 'step.fixture.b' as never
    root.executionHistory[0].undoSnapshot.productionPlanBefore = structuredClone(plan)
    root.executionSavePoints[0].productionPlan = structuredClone(plan)
    root.productionPlans = [plan, root.productionPlans[1]]
    await seedRoot(database, root)

    const exported = await service(database).exportRoot()

    expect(exported.ownedWeapons.map(({ id }) => id)).toEqual(['owned.a', 'owned.z'])
    expect(exported.targetWeapons.map(({ id }) => id)).toEqual(['target.fixture.a', 'target.fixture.completed'])
    expect(exported.productionPlans.map(({ id }) => id)).toEqual(['plan.fixture.a', 'plan.fixture.abandoned'])
    expect(exported.ownedWeapons[1].restorationBonuses).toEqual(reversedSlots)
    expect(exported.productionPlans[0].steps.map(({ id }) => id)).toEqual(['step.fixture.b', 'step.fixture.a'])
  }))

  it('reads every table inside one read-only transaction and writes nothing', () => withDatabase(async (database) => {
    await seedRoot(database, dataTransferRoot())
    const before = await fullDump(database)
    const transaction = vi.spyOn(database, 'transaction')

    await service(database).exportRoot()

    expect(transaction).toHaveBeenCalledTimes(1)
    const [mode, tables] = transaction.mock.calls[0] as unknown as [string, { name: string }[]]
    expect(mode).toBe('r')
    expect(tables.map(({ name }) => name).sort()).toEqual([...USER_TABLES].sort())
    expect(await fullDump(database)).toEqual(before)
  }))

  it('fails closed without creating settings when the AppSettings record is missing', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    await seedRoot(database, root)
    await database.settings.clear()

    await expectUnchanged(database, () => service(database).exportRoot(), 'export_state_invalid')
    expect(await database.settings.count()).toBe(0)
  }))

  it('fails closed on a persisted record violating a Domain invariant, without rewriting the database', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    await seedRoot(database, root)
    await database.ownedWeapons.put({ ...root.ownedWeapons[0], kind: 'unknown' } as unknown as OwnedWeapon)

    const before = await fullDump(database)
    const error = await service(database).exportRoot().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DataTransferError)
    expect((error as DataTransferError).code).toBe('export_state_invalid')
    expect((error as DataTransferError).validationIssues.map(({ path }) => path)).toContain('ownedWeapons[0].kind')
    expect(await fullDump(database)).toEqual(before)
  }))

  it('fails closed on a broken cross-collection reference in the current database', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    await seedRoot(database, root)
    await database.targetWeapons.delete(targetWeaponId('target.fixture.a'))

    await expectUnchanged(database, () => service(database).exportRoot(), 'export_state_invalid')
  }))

  it('fails closed when the current database holds two running Plans', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    await seedRoot(database, root)
    await database.productionPlans.put({ ...root.productionPlans[0], id: productionPlanId('plan.second-running'), status: 'stale', recalculationReasons: ['rng_state_changed'] })

    const before = await fullDump(database)
    const error = await service(database).exportRoot().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DataTransferError)
    expect((error as DataTransferError).code).toBe('export_state_invalid')
    expect((error as DataTransferError).validationIssues.map(({ code }) => code)).toContain('invalid_state')
    expect(await fullDump(database)).toEqual(before)
  }))

  it('keeps historical calculation artifacts exportable', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    expect(root.buildListEntries[0].calculationContext.appSchemaVersion).toBe(1)
    await seedRoot(database, root)

    const exported = await service(database).exportRoot()
    expect(exported.buildListEntries[0]).toEqual(root.buildListEntries[0])
  }))

  it('serializes the root as indented JSON that parses back to the same root', () => withDatabase(async (database) => {
    await seedRoot(database, dataTransferRoot())

    const json = await service(database).serializeExport()

    expect(json.startsWith('{\n  "schemaVersion": 10,')).toBe(true)
    expect(JSON.parse(json)).toEqual(await service(database).exportRoot())
  }))
})

describe('ImportExportService prepare', () => {
  it.each<[string, string]>([
    ['an empty string', ''],
    ['broken JSON', '{"schemaVersion": 10,'],
    ['an array root', '[]'],
    ['a null root', 'null'],
    ['a string root', '"root"'],
    ['another app', JSON.stringify({ ...dataTransferRoot(), appName: 'other-app' })],
    ['an unsupported older schema', JSON.stringify({ ...dataTransferRoot(), schemaVersion: 5 })],
    ['an unsupported newer schema', JSON.stringify({ ...dataTransferRoot(), schemaVersion: 11 })],
  ])('rejects %s with a typed result instead of throwing', (_label, json) => withDatabase(async (database) => {
    const result = service(database).prepareImportJson(json)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(['invalid_json', 'invalid_import']).toContain(result.code)
    expect(result.issues.length).toBeGreaterThan(0)
  }))

  it('distinguishes a non-JSON body from an invalid root', () => withDatabase(async (database) => {
    const parse = service(database).prepareImportJson('{')
    expect(parse).toMatchObject({ ok: false, code: 'invalid_json' })
    const root = service(database).prepareImportJson('{"appName":"x"}')
    expect(root).toMatchObject({ ok: false, code: 'invalid_import' })
  }))

  it('returns the validated current-schema root as a copy of the input', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    const result = service(database).prepareImportJson(JSON.stringify(root))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root).toEqual(root)
  }))

  it('reports full-validation issues as invalid_import', () => withDatabase(async (database) => {
    const root = dataTransferRoot()
    root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.missing')
    const result = service(database).prepareImportJson(JSON.stringify(root))
    expect(result).toMatchObject({ ok: false, code: 'invalid_import' })
    if (result.ok) return
    expect(result.issues.map(({ path }) => path)).toContain('targetWeapons[0].preferredOwnedWeaponId')
  }))

  describe('schema migration through the existing authority', () => {
    const PROVENANCE = ['lastIdentifiedAt']
    const LIFECYCLE = ['abandonmentReason', 'abandonedAt', 'completedAt']

    /** A schema 9 root: no Identification provenance anywhere. */
    function schema9Root(): ExportRootV9 {
      const root = dataTransferRoot()
      const stripCounters = (counters: unknown[]) => counters.map((counter) => without(counter as object, PROVENANCE))
      const stripRng = (state: object) => ({ ...without(state, PROVENANCE), schemaVersion: 1 })
      return {
        ...root,
        schemaVersion: 9,
        rngState: stripRng(root.rngState as object),
        normalArtianCounters: stripCounters(root.normalArtianCounters),
        executionSavePoints: root.executionSavePoints.map((savePoint) => ({
          ...savePoint,
          rngState: stripRng(savePoint.rngState),
          normalCounters: stripCounters(savePoint.normalCounters),
        })),
        executionHistory: root.executionHistory.map((history) => ({
          ...history,
          undoSnapshot: {
            ...history.undoSnapshot,
            rngStateBefore: stripRng(history.undoSnapshot.rngStateBefore),
            normalCountersBefore: stripCounters(history.undoSnapshot.normalCountersBefore),
            executionSavePointBefore: history.undoSnapshot.executionSavePointBefore === null
              ? null
              : {
                  ...history.undoSnapshot.executionSavePointBefore,
                  rngState: stripRng(history.undoSnapshot.executionSavePointBefore.rngState),
                  normalCounters: stripCounters(history.undoSnapshot.executionSavePointBefore.normalCounters),
                },
          },
        })),
      } as unknown as ExportRootV9
    }

    /** A schema 8 root: no ExecutionHistory, no terminal Plan, no lifecycle metadata. */
    function schema8Root(): ExportRootV8 {
      const root = schema9Root()
      const plan = without(root.productionPlans[0], LIFECYCLE)
      return {
        ...root,
        schemaVersion: 8,
        productionPlans: [plan],
        executionHistory: [],
        executionSavePoints: root.executionSavePoints.map((savePoint) => ({
          ...savePoint,
          lastExecutionHistoryId: null,
          productionPlan: without(savePoint.productionPlan, LIFECYCLE),
        })),
      } as unknown as ExportRootV8
    }

    function schema7Root(): ExportRootV7 {
      return { ...schema8Root(), schemaVersion: 7 } as unknown as ExportRootV7
    }

    function schema6Root(): ExportRootV6 {
      const root = schema7Root()
      return {
        ...without(root, ['executionSavePoints']),
        schemaVersion: 6,
        ownedWeapons: root.ownedWeapons.map((weapon) => without(weapon, ['executionInProgress'])),
        targetWeapons: [without(root.targetWeapons[0], ['lifecycleStatus', 'completedAt', 'completedByProductionPlanId'])],
      } as unknown as ExportRootV6
    }

    it('reads schema 10 as it is', () => withDatabase(async (database) => {
      const result = service(database).prepareImportRoot(dataTransferRoot())
      expect(result.ok).toBe(true)
    }))

    it('migrates schema 9 to 10 with null provenance and record schema 2, inferring no adoption time', () => withDatabase(async (database) => {
      const result = service(database).prepareImportRoot(schema9Root())
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) return
      expect(result.root.schemaVersion).toBe(10)
      expect(result.root.rngState).toMatchObject({ schemaVersion: 2, lastIdentifiedAt: null })
      expect(result.root.normalArtianCounters[0].lastIdentifiedAt).toBeNull()
      expect(result.root.executionSavePoints[0].rngState.lastIdentifiedAt).toBeNull()
      expect(result.root.executionHistory[0].undoSnapshot.rngStateBefore.lastIdentifiedAt).toBeNull()
      expect(result.root.executionHistory[0].undoSnapshot.normalCountersBefore[0].lastIdentifiedAt).toBeNull()
      const nested = result.root.executionHistory[0].undoSnapshot.executionSavePointBefore
      expect(nested).not.toBeNull()
      expect(nested?.rngState).toMatchObject({ schemaVersion: 2, lastIdentifiedAt: null })
      expect(nested?.normalCounters[0].lastIdentifiedAt).toBeNull()
    }))

    it('migrates schema 8 through 9 to 10, filling only the non-terminal lifecycle nulls', () => withDatabase(async (database) => {
      const result = service(database).prepareImportRoot(schema8Root())
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) return
      expect(result.root.schemaVersion).toBe(10)
      expect(result.root.productionPlans[0]).toMatchObject({ status: 'active', abandonmentReason: null, abandonedAt: null, completedAt: null })
      expect(result.root.executionSavePoints[0].productionPlan.abandonmentReason).toBeNull()
    }))

    it('refuses a schema 8 root holding a terminal Plan or an ExecutionHistory instead of guessing', () => withDatabase(async (database) => {
      const terminal = schema8Root()
      terminal.productionPlans.push(without({ ...createValidProductionPlan(), id: productionPlanId('plan.done'), status: 'completed' }, LIFECYCLE) as never)
      expect(service(database).prepareImportRoot(terminal)).toMatchObject({ ok: false, code: 'invalid_import' })
      const withHistory = { ...schema8Root(), executionHistory: [dataTransferRoot().executionHistory[0]] }
      expect(service(database).prepareImportRoot(withHistory)).toMatchObject({ ok: false, code: 'invalid_import' })
    }))

    it('migrates schema 7 through 8, 9 and 10 without adding executionEffects to its Plans', () => withDatabase(async (database) => {
      const result = service(database).prepareImportRoot(schema7Root())
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) return
      expect(result.root.schemaVersion).toBe(10)
      expect(result.root.productionPlans[0].steps[0].executionEffects).toBeUndefined()
      expect(result.root.productionPlans[0].baseSnapshot.dependentTargetDefinitionsHash).toBeUndefined()
    }))

    it('migrates schema 6 through every step without inferring Execution state', () => withDatabase(async (database) => {
      const result = service(database).prepareImportRoot(schema6Root())
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) return
      expect(result.root.schemaVersion).toBe(10)
      expect(result.root.ownedWeapons[0].executionInProgress).toBeNull()
      expect(result.root.targetWeapons[0]).toMatchObject({ lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null })
      expect(result.root.executionSavePoints).toEqual([])
      expect(result.root.rngState?.lastIdentifiedAt).toBeNull()
    }))

    it('applies a migrated root exactly as migrated', () => withDatabase(async (database) => {
      const s = service(database)
      const prepared = s.prepareImportRoot(schema6Root())
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return
      await s.applyImport(prepared.root)
      const exported = await s.exportRoot()
      expect(without(exported, ['exportedAt'])).toEqual(without(prepared.root, ['exportedAt']))
    }))
  })
})

describe('ImportExportService apply', () => {
  it('replaces every table with the root in one transaction and stores exportedAt nowhere', () => withDatabase(async (database) => {
    await seedRoot(database, otherRoot())
    const root = dataTransferRoot()
    const transaction = vi.spyOn(database, 'transaction')

    await service(database).applyImport(root)

    expect(transaction).toHaveBeenCalledTimes(1)
    const [mode, tables] = transaction.mock.calls[0] as unknown as [string, { name: string }[]]
    expect(mode).toBe('rw')
    expect(tables.map(({ name }) => name).sort()).toEqual([...USER_TABLES].sort())
    const after = await fullDump(database)
    expect(after.rngState).toEqual([root.rngState])
    expect(after.normalCounters).toEqual(root.normalArtianCounters)
    expect(after.ownedWeapons).toEqual(root.ownedWeapons)
    expect(after.targetWeapons).toEqual(root.targetWeapons)
    expect(after.buildListEntries).toEqual(root.buildListEntries)
    expect(after.productionPlans).toEqual(root.productionPlans)
    expect(after.executionHistory).toEqual(root.executionHistory)
    expect(after.executionSavePoints).toEqual(root.executionSavePoints)
    expect(after.settings).toEqual([root.settings])
    expect(await database.buildCandidates.toArray()).toEqual(root.buildCandidates)
    expect(JSON.stringify(after)).not.toContain('exportedAt')
    // No trace of the previous data survives.
    expect(await database.ownedWeapons.get(ownedWeaponId('owned.other'))).toBeUndefined()
    expect(await database.productionPlans.get(productionPlanId('plan.other'))).toBeUndefined()
  }))

  it('imports a null RngState as no RngState record', () => withDatabase(async (database) => {
    await seedRoot(database, dataTransferRoot())
    await service(database).applyImport(otherRoot())
    expect(await database.rngState.count()).toBe(0)
  }))

  it('re-validates the root and refuses one edited after preparation, writing nothing', () => withDatabase(async (database) => {
    await seedRoot(database, otherRoot())
    const s = service(database)
    const prepared = s.prepareImportJson(JSON.stringify(dataTransferRoot()))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    prepared.root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.missing')

    await expectUnchanged(database, () => s.applyImport(prepared.root), 'invalid_import')
  }))

  it('refuses a duplicate primary ID before any write instead of letting the last record win', () => withDatabase(async (database) => {
    await seedRoot(database, otherRoot())
    const root = dataTransferRoot()
    root.ownedWeapons.push({ ...root.ownedWeapons[0], name: 'later duplicate' })

    await expectUnchanged(database, () => service(database).applyImport(root), 'invalid_import')
  }))

  it('rolls the whole replacement back when a write fails midway', () => withDatabase(async (database) => {
    await seedRoot(database, otherRoot())
    const before = await fullDump(database)
    // The last write of the transaction fails, after every table was cleared
    // and re-filled: nothing of that may remain.
    vi.spyOn(database.settings, 'add').mockImplementation(() => { throw new Error('write failure') })

    await expect(service(database).applyImport(dataTransferRoot())).rejects.toMatchObject({ code: 'transaction_failed' })

    expect(await fullDump(database)).toEqual(before)
    expect(await database.ownedWeapons.get(ownedWeaponId('owned.fixture.a'))).toBeUndefined()
  }))

  it('runs no ordinary CRUD side effect: an active Plan, its in-progress weapon and timestamps come back exactly', () => withDatabase(async (database) => {
    // The current database runs another active Plan; Import is a backup
    // restore, so no breaking-change guard abandons anything.
    await seedRoot(database, otherRoot())
    const root = dataTransferRoot()

    await service(database).applyImport(root)

    const plan = await database.productionPlans.get(productionPlanId('plan.fixture.a'))
    expect(plan).toMatchObject({ status: 'active', abandonmentReason: null, updatedAt: DOMAIN_FIXTURE_TIME })
    expect(await database.productionPlans.get(productionPlanId('plan.other'))).toBeUndefined()
    expect(await database.ownedWeapons.get(ownedWeaponId('owned.fixture.a'))).toMatchObject({
      executionInProgress: { productionPlanId: 'plan.fixture.a', startedAt: DOMAIN_FIXTURE_TIME },
      updatedAt: DOMAIN_FIXTURE_TIME,
    })
    expect(await database.settings.get('settings')).toEqual(root.settings)
  }))

  it('accepts a BuildListEntry without its source BuildCandidate record', () => withDatabase(async (database) => {
    const root = dataTransferRoot({ buildCandidates: [] })
    await service(database).applyImport(root)
    expect(await database.buildListEntries.toArray()).toEqual([createValidBuildListEntry()])
    expect(await database.buildCandidates.count()).toBe(0)
  }))
})

describe('ImportExportService clearAllData', () => {
  it('empties every user table and creates one default AppSettings in one transaction', () => withDatabase(async (database) => {
    await seedRoot(database, dataTransferRoot())
    const transaction = vi.spyOn(database, 'transaction')

    const settings = await service(database).clearAllData()

    expect(transaction).toHaveBeenCalledTimes(1)
    expect((transaction.mock.calls[0] as unknown as [string])[0]).toBe('rw')
    expect(settings).toEqual(createDefaultAppSettings(NOW))
    for (const table of USER_TABLES) {
      const count = await database.table(table).count()
      expect([table, count]).toEqual([table, table === 'settings' ? 1 : 0])
    }
    expect(await database.settings.get('settings')).toEqual(createDefaultAppSettings(NOW))
  }))

  it('keeps the previous data entirely when the clear transaction fails', () => withDatabase(async (database) => {
    await seedRoot(database, dataTransferRoot())
    const before = await fullDump(database)
    vi.spyOn(database.settings, 'add').mockImplementation(() => { throw new Error('write failure') })

    await expect(service(database).clearAllData()).rejects.toMatchObject({ code: 'transaction_failed' })

    expect(await fullDump(database)).toEqual(before)
  }))
})

describe('ImportExportService round-trip', () => {
  it('restores the full Execution lifecycle, save point, Undo snapshot and Identification provenance into another database', () => withDatabase(async (source) => withDatabase(async (destination) => {
    const root = dataTransferRoot()
    await service(source).applyImport(root)
    const exported = await service(source).exportRoot()

    // The premises of the round trip are all present in the Export.
    expect(exported.targetWeapons.find(({ id }) => id === 'target.fixture.completed')).toMatchObject({ lifecycleStatus: 'completed', completedByProductionPlanId: 'plan.fixture.a' })
    expect(exported.ownedWeapons[0].executionInProgress).toEqual({ productionPlanId: 'plan.fixture.a', startedAt: DOMAIN_FIXTURE_TIME })
    expect(exported.productionPlans.map(({ status, abandonmentReason }) => [status, abandonmentReason])).toEqual([['active', null], ['abandoned', 'user_abandoned']])
    expect(exported.executionHistory[0].undoSnapshot.executionSavePointBefore).not.toBeNull()
    expect(exported.executionHistory[0].undoSnapshot.affectedTargetWeaponsBefore).toHaveLength(1)
    expect(exported.executionSavePoints).toHaveLength(1)
    expect(exported.rngState?.lastIdentifiedAt).toBe('2026-08-28T12:00:00.000Z')
    expect(exported.normalArtianCounters[0].lastIdentifiedAt).toBe('2026-08-27T12:00:00.000Z')
    expect(exported.executionSavePoints[0].rngState.lastIdentifiedAt).toBe('2026-08-28T00:00:00.000Z')

    const prepared = service(destination).prepareImportJson(JSON.stringify(exported))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    await service(destination).applyImport(prepared.root)

    expect(await fullDump(destination)).toEqual(await fullDump(source))
    const reExported = await service(destination, '2026-09-22T00:00:00.000Z').exportRoot()
    expect(without(reExported, ['exportedAt'])).toEqual(without(exported, ['exportedAt']))
    expect(reExported.exportedAt).toBe('2026-09-22T00:00:00.000Z')
  })))

  it('survives export, clear and import on one database', () => withDatabase(async (database) => {
    const s = service(database)
    await s.applyImport(dataTransferRoot())
    const before = await fullDump(database)
    const json = await s.serializeExport()

    await s.clearAllData()
    expect(await database.ownedWeapons.count()).toBe(0)
    const prepared = s.prepareImportJson(json)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    await s.applyImport(prepared.root)

    expect(await fullDump(database)).toEqual(before)
  }))

  it('round-trips a Plan the real Planner produced and the Execution runtime advanced', () => withDatabase(async (source) => withDatabase(async (destination) => {
    const fixture = await existingGogmaFixture()
    await seed(source, fixture)
    await source.settings.put(dataTransferSettings())
    const execution = executionService(source, fixture.built)
    await execution.startProductionPlan(fixture.plan.id)
    await confirmCurrent(execution, source, fixture.plan)
    await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
    const before = await fullDump(source)
    expect(before.executionHistory).toHaveLength(1)
    expect(before.executionSavePoints).toHaveLength(1)
    expect(before.ownedWeapons.some((weapon) => weapon.executionInProgress?.productionPlanId === fixture.plan.id)).toBe(true)

    const json = await service(source).serializeExport()
    const prepared = service(destination).prepareImportJson(json)
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    await service(destination).applyImport(prepared.root)

    expect(await fullDump(destination)).toEqual(before)
  })))
})
