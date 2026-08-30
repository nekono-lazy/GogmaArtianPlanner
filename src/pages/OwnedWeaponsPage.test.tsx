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
    id: 'owned-ui' as OwnedWeapon['id'], kind: 'gogma', name: '既存武器', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonusScope: 'gogma_artian', restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as OwnedWeapon['restorationBonuses'],
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

  it('shows verified Japanese Master choices without the old core-data warning', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    expect(screen.queryByText(/一部のゲームデータは未登録または未検証/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('武器種')).toHaveTextContent('大剣')
    expect(screen.getByLabelText('属性')).toHaveTextContent('無属性')
    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]).toHaveTextContent('基礎攻撃力強化')
    expect(screen.getAllByRole('combobox', { name: /ランク/ })[0]).toHaveTextContent('I')
    await user.click(screen.getByLabelText('シリーズスキル'))
    expect(await screen.findByRole('option', { name: '闢獣の力' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(22)
    expect(screen.queryByRole('option', { name: '花舞の祈り' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByLabelText('グループスキル'))
    expect(await screen.findByRole('option', { name: '鱗張りの技法' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(17)
    expect(screen.queryByRole('option', { name: '拳を極めし者' })).not.toBeInTheDocument()
  })

  it('defaults to Gogma and switches new input to Normal-only fields and bonuses', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(
      await screen.findByRole('button', { name: '所持武器を追加' }),
    )
    const normalToggle = screen.getByRole('checkbox', {
      name: '通常アーティアとして登録',
    })
    expect(normalToggle).not.toBeChecked()
    expect(screen.getByLabelText('シリーズスキル')).toBeInTheDocument()
    expect(screen.getByLabelText('状態')).toBeInTheDocument()
    await user.click(normalToggle)
    expect(screen.queryByLabelText('シリーズスキル')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('グループスキル')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('状態')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('レア度')).not.toBeInTheDocument()
    await user.click(
      screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0],
    )
    expect(
      screen.getByRole('option', { name: '斬れ味強化' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: '斬れ味・装填強化' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: '属性強化' }),
    ).not.toBeInTheDocument()
  })

  it('registers owned Normal Artian as rarity 8 without a rarity selector', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await user.click(screen.getByRole('checkbox', { name: '通常アーティアとして登録' }))
    await user.type(screen.getByRole('textbox', { name: /名前/ }), 'レア8通常')
    expect(screen.queryByLabelText('レア度')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'normal', rarity: 8 }),
      null,
    )
  })

  it('deletes an unreferenced weapon after confirmation', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(deps.delete).toHaveBeenCalledWith(weapon.id)
    confirm.mockRestore()
  })
})
