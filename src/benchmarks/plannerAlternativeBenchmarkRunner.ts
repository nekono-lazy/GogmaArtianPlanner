import type { PlannerAlternativeTrialBounds } from '../domain/planner'
import type { PlannerAlternativeSearchExtent } from '../domain/search'
import { summarizeIssue101Route } from './issue101RouteSummary'
import {
  assertPlannerAlternativeRunOptions,
  createPlannerAlternativeBenchmarkHarness,
  type PlannerAlternativeBenchmarkHarness,
  type PlannerAlternativeHarnessRunOptions,
  type PlannerAlternativeRunOutcome,
  type PlannerAlternativeRunResult,
} from './plannerAlternativeBrowserBenchmark'
import {
  createIssue101DragonReservation,
  createIssue101KernelRequest,
  createLongHeldFixture,
  createPlannerAlternativeSearchWorkloadInput,
  PLANNER_ALTERNATIVE_KERNEL_WORKLOADS,
  PLANNER_ALTERNATIVE_SEARCH_WORKLOADS,
  plannerAlternativeSearchWorkloadNeedsIssue101,
  type Issue101RealFixture,
  type LongHeldOptions,
  type PlannerAlternativeKernelWorkloadId,
  type PlannerAlternativeSearchWorkloadId,
} from './plannerAlternativeBenchmarkFixtures'
import {
  createPlannerAlternativeRerunPressureFixture,
  createPlannerAlternativeRerunPressureKernelRequest,
  type PlannerAlternativeRerunPressureFixture,
} from './plannerAlternativeRerunPressureFixtures'
import {
  PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION,
  type PlannerAlternativeRecordingMode,
} from './plannerAlternativeBenchmarkProtocol'

/**
 * Planner Alternative Search Phase 3-A run orchestration: fixture caching,
 * fresh Worker per run, warm-up / measurement series, cancel, ping and the
 * raw records. It is shared by the benchmark page (buttons) and the console
 * API `globalThis.plannerAlternativeBenchmark`; nothing here decides a
 * Production default.
 */

export type PlannerAlternativeRunPhase = 'warm-up' | 'measurement' | 'probe'

interface CommonRunOptions {
  readonly phase?: PlannerAlternativeRunPhase
  /** Instrumentation observers plus prediction counting; default true. */
  readonly instrumented?: boolean
  readonly cancelAfterMs?: number
  readonly cancelOnFirstCandidate?: boolean
  /** Ping the Worker while it runs; `0` chains each ping on the previous pong. */
  readonly pingIntervalMs?: number
}

export interface PlannerAlternativeSearchRunOptions extends CommonRunOptions {
  readonly mode: 'search'
  readonly workload: PlannerAlternativeSearchWorkloadId
  readonly extent: PlannerAlternativeSearchExtent
  /** Required: `1` measures time-to-first and the same-cost closure, `null` runs to the end. */
  readonly stopAfterCandidates: number | null
  readonly recording?: PlannerAlternativeRecordingMode
  readonly longHeld?: LongHeldOptions
}

export interface PlannerAlternativeKernelRunOptions extends CommonRunOptions {
  readonly mode: 'kernel'
  readonly workload: PlannerAlternativeKernelWorkloadId
  readonly extent: PlannerAlternativeSearchExtent
  readonly bounds: PlannerAlternativeTrialBounds
}

export type PlannerAlternativeRunOptions = PlannerAlternativeSearchRunOptions | PlannerAlternativeKernelRunOptions

export type PlannerAlternativeSeriesOptions = PlannerAlternativeRunOptions & {
  readonly warmUp: number
  readonly measurements: number
}

