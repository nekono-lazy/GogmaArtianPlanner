import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionRuntimeError, PlanBreakingChangeApprovalRequiredError } from '../domain/execution'
import { createInitialRngState } from '../domain/models/factories'
import type { RngState } from '../domain/models/publicTypes'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { RngSetupPage, type RngSetupPageDependencies } from './RngSetupPage'

/**
 * The RNG Setup direct save behind the breaking-change warning
 * (`docs/UI_FLOW.md` 16.3): the inspection decides, the approval is built from
 * it, and a cancel keeps the form as it was.
 */

const WARNING = { name: '実行中の生産計画があります' } as const

function fixture(initial = createInitialRngState('2026-08-29T00:00:00.000Z')) {
  let stored: RngState = { ...initial, gogmaCounter: { value: 11, isConfirmed: true, source: 'observation' } }
  const deps: RngSetupPageDependencies = {
    ensure: vi.fn(async () => stored),
    save: vi.fn(async (state: RngState) => { stored = state; return state }),
    inspectSave: vi.fn(async () => ({ approvalRequired: false as const })),
    getNormalCounters: vi.fn(async () => []),
  }
  return { deps, getStored: () => stored }
}

async function editGogmaCounter(user: ReturnType<typeof userEvent.setup>, value: string) {
  const counter = await screen.findByLabelText('巨戟カウンター')
  await user.clear(counter)
  await user.type(counter, value)
}

describe('RngSetupPage breaking-change warning', () => {
  it('saves a notes-only change without a warning when the inspection needs no approval', async () => {
    const user = userEvent.setup()
    const { deps, getStored } = fixture()
    render(<RngSetupPage dependencies={deps} />)
    await user.type(await screen.findByLabelText('メモ'), 'メモだけ')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('RNG状態を保存しました。')).toBeInTheDocument()
    expect(deps.inspectSave).toHaveBeenCalledTimes(1)
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.save).mock.calls[0][2]).toBeNull()
    expect(getStored().notes).toBe('メモだけ')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('warns before a semantic change and keeps the form and the stored state on cancel', async () => {
    const user = userEvent.setup()
    const { deps, getStored } = fixture()
    deps.inspectSave = vi.fn(async () => planBreakingInspection({ reasons: ['rng_state_changed'] }))
    render(<RngSetupPage dependencies={deps} />)
    await editGogmaCounter(user, '50')
    await user.click(screen.getByRole('button', { name: '保存' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('RNG状態が変わります')).toBeInTheDocument()
    expect(warning.getByText('RNG状態を変更すると、現在の生産計画で使用している予測位置と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.save).not.toHaveBeenCalled()
    expect(getStored().gogmaCounter.value).toBe(11)
    expect(screen.getByLabelText('巨戟カウンター')).toHaveValue(50)
    expect(screen.getByText('未保存の変更があります。')).toBeInTheDocument()
  })

  it('saves with the approval built from the inspection and reports the abandoned Plan', async () => {
    const user = userEvent.setup()
    const { deps, getStored } = fixture()
    const inspection = planBreakingInspection()
    deps.inspectSave = vi.fn(async () => inspection)
    render(<RngSetupPage dependencies={deps} />)
    await editGogmaCounter(user, '50')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('RNG状態を保存し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledTimes(1)
    const [saved, basis, approval] = vi.mocked(deps.save).mock.calls[0]
    expect(saved.gogmaCounter.value).toBe(50)
    expect(basis?.gogmaCounter.value).toBe(11)
    expect(approval).toEqual(planBreakingApproval(inspection))
    expect(getStored().gogmaCounter.value).toBe(50)
    expect(screen.queryByText('未保存の変更があります。')).toBeNull()
  })

  it('promotes a save refused for a missing approval to the warning', async () => {
    const user = userEvent.setup()
    const { deps } = fixture()
    const inspection = planBreakingInspection()
    const save = vi.mocked(deps.save)
    save.mockImplementationOnce(async () => { throw new PlanBreakingChangeApprovalRequiredError(inspection) })
    render(<RngSetupPage dependencies={deps} />)
    await editGogmaCounter(user, '50')
    await user.click(screen.getByRole('button', { name: '保存' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(warning.getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('RNG状態を保存し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][2]).toEqual(planBreakingApproval(inspection))
  })

  it('reports a Plan that moved on after the warning and keeps the edit for another try', async () => {
    const user = userEvent.setup()
    const { deps, getStored } = fixture()
    deps.inspectSave = vi.fn(async () => planBreakingInspection())
    deps.save = vi.fn(async () => { throw new ExecutionRuntimeError('plan_breaking_change_state_changed', 'moved on') })
    render(<RngSetupPage dependencies={deps} />)
    await editGogmaCounter(user, '50')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getStored().gogmaCounter.value).toBe(11)
    expect(screen.getByLabelText('巨戟カウンター')).toHaveValue(50)
    expect(deps.save).toHaveBeenCalledTimes(1)
  })

  it('does not save when the approval is no longer required at save time', async () => {
    const user = userEvent.setup()
    const { deps } = fixture()
    deps.inspectSave = vi.fn(async () => planBreakingInspection())
    deps.save = vi.fn(async () => { throw new ExecutionRuntimeError('plan_breaking_change_approval_not_required', 'gone') })
    render(<RngSetupPage dependencies={deps} />)
    await editGogmaCounter(user, '50')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('確認後に状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledTimes(1)
  })
})
