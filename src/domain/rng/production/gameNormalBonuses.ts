import type { ElementId, WeaponTypeId } from '../../models/publicTypes'
import { toReferenceNormalFinalAttribute, toReferenceWeaponType } from './referenceAdapters'
import type { ReferenceNormalCandidate } from './referenceNormalBonuses'

/*
 * Per-candidate limits of the Production rarity-8 Normal Artian pool
 * (docs/RNG_REFERENCE_AUDIT.md 5.3 / 14.13):
 *
 *   Attack (6)              5
 *   Element (4)             4
 *   Sharpness/Capacity (7)  2
 *   Affinity (8)            3
 *
 * Provenance is not uniform. Attack 5 / Element 4 / Sharpness 2 / Affinity 3
 * were game-verified directly on 1293 attribute-present melee forges (Great
 * Sword, Dual Blades, Hammer, Charge Blade; 6465 slots at Base Seed 51231782,
 * 2026-09-14). Capacity 2 on the Bowguns, Element 4 / Affinity 3 on the Bow,
 * Affinity 3 on the Bowguns, and Affinity 3 in the elementless pools were not
 * boundary-observed in that data set: they are adopted as the Production
 * contract from the user-supplied Game8 limit table and from the existing
 * game-observed Bow / LBG / HBG / Long Sword fixtures not contradicting them.
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

/*
 * Melee category (docs/RNG_REFERENCE_AUDIT.md 14.14).
 *
 * The Melee pools below are the Production contract for every melee weapon
 * type except Switch Axe. Their provenance is two-layered and must be kept
 * apart when described:
 *
 * - Directly game-verified: Long Sword (elemental and elementless 15-slot
 *   fixtures, `gameVerifiedNormalVectors.ts`), and the elemental pool on
 *   Great Sword, Dual Blades, Hammer, and Charge Blade (the 1293-forge /
 *   6465-slot re-verification at Base Seed 51231782, 2026-09-14).
 * - Category-level Production adoption: Sword and Shield, Hunting Horn,
 *   Lance, Gunlance, and Insect Glaive have no direct large-sample
 *   observation, and the elementless pool was not observed on Great Sword /
 *   Dual Blades / Hammer / Charge Blade. They are adopted because five
 *   independent melee weapon streams (Long Sword + the four above) follow one
 *   rule, the user-supplied Game8 table treats every melee weapon except
 *   Switch Axe as one common condition, the elementless pool agrees with the
 *   existing Long Sword none fixture, and the PRNG / seed derivation / weapon
 *   type stream are shared by every weapon type with only the weapon type
 *   numeric value separating the seeds.
 *
 * Switch Axe stays outside the category on purpose: Game8 describes it as a
 * separate table condition, and its pool, its attribute handling, and its
 * mapping onto `NormalArtianAttributeClass` were not covered by any real-game
 * fixture. Never add it here by inference.
 */

/** Production elemental Melee pool `[6, 4, 7, 8]`; see the category note above. */
export const GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_ELEMENT,
  GAME_SHARPNESS_OR_CAPACITY,
  GAME_AFFINITY,
]

/** Production elementless Melee pool `[6, 7, 8]`; see the category note above. */
export const GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  GAME_ATTACK,
  GAME_SHARPNESS_OR_CAPACITY,
  GAME_AFFINITY,
]

/**
 * The explicit allow-list of weapon types that draw from the Melee pools.
 *
 * This is the single place that decides Melee membership. An unknown weapon
 * type, and Switch Axe in particular, is never treated as Melee implicitly:
 * `gameVerifiedNormalCandidatesForWeaponAndElement()` fails closed for every
 * weapon type outside this set and the three ranged cases.
 */
export const PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS: ReadonlySet<WeaponTypeId> = new Set<WeaponTypeId>([
  'weapon.great_sword',
  'weapon.sword_and_shield',
  'weapon.dual_blades',
  'weapon.long_sword',
  'weapon.hammer',
  'weapon.hunting_horn',
  'weapon.lance',
  'weapon.gunlance',
  'weapon.charge_blade',
  'weapon.insect_glaive',
])

/** True only for a weapon type on the explicit Melee allow-list above. */
export function isProductionMeleeNormalPoolWeaponType(weaponTypeId: WeaponTypeId): boolean {
  return PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS.has(weaponTypeId)
}

/** Game verification has not established a Normal pool for this input. */
export class UnsupportedGameVerifiedNormalPredictionError extends Error {
  constructor(weaponTypeId: WeaponTypeId, elementId: ElementId) {
    super(`Game-verified Normal prediction is unsupported for ${weaponTypeId} / ${elementId}`)
    this.name = 'UnsupportedGameVerifiedNormalPredictionError'
  }
}

/**
 * Returns candidates only for an explicitly supported Production Normal pool.
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
    default:
      if (isProductionMeleeNormalPoolWeaponType(weaponTypeId)) {
        return finalAttribute === 1
          ? GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES
          : GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES
      }
      throw new UnsupportedGameVerifiedNormalPredictionError(weaponTypeId, elementId)
  }
}
