import type { TargetWeapon, TargetWeaponId } from '../models/publicTypes'
import type {
  PlannerOptions,
  PlannerSearchState,
  PlannerSearchTermination,
  PlannerSearchLimitKind,
} from './plannerTypes'

/**
 * How a bounded Beam Search ended, as typed data (PLANNER_SPEC 7.2.1).
 *
 * This module is the single place the status is derived. UI, Application and
 * Persistence read `PlannerSearchTermination`; they never parse a
 * `PlannerWarning.message` and never re-derive the status from a warning kind.
 * `max_steps_reached` / `max_expanded_states_reached` stay diagnostics that say
 * a bound was touched - which a *completed* search can also do, when the last
 * affordable expansion happened to be the one that completed it.
 */

/** True when this Beam Search may become an executable ProductionPlan. */
export function isPlannerSearchResultUsable(
  termination: PlannerSearchTermination,
): boolean {
  return termination.status !== 'incomplete'
}

function countCompletedTargets(
  bestState: PlannerSearchState | null,
  enabledTargetIds: readonly TargetWeaponId[],
): number {
  if (bestState === null) return 0
  return enabledTargetIds.filter(
    (targetId) => bestState.targetSatisfaction[targetId]?.hasIdeal === true,
  ).length
}

export interface PlannerSearchTerminationInput {
  options: PlannerOptions
  enabledTargetIds: readonly TargetWeaponId[]
  bestState: PlannerSearchState | null
  expandedStates: number
  cancelled: boolean
  reachedStepLimit: boolean
  reachedExpandedLimit: boolean
}

/**
 * Derives the typed termination of one Beam Search.
 *
 * Status precedence, in this order:
 *
 * - `cancelled`  the user stopped the search; nothing about the result is a
 *   statement on feasibility, and the ordinary Planner already returns a safe
 *   `plan: null` for it.
 * - `completed`  every enabled Target reached Ideal. A bound that was touched
 *   on the way stays in `reachedLimits` as a diagnostic and changes nothing.
 * - `incomplete` a `PlannerOptions` bound truncated the search before that, so
 *   the best state is a search artifact, not an answer about the input.
 * - `exhausted`  the search ended on its own without completing every Target.
 *   That is the ordinary "this input yields no better Plan" outcome, not a
 *   truncation, and it keeps its existing meaning and behaviour.
 */
export function createPlannerSearchTermination(
  input: PlannerSearchTerminationInput,
): PlannerSearchTermination {
  const reachedLimits: PlannerSearchLimitKind[] = [
    ...(input.reachedExpandedLimit ? (['max_expanded_states'] as const) : []),
    ...(input.reachedStepLimit ? (['max_plan_steps'] as const) : []),
  ]
  const totalTargetCount = input.enabledTargetIds.length
  const completedTargetCount = countCompletedTargets(
    input.bestState,
    input.enabledTargetIds,
  )
  const isComplete =
    input.bestState !== null &&
    totalTargetCount > 0 &&
    completedTargetCount === totalTargetCount
  const status = input.cancelled
    ? 'cancelled'
    : isComplete
      ? 'completed'
      : reachedLimits.length > 0
        ? 'incomplete'
        : 'exhausted'
  return {
    status,
    reachedLimits,
    limits: { ...input.options },
    expandedStates: input.expandedStates,
    completedTargetCount,
    totalTargetCount,
  }
}

/**
 * The termination of a Planner run that never reached its Beam Search, so no
 * `PlannerOptions` bound was touched. The reason it stopped - an invalid input,
 * or an orchestration bound - is reported by its own warning, never here.
 */
export function createUnsearchedPlannerTermination(
  options: PlannerOptions,
  targetWeapons: readonly TargetWeapon[],
): PlannerSearchTermination {
  return {
    status: 'exhausted',
    reachedLimits: [],
    limits: { ...options },
    expandedStates: 0,
    completedTargetCount: 0,
    totalTargetCount: targetWeapons.filter(({ isEnabled }) => isEnabled).length,
  }
}
