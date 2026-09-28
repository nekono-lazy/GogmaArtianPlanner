import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { Phase2BAutonomousPlanEvidence } from './plannerGlobalPhase2BPlan'
import type { Phase2BPlannerCallTimeline } from './plannerGlobalPhase2BTimeline'
import type { ExtentAxis } from './plannerGlobalOptimizationExtentProbe'
import type { ExtentFallbackMeasurement, GlobalResearchReport } from './plannerGlobalOptimizationResearch'
import type { DiscoveryState, RetrySignals, StopReason } from './plannerGlobalOptimizationRetry'

/**
 * Issue #154 Global Planner Research Phase 2-A: benchmark-only Browser Worker protocol
 * (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2A.md`).
 *
 * It is NOT the Production Planner / Search Worker protocol and is never reachable from the normal
 * application. Every message type is prefixed `pg2a_benchmark_`, so it cannot collide with a Production
 * message or with another benchmark protocol (`pa3_benchmark_`, `b8_benchmark_`, ...). The Worker runs the
 * Phase 1-E Research calculation unchanged (`runGlobalPlannerResearch()` + the generic single-axis
 * fallback) and returns summaries and SHA-256 evidence only: no Candidate, Entry or Plan body.
 */
export const PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION = 'planner-global-phase2a'

/** `control`: Phase 0, no fallback. `fallback`: the Phase 1-E generic single-axis fallback of `fallbackAxis`. */
export type PlannerGlobalRunMode = 'control' | 'fallback'
/** Phase 1-B Research raw RNG block cache. `off` keeps the same pass-through observer without caching. */
export type PlannerGlobalRawCacheMode = 'off' | 'per-search'
/** `message-channel`: one MessagePort turn (macrotask). `timer`: `setTimeout(0)`. Never a microtask. */
export type PlannerGlobalYieldMode = 'message-channel' | 'timer'
/** A record label only; the Worker computes the same thing in every mode. `memory` adds Worker-side heap samples. */
export type PlannerGlobalMeasurementMode = 'timing' | 'responsiveness' | 'memory' | 'cancel' | 'controller' | 'probe'

export const PLANNER_GLOBAL_RUN_MODES: readonly PlannerGlobalRunMode[] = ['control', 'fallback']
export const PLANNER_GLOBAL_RAW_CACHE_MODES: readonly PlannerGlobalRawCacheMode[] = ['off', 'per-search']
export const PLANNER_GLOBAL_YIELD_MODES: readonly PlannerGlobalYieldMode[] = ['message-channel', 'timer']
export const PLANNER_GLOBAL_MEASUREMENT_MODES: readonly PlannerGlobalMeasurementMode[] = ['timing', 'responsiveness', 'memory', 'cancel', 'controller', 'probe']

export interface PlannerGlobalRunRequest {
  readonly type: 'pg2a_benchmark_run'
  readonly requestId: string
  /** Built on the main thread from the original Export only (`globalResearchInputFromExport()`). */
  readonly input: PlannerInput
  readonly mode: PlannerGlobalRunMode
  /** Required for `fallback`, null for `control`. */
  readonly fallbackAxis: ExtentAxis | null
  readonly rawCache: PlannerGlobalRawCacheMode
  readonly yieldMode: PlannerGlobalYieldMode
  /** Research Planner bound; must equal `input.options.maxPlanSteps` (never the Production default). */
  readonly maxPlanSteps: number
  /** Fallback Search budget (ms); required for `fallback`, null for `control`. */
  readonly fallbackBudgetMs: number | null
  /** Phase 1-E fallback episode bound per attempt; required for `fallback`, null for `control`. */
  readonly fallbackMaxEpisodes: number | null
  /** Attempt budget (ms); null = no Research deadline. Reaching it is `time_budget_reached`, never a no-match. */
  readonly attemptBudgetMs: number | null
  /** Phase 1-C retry state only; null = the run derives its retained set and pending order itself. */
  readonly attemptState: DiscoveryState | null
  readonly measurement: PlannerGlobalMeasurementMode
  /** Research prediction profiler (a pure observer, as in the Node runner). Off for Phase 2-A timing runs. */
  readonly profiler: boolean
  /**
   * Issue #154 Phase 2-B (optional; absent = the Phase 2-A run unchanged): the full Planner call timeline
   * (clocks only) and the post-hoc autonomous Plan evidence computed after the calculation.
   */
  readonly phase2b?: PlannerGlobalPhase2BRequest
}

