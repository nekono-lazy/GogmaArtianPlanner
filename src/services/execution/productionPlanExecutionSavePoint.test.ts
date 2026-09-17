import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import {
  ExecutionRuntimeError,
  collectExecutionScopeOwnedWeaponIds,
  prepareExecutionSavePointRestore,
} from '../../domain/execution'
import type {
  BuildListEntry,
  BuildListEntryId,
  ExecutionHistory,
  ExecutionHistoryId,
  ExecutionSavePoint,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStep,
  ProductionPlan,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createDefaultAppSettings,
  executionSavePointIdForPlan,
  validateExecutionHistory,
  validateExecutionSavePoint,
} from '../../domain/models/publicTypes'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  belowPracticalBonuses,
  normalWeapon,
  practicalBonuses,
} from '../../test/fixtures/constrainedEnumeration'
import {
  blindFixture,
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
  ownedNormalFixture,
  planFor,
  recordDifferent,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import {
  checkpointBonusEntry,
  checkpointBonusResultAt,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import type { ProductionPlanExecutionService } from './productionPlanExecutionService'

async function started(database: AppDatabase, fixture: ExecutionFixture, service = executionService(database, fixture.built)) {
  await seed(database, fixture)
  await service.startProductionPlan(fixture.plan.id)
  return service
}

function record(service: ProductionPlanExecutionService, plan: ProductionPlan) {
  return service.recordExecutionSavePoint({ planId: plan.id })
}

function restore(service: ProductionPlanExecutionService, plan: ProductionPlan, savePoint: Pick<ExecutionSavePoint, 'recordedAt'>) {
  return service.restoreExecutionSavePoint({ planId: plan.id, recordedAt: savePoint.recordedAt })
}

function ids(values: readonly { id: string }[]): string[] {
  return values.map(({ id }) => id)
}

describe('ExecutionSavePoint record', () => {
  it('snapshots the active Plan state exactly under the Plan-derived ID and changes nothing else', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const before = await dump(database)
      const plan = await currentPlan(database, fixture.plan)

      const savePoint = await record(service, fixture.plan)

      expect(savePoint).toEqual({
        id: executionSavePointIdForPlan(fixture.plan.id),
        productionPlanId: fixture.plan.id,
        lastExecutionHistoryId: null,
        rngState: (before.rngState as unknown[])[0],
        normalCounters: before.normalCounters,
        ownedWeapons: [],
        targetWeapons: before.targetWeapons,
        productionPlan: plan,
        recordedAt: '2026-09-17T00:00:02.000Z',
      })
      expect(validateExecutionSavePoint(savePoint).issues).toEqual([])
      const after = await dump(database)
      expect(after.executionSavePoints).toEqual([savePoint])
      expect({ ...after, executionSavePoints: [] }).toEqual(before)
      expect(after.executionHistory).toEqual([])
    }))

  it('names the latest ExecutionHistory by the order authority, ties broken by ID, not insertion', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const historyIds = ['history.same-time.b', 'history.same-time.a']
      const service = await started(database, fixture, executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => historyIds.shift() as ExecutionHistoryId },
        clock: { now: () => '2026-09-17T02:00:00.000Z' },
      }))
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      const savePoint = await record(service, fixture.plan)

      expect(savePoint.lastExecutionHistoryId).toBe('history.same-time.b')
      expect(await database.executionHistory.count()).toBe(2)
    }))

  it('keeps one save point per Plan: recording again replaces it', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await record(service, fixture.plan)
      const { history } = await confirmCurrent(service, database, fixture.plan)

      const second = await record(service, fixture.plan)

      expect(second.recordedAt).not.toBe(first.recordedAt)
      expect(second.lastExecutionHistoryId).toBe(history.id)
      expect(second.productionPlan.currentStepId).toBe(stepOf(fixture.plan, 1).id)
      expect(await database.executionSavePoints.toArray()).toEqual([second])
    }))

  it('refuses a draft, stale, completed or abandoned Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await expectRefusal(() => record(service, fixture.plan), database, 'save_point_record_not_allowed')

      await service.startProductionPlan(fixture.plan.id)
      const active = await currentPlan(database, fixture.plan)
      await database.productionPlans.put({ ...active, status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: '2026-09-17T03:00:00.000Z' })
      await expectRefusal(() => record(service, fixture.plan), database, 'save_point_record_not_allowed')
      await database.productionPlans.put(active)

      const uncertain = await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: active.currentStepId as PlanStep['id'] })
      await expectRefusal(() => record(service, fixture.plan), database, 'save_point_record_not_allowed')
      await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: uncertain.history.id })

      await confirmCurrent(service, database, fixture.plan)
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
      await expectRefusal(() => record(service, fixture.plan), database, 'save_point_record_not_allowed')
    }))

  it('refuses a diverged state instead of snapshotting it', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const rng = (await database.rngState.get('current')) as ExecutionSavePoint['rngState']
      await database.rngState.put({ ...rng, gogmaCounter: { ...rng.gogmaCounter, value: CONSTRAINED_START_GOGMA_COUNTER + 9 } })
      await expectRefusal(() => record(service, fixture.plan), database, 'execution_state_mismatch')
    }))

  it('holds exactly the route source, in-progress and Plan-registered OwnedWeapons', () =>
    withDatabase(async (database) => {
      const unrelated = normalWeapon('owned.execution.unrelated')
      const inProgress = normalWeapon('owned.execution.in-progress')
      const elsewhere = normalWeapon('owned.execution.elsewhere')
      const fixture = await existingGogmaFixture([unrelated, inProgress, elsewhere])
      const service = await started(database, fixture)
      await database.ownedWeapons.bulkPut([
        { ...inProgress, executionInProgress: { productionPlanId: fixture.plan.id, startedAt: '2026-09-17T00:00:00.000Z' } },
        { ...elsewhere, executionInProgress: { productionPlanId: 'plan.other' as ProductionPlan['id'], startedAt: '2026-09-17T00:00:00.000Z' } },
      ])
      const source = fixture.built.input.ownedWeapons[0]

      const savePoint = await record(service, fixture.plan)

      expect(ids(savePoint.ownedWeapons)).toEqual([inProgress.id, source.id].sort())
      expect(savePoint.ownedWeapons).toContainEqual(await database.ownedWeapons.get(inProgress.id))
    }))

  it('holds a weapon this Plan registered, and the ones a record still registers only', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(1)
      const service = await started(database, fixture)
      const { history } = await confirmCurrent(service, database, fixture.plan)
      const tracked = history.undoSnapshot.addedOwnedWeaponIds[0]
      // Not in progress any more, yet still registered by this Plan's Execution.
      const weapon = (await database.ownedWeapons.get(tracked)) as OwnedWeapon
      await database.ownedWeapons.put({ ...weapon, executionInProgress: null })

      const savePoint = await record(service, fixture.plan)

      expect(ids(savePoint.ownedWeapons)).toEqual([tracked])
      expect(savePoint.ownedWeapons[0]).toMatchObject({ executionInProgress: null })
      expect(collectExecutionScopeOwnedWeaponIds(fixture.plan, {
        ownedWeapons: await database.ownedWeapons.toArray(),
        buildListEntries: await database.buildListEntries.toArray(),
        planExecutionHistory: [],
      })).toEqual([])
    }))

  it('holds exactly the Plan-dependent Targets and the Targets preferring a scope weapon', () =>
    withDatabase(async (database) => {
      const unrelated = normalWeapon('owned.execution.unrelated')
      const fixture = await existingGogmaFixture([unrelated])
      const service = await started(database, fixture)
      await database.targetWeapons.bulkPut([
        orchestrationTarget('target.execution.unrelated-preference', { preferredOwnedWeaponId: unrelated.id }),
        orchestrationTarget('target.execution.no-preference'),
      ])
      const [goal, other] = fixture.built.input.targetWeapons

      const savePoint = await record(service, fixture.plan)

      expect(ids(savePoint.targetWeapons)).toEqual([goal.id, other.id].sort())
      expect(savePoint.targetWeapons).toEqual([goal, other].sort((a, b) => a.id.localeCompare(b.id)))
    }))
})

