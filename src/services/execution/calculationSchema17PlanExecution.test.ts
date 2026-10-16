import { describe, expect, it } from 'vitest'
import type {
  PlanConflict,
  PlannerConflictRepairLineage,
  PlanStep,
  ProductionPlan,
} from '../../domain/models/publicTypes'
import { buildListEntryId, targetWeaponId } from '../../test/fixtures/domainData'
import {
  confirmCurrent,
  currentPlan,
  executionService,
  existingGogmaFixture,
  expectRefusal,
  newNormalFixture,
  seed,
  withDatabase,
} from '../../test/fixtures/executionRuntime'

/**
 * Issue #278 PR-2 (`docs/PLANNER_SPEC.md` 9.6.10): the one ProductionPlan
 * exception `18 -> 17`. A version 17 Plan with no repair lineage and no selected
 * Conflict - a Build List Plan, a Build List optimization adoption, an auxiliary
 * Plan, a replan adoption - keeps running under schema 18 through the start,
 * Step confirmation, the save point and Undo, and is never rewritten to 18. A
 * version 17 Planner Alternative repair Plan (a lineage) or a version 17 Plan
 * carrying a selected Conflict fails closed with `calculation_context_changed`
 * in the same runtime calls.
 */

function atSchema17(plan: ProductionPlan, edit: (plan: ProductionPlan) => void = () => undefined): ProductionPlan {
  const legacy = structuredClone(plan)
  legacy.calculationContext.appSchemaVersion = 17
  legacy.baseSnapshot.calculationContext.appSchemaVersion = 17
  edit(legacy)
  return legacy
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
      replacementBuildListEntryId: null,
      outcome: 'not_found_within_search_extent',
    }],
  }],
}

function selectedConflict(plan: ProductionPlan): PlanConflict {
  const [entryId] = plan.selectedBuildListEntryIds
  return {
    id: 'conflict.schema17.selected',
    kind: 'same_gogma_counter',
    buildListEntryIds: [entryId, buildListEntryId('build-list.schema17.other')],
    reason: 'fixture',
    recommendedBuildListEntryId: entryId,
    selectedBuildListEntryId: entryId,
    resolutionNote: null,
    checkpointParticipants: [],
  }
}

describe('a resolution-free schema 17 Plan under schema 18', () => {
  it.each([
    ['an existing Gogma', () => existingGogmaFixture()],
    ['a new Normal', () => newNormalFixture(2)],
  ])('starts, confirms, records and restores the save point and undoes %s Plan without rewriting its version', (_, build) =>
    withDatabase(async (database) => {
      const fixture = await build()
      const legacy = atSchema17(fixture.plan)
      expect(legacy.conflictRepairLineage).toBeNull()
      expect(legacy.conflicts.every(({ selectedBuildListEntryId }) => selectedBuildListEntryId === null)).toBe(true)
      expect(fixture.built.input.calculationContext.appSchemaVersion).toBe(18)
      await seed(database, { ...fixture, plan: legacy })
      const service = executionService(database, fixture.built)

      const started = await service.startProductionPlan(legacy.id)
      expect(started.status).toBe('active')
      expect(started.calculationContext.appSchemaVersion).toBe(17)

      const savePoint = await service.recordExecutionSavePoint({ planId: legacy.id })
      const confirmed = await confirmCurrent(service, database, legacy)
      expect(confirmed.plan.calculationContext.appSchemaVersion).toBe(17)

      const undone = await service.undoLatestExecution({ planId: legacy.id, executionHistoryId: confirmed.history.id })
      expect(undone.plan.currentStepId).toBe(started.currentStepId)

      await confirmCurrent(service, database, legacy)
      await service.restoreExecutionSavePoint({ planId: legacy.id, recordedAt: savePoint.recordedAt })
      const restored = await currentPlan(database, legacy)
      expect(restored.status).toBe('active')
      expect(restored.currentStepId).toBe(started.currentStepId)
      expect(restored.calculationContext.appSchemaVersion).toBe(17)
      expect(restored.baseSnapshot.calculationContext.appSchemaVersion).toBe(17)
    }))
})

describe('a schema 17 Plan that carries an explicit decision under schema 18', () => {
  it.each([
    ['a repair lineage', (plan: ProductionPlan) => { plan.conflictRepairLineage = structuredClone(LINEAGE) }],
    ['a selected Conflict and no lineage', (plan: ProductionPlan) => { plan.conflicts = [selectedConflict(plan)] }],
  ])('never starts or executes a draft or active Plan with %s', (_, edit) =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const legacy = atSchema17(fixture.plan, edit)
      await seed(database, { ...fixture, plan: legacy })
      const service = executionService(database, fixture.built)

      await expectRefusal(() => service.startProductionPlan(legacy.id), database, 'calculation_context_changed')
      expect(await currentPlan(database, legacy)).toEqual(legacy)

      await database.productionPlans.put({ ...legacy, status: 'active' })
      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: legacy.id, planStepId: legacy.currentStepId as PlanStep['id'] }),
        database,
        'calculation_context_changed',
      )
      await expectRefusal(
        () => service.recordExecutionSavePoint({ planId: legacy.id }),
        database,
        'calculation_context_changed',
      )
    }))
})