/** One flat record, `JSON.stringify`-ready for the raw artifact. */
export interface PlannerAlternativeBenchmarkRecord {
  readonly id: string
  readonly sequence: number
  readonly protocolVersion: string
  readonly mode: 'search' | 'kernel'
  readonly workload: string
  readonly phase: PlannerAlternativeRunPhase
  readonly extent: PlannerAlternativeSearchExtent
  readonly bounds: PlannerAlternativeTrialBounds | null
  readonly longHeld: LongHeldOptions | null
  readonly stopAfterCandidates: number | null
  readonly recording: PlannerAlternativeRecordingMode | null
  readonly instrumented: boolean
  readonly roundTripMs: number
  readonly acceptedAtMs: number | null
  readonly firstCandidateNoticeAtMs: number | null
  readonly outcome: PlannerAlternativeRunOutcome
  readonly cancel: PlannerAlternativeRunResult['cancel']
  readonly workerPings: number
  readonly longestWorkerPingMs: number | null
  readonly visibilityState: string
}

export interface PlannerAlternativeRunnerDependencies {
  readonly createHarness?: () => PlannerAlternativeBenchmarkHarness
  readonly loadIssue101Fixture: () => Promise<Issue101RealFixture>
  /** The synthetic rerun-pressure fixture; built once, outside every measurement. */
  readonly loadRerunPressureFixture?: () => Promise<PlannerAlternativeRerunPressureFixture>
  readonly createRequestId?: () => string
  readonly visibilityState?: () => string
  readonly onChange?: (state: { running: boolean; records: readonly PlannerAlternativeBenchmarkRecord[] }) => void
}

export interface PlannerAlternativeBenchmarkRunner {
  run(options: PlannerAlternativeRunOptions): Promise<PlannerAlternativeBenchmarkRecord>
  runMeasurements(options: PlannerAlternativeSeriesOptions): Promise<PlannerAlternativeBenchmarkRecord[]>
  /** Cancels the running run and stops the rest of a series. */
  cancel(): boolean
  records(): readonly PlannerAlternativeBenchmarkRecord[]
  clear(): void
  running(): boolean
  exportJson(environment?: unknown): string
}

