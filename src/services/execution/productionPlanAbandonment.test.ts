import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION, type AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import {
  ExecutionRuntimeError,
  deriveRunningPlanSavePointChoiceRequirement,
  type PlanAbandonSavePointDecision,
} from '../../domain/execution'
import { EXPORT_SCHEMA_VERSION } from '../../domain/models/exportModel'
import type {
  BuildListEntry,
  BuildListEntryId,
  ExecutionHistoryId,
  ExecutionSavePoint,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  createDefaultAppSettings,
  validateProductionPlan,
} from '../../domain/models/publicTypes'
import { normalWeapon } from '../../test/fixtures/constrainedEnumeration'
import {
  bonusResult,
  confirmCurrent,
  currentPlan,
  differentBonuses,
  dump,
  executionService,
  existingGogmaFixture,
  existingResetFixture,
  expectRefusal,
  newNormalFixture,
  recordDifferent,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
  type PersistedDump,
} from '../../test/fixtures/executionRuntime'
import { orchestrationTarget } from '../../test/fixtures/plannerConstrainedOrchestration'
import type { ProductionPlanExecutionService } from './productionPlanExecutionService'

async function started(database: AppDatabase, fixture: ExecutionFixture, service = executionService(database, fixture.built)) {
  await seed(database, fixture)
  await service.startProductionPlan(fixture.plan.id)
  return service
}

async function observed(database: AppDatabase, plan: ProductionPlan) {
  const stored = await currentPlan(database, plan)
  return { status: stored.status, currentStepId: stored.currentStepId, updatedAt: stored.updatedAt }
}

async function abandon(
  service: ProductionPlanExecutionService,
  database: AppDatabase,
  plan: ProductionPlan,
  savePointDecision: PlanAbandonSavePointDecision = null,
) {
  return service.abandonProductionPlan({ planId: plan.id, observedPlan: await observed(database, plan), savePointDecision })
}

function keepCurrent(savePoint: Pick<ExecutionSavePoint, 'recordedAt'>): PlanAbandonSavePointDecision {
  return { kind: 'keep_current', recordedAt: savePoint.recordedAt }
}

function restoreSavePoint(savePoint: Pick<ExecutionSavePoint, 'recordedAt'>): PlanAbandonSavePointDecision {
  return { kind: 'restore_save_point', recordedAt: savePoint.recordedAt }
}

function inspect(service: ProductionPlanExecutionService, plan: ProductionPlan) {
  return service.inspectProductionPlanAbandonment({ planId: plan.id })
}

function inProgress(weapon: OwnedWeapon, planId: string): OwnedWeapon {
  return { ...weapon, executionInProgress: { productionPlanId: planId as ProductionPlan['id'], startedAt: '2026-09-17T00:00:00.000Z' } }
}

function abandonedFrom(base: ProductionPlan, now: string): ProductionPlan {
  return { ...base, status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: now, completedAt: null, updatedAt: now }
}

/** The dump with only the abandoned Plan and the save point replaced. */
function expectedDump(before: PersistedDump, plan: ProductionPlan, ownedWeapons = before.ownedWeapons): PersistedDump {
  return {
    ...before,
    ownedWeapons,
    productionPlans: before.productionPlans.map((stored) => (stored.id === plan.id ? plan : stored)),
    executionSavePoints: before.executionSavePoints.filter(({ productionPlanId }) => productionPlanId !== plan.id),
  }
}

