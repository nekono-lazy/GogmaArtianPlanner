import type { BuildListOptimizationBounds } from '../domain/planner/buildListOptimization'
import {
  createBuildListOptimizationWorkerController,
  type BuildListOptimizationWorkerController,
  type BuildListOptimizationWorkerRuntime,
  type BuildListOptimizationWorkerScope,
} from './buildListOptimization.worker'
import { createBuildListOptimizationWorkerRuntime } from './buildListOptimization.worker.production'

/**
 * Benchmark-only measurement entry of the Build List global optimization Worker (Issue #260 PR-4, prepared for the PR-5 PC Browser
 * measurement that decides the Production search bounds, `docs/PLANNER_SPEC.md` 17.13 / 17.19 U2).
 *
 * The measured calculation is the Production one: the same controller, the same Production adapter
 * (`createBuildListOptimizationCalculation()`), the same Production Engine, ID factory and Clock, and the same `blo_run` request the
 * Production Client sends. The only difference is where the search bounds come from: a measurement Worker receives them in one
 * benchmark-only configuration message before its run. That message is not part of the Production protocol, the Production entry
 * never handles it, and no run request carries a bound. The normal application never loads this entry.
 */

export const BUILD_LIST_OPTIMIZATION_BENCHMARK_PROTOCOL_VERSION = 'build-list-optimization-benchmark:1' as const

export interface BuildListOptimizationBenchmarkBoundsMessage {
  type: 'blo_benchmark_bounds'
  protocolVersion: typeof BUILD_LIST_OPTIMIZATION_BENCHMARK_PROTOCOL_VERSION
  bounds: BuildListOptimizationBounds
}

export function createBuildListOptimizationBenchmarkBoundsMessage(
  bounds: BuildListOptimizationBounds,
): BuildListOptimizationBenchmarkBoundsMessage {
  return { type: 'blo_benchmark_bounds', protocolVersion: BUILD_LIST_OPTIMIZATION_BENCHMARK_PROTOCOL_VERSION, bounds: structuredClone(bounds) }
}

function isBoundsMessage(value: unknown): value is BuildListOptimizationBenchmarkBoundsMessage {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'blo_benchmark_bounds'
    && (value as { protocolVersion?: unknown }).protocolVersion === BUILD_LIST_OPTIMIZATION_BENCHMARK_PROTOCOL_VERSION
    && typeof (value as { bounds?: unknown }).bounds === 'object' && (value as { bounds?: unknown }).bounds !== null
}

export type BuildListOptimizationBenchmarkRuntimeFactory = (bounds: BuildListOptimizationBounds | null) => BuildListOptimizationWorkerRuntime

/**
 * The first message configures the bounds; every later message goes to the ordinary controller over the Production adapter with
 * those bounds. A run that arrives before any bounds runs with none and is refused (`search_bounds_unavailable`), so a missing
 * configuration is never filled in. The bounds themselves are validated by the Domain (`assertBuildListOptimizationBounds()`).
 */
export function attachBuildListOptimizationBenchmarkWorker(
  scope: BuildListOptimizationWorkerScope,
  createRuntime: BuildListOptimizationBenchmarkRuntimeFactory = createBuildListOptimizationWorkerRuntime,
): void {
  let controller: BuildListOptimizationWorkerController | null = null
  const post = (response: Parameters<BuildListOptimizationWorkerScope['postMessage']>[0]) => scope.postMessage(response)
  scope.addEventListener('message', (event) => {
    if (controller === null) {
      if (isBoundsMessage(event.data)) {
        controller = createBuildListOptimizationWorkerController(createRuntime(structuredClone(event.data.bounds)), post)
        return
      }
      controller = createBuildListOptimizationWorkerController(createRuntime(null), post)
    }
    void controller.handleMessage(event.data)
  })
}
