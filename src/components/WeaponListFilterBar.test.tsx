import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import { getEnabledElements, getEnabledWeaponTypes } from '../domain/master/masterSelectors'
import { emptyWeaponListFilter, type WeaponListFilter } from '../presentation/weaponListFilter'
import { WeaponListFilterBar, WeaponListFilterEmpty } from './WeaponListFilterBar'

function master() {
  const result = loadMasterData()
  if (!result.ok) throw new Error('Master load failed')
  return result.data
}

function Harness({ onChange, shownCount = 3 }: { onChange?(filter: WeaponListFilter): void; shownCount?: number }) {
  const [filter, setFilter] = useState<WeaponListFilter>(emptyWeaponListFilter)
  const data = master()
  return (
    <WeaponListFilterBar
      label="所持武器の絞り込み"
      filter={filter}
      onChange={(next) => {
        onChange?.(next)
        setFilter(next)
      }}
      weaponTypes={getEnabledWeaponTypes(data)}
      elements={getEnabledElements(data)}
      totalCount={5}
      shownCount={shownCount}
      unit="本"
    />
  )
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByRole('combobox', { name }))
  await user.click(await screen.findByRole('option', { name: option }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

describe('WeaponListFilterBar', () => {
  it('starts at すべて for both fields with no status text and no clear action', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: '所持武器の絞り込み' })
    expect(within(group).getByRole('combobox', { name: '武器種で絞り込み' })).toHaveTextContent('すべて')
    expect(within(group).getByRole('combobox', { name: '属性で絞り込み' })).toHaveTextContent('すべて')
    expect(within(group).getByRole('status')).toHaveTextContent('')
    expect(within(group).queryByRole('button', { name: '絞り込みを解除' })).toBeNull()
  })

  it('offers every enabled weapon type and element in Master order after すべて', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const data = master()
    await user.click(screen.getByRole('combobox', { name: '武器種で絞り込み' }))
    const typeOptions = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
    expect(typeOptions).toEqual(['すべて', ...getEnabledWeaponTypes(data).map(({ displayNameJa }) => displayNameJa)])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    await user.click(screen.getByRole('combobox', { name: '属性で絞り込み' }))
    const elementOptions = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
    expect(elementOptions).toEqual(['すべて', ...getEnabledElements(data).map(({ displayNameJa }) => displayNameJa)])
  })

  it('maps a choice to its Master ID, announces the shown count, and clears back to すべて', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const data = master()
    const bow = getEnabledWeaponTypes(data).find(({ id }) => id === 'weapon.bow')
    const fire = getEnabledElements(data).find(({ id }) => id === 'element.fire')
    if (!bow || !fire) throw new Error('fixture Master IDs missing')

    await choose(user, '武器種で絞り込み', bow.displayNameJa)
    expect(onChange).toHaveBeenLastCalledWith({ weaponTypeId: 'weapon.bow', elementId: null })
    expect(screen.getByRole('status')).toHaveTextContent('5本中 3本を表示')

    await choose(user, '属性で絞り込み', fire.displayNameJa)
    expect(onChange).toHaveBeenLastCalledWith({ weaponTypeId: 'weapon.bow', elementId: 'element.fire' })

    await choose(user, '武器種で絞り込み', 'すべて')
    expect(onChange).toHaveBeenLastCalledWith({ weaponTypeId: null, elementId: 'element.fire' })

    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }))
    expect(onChange).toHaveBeenLastCalledWith(emptyWeaponListFilter)
    expect(screen.getByRole('combobox', { name: '属性で絞り込み' })).toHaveTextContent('すべて')
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})

describe('WeaponListFilterEmpty', () => {
  it('says the data is unchanged and offers the way back', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<WeaponListFilterEmpty message="条件に一致する所持武器はありません。" onClear={onClear} />)
    expect(screen.getByText('条件に一致する所持武器はありません。')).toBeInTheDocument()
    expect(screen.getByText('絞り込みは表示だけを変えます。登録内容は変わっていません。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