describe('Plan abandonment save point choice', () => {
  it('asks nothing without a save point', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)

      expect(await inspect(service, fixture.plan)).toEqual({
        planId: plan.id,
        planStatus: 'active',
        planCurrentStepId: plan.currentStepId,
        planUpdatedAt: plan.updatedAt,
        savePointChoiceRequired: false,
      })
    }))

  it('asks nothing when the save point is the current position', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })

      expect(await inspect(service, fixture.plan)).toMatchObject({ savePointChoiceRequired: false })
    }))

  it('asks when a record follows the save point, naming the save point the user sees', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)

      expect(await inspect(service, fixture.plan)).toEqual({
        planId: plan.id,
        planStatus: 'active',
        planCurrentStepId: plan.currentStepId,
        planUpdatedAt: plan.updatedAt,
        savePointChoiceRequired: true,
        savePointRecordedAt: savePoint.recordedAt,
        savePointLastExecutionHistoryId: first.history.id,
        savePointCurrentStepId: stepOf(fixture.plan, 1).id,
      })
    }))

  it('asks when the save point was recorded before any record and a record exists now', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      expect(savePoint.lastExecutionHistoryId).toBeNull()
      await confirmCurrent(service, database, fixture.plan)

      expect(await inspect(service, fixture.plan)).toMatchObject({
        savePointChoiceRequired: true,
        savePointLastExecutionHistoryId: null,
      })
    }))

  it('orders records sharing createdAt by ID, never by insertion', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      // The second record sorts before the boundary although it was added later.
      const historyIds = ['history.same-time.b', 'history.same-time.a', 'history.same-time.c']
      const service = await started(database, fixture, executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => historyIds.shift() as ExecutionHistoryId },
        clock: { now: () => '2026-09-17T02:00:00.000Z' },
      }))
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      expect(savePoint.lastExecutionHistoryId).toBe('history.same-time.b')
      await confirmCurrent(service, database, fixture.plan)

      expect(await inspect(service, fixture.plan)).toMatchObject({ savePointChoiceRequired: false })
      const history = await database.executionHistory.toArray()
      expect(deriveRunningPlanSavePointChoiceRequirement(fixture.plan, savePoint, [...history].reverse()).required).toBe(false)

      await confirmCurrent(service, database, fixture.plan)
      const choice = deriveRunningPlanSavePointChoiceRequirement(fixture.plan, savePoint, await database.executionHistory.toArray())
      expect(choice.required).toBe(true)
      expect(choice.required && choice.historyAfterSavePoint.map(({ id }) => id)).toEqual(['history.same-time.c'])
    }))

  it('refuses a missing or foreign boundary instead of guessing', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      await database.executionHistory.delete(first.history.id)

      await expect(inspect(service, fixture.plan)).rejects.toMatchObject({ code: 'save_point_snapshot_invalid' })
      await expectRefusal(() => abandon(service, database, fixture.plan), database, 'save_point_snapshot_invalid')

      const otherPlanId = 'plan.execution.other' as ProductionPlan['id']
      await database.productionPlans.put({ ...structuredClone(fixture.plan), id: otherPlanId })
      await database.executionHistory.put({ ...first.history, planId: otherPlanId })
      await expectRefusal(() => abandon(service, database, fixture.plan), database, 'save_point_snapshot_invalid')
    }))

  it('refuses a draft, completed or abandoned Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await expect(inspect(service, fixture.plan)).rejects.toMatchObject({ code: 'plan_abandon_not_allowed' })
      await expectRefusal(() => abandon(service, database, fixture.plan), database, 'plan_abandon_not_allowed')

      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
      await expectRefusal(() => abandon(service, database, fixture.plan), database, 'plan_abandon_not_allowed')

      const completed = await currentPlan(database, fixture.plan)
      await database.productionPlans.put({ ...completed, status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: completed.updatedAt, completedAt: null })
      await expectRefusal(() => abandon(service, database, fixture.plan), database, 'plan_abandon_not_allowed')
    }))
})

