/**
 * Issue #154 Global Assignment Phase B-1 (Research adapter; never imported by the app).
 *
 * The resource conditions C1 / C2 of the assignment problem (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.1) are the
 * Production Domain's (`src/domain/planner/buildListOptimization/assignmentFeasibility.ts`, Issue #260 PR-2). A Research
 * table is handed over with the rule its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type { PartialResourceAssignment } from './assignmentTypes'
import { productionReachTableOf, type ReachTable, type StreamEnd } from './types'

export { applyReachOption, findResourceViolation, requiredPositionsOf, streamEndDelta } from '../../domain/planner/buildListOptimization'

export function createEmptyPartialAssignment(table: ReachTable): PartialResourceAssignment {
  return production.createEmptyPartialAssignment(productionReachTableOf(table))
}

export function streamEndObjective(streamEnd: StreamEnd, table: ReachTable): number {
  return production.streamEndObjective(streamEnd, productionReachTableOf(table))
}
