import {
  PLANNER_ALTERNATIVE_PARITY_LEADING_KEYS,
  PLANNER_ALTERNATIVE_RECORDED_CANDIDATE_TIMES,
  type PlannerAlternativeBenchmarkRequest,
  type PlannerAlternativeBenchmarkResponse,
  type PlannerAlternativeKernelRunRequest,
  type PlannerAlternativePredictionCounts,
  type PlannerAlternativeSearchRunRequest,
} from '../benchmarks/plannerAlternativeBenchmarkProtocol'
import {
  createCountingRngEngine,
  createPlannerAlternativeSearchObserver,
  observePlannerAlternativeKernelDependencies,
  summarizePlannerAlternativeKernelResult,
} from '../benchmarks/plannerAlternativeBenchmarkInstrumentation'
import { summarizeIssue101Route } from '../benchmarks/issue101RouteSummary'
import { hashStableValue } from '../domain/models/publicTypes'
import {
  assertPlannerAlternativeTrialBounds,
  PlannerAlternativeCancelledError,
  runPlannerAlternativeKernel,
  type PlannerDependencies,
} from '../domain/planner'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  CandidateSearchError,
  candidateStableKey,
  validatePlannerAlternativeSearchExtent,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import type { Issue101RouteSummary } from '../benchmarks/issue101ConstrainedResearchProtocol'
import { benchmarkWorkerYield } from './constrainedEnumeration.worker.benchmark'

/**
 * Planner Alternative Search Phase 3-A benchmark-only Worker controller
 * (`docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`).
 *
 * `search` calls `visitPlannerAlternativeCandidates()` directly; `kernel`
 * calls `runPlannerAlternativeKernel()` with the Production Planner
 * dependencies the entry supplies (`ProductionRngEngine`, UUID IDs, UTC
 * clock), so every trial is the Phase 2 full Production Plan run plus Trace
 * Replay. Nothing Production imports this module and no Production Worker
 * protocol changed.
 *
 * Cancellation and yield are the Production-compatible execution seam
 * (`shouldCancel`, `yieldControl`); the yield is the B8-B2 benchmark
 * MessageChannel macrotask, reused rather than copied: a microtask would never
 * let a pending cancel or ping through, and a timer would measure its clamp.
 */
export type PlannerAlternativeBenchmarkPostMessage = (response: PlannerAlternativeBenchmarkResponse) => void

export interface PlannerAlternativeBenchmarkController {
  handleMessage: (request: PlannerAlternativeBenchmarkRequest) => Promise<void>
}

export interface PlannerAlternativeBenchmarkControllerOptions {
  /** Worker-local clock; `performance.now()` in the Worker. */
  readonly now?: () => number
  readonly yieldControl?: () => Promise<void>
}

function assertExtent(extent: PlannerAlternativeSearchExtent): void {
  const issues = validatePlannerAlternativeSearchExtent(extent)
  if (issues.length > 0) {
    throw new RangeError(
      `Invalid PlannerAlternativeSearchExtent: ${issues.map(({ path, message }) => `${path}: ${message}`).join(' / ')}`,
    )
  }
}

function isCancellation(error: unknown): boolean {
  return (error instanceof CandidateSearchError && error.code === 'cancelled') ||
    error instanceof PlannerAlternativeCancelledError
}

