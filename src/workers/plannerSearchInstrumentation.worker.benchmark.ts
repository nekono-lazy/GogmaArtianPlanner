import { createPlannerSearchInstrumentationInput } from '../benchmarks/plannerSearchInstrumentationFixtures'
import {
  runPlannerSearchInstrumentation,
  type PlannerSearchInstrumentationRunResult,
} from '../benchmarks/plannerSearchInstrumentationBenchmark'
import type {
  PlannerInput,
  PlannerOptions,
  PlannerSearchDepthMetrics,
} from '../domain/planner'
import type { RngEngine } from '../domain/rng/rngEngine'
import { benchmarkWorkerYield } from './constrainedEnumeration.worker.benchmark'

/**
 * Issue #103 benchmark-only Worker controller.
 *
 * It runs the ordinary `runPlannerBeamSearch()` inside a real Browser Worker
 * through the instrumentation harness. No Production Worker protocol, Planner
 * Worker controller or persistence is involved, and the normal application
 * never loads it. The source is either a Repository fixture workload or a
 * PlannerInput the benchmark page assembled in memory from a pasted Export.
 */
export type PlannerSearchInstrumentationBenchmarkSource =
  | { kind: 'workload'; workloadId: string }
  | { kind: 'input'; input: PlannerInput }

export type PlannerSearchInstrumentationBenchmarkRequest =
  | {
      type: 'issue103_run'
      requestId: string
      source: PlannerSearchInstrumentationBenchmarkSource
      options: PlannerOptions
      instrumented: boolean
      collectDiagnosticProjections: boolean
    }
  | { type: 'issue103_cancel'; requestId: string }

export type PlannerSearchInstrumentationBenchmarkResponse =
  | {
      type: 'issue103_depth'
      requestId: string
      depth: PlannerSearchDepthMetrics
      elapsedMs: number
    }
  | {
      type: 'issue103_result'
      requestId: string
      entryCount: number
      result: PlannerSearchInstrumentationRunResult
    }
  | { type: 'issue103_error'; requestId: string; message: string }

export type PlannerSearchInstrumentationBenchmarkPostMessage = (
  response: PlannerSearchInstrumentationBenchmarkResponse,
) => void

export function createPlannerSearchInstrumentationBenchmarkController(
  createEngine: () => RngEngine,
  postMessage: PlannerSearchInstrumentationBenchmarkPostMessage,
  now: () => number = () => performance.now(),
) {
  const cancelled = new Set<string>()
  return {
    async handleMessage(request: PlannerSearchInstrumentationBenchmarkRequest) {
      if (request.type === 'issue103_cancel') {
        cancelled.add(request.requestId)
        return
      }
      try {
        const engine = createEngine()
        const input =
          request.source.kind === 'workload'
            ? createPlannerSearchInstrumentationInput(request.source.workloadId).input
            : request.source.input
        const measured = { ...input, options: { ...request.options } }
        const startedAt = now()
        const result = await runPlannerSearchInstrumentation(measured, engine, {
          instrumented: request.instrumented,
          collectDiagnosticProjections: request.collectDiagnosticProjections,
          now,
          shouldCancel: () => cancelled.has(request.requestId),
          yieldControl: benchmarkWorkerYield,
          onDepth: (depth) =>
            postMessage({
              type: 'issue103_depth',
              requestId: request.requestId,
              depth,
              elapsedMs: now() - startedAt,
            }),
        })
        postMessage({
          type: 'issue103_result',
          requestId: request.requestId,
          entryCount: measured.buildListEntries.length,
          result,
        })
      } catch (error) {
        postMessage({
          type: 'issue103_error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        cancelled.delete(request.requestId)
      }
    },
  }
}

export interface PlannerSearchInstrumentationBenchmarkWorkerScope {
  postMessage: PlannerSearchInstrumentationBenchmarkPostMessage
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<PlannerSearchInstrumentationBenchmarkRequest>) => void,
  ) => void
}

export function attachPlannerSearchInstrumentationBenchmarkWorker(
  scope: PlannerSearchInstrumentationBenchmarkWorkerScope,
  createEngine: () => RngEngine,
) {
  const controller = createPlannerSearchInstrumentationBenchmarkController(
    createEngine,
    (response) => scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    void controller.handleMessage(event.data)
  })
}
