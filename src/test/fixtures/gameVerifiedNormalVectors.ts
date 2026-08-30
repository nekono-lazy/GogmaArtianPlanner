import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'

/**
 * Game-observed Normal Artian Bow results. These establish only the elemental
 * Bow candidate-pool behavior described below; they do not verify all Bows or
 * all game versions.
 */
function bonus(bonusTypeId: string): RestorationBonus {
  return { bonusTypeId, bonusRankId: 'bonus_rank.base' }
}

function set(
  first: RestorationBonus,
  second: RestorationBonus,
  third: RestorationBonus,
  fourth: RestorationBonus,
  fifth: RestorationBonus,
): RestorationBonusSet {
  return [first, second, third, fourth, fifth]
}

const attack = bonus('bonus_type.attack')
const affinity = bonus('bonus_type.affinity')
const element = bonus('bonus_type.element')

export const gameVerifiedBowElementalNormalVectors = [
  {
    baseSeed: 51231782,
    weaponTypeId: 'weapon.bow',
    elementId: 'element.fire',
    rarity: 8,
    normalCounter: 0,
    referenceIds: [4, 4, 7, 6, 4],
    gameLotteryIds: [6, 6, 8, 4, 4],
    bonuses: set(attack, attack, affinity, element, element),
  },
  {
    baseSeed: 51231782,
    weaponTypeId: 'weapon.bow',
    elementId: 'element.fire',
    rarity: 8,
    normalCounter: 1,
    referenceIds: [4, 8, 7, 7, 4],
    gameLotteryIds: [4, 6, 4, 6, 4],
    bonuses: set(element, attack, element, attack, element),
  },
  {
    baseSeed: 51231782,
    weaponTypeId: 'weapon.bow',
    elementId: 'element.fire',
    rarity: 8,
    normalCounter: 2,
    referenceIds: [8, 6, 6, 4, 7],
    gameLotteryIds: [6, 6, 4, 4, 8],
    bonuses: set(attack, attack, element, element, affinity),
  },
] as const
