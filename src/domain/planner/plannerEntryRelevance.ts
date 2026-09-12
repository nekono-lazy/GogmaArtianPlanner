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
  // Every Candidate is a canonical Ideal Candidate, so an Entry stays relevant
  // until its Target actually holds an Ideal weapon. A Target that only holds a
  // Practical weapon still needs its Ideal Route - and that Route may be the
  // very one carrying the user's selected checkpoints.
  return Boolean(state.targetSatisfaction[entry.targetWeaponId]?.hasIdeal === false)
}
