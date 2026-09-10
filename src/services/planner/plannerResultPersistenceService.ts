import { appDatabase, type AppDatabase } from '../../db/AppDatabase'
import {
  BuildListEntryRepository,
  NormalArtianCounterRepository,
  OwnedWeaponRepository,
  ProductionPlanRepository,
  RngStateRepository,
  TargetWeaponRepository,
} from '../../db/repositories'
import {
  assertRepositoryValidation,
  RepositoryError,
} from '../../db/repositoryError'
import { runInRepositoryTransaction } from '../../db/transaction'
import { evaluateBuildListEntryStaleness } from '../../domain/buildList'
import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  ExpectedPlanState,
  NormalArtianCounter,
  OwnedWeapon,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createExpectedPlanState,
  isCalculationContextCompatible,
  validateBuildListEntry,
  validateProductionPlan,
  validateRngState,
} from '../../domain/models/publicTypes'
import {
  createPlanningBuildListEntriesHash,
  createPlanningTargetWeaponsHash,
  type PlannerOrchestrationResult,
  type PlannerSearchTermination,
} from '../../domain/planner'

/**
 * The B8-D2a save-time boundary of PLANNER_SPEC 9.2.15.
 *
 * A `PlannerOrchestrationResult` is a pure calculation over the snapshot the
 * Planner Worker was handed. Persisting it therefore re-reads the current state
 * *inside* the same Dexie read-write transaction that writes, re-validates the
 * Plan against that state with the existing snapshot authorities, and only then
 * writes the generated BuildListEntries and the ProductionPlan together. There
 * is no window between the check and the write, and no partial save: either
 * every Entry and the Plan are stored, or nothing is.
 *
 * It re-runs nothing. Beam Search, Trace Replay, constrained enumeration and
 * Candidate trials stay the Worker's authority, so no `RngEngine` is created on
 * the main thread. Save time only compares the finished Plan against current
 * persisted state.
 */

/** The repositories the save-time transaction reads and writes through. */
export interface PlannerResultPersistenceRepositories {
  rngState: RngStateRepository
  normalCounters: NormalArtianCounterRepository
  ownedWeapons: OwnedWeaponRepository
  targetWeapons: TargetWeaponRepository
  buildListEntries: BuildListEntryRepository
  productionPlans: ProductionPlanRepository
}

export function createPlannerResultPersistenceRepositories(
  database: AppDatabase,
): PlannerResultPersistenceRepositories {
  return {
    rngState: new RngStateRepository(database),
    normalCounters: new NormalArtianCounterRepository(database),
    ownedWeapons: new OwnedWeaponRepository(database),
    targetWeapons: new TargetWeaponRepository(database),
    buildListEntries: new BuildListEntryRepository(database),
    productionPlans: new ProductionPlanRepository(database),
  }
}

/**
 * Current persisted state diverged from the Plan's own snapshot. Nothing was
 * written; re-running the Planner over the current state is the recovery.
 */
function stateChanged(message: string): RepositoryError {
  return new RepositoryError('planner_state_changed', message)
}

/**
 * The orchestration result itself is not persistable. Re-running the Planner
 * over unchanged state would fail the same way, so this is not retryable.
 */
function resultInvalid(message: string): RepositoryError {
  return new RepositoryError('planner_result_invalid', message)
}

function sameExpectedPlanState(
  left: ExpectedPlanState,
  right: ExpectedPlanState,
): boolean {
  return (
    left.rngStateHash === right.rngStateHash &&
    left.normalCountersHash === right.normalCountersHash &&
    left.ownedWeaponsHash === right.ownedWeaponsHash
  )
}

interface PlannerSaveCurrentState {
  rngState: RngState
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
}

export class PlannerResultPersistenceService {
  private readonly database: AppDatabase
  private readonly repositories: PlannerResultPersistenceRepositories

  constructor(
    database: AppDatabase = appDatabase,
    repositories: PlannerResultPersistenceRepositories =
      createPlannerResultPersistenceRepositories(database),
  ) {
    this.database = database
    this.repositories = repositories
  }

