import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  TargetWeapon,
} from '../domain/models/publicTypes'
import type {
  OwnedWeaponDraft,
  TargetWeaponDraft,
} from '../services/crud/entityCrudServices'
import {
  OwnedWeaponsPage,
  type OwnedWeaponsPageDependencies,
} from './OwnedWeaponsPage'
import {
  TargetWeaponsPage,
  type TargetWeaponsPageDependencies,
} from './TargetWeaponsPage'

const WEAPON_TYPE = 'weapon.dual_blades'
const ELEMENT = 'element.thunder'

function gogma(
  id: string,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  return {
    id: id as OwnedWeapon['id'],
    kind: 'gogma',
    name: id,
    weaponTypeId: WEAPON_TYPE,
    elementId: ELEMENT,
    restorationBonusScope: 'gogma_artian',
    restorationBonuses: Array.from({ length: 5 }, () => ({
      bonusTypeId: 'bonus_type.attack',
      bonusRankId: 'bonus_rank.ex',
    })) as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null,
    groupSkillId: null,
    status: 'practical',
    isProtected: false,
    memo: null,
    createdAt: 'created',
    updatedAt: 'updated',
    ...overrides,
  }
}

function normal(id: string): OwnedNormalArtianWeapon {
  const base = gogma(id)
  return {
    id: base.id,
    kind: 'normal',
    rarity: 8,
    name: id,
    weaponTypeId: WEAPON_TYPE,
    elementId: ELEMENT,
    restorationBonusScope: 'normal_artian',
    restorationBonuses: base.restorationBonuses,
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    memo: null,
    createdAt: 'created',
    updatedAt: 'updated',
  }
}

function targetWeapon(
  id: string,
  overrides: Partial<TargetWeapon> = {},
): TargetWeapon {
  return {
    id: id as TargetWeapon['id'],
    name: id,
    weaponTypeId: WEAPON_TYPE,
    elementId: ELEMENT,
    priority: 3,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    idealBonuses: Array.from({ length: 5 }, () => ({
      bonusTypeId: 'bonus_type.attack',
      bonusRankId: 'bonus_rank.ex',
    })) as TargetWeapon['idealBonuses'],
    practicalBonusConditions: [],
    alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
    createdAt: 'created',
    updatedAt: 'updated',
    ...overrides,
  }
}

function targetDependencies(
  targets: TargetWeapon[],
  ownedWeapons: OwnedWeapon[],
) {
  const save = vi.fn(
    async (draft: TargetWeaponDraft, existing: TargetWeapon | null) => ({
      ...draft,
      id: existing?.id ?? ('target.new' as TargetWeapon['id']),
      createdAt: 'now',
      updatedAt: 'now',
    }),
  )
  return {
    getAll: vi.fn(async () => targets),
    getOwnedWeapons: vi.fn(async () => ownedWeapons),
    save,
    delete: vi.fn(async () => undefined),
  } satisfies TargetWeaponsPageDependencies
}

function ownedDependencies(
  weapons: OwnedWeapon[],
  targets: TargetWeapon[],
) {
  const save = vi.fn(
    async (
      draft: OwnedWeaponDraft,
      existing: OwnedWeapon | null,
    ): Promise<OwnedWeapon> => ({
      ...draft,
      id: existing?.id ?? ('owned.new' as OwnedWeapon['id']),
      createdAt: 'now',
      updatedAt: 'now',
    }),
  )
  return {
    getAll: vi.fn(async () => weapons),
    getTargets: vi.fn(async () => targets),
    save,
    delete: vi.fn(async () => undefined),
  } satisfies OwnedWeaponsPageDependencies
}

