import type {
  PlannerInput,
  PlannerProgress,
  PlannerResult,
  PlannerWorkerRequest,
  PlannerWorkerResponse,
} from '../../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'

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
  cancelPlan(requestId: string): void
  dispose(): void
}

export interface PlannerWorkerLike {
  postMessage(message: PlannerWorkerRequest): void
  addEventListener(
    type: 'message',
    listener: (event: { data: PlannerWorkerResponse }) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: { data: PlannerWorkerResponse }) => void,
  ): void
  terminate(): void
}

interface PendingPlan {
  resolve: (result: PlannerResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: PlannerProgress) => void
}

export function createPlannerWorkerClient(
  worker: PlannerWorkerLike,
  engineVersion: string,
): PlannerWorkerClient {
  const pending = new Map<string, PendingPlan>()
  let disposed = false

  const handleMessage = ({ data }: { data: PlannerWorkerResponse }) => {
    const current = pending.get(data.requestId)
    if (!current) return
    if (data.type === 'progress') {
      current.onProgress?.(data.progress)
      return
    }
    pending.delete(data.requestId)
    if (data.type === 'error') {
      current.reject(new Error(data.message))
      return
    }
    current.resolve(data.result)
  }
  worker.addEventListener('message', handleMessage)

  return {
    engineVersion,
    createPlan: (requestId, input, callbacks = {}) => {
      if (disposed) {
        return Promise.reject(new Error('Planner Worker Client is disposed.'))
      }
      const existing = pending.get(requestId)
      existing?.reject(new PlannerCancelledError())
      pending.delete(requestId)
      return new Promise<PlannerResult>((resolve, reject) => {
        pending.set(requestId, {
          resolve,
          reject,
          onProgress: callbacks.onProgress,
        })
        worker.postMessage({ type: 'create_plan', requestId, input })
      })
    },
    cancelPlan: (requestId) => {
      const current = pending.get(requestId)
      if (!current) return
      pending.delete(requestId)
      current.reject(new PlannerCancelledError())
      worker.postMessage({ type: 'cancel', requestId })
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
