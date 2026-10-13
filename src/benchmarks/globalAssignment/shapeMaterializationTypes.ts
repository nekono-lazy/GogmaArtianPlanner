/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research only; never imported by the app).
 *
 * Plain-data types of the shape-constrained materialization method `shape_constrained` and of the method rule `d0a2-v2`
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.2 / 5.4 / 9.1 / 9.3 / 10 / 11). The method calls the Research-only
 * Search Domain seam `visitShapeConstrainedRouteCandidates()` (D-0A-2a, `docs/SEARCH_SPEC.md` 5.6.9) under the formal
 * reservation of the Entries materialized so far, with the Target's expected Route shape applied before any Route base
 * exists, and accepts the first delivered Candidate only after it matches the shape and passes the independent Route
 * checks. The rule `d0a-v1` (Phase D-0A / D-0B) is unchanged and stays the default.
 *
 * Nothing here is a Plan, a Planner verification or a persisted value: a materialized Entry is speculative Research data
 * (G1) and Phase D' (D-1) alone decides whether the Planner builds a Plan from it. No status here is "verified".
 */
import type { BuildListEntry, BuildListEntryId, TargetWeaponId } from '../../domain/models/publicTypes'
import type { PlannerAlternativeReservation, PlannerAlternativeSearchExtent } from '../../domain/search/alternative'
import type { UnsupportedAmendmentPrediction } from '../../domain/search/bonusStream'
import type {
  RouteShapeConstraint, ShapeBaseUnavailableReason, ShapeConstrainedRouteBase, ShapeConstrainedSearchExecution,
} from '../../domain/search/research'
import type { RequiredPositions } from './assignmentTypes'
import type { ExpectedRouteShape } from './coverageTypes'
import type { ObservedPlannerAlternativeSearch, PredictedSearchScale, SearchPolicyShape, SearchScaleGate } from './materializationTypes'
import type { InclusiveRange, LayoutKey, NormalArtianCounterId } from './types'

/** The method rule of one materialization run (design 11). `d0a-v1` is the D-0A / D-0B rule and the default. */
export type MaterializationRule = 'd0a-v1' | 'd0a2-v2'

/** Design 9.1: the algorithm token of every shape-constrained search identity (the D-0A token stays as it is). */
export const GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM = 'global-assignment-d0a2-shape-constrained-materialization-v1'
/** Design 9.1: the Candidate ID prefix of a shape-constrained Candidate (the D-0A prefix stays as it is). */
export const SHAPE_CONSTRAINED_CANDIDATE_ID_PREFIX = 'candidate.research.global-assignment.shape.'

/**
 * Design 10.3: the scale of one shape-constrained Search, computed before the Search from positions alone (no prediction,
 * no Search). Upper bounds and counts of the work the early constraints leave, never a measurement and never a formal Search
 * work unit (G8). The pre-base part and the stream part are kept apart.
 */
export interface ShapeSearchScale {
  /** Design 3.9: what still runs before the Route base exists. */
  preBase: {
    /** The one Route search primitive the seam starts. */
    primitive: ShapeConstrainedRouteBase['kind']
    /** Positions the formal `conversionSkillPositions()` walk inspects (a conversion base only; no prediction). */
    conversionWalkPositions: number
    /** The predictions before the base: the new Normal at `p` and the conversion Skill at `c`. */
    requiredPredictions: { normalArtian: 0 | 1; skill: 0 | 1 }
    /** The base registration work item (an owned Gogma registers synchronously: 0). */
    baseWorkItems: 0 | 1
    /** The prediction supports the lanes use (the only ones the seam asks). */
    supportQueries: ('normal_artian' | 'skill' | 'gogma_reset' | 'gogma_keep')[]
  }
  /** Own forges of the canonical held-prefix Normal creation up to `p`; 0 for an owned source. */
  normalForgeCount: number
  /** Whether `c` is one of the formal legal conversion positions (always true for an owned Gogma). */
  conversionLegal: boolean
  /** The formal legal conversion positions of the walk (empty for an owned Gogma). */
  conversionLegalPositions: number[]
  skill: ShapeStreamScale
  gogma: ShapeStreamScale & {
    policy: RouteShapeConstraint['bonus']['kind']
    /** Non-blocked positions of the window: the shape policy keeps one family layout per position. */
    frontierUpperBound: number
    /** `depthUpperBound × non-blocked positions × (maxHeldRun + 2)`: Resets one per position, Keeps one per frontier state and window position. */
    generatedStateUpperBound: number
  }
  /** The depth a stream can be read to before the first matching composition: the sum of both lanes' `minOwnOperations`. */
  depthUpperBound: number
}

