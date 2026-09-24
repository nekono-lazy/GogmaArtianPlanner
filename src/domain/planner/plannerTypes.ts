import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  DomainValidationIssue,
  ISODateTimeString,
  NormalArtianCounter,
  OwnedWeapon,
  OwnedWeaponId,
  PlanConflict,
  PlanStepId,
  ProductionPlan,
  ProductionPlanId,
  RngState,
  RouteOperation,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import type {
  ArtianBonusTypeMapping,
  BonusRankMaster,
  BonusTypeMaster,
  ElementMaster,
  MaterialCostMaster,
  WeaponBonusDefinition,
  WeaponTypeMaster,
} from '../master/masterTypes'
import type { RngEngine } from '../rng/rngEngine'
import type { BuildListEntryReplacement } from '../buildList/buildListEntryReplacement'
import type { PlannerLaneProgress } from './plannerRouteLanes'
import type { PlannerSearchInstrumentation } from './plannerSearchInstrumentation'

export interface PlannerOptions {
  maxPlanSteps: number
  beamWidth: number
  maxExpandedStates: number
}

/**
 * The initial values of the three Beam Search bounds (PLANNER_SPEC 7.2).
 *
 * They are the *default* the Application caller starts from, not a floor or a
 * ceiling: the Build List detail settings let the user raise any of them for
 * one calculation. `PlannerInput.options` remains the single Beam Search bound
 * authority, and no Worker or Domain module substitutes these values for a
 * caller-supplied one.
 */
export const defaultPlannerOptions: Readonly<PlannerOptions> = {
  maxPlanSteps: 300,
  beamWidth: 50,
  maxExpandedStates: 10_000,
}

/** Which `PlannerOptions` bound the Beam Search touched. */
export type PlannerSearchLimitKind = 'max_expanded_states' | 'max_plan_steps'

export const plannerSearchLimitKinds: readonly PlannerSearchLimitKind[] = [
  'max_expanded_states',
  'max_plan_steps',
]

/**
 * - `completed`  every enabled Target reached Ideal
 * - `incomplete` a `PlannerOptions` bound truncated the search first
 * - `exhausted`  the search ended on its own without completing every Target
 * - `cancelled`  the user stopped the search
 */
export type PlannerSearchTerminationStatus =
  | 'completed'
  | 'incomplete'
  | 'exhausted'
  | 'cancelled'

/**
 * Typed Beam Search termination (PLANNER_SPEC 7.2.1).
 *
 * It is the UI, Application and Persistence control authority for whether a
 * calculation produced a usable Plan. `PlannerWarning` stays diagnostics: no
 * consumer may parse a warning message, and `reachedLimits` is not a copy of
 * the warning list either - a `completed` search can carry a reached bound, and
 * a run that never reached its Beam Search carries none.
 *
 * Every field is plain structured-clone data, so it crosses the Worker boundary
 * unchanged and is never rebuilt on the other side. It is runtime result
 * metadata only: it is never persisted in `ProductionPlan`, `PlanStep`,
 * `BuildListEntry`, or the DB schema.
 */
export interface PlannerSearchTermination {
  status: PlannerSearchTerminationStatus
  /** Empty unless a bound was touched; non-empty whenever `incomplete`. */
  reachedLimits: PlannerSearchLimitKind[]
  /** The `PlannerInput.options` this search actually ran with. */
  limits: PlannerOptions
  expandedStates: number
  completedTargetCount: number
  totalTargetCount: number
}

/** Carries no `LotteryMaster`: Planner calculation and Trace Replay never read one. */
export interface PlannerMasterSubset {
  /** Matches RngMasterSubset so trace replay can repeat Search predictions. */
  weaponBonusDefinitions: WeaponBonusDefinition[]
  materialCosts: MaterialCostMaster[]
  bonusRanks: BonusRankMaster[]
  /** Keep family resolution authority for Normal-side bonus types (`docs/RNG_SPEC.md` 6.1). */
  artianBonusTypeMappings: ArtianBonusTypeMapping[]
  /** Caller-supplied Production Gogma Reset availability inputs. */
  elements: ElementMaster[]
  /** Caller-supplied Production Gogma Reset availability inputs. */
  bonusTypes: BonusTypeMaster[]
  /** Caller-supplied Production Gogma Reset availability inputs. */
  weaponTypes: WeaponTypeMaster[]
}

