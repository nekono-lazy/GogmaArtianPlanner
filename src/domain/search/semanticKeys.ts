import type { RestorationBonusScope, RestorationBonusSet } from '../models/publicTypes'
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
 * Pure unordered five-slot multiset key, with duplicate counts preserved.
 * Structural slot encoding avoids collisions between IDs containing delimiters.
 * Stream retention additionally requires scope; use bonusSolutionRetentionKey.
 */
export function bonusOutcomeKey(bonuses: RestorationBonusSet): string {
  return stableStringify(canonicalBonusMultiset(bonuses))
}

/** SEARCH_SPEC 5.5.3 initial-Search identity, not permanent dominance. */
export function bonusSolutionRetentionKey(
  bonuses: RestorationBonusSet,
  restorationBonusScope: RestorationBonusScope,
): string {
  return stableStringify([restorationBonusScope, bonusOutcomeKey(bonuses)])
}
