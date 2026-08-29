import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type {
  CandidateCategory,
  GroupSkillId,
  RestorationBonusSet,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'
import {
  assertRestorationBonusRankReferences,
  evaluatePracticalBonusConditions,
} from './bonusConditionEvaluator'
import { createIdealDifference } from './idealDifference'
import { evaluateSkillCondition } from './skillConditionEvaluator'
import { calculateSimilarityScore, isSimilarToIdeal } from './similarity'
import type {
  TargetEvaluationMasterSubset,
  TargetEvaluationResult,
} from './targetEvaluationTypes'

export function satisfiesIdealTarget(
  target: TargetWeapon,
  finalBonuses: RestorationBonusSet,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  master: TargetEvaluationMasterSubset,
): boolean {
  assertRestorationBonusRankReferences(target.idealBonuses, master)
  assertRestorationBonusRankReferences(finalBonuses, master)
  return (
    areRestorationBonusSetsEqual(target.idealBonuses, finalBonuses) &&
    evaluateSkillCondition(
      target.idealSkillCondition,
      seriesSkillId,
      groupSkillId,
    )
  )
}

export function satisfiesPracticalTarget(
  target: TargetWeapon,
  finalBonuses: RestorationBonusSet,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  master: TargetEvaluationMasterSubset,
): boolean {
  return (
    evaluatePracticalBonusConditions(
      target.practicalBonusConditions,
      target.practicalAlternativeGroups,
      finalBonuses,
      master,
    ) &&
    evaluateSkillCondition(
      target.practicalSkillCondition,
      seriesSkillId,
      groupSkillId,
    )
  )
}

export function classifyCandidate(
  target: TargetWeapon,
  finalBonuses: RestorationBonusSet,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  master: TargetEvaluationMasterSubset,
): CandidateCategory | null {
  if (
    satisfiesIdealTarget(
      target,
      finalBonuses,
      seriesSkillId,
      groupSkillId,
      master,
    )
  ) {
    return 'ideal'
  }
  return satisfiesPracticalTarget(
    target,
    finalBonuses,
    seriesSkillId,
    groupSkillId,
    master,
  )
    ? 'practical'
    : null
}

export function evaluateTargetCandidate(
  target: TargetWeapon,
  finalBonuses: RestorationBonusSet,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  master: TargetEvaluationMasterSubset,
  similarityThreshold: number,
): TargetEvaluationResult {
  const category = classifyCandidate(
    target,
    finalBonuses,
    seriesSkillId,
    groupSkillId,
    master,
  )
  const idealDifference = createIdealDifference(
    target,
    finalBonuses,
    seriesSkillId,
    groupSkillId,
  )
  const similarityScore = calculateSimilarityScore(target, idealDifference)

  return {
    category,
    idealDifference,
    similarityScore,
    isSimilarToIdeal: isSimilarToIdeal(
      category,
      similarityScore,
      similarityThreshold,
    ),
  }
}
