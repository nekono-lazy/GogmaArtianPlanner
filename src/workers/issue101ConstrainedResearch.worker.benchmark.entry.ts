import {
  attachIssue101BenchmarkWorker,
  type Issue101BenchmarkWorkerScope,
} from './issue101ConstrainedResearch.worker.benchmark'
import { createProductionPlannerWorkerDependencies } from './planner.worker.production'

/**
 * Issue #101 benchmark-only Worker entry.
 *
 * The Planner dependencies are the Production Planner Worker's own
 * (`createProductionPlannerWorkerDependencies()`: `ProductionRngEngine`, the
 * UUID ID factory and the UTC clock), so the measured calculation is the
 * Production one. The normal application never loads this entry.
 */
attachIssue101BenchmarkWorker(
  self as unknown as Issue101BenchmarkWorkerScope,
  createProductionPlannerWorkerDependencies,
)
