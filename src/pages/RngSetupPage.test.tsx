import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createInitialRngState } from '../domain/models/factories'
import type { RngState } from '../domain/models/publicTypes'
import { RngSetupPage, type RngSetupPageDependencies } from './RngSetupPage'

function dependencies(initial = createInitialRngState('2026-08-29T00:00:00.000Z')) {
  let stored = initial
  const deps: RngSetupPageDependencies = {
    ensure: vi.fn(async () => stored),
    save: vi.fn(async (state: RngState) => { stored = state; return state }),
    getNormalCounters: vi.fn(async () => []),
  }
  return { deps, getStored: () => stored }
}

describe('RngSetupPage', () => {
  it('saves partial-known state and preserves Base Seed as a string', async () => {
    const user = userEvent.setup(); const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    const seedPanel = seed.closest('.MuiPaper-root') as HTMLElement
    expect(within(seedPanel).getByText('未入力')).toBeInTheDocument()
    await user.type(seed, '000123')
    expect(within(seedPanel).getByText('未確認')).toBeInTheDocument()
    await user.click(within(seedPanel).getByRole('checkbox', { name: 'この値を検索・予測に使用する' }))
    expect(within(seedPanel).getByText('使用中')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(fixture.getStored().baseSeed).toMatchObject({ value: '000123', isConfirmed: true })
    expect(fixture.getStored().skillCounter.value).toBeNull()
  })

  it('clearing a value forces isConfirmed false', async () => {
    const state = createInitialRngState('2026-08-29T00:00:00.000Z'); state.baseSeed = { value: 'seed', isConfirmed: true, source: 'manual' }
    const user = userEvent.setup(); const fixture = dependencies(state)
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    const seedPanel = seed.closest('.MuiPaper-root') as HTMLElement
    await user.clear(seed)
    expect(within(seedPanel).getByRole('checkbox', { name: 'この値を検索・予測に使用する' })).toBeDisabled()
    expect(within(seedPanel).getByText('未入力')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(fixture.getStored().baseSeed).toEqual({ value: null, isConfirmed: false, source: null })
  })

  it('rejects negative counters and explains unavailable production Engine capability', async () => {
    const user = userEvent.setup(); const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const counter = await screen.findByLabelText('巨戟カウンター')
    await user.type(counter, '-1'); await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('巨戟カウンターは0以上の整数で入力してください。')).toBeInTheDocument()
    expect(screen.getAllByText(/本番RNG予測エンジン/).length).toBeGreaterThan(0)
    expect(fixture.deps.save).not.toHaveBeenCalled()
  })

  it('disables search-use for an empty value and shows Japanese source/capability labels', async () => {
    const user = userEvent.setup(); const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    const seedPanel = seed.closest('.MuiPaper-root') as HTMLElement
    const useValue = within(seedPanel).getByRole('checkbox', { name: 'この値を検索・予測に使用する' })
    expect(useValue).toBeDisabled()
    await user.type(seed, 'candidate')
    expect(useValue).toBeEnabled()
    const source = within(seedPanel).getByRole('combobox', { name: '取得方法' })
    await user.click(source)
    await user.click(await screen.findByRole('option', { name: '手動入力' }))
    expect(source).toHaveTextContent('手動入力')
    expect(screen.getByText(/巨戟アーティア予測: 利用不可/)).toBeInTheDocument()
    expect(screen.queryByText('確定済み')).not.toBeInTheDocument()
  })
})
