import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createTargetWeaponDraft } from '../../domain/forms/entityDrafts'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'
import type { TargetWeaponDraft } from '../../services/crud/entityCrudServices'
import { TargetCompromiseEditor } from './TargetCompromiseEditor'

function verifiedMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error('Master load failed')
  return result.data
}

const master = verifiedMaster()
const GOGMA_ATTACK: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }
const ALL_ATTACK: RestorationBonusSet = [GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK]

function draft(weaponTypeId: string, elementId: string, overrides: Partial<TargetWeaponDraft> = {}): TargetWeaponDraft {
  return { ...createTargetWeaponDraft(master), weaponTypeId, elementId, idealBonuses: ALL_ATTACK, ...overrides }
}

function Editor({ initial, onChangeSpy }: { initial: TargetWeaponDraft; onChangeSpy?: () => void }) {
  const [value, setValue] = useState(initial)
  return <TargetCompromiseEditor target={value} master={master} onChange={(conditions) => {
    onChangeSpy?.()
    setValue({ ...value, ...conditions })
  }} />
}

async function optionsOf(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name }))
  const listbox = within(await screen.findByRole('listbox'))
  return listbox.getAllByRole('option')
}

function elementAlternative(minimumRankId = 'bonus_rank.ii'): TargetWeaponDraft['alternativeBonusRules'] {
  return [{
    id: 'alternative',
    sourceBonusTypeId: 'bonus_type.attack',
    maxReplacementCount: 1,
    options: [{ alternativeBonusTypeId: 'bonus_type.element', minimumRankId, requiredExCount: 0 }],
  }]
}

describe('TargetCompromiseEditor Production bonus availability', () => {
  it('offers Element as an alternative for Switch Axe element.none', async () => {
    const user = userEvent.setup()
    render(<Editor initial={draft('weapon.switch_axe', 'element.none')} />)
    await user.click(screen.getByRole('button', { name: '代替条件を追加' }))
    const options = await optionsOf(user, '代替ボーナス種別')
    expect(options.map((option) => option.textContent)).toEqual(['会心率強化', '属性強化', '斬れ味・装填強化'])
  })

  it('never offers Element as an alternative for Bow Poison', async () => {
    const user = userEvent.setup()
    render(<Editor initial={draft('weapon.bow', 'element.poison')} />)
    await user.click(screen.getByRole('button', { name: '代替条件を追加' }))
    const options = await optionsOf(user, '代替ボーナス種別')
    expect(options.map((option) => option.textContent)).toEqual(['会心率強化'])
  })

  it('takes alternative and practical ranks from the same availability', async () => {
    const user = userEvent.setup()
    render(<Editor initial={draft('weapon.switch_axe', 'element.none', {
      practicalBonusConditions: [{ id: 'practical', bonusTypeId: 'bonus_type.attack', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }],
      alternativeBonusRules: elementAlternative(),
    })} />)
    expect((await optionsOf(user, '代替最低ランク')).map((option) => option.textContent)).toEqual(['II', 'EX'])
    await user.keyboard('{Escape}')
    expect((await optionsOf(user, '最低ランク')).map((option) => option.textContent)).toEqual(['II', 'III', 'EX'])
  })

  it('keeps a stored alternative outside Production availability visible and unselectable without rewriting it', async () => {
    const user = userEvent.setup()
    const onChangeSpy = vi.fn()
    render(<Editor initial={draft('weapon.bow', 'element.poison', { alternativeBonusRules: elementAlternative() })} onChangeSpy={onChangeSpy} />)
    expect(screen.getByRole('combobox', { name: '代替ボーナス種別' })).toHaveTextContent('属性強化（現在値・Production抽選対象外）')
    expect(screen.getByRole('combobox', { name: '代替最低ランク' })).toHaveTextContent('II（現在値・Production抽選対象外）')
    expect(onChangeSpy).not.toHaveBeenCalled()
    const options = await optionsOf(user, '代替ボーナス種別')
    const legacy = options.find((option) => option.textContent === '属性強化（現在値・Production抽選対象外）')
    expect(legacy).toHaveAttribute('aria-disabled', 'true')
    expect(options.map((option) => option.textContent)).not.toContain('属性強化')
  })
})
