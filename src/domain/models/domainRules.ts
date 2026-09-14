import type {
  CalculationContext,
  RestorationBonusSet,
} from './common'
import type { OwnedWeapon, SkillCondition } from './entities'

function bonusKey(bonus: RestorationBonusSet[number]): string {
  return JSON.stringify([bonus.bonusTypeId, bonus.bonusRankId])
}

function countBonuses(bonuses: RestorationBonusSet): Map<string, number> {
  const counts = new Map<string, number>()
  bonuses.forEach((bonus) => {
    const key = bonusKey(bonus)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

/**
 * Unordered multiset equality with duplicate counts preserved.
 *
 * This is the completed-result contract: Target conditions, Candidate
 * completion, and Candidate semantic identity all compare five slots this way,
 * so slot order alone never creates a second result.
 *
 * It is deliberately NOT the comparison for anything that feeds Keep
 * prediction: use `areRestorationBonusSlotsEqual()` there.
 */
export function areRestorationBonusSetsEqual(
  left: RestorationBonusSet,
  right: RestorationBonusSet,
): boolean {
  const leftCounts = countBonuses(left)
  const rightCounts = countBonuses(right)
  if (leftCounts.size !== rightCounts.size) return false
  return [...leftCounts].every(
    ([key, count]) => rightCounts.get(key) === count,
  )
}

/**
 * Slot-by-slot equality: slot 1 through slot 5 must hold the same
 * `bonusTypeId` and `bonusRankId` in the same positions.
 *
 * Keep Bonuses preserves the bonus family at each slot position and rerolls
 * only the tier, so two results with the identical multiset in a different slot
 * order are different Keep inputs. Wherever that distinction matters, the
 * multiset comparison above is wrong and this one is required.
 */
export function areRestorationBonusSlotsEqual(
  left: RestorationBonusSet,
  right: RestorationBonusSet,
): boolean {
  return left.every(
    (bonus, slot) =>
      bonus.bonusTypeId === right[slot]?.bonusTypeId &&
      bonus.bonusRankId === right[slot]?.bonusRankId,
  )
}

export function isCalculationContextCompatible(
  left: CalculationContext,
  right: CalculationContext,
): boolean {
  return (
    left.gameVersion === right.gameVersion &&
    left.masterDataVersion === right.masterDataVersion &&
    left.rngEngineVersion === right.rngEngineVersion &&
    left.appSchemaVersion === right.appSchemaVersion
  )
}

/**
 * Compatibility for Search and Build List calculation artifacts.
 *
 * App schema 3 changes only Planner physical-action sharing, app schema 4 only
 * how the Planner treats a Route prefix whose shared Counter position another
 * Entry's real operation already passed, and app schema 5 only whether a
 * partial result of a bound-truncated Planner search may be persisted as an
 * executable ProductionPlan. None of the three touches Candidate Search or
 * BuildListEntry snapshot semantics, so a version 2, 3 or 4 BuildCandidate or
 * BuildListEntry remains safe to use under a later version when the other
 * calculation authorities are unchanged. This exception is directional and
 * deliberately narrow: version 1 stays incompatible, it is never a general
 * forward compatibility for future versions, and ProductionPlan compatibility
 * continues to require exact four-field equality.
 */
const COMPATIBLE_BUILD_RESULT_APP_SCHEMA_VERSIONS: ReadonlyMap<number, readonly number[]> =
  new Map([
    [3, [2]],
    [4, [2, 3]],
    [5, [2, 3, 4]],
  ])

export function isBuildResultCalculationContextCompatible(
  result: CalculationContext,
  current: CalculationContext,
): boolean {
  return (
    result.gameVersion === current.gameVersion &&
    result.masterDataVersion === current.masterDataVersion &&
    result.rngEngineVersion === current.rngEngineVersion &&
    (result.appSchemaVersion === current.appSchemaVersion ||
      (
        COMPATIBLE_BUILD_RESULT_APP_SCHEMA_VERSIONS.get(current.appSchemaVersion) ?? []
      ).includes(result.appSchemaVersion))
  )
}

export function canResetBonuses(weapon: OwnedWeapon): boolean {
  return weapon.kind === 'gogma' && !weapon.isProtected
}

/**
 * Keep Bonuses legality of an owned Gogma source.
 *
 * An owned Gogma's five slots are always known, so Keep is legal from either
 * `restorationBonusScope`: the Engine resolves each slot's family from its
 * bonus type alone (Normal-side types through the Master mapping) and the
 * result is `gogma_artian` scope (`docs/SEARCH_SPEC.md` 5.9). Only kind and
 * protection decide; scope and status never do.
 */
export function canKeepBonuses(weapon: OwnedWeapon): boolean {
  return weapon.kind === 'gogma' && !weapon.isProtected
}

export function canResetSkills(weapon: OwnedWeapon): boolean {
  return weapon.kind === 'gogma' && !weapon.isProtected
}

export function isSkillConditionUnconstrained(
  condition: SkillCondition,
): boolean {
  return condition.seriesSkillId === null && condition.groupSkillId === null
}
