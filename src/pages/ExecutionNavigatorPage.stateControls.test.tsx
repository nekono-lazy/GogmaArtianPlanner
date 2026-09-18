import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../db/AppDatabase'
import { ExecutionRuntimeError } from '../domain/execution'
import type {
  ExecutionHistory,
  ExecutionSavePoint,
  PlanStep,
  ProductionPlan,
} from '../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import {
  bonusResult,
  checkpointFixture,
  confirmCurrent,
  currentPlan,
  differentBonuses,
  existingGogmaFixture,
  executionService,
  finishAsCompromise,
  newNormalFixture,
  recordDifferent,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
} from '../test/fixtures/executionRuntime'
import {
  loadExecutionNavigatorSnapshot,
  type ExecutionNavigatorPageDependencies,
  type ExecutionNavigatorSnapshot,
} from '../services/execution/executionNavigatorDependencies'
import { ExecutionNavigatorPage } from './ExecutionNavigatorPage'

/**
 * The Execution Navigator's 「実行状態の管理」: Undo, the game save point and the
 * ordinary Plan abandonment (`docs/UI_FLOW.md` 12.7 / 12.8 / 16.2). Most cases
 * run the real Execution runtime over a real Dexie database; the concurrency
 * refusals use a mocked runtime.
 */

function renderNavigator(deps: ExecutionNavigatorPageDependencies, planId: string) {
  const router = createMemoryRouter(
    [
      { path: '/plans/:planId/run', element: <ExecutionNavigatorPage dependencies={deps} /> },
      { path: '/plans/:planId', element: <div>Plan page destination</div> },
    ],
    { initialEntries: [`/plans/${planId}/run`] },
  )
  return render(<RouterProvider router={router} />)
}

async function realRuntime(database: AppDatabase, fixture: ExecutionFixture) {
  await seed(database, fixture)
  const service = executionService(database, fixture.built)
  await service.startProductionPlan(fixture.plan.id)
  const deps: ExecutionNavigatorPageDependencies = {
    master: createValidMasterDataFixture(),
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
    loadSnapshot: vi.fn((planId) => loadExecutionNavigatorSnapshot(database, planId)),
    confirmExpectedPlanStep: vi.fn((request) => service.confirmExpectedPlanStep(request)),
    finishProductionPlanAsCompromise: vi.fn((request) => service.finishProductionPlanAsCompromise(request)),
    recordActualResultDifferent: vi.fn((request) => service.recordActualResultDifferent(request)),
    recordOperationUncertain: vi.fn((request) => service.recordOperationUncertain(request)),
    recoverOperationCount: vi.fn((request) => service.recoverOperationCount(request)),
    undoLatestExecution: vi.fn((request) => service.undoLatestExecution(request)),
    recordExecutionSavePoint: vi.fn((request) => service.recordExecutionSavePoint(request)),
    restoreExecutionSavePoint: vi.fn((request) => service.restoreExecutionSavePoint(request)),
    inspectProductionPlanAbandonment: vi.fn((request) => service.inspectProductionPlanAbandonment(request)),
    abandonProductionPlan: vi.fn((request) => service.abandonProductionPlan(request)),
  }
  return { service, deps }
}

function notExpected(name: string) {
  return vi.fn(async () => {
    throw new Error(`${name} is not expected`)
  })
}

function mockedRuntime(snapshot: ExecutionNavigatorSnapshot): ExecutionNavigatorPageDependencies {
  return {
    master: createValidMasterDataFixture(),
    currentCalculationContext: structuredClone(snapshot.plan.calculationContext),
    loadSnapshot: vi.fn(async () => structuredClone(snapshot)),
    confirmExpectedPlanStep: notExpected('confirmExpectedPlanStep'),
    finishProductionPlanAsCompromise: notExpected('finishProductionPlanAsCompromise'),
    recordActualResultDifferent: notExpected('recordActualResultDifferent'),
    recordOperationUncertain: notExpected('recordOperationUncertain'),
    recoverOperationCount: notExpected('recoverOperationCount'),
    undoLatestExecution: notExpected('undoLatestExecution'),
    recordExecutionSavePoint: notExpected('recordExecutionSavePoint'),
    restoreExecutionSavePoint: notExpected('restoreExecutionSavePoint'),
    inspectProductionPlanAbandonment: notExpected('inspectProductionPlanAbandonment'),
    abandonProductionPlan: notExpected('abandonProductionPlan'),
  }
}

