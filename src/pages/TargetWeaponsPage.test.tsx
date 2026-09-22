import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OwnedWeapon, TargetWeapon } from '../domain/models/publicTypes'
import { EntityFormValidationError, ReferencedEntityDeleteError, type TargetWeaponDraft } from '../services/crud/entityCrudServices'
import { hasMaxHeightRule } from '../test/cssRuleAssertions'
import { TargetWeaponsPage, type TargetWeaponsPageDependencies } from './TargetWeaponsPage'

async function itemFor(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  const item = heading.closest<HTMLElement>('li')
  if (!item) throw new Error(`${name} was not rendered as a list item`)
  return item
}

function dependencies() {
  const save = vi.fn(async (draft: TargetWeaponDraft) => ({ ...draft, id: crypto.randomUUID() as TargetWeapon['id'], createdAt: 'now', updatedAt: 'now' }))
  return {
    getAll: vi.fn(async (): Promise<TargetWeapon[]> => []),
    getOwnedWeapons: vi.fn(async (): Promise<OwnedWeapon[]> => []),
    save,
    inspectSave: vi.fn(async () => ({ approvalRequired: false as const })),
    delete: vi.fn(async () => undefined),
    inspectDelete: vi.fn(async () => ({ approvalRequired: false as const })),
    inspectCompleteWithOwnedIdeal: vi.fn(async () => ({ approvalRequired: false as const })),
    completeWithOwnedIdeal: vi.fn(async () => { throw new Error('not used in this test') }),
    inspectReopen: vi.fn(async () => ({ approvalRequired: false as const })),
    reopen: vi.fn(async () => { throw new Error('not used in this test') }),
  } satisfies TargetWeaponsPageDependencies
}

function existingTarget(): TargetWeapon {
  return {
    id: 'target-ui' as TargetWeapon['id'], name: '既存Target', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', priority: 3, isEnabled: true, preferredOwnedWeaponId: null,
    lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null,
    idealBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as TargetWeapon['idealBonuses'],
    practicalBonusConditions: [], alternativeBonusRules: [], idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }, practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }, memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

