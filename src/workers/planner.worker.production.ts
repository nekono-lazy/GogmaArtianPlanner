import {
  createProductionPlan,
  createProductionPlanWithConstrainedSearch,
  createProductionPlannerDependencies,
  createPlannerWhatIfComparison,
  preparePlannerInitialContext,
  type CreateConstrainedProductionPlanCalculation,
  type PlannerDependencies,
} from '../domain/planner'
import {
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import type { RngEngine } from '../domain/rng/rngEngine'
import { defaultConstrainedEnumerationBounds } from '../domain/search'
import type {
  CreatePlannerWhatIfComparisonCalculation,
  PlannerWorkerCalculations,
  PreparePlannerInteractionCalculation,
} from './planner.worker'

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
 *   default substitution, no clamping, and no field-wise completion. The
 *   Production default now exists as `defaultPlannerOrchestrationBounds`
 *   (B8-E2b, `2 / 1 / 4`), but this adapter still forwards the caller-supplied
 *   wire value unchanged. Application callers decide when to use the Production
 *   default; the Worker never overrides what the request carried.
 */
export const createProductionConstrainedPlan: CreateConstrainedProductionPlanCalculation =
  (input, orchestrationBounds, dependencies, executionOptions) =>
    createProductionPlanWithConstrainedSearch(input, dependencies, {
      enumerationBounds: defaultConstrainedEnumerationBounds,
      orchestrationBounds,
      executionOptions,
    })

/**
 * Supplies only the Search-domain enumeration extent inside the Worker.
 * `request.bounds` remains caller-required and is forwarded without repair,
 * clamping, completion, or default substitution. The B9-B2c Production value
 * `defaultPlannerWhatIfBounds` (2 / 8) is for explicit Application caller use;
 * this adapter never injects it.
 */
export const createProductionPlannerWhatIfComparison: CreatePlannerWhatIfComparisonCalculation =
  (request, dependencies, executionOptions) =>
    createPlannerWhatIfComparison(request, dependencies, {
      enumerationBounds: defaultConstrainedEnumerationBounds,
      executionOptions,
    })

/**
 * Project only the shared Domain helper's validation and current initial
 * Conflicts. No retry, search, or availability rule belongs in this adapter.
 */
const prepareProductionPlannerInteraction: PreparePlannerInteractionCalculation =
  (input, dependencies) => {
    const prepared = preparePlannerInitialContext(input, dependencies)
    if (prepared.status === 'invalid') {
      return {
        status: 'invalid',
        issues: prepared.issues,
        warnings: prepared.warnings,
        excludedBuildListEntries: prepared.excludedBuildListEntries.map(
          ({ entry, reason }) => ({ buildListEntryId: entry.id, reason }),
        ),
      }
    }
    const { context } = prepared
    return {
      status: 'ready',
      validBuildListEntryIds: context.validBuildListEntries.map(({ entry }) => entry.id),
      excludedBuildListEntries: context.excludedBuildListEntries.map(
        ({ entry, reason }) => ({ buildListEntryId: entry.id, reason }),
      ),
      currentConflicts: context.initialConflictDetection.conflicts.map(
        ({ id, buildListEntryIds }) => ({ id, buildListEntryIds: [...buildListEntryIds] }),
      ),
    }
  }

/** All Production Planner calculations the Worker controller dispatches to. */
export function createProductionPlannerWorkerCalculations(): PlannerWorkerCalculations {
  return {
    prepareInteraction: prepareProductionPlannerInteraction,
    createPlan: createProductionPlan,
    createConstrainedPlan: createProductionConstrainedPlan,
    createWhatIfComparison: createProductionPlannerWhatIfComparison,
  }
}