describe('Plan abandonment at the current state', () => {
  it('abandons an active Plan and keeps every other state, record and Target preference', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const registration = await confirmCurrent(service, database, fixture.plan)
      const tracked = registration.history.undoSnapshot.addedOwnedWeaponIds[0]
      const goal = fixture.built.input.targetWeapons[0]
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ preferredOwnedWeaponId: tracked })
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ executionInProgress: { productionPlanId: fixture.plan.id } })
      const before = await dump(database)
      const plan = await currentPlan(database, fixture.plan)

      const result = await abandon(service, database, fixture.plan)

      const now = result.plan.abandonedAt as string
      expect(result).toEqual({ plan: abandonedFrom(plan, now), savePointHandling: 'no_choice', deletedExecutionHistoryIds: [] })
      expect(result.plan.currentStepId).toBe(plan.currentStepId)
      expect(validateProductionPlan(result.plan).issues).toEqual([])
      const weapon = before.ownedWeapons.find(({ id }) => id === tracked) as OwnedWeapon
      expect(await dump(database)).toEqual(expectedDump(before, result.plan, [{ ...weapon, executionInProgress: null, updatedAt: now }]))
      expect(await database.executionHistory.count()).toBe(3)
    }))

  it('deletes a save point the Plan did not run past without asking', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)

      const result = await abandon(service, database, fixture.plan)

      expect(await dump(database)).toEqual(expectedDump(before, result.plan))
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('abandons a stale Plan and keeps its recalculation reasons and records', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const current = (await currentPlan(database, fixture.plan)).currentStepId as PlanStep['id']
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: current })
      const stale = await currentPlan(database, fixture.plan)
      expect(stale).toMatchObject({ status: 'stale', recalculationReasons: ['execution_operation_uncertain'] })
      const before = await dump(database)

      const result = await abandon(service, database, fixture.plan)

      expect(result.plan).toEqual(abandonedFrom(stale, result.plan.updatedAt))
      expect(result.plan.recalculationReasons).toEqual(['execution_operation_uncertain'])
      const after = await dump(database)
      expect(after.executionHistory).toEqual(before.executionHistory)
      expect(after.ownedWeapons.filter(({ executionInProgress }) => executionInProgress !== null)).toEqual([])
    }))

  it('abandons a stale Plan with an incompatible CalculationContext, but restores its save point only under the restore contract', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const active = await currentPlan(database, fixture.plan)
      const stale: ProductionPlan = { ...active, status: 'stale', recalculationReasons: ['calculation_context_changed'], updatedAt: '2026-09-17T01:00:00.000Z' }
      expect(validateProductionPlan(stale).issues).toEqual([])
      await database.productionPlans.put(stale)
      const incompatible = executionService(database, fixture.built, {
        currentCalculationContext: { ...fixture.built.input.calculationContext, rngEngineVersion: 'production-rng:other' },
      })

      await expectRefusal(() => abandon(incompatible, database, fixture.plan, restoreSavePoint(savePoint)), database, 'calculation_context_changed')

      const result = await abandon(incompatible, database, fixture.plan, keepCurrent(savePoint))
      expect(result.plan).toEqual(abandonedFrom(stale, result.plan.updatedAt))
      expect(result.plan.recalculationReasons).toEqual(['calculation_context_changed'])
      expect(result.savePointHandling).toBe('keep_current')
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('clears in-progress for every weapon of the Plan and none of another Plan', () =>
    withDatabase(async (database) => {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((suffix) => normalWeapon(`owned.execution.progress-${suffix}`))
      const fixture = await existingGogmaFixture([a, b, c, d])
      const service = await started(database, fixture)
      const otherPlanId = 'plan.execution.other'
      await database.ownedWeapons.bulkPut([
        inProgress(a, fixture.plan.id),
        inProgress(b, fixture.plan.id),
        inProgress(c, fixture.plan.id),
        inProgress(d, otherPlanId),
      ])
      const targetsBefore = await database.targetWeapons.toArray()

      const { plan } = await abandon(service, database, fixture.plan)

      for (const weapon of [a, b, c]) {
        expect(await database.ownedWeapons.get(weapon.id)).toEqual({ ...weapon, executionInProgress: null, updatedAt: plan.updatedAt })
      }
      expect(await database.ownedWeapons.get(d.id)).toEqual(inProgress(d, otherPlanId))
      expect(await database.targetWeapons.toArray()).toEqual(targetsBefore)
    }))

  it('leaves Plan-independent Targets, Entries, weapons and settings untouched', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const addedTarget = orchestrationTarget('target.execution.added-later')
      const addedEntry: BuildListEntry = {
        ...structuredClone(fixture.built.input.buildListEntries[0]),
        id: 'entry.execution.added-later' as BuildListEntryId,
        targetWeaponId: addedTarget.id,
      }
      const addedWeapon = normalWeapon('owned.execution.added-later')
      const settings = { ...createDefaultAppSettings('2026-09-17T07:00:00.000Z'), debugMode: true }
      await database.targetWeapons.put(addedTarget)
      await database.buildListEntries.put(addedEntry)
      await database.ownedWeapons.put(addedWeapon)
      await database.settings.put(settings)
      const savePoint = (await database.executionSavePoints.toArray())[0]

      await abandon(service, database, fixture.plan, keepCurrent(savePoint))

      expect(await database.targetWeapons.get(addedTarget.id)).toEqual(addedTarget)
      expect(await database.buildListEntries.get(addedEntry.id)).toEqual(addedEntry)
      expect(await database.ownedWeapons.get(addedWeapon.id)).toEqual(addedWeapon)
      expect(await database.settings.get('settings')).toEqual(settings)
    }))
})

