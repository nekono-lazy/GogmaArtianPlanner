/*
 * The Global Assignment Research (Issue #154) adapter of the shape-constrained Route search (`docs/SEARCH_SPEC.md` 5.6.9).
 * Since Issue #260 PR-2 the search itself is the Production Search API `src/domain/search/shapeConstrained/`; this path
 * re-exports it unchanged for the Research code and keeps only what is the Research's own: its route policy token, which
 * the Research search identities (D-0A-2b / D-0C / D-1C records) fold in. No Production module imports this path.
 */
export {
  assertShapeConstrainedSearchInput,
  collectShapeConstraintIssues,
  diagnoseShapeConstrainedBase,
  shapeConstrainedBonusPolicy,
  shapeConstrainedLaneNeeds,
  shapeConstrainedRouteBaseConstraint,
  ShapeConstrainedSearchError,
  visitShapeConstrainedRouteCandidates,
  type RouteShapeConstraint,
  type ShapeBaseUnavailableReason,
  type ShapeConstrainedBonusLane,
  type ShapeConstrainedRouteBase,
  type ShapeConstrainedSearchErrorCode,
  type ShapeConstrainedSearchExecution,
  type ShapeConstrainedSearchInput,
  type ShapeConstrainedSkillLane,
} from '../shapeConstrained'

/**
 * The Research route policy token (`docs/SEARCH_SPEC.md` 5.6.9): the version of the seam semantics the Research folds
 * into its own search identity. It is not the Production token (`src/domain/search/shapeConstrained/`
 * `SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION`) and never changes with it, so the Research records keep their meaning.
 */
export const SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION = 'research-shape-constrained-route-policy:v1'
