import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalArtianCounter } from '../domain/models/publicTypes'
import { useSettingsStore } from '../stores/settingsStore'
import { NormalCountersPage, type NormalCountersPageDependencies } from './NormalCountersPage'

const fixture: NormalArtianCounter = { id: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades', rarity: 8, counter: null, isConfirmed: false, observationCount: 0, lastObservedAt: null, candidateCount: null, createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z' }
const confirmedFixture: NormalArtianCounter = { ...fixture, id: 'weapon.great_sword:8', weaponTypeId: 'weapon.great_sword', counter: 98765, isConfirmed: true, observationCount: 4, candidateCount: 1 }
const unconfirmedFixture: NormalArtianCounter = { ...fixture, id: 'weapon.long_sword:8', weaponTypeId: 'weapon.long_sword', counter: 43210, isConfirmed: false }
function dependencies(values: NormalArtianCounter[] = [fixture]) { return { getAll: vi.fn(async () => values.map((value) => structuredClone(value))), save: vi.fn(async (value: NormalArtianCounter) => value) } satisfies NormalCountersPageDependencies }

async function rowFor(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  const row = heading.closest<HTMLElement>('li')
  if (!row) throw new Error('Counter row was not rendered')
  return row
}

describe('NormalCountersPage', () => {
  beforeEach(() => useSettingsStore.getState().reset())
  it('shows rows and prevents direct editing when Debug Mode is off', async () => {
    render(<NormalCountersPage dependencies={dependencies()} />)
    expect(await screen.findByRole('heading', { name: '双剣' })).toBeInTheDocument()
    expect(await screen.findAllByRole('heading', { level: 3 })).toHaveLength(14)
    expect(screen.queryByText(/レア[67]/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/検索に未使用/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Counter raw値')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'デバッグ保存' })).not.toBeInTheDocument()
  })

  it('lists the 14 rarity-8 weapon types once each, with status, counts and last observation', async () => {
    render(<NormalCountersPage dependencies={dependencies([fixture, confirmedFixture, unconfirmedFixture])} />)
    const list = (await screen.findByRole('heading', { name: '双剣' })).closest<HTMLElement>('ul')
    if (!list) throw new Error('Counter list was not rendered')
    // One DOM structure serves PC and smartphone, so every weapon type appears
    // exactly once rather than in a hidden duplicate representation.
    expect(within(list).getAllByRole('listitem')).toHaveLength(14)
    expect(screen.getAllByRole('heading', { name: '大剣' })).toHaveLength(1)

    const confirmed = within(await rowFor('大剣'))
    expect(confirmed.getByText('確定・検索に使用')).toBeInTheDocument()
    expect(confirmed.getByText('観測数')).toBeInTheDocument()
    expect(confirmed.getByText('候補数')).toBeInTheDocument()
    expect(confirmed.getByText('最終観測')).toBeInTheDocument()
    expect(within(await rowFor('太刀')).getByText('未確定・検索に未使用')).toBeInTheDocument()
    expect(within(await rowFor('双剣')).getByText('未設定・検索に未使用')).toBeInTheDocument()
    expect(screen.getByText('確定 1 / 14')).toBeInTheDocument()
  })

  it('never shows raw Counter values in the normal UI', async () => {
    // `docs/UI_FLOW.md` 3: Seed / Counter values are Debug Mode only.
    render(<NormalCountersPage dependencies={dependencies([confirmedFixture, unconfirmedFixture])} />)
    await screen.findByRole('heading', { name: '大剣' })
    expect(screen.queryByText(/98765/)).not.toBeInTheDocument()
    expect(screen.queryByText(/43210/)).not.toBeInTheDocument()
  })

  it('shows raw Counter values only inside the Debug Mode editor', async () => {
    useSettingsStore.getState().setDebugMode(true)
    render(<NormalCountersPage dependencies={dependencies([confirmedFixture])} />)
    const row = within(await rowFor('大剣'))
    expect(row.getByLabelText('Counter raw値')).toHaveValue(98765)
    expect(row.getByRole('checkbox', { name: '確定済み' })).toBeChecked()
    expect(row.getByRole('button', { name: 'デバッグ保存' })).toHaveAccessibleDescription('大剣')
  })

  it('allows Debug editing, rejects invalid counters, and persists valid data', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup(); const deps = dependencies()
    render(<NormalCountersPage dependencies={deps} />)
    const row = await rowFor('双剣')
    const input = within(row).getByLabelText('Counter raw値')
    const save = within(row).getByRole('button', { name: 'デバッグ保存' })
    await user.type(input, '-1')
    await user.click(save)
    expect(await screen.findByText(/non-negative integer/)).toBeInTheDocument()
    await user.clear(input); await user.type(input, '12'); await user.click(save)
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ counter: 12 }))
  }, 15_000)

  it('never confirms a Counter without a value', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup(); const deps = dependencies([confirmedFixture])
    render(<NormalCountersPage dependencies={deps} />)
    const row = within(await rowFor('大剣'))
    await user.clear(row.getByLabelText('Counter raw値'))
    expect(row.getByRole('checkbox', { name: '確定済み' })).toBeDisabled()
    expect(row.getByRole('checkbox', { name: '確定済み' })).not.toBeChecked()
    await user.click(row.getByRole('button', { name: 'デバッグ保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ counter: null, isConfirmed: false, rarity: 8 }))
    expect(await screen.findByText('カウンターを保存しました。')).toBeInTheDocument()
  }, 15_000)
})
