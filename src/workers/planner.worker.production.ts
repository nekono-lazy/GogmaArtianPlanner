import {
  createPlannerAlternativeRepair,
  createPlannerAlternativeWhatIfComparison,
  createProductionPlan,
  createProductionPlannerDependencies,
  defaultPlannerAlternativeTrialBounds,
  preparePlannerInitialContext,
  type PlannerDependencies,
} from '../domain/planner'
import {
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import type { RngEngine } from '../domain/rng/rngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import type {
  CreatePlannerAlternativeComparisonCalculation,
  CreatePlannerAlternativeRepairCalculation,
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
 * The Production Planner Alternative what-if (Phase 4-B, `docs/PLANNER_SPEC.md`
 * 9.2.19.7 / 9.2.19.12). The Domain calculation keeps extent and trial bounds
 * caller-required; this adapter is that caller inside the Worker boundary and
 * passes the Phase 3-C Production defaults, each imported from its own Domain
 * authority rather than restated. Scenario composition, Route summaries and
 * the typed result all stay in the Domain.
 *
 * Since Phase 5-B it is the Production Plan screen's 「比較する」; Phase 6-B1
 * removed the legacy B9 what-if adapter, so it is the only comparison adapter.
 */
export const createProductionPlannerAlternativeComparison: CreatePlannerAlternativeComparisonCalculation =
  (input, dependencies, executionOptions) =>
    createPlannerAlternativeWhatIfComparison(
      {
        ...input,
        extent: { ...defaultPlannerAlternativeSearchExtent },
        bounds: { ...defaultPlannerAlternativeTrialBounds },
      },
      dependencies,
      { executionOptions },
    )

/**
 * The Production Planner Alternative actual repair (Phase 5-B,
 * `docs/PLANNER_SPEC.md` 9.2.19.8 / 9.2.19.12): 「この候補を優先」. Exactly the
 * what-if's Production caller contract - the Phase 3-C extent and trial
 * bounds, each imported from its Domain authority and passed explicitly - so a
 * preview and the repair it previews run the same scenario semantics. Saving
 * the artifact stays the Application / Persistence boundary.
 */
export const createProductionPlannerAlternativeRepair: CreatePlannerAlternativeRepairCalculation =
  (input, dependencies, executionOptions) =>
    createPlannerAlternativeRepair(
      {
        ...input,
        extent: { ...defaultPlannerAlternativeSearchExtent },
        bounds: { ...defaultPlannerAlternativeTrialBounds },
      },
      dependencies,
      { executionOptions },
    )

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
        ({ id, buildListEntryIds, checkpointParticipants }) => ({
          id,
          buildListEntryIds: [...buildListEntryIds],
          checkpointParticipants: structuredClone(checkpointParticipants ?? []),
        }),
      ),
    }
  }

/** All Production Planner calculations the Worker controller dispatches to. */
export function createProductionPlannerWorkerCalculations(): PlannerWorkerCalculations {
  return {
    prepareInteraction: prepareProductionPlannerInteraction,
    createPlan: createProductionPlan,
    createPlannerAlternativeComparison: createProductionPlannerAlternativeComparison,
    createPlannerAlternativeRepair: createProductionPlannerAlternativeRepair,
  }
}