/** The active Plan at its second Step, one confirmed record, and a save point before it. */
function mockedSnapshot(fixture: ExecutionFixture): ExecutionNavigatorSnapshot {
  const steps = fixture.plan.steps.map((step, index): PlanStep => ({ ...step, isCompleted: index < 1 }))
  const plan: ProductionPlan = { ...structuredClone(fixture.plan), status: 'active', steps, currentStepId: steps[1].id }
  const history = {
    id: 'history.shown',
    planId: plan.id,
    planStepId: steps[0].id,
    action: 'confirmed_expected',
    createdAt: '2026-09-18T00:00:00.000Z',
  } as ExecutionHistory
  const savePoint = {
    recordedAt: '2026-09-18T01:00:00.000Z',
    lastExecutionHistoryId: null,
    productionPlan: { ...structuredClone(fixture.plan), status: 'active', currentStepId: steps[0].id },
  } as ExecutionSavePoint
  return {
    plan,
    ownedWeapons: structuredClone(fixture.built.input.ownedWeapons),
    targetWeapons: structuredClone(fixture.built.input.targetWeapons),
    buildListEntries: structuredClone(fixture.built.input.buildListEntries),
    latestExecutionHistory: history,
    executionSavePoint: savePoint,
    operationCountRecovery: { kind: 'unavailable', reason: 'not_operation_uncertain' },
    undo: { kind: 'available', history, terminal: false, deletesExecutionSavePoint: false },
    savePointRestore: { kind: 'available', savePoint },
  }
}

const controls = () => screen.findByRole('region', { name: '実行状態の管理' }, { timeout: 5000 })
const undoButton = () => screen.queryByRole('button', { name: '最後の操作をUndo' })
const recordButton = () => screen.getByRole('button', { name: 'ゲーム内セーブ済みとして記録' })
const restoreButton = () => screen.queryByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' })
const abandonButton = () => screen.getByRole('button', { name: '現在Planを破棄する' })
const dialogClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 5000 })
const planHistory = (database: AppDatabase, plan: ProductionPlan) =>
  database.executionHistory.where('planId').equals(plan.id).toArray()

async function undoThroughDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(undoButton() as HTMLElement)
  const dialog = await screen.findByRole('dialog', { name: '最後のツール上の操作を元に戻します' })
  await user.click(within(dialog).getByRole('button', { name: 'Undoする' }))
  return dialog
}

describe('ExecutionNavigatorPage state controls layout', () => {
  it('keeps the management controls apart from the Step primary action', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { deps } = await realRuntime(database, fixture)
      renderNavigator(deps, fixture.plan.id)
      const section = await controls()
      const primary = screen.getByRole('button', { name: '結果一致・次へ' })
      // The primary action is not inside the management section, and precedes it.
      expect(section).not.toContainElement(primary)
      expect(primary.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(section).toHaveTextContent('アプリはゲームのセーブを自動判別しません。')
      expect(section).toHaveTextContent('最後のゲーム内セーブ地点: 記録なし')
      // No record yet, so there is nothing to undo or restore.
      expect(undoButton()).not.toBeInTheDocument()
      expect(restoreButton()).not.toBeInTheDocument()
      expect(within(section).getByRole('button', { name: '現在Planを破棄する' })).toBeInTheDocument()
    }))
})

