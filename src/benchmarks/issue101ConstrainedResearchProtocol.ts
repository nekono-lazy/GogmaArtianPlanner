import type { PlannerInput, PlannerOrchestrationBounds } from '../domain/planner'
import type {
  ConstrainedCandidateSearchInput,
  ConstrainedEnumerationBounds,
  ConstrainedEnumerationSummary,
} from '../domain/search'

/**
 * Issue #101 benchmark-only Worker protocol.
 *
 * It is deliberately NOT a Production Worker protocol and is never reachable
 * from the normal application. Every message type is prefixed
 * `i101_benchmark_`, so it cannot collide with a Production message or with
 * the B8-B2 `b8_benchmark_` protocol.
 *
 * It exists because the Production Planner Worker fixes
 * `defaultConstrainedEnumerationBounds` inside its adapter, so the Issue #101
 * Gogma sweep cannot be measured through it. This Worker composes the very
 * same Production calculation - `createProductionPlanWithConstrainedSearch()`
 * with the Production Planner dependencies and `ProductionRngEngine` - and only
 * lets the benchmark choose the enumeration bounds.
 *
 * The input travels from the main thread as structured-clone data, exactly as
 * a Production `PlannerInput` does, so the fixture's two real Candidate
 * Searches run once on the main thread and never inside a measurement.
 */
export const ISSUE_101_BENCHMARK_PROTOCOL_VERSION = 'issue101-a'

/** How many delivered Candidates keep an individual Worker-local timestamp. */
export const ISSUE_101_RECORDED_CANDIDATE_TIMES = 16

export interface Issue101EnumerationRunRequest {
  readonly type: 'i101_benchmark_enumeration'
  readonly requestId: string
  readonly input: ConstrainedCandidateSearchInput
  /** Consumer stop after this many delivered Candidates; null runs to the end. */
  readonly stopAfterCandidates: number | null
  /**
   * Post one `i101_benchmark_first_candidate` when the first Candidate is
   * delivered, so a cancel can be aimed at the lattice traversal. It is the
   * only mid-run message and is off unless a cancel observation asks for it.
   */
  readonly notifyFirstCandidate: boolean
}

export interface Issue101OrchestrationRunRequest {
  readonly type: 'i101_benchmark_orchestration'
  readonly requestId: string
  readonly input: PlannerInput
  readonly enumerationBounds: ConstrainedEnumerationBounds
  readonly orchestrationBounds: PlannerOrchestrationBounds
  /** Same as enumeration: one message at the first Candidate trial. */
  readonly notifyFirstCandidate: boolean
}

export interface Issue101CancelRequest {
  readonly type: 'i101_benchmark_cancel'
  readonly requestId: string
}

export interface Issue101PingRequest {
  readonly type: 'i101_benchmark_ping'
  readonly pingId: number
}

export type Issue101BenchmarkRequest =
  | Issue101EnumerationRunRequest
  | Issue101OrchestrationRunRequest
  | Issue101CancelRequest
  | Issue101PingRequest

/** A compact, Candidate-independent description of one Route. */
export interface Issue101RouteSummary {
  readonly kind: string
  readonly operationCount: number
  /** `create_normal_artian.count`, or null for a Route that forges nothing. */
  readonly normalForgeCount: number | null
  readonly normalCounterBefore: number | null
  readonly conversionSkillCounter: number | null
  readonly resetBonusesCount: number
  readonly keepBonusesCount: number
  readonly resetSkillsCount: number
  readonly firstGogmaCounter: number | null
  readonly lastGogmaCounter: number | null
  readonly estimatedGogmaAdvance: number
  readonly estimatedSkillAdvance: number
  readonly estimatedNormalAdvance: number | null
}

/**
 * One enumeration run. Every time is a Worker-local offset from the anchor
 * immediately before `visitConstrainedCandidates()`; input validation inside
 * that call, the upfront raw stream solve and the lattice traversal are all
 * inside it, because a Production consumer waits for all of them.
 */
export interface Issue101EnumerationMeasurement {
  readonly workerElapsedMs: number
  readonly deliveredCandidates: number
  readonly timeToFirstCandidateMs: number | null
  /** The first `ISSUE_101_RECORDED_CANDIDATE_TIMES` delivery offsets. */
  readonly candidateTimesMs: readonly number[]
  readonly firstCandidate: Issue101RouteSummary | null
  readonly summary: ConstrainedEnumerationSummary
  readonly stoppedByConsumer: boolean
}

