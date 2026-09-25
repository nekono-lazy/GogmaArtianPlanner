import {
  defaultPlannerOptions,
  type PlannerOptions,
  type PlannerRunLimitKind,
  type PlannerRunTermination,
} from '../../domain/planner'

/**
 * Test-only Production `PlannerRunTermination` builders.
 *
 * They exist so a test that is not about termination can state one line of
 * intent instead of six fields, and so the Planner runs stay the only
 * production code that derives a status. A Production termination can only
 * name `max_plan_steps` (Issue #103 Phase D-2a).
 */
export function plannerTermination(
  overrides: Partial<PlannerRunTermination> = {},
): PlannerRunTermination {
  return {
    status: 'completed',
    reachedLimits: [],
    limits: { ...defaultPlannerOptions },
    expandedStates: 0,
    completedTargetCount: 1,
    totalTargetCount: 1,
    ...overrides,
  }
}

export function completedPlannerTermination(
  overrides: Partial<PlannerRunTermination> = {},
): PlannerRunTermination {
  return plannerTermination({ status: 'completed', ...overrides })
}

/** A Planner run its `maxPlanSteps` bound truncated before it completed. */
export function incompletePlannerTermination(
  reachedLimits: readonly PlannerRunLimitKind[] = ['max_plan_steps'],
  overrides: Partial<PlannerRunTermination> = {},
): PlannerRunTermination {
  const limits: PlannerOptions =
    overrides.limits ?? { ...defaultPlannerOptions }
  return plannerTermination({
    status: 'incomplete',
    reachedLimits: [...reachedLimits],
    limits,
    expandedStates: limits.maxPlanSteps,
    completedTargetCount: 1,
    totalTargetCount: 2,
    ...overrides,
  })
}

/** A run that ended on its own without completing every Target. */
export function exhaustedPlannerTermination(
  overrides: Partial<PlannerRunTermination> = {},
): PlannerRunTermination {
  return plannerTermination({
    status: 'exhausted',
    completedTargetCount: 0,
    ...overrides,
  })
}
