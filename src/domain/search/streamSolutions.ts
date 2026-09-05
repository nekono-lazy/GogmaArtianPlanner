import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type {
  GroupSkillId,
  RestorationBonusScope,
  RestorationBonusSet,
  RouteOperation,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import {
  createBonusIdealDifference,
  evaluatePracticalBonusConditions,
  evaluateSkillCondition,
} from '../target'
import { totalMaterialQuantity } from './candidateFactory'
import type { CandidateSearchInput } from './searchTypes'

/**
 * Locale-independent ordering. `String.prototype.localeCompare` can reorder
 * equal-looking keys per environment, which would move the stream anchors
 * `b0` / `k0` (SEARCH_SPEC 5.5.2 / 5.5.3).
 */
export function compareStableKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * One Skill stream solution as seen by a single Route base, including the
 * zero-operation solution (SEARCH_SPEC 5.5.5).
 *
 * `resetCount = 0` is the Route base's own current Skills: the source Gogma's
 * stored Skills, or the Skills assigned by `convert_normal_to_gogma`.
 */
export interface RouteSkillSolution {
  resetCount: number
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  /** `resetCount` for existing Gogma bases, `resetCount + 1` for conversion. */
  estimatedSkillAdvance: number
  /** Reset Skills operations in execution order; empty when `resetCount = 0`. */
  operations: readonly RouteOperation[]
}

/**
 * One Bonus stream solution as seen by a single Route base, including the
 * zero-operation solution (SEARCH_SPEC 5.5.5).
 *
 * `gogmaAdvance = 0` is the Route base's own five slots: the source Gogma's
 * stored bonuses, or the five `normal_artian` scope slots a conversion
 * inherits. `lastResetDepth` carries the canonical amendment history so the
 * existing-Gogma RouteKind follows from `(d, lastResetDepth)` alone.
 */
export interface RouteBonusSolution {
  gogmaAdvance: number
  lastResetDepth: number
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  /** Bonus amendment operations in execution order; empty when `d = 0`. */
  operations: readonly RouteOperation[]
}

/** Which stream predicate selects an axis; never the final Candidate category. */
export type StreamCategoryPredicate = 'ideal' | 'practical'

export interface EvaluatedSkillSolution {
  /** Position in the retained, deterministically ordered stream set. */
  index: number
  solution: RouteSkillSolution
  idealMatch: boolean
  practicalMatch: boolean
  /** Matched count among the series / group actually specified by Ideal. */
  idealCloseness: number
  semanticKey: string
}

export interface EvaluatedBonusSolution {
  index: number
  solution: RouteBonusSolution
  idealMatch: boolean
  practicalMatch: boolean
  matchedIdealBonusCount: number
  /** Anchor-ordering tie-break only; never a Practical dominance input. */
  materialQuantity: number
  bonusKey: string
  operationTypeKey: string
}

/**
 * SEARCH_SPEC 5.5.2 stream-local ideal closeness. A `null` side of
 * `idealSkillCondition` is unconstrained, so it is never counted as a match.
 * This is the same quantity `calculateSimilarityScore()` adds on the Skill side.
 */
function skillIdealCloseness(
  target: TargetWeapon,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
): number {
  const condition = target.idealSkillCondition
  return (
    Number(
      condition.seriesSkillId !== null &&
        condition.seriesSkillId === seriesSkillId,
    ) +
    Number(
      condition.groupSkillId !== null && condition.groupSkillId === groupSkillId,
    )
  )
}

/**
 * The completed outcome identity of SEARCH_SPEC 5.5.3: the unordered five-slot
 * multiset, and nothing else.
 *
 * `restorationBonusScope` stays on the solution but is deliberately not part of
 * this key: the retention contract is "the same completed five-slot multiset",
 * so an inherited `normal_artian` solution and a later `gogma_artian` one that
 * reach the same multiset keep only the smaller `gogmaAdvance`. As with every
 * other stream-local retention this is initial-Search omission, not permanent
 * dominance.
 *
 * Each slot is encoded structurally rather than by string concatenation.
 * Master IDs may contain any delimiter, so joining `bonusTypeId` and
 * `bonusRankId` with one would let different pairs collide into one key.
 */
function bonusOutcomeKey(bonuses: RestorationBonusSet): string {
  return stableStringify(
    bonuses
      .map((bonus) => stableStringify([bonus.bonusTypeId, bonus.bonusRankId]))
      .sort(compareStableKeys),
  )
}

function evaluateSkillSolution(
  target: TargetWeapon,
  solution: RouteSkillSolution,
): Omit<EvaluatedSkillSolution, 'index'> {
  return {
    solution,
    idealMatch: evaluateSkillCondition(
      target.idealSkillCondition,
      solution.seriesSkillId,
      solution.groupSkillId,
    ),
    practicalMatch: evaluateSkillCondition(
      target.practicalSkillCondition,
      solution.seriesSkillId,
      solution.groupSkillId,
    ),
    idealCloseness: skillIdealCloseness(
      target,
      solution.seriesSkillId,
      solution.groupSkillId,
    ),
    semanticKey: stableStringify({
      seriesSkillId: solution.seriesSkillId,
      groupSkillId: solution.groupSkillId,
    }),
  }
}

function evaluateBonusSolution(
  target: TargetWeapon,
  input: Pick<CandidateSearchInput, 'master'>,
  solution: RouteBonusSolution,
): Omit<EvaluatedBonusSolution, 'index'> {
  return {
    solution,
    idealMatch: areRestorationBonusSetsEqual(
      target.idealBonuses,
      solution.finalBonuses,
    ),
    practicalMatch: evaluatePracticalBonusConditions(
      target.practicalBonusConditions,
      target.practicalAlternativeGroups,
      solution.finalBonuses,
      input.master,
    ),
    matchedIdealBonusCount: createBonusIdealDifference(
      target.idealBonuses,
      solution.finalBonuses,
    ).matchedBonusCount,
    materialQuantity: totalMaterialQuantity(
      solution.operations,
      target.weaponTypeId,
      input,
    ),
    bonusKey: bonusOutcomeKey(solution.finalBonuses),
    operationTypeKey: solution.operations
      .map((operation) => operation.type)
      .join(','),
  }
}

/** SEARCH_SPEC 5.5.2 ordering: resetCount, ideal closeness, stable key. */
export function compareSkillSolutions(
  left: Omit<EvaluatedSkillSolution, 'index'>,
  right: Omit<EvaluatedSkillSolution, 'index'>,
): number {
  return (
    left.solution.resetCount - right.solution.resetCount ||
    right.idealCloseness - left.idealCloseness ||
    compareStableKeys(left.semanticKey, right.semanticKey)
  )
}

/**
 * SEARCH_SPEC 5.5.3 ordering: gogmaAdvance, ideal closeness, summed material
 * quantity, then the stable semantic key (completed multiset, then operation
 * type sequence).
 */
export function compareBonusSolutions(
  left: Omit<EvaluatedBonusSolution, 'index'>,
  right: Omit<EvaluatedBonusSolution, 'index'>,
): number {
  return (
    left.solution.gogmaAdvance - right.solution.gogmaAdvance ||
    right.matchedIdealBonusCount - left.matchedIdealBonusCount ||
    left.materialQuantity - right.materialQuantity ||
    compareStableKeys(left.bonusKey, right.bonusKey) ||
    compareStableKeys(left.operationTypeKey, right.operationTypeKey)
  )
}

/**
 * Evaluates, retains, and deterministically orders the Skill stream solutions
 * of one Route base.
 *
 * Retention keeps the smallest `resetCount` per `(seriesSkillId, groupSkillId)`
 * (SEARCH_SPEC 5.5.2). That is an initial-Search retention rule, not a
 * permanent Planner dominance: a later position reaching the same Skills stays
 * reachable by the constrained re-search (5.6.4).
 */
export function buildSkillSolutionSet(
  target: TargetWeapon,
  solutions: readonly RouteSkillSolution[],
): EvaluatedSkillSolution[] {
  const retained = new Map<string, Omit<EvaluatedSkillSolution, 'index'>>()
  solutions.forEach((solution) => {
    const evaluated = evaluateSkillSolution(target, solution)
    const current = retained.get(evaluated.semanticKey)
    if (!current || compareSkillSolutions(evaluated, current) < 0) {
      retained.set(evaluated.semanticKey, evaluated)
    }
  })
  return [...retained.values()]
    .sort(compareSkillSolutions)
    .map((evaluated, index) => ({ ...evaluated, index }))
}

/**
 * Evaluates, retains, and deterministically orders the Bonus stream solutions
 * of one Route base.
 *
 * Retention keeps the smallest `gogmaAdvance` per completed outcome
 * (SEARCH_SPEC 5.5.3), compared as an unordered five-slot multiset so slot
 * order alone never creates a second solution and `restorationBonusScope`
 * never splits one outcome in two. Ties at the same depth pick the
 * representative that comes first in the ordering above. As with the Skill
 * stream this is initial-Search retention, not permanent dominance.
 */
export function buildBonusSolutionSet(
  target: TargetWeapon,
  input: Pick<CandidateSearchInput, 'master'>,
  solutions: readonly RouteBonusSolution[],
): EvaluatedBonusSolution[] {
  const retained = new Map<string, Omit<EvaluatedBonusSolution, 'index'>>()
  solutions.forEach((solution) => {
    const evaluated = evaluateBonusSolution(target, input, solution)
    const current = retained.get(evaluated.bonusKey)
    if (!current || compareBonusSolutions(evaluated, current) < 0) {
      retained.set(evaluated.bonusKey, evaluated)
    }
  })
  return [...retained.values()]
    .sort(compareBonusSolutions)
    .map((evaluated, index) => ({ ...evaluated, index }))
}

/** `K(c)`: the ordered Skill solutions satisfying the category's predicate. */
export function selectSkillAxis(
  set: readonly EvaluatedSkillSolution[],
  category: StreamCategoryPredicate,
): EvaluatedSkillSolution[] {
  return set.filter((entry) =>
    category === 'ideal' ? entry.idealMatch : entry.practicalMatch,
  )
}

/** `B(c)`: the ordered Bonus solutions satisfying the category's predicate. */
export function selectBonusAxis(
  set: readonly EvaluatedBonusSolution[],
  category: StreamCategoryPredicate,
): EvaluatedBonusSolution[] {
  return set.filter((entry) =>
    category === 'ideal' ? entry.idealMatch : entry.practicalMatch,
  )
}
