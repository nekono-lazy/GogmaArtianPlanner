import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../domain/models/publicTypes'
import { validateAppSettings } from '../domain/models/validation'
import {
  SettingsRepository,
  createDefaultSettings,
  type SettingsDataSource,
  type SettingsFieldChanges,
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

  async update(_id: 'settings', changes: SettingsFieldChanges) {
    if (this.value === undefined) return 0
    this.value = { ...this.value, ...changes }
    return 1
  }
}

describe('SettingsRepository', () => {
  it('creates the initial settings only when missing', async () => {
    const dataSource = new MemorySettingsDataSource()
    const repository = new SettingsRepository(dataSource)

    const settings = await repository.getOrCreateDefault('2026-08-29T00:00:00.000Z')

    expect(settings).toEqual(createDefaultSettings('2026-08-29T00:00:00.000Z'))
    expect(validateAppSettings(settings).isValid).toBe(true)
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

  it('creates the recommended Candidate Search defaults 350 / 500 / 1500 for a new environment', async () => {
    const repository = new SettingsRepository(new MemorySettingsDataSource())
    const settings = await repository.ensureSettings('2026-09-25T00:00:00.000Z')
    expect(settings.schemaVersion).toBe(2)
    expect(settings.candidateSearchDefaults).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    // The existing fields keep their meaning and values.
    expect(settings).toMatchObject({ debugMode: false, resultPageSize: 50, defaultSearchLimit: 5000 })
  })

  it('saves the Candidate Search defaults in any order and touches no other field', async () => {
    const dataSource = new MemorySettingsDataSource()
    const existing = { ...createDefaultSettings('2026-08-28T00:00:00.000Z'), debugMode: true }
    dataSource.value = existing
    const repository = new SettingsRepository(dataSource)

    // Normal above Bonus is allowed: the recommended order is no constraint.
    const saved = await repository.setCandidateSearchDefaults({ maxNormalAdvance: 1000, maxGogmaAdvance: 200, maxSkillAdvance: 1 })

    expect(saved.candidateSearchDefaults).toEqual({ maxNormalAdvance: 1000, maxGogmaAdvance: 200, maxSkillAdvance: 1 })
    expect(dataSource.value).toEqual({ ...existing, candidateSearchDefaults: saved.candidateSearchDefaults, updatedAt: saved.updatedAt })
  })

  it.each([
    ['zero', { maxNormalAdvance: 0, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }],
    ['a negative number', { maxNormalAdvance: 350, maxGogmaAdvance: -1, maxSkillAdvance: 1500 }],
    ['a fraction', { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1.5 }],
    ['NaN', { maxNormalAdvance: Number.NaN, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }],
  ])('refuses %s before any write', async (_label, defaults) => {
    const dataSource = new MemorySettingsDataSource()
    const existing = createDefaultSettings('2026-08-28T00:00:00.000Z')
    dataSource.value = existing
    const repository = new SettingsRepository(dataSource)

    await expect(repository.setCandidateSearchDefaults(defaults)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(dataSource.value).toBe(existing)
  })
})