function assertCount(value: number, name: string, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}.`)
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function plannerAlternativeWorkerElapsedMs(outcome: PlannerAlternativeRunOutcome): number | null {
  switch (outcome.status) {
    case 'search_completed':
    case 'kernel_completed':
      return outcome.measurement.workerElapsedMs
    case 'cancelled':
      return outcome.workerElapsedMs
    case 'error':
      return null
  }
}

/**
 * Medians of the `measurement` records only - warm-up and probe records are
 * never mixed in. A convenience for Phase 3-B; the raw records stay the
 * authority.
 */
export function summarizePlannerAlternativeMeasurements(records: readonly PlannerAlternativeBenchmarkRecord[]) {
  const measured = records.filter(({ phase }) => phase === 'measurement')
  const completed = measured.filter(({ outcome }) =>
    outcome.status === 'search_completed' || outcome.status === 'kernel_completed')
  const firsts = completed.flatMap(({ outcome }) =>
    outcome.status === 'search_completed' && outcome.measurement.timeToFirstCandidateMs !== null
      ? [outcome.measurement.timeToFirstCandidateMs]
      : [])
  return {
    measurementRecords: measured.length,
    completedRecords: completed.length,
    medianWorkerElapsedMs: median(completed.flatMap(({ outcome }) => {
      const value = plannerAlternativeWorkerElapsedMs(outcome)
      return value === null ? [] : [value]
    })),
    medianRoundTripMs: median(completed.map(({ roundTripMs }) => roundTripMs)),
    medianTimeToFirstCandidateMs: median(firsts),
  }
}

export function createPlannerAlternativeBenchmarkRunner(
  dependencies: PlannerAlternativeRunnerDependencies,
): PlannerAlternativeBenchmarkRunner {
  const createHarness = dependencies.createHarness ?? (() => createPlannerAlternativeBenchmarkHarness())
  const createRequestId = dependencies.createRequestId ?? (() => `pa3-${crypto.randomUUID()}`)
  const visibilityState = dependencies.visibilityState ?? (() => document.visibilityState)
  let records: readonly PlannerAlternativeBenchmarkRecord[] = []
  let sequence = 0
  let active: { harness: PlannerAlternativeBenchmarkHarness; requestId: string } | null = null
  let seriesCancelled = false
  let issue101: Promise<Issue101RealFixture> | null = null
  let rerunPressure: Promise<PlannerAlternativeRerunPressureFixture> | null = null
  const loadRerunPressureFixture = dependencies.loadRerunPressureFixture ?? createPlannerAlternativeRerunPressureFixture

  const notify = () => dependencies.onChange?.({ running: active !== null, records })
  const loadIssue101 = () => {
    issue101 ??= dependencies.loadIssue101Fixture().catch((error: unknown) => {
      issue101 = null
      throw error
    })
    return issue101
  }
  const loadRerunPressure = () => {
    rerunPressure ??= loadRerunPressureFixture().catch((error: unknown) => {
      rerunPressure = null
      throw error
    })
    return rerunPressure
  }

  async function buildHarnessOptions(
    options: PlannerAlternativeRunOptions,
    requestId: string,
  ): Promise<PlannerAlternativeHarnessRunOptions> {
    const common = {
      requestId,
      instrumented: options.instrumented ?? true,
      cancelAfterMs: options.cancelAfterMs,
      cancelOnFirstCandidate: options.cancelOnFirstCandidate,
    }
    if (options.mode === 'search') {
      if (!PLANNER_ALTERNATIVE_SEARCH_WORKLOADS.includes(options.workload)) {
        throw new RangeError(`Unknown Search workload '${String(options.workload)}'.`)
      }
      if (options.stopAfterCandidates === undefined) {
        throw new RangeError('stopAfterCandidates is required (a positive integer or null).')
      }
      const fixture = plannerAlternativeSearchWorkloadNeedsIssue101(options.workload) ? await loadIssue101() : null
      return {
        ...common,
        kind: 'search',
        input: createPlannerAlternativeSearchWorkloadInput(
          { workload: options.workload, extent: options.extent, longHeld: options.longHeld },
          fixture,
        ),
        stopAfterCandidates: options.stopAfterCandidates,
        recording: options.recording ?? 'timing',
      }
    }
    if (options.mode === 'kernel') {
      if (!PLANNER_ALTERNATIVE_KERNEL_WORKLOADS.includes(options.workload)) {
        throw new RangeError(`Unknown Kernel workload '${String(options.workload)}'.`)
      }
      return {
        ...common,
        kind: 'kernel',
        request: options.workload === 'kernel_multi_target'
          ? createPlannerAlternativeRerunPressureKernelRequest(await loadRerunPressure(), options.extent, options.bounds)
          : createIssue101KernelRequest(await loadIssue101(), options.extent, options.bounds),
      }
    }
    throw new RangeError(`Unknown mode '${String((options as { mode?: unknown }).mode)}'.`)
  }

  async function run(options: PlannerAlternativeRunOptions): Promise<PlannerAlternativeBenchmarkRecord> {
    if (active !== null) throw new Error('A Planner Alternative benchmark run is already in progress.')
    const requestId = createRequestId()
    // Fixture construction and every validation happen before the Worker exists.
    const harnessOptions = await buildHarnessOptions(options, requestId)
    assertPlannerAlternativeRunOptions(harnessOptions)
    if (options.pingIntervalMs !== undefined && (!Number.isFinite(options.pingIntervalMs) || options.pingIntervalMs < 0)) {
      throw new RangeError('pingIntervalMs must be a finite number greater than or equal to 0.')
    }
    const harness = createHarness()
    active = { harness, requestId }
    notify()
    const pings: number[] = []
    let stopPings = false
    const pingLoop = async () => {
      while (!stopPings) {
        const latency = await harness.ping(120_000)
        if (stopPings) break
        if (latency !== null) pings.push(latency)
        const interval = options.pingIntervalMs ?? 0
        if (interval > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, interval))
      }
    }
    let result: PlannerAlternativeRunResult
    try {
      // The run request must be the first message the fresh Worker receives,
      // so every record's round trip contains the same outstanding Worker
      // start-up: `harness.run()` posts it synchronously before it returns,
      // and only then does the ping loop start. It does not wait for
      // `accepted`, so the pings still observe the Worker from the start.
      const running = harness.run(harnessOptions)
      if (options.pingIntervalMs !== undefined) void pingLoop()
      result = await running
    } finally {
      stopPings = true
      harness.dispose()
      active = null
    }
    sequence += 1
    const record: PlannerAlternativeBenchmarkRecord = {
      id: requestId,
      sequence,
      protocolVersion: PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION,
      mode: options.mode,
      workload: options.workload,
      phase: options.phase ?? 'measurement',
      extent: { ...options.extent },
      bounds: options.mode === 'kernel' ? { ...options.bounds } : null,
      longHeld: options.mode === 'search' && options.longHeld !== undefined ? { ...options.longHeld } : null,
      stopAfterCandidates: options.mode === 'search' ? options.stopAfterCandidates : null,
      recording: options.mode === 'search' ? (options.recording ?? 'timing') : null,
      instrumented: harnessOptions.instrumented,
      roundTripMs: result.roundTripMs,
      acceptedAtMs: result.acceptedAtMs,
      firstCandidateNoticeAtMs: result.firstCandidateNoticeAtMs,
      outcome: result.outcome,
      cancel: result.cancel,
      workerPings: pings.length,
      longestWorkerPingMs: pings.length === 0 ? null : Math.max(...pings),
      visibilityState: visibilityState(),
    }
    records = [...records, record]
    notify()
    return record
  }

  return {
    run: (options) => {
      seriesCancelled = false
      return run(options)
    },
    runMeasurements: async (options) => {
      assertCount(options.warmUp, 'warmUp', 0)
      assertCount(options.measurements, 'measurements', 1)
      seriesCancelled = false
      const { warmUp, measurements, ...single } = options
      const produced: PlannerAlternativeBenchmarkRecord[] = []
      const phases: PlannerAlternativeRunPhase[] = [
        ...Array.from({ length: warmUp }, () => 'warm-up' as const),
        ...Array.from({ length: measurements }, () => 'measurement' as const),
      ]
      for (const phase of phases) {
        if (seriesCancelled) break
        produced.push(await run({ ...single, phase } as PlannerAlternativeRunOptions))
      }
      return produced
    },
    cancel: () => {
      seriesCancelled = true
      return active === null ? false : active.harness.cancel(active.requestId)
    },
    records: () => records,
    clear: () => {
      records = []
      notify()
    },
    running: () => active !== null,
    exportJson: (environment) => JSON.stringify({
      protocolVersion: PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION,
      exportedAt: new Date().toISOString(),
      environment: environment ?? null,
      records,
    }, null, 2),
  }
}

/** A compact description of the cached Issue #101 fixture for the console. */
export function describeIssue101Fixture(fixture: Issue101RealFixture) {
  const reservation = createIssue101DragonReservation(fixture)
  return {
    fireEntryId: fixture.fireEntry.id,
    dragonEntryId: fixture.dragonEntry.id,
    fireRoute: summarizeIssue101Route(fixture.fireCandidate.route, fixture.fireCandidate),
    dragonRoute: summarizeIssue101Route(fixture.dragonCandidate.route, fixture.dragonCandidate),
    initialConflicts: fixture.initialConflicts.map(({ id, kind }) => ({ id, kind })),
    dragonReservation: {
      normal: reservation.normal.map(({ counterId, held, blocked }) => ({
        counterId,
        heldCount: held.length,
        heldFirst: held[0] ?? null,
        heldLast: held.at(-1) ?? null,
        blocked: [...blocked],
      })),
      skill: reservation.skill,
      gogma: reservation.gogma,
    },
  }
}

/** A compact description of one synthetic long-held fixture for the console. */
export function describeLongHeldFixture(
  workload: 'long_skill_held' | 'long_gogma_held',
  options: LongHeldOptions,
  extent: PlannerAlternativeSearchExtent,
) {
  const fixture = createLongHeldFixture(workload, options, extent)
  return {
    workload,
    ...options,
    provenance: 'synthetic Production benchmark fixture (not a game observation)',
    idealPosition: fixture.idealPosition,
    heldCount: fixture.heldPositions.length,
    blockedCount: fixture.blockedPositions.length,
  }
}