describe('Plan abandonment decision checks', () => {
  it('refuses no decision when the Plan ran past its save point', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)

      await expectRefusal(() => abandon(service, database, fixture.plan), database, 'save_point_choice_required')
    }))

  it('refuses a decision where no choice applies, never restoring an unasked save point', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })

      await expectRefusal(() => abandon(service, database, fixture.plan, restoreSavePoint(savePoint)), database, 'save_point_choice_not_required')
      await expectRefusal(() => abandon(service, database, fixture.plan, keepCurrent(savePoint)), database, 'save_point_choice_not_required')
      await database.executionSavePoints.clear()
      await expectRefusal(() => abandon(service, database, fixture.plan, keepCurrent(savePoint)), database, 'save_point_choice_not_required')
    }))

  it('refuses a Plan that moved on after the user confirmed', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const seen = await observed(database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await expectRefusal(
        () => service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: seen, savePointDecision: null }),
        database,
        'plan_abandon_state_changed',
      )

      const current = await observed(database, fixture.plan)
      await expectRefusal(
        () => service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: { ...current, updatedAt: '2026-09-16T00:00:00.000Z' }, savePointDecision: null }),
        database,
        'plan_abandon_state_changed',
      )
      await expectRefusal(
        () => service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: { ...current, status: 'stale' }, savePointDecision: null }),
        database,
        'plan_abandon_state_changed',
      )
    }))

  it('refuses a Plan confirmed past the save point after the dialog offered no choice', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      expect(await inspect(service, fixture.plan)).toMatchObject({ savePointChoiceRequired: false })
      const seen = await observed(database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await expectRefusal(
        () => service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: seen, savePointDecision: null }),
        database,
        'plan_abandon_state_changed',
      )
    }))

  it('refuses a save point other than the one the user saw, for both choices', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const seen = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      // Recorded again elsewhere with the same boundary: the Plan itself is unchanged.
      await database.executionSavePoints.put({ ...seen, recordedAt: '2026-09-17T05:00:00.000Z' })

      await expectRefusal(() => abandon(service, database, fixture.plan, keepCurrent(seen)), database, 'save_point_changed')
      await expectRefusal(() => abandon(service, database, fixture.plan, restoreSavePoint(seen)), database, 'save_point_changed')
    }))
})

describe('Plan abandonment after restoring the save point', () => {
  it('restores the save point state, keeps earlier records and abandons the snapshot Plan', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)
      const later = [
        await confirmCurrent(service, database, fixture.plan),
        await confirmCurrent(service, database, fixture.plan),
      ]
      const registered = later[1].history.undoSnapshot.addedOwnedWeaponIds[0]
      expect(await database.ownedWeapons.get(registered)).toBeDefined()

      const result = await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      const expectedPlan = abandonedFrom(savePoint.productionPlan, result.plan.updatedAt)
      expect(result).toEqual({
        plan: expectedPlan,
        savePointHandling: 'restore_save_point',
        deletedExecutionHistoryIds: later.map(({ history }) => history.id),
      })
      expect(validateProductionPlan(result.plan).issues).toEqual([])
      expect(await database.ownedWeapons.get(registered)).toBeUndefined()
      expect(await database.executionHistory.toArray()).toEqual([first.history])
      expect(await dump(database)).toEqual(expectedDump(before, expectedPlan))
    }))

  it('clears in-progress on the restored weapon and keeps the restored Target preference', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const registration = await confirmCurrent(service, database, fixture.plan)
      const tracked = registration.history.undoSnapshot.addedOwnedWeaponIds[0]
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ kind: 'gogma' })

      const { plan } = await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      const snapshotWeapon = savePoint.ownedWeapons.find(({ id }) => id === tracked) as OwnedWeapon
      expect(snapshotWeapon).toMatchObject({ kind: 'normal', executionInProgress: { productionPlanId: fixture.plan.id } })
      const goal = fixture.built.input.targetWeapons[0]
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ preferredOwnedWeaponId: tracked })
      expect(await dump(database)).toEqual(expectedDump(before, abandonedFrom(savePoint.productionPlan, plan.updatedAt), [
        { ...snapshotWeapon, executionInProgress: null, updatedAt: plan.updatedAt },
      ]))
    }))

  it('undoes an actual_result_different divergence and abandons from the save point', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      const service = await started(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)
      await recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), 'gogma_artian'))
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'stale', recalculationReasons: ['unexpected_result'] })

      const { plan, deletedExecutionHistoryIds } = await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      expect(plan).toEqual(abandonedFrom(savePoint.productionPlan, plan.updatedAt))
      expect(plan.recalculationReasons).toEqual([])
      expect(deletedExecutionHistoryIds).toHaveLength(1)
      expect(await dump(database)).toEqual(expectedDump(before, plan))
    }))

  it('undoes an operation_uncertain divergence and abandons from the save point', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const before = await dump(database)
      const current = (await currentPlan(database, fixture.plan)).currentStepId as PlanStep['id']
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: current })

      const { plan } = await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      expect(plan).toEqual(abandonedFrom(savePoint.productionPlan, plan.updatedAt))
      expect(plan.recalculationReasons).toEqual([])
      const source = fixture.built.input.ownedWeapons[0]
      const restoredSource = savePoint.ownedWeapons.find(({ id }) => id === source.id) as OwnedWeapon
      expect(restoredSource.executionInProgress).not.toBeNull()
      expect(await database.executionHistory.toArray()).toEqual([first.history])
      expect(await dump(database)).toEqual(expectedDump(before, plan, before.ownedWeapons.map((weapon) =>
        weapon.id === source.id ? { ...restoredSource, executionInProgress: null, updatedAt: plan.updatedAt } : weapon)))
    }))

  it('leaves Plan-independent data added after the save point untouched', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const addedTarget = orchestrationTarget('target.execution.added-later')
      const addedWeapon = normalWeapon('owned.execution.added-later')
      const settings = { ...createDefaultAppSettings('2026-09-17T07:00:00.000Z'), debugMode: true }
      await database.targetWeapons.put(addedTarget)
      await database.ownedWeapons.put(addedWeapon)
      await database.settings.put(settings)

      await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      expect(await database.targetWeapons.get(addedTarget.id)).toEqual(addedTarget)
      expect(await database.ownedWeapons.toArray()).toEqual([addedWeapon])
      expect(await database.settings.get('settings')).toEqual(settings)
    }))

  it('refuses a failing restore with no change at all, and still allows keeping the current state', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const source = fixture.built.input.ownedWeapons[0]
      const [goal] = await database.targetWeapons.bulkGet(fixture.built.input.targetWeapons.map(({ id }) => id))
      await database.targetWeapons.put({ ...(goal as TargetWeapon), preferredOwnedWeaponId: null })
      await database.ownedWeapons.delete(source.id)

      await expectRefusal(() => abandon(service, database, fixture.plan, restoreSavePoint(savePoint)), database, 'save_point_required_entity_missing')
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active' })

      const { plan } = await abandon(service, database, fixture.plan, keepCurrent(savePoint))
      expect(plan).toMatchObject({ status: 'abandoned', abandonmentReason: 'user_abandoned' })
      expect(await database.ownedWeapons.get(source.id)).toBeUndefined()
      expect(await database.executionHistory.count()).toBe(1)
    }))
})

