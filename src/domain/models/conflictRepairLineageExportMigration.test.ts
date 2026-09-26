import { describe, expect, it } from 'vitest'
import {
  EXPORT_SCHEMA_VERSION,
  migrateExportRootV12ToV13,
  prepareExportRootForImport,
  type ExportRoot,
  type ExportRootV12,
} from './exportModel'
import type { PlannerConflictRepairLineage } from './publicTypes'
import { dataTransferRoot, withoutConflictRepairLineage } from '../../test/fixtures/dataTransfer'
import { buildListEntryId, targetWeaponId } from '../../test/fixtures/domainData'

/**
 * Export schema 12 -> 13 (`docs/DATA_MODEL.md` 11.1.1 / 15.3,
 * `docs/PLANNER_SPEC.md` 9.2.19.15): `conflictRepairLineage = null` is added to
 * every ProductionPlan body - top-level, in a game save point, in an Undo
 * snapshot and in the save point an Undo snapshot holds - and nothing else
 * changes. A schema 12 body already carrying the field fails closed.
 */

function schema12Root(): ExportRootV12 {
  return { ...withoutConflictRepairLineage(dataTransferRoot()), schemaVersion: 12 }
}

const LINEAGE: PlannerConflictRepairLineage = {
  decisions: [{
    conflictKind: 'same_skill_counter',
    fixedBuildListEntryId: buildListEntryId('build-list.lineage.fixed'),
    fixedTargetWeaponId: targetWeaponId('target.lineage.fixed'),
    invalidatedRoutes: [{
      targetWeaponId: targetWeaponId('target.lineage.other'),
      invalidatedBuildListEntryId: buildListEntryId('build-list.lineage.old'),
      invalidatedRouteKey: 'route.key.lineage',
      replacementBuildListEntryId: buildListEntryId('build-list.lineage.new'),
      outcome: 'replaced',
    }],
  }],
}

describe('Export schema 12 -> 13 (ProductionPlan repair lineage)', () => {
  it('is the current Export schema', () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
  })

  it('fills null into every Plan body, infers no decision and changes nothing else', () => {
    const legacy = schema12Root()
    const copy = structuredClone(legacy)
    const migrated = migrateExportRootV12ToV13(legacy)
    expect(migrated.ok, JSON.stringify(migrated)).toBe(true)
    if (!migrated.ok) return
    const expected = dataTransferRoot()
    expect(migrated.root).toEqual({ ...expected, schemaVersion: 13 })
    for (const plan of migrated.root.productionPlans) expect(plan.conflictRepairLineage).toBeNull()
    expect(migrated.root.executionSavePoints[0].productionPlan.conflictRepairLineage).toBeNull()
    expect(migrated.root.executionHistory[0].undoSnapshot.productionPlanBefore.conflictRepairLineage).toBeNull()
    expect(migrated.root.executionHistory[0].undoSnapshot.executionSavePointBefore?.productionPlan.conflictRepairLineage).toBeNull()
    // The input is never mutated.
    expect(legacy).toEqual(copy)
  })

  it.each([
    ['a top-level Plan', (root: ExportRootV12) => {
      (root.productionPlans[0] as unknown as Record<string, unknown>).conflictRepairLineage = null
    }, 'productionPlans[0]'],
    ['a save point Plan', (root: ExportRootV12) => {
      (root.executionSavePoints[0].productionPlan as unknown as Record<string, unknown>).conflictRepairLineage = LINEAGE
    }, 'executionSavePoints[0].productionPlan'],
    ['an Undo snapshot Plan', (root: ExportRootV12) => {
      (root.executionHistory[0].undoSnapshot.productionPlanBefore as unknown as Record<string, unknown>).conflictRepairLineage = null
    }, 'executionHistory[0].undoSnapshot.productionPlanBefore'],
    ['the Plan of an Undo snapshot save point', (root: ExportRootV12) => {
      const nested = root.executionHistory[0].undoSnapshot.executionSavePointBefore
      if (!nested) throw new Error('fixture has no nested save point')
      ;(nested.productionPlan as unknown as Record<string, unknown>).conflictRepairLineage = null
    }, 'executionHistory[0].undoSnapshot.executionSavePointBefore.productionPlan'],
  ] as const)('fails closed on %s that already carries the field', (_label, carry, path) => {
    const legacy = schema12Root()
    carry(legacy)
    const migrated = migrateExportRootV12ToV13(legacy)
    expect(migrated.ok).toBe(false)
    if (migrated.ok) return
    expect(migrated.issues.map((issue) => issue.path)).toContain(path)
    expect(prepareExportRootForImport(JSON.parse(JSON.stringify(legacy))).ok).toBe(false)
  })

  it('fails closed on a malformed collection or Undo snapshot instead of throwing', () => {
    expect(migrateExportRootV12ToV13({ ...schema12Root(), productionPlans: 'plans' } as unknown as ExportRootV12).ok).toBe(false)
    const brokenHistory = schema12Root()
    ;(brokenHistory.executionHistory[0] as unknown as Record<string, unknown>).undoSnapshot = 'snapshot'
    expect(migrateExportRootV12ToV13(brokenHistory).ok).toBe(false)
    const brokenSavePoint = schema12Root()
    ;(brokenSavePoint.executionSavePoints[0] as unknown as Record<string, unknown>).productionPlan = null
    expect(migrateExportRootV12ToV13(brokenSavePoint).ok).toBe(false)
    expect(migrateExportRootV12ToV13(null as unknown as ExportRootV12).ok).toBe(false)
  })

  it('reaches the current schema through the Import preparation', () => {
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(schema12Root())))
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    expect(prepared.root.schemaVersion).toBe(13)
    expect(prepared.root.productionPlans.every(({ conflictRepairLineage }) => conflictRepairLineage === null)).toBe(true)
  })

  it('round-trips a current schema 13 root with a lineage exactly, its IDs never read as current foreign keys', () => {
    const root: ExportRoot = dataTransferRoot()
    root.productionPlans[0] = { ...root.productionPlans[0], conflictRepairLineage: LINEAGE }
    const prepared = prepareExportRootForImport(JSON.parse(JSON.stringify(root)))
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true)
    if (!prepared.ok) return
    expect(prepared.root).toEqual(root)
  })

  it('refuses a current schema 13 root whose Plan misses the field or carries a malformed lineage', () => {
    const missing = dataTransferRoot()
    delete (missing.productionPlans[0] as unknown as Record<string, unknown>).conflictRepairLineage
    expect(prepareExportRootForImport(JSON.parse(JSON.stringify(missing))).ok).toBe(false)

    const malformed = dataTransferRoot()
    malformed.productionPlans[0] = {
      ...malformed.productionPlans[0],
      conflictRepairLineage: { decisions: [{ ...LINEAGE.decisions[0], invalidatedRoutes: [{ ...LINEAGE.decisions[0].invalidatedRoutes[0], replacementBuildListEntryId: null }] }] },
    }
    const refused = prepareExportRootForImport(JSON.parse(JSON.stringify(malformed)))
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.issues.some(({ path }) => path.includes('conflictRepairLineage'))).toBe(true)
  })
})
