import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanBreakingChangeApproval, PlanBreakingChangeInspection } from '../domain/execution'
import { createTargetWeaponDraft } from '../domain/forms/entityDrafts'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { OwnedGogmaArtianWeapon, OwnedWeapon, ProductionPlanId, TargetWeapon } from '../domain/models/publicTypes'
import type { TargetWeaponDraft } from '../services/crud/entityCrudServices'
import { TargetWeaponLifecycleError, type TargetOwnedIdealCompletion } from '../services/crud/targetWeaponLifecycleService'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { TargetWeaponsPage, type TargetWeaponsPageDependencies } from './TargetWeaponsPage'

/**
 * The owned Ideal notice, 「この武器で目標を完了にする」, the completed Target
 * section and 「未完了に戻す」 of `docs/UI_FLOW.md` 8 / 8.2 / 8.3 on the Target
 * Weapons screen. The Service is mocked as a stateful store: the screen mirrors
 * what the Service returned, never a judgement of its own.
 */

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data
const NOW = '2026-09-22T10:00:00.000Z'
const WARNING = { name: '実行中の生産計画があります' } as const
const COMPLETE = { name: 'この武器で目標を完了にする' } as const
const ATTACK_EX = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' }
const ATTACK_II = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }

function target(id: string, patch: Partial<TargetWeapon> = {}): TargetWeapon {
  return {
    id: id as TargetWeapon['id'], name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', priority: 3, isEnabled: true,
    preferredOwnedWeaponId: null, lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null,
    idealBonuses: [ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX] as TargetWeapon['idealBonuses'],
    practicalBonusConditions: [], alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null, createdAt: 'created', updatedAt: 'updated', ...patch,
  }
}

function gogma(id: string, patch: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return {
    id: id as OwnedWeapon['id'], kind: 'gogma', name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonusScope: 'gogma_artian', restorationBonuses: [ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX] as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null, groupSkillId: null, status: 'unclassified', isProtected: false, executionInProgress: null, memo: null, createdAt: 'created', updatedAt: 'updated', ...patch,
  }
}

function dependencies(targets: TargetWeapon[], ownedWeapons: OwnedWeapon[] = []) {
  let storedTargets = targets
  let storedWeapons = ownedWeapons
  const deps = {
    getAll: vi.fn(async () => storedTargets.map((value) => structuredClone(value))),
    getOwnedWeapons: vi.fn(async () => storedWeapons.map((value) => structuredClone(value))),
    save: vi.fn(async (draft: TargetWeaponDraft, existing: TargetWeapon | null): Promise<TargetWeapon> => {
      const saved = { ...draft, id: existing?.id ?? ('target.new' as TargetWeapon['id']), createdAt: 'now', updatedAt: 'now' }
      storedTargets = storedTargets.some(({ id }) => id === saved.id) ? storedTargets.map((value) => (value.id === saved.id ? saved : value)) : [...storedTargets, saved]
      return saved
    }),
    inspectSave: vi.fn(async () => ({ approvalRequired: false as const })),
    delete: vi.fn(async () => undefined),
    inspectDelete: vi.fn(async () => ({ approvalRequired: false as const })),
    inspectCompleteWithOwnedIdeal: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    completeWithOwnedIdeal: vi.fn(async (targetId: TargetWeapon['id'], weaponId: OwnedWeapon['id'], _approval?: PlanBreakingChangeApproval | null): Promise<TargetOwnedIdealCompletion> => {
      void _approval
      const stored = storedTargets.find(({ id }) => id === targetId)
      const weapon = storedWeapons.find(({ id }) => id === weaponId)
      if (!stored || !weapon || weapon.kind !== 'gogma') throw new Error('fixture mismatch')
      const completed: TargetWeapon = { ...stored, lifecycleStatus: 'completed', completedAt: NOW, completedByProductionPlanId: null, preferredOwnedWeaponId: null, updatedAt: NOW }
      const protectedWeapon: OwnedGogmaArtianWeapon = { ...weapon, status: 'ideal', isProtected: true, updatedAt: NOW }
      const releasedTargetIds = storedTargets.filter((other) => other.id !== targetId && other.preferredOwnedWeaponId === weaponId).map(({ id }) => id)
      storedTargets = storedTargets.map((other) =>
        other.id === targetId ? completed : releasedTargetIds.includes(other.id) ? { ...other, preferredOwnedWeaponId: null, updatedAt: NOW } : other,
      )
      storedWeapons = storedWeapons.map((other) => (other.id === weaponId ? protectedWeapon : other))
      return { target: completed, ownedWeapon: protectedWeapon, releasedTargetIds }
    }),
    inspectReopen: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    reopen: vi.fn(async (targetId: TargetWeapon['id'], _approval?: PlanBreakingChangeApproval | null): Promise<TargetWeapon> => {
      void _approval
      const stored = storedTargets.find(({ id }) => id === targetId)
      if (!stored) throw new Error('fixture mismatch')
      const reopened: TargetWeapon = { ...stored, lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null, preferredOwnedWeaponId: null, updatedAt: NOW }
      storedTargets = storedTargets.map((other) => (other.id === targetId ? reopened : other))
      return reopened
    }),
  } satisfies TargetWeaponsPageDependencies
  return deps
}

