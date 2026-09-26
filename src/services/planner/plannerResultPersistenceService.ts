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
import type { BuildListEntryReplacement } from '../../domain/buildList'
import {
  unchangedMutableState,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
  type PlanGuardedMutation,
  type PlanGuardedMutationBase,
} from '../../domain/execution'
import type {
  BuildListEntry,
  CalculationContext,
  ExecutionHistoryId,
  ExecutionSavePoint,
  ExpectedPlanState,
  ISODateTimeString,
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
  checkPersistablePlannerAlternativeRepairShape,
  checkPersistablePlannerResultShape,
  checkProductionPlanBuildListEntryReferences,
  checkProductionPlanBuildListReferences,
  collectProductionPlanDependentTargetWeaponIds,
  createPlanningBuildListEntriesHash,
  createPlanningTargetWeaponsHash,
  prepareFinalReplacementBuildList,
  type PlannerAlternativeRepairArtifact,
  type PlannerOrchestrationResult,
  type PlannerResultPersistenceIssue,
  type PlannerRunTermination,
} from '../../domain/planner'
import { PlanBreakingChangeGuard } from '../execution/planBreakingChangeGuard'

/**
 * The B8-D2a save-time boundary of PLANNER_SPEC 9.2.15 / 9.2.18.
 *
 * A `PlannerOrchestrationResult` is a pure calculation over the snapshot the
 * Planner Worker was handed. Persisting it therefore re-reads the current state
 * *inside* the same Dexie read-write transaction that writes, re-validates the
 * Plan against that state with the existing snapshot authorities, and only then
 * deletes the previous Draft, replaces each Entry the Planner replaced with its
 * generated BuildListEntry and adds the new Draft together. There is no window
 * between the check and the write, and no partial save: either the previous
 * Draft is gone, every replaced Entry is gone, every generated Entry and the
 * new Plan are stored, or nothing changed and the previous Draft survives.
 *
 * A generated Entry replaces the persisted Entry `O` of its Target
 * (`docs/PLANNER_SPEC.md` 9.2.18). The transaction deletes that `O` only after
 * confirming it is still the Target's one persisted Entry, never whatever Entry
 * the Target holds now. Deleting `O` is a Build List change, so the whole save
 * is one guarded mutation of the existing Plan-breaking guard (16.6): when `O`
 * is a dependency of the `active` Plan the save is refused without the user's
 * approval, and with it ends that Plan (`breaking_change_approved`) in the same
 * transaction. A Draft, stale or ended Plan referencing `O` never needs one.
 * Without any replacement the save never breaks a Plan, exactly as before.
 *
 * The result was calculated from the state before any save point restore, so
 * choosing 「最後のゲーム内セーブ地点へ戻す」 in that approval never saves it over
 * the restored state (`docs/PLANNER_SPEC.md` 9.2.18 / 16.10): the restore alone
 * is written, the result is dropped with its generated Entries, replacements and
 * Draft, the running Plan is not abandoned, and the outcome asks for a new
 * calculation from the restored state. The snapshot checks are never weakened to
 * fit the old result onto it.
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
 * It re-runs nothing. The full Planner run, Trace Replay, constrained enumeration and
 * Candidate trials stay the Worker's authority, so no `RngEngine` is created on
 * the main thread. Save time only compares the finished Plan against current
 * persisted state.
 *
 * The Planner Alternative actual repair (「この候補を優先」, `docs/PLANNER_SPEC.md`
 * 9.2.19.8 / 9.2.19.11) has its own entry points,
 * `inspectPlannerAlternativeRepairSave()` / `savePlannerAlternativeRepair()`.
 * They share this whole boundary - the in-transaction re-read, the snapshot
 * checks, the atomic Entry replacement, the Draft replacement, the
 * Plan-breaking guard and the save point restore that drops the result - with
 * two differences only: the artifact's accepted replacement set is the
 * authority, so a generated Entry the final Plan does not select is still
 * saved (the B8 "every generated Entry is selected" check does not apply), and
 * the Draft is stored with `conflictRepairLineage` set exactly to the
 * artifact's lineage. The B8 orchestration save keeps its own contract.
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

export interface PlannerResultPersistenceOptions {
  /** The time an approved breaking change ends the `active` Plan at. */
  clock?: { now(): ISODateTimeString }
}

