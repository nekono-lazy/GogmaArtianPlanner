import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { PRODUCTION_RNG_ENGINE_VERSION } from './domain/rng/production/productionRngEngine'
import { useSettingsStore } from './stores/settingsStore'

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    useSettingsStore.getState().reset()
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

    expect(screen.getByText('Debug Modeが無効です。Settingsから有効にしてください。')).toBeInTheDocument()
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

  it('shows the active Production RNG provenance in Settings', () => {
    window.location.hash = '#/settings'
    render(<App />)

    expect(screen.getByText('RNG予測エンジン: Production')).toBeInTheDocument()
    expect(screen.getByText(`Engine version: ${PRODUCTION_RNG_ENGINE_VERSION}`)).toBeInTheDocument()
    expect(screen.getByText('Seed Search: 未対応')).toBeInTheDocument()
    expect(screen.queryByText('RNG予測エンジン: 未設定')).not.toBeInTheDocument()
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
      expect(within(row).getByText('true')).toBeInTheDocument()
    }
    const seedSearchRow = within(provenance).getByText('supportsSeedSearch').closest('li') as HTMLElement
    expect(within(seedSearchRow).getByText('false')).toBeInTheDocument()
  })
})