describe('ExecutionNavigatorPage Undo with the real runtime', () => {
  it('undoes the latest confirmed Step only after the confirmation, and says the game is not reversed', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await user.click(await screen.findByRole('button', { name: '結果一致・次へ' }))
      expect(await screen.findByText('Step 2 / 5')).toBeInTheDocument()
      const [latest] = await planHistory(database, fixture.plan)

      // Cancel: nothing is called.
      await user.click(undoButton() as HTMLElement)
      const dialog = await screen.findByRole('dialog', { name: '最後のツール上の操作を元に戻します' })
      expect(dialog).toHaveTextContent('Undoはツール上の状態だけを戻します。ゲーム内で行った操作は元に戻りません。')
      expect(dialog).toHaveTextContent(/戻す操作: Step 1（.+） の確定/)
      expect(dialog).not.toHaveTextContent('ゲーム内セーブ地点の記録も削除されます')
      await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await dialogClosed()
      expect(deps.undoLatestExecution).not.toHaveBeenCalled()

      await undoThroughDialog(user)
      expect(await screen.findByText('Step 1 / 5', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(deps.undoLatestExecution).toHaveBeenCalledExactlyOnceWith({
        planId: fixture.plan.id,
        executionHistoryId: latest.id,
      })
      expect(screen.getByText('最後のツール上の操作を元に戻しました。ゲーム内の操作は戻っていません。')).toBeInTheDocument()
      expect(await planHistory(database, fixture.plan)).toEqual([])
      await dialogClosed()
      expect(undoButton()).not.toBeInTheDocument()
    }), 20_000)

  it('deletes the game save point with Undo of its boundary record, and says so first', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await controls()).toHaveTextContent('最後のゲーム内セーブ地点: Step 1完了時点')

      await user.click(undoButton() as HTMLElement)
      const dialog = await screen.findByRole('dialog', { name: '最後のツール上の操作を元に戻します' })
      expect(dialog).toHaveTextContent('この操作をUndoすると、ゲーム内セーブ地点の記録も削除されます。')
      await user.click(within(dialog).getByRole('button', { name: 'Undoする' }))
      expect(await screen.findByText('Step 1 / 2', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(await database.executionSavePoints.toArray()).toEqual([])
      await dialogClosed()
      expect(await controls()).toHaveTextContent('最後のゲーム内セーブ地点: 記録なし')
    }), 20_000)

  it('undoes a stale actual_result_different record next to its re-identification guidance', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), 'gogma_artian'))
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByRole('region', { name: '生産計画の停止' }, { timeout: 5000 })).toBeInTheDocument()
      // A stale Plan cannot record a save point.
      expect(recordButton()).toBeDisabled()
      expect(screen.getByText('作成プランが停止しているため、ゲーム内セーブ地点は記録できません。')).toBeInTheDocument()

      await undoThroughDialog(user)
      expect(await screen.findByText('Step 1 / 2', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active', recalculationReasons: [] })
      expect(await planHistory(database, fixture.plan)).toEqual([])
    }), 20_000)

  it('undoes operation_uncertain from its recovery screen', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: fixture.plan.steps[0].id })
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByRole('region', { name: '操作状況の回復' }, { timeout: 5000 })).toBeInTheDocument()

      const dialog = await undoThroughDialog(user)
      expect(dialog).toHaveTextContent('ゲーム内で行った操作は元に戻りません。')
      expect(await screen.findByText('Step 1 / 5', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active', recalculationReasons: [] })
      expect(await planHistory(database, fixture.plan)).toEqual([])
    }), 20_000)

  it('undoes the Step that completed the Plan and returns to the Navigator', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('生産計画が完了しました')).toBeInTheDocument()

      const dialog = await undoThroughDialog(user)
      expect(dialog).toHaveTextContent('終了した生産計画は、この操作の前の状態に戻ります。')
      expect(await screen.findByText('Step 2 / 2', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active', completedAt: null })
    }), 20_000)

  it('undoes an operation_count_recovered that completed the Plan, back to the recovery', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const { history } = await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: fixture.plan.steps[1].id })
      const expected = fixture.plan.steps[1].expectedResult as NonNullable<PlanStep['expectedResult']>
      await service.recoverOperationCount({
        planId: fixture.plan.id,
        planStepId: fixture.plan.steps[1].id,
        uncertainExecutionHistoryId: history.id,
        observations: [{ kind: 'skills', seriesSkillId: expected.seriesSkillId, groupSkillId: expected.groupSkillId }],
        recoveredPosition: 1,
      })
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'completed' })
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('生産計画が完了しました')).toBeInTheDocument()

      const dialog = await undoThroughDialog(user)
      expect(dialog).toHaveTextContent('現在位置の確認による再開')
      expect(await screen.findByRole('region', { name: '操作状況の回復' }, { timeout: 5000 })).toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({
        status: 'stale',
        recalculationReasons: ['execution_operation_uncertain'],
      })
    }), 20_000)

  it('undoes a compromise finish and returns to the running Plan', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      await finishAsCompromise(service, database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('妥協品として現在の生産計画を終了しました')).toBeInTheDocument()
      // An ended Plan offers no save point and no abandonment.
      expect(screen.queryByRole('button', { name: 'ゲーム内セーブ済みとして記録' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '現在Planを破棄する' })).not.toBeInTheDocument()

      const dialog = await undoThroughDialog(user)
      expect(dialog).toHaveTextContent('戻す操作: 妥協品として確定して終了')
      expect(await screen.findByText('Step 2 / 5', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active', abandonmentReason: null })
    }), 20_000)

  it('offers no Undo after a user abandonment', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await confirmCurrent(service, database, fixture.plan)
      const stored = await currentPlan(database, fixture.plan)
      await service.abandonProductionPlan({
        planId: stored.id,
        observedPlan: { status: stored.status, currentStepId: stored.currentStepId, updatedAt: stored.updatedAt },
        savePointDecision: null,
      })
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('作成プランを破棄しました')).toBeInTheDocument()
      expect(undoButton()).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '実行状態の管理' })).not.toBeInTheDocument()
    }), 20_000)
})

