import type { ConstrainedSearchOrigin } from '../../search'
import {
  preparePlannerInitialContext,
  type PlannerInitialContext,
} from '../plannerInitialContext'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
} from '../plannerTypes'
import {
  createPlannerConstrainedConflictContexts,
  preparePlannerFixedConflictConstraints,
  type PlannerConstrainedConflictContext,
  type PlannerFixedConflictConstraint,
} from './plannerConflictContext'
import {
  createConstrainedSearchOriginFromPlannerInput,
  createPlannerConflictWorks,
  type PlannerConflictWork,
} from './plannerConstrainedOrchestration'
import { assertPlannerWhatIfBounds } from './plannerWhatIfBounds'
import type {
  PlannerWhatIfFailureResult,
  PlannerWhatIfInvalidFixedResolutionReason,
  PlannerWhatIfRequest,
} from './plannerWhatIfTypes'

/**
 * B9-B1a: everything a what-if comparison needs before the first Candidate is
 * enumerated (PLANNER_SPEC 9.2.4.5, 9.2.4.4, 9.2.3, 9.2.3.1, 9.2.7).
 *
 * It reuses the existing Planner authority end to end -
 * `preparePlannerInitialContext()`, `createPlannerConstrainedConflictContexts()`,
 * `preparePlannerFixedConflictConstraints()`,
 * `createConstrainedSearchOriginFromPlannerInput()` and
 * `createPlannerConflictWorks()` - and reimplements none of validation, initial
 * state, entry relevance, Route unit plans, or conflict detection.
 *
 * It enumerates no Candidate, materializes nothing, starts no Beam Search, and
 * computes no distance. Those are B9-B1b.
 */

/** The internal ready context B9-B1b consumes. It is not a public Domain API. */
export interface PreparedPlannerWhatIfScenario {
  /**
   * `request.plannerInput` with the scenario resolution merged in. The request
   * input itself is never mutated.
   */
  mergedInput: PlannerInput
  /**
   * The Planner-start Search / RNG snapshot, built from the merged input.
   * Merging a resolution changes no `ConstrainedSearchOrigin` field, so this is
   * the same origin the ordinary constrained enumeration would use.
   */
  origin: ConstrainedSearchOrigin
  initialContext: PlannerInitialContext
  conflictContexts: PlannerConstrainedConflictContext[]
  /**
   * Every valid explicit resolution as a fixed constraint, the scenario's own
   * included. B9-B1b keeps the others as feasibility constraints for preflight
   * re-mapping and the full rerun; they are not what-if subjects.
   */
  fixedConstraints: PlannerFixedConflictConstraint[]
  /** The single what-if subject, i.e. the scenario resolution's own constraint. */
  scenarioConstraint: PlannerFixedConflictConstraint
  /**
   * One work item per unique non-fixed participant Target of the scenario
   * conflict only.
   *
   * Built from `[scenarioConstraint]` alone. Passing every fixed constraint
   * would make the other explicit resolutions what-if subjects too, which
   * 9.2.4 does not ask for.
   */
  works: PlannerConflictWork[]
}

export type PlannerWhatIfScenarioPreparationResult =
  | { status: 'ready'; scenario: PreparedPlannerWhatIfScenario }
  | PlannerWhatIfFailureResult

/**
 * Merges the scenario resolution into a `PlannerInput` (PLANNER_SPEC 9.2.4.5).
 *
 * ```text
 * same conflictKey   -> replaced by scenarioResolution
 * other conflictKeys -> kept unchanged, in place
 * key absent         -> scenarioResolution appended
 * ```
 *
 * It repairs nothing. A malformed input carrying the same `conflictKey` twice
 * keeps two entries afterwards, so `validatePlannerInput()` still reports the
 * duplicate and the whole request fails closed. Merging never bypasses
 * validation, never de-duplicates, and never drops a resolution validation
 * would have rejected.
 *
 * The input object and its arrays are not mutated.
 */
export function mergePlannerWhatIfScenarioResolution(
  input: PlannerInput,
  scenarioResolution: PlannerConflictResolution,
): PlannerInput {
  const matched = input.conflictResolutions.some(
    ({ conflictKey }) => conflictKey === scenarioResolution.conflictKey,
  )
  const conflictResolutions = input.conflictResolutions.map((resolution) =>
    resolution.conflictKey === scenarioResolution.conflictKey
      ? { ...scenarioResolution }
      : resolution,
  )
  if (!matched) conflictResolutions.push({ ...scenarioResolution })
  return { ...input, conflictResolutions }
}

function invalidFixedResolution(
  reason: PlannerWhatIfInvalidFixedResolutionReason,
  resolution: PlannerConflictResolution,
  detail: string,
): PlannerWhatIfScenarioPreparationResult {
  return {
    status: 'invalid_fixed_resolution',
    reason,
    conflictKey: resolution.conflictKey,
    selectedBuildListEntryId: resolution.selectedBuildListEntryId,
    detail,
  }
}

