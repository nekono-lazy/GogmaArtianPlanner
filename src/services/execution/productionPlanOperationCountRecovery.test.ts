import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import type {
  ExecutionHistory,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  RestorationBonusSet,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { compareExecutionHistoryOrder, validateExecutionHistory } from '../../domain/models/publicTypes'
import type { OperationCountRecoveryObservation } from '../../domain/execution'
import {
  alternativePracticalBonuses,
  belowPracticalBonuses,
  idealBonuses,
  practicalBonuses,
  sameLayoutLowerRanks,
} from '../../test/fixtures/constrainedEnumeration'
import {
  checkpointFixture,
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  expectRefusal,
  sameWeaponWindowFixture,
  seed,
  WINDOW_SOURCE_ID,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import type { ProductionPlanExecutionService } from './productionPlanExecutionService'

/**
 * Current Position Recovery after `operation_uncertain`
 * (`docs/PLANNER_SPEC.md` 16.15) over the real runtime and a real Dexie
 * database, with Plans the real Planner produced.
 */

const KEEP_RESULTS = [sameLayoutLowerRanks(), practicalBonuses(), sameLayoutLowerRanks(), alternativePracticalBonuses(), idealBonuses()]
const keepFixture = () => sameWeaponWindowFixture(
  ['keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'reset_skills'],
  KEEP_RESULTS,
)

const bonuses = (restorationBonuses: RestorationBonusSet): OperationCountRecoveryObservation =>
  ({ kind: 'restoration_bonuses', restorationBonuses, restorationBonusScope: 'gogma_artian' })

async function historyOf(database: AppDatabase, plan: ProductionPlan): Promise<ExecutionHistory[]> {
  return (await database.executionHistory.where('planId').equals(plan.id).toArray()).sort(compareExecutionHistoryOrder)
}

/** Seeds and starts the Plan, confirms `confirmed` Steps, optionally records a save point, then records operation_uncertain. */
async function uncertainPlan(
  database: AppDatabase,
  fixture: ExecutionFixture,
  options: { confirmed?: number; savePoint?: boolean } = {},
) {
  await seed(database, fixture)
  const service = executionService(database, fixture.built)
  await service.startProductionPlan(fixture.plan.id)
  if (options.savePoint) await service.recordExecutionSavePoint({ planId: fixture.plan.id })
  for (let index = 0; index < (options.confirmed ?? 0); index += 1) {
    await confirmCurrent(service, database, fixture.plan)
  }
  const stored = await currentPlan(database, fixture.plan)
  const { history } = await service.recordOperationUncertain({
    planId: fixture.plan.id,
    planStepId: stored.currentStepId as PlanStep['id'],
  })
  return { service, uncertain: history, stepId: stored.currentStepId as PlanStep['id'] }
}

function recover(
  service: ProductionPlanExecutionService,
  fixture: ExecutionFixture,
  context: { uncertain: ExecutionHistory; stepId: PlanStep['id'] },
  observations: OperationCountRecoveryObservation[],
  recoveredPosition: number,
) {
  return service.recoverOperationCount({
    planId: fixture.plan.id,
    planStepId: context.stepId,
    uncertainExecutionHistoryId: context.uncertain.id,
    observations,
    recoveredPosition,
  })
}

const weaponOf = async (database: AppDatabase, id: string) => (await database.ownedWeapons.get(id as OwnedWeapon['id'])) as OwnedWeapon

describe('ProductionPlanExecutionService.recoverOperationCount', () => {
  it('follows a unique Keep position by replaying the Plan, and the Plan continues', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture, { savePoint: true })
      const rngBefore = await database.rngState.get('current')
      const savePointBefore = await database.executionSavePoints.toArray()

      const inspected = await context.service.inspectOperationCountRecovery(fixture.plan.id)
      expect(inspected.kind).toBe('available')

      const { plan, history } = await recover(context.service, fixture, context, [bonuses(alternativePracticalBonuses())], 4)
      const steps = fixture.plan.steps
      expect(plan.status).toBe('active')
      expect(plan.recalculationReasons).toEqual([])
      expect(plan.currentStepId).toBe(steps[4].id)
      expect(plan.steps.slice(0, 4).every(({ isCompleted }) => isCompleted)).toBe(true)
      expect(plan.steps.slice(4).some(({ isCompleted }) => isCompleted)).toBe(false)
      // Four Keeps advanced the Gogma Counter four times, through each Step's rngAdvance.
      const rngAfter = await database.rngState.get('current')
      expect(rngAfter?.gogmaCounter.value).toBe((rngBefore?.gogmaCounter.value as number) + 4)
      expect(rngAfter?.skillCounter.value).toBe(rngBefore?.skillCounter.value)
      expect((await weaponOf(database, WINDOW_SOURCE_ID)).restorationBonuses).toEqual(alternativePracticalBonuses())
      expect(await database.executionSavePoints.toArray()).toEqual(savePointBefore)

      expect(history).toMatchObject({
        action: 'operation_count_recovered',
        planStepId: steps[3].id,
        wasExpected: true,
        recalculationReason: null,
        actualResult: { restorationBonuses: alternativePracticalBonuses(), restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: null },
      })
      expect(history.undoSnapshot.productionPlanBefore.status).toBe('stale')
      expect(validateExecutionHistory(history).issues).toEqual([])
      expect((await historyOf(database, fixture.plan)).map(({ action }) => action))
        .toEqual(['operation_uncertain', 'operation_count_recovered'])

      // The same Plan resumes at Keep 5.
      await confirmCurrent(context.service, database, fixture.plan)
      expect((await currentPlan(database, fixture.plan)).currentStepId).toBe(steps[5].id)
    }))

  it('returns to active at the persisted position when nothing more ran in the game', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture)
      const before = await dump(database)
      const { plan } = await recover(context.service, fixture, context, [bonuses(belowPracticalBonuses())], 0)
      const after = await dump(database)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(after.ownedWeapons).toEqual(before.ownedWeapons)
      expect(after.targetWeapons).toEqual(before.targetWeapons)
      expect(plan).toMatchObject({ status: 'active', currentStepId: context.stepId, recalculationReasons: [] })
      expect(plan.steps.some(({ isCompleted }) => isCompleted)).toBe(false)
      const history = await historyOf(database, fixture.plan)
      expect(history.map(({ action }) => action)).toEqual(['operation_uncertain', 'operation_count_recovered'])
      expect(history[1].planStepId).toBe(context.stepId)
    }))

  it('replays Execution effects exactly like ordinary confirmation (compromise label)', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      const context = await uncertainPlan(database, fixture)
      // P / below / P narrows candidates 1 and 3 down to position 3.
      await recover(context.service, fixture, context, [
        bonuses(practicalBonuses()), bonuses(belowPracticalBonuses()), bonuses(practicalBonuses()),
      ], 3)
      const recovered = await dump(database)

      await withDatabase(async (reference) => {
        await seed(reference, fixture)
        const service = executionService(reference, fixture.built)
        await service.startProductionPlan(fixture.plan.id)
        for (let index = 0; index < 3; index += 1) await confirmCurrent(service, reference, fixture.plan)
        const expected = await dump(reference)
        // Only timestamps differ: the reference ran three transactions at other clock values.
        const withoutTimes = (value: unknown) => JSON.parse(JSON.stringify(value, (key, field) =>
          key === 'updatedAt' || key === 'startedAt' ? undefined : field))
        expect(withoutTimes(recovered.ownedWeapons)).toEqual(withoutTimes(expected.ownedWeapons))
        expect(withoutTimes(recovered.targetWeapons)).toEqual(withoutTimes(expected.targetWeapons))
        const counters = withoutTimes
        expect(counters(recovered.rngState)).toEqual(counters(expected.rngState))
        const [plan] = recovered.productionPlans
        const [reference3] = expected.productionPlans
        expect(plan.currentStepId).toBe(reference3.currentStepId)
        expect(plan.steps.map(({ isCompleted }) => isCompleted)).toEqual(reference3.steps.map(({ isCompleted }) => isCompleted))
      })
      // The compromise label of Step 1 was replayed.
      expect((await weaponOf(database, fixture.source.id)).status).toBe('practical')
    }), 30_000)

  it('completes the Plan and its Target when the unique position is the last Step, and Undo returns to stale', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      const context = await uncertainPlan(database, fixture, { savePoint: true })
      const beforeRecovery = await dump(database)
      const { plan, history } = await recover(context.service, fixture, context, [bonuses(idealBonuses())], 5)
      expect(plan).toMatchObject({ status: 'completed', currentStepId: null, recalculationReasons: [] })
      expect(plan.completedAt).toBe(history.createdAt)
      const weapon = await weaponOf(database, fixture.source.id)
      expect(weapon).toMatchObject({ status: 'ideal', isProtected: true, executionInProgress: null })
      expect(await database.targetWeapons.get(fixture.goal.id)).toMatchObject({ lifecycleStatus: 'completed', preferredOwnedWeaponId: null })
      // Plan completion deletes the save point, exactly as an ordinary completion does.
      expect(await database.executionSavePoints.toArray()).toEqual([])

      await context.service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id })
      expect(await dump(database)).toEqual(beforeRecovery)
      const restored = await currentPlan(database, fixture.plan)
      expect(restored.status).toBe('stale')
      expect((await historyOf(database, fixture.plan)).at(-1)?.id).toBe(context.uncertain.id)
    }), 30_000)

  it('is undone back to the operation_uncertain state for an active result too', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture)
      const before = await dump(database)
      const { history } = await recover(context.service, fixture, context, [bonuses(alternativePracticalBonuses())], 4)
      await context.service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id })
      expect(await dump(database)).toEqual(before)
    }))

  it('refuses an ambiguous or unmatched observation without writing anything', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture)
      await expectRefusal(() => recover(context.service, fixture, context, [bonuses(sameLayoutLowerRanks())], 1), database, 'operation_count_recovery_not_unique')
      const reordered = [...practicalBonuses()].reverse() as RestorationBonusSet
      await expectRefusal(() => recover(context.service, fixture, context, [bonuses(reordered)], 0), database, 'operation_count_recovery_not_unique')
    }))

  it('never follows a result outside the Recovery Window', () =>
    withDatabase(async (database) => {
      const fixture = await sameWeaponWindowFixture(
        ['reset_bonuses', 'reset_bonuses', 'keep_bonuses', 'keep_bonuses', 'reset_skills'],
        [sameLayoutLowerRanks(), practicalBonuses(), alternativePracticalBonuses(), idealBonuses()],
      )
      const context = await uncertainPlan(database, fixture)
      // The first Keep (Step 3) would show this result; the window is the two Resets.
      await expectRefusal(
        () => recover(context.service, fixture, context, [bonuses(alternativePracticalBonuses())], 3),
        database,
        'operation_count_recovery_not_unique',
      )
    }))

  it('refuses when what the user saw changed', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture)
      const observation = [bonuses(alternativePracticalBonuses())]
      await expectRefusal(() => recover(context.service, fixture, context, observation, 3), database, 'operation_count_recovery_changed')
      await expectRefusal(
        () => recover(context.service, fixture, { ...context, uncertain: { ...context.uncertain, id: 'history.other' as ExecutionHistory['id'] } }, observation, 4),
        database,
        'operation_count_recovery_changed',
      )
      await expectRefusal(
        () => recover(context.service, fixture, { ...context, stepId: fixture.plan.steps[1].id }, observation, 4),
        database,
        'operation_count_recovery_changed',
      )
    }))

  it('refuses a Plan with another stale reason, a changed dependency, or an incompatible context', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture)
      const observation = [bonuses(alternativePracticalBonuses())]
      const stored = await currentPlan(database, fixture.plan)

      await database.productionPlans.put({ ...stored, recalculationReasons: ['execution_operation_uncertain', 'manual_recalculate'] })
      await expectRefusal(() => recover(context.service, fixture, context, observation, 4), database, 'operation_count_recovery_not_applicable')
      await database.productionPlans.put(stored)

      const incompatible = executionService(database, fixture.built, {
        currentCalculationContext: { ...fixture.built.input.calculationContext, rngEngineVersion: 'other-engine' },
      })
      await expectRefusal(() => recover(incompatible, fixture, context, observation, 4), database, 'calculation_context_changed')

      const target = (await database.targetWeapons.get(fixture.goal.id)) as TargetWeapon
      await database.targetWeapons.put({ ...target, priority: target.priority === 5 ? 4 : 5 })
      await expectRefusal(() => recover(context.service, fixture, context, observation, 4), database, 'plan_dependency_changed')
    }))

  it('validates the operation_count_recovered record shape', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture)
      const { history } = await recover(context.service, fixture, context, [bonuses(alternativePracticalBonuses())], 4)
      expect(validateExecutionHistory(history).isValid).toBe(true)
      const issues = (candidate: ExecutionHistory) => validateExecutionHistory(candidate).issues.map(({ path }) => path)
      expect(issues({ ...history, wasExpected: false })).toContain('wasExpected')
      expect(issues({ ...history, recalculationReason: 'unexpected_result' })).toContain('recalculationReason')
      expect(issues({ ...history, actualResult: null })).toContain('actualResult')
      expect(issues({
        ...history,
        actualResult: { ...(history.actualResult as NonNullable<ExecutionHistory['actualResult']>), seriesSkillId: 'series_skill.fixture.a' as never },
      })).toContain('actualResult')
    }))

  it('refuses an active Plan', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(
        () => service.recoverOperationCount({
          planId: fixture.plan.id,
          planStepId: fixture.plan.steps[0].id,
          uncertainExecutionHistoryId: 'history.none' as ExecutionHistory['id'],
          observations: [bonuses(belowPracticalBonuses())],
          recoveredPosition: 0,
        }),
        database,
        'operation_count_recovery_not_applicable',
      )
    }))
})

