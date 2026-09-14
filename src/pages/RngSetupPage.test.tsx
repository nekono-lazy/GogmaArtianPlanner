import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * A Browser-like `Worker` that accepts listeners and messages but never runs:
 * enough for the Production Worker clients to construct, so the Wizard Dialog
 * opens exactly as it does in a Browser. Identification itself is never run
 * through it in this suite.
 */
class InertWorker {
  onmessage: unknown = null
  onerror: unknown = null
  onmessageerror: unknown = null
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(): void {}
  terminate(): void {}
}

/** A `dt` / `dd` row of a definition list, found by its term. */
function definitionRow(container: HTMLElement, term: string): HTMLElement {
  return within(container).getByText(term, { selector: 'dt' }).parentElement as HTMLElement
}

/** Expands the shared technical-details Accordion and returns its definition list. */
async function openEngineDetails(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const toggle = screen.getByRole('button', { name: 'Production RNG Engine（技術情報）' })
  // The Accordion heading slot is the only heading around its toggle.
  expect(screen.getByRole('heading', { level: 2, name: 'Production RNG Engine（技術情報）' })).toContainElement(toggle)
  expect(within(toggle).queryByRole('heading')).not.toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return screen.getByText('Engine version', { selector: 'dt' }).closest('dl') as HTMLElement
}

