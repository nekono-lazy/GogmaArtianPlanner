import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
} from '../domain/models/publicTypes'
import { EntityFormValidationError, ReferencedEntityDeleteError, type OwnedWeaponDraft } from '../services/crud/entityCrudServices'
import { createDefaultBonusSet } from '../domain/forms/entityDrafts'
import { loadMasterData } from '../domain/master/loadMasterData'
import { getBonusDefinitionsForWeapon } from '../domain/master/masterSelectors'
import { restorationBonusScopeLabels } from '../presentation/labels'
import { hasMaxHeightRule } from '../test/cssRuleAssertions'
import { OwnedWeaponsPage, type OwnedWeaponsPageDependencies } from './OwnedWeaponsPage'

function loadedMaster() {
  const result = loadMasterData()
  if (!result.ok) throw new Error('Master load failed')
  return result.data
}

const NORMAL_SCOPE_LABEL = restorationBonusScopeLabels.normal_artian
const GOGMA_SCOPE_LABEL = restorationBonusScopeLabels.gogma_artian

async function chooseOption(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, name: string) {
  await user.click(combobox)
  await user.click(await screen.findByRole('option', { name }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

/** Every slot is a Master definition for the draft's own weapon type, element, and the given scope. */
function expectSlotsMatchScope(master: ReturnType<typeof loadedMaster>, draft: OwnedWeaponDraft, scope: 'normal_artian' | 'gogma_artian') {
  const definitions = getBonusDefinitionsForWeapon(master, draft.weaponTypeId, draft.elementId, scope)
  expect(draft.restorationBonuses).toHaveLength(5)
  for (const bonus of draft.restorationBonuses) {
    expect(definitions.some((definition) => definition.bonusTypeId === bonus.bonusTypeId && definition.bonusRankId === bonus.bonusRankId)).toBe(true)
  }
}

async function itemFor(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  const item = heading.closest<HTMLElement>('li')
  if (!item) throw new Error(`${name} was not rendered as a list item`)
  return item
}

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

  it('shows an empty state with the add action when nothing is registered', async () => {
    render(<OwnedWeaponsPage dependencies={dependencies()} />)
    expect(await screen.findByText('所持武器は未登録です。')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '所持武器を追加' })).toHaveLength(1)
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('lists each weapon once with kind, type, element, five slots, skills, status, protection and preferred origin', async () => {
    const gogmaWeapon = existingWeapon()
    const normalWeapon: OwnedWeapon = {
      ...existingWeapon(),
      id: 'owned-normal' as OwnedWeapon['id'],
      kind: 'normal',
      rarity: 8,
      name: '通常武器',
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }
    const deps = dependencies(); deps.getAll = vi.fn(async () => [gogmaWeapon, normalWeapon])
    render(<OwnedWeaponsPage dependencies={deps} />)

    const gogmaItem = within(await itemFor('既存武器'))
    expect(gogmaItem.getByText('巨戟アーティア')).toBeInTheDocument()
    expect(gogmaItem.getByText('双剣 / 雷')).toBeInTheDocument()
    const slots = gogmaItem.getByRole('list', { name: '復元ボーナス' })
    expect(within(slots).getAllByRole('listitem')).toHaveLength(5)
    expect(gogmaItem.getByText(/シリーズスキル: なし/)).toBeInTheDocument()
    expect(gogmaItem.getByText('状態: 実用')).toBeInTheDocument()
    expect(gogmaItem.getByText('保護中')).toBeInTheDocument()
    expect(gogmaItem.getByText('優先起点: なし')).toBeInTheDocument()

    const normalItem = within(await itemFor('通常武器'))
    expect(normalItem.getByText('通常アーティア')).toBeInTheDocument()
    expect(normalItem.getByText('状態: —')).toBeInTheDocument()
    expect(normalItem.getByText('未保護')).toBeInTheDocument()
    expect(normalItem.queryByText(/シリーズスキル/)).toBeNull()

    // Both devices share one DOM structure: each action exists once per weapon
    // and is described by that weapon's name.
    for (const [item, name] of [[gogmaItem, '既存武器'], [normalItem, '通常武器']] as const) {
      expect(item.getAllByRole('button', { name: '編集' })).toHaveLength(1)
      expect(item.getByRole('button', { name: '編集' })).toHaveAccessibleDescription(name)
      expect(item.getByRole('button', { name: '削除' })).toHaveAccessibleDescription(name)
    }
  })

  it('offers the bonus scope for a new Gogma, defaulting to gogma_artian', async () => {
    const user = userEvent.setup()
    render(<OwnedWeaponsPage dependencies={dependencies()} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    const dialog = within(screen.getByRole('dialog', { name: '所持武器を追加' }))
    expect(dialog.getByRole('checkbox', { name: '通常アーティアとして登録' })).not.toBeChecked()
    const scope = dialog.getByRole('combobox', { name: 'ボーナス区分' })
    expect(scope).toHaveTextContent(GOGMA_SCOPE_LABEL)
    await user.click(scope)
    expect(screen.getAllByRole('option').map(({ textContent }) => textContent)).toEqual([NORMAL_SCOPE_LABEL, GOGMA_SCOPE_LABEL])
  })

  it('switches a new Gogma from gogma_artian to normal_artian with a fresh normal-tier set', async () => {
    const master = loadedMaster()
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    // A Gogma-only type in slot 1 must not survive the scope change.
    await chooseOption(user, screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0], '斬れ味・装填強化')
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), NORMAL_SCOPE_LABEL)

    expect(screen.getByRole('combobox', { name: 'ボーナス区分' })).toHaveTextContent(NORMAL_SCOPE_LABEL)
    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })).toHaveLength(5)
    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]).not.toHaveTextContent('斬れ味・装填強化')
    await user.click(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0])
    expect(screen.getByRole('option', { name: '斬れ味強化' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '斬れ味・装填強化' })).toBeNull()
    await user.keyboard('{Escape}')

    await user.type(screen.getByRole('textbox', { name: /名前/ }), '巨戟化直後の新規')
    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = deps.save.mock.calls[0][0] as OwnedWeaponDraft
    expect(saved).toMatchObject({ kind: 'gogma', restorationBonusScope: 'normal_artian', status: 'unclassified', isProtected: false })
    expectSlotsMatchScope(master, saved, 'normal_artian')
  })

  it('switches a new Gogma from normal_artian back to gogma_artian with a fresh Gogma-tier set', async () => {
    const master = loadedMaster()
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), NORMAL_SCOPE_LABEL)
    await chooseOption(user, screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0], '斬れ味強化')
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), GOGMA_SCOPE_LABEL)

    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]).not.toHaveTextContent('斬れ味強化')
    await user.click(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0])
    expect(screen.getByRole('option', { name: '斬れ味・装填強化' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '斬れ味強化' })).toBeNull()
    await user.keyboard('{Escape}')

    await user.type(screen.getByRole('textbox', { name: /名前/ }), '巨戟tierの新規')
    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = deps.save.mock.calls[0][0] as OwnedWeaponDraft
    expect(saved).toMatchObject({ kind: 'gogma', restorationBonusScope: 'gogma_artian' })
    expectSlotsMatchScope(master, saved, 'gogma_artian')
  })

  it('keeps the chosen normal_artian scope through a weapon type change', async () => {
    const master = loadedMaster()
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), NORMAL_SCOPE_LABEL)
    await chooseOption(user, screen.getByLabelText('武器種'), '双剣')

    expect(screen.getByRole('combobox', { name: 'ボーナス区分' })).toHaveTextContent(NORMAL_SCOPE_LABEL)
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '双剣')
    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = deps.save.mock.calls[0][0] as OwnedWeaponDraft
    expect(saved).toMatchObject({ kind: 'gogma', weaponTypeId: 'weapon.dual_blades', restorationBonusScope: 'normal_artian' })
    expectSlotsMatchScope(master, saved, 'normal_artian')
  })

  it('keeps the chosen normal_artian scope through an element change, with that element option set', async () => {
    const master = loadedMaster()
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), NORMAL_SCOPE_LABEL)
    await chooseOption(user, screen.getByLabelText('属性'), '火')

    expect(screen.getByRole('combobox', { name: 'ボーナス区分' })).toHaveTextContent(NORMAL_SCOPE_LABEL)
    await user.type(screen.getByRole('textbox', { name: /名前/ }), '火属性')
    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = deps.save.mock.calls[0][0] as OwnedWeaponDraft
    expect(saved.restorationBonusScope).toBe('normal_artian')
    expect(master.elements.find(({ id }) => id === saved.elementId)?.displayNameJa).toBe('火')
    expectSlotsMatchScope(master, saved, 'normal_artian')

    // The editor offers exactly the normal_artian types for the new element.
    const expectedTypes = [...new Set(getBonusDefinitionsForWeapon(master, saved.weaponTypeId, saved.elementId, 'normal_artian').map(({ bonusTypeId }) => bonusTypeId))]
      .map((id) => master.bonusTypes.find((type) => type.id === id)?.displayNameJa)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: '所持武器を追加' }))
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), NORMAL_SCOPE_LABEL)
    await chooseOption(user, screen.getByLabelText('属性'), '火')
    await user.click(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0])
    expect(screen.getAllByRole('option').map(({ textContent }) => textContent)).toEqual(expectedTypes)
  })

  it('opens an existing normal_artian Gogma on its stored scope, saves it unchanged, and writes nothing on cancel', async () => {
    const master = loadedMaster()
    const inheritedBonuses = createDefaultBonusSet(master, 'weapon.dual_blades', 'element.thunder', 'normal_artian')
    const weapon: OwnedWeapon = { ...existingWeapon(), name: '通常継承の既存', restorationBonusScope: 'normal_artian', restorationBonuses: inheritedBonuses, isProtected: false }
    const user = userEvent.setup(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    render(<OwnedWeaponsPage dependencies={deps} />)

    await user.click(await screen.findByRole('button', { name: '編集' }))
    await chooseOption(user, screen.getByRole('combobox', { name: 'ボーナス区分' }), GOGMA_SCOPE_LABEL)
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.save).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByRole('combobox', { name: 'ボーナス区分' })).toHaveTextContent(NORMAL_SCOPE_LABEL)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gogma', restorationBonusScope: 'normal_artian', restorationBonuses: inheritedBonuses }), weapon)
  })

  it('keeps Normal Artian fixed to normal_artian with no scope selector', async () => {
    const user = userEvent.setup(); const deps = dependencies()
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '所持武器を追加' }))
    await user.click(screen.getByRole('checkbox', { name: '通常アーティアとして登録' }))
    const dialog = within(screen.getByRole('dialog', { name: '所持武器を追加' }))
    expect(dialog.queryByRole('combobox', { name: 'ボーナス区分' })).toBeNull()
    expect(dialog.getByText(`ボーナス区分: ${NORMAL_SCOPE_LABEL}`)).toBeInTheDocument()
    await user.type(dialog.getByRole('textbox', { name: /名前/ }), '通常')
    await user.click(dialog.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'normal', restorationBonusScope: 'normal_artian', status: null }), null)
  })

  it('keeps a Gogma weapon inherited normal_artian scope in the list, the editor, and after a weapon type change', async () => {
    // A converted Gogma legitimately keeps its five normal-tier slots until the
    // first bonus amendment (`docs/DATA_MODEL.md` 7.1), so kind must not decide scope.
    const master = loadedMaster()
    const inheritedBonuses = createDefaultBonusSet(master, 'weapon.dual_blades', 'element.thunder', 'normal_artian')
    const weapon: OwnedWeapon = { ...existingWeapon(), name: '巨戟化直後', restorationBonusScope: 'normal_artian', restorationBonuses: inheritedBonuses, isProtected: false }
    const expectedLabels = inheritedBonuses.map((bonus) => master.weaponBonusDefinitions.find((definition) => definition.scope === 'normal_artian' && definition.weaponTypeId === 'weapon.dual_blades' && definition.bonusTypeId === bonus.bonusTypeId && definition.bonusRankId === bonus.bonusRankId)?.displayNameJa)
    expect(expectedLabels.every((label) => typeof label === 'string')).toBe(true)
    const user = userEvent.setup(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    render(<OwnedWeaponsPage dependencies={deps} />)

    const item = within(await itemFor('巨戟化直後'))
    expect(item.getByText('巨戟アーティア')).toBeInTheDocument()
    expect(item.getByText('ボーナス区分: 通常継承（通常アーティアのボーナス）')).toBeInTheDocument()
    const slots = within(item.getByRole('list', { name: '復元ボーナス' })).getAllByRole('listitem')
    expect(slots.map((slot) => slot.textContent)).toEqual(expectedLabels.map((label, index) => `${index + 1}${label}`))
    expect(item.queryByText('不明')).toBeNull()

    await user.click(item.getByRole('button', { name: '編集' }))
    // The selector opens on the stored scope; kind never decides it.
    expect(within(screen.getByRole('dialog', { name: '所持武器を編集' })).getByRole('combobox', { name: 'ボーナス区分' })).toHaveTextContent(NORMAL_SCOPE_LABEL)
    await user.click(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0])
    expect(screen.getByRole('option', { name: '斬れ味強化' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '斬れ味・装填強化' })).toBeNull()
    await user.keyboard('{Escape}')

    await user.click(screen.getByLabelText('武器種'))
    await user.click(screen.getByRole('option', { name: '大剣' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = deps.save.mock.calls[0][0] as OwnedWeaponDraft
    expect(saved).toMatchObject({ kind: 'gogma', weaponTypeId: 'weapon.great_sword', restorationBonusScope: 'normal_artian' })
    expect(saved.restorationBonuses).toHaveLength(5)
    for (const bonus of saved.restorationBonuses) {
      expect(master.weaponBonusDefinitions.some((definition) => definition.scope === 'normal_artian' && definition.weaponTypeId === 'weapon.great_sword' && definition.bonusTypeId === bonus.bonusTypeId && definition.bonusRankId === bonus.bonusRankId)).toBe(true)
    }
  })

  it('keeps a very long save error fully readable in a bounded region while 保存 / キャンセル stay reachable', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    const issues = Array.from({ length: 12 }, (_, index) => `restorationBonuses[${index}]: 選択した武器種では利用できないボーナス／Rankです。`)
    deps.save = vi.fn(async () => { throw new EntityFormValidationError(issues) })
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    const dialog = screen.getByRole('dialog', { name: '所持武器を編集' })
    const alert = await within(dialog).findByRole('alert')
    // The whole message is in the DOM: nothing is truncated.
    expect(alert).toHaveTextContent(issues.join(' / '))
    // The error sits outside the scrolling form content, and before the actions.
    expect(alert.closest('.MuiDialogContent-root')).toBeNull()
    const save = within(dialog).getByRole('button', { name: '保存' })
    const cancel = within(dialog).getByRole('button', { name: 'キャンセル' })
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(save).toBeEnabled()
    expect(cancel).toBeEnabled()
    // The region is bounded and scrolls rather than pushing the actions away.
    expect(getComputedStyle(alert).overflowY).toBe('auto')
    expect(hasMaxHeightRule(alert)).toBe(true)
  })

  it('shows the Gogma amendment scope for gogma_artian slots', async () => {
    const deps = dependencies(); deps.getAll = vi.fn(async () => [existingWeapon()])
    render(<OwnedWeaponsPage dependencies={deps} />)
    expect(within(await itemFor('既存武器')).getByText('ボーナス区分: 巨戟amendment後（巨戟のボーナス）')).toBeInTheDocument()
  })

  it.each([
    ['a validation error', () => new EntityFormValidationError(['name: 名前を入力してください'])],
    ['a persistence error', () => new Error('IndexedDB write failed')],
  ])('shows %s inside the open Dialog, not only behind the modal', async (_kind, createError) => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    const failure = createError()
    const message = failure instanceof EntityFormValidationError ? failure.issues.join(' / ') : failure.message
    deps.save = vi.fn(async () => { throw failure })
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    const dialog = screen.getByRole('dialog', { name: '所持武器を編集' })
    expect(await within(dialog).findByText(message)).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(message)
    // Every rendering of the message lives inside the Dialog.
    for (const element of screen.getAllByText(message)) {
      expect(dialog.contains(element)).toBe(true)
    }
    expect(screen.queryByText('所持武器を保存しました。')).toBeNull()

    // Cancelling and reopening does not carry the old form error over.
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(within(screen.getByRole('dialog', { name: '所持武器を編集' })).queryByRole('alert')).toBeNull()
    expect(screen.queryByText(message)).toBeNull()
  })

  it('keeps the registered kind fixed when editing, and explains why', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    const kind = screen.getByRole('checkbox', { name: '通常アーティアとして登録' })
    expect(kind).toBeDisabled()
    expect(kind).toHaveAccessibleDescription('登録済み武器の種類は変更できません。')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gogma' }), weapon)
    expect(await screen.findByText('所持武器を保存しました。')).toBeInTheDocument()
  })

  it('resets the five slots when the weapon type changes', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByLabelText('武器種'))
    await user.click(screen.getByRole('option', { name: '大剣' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    const saved = deps.save.mock.calls[0][0] as OwnedWeaponDraft
    expect(saved.weaponTypeId).toBe('weapon.great_sword')
    expect(saved.restorationBonuses).toHaveLength(5)
    expect(saved.restorationBonuses).not.toEqual(weapon.restorationBonuses)
  })

  it('refuses to delete a referenced weapon and keeps it listed', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon])
    deps.delete = vi.fn(async () => { throw new ReferencedEntityDeleteError([{ kind: 'target_weapon', entityId: 'target.a', path: 'preferredOwnedWeaponId' }]) })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(await screen.findByText(/参照中のため削除できません/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '既存武器' })).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('deletes an unreferenced weapon after confirmation', async () => {
    const user = userEvent.setup(); const weapon = existingWeapon(); const deps = dependencies(); deps.getAll = vi.fn(async () => [weapon]); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '削除' }))
    expect(deps.delete).toHaveBeenCalledWith(weapon.id)
    confirm.mockRestore()
  })
})
