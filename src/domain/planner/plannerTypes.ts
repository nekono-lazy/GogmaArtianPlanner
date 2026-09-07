import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  CandidateCategory,
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

export const defaultPlannerOptions: Readonly<PlannerOptions> = {
  maxPlanSteps: 300,
  beamWidth: 50,
  maxExpandedStates: 10_000,
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

/**
 * A Planner-created need for a consumable Gogma weapon. It deliberately carries
 * no guessed weapon type, element, bonus, or material-cost constraint.
 */
export interface PlannerMaterialRequirement {
  id: string
  sourceBuildListEntryId: BuildListEntryId | null
  purpose: 'gogma_rng_progression'
}

export interface PlannerMaterialAssignment {
  requirementId: string
  ownedWeaponId: OwnedWeaponId
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

export interface CandidateScore {
  targetPriorityScore: number
  satisfactionScore: number
  categoryScore: number
  distancePenalty: number
  resourcePenalty: number
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
  candidateCategory: CandidateCategory
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
  /** Targets initially lacking a Practical weapon that this branch has started to secure. */
  practicalFirstProgressTargetIds: TargetWeaponId[]
  trace: PlannerSearchAction[]
  consumedMaterialWeaponCount: number
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
}

export type PlannerWarningKind =
  | 'no_build_list_entries'
  | 'rng_state_missing'
  | 'rng_prediction_unsupported'
  | 'material_weapon_shortage'
  | 'protected_weapon_required'
  | 'build_list_entry_stale'
  | 'calculation_context_incompatible'
  | 'all_targets_already_satisfied'
  | 'invalid_conflict_resolution'
  | 'max_steps_reached'
  | 'max_expanded_states_reached'

export const plannerWarningKinds: readonly PlannerWarningKind[] = [
  'no_build_list_entries',
  'rng_state_missing',
  'rng_prediction_unsupported',
  'material_weapon_shortage',
  'protected_weapon_required',
  'build_list_entry_stale',
  'calculation_context_incompatible',
  'all_targets_already_satisfied',
  'invalid_conflict_resolution',
  'max_steps_reached',
  'max_expanded_states_reached',
]

export interface PlannerWarning {
  kind: PlannerWarningKind
  message: string
}

export interface PlannerResult {
  plan: ProductionPlan | null
  conflicts: PlanConflict[]
  warnings: PlannerWarning[]
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
