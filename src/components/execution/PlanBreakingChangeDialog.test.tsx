import { useEffect } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../../db/repositoryError'
import {
  ExecutionRuntimeError,
  PlanBreakingChangeApprovalRequiredError,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
} from '../../domain/execution'
import { PlanBreakingChangeDialog } from './PlanBreakingChangeDialog'
import {
  PLAN_BREAKING_APPROVE_LABEL,
  PLAN_BREAKING_SAVE_POINT_CHOICE_MESSAGE,
  PLAN_BREAKING_WARNING_TITLE,
  planBreakingReasonLabels,
} from './planBreakingChangePresentation'
import {
  PLAN_BREAKING_FIXTURE_RECORDED_AT,
  planBreakingInspection,
} from '../../test/fixtures/planBreakingInspection'
import {
  usePlanBreakingChangeApproval,
  type PlanBreakingChangeApprovalController,
  type PlanGuardedAction,
  type PlanGuardedActionOutcome,
} from './usePlanBreakingChangeApproval'

/**
 * The shared breaking-change warning (`docs/UI_FLOW.md` 16.3 / 16.2): the
 * controller hook and its dialog together, driven by a fake guarded action.
 * The runtime is never involved; the inspection is the fixture's.
 */

const RECORDED_AT = PLAN_BREAKING_FIXTURE_RECORDED_AT

interface Harness {
  controller: PlanBreakingChangeApprovalController | null
  outcomes: PlanGuardedActionOutcome<string>[]
  errors: unknown[]
  run(action: PlanGuardedAction<string>): Promise<void>
}

function Host({ onController, label }: { onController(controller: PlanBreakingChangeApprovalController): void; label?: (inspection: never) => string | null }) {
  const controller = usePlanBreakingChangeApproval()
  useEffect(() => {
    onController(controller)
  })
  return (
    <>
      <span data-testid="busy">{controller.busy ? 'busy' : 'idle'}</span>
      <span data-testid="deciding">{controller.deciding ? 'deciding' : 'free'}</span>
      <PlanBreakingChangeDialog controller={controller} savePointPositionLabel={label as never} />
    </>
  )
}

function renderHarness(label?: (inspection: never) => string | null) {
  const harness: Harness = {
    controller: null,
    outcomes: [],
    errors: [],
    async run(action) {
      try {
        harness.outcomes.push(await harness.controller!.run(action))
      } catch (caught: unknown) {
        harness.errors.push(caught)
      }
    },
  }
  const view = render(<Host onController={(controller) => { harness.controller = controller }} label={label} />)
  return { harness, view }
}

function action(
  inspection: PlanBreakingChangeInspection | Error,
  apply: (approval: PlanBreakingChangeApproval | null) => Promise<string> = async () => 'saved',
  note?: string,
): PlanGuardedAction<string> & { inspect: ReturnType<typeof vi.fn>; apply: ReturnType<typeof vi.fn> } {
  return {
    inspect: vi.fn(async () => {
      if (inspection instanceof Error) throw inspection
      return inspection
    }),
    apply: vi.fn(apply),
    note,
  }
}

const dialog = () => screen.getByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
const approveButton = () => within(dialog()).getByRole('button', { name: PLAN_BREAKING_APPROVE_LABEL })

