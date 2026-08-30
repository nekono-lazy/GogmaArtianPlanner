import type { CalculationContext, RestorationBonusSet } from './common'
import type { OwnedWeapon, SkillCondition } from './entities'

function bonusKey(bonus: RestorationBonusSet[number]): string {
  return JSON.stringify([bonus.bonusTypeId, bonus.bonusRankId])
}

function countBonuses(bonuses: RestorationBonusSet): Map<string, number> {
  const counts = new Map<string, number>()
  bonuses.forEach((bonus) => {
    const key = bonusKey(bonus)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

export function areRestorationBonusSetsEqual(
  left: RestorationBonusSet,
  right: RestorationBonusSet,
): boolean {
  const leftCounts = countBonuses(left)
  const rightCounts = countBonuses(right)
  if (leftCounts.size !== rightCounts.size) return false
  return [...leftCounts].every(
    ([key, count]) => rightCounts.get(key) === count,
  )
}

export function isCalculationContextCompatible(
  left: CalculationContext,
  right: CalculationContext,
): boolean {
  return (
    left.gameVersion === right.gameVersion &&
    left.masterDataVersion === right.masterDataVersion &&
    left.rngEngineVersion === right.rngEngineVersion &&
    left.appSchemaVersion === right.appSchemaVersion
  )
}

export function canUseAsMaterial(weapon: OwnedWeapon): boolean {
  return (
    weapon.kind === 'gogma' &&
    weapon.status === 'material' &&
    !weapon.isProtected
  )
}

export function canResetBonuses(weapon: OwnedWeapon): boolean {
  return weapon.kind === 'gogma' && !weapon.isProtected
}

export function canKeepBonuses(weapon: OwnedWeapon): boolean {
  return (
    weapon.kind === 'gogma' &&
    !weapon.isProtected &&
    weapon.restorationBonusScope === 'gogma_artian'
  )
}

export function canResetSkills(weapon: OwnedWeapon): boolean {
  return weapon.kind === 'gogma'
}

export function isSkillConditionUnconstrained(
  condition: SkillCondition,
): boolean {
  return condition.seriesSkillId === null && condition.groupSkillId === null
}
