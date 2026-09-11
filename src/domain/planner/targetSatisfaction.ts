import type { TargetEvaluationMasterSubset } from '../target'
import { satisfiesIdealTarget, satisfiesPracticalTarget } from '../target'
import type { OwnedWeapon, TargetWeapon } from '../models/publicTypes'
import type { TargetSatisfaction } from './plannerTypes'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Derives enabled Target satisfaction from Gogma inventory, never weapon status. */
export function deriveTargetSatisfaction(
  targetWeapons: readonly TargetWeapon[], ownedWeapons: readonly OwnedWeapon[], master: TargetEvaluationMasterSubset,
): TargetSatisfaction[] {
  return targetWeapons.filter(({ isEnabled }) => isEnabled).sort((left, right) => compareStableStrings(left.id, right.id)).map((target) => {
    const practicalIds = new Set<string>()
    const idealIds = new Set<string>()
    ownedWeapons.forEach((weapon) => {
      if (weapon.kind !== 'gogma' || weapon.weaponTypeId !== target.weaponTypeId || weapon.elementId !== target.elementId) return
      const isIdeal = satisfiesIdealTarget(target, weapon.restorationBonuses, weapon.restorationBonusScope, weapon.seriesSkillId, weapon.groupSkillId, master)
      const isPractical = isIdeal || satisfiesPracticalTarget(target, weapon.restorationBonuses, weapon.restorationBonusScope, weapon.seriesSkillId, weapon.groupSkillId, master)
      if (isPractical) practicalIds.add(weapon.id)
      if (isIdeal) idealIds.add(weapon.id)
    })
    const practicalOwnedWeaponIds = [...practicalIds].sort(compareStableStrings) as TargetSatisfaction['practicalOwnedWeaponIds']
    const idealOwnedWeaponIds = [...idealIds].sort(compareStableStrings) as TargetSatisfaction['idealOwnedWeaponIds']
    return { targetWeaponId: target.id, hasPractical: practicalOwnedWeaponIds.length > 0, hasIdeal: idealOwnedWeaponIds.length > 0, practicalOwnedWeaponIds, idealOwnedWeaponIds }
  })
}

export function areAllEnabledTargetsAlreadySatisfied(satisfaction: readonly TargetSatisfaction[]): boolean {
  return satisfaction.length > 0 && satisfaction.every(({ hasIdeal }) => hasIdeal)
}
