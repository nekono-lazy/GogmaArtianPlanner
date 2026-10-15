import type { BuildListOptimizationWorkerScope } from './buildListOptimization.worker'
import { attachBuildListOptimizationBenchmarkWorker } from './buildListOptimization.worker.benchmark'

/**
 * Benchmark-only measurement Worker entry of the Build List global optimization (see `buildListOptimization.worker.benchmark.ts`).
 * The normal application never loads it; the Production entry is `buildListOptimization.worker.entry.ts`.
 */
attachBuildListOptimizationBenchmarkWorker(self as unknown as BuildListOptimizationWorkerScope)
