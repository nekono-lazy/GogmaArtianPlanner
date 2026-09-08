import { assertPlannerWhatIfBounds, type PlannerWhatIfBounds, type PlannerWhatIfCalculationResult } from '../domain/planner'
import { createProductionPlannerWorkerClient, type PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { createPlannerWhatIfBenchmarkFixture, plannerWhatIfBenchmarkWorkload, type PlannerWhatIfBenchmarkFixture } from './plannerWhatIfBenchmarkFixtures'
import { createPlannerWhatIfBenchmarkOutcome, type PlannerWhatIfBenchmarkOutcome } from './plannerWhatIfBenchmarkOutcome'

export interface PlannerWhatIfBenchmarkRunOptions {
  readonly requestId: string
  readonly workloadId: string
  readonly bounds: PlannerWhatIfBounds
}

export interface PlannerWhatIfBenchmarkRunResult extends PlannerWhatIfBenchmarkRunOptions {
  readonly status: 'completed' | 'error'
  readonly roundTripMs: number
  readonly outcome: PlannerWhatIfBenchmarkOutcome | null
  readonly progressEvents: number
  readonly engineVersion: string
  readonly error: string | null
}

/** Dependency substitution is for harness contract tests only, never measurement evidence. */
export interface PlannerWhatIfBenchmarkDependencies {
  readonly createClient?: () => PlannerWorkerClient
  readonly createFixture?: (workloadId: string) => PlannerWhatIfBenchmarkFixture
  readonly now?: () => number
}

/**
 * 1 run = 1 fresh Production Planner Worker Client, including warm-ups.
 * Only createWhatIfComparison call -> Promise settle is timed: postMessage,
 * structured clones, outstanding async Worker initialization, Production
 * enumeration/materialization/preflight/full Beam/Trace Replay and delivery.
 * Fixture, validation, Client/new Worker constructor, dispose and normalization
 * are outside the clock interval. No main-thread calculation fallback exists.
 * Enumeration bounds are supplied ONLY by the Production adapter in the Worker.
 */
export async function runPlannerWhatIfBenchmark(
  options: PlannerWhatIfBenchmarkRunOptions,
  dependencies: PlannerWhatIfBenchmarkDependencies = {},
): Promise<PlannerWhatIfBenchmarkRunResult> {
  assertPlannerWhatIfBounds(options.bounds)
  plannerWhatIfBenchmarkWorkload(options.workloadId)
  const recordedBounds = { ...options.bounds }
  const fixture = (dependencies.createFixture ?? createPlannerWhatIfBenchmarkFixture)(options.workloadId)
  const now = dependencies.now ?? (() => performance.now())
  const client = (dependencies.createClient ?? createProductionPlannerWorkerClient)()
  const request = { plannerInput: fixture.plannerInput, scenarioResolution: fixture.scenarioResolution, bounds: options.bounds }
  let progressEvents = 0
  const callbacks = { onProgress: () => { progressEvents += 1 } }
  let result: PlannerWhatIfCalculationResult | undefined
  let failure: unknown
  let failed = false
  let settledAt: number
  const startedAt = now()
  try {
    result = await client.createWhatIfComparison(options.requestId, request, callbacks)
    settledAt = now()
  } catch (error) {
    settledAt = now()
    failed = true
    failure = error
  } finally {
    client.dispose()
  }
  // Deliberately outside the try/catch: a normalization defect must not be
  // mistaken for a Worker error or change the measured settlement boundary.
  return {
    requestId: options.requestId,
    workloadId: options.workloadId,
    bounds: recordedBounds,
    status: failed ? 'error' : 'completed',
    roundTripMs: settledAt - startedAt,
    outcome: result === undefined ? null : createPlannerWhatIfBenchmarkOutcome(result),
    progressEvents, engineVersion: client.engineVersion,
    error: failed ? failure instanceof Error ? failure.message : String(failure) : null,
  }
}
