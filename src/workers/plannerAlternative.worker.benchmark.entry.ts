import { isPlannerAlternativeBenchmarkRequest } from '../benchmarks/plannerAlternativeBenchmarkProtocol'
import {
  attachPlannerAlternativeBenchmarkWorker,
  type PlannerAlternativeBenchmarkWorkerScope,
} from './plannerAlternative.worker.benchmark'
import { createProductionPlannerWorkerDependencies } from './planner.worker.production'

/**
 * Planner Alternative Search Phase 3-A benchmark-only Worker entry.
 *
 * The Planner dependencies are the Production Planner Worker's own
 * (`createProductionPlannerWorkerDependencies()`: `ProductionRngEngine`, the
 * UUID ID factory and the UTC clock), so the measured calculation is the
 * Production one. The normal application never loads this entry.
 */
attachPlannerAlternativeBenchmarkWorker(
  self as unknown as PlannerAlternativeBenchmarkWorkerScope,
  createProductionPlannerWorkerDependencies,
  isPlannerAlternativeBenchmarkRequest,
)
