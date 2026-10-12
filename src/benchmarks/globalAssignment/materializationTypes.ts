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
 */
import type {
  BuildListEntry, BuildListEntryId, OwnedWeaponId, RouteKind, TargetWeaponId,
} from '../../domain/models/publicTypes'
import type { PlannerAlternativeReservation, PlannerAlternativeSearchExtent } from '../../domain/search/alternative'
import type { CandidateRouteFilter, CandidateSearchSettings } from '../../domain/search/searchTypes'
import type { RequiredPositions } from './assignmentTypes'
import type { ExpectedRouteShape } from './coverageTypes'
import type { InclusiveRange, NormalArtianCounterId } from './types'

/** Design 4.5 / 9.1 / 9.2. */
export type MaterializationMethod = 'planner_alternative_reservation' | 'candidate_search_projected'

/**
 * Design 9.7: the Search scale computed from the reservation and the extent before any Search runs.
 * Research diagnostics and the gate's input only, never a formal Search work unit (G8).
 */
export interface PredictedSearchScale {
  /** Legal conversion Skill positions (`nextOperationPositions()` from the Skill origin); 0 for an owned Gogma. */
  conversionPositions: number
  /** Non-blocked positions of the Gogma extent window. */
  gogmaLegalWidth: number
  /** Non-blocked positions of the Skill extent window (a conversion Route's window is one position longer). */
  skillLegalWidth: number
  /** Own forges of the canonical held-prefix Normal creation up to the production target; 0 for an owned source. */
  normalForgeCount: number
}

/**
 * Design 9.7 / 10.4: the caller's explicit upper bound per scale component (non-negative safe integers).
 * D-0A decides no value; D-0B pre-registers them. A request above any of them is never executed.
 */
export interface SearchScaleGate {
  maxConversionPositions: number
  maxGogmaLegalWidth: number
  maxSkillLegalWidth: number
  maxNormalForgeCount: number
}

/** The windows and positions one scale prediction counted (diagnostics for the D-0B comparison). */
export interface SearchScaleDetail {
  origins: { skill: number; gogma: number; normal: { counterId: NormalArtianCounterId; position: number } | null }
  /** The legal conversion Skill positions in ascending order (empty for an owned Gogma). */
  conversionSkillPositions: number[]
  /** `nextOperationPositions().beyondLimit` of the conversion walk: a legal position still lay at or beyond the extent. */
  conversionBeyondExtent: boolean
  /** Inclusive Skill window of the extent (`origin .. origin + M - 1`, a conversion `origin .. origin + M`). */
  skillWindow: InclusiveRange
  /** Inclusive Gogma window of the extent. */
  gogmaWindow: InclusiveRange
  /** The canonical held-prefix creation (PLANNER_SPEC 9.2.19.4) of a new Normal source, otherwise null. */
  normalCreation: { normalCounterBefore: number; normalCounterAfter: number; count: number } | null
}

/** Design 9.2: the projected start of each stream and the restricted inventory of a projected Candidate Search. */
export interface ProjectedSearchOrigin {
  /** The first own Skill position of the shape, or the Planner-start Skill Counter when the shape has none. */
  skillCounter: number
  /** The first own Gogma position of the shape, or the Planner-start Gogma Counter when the shape has none. */
  gogmaCounter: number
  /** A new Normal source's Counter and its first own forge position; null for an owned source (Counters unchanged). */
  normal: { counterId: NormalArtianCounterId; counter: number } | null
  /** The source's Route family: `existing_gogma` for an owned Gogma, `normal_artian` for a Normal source. */
  routeFilter: Extract<CandidateRouteFilter, 'existing_gogma' | 'normal_artian'>
  /** The restricted inventory: the source weapon alone, or none for a new Normal. */
  ownedWeaponIds: OwnedWeaponId[]
  /**
   * The Target's own preference when it names the source weapon, otherwise null: the restricted inventory
   * holds no other weapon, and the Production validation refuses a preference outside it. Never set to a
   * weapon the Target does not already prefer.
   */
  preferredOwnedWeaponId: OwnedWeaponId | null
}

interface MaterializationRequestBase {
  targetWeaponId: TargetWeaponId
  shape: ExpectedRouteShape
  predictedSearchScale: PredictedSearchScale
  scaleDetail: SearchScaleDetail
}