export interface ShapeStreamScale {
  /** The lane's own-operation window (inclusive), or null for a zero lane. */
  window: InclusiveRange | null
  /** Non-held positions of the window plus the held required positions of the window. */
  minOwnOperations: number
  /** Non-blocked positions of the window. */
  maxOwnOperations: number
  /** The longest run of held positions inside the window. */
  maxHeldRun: number
}

/** Design 10.3: the caller's explicit upper bound per component (non-negative safe integers; no default anywhere). */
export interface ShapeSearchScaleGate {
  maxDepthUpperBound: number
  maxGogmaGeneratedStateUpperBound: number
  maxNormalForgeCount: number
  maxConversionWalkPositions: number
}

export type ShapeSearchScaleComponent = 'depthUpperBound' | 'gogmaGeneratedStateUpperBound' | 'normalForgeCount' | 'conversionWalkPositions'

/** Design 10.4: the caller's explicit runtime budget of one Search (non-negative safe integers; reaching it stops the Search). */
export interface ShapeSearchBudget {
  maxGogmaGeneratedStates: number
  maxSkillStates: number
  /** Settled work items (the base registration work included). */
  maxSettledWork: number
  /** Production RNG prediction calls of the Search itself, per kind (the independent Route checks are not counted). */
  maxPredictions: { normalArtian: number; skill: number; gogmaReset: number; gogmaKeep: number }
}

export type ShapeSearchBudgetComponent =
  | 'gogmaGeneratedStates' | 'skillStates' | 'settledWork' | 'normalArtianPredictions' | 'skillPredictions' | 'gogmaResetPredictions' | 'gogmaKeepPredictions'

/** The settings of the rule `d0a2-v2`; a type of its own, never the D-0A `MaterializationSettings`. */
export interface ShapeMaterializationSettings {
  /** Design 9.2: the gate of the projected Candidate Search (the D-0A gate type; that method is unchanged). */
  projectedSearchScaleGate: SearchScaleGate
  shapeSearchScaleGate: ShapeSearchScaleGate
  shapeSearchBudget: ShapeSearchBudget
}

/** Production RNG Engine calls one counting wrapper saw (design 10.4). */
export interface PredictionCallCounts {
  normalArtian: number
  skill: number
  gogmaReset: number
  gogmaKeep: number
  supportQueries: number
}

/**
 * A position premise of the minimal Route lemma (design 5.5) that does not hold, found before the Search from positions and
 * the PlannerInput alone. Any one of them is a fail-closed `shape_base_unavailable`: a Phase C / C1 / C2 / earlier
 * materialization premise is broken, never "no Route".
 */
export type MinimalRoutePremiseViolation =
  | { kind: 'source_not_found' | 'source_exclusive' | 'source_protected'; ownedWeaponId: string }
  | { kind: 'conversion_position_not_legal'; position: number; legalPositions: number[] }
  | { kind: 'normal_counter_origin_missing'; counterId: NormalArtianCounterId }
  | { kind: 'production_target_blocked' | 'production_target_outside_extent'; counterId: NormalArtianCounterId; position: number }
  | { kind: 'required_position_blocked'; stream: 'skill' | 'gogma'; position: number }
  | { kind: 'required_position_outside_extent'; stream: 'skill' | 'gogma'; position: number; window: InclusiveRange }

