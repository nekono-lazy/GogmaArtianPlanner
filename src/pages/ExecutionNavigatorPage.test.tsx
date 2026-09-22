import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../db/AppDatabase'
import { deriveOperationCountRecovery, ExecutionRuntimeError } from '../domain/execution'
import {
  getProductionAvailableBonusTypeIds,
  getProductionAvailableRanksForBonusType,
} from '../domain/artian/productionBonusAvailability'
import { loadMasterData } from '../domain/master/loadMasterData'
import { getSeriesSkillOptions } from '../domain/master/masterSelectors'
import type {
  ExecutionAction,
  ExecutionHistory,
  ExecutionSavePoint,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStep,
  ProductionPlan,
  RecalculationReason,
  RestorationBonusSet,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  alternativePracticalBonuses,
  idealBonuses,
  practicalBonuses,
  sameLayoutLowerRanks,
} from '../test/fixtures/constrainedEnumeration'
import {
  planFor,
  blindFixture,
  checkpointFixture,
  dump,
  existingGogmaFixture,
  newNormalFixture,
  OTHER_WEAPON_ID,
  otherWeaponCheckpointFixture,
  ownedNormalFixture,
  sameWeaponWindowFixture,
  seed,
  startReachedCheckpointFixture,
  withDatabase,
  executionService,
  type ExecutionFixture,
} from '../test/fixtures/executionRuntime'
import { orchestrationEntry, orchestrationScenario, orchestrationSource, orchestrationTarget, resetRoute } from '../test/fixtures/plannerConstrainedOrchestration'
import { hasStyleRule } from '../test/cssRuleAssertions'
import { ExecutionNavigatorPage } from './ExecutionNavigatorPage'
import {
  loadExecutionNavigatorSnapshot,
  type ExecutionNavigatorPageDependencies,
  type ExecutionNavigatorSnapshot,
} from '../services/execution/executionNavigatorDependencies'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderNavigator(deps: ExecutionNavigatorPageDependencies, planId: string) {
  const router = createMemoryRouter(
    [
      { path: '/plans/:planId/run', element: <ExecutionNavigatorPage dependencies={deps} /> },
      { path: '/plans/:planId', element: <div>Plan page destination</div> },
      { path: '/build-list', element: <div>Build list destination</div> },
    ],
    { initialEntries: [`/plans/${planId}/run`] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

/**
 * The real Execution runtime over a real Dexie database and a Plan the real
 * Planner produced; the service calls are wrapped only to observe requests.
 */
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

/** A mocked runtime over one fixed snapshot. */
function mockedRuntime(snapshot: ExecutionNavigatorSnapshot | null, master = createValidMasterDataFixture()) {
  const deps: ExecutionNavigatorPageDependencies = {
    master,
    currentCalculationContext: structuredClone(
      snapshot?.plan.calculationContext ?? {
        gameVersion: 'x',
        masterDataVersion: 1,
        rngEngineVersion: 'x',
        appSchemaVersion: 12,
      },
    ),
    loadSnapshot: vi.fn(async () => (snapshot === null ? null : structuredClone(snapshot))),
    confirmExpectedPlanStep: vi.fn(async () => {
      throw new Error('confirmExpectedPlanStep is not expected')
    }),
    finishProductionPlanAsCompromise: vi.fn(async () => {
      throw new Error('finishProductionPlanAsCompromise is not expected')
    }),
    recordActualResultDifferent: vi.fn(async () => {
      throw new Error('recordActualResultDifferent is not expected')
    }),
    recordOperationUncertain: vi.fn(async () => {
      throw new Error('recordOperationUncertain is not expected')
    }),
    recoverOperationCount: vi.fn(async () => {
      throw new Error('recoverOperationCount is not expected')
    }),
    undoLatestExecution: vi.fn(async () => {
      throw new Error('undoLatestExecution is not expected')
    }),
    recordExecutionSavePoint: vi.fn(async () => {
      throw new Error('recordExecutionSavePoint is not expected')
    }),
    restoreExecutionSavePoint: vi.fn(async () => {
      throw new Error('restoreExecutionSavePoint is not expected')
    }),
    inspectProductionPlanAbandonment: vi.fn(async () => {
      throw new Error('inspectProductionPlanAbandonment is not expected')
    }),
    abandonProductionPlan: vi.fn(async () => {
      throw new Error('abandonProductionPlan is not expected')
    }),
  }
  return deps
}

async function snapshotOf(fixture: ExecutionFixture, plan: Partial<ProductionPlan> = {}): Promise<ExecutionNavigatorSnapshot> {
  return {
    plan: { ...structuredClone(fixture.plan), status: 'active', ...plan },
    ownedWeapons: structuredClone(fixture.built.input.ownedWeapons),
    targetWeapons: structuredClone(fixture.built.input.targetWeapons),
    buildListEntries: structuredClone(fixture.built.input.buildListEntries),
    latestExecutionHistory: null,
    executionSavePoint: null,
    operationCountRecovery: { kind: 'unavailable', reason: 'not_operation_uncertain' },
    undo: { kind: 'unavailable' },
    savePointRestore: { kind: 'no_save_point' },
    reidentificationReminder: { kind: 'none' },
  }
}

const primary = () => screen.getByRole('button', { name: '結果一致・次へ' })

describe('ExecutionNavigatorPage load states', () => {
  it('shows not-found for a missing Plan', async () => {
    const deps = mockedRuntime(null)
    renderNavigator(deps, 'plan.missing')
    expect(await screen.findByText('指定された生産計画が見つかりません。')).toBeInTheDocument()
    expect(deps.loadSnapshot).toHaveBeenCalledExactlyOnceWith('plan.missing')
  })

  it('shows a loading status before the Plan resolves', async () => {
    const fixture = await newNormalFixture()
    const pending = deferred<ExecutionNavigatorSnapshot | null>()
    const deps = mockedRuntime(await snapshotOf(fixture))
    vi.mocked(deps.loadSnapshot).mockReturnValue(pending.promise)
    renderNavigator(deps, fixture.plan.id)
    expect(screen.getByRole('status')).toHaveTextContent('生産計画を読み込んでいます。')
    pending.resolve(await snapshotOf(fixture))
    expect(await screen.findByText('Step 1 / 5')).toBeInTheDocument()
  })

  it.each([
    ['stale', { status: 'stale' as const, recalculationReasons: ['unexpected_result' as const] }, 'この計画は再計算が必要です'],
    ['completed', { status: 'completed' as const }, '生産計画が完了しました'],
    ['abandoned', { status: 'abandoned' as const, abandonmentReason: 'user_abandoned' as const }, '作成プランを破棄しました'],
    ['draft', { status: 'draft' as const }, 'この生産計画はまだ開始されていません'],
  ])('shows a %s Plan without any Step action', async (_, plan, title) => {
    const fixture = await newNormalFixture()
    renderNavigator(mockedRuntime(await snapshotOf(fixture, plan)), fixture.plan.id)
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /確定/ })).not.toBeInTheDocument()
  })

  it('shows the abandonment reason of an ended Plan', async () => {
    const fixture = await newNormalFixture()
    renderNavigator(
      mockedRuntime(await snapshotOf(fixture, { status: 'abandoned', abandonmentReason: 'replan_adopted' })),
      fixture.plan.id,
    )
    expect(await screen.findByText(/終了理由: 再計画を採用/)).toBeInTheDocument()
  })

  it('offers only the completed-Plan destinations when the Plan is completed', async () => {
    const fixture = await newNormalFixture()
    renderNavigator(mockedRuntime(await snapshotOf(fixture, { status: 'completed' })), fixture.plan.id)
    expect(await screen.findByRole('link', { name: '所持武器を見る' })).toHaveAttribute('href', '/owned-weapons')
    expect(screen.getByRole('link', { name: '目標武器を見る' })).toHaveAttribute('href', '/target-weapons')
    expect(screen.getByRole('link', { name: '作成プランを見る' })).toHaveAttribute('href', `/plans/${fixture.plan.id}`)
  })
})

