import { createPlannerSearchInstrumentationInput } from '../benchmarks/plannerSearchInstrumentationFixtures'
import {
  executePlannerSearchInstrumentation,
  type PlannerSearchInstrumentationRunResult,
} from '../benchmarks/plannerSearchInstrumentationBenchmark'
import {
  executePlannerSchedulerInstrumentation,
  type PlannerSchedulerInstrumentationRunResult,
} from '../benchmarks/plannerSchedulerInstrumentationBenchmark'
import {
  summarizePlannerStrategyRun,
  type PlannerBenchmarkStrategy,
  type PlannerStrategyRunSummary,
} from '../benchmarks/plannerSchedulerParity'
import type {
  PlannerBeamSearchInput,
  PlannerBeamSearchOptions,
  PlannerInput,
  PlannerSearchDepthMetrics,
} from '../domain/planner'
import type { RngEngine } from '../domain/rng/rngEngine'
import { benchmarkWorkerYield } from './constrainedEnumeration.worker.benchmark'

/**
 * Issue #103 benchmark-only Worker controller.
 *
 * It runs, inside a real Browser Worker, either the Beam Search oracle
 * `runPlannerBeamSearch()` through the PR #107 instrumentation harness, or -
 * Issue #103 Phase B - the deterministic scheduler (the Production Planner
 * since Phase C) through its own harness.
 * The strategy is a field of this benchmark request only: no Production Worker
 * protocol, Planner Worker controller, `PlannerInput` or persistence carries
 * it, and the normal application never loads this Worker. The source is either
 * a Repository fixture workload or a PlannerInput the benchmark page assembled
 * in memory from a pasted Export.
 */
export type PlannerSearchInstrumentationBenchmarkSource =
  | { kind: 'workload'; workloadId: string }
  | { kind: 'input'; input: PlannerInput }

/**
 * One benchmark run's result. The Beam Search variant keeps the PR #107
 * `result` field unchanged; the scheduler has its own metrics shape, so no
 * Beam depth / trim / dedup value is filled in for it. `summary` is the
 * Phase B parity summary (Trace Replay, Production projection, completed
 * Targets), computed after the measured search; `null` when not requested.
 */
export type PlannerBenchmarkRunResult =
  | {
      strategy: 'beam'
      result: PlannerSearchInstrumentationRunResult
      summary: PlannerStrategyRunSummary | null
    }
  | {
      strategy: 'scheduler'
      scheduler: PlannerSchedulerInstrumentationRunResult
      summary: PlannerStrategyRunSummary | null
    }

export type PlannerSearchInstrumentationBenchmarkRequest =
  | {
      type: 'issue103_run'
      requestId: string
      source: PlannerSearchInstrumentationBenchmarkSource
      /**
       * The benchmark bounds. The scheduler run receives `maxPlanSteps` only,
       * as Production does; `beamWidth` / `maxExpandedStates` reach the Beam
       * Search oracle alone (Issue #103 Phase D-2a).
       */
      options: PlannerBeamSearchOptions
      instrumented: boolean
      collectDiagnosticProjections: boolean
      /** Benchmark-only; omitted means the PR #107 Beam Search run. */
      strategy?: PlannerBenchmarkStrategy
      /** Omitted means `true`: add the Phase B parity summary after the run. */
      summarize?: boolean
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
      type: 'issue103_progress'
      requestId: string
      expandedStates: number
      elapsedMs: number
    }
  | {
      type: 'issue103_result'
      requestId: string
      entryCount: number
      run: PlannerBenchmarkRunResult
    }
  | { type: 'issue103_error'; requestId: string; message: string }

export type PlannerSearchInstrumentationBenchmarkPostMessage = (
  response: PlannerSearchInstrumentationBenchmarkResponse,
) => void

/** Scheduler progress is posted every this many applied actions. */
export const SCHEDULER_BENCHMARK_PROGRESS_INTERVAL = 256

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
        const beamInput: PlannerBeamSearchInput = { ...input, options: { ...request.options } }
        const schedulerInput: PlannerInput = {
          ...input,
          options: { maxPlanSteps: request.options.maxPlanSteps },
        }
        const strategy = request.strategy ?? 'beam'
        const summarize = request.summarize ?? true
        const startedAt = now()
        const shouldCancel = () => cancelled.has(request.requestId)
        let run: PlannerBenchmarkRunResult
        if (strategy === 'beam') {
          const executed = await executePlannerSearchInstrumentation(beamInput, engine, {
            instrumented: request.instrumented,
            collectDiagnosticProjections: request.collectDiagnosticProjections,
            now,
            shouldCancel,
            yieldControl: benchmarkWorkerYield,
            onDepth: (depth) =>
              postMessage({
                type: 'issue103_depth',
                requestId: request.requestId,
                depth,
                elapsedMs: now() - startedAt,
              }),
          })
          run = {
            strategy,
            result: executed.run,
            summary: summarize
              ? await summarizePlannerStrategyRun({
                  strategy,
                  input: beamInput,
                  result: executed.result,
                  engine,
                  dependencies: executed.dependencies,
                })
              : null,
          }
        } else {
          const executed = await executePlannerSchedulerInstrumentation(schedulerInput, engine, {
            instrumented: request.instrumented,
            now,
            shouldCancel,
            yieldControl: benchmarkWorkerYield,
            onProgress: (expandedStates) => {
              if (expandedStates % SCHEDULER_BENCHMARK_PROGRESS_INTERVAL !== 0) return
              postMessage({
                type: 'issue103_progress',
                requestId: request.requestId,
                expandedStates,
                elapsedMs: now() - startedAt,
              })
            },
          })
          run = {
            strategy,
            scheduler: executed.run,
            summary: summarize
              ? await summarizePlannerStrategyRun({
                  strategy,
                  input: schedulerInput,
                  result: executed.result,
                  engine,
                  dependencies: executed.dependencies,
                  schedulerMetrics: executed.run.metrics,
                })
              : null,
          }
        }
        postMessage({
          type: 'issue103_result',
          requestId: request.requestId,
          entryCount: input.buildListEntries.length,
          run,
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
