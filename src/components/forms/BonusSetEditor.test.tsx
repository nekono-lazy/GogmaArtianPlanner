import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import type { RestorationBonusSet } from '../../domain/models/publicTypes'
import { BonusSetEditor } from './BonusSetEditor'

function EditorFixture({ empty = false }: { empty?: boolean }) {
  const master = createValidMasterDataFixture()
  const weaponTypeId = 'weapon.fixture.a'
  if (empty) master.weaponBonusDefinitions = []
  else {
    master.bonusTypes.push({ id: 'bonus_type.fixture.utility', displayNameJa: '補助fixture', displayNameEn: 'Utility fixture', sortOrder: 20, category: 'utility', isEnabled: true })
    master.bonusRanks.push({ id: 'bonus_rank.fixture.utility', displayNameJa: '補助ランクfixture', displayNameEn: 'Utility rank fixture', order: 3, isEx: false, isEnabled: true })
    master.weaponBonusDefinitions.push({ id: 'weapon_bonus.fixture.a.utility', weaponTypeId, bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.utility', displayNameJa: '補助fixture', displayNameEn: 'Utility fixture', effectValue: 'fixture-only', sortOrder: 30, isEnabled: true })
  }
  const [value, setValue] = useState(Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' })) as RestorationBonusSet)
  return <BonusSetEditor label="復元ボーナス" master={master} weaponTypeId={weaponTypeId} value={value} onChange={setValue} />
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
})
