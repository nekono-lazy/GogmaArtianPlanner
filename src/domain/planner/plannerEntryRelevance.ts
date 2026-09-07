import type { BuildListEntry } from '../models/publicTypes'
import type { PlannerSearchState } from './plannerTypes'

/**
 * The single Planner authority for whether a BuildListEntry can still improve a
 * Target in the given state. The initial conflict preparation and the dynamic
 * Beam Search expansion must never diverge here, so both use this predicate.
 */
export function entryIsRelevantForState(
  state: PlannerSearchState,
  entry: BuildListEntry,
): boolean {
  const satisfaction = state.targetSatisfaction[entry.targetWeaponId]
  return Boolean(
    satisfaction &&
      !satisfaction.hasIdeal &&
      (!satisfaction.hasPractical || entry.candidateSnapshot.category === 'ideal'),
  )
}
