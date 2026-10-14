/**
 * Issue #154 Global Assignment Phase C-1 (Research adapter; never imported by the app).
 *
 * The structural candidate of one resource assignment - the coverage pre-check, the required-only replay, the
 * materialization order and the expected Route shapes (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.3 / 4.4 / 8.1 - 8.3) -
 * is the Production Domain's (`src/domain/planner/buildListOptimization/structuralCandidate.ts`, Issue #260 PR-2). The
 * Research inputs name a Research table, handed over with the rule its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type { RngEngine } from '../../domain/rng/rngEngine'
import type { ResourceAssignmentCandidate } from './assignmentTypes'
import type { CoverageInvalidInput, StructuralCandidateResult } from './coverageTypes'
import { productionReachTableOf, type GlobalAssignmentContext, type ReachTable } from './types'

export interface StructuralCandidateInputs {
  /** The ReachTable the assignment was generated from. */
  table: ReachTable
  /** The context the table was built from (the PlannerInput the replay reads). */
  context: GlobalAssignmentContext
  /** The Engine the table was scanned with. */
  engine: RngEngine
}

/** The Production inputs these Research inputs stand for. */
export function productionStructuralCandidateInputs(inputs: StructuralCandidateInputs): production.StructuralCandidateInputs {
  return { ...inputs, table: productionReachTableOf(inputs.table) }
}

export function checkTableBelongsToContext(table: ReachTable, context: GlobalAssignmentContext): CoverageInvalidInput | null {
  return production.checkTableBelongsToContext(productionReachTableOf(table), context)
}

export function buildStructuralCandidate(assignment: ResourceAssignmentCandidate, inputs: StructuralCandidateInputs): StructuralCandidateResult {
  return production.buildStructuralCandidate(assignment, productionStructuralCandidateInputs(inputs))
}