/** Design 5.2 / 5.4: one shape-constrained materialization request, fully re-derivable from the shape and the earlier Entries. */
export interface ShapeConstrainedMaterializationRequest {
  method: 'shape_constrained'
  rule: 'd0a2-v2'
  targetWeaponId: TargetWeaponId
  shape: ExpectedRouteShape
  /** The shape as the seam reads it, converted from `shape.option` alone. */
  routeShape: RouteShapeConstraint
  /** `emptyPlannerAlternativeReservation` with no earlier Entry, otherwise `derivePlannerAlternativeReservation()` of them. Never edited. */
  reservation: PlannerAlternativeReservation
  reservationSourceEntryIds: BuildListEntryId[]
  /** The Planner-start origins of the shape's streams. */
  origins: { skill: number; gogma: number; normal: { counterId: NormalArtianCounterId; position: number } | null }
  /** Design 9.1 `extentFor(shape)` from the Planner-start origins. */
  extent: PlannerAlternativeSearchExtent
  /** Design 9.1: deterministic, from the token, the route policy, the Target, the origin, the context, the extent, the reservation and the shape. */
  searchIdentity: string
  predictedScale: ShapeSearchScale
  /** The violated position premises (empty when they all hold). */
  premiseViolations: MinimalRoutePremiseViolation[]
}

/** One prediction-support question in the Phase A sense (design 3.10): per weapon type / element, Keep per family layout. */
export type SupportQuestion =
  | { prediction: 'normal_artian' | 'skill' | 'gogma_reset'; weaponTypeId: string; elementId: string }
  | { prediction: 'gogma_keep'; weaponTypeId: string; elementId: string; layout: LayoutKey }

/** Whether Phase A answered the same question, and how (design 10.1 区分 1 / 4). */
export type PhaseASupportJudgement = 'supported' | 'unsupported' | 'not_judged'

export interface SupportQuestionRecord {
  question: SupportQuestion
  phaseA: PhaseASupportJudgement
}

/** Why a needed prediction or capability was not available (design 10.1 区分 1, Phase A did not judge it as supported). */
export interface ShapeUnsupportedDetail {
  /** `base_diagnosis`: the seam's base diagnosis; `bonus_stream`: the admitted base's Bonus stream reported it. */
  origin: 'base_diagnosis' | 'bonus_stream'
  unavailable: ShapeBaseUnavailableReason | null
  predictions: UnsupportedAmendmentPrediction[]
  /** The Phase A question of each unsupported prediction (absent for an Engine capability flag, which Phase A never reads). */
  questions: SupportQuestionRecord[]
}

/**
 * What decided a stop of the Search. A `budget` / `cancel` stop is recorded when `shouldCancel` first answered true, never
 * re-read from the counters afterwards (a cancel that coincides with the budget is a cancel, the budget recorded beside it).
 * A `consumer` (the accepted delivery) / `search_end` stop records the usage at the end: a component may be over its limit
 * when the Search delivered before its next checkpoint read the budget - the materialization still stands, and the excess is
 * shown, never hidden.
 */
export interface ShapeSearchStop {
  by: 'consumer' | 'search_end' | 'budget' | 'cancel'
  budgetExceeded: ShapeSearchBudgetComponent[]
}

/** What one executed shape-constrained Search reported and used (execution-only observation, never an identity). */
export interface ShapeSearchObserved {
  /** Candidates the Search delivered (0, or 1: the first delivery is accepted or fails closed). */
  deliveredCandidates: number
  /** Null when the Search was stopped by the budget or a cancel (it rejected, so it reported no summary). */
  execution: Omit<ShapeConstrainedSearchExecution, 'targetWeaponId'> | null
  instrumentation: ObservedPlannerAlternativeSearch['instrumentation']
  /** Prediction calls of the Search itself (the independent Route checks are counted apart). */
  searchPredictions: PredictionCallCounts
  stop: ShapeSearchStop
}

export type RouteCheckIssueCode =
  | 'reservation_mismatch'
  | 'candidate_invalid'
  | 'entry_invalid'
  | 'target_mismatch'
  | 'route_kind_mismatch'
  | 'source_mismatch'
  | 'operation_sequence'
  | 'counter_discontinuity'
  | 'counter_advance_mismatch'
  | 'conversion_position_mismatch'
  | 'production_target_mismatch'
  | 'normal_creation_not_canonical'
  | 'coverage_gap'
  | 'blocked_position'
  | 'exclusive_source'
  | 'protected_source'
  | 'prediction_unavailable'
  | 'trace_mismatch'
  | 'keep_input_layout_mismatch'
  | 'final_state_mismatch'
  | 'not_ideal'
  | 'hash_mismatch'
  | 'calculation_context_mismatch'
  | 'estimate_mismatch'
  | 'unit_plan_rejected'
  | 'required_positions_mismatch'

