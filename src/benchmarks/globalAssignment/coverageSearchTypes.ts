/**
 * Issue #154 Global Assignment Phase C-2 (Research adapter; never imported by the app).
 *
 * The plain-data types of the coverage-gated assignment search (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.3 / 6.4 /
 * 8.1 / 13.3) are the Production Domain's (`src/domain/planner/buildListOptimization/coverageSearchTypes.ts`, Issue #260
 * PR-2), re-exported unchanged.
 */
export type {
  AssignmentCoverageInspection,
  CoverageDrivenOrderingDiagnostics,
  CoverageFeasibleAssignment,
  CoverageSearch,
  CoverageSearchDiagnostics,
  CoverageSearchEvent,
  CoverageSearchRequest,
  CoverageSearchResult,
  CreateCoverageSearchResult,
  NoStructuralCandidateReason,
  StructuralSearchDiagnostics,
  StructuralSearchResult,
} from '../../domain/planner/buildListOptimization'