/** One observed step of the Production orchestration, in Worker-local time. */
export type Issue101OrchestrationEvent =
  /** A delivered Candidate was materialized: one Candidate trial started. */
  | { readonly kind: 'candidate_materialized'; readonly atMs: number }
  /** A full Planner run ended with a Plan (initial run or a trial rerun). */
  | { readonly kind: 'plan_generated'; readonly atMs: number }

export interface Issue101ConflictSummary {
  readonly kind: string
  readonly buildListEntryIds: readonly string[]
  readonly selectedBuildListEntryId: string | null
}

/**
 * One orchestration run.
 *
 * The timeline is read through the Production Planner dependencies only - the
 * clock and the ProductionPlan ID factory are wrapped, never replaced: every
 * value they return is the Production one. `PlannerClock.now()` is called by
 * the materializer once per Candidate trial and by Plan generation once per
 * Plan, immediately before `productionPlanId()`, so a clock call followed by a
 * ProductionPlan ID is a Plan and every other clock call is a Candidate trial.
 * A full Planner run that returned no Plan leaves no event; the record says so
 * through `planGenerations` versus `candidateTrials`.
 */
export interface Issue101OrchestrationMeasurement {
  readonly workerElapsedMs: number
  readonly events: readonly Issue101OrchestrationEvent[]
  readonly candidateTrials: number
  readonly planGenerations: number
  readonly initialPlannerRunMs: number | null
  readonly timeToFirstCandidateMs: number | null
  /** The Plan generation of the adopted trial; null when nothing was adopted. */
  readonly timeToAdoptedCandidateMs: number | null
  /** 1-based ordinal of the adopted Candidate among the trials. */
  readonly adoptedCandidateOrdinal: number | null
  readonly planPresent: boolean
  readonly planStepCount: number | null
  readonly terminationStatus: string
  readonly selectedBuildListEntryIds: readonly string[]
  readonly conflicts: readonly Issue101ConflictSummary[]
  readonly warningKinds: readonly string[]
  readonly generatedBuildListEntryCount: number
  readonly generatedRoutes: readonly Issue101RouteSummary[]
}

export interface Issue101AcceptedResponse {
  readonly type: 'i101_benchmark_accepted'
  readonly requestId: string
}

export interface Issue101CancelAckResponse {
  readonly type: 'i101_benchmark_cancel_ack'
  readonly requestId: string
}

/** The first Candidate was delivered (enumeration) or materialized (orchestration). */
export interface Issue101FirstCandidateResponse {
  readonly type: 'i101_benchmark_first_candidate'
  readonly requestId: string
}

export interface Issue101PongResponse {
  readonly type: 'i101_benchmark_pong'
  readonly pingId: number
}

export interface Issue101EnumerationResultResponse {
  readonly type: 'i101_benchmark_enumeration_result'
  readonly requestId: string
  readonly bounds: ConstrainedEnumerationBounds
  readonly measurement: Issue101EnumerationMeasurement
}

export interface Issue101OrchestrationResultResponse {
  readonly type: 'i101_benchmark_orchestration_result'
  readonly requestId: string
  readonly enumerationBounds: ConstrainedEnumerationBounds
  readonly orchestrationBounds: PlannerOrchestrationBounds
  readonly measurement: Issue101OrchestrationMeasurement
}

export interface Issue101CancelledResponse {
  readonly type: 'i101_benchmark_cancelled'
  readonly requestId: string
  /** Worker time from the measurement anchor to the cancelled settle. */
  readonly workerElapsedMs: number | null
  /** Candidates delivered (enumeration) or trials started (orchestration). */
  readonly deliveredCandidates: number
  /**
   * Whether the orchestration returned its ordinary cancelled result (a
   * `PlannerResult` with `plan: null`) rather than a thrown cancellation.
   */
  readonly settledAsResult: boolean
}

export interface Issue101ErrorResponse {
  readonly type: 'i101_benchmark_error'
  readonly requestId: string
  readonly message: string
}

export type Issue101BenchmarkResponse =
  | Issue101AcceptedResponse
  | Issue101CancelAckResponse
  | Issue101PongResponse
  | Issue101FirstCandidateResponse
  | Issue101EnumerationResultResponse
  | Issue101OrchestrationResultResponse
  | Issue101CancelledResponse
  | Issue101ErrorResponse

export function isIssue101BenchmarkResponse(
  value: unknown,
): value is Issue101BenchmarkResponse {
  const type = (value as { type?: unknown } | null)?.type
  return typeof type === 'string' && type.startsWith('i101_benchmark_')
}
