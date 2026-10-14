/**
 * Issue #154 Global Assignment Phase B-1 (Research adapter; never imported by the app).
 *
 * The plain-data types of the resource assignment solver (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.3 / 6.1 / 6.3 /
 * 6.4 / 10.1 / 12) are the Production Domain's (`src/domain/planner/buildListOptimization/assignmentTypes.ts`,
 * Issue #260 PR-2), re-exported unchanged.
 */
export type {
  CreateResourceAssignmentSearchResult,
  ExpandedNodeInfo,
  PartialResourceAssignment,
  PlanningTargetPriority,
  PriorityOrderingDiagnostics,
  RequiredPositions,
  ResourceAssignmentCandidate,
  ResourceAssignmentSearch,
  ResourceAssignmentSearchCompleteness,
  ResourceAssignmentSearchDiagnostics,
  ResourceAssignmentSearchEvent,
  ResourceAssignmentSearchRequest,
  ResourceAssignmentSearchResult,
  ResourceViolationKind,
  VerifiedUpperBound,
} from '../../domain/planner/buildListOptimization'