async function openPreferredSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '編集' }))
  await user.click(await screen.findByLabelText('優先する所持武器'))
  return within(await screen.findByRole('listbox'))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Target Weapons preferred owned weapon select', () => {
  it('lists compatible Normal and Gogma weapons, and no incompatible one', async () => {
    const user = userEvent.setup()
    const weapons = [
      gogma('owned.gogma'),
      normal('owned.normal'),
      gogma('owned.other-element', { elementId: 'element.fire' }),
      gogma('owned.other-type', { weaponTypeId: 'weapon.great_sword' }),
    ]
    render(
      <TargetWeaponsPage
        dependencies={targetDependencies([targetWeapon('target.a')], weapons)}
      />,
    )
    const listbox = await openPreferredSelect(user)

    expect(listbox.getByRole('option', { name: /owned\.gogma/ })).toBeInTheDocument()
    expect(listbox.getByRole('option', { name: /owned\.normal/ })).toBeInTheDocument()
    expect(listbox.queryByRole('option', { name: /owned\.other-element/ })).toBeNull()
    expect(listbox.queryByRole('option', { name: /owned\.other-type/ })).toBeNull()
    expect(listbox.getByRole('option', { name: '指定なし' })).toBeInTheDocument()
  })

  it('shows a protected weapon but never lets it be selected', async () => {
    const user = userEvent.setup()
    render(
      <TargetWeaponsPage
        dependencies={targetDependencies(
          [targetWeapon('target.a')],
          [gogma('owned.protected', { isProtected: true })],
        )}
      />,
    )
    const listbox = await openPreferredSelect(user)
    const option = listbox.getByRole('option', { name: /owned\.protected/ })

    // Shown, so the user can see why it is unavailable, and disabled rather
    // than hidden (`docs/UI_FLOW.md` 8.1).
    expect(option).toHaveTextContent('[保護中・選択不可]')
    expect(option).toHaveAttribute('aria-disabled', 'true')
  })

  it('marks a weapon another Target already prefers, and orders the groups', async () => {
    const user = userEvent.setup()
    const current = gogma('owned.current')
    const free = gogma('owned.free')
    const taken = gogma('owned.taken')
    const locked = gogma('owned.locked', { isProtected: true })
    render(
      <TargetWeaponsPage
        dependencies={targetDependencies(
          [
            targetWeapon('target.a', { preferredOwnedWeaponId: current.id }),
            targetWeapon('target.b', { preferredOwnedWeaponId: taken.id }),
          ],
          [locked, taken, free, current],
        )}
      />,
    )
    await user.click((await screen.findAllByRole('button', { name: '編集' }))[0])
    await user.click(await screen.findByLabelText('優先する所持武器'))
    const listbox = within(await screen.findByRole('listbox'))

    expect(
      listbox.getByRole('option', { name: /owned\.taken/ }),
    ).toHaveTextContent('[target.bに割当中]')
    // Current selection, then unassigned, then assigned elsewhere, then
    // protected - independent of the order the weapons were loaded in.
    expect(
      listbox
        .getAllByRole('option')
        .map((option) => option.textContent ?? '')
        .filter((text) => text !== '指定なし')
        .map((text) => text.replace(/^.*?\/ /, '').split(' ')[0]),
    ).toEqual(['owned.current', 'owned.free', 'owned.taken', 'owned.locked'])
  })

  it('confirms before taking a weapon from another Target, and keeps the draft on cancel', async () => {
    const user = userEvent.setup()
    const taken = gogma('owned.taken')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deps = targetDependencies(
      [
        targetWeapon('target.a'),
        targetWeapon('target.b', { preferredOwnedWeaponId: taken.id }),
      ],
      [taken],
    )
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click((await screen.findAllByRole('button', { name: '編集' }))[0])
    await user.click(await screen.findByLabelText('優先する所持武器'))
    await user.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: /owned\.taken/,
      }),
    )

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('target.b'))
    // Cancelled: the draft is unchanged, and nothing was written.
    expect(
      await screen.findByLabelText('優先する所持武器'),
    ).not.toHaveTextContent('owned.taken')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ preferredOwnedWeaponId: null }),
      expect.anything(),
    )
  })

  it('saves the takeover once confirmed', async () => {
    const user = userEvent.setup()
    const taken = gogma('owned.taken')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deps = targetDependencies(
      [
        targetWeapon('target.a'),
        targetWeapon('target.b', { preferredOwnedWeaponId: taken.id }),
      ],
      [taken],
    )
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click((await screen.findAllByRole('button', { name: '編集' }))[0])
    await user.click(await screen.findByLabelText('優先する所持武器'))
    await user.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: /owned\.taken/,
      }),
    )
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ preferredOwnedWeaponId: taken.id }),
      expect.objectContaining({ id: 'target.a' }),
    )
    // The Service releases the previous holder atomically, and the list shows
    // that release.
    expect(await screen.findByText('優先起点: なし')).toBeInTheDocument()
  })

  it('clears the preference with 指定なし', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.gogma')
    const deps = targetDependencies(
      [targetWeapon('target.a', { preferredOwnedWeaponId: weapon.id })],
      [weapon],
    )
    render(<TargetWeaponsPage dependencies={deps} />)
    // The card shows the current preference before editing.
    expect(await screen.findByText('優先起点: owned.gogma')).toBeInTheDocument()
    const listbox = await openPreferredSelect(user)
    await user.click(listbox.getByRole('option', { name: '指定なし' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ preferredOwnedWeaponId: null }),
      expect.anything(),
    )
  })

  it('drops a preference the Target own definition change makes incompatible', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.gogma')
    const deps = targetDependencies(
      [targetWeapon('target.a', { preferredOwnedWeaponId: weapon.id })],
      [weapon],
    )
    const confirm = vi.spyOn(window, 'confirm')
    render(<TargetWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(await screen.findByLabelText('属性'))
    await user.click(
      within(await screen.findByRole('listbox')).getAllByRole('option')[0],
    )
    await user.click(screen.getByRole('button', { name: '保存' }))

    // Changing the Target's own definition is not taking a weapon from another
    // Target, so no confirmation is asked; the draft simply drops it.
    expect(confirm).not.toHaveBeenCalled()
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ preferredOwnedWeaponId: null }),
      expect.anything(),
    )
  })
})

