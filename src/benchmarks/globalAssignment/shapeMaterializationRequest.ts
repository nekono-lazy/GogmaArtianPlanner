/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research adapter; never imported by the app).
 *
 * The request side of the shape-constrained materialization (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.2 / 5.4 / 9.1 / 11) -
 * the conversion of an `ExpectedRouteShape` into the shape-constrained Route search's `RouteShapeConstraint`, the deterministic search
 * identity, the position premises of the minimal Route lemma (5.5), the assembly of one request from a formal reservation and the
 * method rule `d0a2-v2` - is the Production Domain's (`src/domain/planner/buildListOptimization/shapeConstrainedRequest.ts`,
 * Issue #260 PR-3). This adapter passes the Research identity tokens (the D-0A-2b algorithm token, the Research route policy and
 * the Research identity prefix), so every Research identity keeps its value, and returns the Research views of a request and of a
 * method selection.
 */
import {
  assembleShapeConstrainedRouteRequest, selectRouteGenerationMethods, shapeConstrainedSearchIdentity as productionShapeConstrainedSearchIdentity,
  type PredictedSearchScale, type ShapeConstrainedRouteRequest, type ShapeOwnPositions, type ShapeSearchScale,
} from '../../domain/planner/buildListOptimization'
import type { BuildListEntryId } from '../../domain/models/publicTypes'
import type { PlannerAlternativeReservation } from '../../domain/search/alternative'
import { SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION, type RouteShapeConstraint } from '../../domain/search/research'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import type { ExpectedRouteShape } from './coverageTypes'
import {
  GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM, GLOBAL_ASSIGNMENT_SHAPE_SEARCH_IDENTITY_PREFIX, researchShapeMethodSelectionOf, researchShapeRequestOf,
  type ShapeConstrainedMaterializationRequest, type ShapeMethodSelection,
} from './shapeMaterializationTypes'
import { productionReachTableOf, type GlobalAssignmentContext, type ReachTable } from './types'

export {
  checkMinimalRoutePremises,
  detectRouteContinuation as continuationShapeOf,
  normalizeRouteShapeConstraint,
  ROUTE_CONTINUATION_DETECTORS as CONTINUATION_SHAPE_DETECTORS,
  toRouteShapeConstraint,
  type RouteContinuationDetector as ContinuationShapeDetector,
} from '../../domain/planner/buildListOptimization'

/** The Research tokens of the shape-constrained search identity (design 9.1). */
export const RESEARCH_SHAPE_IDENTITY_TOKENS = Object.freeze({
  shapeAlgorithm: GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM,
  routePolicy: SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION,
  shapeSearchIdentityPrefix: GLOBAL_ASSIGNMENT_SHAPE_SEARCH_IDENTITY_PREFIX,
})

/**
 * Design 9.1: the deterministic search identity (also every Candidate's `searchRunId`) under the Research tokens. No Clock, UUID,
 * ordinal, delivery order or attempt count.
 */
export function shapeConstrainedSearchIdentity(input: {
  plannerInput: PlannerInput
  targetWeaponId: ShapeConstrainedRouteRequest['targetWeaponId']
  extent: ShapeConstrainedRouteRequest['extent']
  reservation: PlannerAlternativeReservation
  routeShape: RouteShapeConstraint
}): string {
  return productionShapeConstrainedSearchIdentity(input, RESEARCH_SHAPE_IDENTITY_TOKENS)
}

/**
 * Design 5.4 steps 2 - 5: one shape-constrained request from the shape and the formal reservation of the Entries the caller
 * materialized before it (`reservationSourceEntryIds`, in materialization order), under the Research identity tokens.
 */
export async function assembleShapeConstrainedRequest(input: {
  shape: ExpectedRouteShape
  reservation: PlannerAlternativeReservation
  reservationSourceEntryIds: BuildListEntryId[]
  context: GlobalAssignmentContext
  table: ReachTable
}): Promise<ShapeConstrainedMaterializationRequest> {
  return researchShapeRequestOf(await assembleShapeConstrainedRouteRequest({ ...input, table: productionReachTableOf(input.table) }, RESEARCH_SHAPE_IDENTITY_TOKENS))
}

/**
 * Design 11: the deterministic method order of one Target under the rule `d0a2-v2` (the Production method rule), in its Research
 * view. Planner Alternative Search (design 9.1) is never part of this rule; it stays in `d0a-v1` and in the parity tests.
 */
export function selectShapeMaterializationMethods(
  shape: ExpectedRouteShape,
  own: ShapeOwnPositions,
  table: ReachTable,
  predicted: { shapeConstrained: ShapeSearchScale; projected: PredictedSearchScale | null },
): ShapeMethodSelection {
  return researchShapeMethodSelectionOf(selectRouteGenerationMethods(shape, own, table, predicted))
}
