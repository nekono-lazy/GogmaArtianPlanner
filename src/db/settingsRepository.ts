import type { AppSettings, ISODateTimeString } from '../domain/models/publicTypes'
import { appDatabase } from './AppDatabase'

export interface SettingsDataSource {
  get(id: 'settings'): Promise<AppSettings | undefined>
  add(settings: AppSettings): Promise<unknown>
  put(settings: AppSettings): Promise<unknown>
}

export function createDefaultSettings(
  now: ISODateTimeString = new Date().toISOString(),
): AppSettings {
  return {
    id: 'settings',
    schemaVersion: 1,
    debugMode: false,
    resultPageSize: 50,
    defaultSearchLimit: 5000,
    createdAt: now,
    updatedAt: now,
  }
}

export class SettingsRepository {
  private readonly dataSource: SettingsDataSource

  constructor(dataSource: SettingsDataSource) {
    this.dataSource = dataSource
  }

  async getOrCreateDefault(
    now: ISODateTimeString = new Date().toISOString(),
  ): Promise<AppSettings> {
    const existing = await this.dataSource.get('settings')
    if (existing) return existing

    const initial = createDefaultSettings(now)
    try {
      await this.dataSource.add(initial)
      return initial
    } catch (error: unknown) {
      const concurrentlyCreated = await this.dataSource.get('settings')
      if (concurrentlyCreated) return concurrentlyCreated
      throw error
    }
  }

  async setDebugMode(debugMode: boolean): Promise<AppSettings> {
    const current = await this.getOrCreateDefault()
    const updated: AppSettings = {
      ...current,
      debugMode,
      updatedAt: new Date().toISOString(),
    }
    await this.dataSource.put(updated)
    return updated
  }
}

export const settingsRepository = new SettingsRepository({
  get: (id) => appDatabase.settings.get(id),
  add: (settings) => appDatabase.settings.add(settings),
  put: (settings) => appDatabase.settings.put(settings),
})
