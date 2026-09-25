import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { ExecutionRuntimeError, listCurrentCompromiseCheckpoints } from '../../domain/execution'
import type {
  BuildListEntryId,
  ExecutionHistory,
  ExecutionHistoryId,
  OwnedWeaponId,
  PlanStep,
  ProductionPlan,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  executionSavePointIdForPlan,
  validateExecutionHistory,
  validateProductionPlan,
} from '../../domain/models/publicTypes'
import { DATABASE_SCHEMA_VERSION } from '../../db/AppDatabase'
import { EXPORT_SCHEMA_VERSION } from '../../domain/models/exportModel'
import { IDEAL_SERIES_SKILL_ID, gogmaWeapon, practicalBonuses } from '../../test/fixtures/constrainedEnumeration'
import {
  OTHER_WEAPON_ID,
  checkpointFixture,
  compromiseLabelStepIndex,
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  expectRefusal,
  finishAsCompromise,
  otherWeaponCheckpointFixture,
  seed,
  startReachedCheckpointFixture,
  withDatabase,
  type CheckpointFixture,
} from '../../test/fixtures/executionRuntime'
import type { ProductionPlanExecutionService } from './productionPlanExecutionService'

/**
 * The `finished_as_compromise` Execution runtime (`docs/PLANNER_SPEC.md` 16.12),
 * over the real Dexie database and Plans produced by the real Planner.
 */

/** Starts the Plan and confirms every Step up to and including the label Step. */
async function reachCheckpoint(
  service: ProductionPlanExecutionService,
  database: AppDatabase,
  fixture: CheckpointFixture,
): Promise<void> {
  await service.startProductionPlan(fixture.plan.id)
  const labelled = compromiseLabelStepIndex(fixture.plan)
  expect(labelled).toBeGreaterThanOrEqual(0)
  for (let index = 0; index <= labelled; index += 1) {
    await confirmCurrent(service, database, fixture.plan)
  }
}

