import type { PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerGlobalBrowserHarness, type PlannerGlobalBrowserHarness, type PlannerGlobalRunResult } from './plannerGlobalBrowserBenchmark'
import {
  PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION,
  type PlannerGlobalMeasurementMode,
  type PlannerGlobalPhase2BRequest,
  type PlannerGlobalProgressObservation,
  type PlannerGlobalRawCacheMode,
  type PlannerGlobalRunMode,
  type PlannerGlobalWorkerEnvironment,
  type PlannerGlobalWorkerResult,
  type PlannerGlobalYieldMode,
} from './plannerGlobalBrowserBenchmarkProtocol'
import { EXTENT_AXES, isGlobalPlanSuccess, type ExtentAxis } from './plannerGlobalOptimizationExtentProbe'
import { PHASE1E_BOUNDS, phase1eStrategyName, runPhase1EController, type Phase1EBounds, type Phase1EExecution } from './plannerGlobalOptimizationPhase1E'
import { GLOBAL_RESEARCH_EXTENT, type GlobalResearchReport } from './plannerGlobalOptimizationResearch'
import { discoverySignature, type AttemptSummary, type DiscoveryState, type StopReason } from './plannerGlobalOptimizationRetry'
import { attributePingDelays, phase2bIntervals, type Phase2BInterval, type Phase2BPingAttribution, type Phase2BPingSample } from './plannerGlobalPhase2BTimeline'

/**
 * Issue #154 Phase 2-A main-thread runner: records, fresh Worker per attempt, Phase 1-E controller on
 * fresh Workers, chained ping, benchmark-only cancel triggers and memory sampling. It decides no
 * Research result: every attempt's outcome is the Worker's. The only runtime data input is the
 * PlannerInput the page built from the original Export; no earlier Phase result, Target ID, order,
 * snapshot or oracle enters it. Nothing is persisted: records live in memory until exported as JSON.
 */
export type PlannerGlobalRecordKind = 'warmup' | 'measurement' | 'probe' | 'responsiveness' | 'memory' | 'cancel' | 'controller'

export interface PlannerGlobalAttemptConfig {
  readonly label: string
  readonly kind: PlannerGlobalRecordKind
  readonly mode: PlannerGlobalRunMode
  readonly fallbackAxis: ExtentAxis | null
  readonly rawCache: PlannerGlobalRawCacheMode
  readonly yieldMode: PlannerGlobalYieldMode
  readonly fallbackBudgetMs: number | null
  readonly fallbackMaxEpisodes: number | null
  readonly attemptBudgetMs: number | null
  readonly attemptState: DiscoveryState | null
  readonly profiler: boolean
  /** Chained ping while the run is active (a pong sends the next ping at once). */
  readonly ping?: { readonly timeoutMs: number } | null
  /** Benchmark-only cancel trigger, measured from the triggering progress observation. */
  readonly cancel?: { readonly trigger: 'base_search' | 'fallback' | 'after_ms'; readonly delayMs: number } | null
  /** Memory samples at fixed points and every `intervalMs` while running (a separate run from timing). */
  readonly memory?: { readonly intervalMs: number; readonly gcWaitMs: number } | null
  /** How long to keep listening after the run settled, to detect a response sent after a cancel. */
  readonly lateResponseWaitMs?: number
  /** Issue #154 Phase 2-B (optional): Worker full Planner call timeline and post-hoc Plan evidence. */
  readonly phase2b?: PlannerGlobalPhase2BRequest | null
}

/** Phase 2-B: pings slower than this are attributed to the Worker timeline intervals they overlapped. */
export const PHASE2B_PING_ATTRIBUTION_THRESHOLD_MS = 100

export interface PlannerGlobalPhase2BRecord {
  /**
   * Main-thread epoch at `accepted` minus the Worker's epoch when it posted `accepted`: message latency plus the
   * skew of the two realms' `timeOrigin + now()` clocks. Small and positive when the clocks agree.
   */
  readonly acceptedClockCheckMs: number | null
  readonly ping: {
    readonly thresholdMs: number
    readonly slowPings: readonly Phase2BPingAttribution[]
    /** The slowest ping, attributed to the Worker intervals it overlapped (null without pings). */
    readonly slowest: Phase2BPingAttribution | null
  } | null
}

/** A Research workload preset. Fallback bounds are the Phase 1-E ones; Research maxPlanSteps comes from the input. */
export const PHASE2A_FALLBACK_BUDGET_MS = 180_000
export const PHASE2A_ATTEMPT_BUDGET_MS = 900_000
export const PHASE2A_CACHE_OFF_BUDGET_MS = 900_000
export const PHASE2A_RESEARCH_MAX_PLAN_STEPS = 20_000

