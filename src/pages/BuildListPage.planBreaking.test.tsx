import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../domain/buildList'
import {
  ExecutionRuntimeError,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
} from '../domain/execution'
import type { BuildListEntry, BuildListEntryId, IntermediateStateSelection, ProductionPlan } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointSource,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../test/fixtures/checkpointRoute'
import { buildListEntryId, createValidProductionPlan, productionPlanId } from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

/**
 * The Build List selection change and Entry delete behind the breaking-change
 * warning (`docs/UI_FLOW.md` 16.3): a cancel changes neither the Entry nor the
 * chain, an approved save re-reads the Entries and the running Plan, and the
 * save point choice names the Step from the Plan the page holds.
 */

const WARNING = { name: '実行中の生産計画があります' } as const
const BONUS_ONE = 'この途中状態を採用する: 復元ボーナス操作1回目（再抽選）の直後'

function runningPlan(): ProductionPlan {
  const base = createValidProductionPlan()
  const plan: ProductionPlan = {
    ...base,
    id: productionPlanId('plan.fixture.active'),
    status: 'active',
    steps: base.steps.map((step) => ({ ...step, progressedTargetWeaponIds: step.targetWeaponId === null ? [] : [step.targetWeaponId] })),
    conflicts: [],
  }
  return { ...plan, currentStepId: plan.steps[0]?.id ?? null }
}

function unusedReplan(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected') }),
    inspectProductionPlanReplanAdoption: vi.fn(notExpected),
    adoptProductionPlanReplanPreview: vi.fn(notExpected),
  }
}

function client(): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
    createConstrainedPlan: vi.fn(),
    createWhatIfComparison: vi.fn(),
    prepareInteraction: vi.fn(),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function harness(estimatedOperationCount?: number) {
  const candidate = checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()])
  if (estimatedOperationCount !== undefined) candidate.estimatedOperationCount = estimatedOperationCount
  const source = checkpointSource()
  const target = checkpointTarget()
  let entry = createBuildListEntry(candidate, target, { id: buildListEntryId('build-list.guarded'), createdAt: '2026-09-12T00:00:00.000Z' })
  let plan: ProductionPlan | undefined = runningPlan()
  const deps = {
    master: createValidMasterDataFixture(),
    createWorkerClient: vi.fn(() => client()),
    refresh: vi.fn(async () => ({ entries: entry === null ? [] : [entry], targets: [target], ownedWeapons: [source] })),
    createInput: vi.fn(async () => { throw new Error('not expected') }),
    savePlannerResult: vi.fn(async () => null),
    deleteEntry: vi.fn(async () => { entry = null as unknown as BuildListEntry }),
    inspectEntryDelete: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    updateIntermediateStateSelection: vi.fn(
      async (_id: BuildListEntryId, selection: IntermediateStateSelection, _approval?: PlanBreakingChangeApproval | null) => {
        void _approval
        entry = { ...entry, intermediateStateSelection: { ...selection } }
        return entry
      },
    ),
    inspectIntermediateStateSelectionUpdate: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    getRunningProductionPlan: vi.fn(async () => plan),
    getDraftProductionPlan: vi.fn(async () => undefined),
    replan: unusedReplan(),
  } satisfies BuildListPageDependencies
  return {
    deps,
    candidate,
    entryId: entry.id,
    endPlan: () => { plan = undefined },
  }
}

function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter([{ path: '/build-list', element: <BuildListPage dependencies={deps} /> }], { initialEntries: ['/build-list'] })
  return render(<RouterProvider router={router} />)
}

