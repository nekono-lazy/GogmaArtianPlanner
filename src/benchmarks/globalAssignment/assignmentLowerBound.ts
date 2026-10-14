/**
 * Issue #154 Global Assignment Phase B-1 (Research adapter; never imported by the app).
 *
 * The admissible lower bound of a partial assignment (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 10.1) is the Production
 * Domain's (`src/domain/planner/buildListOptimization/assignmentLowerBound.ts`, Issue #260 PR-2). It is not the root lower
 * bound of the Research relaxation module (design 10.2), which stays in the Research. A Research table is handed over
 * with the rule its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type { MinimalStreamEnds, ResetThenKeepIndex, TargetStreamMenu } from '../../domain/planner/buildListOptimization'
import type { PartialResourceAssignment } from './assignmentTypes'
import { productionReachTableOf, type ReachTable, type TargetReach } from './types'

export type { MinimalStreamEnds, TargetStreamMenu, TargetStreamMenuSource } from '../../domain/planner/buildListOptimization'

export function createTargetStreamMenu(target: TargetReach, table: ReachTable, resetThenKeep?: ResetThenKeepIndex): TargetStreamMenu {
  return production.createTargetStreamMenu(target, productionReachTableOf(table), resetThenKeep)
}

export function createTargetStreamMenus(table: ReachTable, resetThenKeepByTarget?: ReadonlyMap<TargetReach['targetWeaponId'], ResetThenKeepIndex>): Map<TargetReach['targetWeaponId'], TargetStreamMenu> {
  return production.createTargetStreamMenus(productionReachTableOf(table), resetThenKeepByTarget)
}

export function minimalStreamEnds(menu: TargetStreamMenu, partial: PartialResourceAssignment, table: ReachTable): MinimalStreamEnds {
  return production.minimalStreamEnds(menu, partial, productionReachTableOf(table))
}

export function partialAssignmentLowerBound(partial: PartialResourceAssignment, unassigned: readonly TargetStreamMenu[], table: ReachTable): number {
  return production.partialAssignmentLowerBound(partial, unassigned, productionReachTableOf(table))
}