export function phase2aAttemptConfig(label: string, kind: PlannerGlobalRecordKind, axis: ExtentAxis | null,
  overrides: Partial<PlannerGlobalAttemptConfig> = {}): PlannerGlobalAttemptConfig {
  return { label, kind, mode: axis === null ? 'control' : 'fallback', fallbackAxis: axis, rawCache: 'per-search', yieldMode: 'message-channel',
    fallbackBudgetMs: axis === null ? null : PHASE2A_FALLBACK_BUDGET_MS, fallbackMaxEpisodes: axis === null ? null : PHASE1E_BOUNDS.maxFallbackEpisodesPerAttempt,
    attemptBudgetMs: PHASE2A_ATTEMPT_BUDGET_MS, attemptState: null, profiler: false, ...overrides }
}

export type PlannerGlobalMemoryReading =
  | { readonly status: 'ok'; readonly bytes: number; readonly dedicatedWorkerBytes: number; readonly windowBytes: number; readonly otherBytes: number; readonly resolveMs: number }
  | { readonly status: 'unavailable' | 'error'; readonly reason: string }

export interface PlannerGlobalMemorySample {
  readonly label: string
  /** Main-thread ms since the attempt started (Worker creation). */
  readonly atMs: number
  /** `performance.measureUserAgentSpecificMemory()`: page + its same-agent-cluster Workers aggregate (Chrome). */
  readonly userAgentSpecific: PlannerGlobalMemoryReading
  /** `performance.memory` of the main realm only (non-standard, Chrome-bucketed). */
  readonly mainRealm: { readonly usedJSHeapSize: number; readonly totalJSHeapSize: number; readonly jsHeapSizeLimit: number } | null
}

export interface PlannerGlobalMemorySampler {
  availability(): { readonly measureUserAgentSpecificMemory: boolean; readonly performanceMemory: boolean; readonly crossOriginIsolated: boolean | null }
  sample(label: string, atMs: number): Promise<PlannerGlobalMemorySample>
}

interface UserAgentSpecificMemoryResult {
  bytes: number
  breakdown: { bytes: number; attribution: { url?: string; scope?: string }[]; types: string[] }[]
}

/** Browser memory APIs as they are; nothing is estimated when one is unavailable. */
export function createBrowserMemorySampler(now: () => number = () => performance.now()): PlannerGlobalMemorySampler {
  const perf = globalThis.performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<UserAgentSpecificMemoryResult>;
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }
  const isolated = typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : null
  const uaAvailable = typeof perf.measureUserAgentSpecificMemory === 'function' && isolated === true
  return {
    availability: () => ({ measureUserAgentSpecificMemory: uaAvailable, performanceMemory: perf.memory !== undefined, crossOriginIsolated: isolated }),
    sample: async (label, atMs) => {
      let userAgentSpecific: PlannerGlobalMemoryReading
      if (!uaAvailable) userAgentSpecific = { status: 'unavailable', reason: isolated === true ? 'measureUserAgentSpecificMemory is not exposed' : 'not crossOriginIsolated' }
      else {
        const start = now()
        try {
          const result = await perf.measureUserAgentSpecificMemory!()
          let worker = 0, window = 0, other = 0
          for (const entry of result.breakdown) {
            const scopes = entry.attribution.map(a => a.scope)
            if (scopes.includes('DedicatedWorkerGlobalScope')) worker += entry.bytes
            else if (scopes.includes('Window')) window += entry.bytes
            else other += entry.bytes
          }
          userAgentSpecific = { status: 'ok', bytes: result.bytes, dedicatedWorkerBytes: worker, windowBytes: window, otherBytes: other, resolveMs: now() - start }
        } catch (error) { userAgentSpecific = { status: 'error', reason: error instanceof Error ? error.message : String(error) } }
      }
      const memory = perf.memory
      return { label, atMs, userAgentSpecific, mainRealm: memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit } : null }
    },
  }
}

export interface PlannerGlobalPingSummary {
  readonly count: number
  readonly lost: number
  readonly medianMs: number | null
  readonly p95Ms: number | null
  readonly maxMs: number | null
  readonly samplesMs: readonly number[]
}

