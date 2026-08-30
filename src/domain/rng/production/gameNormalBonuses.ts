import type { ElementId, WeaponTypeId } from '../../models/publicTypes'
import { toReferenceNormalFinalAttribute, toReferenceWeaponType } from './referenceAdapters'
import type { ReferenceNormalCandidate } from './referenceNormalBonuses'

/**
 * Game-verified only for an elemental rarity-8 Bow Normal Artian result.
 * Evidence: Base Seed 51231782 / Fire / counters 0, 1, 2 (15 slots).
 */
export const GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  { referenceId: 6, maximumOccurrences: 5 },
  { referenceId: 4, maximumOccurrences: 5 },
  { referenceId: 8, maximumOccurrences: 5 },
]

/** Game verification has not established a Normal pool for this input. */
export class UnsupportedGameVerifiedNormalPredictionError extends Error {
  constructor(weaponTypeId: WeaponTypeId, elementId: ElementId) {
    super(`Game-verified Normal prediction is unsupported for ${weaponTypeId} / ${elementId}`)
    this.name = 'UnsupportedGameVerifiedNormalPredictionError'
  }
}

/**
 * Returns candidates only for the game-verified elemental Bow contract.
 * Callers needing a reference-only result must use predictReferenceNormalRaw.
 */
export function gameVerifiedNormalCandidatesForWeaponAndElement(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
): readonly ReferenceNormalCandidate[] {
  toReferenceWeaponType(weaponTypeId)
  const finalAttribute = toReferenceNormalFinalAttribute(elementId)
  if (weaponTypeId === 'weapon.bow' && finalAttribute !== 1) {
    return GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES
  }
  throw new UnsupportedGameVerifiedNormalPredictionError(weaponTypeId, elementId)
}
