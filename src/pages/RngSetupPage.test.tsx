import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createInitialRngState } from '../domain/models/factories'
import type { RngState } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { productionRngEngine } from '../domain/rng/production/productionRngRuntime'
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
  it('normalizes a decimal Base Seed, marks it manual, and preserves untouched KnownValues', async () => {
    const state = createInitialRngState('2026-08-29T00:00:00.000Z')
    state.gogmaCounter = { value: 11, isConfirmed: true, source: 'observation' }
    state.skillCounter = { value: 22, isConfirmed: false, source: 'gogma_seed_finder_import' }
    state.counterGate = { value: 55, isConfirmed: true, source: 'manual' }
    const untouched = {
      gogmaCounter: { ...state.gogmaCounter },
      skillCounter: { ...state.skillCounter },
      counterGate: { ...state.counterGate },
    }
    const user = userEvent.setup()
    const fixture = dependencies(state)
    render(<RngSetupPage dependencies={fixture.deps} />)

    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    const seedPanel = seed.closest('.MuiPaper-root') as HTMLElement
    await user.type(seed, '100000001')
    await user.click(within(seedPanel).getByRole('checkbox', { name: 'この値を検索・予測に使用する' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(fixture.getStored().baseSeed).toEqual({
      value: productionRngEngine.normalizeSeed('100000001'),
      isConfirmed: true,
      source: 'manual',
    })
    expect(fixture.getStored().gogmaCounter).toEqual(untouched.gogmaCounter)
    expect(fixture.getStored().skillCounter).toEqual(untouched.skillCounter)
    expect(fixture.getStored().counterGate).toEqual(untouched.counterGate)
  })

  it('normalizes equivalent hexadecimal and decimal Base Seeds to the same stored value', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    await user.type(seed, '0x5f5e101')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(fixture.getStored().baseSeed).toEqual({
      value: productionRngEngine.normalizeSeed('100000001'),
      isConfirmed: false,
      source: 'manual',
    })
  })

  it.each(['not-a-seed', '0xnothex', '   '])('does not save invalid Base Seed input %j', async (input) => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    fireEvent.change(seed, { target: { value: input } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('Base seed must be unsigned decimal or hexadecimal')).toBeInTheDocument()
    expect(fixture.deps.save).not.toHaveBeenCalled()
    expect(fixture.getStored().baseSeed.value).toBeNull()
  })

  it('keeps an existing KnownValue when its edited field is left blank', async () => {
    const state = createInitialRngState('2026-08-29T00:00:00.000Z')
    state.baseSeed = { value: '123', isConfirmed: true, source: 'manual' }
    const user = userEvent.setup()
    const fixture = dependencies(state)
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    await user.clear(seed)
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(fixture.getStored().baseSeed).toEqual({ value: '123', isConfirmed: true, source: 'manual' })
    expect(seed).toHaveValue('123')
  })

  it('updates one Counter without changing the other KnownValues', async () => {
    const state = createInitialRngState('2026-08-29T00:00:00.000Z')
    state.baseSeed = { value: '42', isConfirmed: true, source: 'observation' }
    state.gogmaCounter = { value: 1, isConfirmed: true, source: 'observation' }
    state.skillCounter = { value: 2, isConfirmed: true, source: 'observation' }
    state.counterGate = { value: 54, isConfirmed: true, source: 'observation' }
    const user = userEvent.setup()
    const fixture = dependencies(state)
    render(<RngSetupPage dependencies={fixture.deps} />)
    const counter = await screen.findByLabelText('巨戟カウンター')
    await user.clear(counter)
    await user.type(counter, '9')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(fixture.getStored().gogmaCounter).toEqual({ value: 9, isConfirmed: false, source: 'manual' })
    expect(fixture.getStored().baseSeed).toEqual(state.baseSeed)
    expect(fixture.getStored().skillCounter).toEqual(state.skillCounter)
    expect(fixture.getStored().counterGate).toEqual(state.counterGate)
  })

  it('rejects negative counters without saving', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const counter = await screen.findByLabelText('巨戟カウンター')
    await user.type(counter, '-1')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('巨戟カウンターは0以上の整数で入力してください。')).toBeInTheDocument()
    expect(fixture.deps.save).not.toHaveBeenCalled()
  })

  it('shows Production authority capabilities independently from current KnownValues', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    const seed = await screen.findByLabelText('Base Seed（基準シード）')
    const seedPanel = seed.closest('.MuiPaper-root') as HTMLElement
    const useValue = within(seedPanel).getByRole('checkbox', { name: 'この値を検索・予測に使用する' })
    expect(useValue).toBeDisabled()
    await user.type(seed, '42')

    expect(useValue).toBeEnabled()
    expect(within(seedPanel).getByText('取得方法: 手動入力')).toBeInTheDocument()
    expect(screen.getByText(`Engine version: ${PRODUCTION_RNG_ENGINE_VERSION}`)).toBeInTheDocument()
    expect(screen.getByText('通常アーティア予測 capability: 対応')).toBeInTheDocument()
    expect(screen.getByText('スキル予測 capability: 対応')).toBeInTheDocument()
    expect(screen.getByText('巨戟アーティア予測 capability: 対応')).toBeInTheDocument()
    expect(screen.getByText('Keep Bonuses予測 capability: 対応')).toBeInTheDocument()
    expect(screen.getByText('Seed Search capability: 未対応')).toBeInTheDocument()
    expect(screen.queryByText(/本番RNG予測エンジンが未実装/)).not.toBeInTheDocument()
  })

  it('opens the dedicated Identification Wizard without replacing the manual workflow', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)

    await screen.findByLabelText('Base Seed（基準シード）')
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))

    expect(screen.getByRole('dialog', { name: 'RNG Identification Wizard' })).toBeInTheDocument()
    expect(screen.getByLabelText('Base Seed（基準シード）')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'RNG Identification Wizard' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Identification Wizardを開始' })).toBeEnabled()
  })

  it('blocks Wizard start while a KnownField has an unsaved manual draft', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)

    await user.type(await screen.findByLabelText('Base Seed（基準シード）'), '42')

    expect(screen.getByRole('button', { name: 'Identification Wizardを開始' }))
      .toBeDisabled()
    expect(screen.getByText(
      'Identification Wizardを開始する前に、RNG状態設定の変更を保存するか元に戻してください。',
    )).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'RNG Identification Wizard' }))
      .not.toBeInTheDocument()
  })

  it('blocks Wizard start when Notes are the only unsaved change', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)

    await user.type(await screen.findByLabelText('メモ'), '未保存メモ')

    expect(screen.getByRole('button', { name: 'Identification Wizardを開始' }))
      .toBeDisabled()
    expect(screen.getByText(
      'Identification Wizardを開始する前に、RNG状態設定の変更を保存するか元に戻してください。',
    )).toBeInTheDocument()
  })

  it('allows Wizard start after the manual draft has been saved', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)

    await user.type(await screen.findByLabelText('メモ'), '保存済みメモ')
    expect(screen.getByRole('button', { name: 'Identification Wizardを開始' }))
      .toBeDisabled()
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('RNG状態を保存しました。')).toBeInTheDocument()
    expect(fixture.getStored().notes).toBe('保存済みメモ')
    const startWizard = screen.getByRole('button', { name: 'Identification Wizardを開始' })
    expect(startWizard).toBeEnabled()
    await user.click(startWizard)
    expect(screen.getByRole('dialog', { name: 'RNG Identification Wizard' }))
      .toBeInTheDocument()
  })
})