export interface PlannerGlobalBrowserRecord {
  readonly id: string
  readonly sequence: number
  readonly label: string
  readonly kind: PlannerGlobalRecordKind
  readonly startedAt: string
  readonly config: Omit<PlannerGlobalAttemptConfig, 'attemptState'> & { readonly attemptStateSignature: string | null }
  readonly visibility: { readonly atStart: string; readonly atEnd: string; readonly changes: number }
  readonly createToReadyMs: number | null
  readonly workerEnvironment: PlannerGlobalWorkerEnvironment | null
  readonly acceptedAtMs: number | null
  readonly roundTripMs: number | null
  readonly status: 'completed' | 'cancelled' | 'error' | 'worker_error'
  readonly message: string | null
  readonly priorityEntries: PlannerGlobalWorkerResult['priorityEntries'] | null
  readonly result: PlannerGlobalWorkerResult | null
  readonly progress: { readonly count: number; readonly last: PlannerGlobalProgressObservation | null;
    readonly milestones: readonly { readonly atMs: number; readonly observation: PlannerGlobalProgressObservation }[] }
  readonly ping: PlannerGlobalPingSummary | null
  readonly cancel: (PlannerGlobalRunResult['cancel'] & { readonly trigger: string; readonly triggeredAtMs: number | null; readonly triggerObservation: PlannerGlobalProgressObservation | null;
    readonly lateResponses: number; readonly lateResponseWaitMs: number }) | null
  readonly memory: readonly PlannerGlobalMemorySample[] | null
  /** Main-thread ms: Worker creation -> dispose (whole attempt wall, including the ready wait). */
  readonly attemptWallMs: number
  /** Phase 2-B only (`config.phase2b`). */
  readonly phase2b?: PlannerGlobalPhase2BRecord
}

export interface PlannerGlobalControllerRecord {
  readonly id: string
  readonly label: string
  readonly startedAt: string
  readonly outcome: string
  readonly stop: string | null
  readonly initialSuccess: boolean
  readonly retryStarted: boolean
  readonly nonRetryableInitial: readonly { readonly axis: string; readonly stop: string | null; readonly status: string }[]
  readonly firstCompleted: { readonly axis: string; readonly stage: string; readonly attemptId: number; readonly elapsedMs: number } | null
  readonly controlFinishedAtMs: number | null
  readonly allInitialAxesComparedAtMs: number | null
  readonly elapsedMs: number
  readonly winner: { readonly axis: string; readonly stage: string; readonly recordId: string; readonly semanticSha256: string | null } | null
  readonly ranking: readonly { readonly axis: string; readonly stage: string; readonly attemptId: number; readonly success: boolean; readonly final: unknown; readonly stop: string | null; readonly recordId: string }[]
  readonly recordIds: readonly string[]
  /** Failed attempts (no `accepted`) handed to the controller with the priority of an earlier run of the same input. */
  readonly priorityReusedForRecordIds: readonly string[]
  readonly retries: unknown
  readonly error: string | null
}

