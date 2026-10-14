/**
 * Issue #154 Global Assignment Phase C-1 (Research adapter; never imported by the app).
 *
 * The plain-data types of the Counter coverage pre-check, the coverer prediction, the materialization order and the
 * structural candidate (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.3 / 4.4 / 8) are the Production Domain's
 * (`src/domain/planner/buildListOptimization/coverageTypes.ts`, Issue #260 PR-2), re-exported unchanged.
 */
export type {
  ChainOperation,
  CoverageInputIssue,
  CoverageInvalidInput,
  CoverageRequiredPosition,
  CoverageSegment,
  CoverageStream,
  ExpectedRouteShape,
  MaterializationDependency,
  MaterializationPlan,
  PredictedChainSegment,
  StreamCoverage,
  StreamCoverageResult,
  StructuralCandidate,
  StructuralCandidateResult,
  UncoveredGap,
} from '../../domain/planner/buildListOptimization'