describe('ExecutionNavigatorPage ordinary Steps with the real runtime', () => {
  it('walks a new Normal Route to completion one confirmed Step at a time', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)

      // Step 1: a Counter-advance Normal, which names no weapon.
      expect(await screen.findByText('Step 1 / 5')).toBeInTheDocument()
      expect(screen.getByText('完了 0件')).toBeInTheDocument()
      expect(screen.getByText('残り 5件')).toBeInTheDocument()
      expect(screen.getByText('Counter進行用の作成です。この武器は所持武器として登録しません。')).toBeInTheDocument()
      expect(screen.queryByText('使用する武器')).not.toBeInTheDocument()
      expect(screen.queryByText('この後巨戟化する作成対象です。')).not.toBeInTheDocument()

      await user.click(primary())
      expect(await screen.findByText('Step 2 / 5')).toBeInTheDocument()
      expect(deps.confirmExpectedPlanStep).toHaveBeenNthCalledWith(1, {
        planId: fixture.plan.id,
        planStepId: fixture.plan.steps[0].id,
      })
      await user.click(primary())

      // Step 3: the production-target Normal.
      expect(await screen.findByText('Step 3 / 5')).toBeInTheDocument()
      expect(screen.getByText('この後巨戟化する作成対象です。')).toBeInTheDocument()
      expect(screen.queryByText('Counter進行用の作成です。この武器は所持武器として登録しません。')).not.toBeInTheDocument()
      await user.click(primary())

      // Step 4: the registered weapon is now named from the persisted state.
      expect(await screen.findByText('Step 4 / 5')).toBeInTheDocument()
      const registered = await database.ownedWeapons.get('owned.orchestration.created.1' as OwnedWeaponId)
      expect(registered).toBeDefined()
      expect(screen.getByText('使用する武器').nextElementSibling).toHaveTextContent(registered?.name ?? '')
      // The first compared Step has no weapon to switch from.
      expect(screen.queryByText(/作業する武器を/)).not.toBeInTheDocument()
      await user.click(primary())

      // Step 5 completes the Target, from `targetCompletions` only.
      expect(await screen.findByText('Step 5 / 5')).toBeInTheDocument()
      const targetName = fixture.built.input.targetWeapons[0].name
      expect(screen.getByText(`このStepで「${targetName}」が完成します`)).toBeInTheDocument()
      // Same weapon as Step 4: no switch guidance.
      expect(screen.queryByText(/作業する武器を/)).not.toBeInTheDocument()
      await user.click(primary())

      expect(await screen.findByText('生産計画が完了しました')).toBeInTheDocument()
      expect(screen.getByText(`「${targetName}」が完成しました`)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
      expect(deps.confirmExpectedPlanStep).toHaveBeenCalledTimes(5)
      expect((await database.productionPlans.get(fixture.plan.id))?.status).toBe('completed')
    }))

  it('shows no weapon switch guidance between Steps on the same weapon', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('Step 1 / 2')).toBeInTheDocument()
      expect(screen.getByText('使用する武器').nextElementSibling).toHaveTextContent('Constrained fixture owned.execution.gogma')
      await user.click(primary())
      expect(await screen.findByText('Step 2 / 2')).toBeInTheDocument()
      expect(screen.queryByText(/作業する武器を/)).not.toBeInTheDocument()
      expect(primary()).toBeEnabled()
    }))
})

describe('ExecutionNavigatorPage submission safety', () => {
  it('confirms a Step once even when the primary action is pressed twice', async () => {
    const fixture = await newNormalFixture()
    const deps = mockedRuntime(await snapshotOf(fixture))
    const pending = deferred<never>()
    vi.mocked(deps.confirmExpectedPlanStep).mockReturnValue(pending.promise)
    // The second press lands on the disabled button on purpose.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderNavigator(deps, fixture.plan.id)
    const button = await screen.findByRole('button', { name: '結果一致・次へ' })
    await user.click(button)
    await user.click(button)
    expect(deps.confirmExpectedPlanStep).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(screen.getByText('操作を保存しています。')).toBeInTheDocument()
    // Nothing moves on before the runtime answered.
    expect(screen.getByText('Step 1 / 5')).toBeInTheDocument()
    pending.reject(new Error('late failure'))
    expect(await screen.findByText('操作を確定できませんでした。状態は変更されていません。')).toBeInTheDocument()
  })

  it('keeps the Step and shows recalculation guidance on a state mismatch', async () => {
    const fixture = await newNormalFixture()
    const deps = mockedRuntime(await snapshotOf(fixture))
    vi.mocked(deps.confirmExpectedPlanStep).mockRejectedValue(
      new ExecutionRuntimeError('execution_state_mismatch', 'mismatch'),
    )
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '結果一致・次へ' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('現在の保存状態が、このStep開始時の想定と一致しません。')
    expect(within(alert).getByRole('link', { name: '作成プランを見る' })).toHaveAttribute('href', `/plans/${fixture.plan.id}`)
    expect(within(alert).getByRole('link', { name: 'ビルドリストへ' })).toHaveAttribute('href', '/build-list')
    expect(alert).not.toHaveTextContent('mismatch')
    expect(screen.getByText('Step 1 / 5')).toBeInTheDocument()
    expect(primary()).toBeEnabled()
  })

  it('reloads the persisted Plan when the Step is no longer current', async () => {
    const fixture = await newNormalFixture()
    const deps = mockedRuntime(await snapshotOf(fixture))
    vi.mocked(deps.confirmExpectedPlanStep).mockRejectedValue(
      new ExecutionRuntimeError('step_not_current', 'moved'),
    )
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '結果一致・次へ' }))
    expect(await screen.findByText(/このStepは現在のStepではありません/)).toBeInTheDocument()
    await waitFor(() => expect(deps.loadSnapshot).toHaveBeenCalledTimes(2))
  })

  it('ignores a result that arrives after the navigator was left', async () => {
    const fixture = await newNormalFixture()
    const deps = mockedRuntime(await snapshotOf(fixture))
    const pending = deferred<ExecutionNavigatorSnapshot | null>()
    const user = userEvent.setup()
    const { router } = renderNavigator(deps, fixture.plan.id)
    await screen.findByText('Step 1 / 5')
    // The post-confirmation reload stays pending, and the next route never loads.
    vi.mocked(deps.loadSnapshot)
      .mockReturnValueOnce(pending.promise)
      .mockReturnValue(new Promise(() => undefined))
    vi.mocked(deps.confirmExpectedPlanStep).mockResolvedValue({} as never)
    await user.click(primary())
    await waitFor(() => expect(deps.loadSnapshot).toHaveBeenCalledTimes(2))
    await router.navigate('/plans/plan.other/run')
    pending.resolve(await snapshotOf(fixture, { status: 'completed' }))
    // The new route's own load is still pending: the old completion never lands.
    await waitFor(() => expect(deps.loadSnapshot).toHaveBeenLastCalledWith('plan.other'))
    expect(screen.queryByText('生産計画が完了しました')).not.toBeInTheDocument()
  })
})

describe('ExecutionNavigatorPage blind observation', () => {
  async function blindSnapshot() {
    const fixture = await blindFixture()
    const snapshot = await snapshotOf(fixture)
    // A real weapon type / element so the Production availability applies.
    snapshot.targetWeapons = snapshot.targetWeapons.map(
      (target): TargetWeapon => ({ ...target, weaponTypeId: 'weapon.long_sword', elementId: 'element.fire' }),
    )
    return { fixture, snapshot }
  }

  it('asks for the observed five slots instead of offering a match confirmation', async () => {
    const master = loadMasterData()
    if (!master.ok) throw new Error('master')
    const { fixture, snapshot } = await blindSnapshot()
    const deps = mockedRuntime(snapshot, master.data)
    vi.mocked(deps.confirmExpectedPlanStep).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)

    const submit = await screen.findByRole('button', { name: '実際の5枠を入力して確定' })
    expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
    expect(screen.getByText('これは予測ではなく、ゲーム画面で確認した実際の5枠です。')).toBeInTheDocument()
    expect(screen.getByText('想定結果: ゲーム画面で確認した5枠を入力')).toBeInTheDocument()
    expect(submit).toBeDisabled()

    // No fabricated initial value: every slot starts empty.
    const typeSelects = [1, 2, 3, 4, 5].map((slot) => screen.getByRole('combobox', { name: `枠${slot} ボーナス種別` }))
    typeSelects.forEach((select) => expect(select.textContent?.replace(/[^\p{L}\p{N}]/gu, '')).toBe(''))
    expect(screen.queryByText(/Productionで抽選されない現在値/)).not.toBeInTheDocument()

    for (const [index, select] of typeSelects.entries()) {
      await user.click(select)
      const options = within(screen.getByRole('listbox')).getAllByRole('option')
      await user.click(options[index % options.length])
      if (index < 4) expect(submit).toBeDisabled()
    }
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(deps.confirmExpectedPlanStep).toHaveBeenCalledOnce()
    const [request] = vi.mocked(deps.confirmExpectedPlanStep).mock.calls[0]
    expect(request.planId).toBe(fixture.plan.id)
    expect(request.planStepId).toBe(fixture.plan.steps[0].id)
    expect(request.observation?.kind).toBe('normal_restoration_bonuses')
    const slots = request.observation?.restorationBonuses as RestorationBonusSet
    expect(slots).toHaveLength(5)
    slots.forEach(({ bonusTypeId, bonusRankId }) => {
      expect(bonusTypeId).not.toBe('')
      expect(bonusRankId).not.toBe('')
    })
  })
})