export interface PlannerGlobalRunnerDependencies {
  readonly createHarness?: () => PlannerGlobalBrowserHarness
  readonly now?: () => number
  readonly createRequestId?: () => string
  readonly visibilityState?: () => string
  readonly onVisibilityChange?: (listener: () => void) => () => void
  readonly memory?: PlannerGlobalMemorySampler
  readonly sleep?: (ms: number) => Promise<void>
  readonly clock?: () => string
  /** Phase 2-B epoch-aligned clock (`performance.timeOrigin + performance.now()` by default). */
  readonly epochNow?: () => number
  readonly onChange?: (state: { readonly records: readonly PlannerGlobalBrowserRecord[]; readonly controllers: readonly PlannerGlobalControllerRecord[]; readonly running: boolean }) => void
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
/** Nearest-rank percentile of the observed samples. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}
export function summarizePings(samples: readonly (number | null)[]): PlannerGlobalPingSummary {
  const ok = samples.filter((v): v is number => v !== null)
  return { count: samples.length, lost: samples.length - ok.length, medianMs: median(ok), p95Ms: percentile(ok, 95), maxMs: ok.length ? Math.max(...ok) : null, samplesMs: ok }
}

function failureReport(message: string): GlobalResearchReport {
  return { algorithm: 'browser-worker-failure', status: 'error', inputTargetCount: 0, inputEntryCount: 0, planningTargetCount: 0, inputFingerprint: '',
    baseline: null, retained: null, final: null, retainedOriginalEntryIds: [], searches: [], generatedReplacementCount: 0, plannerFullRunCount: 0,
    searchElapsedMs: 0, plannerElapsedMs: 0, totalElapsedMs: 0, stage: 'baseline', error: message }
}

/** A Browser record as a Phase 1-E attempt. A Worker failure is a stop, never a partial result or a no-match. */
export function attemptFromRecord(record: PlannerGlobalBrowserRecord, meta: { attemptId: number; strategy: string; reason: string; state: DiscoveryState | null }): AttemptSummary & { recordId: string } {
  const result = record.result
  if (result && (record.status === 'completed' || record.status === 'cancelled')) {
    return { recordId: record.id, attemptId: meta.attemptId, strategy: meta.strategy, reason: meta.reason, state: result.state, signature: result.signature,
      signals: result.signals, report: result.report, stop: record.status === 'cancelled' ? 'cancelled' : result.stop }
  }
  const state = meta.state ?? { retainedEntryIds: [], pendingTargetIds: [], extent: { ...GLOBAL_RESEARCH_EXTENT } }
  const stop: StopReason = record.status === 'worker_error' ? 'process_error' : 'attempt_error'
  return { recordId: record.id, attemptId: meta.attemptId, strategy: meta.strategy, reason: meta.reason, state, signature: discoverySignature(state),
    signals: { notFound: [], resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [{ targetId: '', classification: record.status }] },
    report: failureReport(record.message ?? record.status), stop }
}

export function createPlannerGlobalBrowserRunner(dependencies: PlannerGlobalRunnerDependencies = {}) {
  const now = dependencies.now ?? (() => performance.now())
  const createHarness = dependencies.createHarness ?? (() => createPlannerGlobalBrowserHarness({ now }))
  const createRequestId = dependencies.createRequestId ?? (() => `pg2a-${crypto.randomUUID()}`)
  const visibilityState = dependencies.visibilityState ?? (() => document.visibilityState)
  const onVisibilityChange = dependencies.onVisibilityChange ?? (listener => {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  })
  const memory = dependencies.memory ?? createBrowserMemorySampler(now)
  const sleep = dependencies.sleep ?? (ms => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms)))
  const clock = dependencies.clock ?? (() => new Date().toISOString())
  const epochNow = dependencies.epochNow ?? (() => performance.timeOrigin + performance.now())
  const records: PlannerGlobalBrowserRecord[] = []
  const controllers: PlannerGlobalControllerRecord[] = []
  let sequence = 0
  let active: { harness: PlannerGlobalBrowserHarness; requestId: string } | null = null
  let stopRequested = false
  let lastProgress: { recordLabel: string; atMs: number; observation: PlannerGlobalProgressObservation } | null = null
  const notify = () => dependencies.onChange?.({ records: [...records], controllers: [...controllers], running: active !== null })

  async function runAttempt(input: PlannerInput, config: PlannerGlobalAttemptConfig): Promise<PlannerGlobalBrowserRecord> {
    if (active !== null) throw new Error('A Phase 2-A attempt is already running.')
    if (config.ping && (!Number.isFinite(config.ping.timeoutMs) || config.ping.timeoutMs <= 0)) throw new RangeError('ping.timeoutMs must be > 0')
    if (config.cancel && (!Number.isFinite(config.cancel.delayMs) || config.cancel.delayMs < 0)) throw new RangeError('cancel.delayMs must be >= 0')
    if (config.memory && (!(config.memory.intervalMs > 0) || !(config.memory.gcWaitMs >= 0))) throw new RangeError('Invalid memory sampling')
    const id = `pg2a-record-${++sequence}`
    const startedAt = clock()
    const visibilityAtStart = visibilityState()
    let visibilityChanges = 0
    const stopVisibility = onVisibilityChange(() => { visibilityChanges += 1 })
    const samples: PlannerGlobalMemorySample[] = []
    const attemptStart = now()
    const at = () => now() - attemptStart
    const sample = async (label: string) => { if (config.memory) samples.push(await memory.sample(label, at())) }
    await sample('before_worker_create')
    const requestId = createRequestId()
    const harness = createHarness()
    active = { harness, requestId }
    notify()
    let createToReadyMs: number | null = null, workerEnvironment: PlannerGlobalWorkerEnvironment | null = null
    let run: PlannerGlobalRunResult | null = null, failure: string | null = null
    const milestones: { atMs: number; observation: PlannerGlobalProgressObservation }[] = []
    const pings: (number | null)[] = []
    const pingTimeline: Phase2BPingSample[] = []
    let acceptedEpochMs: number | null = null
    let pingChain: Promise<void> | null = null
    let settled = false
    let triggeredAtMs: number | null = null, triggerObservation: PlannerGlobalProgressObservation | null = null
    let cancelTimer: ReturnType<typeof setTimeout> | null = null
    const armCancel = (observation: PlannerGlobalProgressObservation | null, atMs: number) => {
      if (!config.cancel || triggeredAtMs !== null) return
      triggeredAtMs = atMs
      triggerObservation = observation
      cancelTimer = globalThis.setTimeout(() => harness.cancel(requestId), config.cancel.delayMs)
    }
    try {
      const ready = await harness.whenReady()
      createToReadyMs = ready.createToReadyMs
      workerEnvironment = ready.environment
      await sample('worker_ready')
      let sampling: Promise<void> | null = null
      const periodic = config.memory ? globalThis.setInterval(() => {
        if (sampling === null && !settled) sampling = sample('running').finally(() => { sampling = null })
      }, config.memory.intervalMs) : null
      try {
        run = await harness.run({ requestId, input, mode: config.mode, fallbackAxis: config.fallbackAxis, rawCache: config.rawCache, yieldMode: config.yieldMode,
          maxPlanSteps: input.options.maxPlanSteps, fallbackBudgetMs: config.fallbackBudgetMs, fallbackMaxEpisodes: config.fallbackMaxEpisodes,
          attemptBudgetMs: config.attemptBudgetMs, attemptState: config.attemptState, measurement: measurementOf(config.kind), profiler: config.profiler,
          ...(config.phase2b ? { phase2b: config.phase2b } : {}) }, {
          onAccepted: atMs => {
            acceptedEpochMs = epochNow()
            if (config.cancel?.trigger === 'after_ms') armCancel(null, atMs)
            if (config.ping) {
              const timeoutMs = config.ping.timeoutMs
              pingChain = (async () => {
                while (!settled) {
                  const sentAtMs = epochNow()
                  const rtt = await harness.ping(timeoutMs)
                  pings.push(rtt)
                  if (config.phase2b) pingTimeline.push({ sentAtMs, receivedAtMs: rtt === null ? null : sentAtMs + rtt })
                }
              })()
            }
          },
          onProgress: (observation, atMs) => {
            milestones.push({ atMs, observation })
            lastProgress = { recordLabel: config.label, atMs, observation }
            if (config.cancel?.trigger === 'base_search' && observation.stage === 'discovery' && observation.searchStatus === 'searching' && observation.fallbackStatus === null) armCancel(observation, atMs)
            if (config.cancel?.trigger === 'fallback' && observation.fallbackStatus === 'searching') armCancel(observation, atMs)
          },
        })
      } finally {
        settled = true
        if (periodic !== null) globalThis.clearInterval(periodic)
        if (cancelTimer !== null) globalThis.clearTimeout(cancelTimer)
        await sampling
      }
      await pingChain
      await sample('result_received')
      if (config.lateResponseWaitMs) await sleep(config.lateResponseWaitMs)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    } finally {
      const lateResponses = harness.lateResponses()
      harness.dispose()
      active = null
      stopVisibility()
      await sample('after_dispose')
      if (config.memory) { await sleep(config.memory.gcWaitMs); await sample('after_gc_wait_reference') }
      const outcome = run?.outcome
      const record: PlannerGlobalBrowserRecord = {
        id, sequence, label: config.label, kind: config.kind, startedAt,
        config: { ...withoutState(config), attemptStateSignature: config.attemptState ? discoverySignature(config.attemptState) : null },
        visibility: { atStart: visibilityAtStart, atEnd: visibilityState(), changes: visibilityChanges },
        createToReadyMs, workerEnvironment, acceptedAtMs: run?.acceptedAtMs ?? null, roundTripMs: run?.roundTripMs ?? null,
        status: outcome?.status ?? 'error', message: outcome && (outcome.status === 'error' || outcome.status === 'worker_error') ? outcome.message : failure,
        priorityEntries: run?.priorityEntries ?? null,
        result: outcome && (outcome.status === 'completed' || outcome.status === 'cancelled') ? outcome.result : null,
        progress: { count: run?.progressCount ?? milestones.length, last: run?.lastProgress ?? milestones.at(-1)?.observation ?? null, milestones },
        ping: config.ping ? summarizePings(pings) : null,
        cancel: config.cancel ? { requestedAtMs: run?.cancel?.requestedAtMs ?? NaN, ackMs: run?.cancel?.ackMs ?? null, settledMs: run?.cancel?.settledMs ?? null,
          trigger: config.cancel.trigger, triggeredAtMs, triggerObservation, lateResponses, lateResponseWaitMs: config.lateResponseWaitMs ?? 0 } : null,
        memory: config.memory ? samples : null,
        attemptWallMs: at(),
        ...(config.phase2b ? { phase2b: phase2bRecordOf(outcome && (outcome.status === 'completed' || outcome.status === 'cancelled') ? outcome.result : null,
          acceptedEpochMs, config.ping ? pingTimeline : null) } : {}),
      }
      records.push(record)
      notify()
    }
    return records.at(-1)!
  }

  async function runSeries(input: PlannerInput, config: Omit<PlannerGlobalAttemptConfig, 'kind'>, warmups: number, measurements: number) {
    if (!Number.isSafeInteger(warmups) || warmups < 0 || !Number.isSafeInteger(measurements) || measurements < 1) throw new RangeError('Invalid series size')
    stopRequested = false
    const series: PlannerGlobalBrowserRecord[] = []
    for (let i = 0; i < warmups + measurements; i++) {
      if (stopRequested) break
      series.push(await runAttempt(input, { ...config, kind: i < warmups ? 'warmup' : 'measurement' }))
    }
    return series
  }

  /**
   * The Phase 1-E controller on fresh Browser Workers: control, then every axis strategy in the stable
   * `EXTENT_AXES` order, each from the same original input; the bounded retry only when every initial
   * attempt is a finished partial Plan. Each attempt is its own record.
   */
  async function runController(input: PlannerInput, options: { label: string; bounds?: Phase1EBounds; controllerBudgetMs?: number | null; rawCache?: PlannerGlobalRawCacheMode;
    onFirstCompleted?: (elapsedMs: number) => void } = { label: 'phase1e-controller' }) {
    stopRequested = false
    const bounds = options.bounds ?? PHASE1E_BOUNDS
    const start = now()
    const recordIds: string[] = []
    const recordOfAttempt = new Map<string, string>()
    const base = (axis: ExtentAxis | null, label: string, state: DiscoveryState | null) =>
      phase2aAttemptConfig(label, 'controller', axis, { attemptState: state, rawCache: options.rawCache ?? 'per-search' })
    /**
     * The stable ordinary Planner priority an earlier fresh run of the same original input already returned.
     * A Worker that breaks before `accepted` returns none; its attempt is still a failure (process_error /
     * attempt_error, never completed, partial or a no-match), and it is handed to the controller with this known
     * priority so an earlier completed variant is never lost. Without any known priority nothing is guessed:
     * the controller fails closed as before.
     */
    let knownPriority: PlannerGlobalWorkerResult['priorityEntries'] | null = null
    const priorityReusedForRecordIds: string[] = []
    const execution = (record: PlannerGlobalBrowserRecord, meta: Parameters<typeof attemptFromRecord>[1]): Phase1EExecution<AttemptSummary & { recordId: string }> => {
      recordIds.push(record.id)
      const attempt = attemptFromRecord(record, meta)
      const own = record.result?.priorityEntries ?? record.priorityEntries
      if (own) {
        // A run's own priority stays authority; runPhase1EController still refuses one that differs.
        knownPriority ??= structuredClone(own)
        return { attempt, priorityEntries: own }
      }
      if (attempt.stop === 'completed' || (attempt.stop === null && attempt.report.status === 'partial')) {
        throw new Error(`Attempt ${record.label} has a result but no priority evidence.`)
      }
      if (!knownPriority) throw new Error(`Attempt ${record.label} produced no priority evidence: ${record.status} ${record.message ?? ''}`)
      priorityReusedForRecordIds.push(record.id)
      return { attempt, priorityEntries: structuredClone(knownPriority) }
    }
    let firstNotified = false
    const notifyCompleted = (attempt: AttemptSummary, axis: ExtentAxis) => {
      if (!firstNotified && attempt.stop === 'completed') { firstNotified = true; options.onFirstCompleted?.(now() - start) }
      void axis
    }
    let error: string | null = null
    let result: Awaited<ReturnType<typeof runPhase1EController<AttemptSummary & { recordId: string }>>> | null = null
    try {
      result = await runPhase1EController<AttemptSummary & { recordId: string }>({
        control: async () => execution(await runAttempt(input, base(null, `${options.label}:control`, null)), { attemptId: 0, strategy: 'control_no_fallback', reason: 'Phase 0 order, no fallback', state: null }),
        initial: async axis => {
          const run = execution(await runAttempt(input, base(axis, `${options.label}:${axis}-initial`, null)),
            { attemptId: 0, strategy: 'initial_phase0_order', reason: `original Export, Phase 0 order and retained set derived by the run, ${phase1eStrategyName(axis)}`, state: null })
          recordOfAttempt.set(`${axis}:initial:0`, run.attempt.recordId)
          notifyCompleted(run.attempt, axis)
          return run
        },
        retry: async (axis, state, strategy, reason, attemptId) => {
          const run = execution(await runAttempt(input, base(axis, `${options.label}:${axis}-retry-${attemptId}`, state)), { attemptId, strategy, reason, state })
          recordOfAttempt.set(`${axis}:retry:${attemptId}`, run.attempt.recordId)
          notifyCompleted(run.attempt, axis)
          return run.attempt
        },
        nowMs: now,
        shouldStop: () => stopRequested ? 'cancelled' : options.controllerBudgetMs != null && now() - start >= options.controllerBudgetMs ? 'time_budget' : null,
      }, bounds)
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
    const recordId = (axis: string, stage: string, attemptId: number) => recordOfAttempt.get(`${axis}:${stage}:${attemptId}`) ?? ''
    const controllerRecord: PlannerGlobalControllerRecord = {
      id: `pg2a-controller-${controllers.length + 1}`, label: options.label, startedAt: clock(), outcome: result?.outcome ?? 'error', stop: result?.stop ?? null,
      initialSuccess: result?.initialSuccess ?? false, retryStarted: result?.retryStarted ?? false,
      nonRetryableInitial: result?.nonRetryableInitial ?? [],
      firstCompleted: result?.firstCompleted ? { axis: result.firstCompleted.axis, stage: result.firstCompleted.stage, attemptId: result.firstCompleted.attemptId, elapsedMs: result.firstCompleted.elapsedMs } : null,
      controlFinishedAtMs: result?.control?.finishedAtMs ?? null, allInitialAxesComparedAtMs: result?.initial.at(-1)?.finishedAtMs ?? null, elapsedMs: now() - start,
      winner: result?.winner ? { axis: result.winner.axis, stage: result.winner.stage, recordId: result.winner.attempt.recordId,
        semanticSha256: records.find(r => r.id === result!.winner!.attempt.recordId)?.result?.semanticSha256 ?? null } : null,
      ranking: (result?.ranking ?? []).map(v => ({ axis: v.axis, stage: v.stage, attemptId: v.attempt.attemptId, success: isGlobalPlanSuccess(v.outcome), final: v.outcome.final, stop: v.outcome.stop,
        recordId: recordId(v.axis, v.stage, v.attempt.attemptId) })),
      recordIds, priorityReusedForRecordIds, retries: result?.retries ?? [], error,
    }
    controllers.push(controllerRecord)
    notify()
    return controllerRecord
  }

  return {
    runAttempt, runSeries, runController,
    /** Cancels the running attempt now (benchmark-only) and stops a series / controller before its next attempt. */
    cancel: () => { stopRequested = true; return active ? active.harness.cancel(active.requestId) : false },
    running: () => active !== null,
    records: () => [...records],
    controllers: () => [...controllers],
    lastProgress: () => lastProgress,
    clear: () => { if (active) throw new Error('Cannot clear while running.'); records.length = 0; controllers.length = 0; sequence = 0 },
    memoryAvailability: () => memory.availability(),
    exportJson: (environment: Record<string, unknown>) => JSON.stringify({ protocolVersion: PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION,
      exportedAt: clock(), environment, axes: EXTENT_AXES, records, controllers }, null, 2),
  }
}
export type PlannerGlobalBrowserRunner = ReturnType<typeof createPlannerGlobalBrowserRunner>

