import {
  applyBuildListEntryStaleness,
  createBuildListEntry,
  evaluateBuildListEntryStaleness,
  isSameBuildListCandidate,
} from '../../domain/buildList'
import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  NormalArtianCounter,
  OwnedWeapon,
  RngState,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  buildListEntryRepository,
  normalArtianCounterRepository,
  ownedWeaponRepository,
  rngStateRepository,
  targetWeaponRepository,
} from '../../db/repositories'

export interface BuildListServiceRepositories {
  getAllEntries(): Promise<BuildListEntry[]>
  putEntry(entry: BuildListEntry): Promise<BuildListEntry>
  deleteEntry(id: BuildListEntryId): Promise<void>
  ensureRngState(): Promise<RngState>
  getNormalCounters(): Promise<NormalArtianCounter[]>
  getOwnedWeapons(): Promise<OwnedWeapon[]>
  getTargets(): Promise<TargetWeapon[]>
}

export const defaultBuildListRepositories: BuildListServiceRepositories = {
  getAllEntries: () => buildListEntryRepository.getAllBuildListEntries(),
  putEntry: (entry) => buildListEntryRepository.putBuildListEntry(entry),
  deleteEntry: (id) => buildListEntryRepository.deleteBuildListEntry(id),
  ensureRngState: () => rngStateRepository.ensureInitialRngState(),
  getNormalCounters: () => normalArtianCounterRepository.getAllNormalArtianCounters(),
  getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
  getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
}

export class BuildListService {
  private readonly repositories: BuildListServiceRepositories

  constructor(repositories: BuildListServiceRepositories = defaultBuildListRepositories) {
    this.repositories = repositories
  }

  async addCandidate(
    candidate: BuildCandidate,
    target: TargetWeapon,
  ): Promise<{ entry: BuildListEntry; added: boolean }> {
    const existing = (await this.repositories.getAllEntries()).find((entry) =>
      isSameBuildListCandidate(entry, candidate),
    )
    if (existing) return { entry: existing, added: false }
    const entry = createBuildListEntry(candidate, target)
    await this.repositories.putEntry(entry)
    return { entry, added: true }
  }

  async refreshStaleness(
    calculationContext: CalculationContext,
  ): Promise<{
    entries: BuildListEntry[]
    targets: TargetWeapon[]
    ownedWeapons: OwnedWeapon[]
  }> {
    const [entries, rngState, normalCounters, ownedWeapons, targets] =
      await Promise.all([
        this.repositories.getAllEntries(),
        this.repositories.ensureRngState(),
        this.repositories.getNormalCounters(),
        this.repositories.getOwnedWeapons(),
        this.repositories.getTargets(),
      ])
    const targetById = new Map(targets.map((target) => [target.id, target]))
    const refreshed = await Promise.all(
      entries.map(async (entry) => {
        const result = evaluateBuildListEntryStaleness(entry, {
          target: targetById.get(entry.targetWeaponId) ?? null,
          rngState,
          normalCounters,
          ownedWeapons,
          calculationContext,
        })
        if (
          result.isStale === entry.isStale &&
          result.staleReasons.join() === entry.staleReasons.join()
        ) {
          return entry
        }
        return this.repositories.putEntry(
          applyBuildListEntryStaleness(entry, result),
        )
      }),
    )
    return { entries: refreshed, targets, ownedWeapons }
  }

  deleteEntry(id: BuildListEntryId): Promise<void> {
    return this.repositories.deleteEntry(id)
  }
}

export const buildListService = new BuildListService()