/** Design 4.5 / 9.1: a Planner Alternative Search under the formal reservation of the Entries materialized so far. */
export interface PlannerAlternativeMaterializationRequest extends MaterializationRequestBase {
  method: 'planner_alternative_reservation'
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

/** Design 4.5 / 9.2: one ordinary Candidate Search from the projected start of a continuous shape. */
export interface ProjectedMaterializationRequest extends MaterializationRequestBase {
  method: 'candidate_search_projected'
  reservation: null
  projection: ProjectedSearchOrigin
  /** The minimal extent from the projected start (design 9.1 `extentFor` with the projected origins). */
  extent: CandidateSearchSettings
  /** The projected request's `searchRunId` (deterministic; the projected Candidate is rebuilt at the origin afterwards). */
  searchRunId: string
}

export type MaterializationRequest = PlannerAlternativeMaterializationRequest | ProjectedMaterializationRequest

/** Why one materialized Entry does not have the expected Route shape (design 8.3 / 9.1 `matchesExpectedShape()`). */
export type ShapeMismatchReason =
  | 'target'
  /** `createPlannerRouteUnitPlans()` rejected the Route, so no required position exists to compare. */
  | 'unit_plan_rejected'
  | 'source'
  /** A required unit without a Counter position (a blind creation); no expected shape has one. */
  | 'unpositioned_required_unit'
  | 'skill_required'
  | 'gogma_required'
  | 'normal_required'
  | 'final_bonuses'
  | 'restoration_bonus_scope'
  | 'series_skill'
  | 'group_skill'

export interface ShapeMismatch {
  /** 1-based delivery index of the Candidate (always 1 for a projected canonical Ideal). */
  deliveredIndex: number
  reasons: ShapeMismatchReason[]
  /** The Route's required positions per stream, or null when no unit plan exists. */
  plannerRequired: RequiredPositions | null
  sourceOwnedWeaponId: OwnedWeaponId | null
}

export type ShapeMatchResult =
  | { matches: true; plannerRequired: RequiredPositions }
  | { matches: false; reasons: ShapeMismatchReason[]; plannerRequired: RequiredPositions | null }

/**
 * Design 19.3 G1 (Phase D-0B): an expected shape the Production Search policy never returns, decided from the
 * ReachTable alone before any Search (`searchPolicyShapeOf()`). The one kind the current Phase A option set can
 * hold is the lane-start Ideal Skill continuation: a `conversion (c, s*)` with `c < s*` whose conversion Skill at
 * `c` is already Ideal for the Target. The Search attaches no Reset Skills channel to a Route base whose lane-start
 * Skill is Ideal (SEARCH_SPEC 5.6.1 / 5.6.8, `TargetSearchScheduler.addBase()`), so neither design 9.1 nor 9.2 can
 * deliver it. The Route is legal in the game and representable in the Domain: this is a Search policy, never a
 * mismatch, an extent or delivery stop, a gate, a missing window or "no Route".
 */
export interface SearchPolicyShape {
  policy: 'lane_start_ideal_skill_continuation'
  stream: 'skill'
  /** `c`: the conversion position, whose conversion Skill is already Ideal. */
  conversionPosition: number
  /** `s*`: the last Reset Skills position of the shape (`c < s*`). */
  finalPosition: number
}

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
  instrumentation: {
    workSettled: number
    skillStreams: number
    skillDepths: number
    skillStates: number
    maxSkillStatesPerDepth: number
    skillTransitions: number
    gogmaStreams: number
    gogmaDepths: number
    gogmaGeneratedStates: number
    maxGogmaFrontierStates: number
  }
}

export interface PlannerAlternativeAttempt {
  method: 'planner_alternative_reservation'
  request: PlannerAlternativeMaterializationRequest
  outcome: MaterializationOutcome
  /** Null when the Search did not run (gate) or did not finish (cancel). */
  observed: ObservedPlannerAlternativeSearch | null
}

/**
 * One projected Candidate Search. It never decides the Target outcome on its own (design 9.2): a non-match is
 * this method's limit, not evidence about the shape, so it only switches to (or keeps) design 9.1's result.
 */
export type ProjectedAttemptResult =
  | { kind: 'matched'; outcome: Extract<MaterializationOutcome, { kind: 'materialized' }> }
  /** The canonical Ideal from the projected start is a different shape. */
  | { kind: 'canonical_mismatch'; mismatch: ShapeMismatch }
  /** No canonical Ideal inside the projected extent. */
  | { kind: 'no_candidate' }
  | { kind: 'not_executed'; reason: 'search_scale_gate'; predictedSearchScale: PredictedSearchScale; exceeded: (keyof PredictedSearchScale)[] }
  | { kind: 'unmeasured'; reason: 'cancelled' }

export interface ProjectedAttempt {
  method: 'candidate_search_projected'
  request: ProjectedMaterializationRequest
  result: ProjectedAttemptResult
  /** Null when the Search did not run (gate) or did not finish (cancel). */
  observed: { searchedRoutes: RouteKind[]; skippedRoutes: { route: RouteKind; reason: string }[]; candidateFound: boolean } | null
}

export type MaterializationAttempt = PlannerAlternativeAttempt | ProjectedAttempt

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
   */
  selection: MethodSelection | null
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

export type MaterializationFailClosedCode =
  /** `deliveryCap` or a gate value is invalid (a lower-level API called without the run's settings check). */
  | 'invalid_settings'
  /** A request differs from its re-derivation (reservation, extent, projection, identity or predicted scale). */
  | 'request_mismatch'
  /** The shape's own positions are not a valid partition (an internal inconsistency of the shape). */
  | 'invalid_shape'
  /** `derivePlannerAlternativeReservation()` refused the materialized Entries. */
  | 'reservation_derivation_failed'
  /** The Production Search rejected a derived input (not a cancellation). */
  | 'search_refused'
  /** The Search's completion report has neither `exhausted`, `stoppedByExtent` nor a consumer stop. */
  | 'search_contract_violation'
  /** The deterministic materializer or the projected adapter refused (ID collision, invalid Candidate, projection). */
  | 'entry_materialization_refused'
  /** The generated Entry no longer matched after its probe matched. */
  | 'match_inconsistent'

/**
 * A fail-closed stop of the materialization (design 9.4): never classified as a `MaterializationOutcome`,
 * never read as "no Route". The D-0B runner records it as an error of the run.
 */
export class GlobalAssignmentMaterializationError extends Error {
  readonly code: MaterializationFailClosedCode
  readonly targetWeaponId: TargetWeaponId | null

  constructor(code: MaterializationFailClosedCode, targetWeaponId: TargetWeaponId | null, message: string) {
    super(message)
    this.name = 'GlobalAssignmentMaterializationError'
    this.code = code
    this.targetWeaponId = targetWeaponId
  }
}