describe('Owned Weapons preferred-origin relation', () => {
  it('no longer offers the old related-Target editing UI', async () => {
    const user = userEvent.setup()
    render(
      <OwnedWeaponsPage
        dependencies={ownedDependencies(
          [gogma('owned.gogma')],
          [targetWeapon('target.a')],
        )}
      />,
    )
    await user.click(await screen.findByRole('button', { name: '編集' }))

    expect(screen.queryByText('関連する目標武器')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'target.a' })).toBeNull()
  })

  it('shows the preferring Target read-only in the list', async () => {
    const weapon = gogma('owned.gogma')
    render(
      <OwnedWeaponsPage
        dependencies={ownedDependencies(
          [weapon],
          [targetWeapon('target.a', { preferredOwnedWeaponId: weapon.id })],
        )}
      />,
    )
    expect(await screen.findByText('優先起点: target.a')).toBeInTheDocument()
  })

  it('confirms before protecting a preferred weapon and cancels without saving', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.gogma')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deps = ownedDependencies(
      [weapon],
      [targetWeapon('target.a', { preferredOwnedWeaponId: weapon.id })],
    )
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('checkbox', { name: '保護する' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('target.a'))
    // Neither the weapon nor the Target changed.
    expect(deps.save).not.toHaveBeenCalled()
    expect(await screen.findByText('優先起点: target.a')).toBeInTheDocument()
  })

  it('protects and releases the Target preference once confirmed', async () => {
    const user = userEvent.setup()
    const weapon = gogma('owned.gogma')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deps = ownedDependencies(
      [weapon],
      [targetWeapon('target.a', { preferredOwnedWeaponId: weapon.id })],
    )
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('checkbox', { name: '保護する' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({ isProtected: true }),
      expect.objectContaining({ id: weapon.id }),
    )
    expect(await screen.findByText('優先起点: なし')).toBeInTheDocument()
  })

  it('asks no confirmation when no Target prefers the weapon', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deps = ownedDependencies([gogma('owned.gogma')], [targetWeapon('target.a')])
    render(<OwnedWeaponsPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('checkbox', { name: '保護する' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(confirm).not.toHaveBeenCalled()
    expect(deps.save).toHaveBeenCalledOnce()
  })
})