describe('ExecutionNavigatorPage game save point with the real runtime', () => {
  it('records only after confirming, overwrites only after confirming, and adds no record', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await controls()

      await user.click(recordButton())
      let dialog = await screen.findByRole('dialog', { name: 'ゲーム内セーブ地点を記録します' })
      expect(dialog).toHaveTextContent('アプリはゲームのセーブを自動では判別しません。')
      await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await dialogClosed()
      expect(deps.recordExecutionSavePoint).not.toHaveBeenCalled()

      await user.click(recordButton())
      dialog = await screen.findByRole('dialog', { name: 'ゲーム内セーブ地点を記録します' })
      await user.click(within(dialog).getByRole('button', { name: 'ゲーム内セーブ済みとして記録' }))
      expect(await screen.findByText('ゲーム内セーブ地点を記録しました。', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(deps.recordExecutionSavePoint).toHaveBeenCalledExactlyOnceWith({ planId: fixture.plan.id })
      await dialogClosed()
      expect(await controls()).toHaveTextContent('最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）')
      // Recording is not a Step: the Plan stays and no ExecutionHistory is added.
      expect(screen.getByText('Step 1 / 5')).toBeInTheDocument()
      expect(await planHistory(database, fixture.plan)).toEqual([])
      // The save point is the current position: nothing to restore.
      expect(restoreButton()).not.toBeInTheDocument()
      expect(screen.getByText('現在地点がセーブ地点のため、戻す操作はありません。')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '結果一致・次へ' }))
      expect(await screen.findByText('Step 2 / 5')).toBeInTheDocument()
      await user.click(recordButton())
      dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点を更新します' })
      expect(dialog).toHaveTextContent('現在記録されているセーブ地点は上書きされます。')
      await user.click(within(dialog).getByRole('button', { name: '現在地点で上書き' }))
      await dialogClosed()
      await waitFor(async () => expect(await controls()).toHaveTextContent('最後のゲーム内セーブ地点: Step 1完了時点'))
      expect(deps.recordExecutionSavePoint).toHaveBeenCalledTimes(2)
      expect(await planHistory(database, fixture.plan)).toHaveLength(1)
    }), 20_000)

  it('restores the save point only after the game-side confirmation, keeping the save point', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { service, deps } = await realRuntime(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('Step 2 / 5')).toBeInTheDocument()

      await user.click(restoreButton() as HTMLElement)
      const dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
      expect(dialog).toHaveTextContent('最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）')
      expect(dialog).toHaveTextContent('ゲーム進行と無関係なデータは戻しません。')
      const confirm = within(dialog).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' })
      expect(confirm).toBeDisabled()
      await user.click(within(dialog).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
      await user.click(confirm)

      expect(await screen.findByText('Step 1 / 5', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(deps.restoreExecutionSavePoint).toHaveBeenCalledExactlyOnceWith({
        planId: fixture.plan.id,
        recordedAt: savePoint.recordedAt,
      })
      expect(screen.getByText(/最後のゲーム内セーブ地点へ戻しました。/)).toBeInTheDocument()
      expect(await planHistory(database, fixture.plan)).toEqual([])
      expect(await database.executionSavePoints.toArray()).toEqual([savePoint])
    }), 20_000)
})

