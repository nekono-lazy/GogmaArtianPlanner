import type { ElementId, RestorationBonus, WeaponTypeId } from '../../models/publicTypes'
import { MasterDataDomainError, getBonusDefinitionsForWeapon } from '../../master/masterSelectors'
import type { WeaponBonusDefinitionsMasterSubset } from '../../master/masterSelectors'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  type ReferenceGogmaBonus,
} from './referenceGogmaBonuses'

function bonusKey(bonus: RestorationBonus): string {
  return `${bonus.bonusTypeId}\u0000${bonus.bonusRankId}`
}

export type GameAdjustedGogmaMasterSubset = WeaponBonusDefinitionsMasterSubset

/** The Master Data does not permit any fixed reference Reset candidate for this input. */
export class GameAdjustedGogmaResetAvailabilityError extends Error {
  constructor(weaponTypeId: WeaponTypeId, elementId: ElementId) {
    super(`No available reference Gogma Reset candidates for ${weaponTypeId} / ${elementId}`)
    this.name = 'GameAdjustedGogmaResetAvailabilityError'
  }
}

export class GameAdjustedGogmaResetMasterDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameAdjustedGogmaResetMasterDataError'
  }
}

/**
 * Keeps the pinned reference order and removes only candidates unavailable to
 * the requested weapon, element, and Gogma Artian scope in caller-supplied Master data.
 * The filtering mechanism is game-verified by the recorded fixtures; inputs
 * outside those observations remain Master-availability generalizations.
 */
export function gameAdjustedGogmaResetCandidatesForWeaponAndElement(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
  master: GameAdjustedGogmaMasterSubset,
): readonly ReferenceGogmaBonus[] {
  let definitions
  try {
    definitions = getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, 'gogma_artian')
  } catch (error) {
    if (error instanceof MasterDataDomainError) {
      throw new GameAdjustedGogmaResetMasterDataError(error.message)
    }
    throw error
  }
  const availableBonuses = new Set(definitions.map((definition) => bonusKey(definition)))
  const candidates = REFERENCE_GOGMA_RESET_CANDIDATES.filter((candidate) =>
    availableBonuses.has(bonusKey(candidate.bonus)),
  )
  if (candidates.length === 0) {
    throw new GameAdjustedGogmaResetAvailabilityError(weaponTypeId, elementId)
  }
  return candidates
}