export interface PlannerGlobalPhase2BRequest {
  readonly timeline: boolean
  readonly planEvidence: boolean
}

/** Phase 2-B additions to a Worker result. Every time is epoch-aligned ms (`timeOrigin + now()` of the Worker realm). */
export interface PlannerGlobalPhase2BResult {
  readonly marks: { readonly acceptedAtMs: number; readonly calculationStartAtMs: number; readonly calculationEndAtMs: number;
    readonly evidenceEndAtMs: number; readonly planEvidenceEndAtMs: number; readonly resultPostAtMs: number }
  readonly timeline: readonly Phase2BPlannerCallTimeline[] | null
  readonly autonomousPlan: Phase2BAutonomousPlanEvidence | null
  readonly planEvidenceElapsedMs: number
  /** Where the timeline heap probe came from (`null` = none; a Browser Worker exposes no synchronous heap API). */
  readonly heapProbe: string | null
}

export interface PlannerGlobalCancelRequest {
  readonly type: 'pg2a_benchmark_cancel'
  readonly requestId: string
}

export interface PlannerGlobalPingRequest {
  readonly type: 'pg2a_benchmark_ping'
  readonly pingId: number
}

export type PlannerGlobalBenchmarkRequest = PlannerGlobalRunRequest | PlannerGlobalCancelRequest | PlannerGlobalPingRequest

/** Worker-realm `performance.memory` (non-standard). Scope: this Worker's JS heap only; null where unavailable. */
export interface PlannerGlobalWorkerHeapSample {
  readonly usedJSHeapSize: number
  readonly totalJSHeapSize: number
  readonly jsHeapSizeLimit: number
}

export interface PlannerGlobalWorkerEnvironment {
  readonly protocolVersion: string
  readonly crossOriginIsolated: boolean | null
  readonly hardwareConcurrency: number | null
  readonly userAgent: string | null
  readonly workerPerformanceMemory: boolean
  readonly rngEngineVersion: string
}

/** A benchmark-only progress observation; sent only when its stage / Search / fallback status changes. */
export interface PlannerGlobalProgressObservation {
  readonly stage: GlobalResearchReport['stage']
  readonly status: GlobalResearchReport['status']
  readonly searchIndex: number
  readonly searchStatus: string | null
  readonly fallbackStatus: ExtentFallbackMeasurement['status'] | null
  readonly fallbackEpisodes: number
  readonly generatedReplacements: number
  /** Worker-local ms since the request was accepted. */
  readonly elapsedMs: number
  /** Only for `measurement === 'memory'`. */
  readonly workerHeap: PlannerGlobalWorkerHeapSample | null
}

export interface PlannerGlobalSearchEvidence {
  readonly targetId: string
  readonly resultSha256: string
  readonly candidateSha256: string
}
export interface PlannerGlobalFallbackSearchEvidence extends PlannerGlobalSearchEvidence {
  readonly axis: string
  readonly extent: ExtentFallbackMeasurement['extent']
  readonly searchRunId: string
}
export interface PlannerGlobalGeneratedEntryEvidence {
  readonly id: string
  readonly candidateSha256: string
  readonly entrySha256: string
}

/** Same hashes, same inputs and the same `sha256(JSON.stringify(value))` formula as the Node Phase 1-B..1-E runners. */
export interface PlannerGlobalEvidence {
  readonly searchEvidence: readonly PlannerGlobalSearchEvidence[]
  readonly fallbackSearchEvidence: readonly PlannerGlobalFallbackSearchEvidence[]
  readonly generatedEntries: readonly PlannerGlobalGeneratedEntryEvidence[]
  readonly finalSelectedEntryIds: readonly string[]
  readonly planSha256: string
  readonly finalResultSha256: string
  readonly resultSha256: string
}