describe('ExecutionNavigatorPage Plan abandonment with the real runtime', () => {
  it('abandons without a save point choice, and cancel changes nothing', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await controls()

      await user.click(abandonButton())
      let dialog = await screen.findByRole('dialog', { name: '現在の生産計画を破棄します' })
      expect(dialog).toHaveTextContent('残りの作成手順は実行されません。')
      expect(dialog).toHaveTextContent('目標武器の優先起点の紐付けは残ります。')
      expect(within(dialog).queryByRole('button', { name: '現在地点を維持' })).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await dialogClosed()
      expect(deps.abandonProductionPlan).not.toHaveBeenCalled()

      await user.click(abandonButton())
      dialog = await screen.findByRole('dialog', { name: '現在の生産計画を破棄します' })
      const stored = await currentPlan(database, fixture.plan)
      const targetsBefore = await database.targetWeapons.toArray()
      expect(targetsBefore.some(({ preferredOwnedWeaponId }) => preferredOwnedWeaponId !== null)).toBe(true)
      await user.click(within(dialog).getByRole('button', { name: '作成プランを破棄する' }))
      expect(await screen.findByText('作成プランを破棄しました', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(deps.abandonProductionPlan).toHaveBeenCalledExactlyOnceWith({
        planId: fixture.plan.id,
        observedPlan: { status: 'active', currentStepId: stored.currentStepId, updatedAt: stored.updatedAt },
        savePointDecision: null,
      })
      await dialogClosed()
      expect(screen.getByText('現在状態から必要に応じて再計画できます。')).toBeInTheDocument()
      // An ordinary abandonment asks for no RNG re-identification.
      expect(screen.queryByRole('link', { name: 'RNG状態設定へ' })).not.toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'abandoned', abandonmentReason: 'user_abandoned' })
      // Target preferences are kept exactly as they were.
      expect(await database.targetWeapons.toArray()).toEqual(targetsBefore)
    }), 20_000)

  it('keeps the current state when chosen past the save point', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { service, deps } = await realRuntime(database, fixture)
      const savePoint = await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const before = await planHistory(database, fixture.plan)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('Step 2 / 5')).toBeInTheDocument()

      await user.click(abandonButton())
      const dialog = await screen.findByRole('dialog', { name: '現在の生産計画を破棄します' })
      expect(deps.inspectProductionPlanAbandonment).toHaveBeenCalledExactlyOnceWith({ planId: fixture.plan.id })
      expect(dialog).toHaveTextContent('この生産計画は、最後のゲーム内セーブ地点より先まで進んでいます。')
      expect(dialog).toHaveTextContent('最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）')
      await user.click(within(dialog).getByRole('button', { name: '現在地点を維持' }))

      expect(await screen.findByText('作成プランを破棄しました', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(deps.abandonProductionPlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        savePointDecision: { kind: 'keep_current', recordedAt: savePoint.recordedAt },
      }))
      expect(deps.restoreExecutionSavePoint).not.toHaveBeenCalled()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'user_abandoned',
        currentStepId: fixture.plan.steps[1].id,
      })
      expect(await planHistory(database, fixture.plan)).toEqual(before)
      expect(await database.executionSavePoints.toArray()).toEqual([])
    }), 20_000)

  it('returns to the save point and abandons in one runtime call, after the game-side confirmation', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      const savePoint = (await database.executionSavePoints.toArray())[0]
      // Past the save point, the production-target Normal is registered and in progress.
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      await confirmCurrent(service, database, fixture.plan)
      const registered = (await database.ownedWeapons.toArray()).filter(({ executionInProgress }) => executionInProgress !== null)
      expect(registered).toHaveLength(1)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('Step 4 / 5')).toBeInTheDocument()

      await user.click(abandonButton())
      const dialog = await screen.findByRole('dialog', { name: '現在の生産計画を破棄します' })
      await user.click(within(dialog).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))
      const confirm = within(dialog).getByRole('button', { name: 'セーブ地点へ戻して破棄する' })
      expect(confirm).toBeDisabled()
      expect(deps.abandonProductionPlan).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
      await user.click(confirm)

      expect(await screen.findByText('作成プランを破棄しました', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(deps.abandonProductionPlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        savePointDecision: { kind: 'restore_save_point', recordedAt: savePoint.recordedAt },
      }))
      // The restore is the abandonment's own transaction, never a separate call.
      expect(deps.restoreExecutionSavePoint).not.toHaveBeenCalled()
      expect(await currentPlan(database, fixture.plan)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'user_abandoned',
        currentStepId: fixture.plan.steps[0].id,
      })
      expect(await planHistory(database, fixture.plan)).toEqual([])
      expect(await database.executionSavePoints.toArray()).toEqual([])
      expect(await database.ownedWeapons.get(registered[0].id)).toBeUndefined()
      expect((await database.ownedWeapons.toArray()).filter(({ executionInProgress }) => executionInProgress !== null)).toEqual([])
      expect(await database.rngState.get('current')).toEqual(savePoint.rngState)
    }), 20_000)
})

