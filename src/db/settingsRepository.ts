import type { AppSettings, ISODateTimeString } from '../domain/models/publicTypes'
import { createDefaultAppSettings } from '../domain/models/factories'
import { validateAppSettings } from '../domain/models/validation'
import { appDatabase } from './AppDatabase'
import {
  assertRepositoryValidation,
  RepositoryError,
} from './repositoryError'

export interface SettingsDataSource {
  get(id: 'settings'): Promise<AppSettings | undefined>
  add(settings: AppSettings): Promise<unknown>
  put(settings: AppSettings): Promise<unknown>
}

export { createDefaultAppSettings as createDefaultSettings }

export class SettingsRepository {
  private readonly dataSource: SettingsDataSource

  constructor(dataSource: SettingsDataSource) {
    this.dataSource = dataSource
  }

  getSettings(): Promise<AppSettings | undefined> {
    return this.dataSource.get('settings')
  }

  async ensureSettings(
    now: ISODateTimeString = new Date().toISOString(),
  ): Promise<AppSettings> {
    const existing = await this.getSettings()
    if (existing) return existing

    const initial = createDefaultAppSettings(now)
    assertRepositoryValidation('AppSettings', validateAppSettings(initial))
    try {
      await this.dataSource.add(initial)
      return initial
    } catch (error: unknown) {
      const concurrentlyCreated = await this.getSettings()
      if (concurrentlyCreated) return concurrentlyCreated
      throw new RepositoryError(
        'transaction_failed',
        'Creating default AppSettings failed.',
        { cause: error },
      )
    }
  }

  async getOrCreateDefault(
    now: ISODateTimeString = new Date().toISOString(),
  ): Promise<AppSettings> {
    return this.ensureSettings(now)
  }

  async putSettings(settings: AppSettings): Promise<AppSettings> {
    assertRepositoryValidation('AppSettings', validateAppSettings(settings))
    try {
      await this.dataSource.put(settings)
      return settings
    } catch (error: unknown) {
      throw new RepositoryError(
        'transaction_failed',
        'Saving AppSettings failed.',
        { cause: error },
      )
    }
  }

  async setDebugMode(debugMode: boolean): Promise<AppSettings> {
    const current = await this.ensureSettings()
    const updated: AppSettings = {
      ...current,
      debugMode,
      updatedAt: new Date().toISOString(),
    }
    return this.putSettings(updated)
  }
}

export const settingsRepository = new SettingsRepository({
  get: (id) => appDatabase.settings.get(id),
  add: (settings) => appDatabase.settings.add(settings),
  put: (settings) => appDatabase.settings.put(settings),
})
