import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TargetWeapon } from '../domain/models/publicTypes'
import type { TargetWeaponDraft } from '../services/crud/entityCrudServices'
import { TargetWeaponsPage, type TargetWeaponsPageDependencies } from './TargetWeaponsPage'

function dependencies() { const save = vi.fn(async (draft: TargetWeaponDraft) => ({ ...draft, id: crypto.randomUUID() as TargetWeapon['id'], createdAt: 'now', updatedAt: 'now' })); return { getAll: vi.fn(async (): Promise<TargetWeapon[]> => []), save, delete: vi.fn(async () => undefined) } satisfies TargetWeaponsPageDependencies }

function existingTarget(): TargetWeapon {
  return {
    id: 'target-ui' as TargetWeapon['id'], name: '既存Target', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', priority: 3, isEnabled: true,
    idealBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as TargetWeapon['idealBonuses'],
    practicalBonusConditions: [], practicalAlternativeGroups: [], idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }, practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }, memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

describe('TargetWeaponsPage', () => {
  it('creates priority-3 Target with five Ideal slots and condition editors', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '目標武器を追加' }))
    expect(screen.getByLabelText('優先度')).toHaveTextContent('3')
    expect(screen.getAllByRole('combobox', { name: /枠[1-5] ボーナス種別/ })).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: '条件を追加' }))
    await user.click(screen.getByRole('button', { name: '代替グループを追加' }))
    expect(screen.getByLabelText('必要個数')).toBeInTheDocument()
    expect(screen.getByLabelText('グループの必要個数')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '新規Target')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ name: '新規Target', priority: 3, isEnabled: true, practicalBonusConditions: expect.any(Array), practicalAlternativeGroups: expect.any(Array) }), null)
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
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }), target)
  })

  it('deletes an unreferenced Target after confirmation', async () => {
    const user = userEvent.setup(); const target = existingTarget(); const deps = dependencies(); deps.getAll = vi.fn(async () => [target]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(deps.delete).toHaveBeenCalledWith(target.id)
    confirm.mockRestore()
  })
})
