import { getBonusRank } from '../master/masterSelectors'
import type {
  AlternativeBonusConditionGroup,
  BonusCondition,
  RestorationBonusSet,
} from '../models/publicTypes'
import type { TargetEvaluationMasterSubset } from './targetEvaluationTypes'

export function assertRestorationBonusRankReferences(
  bonuses: RestorationBonusSet,
  master: TargetEvaluationMasterSubset,
): void {
  bonuses.forEach((bonus) => getBonusRank(master, bonus.bonusRankId))
}

export function evaluateBonusCondition(
  condition: BonusCondition,
  bonuses: RestorationBonusSet,
  master: TargetEvaluationMasterSubset,
): boolean {
  assertRestorationBonusRankReferences(bonuses, master)
  const minimumOrder = getBonusRank(master, condition.minimumRankId).order
  const qualifyingBonuses = bonuses.filter((bonus) => {
    if (bonus.bonusTypeId !== condition.bonusTypeId) return false
    return getBonusRank(master, bonus.bonusRankId).order >= minimumOrder
  })
  const exCount = qualifyingBonuses.filter(
    (bonus) => getBonusRank(master, bonus.bonusRankId).isEx,
  ).length

  return (
    qualifyingBonuses.length >= condition.requiredCount &&
    exCount >= condition.requiredExCount
  )
}

export function evaluateAlternativeBonusConditionGroup(
  group: AlternativeBonusConditionGroup,
  bonuses: RestorationBonusSet,
  master: TargetEvaluationMasterSubset,
): boolean {
  assertRestorationBonusRankReferences(bonuses, master)
  const resolvedOptions = group.options.map((option) => ({
    ...option,
    minimumOrder: getBonusRank(master, option.minimumRankId).order,
  }))

  const matchingSlotCount = bonuses.filter((bonus) =>
    resolvedOptions.some(
      (option) =>
        bonus.bonusTypeId === option.bonusTypeId &&
        getBonusRank(master, bonus.bonusRankId).order >= option.minimumOrder,
    ),
  ).length

  return matchingSlotCount >= group.requiredCount
}

export function evaluatePracticalBonusConditions(
  conditions: readonly BonusCondition[],
  alternativeGroups: readonly AlternativeBonusConditionGroup[],
  bonuses: RestorationBonusSet,
  master: TargetEvaluationMasterSubset,
): boolean {
  return (
    conditions.every((condition) =>
      evaluateBonusCondition(condition, bonuses, master),
    ) &&
    alternativeGroups.every((group) =>
      evaluateAlternativeBonusConditionGroup(group, bonuses, master),
    )
  )
}
