import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import type { BuildListEntryReplacement } from '../../domain/buildList'
import {
  ExecutionRuntimeError,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
} from '../../domain/execution'
import type {
  BuildListEntry,
  ExecutionSavePoint,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createProductionPlan,
  type PlannerInput,
  type PlannerOrchestrationResult,
} from '../../domain/planner'
import { productionPlanId } from '../../test/fixtures/domainData'
import { IDEAL_SERIES_SKILL_ID } from '../../test/fixtures/constrainedEnumeration'
import { resetRoute } from '../../test/fixtures/plannerBeam'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  newNormalFixture,
  seed,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import {
  orchestrationEntry,
  orchestrationSource,
  synchronizeOrchestrationEntry,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { PlannerResultPersistenceService } from './plannerResultPersistenceService'

/**
 * A Planner result save that breaks the `active` Plan, with the 16.10 save
 * point choice (`docs/PLANNER_SPEC.md` 9.2.18 / 16.10): 「現在地点を維持」 saves
 * the result and abandons the Plan, 「最後のゲーム内セーブ地点へ戻す」 restores the
 * save point and drops the result - it was calculated before the restore - and
 * 「キャンセル」 never calls the save.
 */

const SAVE_NOW = '2026-09-24T12:00:00.000Z'
const GENERATED_ENTRY_ID = 'build-list.generated.replacement'
const GENERATED_SOURCE_ID = 'owned.replacement.source'
const OLD_DRAFT_ID = 'plan.replacement.old-draft'

interface Scenario {
  database: AppDatabase
  fixture: ExecutionFixture
  service: PlannerResultPersistenceService
  execution: ReturnType<typeof executionService>
  savePoint: ExecutionSavePoint
  firstHistoryId: string
  replaced: BuildListEntry
  generated: BuildListEntry
  newDraftId: string
  result: PlannerOrchestrationResult
  context: PlannerInput['calculationContext']
}

/** The Planner input the current persisted state gives, as a Worker would receive it. */
async function currentInput(database: AppDatabase, fixture: ExecutionFixture): Promise<PlannerInput> {
  return {
    ...structuredClone(fixture.built.input),
    rngState: (await database.rngState.get('current')) as RngState,
    normalCounters: await database.normalArtianCounters.toArray(),
    ownedWeapons: await database.ownedWeapons.toArray(),
    targetWeapons: await database.targetWeapons.toArray(),
    buildListEntries: await database.buildListEntries.toArray(),
    conflictResolutions: [],
  }
}

/**
 * A running new-Normal Plan with a save point and one confirmed Step after it
 * (so the 16.10 choice is asked), a previous Draft beside it, and a Planner
 * result whose generated Entry replaces the Entry the running Plan depends on.
 */
async function scenario(database: AppDatabase): Promise<Scenario> {
  const fixture = await newNormalFixture(3)
  await seed(database, fixture)
  const execution = executionService(database, fixture.built)
  await execution.startProductionPlan(fixture.plan.id)
  const first = await confirmCurrent(execution, database, fixture.plan)
  const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
  await confirmCurrent(execution, database, fixture.plan)
  await database.productionPlans.put({ ...structuredClone(fixture.plan), id: productionPlanId(OLD_DRAFT_ID), status: 'draft' })

  // The alternate Route a constrained re-search found for the running Plan's
  // Target: one Reset on another weapon that already holds the Ideal Skill.
  await database.ownedWeapons.put(orchestrationSource(GENERATED_SOURCE_ID, { seriesSkillId: IDEAL_SERIES_SKILL_ID }))
  const input = await currentInput(database, fixture)
  const replaced = input.buildListEntries.find(({ id }) => id === fixture.plan.selectedBuildListEntryIds[0]) as BuildListEntry
  const goal = input.targetWeapons.find(({ id }) => id === replaced.targetWeaponId) as TargetWeapon
  const generated = orchestrationEntry(GENERATED_ENTRY_ID, goal, resetRoute(GENERATED_SOURCE_ID))
  synchronizeOrchestrationEntry(input, generated)
  // The real Planner over the replacement set, from the current state.
  const replacementInput: PlannerInput = {
    ...input,
    buildListEntries: [...input.buildListEntries.filter(({ id }) => id !== replaced.id), generated],
  }
  const planned = await createProductionPlan(replacementInput, fixture.built.dependencies)
  expect(planned.plan?.selectedBuildListEntryIds).toEqual([GENERATED_ENTRY_ID])
  const replacement: BuildListEntryReplacement = {
    targetWeaponId: replaced.targetWeaponId,
    replacedBuildListEntryId: replaced.id,
    generatedBuildListEntryId: generated.id,
  }
  const result: PlannerOrchestrationResult = {
    ...planned,
    generatedBuildListEntries: [generated],
    generatedBuildListEntryReplacements: [replacement],
  }
  return {
    database,
    fixture,
    service: new PlannerResultPersistenceService(database, undefined, { clock: { now: () => SAVE_NOW } }),
    execution,
    savePoint,
    firstHistoryId: first.history.id,
    replaced,
    generated,
    newDraftId: (planned.plan as ProductionPlan).id,
    result,
    context: structuredClone(fixture.built.input.calculationContext),
  }
}

function approvalOf(
  inspection: PlanBreakingChangeInspection,
  decision: 'keep_current' | 'restore_save_point',
): PlanBreakingChangeApproval {
  if (!inspection.approvalRequired || !inspection.savePointChoiceRequired) {
    throw new Error('The save was expected to need the approval with the save point choice.')
  }
  return {
    observedPlan: inspection.observedPlan,
    savePointDecision: { kind: decision, recordedAt: inspection.savePointRecordedAt },
  }
}

async function entryIds(database: AppDatabase): Promise<string[]> {
  return (await database.buildListEntries.toArray()).map(({ id }) => id).sort()
}

async function planIds(database: AppDatabase): Promise<string[]> {
  return (await database.productionPlans.toArray()).map(({ id }) => id).sort()
}

describe('Planner result save with the 16.10 save point choice (PLANNER_SPEC 9.2.18 / 16.10)', () => {
  it('asks for the approval and the save point choice, writing nothing', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const before = await dump(database)

      const inspection = await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)

      expect(inspection).toMatchObject({
        approvalRequired: true,
        reasons: ['build_list_changed'],
        observedPlan: { planId: s.fixture.plan.id, status: 'active' },
        savePointChoiceRequired: true,
        savePointRecordedAt: s.savePoint.recordedAt,
        savePointLastExecutionHistoryId: s.firstHistoryId,
      })
      expect(await dump(database)).toEqual(before)
    }))

  it('「現在地点を維持」: replaces O with G, replaces the Draft and abandons the Plan in one transaction', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const inspection = await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)

      const outcome = await s.service.savePlannerOrchestrationResult(
        s.result,
        s.context,
        approvalOf(inspection, 'keep_current'),
      )

      expect(outcome).toMatchObject({ kind: 'saved', plan: { id: s.newDraftId, status: 'draft' } })
      const ids = await entryIds(database)
      expect(ids).toContain(GENERATED_ENTRY_ID)
      expect(ids).not.toContain(s.replaced.id)
      expect(await planIds(database)).toEqual([s.newDraftId, s.fixture.plan.id].sort())
      expect(await currentPlan(database, s.fixture.plan)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'breaking_change_approved',
      })
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('「最後のゲーム内セーブ地点へ戻す」: restores exactly as the restore authority does and saves nothing of the result', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const inspection = await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)

      const outcome = await s.service.savePlannerOrchestrationResult(
        s.result,
        s.context,
        approvalOf(inspection, 'restore_save_point'),
      )

      // A typed, successful outcome - never planner_state_changed.
      expect(outcome).toEqual({
        kind: 'save_point_restored_recalculation_required',
        restoredPlan: s.savePoint.productionPlan,
        savePoint: s.savePoint,
        deletedExecutionHistoryIds: expect.any(Array) as unknown,
      })
      if (outcome.kind !== 'save_point_restored_recalculation_required') return
      expect(outcome.deletedExecutionHistoryIds).toHaveLength(1)

      // Nothing of the pre-restore result: O kept, no G, the old Draft kept,
      // no new Draft, and the Plan not abandoned.
      const ids = await entryIds(database)
      expect(ids).toContain(s.replaced.id)
      expect(ids).not.toContain(GENERATED_ENTRY_ID)
      expect(await planIds(database)).toEqual([OLD_DRAFT_ID, s.fixture.plan.id].sort())
      expect(await currentPlan(database, s.fixture.plan)).toEqual(s.savePoint.productionPlan)
      expect((await currentPlan(database, s.fixture.plan)).status).toBe('active')
      expect(await database.rngState.get('current')).toEqual(s.savePoint.rngState)
      expect(await database.normalArtianCounters.toArray()).toEqual(s.savePoint.normalCounters)
      expect((await database.executionHistory.toArray()).map(({ id }) => id)).toEqual([s.firstHistoryId])
      expect(await database.executionSavePoints.toArray()).toEqual([s.savePoint])

      // The persisted state is exactly what the ordinary save point restore
      // authority leaves from the same starting state.
      const restoredByPlanner = await dump(database)
      await withDatabase(async (reference) => {
        const r = await scenario(reference)
        await r.execution.restoreExecutionSavePoint({ planId: r.fixture.plan.id, recordedAt: r.savePoint.recordedAt })
        expect(await dump(reference)).toEqual(restoredByPlanner)
      })
    }))

  it('「キャンセル」: the save is never called and nothing changes', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const before = await dump(database)
      await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)
      // Cancelling ends the pending change without any further call.
      expect(await dump(database)).toEqual(before)
      expect(await entryIds(database)).toContain(s.replaced.id)
    }))

  it('refuses a stale approval without restoring or saving anything', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const inspection = await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)
      // The running Plan moved on after the warning was shown.
      const moved = { ...(await currentPlan(database, s.fixture.plan)), updatedAt: '2026-09-24T11:00:00.000Z' }
      await database.productionPlans.put(moved)
      const before = await dump(database)

      for (const decision of ['restore_save_point', 'keep_current'] as const) {
        await expect(s.service.savePlannerOrchestrationResult(s.result, s.context, approvalOf(inspection, decision)))
          .rejects.toMatchObject({ code: 'plan_breaking_change_state_changed' })
        expect(await dump(database)).toEqual(before)
      }
    }))

  it('refuses a restore naming a save point other than the stored one', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const inspection = await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)
      const approval = approvalOf(inspection, 'restore_save_point')
      const before = await dump(database)

      const error = await s.service.savePlannerOrchestrationResult(s.result, s.context, {
        ...approval,
        savePointDecision: { kind: 'restore_save_point', recordedAt: '2026-01-01T00:00:00.000Z' },
      }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ExecutionRuntimeError)
      expect(error).toMatchObject({ code: 'save_point_changed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('rolls the whole restore back when a restore write fails', () =>
    withDatabase(async (database) => {
      const s = await scenario(database)
      const inspection = await s.service.inspectPlannerOrchestrationResultSave(s.result, s.context)
      const before = await dump(database)
      // The history deletion is the restore's last write; RNG, Counters,
      // weapons and the Plan were already written in the same transaction.
      database.executionHistory.hook('deleting', () => {
        throw new Error('storage failure')
      })

      const error = await s.service.savePlannerOrchestrationResult(
        s.result,
        s.context,
        approvalOf(inspection, 'restore_save_point'),
      ).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(RepositoryError)
      expect(error).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))
})