describe('usePlanBreakingChangeApproval without a warning', () => {
  it('saves without any dialog when the inspection needs no approval', async () => {
    const { harness } = renderHarness()
    const guarded = action({ approvalRequired: false })
    await act(() => harness.run(guarded))

    expect(guarded.apply).toHaveBeenCalledWith(null)
    expect(harness.outcomes).toEqual([{ status: 'applied', result: 'saved', planAbandoned: false }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('busy')).toHaveTextContent('idle')
  })

  it('rethrows the change own validation error from the inspection and shows nothing', async () => {
    const { harness } = renderHarness()
    const failure = new Error('name: 名前を入力してください。')
    await act(() => harness.run(action(failure)))

    expect(harness.errors).toEqual([failure])
    expect(harness.outcomes).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a runtime refusal of the inspection in Japanese instead of throwing', async () => {
    const { harness } = renderHarness()
    await act(() => harness.run(action(new ExecutionRuntimeError('running_plan_invariant_violated', 'two plans'))))

    expect(harness.outcomes).toEqual([
      { status: 'refused', message: '実行中の生産計画が複数存在するため保存できません。生産計画の状態を確認してください。' },
    ])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('promotes a save refused for a missing approval to the warning', async () => {
    const { harness } = renderHarness()
    const inspection = planBreakingInspection({ reasons: ['owned_weapon_changed', 'target_changed'] })
    const guarded = action({ approvalRequired: false }, async (approval) => {
      if (approval === null) throw new PlanBreakingChangeApprovalRequiredError(inspection)
      return 'saved with approval'
    })
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })

    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    expect(within(dialog()).getByText(planBreakingReasonLabels.owned_weapon_changed)).toBeInTheDocument()
    expect(within(dialog()).getByText(planBreakingReasonLabels.target_changed)).toBeInTheDocument()
    await userEvent.setup().click(approveButton())
    await act(() => run)

    expect(guarded.apply).toHaveBeenLastCalledWith({ observedPlan: inspection.observedPlan, savePointDecision: null })
    expect(harness.outcomes).toEqual([{ status: 'applied', result: 'saved with approval', planAbandoned: true }])
  })
})

describe('PlanBreakingChangeDialog warning', () => {
  it('lists every reason, the note and the destructive action, and cancels without saving', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const guarded = action(
      planBreakingInspection({ reasons: ['rng_state_changed', 'normal_counter_changed', 'build_list_changed'] }),
      undefined,
      'RNG状態を変更すると、現在の生産計画で使用している予測位置と一致しなくなります。',
    )
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })

    const warning = within(await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE }))
    expect(warning.getByText('この変更を保存すると、現在の生産計画は続行できなくなります。')).toBeInTheDocument()
    expect(warning.getByText('変更を保存すると、この生産計画は破棄されます。')).toBeInTheDocument()
    expect(warning.getByText('RNG状態を変更すると、現在の生産計画で使用している予測位置と一致しなくなります。')).toBeInTheDocument()
    const reasons = warning.getAllByRole('listitem').map((item) => item.textContent)
    expect(reasons).toEqual([
      planBreakingReasonLabels.rng_state_changed,
      planBreakingReasonLabels.normal_counter_changed,
      planBreakingReasonLabels.build_list_changed,
    ])
    // Ending the Plan changes no preference; the change being saved may (PLANNER_SPEC 16.6).
    expect(warning.getByText('破棄した生産計画は元に戻せません。作成途中の武器の「作成中」は解除されます。生産計画を破棄すること自体では優先起点を変更しませんが、今回保存する変更によって優先起点が変更・解除される場合があります。')).toBeInTheDocument()
    expect(warning.queryByText(/優先起点の紐付けは残ります/)).toBeNull()
    expect(warning.queryByText(/優先起点は(残ります|維持されます|変更されません|解除されます)/)).toBeNull()
    expect(screen.getByTestId('deciding')).toHaveTextContent('deciding')
    expect(approveButton()).toHaveClass('MuiButton-colorError')

    await user.click(warning.getByRole('button', { name: 'キャンセル' }))
    await act(() => run)

    expect(guarded.apply).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ status: 'cancelled' }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('busy')).toHaveTextContent('idle')
  })

  it('approves with no save point decision when no choice applies, disabling the controls while saving', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const inspection = planBreakingInspection()
    let resolveApply!: (value: string) => void
    const guarded = action(inspection, () => new Promise<string>((resolve) => { resolveApply = resolve }))
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })

    await user.click(approveButton())

    expect(guarded.apply).toHaveBeenCalledWith({ observedPlan: inspection.observedPlan, savePointDecision: null })
    expect(approveButton()).toBeDisabled()
    expect(within(dialog()).getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    expect(screen.queryByText(PLAN_BREAKING_SAVE_POINT_CHOICE_MESSAGE)).toBeNull()
    await act(async () => { resolveApply('saved'); await run })

    expect(harness.outcomes).toEqual([{ status: 'applied', result: 'saved', planAbandoned: true }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a refusal of the approved save and closes', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const guarded = action(planBreakingInspection(), async () => {
      throw new ExecutionRuntimeError('plan_breaking_change_state_changed', 'moved on')
    })
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })

    await user.click(approveButton())
    await act(() => run)

    expect(harness.outcomes).toEqual([
      { status: 'refused', message: '確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。' },
    ])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([
    [new ExecutionRuntimeError('plan_breaking_change_approval_not_required', 'x'), '確認後に状態が変わったため、変更を保存していません。もう一度保存してください。'],
    [new ExecutionRuntimeError('save_point_choice_required', 'x'), '確認後にゲーム内セーブ地点の状態が変わったため、変更を保存していません。もう一度保存してください。'],
    [new ExecutionRuntimeError('save_point_required_entity_missing', 'x'), 'このセーブ地点を安全に復元できません。必要な所持武器・目標武器・作成リストの状態を確認し、現在状態から再計画してください。状態は変更されていません。'],
    [new RepositoryError('transaction_failed', 'x'), '保存に失敗しました。状態は変更されていません。再試行してください。'],
  ])('translates the typed refusal %o', async (error, message) => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const guarded = action(planBreakingInspection(), async () => { throw error })
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())
    await act(() => run)
    expect(harness.outcomes).toEqual([{ status: 'refused', message }])
  })

  it('rethrows an unexpected error of the approved save', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const failure = new Error('boom')
    const guarded = action(planBreakingInspection(), async () => { throw failure })
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())
    await act(() => run)
    expect(harness.errors).toEqual([failure])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses a second change that needs a decision while the warning is open', async () => {
    const { harness } = renderHarness()
    const first = action(planBreakingInspection())
    const second = action(planBreakingInspection())
    let firstRun!: Promise<void>
    act(() => { firstRun = harness.run(first) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })

    await act(() => harness.run(second))
    expect(harness.outcomes).toEqual([
      { status: 'refused', message: '別の変更を確認中です。完了してからもう一度操作してください。' },
    ])
    expect(second.apply).not.toHaveBeenCalled()

    harness.controller!.cancel()
    await act(() => firstRun)
    expect(harness.outcomes[1]).toEqual({ status: 'cancelled' })
  })

  it('cancels a pending warning when the screen unmounts, saving nothing', async () => {
    const { harness, view } = renderHarness()
    const guarded = action(planBreakingInspection())
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })

    view.unmount()
    await run
    expect(harness.outcomes).toEqual([{ status: 'cancelled' }])
    expect(guarded.apply).not.toHaveBeenCalled()
  })
})

