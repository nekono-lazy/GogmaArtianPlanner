import { describe, expect, it } from 'vitest'
import {
  EXPORT_SCHEMA_VERSION,
  migrateExportRootV9ToV10,
  prepareExportRootForImport,
  type ExportRoot,
  type ExportRootV9,
} from './exportModel'
import { createExpectedPlanState, createSearchStateHash } from './hashing'
import {
  RNG_STATE_SCHEMA_VERSION,
  executionSavePointIdForPlan,
  validateNormalArtianCounter,
  validateRngState,
  type ExecutionSavePoint,
} from './publicTypes'
import { createInitialRngState } from './factories'
import {
  DOMAIN_FIXTURE_TIME,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'

const IDENTIFIED_AT = '2026-09-18T00:00:00.000Z'

function savePointFor(): ExecutionSavePoint {
  const plan = { ...createValidProductionPlan(), status: 'active' as const }
  return {
    id: executionSavePointIdForPlan(plan.id),
    productionPlanId: plan.id,
    lastExecutionHistoryId: null,
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [createValidOwnedWeapon()],
    targetWeapons: [createValidTargetWeapon()],
    productionPlan: plan,
    recordedAt: DOMAIN_FIXTURE_TIME,
  }
}

function exportRoot(): ExportRoot {
  const plan = createValidProductionPlan()
  const history = createValidExecutionHistory()
  return {
    schemaVersion: 10,
    appName: 'mh-wilds-gogma-artian-planner',
    exportedAt: DOMAIN_FIXTURE_TIME,
    rngState: { ...createValidRngState(), lastIdentifiedAt: IDENTIFIED_AT },
    normalArtianCounters: [{ ...createValidNormalArtianCounter(), lastIdentifiedAt: IDENTIFIED_AT }],
    ownedWeapons: [createValidOwnedWeapon()],
    targetWeapons: [createValidTargetWeapon()],
    buildCandidates: [createValidBuildCandidate()],
    buildListEntries: [createValidBuildListEntry()],
    productionPlans: [plan],
    executionHistory: [history],
    executionSavePoints: [{ ...savePointFor(), productionPlanId: plan.id, id: executionSavePointIdForPlan(plan.id), lastExecutionHistoryId: history.id, productionPlan: { ...plan, status: 'active' } }],
    settings: {
      id: 'settings',
      schemaVersion: 1,
      debugMode: false,
      resultPageSize: 50,
      defaultSearchLimit: 5000,
      createdAt: DOMAIN_FIXTURE_TIME,
      updatedAt: DOMAIN_FIXTURE_TIME,
    },
  }
}

function stripProvenance<T extends Record<string, unknown>>(body: T, rngState = false): T {
  const copy: Record<string, unknown> = { ...body }
  delete copy.lastIdentifiedAt
  if (rngState) copy.schemaVersion = 1
  return copy as T
}

/** The same content as schema 9 stored it: no provenance anywhere, RngState record schema 1. */
function schema9Root(): ExportRootV9 {
  const root = exportRoot()
  const history = root.executionHistory[0]
  return {
    ...root,
    schemaVersion: 9,
    rngState: stripProvenance(root.rngState as unknown as Record<string, unknown>, true) as never,
    normalArtianCounters: root.normalArtianCounters.map((counter) => stripProvenance(counter as unknown as Record<string, unknown>) as never),
    executionSavePoints: root.executionSavePoints.map((savePoint) => ({
      ...savePoint,
      rngState: stripProvenance(savePoint.rngState as unknown as Record<string, unknown>, true) as never,
      normalCounters: savePoint.normalCounters.map((counter) => stripProvenance(counter as unknown as Record<string, unknown>) as never),
    })),
    executionHistory: [{
      ...history,
      undoSnapshot: {
        ...history.undoSnapshot,
        rngStateBefore: stripProvenance(history.undoSnapshot.rngStateBefore as unknown as Record<string, unknown>, true) as never,
        normalCountersBefore: history.undoSnapshot.normalCountersBefore.map((counter) => stripProvenance(counter as unknown as Record<string, unknown>) as never),
      },
    }],
  }
}

describe('Identification provenance model', () => {
  it('creates the initial RngState at record schema 2 with no provenance', () => {
    expect(createInitialRngState(DOMAIN_FIXTURE_TIME)).toMatchObject({ schemaVersion: RNG_STATE_SCHEMA_VERSION, lastIdentifiedAt: null })
    expect(validateRngState(createInitialRngState(DOMAIN_FIXTURE_TIME)).isValid).toBe(true)
  })

  it('validates lastIdentifiedAt as null or a date-time string and refuses record schema 1', () => {
    expect(validateRngState({ ...createValidRngState(), lastIdentifiedAt: IDENTIFIED_AT }).isValid).toBe(true)
    expect(validateRngState({ ...createValidRngState(), lastIdentifiedAt: '' }).issues.map(({ path }) => path)).toEqual(['lastIdentifiedAt'])
    expect(validateRngState({ ...createValidRngState(), schemaVersion: 1 } as never).issues.map(({ path }) => path)).toEqual(['schemaVersion'])
    expect(validateRngState(stripProvenance(createValidRngState() as unknown as Record<string, unknown>) as never).issues.map(({ path }) => path)).toEqual(['lastIdentifiedAt'])
    expect(validateNormalArtianCounter({ ...createValidNormalArtianCounter(), lastIdentifiedAt: IDENTIFIED_AT }).isValid).toBe(true)
    expect(validateNormalArtianCounter(stripProvenance(createValidNormalArtianCounter() as unknown as Record<string, unknown>) as never).issues.map(({ path }) => path)).toEqual(['lastIdentifiedAt'])
  })

  it('never enters a semantic hash: searchStateHash, ExpectedPlanState and the Normal Counter hash ignore it', () => {
    const state = createValidRngState()
    const counter = createValidNormalArtianCounter()
    const weapon = createValidOwnedWeapon()
    const route = createValidBuildCandidate().route
    const before = createExpectedPlanState(state, [counter], [weapon], { targetWeapons: [], dependentTargetWeaponIds: [] })
    const searchBefore = createSearchStateHash(route, state, [counter])
    const identifiedState = { ...state, lastIdentifiedAt: IDENTIFIED_AT }
    const identifiedCounter = { ...counter, lastIdentifiedAt: IDENTIFIED_AT }
    expect(createExpectedPlanState(identifiedState, [identifiedCounter], [weapon], { targetWeapons: [], dependentTargetWeaponIds: [] })).toEqual(before)
    expect(createSearchStateHash(route, identifiedState, [identifiedCounter])).toBe(searchBefore)
  })
})

describe('Export schema 9 -> 10', () => {
  it('round-trips the provenance through JSON at schema 10', () => {
    const root = exportRoot()
    const imported = prepareExportRootForImport(JSON.parse(JSON.stringify(root)))
    expect(imported).toEqual({ ok: true, root })
    expect(EXPORT_SCHEMA_VERSION).toBe(10)
  })

  it('fills null provenance and record schema 2 in the root, the save points and the Undo snapshots, and infers nothing', () => {
    const legacy = schema9Root()
    const migrated = migrateExportRootV9ToV10(legacy)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.schemaVersion).toBe(10)
    expect(migrated.root.rngState).toEqual({ ...createValidRngState(), lastIdentifiedAt: null })
    expect(migrated.root.normalArtianCounters).toEqual([{ ...createValidNormalArtianCounter(), lastIdentifiedAt: null }])
    expect(migrated.root.executionSavePoints[0].rngState).toEqual({ ...createValidRngState(), lastIdentifiedAt: null })
    expect(migrated.root.executionSavePoints[0].normalCounters).toEqual([{ ...createValidNormalArtianCounter(), lastIdentifiedAt: null }])
    expect(migrated.root.executionHistory[0].undoSnapshot.rngStateBefore).toEqual({ ...createValidRngState(), lastIdentifiedAt: null })
    expect(migrated.root.executionHistory[0].undoSnapshot.normalCountersBefore).toEqual([{ ...createValidNormalArtianCounter(), lastIdentifiedAt: null }])
    // Every other entity is untouched.
    expect(migrated.root.productionPlans).toEqual(legacy.productionPlans)
    expect(migrated.root.buildListEntries).toEqual(legacy.buildListEntries)
    expect(migrated.root.ownedWeapons).toEqual(legacy.ownedWeapons)
    expect(legacy.schemaVersion).toBe(9)
    // The whole import chain accepts the schema 9 root.
    const imported = prepareExportRootForImport(JSON.parse(JSON.stringify(legacy)))
    expect(imported.ok && imported.root.schemaVersion).toBe(10)
    expect(imported.ok && imported.root.rngState?.lastIdentifiedAt).toBeNull()
  })

  it('migrates a schema 9 root without an RngState', () => {
    const legacy = { ...schema9Root(), rngState: null }
    const migrated = migrateExportRootV9ToV10(legacy)
    expect(migrated.ok && migrated.root.rngState).toBeNull()
  })

  it('refuses a schema 9 body that already carries the schema 10 provenance', () => {
    const legacy = schema9Root()
    expect(migrateExportRootV9ToV10({ ...legacy, rngState: { ...legacy.rngState, lastIdentifiedAt: null } as never }).ok).toBe(false)
    expect(migrateExportRootV9ToV10({ ...legacy, rngState: { ...legacy.rngState, schemaVersion: 2 } as never }).ok).toBe(false)
    expect(migrateExportRootV9ToV10({ ...legacy, normalArtianCounters: [{ ...legacy.normalArtianCounters[0], lastIdentifiedAt: null }] }).ok).toBe(false)
    const savePoint = legacy.executionSavePoints[0]
    expect(migrateExportRootV9ToV10({
      ...legacy,
      executionSavePoints: [{ ...savePoint, normalCounters: [{ ...savePoint.normalCounters[0], lastIdentifiedAt: IDENTIFIED_AT }] }],
    }).ok).toBe(false)
    const history = legacy.executionHistory[0]
    expect(migrateExportRootV9ToV10({
      ...legacy,
      executionHistory: [{ ...history, undoSnapshot: { ...history.undoSnapshot, rngStateBefore: { ...history.undoSnapshot.rngStateBefore, lastIdentifiedAt: null } } }],
    }).ok).toBe(false)
    // A schema 10 root claiming schema 9 is refused the same way.
    expect(prepareExportRootForImport({ ...exportRoot(), schemaVersion: 9 }).ok).toBe(false)
  })

  it('refuses malformed schema 9 bodies without throwing', () => {
    const legacy = schema9Root()
    expect(migrateExportRootV9ToV10({ ...legacy, rngState: 'x' as never }).ok).toBe(false)
    expect(migrateExportRootV9ToV10({ ...legacy, normalArtianCounters: [null] as never }).ok).toBe(false)
    expect(migrateExportRootV9ToV10({ ...legacy, executionHistory: [{ ...legacy.executionHistory[0], undoSnapshot: null }] as never }).ok).toBe(false)
  })
})