describe('ExecutionSavePoint restore', () => {
  it('restores an intermediate save point: state, Plan, later records deleted, earlier kept, save point kept', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await record(service, fixture.plan)
      expect(savePoint.lastExecutionHistoryId).toBe(first.history.id)
      const before = await dump(database)

      const later = [
        await confirmCurrent(service, database, fixture.plan),
        await confirmCurrent(service, database, fixture.plan),
        await confirmCurrent(service, database, fixture.plan),
      ]
      const tracked = later[1].history.undoSnapshot.addedOwnedWeaponIds[0]
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ kind: 'gogma' })

      const result = await restore(service, fixture.plan, savePoint)

      expect(result.plan).toEqual(savePoint.productionPlan)
      expect(result.savePoint).toEqual(savePoint)
      expect(result.deletedExecutionHistoryIds).toEqual(later.map(({ history }) => history.id))
      expect(await database.ownedWeapons.get(tracked)).toBeUndefined()
      expect(await database.executionHistory.toArray()).toEqual([first.history])
      expect(await dump(database)).toEqual(before)
    }))

  it('restores a save point recorded before any record and deletes every record of the Plan', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      for (let index = 0; index < 4; index += 1) await confirmCurrent(service, database, fixture.plan)

      const { plan } = await restore(service, fixture.plan, savePoint)

      expect(plan).toMatchObject({ status: 'active', currentStepId: stepOf(fixture.plan, 0).id })
      expect(await database.executionHistory.count()).toBe(0)
      expect(await dump(database)).toEqual(before)
    }))

  it('returns an owned Normal converted after the save point to its exact Normal body', () =>
    withDatabase(async (database) => {
      const fixture = await ownedNormalFixture()
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      const source = fixture.built.input.ownedWeapons[0]
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ kind: 'gogma', status: 'unclassified', executionInProgress: { productionPlanId: fixture.plan.id } })

      await restore(service, fixture.plan, savePoint)

      expect(await database.ownedWeapons.get(source.id)).toEqual(source)
      expect(await dump(database)).toEqual(before)
    }))

  it('returns an existing Gogma, its Plan-dependent Target and a relinked-away Target exactly', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      const [goal, other] = fixture.built.input.targetWeapons
      const source = fixture.built.input.ownedWeapons[0]
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ preferredOwnedWeaponId: source.id })
      expect(await database.targetWeapons.get(other.id)).toMatchObject({ preferredOwnedWeaponId: null })
      expect(await database.ownedWeapons.get(source.id)).not.toEqual(source)

      await restore(service, fixture.plan, savePoint)

      expect(await database.targetWeapons.get(goal.id)).toEqual(goal)
      expect(await database.targetWeapons.get(other.id)).toEqual(other)
      expect(await database.ownedWeapons.get(source.id)).toEqual(source)
      expect(await dump(database)).toEqual(before)
    }))

  it('returns the status label a reached compromise checkpoint wrote after the save point', () =>
    withDatabase(async (database) => {
      const source = orchestrationSource('owned.execution.checkpoint', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
      const goal = orchestrationTarget('target.execution.checkpoint')
      const entry = checkpointBonusEntry('entry.execution.checkpoint', goal, source.id, source)
      const fixture = await planFor(orchestrationScenario({
        targets: [goal],
        entries: [entry],
        ownedWeapons: [source],
        engine: { resetResultAt: checkpointBonusResultAt },
      }))
      const labelled = fixture.plan.steps.findIndex((step) => (step.executionEffects?.compromiseLabels.length ?? 0) > 0)
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      for (let index = 0; index <= labelled; index += 1) await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'practical' })

      await restore(service, fixture.plan, savePoint)

      expect(await database.ownedWeapons.get(source.id)).toEqual(source)
      expect(await dump(database)).toEqual(before)
    }))

  it('returns a Target outside the save point to the before body of the earliest later record', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const outside = orchestrationTarget('target.execution.outside', { memo: 'at the save point' })
      await seed(database, fixture)
      await database.targetWeapons.put(outside)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const savePoint = await record(service, fixture.plan)
      expect(ids(savePoint.targetWeapons)).not.toContain(outside.id)
      const first = await confirmCurrent(service, database, fixture.plan)
      const second = await confirmCurrent(service, database, fixture.plan)
      const changedOnce = { ...outside, memo: 'after the first record', updatedAt: '2026-09-17T05:00:00.000Z' }
      const changedTwice = { ...outside, memo: 'after the second record', updatedAt: '2026-09-17T06:00:00.000Z' }
      const crafted: ExecutionHistory[] = [
        { ...first.history, undoSnapshot: { ...first.history.undoSnapshot, affectedTargetWeaponsBefore: [outside] } },
        { ...second.history, undoSnapshot: { ...second.history.undoSnapshot, affectedTargetWeaponsBefore: [changedOnce] } },
      ]
      crafted.forEach((history) => expect(validateExecutionHistory(history).issues).toEqual([]))
      await database.executionHistory.bulkPut(crafted)
      await database.targetWeapons.put(changedTwice)

      await restore(service, fixture.plan, savePoint)

      expect(await database.targetWeapons.get(outside.id)).toEqual(outside)
    }))

  it('keeps a deleted Plan-independent snapshot Target deleted, but refuses a deleted Plan-dependent Target', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const [goal, other] = fixture.built.input.targetWeapons
      expect(ids(savePoint.targetWeapons)).toContain(other.id)
      await confirmCurrent(service, database, fixture.plan)

      const storedGoal = (await database.targetWeapons.get(goal.id)) as TargetWeapon
      await database.targetWeapons.delete(goal.id)
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_required_entity_missing')
      await database.targetWeapons.put(storedGoal)

      await database.targetWeapons.delete(other.id)
      await restore(service, fixture.plan, savePoint)

      expect(await database.targetWeapons.get(other.id)).toBeUndefined()
      expect(await database.targetWeapons.get(goal.id)).toEqual(goal)
    }))

  it('refuses a missing snapshot OwnedWeapon or selected BuildListEntry and never revives it', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const source = fixture.built.input.ownedWeapons[0]
      const [goal, other] = await database.targetWeapons.bulkGet(fixture.built.input.targetWeapons.map(({ id }) => id))

      const storedSource = await database.ownedWeapons.get(source.id)
      await database.targetWeapons.put({ ...(goal as TargetWeapon), preferredOwnedWeaponId: null })
      await database.ownedWeapons.delete(source.id)
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_required_entity_missing')
      expect(await database.ownedWeapons.get(source.id)).toBeUndefined()
      await database.ownedWeapons.put(storedSource as NonNullable<typeof storedSource>)
      await database.targetWeapons.bulkPut([goal as TargetWeapon, other as TargetWeapon])

      const entry = fixture.built.input.buildListEntries[0]
      await database.buildListEntries.delete(entry.id)
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_required_entity_missing')
      expect(await database.buildListEntries.get(entry.id)).toBeUndefined()
    }))

  it('restores a Plan made stale by actual_result_different back to active', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      const step = stepOf(fixture.plan, 0)
      await recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(step.expectedResult?.restorationBonuses), 'gogma_artian'))
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'stale', currentStepId: null })

      const { plan, deletedExecutionHistoryIds } = await restore(service, fixture.plan, savePoint)

      expect(plan).toMatchObject({ status: 'active', currentStepId: step.id, recalculationReasons: [] })
      expect(deletedExecutionHistoryIds).toHaveLength(1)
      expect((await database.rngState.get('current'))?.gogmaCounter.value).toBe(CONSTRAINED_START_GOGMA_COUNTER)
      expect(await dump(database)).toEqual(before)
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
    }))

  it('restores a Plan made stale by operation_uncertain back to active', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      const current = (await currentPlan(database, fixture.plan)).currentStepId as PlanStep['id']
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: current })

      const { plan } = await restore(service, fixture.plan, savePoint)

      expect(plan).toMatchObject({ status: 'active', currentStepId: current, recalculationReasons: [] })
      expect(await dump(database)).toEqual(before)
    }))

  it('leaves Plan-independent data added after the save point untouched', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const addedTarget = orchestrationTarget('target.execution.added-later')
      const addedEntry: BuildListEntry = {
        ...structuredClone(fixture.built.input.buildListEntries[0]),
        id: 'entry.execution.added-later' as BuildListEntryId,
        targetWeaponId: addedTarget.id,
      }
      const addedWeapon = normalWeapon('owned.execution.added-later')
      const settings = { ...createDefaultAppSettings('2026-09-17T07:00:00.000Z'), debugMode: true }
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      // Added after the Steps: an added OwnedWeapon is part of the expected state hash.
      await database.targetWeapons.put(addedTarget)
      await database.buildListEntries.put(addedEntry)
      await database.ownedWeapons.put(addedWeapon)
      await database.settings.put(settings)

      await restore(service, fixture.plan, savePoint)

      expect(await database.targetWeapons.get(addedTarget.id)).toEqual(addedTarget)
      expect(await database.buildListEntries.get(addedEntry.id)).toEqual(addedEntry)
      expect(await database.ownedWeapons.get(addedWeapon.id)).toEqual(addedWeapon)
      expect(await database.settings.get('settings')).toEqual(settings)
      expect(ids(await database.ownedWeapons.toArray())).toEqual([addedWeapon.id])
    }))

  it('leaves other Plans, their records and their save points untouched', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      const first = await confirmCurrent(service, database, fixture.plan)
      const otherPlan: ProductionPlan = { ...structuredClone(fixture.plan), id: 'plan.execution.other' as ProductionPlan['id'], status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: '2026-09-17T08:00:00.000Z' }
      const otherHistory: ExecutionHistory = { ...structuredClone(first.history), id: 'history.execution.other' as ExecutionHistoryId, planId: otherPlan.id }
      const otherSavePoint: ExecutionSavePoint = { ...structuredClone(savePoint), id: executionSavePointIdForPlan(otherPlan.id), productionPlanId: otherPlan.id, productionPlan: otherPlan }
      await database.productionPlans.put(otherPlan)
      await database.executionHistory.put(otherHistory)
      await database.executionSavePoints.put(otherSavePoint)

      await restore(service, fixture.plan, savePoint)

      expect(await database.productionPlans.get(otherPlan.id)).toEqual(otherPlan)
      expect(await database.executionHistory.get(otherHistory.id)).toEqual(otherHistory)
      expect(await database.executionSavePoints.get(otherSavePoint.id)).toEqual(otherSavePoint)
      expect(await database.executionHistory.get(first.history.id)).toBeUndefined()
    }))

  it('splits records at the boundary by ID when they share createdAt', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const historyIds = ['history.same-time.a', 'history.same-time.b']
      const service = await started(database, fixture, executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => historyIds.shift() as ExecutionHistoryId },
        clock: { now: () => '2026-09-17T02:00:00.000Z' },
      }))
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await record(service, fixture.plan)
      expect(savePoint.lastExecutionHistoryId).toBe('history.same-time.a')
      await confirmCurrent(service, database, fixture.plan)

      // The order the records are handed over in is never the authority.
      const decided = prepareExecutionSavePointRestore({
        plan: await currentPlan(database, fixture.plan),
        recordedAt: savePoint.recordedAt,
        state: {
          ownedWeapons: await database.ownedWeapons.toArray(),
          targetWeapons: await database.targetWeapons.toArray(),
          buildListEntries: await database.buildListEntries.toArray(),
          planExecutionHistory: (await database.executionHistory.toArray()).reverse(),
          executionSavePoint: savePoint,
        },
        currentCalculationContext: fixture.built.input.calculationContext,
      })
      expect(decided.deletedExecutionHistoryIds).toEqual(['history.same-time.b'])

      await restore(service, fixture.plan, savePoint)
      expect(ids(await database.executionHistory.toArray())).toEqual(['history.same-time.a'])
    }))

  it('refuses a save point other than the one the user saw', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const seen = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const latest = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await expectRefusal(() => restore(service, fixture.plan, seen), database, 'save_point_changed')

      const { plan } = await restore(service, fixture.plan, latest)
      expect(plan).toEqual(latest.productionPlan)
    }))

  it('refuses a missing save point and a Plan that is not active or stale', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await expectRefusal(() => restore(service, fixture.plan, { recordedAt: '2026-09-17T00:00:00.000Z' }), database, 'save_point_restore_not_allowed')
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(() => restore(service, fixture.plan, { recordedAt: '2026-09-17T00:00:00.000Z' }), database, 'save_point_not_found')

      const savePoint = await record(service, fixture.plan)
      const active = await currentPlan(database, fixture.plan)
      await database.productionPlans.put({ ...active, status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: '2026-09-17T03:00:00.000Z' })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_restore_not_allowed')
      await database.productionPlans.put({ ...active, status: 'completed', currentStepId: null, completedAt: '2026-09-17T03:00:00.000Z', steps: active.steps.map((step) => ({ ...step, isCompleted: true, completedAt: '2026-09-17T03:00:00.000Z' })) })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_restore_not_allowed')
    }))

  it('refuses a missing or foreign boundary record instead of reading it as null', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await database.executionHistory.delete(first.history.id)
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_snapshot_invalid')

      const otherPlanId = 'plan.execution.other' as ProductionPlan['id']
      await database.productionPlans.put({ ...structuredClone(fixture.plan), id: otherPlanId })
      await database.executionHistory.put({ ...first.history, planId: otherPlanId })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_snapshot_invalid')
    }))

  it('refuses a save point whose snapshot is invalid, not active, or does not cover its scope', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      const savePoint = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await database.executionSavePoints.put({ ...savePoint, productionPlan: { ...savePoint.productionPlan, status: 'stale' } })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_snapshot_invalid')
      await database.executionSavePoints.put({ ...savePoint, ownedWeapons: [] })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_snapshot_invalid')
      await database.executionSavePoints.put({ ...savePoint, targetWeapons: [] })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_snapshot_invalid')
      await database.executionSavePoints.put({ ...savePoint, rngState: { ...savePoint.rngState, id: 'broken' as 'current' } })
      await expectRefusal(() => restore(service, fixture.plan, savePoint), database, 'save_point_snapshot_invalid')
    }))

  it('rolls back every restore write when the ExecutionHistory delete fails', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      // The history delete runs after the RngState, Counter, OwnedWeapon,
      // Target and Plan restore writes.
      database.executionHistory.hook('deleting', () => {
        throw new Error('storage failure')
      })
      const before = await dump(database)
      const failure = await restore(service, fixture.plan, savePoint).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).not.toBeInstanceOf(ExecutionRuntimeError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('lets the restored Step run again to completion', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await restore(service, fixture.plan, savePoint)

      let last = await confirmCurrent(service, database, fixture.plan)
      while (last.plan.status === 'active') last = await confirmCurrent(service, database, fixture.plan)
      expect(last.plan.status).toBe('completed')
      expect(await database.executionHistory.count()).toBe(fixture.plan.steps.length)
    }))

  it('keeps a blind observation recorded before the save point as the binding authority', () =>
    withDatabase(async (database) => {
      const fixture = await blindFixture()
      const service = await started(database, fixture)
      const observed = await confirmCurrent(service, database, fixture.plan, belowPracticalBonuses())
      const savePoint = await record(service, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)

      await restore(service, fixture.plan, savePoint)

      expect(await database.executionHistory.toArray()).toEqual([observed.history])
      await confirmCurrent(service, database, fixture.plan)
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
    }))

  it('drops a blind observation recorded after the save point with its weapon', () =>
    withDatabase(async (database) => {
      const fixture = await blindFixture()
      const service = await started(database, fixture)
      const tracked = stepOf(fixture.plan, 0).executionEffects?.trackedOwnedWeaponId as OwnedWeaponId
      const savePoint = await record(service, fixture.plan)
      const before = await dump(database)
      await confirmCurrent(service, database, fixture.plan, belowPracticalBonuses())

      await restore(service, fixture.plan, savePoint)

      expect(await database.ownedWeapons.get(tracked)).toBeUndefined()
      expect(await dump(database)).toEqual(before)
      const second = await confirmCurrent(service, database, fixture.plan, practicalBonuses())
      expect(await database.executionHistory.toArray()).toEqual([second.history])
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ restorationBonuses: practicalBonuses() })
    }))

  it('adds no ExecutionHistory when recording or restoring', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await record(service, fixture.plan)
      expect(await database.executionHistory.count()).toBe(1)
      await confirmCurrent(service, database, fixture.plan)
      const savePoint = (await database.executionSavePoints.toArray())[0]
      await restore(service, fixture.plan, savePoint)
      expect(await database.executionHistory.count()).toBe(1)
    }))
})
