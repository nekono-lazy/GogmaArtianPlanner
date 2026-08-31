import { loadMasterData } from '../../master/loadMasterData'
import { getBonusDefinitionsForWeapon } from '../../master/masterSelectors'
import type { ElementId, RestorationBonus, WeaponTypeId } from '../../models/publicTypes'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  type ReferenceGogmaBonus,
} from './referenceGogmaBonuses'

function bonusKey(bonus: RestorationBonus): string {
  return `${bonus.bonusTypeId}\u0000${bonus.bonusRankId}`
}

function loadAvailabilityMaster() {
  const result = loadMasterData()
  if (!result.ok) {
    throw new Error('Static Master Data is unavailable for game-adjusted Gogma Reset prediction')
  }
  return result.data
}

const availabilityMaster = loadAvailabilityMaster()

/** The Master Data does not permit any fixed reference Reset candidate for this input. */
export class GameAdjustedGogmaResetAvailabilityError extends Error {
  constructor(weaponTypeId: WeaponTypeId, elementId: ElementId) {
    super(`No available reference Gogma Reset candidates for ${weaponTypeId} / ${elementId}`)
    this.name = 'GameAdjustedGogmaResetAvailabilityError'
  }
}

/**
 * Keeps the pinned reference order and removes only candidates unavailable to
 * the requested weapon, element, and Gogma Artian scope in static Master Data.
 * The filtering mechanism is game-verified by the recorded fixtures; inputs
 * outside those observations remain Master-availability generalizations.
 */
export function gameAdjustedGogmaResetCandidatesForWeaponAndElement(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
): readonly ReferenceGogmaBonus[] {
  const availableBonuses = new Set(
    getBonusDefinitionsForWeapon(
      availabilityMaster,
      weaponTypeId,
      elementId,
      'gogma_artian',
    ).map((definition) => bonusKey(definition)),
  )
  const candidates = REFERENCE_GOGMA_RESET_CANDIDATES.filter((candidate) =>
    availableBonuses.has(bonusKey(candidate.bonus)),
  )
  if (candidates.length === 0) {
    throw new GameAdjustedGogmaResetAvailabilityError(weaponTypeId, elementId)
  }
  return candidates
}
