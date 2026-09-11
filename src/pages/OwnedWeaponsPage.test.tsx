import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
} from '../domain/models/publicTypes'
import type { OwnedWeaponDraft } from '../services/crud/entityCrudServices'
import { OwnedWeaponsPage, type OwnedWeaponsPageDependencies } from './OwnedWeaponsPage'

function dependencies() {
  const save = vi.fn(async (draft: OwnedWeaponDraft) => ({ ...draft, id: crypto.randomUUID() as OwnedWeapon['id'], createdAt: 'now', updatedAt: 'now' }))
  return { getAll: vi.fn(async (): Promise<OwnedWeapon[]> => []), getTargets: vi.fn(async () => []), save, delete: vi.fn(async () => undefined) } satisfies OwnedWeaponsPageDependencies
}

function existingWeapon(): OwnedGogmaArtianWeapon {
  return {
    id: 'owned-ui' as OwnedWeapon['id'], kind: 'gogma', name: '既存武器', weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonusScope: 'gogma_artian', restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' })) as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null, groupSkillId: null, status: 'practical', isProtected: true, memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

describe('OwnedWeaponsPage', () => {
  it('creates a five-slot unclassified weapon unprotected', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    expect(screen.getAllByRole('combobox', { name: /枠[1-5] ボーナス種別/ })).toHaveLength(5)
    expect(screen.getByRole('checkbox', { name: '保護する' })).not.toBeChecked()
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '登録武器')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ name: '登録武器', status: 'unclassified', isProtected: false, restorationBonuses: expect.any(Array) }), null)
    expect((deps.save.mock.calls[0][0] as OwnedWeaponDraft).restorationBonuses).toHaveLength(5)
  })

  it.each([
    ['ideal', '理想', true],
    ['practical', '実用', false],
    ['unclassified', '未分類', false],
  ] as const)(
    'applies the %s protection default when a new Gogma status changes',
    async (status, label, isProtected) => {
      const user = userEvent.setup()
      const deps = dependencies()
      render(<OwnedWeaponsPage dependencies={deps} />)
      await user.click(
        await screen.findByRole('button', { name: '所持武器を追加' }),
      )
      if (status === 'unclassified') {
        await user.click(screen.getByLabelText('状態'))
        await user.click(screen.getByRole('option', { name: '理想' }))
        expect(screen.getByRole('checkbox', { name: '保護する' })).toBeChecked()
      }
      await user.click(screen.getByLabelText('状態'))
      await user.click(screen.getByRole('option', { name: label }))
      const protection = screen.getByRole('checkbox', { name: '保護する' })
      if (isProtected) expect(protection).toBeChecked()
      else expect(protection).not.toBeChecked()

      await user.type(screen.getByRole('textbox', { name: /名前/ }), `新規${label}`)
      await user.click(screen.getByRole('button', { name: '保存' }))
      expect(deps.save).toHaveBeenCalledWith(
        expect.objectContaining({ status, isProtected }),
        null,
      )
    },
  )

  it('relabels Practical to 未分類 with no confirmation and no Protection change', async () => {
    // Status is a user-facing organisation label, so relabelling is ordinary
    // CRUD: it never implies the weapon becomes consumable and never touches
    // protection (`docs/DATA_MODEL.md` 3.2).
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByLabelText('状態')); await user.click(screen.getByRole('option', { name: '未分類' })); await user.click(screen.getByRole('button', { name: '保存' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'unclassified', isProtected: true }), weapon)
    confirm.mockRestore()
  })

  it('never offers 素材 as an owned weapon status', async () => {
    const user = userEvent.setup()
    render(<OwnedWeaponsPage dependencies={dependencies()} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await user.click(screen.getByLabelText('状態'))
    expect(
      screen.getAllByRole('option').map(({ textContent }) => textContent),
    ).toEqual(['未分類', '実用', '理想'])
    expect(screen.queryByRole('option', { name: '素材' })).toBeNull()
  })

  it('preserves explicit protected state when editing Practical to Ideal', async () => {
    const user = userEvent.setup()
    const weapon = existingWeapon()
    const deps = dependencies()
    deps.getAll = vi.fn(async () => [weapon])
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByLabelText('状態'))
    await user.click(screen.getByRole('option', { name: '理想' }))
    expect(screen.getByRole('checkbox', { name: '保護する' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ideal', isProtected: true }),
      weapon,
    )
  })

  it('preserves explicit unprotected state when editing Ideal to Practical', async () => {
    const user = userEvent.setup()
    const weapon: OwnedWeapon = {
      ...existingWeapon(),
      status: 'ideal',
      isProtected: false,
    }
    const deps = dependencies()
    deps.getAll = vi.fn(async () => [weapon])
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByLabelText('状態'))
    await user.click(screen.getByRole('option', { name: '実用' }))
    expect(screen.getByRole('checkbox', { name: '保護する' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'practical', isProtected: false }),
      weapon,
    )
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