/**
 * Prepares one what-if scenario.
 *
 * Order (PLANNER_SPEC 9.2.4.5, 9.2.3.1):
 *
 * ```text
 * assertPlannerWhatIfBounds
 *   -> merge scenarioResolution
 *   -> preparePlannerInitialContext
 *   -> scenario resolution survived validation?
 *   -> conflict contexts
 *   -> fixed constraints for every valid explicit resolution
 *   -> the scenario's own constraint, uniquely
 *   -> ConstrainedSearchOrigin
 *   -> scenario-only conflict works
 * ```
 *
 * Invalid bounds throw `PlannerWhatIfBoundsError`; every other failure is a
 * typed result. Nothing is inferred when the fixed side is unknown.
 */
export function preparePlannerWhatIfScenario(
  request: PlannerWhatIfRequest,
  dependencies: PlannerDependencies,
): PlannerWhatIfScenarioPreparationResult {
  assertPlannerWhatIfBounds(request.bounds)
  const { scenarioResolution } = request
  const mergedInput = mergePlannerWhatIfScenarioResolution(
    request.plannerInput,
    scenarioResolution,
  )
  const prepared = preparePlannerInitialContext(mergedInput, dependencies)
  if (prepared.status !== 'ready') {
    return {
      status: 'planner_input_not_ready',
      issues: prepared.issues,
      warnings: prepared.warnings,
      excludedBuildListEntries: prepared.excludedBuildListEntries,
    }
  }
  const context = prepared.context
  // A ready initial context does not imply the scenario survived.
  // `validatePlannerInput()` drops a resolution whose selected Entry is
  // missing, stale, or otherwise excluded with a warning only, leaving the
  // input valid. The exact pair must still be there, and no other Entry of the
  // same conflict is accepted in its place (PLANNER_SPEC 9.2.7).
  const scenarioSurvived = context.validConflictResolutions.some(
    ({ conflictKey, selectedBuildListEntryId }) =>
      conflictKey === scenarioResolution.conflictKey &&
      selectedBuildListEntryId === scenarioResolution.selectedBuildListEntryId,
  )
  if (!scenarioSurvived) {
    return invalidFixedResolution(
      'scenario_resolution_not_valid',
      scenarioResolution,
      `The scenario resolution for conflict '${scenarioResolution.conflictKey}' selecting BuildListEntry '${scenarioResolution.selectedBuildListEntryId}' is not among the currently valid Planner conflict resolutions.`,
    )
  }
  const conflictContexts = createPlannerConstrainedConflictContexts(context)
  // Every valid explicit resolution, not only the scenario's: what-if work must
  // not silently drop another fixed choice, and B8's all-or-nothing rule
  // applies unchanged (PLANNER_SPEC 9.2.3.1).
  const fixedPreparation = preparePlannerFixedConflictConstraints(
    context,
    conflictContexts,
  )
  if (fixedPreparation.status !== 'ready') {
    const [first] = fixedPreparation.failures
    return {
      status: 'invalid_fixed_resolution',
      reason: 'fixed_constraints_unresolved',
      conflictKey: first.conflictKey,
      selectedBuildListEntryId: first.selectedBuildListEntryId,
      detail: fixedPreparation.failures
        .map(({ conflictKey, reason, detail }) => `${conflictKey}: ${reason}: ${detail}`)
        .join(' '),
    }
  }
  const fixedConstraints = fixedPreparation.constraints
  const scenarioConstraints = fixedConstraints.filter(
    ({ originalConflictId, fixedBuildListEntryId }) =>
      originalConflictId === scenarioResolution.conflictKey &&
      fixedBuildListEntryId === scenarioResolution.selectedBuildListEntryId,
  )
  if (scenarioConstraints.length !== 1) {
    return invalidFixedResolution(
      'scenario_constraint_missing',
      scenarioResolution,
      `${scenarioConstraints.length} fixed constraints match the scenario resolution for conflict '${scenarioResolution.conflictKey}'; exactly one is required.`,
    )
  }
  const scenarioConstraint = scenarioConstraints[0]
  return {
    status: 'ready',
    scenario: {
      mergedInput,
      origin: createConstrainedSearchOriginFromPlannerInput(mergedInput),
      initialContext: context,
      conflictContexts,
      fixedConstraints,
      scenarioConstraint,
      // Scenario-only: `createPlannerConflictWorks(fixedConstraints, ...)`
      // would turn every other explicit resolution into a what-if subject.
      works: createPlannerConflictWorks([scenarioConstraint], conflictContexts),
    },
  }
}
