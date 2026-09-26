import type {
  BuildListEntry,
  PlannerConflictRepairDecision,
  PlannerConflictRepairLineage,
  ProductionPlan,
} from '../../models/publicTypes'
import type { BuildListEntryReplacement } from '../../buildList'
import type { PlannerAlternativeSearchExtent } from '../../search'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
} from '../plannerTypes'
import type { PlannerAlternativeComparison } from './plannerAlternativeComparison'
import type { PlannerAlternativeKernelPreparationFailure } from './plannerAlternativeKernel'
import {
  expandPlannerAlternativeDecision,
  runPlannerAlternativeScenario,
  type PlannerAlternativeScenarioCalculation,
} from './plannerAlternativeScenario'
import type { PlannerAlternativeTrialBounds } from './plannerAlternativeTrial'
import {
  appendPlannerConflictRepairDecision,
  derivePlannerConflictRepairLineageContext,
  plannerConflictRepairOutcomeOf,
  type PlannerConflictRepairLineageContext,
} from './plannerConflictRepairLineage'

/**
 * The Planner Alternative actual repair: 「この候補を優先」 as a pure Domain
 * calculation (`docs/PLANNER_SPEC.md` 9.2.19.8 / 9.2.19.8.1 / 9.2.19.9 /
 * 9.2.19.11 / 9.2.19.13, Phase 5-A).
 *
 * ```text
 * lineage + fresh Build List -> active lineage context (9.2.19.11)
 *   -> runPlannerAlternativeScenario()   the same kernel, composition, budget
 *                                        and expansion the what-if uses
 *   -> typed comparison                  the what-if's own projection
 *   -> persistence artifact              only for a savable final scenario Plan:
 *                                        the expanded Plan, the accepted
 *                                        replacements, the next lineage
 * ```
 *
 * It persists nothing and calls no Persistence service: saving the artifact -
 * its current-state re-validation, the Plan-breaking guard, the Build List
 * replacement - is the Phase 5-B Persistence boundary. No Production default is
 * read here: `extent` and `bounds` are caller-required.
 */

export interface PlannerAlternativeRepairInput {
  /**
   * The fresh input built from the displayed Draft with the existing explicit
   * resolutions restored and `options` already
   * `conflictResolutionPlannerOptions(displayed Plan)` (9.2.19.8 steps 1 / 9.2.4.14).
   * The decision is merged in (same `conflictKey` replaced). Its
   * `buildListEntries` is the current Build List the lineage is checked against.
   */
  plannerInput: PlannerInput
  /** This decision: the Conflict and the Entry the user preferred. */
  decision: PlannerConflictResolution
  /** The displayed Draft's repair lineage, or `null` for none. */
  lineage: PlannerConflictRepairLineage | null
}

export interface PlannerAlternativeRepairRequest extends PlannerAlternativeRepairInput {
  extent: PlannerAlternativeSearchExtent
  bounds: PlannerAlternativeTrialBounds
}

export interface PlannerAlternativeRepairOptions {
  executionOptions?: PlannerExecutionOptions
}

/** The final scenario result, as the Plan the repair would save. */
export interface PlannerAlternativeRepairPlannerResult extends PlannerResult {
  plan: ProductionPlan
}

/**
 * What Phase 5-B hands to Persistence for one repair (9.2.19.8 step 9). It is
 * runtime data only; nothing here has been checked against the database.
 */
export interface PlannerAlternativeRepairArtifact {
  /**
   * The final scenario result with the decision expanded (9.2.19.9). Its
   * `conflicts` and `plan.conflicts` are the same expanded list.
   */
  plannerResult: PlannerAlternativeRepairPlannerResult
  /**
   * The generated Entry of every accepted replacement, in stable Target order.
   * The accepted set is the authority, not the final Plan's selection: an
   * accepted Entry may be unselected, having lost only a provisional outcome
   * to an Entry outside the fixed Route set (9.2.19.6).
   */
  generatedBuildListEntries: BuildListEntry[]
  /** `O -> G` for each accepted replacement, in the same order (9.2.18). */
  generatedBuildListEntryReplacements: BuildListEntryReplacement[]
  /** The displayed Draft's still valid lineage with this decision appended (9.2.19.11). */
  conflictRepairLineage: PlannerConflictRepairLineage
}

/** Why no artifact exists; each is a fail-closed condition, never a partial save. */
export type PlannerAlternativeRepairNotPersistableReason =
  | 'no_plan'
  | 'stopped_by_plan_step_bound'
  | 'stopped_by_planner_rerun_bound'
  | 'invalid_conflict_resolution'

export type PlannerAlternativeRepairPersistence =
  | { status: 'persistable'; artifact: PlannerAlternativeRepairArtifact }
  | { status: 'not_persistable'; reason: PlannerAlternativeRepairNotPersistableReason }

export type PlannerAlternativeRepairCalculationResult =
  | {
      status: 'completed'
      /** The same typed comparison the what-if returns for this request (9.2.19.13). */
      comparison: PlannerAlternativeComparison
      persistence: PlannerAlternativeRepairPersistence
    }
  | PlannerAlternativeKernelPreparationFailure