export interface PlannerGlobalFallbackRecord {
  readonly searchIndex: number
  readonly targetId: string
  readonly baseStatus: string
  readonly targetOutcome: string | null
  readonly fallback: Omit<ExtentFallbackMeasurement, 'profile'>
}

export interface PlannerGlobalTiming {
  /** Worker-local: accepted -> result posted (calculation + evidence). */
  readonly workerElapsedMs: number
  /** Worker-local: `runGlobalPlannerResearch()` only. */
  readonly calculationElapsedMs: number
  /** Worker-local: signals, classification and SHA-256 evidence after the calculation. */
  readonly evidenceElapsedMs: number
  readonly searchElapsedMs: number
  readonly fallbackSearchElapsedMs: number
  readonly plannerElapsedMs: number
  /** `report.totalElapsedMs` (the Research's own clock). */
  readonly totalElapsedMs: number
  readonly candidateSearches: number
  readonly fallbackEpisodes: number
}

export interface PlannerGlobalWorkerResult {
  readonly rngEngineVersion: string
  readonly inputFingerprint: string
  /** Stable ordinary Planner priority of the original Build List, derived by this Worker from the input. */
  readonly priorityEntries: readonly { readonly id: string; readonly targetWeaponId: string }[]
  /** The state this run executed: derived by the run (initial / control) or the given retry state. */
  readonly state: DiscoveryState
  readonly signature: string
  readonly signals: RetrySignals
  readonly stop: StopReason | null
  /** Profiles removed. */
  readonly report: GlobalResearchReport
  readonly fallbacks: readonly PlannerGlobalFallbackRecord[]
  readonly evidence: PlannerGlobalEvidence
  /** The Phase 1-E reproduction semantic structure (timing, memory and environment excluded) and its SHA-256. */
  readonly semantic: unknown
  readonly semanticSha256: string
  readonly timing: PlannerGlobalTiming
  readonly rawBlockSummary: unknown
  readonly predictionProfile: unknown
  readonly workerHeapAfter: PlannerGlobalWorkerHeapSample | null
  /** Phase 2-B only (`request.phase2b` present). */
  readonly phase2b?: PlannerGlobalPhase2BResult
}

export type PlannerGlobalBenchmarkResponse =
  | { readonly type: 'pg2a_benchmark_ready'; readonly environment: PlannerGlobalWorkerEnvironment }
  | { readonly type: 'pg2a_benchmark_accepted'; readonly requestId: string; readonly priorityEntries: PlannerGlobalWorkerResult['priorityEntries'] }
  | { readonly type: 'pg2a_benchmark_pong'; readonly pingId: number }
  | { readonly type: 'pg2a_benchmark_cancel_ack'; readonly requestId: string }
  | { readonly type: 'pg2a_benchmark_progress'; readonly requestId: string; readonly observation: PlannerGlobalProgressObservation }
  | { readonly type: 'pg2a_benchmark_result'; readonly requestId: string; readonly result: PlannerGlobalWorkerResult }
  | { readonly type: 'pg2a_benchmark_cancelled'; readonly requestId: string; readonly result: PlannerGlobalWorkerResult }
  | { readonly type: 'pg2a_benchmark_error'; readonly requestId: string; readonly message: string }

const RESPONSE_TYPES = new Set(['pg2a_benchmark_ready', 'pg2a_benchmark_accepted', 'pg2a_benchmark_pong', 'pg2a_benchmark_cancel_ack',
  'pg2a_benchmark_progress', 'pg2a_benchmark_result', 'pg2a_benchmark_cancelled', 'pg2a_benchmark_error'])

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const nullOr = (value: unknown, check: (v: unknown) => boolean) => value === null || check(value)
const finiteNonNegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function isPlannerGlobalBenchmarkResponse(value: unknown): value is PlannerGlobalBenchmarkResponse {
  if (!isObject(value) || typeof value.type !== 'string' || !RESPONSE_TYPES.has(value.type)) return false
  if (value.type === 'pg2a_benchmark_ready') return isObject(value.environment)
  if (value.type === 'pg2a_benchmark_pong') return typeof value.pingId === 'number'
  if (!nonEmptyString(value.requestId)) return false
  switch (value.type) {
    case 'pg2a_benchmark_accepted': return Array.isArray(value.priorityEntries)
    case 'pg2a_benchmark_progress': return isObject(value.observation)
    case 'pg2a_benchmark_result':
    case 'pg2a_benchmark_cancelled': return isObject(value.result)
    case 'pg2a_benchmark_error': return typeof value.message === 'string'
    default: return true
  }
}

