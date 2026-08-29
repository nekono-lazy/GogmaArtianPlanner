import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalArtianCounter } from '../domain/models/publicTypes'
import { useSettingsStore } from '../stores/settingsStore'
import { NormalCountersPage, type NormalCountersPageDependencies } from './NormalCountersPage'

const fixture: NormalArtianCounter = { id: 'weapon.dual_blades:rare7', weaponTypeId: 'weapon.dual_blades', rarity: 'rare7', counter: null, isConfirmed: false, observationCount: 0, lastObservedAt: null, candidateCount: null, createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z' }
function dependencies() { return { getAll: vi.fn(async () => [structuredClone(fixture)]), save: vi.fn(async (value: NormalArtianCounter) => value) } satisfies NormalCountersPageDependencies }

describe('NormalCountersPage', () => {
  beforeEach(() => useSettingsStore.getState().reset())
  it('shows rows and prevents direct editing when Debug Mode is off', async () => {
    render(<NormalCountersPage dependencies={dependencies()} />)
    expect(await screen.findByText('双剣 / レア7')).toBeInTheDocument()
    expect(screen.getAllByText(/検索に未使用/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Counter raw値')).not.toBeInTheDocument()
  })
  it('allows Debug editing, rejects invalid counters, and persists valid data', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup(); const deps = dependencies()
    render(<NormalCountersPage dependencies={deps} />)
    const inputs = await screen.findAllByLabelText('Counter raw値')
    await user.type(inputs[1], '-1')
    const saves = screen.getAllByRole('button', { name: 'デバッグ保存' })
    await user.click(saves[1])
    expect(await screen.findByText(/non-negative integer/)).toBeInTheDocument()
    await user.clear(inputs[1]); await user.type(inputs[1], '12'); await user.click(saves[1])
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ counter: 12 }))
  })
})