  /**
   * Saves the generated BuildListEntries and the ProductionPlan atomically.
   *
   * Returns the stored Plan, or `null` when the calculation produced no Plan.
   * Every failure throws a `RepositoryError` and writes nothing:
   * `planner_state_changed` means the current state moved under the
   * calculation, `planner_result_invalid` means the result violates an
   * invariant it must satisfy to be persisted, and `validation_failed` means
   * Domain validation rejected the Plan or an Entry.
   */
  async savePlannerOrchestrationResult(
    result: PlannerOrchestrationResult,
    currentCalculationContext: CalculationContext,
  ): Promise<ProductionPlan | null> {
    const { plan } = result
    const generatedEntries = result.generatedBuildListEntries

    if (plan === null) {
      // PLANNER_SPEC 9.2.14: no Plan means no adopted Entry. A non-empty list
      // here breaks the orchestration invariant, so nothing is written and no
      // Entry is salvaged on its own.
      if (generatedEntries.length > 0) {
        throw resultInvalid(
          `The Planner returned no Plan but ${generatedEntries.length} generated BuildListEntries. No Entry may be persisted without its Plan.`,
        )
      }
      return null
    }

    this.assertPersistableResultShape(plan, generatedEntries, result.termination)

    return runInRepositoryTransaction(
      this.database,
      [
        this.database.rngState,
        this.database.normalArtianCounters,
        this.database.ownedWeapons,
        this.database.targetWeapons,
        this.database.buildListEntries,
        this.database.productionPlans,
      ],
      async () => {
        const current = await this.readCurrentState()
        const augmentedEntries = this.assertCurrentStateMatchesPlan(
          plan,
          generatedEntries,
          current,
          currentCalculationContext,
        )
        this.assertPlanReferences(plan, generatedEntries, augmentedEntries)

        for (const entry of generatedEntries) {
          await this.repositories.buildListEntries.addBuildListEntry(entry)
        }
        return this.repositories.productionPlans.addProductionPlan(plan)
      },
    )
  }

  /** Result-shape invariants that do not depend on current persisted state. */
  private assertPersistableResultShape(
    plan: ProductionPlan,
    generatedEntries: readonly BuildListEntry[],
    termination: PlannerSearchTermination,
  ) {
    // PLANNER_SPEC 7.2.1: a Plan calculated from a Beam Search that a
    // `PlannerOptions` bound truncated is a partial search artifact, not a
    // finished production plan, so it never becomes an executable Draft. The
    // typed termination decides this - never a `PlannerWarning` message, and
    // never the presence of `max_expanded_states_reached`, which a completed
    // search can carry too. Raising the bound and recalculating is the
    // recovery, so nothing is written and no generated Entry is salvaged.
    if (termination.status === 'incomplete') {
      throw resultInvalid(
        `The Planner search did not complete: it reached ${termination.reachedLimits.join(', ')} after ${termination.expandedStates} expanded states with ${termination.completedTargetCount} of ${termination.totalTargetCount} target weapons completed. A truncated search result must not be saved as an executable ProductionPlan.`,
      )
    }
    // B8-D2a stores a freshly calculated Draft. Activation, replacement and the
    // single-active-Plan constraint stay the existing Application concerns.
    if (plan.status !== 'draft') {
      throw resultInvalid(
        `A Planner orchestration result must be saved as a draft ProductionPlan, but its status is '${plan.status}'.`,
      )
    }
    const duplicated = generatedEntries
      .map(({ id }) => id)
      .filter((id, index, all) => all.indexOf(id) !== index)
    if (duplicated.length > 0) {
      throw resultInvalid(
        `Generated BuildListEntry IDs must be unique: '${duplicated[0]}' appears more than once.`,
      )
    }
    assertRepositoryValidation('ProductionPlan', validateProductionPlan(plan))
    for (const entry of generatedEntries) {
      assertRepositoryValidation('BuildListEntry', validateBuildListEntry(entry))
    }
  }

  private async readCurrentState(): Promise<PlannerSaveCurrentState> {
    // Read inside the write transaction. A missing or invalid RngState fails
    // closed: save time never creates an initial state and never repairs one.
    const rngState = await this.repositories.rngState.getCurrentRngState()
    if (!rngState) {
      throw stateChanged(
        'No RngState is stored, so the Planner result cannot be validated against current state.',
      )
    }
    assertRepositoryValidation('RngState', validateRngState(rngState))
    return {
      rngState,
      normalCounters:
        await this.repositories.normalCounters.getAllNormalArtianCounters(),
      ownedWeapons: await this.repositories.ownedWeapons.getAllOwnedWeapons(),
      targetWeapons: await this.repositories.targetWeapons.getAllTargetWeapons(),
      buildListEntries:
        await this.repositories.buildListEntries.getAllBuildListEntries(),
    }
  }