/** Phase 2-B: the Worker's own intervals (full Planner call phases and the post-calculation evidence stages). */
export function phase2bWorkerIntervals(result: PlannerGlobalWorkerResult): Phase2BInterval[] {
  const phase2b = result.phase2b
  if (!phase2b) return []
  const { marks } = phase2b
  return [...phase2bIntervals(phase2b.timeline ?? []),
    { name: 'worker:evidence', startMs: marks.calculationEndAtMs, endMs: marks.evidenceEndAtMs },
    { name: 'worker:plan_evidence', startMs: marks.evidenceEndAtMs, endMs: marks.planEvidenceEndAtMs },
    { name: 'worker:result_post', startMs: marks.planEvidenceEndAtMs, endMs: marks.resultPostAtMs }]
}

export function phase2bRecordOf(result: PlannerGlobalWorkerResult | null, acceptedEpochMs: number | null, pings: readonly Phase2BPingSample[] | null): PlannerGlobalPhase2BRecord {
  const workerAccepted = result?.phase2b?.marks.acceptedAtMs ?? null
  let ping: PlannerGlobalPhase2BRecord['ping'] = null
  if (pings !== null) {
    const slowPings = result ? attributePingDelays(pings, phase2bWorkerIntervals(result), PHASE2B_PING_ATTRIBUTION_THRESHOLD_MS) : []
    ping = { thresholdMs: PHASE2B_PING_ATTRIBUTION_THRESHOLD_MS, slowPings, slowest: slowPings.reduce<Phase2BPingAttribution | null>((max, p) => max === null || p.rttMs > max.rttMs ? p : max, null) }
  }
  return { acceptedClockCheckMs: acceptedEpochMs !== null && workerAccepted !== null ? acceptedEpochMs - workerAccepted : null, ping }
}

