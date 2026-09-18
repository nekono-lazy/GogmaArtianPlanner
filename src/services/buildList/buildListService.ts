import {
  applyBuildListEntryStaleness,
  createBuildListEntry,
  defaultIntermediateStateSelection,
  evaluateBuildListEntryStaleness,
  isSameBuildListCandidate,
  withIntermediateStateSelection,
} from '../../domain/buildList'
import {
  unchangedMutableState,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
  type PlanGuardedMutation,
} from '../../domain/execution'
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
import {
  defaultPlanGuardedPersistence,
  type PlanGuardedPersistence,
} from '../execution/planBreakingChangeGuard'

export interface BuildListServiceRepositories {
  getAllEntries(): Promise<BuildListEntry[]>
  /**
   * Adds an Entry or refreshes its derived staleness flags. Neither can break
   * a ProductionPlan (`docs/PLANNER_SPEC.md` 16.6), so neither is guarded.
   */
  putEntry(entry: BuildListEntry): Promise<BuildListEntry>
  ensureRngState(): Promise<RngState>
  getNormalCounters(): Promise<NormalArtianCounter[]>
  getOwnedWeapons(): Promise<OwnedWeapon[]>
  getTargets(): Promise<TargetWeapon[]>
  /**
   * The breaking-change guard of the two Build List operations that can break
   * the `active` Plan: changing a selected Entry's intermediate state selection
   * or improvement preference, and deleting a selected Entry.
   */
  persistence: PlanGuardedPersistence
}

export const defaultBuildListRepositories: BuildListServiceRepositories = {
  getAllEntries: () => buildListEntryRepository.getAllBuildListEntries(),
  putEntry: (entry) => buildListEntryRepository.putBuildListEntry(entry),
  ensureRngState: () => rngStateRepository.ensureInitialRngState(),
  getNormalCounters: () => normalArtianCounterRepository.getAllNormalArtianCounters(),
  getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
  getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
  persistence: defaultPlanGuardedPersistence,
}

/**
 * One intermediate state selection change as a guarded mutation. The Domain
 * validation is the authority for at most one state per lane and for every id
 * existing on its own lane of the Candidate Snapshot, so an invalid selection
 * fails closed here rather than reaching the Planner.
 */
export function intermediateStateSelectionMutation(
  id: BuildListEntryId,
  intermediateStateSelection: IntermediateStateSelection,
): PlanGuardedMutation<BuildListEntry> {
  return (base) => {
    const existing = base.buildListEntries.find((entry) => entry.id === id)
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
    return {
      result: updated,
      state: {
        ...unchangedMutableState(base),
        buildListEntries: base.buildListEntries.map((entry) => (entry.id === id ? updated : entry)),
      },
    }
  }
}

/** One Build List Entry delete as a guarded mutation. */
export function buildListEntryDeleteMutation(id: BuildListEntryId): PlanGuardedMutation<void> {
  return (base) => ({
    result: undefined,
    state: {
      ...unchangedMutableState(base),
      buildListEntries: base.buildListEntries.filter((entry) => entry.id !== id),
    },
  })
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
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<BuildListEntry> {
    const mutation = intermediateStateSelectionMutation(id, intermediateStateSelection)
    return (await this.repositories.persistence.apply(mutation, approval)).result
  }

  /** Whether the selection change needs the breaking-change approval (`docs/UI_FLOW.md` 16.3). Writes nothing. */
  inspectIntermediateStateSelectionUpdate(
    id: BuildListEntryId,
    intermediateStateSelection: IntermediateStateSelection,
  ): Promise<PlanBreakingChangeInspection> {
    return this.repositories.persistence.inspect(intermediateStateSelectionMutation(id, intermediateStateSelection))
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

  async deleteEntry(id: BuildListEntryId, approval: PlanBreakingChangeApproval | null = null): Promise<void> {
    await this.repositories.persistence.apply(buildListEntryDeleteMutation(id), approval)
  }

  /** Whether deleting the Entry needs the breaking-change approval (`docs/UI_FLOW.md` 16.3). Writes nothing. */
  inspectEntryDelete(id: BuildListEntryId): Promise<PlanBreakingChangeInspection> {
    return this.repositories.persistence.inspect(buildListEntryDeleteMutation(id))
  }
}

export const buildListService = new BuildListService()
