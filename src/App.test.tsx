import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { settingsRepository } from './db/settingsRepository'
import { PRODUCTION_RNG_ENGINE_VERSION } from './domain/rng/production/productionRngEngine'
import { useSettingsStore } from './stores/settingsStore'

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    useSettingsStore.getState().reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the Dashboard', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'ダッシュボード' })).toBeInTheDocument()
  })

  it.each([
    ['#/rng', 'RNG状態設定'],
    ['#/normal-counters', '通常アーティアカウンター'],
    ['#/owned-weapons', '所持武器'],
    ['#/target-weapons', '目標武器'],
    ['#/search', '候補検索'],
    ['#/build-list', 'ビルドリスト'],
    ['#/plans/plan-1', '生産計画'],
    ['#/plans/plan-1/run', '実行ナビゲーション'],
    ['#/settings', '設定'],
  ])('navigates %s to %s', (hash, heading) => {
    window.location.hash = hash
    render(<App />)

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('renders a safe fallback for an unknown route', () => {
    window.location.hash = '#/not-a-route'
    render(<App />)

    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
  })

  it('does not show internal values when Debug Mode is off', () => {
    window.location.hash = '#/debug'
    render(<App />)

    expect(
      screen.getByText('Debug Modeが無効です。「設定」画面のデバッグモードから有効にしてください。'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Base Seed')).not.toBeInTheDocument()
  })

  it('can turn Debug Mode on and off from Settings', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/settings'
    render(<App />)
    const debugSwitch = screen.getByRole('switch', { name: 'デバッグモード' })

    expect(debugSwitch).not.toBeChecked()
    await user.click(debugSwitch)
    expect(debugSwitch).toBeChecked()
    await user.click(debugSwitch)
    expect(debugSwitch).not.toBeChecked()
  })

  it('shows the active Production RNG provenance in Settings as a key / value list', () => {
    window.location.hash = '#/settings'
    render(<App />)

    const versions = screen.getByRole('region', { name: 'バージョン情報' })
    const row = (label: string) =>
      within(versions).getByText(label, { selector: 'dt' }).parentElement as HTMLElement
    expect(within(row('RNG予測エンジン')).getByText('Production', { selector: 'dd' })).toBeInTheDocument()
    expect(
      within(row('Engine version')).getByText(PRODUCTION_RNG_ENGINE_VERSION, { selector: 'dd' }),
    ).toBeInTheDocument()
    // The legacy flag is named as the old generic API, never as "Seed Search"
    // on its own, so it cannot read as "RNG identification is unsupported".
    expect(within(row('旧generic Seed Search API')).getByText('未対応', { selector: 'dd' })).toBeInTheDocument()
    expect(within(versions).queryByText('Seed Search', { selector: 'dt' })).not.toBeInTheDocument()
    expect(within(versions).queryByText('未設定')).not.toBeInTheDocument()
  })

  it('reports RNG identification availability in Settings from the Wizard, not from supportsSeedSearch', () => {
    // jsdom has no Worker; a Browser does. The row follows the Wizard's own
    // application-level availability (`docs/UI_FLOW.md` 5 / 14).
    vi.stubGlobal('Worker', class {})
    try {
      window.location.hash = '#/settings'
      render(<App />)
      const versions = screen.getByRole('region', { name: 'バージョン情報' })
      const row = (label: string) =>
        within(versions).getByText(label, { selector: 'dt' }).parentElement as HTMLElement
      expect(within(row('RNG同定')).getByText('利用可能', { selector: 'dd' })).toBeInTheDocument()
      expect(within(row('旧generic Seed Search API')).getByText('未対応', { selector: 'dd' })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports RNG identification unavailable with its reason when the runtime has no Worker', () => {
    window.location.hash = '#/settings'
    render(<App />)
    const versions = screen.getByRole('region', { name: 'バージョン情報' })
    const row = within(versions).getByText('RNG同定', { selector: 'dt' }).parentElement as HTMLElement
    expect(within(row).getByText(/利用不可（.*Web Worker.*）/, { selector: 'dd' })).toBeInTheDocument()
  })

  it('reports a Debug Mode persistence failure without claiming what is persisted', async () => {
    const user = userEvent.setup()
    vi.spyOn(settingsRepository, 'setDebugMode').mockRejectedValue(new Error('IndexedDB write failed'))
    window.location.hash = '#/settings'
    render(<App />)
    const debugSwitch = screen.getByRole('switch', { name: 'デバッグモード' })

    await user.click(debugSwitch)
    const warning = await screen.findByText(/設定を保存できませんでした/)
    // The switch keeps showing the value the user chose: no rollback is
    // pretended, and the persisted value is described only as possibly
    // different, never as "restored".
    expect(debugSwitch).toBeChecked()
    expect(warning).toHaveTextContent('再読み込み後は保存済みの設定が使用され、現在の表示と異なる場合があります')
    expect(warning).toHaveTextContent('再度お試しください')
    expect(warning).not.toHaveTextContent('元の設定に戻ります')

    // The next operation clears the notice, as before.
    await user.click(debugSwitch)
    expect(debugSwitch).not.toBeChecked()
    expect(await screen.findByText(/設定を保存できませんでした/)).toBeInTheDocument()
  })

  it('heads the Debug Mode switch with its own settings section', () => {
    window.location.hash = '#/settings'
    render(<App />)

    const display = screen.getByRole('region', { name: '表示設定' })
    expect(within(display).getByRole('switch', { name: 'デバッグモード' })).toHaveAccessibleDescription(
      /ゲーム計算の意味には影響しません/,
    )
    expect(screen.getByRole('heading', { level: 2, name: '表示設定' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'バージョン情報' })).toBeInTheDocument()
  })

  it('shows Production Engine capabilities and version in Debug Details', () => {
    useSettingsStore.setState({ debugMode: true })
    window.location.hash = '#/debug'
    render(<App />)
    const provenance = screen.getByRole('list', { name: 'Production RNG Engine provenance' })

    expect(within(provenance).getByText(PRODUCTION_RNG_ENGINE_VERSION)).toBeInTheDocument()
    expect(within(within(provenance).getByText('Engine mode').closest('li') as HTMLElement).getByText('Production')).toBeInTheDocument()
    for (const capability of [
      'supportsNormalArtianPrediction',
      'supportsSkillPrediction',
      'supportsGogmaPrediction',
      'supportsKeepBonusesPrediction',
    ]) {
      const row = within(provenance).getByText(capability).closest('li') as HTMLElement
      expect(within(row).getByText('true（対応）')).toBeInTheDocument()
    }
    // The legacy flag is labelled as the old generic API and stays false,
    // while the Wizard availability is its own row and never reads that flag.
    const seedSearchRow = within(provenance).getByText('旧generic Seed Search API (supportsSeedSearch)').closest('li') as HTMLElement
    expect(within(seedSearchRow).getByText('false（未対応）')).toBeInTheDocument()
    const identificationRow = within(provenance)
      .getByText('Production Identification (Identification Wizard)')
      .closest('li') as HTMLElement
    expect(within(identificationRow).getByText('unavailable: worker_unavailable（利用不可）')).toBeInTheDocument()
    // Every Debug section is a headed region, the placeholder list included.
    expect(screen.getByRole('heading', { level: 2, name: 'RNG Engine information' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Future debug sections' })).toBeInTheDocument()
  })

  it('shows Production Identification available in Debug Details while supportsSeedSearch stays false', () => {
    vi.stubGlobal('Worker', class {})
    try {
      useSettingsStore.setState({ debugMode: true })
      window.location.hash = '#/debug'
      render(<App />)
      const provenance = screen.getByRole('list', { name: 'Production RNG Engine provenance' })
      const identificationRow = within(provenance)
        .getByText('Production Identification (Identification Wizard)')
        .closest('li') as HTMLElement
      expect(within(identificationRow).getByText('available（利用可能）')).toBeInTheDocument()
      const seedSearchRow = within(provenance).getByText('旧generic Seed Search API (supportsSeedSearch)').closest('li') as HTMLElement
      expect(within(seedSearchRow).getByText('false（未対応）')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('offers the Not Found page a heading, an explanation, and a way back', () => {
    window.location.hash = '#/not-a-route'
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeInTheDocument()
    expect(screen.getByText(/ダッシュボードから目的の画面へ移動/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ダッシュボードへ戻る' })).toHaveAttribute('href', '#/')
  })
})
