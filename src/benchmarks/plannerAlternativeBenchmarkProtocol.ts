import type {
  PlannerAlternativeKernelRequest,
  PlannerAlternativeTrialBounds,
} from '../domain/planner'
import type {
  PlannerAlternativeSearchExtent,
  PlannerAlternativeSearchInput,
  PlannerAlternativeSearchSummary,
} from '../domain/search'
import type { Issue101RouteSummary } from './issue101ConstrainedResearchProtocol'

/**
 * Planner Alternative Search Phase 3-A benchmark-only Worker protocol
 * (`docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`).
 *
 * It is NOT a Production Worker protocol and is never reachable from the
 * normal application. Every message type is prefixed `pa3_benchmark_`, so it
 * cannot collide with a Production message or with another benchmark
 * protocol (`b8_benchmark_`, `i101_benchmark_`, ...).
 *
 * The Worker runs the Production calculations unchanged -
 * `visitPlannerAlternativeCandidates()` (Search measurement) and
 * `runPlannerAlternativeKernel()` with the Production Planner dependencies
 * (Kernel measurement) - and returns aggregates only: no Candidate array, no
 * state content, no ProductionPlan.
 */
export const PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION = 'planner-alternative-phase3-a'

/** How many delivered Candidates keep an individual Worker-local timestamp. */
export const PLANNER_ALTERNATIVE_RECORDED_CANDIDATE_TIMES = 16

/** How many leading `candidateStableKey`s a parity run returns in full. */
export const PLANNER_ALTERNATIVE_PARITY_LEADING_KEYS = 4

/**
 * `timing`: the visitor only counts and timestamps (no `candidateStableKey`,
 * no digest). `parity`: the visitor also folds every delivered
 * `candidateStableKey` into a digest for determinism / ordering checks; a
 * parity record is never performance evidence.
 */
export type PlannerAlternativeRecordingMode = 'timing' | 'parity'

export interface PlannerAlternativeSearchRunRequest {
  readonly type: 'pa3_benchmark_search'
  readonly requestId: string
  readonly input: PlannerAlternativeSearchInput
  /** Consumer stop after this many delivered Candidates; null runs to the end. */
  readonly stopAfterCandidates: number | null
  readonly recording: PlannerAlternativeRecordingMode
  /**
   * Pass the Search instrumentation observers and count Production RNG
   * predictions. Off runs the exact Production call path (no observer, the
   * unwrapped `ProductionRngEngine`).
   */
  readonly instrumented: boolean
  /** Post one `pa3_benchmark_first_candidate` at the first delivery. */
  readonly notifyFirstCandidate: boolean
}

export interface PlannerAlternativeKernelRunRequest {
  readonly type: 'pa3_benchmark_kernel'
  readonly requestId: string
  readonly request: PlannerAlternativeKernelRequest
  /** Count Production RNG predictions (Search, Planner and Trace Replay together). */
  readonly instrumented: boolean
  /** Post one `pa3_benchmark_first_candidate` when the first Candidate trial starts. */
  readonly notifyFirstCandidate: boolean
}

export interface PlannerAlternativeCancelRequest {
  readonly type: 'pa3_benchmark_cancel'
  readonly requestId: string
}

export interface PlannerAlternativePingRequest {
  readonly type: 'pa3_benchmark_ping'
  readonly pingId: number
}

export type PlannerAlternativeBenchmarkRequest =
  | PlannerAlternativeSearchRunRequest
  | PlannerAlternativeKernelRunRequest
  | PlannerAlternativeCancelRequest
  | PlannerAlternativePingRequest

/** Production RNG prediction calls, counted by wrapping the Engine. */
export interface PlannerAlternativePredictionCounts {
  readonly predictNormalArtian: number
  readonly predictSkills: number
  readonly resetBonuses: number
  readonly keepBonuses: number
}

/** Held-aware Skill stream depths, summed over every held-aware stream. */
export interface PlannerAlternativeSkillDepthAggregate {
  readonly depth: number
  readonly streams: number
  readonly transitions: number
  readonly states: number
  readonly absolutePositions: number
  readonly maxStatesPerStream: number
}

export interface PlannerAlternativeSkillStreamAggregate {
  readonly streams: number
  readonly totalStates: number
  readonly totalTransitions: number
  readonly maxDepth: number
  readonly depths: readonly PlannerAlternativeSkillDepthAggregate[]
}

/** Held-aware Bonus stream depths, summed over every held-aware stream. */
export interface PlannerAlternativeGogmaDepthAggregate {
  readonly depth: number
  readonly streams: number
  readonly generatedStates: number
  readonly frontierStates: number
  readonly absolutePositions: number
  /** Summed per stream; a family layout shared by two streams counts twice. */
  readonly familyLayouts: number
  readonly maxGeneratedStatesPerStream: number
  readonly maxFamilyLayoutsPerStream: number
}

export interface PlannerAlternativeGogmaStreamAggregate {
  readonly streams: number
  readonly totalGeneratedStates: number
  readonly totalFrontierStates: number
  readonly maxDepth: number
  readonly depths: readonly PlannerAlternativeGogmaDepthAggregate[]
}

export interface PlannerAlternativeParityDigest {
  /** `hashStableValue()` of the whole delivered `candidateStableKey` sequence. */
  readonly candidateKeyDigest: string
  readonly leadingCandidateKeys: readonly string[]
}

/**
 * One Search run. Every time is a Worker-local offset from the anchor
 * immediately before `visitPlannerAlternativeCandidates()`, so input
 * validation, Route base registration, stream solving and every same-cost
 * closure are inside it.
 */
