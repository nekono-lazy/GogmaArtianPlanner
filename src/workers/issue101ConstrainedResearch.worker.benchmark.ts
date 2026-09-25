import {
  ISSUE_101_RECORDED_CANDIDATE_TIMES,
  type Issue101BenchmarkRequest,
  type Issue101BenchmarkResponse,
  type Issue101EnumerationRunRequest,
  type Issue101OrchestrationEvent,
  type Issue101OrchestrationMeasurement,
  type Issue101OrchestrationRunRequest,
  type Issue101RouteSummary,
} from '../benchmarks/issue101ConstrainedResearchProtocol'
import { summarizeIssue101Route } from '../benchmarks/issue101RouteSummary'
import {
  assertPlannerOrchestrationBounds,
  createProductionPlanWithConstrainedSearch,
  type PlannerDependencies,
  type PlannerOrchestrationResult,
} from '../domain/planner'
import {
  CandidateSearchError,
  validateConstrainedEnumerationBounds,
  visitConstrainedCandidates,
  type ConstrainedEnumerationBounds,
} from '../domain/search'
import { benchmarkWorkerYield } from './constrainedEnumeration.worker.benchmark'

/**
 * Issue #101 benchmark-only Worker controller.
 *
 * `enumeration` calls `visitConstrainedCandidates()` directly. `orchestration`
 * calls the Production `createProductionPlanWithConstrainedSearch()` with the
 * Production Planner dependencies the caller supplies - exactly what the
 * Production Planner Worker adapter does - except that the enumeration bounds
 * come from the request instead of `defaultConstrainedEnumerationBounds`.
 * Nothing Production imports this module, and no Production module changed.
 *
 * The yield is the B8-B2 benchmark MessageChannel macrotask yield, reused
 * rather than copied again: a timer would measure its own clamp, and a
 * microtask would never let a pending cancel message through.
 */
export type Issue101BenchmarkPostMessage = (response: Issue101BenchmarkResponse) => void

export interface Issue101BenchmarkController {
  handleMessage: (request: Issue101BenchmarkRequest) => Promise<void>
}

