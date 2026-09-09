import type { ElementId, RestorationBonus, WeaponTypeId } from '../../models/publicTypes'
import { MasterDataDomainError, getBonusDefinitionsForWeapon } from '../../master/masterSelectors'
import type { WeaponBonusDefinitionsMasterSubset } from '../../master/masterSelectors'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  type ReferenceGogmaBonus,
  type ReferenceGogmaBonusFamily,
  referenceGogmaKeepFamilyForBonusType,
} from './referenceGogmaBonuses'

function bonusKey(bonus: RestorationBonus): string {
  return `${bonus.bonusTypeId}\u0000${bonus.bonusRankId}`
}

/**
 * The bonus values a `gogma_artian` scope slot may legally hold as a Keep
 * current input.
 *
 * This is deliberately separate from `REFERENCE_GOGMA_RESET_CANDIDATES`. That
 * table is the Reset/Keep **draw result** pool and never produces rank I, but
 * Master Data declares Attack / Affinity / Element rank I under `gogma_artian`
 * scope and such weapons occur in the real game
 * (`docs/RNG_REFERENCE_AUDIT.md` 10.4). A current bonus only selects its slot
 * family, so accepting these tiers adds no reference ID, no draw candidate,
 * and no weight assumption.
 *
 * The tiers below are exactly the distinct `gogma_artian` scope
 * (bonusTypeId, bonusRankId) pairs of `weapon-bonus-definitions`; the
 * accompanying test pins that equality so the two cannot drift. Normal-tier
 * values are absent on purpose: predicting Keep from `normal_artian` scope
 * current bonuses stays unsupported (`docs/RNG_SPEC.md` 6.1).
 */
export const GOGMA_SCOPE_KEEP_CURRENT_BONUSES: readonly RestorationBonus[] = [
  { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.i' },
  { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' },
  { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.iii' },
  { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.i' },
  { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.ii' },
  { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.iii' },
  { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.i' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.gogma_sharpness_capacity', bonusRankId: 'bonus_rank.base' },
  { bonusTypeId: 'bonus_type.gogma_sharpness_capacity', bonusRankId: 'bonus_rank.ex' },
]

const GOGMA_SCOPE_KEEP_CURRENT_BONUS_KEYS: ReadonlySet<string> = new Set(
  GOGMA_SCOPE_KEEP_CURRENT_BONUSES.map(bonusKey),
)

/**
 * The Keep family of one current slot, or null when the value is not a legal
 * `gogma_artian` scope bonus or its type has no reference Keep family.
 */
export function gogmaScopeKeepCurrentBonusFamily(
  bonus: RestorationBonus,
): ReferenceGogmaBonusFamily | null {
  if (!GOGMA_SCOPE_KEEP_CURRENT_BONUS_KEYS.has(bonusKey(bonus))) return null
  return referenceGogmaKeepFamilyForBonusType(bonus.bonusTypeId)
}

/** Rejects a current slot value Keep prediction cannot read a family from. */
export function requireGogmaScopeKeepCurrentBonusFamily(
  bonus: RestorationBonus,
): ReferenceGogmaBonusFamily {
  const family = gogmaScopeKeepCurrentBonusFamily(bonus)
  if (family === null) {
    throw new RangeError(`Unsupported current Gogma bonus for Keep prediction: ${bonus.bonusTypeId} / ${bonus.bonusRankId}`)
  }
  return family
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
