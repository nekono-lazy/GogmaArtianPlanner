import {
  assertPlannerOrchestrationBounds,
  type PlannerOrchestrationBounds,
} from '../domain/planner'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { createProductionPlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  createPlannerOrchestrationBenchmarkInput,
  type PlannerOrchestrationBenchmarkFixture,
} from './plannerOrchestrationBenchmarkFixtures'
import {
  createPlannerOrchestrationOutcome,
  readPlannerOrchestrationBoundFlags,
  type PlannerOrchestrationBoundFlags,
  type PlannerOrchestrationOutcome,
} from './plannerOrchestrationBenchmarkOutcome'

/**
 * B8-E1 Planner orchestration Browser benchmark harness.
 *
 * The measured path is the Production one, end to end. There is no benchmark
 * Worker, no benchmark Planner protocol, and no benchmark calculation:
 *
 * ```text
 * Browser main thread
 *   -> createProductionPlannerWorkerClient()
 *   -> planner.worker.entry.ts                    (real Production Worker)
 *   -> createProductionPlannerWorkerCalculations() (real Production adapter)
 *   -> defaultConstrainedEnumerationBounds         (B8-B2 authority, inside the Worker)
 *   -> createProductionPlanWithConstrainedSearch() (real B8-C4b orchestration)
 *   -> ProductionRngEngine / Beam Search / Trace Replay
 *   -> structured clone back to the main thread
 * ```
 *
 * `ConstrainedEnumerationBounds` is deliberately not a parameter here: the
 * Production Worker adapter supplies it inside the Worker boundary, exactly as
 * `BuildListPage` will in B8-D2b. Passing one from the benchmark would bypass
 * the adapter and measure a path Production never takes.
 *
 * `PlannerOrchestrationBounds` is caller-supplied and validated with the Domain
 * validator, which repairs nothing. B8-E1 adds no Production default for it.
 *
 * ## Timing boundary
 *
 * `roundTripMs` starts immediately before `createConstrainedPlan()` and ends
 * when its Promise settles.
 *
 * Outside it:
 *
 * ```text
 * fixture construction
 * PlannerOrchestrationBounds validation
 * Worker Client construction, including the `new Worker(...)` constructor
 * dispose()
 * outcome digest construction
 * ```
 *
 * Inside it:
 *
 * ```text
 * the createConstrainedPlan() call itself
 * the request postMessage and the PlannerInput structured clone
 * whatever Worker asynchronous initialization is still outstanding before the
 *   first request can be processed
 * the Production calculation
 * the response structured clone and its delivery
 * ```
 *
 * The `new Worker(...)` constructor therefore is *not* measured - this is not
 * "the whole Worker start-up". What is measured is the part of Worker
 * initialization that has not finished by the time the request is posted, which
 * is the part a caller actually waits for. B8-D2b's `BuildListPage` holds its
 * Worker Client the same way, from before planning starts, so this boundary is
 * the one Production crosses. Nothing is subtracted from it, and no estimated
 * baseline is removed before it is recorded.
 *
 * ## Fresh Worker policy
 *
 * One run owns one Worker Client, created before the measurement and disposed
 * after it, so every warm-up and every measurement runs against a freshly
 * created Worker. Its outstanding initialization is therefore never amortized
 * across runs. A warm-up run exists to settle the Browser, its JIT, and the
 * module cache - not to hand a warmed Worker to the measurement. This mirrors
 * the B8-B2 procedure.
 */

export type PlannerOrchestrationRunStatus = 'completed' | 'error'

export interface PlannerOrchestrationRunResult {
  readonly requestId: string
  readonly workloadId: string
  readonly status: PlannerOrchestrationRunStatus
  readonly orchestrationBounds: PlannerOrchestrationBounds
  /** `createConstrainedPlan()` call to Promise settle, on the main-thread clock. */
  readonly roundTripMs: number
  readonly outcome: PlannerOrchestrationOutcome | null
  readonly boundFlags: PlannerOrchestrationBoundFlags | null
  readonly generatedBuildListEntryCount: number | null
  readonly conflictCount: number | null
  readonly progressEvents: number
  readonly engineVersion: string
  readonly error: string | null
}

export interface PlannerOrchestrationRunOptions {
  readonly requestId: string
  readonly workloadId: string
  readonly orchestrationBounds: PlannerOrchestrationBounds
}

export interface PlannerOrchestrationBenchmarkDependencies {
  /**
   * Creates the Worker Client for one run. It defaults to the Production one;
   * the harness tests substitute a fake so they never start a real Worker.
   */
  readonly createClient?: () => PlannerWorkerClient
  readonly now?: () => number
  readonly createFixture?: (
    workloadId: string,
  ) => PlannerOrchestrationBenchmarkFixture
}

/**
 * Runs one measurement.
 *
 * Invalid `PlannerOrchestrationBounds` throw before any Worker is created: a
 * malformed bound is a caller contract violation, not a measurement.
 */
export async function runPlannerOrchestrationBenchmark(
  options: PlannerOrchestrationRunOptions,
  dependencies: PlannerOrchestrationBenchmarkDependencies = {},
): Promise<PlannerOrchestrationRunResult> {
  const now = dependencies.now ?? (() => performance.now())
  const createFixture =
    dependencies.createFixture ?? createPlannerOrchestrationBenchmarkInput
  const createClient =
    dependencies.createClient ?? createProductionPlannerWorkerClient

  assertPlannerOrchestrationBounds(options.orchestrationBounds)
  // Outside the measured window: the Production caller already holds its
  // PlannerInput when it asks for a Plan.
  const fixture = createFixture(options.workloadId)
  const ownedWeaponIds = fixture.input.ownedWeapons.map(({ id }) => id as string)
  let progressEvents = 0
  // Also outside it, including the `new Worker(...)` constructor: BuildListPage
  // holds its Client from before planning starts too. Whatever Worker
  // initialization is still outstanding when the request is posted does land
  // inside the measurement, because a caller waits for exactly that.
  const client = createClient()

  const startedAt = now()
  try {
    const result = await client.createConstrainedPlan(
      options.requestId,
      fixture.input,
      options.orchestrationBounds,
      {
        // Counted only as a diagnostic: the benchmark keeps no progress trace.
        onProgress: () => {
          progressEvents += 1
        },
      },
    )
    const settledAt = now()
    client.dispose()
    const outcome = createPlannerOrchestrationOutcome(result, ownedWeaponIds)
    return {
      requestId: options.requestId,
      workloadId: options.workloadId,
      status: 'completed',
      orchestrationBounds: { ...options.orchestrationBounds },
      roundTripMs: settledAt - startedAt,
      outcome,
      boundFlags: readPlannerOrchestrationBoundFlags(outcome.warningKinds),
      generatedBuildListEntryCount: result.generatedBuildListEntries.length,
      conflictCount: result.conflicts.length,
      progressEvents,
      engineVersion: client.engineVersion,
      error: null,
    }
  } catch (error) {
    const settledAt = now()
    const engineVersion = client.engineVersion
    client.dispose()
    return {
      requestId: options.requestId,
      workloadId: options.workloadId,
      status: 'error',
      orchestrationBounds: { ...options.orchestrationBounds },
      roundTripMs: settledAt - startedAt,
      outcome: null,
      boundFlags: null,
      generatedBuildListEntryCount: null,
      conflictCount: null,
      progressEvents,
      engineVersion,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
