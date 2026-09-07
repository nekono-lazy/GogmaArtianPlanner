import type { ProductionPlanGenerationObserver } from '../plannerTypes'
import {
  assertPlannerOrchestrationBounds,
  type PlannerOrchestrationBounds,
} from './plannerOrchestrationBounds'

/**
 * Which orchestration bound was reached, as a typed value.
 *
 * Callers branch on `code`; they must never parse the message text. Only the
 * bound that B8-C4a actually consumes exists today. The trial loop and the
 * Entry adoption loop of B8-C4b add their own codes when they are implemented,
 * rather than shipping unused ones now.
 */
export type PlannerOrchestrationLimitCode = 'max_planner_reruns'

/**
 * A B8 orchestration bound was reached (PLANNER_SPEC 9.2.16). Reaching a bound
 * is a stop, never silent exhaustion, so it is surfaced as a typed signal.
 */
export class PlannerOrchestrationLimitError extends Error {
  readonly code: PlannerOrchestrationLimitCode
  /** The configured bound. */
  readonly limit: number
  /** Executions already consumed. The rejected one is not included. */
  readonly used: number

  constructor(code: PlannerOrchestrationLimitCode, limit: number, used: number) {
    super(`Planner orchestration bound '${code}' reached (limit ${limit}, used ${used}).`)
    this.name = 'PlannerOrchestrationLimitError'
    this.code = code
    this.limit = limit
    this.used = used
  }
}

/**
 * A `maxPlannerReruns` budget shaped as a `ProductionPlanGenerationObserver`,
 * so it can be handed straight to `createProductionPlanWithObserver()`.
 *
 * It counts every full Beam Search that actually starts, including the first
 * ordinary one and every runtime-unsupported retry. A rejected execution never
 * started, so it does not consume the budget.
 */
export interface PlannerFullBeamBudget extends ProductionPlanGenerationObserver {
  readonly limit: number
  readonly used: number
}

/**
 * Builds the budget from the caller-supplied bounds. There is no Production
 * default: invalid bounds fail closed rather than being repaired.
 *
 * The budget is deliberately unaware of the initial conflict preflight. The
 * preflight calls `preparePlannerInitialContext()` /
 * `createPlannerRouteUnitPlans()` / `detectPlannerConflicts()` and never runs a
 * Beam Search, so it never reaches this observer and cannot consume the budget.
 */
export function createPlannerFullBeamBudget(
  bounds: PlannerOrchestrationBounds,
): PlannerFullBeamBudget {
  assertPlannerOrchestrationBounds(bounds)
  const limit = bounds.maxPlannerReruns
  let used = 0
  return {
    get limit() {
      return limit
    },
    get used() {
      return used
    },
    beforeBeamSearch() {
      if (used >= limit) {
        throw new PlannerOrchestrationLimitError('max_planner_reruns', limit, used)
      }
      used += 1
    },
  }
}
