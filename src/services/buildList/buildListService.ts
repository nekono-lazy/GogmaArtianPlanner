import {
  applyBuildListEntryStaleness,
  createBuildListEntry,
  evaluateBuildListEntryStaleness,
  isSameBuildListCandidate,
  withSelectedCheckpointOpportunities,
} from '../../domain/buildList'
import { validateBuildListEntry } from '../../domain/models/publicTypes'
import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  CompromiseCheckpointOpportunityId,
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

  /**
   * Adds one Candidate, or reports that an equivalent Entry already exists.
   *
   * An existing Entry is returned untouched: its checkpoint selection is the
   * user's Build List input, and the Search screen's current selection must
   * never silently overwrite it (`docs/UI_FLOW.md` 6.5).
   */
  async addCandidate(
    candidate: BuildCandidate,
    target: TargetWeapon,
    selectedCheckpointOpportunityIds: readonly CompromiseCheckpointOpportunityId[] = [],
  ): Promise<{ entry: BuildListEntry; added: boolean }> {
    const existing = (await this.repositories.getAllEntries()).find((entry) =>
      isSameBuildListCandidate(entry, candidate),
    )
    if (existing) return { entry: existing, added: false }
    const entry = createBuildListEntry(candidate, target, {
      selectedCheckpointOpportunityIds,
    })
    await this.repositories.putEntry(entry)
    return { entry, added: true }
  }

  /**
   * Replaces one Entry's checkpoint selection.
   *
   * The Domain validation is the authority for at most one opportunity per
   * group and for every id existing in the Candidate Snapshot, so an invalid
   * selection fails closed here rather than reaching the Planner.
   */
  async updateCheckpointSelection(
    id: BuildListEntryId,
    selectedCheckpointOpportunityIds: readonly CompromiseCheckpointOpportunityId[],
  ): Promise<BuildListEntry> {
    const existing = (await this.repositories.getAllEntries()).find(
      (entry) => entry.id === id,
    )
    if (!existing) {
      throw new Error(`BuildListEntry '${id}' does not exist.`)
    }
    const updated = withSelectedCheckpointOpportunities(
      existing,
      selectedCheckpointOpportunityIds,
    )
    const valid = validateBuildListEntry(updated)
    if (!valid.isValid) {
      throw new Error(
        valid.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
      )
    }
    return this.repositories.putEntry(updated)
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