describe('TargetWeaponsPage', () => {
  it('creates priority-3 Target with five Ideal slots and condition editors', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '目標武器を追加' }))
    expect(screen.getByLabelText('優先度')).toHaveTextContent('3')
    expect(screen.getAllByRole('combobox', { name: /枠[1-5] ボーナス種別/ })).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: '実用条件を追加' }))
    await user.click(screen.getByRole('button', { name: '代替条件を追加' }))
    expect(screen.queryByLabelText('必要個数')).not.toBeInTheDocument()
    expect(screen.getByText('理想での個数: 5')).toBeInTheDocument()
    expect(screen.getByLabelText('最大置換数')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '実用条件を追加' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '代替条件を追加' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '新規Target')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ name: '新規Target', priority: 3, isEnabled: true, practicalBonusConditions: expect.any(Array), alternativeBonusRules: expect.any(Array) }), null, null)
  })

  it('shows Japanese Master-backed options without exposing English Domain labels', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '目標武器を追加' }))
    expect(screen.queryByText(/一部のゲームデータは未登録または未検証/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('武器種')).toHaveTextContent('大剣')
    expect(screen.getByLabelText('属性')).toHaveTextContent('無属性')
    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]).toHaveTextContent('基礎攻撃力強化')
    expect(screen.getAllByRole('combobox', { name: /ランク/ })[0]).toHaveTextContent('I')
    expect(screen.queryByText('Practical Bonus Conditions')).not.toBeInTheDocument()
    expect(screen.queryByText('Alternative Bonus Groups')).not.toBeInTheDocument()
  })

  it('does not offer Element bonuses for an element.none Target', async () => {
    const user = userEvent.setup()
    render(<TargetWeaponsPage dependencies={dependencies()} />)
    await user.click(
      await screen.findByRole('button', { name: '目標武器を追加' }),
    )
    await user.click(
      screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0],
    )
    expect(
      screen.queryByRole('option', { name: '属性強化' }),
    ).not.toBeInTheDocument()
  })

  it('edits enabled state while preserving the existing Entity identity boundary', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target])
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('checkbox', { name: '有効' })); await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }), target, null)
  })

  it('shows an empty state with the add action when nothing is registered', async () => {
    render(<TargetWeaponsPage dependencies={dependencies()} />)
    expect(await screen.findByText('目標武器は未登録です。')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '目標武器を追加' })).toHaveLength(1)
  })

  it('lists enabled state, priority, ideal slots, skills, compromise summary, review notice and preferred origin', async () => {
    const plain = existingTarget()
    const compromised: TargetWeapon = {
      ...existingTarget(),
      id: 'target-compromised' as TargetWeapon['id'],
      name: '妥協Target',
      priority: 5,
      isEnabled: false,
      practicalBonusConditions: [{ id: 'practical-1', bonusTypeId: 'bonus_type.attack', minimumRankId: 'bonus_rank.ex', requiredExCount: 0 }],
      compromiseNeedsReview: true,
    }
    const deps = dependencies(); deps.getAll = vi.fn(async () => [plain, compromised])
    render(<TargetWeaponsPage dependencies={deps} />)

    const plainItem = within(await itemFor('既存Target'))
    expect(plainItem.getByText('有効')).toBeInTheDocument()
    expect(plainItem.getByText('優先度 3')).toBeInTheDocument()
    expect(plainItem.getByText('双剣 / 雷')).toBeInTheDocument()
    expect(within(plainItem.getByRole('list', { name: '理想ボーナス' })).getAllByRole('listitem')).toHaveLength(5)
    const idealSlots = within(plainItem.getByRole('list', { name: '理想ボーナス' })).getAllByRole('listitem')
    // Ideal slots are Gogma-side definitions, colour-coded by family with the EX tint flag, numbered 1..5.
    expect(idealSlots.map((slot) => slot.textContent)).toEqual(['1基礎攻撃力強化EX', '2基礎攻撃力強化EX', '3基礎攻撃力強化EX', '4基礎攻撃力強化EX', '5基礎攻撃力強化EX'])
    expect(idealSlots.every((slot) => slot.getAttribute('data-bonus-tone') === 'attack' && slot.getAttribute('data-bonus-ex') === 'true')).toBe(true)
    expect(plainItem.getByText('理想スキル: 指定なし')).toBeInTheDocument()
    expect(plainItem.getByText('妥協なし（理想のみ検索）')).toBeInTheDocument()
    expect(plainItem.queryByText('妥協条件の再設定が必要')).toBeNull()
    expect(plainItem.getByText('優先起点: なし')).toBeInTheDocument()

    const compromisedItem = within(await itemFor('妥協Target'))
    expect(compromisedItem.getByText('無効')).toBeInTheDocument()
    expect(compromisedItem.getByText('優先度 5')).toBeInTheDocument()
    expect(compromisedItem.getByText(/実用ボーナス条件 1件/)).toBeInTheDocument()
    expect(compromisedItem.queryByText('妥協なし（理想のみ検索）')).toBeNull()
    expect(compromisedItem.getByText('妥協条件の再設定が必要')).toBeInTheDocument()
    expect(compromisedItem.getByText(/旧妥協条件を解除しました/)).toBeInTheDocument()

    for (const [item, name] of [[plainItem, '既存Target'], [compromisedItem, '妥協Target']] as const) {
      expect(item.getAllByRole('button', { name: '編集' })).toHaveLength(1)
      expect(item.getByRole('button', { name: '編集' })).toHaveAccessibleDescription(name)
      expect(item.getByRole('button', { name: '削除' })).toHaveAccessibleDescription(name)
    }
  })

  it('edits priority and keeps every dialog section reachable', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target])
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    const dialog = within(screen.getByRole('dialog', { name: '目標武器を編集' }))
    for (const heading of ['基本情報', '優先する所持武器', '理想の復元ボーナス5枠', '実用ボーナス条件', '代替ボーナス条件', '理想スキル条件', '実用スキル条件']) {
      expect(dialog.getByRole('heading', { level: 3, name: heading })).toBeInTheDocument()
    }
    expect(dialog.getByRole('combobox', { name: '優先する所持武器' })).toHaveAccessibleDescription(/起点として優先します/)
    await user.click(dialog.getByLabelText('優先度'))
    await user.click(screen.getByRole('option', { name: '1' }))
    await user.click(dialog.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ priority: 1 }), target, null)
    expect(await screen.findByText('目標武器を保存しました。')).toBeInTheDocument()
  })

  it('keeps a very long save error fully readable in a bounded region while 保存 / キャンセル stay reachable', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target])
    const issues = Array.from({ length: 12 }, (_, index) => `practicalBonusConditions[${index}]: 理想に含まれない種類です`)
    deps.save = vi.fn(async () => { throw new EntityFormValidationError(issues) })
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    const dialog = screen.getByRole('dialog', { name: '目標武器を編集' })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(issues.join(' / '))
    expect(alert.closest('.MuiDialogContent-root')).toBeNull()
    const save = within(dialog).getByRole('button', { name: '保存' })
    const cancel = within(dialog).getByRole('button', { name: 'キャンセル' })
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(save).toBeEnabled()
    expect(cancel).toBeEnabled()
    expect(getComputedStyle(alert).overflowY).toBe('auto')
    expect(hasMaxHeightRule(alert)).toBe(true)
  })

  it('shows a save validation error inside the open Dialog, not only behind the modal', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target])
    const message = 'practicalBonusConditions: 理想に含まれない種類です'
    deps.save = vi.fn(async () => { throw new EntityFormValidationError([message]) })
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    const dialog = screen.getByRole('dialog', { name: '目標武器を編集' })
    expect(await within(dialog).findByText(message)).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(message)
    for (const element of screen.getAllByText(message)) {
      expect(dialog.contains(element)).toBe(true)
    }
    expect(screen.queryByText('目標武器を保存しました。')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: '目標武器を追加' }))
    expect(within(screen.getByRole('dialog', { name: '目標武器を追加' })).queryByRole('alert')).toBeNull()
    expect(screen.queryByText(message)).toBeNull()
  })

  it('refuses to delete a referenced Target and keeps it listed', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target])
    deps.delete = vi.fn(async () => { throw new ReferencedEntityDeleteError([{ kind: 'build_list_entry', entityId: 'entry.a', path: 'targetWeaponId' }]) })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(await screen.findByText(/参照中のため削除できません/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '既存Target' })).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('deletes an unreferenced Target after confirmation', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(deps.delete).toHaveBeenCalledWith(target.id, null)
    confirm.mockRestore()
  })
})

