import type {
  CandidateCategory,
  IdealDifference,
  TargetWeapon,
} from '../models/publicTypes'
import { TargetEvaluationError } from './targetEvaluationTypes'

export function calculateSimilarityScore(
  target: TargetWeapon,
  idealDifference: IdealDifference,
): number {
  const specifiedIdealSkillCount =
    Number(target.idealSkillCondition.seriesSkillId !== null) +
    Number(target.idealSkillCondition.groupSkillId !== null)
  const matchedSpecifiedIdealSkillCount =
    Number(
      target.idealSkillCondition.seriesSkillId !== null &&
        idealDifference.seriesSkillMatches,
    ) +
    Number(
      target.idealSkillCondition.groupSkillId !== null &&
        idealDifference.groupSkillMatches,
    )
  const comparableItemCount = 5 + specifiedIdealSkillCount
  const matchedItemCount =
    idealDifference.matchedBonusCount + matchedSpecifiedIdealSkillCount
  const score = matchedItemCount / comparableItemCount
  return Math.max(0, Math.min(1, score))
}

export function isSimilarToIdeal(
  category: CandidateCategory | null,
  similarityScore: number,
  similarityThreshold: number,
): boolean {
  if (
    !Number.isFinite(similarityThreshold) ||
    similarityThreshold < 0 ||
    similarityThreshold > 1
  ) {
    throw new TargetEvaluationError(
      'invalid_similarity_threshold',
      'similarityThreshold must be a finite number from 0 through 1.',
    )
  }
  return category === 'practical' && similarityScore >= similarityThreshold
}