function measurementOf(kind: PlannerGlobalRecordKind): PlannerGlobalMeasurementMode {
  return kind === 'warmup' || kind === 'measurement' ? 'timing' : kind
}
function withoutState(config: PlannerGlobalAttemptConfig): Omit<PlannerGlobalAttemptConfig, 'attemptState'> {
  const copy: { -readonly [K in keyof PlannerGlobalAttemptConfig]?: PlannerGlobalAttemptConfig[K] } = { ...config }
  delete copy.attemptState
  return copy as Omit<PlannerGlobalAttemptConfig, 'attemptState'>
}

/**
 * The Phase 2-A formal workloads. Every one runs from the same original-Export input on a fresh Worker with
 * the Phase 1-E bounds (base N350 / G500 / S1500, fallback x2 on one axis, 3 episodes, fallback 180 s,
 * attempt 900 s); only the recording differs. No Target ID, Candidate or earlier Phase result is involved.
 */
export const PHASE2A_WORKLOADS = {
  control: (kind: PlannerGlobalRecordKind = 'measurement') => phase2aAttemptConfig('control-no-fallback', kind, null),
  normalWinner: (kind: PlannerGlobalRecordKind = 'measurement') => phase2aAttemptConfig('normal-2x-fallback', kind, 'normal'),
  normalCacheOff: () => phase2aAttemptConfig('normal-2x-fallback-cache-off', 'probe', 'normal', { rawCache: 'off', attemptBudgetMs: PHASE2A_CACHE_OFF_BUDGET_MS }),
  responsiveness: () => phase2aAttemptConfig('normal-2x-fallback-responsiveness', 'responsiveness', 'normal', { ping: { timeoutMs: 120_000 } }),
  cancelBaseSearch: () => phase2aAttemptConfig('cancel-during-base-search', 'cancel', 'normal', { cancel: { trigger: 'base_search', delayMs: 1000 }, lateResponseWaitMs: 5000 }),
  cancelFallback: () => phase2aAttemptConfig('cancel-during-fallback', 'cancel', 'normal', { cancel: { trigger: 'fallback', delayMs: 1000 }, lateResponseWaitMs: 5000 }),
  memory: (axis: ExtentAxis | null = 'normal') => phase2aAttemptConfig(`${axis ?? 'control'}-memory`, 'memory', axis, { memory: { intervalMs: 15_000, gcWaitMs: 10_000 } }),
} as const

