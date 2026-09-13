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

/**
 * Six consecutive Reset Bonuses draws recorded directly in game by a
 * GogmaArtianPlanner user on 2026-09-13 (Asia/Tokyo). The Base Seed and
 * starting Gogma Counter came from a GARP live RNG state read. Performing each
 * draw advanced the Gogma Counter; subsequently applying or discarding the
 * rolled bonuses did not change that advance.
 *
 * Semantic Domain bonuses are the fixture authority. Private reference IDs are
 * retained only to verify the observed Japanese bonus transcription against
 * the reference-to-Domain adapter.
 */
export const gameVerifiedGogmaCounterIdentificationVector = {
  provenance: {
    status: 'game-verified',
    liveObservationDate: '2026-09-13',
    timeZone: 'Asia/Tokyo',
    observationSource: 'GogmaArtianPlanner user live-game observation',
    stateSource: 'GARP live RNG state read',
    counterAdvancesWhenDrawPerformed: true,
    subsequentApplyDecisionChangesCounterAdvance: false,
  },
  baseSeed: 51_231_782,
  weaponTypeId: 'weapon.hammer',
  elementId: 'element.paralysis',
  startGogmaCounter: 55,
  actualCounterGate: 200,
  referenceIds: [
    [16, 12, 11, 10, 8],
    [16, 10, 15, 12, 12],
    [16, 9, 15, 10, 6],
    [10, 11, 13, 9, 6],
    [10, 14, 12, 11, 11],
    [15, 8, 12, 10, 13],
  ],
  observations: [
    set(affinityEX, attackIII, elementII, sharpnessEX, attackII),
    set(affinityEX, sharpnessEX, attackEX, attackIII, attackIII),
    set(affinityEX, affinityII, attackEX, sharpnessEX, sharpnessBase),
    set(sharpnessEX, elementII, affinityIII, affinityII, sharpnessBase),
    set(sharpnessEX, elementEX, attackIII, elementII, elementII),
    set(attackEX, attackII, attackIII, sharpnessEX, affinityIII),
  ],
} as const
