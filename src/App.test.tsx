import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
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
})
