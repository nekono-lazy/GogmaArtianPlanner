/**
 * Issue #154 Global Assignment Phase B-1 (Research adapter; never imported by the app).
 *
 * The resource assignment solver (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.3 / 6.4 / 6.5 / 10.1 / 12) is the
 * Production Domain's (`src/domain/planner/buildListOptimization/assignmentSolver.ts`, Issue #260 PR-2). A Research table
 * is handed over with the rule its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type {
  CreateResourceAssignmentSearchResult, PlanningTargetPriority, ResourceAssignmentSearchRequest, ResourceAssignmentSearchResult,
} from './assignmentTypes'
import { productionReachTableOf, type ReachTable } from './types'

export function createResourceAssignmentSearch(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: ResourceAssignmentSearchRequest): CreateResourceAssignmentSearchResult {
  return production.createResourceAssignmentSearch(productionReachTableOf(table), planningTargets, request)
}

export function collectResourceAssignments(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: ResourceAssignmentSearchRequest,
  candidateLimit: number): ResourceAssignmentSearchResult {
  return production.collectResourceAssignments(productionReachTableOf(table), planningTargets, request, candidateLimit)
}