describe('ExecutionNavigatorPage owned Ideal confirmation', () => {
  it('asks for no game operation and confirms through the ordinary Step confirmation', async () => {
    const fixture = await existingGogmaFixture()
    const snapshot = await snapshotOf(fixture)
    const [first] = snapshot.plan.steps
    const target = snapshot.targetWeapons[0]
    const ownedIdeal: PlanStep = {
      ...first,
      operationType: 'confirm_owned_ideal',
      title: 'Owned ideal fixture title',
      instruction: 'Owned ideal fixture instruction',
      expectedResult: null,
      executionEffects: {
        ...(first.executionEffects as NonNullable<PlanStep['executionEffects']>),
        targetCompletions: [{
          buildListEntryId: first.buildListEntryId as NonNullable<PlanStep['buildListEntryId']>,
          targetWeaponId: target.id,
          ownedWeaponId: first.executionEffects?.trackedOwnedWeaponId as OwnedWeaponId,
        }],
      },
    }
    snapshot.plan.steps = [ownedIdeal]
    snapshot.plan.currentStepId = ownedIdeal.id
    const deps = mockedRuntime(snapshot)
    vi.mocked(deps.confirmExpectedPlanStep).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)

    const button = await screen.findByRole('button', { name: '所持武器で完成を確認' })
    expect(screen.getByText(/この所持武器はすでに目標条件を満たしています。/)).toBeInTheDocument()
    expect(screen.queryByText('Owned ideal fixture instruction')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
    expect(screen.queryByText(/作業する武器を/)).not.toBeInTheDocument()
    expect(screen.getByText(`このStepで「${target.name}」が完成します`)).toBeInTheDocument()
    await user.click(button)
    expect(deps.confirmExpectedPlanStep).toHaveBeenCalledExactlyOnceWith({
      planId: fixture.plan.id,
      planStepId: ownedIdeal.id,
    })
  })
})

describe('ExecutionNavigatorPage weapon switching and checkpoints with the real runtime', () => {
  it('38.5-E: guides A to B to A twice without adding a Step, history or Undo action', () =>
    withDatabase(async (database) => {
      const a = orchestrationSource('owned.acceptance.a', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
      const b = orchestrationSource('owned.acceptance.b', { seriesSkillId: 'series_skill.fixture.z' })
      const targetA = orchestrationTarget('target.acceptance.a')
      const otherSkill = { seriesSkillId: 'series_skill.fixture.z', groupSkillId: null, matchMode: 'all' as const }
      const targetB = orchestrationTarget('target.acceptance.b', { idealSkillCondition: otherSkill, practicalSkillCondition: otherSkill })
      const routeA = resetRoute(a.id)
      routeA.operations.push(...resetRoute(a.id, CONSTRAINED_START_GOGMA_COUNTER + 2).operations)
      const fixture = await planFor(orchestrationScenario({
        targets: [targetA, targetB], ownedWeapons: [a, b],
        entries: [orchestrationEntry('entry.acceptance.a', targetA, routeA),
          orchestrationEntry('entry.acceptance.b', targetB, resetRoute(b.id, CONSTRAINED_START_GOGMA_COUNTER + 1), { seriesSkillId: otherSkill.seriesSkillId })],
        engine: { resetResultAt: (counter) => counter === CONSTRAINED_START_GOGMA_COUNTER ? practicalBonuses() : idealBonuses() },
      }))
      expect(fixture.plan.steps.map((step) => step.executionEffects?.trackedOwnedWeaponId)).toEqual([a.id, b.id, a.id])
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await screen.findByText('Step 1 / 3')
      // xs covers 375px; jsdom verifies emitted CSS, not physical geometry.
      expect(hasStyleRule(primary(), 'width', '100%', '(min-width:0px)')).toBe(true)
      expect(getComputedStyle(primary()).minHeight).toBe('48px')
      expect(screen.queryByRole('button', { name: '武器を切り替えました' })).not.toBeInTheDocument()
      for (const [index, weapon] of [b, a].entries()) {
        await user.click(primary())
        await screen.findByText(`Step ${index + 2} / 3`)
        expect(screen.getByText(`作業する武器を「${weapon.name}」へ切り替えてください`)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
        const before = await dump(database)
        const switchButton = screen.getByRole('button', { name: '武器を切り替えました' })
        expect(hasStyleRule(switchButton, 'width', '100%', '(min-width:0px)')).toBe(true)
        expect(getComputedStyle(switchButton).minHeight).toBe('48px')
        await user.click(switchButton)
        expect(primary()).toBeEnabled()
        expect(await dump(database)).toEqual(before)
        expect(deps.undoLatestExecution).not.toHaveBeenCalled()
        expect(deps.confirmExpectedPlanStep).toHaveBeenCalledTimes(index + 1)
      }
      await user.click(primary())
      await waitFor(async () => expect((await database.productionPlans.get(fixture.plan.id))?.status).toBe('completed'))
      expect(await database.executionHistory.count()).toBe(3)
      expect((await database.productionPlans.get(fixture.plan.id))?.steps).toHaveLength(3)
    }))

  it('guides a switch to another weapon and never persists the acknowledgement', () =>
    withDatabase(async (database) => {
      const fixture = await otherWeaponCheckpointFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      const view = renderNavigator(deps, fixture.plan.id)

      // Step 1 runs on the other weapon; this Entry's start-held checkpoint is
      // already the current state of its own weapon.
      expect(await screen.findByText('Step 1 / 2')).toBeInTheDocument()
      const panel = screen.getByRole('region', { name: '途中採用状態への到達' })
      expect(panel).toHaveTextContent('この武器は開始時点で途中採用状態です。')
      await user.click(within(panel).getByRole('button', { name: '次の操作へ進む' }))
      await user.click(primary())

      // Step 2 on the checkpoint weapon. The panel stays closed for this page
      // session; the checkpoint itself is still held (checked after the reload).
      expect(await screen.findByText('Step 2 / 2')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '途中採用状態への到達' })).not.toBeInTheDocument()

      // Other weapon -> checkpoint weapon: the switch guidance hides the Step actions.
      const historyBefore = await database.executionHistory.toArray()
      const planBefore = await database.productionPlans.get(fixture.plan.id)
      expect(screen.getByText('作業する武器を「Constrained fixture owned.execution.checkpoint」へ切り替えてください')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '武器を切り替えました' }))
      expect(primary()).toBeEnabled()
      expect(await database.executionHistory.toArray()).toEqual(historyBefore)
      expect(await database.productionPlans.get(fixture.plan.id)).toEqual(planBefore)

      // A reload shows both again: the checkpoint is still held because only
      // the other weapon advanced, and the switch was never recorded.
      view.unmount()
      renderNavigator(deps, fixture.plan.id)
      const panel2 = await screen.findByRole('region', { name: '途中採用状態への到達' })
      await user.click(within(panel2).getByRole('button', { name: '次の操作へ進む' }))
      expect(screen.getByText('作業する武器を「Constrained fixture owned.execution.checkpoint」へ切り替えてください')).toBeInTheDocument()
      expect(OTHER_WEAPON_ID).not.toBe(fixture.source.id)
    }))

  it('shows the checkpoint panel right after its Step until the same weapon moves on', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      const view = renderNavigator(deps, fixture.plan.id)

      expect(await screen.findByText('Step 1 / 5')).toBeInTheDocument()
      expect(screen.getByText('このStepで作成リストの途中採用状態に到達します')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '途中採用状態への到達' })).not.toBeInTheDocument()
      await user.click(primary())

      const panel = await screen.findByRole('region', { name: '途中採用状態への到達' })
      expect(panel).toHaveTextContent('作成リストで選んだ途中採用状態に到達しました。')
      expect(panel).toHaveTextContent('この武器は「実用」になりました。')
      expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()

      const historyBefore = await database.executionHistory.toArray()
      await user.click(within(panel).getByRole('button', { name: '次の操作へ進む' }))
      expect(screen.queryByRole('region', { name: '途中採用状態への到達' })).not.toBeInTheDocument()
      expect(await database.executionHistory.toArray()).toEqual(historyBefore)

      // Not persisted: a reload offers it again.
      view.unmount()
      const again = renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByRole('region', { name: '途中採用状態への到達' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '次の操作へ進む' }))
      await user.click(primary())

      // The next Step on the same weapon left the checkpoint behind.
      expect(await screen.findByText('Step 3 / 5')).toBeInTheDocument()
      again.unmount()
      renderNavigator(deps, fixture.plan.id)
      expect(await screen.findByText('Step 3 / 5')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '途中採用状態への到達' })).not.toBeInTheDocument()
    }))

  it('offers a start-held checkpoint before the Entry first physical Step', () =>
    withDatabase(async (database) => {
      const fixture = await startReachedCheckpointFixture()
      const { deps } = await realRuntime(database, fixture)
      renderNavigator(deps, fixture.plan.id)
      const panel = await screen.findByRole('region', { name: '途中採用状態への到達' })
      expect(panel).toHaveTextContent('この武器は開始時点で途中採用状態です。')
      expect(within(panel).getByRole('button', { name: 'この武器を妥協品として確定して終了' })).toBeInTheDocument()
    }))

  it('finishes as a compromise only after the confirmation dialog', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await screen.findByText('Step 1 / 5')
      await user.click(primary())
      const panel = await screen.findByRole('region', { name: '途中採用状態への到達' }, { timeout: 5000 })

      // Cancel: nothing is called.
      await user.click(within(panel).getByRole('button', { name: 'この武器を妥協品として確定して終了' }))
      let dialog = await screen.findByRole('dialog', { name: '妥協品として確定して終了' }, { timeout: 5000 })
      expect(dialog).toHaveAccessibleDescription(/この武器を妥協品として確定し、現在の生産計画を終了します。/)
      expect(dialog).toHaveTextContent('残りの作成手順は実行されません。')
      expect(dialog).toHaveTextContent('未完了の目標武器がある場合は現在状態から再計画できます。')
      await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 5000 })
      expect(deps.finishProductionPlanAsCompromise).not.toHaveBeenCalled()

      // Confirm: the IDs come from the Plan's own checkpoint projection.
      await user.click(within(panel).getByRole('button', { name: 'この武器を妥協品として確定して終了' }))
      dialog = await screen.findByRole('dialog', { name: '妥協品として確定して終了' }, { timeout: 5000 })
      await user.click(within(dialog).getByRole('button', { name: '妥協品として確定して終了' }))

      expect(await screen.findByText('妥協品として現在の生産計画を終了しました', {}, { timeout: 5000 })).toBeInTheDocument()
      // The page behind a closing MUI Dialog stays aria-hidden until the exit
      // transition ends: wait for it, exactly as the Cancel path does.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 5000 })
      expect(deps.finishProductionPlanAsCompromise).toHaveBeenCalledExactlyOnceWith({
        planId: fixture.plan.id,
        planStepId: fixture.plan.steps[1].id,
        buildListEntryId: fixture.entry.id,
        targetWeaponId: fixture.goal.id,
        ownedWeaponId: fixture.source.id,
      })
      expect(screen.getByRole('link', { name: 'ビルドリストへ' })).toHaveAttribute('href', '/build-list')
      expect(screen.getByRole('link', { name: '目標武器へ' })).toHaveAttribute('href', '/target-weapons')
      expect(screen.getByRole('link', { name: '作成プランを見る' })).toHaveAttribute('href', `/plans/${fixture.plan.id}`)
      // No save point choice is offered for a compromise finish.
      expect(screen.queryByText(/セーブ地点/)).not.toBeInTheDocument()
      expect(await database.productionPlans.get(fixture.plan.id)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'finished_as_compromise',
      })
      expect(await database.targetWeapons.get(fixture.goal.id)).toMatchObject({ lifecycleStatus: 'active', preferredOwnedWeaponId: fixture.source.id })
      expect(await database.ownedWeapons.get(fixture.source.id)).toMatchObject({ status: 'practical', executionInProgress: null })
    }), 20_000)
})

