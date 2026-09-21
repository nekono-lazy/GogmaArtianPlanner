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
import type {
  BuildListEntry,
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
  validateRngState,
} from '../../domain/models/publicTypes'
import {
  checkGeneratedBuildListEntriesFresh,
  checkPersistablePlannerResultShape,
  checkProductionPlanBuildListReferences,
  collectProductionPlanDependentTargetWeaponIds,
  createPlanningBuildListEntriesHash,
  createPlanningTargetWeaponsHash,
  findPersistedGeneratedBuildListEntryCollision,
  type PlannerOrchestrationResult,
  type PlannerResultPersistenceIssue,
  type PlannerSearchTermination,
} from '../../domain/planner'

/**
 * The B8-D2a save-time boundary of PLANNER_SPEC 9.2.15.
 *
 * A `PlannerOrchestrationResult` is a pure calculation over the snapshot the
 * Planner Worker was handed. Persisting it therefore re-reads the current state
 * *inside* the same Dexie read-write transaction that writes, re-validates the
 * Plan against that state with the existing snapshot authorities, and only then
 * deletes the previous Draft, writes the generated BuildListEntries and adds the
 * new Draft together. There is no window between the check and the write, and
 * no partial save: either the previous Draft is gone and every Entry and the
 * new Plan are stored, or nothing changed and the previous Draft survives.
 *
 * The Draft replacement (`docs/DATA_MODEL.md` 11.1, `docs/PLANNER_SPEC.md`
 * 9.2.15) deletes only `draft` ProductionPlan records - never an `active` /
 * `stale` / `completed` / `abandoned` Plan, and never the BuildListEntries,
 * BuildCandidates or Targets the previous Draft referenced, because a Draft
 * owns no Entry and no persisted authority could say which Entry belonged to
 * it alone. It is never done in a separate transaction ahead of the save, and it
 * never replaces a Plan under its ID: the new Plan's ID is checked against the
 * whole collection in the same transaction before any Draft is deleted
 * (`production_plan_id_conflict`).
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

/**
 * Maps a shared save-time issue onto this service's `RepositoryError`
 * boundary; `null` passes.
 */
function throwIssue(issue: PlannerResultPersistenceIssue | null): void {
  if (issue === null) return
  switch (issue.kind) {
    case 'result_invalid':
      throw resultInvalid(issue.message)
    case 'state_changed':
      throw stateChanged(issue.message)
    case 'entity_invalid':
      assertRepositoryValidation(issue.entityName, issue.validation)
      return
  }
}

function sameExpectedPlanState(
  left: ExpectedPlanState,
  right: ExpectedPlanState,
): boolean {
  return (
    left.rngStateHash === right.rngStateHash &&
    left.normalCountersHash === right.normalCountersHash &&
    left.ownedWeaponsHash === right.ownedWeaponsHash &&
    // Calculation schema 12 state includes the Plan-dependent Target execution
    // state; a stored Plan is always of the current schema here, because an
    // incompatible CalculationContext fails closed before this comparison.
    left.targetExecutionStateHash === right.targetExecutionStateHash
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
   * Saves the generated BuildListEntries and the ProductionPlan atomically,
   * replacing the previous Draft in the same transaction.
   *
   * Returns the stored Plan, or `null` when the calculation produced no Plan
   * (the previous Draft is then kept). Every failure throws a `RepositoryError`
   * and writes nothing - the previous Draft, the Build List and every other
   * table stay as they were: `planner_state_changed` means the current state
   * moved under the calculation, `planner_result_invalid` means the result
   * violates an invariant it must satisfy to be persisted, and
   * `validation_failed` means Domain validation rejected the Plan or an Entry.
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

        // A newly calculated Plan carries a fresh ID: an ID the collection
        // already holds - whatever that Plan's status, the previous Draft
        // included - is a different Plan and is refused here, inside the
        // transaction and before the Draft replacement, so a Draft holding the
        // same ID is never deleted and re-added under it.
        await this.repositories.productionPlans.assertProductionPlanIdFree(plan.id)

        // The new Draft replaces the previous one (DATA_MODEL 11.1): only Draft
        // records are deleted, their referenced Entries stay, and any failure
        // below rolls this deletion back with the rest of the transaction.
        await this.repositories.productionPlans.deleteDraftProductionPlans()
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
    // PLANNER_SPEC 7.2.1 / 9.2.15, shared with the replan adoption (16.8):
    // an incomplete search, a non-draft Plan, duplicated generated Entry IDs,
    // or a Domain-invalid Plan / Entry is never persisted. B8-D2a stores a
    // freshly calculated Draft; activation, replacement and the
    // single-active-Plan constraint stay the existing Application concerns.
    throwIssue(checkPersistablePlannerResultShape(plan, generatedEntries, termination))
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

    // A freshly calculated Draft has no confirmed Step yet, so no observation
    // binding applies and the current state hashes with its real values.
    const currentExecutionState = createExpectedPlanState(
      current.rngState,
      current.normalCounters,
      current.ownedWeapons,
      {
        targetWeapons: current.targetWeapons,
        dependentTargetWeaponIds: collectProductionPlanDependentTargetWeaponIds(
          plan,
          [...current.buildListEntries, ...generatedEntries],
        ),
      },
    )
    if (
      !sameExpectedPlanState(
        currentExecutionState,
        plan.baseSnapshot.initialExecutionState,
      )
    ) {
      throw stateChanged(
        'Current RngState, Normal Artian counters, OwnedWeapons or Plan-dependent Target execution state differ from PlanningInputSnapshot.initialExecutionState.',
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

    throwIssue(
      findPersistedGeneratedBuildListEntryCollision(generatedEntries, current.buildListEntries),
    )

    const augmentedEntries = [...current.buildListEntries, ...generatedEntries]
    if (
      createPlanningBuildListEntriesHash(augmentedEntries) !==
      plan.baseSnapshot.buildListEntriesHash
    ) {
      throw stateChanged(
        'The current BuildListEntry set plus the generated Entries differs from PlanningInputSnapshot.buildListEntriesHash.',
      )
    }

    throwIssue(
      checkGeneratedBuildListEntriesFresh(generatedEntries, current, currentCalculationContext),
    )

    return augmentedEntries
  }

  /** Every BuildListEntry the Plan references must exist in the final set. */
  private assertPlanReferences(
    plan: ProductionPlan,
    generatedEntries: readonly BuildListEntry[],
    augmentedEntries: readonly BuildListEntry[],
  ) {
    throwIssue(checkProductionPlanBuildListReferences(plan, generatedEntries, augmentedEntries))
  }
}

export const plannerResultPersistenceService =
  new PlannerResultPersistenceService()
