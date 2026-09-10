import {
  defaultPlannerOptions,
  type PlannerOptions,
  type PlannerSearchLimitKind,
  type PlannerSearchTermination,
} from '../../domain/planner'

/**
 * Test-only `PlannerSearchTermination` builders.
 *
 * They exist so a test that is not about termination can state one line of
 * intent instead of six fields, and so the Beam Search stays the only
 * production code that derives a status.
 */
export function plannerTermination(
  overrides: Partial<PlannerSearchTermination> = {},
): PlannerSearchTermination {
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
  overrides: Partial<PlannerSearchTermination> = {},
): PlannerSearchTermination {
  return plannerTermination({ status: 'completed', ...overrides })
}

/** A search a `PlannerOptions` bound truncated before it completed. */
export function incompletePlannerTermination(
  reachedLimits: readonly PlannerSearchLimitKind[] = ['max_expanded_states'],
  overrides: Partial<PlannerSearchTermination> = {},
): PlannerSearchTermination {
  const limits: PlannerOptions =
    overrides.limits ?? { ...defaultPlannerOptions }
  return plannerTermination({
    status: 'incomplete',
    reachedLimits: [...reachedLimits],
    limits,
    expandedStates: limits.maxExpandedStates,
    completedTargetCount: 1,
    totalTargetCount: 2,
    ...overrides,
  })
}

/** A search that ended on its own without completing every Target. */
export function exhaustedPlannerTermination(
  overrides: Partial<PlannerSearchTermination> = {},
): PlannerSearchTermination {
  return plannerTermination({
    status: 'exhausted',
    completedTargetCount: 0,
    ...overrides,
  })
}
