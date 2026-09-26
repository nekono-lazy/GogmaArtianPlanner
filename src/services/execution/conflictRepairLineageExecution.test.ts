import { describe, expect, it } from 'vitest'
import type { PlannerConflictRepairLineage } from '../../domain/models/publicTypes'
import { createProductionPlan } from '../../domain/planner'
import { buildListEntryId, targetWeaponId } from '../../test/fixtures/domainData'
import {
  confirmCurrent,
  currentPlan,
  executionService,
  newNormalFixture,
  seed,
  withDatabase,
} from '../../test/fixtures/executionRuntime'

/**
 * `ProductionPlan.conflictRepairLineage` through the Plan lifecycle
 * (`docs/PLANNER_SPEC.md` 9.2.19.11, `docs/DATA_MODEL.md` 11.1.1): Plan
 * generation always starts a new chain (`null`), and every later transition -
 * `draft -> active`, Step confirmation, the save point snapshot, the Undo
 * snapshot and Undo itself - keeps the persisted value exactly. The lineage is
 * never part of an Execution judgement.
 */

const LINEAGE: PlannerConflictRepairLineage = {
  decisions: [{
    conflictKind: 'same_skill_counter',
    fixedBuildListEntryId: buildListEntryId('build-list.lineage.fixed'),
    fixedTargetWeaponId: targetWeaponId('target.lineage.fixed'),
    invalidatedRoutes: [{
      targetWeaponId: targetWeaponId('target.lineage.other'),
      invalidatedBuildListEntryId: buildListEntryId('build-list.lineage.old'),
      invalidatedRouteKey: 'route.key.lineage',
      replacementBuildListEntryId: null,
      outcome: 'not_found_within_search_extent',
    }],
  }],
}

describe('ProductionPlan repair lineage through the Plan lifecycle', () => {
  it('generates every Plan with no repair chain', async () => {
    const fixture = await newNormalFixture(2)
    const generated = await createProductionPlan(fixture.built.input, fixture.built.dependencies)
    expect(generated.plan?.conflictRepairLineage).toBeNull()
    expect(fixture.plan.conflictRepairLineage).toBeNull()
  })

  it('keeps the lineage through the start, a Step, the save point, the Undo snapshot and Undo', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      fixture.plan = { ...fixture.plan, conflictRepairLineage: structuredClone(LINEAGE) }
      await seed(database, fixture)
      const service = executionService(database, fixture.built)

      const started = await service.startProductionPlan(fixture.plan.id)
      expect(started.status).toBe('active')
      expect(started.conflictRepairLineage).toEqual(LINEAGE)

      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      expect(savePoint.productionPlan.conflictRepairLineage).toEqual(LINEAGE)

      const confirmed = await confirmCurrent(service, database, fixture.plan)
      expect(confirmed.plan.conflictRepairLineage).toEqual(LINEAGE)
      expect(confirmed.history.undoSnapshot.productionPlanBefore.conflictRepairLineage).toEqual(LINEAGE)

      await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: confirmed.history.id })
      expect((await currentPlan(database, fixture.plan)).conflictRepairLineage).toEqual(LINEAGE)
    }))
})