const systemClock = { now: (): ISODateTimeString => new Date().toISOString() }

/**
 * How one Planner result save ended (`docs/PLANNER_SPEC.md` 9.2.15 / 9.2.18).
 *
 * - `saved`: the new Draft, its generated Entries and their replacements are
 *   stored, and any running Plan the user approved breaking is abandoned
 * - `no_plan`: the calculation produced no Plan; nothing was written and the
 *   previous Draft is kept
 * - `save_point_restored_recalculation_required`: the user approved breaking
 *   the `active` Plan and chose 「最後のゲーム内セーブ地点へ戻す」. Only the save
 *   point restore was written; this result - calculated before the restore - was
 *   dropped with its generated Entries, replacements and Draft, the previous
 *   Draft and Build List are untouched, the running Plan is the restored one
 *   (not abandoned), and a new calculation from the restored state is required
 */
export type PlannerOrchestrationResultSaveOutcome =
  | { kind: 'saved'; plan: ProductionPlan }
  | { kind: 'no_plan' }
  | {
      kind: 'save_point_restored_recalculation_required'
      /** The running Plan as the save point restored it. */
      restoredPlan: ProductionPlan
      /** The save point that was restored; it is kept. */
      savePoint: ExecutionSavePoint
      deletedExecutionHistoryIds: ExecutionHistoryId[]
    }

/**
 * How one Planner Alternative actual repair save ended. A repair artifact
 * always carries its final scenario Plan, so there is no `no_plan`: an
 * unsavable repair never reaches Persistence.
 */
export type PlannerAlternativeRepairSaveOutcome = Exclude<
  PlannerOrchestrationResultSaveOutcome,
  { kind: 'no_plan' }
>

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
  normalCounters: readonly NormalArtianCounter[]
  ownedWeapons: readonly OwnedWeapon[]
  targetWeapons: readonly TargetWeapon[]
  buildListEntries: readonly BuildListEntry[]
}

/** One persistable Planner result, its shape already checked. */
interface PersistablePlannerResult {
  plan: ProductionPlan
  generatedEntries: readonly BuildListEntry[]
  replacements: readonly BuildListEntryReplacement[]
  /**
   * The B8 orchestration contract that the final Plan selects every generated
   * Entry. `false` for a Planner Alternative repair, whose accepted replacement
   * set is the authority (`docs/PLANNER_SPEC.md` 9.2.19.6).
   */
  requireGeneratedEntriesSelected: boolean
}

export class PlannerResultPersistenceService {
  private readonly database: AppDatabase
  private readonly repositories: PlannerResultPersistenceRepositories
  private readonly clock: { now(): ISODateTimeString }

  constructor(
    database: AppDatabase = appDatabase,
    repositories: PlannerResultPersistenceRepositories =
      createPlannerResultPersistenceRepositories(database),
    options: PlannerResultPersistenceOptions = {},
  ) {
    this.database = database
    this.repositories = repositories
    this.clock = options.clock ?? systemClock
  }

  /**
   * Reads whether saving the result needs the Plan-breaking approval
   * (`docs/PLANNER_SPEC.md` 16.6 / 9.2.18, `docs/UI_FLOW.md` 16.3) and what the
   * warning and the 16.10 save point choice must show. It writes nothing, and
   * refuses a result the save would refuse. A result with no Plan never needs
   * one.
   */
  async inspectPlannerOrchestrationResultSave(
    result: PlannerOrchestrationResult,
    currentCalculationContext: CalculationContext,
  ): Promise<PlanBreakingChangeInspection> {
    const persistable = this.persistableResult(result)
    if (persistable === null) return { approvalRequired: false }
    return this.guard(currentCalculationContext).inspect(
      this.saveMutation(persistable, currentCalculationContext),
    )
  }