export interface PlannerAlternativeSearchMeasurement {
  readonly workerElapsedMs: number
  /** The first visitor delivery (after the same-cost closure and 6-key sort). */
  readonly timeToFirstCandidateMs: number | null
  readonly candidateTimesMs: readonly number[]
  readonly deliveredCandidates: number
  /** Settled scheduler work items when the first Candidate was delivered; null when not instrumented. */
  readonly settledWorkItemsAtFirstCandidate: number | null
  /** Settled scheduler work items of the whole run; null when not instrumented. */
  readonly settledWorkItemsTotal: number | null
  readonly predictionCounts: PlannerAlternativePredictionCounts | null
  readonly predictionCountsAtFirstCandidate: PlannerAlternativePredictionCounts | null
  readonly skillStreams: PlannerAlternativeSkillStreamAggregate | null
  readonly gogmaStreams: PlannerAlternativeGogmaStreamAggregate | null
  readonly firstCandidate: Issue101RouteSummary | null
  readonly summary: PlannerAlternativeSearchSummary
  readonly stoppedByConsumer: boolean
  readonly parity: PlannerAlternativeParityDigest | null
}

export type PlannerAlternativeKernelOutcomeStatus =
  | 'found'
  | 'not_found_within_search_extent'
  | 'stopped_by_search_extent_bound'
  | 'stopped_by_candidate_trial_bound'
  | 'stopped_by_planner_rerun_bound'
  | 'blocked_by_selected_checkpoint'

export interface PlannerAlternativeFoundSummary {
  readonly route: Issue101RouteSummary
  readonly generatedSelected: boolean
  readonly trialTerminationStatus: string
  readonly trialConflictCount: number
  readonly planStepCount: number | null
}

export interface PlannerAlternativeKernelTargetSummary {
  readonly targetWeaponId: string
  readonly outcome: PlannerAlternativeKernelOutcomeStatus
  readonly trials: number
  readonly trialResults: readonly string[]
  readonly search: (PlannerAlternativeSearchSummary & { readonly stoppedByConsumer: boolean }) | null
  readonly found: PlannerAlternativeFoundSummary | null
}

export type PlannerAlternativeKernelResultSummary =
  | {
      readonly status: 'completed'
      readonly plannerRerunsUsed: number
      readonly candidateTrials: number
      readonly targets: readonly PlannerAlternativeKernelTargetSummary[]
    }
  /** A typed Kernel failure (`PlannerWhatIfFailureResult`, `invalid_prior_fixed_entry`). */
  | { readonly status: 'failed'; readonly kernelStatus: string; readonly detail: string | null }

export interface PlannerAlternativeKernelMeasurement {
  readonly workerElapsedMs: number
  /** The first Candidate trial's materialization (its Production clock read). */
  readonly timeToFirstTrialMs: number | null
  readonly predictionCounts: PlannerAlternativePredictionCounts | null
  readonly result: PlannerAlternativeKernelResultSummary
}

export interface PlannerAlternativeAcceptedResponse {
  readonly type: 'pa3_benchmark_accepted'
  readonly requestId: string
}

export interface PlannerAlternativeCancelAckResponse {
  readonly type: 'pa3_benchmark_cancel_ack'
  readonly requestId: string
}

export interface PlannerAlternativeFirstCandidateResponse {
  readonly type: 'pa3_benchmark_first_candidate'
  readonly requestId: string
}

export interface PlannerAlternativePongResponse {
  readonly type: 'pa3_benchmark_pong'
  readonly pingId: number
}

export interface PlannerAlternativeSearchResultResponse {
  readonly type: 'pa3_benchmark_search_result'
  readonly requestId: string
  readonly extent: PlannerAlternativeSearchExtent
  readonly measurement: PlannerAlternativeSearchMeasurement
}

export interface PlannerAlternativeKernelResultResponse {
  readonly type: 'pa3_benchmark_kernel_result'
  readonly requestId: string
  readonly extent: PlannerAlternativeSearchExtent
  readonly bounds: PlannerAlternativeTrialBounds
  readonly measurement: PlannerAlternativeKernelMeasurement
}

export interface PlannerAlternativeCancelledResponse {
  readonly type: 'pa3_benchmark_cancelled'
  readonly requestId: string
  /** Worker time from the measurement anchor to the cancelled settle. */
  readonly workerElapsedMs: number
  /** Candidates delivered (Search) or Candidate trials started (Kernel). */
  readonly deliveredCandidates: number
}

export interface PlannerAlternativeErrorResponse {
  readonly type: 'pa3_benchmark_error'
  readonly requestId: string
  readonly message: string
}

export type PlannerAlternativeBenchmarkResponse =
  | PlannerAlternativeAcceptedResponse
  | PlannerAlternativeCancelAckResponse
  | PlannerAlternativeFirstCandidateResponse
  | PlannerAlternativePongResponse
  | PlannerAlternativeSearchResultResponse
  | PlannerAlternativeKernelResultResponse
  | PlannerAlternativeCancelledResponse
  | PlannerAlternativeErrorResponse

export function isPlannerAlternativeBenchmarkResponse(
  value: unknown,
): value is PlannerAlternativeBenchmarkResponse {
  const type = (value as { type?: unknown } | null)?.type
  return typeof type === 'string' && type.startsWith('pa3_benchmark_')
}

const REQUEST_TYPES = new Set([
  'pa3_benchmark_search',
  'pa3_benchmark_kernel',
  'pa3_benchmark_cancel',
  'pa3_benchmark_ping',
])

/** Structural check of an incoming Worker message; anything else is ignored. */
export function isPlannerAlternativeBenchmarkRequest(
  value: unknown,
): value is PlannerAlternativeBenchmarkRequest {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || !REQUEST_TYPES.has(record.type)) return false
  if (record.type === 'pa3_benchmark_ping') return typeof record.pingId === 'number'
  return typeof record.requestId === 'string' && record.requestId.length > 0
}
