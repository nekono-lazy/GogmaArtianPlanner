import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OwnedWeapon } from '../domain/models/publicTypes'
import type { OwnedWeaponDraft } from '../services/crud/entityCrudServices'
import { OwnedWeaponsPage, type OwnedWeaponsPageDependencies } from './OwnedWeaponsPage'

function dependencies() {
  const save = vi.fn(async (draft: OwnedWeaponDraft) => ({ ...draft, id: crypto.randomUUID() as OwnedWeapon['id'], createdAt: 'now', updatedAt: 'now' }))
  return { getAll: vi.fn(async (): Promise<OwnedWeapon[]> => []), getTargets: vi.fn(async () => []), save, delete: vi.fn(async () => undefined) } satisfies OwnedWeaponsPageDependencies
}

function existingWeapon(): OwnedWeapon {
  return {
    id: 'owned-ui' as OwnedWeapon['id'], name: '既存武器', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null, groupSkillId: null, status: 'practical', isProtected: true, relatedTargetWeaponIds: [], memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

describe('OwnedWeaponsPage', () => {
  it('creates a five-slot Material weapon unprotected', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    expect(screen.getAllByRole('combobox', { name: /枠[1-5] ボーナス種別/ })).toHaveLength(5)
    expect(screen.getByRole('checkbox', { name: '保護する' })).not.toBeChecked()
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '登録武器')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ name: '登録武器', status: 'material', isProtected: false, restorationBonuses: expect.any(Array) }), null)
    expect((deps.save.mock.calls[0][0] as OwnedWeaponDraft).restorationBonuses).toHaveLength(5)
  })

  it('does not overwrite Protection when Status changes', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await user.click(screen.getByLabelText('状態')); await user.click(screen.getByRole('option', { name: '実用' }))
    expect(screen.getByRole('checkbox', { name: '保護する' })).not.toBeChecked()
  })

  it('confirms Practical-to-Material editing and preserves explicit Protection', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByLabelText('状態')); await user.click(screen.getByRole('option', { name: '素材' })); await user.click(screen.getByRole('button', { name: '保存' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('素材扱い'))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'material', isProtected: true }), weapon)
    confirm.mockRestore()
  })

  it('shows Master-backed Japanese choices and warns that placeholder data is incomplete', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    expect(await screen.findByText(/一部のゲームデータは未登録または未検証/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '所持武器を追加' }))
    expect(screen.getByLabelText('武器種')).toHaveTextContent('双剣')
    expect(screen.getByLabelText('属性')).toHaveTextContent('雷')
    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]).toHaveTextContent('攻撃')
    expect(screen.getAllByRole('combobox', { name: /ランク/ })[0]).toHaveTextContent('EX')
    await user.click(screen.getByLabelText('シリーズスキル'))
    expect(await screen.findByRole('option', { name: '黒蝕竜の力' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByLabelText('グループスキル'))
    expect(await screen.findByRole('option', { name: 'ヌシの魂' })).toBeInTheDocument()
  })

  it('deletes an unreferenced weapon after confirmation', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(deps.delete).toHaveBeenCalledWith(weapon.id)
    confirm.mockRestore()
  })
})
