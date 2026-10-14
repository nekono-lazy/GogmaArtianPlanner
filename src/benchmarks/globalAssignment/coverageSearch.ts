/**
 * Issue #154 Global Assignment Phase C-2 (Research adapter; never imported by the app).
 *
 * The coverage-gated assignment search (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.3 / 6.4 / 8.1 / 13.3) is the
 * Production Domain's (`src/domain/planner/buildListOptimization/coverageSearch.ts`, Issue #260 PR-2). A Research table is
 * handed over with the rule its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type { PlanningTargetPriority } from './assignmentTypes'
import type {
  CoverageFeasibleAssignment, CoverageSearchDiagnostics, CoverageSearchRequest, CoverageSearchResult, CreateCoverageSearchResult,
} from './coverageSearchTypes'
import { productionReachTableOf, type ReachTable } from './types'

export { noCandidateReason } from '../../domain/planner/buildListOptimization'

export function createCoverageSearch(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: CoverageSearchRequest): CreateCoverageSearchResult<CoverageFeasibleAssignment> {
  return production.createCoverageSearch(productionReachTableOf(table), planningTargets, request)
}

export function collectFromCoverageSearch<TCandidate, TDiagnostics extends CoverageSearchDiagnostics>(
  created: CreateCoverageSearchResult<TCandidate, TDiagnostics>, table: ReachTable, candidateLimit: number,
): CoverageSearchResult<TCandidate, TDiagnostics> {
  return production.collectFromCoverageSearch(created, productionReachTableOf(table), candidateLimit)
}

export function collectCoverageFeasibleAssignments(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: CoverageSearchRequest,
  candidateLimit: number): CoverageSearchResult<CoverageFeasibleAssignment> {
  return production.collectCoverageFeasibleAssignments(productionReachTableOf(table), planningTargets, request, candidateLimit)
}
