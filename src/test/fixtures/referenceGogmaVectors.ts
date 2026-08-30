import type { RestorationBonus, RestorationBonusSet } from '../../domain/models/publicTypes'

/**
 * Literal values extracted by executing WiseHorror/Gogma-Artian-Roll-Planner
 * @ eceb2bd9ca6f4897ec516387acab2ad6beb8b38b app.js in a read-only Node VM.
 * Source functions: initializeGogma, buildGogmaPool, and simulateGogma.
 * Do not regenerate these expected values from this repository's production code.
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

export const referenceGogmaVectors = {
  resets: [
    {
      baseSeed: 8524433, weaponTypeId: 'weapon.insect_glaive', elementId: 'element.thunder', counterGate: 200, gogmaCounter: 45,
      bonuses: set(elementII, affinityIII, affinityII, attackIII, elementII),
    },
    {
      baseSeed: 1, weaponTypeId: 'weapon.great_sword', elementId: 'element.none', counterGate: 0, gogmaCounter: 999,
      bonuses: set(affinityEX, attackEX, attackII, attackII, attackEX),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.great_sword', elementId: 'element.fire', counterGate: 34, gogmaCounter: 999,
      bonuses: set(sharpnessEX, sharpnessBase, affinityII, elementEX, sharpnessBase),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.great_sword', elementId: 'element.fire', counterGate: 35, gogmaCounter: 999,
      bonuses: set(attackIII, elementEX, attackEX, affinityEX, sharpnessBase),
    },
    {
      baseSeed: 99999999, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.blast', counterGate: 36, gogmaCounter: 123,
      bonuses: set(sharpnessEX, affinityEX, affinityII, elementII, affinityII),
    },
  ],
  keeps: [
    {
      baseSeed: 8524433, weaponTypeId: 'weapon.insect_glaive', elementId: 'element.thunder', counterGate: 200, gogmaCounter: 45,
      currentBonuses: set(attackEX, attackIII, attackII, affinityEX, sharpnessEX),
      bonuses: set(attackIII, attackII, attackEX, affinityEX, sharpnessBase),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.great_sword', elementId: 'element.fire', counterGate: 35, gogmaCounter: 2,
      currentBonuses: set(attackII, affinityII, elementII, sharpnessBase, attackEX),
      bonuses: set(attackEX, affinityII, elementII, sharpnessBase, attackIII),
    },
    {
      baseSeed: 1, weaponTypeId: 'weapon.great_sword', elementId: 'element.none', counterGate: 0, gogmaCounter: 999,
      currentBonuses: set(attackII, attackII, attackII, attackII, attackII),
      bonuses: set(attackIII, attackEX, attackIII, attackEX, attackII),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.great_sword', elementId: 'element.fire', counterGate: 34, gogmaCounter: 999,
      currentBonuses: set(attackII, affinityII, elementII, sharpnessBase, attackEX),
      bonuses: set(attackIII, affinityEX, elementEX, sharpnessBase, attackIII),
    },
    {
      baseSeed: 42, weaponTypeId: 'weapon.great_sword', elementId: 'element.fire', counterGate: 35, gogmaCounter: 999,
      currentBonuses: set(attackII, affinityII, elementII, sharpnessBase, attackEX),
      bonuses: set(attackIII, affinityEX, elementEX, sharpnessBase, attackEX),
    },
    {
      baseSeed: 99999999, weaponTypeId: 'weapon.light_bowgun', elementId: 'element.blast', counterGate: 36, gogmaCounter: 123,
      currentBonuses: set(attackII, attackIII, attackEX, affinityII, affinityEX),
      bonuses: set(attackEX, attackII, attackIII, affinityIII, affinityEX),
    },
  ],
  chains: {
    input: {
      baseSeed: 8524433, weaponTypeId: 'weapon.insect_glaive', elementId: 'element.thunder', counterGate: 200, gogmaCounter: 45,
    },
    reset: set(elementII, affinityIII, affinityII, attackIII, elementII),
    firstKeep: set(elementII, affinityII, affinityEX, attackEX, elementII),
    secondKeep: set(elementII, affinityEX, affinityIII, attackEX, elementEX),
  },
} as const