describe('finish as a compromise', () => {
  it('confirms the reached checkpoint weapon and abandons the Plan', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const stopped = await currentPlan(database, fixture.plan)
      expect(stopped.status).toBe('active')
      expect(await database.ownedWeapons.get(fixture.source.id)).toMatchObject({
        status: 'practical',
        executionInProgress: { productionPlanId: fixture.plan.id },
      })
      const before = await dump(database)

      const { plan, history } = await finishAsCompromise(service, database, fixture)

      // The weapon: Practical, no longer in progress, and otherwise untouched.
      const weapon = await database.ownedWeapons.get(fixture.source.id)
      const weaponBefore = before.ownedWeapons.find(({ id }) => id === fixture.source.id)
      expect(weapon).toEqual({ ...weaponBefore, executionInProgress: null, updatedAt: history.createdAt })
      expect(weapon).toMatchObject({ status: 'practical', isProtected: false })

      // The Target: untouched, still active, still preferring the weapon.
      expect(await database.targetWeapons.get(fixture.goal.id)).toEqual(
        before.targetWeapons.find(({ id }) => id === fixture.goal.id),
      )
      expect(await database.targetWeapons.get(fixture.goal.id)).toMatchObject({
        lifecycleStatus: 'active',
        completedAt: null,
        completedByProductionPlanId: null,
        preferredOwnedWeaponId: fixture.source.id,
      })

      // The Plan: abandoned exactly where it stopped.
      expect(plan).toEqual({
        ...stopped,
        status: 'abandoned',
        abandonmentReason: 'finished_as_compromise',
        abandonedAt: history.createdAt,
        completedAt: null,
        updatedAt: history.createdAt,
      })
      expect(plan.currentStepId).toBe(stopped.currentStepId)
      expect(plan.steps.filter(({ isCompleted }) => isCompleted).map(({ id }) => id)).toEqual(
        stopped.steps.filter(({ isCompleted }) => isCompleted).map(({ id }) => id),
      )
      expect(validateProductionPlan(plan).issues).toEqual([])
      expect(await currentPlan(database, fixture.plan)).toEqual(plan)

      // The record, and nothing else.
      const after = await dump(database)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(after.buildListEntries).toEqual(before.buildListEntries)
      expect(after.executionHistory.at(-1)).toEqual(history)
      expect(after.executionHistory).toHaveLength(before.executionHistory.length + 1)
      expect(history).toMatchObject({
        planId: fixture.plan.id,
        planStepId: stopped.currentStepId,
        action: 'finished_as_compromise',
        actualResult: null,
        wasExpected: true,
        recalculationReason: null,
      })
      expect(validateExecutionHistory(history).issues).toEqual([])
    }))

  it('clears the in-progress state of every weapon of the Plan only', () =>
    withDatabase(async (database) => {
      const spare = gogmaWeapon('owned.execution.extra')
      const foreign = gogmaWeapon('owned.execution.foreign')
      const fixture = await checkpointFixture([spare, foreign])
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      // A second weapon the same Plan is producing, plus one another Plan is.
      // `executionInProgress` is non-semantic, so neither moves an expected hash.
      const extra = { ...spare, executionInProgress: { productionPlanId: fixture.plan.id, startedAt: '2026-09-16T00:00:00.000Z' } }
      const otherPlan = { ...foreign, executionInProgress: { productionPlanId: 'plan.execution.other' as ProductionPlan['id'], startedAt: '2026-09-16T00:00:00.000Z' } }
      await database.ownedWeapons.bulkPut([extra, otherPlan])

      const { history } = await finishAsCompromise(service, database, fixture)

      expect(await database.ownedWeapons.get(extra.id)).toEqual({ ...extra, executionInProgress: null, updatedAt: history.createdAt })
      expect(await database.ownedWeapons.get(foreign.id)).toEqual(otherPlan)
      const inProgress = (await database.ownedWeapons.toArray()).filter(
        ({ executionInProgress }) => executionInProgress?.productionPlanId === fixture.plan.id,
      )
      expect(inProgress).toEqual([])
      // Both cleared weapons, and no duplicate, are in the Undo snapshot.
      expect(history.undoSnapshot.affectedOwnedWeaponsBefore.map(({ id }) => id).sort()).toEqual(
        [extra.id, fixture.source.id].sort(),
      )
      expect(history.undoSnapshot.affectedTargetWeaponsBefore).toEqual([])
      expect(history.undoSnapshot.addedOwnedWeaponIds).toEqual([])
      expect(history.undoSnapshot.removedOwnedWeaponsBefore).toEqual([])
    }))

  it('deletes the game save point and keeps it in the Undo snapshot', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      expect(await database.executionSavePoints.get(executionSavePointIdForPlan(fixture.plan.id))).toEqual(savePoint)

      const { history } = await finishAsCompromise(service, database, fixture)

      expect(await database.executionSavePoints.toArray()).toEqual([])
      expect(history.undoSnapshot.executionSavePointBefore).toEqual(savePoint)
    }))

  it('finishes without a game save point', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)

      const { plan, history } = await finishAsCompromise(service, database, fixture)

      expect(plan.abandonmentReason).toBe('finished_as_compromise')
      expect(history.undoSnapshot.executionSavePointBefore).toBeNull()
      expect(await database.executionSavePoints.toArray()).toEqual([])
    }))

  it('finishes a checkpoint held at Plan start before the first physical Step', () =>
    withDatabase(async (database) => {
      const fixture = await startReachedCheckpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      // The label rides on the Entry's first physical Step, which has not run.
      expect(compromiseLabelStepIndex(fixture.plan)).toBe(0)
      const before = await dump(database)
      expect(before.ownedWeapons.find(({ id }) => id === fixture.source.id)).toMatchObject({
        status: 'unclassified',
        executionInProgress: null,
      })

      const { plan, history } = await finishAsCompromise(service, database, fixture)

      const after = await dump(database)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(plan.steps.some(({ isCompleted }) => isCompleted)).toBe(false)
      expect(plan.currentStepId).toBe(fixture.plan.currentStepId)
      expect(plan).toMatchObject({ status: 'abandoned', abandonmentReason: 'finished_as_compromise' })
      expect(await database.ownedWeapons.get(fixture.source.id)).toEqual({
        ...before.ownedWeapons.find(({ id }) => id === fixture.source.id),
        status: 'practical',
        updatedAt: history.createdAt,
      })
      expect(after.targetWeapons).toEqual(before.targetWeapons)
      expect(history.action).toBe('finished_as_compromise')
    }))

  it('is undone back to the active Plan, the save point and the weapon state', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)

      const { history } = await finishAsCompromise(service, database, fixture)
      const undone = await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id })

      expect(undone.undoneExecutionHistoryId).toBe(history.id)
      expect(undone.plan.status).toBe('active')
      expect(await dump(database)).toEqual(before)
    }))

  it('stays undoable only as the finish that abandoned the Plan', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const { plan, history } = await finishAsCompromise(service, database, fixture)

      // The same record under another abandonment reason is never undone.
      for (const abandonmentReason of ['user_abandoned', 'replan_adopted', 'breaking_change_approved'] as const) {
        await database.productionPlans.put({ ...plan, abandonmentReason })
        await expectRefusal(
          () => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id }),
          database,
          'undo_not_allowed',
        )
      }
      // Nor is it undone when the Plan was abandoned at another moment.
      await database.productionPlans.put({ ...plan, abandonedAt: '2026-09-17T09:00:00.000Z' })
      await expectRefusal(
        () => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id }),
        database,
        'undo_not_allowed',
      )

      await database.productionPlans.put(plan)
      expect((await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id })).plan.status).toBe('active')
    }))

  it('refuses to finish an unselected checkpoint the weapon reaches by performance', () =>
    withDatabase(async (database) => {
      // The same Route reaching the same compromise state, selected by nobody.
      const fixture = await checkpointFixture([], { select: false })
      expect(compromiseLabelStepIndex(fixture.plan)).toBe(-1)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)

      // The weapon now holds the compromise five slots, and stays unclassified.
      expect(await database.ownedWeapons.get(fixture.source.id)).toMatchObject({
        restorationBonuses: practicalBonuses(),
        status: 'unclassified',
      })
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'compromise_finish_not_applicable',
      )
    }))

  it('refuses a selected checkpoint that is not reached yet', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      // The Route produces the selected state, so the label Step must run first.
      const labelled = compromiseLabelStepIndex(fixture.plan)
      expect(labelled).toBeGreaterThanOrEqual(0)
      expect((await currentPlan(database, fixture.plan)).steps[labelled].isCompleted).toBe(false)
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'compromise_checkpoint_not_current',
      )
    }))

  it('refuses a checkpoint the next operation on the same weapon left behind', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      // 「次の操作へ進む」: the next Step operates on the very same weapon.
      const next = await confirmCurrent(service, database, fixture.plan)
      const labelled = compromiseLabelStepIndex(fixture.plan)
      const confirmed = next.plan.steps.filter(({ isCompleted }) => isCompleted)
      expect(confirmed).toHaveLength(labelled + 2)
      expect(confirmed.at(-1)?.executionEffects?.trackedOwnedWeaponId).toBe(fixture.source.id)

      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'compromise_checkpoint_not_current',
      )
    }))

  it('refuses a start-held checkpoint the Entry first physical Step left behind', () =>
    withDatabase(async (database) => {
      const fixture = await startReachedCheckpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      expect(compromiseLabelStepIndex(fixture.plan)).toBe(0)
      // The Entry's first physical Step is the one that labels it.
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(fixture.source.id)).toMatchObject({ status: 'practical' })

      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'compromise_checkpoint_not_current',
      )
    }))

  it('keeps a checkpoint another weapon Step advanced past', () =>
    withDatabase(async (database) => {
      const fixture = await otherWeaponCheckpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      // The Plan runs the other Entry's weapon first; this Entry's start-held
      // checkpoint is labelled by its own, still unconfirmed, first Step.
      const labelled = compromiseLabelStepIndex(fixture.plan)
      expect(labelled).toBeGreaterThan(0)
      expect(fixture.plan.steps[0].executionEffects?.trackedOwnedWeaponId).toBe(OTHER_WEAPON_ID)

      const advanced = await confirmCurrent(service, database, fixture.plan)
      // The Plan's current Step moved on, and the checkpoint weapon is untouched.
      expect(advanced.plan.currentStepId).not.toBe(fixture.plan.currentStepId)
      expect(await database.ownedWeapons.get(fixture.source.id)).toEqual(
        fixture.built.input.ownedWeapons.find(({ id }) => id === fixture.source.id),
      )

      const { plan, history } = await finishAsCompromise(service, database, fixture)

      expect(plan).toMatchObject({ status: 'abandoned', abandonmentReason: 'finished_as_compromise' })
      expect(history.planStepId).toBe(advanced.plan.currentStepId)
      expect(await database.ownedWeapons.get(fixture.source.id)).toMatchObject({ status: 'practical' })
    }))

  it('refuses a stale Plan whose checkpoint was already reached', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const stored = await currentPlan(database, fixture.plan)
      await service.recordOperationUncertain({
        planId: fixture.plan.id,
        planStepId: stored.currentStepId as PlanStep['id'],
      })
      expect(await currentPlan(database, fixture.plan)).toMatchObject({
        status: 'stale',
        recalculationReasons: ['execution_operation_uncertain'],
      })

      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'plan_not_active',
      )
    }))

  it.each([
    ['a foreign BuildListEntry', { buildListEntryId: 'entry.execution.foreign' as BuildListEntryId }],
    ['a foreign Target', { targetWeaponId: 'target.execution.foreign' as TargetWeaponId }],
    ['a foreign weapon', { ownedWeaponId: 'owned.execution.foreign' as OwnedWeaponId }],
  ])('refuses %s in the request', (_label, overrides) =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture, overrides),
        database,
        'compromise_finish_not_applicable',
      )
    }))

  it('refuses a Step the user no longer sees', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const stale = compromiseLabelStepIndex(fixture.plan)
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture, { planStepId: fixture.plan.steps[stale].id }),
        database,
        'step_not_current',
      )
    }))

  it('refuses every Execution Step of the finished Plan', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const next = (await currentPlan(database, fixture.plan)).currentStepId as PlanStep['id']
      await finishAsCompromise(service, database, fixture)

      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: fixture.plan.id, planStepId: next }),
        database,
        'plan_not_active',
      )
      await expectRefusal(() => finishAsCompromise(service, database, fixture), database, 'plan_not_active')
      await expectRefusal(
        () => service.recordExecutionSavePoint({ planId: fixture.plan.id }),
        database,
        'save_point_record_not_allowed',
      )
    }))

  it('rolls back everything when the ExecutionHistory ID already exists', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const latest = (await database.executionHistory.toArray()).at(-1) as ExecutionHistory
      // The next generated ID collides with an existing record of the Plan.
      const colliding = executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => latest.id },
      })
      const before = await dump(database)

      await expect(finishAsCompromise(colliding, database, fixture)).rejects.toBeInstanceOf(RepositoryError)

      expect(await dump(database)).toEqual(before)
    }))

  it('rolls back everything when a write fails', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)
      const failing = executionService(database, fixture.built, {
        database: new Proxy(database, {
          get(target, property, receiver) {
            if (property === 'executionHistory') {
              return { add: () => Promise.reject(new Error('storage failure')) }
            }
            return Reflect.get(target, property, receiver)
          },
        }) as AppDatabase,
      })

      await expect(finishAsCompromise(failing, database, fixture)).rejects.toBeInstanceOf(RepositoryError)

      expect(await dump(database)).toEqual(before)
    }))

  it('refuses a Plan that is not an executable current Plan', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await reachCheckpoint(service, database, fixture)
      const stored = await currentPlan(database, fixture.plan)
      await database.productionPlans.put({
        ...stored,
        calculationContext: { ...stored.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION - 1 },
      })
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'calculation_context_changed',
      )
    }))

  it('keeps every schema version authority unchanged', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(14)
    expect(DATABASE_SCHEMA_VERSION).toBe(9)
    expect(EXPORT_SCHEMA_VERSION).toBe(12)
  })

  it('reports an unknown Plan and an unknown history ID as runtime refusals', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await expect(
        service.finishProductionPlanAsCompromise({
          planId: 'plan.execution.missing' as ProductionPlan['id'],
          planStepId: fixture.plan.steps[0].id,
          buildListEntryId: fixture.entry.id,
          targetWeaponId: fixture.goal.id,
          ownedWeaponId: fixture.source.id,
        }),
      ).rejects.toBeInstanceOf(ExecutionRuntimeError)
      await expect(
        service.undoLatestExecution({
          planId: fixture.plan.id,
          executionHistoryId: 'history.execution.missing' as ExecutionHistoryId,
        }),
      ).rejects.toMatchObject({ code: 'undo_history_not_found' })
    }))

  it('keeps the Ideal Series Skill fixture assumption', async () => {
    const fixture = await checkpointFixture()
    expect(fixture.source.seriesSkillId).toBe(IDEAL_SERIES_SKILL_ID)
    expect(fixture.entry.intermediateStateSelection?.bonusOpportunityId).not.toBeNull()
  })
})

