/**
 * Issue #154 Global Assignment Phase A (Research adapter; never imported by the app).
 *
 * The reach option rules and their lazy, deterministic enumeration (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.3 /
 * 5.2 / 5.4) are the Production Domain's (`src/domain/planner/buildListOptimization/reachOptions.ts`, Issue #260 PR-2).
 * This adapter keeps the Research API: a lane rule is asked by option set identity (`a1` without, `a2` with
 * continuation), and a Research table is handed over with the rule its identity names (`productionReachTableOf()`).
 * No option rule is re-implemented here.
 */
import * as production from '../../domain/planner/buildListOptimization'
import type {
  BonusRequirement, ReachOption, SkillRequirement, SkillRequirementBlocks, SourceLaneAdmission, StreamEnd,
} from '../../domain/planner/buildListOptimization'
import { productionReachTableOf, researchContinuesCurrentIdealLanes, type ReachOptionSetVersion, type ReachTable, type SourceCandidate, type TargetReach } from './types'

export {
  createResetThenKeepIndex,
  enumerateResetThenKeepRequirements,
  keepFromSourcePositions,
  laneAdmitsNone,
  laneAdmitsOperations,
  reachOptionKey,
  resetThenKeepPlan,
  sourceResourceKey,
  type LaneAdmission,
  type ResetThenKeepIndex,
  type ResetThenKeepRequirement,
  type SkillRequirementBlocks,
  type SourceLaneAdmission,
} from '../../domain/planner/buildListOptimization'

/** The one option rule of a source's two lanes (design 5.2, A-2) under a Research option set (see the Production rule). */
export function sourceLaneAdmission(source: SourceCandidate, optionSet: ReachOptionSetVersion): SourceLaneAdmission {
  return production.sourceLaneAdmission(source, researchContinuesCurrentIdealLanes(optionSet))
}

export function skillRequirementBlocks(target: TargetReach, source: SourceCandidate, table: Pick<ReachTable, 'originSkill' | 'optionSet'>): SkillRequirementBlocks {
  return production.skillRequirementBlocks(target, source, productionReachTableOf(table))
}

export function enumerateSkillRequirements(target: TargetReach, source: SourceCandidate, table: ReachTable): Generator<SkillRequirement, void, undefined> {
  return production.enumerateSkillRequirements(target, source, productionReachTableOf(table))
}

export function enumerateBonusRequirements(target: TargetReach, source: SourceCandidate, table: ReachTable): Generator<BonusRequirement, void, undefined> {
  return production.enumerateBonusRequirements(target, source, productionReachTableOf(table))
}

export function reachOptionStreamEnd(target: TargetReach, table: ReachTable, source: SourceCandidate, skill: SkillRequirement, bonus: BonusRequirement): StreamEnd {
  return production.reachOptionStreamEnd(target, productionReachTableOf(table), source, skill, bonus)
}

export function createReachOption(target: TargetReach, table: ReachTable, source: SourceCandidate, skillRequired: SkillRequirement, bonusRequired: BonusRequirement): ReachOption {
  return production.createReachOption(target, productionReachTableOf(table), source, skillRequired, bonusRequired)
}

export function reachOptionObjective(option: ReachOption, table: ReachTable): number {
  return production.reachOptionObjective(option, productionReachTableOf(table))
}

export function enumerateReachOptionsOfSource(target: TargetReach, table: ReachTable, source: SourceCandidate): Generator<ReachOption, void, undefined> {
  return production.enumerateReachOptionsOfSource(target, productionReachTableOf(table), source)
}

export function enumerateReachOptions(target: TargetReach, table: ReachTable): Generator<ReachOption, void, undefined> {
  return production.enumerateReachOptions(target, productionReachTableOf(table))
}

export function takeReachOptions(target: TargetReach, table: ReachTable, limit: number): ReachOption[] {
  return production.takeReachOptions(target, productionReachTableOf(table), limit)
}
