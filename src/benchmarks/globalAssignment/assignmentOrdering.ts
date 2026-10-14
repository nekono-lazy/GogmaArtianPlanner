/**
 * Issue #154 Global Assignment Phase B-1 / C-2 (Research adapter; never imported by the app).
 *
 * The value order of one node, the MRV option count and the coverage-driven value ordering
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.3 / 6.4) are the Production Domain's
 * (`src/domain/planner/buildListOptimization/assignmentOrdering.ts`, Issue #260 PR-2). A Research table is handed over
 * with the rule its option set names (`productionReachTableOf()`).
 */
import * as production from '../../domain/planner/buildListOptimization'
import type {
  FeasibleOptionCount, IndexedSequence, KeyedOptionEnumerator, OrderedOptionEnumerator, PrioritizedOptionEnumerator, PriorityOrderingCounters,
  TargetOptionLattice,
} from '../../domain/planner/buildListOptimization'
import type { PartialResourceAssignment } from './assignmentTypes'
import { productionReachTableOf, type BonusRequirement, type ReachTable, type SkillRequirement, type SourceCandidate, type TargetReach } from './types'

export {
  compareValueOrder,
  createPriorityOrderingCounters,
  valueOrderKey,
  type FeasibleOptionCount,
  type IndexedSequence,
  type KeyedOption,
  type KeyedOptionEnumerator,
  type OrderedOptionEnumerator,
  type PrioritizedOptionEnumerator,
  type PriorityOrderingCounters,
  type TargetOptionLattice,
  type TargetOptionLatticeSource,
  type ValueOrderKey,
} from '../../domain/planner/buildListOptimization'

export function indexedSkillRequirements(target: TargetReach, source: SourceCandidate, table: ReachTable): IndexedSequence<SkillRequirement> {
  return production.indexedSkillRequirements(target, source, productionReachTableOf(table))
}

export function indexedBonusStreams(target: TargetReach, source: SourceCandidate, table: Pick<ReachTable, 'optionSet'>, resetThenKeep: IndexedSequence<BonusRequirement>): IndexedSequence<BonusRequirement>[] {
  return production.indexedBonusStreams(target, source, productionReachTableOf(table), resetThenKeep)
}

export function createTargetOptionLattice(target: TargetReach, table: ReachTable, resetThenKeep?: IndexedSequence<BonusRequirement>): TargetOptionLattice {
  return production.createTargetOptionLattice(target, productionReachTableOf(table), resetThenKeep)
}

export function createKeyedOptionEnumerator(lattice: TargetOptionLattice, table: ReachTable, partial: PartialResourceAssignment): KeyedOptionEnumerator {
  return production.createKeyedOptionEnumerator(lattice, productionReachTableOf(table), partial)
}

export function createOrderedOptionEnumerator(lattice: TargetOptionLattice, table: ReachTable, partial: PartialResourceAssignment): OrderedOptionEnumerator {
  return production.createOrderedOptionEnumerator(lattice, productionReachTableOf(table), partial)
}

export function indexedConversionsAt(target: TargetReach, source: SourceCandidate, table: ReachTable, conversionPosition: number): IndexedSequence<SkillRequirement> {
  return production.indexedConversionsAt(target, source, productionReachTableOf(table), conversionPosition)
}

export function createConversionPriorityEnumerator(lattice: TargetOptionLattice, table: ReachTable, partial: PartialResourceAssignment, conversionPosition: number): KeyedOptionEnumerator {
  return production.createConversionPriorityEnumerator(lattice, productionReachTableOf(table), partial, conversionPosition)
}

export function countFeasibleOptionsUpTo(target: TargetReach, table: ReachTable, partial: PartialResourceAssignment, limit: number,
  onOptionWalked?: () => void): FeasibleOptionCount {
  return production.countFeasibleOptionsUpTo(target, productionReachTableOf(table), partial, limit, onOptionWalked)
}

export function createPrioritizedOptionEnumerator(lattice: TargetOptionLattice, table: ReachTable, partial: PartialResourceAssignment,
  readPriorityConversionPosition: () => number | null, counters: PriorityOrderingCounters, onSkip?: () => void): PrioritizedOptionEnumerator {
  return production.createPrioritizedOptionEnumerator(lattice, productionReachTableOf(table), partial, readPriorityConversionPosition, counters, onSkip)
}
