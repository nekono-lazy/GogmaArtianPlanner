import {
  runPlannerBeamSearch,
} from '../../domain/planner/plannerBeamSearch'
import {
  createPlannerBeamSearchInput,
  type PlannerBeamSearchExecutionOptions,
  type PlannerBeamSearchInput,
  type PlannerBeamSearchResult,
} from '../../domain/planner/plannerBeamSearchTypes'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerRunBuildListContext,
} from '../../domain/planner/plannerTypes'

/**
 * Test-only entry to the Beam Search oracle (Issue #103 Phase D-2a).
 *
 * The shared Planner fixtures build Production `PlannerInput`s, which carry
 * `maxPlanSteps` only. This runs the oracle over such an input with its own
 * default bounds (`defaultPlannerBeamSearchOptions`), or over an explicit
 * `PlannerBeamSearchInput` unchanged when a test states the oracle bounds
 * itself (`createPlannerBeamSearchInput(input, { beamWidth: 1 })`).
 */
export function runPlannerBeamSearchOracle(
  input: PlannerInput | PlannerBeamSearchInput,
  dependencies: PlannerDependencies,
  executionOptions?: PlannerBeamSearchExecutionOptions,
  buildListContext?: PlannerRunBuildListContext,
): Promise<PlannerBeamSearchResult> {
  return runPlannerBeamSearch(
    isPlannerBeamSearchInput(input) ? input : createPlannerBeamSearchInput(input),
    dependencies,
    executionOptions,
    buildListContext,
  )
}

function isPlannerBeamSearchInput(
  input: PlannerInput | PlannerBeamSearchInput,
): input is PlannerBeamSearchInput {
  return 'beamWidth' in input.options && 'maxExpandedStates' in input.options
}