/**
 * Runs one actual repair.
 *
 * Invalid bounds or extent throw; every other preparation failure - an invalid
 * decision, an input that is not ready, a lineage fixed Entry that is no valid
 * Entry of the input - is typed and carries no artifact. Cancellation throws
 * `PlannerAlternativeCancelledError` and returns no partial result.
 */
export async function createPlannerAlternativeRepair(
  request: PlannerAlternativeRepairRequest,
  dependencies: PlannerDependencies,
  options: PlannerAlternativeRepairOptions = {},
): Promise<PlannerAlternativeRepairCalculationResult> {
  const context = derivePlannerConflictRepairLineageContext(
    request.lineage,
    request.plannerInput.buildListEntries,
  )
  const result = await runPlannerAlternativeScenario(
    {
      plannerInput: request.plannerInput,
      decision: request.decision,
      priorFixedBuildListEntryIds: context.priorFixedBuildListEntryIds,
      priorExcludedRoutes: context.priorExcludedRoutes,
      extent: request.extent,
      bounds: request.bounds,
    },
    dependencies,
    { executionOptions: options.executionOptions },
  )
  if (result.status !== 'completed') return result
  const { calculation } = result
  return {
    status: 'completed',
    comparison: calculation.comparison,
    persistence: createPlannerAlternativeRepairPersistence(calculation, context),
  }
}

function createPlannerAlternativeRepairPersistence(
  calculation: PlannerAlternativeScenarioCalculation,
  context: PlannerConflictRepairLineageContext,
): PlannerAlternativeRepairPersistence {
  const { comparison, composition, expansion } = calculation
  // The typed scenario already tells every unsavable final result apart.
  if (comparison.scenario.status !== 'evaluated') {
    return { status: 'not_persistable', reason: comparison.scenario.status }
  }
  const final = composition.final
  if (final === null || final.result.plan === null) {
    throw new Error('Planner Alternative invariant violated: an evaluated scenario has no final Plan.')
  }
  // Application fail-closed boundary: a Plan that could not honour an explicit
  // resolution is never saved (9.2.4.14).
  if (final.result.warnings.some(({ kind }) => kind === 'invalid_conflict_resolution')) {
    return { status: 'not_persistable', reason: 'invalid_conflict_resolution' }
  }
  const planConflictIds = final.result.plan.conflicts.map(({ id }) => id)
  if (planConflictIds.join('\n') !== final.result.conflicts.map(({ id }) => id).join('\n')) {
    throw new Error('Planner Alternative invariant violated: the final Plan and its result report different conflicts.')
  }
  // The one expanded list is the authority for both (9.2.19.9).
  const conflicts = expandPlannerAlternativeDecision(final.result.conflicts, expansion)
  const plannerResult: PlannerAlternativeRepairPlannerResult = {
    ...structuredClone(final.result),
    plan: { ...structuredClone(final.result.plan), conflicts: structuredClone(conflicts) },
    conflicts,
  }
  return {
    status: 'persistable',
    artifact: {
      plannerResult,
      generatedBuildListEntries: composition.accepted.map(({ generated }) => structuredClone(generated.entry)),
      generatedBuildListEntryReplacements: composition.accepted.map(({ replacement }) => ({ ...replacement })),
      conflictRepairLineage: appendPlannerConflictRepairDecision(context, createRepairDecision(calculation)),
    },
  }
}

/** This decision's lineage record (9.2.19.11): one per direct participant Target, in the kernel's stable order. */
function createRepairDecision(calculation: PlannerAlternativeScenarioCalculation): PlannerConflictRepairDecision {
  const { prepared, kernel, composition } = calculation
  const acceptedByTarget = new Map(composition.accepted.map((found) => [found.replacement.targetWeaponId, found]))
  return {
    conflictKind: prepared.scenario.scenarioConstraint.resourceIdentity.kind,
    fixedBuildListEntryId: kernel.fixedBuildListEntryId,
    fixedTargetWeaponId: kernel.fixedTargetWeaponId,
    invalidatedRoutes: kernel.targets.map((target) => {
      const outcome = plannerConflictRepairOutcomeOf(
        target.outcome.status,
        composition.adoptedByTargetWeaponId.get(target.targetWeaponId),
      )
      const accepted = acceptedByTarget.get(target.targetWeaponId)
      if ((outcome === 'replaced') !== (accepted !== undefined)) {
        throw new Error(
          `Planner Alternative invariant violated: TargetWeapon '${target.targetWeaponId}' is '${outcome}' but ${accepted ? 'is' : 'is not'} in the accepted replacement set.`,
        )
      }
      return {
        targetWeaponId: target.targetWeaponId,
        invalidatedBuildListEntryId: target.invalidatedBuildListEntryId,
        invalidatedRouteKey: target.invalidatedRouteKey,
        replacementBuildListEntryId: accepted ? accepted.generated.entry.id : null,
        outcome,
      }
    }),
  }
}
