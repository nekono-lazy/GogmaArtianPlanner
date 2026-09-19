import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionRuntimeError, type PlanBreakingChangeApproval, type PlanBreakingChangeInspection } from '../domain/execution'
import type { OwnedGogmaArtianWeapon, OwnedWeapon, TargetWeapon } from '../domain/models/publicTypes'
import { ReferencedEntityDeleteError, type TargetWeaponDraft } from '../services/crud/entityCrudServices'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { TargetWeaponsPage, type TargetWeaponsPageDependencies } from './TargetWeaponsPage'

/**
 * The Target Weapons save and delete behind the breaking-change warning
 * (`docs/UI_FLOW.md` 16.3): a Plan-independent edit saves as before, a
 * Plan-dependent one warns, the takeover confirmation stays, and the approved
 * save re-reads the list.
 */

const WARNING = { name: '実行中の生産計画があります' } as const

function target(id: string, patch: Partial<TargetWeapon> = {}): TargetWeapon {
  return {
    id: id as TargetWeapon['id'], name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', priority: 3, isEnabled: true,
    preferredOwnedWeaponId: null, lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null,
    idealBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as TargetWeapon['idealBonuses'],
    practicalBonusConditions: [], alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null, createdAt: 'created', updatedAt: 'updated', ...patch,
  }
}

function gogma(id: string): OwnedGogmaArtianWeapon {
  return {
    id: id as OwnedWeapon['id'], kind: 'gogma', name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonusScope: 'gogma_artian',
    restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null, groupSkillId: null, status: 'unclassified', isProtected: false, executionInProgress: null, memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

function dependencies(targets: TargetWeapon[], ownedWeapons: OwnedWeapon[] = []) {
  let stored = targets
  const deps = {
    getAll: vi.fn(async () => stored.map((value) => structuredClone(value))),
    getOwnedWeapons: vi.fn(async () => ownedWeapons),
    save: vi.fn(async (draft: TargetWeaponDraft, existing: TargetWeapon | null, _approval?: PlanBreakingChangeApproval | null): Promise<TargetWeapon> => {
      void _approval
      const saved = { ...draft, id: existing?.id ?? ('target.new' as TargetWeapon['id']), createdAt: 'now', updatedAt: 'now' }
      stored = stored.some(({ id }) => id === saved.id) ? stored.map((value) => (value.id === saved.id ? saved : value)) : [...stored, saved]
      return saved
    }),
    inspectSave: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    delete: vi.fn(async (id: TargetWeapon['id']) => { stored = stored.filter((value) => value.id !== id) }),
    inspectDelete: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
  } satisfies TargetWeaponsPageDependencies
  return deps
}

afterEach(() => vi.restoreAllMocks())

async function openEdit(user: ReturnType<typeof userEvent.setup>, index = 0) {
  await user.click((await screen.findAllByRole('button', { name: '編集' }))[index])
  return screen.findByRole('dialog', { name: '目標武器を編集' })
}

describe('TargetWeaponsPage breaking-change warning', () => {
  it('saves a Plan-independent edit without a warning when the inspection needs no approval', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.independent')])
    render(<TargetWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '有効' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('目標武器を保存しました。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }), expect.objectContaining({ id: 'target.independent' }), null)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('warns before a Plan-dependent edit, keeps the draft on cancel, and saves with the approval', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.dependent')])
    const inspection = planBreakingInspection({ reasons: ['target_changed'] })
    deps.inspectSave.mockResolvedValue(inspection)
    render(<TargetWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByLabelText('優先度'))
    await user.click(await screen.findByRole('option', { name: '1' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('生産計画が使用する目標武器の条件または状態が変わります')).toBeInTheDocument()
    expect(warning.getByText('この目標武器を変更すると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.save).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog', { name: '目標武器を編集' })).getByLabelText('優先度')).toHaveTextContent('1')

    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('目標武器を保存し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(deps.save.mock.calls[0][0]).toMatchObject({ priority: 1 })
    expect(deps.save.mock.calls[0][2]).toEqual(planBreakingApproval(inspection))
    await waitFor(() => expect(deps.getAll).toHaveBeenCalledTimes(2))
  })

  it('confirms the takeover first, then warns, when a Plan-dependent Target loses its weapon', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.shared')
    const deps = dependencies(
      [target('target.other'), target('target.dependent', { preferredOwnedWeaponId: weapon.id })],
      [weapon],
    )
    const inspection = planBreakingInspection({ reasons: ['target_changed'] })
    deps.inspectSave.mockResolvedValue(inspection)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user, 0)
    await user.click(within(dialog).getByLabelText('優先する所持武器'))
    await user.click(await screen.findByRole('option', { name: /owned\.shared/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('目標武器を保存し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.save.mock.calls[0][0]).toMatchObject({ preferredOwnedWeaponId: 'owned.shared' })
    expect(deps.save.mock.calls[0][2]).toEqual(planBreakingApproval(inspection))
  })

  it('shows a refusal of the approved save inside the edit dialog', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.dependent')])
    deps.inspectSave.mockResolvedValue(planBreakingInspection())
    deps.save.mockRejectedValue(new ExecutionRuntimeError('plan_breaking_change_approval_not_required', 'gone'))
    render(<TargetWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '有効' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await within(dialog).findByText('確認後に状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: '有効' })).not.toBeChecked()
  })

  it('warns before deleting a Plan-dependent Target, after the existing confirmation and reference protection', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.dependent')])
    const inspection = planBreakingInspection({ reasons: ['target_changed'] })
    deps.inspectDelete.mockRejectedValueOnce(new ReferencedEntityDeleteError([{ kind: 'build_list_entry', entityId: 'entry.1', path: 'targetWeaponId' }]))
    deps.inspectDelete.mockResolvedValue(inspection)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)

    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(await screen.findByText(/参照中のため削除できません/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('目標武器を削除し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.delete).toHaveBeenCalledWith('target.dependent', planBreakingApproval(inspection))
  })
})