describe('PlanBreakingChangeDialog save point choice', () => {
  const choice = () => screen.findByText(PLAN_BREAKING_SAVE_POINT_CHOICE_MESSAGE)

  it('asks the choice after the approval and keeps the current state with the recorded token', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness(() => 'Step 1完了時点')
    const inspection = planBreakingInspection({ savePoint: true })
    const guarded = action(inspection)
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())

    await choice()
    expect(guarded.apply).not.toHaveBeenCalled()
    expect(within(dialog()).getByText(/最後のゲーム内セーブ地点: Step 1完了時点/)).toBeInTheDocument()
    await user.click(within(dialog()).getByRole('button', { name: '現在地点を維持' }))
    await act(() => run)

    expect(guarded.apply).toHaveBeenCalledWith({
      observedPlan: inspection.observedPlan,
      savePointDecision: { kind: 'keep_current', recordedAt: RECORDED_AT },
    })
    expect(harness.outcomes).toEqual([{ status: 'applied', result: 'saved', planAbandoned: true }])
  })

  it('falls back to the recorded time when the screen cannot resolve the Step', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    act(() => { void harness.run(action(planBreakingInspection({ savePoint: true }))) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())
    await choice()
    expect(within(dialog()).getByText(/最後のゲーム内セーブ地点: 記録日時 /)).toBeInTheDocument()
    expect(within(dialog()).queryByText(/step\.1/)).toBeNull()
  })

  it('cancels from the choice without saving', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const guarded = action(planBreakingInspection({ savePoint: true }))
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())
    await choice()
    await user.click(within(dialog()).getByRole('button', { name: 'キャンセル' }))
    await act(() => run)
    expect(guarded.apply).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ status: 'cancelled' }])
  })

  it('requires the game-side confirmation before submitting the restore decision, as one save', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const inspection = planBreakingInspection({ savePoint: true })
    const guarded = action(inspection)
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())
    await choice()
    await user.click(within(dialog()).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))

    const restore = within(await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' }))
    expect(restore.getByText('先にゲームを記録したセーブ地点から読み込み直してください。アプリ側だけを先に戻すことはしません。')).toBeInTheDocument()
    const confirm = restore.getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' })
    expect(confirm).toBeDisabled()
    expect(guarded.apply).not.toHaveBeenCalled()

    await user.click(restore.getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await act(() => run)

    expect(guarded.apply).toHaveBeenCalledTimes(1)
    expect(guarded.apply).toHaveBeenCalledWith({
      observedPlan: inspection.observedPlan,
      savePointDecision: { kind: 'restore_save_point', recordedAt: RECORDED_AT },
    })
    expect(harness.outcomes).toEqual([{ status: 'applied', result: 'saved', planAbandoned: true }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancelling the restore confirmation ends the whole change', async () => {
    const user = userEvent.setup()
    const { harness } = renderHarness()
    const guarded = action(planBreakingInspection({ savePoint: true }))
    let run!: Promise<void>
    act(() => { run = harness.run(guarded) })
    await screen.findByRole('dialog', { name: PLAN_BREAKING_WARNING_TITLE })
    await user.click(approveButton())
    await choice()
    await user.click(within(dialog()).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))
    const restore = within(await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' }))
    await user.click(restore.getByRole('button', { name: 'キャンセル' }))
    await act(() => run)
    expect(guarded.apply).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ status: 'cancelled' }])
  })
})
