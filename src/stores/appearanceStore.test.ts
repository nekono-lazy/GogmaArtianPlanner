import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_MODE_STORAGE_KEY,
  readThemeMode,
  writeThemeMode,
  type ThemeModeStorage,
} from '../app/themeModePreference'
import { createAppearanceStore } from './appearanceStore'

/** An in-memory `Storage` stand-in whose reads and writes can be made to fail. */
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const state = { failReads: false, failWrites: false }
  const storage: ThemeModeStorage = {
    getItem: (key) => {
      if (state.failReads) throw new Error('read blocked')
      return values.get(key) ?? null
    },
    setItem: (key, value) => {
      if (state.failWrites) throw new Error('quota exceeded')
      values.set(key, value)
    },
  }
  return { storage, values, state }
}

describe('theme mode preference', () => {
  it('falls back to light when nothing is stored', () => {
    expect(readThemeMode(memoryStorage().storage)).toBe('light')
  })

  it.each(['light', 'dark'] as const)('reads a stored %s', (mode) => {
    expect(readThemeMode(memoryStorage({ [THEME_MODE_STORAGE_KEY]: mode }).storage)).toBe(mode)
  })

  it.each(['system', 'Dark', '', '"dark"', 'null'])('falls back to light for the unknown value %j', (value) => {
    expect(readThemeMode(memoryStorage({ [THEME_MODE_STORAGE_KEY]: value }).storage)).toBe('light')
  })

  it('falls back to light when the read throws or storage is unavailable', () => {
    const { storage, state } = memoryStorage({ [THEME_MODE_STORAGE_KEY]: 'dark' })
    state.failReads = true
    expect(readThemeMode(storage)).toBe('light')
    expect(readThemeMode(null)).toBe('light')
  })

  it('writes under its own key and reports a failed or impossible write', () => {
    const { storage, values, state } = memoryStorage()
    expect(writeThemeMode(storage, 'dark')).toBe(true)
    expect(values.get(THEME_MODE_STORAGE_KEY)).toBe('dark')
    state.failWrites = true
    expect(writeThemeMode(storage, 'light')).toBe(false)
    expect(values.get(THEME_MODE_STORAGE_KEY)).toBe('dark')
    expect(writeThemeMode(null, 'light')).toBe(false)
  })
})

describe('appearance store', () => {
  let memory: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    memory = memoryStorage()
  })

  it('starts from the stored mode, read before any render', () => {
    memory.values.set(THEME_MODE_STORAGE_KEY, 'dark')
    expect(createAppearanceStore(() => memory.storage).getState().themeMode).toBe('dark')
  })

  it('defaults to light and never follows the operating system', () => {
    // Even a dark operating system answer is never consulted: the store reads
    // only the stored preference.
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...originalMatchMedia(query), matches: true })) as typeof window.matchMedia
    try {
      expect(createAppearanceStore(() => memory.storage).getState().themeMode).toBe('light')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('persists a change and keeps it across a reload', () => {
    const store = createAppearanceStore(() => memory.storage)
    store.getState().setThemeMode('dark')
    expect(store.getState()).toMatchObject({ themeMode: 'dark', themeModePersistFailed: false })
    expect(memory.values.get(THEME_MODE_STORAGE_KEY)).toBe('dark')

    // A reload is a fresh store over the same storage.
    expect(createAppearanceStore(() => memory.storage).getState().themeMode).toBe('dark')
    store.getState().setThemeMode('light')
    expect(memory.values.get(THEME_MODE_STORAGE_KEY)).toBe('light')
    store.getState().reloadFromStorage()
    expect(store.getState().themeMode).toBe('light')
  })

  it('still applies a change for the session when it cannot be saved', () => {
    const store = createAppearanceStore(() => memory.storage)
    memory.state.failWrites = true
    store.getState().setThemeMode('dark')
    expect(store.getState()).toMatchObject({ themeMode: 'dark', themeModePersistFailed: true })
    expect(memory.values.has(THEME_MODE_STORAGE_KEY)).toBe(false)

    memory.state.failWrites = false
    store.getState().setThemeMode('light')
    expect(store.getState().themeModePersistFailed).toBe(false)
  })

  it('works with no storage at all', () => {
    const store = createAppearanceStore(() => null)
    expect(store.getState().themeMode).toBe('light')
    store.getState().setThemeMode('dark')
    expect(store.getState()).toMatchObject({ themeMode: 'dark', themeModePersistFailed: true })
  })
})
