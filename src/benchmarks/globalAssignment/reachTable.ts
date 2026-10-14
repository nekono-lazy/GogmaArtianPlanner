/**
 * Issue #154 Global Assignment Phase A (Research adapter; never imported by the app).
 *
 * The ReachTable scan (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.2 / 5.1 / 5.4 / 5.5) is the Production Domain's
 * Stage A (`src/domain/planner/buildListOptimization/reachTable.ts`, Issue #260 PR-2). This adapter keeps the Research
 * API: the option set is a Research identity (`a1` / `a2`), the table is returned in its Research view, and a Target
 * without a source reads `unconfirmed_counter` as before. The W0 reference window stays here: Production never takes
 * its window from the Candidate Search defaults (`docs/PLANNER_SPEC.md` 17.13).
 */
import { recommendedCandidateSearchDefaults } from '../../domain/models/common'
import {
  assertReachWindow,
  buildReachTable as buildProductionReachTable,
  type ReachTableExecution,
} from '../../domain/planner/buildListOptimization'
import type { RngEngine } from '../../domain/rng/rngEngine'
import {
  isReachOptionSetVersion, REACH_OPTION_SET_A1, REACH_OPTION_SET_A2, researchReachOptionSet, researchReachTableOf,
  type GlobalAssignmentContext, type ReachOptionSetVersion, type ReachTableResult, type ReachWindow,
} from './types'

export { assertReachWindow, type ReachTableExecution }

/**
 * The W0 reference window (design 10.3): `recommendedCandidateSearchDefaults` (Issue #125,
 * REQUIREMENTS 14.1), a Production constant of non-oracle origin. It is a reference value for the
 * caller to pass explicitly; this module applies no window of its own and widens none.
 */
export function reachWindowW0(): ReachWindow {
  return {
    normal: recommendedCandidateSearchDefaults.maxNormalAdvance,
    gogma: recommendedCandidateSearchDefaults.maxGogmaAdvance,
    skill: recommendedCandidateSearchDefaults.maxSkillAdvance,
  }
}

/**
 * Scans every planning Target of the context inside `window` (the Production Stage A scan). `optionSet` (A-2) names the
 * option rule every later Phase applies to the table and is stored on it; the scan itself does not depend on it. It has
 * no default: the caller names the option set it runs (the pre-A-2 protocols name `a1`).
 */
export async function buildReachTable(context: GlobalAssignmentContext, engine: RngEngine, window: ReachWindow, optionSet: ReachOptionSetVersion,
  execution: ReachTableExecution = {}): Promise<ReachTableResult> {
  assertReachWindow(window)
  if (!isReachOptionSetVersion(optionSet)) throw new RangeError(`optionSet must be ${REACH_OPTION_SET_A1} or ${REACH_OPTION_SET_A2} (got ${String(optionSet)}).`)
  const result = await buildProductionReachTable(context, engine, window, researchReachOptionSet(optionSet), execution)
  switch (result.kind) {
    case 'reach_table':
      return { kind: 'reach_table', table: researchReachTableOf(result.table, optionSet) }
    case 'unsupported_input':
      return { ...result, reason: result.reason === 'target_without_source' ? 'unconfirmed_counter' : result.reason }
    case 'cancelled':
      return result
  }
}