/** The real Master and a real weapon type / element, so the Production availability applies. */
function realMaster() {
  const master = loadMasterData()
  if (!master.ok) throw new Error('master')
  return master.data
}

function withRealWeapons(snapshot: ExecutionNavigatorSnapshot): ExecutionNavigatorSnapshot {
  return {
    ...snapshot,
    targetWeapons: snapshot.targetWeapons.map(
      (target): TargetWeapon => ({ ...target, weaponTypeId: 'weapon.long_sword', elementId: 'element.fire' }),
    ),
    ownedWeapons: snapshot.ownedWeapons.map((weapon) => ({
      ...weapon,
      weaponTypeId: 'weapon.long_sword',
      elementId: 'element.fire',
    })),
  }
}

/** Makes the `index`-th Step current, with every earlier Step completed. */
function atStep(snapshot: ExecutionNavigatorSnapshot, index: number, override: Partial<PlanStep> = {}) {
  const steps = snapshot.plan.steps.map((step, position): PlanStep => ({
    ...step,
    isCompleted: position < index,
    ...(position === index ? override : {}),
  }))
  return { ...snapshot, plan: { ...snapshot.plan, steps, currentStepId: steps[index].id } }
}

function divergenceHistory(
  plan: ProductionPlan,
  step: PlanStep,
  action: ExecutionAction,
  recalculationReason: RecalculationReason | null,
): ExecutionHistory {
  return {
    id: `history.${action}.${step.id}`,
    planId: plan.id,
    planStepId: step.id,
    action,
    actualResult: null,
    wasExpected: action === 'confirmed_expected',
    recalculationReason,
    createdAt: '2026-09-18T00:00:00.000Z',
  } as ExecutionHistory
}

/** The persisted state after a divergence record, as the runtime leaves it. */
function staleAfter(
  snapshot: ExecutionNavigatorSnapshot,
  step: PlanStep,
  action: 'actual_result_different' | 'operation_uncertain',
): ExecutionNavigatorSnapshot {
  const reason: RecalculationReason =
    action === 'actual_result_different' ? 'unexpected_result' : 'execution_operation_uncertain'
  const stepIndex = snapshot.plan.steps.findIndex(({ id }) => id === step.id)
  const plan: ProductionPlan = {
    ...structuredClone(snapshot.plan),
    status: 'stale',
    recalculationReasons: [reason],
    // operation_uncertain leaves its Step current; actual_result_different completes it.
    ...(action === 'operation_uncertain'
      ? {
          currentStepId: step.id,
          steps: snapshot.plan.steps.map((candidate, index) => ({ ...candidate, isCompleted: index < stepIndex })),
        }
      : {}),
  }
  const latestExecutionHistory = divergenceHistory(plan, step, action, reason)
  return {
    ...snapshot,
    plan,
    latestExecutionHistory,
    operationCountRecovery: deriveOperationCountRecovery(plan, {
      ownedWeapons: snapshot.ownedWeapons,
      planExecutionHistory: [latestExecutionHistory],
    }),
  }
}

const differentButton = () => screen.queryByRole('button', { name: '結果が違う' })
const uncertainButton = () => screen.queryByRole('button', { name: '何を何回操作したか分からない' })
const recordButton = () => screen.getByRole('button', { name: '実際の結果を記録して計画を停止' })

async function fillFiveSlots(user: ReturnType<typeof userEvent.setup>, submit: HTMLElement) {
  const typeSelects = [1, 2, 3, 4, 5].map((slot) => screen.getByRole('combobox', { name: `枠${slot} ボーナス種別` }))
  // Nothing is copied from the expected result: every slot starts empty.
  typeSelects.forEach((select) => expect(select.textContent?.replace(/[^\p{L}\p{N}]/gu, '')).toBe(''))
  for (const [index, select] of typeSelects.entries()) {
    expect(submit).toBeDisabled()
    await user.click(select)
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    await user.click(options[index % options.length])
  }
}