  /**
   * Compares current state against the Plan's own `PlanningInputSnapshot` with
   * the existing snapshot authorities only, and returns the final augmented
   * BuildListEntry set the Plan was calculated over.
   */
  private assertCurrentStateMatchesPlan(
    plan: ProductionPlan,
    generatedEntries: readonly BuildListEntry[],
    current: PlannerSaveCurrentState,
    currentCalculationContext: CalculationContext,
  ): BuildListEntry[] {
    if (
      !isCalculationContextCompatible(
        currentCalculationContext,
        plan.calculationContext,
      ) ||
      !isCalculationContextCompatible(
        currentCalculationContext,
        plan.baseSnapshot.calculationContext,
      )
    ) {
      throw stateChanged(
        'The current CalculationContext is no longer compatible with the calculated Plan.',
      )
    }

    const currentExecutionState = createExpectedPlanState(
      current.rngState,
      current.normalCounters,
      current.ownedWeapons,
    )
    if (
      !sameExpectedPlanState(
        currentExecutionState,
        plan.baseSnapshot.initialExecutionState,
      )
    ) {
      throw stateChanged(
        'Current RngState, Normal Artian counters or OwnedWeapons differ from PlanningInputSnapshot.initialExecutionState.',
      )
    }

    if (
      createPlanningTargetWeaponsHash(current.targetWeapons) !==
      plan.baseSnapshot.targetWeaponsHash
    ) {
      throw stateChanged(
        'Current TargetWeapons differ from PlanningInputSnapshot.targetWeaponsHash.',
      )
    }

    // A generated Entry that is already persisted was not the `reusedExisting`
    // case - a reused Entry is never returned as generated - so the same ID
    // appearing now is a save-time race, never a silent reuse or overwrite.
    const persistedIds = new Set(current.buildListEntries.map(({ id }) => id))
    const collided = generatedEntries.find(({ id }) => persistedIds.has(id))
    if (collided) {
      throw stateChanged(
        `Generated BuildListEntry '${collided.id}' already exists in persistence; current state changed after the Planner ran.`,
      )
    }

    const augmentedEntries = [...current.buildListEntries, ...generatedEntries]
    if (
      createPlanningBuildListEntriesHash(augmentedEntries) !==
      plan.baseSnapshot.buildListEntriesHash
    ) {
      throw stateChanged(
        'The current BuildListEntry set plus the generated Entries differs from PlanningInputSnapshot.buildListEntriesHash.',
      )
    }

    const targetById = new Map(
      current.targetWeapons.map((target) => [target.id, target]),
    )
    for (const entry of generatedEntries) {
      // Recomputed from current state, never read off the persisted flags.
      const staleness = evaluateBuildListEntryStaleness(entry, {
        target: targetById.get(entry.targetWeaponId) ?? null,
        rngState: current.rngState,
        normalCounters: current.normalCounters,
        ownedWeapons: current.ownedWeapons,
        calculationContext: currentCalculationContext,
      })
      if (staleness.isStale) {
        throw stateChanged(
          `Generated BuildListEntry '${entry.id}' is stale against current state (${staleness.staleReasons.join(', ')}).`,
        )
      }
    }

    return augmentedEntries
  }

  /** Every BuildListEntry the Plan references must exist in the final set. */
  private assertPlanReferences(
    plan: ProductionPlan,
    generatedEntries: readonly BuildListEntry[],
    augmentedEntries: readonly BuildListEntry[],
  ) {
    const entryById = new Map(augmentedEntries.map((entry) => [entry.id, entry]))
    const requireEntry = (id: BuildListEntryId, path: string) => {
      const entry = entryById.get(id)
      if (!entry) {
        throw resultInvalid(
          `${path} references BuildListEntry '${id}', which is not part of the final augmented Build List.`,
        )
      }
      return entry
    }

    plan.selectedBuildListEntryIds.forEach((id, index) =>
      requireEntry(id, `selectedBuildListEntryIds[${index}]`),
    )
    plan.conflicts.forEach((conflict, index) => {
      conflict.buildListEntryIds.forEach((id, participant) =>
        requireEntry(id, `conflicts[${index}].buildListEntryIds[${participant}]`),
      )
      if (conflict.recommendedBuildListEntryId !== null) {
        requireEntry(
          conflict.recommendedBuildListEntryId,
          `conflicts[${index}].recommendedBuildListEntryId`,
        )
      }
      if (conflict.selectedBuildListEntryId !== null) {
        requireEntry(
          conflict.selectedBuildListEntryId,
          `conflicts[${index}].selectedBuildListEntryId`,
        )
      }
    })
    plan.rejectedBuildListEntries.forEach((rejected, index) =>
      requireEntry(
        rejected.buildListEntryId,
        `rejectedBuildListEntries[${index}].buildListEntryId`,
      ),
    )

    plan.steps.forEach((step, index) => {
      if (step.buildListEntryId === null) return
      const entry = requireEntry(
        step.buildListEntryId,
        `steps[${index}].buildListEntryId`,
      )
      // A Candidate-derived Step carries that Entry Snapshot's Candidate ID.
      if (step.candidateId !== entry.candidateSnapshot.id) {
        throw resultInvalid(
          `steps[${index}].candidateId '${step.candidateId}' does not match the candidate Snapshot '${entry.candidateSnapshot.id}' of BuildListEntry '${entry.id}'.`,
        )
      }
    })

    // PLANNER_SPEC 9.2.14 adoption: a generated Entry exists only because the
    // final Plan selected it. Persistence defends the same invariant.
    const selected = new Set(plan.selectedBuildListEntryIds)
    const unselected = generatedEntries.find(({ id }) => !selected.has(id))
    if (unselected) {
      throw resultInvalid(
        `Generated BuildListEntry '${unselected.id}' is not selected by the final ProductionPlan.`,
      )
    }
  }
}

export const plannerResultPersistenceService =
  new PlannerResultPersistenceService()