/** A local choice for one stable conflict key, not a manual Plan order. */
export interface PlannerConflictResolution {
  conflictKey: string
  selectedBuildListEntryId: BuildListEntryId
}

/** Structured-clone input. Engine instances and runtime dependencies are excluded. */
export interface PlannerInput {
  rngState: RngState
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
  calculationContext: CalculationContext
  options: PlannerOptions
  master: PlannerMasterSubset
  conflictResolutions: PlannerConflictResolution[]
}

/** Current-state eligibility; the referenced input snapshot is never mutated. */
export interface ValidatedBuildListEntry {
  entry: BuildListEntry
  missingRngRequirements: string[]
}

export interface ExcludedBuildListEntry {
  entry: BuildListEntry
  reason: string
}

export interface TargetSatisfaction {
  targetWeaponId: TargetWeaponId
  hasPractical: boolean
  hasIdeal: boolean
  practicalOwnedWeaponIds: OwnedWeaponId[]
  idealOwnedWeaponIds: OwnedWeaponId[]
}

/** Beam-search form of Target satisfaction, indexed for direct lookup. */
export interface PlannerTargetSatisfaction {
  hasPractical: boolean
  hasIdeal: boolean
}

/** Immutable, branch-safe inventory used only by Planner calculations. */
export interface SimulatedInventory {
  ownedWeapons: OwnedWeapon[]
  consumedWeaponIds: OwnedWeaponId[]
  reservedWeaponIds: OwnedWeaponId[]
  createdWeaponIds: OwnedWeaponId[]
}

/**
 * How valuable selecting one BuildListEntry is in one state.
 *
 * There is no category term any more: every Candidate is a canonical Ideal
 * Candidate, so a per-Candidate category score would be a constant. Selected
 * compromise checkpoints are a hard constraint, never a score
 * (`docs/PLANNER_SPEC.md` 7.5.3).
 */
export interface CandidateScore {
  targetPriorityScore: number
  satisfactionScore: number
  distancePenalty: number
  conflictPenalty: number
  total: number
}

export interface PlannerSearchRngSnapshot {
  gogmaCounter: number | null
  skillCounter: number | null
  normalCounters: Array<{ id: string; counter: number | null }>
}

export interface PlannerSearchInventoryEffect {
  addedOwnedWeaponIds: OwnedWeaponId[]
  removedOwnedWeaponIds: OwnedWeaponId[]
  updatedOwnedWeaponIds: OwnedWeaponId[]
  reservedOwnedWeaponIds: OwnedWeaponId[]
  routeOutputChangedForEntryIds: BuildListEntryId[]
}

export interface PlannerSearchSatisfactionChange {
  targetWeaponId: TargetWeaponId
  before: PlannerTargetSatisfaction
  after: PlannerTargetSatisfaction
}

export interface PlannerSearchRoutePosition {
  operationIndex: number
  unitIndex: number
  unitCount: number
}

export interface PlannerSearchRouteAction {
  kind: 'route_operation'
  actionType: RouteOperation['type']
  primaryBuildListEntryId: BuildListEntryId
  progressedBuildListEntryIds: BuildListEntryId[]
  progressedRoutePositions: Record<string, PlannerSearchRoutePosition>
  routeOperation: RouteOperation
  ownedWeaponId: OwnedWeaponId | null
  plannerOnly: false
  rngBefore: PlannerSearchRngSnapshot
  rngAfter: PlannerSearchRngSnapshot
  inventoryEffect: PlannerSearchInventoryEffect
  satisfactionChanges: PlannerSearchSatisfactionChange[]
}

