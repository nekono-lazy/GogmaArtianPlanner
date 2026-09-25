import type { TargetWeaponId } from '../models/publicTypes'
import type { PlannerCheckpointRequirements } from './plannerCheckpoints'
import { isPlannerTargetComplete } from './plannerEntryRelevance'
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

/** True when this full Planner run may become an executable ProductionPlan. */
export function isPlannerSearchResultUsable(
  termination: PlannerSearchTermination,
): boolean {
  return termination.status !== 'incomplete'
}

function countCompletedTargets(
  bestState: PlannerSearchState | null,
  planningTargetIds: readonly TargetWeaponId[],
  checkpointRequirements: PlannerCheckpointRequirements,
  unconfirmedTargetIds: ReadonlySet<TargetWeaponId>,
): number {
  if (bestState === null) return 0
  // The same authority the Beam Search uses: a Target with a required
  // checkpoint Entry counts only once that Entry itself was secured.
  return planningTargetIds.filter((targetId) =>
    !unconfirmedTargetIds.has(targetId) &&
    isPlannerTargetComplete(bestState, targetId, checkpointRequirements),
  ).length
}

export interface PlannerSearchTerminationInput {
  options: PlannerOptions
  /**
   * The planning Targets of the run (`PlannerInitialContext.planningTargetIds`):
   * only Targets with a valid BuildListEntry, never every active Target.
   */
  planningTargetIds: readonly TargetWeaponId[]
  checkpointRequirements: PlannerCheckpointRequirements
  bestState: PlannerSearchState | null
  expandedStates: number
  cancelled: boolean
  reachedStepLimit: boolean
  reachedExpandedLimit: boolean
  /**
   * Planning Targets whose `confirm_owned_ideal` a bound withheld (the
   * deterministic scheduler's `maxPlanSteps`, Issue #103 Phase D-1). Such a
   * Target already holds its Ideal but its Step is missing from the trace, so
   * it is never counted complete. Absent means none.
   */
  unconfirmedTargetIds?: ReadonlySet<TargetWeaponId>
}

/**
 * Derives the typed termination of one Beam Search.
 *
 * Status precedence, in this order:
 *
 * - `cancelled`  the user stopped the search; nothing about the result is a
 *   statement on feasibility, and the ordinary Planner already returns a safe
 *   `plan: null` for it.
 * - `completed`  every planning Target is complete: Ideal, and its required
 *   checkpoint Entry secured (PLANNER_SPEC 7.5.6). A bound that was touched
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
  const totalTargetCount = input.planningTargetIds.length
  const completedTargetCount = countCompletedTargets(
    input.bestState,
    input.planningTargetIds,
    input.checkpointRequirements,
    input.unconfirmedTargetIds ?? new Set(),
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
 * `planningTargetIds` is the same planning Target authority a searched run
 * counts (`preparePlannerInitialContext()`), never every active Target.
 */
export function createUnsearchedPlannerTermination(
  options: PlannerOptions,
  planningTargetIds: readonly TargetWeaponId[],
): PlannerSearchTermination {
  return {
    status: 'exhausted',
    reachedLimits: [],
    limits: { ...options },
    expandedStates: 0,
    completedTargetCount: 0,
    totalTargetCount: planningTargetIds.length,
  }
}
