/**
 * Issue #154 Global Assignment Phase D-0A (Research only; never imported by the app).
 *
 * Plain-data types of the materialization of one `StructuralCandidate` through the existing Production
 * Search APIs (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.5 / 9.0 - 9.8). The names follow the design's
 * proposals; where this file departs from their spelling (a discriminated request per method, a structured
 * `closestMismatch`, a per-Target attempt list) the meaning of design 4.5 / 9.6 is unchanged.
 *
 * Nothing here is a Plan, a Planner verification or a persisted value. A materialized Entry is a
 * speculative Research Entry derived from a structural candidate (G1): it is never a user-fixed Route,
 * a `PlannerConflictResolution`, a repair lineage decision or a Build List write.
 *
 * Phase D-0B added the Search-policy shape (`SearchPolicyShape`, design 19.3 G1) with its own
 * `not_executed(search_policy_shape)` outcome, and the execution-only `MaterializationObserver`.
 *
 * Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 10 / 11) added the method `shape_constrained` of the
 * rule `d0a2-v2` (`shapeMaterializationTypes.ts`): its outcomes, attempt, method selection, stage end and fail-closed
 * codes join the unions below. The rule `d0a-v1` never produces any of them, so its values are unchanged.
 *
 * Issue #260 PR-3: the types the rule `d0a2-v2` shares with the Build List global optimization (the projected Candidate Search's
 * request, scale and attempt, the shape match, the continuation shapes and the fail-closed error) moved to the Production Domain
 * (`src/domain/planner/buildListOptimization/routeGenerationTypes.ts`) and are re-exported here under their Research names. The rule
 * `d0a-v1`'s own types (Planner Alternative Search) stay here.
 */
import type { BuildListEntry, BuildListEntryId, TargetWeaponId } from '../../domain/models/publicTypes'
import type {
  BuildListOptimizationMaterializationErrorCode, PredictedSearchScale, ProjectedAttempt, ProjectedRouteRequest, RouteContinuationShape,
  RouteGenerationMethod, RouteSearchInstrumentation, SearchScaleDetail, SearchScaleGate, ShapeMatchResult, ShapeMismatch,
} from '../../domain/planner/buildListOptimization'
import type { PlannerAlternativeReservation, PlannerAlternativeSearchExtent } from '../../domain/search/alternative'
import type { RequiredPositions } from './assignmentTypes'
import type { ExpectedRouteShape } from './coverageTypes'
import type { ShapeConstrainedAttempt, ShapeConstrainedOutcome, ShapeMethodSelection } from './shapeMaterializationTypes'

export {
  BuildListOptimizationMaterializationError as GlobalAssignmentMaterializationError,
  type ConversionSkillContinuationShape,
  type OwnedGogmaBonusContinuation,
  type OwnedGogmaContinuationShape,
  type PredictedSearchScale,
  type ProjectedAttempt,
  type ProjectedAttemptResult,
  type ProjectedRouteRequest as ProjectedMaterializationRequest,
  type ProjectedSearchOrigin,
  type SearchScaleDetail,
  type SearchScaleGate,
  type ShapeMatchResult,
  type ShapeMismatch,
  type ShapeMismatchReason,
} from '../../domain/planner/buildListOptimization'

/** Design 4.5 / 9.1 / 9.2, and the D-0A-2b shape-constrained method (design D0A2 5). */
export type MaterializationMethod = 'planner_alternative_reservation' | RouteGenerationMethod

/** Design 4.5 / 9.1: a Planner Alternative Search under the formal reservation of the Entries materialized so far. */
export interface PlannerAlternativeMaterializationRequest {
  method: 'planner_alternative_reservation'
  targetWeaponId: TargetWeaponId
  shape: ExpectedRouteShape
  predictedSearchScale: PredictedSearchScale
  scaleDetail: SearchScaleDetail
  /**
   * `emptyPlannerAlternativeReservation` when no Entry precedes, otherwise exactly
   * `derivePlannerAlternativeReservation(materialized Entries)`. Never edited to steer the shape.
   */
  reservation: PlannerAlternativeReservation
  /** The Entries the reservation was derived from, in materialization order (empty: the empty reservation). */
  reservationSourceEntryIds: BuildListEntryId[]
  /** Design 9.1 `extentFor(shape)` from the Planner-start origin. */
  extent: PlannerAlternativeSearchExtent
  /** Always empty (design 9.1). */
  excludedRouteKeys: []
  /** The Research search identity (design 9.4): the Production Planner Alternative identity plus the algorithm token. */
  searchIdentity: string
}

export type MaterializationRequest = PlannerAlternativeMaterializationRequest | ProjectedRouteRequest

/**
 * Design 19.3 G1 (Phase D-0B) and A-2 G2: an expected shape the Production Search policy never returns, decided from the ReachTable
 * alone before any Search (`searchPolicyShapeOf()`): the lane-start Ideal Skill continuation of a conversion, and the owned-Gogma
 * current-Ideal lane continuation. The Route is legal in the game and representable in the Domain: this is a Search policy, never a
 * mismatch, an extent or delivery stop, a gate, a missing window or "no Route". `not_executed(search_policy_shape)` under `d0a-v1`,
 * a continuation shape under `d0a2-v2` (the Production continuation shapes).
 */
