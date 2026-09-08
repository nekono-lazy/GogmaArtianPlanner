import type {
  CreateConstrainedProductionPlanCalculation,
  CreateProductionPlanCalculation,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerWhatIfCalculationResult,
  PlannerWhatIfRequest,
} from '../domain/planner'
import type {
  PlannerWorkerProtocolRequest,
  PlannerWorkerProtocolResponse,
} from './plannerWorkerContracts'

export type PlannerWorkerPostMessage = (
  response: PlannerWorkerProtocolResponse,
) => void
export type PlannerDependenciesFactory = () => PlannerDependencies

/**
 * The three Planner calculations this Worker routes to.
 *
 * All three are injected, so the controller performs no Beam Search, no Candidate
 * enumeration, no materialization, no preflight, no Trace Replay, and no
 * adoption of its own: B8-C owns all of that, and the Production adapter
 * composes it.
 */
export interface PlannerWorkerCalculations {
  createPlan: CreateProductionPlanCalculation
  createConstrainedPlan: CreateConstrainedProductionPlanCalculation
  createWhatIfComparison: CreatePlannerWhatIfComparisonCalculation
}

/** Worker-facing B9 calculation shape; Domain runtime options stay off the wire. */
export type CreatePlannerWhatIfComparisonCalculation = (
  request: PlannerWhatIfRequest,
  dependencies: PlannerDependencies,
  executionOptions?: PlannerExecutionOptions,
) => Promise<PlannerWhatIfCalculationResult>

export interface PlannerWorkerController {
  handleMessage(request: PlannerWorkerProtocolRequest): Promise<void>
  isCancelled(requestId: string): boolean
}

function workerYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Message orchestration only. Both calculations are supplied separately and
 * receive the worker-local runtime dependencies rather than structured-cloned
 * methods.
 *
 * `cancel`, progress forwarding, and error conversion are shared by the
 * ordinary, constrained, and what-if request kinds: a cancel stops the task
 * instance it names, and Domain cancellation semantics are never reimplemented
 * here.
 */
export function createPlannerWorkerController(
  dependencies: PlannerDependencies,
  calculations: PlannerWorkerCalculations,
  postMessage: PlannerWorkerPostMessage,
): PlannerWorkerController {
  /**
   * The Client-minted task generation that currently owns each logical request
   * id, and the generations that have been cancelled.
   *
   * The Worker never mints a generation of its own: doing so would lose the
   * correspondence with the Client token, which is what lets the Client discard
   * a stale response it receives before its own newer task has even been
   * delivered here. Ordinary and constrained tasks keep sharing one logical id
   * namespace; only the generation distinguishes task instances.
   *
   * Cancellation is tracked per generation rather than per request id, so a new
   * task instance is never born cancelled and an older instance can never be
   * revived by a newer one.
   */
  const generationByRequestId = new Map<string, number>()
  const cancelledGenerations = new Set<number>()

  const isCurrent = (requestId: string, generation: number): boolean =>
    generationByRequestId.get(requestId) === generation
  /** A retired calculation is silent: it posts no progress, result, or error. */
  const isActive = (requestId: string, generation: number): boolean =>
    isCurrent(requestId, generation) && !cancelledGenerations.has(generation)

  const executionOptions = (
    requestId: string,
    generation: number,
  ): PlannerExecutionOptions => ({
    shouldCancel: () =>
      !isCurrent(requestId, generation) || cancelledGenerations.has(generation),
    yieldControl: workerYield,
    onProgress: (progress) => {
      if (isActive(requestId, generation)) {
        postMessage({ type: 'progress', requestId, generation, progress })
      }
    },
  })
  return {
    isCancelled: (requestId) => {
      const generation = generationByRequestId.get(requestId)
      return generation !== undefined && cancelledGenerations.has(generation)
    },
    handleMessage: async (request) => {
      const { requestId, generation } = request
      if (request.type === 'cancel') {
        // Only the instance the Client is actually waiting on is cancelled: a
        // cancel minted for an older generation never reaches a newer task.
        if (!isCurrent(requestId, generation)) return
        cancelledGenerations.add(generation)
        return
      }
      const owning = generationByRequestId.get(requestId)
      // A task that a newer generation has already superseded is dropped
      // outright rather than run and then silenced.
      if (owning !== undefined && generation <= owning) return
      generationByRequestId.set(requestId, generation)
      try {
        // Every calculation has an explicit branch. In particular, what-if is
        // never treated as the ordinary fallback.
        let response: PlannerWorkerProtocolResponse
        switch (request.type) {
          case 'create_plan':
            response = {
              type: 'create_plan_result',
              requestId,
              generation,
              result: await calculations.createPlan(
                request.input,
                dependencies,
                executionOptions(requestId, generation),
              ),
            }
            break
          case 'create_constrained_plan':
            response = {
              type: 'create_constrained_plan_result',
              requestId,
              generation,
              result: await calculations.createConstrainedPlan(
                request.input.plannerInput,
                request.input.orchestrationBounds,
                dependencies,
                executionOptions(requestId, generation),
              ),
            }
            break
          case 'create_what_if_comparison':
            response = {
              type: 'create_what_if_comparison_result',
              requestId,
              generation,
              result: await calculations.createWhatIfComparison(
                request.input,
                dependencies,
                executionOptions(requestId, generation),
              ),
            }
            break
        }
        if (isActive(requestId, generation)) postMessage(response)
      } catch (error: unknown) {
        // A Domain error keeps its meaning: it is reported as the existing
        // Worker error response and never reclassified from its message text,
        // nor converted into a result.
        if (!isActive(requestId, generation)) return
        postMessage({
          type: 'error',
          requestId,
          generation,
          message: error instanceof Error ? error.message : 'Unknown Planner error.',
        })
      }
    },
  }
}

export interface PlannerWorkerScope {
  postMessage: PlannerWorkerPostMessage
  addEventListener(
    type: 'message',
    listener: (event: { data: PlannerWorkerProtocolRequest }) => void,
  ): void
}

/** Creates Engine/ID/Clock dependencies inside the Worker module boundary. */
export function attachPlannerWorker(
  scope: PlannerWorkerScope,
  createDependencies: PlannerDependenciesFactory,
  calculations: PlannerWorkerCalculations,
): PlannerWorkerController {
  const controller = createPlannerWorkerController(
    createDependencies(),
    calculations,
    (response) => scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    void controller.handleMessage(event.data)
  })
  return controller
}
