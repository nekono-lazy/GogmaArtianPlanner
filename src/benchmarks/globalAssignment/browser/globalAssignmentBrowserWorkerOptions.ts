import { ProductionRngEngine } from '../../../domain/rng/production/productionRngEngine'
import { globalResearchInputFromExport } from '../../plannerGlobalOptimizationResearch'
import { registeredD1cConditions } from '../verificationRegistration'
import type { GlobalAssignmentBrowserControllerOptions } from './globalAssignment.worker.benchmark'
import { GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS } from './globalAssignmentBrowserStages'

/**
 * Issue #154 Production準備 P-1: the dependencies the Research-only Global Assignment Browser Worker entry injects
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 7.2), in one place so the entry and its tests use the very same ones:
 *
 * - the Engine: a new default `ProductionRngEngine` per call (what the D-1A / D-1C child processes use; never a Fake Engine)
 * - the PlannerInput: built in the Worker from the Export by the pure Research path, with the validation-only `maxPlanSteps` 1,000
 * - the conditions: the D-1C registration's materialization and Phase D' values, read in the Worker (`registeredD1cConditions()`);
 *   a run request carries none of them
 */
export function globalAssignmentBrowserWorkerOptions(): GlobalAssignmentBrowserControllerOptions {
  return {
    createEngine: () => new ProductionRngEngine(),
    buildInput: json => globalResearchInputFromExport(json, GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS),
    conditions: {
      read: () => {
        const registered = registeredD1cConditions()
        return { materialization: registered.materialization, verification: registered.verification }
      },
      source: 'registeredD1cConditions',
    },
  }
}
