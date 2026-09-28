import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { PlannerAlternativeSearchSummary } from '../domain/search'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import type { Phase2C2BaselineSummary, Phase2C2Orientation } from './plannerGlobalPhase2C2'
import type { Phase2C25AMode, Phase2C25APreSearchContext, Phase2C25ASearchStatus } from './plannerGlobalPhase2C25A'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-B: benchmark-only Browser Worker protocol
 * (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25B.md`).
 *
 * It is NOT the Production Planner / Search Worker protocol and is never reachable from the normal application.
 * Every message type is prefixed `pg2c25b_benchmark_`, so it cannot collide with a Production message or with another
 * benchmark protocol (`pa3_benchmark_`, `pg2a_benchmark_`, ...), and the historical protocols keep their meaning.
 *
 * One Worker serves exactly one request (fresh Worker policy):
 * - `contexts`: this page session's own baseline (the ordinary Production Planner over the original Export) and the
 *   Phase 2-C2.5-A pre-search contexts of the requested orientations, derived by the current Domain code;
 * - `search`: re-derives one context from the PlannerInput + orientation, checks its digest, and runs only the Planner
 *   Alternative Search with a consumer stop at the first Candidate (`minimal` or `instrumented`).
 * A Worker never receives the Phase 2-C2.5-A evidence, a Counter position, a reservation or a Candidate.
 */
export const PHASE2C25B_PROTOCOL_VERSION = 'planner-global-phase2c25b'

/** The consumer stops at the first delivered Candidate (the Phase 2-C2.5-A stop bound). */
export const PHASE2C25B_CANDIDATE_STOP_BOUND = 1
/** Wall budget of one Search-only Browser run (Worker creation to settle), the Phase 2-C2.5-A child budget. */
export const PHASE2C25B_RUN_BUDGET_MS = 20 * 60 * 1000
/** Wall budget of the one-shot contexts Worker (baseline + context derivation). */
export const PHASE2C25B_CONTEXTS_BUDGET_MS = 10 * 60 * 1000
/** Ready wait of a fresh Worker (module evaluation). */
export const PHASE2C25B_READY_BUDGET_MS = 120_000
/**
 * Sparse instrumented progress (Research constants, not Production defaults): a heartbeat, held-aware depth progress,
 * right before the first Candidate stop, and the end. The heap growth trigger fires only when the Worker realm exposes
 * `performance.memory`; the formal heap authority is the external CDP driver.
 */
export const PHASE2C25B_SNAPSHOT_POLICY = { heartbeatMs: 2_000, heapGrowthBytes: 256 * 1024 * 1024, depthStep: 5 } as const
/** The external CDP driver's Worker heap sampling interval (recorded in the page environment; the driver owns it). */
export const PHASE2C25B_CDP_SAMPLE_INTERVAL_MS = 500

export type Phase2C25BMode = Phase2C25AMode
export type Phase2C25BSnapshotPolicy = { readonly heartbeatMs: number; readonly heapGrowthBytes: number; readonly depthStep: number }

export interface Phase2C25BWorkerHeapSample {
  readonly usedJSHeapSize: number
  readonly totalJSHeapSize: number
  readonly jsHeapSizeLimit: number
}

export interface Phase2C25BWorkerEnvironment {
  readonly protocolVersion: string
  readonly userAgent: string | null
  readonly hardwareConcurrency: number | null
  readonly crossOriginIsolated: boolean | null
  /** Worker-realm `performance.memory` (Chrome, non-standard); `null` when the realm does not expose it. */
  readonly performanceMemory: Phase2C25BWorkerHeapSample | null
  readonly messageChannel: boolean
  readonly rngEngineVersion: string
}

export type Phase2C25BSnapshotTrigger = 'start' | 'heartbeat' | 'heap_growth' | 'depth_progress' | 'first_candidate' | 'final'

/** A compact aggregate only: numbers, never a state, a family layout, a Route or a Candidate. */
export interface Phase2C25BProgressSnapshot {
  readonly seq: number
  readonly trigger: Phase2C25BSnapshotTrigger
  /** Worker ms since the Search started. */
  readonly elapsedMs: number
  readonly settledWorkItems: number
  readonly skill: { readonly streams: number; readonly maxDepth: number; readonly totalStates: number; readonly totalTransitions: number }
  readonly gogma: {
    readonly streams: number
    readonly maxDepth: number
    readonly totalGeneratedStates: number
    readonly totalFrontierStates: number
    readonly maxGeneratedStatesPerDepth: number
    readonly depthOfMaxGeneratedStates: number | null
  }
  readonly lastEvent: null | {
    readonly type: 'skill' | 'gogma'
    readonly streamIndex: number
    readonly startCounter: number
    readonly depth: number
    readonly absolutePositions: number
    /** Gogma events only. */
    readonly generatedStates: number | null
    readonly frontierStates: number | null
    readonly familyLayouts: number | null
    /** Skill events only. */
    readonly transitions: number | null
    readonly states: number | null
  }
  readonly predictionCounts: PlannerAlternativePredictionCounts
  /** Worker-realm `performance.memory` when exposed; `null` otherwise (never estimated). */
  readonly workerHeap: Phase2C25BWorkerHeapSample | null
}

export interface Phase2C25BFirstCandidateSummary {
  readonly routeKind: string
  readonly sourceKind: string
  readonly estimatedOperationCount: number
  readonly ownOperationCount: number
  readonly operationTypes: Readonly<Record<string, number>>
  readonly heldRoute: boolean
}

export interface Phase2C25BSearchRecord {
  readonly mode: Phase2C25BMode
  readonly orientationId: string
  readonly targetWeaponId: string
  readonly workIndex: number
  readonly contextDigest: string
  readonly status: Phase2C25ASearchStatus
  readonly searchSummary: PlannerAlternativeSearchSummary & { readonly stoppedByConsumer: boolean; readonly skippedExcludedRouteKeys: number }
  /** Search start to the first delivery (Worker ms); `null` without a Candidate. */
  readonly timeToFirstMs: number | null
  readonly elapsedMs: number
  /** SHA-256 (UTF-8) of the first Candidate's `candidateStableKey()`; the raw key never leaves the Worker. */
  readonly firstCandidateKeySha256: string | null
  readonly firstCandidateSummary: Phase2C25BFirstCandidateSummary | null
  readonly predictionCounts: PlannerAlternativePredictionCounts | null
  readonly predictionCountsAtFirstCandidate: PlannerAlternativePredictionCounts | null
  readonly finalSnapshot: Phase2C25BProgressSnapshot | null
  readonly snapshotsEmitted: number
}

export interface Phase2C25BContextsResult {
  readonly baseline: { readonly summary: Phase2C2BaselineSummary; readonly orientations: Phase2C2Orientation[]; readonly elapsedMs: number }
  readonly contexts: Record<string, Phase2C25APreSearchContext[]>
  readonly elapsedMs: number
}

export type Phase2C25BErrorStage = 'validation' | 'preparation' | 'search' | 'summary'

export type Phase2C25BRequest =
  | { readonly type: 'pg2c25b_benchmark_contexts'; readonly requestId: string; readonly input: PlannerInput; readonly orientationIds: readonly string[] }
  | {
      readonly type: 'pg2c25b_benchmark_search'
      readonly requestId: string
      readonly input: PlannerInput
      readonly orientation: Phase2C2Orientation
      readonly workIndex: number
      readonly expectedContextDigest: string
      readonly mode: Phase2C25BMode
      readonly snapshotPolicy: Phase2C25BSnapshotPolicy
    }

export type Phase2C25BResponse =
  | { readonly type: 'pg2c25b_benchmark_ready'; readonly environment: Phase2C25BWorkerEnvironment }
  | { readonly type: 'pg2c25b_benchmark_accepted'; readonly requestId: string }
  | { readonly type: 'pg2c25b_benchmark_contexts_result'; readonly requestId: string; readonly result: Phase2C25BContextsResult }
  | { readonly type: 'pg2c25b_benchmark_search_ready'; readonly requestId: string; readonly preparationMs: number; readonly workerHeap: Phase2C25BWorkerHeapSample | null }
  | { readonly type: 'pg2c25b_benchmark_progress'; readonly requestId: string; readonly snapshot: Phase2C25BProgressSnapshot }
  | { readonly type: 'pg2c25b_benchmark_first_candidate'; readonly requestId: string; readonly timeToFirstMs: number }
  | { readonly type: 'pg2c25b_benchmark_search_result'; readonly requestId: string; readonly record: Phase2C25BSearchRecord }
  | { readonly type: 'pg2c25b_benchmark_error'; readonly requestId: string; readonly stage: Phase2C25BErrorStage; readonly name: string; readonly message: string;
      readonly firstCandidateDelivered: boolean }

const RESPONSE_TYPES = new Set(['pg2c25b_benchmark_ready', 'pg2c25b_benchmark_accepted', 'pg2c25b_benchmark_contexts_result', 'pg2c25b_benchmark_search_ready',
  'pg2c25b_benchmark_progress', 'pg2c25b_benchmark_first_candidate', 'pg2c25b_benchmark_search_result', 'pg2c25b_benchmark_error'])

export function isPhase2C25BResponse(value: unknown): value is Phase2C25BResponse {
  return typeof value === 'object' && value !== null && RESPONSE_TYPES.has((value as { type?: unknown }).type as string)
}

export function isPhase2C25BRequest(value: unknown): value is Phase2C25BRequest {
  const type = typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : null
  return type === 'pg2c25b_benchmark_contexts' || type === 'pg2c25b_benchmark_search'
}

const positiveInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Structural validation of one request; an invalid request is refused, never repaired. */
export function validatePhase2C25BRequest(request: Phase2C25BRequest): string[] {
  const issues: string[] = []
  if (typeof request.requestId !== 'string' || request.requestId.length === 0) issues.push('requestId')
  if (typeof request.input !== 'object' || request.input === null) issues.push('input')
  if (request.type === 'pg2c25b_benchmark_contexts') {
    if (!Array.isArray(request.orientationIds) || request.orientationIds.length === 0 || request.orientationIds.some(id => typeof id !== 'string')) issues.push('orientationIds')
    return issues
  }
  if (typeof request.orientation !== 'object' || request.orientation === null || typeof request.orientation.orientationId !== 'string') issues.push('orientation')
  if (!Number.isSafeInteger(request.workIndex) || request.workIndex < 0) issues.push('workIndex')
  if (typeof request.expectedContextDigest !== 'string' || request.expectedContextDigest.length === 0) issues.push('expectedContextDigest')
  if (request.mode !== 'minimal' && request.mode !== 'instrumented') issues.push('mode')
  const policy = request.snapshotPolicy
  if (typeof policy !== 'object' || policy === null || !positiveInteger(policy.heartbeatMs) || !positiveInteger(policy.heapGrowthBytes) || !positiveInteger(policy.depthStep)) issues.push('snapshotPolicy')
  return issues
}

// ---------------------------------------------------------------- page-observable run status

/** A Search result the Worker returned: a normal termination. */
export const PHASE2C25B_NORMAL_STATUSES = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate'] as const

/**
 * What the page can observe of one Search-only run. A native Worker failure is never a "no Candidate" result, and is
 * never an out-of-memory claim either: the page only knows that the Worker failed, and whether the first Candidate
 * notice had arrived before.
 */
export type Phase2C25BPageRunStatus =
  | Phase2C25ASearchStatus
  | 'structured_error'
  | 'worker_error_before_first_candidate'
  | 'worker_error_after_first_candidate'
  | 'worker_messageerror'
  | 'worker_not_ready'
  | 'timeout'
  /** The external driver aborted the run (e.g. it saw the Worker target disappear while the page stayed alive). */
  | 'aborted'

/**
 * The driver-observable statuses the page cannot record because the page itself was lost. They exist only in the
 * external evidence and are merged post-hoc; nothing here makes them an out-of-memory claim.
 */
export type Phase2C25BExternalRunStatus = 'page_crashed' | 'browser_crashed' | 'worker_target_destroyed_before_first_candidate' | 'driver_timeout'

export type Phase2C25BRunStatus = Phase2C25BPageRunStatus | Phase2C25BExternalRunStatus

export function isPhase2C25BNormalStatus(status: string): status is Phase2C25ASearchStatus {
  return (PHASE2C25B_NORMAL_STATUSES as readonly string[]).includes(status)
}
