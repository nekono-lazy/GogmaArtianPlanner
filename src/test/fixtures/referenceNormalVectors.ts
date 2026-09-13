import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'

/**
 * Reference-verified Normal lottery values for
 * WiseHorror/Gogma-Artian-Roll-Planner GARP.lua v0.9.4
 * (`configured_base_reinforcement_pool`, `draw_base_reinforcement`, and
 * `predict_base_reinforcement`)
 * @ eceb2bd9ca6f4897ec516387acab2ad6beb8b38b.
 * GARP.lua SHA-256:
 * dd9ff4ede166542c1efa4bc13595b2d064c581676c289893946af2f9b5551282.
 * The fixed-hash Lua revalidation passed 23 / 23 cases and 155 slot-level
 * comparisons with no mismatch, including visible rarity 8 mapped to internal
 * rarity 7. Do not regenerate these values from Production code.
 * These are reference-verified parity fixtures, not game-verification claims.
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

export const referenceNormalVectors = {
  allWeaponTypes: [
    { weaponTypeId: 'weapon.great_sword', referenceIds: [4, 6, 7, 7, 4] },
    { weaponTypeId: 'weapon.sword_and_shield', referenceIds: [7, 6, 8, 8, 6] },
    { weaponTypeId: 'weapon.dual_blades', referenceIds: [8, 6, 6, 6, 6] },
    { weaponTypeId: 'weapon.long_sword', referenceIds: [7, 6, 6, 6, 7] },
    { weaponTypeId: 'weapon.hammer', referenceIds: [4, 7, 4, 4, 7] },
    { weaponTypeId: 'weapon.hunting_horn', referenceIds: [7, 8, 8, 6, 6] },
    { weaponTypeId: 'weapon.lance', referenceIds: [7, 7, 6, 6, 8] },
    { weaponTypeId: 'weapon.gunlance', referenceIds: [7, 4, 4, 4, 7] },
    { weaponTypeId: 'weapon.switch_axe', referenceIds: [6, 7, 4, 6, 4] },
    { weaponTypeId: 'weapon.charge_blade', referenceIds: [6, 4, 8, 7, 7] },
    { weaponTypeId: 'weapon.insect_glaive', referenceIds: [6, 4, 8, 6, 4] },
    { weaponTypeId: 'weapon.bow', referenceIds: [6, 8, 6, 4, 6] },
    { weaponTypeId: 'weapon.heavy_bowgun', referenceIds: [7, 4, 7, 8, 6] },
    { weaponTypeId: 'weapon.light_bowgun', referenceIds: [7, 8, 6, 4, 6] },
  ],
  raw: [
    {
      baseSeed: 8524433, weaponTypeId: 'weapon.insect_glaive', elementId: 'element.thunder', rarity: 8, normalCounter: 33,
      referenceIds: [6, 4, 6, 8, 4],
      semanticBonuses: set(attack, element, attack, affinity, element),
    },
    {
      baseSeed: 1, weaponTypeId: 'weapon.great_sword', elementId: 'element.none', rarity: 8, normalCounter: 0,
      referenceIds: [6, 6, 8, 8, 7],
      semanticBonuses: set(attack, attack, affinity, affinity, sharpness),
    },
    {
      baseSeed: 1, weaponTypeId: 'weapon.great_sword', elementId: 'element.none', rarity: 8, normalCounter: 1,
      referenceIds: [6, 7, 8, 6, 6],
      semanticBonuses: set(attack, sharpness, affinity, attack, attack),
    },
    {
      baseSeed: 1, weaponTypeId: 'weapon.great_sword', elementId: 'element.none', rarity: 8, normalCounter: 2,
      referenceIds: [7, 6, 6, 8, 6],
      semanticBonuses: set(sharpness, attack, attack, affinity, attack),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.bow', elementId: 'element.blast', rarity: 8, normalCounter: 0,
      referenceIds: [4, 8, 7, 4, 7],
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.bow', elementId: 'element.blast', rarity: 8, normalCounter: 1,
      referenceIds: [6, 4, 4, 4, 8],
      semanticBonuses: set(attack, element, element, element, affinity),
    },
    {
      baseSeed: 99999999, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.none', rarity: 8, normalCounter: 3,
      referenceIds: [7, 6, 7, 6, 8],
      semanticBonuses: set(capacity, attack, capacity, attack, affinity),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.blast', rarity: 8, normalCounter: 2,
      referenceIds: [7, 6, 4, 6, 6],
      semanticBonuses: set(capacity, attack, element, attack, attack),
    },
    {
      baseSeed: 9876543, weaponTypeId: 'weapon.switch_axe', elementId: 'element.poison', rarity: 8, normalCounter: 4,
      referenceIds: [6, 6, 7, 4, 6],
      semanticBonuses: set(attack, attack, sharpness, element, attack),
    },
  ],
} as const
