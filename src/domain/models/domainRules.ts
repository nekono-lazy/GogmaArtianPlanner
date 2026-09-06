import type {
  CalculationContext,
  RestorationBonusScope,
  RestorationBonusSet,
} from './common'
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

/**
 * Keep Bonuses legality at one position of a concrete Route sequence.
 *
 * `currentScope` is the route-local Bonus scope the source holds at that
 * position, which a preceding Reset Bonuses in the same Route has already moved
 * to `gogma_artian`. That is why `normal scope -> Reset -> Keep` is legal while
 * `normal scope -> Keep` is not: the restriction is missing Production Keep
 * prediction support for inherited Normal-tier current bonuses (B11), never a
 * game rule forbidding Keep.
 */
export function canKeepBonusesFromScope(
  weapon: OwnedWeapon,
  currentScope: RestorationBonusScope,
): boolean {
  return (
    weapon.kind === 'gogma' &&
    !weapon.isProtected &&
    currentScope === 'gogma_artian'
  )
}

/** Keep Bonuses legality from the weapon's own stored scope. */
export function canKeepBonuses(weapon: OwnedWeapon): boolean {
  return canKeepBonusesFromScope(weapon, weapon.restorationBonusScope)
}

export function canResetSkills(weapon: OwnedWeapon): boolean {
  return weapon.kind === 'gogma'
}

export function isSkillConditionUnconstrained(
  condition: SkillCondition,
): boolean {
  return condition.seriesSkillId === null && condition.groupSkillId === null
}
