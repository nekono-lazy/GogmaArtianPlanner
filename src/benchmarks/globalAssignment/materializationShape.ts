/**
 * Issue #154 Global Assignment Phase D-0A (Research adapter; never imported by the app).
 *
 * The Route-shape side of the materialization (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 8.3 / 9.1 - 9.3) - the shape's own
 * positions, their continuity, the Search extent, the continuation shapes and the shape match - is the Production Domain's
 * (`src/domain/planner/buildListOptimization/routeShape.ts`, Issue #260 PR-3). This adapter keeps the Research names:
 * `matchExpectedShape()` is the Production `matchRouteShape()`, and the D-0B Search-policy classification `searchPolicyShapeOf()`
 * is the Production continuation detection (the conversion continuation first, then the owned-Gogma continuation: the very
 * detectors the rule `d0a2-v2` reads as continuation shapes).
 */
export {
  conversionSkillContinuationShapeOf,
  detectRouteContinuation as searchPolicyShapeOf,
  matchRouteShape as matchExpectedShape,
  ownedGogmaContinuationShapeOf,
  plannerRequiredPositions,
  plannerStartOrigins,
  shapeOwnPositions,
  shapeSearchExtent,
  type OwnStreamPositions,
  type PlannedRequiredPositions,
  type ShapeOwnPositions,
  type ShapeSearchExtent,
  type ShapeStream,
  type StreamOrigins,
} from '../../domain/planner/buildListOptimization'
