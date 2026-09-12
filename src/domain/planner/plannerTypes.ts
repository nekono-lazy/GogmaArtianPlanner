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
  BonusRankMaster,
  BonusTypeMaster,
  ElementMaster,
  LotteryMaster,
  MaterialCostMaster,
  WeaponBonusDefinition,
  WeaponTypeMaster,
} from '../master/masterTypes'
import type { RngEngine } from '../rng/rngEngine'

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

export interface PlannerMasterSubset {
  /** Matches RngMasterSubset so trace replay can repeat Search predictions. */
  weaponBonusDefinitions: WeaponBonusDefinition[]
  lotteries: LotteryMaster[]
  materialCosts: MaterialCostMaster[]
  bonusRanks: BonusRankMaster[]
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
  routeProgressByEntryId: Record<string, number>
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
   * Which selected compromise checkpoints this branch has actually reached, as
   * `entryId -> reached checkpoint opportunity ids`.
   *
   * A hard constraint's progress record, not a score: a branch may only secure
   * an Entry's Candidate once every checkpoint the user selected for it has
   * really been reached (`docs/PLANNER_SPEC.md` 7.5.3).
   */
  reachedCheckpointOpportunityIdsByEntryId: Record<string, string[]>
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
   * A compromise checkpoint the user selected for this BuildListEntry was not
   * reached, so its Candidate may not be secured (PLANNER_SPEC 7.5.3).
   */
  | 'selected_checkpoint_not_reached'

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

export interface PlannerExecutionOptions {
  shouldCancel?: () => boolean
  onProgress?: (progress: PlannerProgress) => void
  yieldControl?: () => Promise<void>
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
