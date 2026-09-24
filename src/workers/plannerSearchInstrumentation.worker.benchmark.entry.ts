import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  attachPlannerSearchInstrumentationBenchmarkWorker,
  type PlannerSearchInstrumentationBenchmarkWorkerScope,
} from './plannerSearchInstrumentation.worker.benchmark'

/**
 * Issue #103 benchmark-only Worker entry. It composes an unmodified
 * `ProductionRngEngine` inside the Worker boundary; the normal application
 * never loads this entry.
 */
attachPlannerSearchInstrumentationBenchmarkWorker(
  self as unknown as PlannerSearchInstrumentationBenchmarkWorkerScope,
  () => new ProductionRngEngine(),
)
