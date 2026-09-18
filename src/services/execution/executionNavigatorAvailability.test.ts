import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import { loadExecutionNavigatorSnapshot } from './executionNavigatorDependencies'
import type { ProductionPlanExecutionService } from './productionPlanExecutionService'
import {
  confirmCurrent,
  currentPlan,
  existingGogmaFixture,
  executionService,
  newNormalFixture,
  seed,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import { inspectExecutionSavePointRestore } from '../../domain/execution/planAbandonment'
import { inspectExecutionUndo } from '../../domain/execution/executionUndo'

/**
 * The Navigator's display availability of Undo and the save point restore must
 * agree with the runtime that stays the write authority (16.9 / 16.16).
 */

async function started(database: AppDatabase, fixture: ExecutionFixture) {
  await seed(database, fixture)
  const service = executionService(database, fixture.built)
  await service.startProductionPlan(fixture.plan.id)
  return service
}

async function availability(database: AppDatabase, fixture: ExecutionFixture) {
  const snapshot = await loadExecutionNavigatorSnapshot(database, fixture.plan.id)
  if (snapshot === null) throw new Error('plan')
  return snapshot
}

/** Undo offered exactly when the runtime accepts it. */
async function expectUndoAgreement(
  database: AppDatabase,
  fixture: ExecutionFixture,
  service: ProductionPlanExecutionService,
  expected: 'available' | 'unavailable',
) {
  const snapshot = await availability(database, fixture)
  expect(snapshot.undo.kind).toBe(expected)
  const history = snapshot.latestExecutionHistory
  if (history === null) return
  const undo = service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id })
  if (expected === 'available') await expect(undo).resolves.toBeDefined()
  else await expect(undo).rejects.toMatchObject({ code: 'undo_not_allowed' })
}

describe('inspectExecutionUndo', () => {
  it('offers nothing before any record', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await started(database, fixture)
      const plan = await currentPlan(database, fixture.plan)
      expect(inspectExecutionUndo(plan, null, null)).toEqual({ kind: 'unavailable' })
    }))

  it('offers Undo of a running Plan record, and marks the save point boundary', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const snapshot = await availability(database, fixture)
      expect(snapshot.undo).toMatchObject({ kind: 'available', terminal: false, deletesExecutionSavePoint: true })
      await expectUndoAgreement(database, fixture, service, 'available')
    }))

  it('offers Undo of the record that completed the Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      expect((await availability(database, fixture)).undo).toMatchObject({ kind: 'available', terminal: true })
      await expectUndoAgreement(database, fixture, service, 'available')
    }))

  it('offers no Undo after a user abandonment, as the runtime refuses it', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await started(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const stored = await currentPlan(database, fixture.plan)
      await service.abandonProductionPlan({
        planId: stored.id,
        observedPlan: { status: stored.status, currentStepId: stored.currentStepId, updatedAt: stored.updatedAt },
        savePointDecision: null,
      })
      await expectUndoAgreement(database, fixture, service, 'unavailable')
    }))
})

describe('inspectExecutionSavePointRestore', () => {
  it('follows the save point boundary authority', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const service = await started(database, fixture)
      expect((await availability(database, fixture)).savePointRestore).toEqual({ kind: 'no_save_point' })

      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      expect((await availability(database, fixture)).savePointRestore.kind).toBe('at_current_position')

      await confirmCurrent(service, database, fixture.plan)
      const snapshot = await availability(database, fixture)
      expect(snapshot.savePointRestore.kind).toBe('available')
      // The same boundary answer the abandonment inspection gives.
      expect((await service.inspectProductionPlanAbandonment({ planId: fixture.plan.id })).savePointChoiceRequired).toBe(true)
    }))

  it('reports a foreign boundary as invalid, and a non-running Plan as not running', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const service = await started(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const plan = await currentPlan(database, fixture.plan)
      expect(inspectExecutionSavePointRestore(plan, { ...savePoint, lastExecutionHistoryId: 'history.missing' as never }, []))
        .toMatchObject({ kind: 'invalid' })
      expect(inspectExecutionSavePointRestore({ ...plan, status: 'completed' }, savePoint, []))
        .toMatchObject({ kind: 'not_running' })
    }))
})