describe('the other recoveries after operation_uncertain reuse the existing runtime', () => {
  it('restores the game save point after operation_uncertain', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const atSavePoint = await dump(database)
      await confirmCurrent(service, database, fixture.plan)
      const stored = await currentPlan(database, fixture.plan)
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stored.currentStepId as PlanStep['id'] })

      await service.restoreExecutionSavePoint({ planId: fixture.plan.id, recordedAt: savePoint.recordedAt })
      const restored = await dump(database)
      expect(restored.rngState).toEqual(atSavePoint.rngState)
      expect(restored.normalCounters).toEqual(atSavePoint.normalCounters)
      expect(restored.ownedWeapons).toEqual(atSavePoint.ownedWeapons)
      expect(restored.targetWeapons).toEqual(atSavePoint.targetWeapons)
      expect(restored.productionPlans).toEqual(atSavePoint.productionPlans)
      expect(restored.executionHistory).toEqual([])
    }))

  it('abandons the Plan with the existing user abandonment when no save point exists', () =>
    withDatabase(async (database) => {
      const fixture = await keepFixture()
      const context = await uncertainPlan(database, fixture, { confirmed: 1 })
      const historyBefore = await historyOf(database, fixture.plan)
      const options = await context.service.inspectProductionPlanAbandonment({ planId: fixture.plan.id })
      expect(options.savePointChoiceRequired).toBe(false)
      const { plan } = await context.service.abandonProductionPlan({
        planId: fixture.plan.id,
        observedPlan: { status: options.planStatus, currentStepId: options.planCurrentStepId, updatedAt: options.planUpdatedAt },
        savePointDecision: null,
      })
      expect(plan).toMatchObject({ status: 'abandoned', abandonmentReason: 'user_abandoned' })
      expect((await weaponOf(database, WINDOW_SOURCE_ID)).executionInProgress).toBeNull()
      expect(await historyOf(database, fixture.plan)).toEqual(historyBefore)
    }))
})