describe('RngSetupPage', () => {
  // jsdom has no `Worker`; a Browser does. The Wizard start control follows
  // the application-level Identification availability, which mirrors that
  // check, so the ordinary tests run as in a Browser and the no-Worker case
  // unstubs it explicitly.
  beforeEach(() => {
    vi.stubGlobal('Worker', InertWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

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
    const seedPanel = seed.closest('[data-known-field]') as HTMLElement
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
    const seedPanel = seed.closest('[data-known-field]') as HTMLElement
    const useValue = within(seedPanel).getByRole('checkbox', { name: 'この値を検索・予測に使用する' })
    expect(useValue).toBeDisabled()
    await user.type(seed, '42')

    expect(useValue).toBeEnabled()
    expect(within(seedPanel).getByText('取得方法: 手動入力')).toBeInTheDocument()
    const engine = await openEngineDetails(user)
    expect(definitionRow(engine, 'Engine version')).toHaveTextContent(PRODUCTION_RNG_ENGINE_VERSION)
    expect(definitionRow(engine, '通常アーティア予測').textContent).toBe('通常アーティア予測対応')
    expect(definitionRow(engine, 'スキル予測').textContent).toBe('スキル予測対応')
    expect(definitionRow(engine, '巨戟アーティア予測').textContent).toBe('巨戟アーティア予測対応')
    expect(definitionRow(engine, 'Keep Bonuses予測').textContent).toBe('Keep Bonuses予測対応')
    // The legacy generic API flag keeps its meaning but is named as such, so
    // it never reads as the Identification Wizard being unsupported.
    expect(definitionRow(engine, '旧generic Seed Search API').textContent).toBe('旧generic Seed Search API未対応')
    expect(within(engine).queryByText('Seed Search', { selector: 'dt' })).not.toBeInTheDocument()
    expect(within(engine).queryByText('RNG同定', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.getByText(/旧generic Seed Search APIはIdentification Wizard（RNG同定）とは別の旧API契約です/)).toBeInTheDocument()
    expect(screen.queryByText(/本番RNG予測エンジンが未実装/)).not.toBeInTheDocument()
  })

  it('shows RNG identification as available and enables the Wizard start, independent of supportsSeedSearch', async () => {
    // The shared beforeEach stubs `Worker`, as a Browser provides it.
    render(<RngSetupPage dependencies={dependencies().deps} />)
    const wizard = await screen.findByRole('region', { name: '値が分からない場合' })
    expect(definitionRow(wizard, 'RNG同定').textContent).toBe('RNG同定利用可能')
    expect(within(wizard).queryByText(/Web Worker/)).not.toBeInTheDocument()
    expect(within(wizard).getByRole('button', { name: 'Identification Wizardを開始' })).toBeEnabled()
    // The legacy flag is still false: the two are different contracts.
    expect(productionRngEngine.capabilities.supportsSeedSearch).toBe(false)
  })

  it('shows RNG identification as unavailable, with its reason, and disables the Wizard start when the runtime has no Worker', async () => {
    vi.unstubAllGlobals()
    expect(typeof Worker).toBe('undefined')
    const fixture = dependencies()
    const createIdentificationCoordinator = vi.fn()
    render(<RngSetupPage dependencies={{ ...fixture.deps, createIdentificationCoordinator }} />)
    const wizard = await screen.findByRole('region', { name: '値が分からない場合' })
    expect(definitionRow(wizard, 'RNG同定').textContent).toBe('RNG同定利用不可')
    expect(within(wizard).getByText(/Web Workerを利用できないため、RNG同定を実行できません/)).toBeInTheDocument()
    // The status and the start control never contradict each other.
    const startWizard = within(wizard).getByRole('button', { name: 'Identification Wizardを開始' })
    expect(startWizard).toBeDisabled()
    // user-event refuses to click a disabled control; a raw DOM click on it
    // is inert too, so nothing starts.
    fireEvent.click(startWizard)
    expect(createIdentificationCoordinator).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the Wizard start disabled by unsaved changes even when identification is available', async () => {
    const user = userEvent.setup()
    render(<RngSetupPage dependencies={dependencies().deps} />)
    const wizard = await screen.findByRole('region', { name: '値が分からない場合' })
    expect(definitionRow(wizard, 'RNG同定').textContent).toBe('RNG同定利用可能')
    expect(within(wizard).getByRole('button', { name: 'Identification Wizardを開始' })).toBeEnabled()

    await user.type(screen.getByLabelText('巨戟カウンター'), '5')
    expect(within(wizard).getByRole('button', { name: 'Identification Wizardを開始' })).toBeDisabled()
    // The availability status itself is unchanged by the unsaved edit.
    expect(definitionRow(wizard, 'RNG同定').textContent).toBe('RNG同定利用可能')
  })

  it('keeps current availability separate from what the Engine itself supports', async () => {
    const user = userEvent.setup()
    render(<RngSetupPage dependencies={dependencies().deps} />)
    const current = await screen.findByRole('region', { name: '現在の入力内容で利用可能な機能' })

    // Nothing is confirmed yet, so the current state cannot predict even though
    // the Engine supports it.
    expect(definitionRow(current, 'スキル予測').textContent).toBe('スキル予測利用不可')
    expect(definitionRow(current, '巨戟アーティア予測').textContent).toBe('巨戟アーティア予測利用不可')
    expect(within(current).getByText('現在不足している項目')).toBeInTheDocument()
    const engine = await openEngineDetails(user)
    expect(definitionRow(engine, 'スキル予測').textContent).toBe('スキル予測対応')
    expect(within(engine).queryByText('利用不可')).not.toBeInTheDocument()
    expect(within(engine).queryByText('現在不足している項目')).not.toBeInTheDocument()
  })

  it('reports an invalid unsaved draft as undeterminable instead of showing saved availability', async () => {
    const state = createInitialRngState('2026-08-29T00:00:00.000Z')
    state.baseSeed = { value: productionRngEngine.normalizeSeed('42'), isConfirmed: true, source: 'manual' }
    state.gogmaCounter = { value: 1, isConfirmed: true, source: 'manual' }
    state.skillCounter = { value: 2, isConfirmed: true, source: 'manual' }
    const user = userEvent.setup()
    const fixture = dependencies(state)
    render(<RngSetupPage dependencies={fixture.deps} />)

    // The saved state can predict both streams.
    const saved = await screen.findByRole('region', { name: '現在の入力内容で利用可能な機能' })
    expect(definitionRow(saved, 'スキル予測').textContent).toBe('スキル予測利用可能')
    expect(definitionRow(saved, '巨戟アーティア予測').textContent).toBe('巨戟アーティア予測利用可能')

    const counter = screen.getByLabelText('スキルカウンター')
    await user.clear(counter)
    await user.type(counter, '-1')

    // Unsaved, and the draft cannot be turned into an RngState.
    expect(screen.getByRole('button', { name: 'Identification Wizardを開始' })).toBeDisabled()
    const current = screen.getByRole('region', { name: '現在の入力内容で利用可能な機能' })
    expect(within(current).getByText(/現在の入力内容にエラーがあるため、利用可能な機能を判定できません。/)).toBeInTheDocument()
    expect(within(current).queryByText('利用可能')).not.toBeInTheDocument()
    expect(within(current).queryByText('利用不可')).not.toBeInTheDocument()
    expect(within(current).queryByText('現在不足している項目')).not.toBeInTheDocument()
    expect(screen.queryByText(/判定には未保存の入力内容を含みます/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('スキルカウンターは0以上の整数で入力してください。')).toBeInTheDocument()
    expect(fixture.deps.save).not.toHaveBeenCalled()
    expect(fixture.getStored().skillCounter).toEqual(state.skillCounter)
  })

  it('still judges a valid unsaved draft and says it includes unsaved input', async () => {
    const user = userEvent.setup()
    render(<RngSetupPage dependencies={dependencies().deps} />)
    const current = await screen.findByRole('region', { name: '現在の入力内容で利用可能な機能' })
    expect(definitionRow(current, 'スキル予測').textContent).toBe('スキル予測利用不可')

    const seed = screen.getByLabelText('Base Seed（基準シード）')
    await user.type(seed, '42')
    await user.click(within(seed.closest('[data-known-field]') as HTMLElement).getByRole('checkbox', { name: 'この値を検索・予測に使用する' }))
    const skill = screen.getByLabelText('スキルカウンター')
    await user.type(skill, '7')
    await user.click(within(skill.closest('[data-known-field]') as HTMLElement).getByRole('checkbox', { name: 'この値を検索・予測に使用する' }))

    expect(definitionRow(current, 'スキル予測').textContent).toBe('スキル予測利用可能')
    expect(within(current).getByText(/判定には未保存の入力内容を含みます。/)).toBeInTheDocument()
    expect(screen.queryByText(/現在の入力内容にエラーがあるため/)).not.toBeInTheDocument()
  })

  it('summarizes each saved KnownValue as 使用中 / 未確認 / 未入力 without showing the value', async () => {
    const state = createInitialRngState('2026-08-29T00:00:00.000Z')
    state.baseSeed = { value: '987654', isConfirmed: true, source: 'manual' }
    state.gogmaCounter = { value: 4321, isConfirmed: false, source: 'manual' }
    render(<RngSetupPage dependencies={dependencies(state).deps} />)
    const summary = await screen.findByRole('region', { name: '保存済みのRNG状態' })

    expect(definitionRow(summary, 'Base Seed（基準シード）').textContent).toBe('Base Seed（基準シード）使用中')
    expect(definitionRow(summary, '巨戟カウンター').textContent).toBe('巨戟カウンター未確認')
    expect(definitionRow(summary, 'スキルカウンター').textContent).toBe('スキルカウンター未入力')
    expect(summary).not.toHaveTextContent('987654')
    expect(summary).not.toHaveTextContent('4321')
    // The editable fields show the draft status in words as well.
    const seedPanel = screen.getByLabelText('Base Seed（基準シード）').closest('[data-known-field]') as HTMLElement
    expect(within(seedPanel).getByText('状態: 使用中')).toBeInTheDocument()
  })

  describe('legacy Counter Gate', () => {
    // `docs/UI_FLOW.md` 5.2: the ordinary RNG Setup neither shows nor edits
    // Counter Gate. The persisted KnownValue is legacy / diagnostic / import
    // compatibility data and is carried through every save unchanged.
    const legacyGate = { value: 200, isConfirmed: true, source: 'manual' } as const

    function legacyState(): RngState {
      const state = createInitialRngState('2026-08-29T00:00:00.000Z')
      state.baseSeed = { value: '42', isConfirmed: true, source: 'observation' }
      state.counterGate = { ...legacyGate }
      return state
    }

    it('never shows a Counter Gate field, section, status, or source in the ordinary UI', async () => {
      const state = legacyState()
      render(<RngSetupPage dependencies={dependencies(state).deps} />)
      await screen.findByLabelText('Base Seed（基準シード）')

      expect(screen.queryByText(/Counter Gate（カウンターゲート）/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /詳細・互換情報/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/詳細・互換情報（Counter Gate）/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Counter Gateの状態/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Counter Gateの取得方法/)).not.toBeInTheDocument()
      expect(document.querySelector('[data-known-field="counter-gate"]')).toBeNull()
      // The saved summary lists the three ordinary KnownValues only.
      const summary = screen.getByRole('region', { name: '保存済みのRNG状態' })
      expect(within(summary).getAllByRole('term').map((term) => term.textContent))
        .toEqual(['Base Seed（基準シード）', '巨戟カウンター', 'スキルカウンター'])
      expect(screen.getAllByRole('checkbox', { name: 'この値を検索・予測に使用する' })).toHaveLength(3)
      // The persisted value itself is not rendered anywhere in the ordinary UI.
      expect(document.body).not.toHaveTextContent('200')
    })

    it('preserves the persisted Counter Gate exactly when only Base Seed is edited and saved', async () => {
      const state = legacyState()
      const user = userEvent.setup()
      const fixture = dependencies(state)
      render(<RngSetupPage dependencies={fixture.deps} />)

      const seed = await screen.findByLabelText('Base Seed（基準シード）')
      await user.clear(seed)
      await user.type(seed, '100000001')
      await user.click(screen.getByRole('button', { name: '保存' }))

      expect(await screen.findByText('RNG状態を保存しました。')).toBeInTheDocument()
      expect(fixture.deps.save).toHaveBeenCalledTimes(1)
      expect(fixture.getStored().baseSeed).toEqual({
        value: productionRngEngine.normalizeSeed('100000001'),
        isConfirmed: false,
        source: 'manual',
      })
      expect(fixture.getStored().counterGate).toEqual(legacyGate)
    })

    it('preserves the persisted Counter Gate exactly when a Counter is edited and saved', async () => {
      const state = legacyState()
      const user = userEvent.setup()
      const fixture = dependencies(state)
      render(<RngSetupPage dependencies={fixture.deps} />)

      const counter = await screen.findByLabelText('スキルカウンター')
      await user.type(counter, '7')
      await user.click(within(counter.closest('[data-known-field]') as HTMLElement).getByRole('checkbox', { name: 'この値を検索・予測に使用する' }))
      await user.click(screen.getByRole('button', { name: '保存' }))

      expect(await screen.findByText('RNG状態を保存しました。')).toBeInTheDocument()
      expect(fixture.getStored().skillCounter).toEqual({ value: 7, isConfirmed: true, source: 'manual' })
      expect(fixture.getStored().counterGate).toEqual(legacyGate)
      // Never nulled, never unconfirmed, never re-sourced, and never replaced
      // by the Production active-branch representatives 54 / 35.
      expect(fixture.getStored().counterGate.value).not.toBeNull()
      expect([54, 35]).not.toContain(fixture.getStored().counterGate.value)
    })

    it.each([
      { value: null, isConfirmed: false, source: null },
      { value: 54, isConfirmed: true, source: 'observation' },
      { value: 35, isConfirmed: false, source: 'gogma_seed_finder_import' },
    ] as const)('carries persisted Counter Gate %j through a Notes-only save', async (counterGate) => {
      const state = createInitialRngState('2026-08-29T00:00:00.000Z')
      state.counterGate = { ...counterGate }
      const user = userEvent.setup()
      const fixture = dependencies(state)
      render(<RngSetupPage dependencies={fixture.deps} />)

      await user.type(await screen.findByLabelText('メモ'), 'memo')
      await user.click(screen.getByRole('button', { name: '保存' }))

      expect(await screen.findByText('RNG状態を保存しました。')).toBeInTheDocument()
      expect(fixture.getStored().counterGate).toEqual(counterGate)
    })
  })

  it('shows a load failure without any synthetic RNG state or form', async () => {
    const fixture = dependencies()
    fixture.deps.ensure = vi.fn(async (): Promise<RngState> => { throw new Error('IndexedDB read failed') })
    render(<RngSetupPage dependencies={fixture.deps} />)

    expect(await screen.findByText('IndexedDB read failed')).toBeInTheDocument()
    expect(screen.queryByLabelText('Base Seed（基準シード）')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '保存済みのRNG状態' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '現在の入力内容で利用可能な機能' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Identification Wizardを開始' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('RNG状態を読み込み中')).not.toBeInTheDocument()
  })

  it('shows a save failure inside the manual input section next to 保存', async () => {
    const user = userEvent.setup()
    const fixture = dependencies()
    render(<RngSetupPage dependencies={fixture.deps} />)
    await user.type(await screen.findByLabelText('スキルカウンター'), '-5')
    await user.click(screen.getByRole('button', { name: '保存' }))

    const manual = screen.getByRole('region', { name: '手動入力' })
    expect(await within(manual).findByText('スキルカウンターは0以上の整数で入力してください。')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '値が分からない場合' })).queryByRole('alert', { name: /スキルカウンター/ })).not.toBeInTheDocument()
  })

  it('states what the Wizard identifies next to its start button', async () => {
    render(<RngSetupPage dependencies={dependencies().deps} />)
    const cta = await screen.findByRole('region', { name: '値が分からない場合' })
    expect(within(cta).getByText('調査開始前のスキルカウンター')).toBeInTheDocument()
    expect(within(cta).getByText('調査開始前の巨戟カウンター')).toBeInTheDocument()
    expect(within(cta).getByRole('button', { name: 'Identification Wizardを開始' })).toBeEnabled()
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
