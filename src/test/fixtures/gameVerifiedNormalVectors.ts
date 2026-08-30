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
const sharpness = bonus('bonus_type.normal_sharpness')
const capacity = bonus('bonus_type.normal_capacity')

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

/** Additional game-observed C4-C Normal Artian results at Base Seed 51231782. */
export const gameVerifiedBowNoneNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.none', rarity: 8, normalCounter: 0,
    gameLotteryIds: [8, 8, 6, 6, 8], bonuses: set(affinity, affinity, attack, attack, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.none', rarity: 8, normalCounter: 1,
    gameLotteryIds: [8, 8, 6, 6, 6], bonuses: set(affinity, affinity, attack, attack, attack),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.none', rarity: 8, normalCounter: 2,
    gameLotteryIds: [8, 6, 6, 8, 6], bonuses: set(affinity, attack, attack, affinity, attack),
  },
] as const

export const gameVerifiedLightBowgunFireNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.fire', rarity: 8, normalCounter: 0,
    gameLotteryIds: [8, 8, 7, 7, 8], bonuses: set(affinity, affinity, capacity, capacity, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.fire', rarity: 8, normalCounter: 1,
    gameLotteryIds: [7, 8, 8, 6, 6], bonuses: set(capacity, affinity, affinity, attack, attack),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.fire', rarity: 8, normalCounter: 2,
    gameLotteryIds: [7, 6, 7, 6, 6], bonuses: set(capacity, attack, capacity, attack, attack),
  },
] as const

export const gameVerifiedLightBowgunNoneNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 0,
    gameLotteryIds: [8, 8, 7, 7, 8], bonuses: set(affinity, affinity, capacity, capacity, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 1,
    gameLotteryIds: [7, 8, 8, 6, 6], bonuses: set(capacity, affinity, affinity, attack, attack),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 2,
    gameLotteryIds: [7, 6, 7, 6, 6], bonuses: set(capacity, attack, capacity, attack, attack),
  },
] as const

/** HBG observations begin at the uniquely matched Normal Counter 4. */
export const gameVerifiedHeavyBowgunFireNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.fire', rarity: 8, normalCounter: 4,
    gameLotteryIds: [8, 6, 7, 6, 6], bonuses: set(affinity, attack, capacity, attack, attack),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.fire', rarity: 8, normalCounter: 5,
    gameLotteryIds: [7, 6, 6, 7, 8], bonuses: set(capacity, attack, attack, capacity, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.fire', rarity: 8, normalCounter: 6,
    gameLotteryIds: [7, 6, 8, 7, 6], bonuses: set(capacity, attack, affinity, capacity, attack),
  },
] as const

export const gameVerifiedHeavyBowgunNoneNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 4,
    gameLotteryIds: [8, 6, 7, 6, 6], bonuses: set(affinity, attack, capacity, attack, attack),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 5,
    gameLotteryIds: [7, 6, 6, 7, 8], bonuses: set(capacity, attack, attack, capacity, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 6,
    gameLotteryIds: [7, 6, 8, 7, 6], bonuses: set(capacity, attack, affinity, capacity, attack),
  },
] as const

export const gameVerifiedLongSwordFireNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.fire', rarity: 8, normalCounter: 0,
    gameLotteryIds: [7, 6, 8, 6, 4], bonuses: set(sharpness, attack, affinity, attack, element),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.fire', rarity: 8, normalCounter: 1,
    gameLotteryIds: [4, 7, 6, 7, 8], bonuses: set(element, sharpness, attack, sharpness, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.fire', rarity: 8, normalCounter: 2,
    gameLotteryIds: [6, 8, 7, 4, 7], bonuses: set(attack, affinity, sharpness, element, sharpness),
  },
] as const

export const gameVerifiedLongSwordNoneNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.none', rarity: 8, normalCounter: 0,
    gameLotteryIds: [7, 6, 6, 7, 8], bonuses: set(sharpness, attack, attack, sharpness, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.none', rarity: 8, normalCounter: 1,
    gameLotteryIds: [7, 7, 6, 6, 8], bonuses: set(sharpness, sharpness, attack, attack, affinity),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.none', rarity: 8, normalCounter: 2,
    gameLotteryIds: [6, 6, 6, 6, 7], bonuses: set(attack, attack, attack, attack, sharpness),
  },
] as const
