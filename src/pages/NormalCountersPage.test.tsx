import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalArtianCounter } from '../domain/models/publicTypes'
import { useSettingsStore } from '../stores/settingsStore'
import { NormalCountersPage, type NormalCountersPageDependencies } from './NormalCountersPage'

const fixture: NormalArtianCounter = { id: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades', rarity: 8, counter: null, isConfirmed: false, observationCount: 0, lastObservedAt: null, candidateCount: null, createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z' }
function dependencies() { return { getAll: vi.fn(async () => [structuredClone(fixture)]), save: vi.fn(async (value: NormalArtianCounter) => value) } satisfies NormalCountersPageDependencies }

describe('NormalCountersPage', () => {
  beforeEach(() => useSettingsStore.getState().reset())
  it('shows rows and prevents direct editing when Debug Mode is off', async () => {
    render(<NormalCountersPage dependencies={dependencies()} />)
    expect(await screen.findByRole('heading', { name: '双剣' })).toBeInTheDocument()
    expect(await screen.findAllByRole('heading', { level: 3 })).toHaveLength(14)
    expect(screen.queryByText(/レア[67]/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/検索に未使用/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Counter raw値')).not.toBeInTheDocument()
  })
  it('allows Debug editing, rejects invalid counters, and persists valid data', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup(); const deps = dependencies()
    render(<NormalCountersPage dependencies={deps} />)
    const heading = await screen.findByRole('heading', { name: '双剣' })
    const row = heading.closest<HTMLElement>('.MuiPaper-root')
    if (!row) throw new Error('Counter row was not rendered')
    const input = within(row).getByLabelText('Counter raw値')
    const save = within(row).getByRole('button', { name: 'デバッグ保存' })
    await user.type(input, '-1')
    await user.click(save)
    expect(await screen.findByText(/non-negative integer/)).toBeInTheDocument()
    await user.clear(input); await user.type(input, '12'); await user.click(save)
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ counter: 12 }))
  }, 15_000)
})
