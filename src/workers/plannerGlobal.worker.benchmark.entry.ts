import { GlobalRawBlockResearch } from '../benchmarks/plannerGlobalRawBlocks'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { attachPlannerGlobalBenchmarkWorker, type PlannerGlobalBenchmarkWorkerScope } from './plannerGlobal.worker.benchmark'

/**
 * Issue #154 Global Planner Research Phase 2-A benchmark-only Worker entry.
 *
 * The Planner / Trace Replay Engine is a default `ProductionRngEngine` (exactly what the Node Research
 * runner used), and Candidate Search reads raw RNG blocks through the Phase 1-B Research observer / cache.
 * The normal application never loads this entry; its Production Workers are unchanged.
 */
attachPlannerGlobalBenchmarkWorker(self as unknown as PlannerGlobalBenchmarkWorkerScope, {
  createEngine: () => new ProductionRngEngine(),
  createRawBlocks: mode => new GlobalRawBlockResearch(mode),
})
