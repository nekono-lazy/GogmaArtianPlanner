import type {
  PlannerInput,
  PlannerOrchestrationBounds,
  PlannerOrchestrationResult,
  PlannerProgress,
  PlannerResult,
  PlannerWhatIfCalculationResult,
  PlannerWhatIfRequest,
} from '../../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import type {
  PlannerInteractionPreparationResult,
  PlannerWorkerProtocolRequest,
  PlannerWorkerProtocolResponse,
} from '../../workers/plannerWorkerContracts'

export class PlannerCancelledError extends Error {
  constructor() {
    super('Planner calculation was cancelled.')
    this.name = 'PlannerCancelledError'
  }
}

export class ProductionPlannerWorkerUnavailableError extends Error {
  constructor() {
    super('この環境ではPlanner Workerを利用できないため、生産計画を作成できません。')
    this.name = 'ProductionPlannerWorkerUnavailableError'
  }
}

/**
 * A Worker result whose discriminant does not match the pending request's
 * expected result type, for the pending request's own task generation.
 *
 * The ordinary and constrained requests share one pending id namespace, so a
 * `create_plan_result` must never resolve a `createConstrainedPlan()` Promise
 * and vice versa: `PlannerOrchestrationResult.generatedBuildListEntries` would
 * silently be missing. This fails closed instead.
 *
 * A response carrying a *different* generation is a stale message from a
 * superseded task instance, not a protocol violation, and is ignored silently
 * rather than raising this.
 */
export class PlannerWorkerProtocolError extends Error {
  readonly receivedResultType: string
  readonly expectedResultType: string

  constructor(receivedResultType: string, expectedResultType: string) {
    super(
      `Planner Worker returned '${receivedResultType}' for a request expecting '${expectedResultType}'.`,
    )
    this.name = 'PlannerWorkerProtocolError'
    this.receivedResultType = receivedResultType
    this.expectedResultType = expectedResultType
  }
}

export interface PlannerWorkerClientCallbacks {
  onProgress?: (progress: PlannerProgress) => void
}

export interface PlannerWorkerClient {
  readonly engineVersion: string
  createPlan(
    requestId: string,
    input: PlannerInput,
    callbacks?: PlannerWorkerClientCallbacks,
  ): Promise<PlannerResult>
  /**
   * The B8-D1 Planner-driven constrained re-search entry point.
   *
   * `orchestrationBounds` is caller-required: this client applies no default
   * and no clamping. B8-E2b decided the Production value
   * (`defaultPlannerOrchestrationBounds`, `2 / 1 / 4`), but choosing to pass it
   * belongs to the Application caller, not here.
   * `ConstrainedEnumerationBounds` is not a
   * parameter - the Production Worker adapter passes the B8-B2
   * `defaultConstrainedEnumerationBounds` inside the Worker boundary.
   *
   * It only calculates. Persisting the returned Plan together with
   * `generatedBuildListEntries` in one transaction is B8-D2's Application /
   * Persistence responsibility (PLANNER_SPEC 9.2.15).
   */
  createConstrainedPlan(
    requestId: string,
    input: PlannerInput,
    orchestrationBounds: PlannerOrchestrationBounds,
    callbacks?: PlannerWorkerClientCallbacks,
  ): Promise<PlannerOrchestrationResult>
  /** B9 transient calculation; the complete caller-required request is wired verbatim. */
  createWhatIfComparison(
    requestId: string,
    request: PlannerWhatIfRequest,
    callbacks?: PlannerWorkerClientCallbacks,
  ): Promise<PlannerWhatIfCalculationResult>
  /** B10 current initial availability; calculation only, with no search bounds. */
  prepareInteraction(
    requestId: string,
    input: PlannerInput,
  ): Promise<PlannerInteractionPreparationResult>
  cancelPlan(requestId: string): void
  dispose(): void
}