/** Structural guard only; `validatePlannerGlobalRunRequest()` checks the run's meaning before any calculation. */
export function isPlannerGlobalBenchmarkRequest(value: unknown): value is PlannerGlobalBenchmarkRequest {
  if (!isObject(value) || typeof value.type !== 'string') return false
  if (value.type === 'pg2a_benchmark_ping') return typeof value.pingId === 'number' && Number.isSafeInteger(value.pingId)
  if (value.type === 'pg2a_benchmark_cancel') return nonEmptyString(value.requestId)
  if (value.type !== 'pg2a_benchmark_run') return false
  return nonEmptyString(value.requestId) && isObject(value.input) && typeof value.mode === 'string' && typeof value.rawCache === 'string' &&
    typeof value.yieldMode === 'string' && typeof value.maxPlanSteps === 'number' && typeof value.measurement === 'string' &&
    typeof value.profiler === 'boolean' && 'fallbackAxis' in value && 'fallbackBudgetMs' in value && 'fallbackMaxEpisodes' in value &&
    'attemptBudgetMs' in value && 'attemptState' in value
}

/** Meaning of a run request. Nothing is defaulted or repaired: an invalid field fails the run before it starts. */
export function validatePlannerGlobalRunRequest(request: PlannerGlobalRunRequest): string[] {
  const issues: string[] = []
  if (!PLANNER_GLOBAL_RUN_MODES.includes(request.mode)) issues.push(`mode: ${String(request.mode)}`)
  if (!PLANNER_GLOBAL_RAW_CACHE_MODES.includes(request.rawCache)) issues.push(`rawCache: ${String(request.rawCache)}`)
  if (!PLANNER_GLOBAL_YIELD_MODES.includes(request.yieldMode)) issues.push(`yieldMode: ${String(request.yieldMode)}`)
  if (!PLANNER_GLOBAL_MEASUREMENT_MODES.includes(request.measurement)) issues.push(`measurement: ${String(request.measurement)}`)
  if (!Number.isSafeInteger(request.maxPlanSteps) || request.maxPlanSteps < 1) issues.push('maxPlanSteps must be a positive integer')
  else if (request.input.options?.maxPlanSteps !== request.maxPlanSteps) issues.push('maxPlanSteps must equal input.options.maxPlanSteps')
  if (!nullOr(request.attemptBudgetMs, finiteNonNegative)) issues.push('attemptBudgetMs must be null or a finite number >= 0')
  if (request.phase2b !== undefined && (!isObject(request.phase2b) || typeof request.phase2b.timeline !== 'boolean' || typeof request.phase2b.planEvidence !== 'boolean')) {
    issues.push('phase2b must be { timeline: boolean, planEvidence: boolean } when present')
  }
  if (request.mode === 'control') {
    if (request.fallbackAxis !== null || request.fallbackBudgetMs !== null || request.fallbackMaxEpisodes !== null) issues.push('control takes no fallback axis, budget or episode bound')
  } else if (request.mode === 'fallback') {
    if (!(['normal', 'gogma', 'skill'] as unknown[]).includes(request.fallbackAxis)) issues.push(`fallbackAxis: ${String(request.fallbackAxis)}`)
    if (!finiteNonNegative(request.fallbackBudgetMs)) issues.push('fallbackBudgetMs must be a finite number >= 0')
    if (!Number.isSafeInteger(request.fallbackMaxEpisodes) || (request.fallbackMaxEpisodes as number) < 1 || (request.fallbackMaxEpisodes as number) > 6) {
      issues.push('fallbackMaxEpisodes must be an integer 1..6')
    }
  }
  return issues
}
