import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import type { RestorationBonusSet } from '../../domain/models/publicTypes'
import { BonusSetEditor } from './BonusSetEditor'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { createDefaultBonusSet } from '../../domain/forms/entityDrafts'

function EditorFixture({ empty = false }: { empty?: boolean }) {
  const master = createValidMasterDataFixture()
  const weaponTypeId = 'weapon.fixture.a'
  if (empty) master.weaponBonusDefinitions = []
  else {
    master.bonusTypes.push({ id: 'bonus_type.fixture.utility', displayNameJa: '補助fixture', displayNameEn: 'Utility fixture', sortOrder: 20, category: 'utility', isEnabled: true })
    master.bonusRanks.push({ id: 'bonus_rank.fixture.utility', displayNameJa: '補助ランクfixture', displayNameEn: 'Utility rank fixture', order: 3, isEx: false, isEnabled: true })
    master.weaponBonusDefinitions.push({ id: 'weapon_bonus.fixture.a.utility', weaponTypeId, bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.utility', scope: 'gogma_artian', displayNameJa: '補助fixture', displayNameEn: 'Utility fixture', effectValue: 'fixture-only', sortOrder: 30, isEnabled: true })
  }
  const [value, setValue] = useState(Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' })) as RestorationBonusSet)
  return <BonusSetEditor label="復元ボーナス" master={master} weaponTypeId={weaponTypeId} elementId="element.fixture.a" scope="gogma_artian" value={value} onChange={setValue} />
}

function FormalEditor({
  weaponTypeId,
  elementId = 'element.thunder',
}: {
  weaponTypeId: string
  elementId?: string
}) {
  const result = loadMasterData()
  if (!result.ok) throw new Error('Master load failed')
  const [value, setValue] = useState(
    createDefaultBonusSet(result.data, weaponTypeId, elementId),
  )
  return (
    <BonusSetEditor
      label="復元ボーナス"
      master={result.data}
      weaponTypeId={weaponTypeId}
      elementId={elementId}
      scope="gogma_artian"
      value={value}
      onChange={setValue}
    />
  )
}

describe('BonusSetEditor', () => {
  it('shows a warning instead of guessed choices when Master definitions are unavailable', () => {
    render(<EditorFixture empty />)
    expect(screen.getByText(/復元ボーナスのマスターデータが利用できません/)).toBeInTheDocument()
  })

  it('replaces an incompatible rank when the bonus type changes', async () => {
    const user = userEvent.setup()
    render(<EditorFixture />)
    const type = screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0]
    await user.click(type)
    await user.click(screen.getByRole('option', { name: '補助fixture' }))
    expect(screen.getAllByRole('combobox', { name: /ランク/ })[0]).toHaveTextContent('補助ランクfixture')
  })

  it.each([
    ['weapon.great_sword', ['基礎攻撃力強化', '会心率強化', '属性強化', '斬れ味・装填強化'], []],
    ['weapon.bow', ['基礎攻撃力強化', '会心率強化', '属性強化'], ['斬れ味・装填強化']],
    ['weapon.light_bowgun', ['基礎攻撃力強化', '会心率強化', '斬れ味・装填強化'], ['属性強化']],
    ['weapon.heavy_bowgun', ['基礎攻撃力強化', '会心率強化', '斬れ味・装填強化'], ['属性強化']],
  ])('shows only Gogma choices for %s', async (weaponTypeId, expected, excluded) => {
    const user = userEvent.setup()
    render(<FormalEditor weaponTypeId={weaponTypeId} />)
    await user.click(screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0])
    for (const label of expected) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument()
    }
    for (const label of excluded) {
      expect(screen.queryByRole('option', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('option', { name: '斬れ味強化' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '装填数強化' })).not.toBeInTheDocument()
    cleanup()
  })

  it('does not expose Element bonuses for element.none', async () => {
    const user = userEvent.setup()
    render(
      <FormalEditor
        weaponTypeId="weapon.great_sword"
        elementId="element.none"
      />,
    )
    await user.click(
      screen.getAllByRole('combobox', { name: /ボーナス種別/ })[0],
    )
    expect(
      screen.queryByRole('option', { name: '属性強化' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: '斬れ味・装填強化' }),
    ).toBeInTheDocument()
  })
})