/**
 * Issue #154 Phase 2-B workloads: the Phase 2-A normal-2x winner unchanged, plus the Worker full Planner call
 * timeline (clocks only) and the post-hoc autonomous Plan evidence. The memory workload samples only at fixed
 * points (no periodic `measureUserAgentSpecificMemory()` while running), so an external CDP Worker heap sampler
 * can follow the Planner phases undisturbed.
 */
const PHASE2B_REQUEST: PlannerGlobalPhase2BRequest = { timeline: true, planEvidence: true }
export const PHASE2B_FIXED_POINT_MEMORY_INTERVAL_MS = 1_000_000_000
export const PHASE2B_WORKLOADS = {
  timing: (kind: PlannerGlobalRecordKind = 'measurement') => phase2aAttemptConfig('phase2b-normal-2x-timeline', kind, 'normal', { phase2b: PHASE2B_REQUEST }),
  responsiveness: () => phase2aAttemptConfig('phase2b-normal-2x-responsiveness', 'responsiveness', 'normal', { ping: { timeoutMs: 120_000 }, phase2b: PHASE2B_REQUEST }),
  memory: () => phase2aAttemptConfig('phase2b-normal-2x-memory', 'memory', 'normal', {
    memory: { intervalMs: PHASE2B_FIXED_POINT_MEMORY_INTERVAL_MS, gcWaitMs: 10_000 }, phase2b: PHASE2B_REQUEST }),
} as const
