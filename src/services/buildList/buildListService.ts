import {
  applyBuildListEntryStaleness,
  createBuildListEntry,
  defaultIntermediateStateSelection,
  evaluateBuildListEntryStaleness,
  isSameBuildListCandidate,
  withIntermediateStateSelection,
} from '../../domain/buildList'
import { validateBuildListEntry } from '../../domain/models/publicTypes'
import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  IntermediateStateSelection,
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
   * An existing Entry is returned untouched: its intermediate state selection
   * and improvement preference are the user's Build List input, and the
   * Search screen's current selection must never silently overwrite them
   * (`docs/UI_FLOW.md` 9).
   */
  async addCandidate(
    candidate: BuildCandidate,
    target: TargetWeapon,
    intermediateStateSelection: IntermediateStateSelection = defaultIntermediateStateSelection(),
  ): Promise<{ entry: BuildListEntry; added: boolean }> {
    const existing = (await this.repositories.getAllEntries()).find((entry) =>
      isSameBuildListCandidate(entry, candidate),
    )
    if (existing) return { entry: existing, added: false }
    const entry = createBuildListEntry(candidate, target, {
      intermediateStateSelection,
    })
    const valid = validateBuildListEntry(entry)
    if (!valid.isValid) {
      throw new Error(
        valid.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
      )
    }
    await this.repositories.putEntry(entry)
    return { entry, added: true }
  }

  /**
   * Replaces one Entry's intermediate state selection and improvement
   * preference.
   *
   * The Domain validation is the authority for at most one state per lane
   * and for every id existing on its own lane of the Candidate Snapshot, so
   * an invalid selection fails closed here rather than reaching the Planner.
   * A lane start (position 0) is a legal selection: for an existing Gogma,
   * both lane starts - or one start beside a lane that is already Ideal - is
   * the weapon the user holds now, and the Planner treats that compromise
   * checkpoint as reached at its start; a conversion Route's lane start is
   * reached once the conversion ran (`docs/PLANNER_SPEC.md` 7.5.2).
   */
  async updateIntermediateStateSelection(
    id: BuildListEntryId,
    intermediateStateSelection: IntermediateStateSelection,
  ): Promise<BuildListEntry> {
    const existing = (await this.repositories.getAllEntries()).find(
      (entry) => entry.id === id,
    )
    if (!existing) {
      throw new Error(`BuildListEntry '${id}' does not exist.`)
    }
    const updated = withIntermediateStateSelection(existing, intermediateStateSelection)
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
