import type { RestorationBonus, RestorationBonusSet, WeaponTypeId } from '../../models/publicTypes'
import { toReferenceWeaponType } from './referenceAdapters'

/**
 * Numeric IDs used solely by the pinned reference Normal lottery. They are
 * deliberately distinct from saved-equipment IDs (where 4 and 6 are swapped).
 */
export type ReferenceNormalLotteryId = 4 | 6 | 7 | 8

export interface ReferenceNormalCandidate {
  readonly referenceId: ReferenceNormalLotteryId
  readonly maximumOccurrences: 2 | 5
}

const ATTACK: ReferenceNormalCandidate = { referenceId: 6, maximumOccurrences: 5 }
const ELEMENT: ReferenceNormalCandidate = { referenceId: 4, maximumOccurrences: 5 }
const SHARPNESS_OR_CAPACITY: ReferenceNormalCandidate = { referenceId: 7, maximumOccurrences: 2 }
const AFFINITY: ReferenceNormalCandidate = { referenceId: 8, maximumOccurrences: 5 }

/** Exact configuredBasePool order for an elementless reference result. */
export const REFERENCE_NORMAL_NONE_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  ATTACK,
  SHARPNESS_OR_CAPACITY,
  AFFINITY,
]

/** Exact configuredBasePool order for every non-none reference result. */
export const REFERENCE_NORMAL_ELEMENTAL_CANDIDATES: readonly ReferenceNormalCandidate[] = [
  ATTACK,
  ELEMENT,
  SHARPNESS_OR_CAPACITY,
  AFFINITY,
]

export type ReferenceNormalSemanticMappingResult =
  | { readonly kind: 'mapped'; readonly bonuses: RestorationBonusSet }
  | {
    readonly kind: 'unmappable'
    readonly reason: 'bow_normal_family_7_has_no_domain_mapping'
    readonly referenceIds: readonly number[]
  }

function requireFiveReferenceIds(referenceIds: readonly number[]): void {
  if (!Array.isArray(referenceIds) || referenceIds.length !== 5) {
    throw new RangeError('Reference Normal result must contain exactly five bonus IDs')
  }
}

function staticNormalBonus(bonusTypeId: string): RestorationBonus {
  return { bonusTypeId, bonusRankId: 'bonus_rank.base' }
}

function sharpnessOrCapacityBonus(weaponTypeId: WeaponTypeId): RestorationBonus | null {
  switch (weaponTypeId) {
    case 'weapon.bow':
      return null
    case 'weapon.light_bowgun':
    case 'weapon.heavy_bowgun':
      return staticNormalBonus('bonus_type.normal_capacity')
    default:
      return staticNormalBonus('bonus_type.normal_sharpness')
  }
}

function mapReferenceNormalId(
  referenceId: number,
  weaponTypeId: WeaponTypeId,
): RestorationBonus | null {
  switch (referenceId) {
    case 4:
      return staticNormalBonus('bonus_type.element')
    case 6:
      return staticNormalBonus('bonus_type.attack')
    case 7:
      return sharpnessOrCapacityBonus(weaponTypeId)
    case 8:
      return staticNormalBonus('bonus_type.affinity')
    default:
      throw new RangeError(`Unsupported reference Normal lottery ID: ${referenceId}`)
  }
}

/**
 * Maps a raw reference result only where the Domain has an unambiguous Normal
 * bonus representation. Bow family 7 is intentionally not guessed.
 */
export function mapReferenceNormalResult(
  weaponTypeId: WeaponTypeId,
  referenceIds: readonly number[],
): ReferenceNormalSemanticMappingResult {
  toReferenceWeaponType(weaponTypeId)
  requireFiveReferenceIds(referenceIds)

  const mapped: RestorationBonus[] = []
  for (const referenceId of referenceIds) {
    const bonus = mapReferenceNormalId(referenceId, weaponTypeId)
    if (bonus === null) {
      return {
        kind: 'unmappable',
        reason: 'bow_normal_family_7_has_no_domain_mapping',
        referenceIds: [...referenceIds],
      }
    }
    mapped.push(bonus)
  }

  return {
    kind: 'mapped',
    bonuses: [mapped[0]!, mapped[1]!, mapped[2]!, mapped[3]!, mapped[4]!],
  }
}
