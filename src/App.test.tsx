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

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it.each([
    ['#/rng', 'RNG Setup'],
    ['#/normal-counters', 'Normal Counters'],
    ['#/owned-weapons', 'Owned Weapons'],
    ['#/target-weapons', 'Target Weapons'],
    ['#/search', 'Search Results'],
    ['#/build-list', 'Build List'],
    ['#/plans/plan-1', 'Production Plan'],
    ['#/plans/plan-1/run', 'Execution Navigator'],
    ['#/settings', 'Settings'],
  ])('navigates %s to %s', (hash, heading) => {
    window.location.hash = hash
    render(<App />)

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('renders a safe fallback for an unknown route', () => {
    window.location.hash = '#/not-a-route'
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Page Not Found' })).toBeInTheDocument()
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
    const debugSwitch = screen.getByRole('switch', { name: 'Debug Mode' })

    expect(debugSwitch).not.toBeChecked()
    await user.click(debugSwitch)
    expect(debugSwitch).toBeChecked()
    await user.click(debugSwitch)
    expect(debugSwitch).not.toBeChecked()
  })
})
