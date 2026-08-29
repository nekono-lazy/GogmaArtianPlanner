import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './settingsStore'

describe('settings UI store', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('defaults Debug Mode to off', () => {
    expect(useSettingsStore.getState().debugMode).toBe(false)
  })

  it('turns Debug Mode on and off', () => {
    useSettingsStore.getState().setDebugMode(true)
    expect(useSettingsStore.getState().debugMode).toBe(true)

    useSettingsStore.getState().setDebugMode(false)
    expect(useSettingsStore.getState().debugMode).toBe(false)
  })
})
