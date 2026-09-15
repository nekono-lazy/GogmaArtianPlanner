import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import type { ArtianBonusScope, MasterDataRoot } from '../../domain/master/masterTypes'
import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'
import { BonusSetEditor } from './BonusSetEditor'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { createDefaultBonusSet } from '../../domain/forms/entityDrafts'

function verifiedMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error('Master load failed')
  return result.data
}

function FormalEditor({
  weaponTypeId,
  elementId = 'element.thunder',
  scope = 'gogma_artian',
  master = verifiedMaster(),
  initialValue,
  onChangeSpy,
}: {
  weaponTypeId: string
  elementId?: string
  scope?: ArtianBonusScope
  master?: MasterDataRoot
  initialValue?: RestorationBonusSet
  onChangeSpy?: (value: RestorationBonusSet) => void
}) {
  const [value, setValue] = useState(
    () => initialValue ?? createDefaultBonusSet(master, weaponTypeId, elementId, scope),
  )
  return (
    <BonusSetEditor
      label="復元ボーナス"
      master={master}
      weaponTypeId={weaponTypeId}
      elementId={elementId}
      scope={scope}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next)
        setValue(next)
      }}
    />
  )
}

const GOGMA_ATTACK: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }

async function openFirstTypeSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]!)
  return within(await screen.findByRole('listbox'))
}

describe('BonusSetEditor', () => {
  it('shows an error instead of guessed choices when Master definitions are unavailable', () => {
    const master = verifiedMaster()
    master.weaponBonusDefinitions = []
    render(<FormalEditor weaponTypeId="weapon.great_sword" master={master} initialValue={[GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK]} />)
    expect(screen.getByText(/復元ボーナスのマスターデータが利用できません/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows an error instead of Master-only choices when the Production authority cannot classify the weapon', () => {
    const fixture = createValidMasterDataFixture()
    const value = Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' })) as RestorationBonusSet
    render(<FormalEditor weaponTypeId="weapon.fixture.a" elementId="element.fixture.a" master={fixture} initialValue={value} />)
    expect(screen.getByText(/復元ボーナス抽選対象を判定できません/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('replaces an incompatible rank when the bonus type changes', async () => {
    const user = userEvent.setup()
    render(<FormalEditor weaponTypeId="weapon.great_sword" elementId="element.fire" />)
    const options = await openFirstTypeSelect(user)
    await user.click(options.getByRole('option', { name: '斬れ味・装填強化' }))
    expect(screen.getAllByRole('combobox', { name: /ランク/ })[0]).toHaveTextContent('通常')
  })

  it.each([
    ['weapon.great_sword', ['基礎攻撃力強化', '会心率強化', '属性強化', '斬れ味・装填強化'], []],
    ['weapon.bow', ['基礎攻撃力強化', '会心率強化', '属性強化'], ['斬れ味・装填強化']],
    ['weapon.light_bowgun', ['基礎攻撃力強化', '会心率強化', '斬れ味・装填強化'], ['属性強化']],
    ['weapon.heavy_bowgun', ['基礎攻撃力強化', '会心率強化', '斬れ味・装填強化'], ['属性強化']],
  ])('shows only Gogma choices for %s', async (weaponTypeId, expected, excluded) => {
    const user = userEvent.setup()
    render(<FormalEditor weaponTypeId={weaponTypeId} />)
    const options = await openFirstTypeSelect(user)
    for (const label of expected) {
      expect(options.getByRole('option', { name: label })).toBeInTheDocument()
    }
    for (const label of excluded) {
      expect(options.queryByRole('option', { name: label })).not.toBeInTheDocument()
    }
    expect(options.queryByRole('option', { name: '斬れ味強化' })).not.toBeInTheDocument()
    expect(options.queryByRole('option', { name: '装填数強化' })).not.toBeInTheDocument()
    cleanup()
  })

  it('does not expose Element bonuses for a Melee element.none weapon', async () => {
    const user = userEvent.setup()
    render(<FormalEditor weaponTypeId="weapon.great_sword" elementId="element.none" />)
    const options = await openFirstTypeSelect(user)
    expect(options.queryByRole('option', { name: '属性強化' })).not.toBeInTheDocument()
    expect(options.getByRole('option', { name: '斬れ味・装填強化' })).toBeInTheDocument()
  })

  it.each([
    ['normal_artian', ['基礎攻撃力強化', '会心率強化', '属性強化', '斬れ味強化']],
    ['gogma_artian', ['基礎攻撃力強化', '会心率強化', '属性強化', '斬れ味・装填強化']],
  ] as const)('offers Element to Switch Axe element.none in %s scope', async (scope, expected) => {
    const user = userEvent.setup()
    render(<FormalEditor weaponTypeId="weapon.switch_axe" elementId="element.none" scope={scope} />)
    const options = await openFirstTypeSelect(user)
    expect(options.getAllByRole('option').map((option) => option.textContent)).toEqual(expected)
    if (scope === 'gogma_artian') {
      await user.click(options.getByRole('option', { name: '属性強化' }))
      await user.click(screen.getAllByRole('combobox', { name: /ランク/ })[0]!)
      const ranks = within(await screen.findByRole('listbox'))
      expect(ranks.getAllByRole('option').map((option) => option.textContent)).toEqual(['II', 'EX'])
    }
    cleanup()
  })

  it.each([
    ['element.poison', 'normal_artian'],
    ['element.paralysis', 'gogma_artian'],
    ['element.sleep', 'gogma_artian'],
  ] as const)('offers no Element to Bow %s in %s scope', async (elementId, scope) => {
    const user = userEvent.setup()
    render(<FormalEditor weaponTypeId="weapon.bow" elementId={elementId} scope={scope} />)
    const options = await openFirstTypeSelect(user)
    expect(options.getAllByRole('option').map((option) => option.textContent)).toEqual(['基礎攻撃力強化', '会心率強化'])
    cleanup()
  })

  it('keeps a stored value outside Production availability visible, unselectable, and unchanged until replaced', async () => {
    const user = userEvent.setup()
    const onChangeSpy = vi.fn()
    const stored: RestorationBonusSet = [
      { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
      GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK,
    ]
    render(<FormalEditor weaponTypeId="weapon.bow" elementId="element.poison" initialValue={stored} onChangeSpy={onChangeSpy} />)

    expect(screen.getByText(/Productionで抽選されない現在値があります/)).toBeInTheDocument()
    expect(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]).toHaveTextContent('属性強化（現在値・Production抽選対象外）')
    expect(screen.getAllByRole('combobox', { name: /ランク/ })[0]).toHaveTextContent('II（現在値・Production抽選対象外）')
    expect(onChangeSpy).not.toHaveBeenCalled()

    const options = await openFirstTypeSelect(user)
    expect(options.getByRole('option', { name: '属性強化（現在値・Production抽選対象外）' })).toHaveAttribute('aria-disabled', 'true')
    expect(options.queryByRole('option', { name: '属性強化' })).not.toBeInTheDocument()
    await user.click(options.getByRole('option', { name: '会心率強化' }))

    expect(onChangeSpy).toHaveBeenCalledTimes(1)
    expect(onChangeSpy.mock.calls[0]![0][0]).toEqual({ bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.ii' })
    expect(screen.queryByText(/Productionで抽選されない現在値があります/)).not.toBeInTheDocument()
    const reopened = await openFirstTypeSelect(user)
    expect(reopened.queryByRole('option', { name: /現在値・Production抽選対象外/ })).not.toBeInTheDocument()
  })
})
