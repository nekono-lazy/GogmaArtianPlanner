import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type {
  CandidateCategory, GroupSkillId, RestorationBonusScope, RestorationBonusSet,
  SeriesSkillId, TargetWeapon,
} from '../models/publicTypes'
import {
  assertRestorationBonusRankReferences, evaluateAlternativeBonusRule,
  evaluatePracticalBonusConditions,
} from './bonusConditionEvaluator'
import { createIdealDifference } from './idealDifference'
import { evaluateSkillCondition } from './skillConditionEvaluator'
import { calculateSimilarityScore, isSimilarToIdeal } from './similarity'
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

export function classifyCandidate(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  series: SeriesSkillId | null, group: GroupSkillId | null, master: TargetEvaluationMasterSubset,
): CandidateCategory | null {
  const bonus = evaluateTargetBonusMatch(target, bonuses, scope, master)
  const skill = evaluateTargetSkillMatch(target, series, group)
  return bonus === null || skill === null ? null : bonus === 'ideal' && skill === 'ideal' ? 'ideal' : 'practical'
}

export function evaluateTargetCandidate(
  target: TargetWeapon, bonuses: RestorationBonusSet, scope: RestorationBonusScope,
  series: SeriesSkillId | null, group: GroupSkillId | null, master: TargetEvaluationMasterSubset,
  similarityThreshold: number,
): TargetEvaluationResult {
  const bonusMatch = evaluateTargetBonusMatch(target, bonuses, scope, master)
  const skillMatch = evaluateTargetSkillMatch(target, series, group)
  const category = bonusMatch === null || skillMatch === null ? null :
    bonusMatch === 'ideal' && skillMatch === 'ideal' ? 'ideal' : 'practical'
  const idealDifference = createIdealDifference(target, bonuses, series, group)
  const similarityScore = calculateSimilarityScore(target, idealDifference)
  return {
    category, bonusMatch, skillMatch, idealDifference, similarityScore,
    isSimilarToIdeal: isSimilarToIdeal(category, similarityScore, similarityThreshold),
  }
}