export interface PlannerSearchReserveAction {
  kind: 'reserve_candidate'
  actionType: 'reserve_weapon'
  primaryBuildListEntryId: BuildListEntryId
  progressedBuildListEntryIds: BuildListEntryId[]
  progressedRoutePositions: Record<string, PlannerSearchRoutePosition>
  routeOperation: null
  ownedWeaponId: OwnedWeaponId
  plannerOnly: true
  rngBefore: PlannerSearchRngSnapshot
  rngAfter: PlannerSearchRngSnapshot
  inventoryEffect: PlannerSearchInventoryEffect
  satisfactionChanges: PlannerSearchSatisfactionChange[]
}

export type PlannerSearchAction =
  | PlannerSearchRouteAction
  | PlannerSearchReserveAction

export interface PlannerRouteRuntimeState {
  hasUnregisteredGogmaOutput: boolean
  transientRestorationBonusScope: 'normal_artian' | 'gogma_artian' | null
}

/** Immutable Beam Search state. Trace actions are not RouteOperations or PlanSteps. */
export interface PlannerSearchState {
  currentRngState: RngState
  currentNormalCounters: NormalArtianCounter[]
  simulatedInventory: SimulatedInventory
  targetSatisfaction: Record<TargetWeaponId, PlannerTargetSatisfaction>
  selectedBuildListEntryIds: BuildListEntryId[]
  /**
   * Units executed or silently passed per lane of each Entry's Route
   * (`docs/PLANNER_SPEC.md` 7.0.4). The base lane runs first; the Bonus and
   * Skill lanes advance independently, so the same Route can be executed in
   * many interleavings.
   */
  routeProgressByEntryId: Record<string, PlannerLaneProgress>
  routeRuntimeByEntryId: Record<string, PlannerRouteRuntimeState>
  /** Incremented whenever an existing Gogma's physical state is changed in-flight. */
  sourceMutationVersionByOwnedWeaponId: Record<string, number>
  /** Existing-source Candidate snapshots are reservable only at this recorded version. */
  candidateReadySourceVersionByEntryId: Record<string, number>
  /** The existing-source version each Route is currently allowed to continue from. */
  routeSourceVersionByEntryId: Record<string, number>
  /** Existing sources are excluded from satisfaction until a Candidate result is reserved. */
  inFlightExistingSourceByOwnedWeaponId: Record<string, true>
  securedOwnedWeaponIdByEntryId: Record<string, OwnedWeaponId>
  /**
   * Which Entries' compromise checkpoints this branch has actually reached:
   * the moment both lanes held their pinned state at once.
   *
   * A hard constraint's progress record, not a score: a branch may only secure
   * an Entry's Candidate once the checkpoint the user selected for it has
   * really been reached (`docs/PLANNER_SPEC.md` 7.5.3).
   */
  reachedCheckpointByEntryId: Record<string, true>
  trace: PlannerSearchAction[]
  /**
   * How many times the player has to put one weapon down and pick another one
   * up while executing this branch's operations so far.
   *
   * Plan quality only, never correctness: a branch with more switches is still
   * a fully executable Plan, so this must not prune, block, or reject an
   * expansion (`docs/PLANNER_SPEC.md` 7.3).
   */
  weaponSwitchCount: number
  /**
   * How much of this branch's progress has been made on Routes that start from
   * their Target's preferred owned weapon.
   *
   * Plan preference only, never correctness or feasibility: it sits below every
   * existing evaluation term and above `weaponSwitchCount` in
   * `comparePlannerSearchStates()`, so it decides nothing except which of two
   * otherwise equally rated branches survives (`docs/PLANNER_SPEC.md` 7.4).
   */
  preferredSourceProgressCount: number
  /**
   * How many stream-lane operations this branch executed against an Entry's
   * improvement preference: a Bonus amendment while a `skill_first` Entry
   * still had Skill lane units left, or the mirror image, counted only once
   * that Entry's compromise checkpoint was reached (or from the start when it
   * selected none).
   *
   * Plan preference only, never correctness or feasibility: it sits below the
   * preferred-source preference and above `weaponSwitchCount` in
   * `comparePlannerSearchStates()` (`docs/PLANNER_SPEC.md` 7.6).
   */
  improvementPreferenceViolationCount: number
  /**
   * The weapon subject of the most recent switch-counted operation, or `null`
   * before the branch has run one. Operations with no continuously operated
   * subject - `reserve_weapon` above all - leave it untouched, so they never
   * split one weapon's run of operations in two.
   */
  lastWeaponOperationSubjectKey: string | null
  totalCost: number
  evaluationScore: number
}

