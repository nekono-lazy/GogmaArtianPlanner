import {
  createProductionPlan,
  createProductionPlanWithConstrainedSearch,
  createProductionPlannerDependencies,
  type CreateConstrainedProductionPlanCalculation,
  type PlannerDependencies,
} from '../domain/planner'
import {
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import type { RngEngine } from '../domain/rng/rngEngine'
import { defaultConstrainedEnumerationBounds } from '../domain/search'
import type { PlannerWorkerCalculations } from './planner.worker'

/** Creates the active Planner Engine inside the Worker boundary. */
export function createProductionPlannerRngEngine(): RngEngine {
  return new ProductionRngEngine()
}

/** Composes all runtime-only Planner dependencies inside the Worker. */
export function createProductionPlannerWorkerDependencies(): PlannerDependencies {
  return createProductionPlannerDependencies(createProductionPlannerRngEngine())
}

/**
 * The Production Planner-driven constrained re-search calculation
 * (PLANNER_SPEC 9.2.6, 9.2.16).
 *
 * Only two things happen here, and neither invents a bound:
 *
 * - `defaultConstrainedEnumerationBounds` - the B8-B2 Browser Worker benchmark
 *   result, imported from its Search Domain authority rather than restated - is
 *   passed explicitly as the enumeration extent.
 * - The caller's `PlannerOrchestrationBounds` is forwarded unchanged: no
 *   Production default, no clamping, and no field-wise completion. Those three
 *   bounds are decided by the B8-E benchmark.
 */
export const createProductionConstrainedPlan: CreateConstrainedProductionPlanCalculation =
  (input, orchestrationBounds, dependencies, executionOptions) =>
    createProductionPlanWithConstrainedSearch(input, dependencies, {
      enumerationBounds: defaultConstrainedEnumerationBounds,
      orchestrationBounds,
      executionOptions,
    })

/** Both Production Planner calculations the Worker controller dispatches to. */
export function createProductionPlannerWorkerCalculations(): PlannerWorkerCalculations {
  return {
    createPlan: createProductionPlan,
    createConstrainedPlan: createProductionConstrainedPlan,
  }
}
