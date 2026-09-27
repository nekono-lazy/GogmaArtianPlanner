import type { PlannerDependencies } from '../plannerTypes'
import {
  preparePlannerConflictScenario,
  type PlannerConflictScenarioPreparationResult,
} from '../replacement/plannerConflictScenario'
import { assertPlannerWhatIfBounds } from './plannerWhatIfBounds'
import type { PlannerWhatIfRequest } from './plannerWhatIfTypes'

/**
 * B9-B1a: the legacy B9 what-if preparation (PLANNER_SPEC 9.2.4.5).
 *
 * Since Phase 6-B2a (PLANNER_SPEC 9.2.19.16) the preparation itself - the
 * scenario resolution merge, the initial context, the conflict contexts, the
 * fixed constraints, the Planner-start Search origin and the scenario-only
 * conflict works - is the shared `preparePlannerConflictScenario()` of
 * `../replacement/plannerConflictScenario`. This wrapper adds only the B9
 * bounds check in front of it, exactly where it always ran, so the legacy B9
 * calculation keeps its contract: invalid bounds throw
 * `PlannerWhatIfBoundsError` before the Planner input is touched, and every
 * other failure is the shared typed result.
 */
export function preparePlannerWhatIfScenario(
  request: PlannerWhatIfRequest,
  dependencies: PlannerDependencies,
): PlannerConflictScenarioPreparationResult {
  assertPlannerWhatIfBounds(request.bounds)
  return preparePlannerConflictScenario(
    {
      plannerInput: request.plannerInput,
      scenarioResolution: request.scenarioResolution,
    },
    dependencies,
  )
}