export type PlannerSearchRejectionReason =
  | 'counter_before_current'
  | 'counter_after_mismatch'
  | 'counter_unavailable'
  | 'inventory_precondition_failed'
  | 'protected_destructive_use'
  | 'conflict_resolution_not_selected'
  | 'candidate_already_satisfied'
  | 'rng_contract_unavailable'
  /**
   * The compromise checkpoint the user selected for this BuildListEntry was
   * not reached: its Candidate may not be secured yet, and a lane may not run
   * past its pinned state before the other lane arrived (PLANNER_SPEC 7.5.3).
   */
  | 'selected_checkpoint_not_reached'
  /**
   * The deterministic scheduler did not commit this BuildListEntry, or dropped
   * it from its commitment, because of a resource conflict it had to settle
   * without an explicit `PlannerConflictResolution`: the provisional outcome of
   * an unresolved conflict, or a deadlock / stall
   * (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 6.5 / 7.8 / 8.4).
   * Runtime-only; the Beam Search never produces it, and the persisted
   * `RejectedBuildListEntry` reports it as `resource_conflict`.
   */
  | 'conflict_not_committed'

export interface PlannerSearchRejection {
  buildListEntryId: BuildListEntryId
  actionType: RouteOperation['type'] | 'reserve_weapon'
  reason: PlannerSearchRejectionReason
  detail: string
}

export interface PlannerBeamSearchResult {
  bestState: PlannerSearchState | null
  conflicts: PlanConflict[]
  warnings: PlannerWarning[]
  validationIssues: DomainValidationIssue[]
  excludedBuildListEntries: ExcludedBuildListEntry[]
  rejections: PlannerSearchRejection[]
  expandedStates: number
  completed: boolean
  cancelled: boolean
  /**
   * The typed termination of this search (PLANNER_SPEC 7.2.1).
   *
   * `completed`, `cancelled` and `expandedStates` above keep their existing
   * meaning for the Domain consumers that already read them; `termination` is
   * the authority everything outside the Domain reads, because it also carries
   * which bound was touched, the bounds this run used, and how many Targets
   * were completed.
   */
  termination: PlannerSearchTermination
}

export type PlannerWarningKind =
  | 'no_build_list_entries'
  | 'rng_state_missing'
  | 'rng_prediction_unsupported'
  | 'protected_weapon_required'
  | 'build_list_entry_stale'
  | 'calculation_context_incompatible'
  | 'all_targets_already_satisfied'
  | 'invalid_conflict_resolution'
  | 'max_steps_reached'
  | 'max_expanded_states_reached'
  /**
   * B8 constrained-search orchestration only (PLANNER_SPEC 9.2.16). The four
   * kinds below report an orchestration or enumeration stop, never silent
   * exhaustion, and the ordinary `createProductionPlan()` path never produces
   * them. They are deliberately separate from `max_steps_reached` /
   * `max_expanded_states_reached`, which report the two `PlannerOptions`
   * bounds of a single Beam Search and mean something else entirely.
   */
  | 'max_candidate_trials_per_conflict_reached'
  | 'max_generated_build_list_entries_reached'
  /**
   * B8 constrained-search orchestration only (PLANNER_SPEC 9.5.2): a
   * conflict participant Target was not re-searched because its BuildListEntry
   * carries a selected compromise checkpoint that an alternate Route would drop.
   */
  | 'selected_checkpoint_blocks_constrained_search'
  /**
   * Planner input fail-closed reasons for selected checkpoints
   * (PLANNER_SPEC 7.5.6 / 7.5.7 / 7.5.8). The first two accompany a validation
   * issue, so the Build List can say why no Plan was calculated; the third is
   * informational: another Entry of a Target with a required checkpoint Entry
   * was left out of this run's candidate selection.
   */
  | 'multiple_selected_checkpoint_entries'
  | 'selected_checkpoint_target_already_ideal'
  | 'selected_checkpoint_fixes_target_entry'
  /**
   * A BuildListEntry's `intermediateStateSelection` is structurally invalid
   * (unknown id, an id of the other lane, unknown preference). The Planner input
   * fails closed with a validation issue; the selection is never read as
   * empty (PLANNER_SPEC 7.5.9).
   */
  | 'invalid_checkpoint_selection'
  /**
   * A planning Target holds two or more BuildListEntries in an ordinary
   * persisted Planner input - a legacy duplicate of the Build List cardinality
   * contract (`docs/DATA_MODEL.md` 9.4.1, `docs/PLANNER_SPEC.md` 4.1). The whole
   * input fails closed with a validation issue: the Planner never picks one
   * Entry by Route length, `createdAt`, staleness or ID.
   */
  | 'duplicate_build_list_entries_for_target'
  /**
   * A BuildListEntry of a `completed` Target was left out of Planner input.
   * The Entry is not stale and needs no re-search: its Target already has its
   * Ideal weapon (`docs/DATA_MODEL.md` 8.1).
   */
  | 'completed_target_excluded'
  | 'max_planner_reruns_reached'
  | 'constrained_enumeration_bound_reached'