describe('BuildListPage breaking-change warning', () => {
  it('warns before a selected Entry change, keeps the Entry on cancel, and saves with the approval', async () => {
    const user = userEvent.setup()
    const { deps, candidate, entryId, endPlan } = harness()
    const inspection = planBreakingInspection({ reasons: ['build_list_changed'] })
    deps.inspectIntermediateStateSelectionUpdate.mockResolvedValue(inspection)
    renderPage(deps)
    expect(await screen.findByRole('heading', { name: '現在地点からの再計画' })).toBeInTheDocument()
    const bonus = await screen.findByRole('checkbox', { name: BONUS_ONE })
    await user.click(bonus)

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('生産計画が使用する作成リスト項目が変わります')).toBeInTheDocument()
    expect(warning.getByText('この作成リスト項目の条件を変更すると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    // Nothing shows as selected while the warning decides, and nothing else is queued.
    expect(bonus).not.toBeChecked()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.updateIntermediateStateSelection).not.toHaveBeenCalled()
    expect(await screen.findByText('途中採用する状態の変更を保存しませんでした。生産計画は変更されていません。')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: BONUS_ONE })).not.toBeChecked()
    expect(screen.getByText('途中採用状態は未選択')).toBeInTheDocument()

    endPlan()
    await user.click(screen.getByRole('checkbox', { name: BONUS_ONE }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('途中採用する状態と改善優先を更新し、実行中の生産計画を破棄しました。生産計画を再作成してください。')).toBeInTheDocument()
    const bonusId = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id
    expect(deps.updateIntermediateStateSelection).toHaveBeenCalledWith(
      entryId,
      { ...defaultIntermediateStateSelection(), bonusOpportunityId: bonusId },
      planBreakingApproval(inspection),
    )
    // The running Plan and the Entries are re-read: the abandoned Plan no longer offers the replan entry.
    await waitFor(() => expect(deps.getRunningProductionPlan).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: '生産計画を作成' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '現在地点からの再計画' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: BONUS_ONE })).toBeChecked())
  })

  it('keeps the user-edited maxPlanSteps through the Build List re-read an approved save triggers (Issue #130)', async () => {
    const user = userEvent.setup()
    // A large Candidate: the untouched field would show 1500.
    const { deps, endPlan } = harness(1470)
    const inspection = planBreakingInspection({ reasons: ['build_list_changed'] })
    deps.inspectIntermediateStateSelectionUpdate.mockResolvedValue(inspection)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '詳細設定' }))
    await waitFor(() => expect(screen.getByLabelText('最大計画ステップ数')).toHaveValue(1500))
    await user.clear(screen.getByLabelText('最大計画ステップ数'))
    await user.type(screen.getByLabelText('最大計画ステップ数'), '1234')

    endPlan()
    await user.click(await screen.findByRole('checkbox', { name: BONUS_ONE }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    await waitFor(() => expect(deps.refresh).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: '生産計画を作成' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: BONUS_ONE })).toBeChecked())

    expect(screen.getByLabelText('最大計画ステップ数')).toHaveValue(1234)
  })

  it('names the save point Step from the running Plan and keeps the current state with the token', async () => {
    const user = userEvent.setup()
    const { deps, endPlan } = harness()
    const plan = runningPlan()
    const inspection = { ...planBreakingInspection({ reasons: ['build_list_changed'], savePoint: true }), savePointCurrentStepId: plan.steps[0].id }
    deps.inspectIntermediateStateSelectionUpdate.mockResolvedValue(inspection)
    renderPage(deps)
    await user.click(await screen.findByRole('radio', { name: '復元ボーナスを優先' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    const choice = within(await screen.findByRole('dialog', WARNING))
    expect(choice.getByText(/最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）/)).toBeInTheDocument()
    endPlan()
    await user.click(choice.getByRole('button', { name: '現在地点を維持' }))

    await waitFor(() => expect(deps.updateIntermediateStateSelection).toHaveBeenCalledTimes(1))
    expect(deps.updateIntermediateStateSelection.mock.calls[0][2]).toEqual(planBreakingApproval(inspection, 'keep_current'))
    expect(await screen.findByText(/実行中の生産計画を破棄しました/)).toBeInTheDocument()
  })

  it('reports a refused approved save as the selection error and keeps the Entry', async () => {
    const user = userEvent.setup()
    const { deps } = harness()
    deps.inspectIntermediateStateSelectionUpdate.mockResolvedValue(planBreakingInspection({ reasons: ['build_list_changed'] }))
    deps.updateIntermediateStateSelection.mockRejectedValue(new ExecutionRuntimeError('plan_breaking_change_state_changed', 'moved'))
    renderPage(deps)
    await user.click(await screen.findByRole('checkbox', { name: BONUS_ONE }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: BONUS_ONE })).not.toBeChecked()
    expect(screen.getByRole('heading', { name: '現在地点からの再計画' })).toBeInTheDocument()
  })

  it('warns before deleting a selected Entry and deletes with the approval', async () => {
    const user = userEvent.setup()
    const { deps, entryId, endPlan } = harness()
    const inspection = planBreakingInspection({ reasons: ['build_list_changed'] })
    deps.inspectEntryDelete.mockResolvedValue(inspection)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: 'ビルドリストから削除' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('この作成リスト項目を削除すると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.deleteEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'ビルドリストから削除' })).toBeEnabled()

    endPlan()
    await user.click(screen.getByRole('button', { name: 'ビルドリストから削除' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('ビルドリストから削除し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.deleteEntry).toHaveBeenCalledWith(entryId, planBreakingApproval(inspection))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ビルドリストから削除' })).toBeNull())
  })
})
