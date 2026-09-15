import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'

/**
 * Game-observed Normal Artian results. Each constant records real forges at
 * Base Seed 51231782 and proves only the weapon type, element, and Counter
 * positions it lists; none verifies all weapons, all elements, or all game
 * versions. Bow provenance is layered (docs/RNG_REFERENCE_AUDIT.md 14.15):
 * Fire, Blast, Poison, Paralysis, Sleep, and none are direct observations,
 * while Water / Thunder / Ice / Dragon have no fixture here and sit on Table A
 * by category-level adoption. Switch Axe (14.16) is a direct observation of
 * its single pool at Counters 0 and 1 only; its occurrence limits are
 * category-level adoption.
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

/*
 * Bow Table A / Table B direct game observations (docs/RNG_REFERENCE_AUDIT.md
 * 14.15). Each row below is a real forge observed directly in the game at
 * Base Seed 51231782 / Normal Counter 0, produced by restoring the same save
 * before every forge so that different elements could be compared at the same
 * PRNG Counter. Fire Counter 0 / 1 were re-observed in the same session and
 * matched `gameVerifiedBowElementalNormalVectors` again; they are not repeated
 * here. Blast drew exactly the Fire result, so it is a Table A element;
 * Poison, Paralysis, and Sleep drew exactly the `gameVerifiedBowNoneNormalVectors`
 * Counter 0 result, so they are Table B elements. Water / Thunder / Ice /
 * Dragon were not observed and have no fixture.
 */

/** Direct game observation: Bow Blast, Counter 0, Table A `[6, 4, 8]`. */
export const gameVerifiedBowBlastNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.blast', rarity: 8, normalCounter: 0,
    gameLotteryIds: [6, 6, 8, 4, 4], bonuses: set(attack, attack, affinity, element, element),
  },
] as const

/** Direct game observation: Bow Poison, Counter 0, Table B `[6, 8]`. */
export const gameVerifiedBowPoisonNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.poison', rarity: 8, normalCounter: 0,
    gameLotteryIds: [8, 8, 6, 6, 8], bonuses: set(affinity, affinity, attack, attack, affinity),
  },
] as const

/** Direct game observation: Bow Paralysis, Counter 0, Table B `[6, 8]`. */
export const gameVerifiedBowParalysisNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.paralysis', rarity: 8, normalCounter: 0,
    gameLotteryIds: [8, 8, 6, 6, 8], bonuses: set(affinity, affinity, attack, attack, affinity),
  },
] as const

/** Direct game observation: Bow Sleep, Counter 0, Table B `[6, 8]`. */
export const gameVerifiedBowSleepNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.sleep', rarity: 8, normalCounter: 0,
    gameLotteryIds: [8, 8, 6, 6, 8], bonuses: set(affinity, affinity, attack, attack, affinity),
  },
] as const

/*
 * Switch Axe single-pool direct game observations (docs/RNG_REFERENCE_AUDIT.md
 * 14.16, 2026-09-15). Base Seed 51231782, Switch Axe rarity 8. The Counter
 * before the investigation was believed to be 0 ("never forged one before")
 * and the three forges below match the existing PRNG / seed derivation /
 * 10-step block at Counters 0 and 1 with the single pool `[6, 4, 7, 8]`
 * (Attack 5 / Element 4 / Sharpness 2 / Affinity 3) exactly, slot order
 * included; the two-observation C / C + 1 pair is unique over 0..5000.
 *
 * `element.none` below is the Domain representation of an elementless
 * configuration built from three parts of all-different attributes. The
 * investigation compared it against a Fire configuration from the same save:
 *
 * - Fire, Counter 0: forged from the pre-investigation save, observed, and
 *   the save was then restored without saving
 * - none, Counter 0: the same save restored again, all-different parts,
 *   observed directly; identical to Fire Counter 0, so the configuration
 *   does not switch the pool
 * - none, Counter 1: the same save restored, Fire forged at Counter 0 again,
 *   then, with no reload in between, all-different parts forged as the very
 *   next Switch Axe; this row is that consecutive second forge
 *
 * These rows prove pool membership, configuration independence, and the
 * Counter 0 -> 1 progression at this seed only. They do not boundary-verify
 * the per-candidate occurrence limits on Switch Axe.
 */

/** Direct game observation: Switch Axe Fire configuration, Counter 0, single pool `[6, 4, 7, 8]`. */
export const gameVerifiedSwitchAxeFireNormalVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.switch_axe', elementId: 'element.fire', rarity: 8, normalCounter: 0,
    gameLotteryIds: [7, 7, 8, 6, 4], bonuses: set(sharpness, sharpness, affinity, attack, element),
  },
] as const

/** Direct game observation: Switch Axe all-different-parts (elementless) configuration, Counters 0 and 1. */
export const gameVerifiedSwitchAxeNoneNormalVectors = [
  {
    // Restored save, all-different parts at Counter 0: identical to the Fire Counter 0 forge.
    baseSeed: 51231782, weaponTypeId: 'weapon.switch_axe', elementId: 'element.none', rarity: 8, normalCounter: 0,
    gameLotteryIds: [7, 7, 8, 6, 4], bonuses: set(sharpness, sharpness, affinity, attack, element),
  },
  {
    // Forged immediately after the Fire Counter 0 forge with no reload: the consecutive Counter 1.
    baseSeed: 51231782, weaponTypeId: 'weapon.switch_axe', elementId: 'element.none', rarity: 8, normalCounter: 1,
    gameLotteryIds: [8, 6, 4, 4, 6], bonuses: set(affinity, attack, element, element, attack),
  },
] as const
