import type { RestorationBonus, RestorationBonusSet } from '../models/publicTypes'

/**
 * Keep Bonuses has no slot selection: it preserves the bonus family at each of
 * the current five slot positions and rerolls only the tier within that family
 * (`AGENTS.md` RNG Rules, `docs/RNG_SPEC.md` 5.3).
 *
 * For a `gogma_artian` scope bonus the semantic family is the `bonusTypeId`
 * itself and the tier is the `bonusRankId`, so one slot's family is read from
 * Domain values alone. No reference/production identifier is involved, and the
 * normal-tier family mapping stays undefined until it is game-verified.
 */
export function gogmaKeepFamilyId(bonus: RestorationBonus): string {
  return bonus.bonusTypeId
}

/**
 * The ordered slot family layout of a complete five-slot Gogma-scope result.
 *
 * Slot order is semantic here: Keep keeps each family in its own position, so
 * `[A, B, A, B, A]` and `[B, A, A, B, A]` are different layouts. The key must
 * never be normalized into an unordered multiset.
 */
export function gogmaKeepFamilyLayoutKey(bonuses: RestorationBonusSet): string {
  return bonuses.map(gogmaKeepFamilyId).join('\u0000')
}