export interface RouteCheckIssue {
  code: RouteCheckIssueCode
  /** The Route operation the issue is about, or null for a whole-Route check. */
  operationIndex: number | null
  detail: string
}

/**
 * Design 9.3 items 1 - 6: the independent Route checks of one shape-constrained Entry. `passed` says only that every check
 * held; it is never "verified" (Phase D' with the Production Planner and Trace Replay is the authority, design 9.3 item 7).
 */
export interface RouteCheckReport {
  passed: boolean
  issues: RouteCheckIssue[]
  checkedOperations: number
  /** The re-predictions of the checks alone (never added to the Search's counts or budget). */
  predictions: PredictionCallCounts
}

/** Design 10.1: how one shape-constrained attempt ended (fail-closed ends throw instead). */
export type ShapeConstrainedOutcome =
  | { kind: 'materialized'; method: 'shape_constrained'; entry: BuildListEntry; plannerRequired: RequiredPositions; deliveredBeforeMatch: 0 }
  /**
   * The Research budget stopped the Search: the shape was not reached, never "absent". A delivery is always accepted or fails
   * closed, so a budget stop delivered nothing (`delivered: 0`, no mismatch to report).
   */
  | { kind: 'unconfirmed'; reason: 'shape_search_budget_reached'; budgetExceeded: ShapeSearchBudgetComponent[]; delivered: 0; closestMismatch: null }
  /** The predicted scale exceeded the gate; no Search API was called. */
  | { kind: 'not_executed'; reason: 'search_scale_gate'; method: 'shape_constrained'; predicted: ShapeSearchScale; exceeded: ShapeSearchScaleComponent[] }
  /** A needed prediction or capability is not available and Phase A did not judge the same question supported. */
  | { kind: 'unsupported'; reason: 'required_prediction_unsupported' | 'capability_unavailable'; detail: ShapeUnsupportedDetail }
  | { kind: 'unmeasured'; reason: 'cancelled' }

export interface ShapeConstrainedAttempt {
  method: 'shape_constrained'
  request: ShapeConstrainedMaterializationRequest
  outcome: ShapeConstrainedOutcome
  /** Null when the Search did not run (gate). */
  observed: ShapeSearchObserved | null
  /** The independent Route checks of the delivered Candidate, null when nothing was delivered. */
  routeChecks: RouteCheckReport | null
}

/**
 * Design 11 continuation shapes: a shape whose lane is continued past an already Ideal lane start. Until A-2 the one kind is
 * the G1 conversion continuation (`searchPolicyShapeOf()`); A-2 adds the owned-Gogma continuations (G2) to this union and to
 * `CONTINUATION_SHAPE_DETECTORS`.
 */
export type ContinuationShape = SearchPolicyShape

export type ShapeMethodSelectionRule =
  /** A continuation shape (G1; G2 after A-2): `shape_constrained` only. */
  | 'continuation_shape_constrained_only'
  /** Continuous: the projected Candidate Search first, then `shape_constrained` once when it does not match. */
  | 'continuous_projected_then_shape_constrained'
  /** Non-continuous: `shape_constrained` only. */
  | 'non_continuous_shape_constrained_only'

/** Design 11: the deterministic method order of one Target under the rule `d0a2-v2`, from the ReachTable and the shape alone. */
export interface ShapeMethodSelection {
  materializationRule: 'd0a2-v2'
  rule: ShapeMethodSelectionRule
  continuous: boolean
  continuation: ContinuationShape | null
  /** Design 6.1: the `d0a-v1` Search-policy shape, kept on every record so the shapes the Search policy never returns are counted. */
  policyShape: SearchPolicyShape | null
  order: ('candidate_search_projected' | 'shape_constrained')[]
  predictedSearchScale: { shapeConstrained: ShapeSearchScale; projected: PredictedSearchScale | null }
}