export interface PlannerWorkerLike {
  postMessage(message: PlannerWorkerProtocolRequest): void
  addEventListener(
    type: 'message',
    listener: (event: { data: PlannerWorkerProtocolResponse }) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: { data: PlannerWorkerProtocolResponse }) => void,
  ): void
  terminate(): void
}

/**
 * One pending request, identified by its task generation and discriminated by
 * the response type it accepts.
 *
 * All request kinds share this Map, so the duplicate-requestId semantics stay
 * exactly as before: re-using an id rejects the previous pending request with
 * `PlannerCancelledError` and replaces it, whichever kind either request is.
 * The generation is what makes that replacement safe across the thread
 * boundary - the superseded task may still be running in the Worker, and its
 * response must not be read as this pending request's.
 */
interface PendingPlanIdentity {
  requestId: string
  generation: number
  reject: (error: Error) => void
  onProgress?: (progress: PlannerProgress) => void
}

type PendingPlan =
  | (PendingPlanIdentity & {
      expectedResultType: 'prepare_interaction_result'
      resolve: (result: PlannerInteractionPreparationResult) => void
    })
  | (PendingPlanIdentity & {
      expectedResultType: 'create_plan_result'
      resolve: (result: PlannerResult) => void
    })
  | (PendingPlanIdentity & {
      expectedResultType: 'create_constrained_plan_result'
      resolve: (result: PlannerOrchestrationResult) => void
    })
  | (PendingPlanIdentity & {
      expectedResultType: 'create_what_if_comparison_result'
      resolve: (result: PlannerWhatIfCalculationResult) => void
    })

