import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'

/**
 * Game-observed Gogma Reset / Keep results at Base Seed 51231782. Reset
 * fixtures prove only the listed conditions; they do not verify every weapon,
 * element, or game version.
 */
function bonus(bonusTypeId: string, bonusRankId: string): RestorationBonus {
  return { bonusTypeId, bonusRankId }
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

const attackII = bonus('bonus_type.attack', 'bonus_rank.ii')
const attackIII = bonus('bonus_type.attack', 'bonus_rank.iii')
const attackEX = bonus('bonus_type.attack', 'bonus_rank.ex')
const affinityII = bonus('bonus_type.affinity', 'bonus_rank.ii')
const affinityIII = bonus('bonus_type.affinity', 'bonus_rank.iii')
const affinityEX = bonus('bonus_type.affinity', 'bonus_rank.ex')
const elementII = bonus('bonus_type.element', 'bonus_rank.ii')
const elementEX = bonus('bonus_type.element', 'bonus_rank.ex')
const sharpnessBase = bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.base')
const sharpnessEX = bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.ex')

export const gameVerifiedGogmaResetVectors = [
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.fire', counterGate: 200, gogmaCounter: 55,
    candidateIds: [8, 12, 15, 9, 13, 16, 11, 14], referenceIds: [8, 9, 16, 11, 14],
    bonuses: set(attackII, affinityII, affinityEX, elementII, elementEX),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId: 'element.none', counterGate: 200, gogmaCounter: 55,
    candidateIds: [8, 12, 15, 9, 13, 16], referenceIds: [12, 13, 9, 13, 15],
    bonuses: set(attackIII, affinityIII, affinityII, affinityIII, attackEX),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.fire', counterGate: 200, gogmaCounter: 56,
    candidateIds: [8, 12, 15, 9, 13, 16, 6, 10], referenceIds: [13, 12, 6, 9, 8],
    bonuses: set(affinityIII, attackIII, sharpnessBase, affinityII, attackII),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.heavy_bowgun', elementId: 'element.fire', counterGate: 200, gogmaCounter: 56,
    candidateIds: [8, 12, 15, 9, 13, 16, 6, 10], referenceIds: [13, 10, 8, 8, 15],
    bonuses: set(affinityIII, sharpnessEX, attackII, attackII, attackEX),
  },
  {
    baseSeed: 51231782, weaponTypeId: 'weapon.long_sword', elementId: 'element.none', counterGate: 200, gogmaCounter: 55,
    candidateIds: [8, 12, 15, 9, 13, 16, 6, 10], referenceIds: [10, 15, 9, 13, 6],
    bonuses: set(sharpnessEX, attackEX, affinityII, affinityIII, sharpnessBase),
  },
] as const

export const gameVerifiedGogmaKeepVector = {
  baseSeed: 51231782,
  weaponTypeId: 'weapon.bow',
  elementId: 'element.fire',
  counterGate: 200,
  gogmaCounter: 56,
  currentReferenceIds: [8, 9, 16, 11, 14],
  referenceIds: [8, 13, 16, 11, 11],
  currentBonuses: set(attackII, affinityII, affinityEX, elementII, elementEX),
  bonuses: set(attackII, affinityIII, affinityEX, elementII, elementII),
} as const