/**
 * `listCurrentCompromiseCheckpoints()` is what the Execution Navigator offers
 * "finish as compromise" from. It must list a checkpoint exactly when the
 * runtime accepts the finish, through the same still-current authority.
 */
describe('listCurrentCompromiseCheckpoints', () => {
  async function listed(database: AppDatabase, fixture: CheckpointFixture) {
    return listCurrentCompromiseCheckpoints(
      await currentPlan(database, fixture.plan),
      await database.buildListEntries.toArray(),
    )
  }

  it('lists a reached checkpoint only until the same weapon is operated on again', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      // Not reached yet: nothing listed, and the runtime refuses.
      expect(await listed(database, fixture)).toEqual([])
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'compromise_checkpoint_not_current',
      )

      const labelled = compromiseLabelStepIndex(fixture.plan)
      for (let index = 0; index <= labelled; index += 1) {
        await confirmCurrent(service, database, fixture.plan)
      }
      expect(await listed(database, fixture)).toEqual([{
        buildListEntryId: fixture.entry.id,
        targetWeaponId: fixture.goal.id,
        ownedWeaponId: fixture.source.id,
        labelPlanStepId: fixture.plan.steps[labelled].id,
        heldBeforeLabelStep: false,
      }])

      // 「次の操作へ進む」 and the next Step on the same weapon: left behind.
      await confirmCurrent(service, database, fixture.plan)
      expect(await listed(database, fixture)).toEqual([])
      await expectRefusal(
        () => finishAsCompromise(service, database, fixture),
        database,
        'compromise_checkpoint_not_current',
      )
    }))

  it('lists a start-held checkpoint before its first physical Step only', () =>
    withDatabase(async (database) => {
      const fixture = await startReachedCheckpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      expect(await listed(database, fixture)).toEqual([expect.objectContaining({
        buildListEntryId: fixture.entry.id,
        ownedWeaponId: fixture.source.id,
        heldBeforeLabelStep: true,
      })])

      await confirmCurrent(service, database, fixture.plan)
      expect(await listed(database, fixture)).toEqual([])
    }))

  it('keeps a checkpoint while only another weapon advances, and the runtime finishes it', () =>
    withDatabase(async (database) => {
      const fixture = await otherWeaponCheckpointFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)

      const [checkpoint] = await listed(database, fixture)
      expect(checkpoint).toMatchObject({ ownedWeaponId: fixture.source.id, heldBeforeLabelStep: true })
      const stored = await currentPlan(database, fixture.plan)
      const { plan } = await service.finishProductionPlanAsCompromise({
        planId: stored.id,
        planStepId: stored.currentStepId as PlanStep['id'],
        buildListEntryId: checkpoint.buildListEntryId,
        targetWeaponId: checkpoint.targetWeaponId,
        ownedWeaponId: checkpoint.ownedWeaponId,
      })
      expect(plan).toMatchObject({ status: 'abandoned', abandonmentReason: 'finished_as_compromise' })
    }))

  it('lists nothing for an unselected state reached by performance', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture([], { select: false })
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      expect(await listed(database, fixture)).toEqual([])
    }))
})