/**
 * Display-order contract of the management list (`docs/UI_FLOW.md` 3.2 / 8): a
 * new Target is appended, an edited one stays at its index, a deletion keeps
 * the others' relative order, and a preferred-origin release triggered by the
 * save leaves every Target where it was.
 */
describe('TargetWeaponsPage list order', () => {
  function named(id: string, name: string, overrides: Partial<TargetWeapon> = {}): TargetWeapon {
    return { ...existingTarget(), id: id as TargetWeapon['id'], name, ...overrides }
  }

  function compatibleGogma(id: string): OwnedWeapon {
    return {
      id: id as OwnedWeapon['id'], kind: 'gogma', name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
      restorationBonusScope: 'gogma_artian', restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as OwnedWeapon['restorationBonuses'],
      seriesSkillId: null, groupSkillId: null, status: 'unclassified', isProtected: false, executionInProgress: null, memo: null, createdAt: 'created', updatedAt: 'updated',
    }
  }

  /** Save keeps the existing identity on edit and mints a new one on add. */
  function orderDependencies(targets: TargetWeapon[], ownedWeapons: OwnedWeapon[] = []) {
    const deps = dependencies()
    deps.getAll = vi.fn(async () => targets)
    deps.getOwnedWeapons = vi.fn(async () => ownedWeapons)
    deps.save = vi.fn(async (draft: TargetWeaponDraft, existing: TargetWeapon | null) => ({
      ...draft,
      id: existing?.id ?? (`target.${draft.name}` as TargetWeapon['id']),
      createdAt: 'now',
      updatedAt: 'now',
    })) as typeof deps.save
    return deps
  }

  async function listedNames(): Promise<string[]> {
    const first = await screen.findByRole('heading', { name: 'A' })
    const list = first.closest('ul') as HTMLElement
    return Array.from(list.children).map(
      (item) => within(item as HTMLElement).getAllByRole('heading')[0].textContent ?? '',
    )
  }

  it('keeps an edited Target in place, appends a new one, and preserves order on delete', async () => {
    const user = userEvent.setup()
    const deps = orderDependencies([named('target.a', 'A'), named('target.b', 'B'), named('target.c', 'C')])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)
    expect(await listedNames()).toEqual(['A', 'B', 'C'])

    // Edit B -> A B' C
    await user.click(within(await itemFor('B')).getByRole('button', { name: '編集' }))
    const nameField = within(screen.getByRole('dialog', { name: '目標武器を編集' })).getByRole('textbox', { name: /名前/ })
    await user.clear(nameField)
    await user.type(nameField, "B'")
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await listedNames()).toEqual(['A', "B'", 'C'])

    // Add D -> A B' C D
    await user.click(screen.getByRole('button', { name: '目標武器を追加' }))
    await user.type(screen.getByRole('textbox', { name: /名前/ }), 'D')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await listedNames()).toEqual(['A', "B'", 'C', 'D'])

    // Delete B' -> A C D
    await user.click(within(await itemFor("B'")).getByRole('button', { name: '削除' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: "B'" })).toBeNull())
    expect(await listedNames()).toEqual(['A', 'C', 'D'])
    expect(deps.save).toHaveBeenCalledTimes(2)
  })

  it('keeps every Target in place when a save releases another Target preferred origin', async () => {
    const user = userEvent.setup()
    const weapon = compatibleGogma('owned.shared')
    const deps = orderDependencies(
      [named('target.a', 'A', { preferredOwnedWeaponId: weapon.id }), named('target.b', 'B'), named('target.c', 'C')],
      [weapon],
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)
    expect(await listedNames()).toEqual(['A', 'B', 'C'])
    expect(within(await itemFor('A')).getByText(`優先起点: ${weapon.name}`)).toBeInTheDocument()

    // Edit C to take A's preferred weapon: A is released in the same save.
    await user.click(within(await itemFor('C')).getByRole('button', { name: '編集' }))
    await user.click(await screen.findByLabelText('優先する所持武器'))
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /owned\.shared/ }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ preferredOwnedWeaponId: weapon.id }),
      expect.objectContaining({ id: 'target.c' }), null,
    )
    expect(await listedNames()).toEqual(['A', 'B', 'C'])
    expect(within(await itemFor('A')).getByText('優先起点: なし')).toBeInTheDocument()
    expect(within(await itemFor('C')).getByText(`優先起点: ${weapon.name}`)).toBeInTheDocument()
  })
})
