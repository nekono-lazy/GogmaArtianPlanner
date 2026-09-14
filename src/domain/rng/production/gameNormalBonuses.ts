import type { ElementId, WeaponTypeId } from '../../models/publicTypes'
import { toReferenceNormalFinalAttribute, toReferenceWeaponType } from './referenceAdapters'
import type { ReferenceNormalCandidate } from './referenceNormalBonuses'

/*
 * Game-verified per-candidate limits of the real rarity-8 Normal Artian lottery
 * (docs/RNG_REFERENCE_AUDIT.md 5.3, 2026-09-14 re-verification of 1293 forges /
 * 6465 slots at Base Seed 51231782):
 *
 *   Attack (6)              5
 *   Element (4)             4
 *   Sharpness/Capacity (7)  2
 *   Affinity (8)            3
 *
 * They deliberately differ from the pinned reference pools in
 * `referenceNormalBonuses.ts`, which cap Element and Affinity at 5 and are kept
 * unchanged as the reference parity contract.
 */
const GAME_ATTACK: ReferenceNormalCandidate = { referenceId: 6, maximumOccurrences: 5 }
const GAME_ELEMENT: ReferenceNormalCandidate = { referenceId: 4, maximumOccurrences: 4 }
const GAME_SHARPNESS_OR_CAPACITY: ReferenceNormalCandidate = { referenceId: 7, maximumOccurrences: 2 }
const GAME_AFFINITY: ReferenceNormalCandidate = { referenceId: 8, maximumOccurrences: 3 }

/**
 * Game-verified only for an elemental rarity-8 Bow Normal Artian result.
 * Evidence: Base Seed 51231782 / Fire / counters 0, 1, 2 (15 slots).
 */
export const GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_ELEMENT,
  GAME_AFFINITY,
]

/** Game-verified for an elementless rarity-8 Bow Normal Artian result. */
export const GAME_VERIFIED_BOW_NONE_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_AFFINITY,
]

/** Game-verified for both elemental and elementless rarity-8 Light Bowgun results. */
export const GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_SHARPNESS_OR_CAPACITY,
  GAME_AFFINITY,
]

/** Game-verified for both elemental and elementless rarity-8 Heavy Bowgun results. */
export const GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_SHARPNESS_OR_CAPACITY,
  GAME_AFFINITY,
]

/** Game-verified for an elemental rarity-8 Long Sword Normal Artian result. */
export const GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_ELEMENT,
  GAME_SHARPNESS_OR_CAPACITY,
  GAME_AFFINITY,
]

/** Game-verified for an elementless rarity-8 Long Sword Normal Artian result. */
export const GAME_VERIFIED_LONG_SWORD_NONE_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_SHARPNESS_OR_CAPACITY,
  GAME_AFFINITY,
]

/** Game verification has not established a Normal pool for this input. */
export class UnsupportedGameVerifiedNormalPredictionError extends Error {
  constructor(weaponTypeId: WeaponTypeId, elementId: ElementId) {
    super(`Game-verified Normal prediction is unsupported for ${weaponTypeId} / ${elementId}`)
    this.name = 'UnsupportedGameVerifiedNormalPredictionError'
  }
}

/**
 * Returns candidates only for an explicitly game-verified Normal pool.
 * Callers needing a reference-only result must use predictReferenceNormalRaw.
 */
export function gameVerifiedNormalCandidatesForWeaponAndElement(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
): readonly ReferenceNormalCandidate[] {
  toReferenceWeaponType(weaponTypeId)
  const finalAttribute = toReferenceNormalFinalAttribute(elementId)
  switch (weaponTypeId) {
    case 'weapon.bow':
      return finalAttribute === 1
        ? GAME_VERIFIED_BOW_NONE_NORMAL_CANDIDATES
        : GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES
    case 'weapon.light_bowgun':
      return GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES
    case 'weapon.heavy_bowgun':
      return GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES
    case 'weapon.long_sword':
      return finalAttribute === 1
        ? GAME_VERIFIED_LONG_SWORD_NONE_NORMAL_CANDIDATES
        : GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES
    default:
      throw new UnsupportedGameVerifiedNormalPredictionError(weaponTypeId, elementId)
  }
}
