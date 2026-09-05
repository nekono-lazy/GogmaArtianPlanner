import type { RestorationBonusSet } from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'

export function compareStableKeys(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

/** Completed five-slot identity: order independent, duplicates preserved. */
export function canonicalBonusMultiset(bonuses: RestorationBonusSet): string[] {
  return bonuses.map(({ bonusTypeId, bonusRankId }) =>
    stableStringify([bonusTypeId, bonusRankId]),
  ).sort(compareStableKeys)
}

/**
 * The completed outcome identity of SEARCH_SPEC 5.5.3: the unordered five-slot
 * multiset, and nothing else.
 *
 * `restorationBonusScope` stays on the solution but is deliberately not part of
 * this key: the retention contract is "the same completed five-slot multiset",
 * so an inherited `normal_artian` solution and a later `gogma_artian` one that
 * reach the same multiset keep only the smaller `gogmaAdvance`. As with every
 * other stream-local retention this is initial-Search omission, not permanent
 * dominance.
 *
 * Each slot is encoded structurally rather than by string concatenation.
 * Master IDs may contain any delimiter, so joining `bonusTypeId` and
 * `bonusRankId` with one would let different pairs collide into one key.
 */
export function bonusOutcomeKey(bonuses: RestorationBonusSet): string {
  return stableStringify(canonicalBonusMultiset(bonuses))
}
