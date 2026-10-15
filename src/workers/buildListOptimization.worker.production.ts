import { createProductionPlannerDependencies, type PlannerDependencies } from '../domain/planner'
import {
  runBuildListOptimization,
  type BuildListOptimizationBounds,
} from '../domain/planner/buildListOptimization'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  BuildListOptimizationSearchBoundsUnavailableError,
  type BuildListOptimizationWorkerCalculation,
  type BuildListOptimizationWorkerRuntime,
} from './buildListOptimization.worker'

/**
 * The Production search bounds of the Build List global optimization (`docs/PLANNER_SPEC.md` 17.13): the window, the structural
 * search's node budget and lookahead, the structural candidate and verification budgets, and Stage D's gates and runtime budget.
 *
 * They are not decided yet. 17.19 U2 decides them by PC Browser measurement of this very Production calculation (Issue #260 PR-5),
 * and until then this adapter supplies none: a run is refused (`search_bounds_unavailable`) instead of borrowing the Research
 * registered values, the Candidate Search defaults or a saved setting. PR-5 replaces this `null` with the measured constants; no
 * request, Client, Application or UI ever carries a bound.
 */
export const PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS: BuildListOptimizationBounds | null = null

/** Creates the Production Engine, ID factory and Clock inside the Worker boundary. */
export function createProductionBuildListOptimizationWorkerDependencies(): PlannerDependencies {
  return createProductionPlannerDependencies(new ProductionRngEngine())
}

/**
 * The Production calculation with the given search bounds: `runBuildListOptimization()` itself, handed a copy of the bounds. With
 * `null` it refuses before any Stage. The Domain keeps every bound caller-required (no default, fallback, completion or clamp), and
 * the final verification's `maxPlanSteps` stays the Domain's own derivation: nothing here computes a step bound.
 *
 * This is the one injection point of the bounds: the Production Worker passes `PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS`, and the
 * benchmark-only measurement Worker passes the bounds a measurement run is configured with.
 */
export function createBuildListOptimizationCalculation(
  bounds: BuildListOptimizationBounds | null,
): BuildListOptimizationWorkerCalculation {
  const fixed = bounds === null ? null : structuredClone(bounds)
  return async (input, dependencies, execution) => {
    if (fixed === null) throw new BuildListOptimizationSearchBoundsUnavailableError()
    return runBuildListOptimization(input, dependencies, structuredClone(fixed), execution)
  }
}

/** The Worker runtime over the given search bounds, with the Production dependencies and the Worker's monotonic clock. */
export function createBuildListOptimizationWorkerRuntime(
  bounds: BuildListOptimizationBounds | null,
): BuildListOptimizationWorkerRuntime {
  return {
    createDependencies: createProductionBuildListOptimizationWorkerDependencies,
    calculation: createBuildListOptimizationCalculation(bounds),
    now: () => performance.now(),
  }
}

/** The Production Worker runtime: the Production search bounds (none until PR-5 decides them). */
export function createProductionBuildListOptimizationWorkerRuntime(): BuildListOptimizationWorkerRuntime {
  return createBuildListOptimizationWorkerRuntime(PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS)
}