export type SearchPolicyShape = RouteContinuationShape

/**
 * Design 4.5 / 9.6. Only `shape_mismatch` is "a Search ran to its explicit end without the shape"; every
 * other non-`materialized` value is "not confirmed", "not executed" or "not measured" and never evidence
 * that no such Route exists.
 *
 * `unmeasured`: D-0A observes only `cancelled` (the Search rejected with `CandidateSearchError('cancelled')`).
 * `timeout`, `out_of_memory` and `process_failure` are process-level and assigned only by the D-0B runner
 * that owns the process; D-0A never infers them.
 */
export type MaterializationOutcome =
  /**
   * `entry` passed `validateBuildListEntry()` and matched its shape; `plannerRequired` is re-derived from it.
   * `deliveredBeforeMatch`: Candidates delivered before the matching one (0 when the first one matched; always
   * 0 for design 9.2, whose Search returns one canonical Ideal).
   */
  | { kind: 'materialized'; method: MaterializationMethod; entry: BuildListEntry; plannerRequired: RequiredPositions; deliveredBeforeMatch: number }
  /** `summary.exhausted = true` and no delivered Candidate matched: the one executed-and-mismatched fact. */
  | { kind: 'shape_mismatch'; delivered: number; closestMismatch: ShapeMismatch | null }
  /**
   * `stopped_by_extent`: `summary.stoppedByExtent = true` without a match, even when every expected required
   * position lies inside the extent. `delivery_cap_reached`: the consumer stop at the delivery cap.
   */
  | { kind: 'unconfirmed'; reason: 'stopped_by_extent' | 'delivery_cap_reached'; delivered: number; closestMismatch: ShapeMismatch | null }
  /** The Search scale gate refused the request; no Search API was called. */
  | { kind: 'not_executed'; reason: 'search_scale_gate'; predictedSearchScale: PredictedSearchScale; exceeded: (keyof PredictedSearchScale)[] }
  /**
   * Phase D-0B (design 19.3 G1 / 10.3): the shape is one the Production Search policy never returns, so no request
   * was built and no Search API was called (only with `MaterializationInputs.searchPolicyPrecheck`). Not executed
   * because of a Search policy: neither a window, a delivery cap, a gate nor an envelope question.
   */
  | { kind: 'not_executed'; reason: 'search_policy_shape'; policyShape: SearchPolicyShape }
  | { kind: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure' | 'cancelled' }
  /**
   * D-0A-2b (rule `d0a2-v2`): the shape-constrained method's own ends - its budget stop, its gate (told apart from the
   * D-0A gate by `method`), and a needed prediction or capability the Engine does not offer (design D0A2 10.1).
   */
  | Exclude<ShapeConstrainedOutcome, { kind: 'materialized' | 'unmeasured' }>

/**
 * What one executed Planner Alternative Search reported (D-0B compares it with the prediction). The
 * instrumentation counters come from the Search's execution-only observer, which changes no Candidate,
 * order or termination.
 */
export interface ObservedPlannerAlternativeSearch {
  deliveredCandidates: number
  exhausted: boolean
  stoppedByExtent: boolean
  stoppedByConsumer: boolean
  /** Distinct conversion Skill positions of the delivered Candidates, ascending. */
  deliveredConversionSkillPositions: number[]
  instrumentation: RouteSearchInstrumentation
}

export interface PlannerAlternativeAttempt {
  method: 'planner_alternative_reservation'
  request: PlannerAlternativeMaterializationRequest
  outcome: MaterializationOutcome
  /** Null when the Search did not run (gate) or did not finish (cancel). */
  observed: ObservedPlannerAlternativeSearch | null
}

export type MaterializationAttempt = PlannerAlternativeAttempt | ProjectedAttempt | ShapeConstrainedAttempt

/** Design 9.3: the deterministic rule that ordered the methods of one Target. */
export type MethodSelectionRule =
  /** The shape crosses held positions in some stream: design 9.1 only. */
  | 'non_continuous_planner_alternative_only'
  /** Continuous conversion Target: design 9.2 first, design 9.1 once when it does not match. */
  | 'continuous_conversion_projected_first'
  /** Continuous owned Gogma whose projected scale is no larger: design 9.2 first, design 9.1 once when it does not match. */
  | 'continuous_owned_gogma_projected_first'
  /** Continuous owned Gogma whose design 9.1 scale is smaller: design 9.1 first, design 9.2 once after a `shape_mismatch` only. */
  | 'continuous_owned_gogma_planner_alternative_first'

export interface MethodSelection {
  /** Every stream's own positions of the shape (required and predicted chain) form one run without a held gap. */
  continuous: boolean
  rule: MethodSelectionRule
  /** The planned order; the second method runs only under the rule's fallback condition. */
  order: MaterializationMethod[]
  predictedSearchScale: { plannerAlternative: PredictedSearchScale; projected: PredictedSearchScale | null }
}

/** One Target's materialization: the method selection, every attempt in execution order, and the Target outcome. */
export interface TargetMaterializationRecord {
  targetWeaponId: TargetWeaponId
  /** 0-based position in the structural candidate's materialization order. */
  orderIndex: number
  /**
   * Null when no request was built: the run was cancelled before this Target, or (Phase D-0B, with
   * `searchPolicyPrecheck`) the shape was classified `not_executed(search_policy_shape)` before any Search.
   * The rule `d0a2-v2` records its own `ShapeMethodSelection`.
   */
  selection: MethodSelection | ShapeMethodSelection | null
  attempts: MaterializationAttempt[]
  /** Design 9.2 / 9.3: decided by design 9.1, or `materialized` by the method that matched. */
  outcome: MaterializationOutcome
}

/** The materialization stage of one structural candidate (design 4.6 `CandidateOutcome`, before Phase D'). */
export type MaterializationStageOutcome =
  /** Every planning Target has a matching Entry. Not verified: the Planner has not run (Phase D'). */
  | { kind: 'all_materialized' }
  /** The first unresolved Target's design 9.1 Search was exhausted without the shape. */
  | { kind: 'materialization_failed'; targetWeaponId: TargetWeaponId; outcome: Extract<MaterializationOutcome, { kind: 'shape_mismatch' }> }
  /** The first unresolved Target was not confirmed, not executed or not measured: never "no Route". */
  | { kind: 'materialization_unconfirmed'; targetWeaponId: TargetWeaponId; outcome: Extract<MaterializationOutcome, { kind: 'unconfirmed' | 'not_executed' | 'unmeasured' }> }
  /** D-0A-2b: the first unresolved Target needs a prediction or capability the Engine does not offer (never "no Route"). */
  | { kind: 'materialization_unsupported'; targetWeaponId: TargetWeaponId; outcome: Extract<MaterializationOutcome, { kind: 'unsupported' }> }

export interface StructuralCandidateMaterialization {
  kind: 'materialization'
  /** The structural candidate's ordinal (diagnostics only, never an identity). */
  candidateOrdinal: number
  objective: number
  materializationOrder: TargetWeaponId[]
  /** One record per attempted Target, in materialization order, up to and including the first unresolved one. */
  targets: TargetMaterializationRecord[]
  /** The materialized Entries in order: the only reservation source of every later Target. */
  materializedEntries: BuildListEntry[]
  materializedTargetCount: number
  outcome: MaterializationStageOutcome
  /** Targets after the first unresolved one, never attempted (not "failed"). */
  notAttemptedTargetWeaponIds: TargetWeaponId[]
}

export type MaterializationInputIssue =
  /** `deliveryCap` is not a positive safe integer, or a gate value is not a non-negative safe integer. */
  | 'invalid_settings'
  /** The ReachTable is not the context's (planning Targets, order, origins). */
  | 'context_mismatch'
  /** The value is not a structural candidate built by Phase C from its assignment (order, dependencies, shapes, coverage). */
  | 'structural_candidate_mismatch'

export type StructuralCandidateMaterializationResult =
  | StructuralCandidateMaterialization
  | { kind: 'invalid_input'; reason: MaterializationInputIssue; detail: string }

export interface MaterializationSettings {
  /** Design 10.4: Candidates one Planner Alternative materialization receives at most (positive safe integer). */
  deliveryCap: number
  searchScaleGate: SearchScaleGate
}

/** One Candidate a Search returned to the materialization and its match verdict (Phase D-0B diagnostics). */
export interface CandidateInspection {
  targetWeaponId: TargetWeaponId
  method: MaterializationMethod
  /** 1-based delivery index of the Planner Alternative Search (always 1 for the projected canonical Ideal). */
  deliveredIndex: number
  match: ShapeMatchResult
}

/**
 * Execution-only observers of one materialization (Phase D-0B runner progress and diagnostics). They receive
 * copies, are called synchronously, and change no request, Search input, Candidate, match, outcome or order:
 * a run with and without them returns the same result.
 */
export interface MaterializationObserver {
  /** A Target's materialization begins (before its cancellation check and its requests). */
  onTargetStarted?: (event: { targetWeaponId: TargetWeaponId; orderIndex: number }) => void
  /** Every Candidate a Search delivered (design 9.1) or returned (design 9.2), after its match. */
  onCandidateInspected?: (inspection: CandidateInspection) => void
  /** A Target's record once its outcome is decided. */
  onTargetSettled?: (record: TargetMaterializationRecord) => void
}

/**
 * The fail-closed codes of the materialization (design 9.4): the Production route generation's codes plus the two of the
 * Research's own request re-derivation and Planner Alternative Search (`d0a-v1`).
 */
export type MaterializationFailClosedCode =
  | BuildListOptimizationMaterializationErrorCode
  /** A request differs from its re-derivation (reservation, extent, projection, identity or predicted scale). */
  | 'request_mismatch'
  /** The Search's completion report has neither `exhausted`, `stoppedByExtent` nor a consumer stop. */
  | 'search_contract_violation'