export function createPlannerAlternativeBenchmarkController(
  createDependencies: () => PlannerDependencies,
  postMessage: PlannerAlternativeBenchmarkPostMessage,
  options: PlannerAlternativeBenchmarkControllerOptions = {},
): PlannerAlternativeBenchmarkController {
  const now = options.now ?? (() => performance.now())
  const yieldControl = options.yieldControl ?? benchmarkWorkerYield
  const cancelledRequestIds = new Set<string>()
  const dependencies = createDependencies()

  async function runSearch(request: PlannerAlternativeSearchRunRequest): Promise<void> {
    assertExtent(request.input.extent)
    const counting = request.instrumented ? createCountingRngEngine(dependencies.rngEngine) : null
    const observer = request.instrumented ? createPlannerAlternativeSearchObserver() : null
    const engine: RngEngine = counting?.engine ?? dependencies.rngEngine
    const parity = request.recording === 'parity'
    const parityKeys: string[] = []
    const times: number[] = []
    let delivered = 0
    let settledAtFirst: number | null = null
    let countsAtFirst: PlannerAlternativePredictionCounts | null = null
    let firstCandidate: Issue101RouteSummary | null = null
    // The measurement anchor.
    const startedAt = now()
    try {
      const execution = await visitPlannerAlternativeCandidates(
        request.input,
        engine,
        (candidate) => {
          delivered += 1
          if (times.length < PLANNER_ALTERNATIVE_RECORDED_CANDIDATE_TIMES) times.push(now() - startedAt)
          if (delivered === 1) {
            settledAtFirst = observer?.settledWorkItems() ?? null
            countsAtFirst = counting?.counts() ?? null
            firstCandidate = summarizeIssue101Route(candidate.route, candidate)
            if (request.notifyFirstCandidate) {
              postMessage({ type: 'pa3_benchmark_first_candidate', requestId: request.requestId })
            }
          }
          if (parity) parityKeys.push(candidateStableKey(candidate))
          return request.stopAfterCandidates !== null && delivered >= request.stopAfterCandidates
            ? 'stop'
            : 'continue'
        },
        {
          shouldCancel: () => cancelledRequestIds.has(request.requestId),
          yieldControl,
          instrumentation: observer?.instrumentation,
        },
      )
      const workerElapsedMs = now() - startedAt
      postMessage({
        type: 'pa3_benchmark_search_result',
        requestId: request.requestId,
        extent: { ...request.input.extent },
        measurement: {
          workerElapsedMs,
          timeToFirstCandidateMs: times[0] ?? null,
          candidateTimesMs: times,
          deliveredCandidates: delivered,
          settledWorkItemsAtFirstCandidate: settledAtFirst,
          settledWorkItemsTotal: observer?.settledWorkItems() ?? null,
          predictionCounts: counting?.counts() ?? null,
          predictionCountsAtFirstCandidate: countsAtFirst,
          skillStreams: observer?.skill() ?? null,
          gogmaStreams: observer?.gogma() ?? null,
          firstCandidate,
          summary: { ...execution.summary },
          stoppedByConsumer: execution.stoppedByConsumer,
          parity: parity
            ? {
                candidateKeyDigest: hashStableValue(parityKeys),
                leadingCandidateKeys: parityKeys.slice(0, PLANNER_ALTERNATIVE_PARITY_LEADING_KEYS),
              }
            : null,
        },
      })
    } catch (error) {
      if (isCancellation(error)) {
        postMessage({
          type: 'pa3_benchmark_cancelled',
          requestId: request.requestId,
          workerElapsedMs: now() - startedAt,
          deliveredCandidates: delivered,
        })
        return
      }
      throw error
    }
  }

  async function runKernel(request: PlannerAlternativeKernelRunRequest): Promise<void> {
    assertExtent(request.request.extent)
    assertPlannerAlternativeTrialBounds(request.request.bounds)
    const counting = request.instrumented ? createCountingRngEngine(dependencies.rngEngine) : null
    // The measurement anchor: the observation clock starts here.
    const startedAt = now()
    const observed = observePlannerAlternativeKernelDependencies(
      { ...dependencies, rngEngine: counting?.engine ?? dependencies.rngEngine },
      () => now() - startedAt,
      () => {
        if (request.notifyFirstCandidate) {
          postMessage({ type: 'pa3_benchmark_first_candidate', requestId: request.requestId })
        }
      },
    )
    try {
      const result = await runPlannerAlternativeKernel(request.request, observed.dependencies, {
        executionOptions: {
          shouldCancel: () => cancelledRequestIds.has(request.requestId),
          yieldControl,
        },
      })
      postMessage({
        type: 'pa3_benchmark_kernel_result',
        requestId: request.requestId,
        extent: { ...request.request.extent },
        bounds: { ...request.request.bounds },
        measurement: {
          workerElapsedMs: now() - startedAt,
          timeToFirstTrialMs: observed.firstClockReadMs(),
          predictionCounts: counting?.counts() ?? null,
          result: summarizePlannerAlternativeKernelResult(result),
        },
      })
    } catch (error) {
      if (isCancellation(error)) {
        postMessage({
          type: 'pa3_benchmark_cancelled',
          requestId: request.requestId,
          workerElapsedMs: now() - startedAt,
          deliveredCandidates: observed.materializations(),
        })
        return
      }
      throw error
    }
  }

  return {
    handleMessage: async (request) => {
      if (request.type === 'pa3_benchmark_ping') {
        postMessage({ type: 'pa3_benchmark_pong', pingId: request.pingId })
        return
      }
      if (request.type === 'pa3_benchmark_cancel') {
        cancelledRequestIds.add(request.requestId)
        postMessage({ type: 'pa3_benchmark_cancel_ack', requestId: request.requestId })
        return
      }
      cancelledRequestIds.delete(request.requestId)
      postMessage({ type: 'pa3_benchmark_accepted', requestId: request.requestId })
      try {
        if (request.type === 'pa3_benchmark_search') await runSearch(request)
        else await runKernel(request)
      } catch (error) {
        postMessage({
          type: 'pa3_benchmark_error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

export interface PlannerAlternativeBenchmarkWorkerScope {
  postMessage: PlannerAlternativeBenchmarkPostMessage
  addEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void
}

export function attachPlannerAlternativeBenchmarkWorker(
  scope: PlannerAlternativeBenchmarkWorkerScope,
  createDependencies: () => PlannerDependencies,
  isRequest: (value: unknown) => value is PlannerAlternativeBenchmarkRequest,
): PlannerAlternativeBenchmarkController {
  const controller = createPlannerAlternativeBenchmarkController(createDependencies, (response) =>
    scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    if (isRequest(event.data)) void controller.handleMessage(event.data)
  })
  return controller
}
