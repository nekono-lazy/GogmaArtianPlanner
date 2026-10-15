/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research adapter of the shared types; never imported by the app).
 *
 * Plain-data types of the shape-constrained materialization method `shape_constrained` and of the method rule `d0a2-v2`
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.2 / 5.4 / 9.1 / 9.3 / 10 / 11). The method and its types moved to the Production
 * Domain (`src/domain/planner/buildListOptimization/routeGenerationTypes.ts`, Issue #260 PR-3); this file re-exports them under the
 * Research names and keeps only what is the Research's own: the rule identities, the Research tokens of the shape-constrained search
 * identity and Candidate IDs, and the Research views of a request (which names its rule) and of a method selection (which also keeps
 * the `d0a-v1` Search-policy classification). The rule `d0a-v1` (Phase D-0A / D-0B) is unchanged and stays the default.
 *
 * Nothing here is a Plan, a Planner verification or a persisted value: a materialized Entry is speculative Research data (G1) and
 * Phase D' (D-1) alone decides whether the Planner builds a Plan from it. No status here is "verified".
 */
import type {
  RouteGenerationMethodSelection,
  ShapeConstrainedAttempt as ProductionShapeConstrainedAttempt,
  ShapeConstrainedRouteRequest,
} from '../../domain/planner/buildListOptimization'
import type { SearchPolicyShape } from './materializationTypes'

export type {
  MinimalRoutePremiseViolation,
  PredictionCallCounts,
  ReachTableSupportJudgement as PhaseASupportJudgement,
  RouteCheckIssue,
  RouteCheckIssueCode,
  RouteCheckReport,
  RouteContinuationShape as ContinuationShape,
  RouteGenerationMethodRule as ShapeMethodSelectionRule,
  RouteGenerationSettings as ShapeMaterializationSettings,
  ShapeConstrainedOutcome,
  ShapeSearchBudget,
  ShapeSearchBudgetComponent,
  ShapeSearchObserved,
  ShapeSearchScale,
  ShapeSearchScaleComponent,
  ShapeSearchScaleGate,
  ShapeSearchStop,
  ShapeStreamScale,
  ShapeUnsupportedDetail,
  SupportQuestion,
  SupportQuestionRecord,
} from '../../domain/planner/buildListOptimization'

/** The method rule of one materialization run (design 11). `d0a-v1` is the D-0A / D-0B rule and the default. */
export type MaterializationRule = 'd0a-v1' | 'd0a2-v2'

/** Design 9.1: the algorithm token of every shape-constrained search identity (the D-0A token stays as it is). */
export const GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM = 'global-assignment-d0a2-shape-constrained-materialization-v1'
/** Design 9.1: the Candidate ID prefix of a shape-constrained Candidate (the D-0A prefix stays as it is). */
export const SHAPE_CONSTRAINED_CANDIDATE_ID_PREFIX = 'candidate.research.global-assignment.shape.'
/** Design 9.1: the prefix of the Research shape-constrained search identity. */
export const GLOBAL_ASSIGNMENT_SHAPE_SEARCH_IDENTITY_PREFIX = 'research.global-assignment.shape.'

/** Design 5.2 / 5.4: one shape-constrained materialization request (the Production request naming its Research rule). */
export type ShapeConstrainedMaterializationRequest = { method: 'shape_constrained'; rule: 'd0a2-v2' } & Omit<ShapeConstrainedRouteRequest, 'method'>

export type ShapeConstrainedAttempt = Omit<ProductionShapeConstrainedAttempt, 'request'> & { request: ShapeConstrainedMaterializationRequest }

/**
 * Design 11: the deterministic method order of one Target under the rule `d0a2-v2`, from the ReachTable and the shape alone. The
 * Production selection plus the rule's name and the `d0a-v1` Search-policy classification (design 6.1), kept on every record so the
 * shapes the Search policy never returns are counted.
 */
export interface ShapeMethodSelection extends RouteGenerationMethodSelection {
  materializationRule: 'd0a2-v2'
  policyShape: SearchPolicyShape | null
}

/** The Research view of a Production request: the same values, naming the rule `d0a2-v2` right after the method. */
export function researchShapeRequestOf(request: ShapeConstrainedRouteRequest): ShapeConstrainedMaterializationRequest {
  const { method, ...rest } = request
  return { method, rule: 'd0a2-v2', ...rest }
}

/** The Research view of a Production selection, in the D-0A-2b record field order. */
export function researchShapeMethodSelectionOf(selection: RouteGenerationMethodSelection): ShapeMethodSelection {
  return {
    materializationRule: 'd0a2-v2',
    continuous: selection.continuous,
    continuation: selection.continuation,
    // The `d0a-v1` Search-policy shape is the same detection (conversion continuation, then owned-Gogma continuation).
    policyShape: selection.continuation === null ? null : structuredClone(selection.continuation),
    predictedSearchScale: selection.predictedSearchScale,
    rule: selection.rule,
    order: selection.order,
  }
}