async function chooseOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string | number) {
  await user.click(screen.getByRole('combobox', { name: label }))
  const listbox = screen.getByRole('listbox')
  const target = typeof option === 'string'
    ? within(listbox).getByRole('option', { name: option })
    : within(listbox).getAllByRole('option').filter((element) => element.getAttribute('aria-disabled') !== 'true')[option]
  await user.click(target)
}

describe('ExecutionNavigatorPage divergence actions per Step', () => {
  it('offers both records on a predicted Normal creation, with normal-scope five slots', async () => {
    const fixture = await newNormalFixture()
    const snapshot = withRealWeapons(await snapshotOf(fixture))
    const deps = mockedRuntime(snapshot, realMaster())
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)

    expect(await screen.findByRole('button', { name: '結果一致・次へ' })).toBeEnabled()
    expect(differentButton()).toBeInTheDocument()
    expect(uncertainButton()).toBeInTheDocument()
    // The divergence records sit in their own section below the primary action.
    expect(screen.getByRole('group', { name: '想定外の結果を記録' })).not.toContainElement(primary())

    await user.click(differentButton() as HTMLElement)
    const form = screen.getByRole('region', { name: '実際の結果の入力' })
    expect(within(form).getByText('実際の復元ボーナス5枠')).toBeInTheDocument()
    // No scope choice and no Skill input for a Normal creation.
    expect(within(form).queryByText(/scope|スコープ/i)).not.toBeInTheDocument()
    expect(within(form).queryByRole('combobox', { name: '実際のシリーズスキル' })).not.toBeInTheDocument()
    // The primary action is replaced while the actual result is entered.
    expect(screen.queryByRole('button', { name: '結果一致・次へ' })).not.toBeInTheDocument()
  })

  it('offers only the uncertain record on a blind production-target Normal', async () => {
    const fixture = await blindFixture()
    const deps = mockedRuntime(withRealWeapons(await snapshotOf(fixture)), realMaster())
    renderNavigator(deps, fixture.plan.id)
    expect(await screen.findByRole('button', { name: '実際の5枠を入力して確定' })).toBeDisabled()
    expect(differentButton()).not.toBeInTheDocument()
    expect(uncertainButton()).toBeInTheDocument()
  })

  it.each(['reset_bonuses', 'keep_bonuses'] as const)('offers both records on %s with five slots', async (operationType) => {
    const fixture = await existingGogmaFixture()
    const snapshot = atStep(withRealWeapons(await snapshotOf(fixture)), 0, { operationType })
    const deps = mockedRuntime(snapshot, realMaster())
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await screen.findByRole('button', { name: '結果一致・次へ' })
    expect(uncertainButton()).toBeInTheDocument()
    await user.click(differentButton() as HTMLElement)
    expect(screen.getByText('実際の復元ボーナス5枠')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '実際のシリーズスキル' })).not.toBeInTheDocument()
  })

  it.each([
    ['convert_normal_to_gogma', ownedNormalFixture, 0],
    ['reset_skills', existingGogmaFixture, 1],
  ] as const)('offers both records on %s with a Series / Group Skill input', async (operationType, make, index) => {
    const fixture = await make()
    const snapshot = atStep(withRealWeapons(await snapshotOf(fixture)), index)
    expect(snapshot.plan.steps[index].operationType).toBe(operationType)
    const deps = mockedRuntime(snapshot, realMaster())
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await screen.findByRole('button', { name: '結果一致・次へ' })
    expect(uncertainButton()).toBeInTheDocument()
    await user.click(differentButton() as HTMLElement)
    expect(screen.getByRole('combobox', { name: '実際のシリーズスキル' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '実際のグループスキル' })).toBeInTheDocument()
    expect(screen.queryByText('実際の復元ボーナス5枠')).not.toBeInTheDocument()
  })

  it('offers neither record on an owned Ideal confirmation', async () => {
    const fixture = await existingGogmaFixture()
    const snapshot = atStep(await snapshotOf(fixture), 0, { operationType: 'confirm_owned_ideal', expectedResult: null })
    renderNavigator(mockedRuntime(snapshot), fixture.plan.id)
    expect(await screen.findByRole('button', { name: '所持武器で完成を確認' })).toBeInTheDocument()
    expect(differentButton()).not.toBeInTheDocument()
    expect(uncertainButton()).not.toBeInTheDocument()
  })

  it('offers neither record on a legacy Step', async () => {
    const fixture = await existingGogmaFixture()
    const snapshot = atStep(await snapshotOf(fixture), 0, { operationType: 'reserve_weapon' })
    renderNavigator(mockedRuntime(snapshot), fixture.plan.id)
    expect(await screen.findByText('このStepは現在の実行形式ではないため、実行ナビでは確定できません。')).toBeInTheDocument()
    expect(differentButton()).not.toBeInTheDocument()
    expect(uncertainButton()).not.toBeInTheDocument()
  })
})

describe('ExecutionNavigatorPage actual result different', () => {
  it('records the entered five slots with the fixed normal scope and shows the recovery', async () => {
    const fixture = await newNormalFixture()
    const snapshot = withRealWeapons(await snapshotOf(fixture))
    const [create] = snapshot.plan.steps
    const deps = mockedRuntime(snapshot, realMaster())
    const pending = deferred<never>()
    vi.mocked(deps.recordActualResultDifferent).mockReturnValue(pending.promise)
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderNavigator(deps, fixture.plan.id)

    await user.click(await screen.findByRole('button', { name: '結果が違う' }))
    const submit = recordButton()
    await fillFiveSlots(user, submit)
    expect(submit).toBeEnabled()
    await user.click(submit)
    await user.click(submit)

    expect(deps.recordActualResultDifferent).toHaveBeenCalledOnce()
    expect(submit).toBeDisabled()
    const [request] = vi.mocked(deps.recordActualResultDifferent).mock.calls[0]
    expect(request.planId).toBe(fixture.plan.id)
    expect(request.planStepId).toBe(create.id)
    expect(request.actualResult).toMatchObject({ kind: 'restoration_bonuses', restorationBonusScope: 'normal_artian' })
    const slots = (request.actualResult as { restorationBonuses: RestorationBonusSet }).restorationBonuses
    expect(slots).toHaveLength(5)
    slots.forEach(({ bonusTypeId, bonusRankId }) => {
      expect(bonusTypeId).not.toBe('')
      expect(bonusRankId).not.toBe('')
    })
    expect(deps.confirmExpectedPlanStep).not.toHaveBeenCalled()

    // The Navigator never moves the Plan itself: it re-reads the persisted state.
    vi.mocked(deps.loadSnapshot).mockResolvedValue(staleAfter(snapshot, create, 'actual_result_different'))
    pending.resolve({} as never)
    const recovery = await screen.findByRole('region', { name: '生産計画の停止' })
    expect(deps.loadSnapshot).toHaveBeenCalledTimes(2)
    expect(recovery).toHaveTextContent('予測と異なる結果を記録しました')
    expect(recovery).toHaveTextContent('この操作で消費したCounterは反映済みです。')
    expect(within(recovery).getByRole('link', { name: '通常アーティアCounterを再同定する' })).toHaveAttribute('href', '/normal-counters')
    expect(within(recovery).queryByRole('link', { name: '所持武器を確認する' })).not.toBeInTheDocument()
  })

  it('records Gogma-scope five slots on Reset Bonuses', async () => {
    const fixture = await existingGogmaFixture()
    const snapshot = atStep(withRealWeapons(await snapshotOf(fixture)), 0)
    const deps = mockedRuntime(snapshot, realMaster())
    vi.mocked(deps.recordActualResultDifferent).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '結果が違う' }))
    await fillFiveSlots(user, recordButton())
    await user.click(recordButton())
    await waitFor(() => expect(deps.recordActualResultDifferent).toHaveBeenCalledOnce())
    expect(vi.mocked(deps.recordActualResultDifferent).mock.calls[0][0].actualResult).toMatchObject({
      kind: 'restoration_bonuses',
      restorationBonusScope: 'gogma_artian',
    })
  })

  it('records Skills, keeping 未入力 apart from スキルなし', async () => {
    const fixture = await ownedNormalFixture()
    const snapshot = atStep(withRealWeapons(await snapshotOf(fixture)), 0)
    const master = realMaster()
    const deps = mockedRuntime(snapshot, master)
    vi.mocked(deps.recordActualResultDifferent).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '結果が違う' }))

    expect(recordButton()).toBeDisabled()
    await chooseOption(user, '実際のシリーズスキル', 1)
    // Group still 未入力: not the same as none.
    expect(recordButton()).toBeDisabled()
    await chooseOption(user, '実際のグループスキル', 'スキルなし')
    expect(recordButton()).toBeEnabled()
    await user.click(recordButton())

    await waitFor(() => expect(deps.recordActualResultDifferent).toHaveBeenCalledOnce())
    const { actualResult } = vi.mocked(deps.recordActualResultDifferent).mock.calls[0][0]
    expect(actualResult).toEqual({
      kind: 'skills',
      seriesSkillId: getSeriesSkillOptions(master)[0].id,
      groupSkillId: null,
    })
  })

  it('keeps the Step and the input when the runtime says the result matches the expectation', async () => {
    const fixture = await existingGogmaFixture()
    const snapshot = atStep(withRealWeapons(await snapshotOf(fixture)), 1)
    const deps = mockedRuntime(snapshot, realMaster())
    vi.mocked(deps.recordActualResultDifferent).mockRejectedValue(
      new ExecutionRuntimeError('actual_result_matches_expected', 'same'),
    )
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '結果が違う' }))
    await chooseOption(user, '実際のシリーズスキル', 'スキルなし')
    await chooseOption(user, '実際のグループスキル', 'スキルなし')
    await user.click(recordButton())

    const message = await screen.findByText('入力した結果は想定結果と一致しています。「結果一致・次へ」を使用してください。')
    const alert = message.closest('[role="alert"]') as HTMLElement
    expect(alert).not.toBeNull()
    expect(alert).not.toHaveTextContent('same')
    expect(screen.getByText('Step 2 / 2')).toBeInTheDocument()
    expect(deps.loadSnapshot).toHaveBeenCalledOnce()
    // The input survives the refusal, and the user can go back to the primary action.
    expect(screen.getByRole('combobox', { name: '実際のシリーズスキル' })).toHaveTextContent('スキルなし')
    expect(recordButton()).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '入力をやめて戻る' }))
    expect(primary()).toBeEnabled()
    await user.click(differentButton() as HTMLElement)
    expect(screen.getByRole('combobox', { name: '実際のグループスキル' })).toHaveTextContent('スキルなし')
  })
})

