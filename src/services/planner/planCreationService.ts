import { appDatabase, type AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { ProductionPlanId } from '../../domain/models/publicTypes'
import {
  createProductionPlannerDependencies,
  validatePlannerOptions,
  type PlannerDependencies,
  type PlannerInput,
  type PlannerOptions,
  type PlannerResult,
} from '../../domain/planner'
import {
  isOrdinaryPlannerAuxiliaryOfferedForResult,
  selectPlanCreationMethod,
  type PlanCreationMethodSelection,
} from '../../domain/planner/buildListOptimization'
import { productionRngEngine } from '../../domain/rng/production/productionRngRuntime'
import { createBuildListCalculationContext } from '../buildList/createBuildListCalculationContext'
import {
  createBuildListOptimizationSession,
  createBuildListOptimizationStartReader,
  type BuildListOptimizationSession,
  type BuildListOptimizationSessionState,
  type BuildListOptimizationStartPreparation,
  type BuildListOptimizationStartReader,
  type BuildListOptimizationStartSnapshot,
} from './buildListOptimizationService'
import { createProductionBuildListOptimizationWorkerClient } from './buildListOptimizationWorkerClient'
import {
  createProductionPlannerWorkerClient,
  PlannerCancelledError,
  type PlannerWorkerClient,
} from './plannerWorkerClient'

/**
 * The plan creation boundary of the Build List screen (`docs/PLANNER_SPEC.md` 17.2 U1 / 17.4 / 17.16, Issue #260 PR-6B1): which
 * calculation 「生産計画を作成」 starts, decided at the moment the operation is pressed.
 *
 *   1. one read-only transaction reads the running Plan, the current Draft and the fresh PlannerInput (`conflictResolutions = []`)
 *      through the Build List optimization start reader (Issue #260 PR-4); a read failure or a Persistence invariant violation fails
 *      closed, and a running (`active` / `stale`) Plan offers no new creation (judgements 1 / 2)
 *   2. the Domain judgement `selectPlanCreationMethod()` decides over that very input (judgements 3 - 6)
 *   3. the ordinary Planner runs that input on the Production Planner Worker with the user's valid `PlannerOptions` (an invalid
 *      setting starts nothing and is never replaced by a default), or the Build List optimization session runs that input with the
 *      start snapshot read beside it (the Production search bounds are the Worker adapter's; the user's setting never reaches it), or
 *      nothing starts and the typed reason says why
 *
 * The input that is judged is the input that is calculated: nothing reads the state a second time between the judgement and the
 * start. Every press reads afresh: a judgement shown before the press (`inspect()`) is never the start authority.
 *
 * The ordinary Planner auxiliary operation (17.2 「通常Plannerの補助導線」) starts only while the session offers it
 * (`isOrdinaryPlannerAuxiliaryOffered()`: beside the primary press's pre-start refusal or optimization result that offers it); a press
 * outside that changes nothing at all. Offered, it reads and judges afresh too, and runs the ordinary Planner when the ordinary Planner
 * itself can run on that state (no running Plan, a readable state, a valid input, one or more valid Entries). It never changes the
 * primary operation's result, so the result it was offered beside stays. Nothing here falls back from the optimization to the ordinary
 * Planner: no cancellation, failure or result of the optimization starts the ordinary Planner, which runs only on a press.
 *
 * It writes nothing. The ordinary Planner's result is saved by the existing `PlannerResultPersistenceService.savePlannerResult()`, and
 * an `optimized` result is adopted by `saveBuildListOptimizationAdoption()` (Issue #260 PR-6A), both outside this session.
 */

/** The two operations the screen offers: 「生産計画を作成」 and the ordinary Planner auxiliary operation. */
export type PlanCreationOperation = 'primary' | 'ordinary_planner_auxiliary'

/** One fresh read and the Domain judgement over it (`docs/PLANNER_SPEC.md` 17.2). Runtime-only: never persisted. */
export type PlanCreationPreparation =
  /** Judgement 2: the running Plan, the Draft or the input could not be read (a read failure or a Persistence invariant violation). */
  | { kind: 'start_read_failed'; code: string; message: string }
  /** The judgement broke a contract: nothing starts, and it is never read as an unsupported input. */
  | { kind: 'judgement_failed'; message: string }
  /** Judgement 1: a running Plan exists, so no new creation is offered (the replan Preview stays the only Planner operation). */
  | { kind: 'running_plan_exists'; runningPlanId: ProductionPlanId }
  /** Judgements 3 - 6 over the fresh input, read in one transaction with the start snapshot the optimization's adoption re-checks. */
  | { kind: 'judged'; plannerInput: PlannerInput; startSnapshot: BuildListOptimizationStartSnapshot; selection: PlanCreationMethodSelection }

export interface PlanCreationPreparer {
  /** One read-only snapshot and the judgement over it. Never throws and never writes. */
  prepare(): Promise<PlanCreationPreparation>
}

export interface PlanCreationPreparerDependencies {
  /** The read-only start reader of the Build List optimization (running Plan, Draft and fresh input in one transaction). */
  startReader: BuildListOptimizationStartReader
  /** The Planner dependencies of the judgement; only the Engine is read (support queries, nothing predicted). */
  plannerDependencies: PlannerDependencies
}

export function createPlanCreationPreparer(dependencies: PlanCreationPreparerDependencies): PlanCreationPreparer {
  return {
    prepare: async () => {
      let preparation: BuildListOptimizationStartPreparation
      try {
        preparation = await dependencies.startReader.read()
      } catch (error: unknown) {
        return {
          kind: 'start_read_failed',
          code: error instanceof RepositoryError ? error.code : 'transaction_failed',
          message: error instanceof Error ? error.message : String(error),
        }
      }
      if (preparation.status === 'running_plan_exists') return { kind: 'running_plan_exists', runningPlanId: preparation.runningPlanId }
      try {
        const selection = selectPlanCreationMethod(preparation.plannerInput, dependencies.plannerDependencies)
        return { kind: 'judged', plannerInput: preparation.plannerInput, startSnapshot: preparation.startSnapshot, selection }
      } catch (error: unknown) {
        return { kind: 'judgement_failed', message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/** Why a press started no calculation. Each kind keeps what the screen needs to say why (the typed validation included). */
export type PlanCreationNotStartedReason =
  | Exclude<PlanCreationPreparation, { kind: 'judged' }>
  | Extract<PlanCreationMethodSelection, { kind: 'invalid_planner_input' | 'no_valid_build_list_entry' | 'build_list_optimization_unsupported' }>
  /** U7: the ordinary Planner was chosen and the screen's 「最大計画ステップ数」 is not a valid `PlannerOptions` (no default fills it). */
  | { kind: 'planner_options_invalid' }

export type PlanCreationCancelReason =
  /** `cancel()` or `discard()` (the screen's cancel, closing the result, leaving the screen, a Build List change). */
  | 'cancelled'
  /** A later press replaced it. */
  | 'superseded'
  /** The session was disposed. */
  | 'disposed'

/** One ordinary Planner run on the Production Planner Worker (`createPlan()`), started by a press. */
export type OrdinaryPlannerRunState =
  | { status: 'running'; requestId: string }
  /** The Planner's result as it returned it (an `incomplete` search and `plan === null` included): saving it is not this session's. */
  | { status: 'completed'; requestId: string; result: PlannerResult }
  /** The Worker failed or refused; `requestId` is null when no request could be made. Never turned into another method's start. */
  | { status: 'failed'; requestId: string | null; message: string }
  | { status: 'cancelled'; requestId: string; reason: PlanCreationCancelReason }

/** The state of one operation's latest press; `runId` names the press it belongs to (a later press never takes over its state). */
type PlanCreationOperationState =
  | { status: 'idle' }
  | { status: 'preparing'; runId: number }
  | { status: 'not_started'; runId: number; reason: PlanCreationNotStartedReason }
  /** Cancelled while it was reading and judging (before any calculation started). */
  | { status: 'cancelled'; runId: number; reason: PlanCreationCancelReason }
  | { status: 'ordinary_planner'; runId: number; run: OrdinaryPlannerRunState }
  | { status: 'disposed' }

/** The ordinary Planner auxiliary operation: it never starts the optimization. */
export type OrdinaryPlannerAuxiliaryState = PlanCreationOperationState

/** 「生産計画を作成」: the ordinary Planner, or the Build List optimization session's own state (Issue #260 PR-4). */
export type PrimaryPlanCreationState =
  | PlanCreationOperationState
  | { status: 'build_list_optimization'; runId: number; optimization: BuildListOptimizationSessionState }

export interface PlanCreationSessionState {
  /** The latest 「生産計画を作成」 press. An auxiliary press never changes it. */
  readonly primary: PrimaryPlanCreationState
  /** The latest auxiliary press since the latest primary press (a primary press resets it to `idle`). */
  readonly auxiliary: OrdinaryPlannerAuxiliaryState
}

/**
 * Whether the state offers the ordinary Planner auxiliary operation (`docs/PLANNER_SPEC.md` 17.2): a primary press that the
 * optimization's pre-start judgement refused for reasons the ordinary Planner can run despite, or a primary press whose optimization
 * calculation returned `not_found`, `search_bound_reached` or such an `unsupported`. Never `optimized`, a cancellation, a failure, a
 * running Plan, an invalid input, no valid Entry or an adoption refusal. An auxiliary run keeps the offer, so it can be run again.
 */
export function isOrdinaryPlannerAuxiliaryOffered(state: PlanCreationSessionState): boolean {
  const primary = state.primary
  if (primary.status === 'not_started') return primary.reason.kind === 'build_list_optimization_unsupported' && primary.reason.ordinaryPlannerAuxiliary
  if (primary.status !== 'build_list_optimization') return false
  const optimization = primary.optimization
  return optimization.status === 'completed' && optimization.completion.decidedBy === 'calculation'
    && isOrdinaryPlannerAuxiliaryOfferedForResult(optimization.completion.result)
}

export interface PlanCreationRequest {
  /**
   * The screen's 「最大計画ステップ数」 as a `PlannerOptions`, or null while the screen holds an invalid value (U7). Only an ordinary
   * Planner run reads it; the method judgement and the optimization never do.
   */
  plannerOptions: PlannerOptions | null
}

export interface PlanCreationSession {
  getState(): PlanCreationSessionState
  /** Notified on every state change; returns the unsubscribe function. */
  subscribe(listener: (state: PlanCreationSessionState) => void): () => void
  /**
   * The judgement over the current persisted state for the display before a press (`docs/UI_FLOW.md` 10.4). Read-only, it changes
   * no state and is never the start authority: every press reads and judges again.
   */
  inspect(): Promise<PlanCreationPreparation>
  /**
   * 「生産計画を作成」: cancels whatever is preparing or running, drops the previous result (the optimization's and the auxiliary
   * operation's included), reads and judges afresh, and starts the method the judgement chose on the input it judged. Resolves with
   * the state once this press settled, or with the state of the press that superseded it.
   */
  start(request: PlanCreationRequest): Promise<PlanCreationSessionState>
  /**
   * The ordinary Planner auxiliary operation. Only while `isOrdinaryPlannerAuxiliaryOffered()` holds for the session state: otherwise
   * it resolves with the state as it is, having cancelled, read, created and changed nothing (a running calculation and every result
   * stay). Offered, it cancels a previous auxiliary run still going, reads and judges afresh, and runs the ordinary Planner when it can
   * run on the current state (one or more valid Entries, whatever the method the count would choose). The primary operation's result -
   * the offer's basis - stays, so the operation can be pressed again.
   */
  startOrdinaryPlanner(request: PlanCreationRequest): Promise<PlanCreationSessionState>
  /** Cancels what is preparing or running (synchronously; a Worker run is cancelled at once). Results stay. */
  cancel(): void
  /** Cancels what is running and drops every result back to `idle`. */
  discard(): void
  /** Cancels and releases everything; later presses start nothing. */
  dispose(): void
}

export interface PlanCreationSessionDependencies {
  preparer: PlanCreationPreparer
  /** The Build List optimization session the primary operation hands its start to; this session owns and disposes it. */
  optimization: BuildListOptimizationSession
  /** The Production Planner Worker Client of the ordinary Planner runs: created on the first run, disposed with this session. */
  createPlannerClient(): PlannerWorkerClient
  createRequestId(): string
}

type PlanCreationDecision =
  | { kind: 'not_started'; reason: PlanCreationNotStartedReason }
  | { kind: 'build_list_optimization'; preparation: Extract<BuildListOptimizationStartPreparation, { status: 'ready' }> }
  | { kind: 'ordinary_planner'; input: PlannerInput }

/** What a press starts over its preparation. The optimization is the primary operation's only; the options are the ordinary Planner's only. */
function decide(operation: PlanCreationOperation, preparation: PlanCreationPreparation, request: PlanCreationRequest): PlanCreationDecision {
  if (preparation.kind !== 'judged') return { kind: 'not_started', reason: preparation }
  const { selection, plannerInput, startSnapshot } = preparation
  switch (selection.kind) {
    case 'invalid_planner_input':
    case 'no_valid_build_list_entry':
      return { kind: 'not_started', reason: selection }
    case 'build_list_optimization':
      if (operation === 'primary') return { kind: 'build_list_optimization', preparation: { status: 'ready', plannerInput, startSnapshot } }
      break
    case 'build_list_optimization_unsupported':
      if (operation === 'primary') return { kind: 'not_started', reason: selection }
      break
    case 'ordinary_planner':
      break
  }
  // The ordinary Planner (the primary operation with one valid Entry, or the auxiliary operation): the user's valid setting only.
  const options = request.plannerOptions
  if (options === null || !validatePlannerOptions(options).isValid) return { kind: 'not_started', reason: { kind: 'planner_options_invalid' } }
  return { kind: 'ordinary_planner', input: { ...plannerInput, options: { maxPlanSteps: options.maxPlanSteps } } }
}

export function createPlanCreationSession(dependencies: PlanCreationSessionDependencies): PlanCreationSession {
  const { optimization } = dependencies
  let state: PlanCreationSessionState = { primary: { status: 'idle' }, auxiliary: { status: 'idle' } }
  let disposed = false
  let latestRunId = 0
  let plannerClient: PlannerWorkerClient | null = null
  const listeners = new Set<(state: PlanCreationSessionState) => void>()

  const publish = (next: PlanCreationSessionState) => {
    state = next
    for (const listener of [...listeners]) listener(next)
  }
  const slotOf = (operation: PlanCreationOperation): PrimaryPlanCreationState => (operation === 'primary' ? state.primary : state.auxiliary)
  const setSlot = (operation: PlanCreationOperation, next: PlanCreationOperationState) =>
    publish(operation === 'primary' ? { ...state, primary: next } : { ...state, auxiliary: next })
  /** True while `runId` is still the press the operation follows (no later press, no cancel, no dispose). */
  const isFollowing = (operation: PlanCreationOperation, runId: number) => {
    if (disposed || runId !== latestRunId) return false
    const slot = slotOf(operation)
    if (!('runId' in slot) || slot.runId !== runId) return false
    return slot.status === 'preparing' || slot.status === 'build_list_optimization' || (slot.status === 'ordinary_planner' && slot.run.status === 'running')
  }

  // The primary operation shows the optimization session's own state while it holds an optimization start.
  const unsubscribeOptimization = optimization.subscribe((optimizationState) => {
    if (state.primary.status === 'build_list_optimization') publish({ ...state, primary: { ...state.primary, optimization: optimizationState } })
  })

  /** Ends whatever is preparing or running, in either operation, as cancelled. Results stay. */
  const cancelActive = (reason: PlanCreationCancelReason) => {
    for (const operation of ['primary', 'ordinary_planner_auxiliary'] as const) {
      const slot = slotOf(operation)
      if (slot.status === 'preparing') {
        setSlot(operation, { status: 'cancelled', runId: slot.runId, reason })
      } else if (slot.status === 'ordinary_planner' && slot.run.status === 'running') {
        const { requestId } = slot.run
        setSlot(operation, { status: 'ordinary_planner', runId: slot.runId, run: { status: 'cancelled', requestId, reason } })
        plannerClient?.cancelPlan(requestId)
      }
    }
    const optimizationStatus = optimization.getState().status
    if (optimizationStatus === 'preparing' || optimizationStatus === 'running') optimization.cancel()
  }

  const runOrdinaryPlanner = async (operation: PlanCreationOperation, runId: number, input: PlannerInput): Promise<PlanCreationSessionState> => {
    let client: PlannerWorkerClient
    try {
      plannerClient ??= dependencies.createPlannerClient()
      client = plannerClient
    } catch (error: unknown) {
      plannerClient = null
      setSlot(operation, { status: 'ordinary_planner', runId, run: { status: 'failed', requestId: null, message: error instanceof Error ? error.message : String(error) } })
      return state
    }
    const requestId = dependencies.createRequestId()
    setSlot(operation, { status: 'ordinary_planner', runId, run: { status: 'running', requestId } })
    let result: PlannerResult
    try {
      result = await client.createPlan(requestId, input)
    } catch (error: unknown) {
      if (!isFollowing(operation, runId)) return state
      setSlot(operation, {
        status: 'ordinary_planner',
        runId,
        run: error instanceof PlannerCancelledError
          ? { status: 'cancelled', requestId, reason: 'cancelled' }
          : { status: 'failed', requestId, message: error instanceof Error ? error.message : String(error) },
      })
      return state
    }
    if (!isFollowing(operation, runId)) return state
    setSlot(operation, { status: 'ordinary_planner', runId, run: { status: 'completed', requestId, result } })
    return state
  }

  const begin = async (operation: PlanCreationOperation, request: PlanCreationRequest): Promise<PlanCreationSessionState> => {
    if (disposed) return state
    cancelActive('superseded')
    latestRunId += 1
    const runId = latestRunId
    if (operation === 'primary') {
      // A new creation: the previous result, the optimization's and the auxiliary operation offered beside it included, is dropped.
      publish({ primary: { status: 'preparing', runId }, auxiliary: { status: 'idle' } })
      optimization.discard()
    } else {
      setSlot(operation, { status: 'preparing', runId })
    }
    const preparation = await dependencies.preparer.prepare()
    if (!isFollowing(operation, runId)) return state
    const decision = decide(operation, preparation, request)
    switch (decision.kind) {
      case 'not_started':
        setSlot(operation, { status: 'not_started', runId, reason: decision.reason })
        return state
      case 'ordinary_planner':
        return runOrdinaryPlanner(operation, runId, decision.input)
      case 'build_list_optimization':
        publish({ ...state, primary: { status: 'build_list_optimization', runId, optimization: optimization.getState() } })
        await optimization.startPrepared(decision.preparation)
        return state
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    inspect: () => dependencies.preparer.prepare(),
    start: (request) => begin('primary', request),
    startOrdinaryPlanner: (request) => {
      // 17.2: the auxiliary operation exists only beside the reason or result that offers it. Checked before any side effect - no
      // cancel, no press (runId), no state change, no read, no Worker - so a press outside the offer leaves everything as it is. Being
      // offered and the fresh input being runnable are separate judgements: begin() still reads and judges afresh.
      if (!isOrdinaryPlannerAuxiliaryOffered(state)) return Promise.resolve(state)
      return begin('ordinary_planner_auxiliary', request)
    },
    cancel: () => {
      if (!disposed) cancelActive('cancelled')
    },
    discard: () => {
      if (disposed) return
      cancelActive('cancelled')
      optimization.discard()
      publish({ primary: { status: 'idle' }, auxiliary: { status: 'idle' } })
    },
    dispose: () => {
      if (disposed) return
      cancelActive('disposed')
      disposed = true
      unsubscribeOptimization()
      optimization.dispose()
      plannerClient?.dispose()
      plannerClient = null
      publish({ primary: { status: 'disposed' }, auxiliary: { status: 'disposed' } })
      listeners.clear()
    },
  }
}

/**
 * The Production session over the loaded Master Data: one start reader over `database` for the judgement and the optimization, the
 * main thread's Production Engine for the judgement's support queries, the Production Planner Worker for the ordinary Planner and the
 * dedicated Build List optimization Worker (with its Production search bounds) for the optimization.
 */
export function createProductionPlanCreationSession(master: MasterDataRoot, database: AppDatabase = appDatabase): PlanCreationSession {
  const startReader = createBuildListOptimizationStartReader(database, master, createBuildListCalculationContext(master))
  return createPlanCreationSession({
    preparer: createPlanCreationPreparer({ startReader, plannerDependencies: createProductionPlannerDependencies(productionRngEngine) }),
    optimization: createBuildListOptimizationSession({ startReader, createClient: createProductionBuildListOptimizationWorkerClient }),
    createPlannerClient: createProductionPlannerWorkerClient,
    createRequestId: () => globalThis.crypto?.randomUUID?.() ?? `planner-${Date.now()}`,
  })
}