  /**
   * Saves the generated BuildListEntries - each replacing the persisted Entry
   * it was calculated to replace - and the ProductionPlan atomically,
   * replacing the previous Draft in the same transaction.
   *
   * Returns `saved` with the stored Plan, or `no_plan` when the calculation
   * produced no Plan (the previous Draft is then kept). An approval whose 16.10
   * decision restores the save point returns
   * `save_point_restored_recalculation_required`: the restore, and nothing of
   * this result, is written in one transaction. Every failure throws and writes nothing
   * - the previous Draft, the Build List, the running Plan and every other
   * table stay as they were: `planner_state_changed` means the current state
   * moved under the calculation (a replaced Entry that is no longer its
   * Target's one persisted Entry included), `planner_result_invalid` means the
   * result violates an invariant it must satisfy to be persisted,
   * `validation_failed` means Domain validation rejected the Plan or an Entry,
   * and `plan_breaking_change_approval_required` means a replacement breaks the
   * `active` Plan and `approval` was not given.
   */
  async savePlannerOrchestrationResult(
    result: PlannerOrchestrationResult,
    currentCalculationContext: CalculationContext,
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<PlannerOrchestrationResultSaveOutcome> {
    const persistable = this.persistableResult(result)
    if (persistable === null) return { kind: 'no_plan' }
    return this.saveGuarded(persistable, currentCalculationContext, approval)
  }

  /**
   * Reads whether saving a Planner Alternative actual repair needs the
   * Plan-breaking approval (`docs/PLANNER_SPEC.md` 9.2.19.8 step 9 / 16.6) and
   * what the warning and the 16.10 save point choice must show. It writes
   * nothing, and refuses an artifact the save would refuse.
   */
  async inspectPlannerAlternativeRepairSave(
    artifact: PlannerAlternativeRepairArtifact,
    currentCalculationContext: CalculationContext,
  ): Promise<PlanBreakingChangeInspection> {
    const persistable = this.persistableRepair(artifact)
    return this.guard(currentCalculationContext).inspect(
      this.saveMutation(persistable, currentCalculationContext),
    )
  }

  /**
   * Saves one Planner Alternative actual repair (「この候補を優先」,
   * `docs/PLANNER_SPEC.md` 9.2.19.8 / 9.2.19.11, `docs/DATA_MODEL.md` 11.1.1)
   * in one transaction: every accepted replacement deletes its Target's `O` and
   * adds its generated `G` - whether or not the final Plan selects `G` - the
   * previous Draft is deleted, and the new Draft is added with
   * `conflictRepairLineage` set exactly to the artifact's lineage. The
   * in-transaction re-validation, the Plan-breaking guard and every failure are
   * those of `savePlannerOrchestrationResult()`: nothing is written on any
   * refusal, and an approval that restores the game save point writes the
   * restore alone and returns `save_point_restored_recalculation_required`
   * (no Entry, Draft or lineage of this artifact is saved).
   */
  async savePlannerAlternativeRepair(
    artifact: PlannerAlternativeRepairArtifact,
    currentCalculationContext: CalculationContext,
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<PlannerAlternativeRepairSaveOutcome> {
    return this.saveGuarded(this.persistableRepair(artifact), currentCalculationContext, approval)
  }

  /** The one guarded save both Planner result kinds go through. */
  private async saveGuarded(
    persistable: PersistablePlannerResult,
    currentCalculationContext: CalculationContext,
    approval: PlanBreakingChangeApproval | null,
  ): Promise<PlannerAlternativeRepairSaveOutcome> {
    const { plan } = persistable
    const guard = this.guard(currentCalculationContext)
    const mutation = this.saveMutation(persistable, currentCalculationContext)
    if (approval?.savePointDecision?.kind === 'restore_save_point') {
      // The restore makes this pre-restore result stale by construction: the
      // guard re-derives the approval and the 16.10 choice, restores, and
      // writes nothing of the result (`docs/PLANNER_SPEC.md` 9.2.18).
      const restore = await guard.restoreSavePointInsteadOfChange(mutation, approval)
      return {
        kind: 'save_point_restored_recalculation_required',
        restoredPlan: restore.plan,
        savePoint: restore.savePoint,
        deletedExecutionHistoryIds: restore.deletedExecutionHistoryIds,
      }
    }
    const outcome = await guard.apply(
      mutation,
      approval,
      {
        afterWrite: async () => {
          // A newly calculated Plan carries a fresh ID: an ID the collection
          // already holds - whatever that Plan's status, the previous Draft
          // included - is a different Plan and is refused here, inside the
          // transaction and before the Draft replacement, so a Draft holding
          // the same ID is never deleted and re-added under it.
          await this.repositories.productionPlans.assertProductionPlanIdFree(plan.id)
          // The new Draft replaces the previous one (DATA_MODEL 11.1): only
          // Draft records are deleted, their referenced Entries stay, and any
          // failure below rolls this deletion back with the rest of the
          // transaction - the Entry replacements and any Plan termination
          // included.
          await this.repositories.productionPlans.deleteDraftProductionPlans()
          await this.repositories.productionPlans.addProductionPlan(plan)
        },
      },
    )
    return { kind: 'saved', plan: outcome.result }
  }

  /**
   * The result-shape invariants that do not depend on current persisted state,
   * or `null` for a result with no Plan.
   */
  private persistableResult(result: PlannerOrchestrationResult): PersistablePlannerResult | null {
    const { plan } = result
    const generatedEntries = result.generatedBuildListEntries
    const replacements = result.generatedBuildListEntryReplacements

    if (plan === null) {
      // PLANNER_SPEC 9.2.14: no Plan means no adopted Entry and no
      // replacement. A non-empty list here breaks the orchestration invariant,
      // so nothing is written and no Entry is salvaged on its own.
      const replacementCount = Array.isArray(replacements) ? replacements.length : 0
      if (generatedEntries.length > 0 || replacementCount > 0) {
        throw resultInvalid(
          `The Planner returned no Plan but ${generatedEntries.length} generated BuildListEntries and ${replacementCount} BuildListEntry replacements. No Entry may be persisted without its Plan.`,
        )
      }
      return null
    }
    this.assertPersistableResultShape(plan, generatedEntries, result.termination, replacements)
    return { plan, generatedEntries, replacements, requireGeneratedEntriesSelected: true }
  }

  /** The artifact-shape invariants of a Planner Alternative repair; the Plan carries its lineage. */
  private persistableRepair(artifact: PlannerAlternativeRepairArtifact): PersistablePlannerResult {
    const checked = checkPersistablePlannerAlternativeRepairShape(artifact)
    if (checked.issue !== null) {
      throwIssue(checked.issue)
      throw resultInvalid('The Planner Alternative repair artifact is not persistable.')
    }
    return { ...checked.repair, requireGeneratedEntriesSelected: false }
  }

  private guard(currentCalculationContext: CalculationContext): PlanBreakingChangeGuard {
    return new PlanBreakingChangeGuard({
      database: this.database,
      currentCalculationContext,
      clock: this.clock,
    })
  }

  /**
   * The whole save as one pure guarded mutation: from the persisted state it
   * is given - the current one, or a restored one after 「最後のゲーム内セーブ
   * 地点へ戻す」 - it re-validates the Plan and returns the final Build List
   * (the replacement set) as the post-state the Plan-breaking guard judges.
   */
  private saveMutation(
    persistable: PersistablePlannerResult,
    currentCalculationContext: CalculationContext,
  ): PlanGuardedMutation<ProductionPlan> {
    return (base: PlanGuardedMutationBase) => {
      const { plan } = persistable
      const current = this.currentState(base)
      const finalEntries = this.assertCurrentStateMatchesPlan(
        persistable,
        current,
        currentCalculationContext,
      )
      this.assertPlanReferences(persistable, finalEntries)
      return {
        state: { ...unchangedMutableState(base), buildListEntries: finalEntries },
        result: plan,
      }
    }
  }

  /** Result-shape invariants that do not depend on current persisted state. */
  private assertPersistableResultShape(
    plan: ProductionPlan,
    generatedEntries: readonly BuildListEntry[],
    termination: PlannerRunTermination,
    replacements: readonly BuildListEntryReplacement[] | undefined,
  ): asserts replacements is readonly BuildListEntryReplacement[] {
    // PLANNER_SPEC 7.2.1 / 9.2.15 / 9.2.18, shared with the replan adoption
    // (16.8): an incomplete search, a non-draft Plan, duplicated generated
    // Entry IDs, malformed replacement metadata, or a Domain-invalid Plan /
    // Entry is never persisted. B8-D2a stores a freshly calculated Draft;
    // activation and the single-active-Plan constraint stay the existing
    // Application concerns.
    throwIssue(checkPersistablePlannerResultShape(plan, generatedEntries, termination, replacements))
  }

  private currentState(base: PlanGuardedMutationBase): PlannerSaveCurrentState {
    // Read inside the write transaction. A missing or invalid RngState fails
    // closed: save time never creates an initial state and never repairs one.
    const { rngState } = base
    if (rngState === null) {
      throw stateChanged(
        'No RngState is stored, so the Planner result cannot be validated against current state.',
      )
    }
    assertRepositoryValidation('RngState', validateRngState(rngState))
    return {
      rngState,
      normalCounters: base.normalCounters,
      ownedWeapons: base.ownedWeapons,
      targetWeapons: base.targetWeapons,
      buildListEntries: base.buildListEntries,
    }
  }

  /**
   * Compares current state against the Plan's own `PlanningInputSnapshot` with
   * the existing snapshot authorities only, and returns the final replacement
   * set the Plan was calculated over: the current Entries with each replaced
   * Entry removed and each generated Entry added.
   */
  private assertCurrentStateMatchesPlan(
    persistable: PersistablePlannerResult,
    current: PlannerSaveCurrentState,
    currentCalculationContext: CalculationContext,
  ): BuildListEntry[] {
    const { plan, generatedEntries, replacements } = persistable
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

    // A generated ID already persisted, or a Target whose persisted Entry is
    // no longer exactly the one the Planner replaced, refuses before anything
    // is compared further: nothing is deleted or overwritten on a guess.
    const finalBuildList = prepareFinalReplacementBuildList(
      [...current.buildListEntries],
      generatedEntries,
      replacements,
    )
    throwIssue(finalBuildList.issue)
    const finalEntries = finalBuildList.finalEntries as BuildListEntry[]

    // A freshly calculated Draft has no confirmed Step yet, so no observation
    // binding applies and the current state hashes with its real values.
    const currentExecutionState = createExpectedPlanState(
      current.rngState,
      [...current.normalCounters],
      [...current.ownedWeapons],
      {
        targetWeapons: [...current.targetWeapons],
        dependentTargetWeaponIds: collectProductionPlanDependentTargetWeaponIds(
          plan,
          finalEntries,
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
      createPlanningTargetWeaponsHash([...current.targetWeapons]) !==
      plan.baseSnapshot.targetWeaponsHash
    ) {
      throw stateChanged(
        'Current TargetWeapons differ from PlanningInputSnapshot.targetWeaponsHash.',
      )
    }

    if (
      createPlanningBuildListEntriesHash(finalEntries) !==
      plan.baseSnapshot.buildListEntriesHash
    ) {
      throw stateChanged(
        'The current BuildListEntry set with the generated replacements applied differs from PlanningInputSnapshot.buildListEntriesHash.',
      )
    }

    throwIssue(
      checkGeneratedBuildListEntriesFresh(generatedEntries, current, currentCalculationContext),
    )

    return finalEntries
  }

  /**
   * Every BuildListEntry the Plan references must exist in the final set; the
   * B8 orchestration result additionally selects every generated Entry.
   */
  private assertPlanReferences(
    persistable: PersistablePlannerResult,
    finalEntries: readonly BuildListEntry[],
  ) {
    const { plan, generatedEntries } = persistable
    throwIssue(
      persistable.requireGeneratedEntriesSelected
        ? checkProductionPlanBuildListReferences(plan, generatedEntries, finalEntries)
        : checkProductionPlanBuildListEntryReferences(plan, finalEntries),
    )
  }
}

export const plannerResultPersistenceService =
  new PlannerResultPersistenceService()