export function createPlannerWorkerClient(
  worker: PlannerWorkerLike,
  engineVersion: string,
): PlannerWorkerClient {
  const pending = new Map<string, PendingPlan>()
  /** Monotonic across all request kinds, so a generation is never reused. */
  let lastGeneration = 0
  let disposed = false

  const handleMessage = ({ data }: { data: PlannerWorkerProtocolResponse }) => {
    const current = pending.get(data.requestId)
    if (!current) return
    // A superseded task instance may still finish in the Worker before the
    // replacement task is even delivered there. Its response is stale, so it is
    // dropped here rather than treated as a wrong discriminant.
    if (data.generation !== current.generation) return
    if (data.type === 'progress') {
      current.onProgress?.(data.progress)
      return
    }
    pending.delete(data.requestId)
    if (data.type === 'error') {
      current.reject(new Error(data.message))
      return
    }
    if (
      data.type === 'create_plan_result' &&
      current.expectedResultType === 'create_plan_result'
    ) {
      current.resolve(data.result)
      return
    }
    if (
      data.type === 'create_constrained_plan_result' &&
      current.expectedResultType === 'create_constrained_plan_result'
    ) {
      current.resolve(data.result)
      return
    }
    if (
      data.type === 'create_what_if_comparison_result' &&
      current.expectedResultType === 'create_what_if_comparison_result'
    ) {
      current.resolve(data.result)
      return
    }
    if (
      data.type === 'prepare_interaction_result' &&
      current.expectedResultType === 'prepare_interaction_result'
    ) {
      current.resolve(data.result)
      return
    }
    current.reject(
      new PlannerWorkerProtocolError(data.type, current.expectedResultType),
    )
  }
  worker.addEventListener('message', handleMessage)

  /** Replaces any pending request holding this id and mints its generation. */
  const claimRequestId = (requestId: string): number => {
    const existing = pending.get(requestId)
    existing?.reject(new PlannerCancelledError())
    pending.delete(requestId)
    lastGeneration += 1
    return lastGeneration
  }

  return {
    engineVersion,
    createPlan: (requestId, input, callbacks = {}) => {
      if (disposed) {
        return Promise.reject(new Error('Planner Worker Client is disposed.'))
      }
      const generation = claimRequestId(requestId)
      return new Promise<PlannerResult>((resolve, reject) => {
        pending.set(requestId, {
          requestId,
          generation,
          expectedResultType: 'create_plan_result',
          resolve,
          reject,
          onProgress: callbacks.onProgress,
        })
        worker.postMessage({ type: 'create_plan', requestId, generation, input })
      })
    },
    createConstrainedPlan: (
      requestId,
      input,
      orchestrationBounds,
      callbacks = {},
    ) => {
      if (disposed) {
        return Promise.reject(new Error('Planner Worker Client is disposed.'))
      }
      const generation = claimRequestId(requestId)
      return new Promise<PlannerOrchestrationResult>((resolve, reject) => {
        pending.set(requestId, {
          requestId,
          generation,
          expectedResultType: 'create_constrained_plan_result',
          resolve,
          reject,
          onProgress: callbacks.onProgress,
        })
        worker.postMessage({
          type: 'create_constrained_plan',
          requestId,
          generation,
          input: { plannerInput: input, orchestrationBounds },
        })
      })
    },
    createWhatIfComparison: (requestId, request, callbacks = {}) => {
      if (disposed) {
        return Promise.reject(new Error('Planner Worker Client is disposed.'))
      }
      const generation = claimRequestId(requestId)
      return new Promise<PlannerWhatIfCalculationResult>((resolve, reject) => {
        pending.set(requestId, {
          requestId,
          generation,
          expectedResultType: 'create_what_if_comparison_result',
          resolve,
          reject,
          onProgress: callbacks.onProgress,
        })
        worker.postMessage({
          type: 'create_what_if_comparison',
          requestId,
          generation,
          input: request,
        })
      })
    },
    prepareInteraction: (requestId, input) => {
      if (disposed) {
        return Promise.reject(new Error('Planner Worker Client is disposed.'))
      }
      const generation = claimRequestId(requestId)
      return new Promise<PlannerInteractionPreparationResult>((resolve, reject) => {
        pending.set(requestId, {
          requestId,
          generation,
          expectedResultType: 'prepare_interaction_result',
          resolve,
          reject,
        })
        worker.postMessage({
          type: 'prepare_interaction',
          requestId,
          generation,
          input,
        })
      })
    },
    cancelPlan: (requestId) => {
      const current = pending.get(requestId)
      if (!current) return
      pending.delete(requestId)
      current.reject(new PlannerCancelledError())
      // Names the instance being waited on, so it can never cancel a newer one.
      worker.postMessage({
        type: 'cancel',
        requestId,
        generation: current.generation,
      })
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      pending.forEach(({ reject }) => reject(new PlannerCancelledError()))
      pending.clear()
      worker.removeEventListener('message', handleMessage)
      worker.terminate()
    },
  }
}

export function createUnavailablePlannerWorkerClient(): PlannerWorkerClient {
  return {
    engineVersion: 'production-engine-unavailable',
    createPlan: () => Promise.reject(new ProductionPlannerWorkerUnavailableError()),
    // The same explicit unavailable error, never a main-thread fallback
    // calculation and never a substituted orchestration bound.
    createConstrainedPlan: () =>
      Promise.reject(new ProductionPlannerWorkerUnavailableError()),
    createWhatIfComparison: () =>
      Promise.reject(new ProductionPlannerWorkerUnavailableError()),
    prepareInteraction: () =>
      Promise.reject(new ProductionPlannerWorkerUnavailableError()),
    cancelPlan: () => undefined,
    dispose: () => undefined,
  }
}

export function createProductionPlannerWorkerClient(): PlannerWorkerClient {
  if (typeof Worker === 'undefined') return createUnavailablePlannerWorkerClient()
  const worker = new Worker(
    new URL('../../workers/planner.worker.entry.ts', import.meta.url),
    { type: 'module' },
  )
  return createPlannerWorkerClient(
    worker as unknown as PlannerWorkerLike,
    PRODUCTION_RNG_ENGINE_VERSION,
  )
}