export const plannerWarningKinds: readonly PlannerWarningKind[] = [
  'no_build_list_entries',
  'rng_state_missing',
  'rng_prediction_unsupported',
  'protected_weapon_required',
  'build_list_entry_stale',
  'calculation_context_incompatible',
  'all_targets_already_satisfied',
  'invalid_conflict_resolution',
  'max_steps_reached',
  'max_expanded_states_reached',
  'max_candidate_trials_per_conflict_reached',
  'max_generated_build_list_entries_reached',
  'max_planner_reruns_reached',
  'constrained_enumeration_bound_reached',
  'selected_checkpoint_blocks_constrained_search',
  'multiple_selected_checkpoint_entries',
  'selected_checkpoint_target_already_ideal',
  'selected_checkpoint_fixes_target_entry',
  'invalid_checkpoint_selection',
  'duplicate_build_list_entries_for_target',
  'completed_target_excluded',
]

export interface PlannerWarning {
  kind: PlannerWarningKind
  message: string
}

export interface PlannerResult {
  plan: ProductionPlan | null
  conflicts: PlanConflict[]
  warnings: PlannerWarning[]
  /**
   * How the Beam Search behind this result ended (PLANNER_SPEC 7.2.1).
   *
   * `plan` alone cannot answer that: a `plan` calculated from a truncated
   * search is a partial Beam Search artifact, not a finished production plan,
   * and Persistence and UI must be able to tell the two apart without reading
   * a warning message. When several full Beam Searches ran - a
   * runtime-unsupported retry, or a B8 Candidate trial - this is the one whose
   * result was actually used.
   */
  termination: PlannerSearchTermination
}

export interface PlannerIdFactory {
  productionPlanId(): ProductionPlanId
  planStepId(): PlanStepId
  ownedWeaponId(): OwnedWeaponId
}

export interface PlannerClock {
  now(): ISODateTimeString
}

/** Runtime-only dependencies. This type is never part of PlannerInput or persistence. */
export interface PlannerDependencies {
  rngEngine: RngEngine
  idFactory: PlannerIdFactory
  clock: PlannerClock
}

export interface PlannerProgress {
  expandedStates: number
  maxExpandedStates: number
}

/**
 * Which Build List cardinality contract one Planner input carries
 * (`docs/DATA_MODEL.md` 9.4.1, `docs/PLANNER_SPEC.md` 4.1 / 9.2.18).
 *
 * - `persisted`: an ordinary Planner input built from the persisted Build
 *   List - the Planner run, the replan Preview, the B10 interaction and the
 *   original input of a B8 / what-if request. At most one BuildListEntry per
 *   planning Target; a legacy duplicate fails the whole input closed.
 * - `temporary_augmented`: the preflight input of a B8 constrained re-search
 *   or what-if trial. Each Target of `replacements` holds exactly its persisted
 *   Entry `O` and its temporary Entry `G` (persisted 0..1 + temporary 0..1);
 *   every other Target follows the persisted contract. `O` is there only so
 *   that the user's fixed constraints are re-associated against the conflicts
 *   it takes part in. It is never a Beam Search input: `O` is no execution
 *   candidate of its Target, so the type of every full Planner run excludes it.
 * - `temporary_replacement`: the **replacement set** of that trial - every `O`
 *   removed, every `G` in its place. Every full Planner run of a trial (Beam
 *   Search, Trace Replay, PlanConflict, rejections, PlanningInputSnapshot)
 *   runs over it, so a Plan never records an Entry the adoption deletes.
 *
 * Which Entry is temporary is named only by `replacements`, runtime-only
 * metadata the constrained Domain orchestration creates. It is a Domain
 * calling-context parameter, never a `PlannerInput` field, never a
 * `BuildListEntry` field, never a Worker request field, and never persisted.
 */
