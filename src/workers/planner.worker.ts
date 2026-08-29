import type {
  CreateProductionPlanCalculation,
  PlannerDependencies,
  PlannerWorkerRequest,
  PlannerWorkerResponse,
} from '../domain/planner'

export type PlannerWorkerPostMessage = (response: PlannerWorkerResponse) => void
export type PlannerDependenciesFactory = () => PlannerDependencies

export interface PlannerWorkerController {
  handleMessage(request: PlannerWorkerRequest): Promise<void>
  isCancelled(requestId: string): boolean
}

function workerYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Message orchestration only. Beam Search is supplied separately and receives
 * the worker-local runtime dependencies rather than structured-cloned methods.
 */
export function createPlannerWorkerController(
  dependencies: PlannerDependencies,
  createPlan: CreateProductionPlanCalculation,
  postMessage: PlannerWorkerPostMessage,
): PlannerWorkerController {
  const cancelledRequestIds = new Set<string>()
  return {
    isCancelled: (requestId) => cancelledRequestIds.has(requestId),
    handleMessage: async (request) => {
      if (request.type === 'cancel') {
        cancelledRequestIds.add(request.requestId)
        return
      }
      cancelledRequestIds.delete(request.requestId)
      try {
        const result = await createPlan(request.input, dependencies, {
          shouldCancel: () => cancelledRequestIds.has(request.requestId),
          yieldControl: workerYield,
          onProgress: (progress) => {
            if (!cancelledRequestIds.has(request.requestId)) {
              postMessage({ type: 'progress', requestId: request.requestId, progress })
            }
          },
        })
        if (!cancelledRequestIds.has(request.requestId)) {
          postMessage({
            type: 'create_plan_result',
            requestId: request.requestId,
            result,
          })
        }
      } catch (error: unknown) {
        if (cancelledRequestIds.has(request.requestId)) return
        postMessage({
          type: 'error',
          requestId: request.requestId,
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
    listener: (event: { data: PlannerWorkerRequest }) => void,
  ): void
}

/** Creates Engine/ID/Clock dependencies inside the Worker module boundary. */
export function attachPlannerWorker(
  scope: PlannerWorkerScope,
  createDependencies: PlannerDependenciesFactory,
  createPlan: CreateProductionPlanCalculation,
): PlannerWorkerController {
  const controller = createPlannerWorkerController(
    createDependencies(),
    createPlan,
    (response) => scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    void controller.handleMessage(event.data)
  })
  return controller
}