describe('ExecutionNavigatorPage operation uncertain', () => {
  it('records only after the confirmation dialog and shows the recovery', async () => {
    const fixture = await existingGogmaFixture()
    const snapshot = atStep(await snapshotOf(fixture), 0)
    const [reset] = snapshot.plan.steps
    const deps = mockedRuntime(snapshot)
    const pending = deferred<never>()
    vi.mocked(deps.recordOperationUncertain).mockReturnValue(pending.promise)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)

    await user.click(await screen.findByRole('button', { name: '何を何回操作したか分からない' }))
    let dialog = await screen.findByRole('dialog', { name: '操作内容が分からない状態として記録しますか？' })
    expect(dialog).toHaveTextContent('Counterと武器の状態は変更しません。')
    expect(dialog).toHaveTextContent('この生産計画を続行できない状態')
    expect(dialog).toHaveTextContent('RNG状態の再同定が必要です。')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deps.recordOperationUncertain).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '何を何回操作したか分からない' }))
    dialog = await screen.findByRole('dialog', { name: '操作内容が分からない状態として記録しますか？' })
    await user.click(within(dialog).getByRole('button', { name: '操作内容不明として記録' }))
    expect(deps.recordOperationUncertain).toHaveBeenCalledExactlyOnceWith({
      planId: fixture.plan.id,
      planStepId: reset.id,
    })
    // While saving, neither record nor the primary action can be sent again.
    await waitFor(() => expect(uncertainButton()).toBeDisabled())
    expect(primary()).toBeDisabled()
    expect(deps.confirmExpectedPlanStep).not.toHaveBeenCalled()
    expect(deps.recordActualResultDifferent).not.toHaveBeenCalled()

    vi.mocked(deps.loadSnapshot).mockResolvedValue(staleAfter(snapshot, reset, 'operation_uncertain'))
    pending.resolve({} as never)
    const recovery = await screen.findByRole('region', { name: '操作状況の回復' })
    expect(recovery).toHaveTextContent('操作状況を確認できなくなりました')
    expect(recovery).toHaveTextContent('Counterや武器の状態は推測して変更していません。')
    // Never straight to the ordinary Identification.
    expect(screen.queryByRole('link', { name: /再同定/ })).not.toBeInTheDocument()
    expect(deps.recordOperationUncertain).toHaveBeenCalledOnce()
  })
})

describe('ExecutionNavigatorPage stale recovery', () => {
  it.each([
    ['actual_result_different', 0, '/normal-counters', '通常アーティアCounterを再同定する'],
    ['actual_result_different', 3, '/rng', 'RNG状態を再同定する'],
  ] as const)('guides %s of Step %i to %s', async (action, index, href, label) => {
    const fixture = await newNormalFixture()
    const snapshot = await snapshotOf(fixture)
    renderNavigator(mockedRuntime(staleAfter(snapshot, snapshot.plan.steps[index], action)), fixture.plan.id)
    const recovery = await screen.findByRole('region', { name: '生産計画の停止' })
    expect(within(recovery).getByRole('link', { name: label })).toHaveAttribute('href', href)
    expect(within(recovery).getByRole('link', { name: '作成プランを見る' })).toHaveAttribute('href', `/plans/${fixture.plan.id}`)
    expect(within(recovery).getByRole('link', { name: 'ビルドリストへ' })).toHaveAttribute('href', '/build-list')
    expect(screen.queryByText('この計画は再計算が必要です')).not.toBeInTheDocument()
  })

  it.each([0, 3, 4])('never sends operation_uncertain of Step %i to the ordinary Identification', async (index) => {
    const fixture = await newNormalFixture()
    const snapshot = await snapshotOf(fixture)
    renderNavigator(mockedRuntime(staleAfter(snapshot, snapshot.plan.steps[index], 'operation_uncertain')), fixture.plan.id)
    const recovery = await screen.findByRole('region', { name: '操作状況の回復' })
    expect(within(recovery).getByRole('button', { name: '同じ操作を何回行ったか分からない' })).toBeInTheDocument()
    expect(within(recovery).getByRole('button', { name: '別の操作・別の武器を操作してしまった' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /再同定/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'RNG状態設定へ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '生産計画の停止' })).not.toBeInTheDocument()
  })

  it('keeps the generic stale view for an unrelated stale reason', async () => {
    const fixture = await newNormalFixture()
    const snapshot = await snapshotOf(fixture, { status: 'stale', recalculationReasons: ['calculation_context_changed'] })
    snapshot.latestExecutionHistory = divergenceHistory(snapshot.plan, snapshot.plan.steps[0], 'confirmed_expected', null)
    renderNavigator(mockedRuntime(snapshot), fixture.plan.id)
    expect(await screen.findByText('この計画は再計算が必要です')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '生産計画の停止' })).not.toBeInTheDocument()
  })

  it('never takes an older divergence for the cause when the latest record is another one', async () => {
    const fixture = await newNormalFixture()
    // The reason list still carries an old divergence, but the latest record is an ordinary confirmation.
    const snapshot = await snapshotOf(fixture, {
      status: 'stale',
      recalculationReasons: ['unexpected_result', 'manual_recalculate'],
    })
    snapshot.latestExecutionHistory = divergenceHistory(snapshot.plan, snapshot.plan.steps[1], 'confirmed_expected', null)
    renderNavigator(mockedRuntime(snapshot), fixture.plan.id)
    expect(await screen.findByText('この計画は再計算が必要です')).toBeInTheDocument()
    expect(screen.queryByText('予測と異なる結果を記録しました')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /再同定する/ })).not.toBeInTheDocument()
  })
})