describe('Plan abandonment Undo and atomicity', () => {
  it('never undoes a user abandonment at the current state', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const latest = await confirmCurrent(service, database, fixture.plan)
      await abandon(service, database, fixture.plan)

      await expectRefusal(
        () => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: latest.history.id }),
        database,
        'undo_not_allowed',
      )
    }))

  it('never undoes a user abandonment after a save point restore', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      await expectRefusal(
        () => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: first.history.id }),
        database,
        'undo_not_allowed',
      )
    }))

  it('rolls back the current-state abandonment when the save point delete fails', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      // The save point delete runs after the OwnedWeapon and Plan writes.
      database.executionSavePoints.hook('deleting', () => {
        throw new Error('storage failure')
      })
      const before = await dump(database)
      const seen = await observed(database, fixture.plan)

      const failure = await service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: seen, savePointDecision: keepCurrent(savePoint) })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).not.toBeInstanceOf(ExecutionRuntimeError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('rolls back the restore and abandonment when a late write fails', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const before = await dump(database)
      const seen = await observed(database, fixture.plan)
      database.executionSavePoints.hook('deleting', () => {
        throw new Error('storage failure')
      })

      const failure = await service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: seen, savePointDecision: restoreSavePoint(savePoint) })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('rolls back the restore and abandonment when the ExecutionHistory delete fails', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const before = await dump(database)
      const seen = await observed(database, fixture.plan)
      database.executionHistory.hook('deleting', () => {
        throw new Error('storage failure')
      })

      const failure = await service.abandonProductionPlan({ planId: fixture.plan.id, observedPlan: seen, savePointDecision: restoreSavePoint(savePoint) })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('adds no ExecutionHistory and moves no version authority', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await abandon(service, database, fixture.plan, restoreSavePoint(savePoint))

      expect((await database.executionHistory.toArray()).map(({ id }) => id)).toEqual([savePoint.lastExecutionHistoryId])
      expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(15)
      expect(DATABASE_SCHEMA_VERSION).toBe(9)
      expect(EXPORT_SCHEMA_VERSION).toBe(12)
    }))
})