function renderPage(deps: TargetWeaponsPageDependencies) {
  return render(<TargetWeaponsPage dependencies={deps} />, { wrapper: MemoryRouter })
}

async function activeItem(name: string): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: '登録済みの目標武器' })
  const heading = within(list).getByRole('heading', { level: 3, name })
  return heading.closest('li') as HTMLElement
}

async function completedList(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const toggle = await screen.findByRole('button', { name: /完了済みの目標武器（\d+件）/ })
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle)
  return screen.findByRole('list', { name: '完了済みの目標武器' })
}

afterEach(() => vi.restoreAllMocks())

describe('TargetWeaponsPage owned Ideal notice', () => {
  it('notifies every owned Ideal of an active Target in stable order and stays silent for the others', async () => {
    const ideal = target('target.ideal-owned')
    const other = target('target.other-element', { elementId: 'element.fire' })
    const weaponB = gogma('owned.b', { name: 'B武器', status: 'practical' })
    const weaponA = gogma('owned.a', { name: 'A武器', isProtected: true, status: 'ideal' })
    const notIdeal = gogma('owned.no', { name: '不一致', restorationBonuses: [ATTACK_II, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX] as OwnedWeapon['restorationBonuses'] })
    renderPage(dependencies([ideal, other], [weaponB, notIdeal, weaponA]))

    const item = within(await activeItem('target.ideal-owned'))
    expect(item.getByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeInTheDocument()
    const weapons = within(item.getByRole('list', { name: 'target.ideal-ownedの理想条件を満たす所持武器' }))
    const names = weapons.getAllByRole('listitem').map((entry) => within(entry).getAllByText(/武器$/)[0].textContent)
    expect(names).toEqual(['A武器', 'B武器'])
    expect(weapons.getByText('巨戟アーティア / 双剣 / 雷 / 理想 / 保護中')).toBeInTheDocument()
    expect(weapons.getByText('巨戟アーティア / 双剣 / 雷 / 実用 / 保護なし')).toBeInTheDocument()
    expect(weapons.queryByText('不一致')).toBeNull()
    const buttons = weapons.getAllByRole('button', COMPLETE)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleDescription('A武器')
    expect(buttons[1]).toHaveAccessibleDescription('B武器')
    buttons.forEach((button) => expect(getComputedStyle(button).minHeight).toBe('44px'))

    const otherItem = within(await activeItem('target.other-element'))
    expect(otherItem.queryByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeNull()
    expect(otherItem.queryByRole('button', COMPLETE)).toBeNull()
  })

  it('cancels the confirmation without calling the Service', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.a')], [gogma('owned.a')])
    renderPage(deps)
    await user.click(await screen.findByRole('button', COMPLETE))
    const dialog = await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })
    expect(dialog).toHaveAccessibleDescription(/武器「owned.a」を理想品・保護ありにし、目標武器「target.a」を完了済みにします。/)
    expect(within(dialog).getByText('武器の復元ボーナスとスキルは変更しません。')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.inspectCompleteWithOwnedIdeal).not.toHaveBeenCalled()
    expect(deps.completeWithOwnedIdeal).not.toHaveBeenCalled()
    expect(await activeItem('target.a')).toBeInTheDocument()
  })

  it('names the other Targets preferring the weapon, completes after confirmation, and moves the Target to the completed section', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.shared')
    const a = target('target.a')
    const b = target('target.b', { preferredOwnedWeaponId: weapon.id, elementId: 'element.fire' })
    const c = target('target.c', { preferredOwnedWeaponId: weapon.id, elementId: 'element.fire' })
    const d = target('target.d')
    const deps = dependencies([a, b, c, d], [weapon])
    renderPage(deps)
    expect(within(await activeItem('target.b')).getByText('優先起点: owned.shared')).toBeInTheDocument()

    await user.click(within(await activeItem('target.a')).getByRole('button', COMPLETE))
    const dialog = within(await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' }))
    expect(dialog.getByText('この武器は次の目標武器でも優先起点に設定されています。')).toBeInTheDocument()
    expect(dialog.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['target.b', 'target.c'])
    expect(dialog.getByText('完了すると武器が保護されるため、これらの優先起点設定も解除されます。')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', COMPLETE))

    expect(await screen.findByText('目標武器「target.a」を完了にしました。')).toBeInTheDocument()
    expect(deps.completeWithOwnedIdeal).toHaveBeenCalledWith('target.a', 'owned.shared', null)
    expect(deps.getAll).toHaveBeenCalledTimes(1)
    const active = within(screen.getByRole('list', { name: '登録済みの目標武器' }))
    expect(active.queryByRole('heading', { level: 3, name: 'target.a' })).toBeNull()
    expect(within(await activeItem('target.b')).getByText('優先起点: なし')).toBeInTheDocument()
    expect(within(await activeItem('target.c')).getByText('優先起点: なし')).toBeInTheDocument()
    // The weapon is mirrored as persisted: the other Target's notice now shows it protected.
    expect(within(await activeItem('target.d')).getByText('巨戟アーティア / 双剣 / 雷 / 理想 / 保護中')).toBeInTheDocument()
    expect(screen.getByText('3件（有効 3件）')).toBeInTheDocument()
    const completed = within(await completedList(user))
    expect(completed.getByRole('heading', { level: 4, name: 'target.a' })).toBeInTheDocument()
    expect(completed.getByText(/完了日時: /)).toBeInTheDocument()
  })

  it('routes the completion through the breaking-change warning and re-reads the lists after the approved save', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.dependent')], [gogma('owned.a')])
    const inspection = planBreakingInspection({ reasons: ['target_changed'] })
    deps.inspectCompleteWithOwnedIdeal.mockResolvedValue(inspection)
    renderPage(deps)
    await user.click(await screen.findByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('この目標武器を完了にすると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.completeWithOwnedIdeal).not.toHaveBeenCalled()
    // The direct completion confirmation stays open: nothing was saved.
    await user.click(within(screen.getByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('目標武器「target.dependent」を完了にし、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.completeWithOwnedIdeal).toHaveBeenCalledTimes(1)
    expect(deps.completeWithOwnedIdeal).toHaveBeenCalledWith('target.dependent', 'owned.a', planBreakingApproval(inspection))
    await waitFor(() => expect(deps.getAll).toHaveBeenCalledTimes(2))
  })

  it('shows a Service refusal inside the confirmation and keeps the Target active', async () => {
    const user = userEvent.setup()
    const deps = dependencies([target('target.a')], [gogma('owned.a')])
    deps.completeWithOwnedIdeal.mockRejectedValue(new TargetWeaponLifecycleError('owned_weapon_no_longer_ideal'))
    renderPage(deps)
    await user.click(await screen.findByRole('button', COMPLETE))
    const dialog = await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })
    await user.click(within(dialog).getByRole('button', COMPLETE))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('この所持武器の現在の性能は目標武器の理想条件を満たしていないため')
    expect(screen.queryByText(/を完了にしました。/)).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await activeItem('target.a')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '完了済みの目標武器' })).toBeNull()
  })

  it('notifies right after a new Target is saved, from the saved Target and the loaded weapons, without a reload', async () => {
    const user = userEvent.setup()
    const draft = createTargetWeaponDraft(master)
    const weapon = gogma('owned.default', { weaponTypeId: draft.weaponTypeId, elementId: draft.elementId, restorationBonuses: structuredClone(draft.idealBonuses) })
    const deps = dependencies([], [weapon])
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '目標武器を追加' }))
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '新規Target')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('目標武器を保存しました。')).toBeInTheDocument()
    const item = within(await activeItem('新規Target'))
    expect(item.getByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeInTheDocument()
    expect(item.getByRole('button', COMPLETE)).toHaveAccessibleDescription('owned.default')
    expect(deps.getAll).toHaveBeenCalledTimes(1)
    expect(deps.getOwnedWeapons).toHaveBeenCalledTimes(1)
  })

  it('reports a judgement failure instead of reading it as no owned Ideal', async () => {
    const broken = gogma('owned.broken', { restorationBonuses: [{ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.unknown' }, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX] as OwnedWeapon['restorationBonuses'] })
    renderPage(dependencies([target('target.a')], [broken]))
    expect(await screen.findByText(/既所持の理想武器を判定できませんでした/)).toBeInTheDocument()
    expect(screen.queryByRole('button', COMPLETE)).toBeNull()
  })
})

describe('TargetWeaponsPage completed Targets', () => {
  const byPlan = target('target.by-plan', { lifecycleStatus: 'completed', completedAt: '2026-09-20T01:02:03.000Z', completedByProductionPlanId: 'plan.done' as ProductionPlanId })
  const byUser = target('target.by-user', { lifecycleStatus: 'completed', completedAt: '2026-09-21T01:02:03.000Z' })

  it('lists active Targets only in the ordinary list and completed ones read-only under their own heading', async () => {
    const user = userEvent.setup()
    renderPage(dependencies([target('target.active'), byPlan, byUser]))
    expect(await activeItem('target.active')).toBeInTheDocument()
    expect(screen.getByText('1件（有効 1件）')).toBeInTheDocument()
    const ordinary = within(screen.getByRole('list', { name: '登録済みの目標武器' }))
    expect(ordinary.queryByRole('heading', { name: 'target.by-plan' })).toBeNull()
    expect(ordinary.queryByRole('heading', { name: 'target.by-user' })).toBeNull()

    expect(screen.getByRole('heading', { level: 2, name: '完了済みの目標武器' })).toBeInTheDocument()
    const completed = within(await completedList(user))
    const planItem = completed.getByRole('heading', { level: 4, name: 'target.by-plan' }).closest('li') as HTMLElement
    expect(within(planItem).getByText('完了済み')).toBeInTheDocument()
    expect(within(planItem).getByText('双剣 / 雷')).toBeInTheDocument()
    expect(within(planItem).getByText(`完了日時: ${new Date('2026-09-20T01:02:03.000Z').toLocaleString('ja-JP')}`)).toBeInTheDocument()
    expect(within(planItem).getByRole('link', { name: '完成に使った生産計画を見る' })).toHaveAttribute('href', '/plans/plan.done')
    const userItem = completed.getByRole('heading', { level: 4, name: 'target.by-user' }).closest('li') as HTMLElement
    expect(within(userItem).queryByRole('link')).toBeNull()
    for (const item of [planItem, userItem]) {
      expect(within(item).queryByRole('button', { name: '編集' })).toBeNull()
      expect(within(item).queryByRole('button', { name: '削除' })).toBeNull()
      expect(within(item).queryByRole('checkbox')).toBeNull()
      const reopen = within(item).getByRole('button', { name: /未完了に戻す/ })
      expect(getComputedStyle(reopen).minHeight).toBe('44px')
    }
    const heading = completed.getByRole('heading', { level: 4, name: 'target.by-plan' })
    expect(getComputedStyle(heading).overflowWrap).toBe('anywhere')
  })

  it('reopens after confirmation, calls nothing on cancel, and leaves the owned weapons alone', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.ideal', { status: 'ideal', isProtected: true })
    const deps = dependencies([byUser], [weapon])
    renderPage(deps)
    const completed = within(await completedList(user))
    await user.click(completed.getByRole('button', { name: 'target.by-userを未完了に戻す' }))
    const dialog = await screen.findByRole('dialog', { name: 'この目標武器を未完了に戻しますか？' })
    expect(dialog).toHaveAccessibleDescription(/所持武器は変更しません。/)
    expect(dialog).toHaveAccessibleDescription(/再び候補検索と生産計画の対象になります。/)
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.inspectReopen).not.toHaveBeenCalled()
    expect(deps.reopen).not.toHaveBeenCalled()

    await user.click(completed.getByRole('button', { name: 'target.by-userを未完了に戻す' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'この目標武器を未完了に戻しますか？' })).getByRole('button', { name: '未完了に戻す' }))
    expect(await screen.findByText('目標武器「target.by-user」を未完了に戻しました。')).toBeInTheDocument()
    expect(deps.reopen).toHaveBeenCalledWith('target.by-user', null)
    const item = within(await activeItem('target.by-user'))
    expect(item.getByText('優先起点: なし')).toBeInTheDocument()
    // The protected Ideal weapon is untouched and is offered again as the owned Ideal.
    expect(item.getByText('巨戟アーティア / 双剣 / 雷 / 理想 / 保護中')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '完了済みの目標武器' })).toBeNull()
    expect(deps.getOwnedWeapons).toHaveBeenCalledTimes(1)
  })

  it('routes the reopening through the breaking-change warning', async () => {
    const user = userEvent.setup()
    const deps = dependencies([byUser])
    const inspection = planBreakingInspection({ reasons: ['target_changed'] })
    deps.inspectReopen.mockResolvedValue(inspection)
    renderPage(deps)
    const completed = within(await completedList(user))
    await user.click(completed.getByRole('button', { name: 'target.by-userを未完了に戻す' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'この目標武器を未完了に戻しますか？' })).getByRole('button', { name: '未完了に戻す' }))
    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('この目標武器を未完了に戻すと、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('目標武器「target.by-user」を未完了に戻し、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.reopen).toHaveBeenCalledWith('target.by-user', planBreakingApproval(inspection))
    await waitFor(() => expect(deps.getAll).toHaveBeenCalledTimes(2))
  })
})
