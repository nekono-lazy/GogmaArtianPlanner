import type {
  GroupSkillId,
  IdealDifference,
  RestorationBonus,
  RestorationBonusSet,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'

function bonusesEqual(
  left: RestorationBonus,
  right: RestorationBonus,
): boolean {
  return (
    left.bonusTypeId === right.bonusTypeId &&
    left.bonusRankId === right.bonusRankId
  )
}

export function createIdealDifference(
  target: TargetWeapon,
  finalBonuses: RestorationBonusSet,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
): IdealDifference {
  const matchedCandidateSlots = new Set<number>()
  const missingBonuses: RestorationBonus[] = []

  target.idealBonuses.forEach((idealBonus) => {
    const matchedIndex = finalBonuses.findIndex(
      (candidateBonus, index) =>
        !matchedCandidateSlots.has(index) &&
        bonusesEqual(idealBonus, candidateBonus),
    )
    if (matchedIndex >= 0) {
      matchedCandidateSlots.add(matchedIndex)
    } else {
      missingBonuses.push({ ...idealBonus })
    }
  })

  const extraBonuses = finalBonuses
    .filter((_, index) => !matchedCandidateSlots.has(index))
    .map((bonus) => ({ ...bonus }))
  const matchedBonusCount = matchedCandidateSlots.size
  const seriesSkillMatches =
    target.idealSkillCondition.seriesSkillId === null ||
    target.idealSkillCondition.seriesSkillId === seriesSkillId
  const groupSkillMatches =
    target.idealSkillCondition.groupSkillId === null ||
    target.idealSkillCondition.groupSkillId === groupSkillId

  return {
    missingBonuses,
    extraBonuses,
    matchedBonusCount,
    seriesSkillMatches,
    groupSkillMatches,
    summary: `ボーナス一致 ${matchedBonusCount}/5、シリーズ${seriesSkillMatches ? '一致' : '不一致'}、グループ${groupSkillMatches ? '一致' : '不一致'}`,
  }
}
