import type { BuildListEntryId, DomainValidationIssue } from '../domain/models/publicTypes'
import type {
  PlannerInput,
  PlannerOrchestrationBounds,
  PlannerOrchestrationResult,
  PlannerWarning,
  PlannerWhatIfCalculationResult,
  PlannerWhatIfRequest,
  PlannerWorkerRequest,
  PlannerWorkerResponse,
} from '../domain/planner'
import type { WorkerResultResponse, WorkerTaskRequest } from './contracts'

/**
 * The B8-D1 Worker-layer protocol for Planner-driven constrained re-search
 * (PLANNER_SPEC 9.2.6, 14).
 *
 * It lives in the Worker layer rather than in `plannerTypes.ts` on purpose.
 * `PlannerOrchestrationResult` belongs to `domain/planner/constrained`, so
 * declaring this protocol beside the ordinary `PlannerWorkerRequest` would make
 * the Planner foundation module import its own constrained sub-module. The
 * Domain never imports a Worker module, so the dependency only ever points
 * Worker -> Domain here.
 *
 * The ordinary `create_plan` / `create_plan_result` protocol is untouched: this
 * is an additional request kind, and `cancel`, `progress`, and `error` stay
 * shared between both kinds. The Domain request/response shapes are reused
 * verbatim and only extended with the wire-level task generation below.
 */

/**
 * The task instance a wire message belongs to.
 *
 * `requestId` stays the *logical* id, shared by the ordinary and constrained
 * kinds exactly as before. It cannot identify a running calculation on its own:
 * `postMessage()` is asynchronous, so re-using an id replaces the Client's
 * pending Promise while the Worker may still be running - and may still finish
 * - the calculation the replaced Promise belonged to. Its result would then
 * arrive for a live pending request of the other kind and be mistaken for a
 * protocol violation.
 *
 * Every task therefore carries a Client-minted monotonic generation, every
 * response echoes it, and both sides compare it: the Worker to decide what to
 * post, the Client to decide what to accept. A mismatch is a stale message, not
 * an error.
 *
 * It is runtime-only wire metadata: a plain number, never part of
 * `PlannerInput`, `PlannerResult`, `PlannerOrchestrationResult`, any Domain
 * entity, or persistence.
 */
export interface PlannerTaskGeneration {
  generation: number
}

/** Display diagnostics only; never parse reason to decide availability. */
export interface PlannerInteractionExcludedEntry {
  buildListEntryId: BuildListEntryId
  reason: string
}

/** Current initial Conflict identity and membership, without recommendation. */
export interface PlannerInteractionConflict {
  id: string
  buildListEntryIds: BuildListEntryId[]
}

/** Minimal B10 wire projection; no PlannerInitialContext or internal state. */
export type PlannerInteractionPreparationResult =
  | {
      status: 'ready'
      validBuildListEntryIds: BuildListEntryId[]
      excludedBuildListEntries: PlannerInteractionExcludedEntry[]
      currentConflicts: PlannerInteractionConflict[]
    }
  | {
      status: 'invalid'
      issues: DomainValidationIssue[]
      warnings: PlannerWarning[]
      excludedBuildListEntries: PlannerInteractionExcludedEntry[]
    }

/** Preparation performs no search and accepts only the fresh PlannerInput. */
export type PlannerInteractionWorkerRequest = WorkerTaskRequest<
  'prepare_interaction',
  PlannerInput
> &
  PlannerTaskGeneration

export type PlannerInteractionWorkerResultResponse = WorkerResultResponse<
  'prepare_interaction_result',
  PlannerInteractionPreparationResult
> &
  PlannerTaskGeneration

/**
 * Everything the constrained request structured-clones.
 *
 * `PlannerOrchestrationBounds` is caller-required (PLANNER_SPEC 9.2.16). B8-E2b
 * decided a Production default (`defaultPlannerOrchestrationBounds`), but the
 * Worker never applies it, so the bounds must still cross the Worker boundary
 * explicitly. `ConstrainedEnumerationBounds` deliberately does *not*
 * appear here - the Production Worker adapter supplies the B8-B2
 * `defaultConstrainedEnumerationBounds` inside the Worker boundary, so an
 * Application caller never restates a Search-domain extent.
 */
export interface PlannerConstrainedWorkerTaskInput {
  plannerInput: PlannerInput
  orchestrationBounds: PlannerOrchestrationBounds
}

export type PlannerOrdinaryWorkerRequest = Extract<
  PlannerWorkerRequest,
  { type: 'create_plan' }
> &
  PlannerTaskGeneration

export type PlannerConstrainedWorkerRequest = WorkerTaskRequest<
  'create_constrained_plan',
  PlannerConstrainedWorkerTaskInput
> &
  PlannerTaskGeneration

/** The B9 public request crosses the wire verbatim; enumeration bounds do not. */
export type PlannerWhatIfWorkerRequest = WorkerTaskRequest<
  'create_what_if_comparison',
  PlannerWhatIfRequest
> &
  PlannerTaskGeneration

/** Cancels one task instance, never merely a logical request id. */
export type PlannerWorkerCancelRequest = Extract<
  PlannerWorkerRequest,
  { type: 'cancel' }
> &
  PlannerTaskGeneration

export type PlannerOrdinaryWorkerResultResponse = Extract<
  PlannerWorkerResponse,
  { type: 'create_plan_result' }
> &
  PlannerTaskGeneration

export type PlannerConstrainedWorkerResultResponse = WorkerResultResponse<
  'create_constrained_plan_result',
  PlannerOrchestrationResult
> &
  PlannerTaskGeneration

export type PlannerWhatIfWorkerResultResponse = WorkerResultResponse<
  'create_what_if_comparison_result',
  PlannerWhatIfCalculationResult
> &
  PlannerTaskGeneration

export type PlannerWorkerProgressResponse = Extract<
  PlannerWorkerResponse,
  { type: 'progress' }
> &
  PlannerTaskGeneration

export type PlannerWorkerErrorResponse = Extract<
  PlannerWorkerResponse,
  { type: 'error' }
> &
  PlannerTaskGeneration

/** All four Planner request kinds share one task namespace. */
export type PlannerWorkerProtocolRequest =
  | PlannerOrdinaryWorkerRequest
  | PlannerConstrainedWorkerRequest
  | PlannerWhatIfWorkerRequest
  | PlannerInteractionWorkerRequest
  | PlannerWorkerCancelRequest

/** All Planner results share the existing `progress` / `error` responses. */
export type PlannerWorkerProtocolResponse =
  | PlannerOrdinaryWorkerResultResponse
  | PlannerConstrainedWorkerResultResponse
  | PlannerWhatIfWorkerResultResponse
  | PlannerInteractionWorkerResultResponse
  | PlannerWorkerProgressResponse
  | PlannerWorkerErrorResponse
