import type { BuildListEntryId } from '../../models/publicTypes'
import type { PlannerAlternativeSearchExtent } from '../../search'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
} from '../plannerTypes'
import type { PlannerAlternativeComparison } from './plannerAlternativeComparison'
import type {
  PlannerAlternativeKernelPreparationFailure,
  PlannerAlternativeRouteExclusion,
} from './plannerAlternativeKernel'
import { runPlannerAlternativeScenario } from './plannerAlternativeScenario'
import type { PlannerAlternativeTrialBounds } from './plannerAlternativeTrial'

/**
 * The Planner Alternative What-if Calculation: B9 「比較する」 on the Planner
 * Alternative kernel (`docs/PLANNER_SPEC.md` 9.2.19.7 / 9.2.19.8.1 / 9.2.19.9 /
 * 9.2.19.12 / 9.2.19.13, Phase 4-B).
 *
 * It is the comparison projection of the shared scenario calculation
 * (`runPlannerAlternativeScenario()`, the same one the actual repair of
 * `createPlannerAlternativeRepair()` stands on): the kernel's independent
 * individual trials, the 9.2.19.8.1 scenario composition with its one
 * request-global rerun budget, the 9.2.19.9 decision expansion and the
 * 9.2.19.13 typed comparison.
 *
 * It is transient: it persists no BuildListEntry, ProductionPlan, resolution,
 * comparison or repair lineage, and it never re-searches a Conflict the
 * scenario introduces (one-step preview). It is a separate calculation from the
 * legacy B9 `createPlannerWhatIfComparison()`, which stays the Production UI
 * path until Phase 5-B.
 */

/**
 * What a Planner Alternative what-if request carries across the Worker
 * boundary: everything except the extent and the trial bounds, which the
 * Production Worker adapter supplies inside the Worker (9.2.19.12).
 */
export interface PlannerAlternativeWhatIfInput {
  /**
   * The fresh baseline input with the existing explicit resolutions restored
   * and `options` already the Application's Conflict resolution Planner options
   * (9.2.19.7). It is never mutated.
   */
  plannerInput: PlannerInput
  /** The virtual fixed choice of this comparison (9.2.4.5). */
  scenarioResolution: PlannerConflictResolution
  /**
   * Still valid fixed Entries of earlier decisions (repair lineage, 9.2.19.11),
   * filtered by the caller (`derivePlannerConflictRepairLineageContext()`).
   */
  priorFixedBuildListEntryIds: readonly BuildListEntryId[]
  /** Routes earlier decisions invalidated, per Target (still valid repair lineage, 9.2.19.10). */
  priorExcludedRoutes: readonly PlannerAlternativeRouteExclusion[]
}

/**
 * The Domain request. `extent` and `bounds` are caller-required: the Domain
 * performs no default substitution, fallback, clamp or field-wise completion.
 */
export interface PlannerAlternativeWhatIfRequest extends PlannerAlternativeWhatIfInput {
  extent: PlannerAlternativeSearchExtent
  bounds: PlannerAlternativeTrialBounds
}

export interface PlannerAlternativeWhatIfOptions {
  executionOptions?: PlannerExecutionOptions
}

/** Failures are typed values, never parsed messages. */
export type PlannerAlternativeWhatIfCalculationResult =
  | { status: 'completed'; comparison: PlannerAlternativeComparison }
  | PlannerAlternativeKernelPreparationFailure

/**
 * Runs one Planner Alternative what-if comparison.
 *
 * Invalid bounds or extent throw; every other failure is typed. Cancellation
 * throws `PlannerAlternativeCancelledError` and returns no partial result.
 */
export async function createPlannerAlternativeWhatIfComparison(
  request: PlannerAlternativeWhatIfRequest,
  dependencies: PlannerDependencies,
  options: PlannerAlternativeWhatIfOptions = {},
): Promise<PlannerAlternativeWhatIfCalculationResult> {
  const result = await runPlannerAlternativeScenario(
    {
      plannerInput: request.plannerInput,
      decision: request.scenarioResolution,
      priorFixedBuildListEntryIds: request.priorFixedBuildListEntryIds,
      priorExcludedRoutes: request.priorExcludedRoutes,
      extent: request.extent,
      bounds: request.bounds,
    },
    dependencies,
    { executionOptions: options.executionOptions },
  )
  if (result.status !== 'completed') return result
  return { status: 'completed', comparison: result.calculation.comparison }
}