export type PlannerBuildListContext =
  | { kind: 'persisted' }
  | {
      kind: 'temporary_augmented'
      replacements: readonly BuildListEntryReplacement[]
    }
  | {
      kind: 'temporary_replacement'
      replacements: readonly BuildListEntryReplacement[]
    }

/** The contexts a full Planner run (Beam Search, Production Plan generation) accepts. */
export type PlannerRunBuildListContext = Exclude<
  PlannerBuildListContext,
  { kind: 'temporary_augmented' }
>

/** The ordinary persisted Build List contract, the default of every Planner entry point. */
export const PERSISTED_PLANNER_BUILD_LIST_CONTEXT: { readonly kind: 'persisted' } = Object.freeze({
  kind: 'persisted' as const,
})

export interface PlannerExecutionOptions {
  shouldCancel?: () => boolean
  onProgress?: (progress: PlannerProgress) => void
  yieldControl?: () => Promise<void>
  /**
   * Benchmark / test-only observation of each Beam Search (Issue #103). It is
   * semantics-neutral, `undefined` runs exactly the previous search, and no
   * Worker protocol, `PlannerResult`, or persistence carries it
   * (`plannerSearchInstrumentation.ts`).
   */
  searchInstrumentation?: PlannerSearchInstrumentation
}

export type CreateProductionPlanCalculation = (
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options?: PlannerExecutionOptions,
) => Promise<PlannerResult>

/**
 * Runtime-only observation of Production Plan generation (PLANNER_SPEC 9.2.16).
 *
 * `beforeBeamSearch()` is called exactly once immediately before each full
 * `runPlannerBeamSearch()` execution that actually starts, including the first
 * one and every runtime-unsupported retry. B8 orchestration counts those calls
 * against `maxPlannerReruns`; the initial conflict preflight runs no Beam
 * Search and therefore never reaches this observer.
 *
 * It is semantics-neutral: it must not change Plan generation behaviour. A
 * throw from it propagates unchanged to the caller and is never converted into
 * a `PlannerResult`. Like `PlannerDependencies`, it carries functions and is
 * therefore never part of `PlannerInput`, a Worker DTO, or persistence.
 */
export interface ProductionPlanGenerationObserver {
  beforeBeamSearch(): void
  /**
   * Called exactly once immediately after each full `runPlannerBeamSearch()`
   * execution returns, before Trace Replay inspects its result.
   *
   * It is pure observation: nothing in Plan generation branches on it, and it
   * cannot change which Beam Search runs next. B8 orchestration uses it so
   * that, when a runtime-unsupported retry is refused by the
   * `maxPlannerReruns` budget, it can still report the last completed Beam
   * Search's conflicts and warnings with `plan: null` instead of assembling a
   * ProductionPlan from a Beam whose Trace Replay never succeeded.
   */
  afterBeamSearch?(result: PlannerBeamSearchResult): void
}

export type PlannerWorkerRequest =
  | {
      type: 'create_plan'
      requestId: string
      input: PlannerInput
    }
  | {
      type: 'cancel'
      requestId: string
    }

export type PlannerWorkerResponse =
  | {
      type: 'create_plan_result'
      requestId: string
      result: PlannerResult
    }
  | {
      type: 'progress'
      requestId: string
      progress: PlannerProgress
    }
  | {
      type: 'error'
      requestId: string
      message: string
    }
