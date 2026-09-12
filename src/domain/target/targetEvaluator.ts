import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type {
  CompromiseConditionMatch, GroupSkillId, RestorationBonusScope, RestorationBonusSet,
  SeriesSkillId, TargetWeapon,
} from '../models/publicTypes'
import {
  assertRestorationBonusRankReferences, evaluateAlternativeBonusRule,
  evaluatePracticalBonusConditions,
} from './bonusConditionEvaluator'
import { createIdealDifference } from './idealDifference'
import { evaluateSkillCondition } from './skillConditionEvaluator'
import type { TargetEvaluationMasterSubset, TargetEvaluationResult } from './targetEvaluationTypes'

export function hasPracticalSkillCondition(target: TargetWeapon): boolean {
  const condition = target.practicalSkillCondition
  return condition.seriesSkillId !== null || condition.groupSkillId !== null
}

export function hasTargetCompromise(target: TargetWeapon): boolean {
  return target.practicalBonusConditions.length > 0 || target.alternativeBonusRules.length > 0 ||
    hasPracticalSkillCondition(target)
}

/** Scope is explicit; invalid Master references fail even for normal scope. */
export function satisfiesIdealBonuses(
  target: TargetWeapon, finalBonuses: RestorationBonusSet,
  restorationBonusScope: RestorationBonusScope, master: TargetEvaluationMasterSubset,
): boolean {
  assertRestorationBonusRankReferences(target.idealBonuses, master)
  assertRestorationBonusRankReferences(finalBonuses, master)
  return restorationBonusScope === 'gogma_artian' &&
    areRestorationBonusSetsEqual(target.idealBonuses, finalBonuses)
}

export function evaluateTargetBonusMatch(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  master: TargetEvaluationMasterSubset,
): TargetEvaluationResult['bonusMatch'] {
  if (satisfiesIdealBonuses(target, bonuses, scope, master)) return 'ideal'
  if (scope !== 'gogma_artian') return null
  if (target.practicalBonusConditions.length > 0 && evaluatePracticalBonusConditions(target, bonuses, master)) return 'practical'
  if (target.alternativeBonusRules.some((rule) => evaluateAlternativeBonusRule(rule, target.idealBonuses, bonuses, master))) return 'alternative'
  return null
}

export function evaluateTargetSkillMatch(
  target: TargetWeapon, series: SeriesSkillId | null, group: GroupSkillId | null,
): TargetEvaluationResult['skillMatch'] {
  if (evaluateSkillCondition(target.idealSkillCondition, series, group)) return 'ideal'
  return hasPracticalSkillCondition(target) && evaluateSkillCondition(target.practicalSkillCondition, series, group)
    ? 'practical' : null
}

export function satisfiesIdealTarget(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  series: SeriesSkillId | null, group: GroupSkillId | null, master: TargetEvaluationMasterSubset,
): boolean {
  return satisfiesIdealBonuses(target, bonuses, scope, master) &&
    evaluateSkillCondition(target.idealSkillCondition, series, group)
}

/** Inclusive accepted set, also used for Planner's hasPractical satisfaction. */
export function satisfiesPracticalTarget(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  series: SeriesSkillId | null, group: GroupSkillId | null, master: TargetEvaluationMasterSubset,
): boolean {
  return evaluateTargetBonusMatch(target, bonuses, scope, master) !== null &&
    evaluateTargetSkillMatch(target, series, group) !== null
}

/**
 * Whether one intermediate weapon state is a compromise checkpoint for this
 * Target, and which conditions it satisfies (`docs/SEARCH_SPEC.md` 5.8.1).
 *
 * A state qualifies when both axes match and the pair is not the full Ideal
 * condition, so it covers exactly the combinations the existing Target
 * evaluator already allows - Practical Bonus with Ideal Skill, Ideal Bonus with
 * Practical Skill, Practical with Practical, and the two Alternative Bonus
 * pairings. Alternative is never a search branch of its own.
 *
 * Ideal Bonus already requires `gogma_artian` scope, and so does every
 * compromise Bonus match, so a state whose five slots are still inherited
 * Normal-tier slots can never be a checkpoint.
 */
export function evaluateCompromiseCheckpointCondition(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  series: SeriesSkillId | null, group: GroupSkillId | null, master: TargetEvaluationMasterSubset,
): CompromiseConditionMatch | null {
  const bonus = evaluateTargetBonusMatch(target, bonuses, scope, master)
  const skill = evaluateTargetSkillMatch(target, series, group)
  if (bonus === null || skill === null) return null
  return bonus === 'ideal' && skill === 'ideal' ? null : { bonus, skill }
}

/**
 * The two axis matches plus the ideal difference of one concrete state.
 *
 * It no longer classifies a Candidate: the caller decides what the pair means -
 * `satisfiesIdealTarget()` for a Candidate, and
 * `evaluateCompromiseCheckpointCondition()` for a checkpoint.
 */
export function evaluateTargetCandidate(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  series: SeriesSkillId | null, group: GroupSkillId | null, master: TargetEvaluationMasterSubset,
): TargetEvaluationResult {
  return {
    bonusMatch: evaluateTargetBonusMatch(target, bonuses, scope, master),
    skillMatch: evaluateTargetSkillMatch(target, series, group),
    idealDifference: createIdealDifference(target, bonuses, series, group),
  }
}
