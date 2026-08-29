import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import { validateBuildListEntry } from '../../domain/models/validation'
import { appDatabase, type AppDatabase } from '../AppDatabase'
import { assertRepositoryValidation } from '../repositoryError'

function sortEntries(entries: BuildListEntry[]): BuildListEntry[] {
  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

export class BuildListEntryRepository {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  getBuildListEntry(
    id: BuildListEntryId,
  ): Promise<BuildListEntry | undefined> {
    return this.database.buildListEntries.get(id)
  }

  async getAllBuildListEntries(): Promise<BuildListEntry[]> {
    return sortEntries(await this.database.buildListEntries.toArray())
  }

  async getBuildListEntriesByTarget(
    targetWeaponId: TargetWeaponId,
  ): Promise<BuildListEntry[]> {
    return sortEntries(
      await this.database.buildListEntries
        .where('targetWeaponId')
        .equals(targetWeaponId)
        .toArray(),
    )
  }

  async getNonStaleBuildListEntries(): Promise<BuildListEntry[]> {
    return sortEntries(
      (await this.database.buildListEntries.toArray()).filter(
        ({ isStale }) => !isStale,
      ),
    )
  }

  async putBuildListEntry(entry: BuildListEntry): Promise<BuildListEntry> {
    assertRepositoryValidation(
      'BuildListEntry',
      validateBuildListEntry(entry),
    )
    await this.database.buildListEntries.put(entry)
    return entry
  }

  deleteBuildListEntry(id: BuildListEntryId): Promise<void> {
    return this.database.buildListEntries.delete(id)
  }
}

export const buildListEntryRepository = new BuildListEntryRepository(appDatabase)
