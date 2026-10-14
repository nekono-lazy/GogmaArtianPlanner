/**
 * Issue #154 Global Assignment Phase C-1 (Research adapter; never imported by the app).
 *
 * The static Counter coverage pre-check, the coverer prediction and the materialization order
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 8.1 / 8.2) are the Production Domain's
 * (`src/domain/planner/buildListOptimization/coverage.ts`, Issue #260 PR-2). A Research table is handed over with the rule
 * its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type { ResourceAssignmentCandidate } from './assignmentTypes'
import type { CoverageStream, MaterializationPlan, StreamCoverage, StreamCoverageResult } from './coverageTypes'
import { productionReachTableOf, type ReachTable } from './types'

export { coverageStreamLabel, selectCoverer, type CoverageHolder } from '../../domain/planner/buildListOptimization'

export function coverageStreamsOf(table: ReachTable): CoverageStream[] {
  return production.coverageStreamsOf(productionReachTableOf(table))
}

export function checkStreamCoverage(candidate: ResourceAssignmentCandidate, table: ReachTable): StreamCoverageResult {
  return production.checkStreamCoverage(candidate, productionReachTableOf(table))
}

export function deriveMaterializationOrder(candidate: ResourceAssignmentCandidate, table: ReachTable, coverage: readonly StreamCoverage[]): MaterializationPlan {
  return production.deriveMaterializationOrder(candidate, productionReachTableOf(table), coverage)
}