describe('ExecutionNavigatorPage divergence records with the real runtime', () => {
  it('records a different Reset Skills result through the real service and reloads the stale Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { deps } = await realRuntime(database, fixture)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)
      await user.click(await screen.findByRole('button', { name: '結果一致・次へ' }))
      expect(await screen.findByText('Step 2 / 2')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '結果が違う' }))
      await chooseOption(user, '実際のシリーズスキル', 0)
      await chooseOption(user, '実際のグループスキル', 'スキルなし')
      await user.click(recordButton())

      const recovery = await screen.findByRole('region', { name: '生産計画の停止' }, { timeout: 5000 })
      expect(recovery).toHaveTextContent('予測と異なる結果を記録しました')
      expect(within(recovery).getByRole('link', { name: 'RNG状態を再同定する' })).toHaveAttribute('href', '/rng')
      expect(deps.recordActualResultDifferent).toHaveBeenCalledOnce()
      const stored = await database.productionPlans.get(fixture.plan.id)
      expect(stored).toMatchObject({ status: 'stale', recalculationReasons: ['unexpected_result'] })
      const history = await database.executionHistory.where('planId').equals(fixture.plan.id).toArray()
      expect(history.map(({ action }) => action).sort()).toEqual(['actual_result_different', 'confirmed_expected'])
    }), 20_000)

  it('records an uncertain operation through the real service without touching Counters or weapons', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      const { deps } = await realRuntime(database, fixture)
      const before = await dump(database)
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)

      await user.click(await screen.findByRole('button', { name: '何を何回操作したか分からない' }))
      const dialog = await screen.findByRole('dialog', { name: '操作内容が分からない状態として記録しますか？' })
      await user.click(within(dialog).getByRole('button', { name: '操作内容不明として記録' }))

      const recovery = await screen.findByRole('region', { name: '操作状況の回復' }, { timeout: 5000 })
      expect(within(recovery).getByRole('button', { name: '同じ操作を何回行ったか分からない' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /再同定/ })).not.toBeInTheDocument()
      const after = await dump(database)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(after.ownedWeapons).toEqual(before.ownedWeapons)
      expect(after.targetWeapons).toEqual(before.targetWeapons)
      const stored = await database.productionPlans.get(fixture.plan.id)
      expect(stored).toMatchObject({
        status: 'stale',
        currentStepId: fixture.plan.steps[0].id,
        recalculationReasons: ['execution_operation_uncertain'],
      })
    }), 20_000)
})