describe('ExecutionNavigatorPage state controls fail closed', () => {
  it('refuses an Undo whose record is no longer the latest, and undoes nothing else', async () => {
    const fixture = await newNormalFixture()
    const snapshot = mockedSnapshot(fixture)
    const deps = mockedRuntime(snapshot)
    vi.mocked(deps.undoLatestExecution).mockRejectedValue(new ExecutionRuntimeError('undo_history_not_latest', 'newer'))
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await controls()
    await undoThroughDialog(user)
    expect(await screen.findByText('表示後に新しい操作が記録されたため、Undoしませんでした。最新の状態を読み込み直しました。')).toBeInTheDocument()
    expect(deps.undoLatestExecution).toHaveBeenCalledExactlyOnceWith({ planId: fixture.plan.id, executionHistoryId: 'history.shown' })
    await waitFor(() => expect(deps.loadSnapshot).toHaveBeenCalledTimes(2))
  })

  it('fails closed when the save point changed after it was shown', async () => {
    const fixture = await newNormalFixture()
    const deps = mockedRuntime(mockedSnapshot(fixture))
    vi.mocked(deps.restoreExecutionSavePoint).mockRejectedValue(new ExecutionRuntimeError('save_point_changed', 'again'))
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await controls()
    await user.click(restoreButton() as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
    expect(dialog).toHaveTextContent('最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）')
    await user.click(within(dialog).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
    await user.click(within(dialog).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' }))
    expect(await screen.findByText(/表示後にゲーム内セーブ地点の記録が変わったため、操作を確定しませんでした。/)).toBeInTheDocument()
    expect(deps.restoreExecutionSavePoint).toHaveBeenCalledExactlyOnceWith({
      planId: fixture.plan.id,
      recordedAt: '2026-09-18T01:00:00.000Z',
    })
  })

  it.each(['save_point_required_entity_missing', 'save_point_snapshot_invalid'] as const)(
    'explains that a %s save point cannot be restored safely',
    async (code) => {
      const fixture = await newNormalFixture()
      const deps = mockedRuntime(mockedSnapshot(fixture))
      vi.mocked(deps.restoreExecutionSavePoint).mockRejectedValue(new ExecutionRuntimeError(code, 'unsafe'))
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await controls()
      await user.click(restoreButton() as HTMLElement)
      const dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
      await user.click(within(dialog).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
      await user.click(within(dialog).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' }))
      const message = await screen.findByText(/このセーブ地点を安全に復元できません。/)
      expect(message).toHaveTextContent('必要な所持武器・目標武器・作成リストの状態を確認し、現在状態から再計画してください。')
      expect(message).not.toHaveTextContent(code)
    },
  )

  it('keeps the shown save point when the record is refused', async () => {
    const fixture = await newNormalFixture()
    const deps = mockedRuntime(mockedSnapshot(fixture))
    vi.mocked(deps.recordExecutionSavePoint).mockRejectedValue(new ExecutionRuntimeError('execution_state_mismatch', 'diverged'))
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    expect(await controls()).toHaveTextContent('最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）')
    await user.click(recordButton())
    const dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点を更新します' })
    await user.click(within(dialog).getByRole('button', { name: '現在地点で上書き' }))
    expect(await screen.findByText('現在の保存状態が、このStep開始時の想定と一致しません。')).toBeInTheDocument()
    expect(screen.queryByText('ゲーム内セーブ地点を記録しました。')).not.toBeInTheDocument()
    expect(await controls()).toHaveTextContent('最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）')
  })

  it('reloads and abandons nothing when the Plan changed after the inspection', async () => {
    const fixture = await newNormalFixture()
    const snapshot = mockedSnapshot(fixture)
    const deps = mockedRuntime(snapshot)
    vi.mocked(deps.inspectProductionPlanAbandonment).mockResolvedValue({
      planId: snapshot.plan.id,
      planStatus: 'active',
      planCurrentStepId: snapshot.plan.currentStepId,
      planUpdatedAt: snapshot.plan.updatedAt,
      savePointChoiceRequired: true,
      savePointRecordedAt: '2026-09-18T01:00:00.000Z',
      savePointLastExecutionHistoryId: null,
      savePointCurrentStepId: snapshot.plan.steps[0].id,
    })
    vi.mocked(deps.abandonProductionPlan).mockRejectedValue(new ExecutionRuntimeError('plan_abandon_state_changed', 'moved'))
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await controls()

    // Cancel from the choice calls nothing.
    await user.click(abandonButton())
    let dialog = await screen.findByRole('dialog', { name: '現在の生産計画を破棄します' })
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await dialogClosed()
    expect(deps.abandonProductionPlan).not.toHaveBeenCalled()

    await user.click(abandonButton())
    dialog = await screen.findByRole('dialog', { name: '現在の生産計画を破棄します' })
    await user.click(within(dialog).getByRole('button', { name: '現在地点を維持' }))
    expect(await screen.findByText('表示後に作成プランの状態が変わったため、破棄しませんでした。最新の状態を読み込み直しました。')).toBeInTheDocument()
    expect(deps.abandonProductionPlan).toHaveBeenCalledExactlyOnceWith({
      planId: snapshot.plan.id,
      observedPlan: { status: 'active', currentStepId: snapshot.plan.currentStepId, updatedAt: snapshot.plan.updatedAt },
      savePointDecision: { kind: 'keep_current', recordedAt: '2026-09-18T01:00:00.000Z' },
    })
    await waitFor(() => expect(deps.loadSnapshot).toHaveBeenCalledTimes(2))
  })
})
