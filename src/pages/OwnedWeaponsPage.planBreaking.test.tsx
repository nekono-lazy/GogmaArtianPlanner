import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExecutionRuntimeError,
  PlanBreakingChangeApprovalRequiredError,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
} from '../domain/execution'
import type { OwnedGogmaArtianWeapon, OwnedWeapon, TargetWeapon } from '../domain/models/publicTypes'
import { ReferencedEntityDeleteError, type OwnedWeaponDraft } from '../services/crud/entityCrudServices'
import { PLAN_BREAKING_FIXTURE_PLAN_ID, planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { OwnedWeaponsPage, type OwnedWeaponsPageDependencies } from './OwnedWeaponsPage'

/**
 * The Owned Weapons save and delete behind the breaking-change warning
 * (`docs/UI_FLOW.md` 16.3): the inspection alone decides, the existing
 * reference protection and preference confirmation come first, a cancel keeps
 * the draft, and an approved save re-reads the list.
 */

const WARNING = { name: '実行中の生産計画があります' } as const

function weapon(): OwnedGogmaArtianWeapon {
  return {
    id: 'owned.tracked' as OwnedWeapon['id'], kind: 'gogma', name: '追跡中の武器', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonusScope: 'gogma_artian',
    restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null, groupSkillId: null, status: 'unclassified', isProtected: false,
    executionInProgress: { productionPlanId: PLAN_BREAKING_FIXTURE_PLAN_ID, startedAt: '2026-09-18T00:00:00.000Z' },
    memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

function dependencies(weapons: OwnedWeapon[] = [weapon()], targets: TargetWeapon[] = []) {
  let stored = weapons
  const deps = {
    getAll: vi.fn(async () => stored.map((value) => structuredClone(value))),
    getTargets: vi.fn(async () => targets),
    save: vi.fn(async (draft: OwnedWeaponDraft, existing: OwnedWeapon | null, _approval?: PlanBreakingChangeApproval | null): Promise<OwnedWeapon> => {
      void _approval
      const saved = { ...draft, id: existing?.id ?? ('owned.new' as OwnedWeapon['id']), executionInProgress: null, createdAt: 'now', updatedAt: 'now' } as OwnedWeapon
      stored = stored.some(({ id }) => id === saved.id) ? stored.map((value) => (value.id === saved.id ? saved : value)) : [...stored, saved]
      return saved
    }),
    inspectSave: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    delete: vi.fn(async (id: OwnedWeapon['id']) => { stored = stored.filter((value) => value.id !== id) }),
    inspectDelete: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
  } satisfies OwnedWeaponsPageDependencies
  return deps
}

afterEach(() => vi.restoreAllMocks())

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '編集' }))
  return screen.findByRole('dialog', { name: '所持武器を編集' })
}

describe('OwnedWeaponsPage breaking-change warning', () => {
  it('saves a name-only change without a warning when the inspection needs no approval', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.type(within(dialog).getByRole('textbox', { name: /名前/ }), '改')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('所持武器を保存しました。')).toBeInTheDocument()
    expect(deps.inspectSave).toHaveBeenCalledWith(expect.objectContaining({ name: '追跡中の武器改' }), expect.objectContaining({ id: 'owned.tracked' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ name: '追跡中の武器改' }), expect.objectContaining({ id: 'owned.tracked' }), null)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('warns before a semantic change and keeps the edit dialog and its draft on cancel', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    deps.inspectSave.mockResolvedValue(planBreakingInspection({ reasons: ['owned_weapon_changed'] }))
    render(<OwnedWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '保護する' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('生産計画が使用する所持武器の状態が変わります')).toBeInTheDocument()
    expect(warning.getByText('この所持武器を変更すると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.save).not.toHaveBeenCalled()
    const kept = screen.getByRole('dialog', { name: '所持武器を編集' })
    expect(within(kept).getByRole('checkbox', { name: '保護する' })).toBeChecked()
    expect(within(kept).getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('saves with the approval, reports the abandoned Plan and re-reads the list', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    const inspection = planBreakingInspection({ reasons: ['owned_weapon_changed', 'target_changed'] })
    deps.inspectSave.mockResolvedValue(inspection)
    render(<OwnedWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '保護する' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getAllByRole('listitem')).toHaveLength(2)
    await user.click(warning.getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('所持武器を保存し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(deps.save.mock.calls[0][2]).toEqual(planBreakingApproval(inspection))
    await waitFor(() => expect(deps.getAll).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('保護中')).toBeInTheDocument()
  })

  it('keeps the preference release confirmation before the warning', async () => {
    const user = userEvent.setup()
    const target: TargetWeapon = {
      id: 'target.holder' as TargetWeapon['id'], name: '保持Target', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', priority: 3, isEnabled: true,
      preferredOwnedWeaponId: 'owned.tracked' as OwnedWeapon['id'], lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null,
      idealBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as TargetWeapon['idealBonuses'],
      practicalBonusConditions: [], alternativeBonusRules: [],
      idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }, practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
      memo: null, createdAt: 'created', updatedAt: 'updated',
    }
    const deps = dependencies([weapon()], [target])
    deps.inspectSave.mockResolvedValue(planBreakingInspection({ reasons: ['owned_weapon_changed', 'target_changed'] }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<OwnedWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '保護する' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(deps.inspectSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', WARNING)).toBeNull()

    confirm.mockReturnValue(true)
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('dialog', WARNING)).toBeInTheDocument()
    expect(deps.inspectSave).toHaveBeenCalledTimes(1)
  })

  it('promotes a save refused for a missing approval to the warning', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    const inspection = planBreakingInspection({ reasons: ['owned_weapon_changed'] })
    deps.save.mockImplementationOnce(async () => { throw new PlanBreakingChangeApprovalRequiredError(inspection) })
    render(<OwnedWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '保護する' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('所持武器を保存し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledTimes(2)
    expect(deps.save.mock.calls[1][2]).toEqual(planBreakingApproval(inspection))
  })

  it('shows a refusal of the approved save inside the edit dialog and keeps the draft', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    deps.inspectSave.mockResolvedValue(planBreakingInspection())
    deps.save.mockRejectedValue(new ExecutionRuntimeError('plan_breaking_change_state_changed', 'moved'))
    render(<OwnedWeaponsPage dependencies={deps} />)
    const dialog = await openEdit(user)
    await user.click(within(dialog).getByRole('checkbox', { name: '保護する' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await within(dialog).findByText('確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: '保護する' })).toBeChecked()
  })

  it('warns before deleting a tracked weapon and deletes with the approval', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    const inspection = planBreakingInspection({ reasons: ['owned_weapon_changed'] })
    deps.inspectDelete.mockResolvedValue(inspection)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('この所持武器を削除すると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('所持武器を削除し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.delete).toHaveBeenCalledWith('owned.tracked', planBreakingApproval(inspection))
    expect(screen.queryByRole('heading', { name: '追跡中の武器' })).toBeNull()
  })

  it('reports the reference protection before any warning', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    deps.inspectDelete.mockRejectedValue(new ReferencedEntityDeleteError([{ kind: 'build_list_entry', entityId: 'entry.1', path: 'candidateSnapshot.route.sourceOwnedWeaponId' }]))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))

    expect(await screen.findByText(/参照中のため削除できません/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(deps.delete).not.toHaveBeenCalled()
  })
})