describe('ExecutionNavigatorPage operation_uncertain recovery', () => {
  const master = realMaster()
  const REAL_WEAPON = 'weapon.long_sword'
  const REAL_ELEMENT = 'element.fire'
  /** A Gogma-scope five-slot set picked by option index, exactly as the editor offers it. */
  function realSet(indexes: readonly number[]): RestorationBonusSet {
    const typeIds = getProductionAvailableBonusTypeIds(master, REAL_WEAPON, REAL_ELEMENT, 'gogma_artian')
    return indexes.map((index) => {
      const bonusTypeId = typeIds[index]
      const [rank] = getProductionAvailableRanksForBonusType(master, REAL_WEAPON, REAL_ELEMENT, bonusTypeId, 'gogma_artian')
      return { bonusTypeId, bonusRankId: rank.id }
    }) as RestorationBonusSet
  }
  const BASELINE = [0, 0, 0, 0, 0]
  const A = [1, 0, 0, 0, 0]
  const B = [0, 1, 0, 0, 0]
  const X = [0, 0, 1, 0, 0]
  const I = [1, 1, 0, 0, 0]

  /** Keep x5 on one weapon then Reset Skills, stopped by operation_uncertain at the first Keep. */
  async function keepRecovery(options: { savePoint?: boolean; results?: number[][] } = {}) {
    const fixture = await sameWeaponWindowFixture(
      ['keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'reset_skills'],
      [sameLayoutLowerRanks(), practicalBonuses(), sameLayoutLowerRanks(), alternativePracticalBonuses(), idealBonuses()],
    )
    const base = withRealWeapons(await snapshotOf(fixture))
    // The Plan's recorded results, in real Master IDs the editor can offer.
    const results = options.results ?? [A, B, A, X, I]
    base.plan.steps.slice(0, 5).forEach((step, index) => {
      (step.expectedResult as NonNullable<PlanStep['expectedResult']>).restorationBonuses = realSet(results[index])
    })
    base.ownedWeapons = base.ownedWeapons.map((weapon): OwnedWeapon =>
      weapon.id === fixture.source.id ? { ...weapon, restorationBonuses: realSet(BASELINE) } : weapon)
    const stale = staleAfter(base, base.plan.steps[0], 'operation_uncertain')
    const snapshot: ExecutionNavigatorSnapshot = {
      ...stale,
      executionSavePoint: options.savePoint
        ? ({ recordedAt: '2026-09-18T01:00:00.000Z', productionPlan: atStep(base, 0).plan } as ExecutionSavePoint)
        : null,
    }
    expect(snapshot.operationCountRecovery.kind).toBe('available')
    return { fixture, base, snapshot, deps: mockedRuntime(snapshot, master) }
  }

  async function enterSlots(user: ReturnType<typeof userEvent.setup>, indexes: readonly number[]) {
    for (const [slot, index] of indexes.entries()) {
      await user.click(screen.getByRole('combobox', { name: `枠${slot + 1} ボーナス種別` }))
      await user.click(within(screen.getByRole('listbox')).getAllByRole('option')[index])
    }
    await user.click(screen.getByRole('button', { name: '作成プランと照合する' }))
  }

  const region = () => screen.findByRole('region', { name: '操作状況の回復' })

  it('asks which situation it is, with the save point when one exists', async () => {
    const { fixture, deps } = await keepRecovery({ savePoint: true })
    renderNavigator(deps, fixture.plan.id)
    const recovery = await region()
    expect(recovery).toHaveTextContent('どの状況に近いですか？')
    expect(within(recovery).getByRole('button', { name: '同じ操作を何回行ったか分からない' })).toBeInTheDocument()
    expect(within(recovery).getByRole('button', { name: '別の操作・別の武器を操作してしまった' })).toBeInTheDocument()
    expect(within(recovery).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /再同定/ })).not.toBeInTheDocument()
  })

  it('follows a unique position only after the user confirms it, once', async () => {
    const { fixture, base, snapshot, deps } = await keepRecovery()
    const pending = deferred<never>()
    vi.mocked(deps.recoverOperationCount).mockReturnValue(pending.promise)
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
    expect(screen.getByText(/ゲーム内では、ここで案内された操作以外を行わないでください。/)).toBeInTheDocument()
    // No fabricated or expected value: the slots start empty and matching waits for all five.
    expect(screen.getByRole('button', { name: '作成プランと照合する' })).toBeDisabled()
    await enterSlots(user, X)

    const found = screen.getByText('現在位置を特定できました').closest('[role="note"]') as HTMLElement
    expect(found).toHaveTextContent('Step 4（')
    expect(found).toHaveTextContent('まで実行済みと判断できます')
    expect(found).toHaveTextContent('次の操作: Step 5（')
    expect(deps.recoverOperationCount).not.toHaveBeenCalled()

    const follow = screen.getByRole('button', { name: 'この位置に合わせて続ける' })
    await user.click(follow)
    await user.click(follow)
    expect(deps.recoverOperationCount).toHaveBeenCalledExactlyOnceWith({
      planId: fixture.plan.id,
      planStepId: base.plan.steps[0].id,
      uncertainExecutionHistoryId: snapshot.latestExecutionHistory?.id,
      observations: [{ kind: 'restoration_bonuses', restorationBonuses: realSet(X), restorationBonusScope: 'gogma_artian' }],
      recoveredPosition: 4,
    })
    expect(follow).toBeDisabled()

    const resumed = atStep(base, 4)
    vi.mocked(deps.loadSnapshot).mockResolvedValue(resumed)
    // The notice follows the Plan the recovery transaction returned.
    pending.resolve({ plan: resumed.plan, history: {} } as never)
    expect(await screen.findByText('現在位置に合わせて作成プランを再開しました。')).toBeInTheDocument()
    expect(screen.queryByText('現在位置に合わせて生産計画を完了しました。')).not.toBeInTheDocument()
    expect(screen.getByText('Step 5 / 6')).toBeInTheDocument()
  })

  it('announces a completed Plan when the recovery reached its last Step', async () => {
    const { fixture, base, deps } = await keepRecovery()
    const completedPlan: ProductionPlan = {
      ...base.plan,
      status: 'completed',
      currentStepId: null,
      steps: base.plan.steps.map((step) => ({ ...step, isCompleted: true })),
    }
    vi.mocked(deps.recoverOperationCount).mockResolvedValue({ plan: completedPlan, history: {} } as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
    await enterSlots(user, X)
    vi.mocked(deps.loadSnapshot).mockResolvedValue({ ...base, plan: completedPlan })
    await user.click(screen.getByRole('button', { name: 'この位置に合わせて続ける' }))

    expect(await screen.findByText('現在位置に合わせて生産計画を完了しました。')).toBeInTheDocument()
    expect(screen.getAllByText('現在位置に合わせて生産計画を完了しました。')).toHaveLength(1)
    expect(screen.queryByText(/再開しました/)).not.toBeInTheDocument()
    expect(screen.getByText('生産計画が完了しました')).toBeInTheDocument()
  })

  it('asks for one more Plan operation while every candidate stays inside the window', async () => {
    const { fixture, deps } = await keepRecovery()
    vi.mocked(deps.recoverOperationCount).mockResolvedValue({ plan: { status: 'active' }, history: {} } as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
    await enterSlots(user, A)
    const narrowing = screen.getByText('候補を1件に絞れませんでした').closest('[role="note"]') as HTMLElement
    expect(narrowing).toHaveTextContent('候補: 2件')
    expect(narrowing).toHaveTextContent('1回だけ実行し、その結果を入力してください。')
    expect(screen.queryByRole('button', { name: 'この位置に合わせて続ける' })).not.toBeInTheDocument()

    await enterSlots(user, B)
    expect(screen.getByText('現在位置を特定できました').closest('[role="note"]')).toHaveTextContent('Step 3（')
    await user.click(screen.getByRole('button', { name: 'この位置に合わせて続ける' }))
    const [request] = vi.mocked(deps.recoverOperationCount).mock.calls[0]
    expect(request.observations).toHaveLength(2)
    expect(request.recoveredPosition).toBe(2)
  })

  it('does not guess when nothing matches, and offers abandoning without a save point', async () => {
    const { fixture, deps } = await keepRecovery()
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
    await enterSlots(user, [2, 2, 2, 2, 2])
    const unsafe = screen.getByText('現在位置を安全に特定できません').closest('[role="note"]') as HTMLElement
    expect(unsafe).toHaveTextContent('推測で続けることはできません')
    expect(screen.queryByRole('button', { name: 'この位置に合わせて続ける' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '作成プランを破棄する' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /再同定/ })).not.toBeInTheDocument()
    // The input can be corrected.
    await user.click(screen.getByRole('button', { name: '入力をやり直す' }))
    expect(screen.getByRole('button', { name: '作成プランと照合する' })).toBeDisabled()
    expect(deps.recoverOperationCount).not.toHaveBeenCalled()
  })

  it('never asks for an operation past the window end, and recommends the save point', async () => {
    const { fixture, deps } = await keepRecovery({ savePoint: true, results: [A, B, A, I, I] })
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
    await enterSlots(user, I)
    const unsafe = screen.getByText('現在位置を安全に特定できません').closest('[role="note"]') as HTMLElement
    expect(unsafe).toHaveTextContent('作成プランの外の操作になる可能性')
    expect(screen.queryByRole('button', { name: '作成プランと照合する' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' })).toBeInTheDocument()
  })

  it('restores the save point only after the game-side confirmation', async () => {
    const { fixture, base, deps } = await keepRecovery({ savePoint: true })
    vi.mocked(deps.restoreExecutionSavePoint).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '別の操作・別の武器を操作してしまった' }))
    expect(screen.getByText(/最後のゲーム内セーブ地点へ戻すことを推奨します。/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '作成プランと照合する' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))
    let dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
    expect(within(dialog).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deps.restoreExecutionSavePoint).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))
    dialog = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
    vi.mocked(deps.loadSnapshot).mockResolvedValue(atStep(base, 0))
    await user.click(within(dialog).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' }))
    expect(deps.restoreExecutionSavePoint).toHaveBeenCalledExactlyOnceWith({
      planId: fixture.plan.id,
      recordedAt: '2026-09-18T01:00:00.000Z',
    })
    expect(await screen.findByText(/最後のゲーム内セーブ地点へ戻しました。/)).toBeInTheDocument()
  })

  it('abandons through the existing user abandonment when no save point exists', async () => {
    const { fixture, snapshot, deps } = await keepRecovery()
    vi.mocked(deps.inspectProductionPlanAbandonment).mockResolvedValue({
      planId: snapshot.plan.id,
      planStatus: 'stale',
      planCurrentStepId: snapshot.plan.currentStepId,
      planUpdatedAt: snapshot.plan.updatedAt,
      savePointChoiceRequired: false,
    })
    vi.mocked(deps.abandonProductionPlan).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '別の操作・別の武器を操作してしまった' }))
    await user.click(screen.getByRole('button', { name: '作成プランを破棄する' }))
    let dialog = await screen.findByRole('dialog', { name: '作成プランを破棄しますか？' })
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deps.abandonProductionPlan).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '作成プランを破棄する' }))
    dialog = await screen.findByRole('dialog', { name: '作成プランを破棄しますか？' })
    vi.mocked(deps.loadSnapshot).mockResolvedValue({
      ...snapshot,
      plan: { ...snapshot.plan, status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: '2026-09-18T02:00:00.000Z' },
    })
    await user.click(within(dialog).getByRole('button', { name: '作成プランを破棄する' }))
    await waitFor(() => expect(deps.abandonProductionPlan).toHaveBeenCalledOnce())
    expect(deps.abandonProductionPlan).toHaveBeenCalledWith({
      planId: fixture.plan.id,
      observedPlan: { status: 'stale', currentStepId: snapshot.plan.currentStepId, updatedAt: snapshot.plan.updatedAt },
      savePointDecision: null,
    })
    expect(await screen.findByText('作成プランを破棄しました')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'RNG状態設定へ' })).toHaveAttribute('href', '/rng')
    expect(screen.getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
    expect(screen.getByRole('link', { name: '所持武器を確認する' })).toHaveAttribute('href', '/owned-weapons')
  })

  it('does not offer the position check for a blind production-target Normal', async () => {
    const fixture = await blindFixture()
    const snapshot = await snapshotOf(fixture)
    const deps = mockedRuntime(staleAfter(snapshot, snapshot.plan.steps[0], 'operation_uncertain'))
    const user = userEvent.setup()
    renderNavigator(deps, fixture.plan.id)
    await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
    expect(screen.getByText('現在位置を確認できません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '作成プランと照合する' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '作成プランを破棄する' })).toBeInTheDocument()
  })

  it('recovers through the real service to the Plan completion', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service, deps } = await realRuntime(database, fixture)
      await service.confirmExpectedPlanStep({ planId: fixture.plan.id, planStepId: fixture.plan.steps[0].id })
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: fixture.plan.steps[1].id })
      // The fixture's Ideal Series Skill as a Master option the Select can offer.
      const expected = fixture.plan.steps[1].expectedResult as NonNullable<PlanStep['expectedResult']>
      const withSkill = createValidMasterDataFixture()
      const template = withSkill.seriesSkills.find(({ isEnabled }) => isEnabled) as (typeof withSkill.seriesSkills)[number]
      withSkill.seriesSkills.push({ ...template, id: expected.seriesSkillId as string, displayNameJa: '理想シリーズ（fixture）' })
      deps.master = withSkill
      const user = userEvent.setup()
      renderNavigator(deps, fixture.plan.id)

      await user.click(within(await region()).getByRole('button', { name: '同じ操作を何回行ったか分からない' }))
      await chooseOption(user, '実際のシリーズスキル', '理想シリーズ（fixture）')
      await chooseOption(user, '実際のグループスキル', 'スキルなし')
      await user.click(screen.getByRole('button', { name: '作成プランと照合する' }))
      expect(screen.getByText('この作成プランの操作はすべて完了します。')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'この位置に合わせて続ける' }))

      expect(await screen.findByText('生産計画が完了しました', {}, { timeout: 5000 })).toBeInTheDocument()
      // The real runtime returned the completed Plan: completion wording, once, and never 「再開しました」.
      expect(screen.getAllByText('現在位置に合わせて生産計画を完了しました。')).toHaveLength(1)
      expect(screen.queryByText(/再開しました/)).not.toBeInTheDocument()
      expect(deps.recoverOperationCount).toHaveBeenCalledOnce()
      expect(await database.productionPlans.get(fixture.plan.id)).toMatchObject({ status: 'completed', recalculationReasons: [] })
      const history = await database.executionHistory.where('planId').equals(fixture.plan.id).toArray()
      expect(history.map(({ action }) => action).sort()).toEqual(['confirmed_expected', 'operation_count_recovered', 'operation_uncertain'])
    }), 20_000)
})
