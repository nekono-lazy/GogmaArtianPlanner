/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research adapter; never imported by the app).
 *
 * Design D0A2 9.3 items 1 - 6: the independent Route checks of one shape-constrained Entry are the Production Domain's
 * (`src/domain/planner/buildListOptimization/shapeRouteCheck.ts`, Issue #260 PR-3): they re-predict every operation, check the
 * Counters, the Keep inputs, the formal reservation's coverage, the Candidate / Entry hashes and the Planner's own required positions.
 * `passed` means every check held - never "verified": the Production Planner and Trace Replay of Phase D' (D-1) are the authority.
 * This adapter keeps the Research name and reads a request in its Research view.
 */
import {
  checkShapeConstrainedRoute, type RouteCheckReport, type ShapeRouteCheckInput as ProductionShapeRouteCheckInput,
} from '../../domain/planner/buildListOptimization'
import type { ShapeConstrainedMaterializationRequest } from './shapeMaterializationTypes'

export type ShapeRouteCheckInput = Omit<ProductionShapeRouteCheckInput, 'request'> & { request: ShapeConstrainedMaterializationRequest }

export function verifyShapeConstrainedRoute(input: ShapeRouteCheckInput): RouteCheckReport {
  return checkShapeConstrainedRoute(input)
}
