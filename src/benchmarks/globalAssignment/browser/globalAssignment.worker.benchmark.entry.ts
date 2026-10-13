import { attachGlobalAssignmentBrowserWorker, type GlobalAssignmentBrowserWorkerScope } from './globalAssignment.worker.benchmark'
import { globalAssignmentBrowserWorkerOptions } from './globalAssignmentBrowserWorkerOptions'

/**
 * Issue #154 Production準備 P-1: the Research-only Global Assignment Browser Worker entry (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md`
 * 7.2). Its dependencies are `globalAssignmentBrowserWorkerOptions()`: a default `ProductionRngEngine`, the PlannerInput built in this
 * Worker from the Export bytes with the validation-only `maxPlanSteps` 1,000, and the D-1C registration's conditions read here. The
 * normal application never loads this entry: only `benchmark-global-assignment.html` reaches it.
 */
attachGlobalAssignmentBrowserWorker(self as unknown as GlobalAssignmentBrowserWorkerScope, globalAssignmentBrowserWorkerOptions())
