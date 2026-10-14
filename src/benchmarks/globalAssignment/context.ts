/**
 * Issue #154 Global Assignment Phase 0 (Research adapter; never imported by the app).
 *
 * The planning Target set of one PlannerInput with exactly the Production rule (`docs/PLANNER_SPEC.md` 4.1,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.1) is the Production Domain's Stage 0
 * (`src/domain/planner/buildListOptimization/planningContext.ts`, Issue #260 PR-2), re-exported here under the
 * Research name. No calculation lives here.
 */
export {
  comparePlanningTargetSet,
  createBuildListOptimizationContext as createGlobalAssignmentContext,
  type PlanningTargetSetComparison,
} from '../../domain/planner/buildListOptimization'