function assertBounds(bounds: ConstrainedEnumerationBounds): void {
  const issues = validateConstrainedEnumerationBounds(bounds)
  if (issues.length > 0) {
    throw new RangeError(
      `Invalid ConstrainedEnumerationBounds: ${issues.map(({ path, message }) => `${path}: ${message}`).join(' / ')}`,
    )
  }
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Wraps the Production Planner dependencies so the orchestration's Candidate
 * trials and Plan generations can be timed. Every returned value is the
 * Production dependency's own; only the call instants are recorded.
 */
export function observeIssue101PlannerDependencies(
  dependencies: PlannerDependencies,
  now: () => number,
  onClockRead: () => void = () => undefined,
): { dependencies: PlannerDependencies; events: () => Issue101OrchestrationEvent[] } {
  const clockCalls: number[] = []
  const planAt = new Set<number>()
  return {
    dependencies: {
      ...dependencies,
      clock: {
        now: () => {
          clockCalls.push(now())
          onClockRead()
          return dependencies.clock.now()
        },
      },
      idFactory: {
        ...dependencies.idFactory,
        productionPlanId: () => {
          // Plan generation reads the clock immediately before the Plan ID.
          if (clockCalls.length > 0) planAt.add(clockCalls.length - 1)
          return dependencies.idFactory.productionPlanId()
        },
      },
    },
    events: () =>
      clockCalls.map((atMs, index) =>
        planAt.has(index)
          ? { kind: 'plan_generated' as const, atMs }
          : { kind: 'candidate_materialized' as const, atMs },
      ),
  }
}

/** Derives the headline numbers of one orchestration run from its timeline. */
export function summarizeIssue101Orchestration(
  events: readonly Issue101OrchestrationEvent[],
  result: PlannerOrchestrationResult,
  workerElapsedMs: number,
): Issue101OrchestrationMeasurement {
  const materialized = events.filter(({ kind }) => kind === 'candidate_materialized')
  const plans = events.filter(({ kind }) => kind === 'plan_generated')
  const initialPlan = events[0]?.kind === 'plan_generated' ? events[0] : null
  const adopted = result.generatedBuildListEntries.length > 0
  // The orchestration stops a work at its adoption, so the adopted trial is
  // the last Candidate trial and its Plan the last Plan generation.
  const lastPlan = plans.at(-1) ?? null
  const adoptedPlan =
    adopted && lastPlan !== null && materialized.length > 0 &&
    lastPlan.atMs >= (materialized.at(-1)?.atMs ?? Infinity)
      ? lastPlan
      : null
  return {
    workerElapsedMs,
    events: [...events],
    candidateTrials: materialized.length,
    planGenerations: plans.length,
    initialPlannerRunMs: initialPlan?.atMs ?? null,
    timeToFirstCandidateMs: materialized[0]?.atMs ?? null,
    timeToAdoptedCandidateMs: adoptedPlan?.atMs ?? null,
    adoptedCandidateOrdinal: adoptedPlan === null ? null : materialized.length,
    planPresent: result.plan !== null,
    planStepCount: result.plan?.steps.length ?? null,
    terminationStatus: result.termination.status,
    selectedBuildListEntryIds: [...(result.plan?.selectedBuildListEntryIds ?? [])].sort(
      compareStableStrings,
    ),
    conflicts: result.conflicts
      .map(({ kind, buildListEntryIds, selectedBuildListEntryId }) => ({
        kind,
        buildListEntryIds: [...buildListEntryIds].sort(compareStableStrings),
        selectedBuildListEntryId,
      }))
      .sort((left, right) => compareStableStrings(left.kind, right.kind)),
    warningKinds: result.warnings.map(({ kind }) => kind as string).sort(compareStableStrings),
    generatedBuildListEntryCount: result.generatedBuildListEntries.length,
    generatedRoutes: result.generatedBuildListEntries.map(({ candidateSnapshot }) =>
      summarizeIssue101Route(candidateSnapshot.route, candidateSnapshot),
    ),
  }
}

export function createIssue101BenchmarkController(
  createDependencies: () => PlannerDependencies,
  postMessage: Issue101BenchmarkPostMessage,
): Issue101BenchmarkController {
  const cancelledRequestIds = new Set<string>()
  const dependencies = createDependencies()

  async function runEnumeration(request: Issue101EnumerationRunRequest): Promise<void> {
    assertBounds(request.input.bounds)
    const times: number[] = []
    let delivered = 0
    let firstCandidate: Issue101RouteSummary | null = null
    // The measurement anchor.
    const startedAt = performance.now()
    try {
      const execution = await visitConstrainedCandidates(
        request.input,
        dependencies.rngEngine,
        (candidate) => {
          delivered += 1
          if (delivered === 1 && request.notifyFirstCandidate) {
            postMessage({ type: 'i101_benchmark_first_candidate', requestId: request.requestId })
          }
          if (times.length < ISSUE_101_RECORDED_CANDIDATE_TIMES) {
            times.push(performance.now() - startedAt)
          }
          if (delivered === 1) firstCandidate = summarizeIssue101Route(candidate.route, candidate)
          return request.stopAfterCandidates !== null &&
            delivered >= request.stopAfterCandidates
            ? 'stop'
            : 'continue'
        },
        {
          shouldCancel: () => cancelledRequestIds.has(request.requestId),
          yieldControl: benchmarkWorkerYield,
        },
      )
      postMessage({
        type: 'i101_benchmark_enumeration_result',
        requestId: request.requestId,
        bounds: { ...request.input.bounds },
        measurement: {
          workerElapsedMs: performance.now() - startedAt,
          deliveredCandidates: delivered,
          timeToFirstCandidateMs: times[0] ?? null,
          candidateTimesMs: times,
          firstCandidate,
          summary: execution.summary,
          stoppedByConsumer: execution.stoppedByConsumer,
        },
      })
    } catch (error) {
      if (error instanceof CandidateSearchError && error.code === 'cancelled') {
        postMessage({
          type: 'i101_benchmark_cancelled',
          requestId: request.requestId,
          workerElapsedMs: performance.now() - startedAt,
          deliveredCandidates: delivered,
          settledAsResult: false,
        })
        return
      }
      throw error
    }
  }

  async function runOrchestration(request: Issue101OrchestrationRunRequest): Promise<void> {
    assertBounds(request.enumerationBounds)
    assertPlannerOrchestrationBounds(request.orchestrationBounds)
    // The measurement anchor: the observation clock starts here.
    const startedAt = performance.now()
    let clockReads = 0
    const observed = observeIssue101PlannerDependencies(
      dependencies,
      () => performance.now() - startedAt,
      () => {
        clockReads += 1
        // The second clock read is the first Candidate trial (the first one is
        // the initial Plan); the notice goes out before that trial's rerun.
        if (clockReads === 2 && request.notifyFirstCandidate) {
          postMessage({ type: 'i101_benchmark_first_candidate', requestId: request.requestId })
        }
      },
    )
    const cancelled = () => cancelledRequestIds.has(request.requestId)
    try {
      const result = await createProductionPlanWithConstrainedSearch(
        request.input,
        observed.dependencies,
        {
          enumerationBounds: request.enumerationBounds,
          orchestrationBounds: request.orchestrationBounds,
          executionOptions: { shouldCancel: cancelled, yieldControl: benchmarkWorkerYield },
        },
      )
      const workerElapsedMs = performance.now() - startedAt
      const events = observed.events()
      if (cancelled()) {
        // The orchestration handles a cancellation inside a full Planner run
        // as an ordinary `plan: null` result (PLANNER_SPEC 9.2.16).
        postMessage({
          type: 'i101_benchmark_cancelled',
          requestId: request.requestId,
          workerElapsedMs,
          deliveredCandidates: events.filter(({ kind }) => kind === 'candidate_materialized').length,
          settledAsResult: true,
        })
        return
      }
      postMessage({
        type: 'i101_benchmark_orchestration_result',
        requestId: request.requestId,
        enumerationBounds: { ...request.enumerationBounds },
        orchestrationBounds: { ...request.orchestrationBounds },
        measurement: summarizeIssue101Orchestration(events, result, workerElapsedMs),
      })
    } catch (error) {
      if (error instanceof CandidateSearchError && error.code === 'cancelled') {
        postMessage({
          type: 'i101_benchmark_cancelled',
          requestId: request.requestId,
          workerElapsedMs: performance.now() - startedAt,
          deliveredCandidates: observed
            .events()
            .filter(({ kind }) => kind === 'candidate_materialized').length,
          settledAsResult: false,
        })
        return
      }
      throw error
    }
  }

  return {
    handleMessage: async (request) => {
      if (request.type === 'i101_benchmark_ping') {
        postMessage({ type: 'i101_benchmark_pong', pingId: request.pingId })
        return
      }
      if (request.type === 'i101_benchmark_cancel') {
        cancelledRequestIds.add(request.requestId)
        postMessage({ type: 'i101_benchmark_cancel_ack', requestId: request.requestId })
        return
      }
      cancelledRequestIds.delete(request.requestId)
      postMessage({ type: 'i101_benchmark_accepted', requestId: request.requestId })
      try {
        if (request.type === 'i101_benchmark_enumeration') await runEnumeration(request)
        else await runOrchestration(request)
      } catch (error) {
        postMessage({
          type: 'i101_benchmark_error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

export interface Issue101BenchmarkWorkerScope {
  postMessage: Issue101BenchmarkPostMessage
  addEventListener: (
    type: 'message',
    listener: (event: { data: Issue101BenchmarkRequest }) => void,
  ) => void
}

export function attachIssue101BenchmarkWorker(
  scope: Issue101BenchmarkWorkerScope,
  createDependencies: () => PlannerDependencies,
): Issue101BenchmarkController {
  const controller = createIssue101BenchmarkController(createDependencies, (response) =>
    scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    void controller.handleMessage(event.data)
  })
  return controller
}
