import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../domain/models/publicTypes'
import {
  SettingsRepository,
  createDefaultSettings,
  type SettingsDataSource,
} from './settingsRepository'

class MemorySettingsDataSource implements SettingsDataSource {
  value: AppSettings | undefined
  addCount = 0

  async get() {
    return this.value
  }

  async add(settings: AppSettings) {
    this.addCount += 1
    this.value = settings
  }

  async put(settings: AppSettings) {
    this.value = settings
  }
}

describe('SettingsRepository', () => {
  it('creates the initial settings only when missing', async () => {
    const dataSource = new MemorySettingsDataSource()
    const repository = new SettingsRepository(dataSource)

    const settings = await repository.getOrCreateDefault('2026-08-29T00:00:00.000Z')

    expect(settings).toEqual(createDefaultSettings('2026-08-29T00:00:00.000Z'))
    expect(dataSource.addCount).toBe(1)
  })

  it('does not overwrite existing settings', async () => {
    const dataSource = new MemorySettingsDataSource()
    const existing = { ...createDefaultSettings('2026-08-28T00:00:00.000Z'), debugMode: true }
    dataSource.value = existing
    const repository = new SettingsRepository(dataSource)

    const settings = await repository.getOrCreateDefault('2026-08-29T00:00:00.000Z')

    expect(settings).toBe(existing)
    expect(dataSource.value).toBe(existing)
    expect(dataSource.addCount).toBe(0)
  })
})
