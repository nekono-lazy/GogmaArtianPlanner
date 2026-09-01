import { describe, expect, it, vi } from 'vitest'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import type {
  PlannerWorkerRequest,
  PlannerWorkerResponse,
} from '../../domain/planner'
import { createValidProductionPlan } from '../../test/fixtures/domainData'
import { createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import {
  createPlannerWorkerClient,
  createProductionPlannerWorkerClient,
  ProductionPlannerWorkerUnavailableError,
  PlannerCancelledError,
  type PlannerWorkerLike,
} from './plannerWorkerClient'
import { defaultPlannerOptions, type PlannerInput } from '../../domain/planner'

class FakeWorker implements PlannerWorkerLike {
  readonly posted: PlannerWorkerRequest[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: PlannerWorkerResponse }) => void) | null = null
  postMessage(message: PlannerWorkerRequest) { this.posted.push(message) }
  addEventListener(_type: 'message', listener: (event: { data: PlannerWorkerResponse }) => void) { this.listener = listener }
  removeEventListener(_type: 'message', listener: (event: { data: PlannerWorkerResponse }) => void) { if (this.listener === listener) this.listener = null }
  emit(data: PlannerWorkerResponse) { this.listener?.({ data }) }
}

function plannerInput(): PlannerInput {
  const search = createCandidateSearchInput()
  return {
    rngState: search.rngState,
    normalCounters: search.normalCounters,
    ownedWeapons: search.ownedWeapons,
    targetWeapons: search.targetWeapons,
    buildListEntries: [],
    calculationContext: search.calculationContext,
    options: { ...defaultPlannerOptions },
    master: {
      weaponBonusDefinitions: search.master.weaponBonusDefinitions,
      weaponTypes: search.master.weaponTypes,
      elements: search.master.elements,
      bonusTypes: search.master.bonusTypes,
      bonusRanks: search.master.bonusRanks,
      lotteries: search.master.lotteries,
      materialCosts: search.master.materialCosts,
    },
    conflictResolutions: [],
  }
}

describe('PlannerWorkerClient', () => {
  it('uses the Production RNG version for the production Worker client', () => {
    vi.stubGlobal('Worker', FakeWorker)
    try {
      const client = createProductionPlannerWorkerClient()
      expect(client.engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
      client.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses an explicit unavailable client when the browser has no Worker', async () => {
    vi.stubGlobal('Worker', undefined)
    try {
      const client = createProductionPlannerWorkerClient()
      expect(client.engineVersion).toBe('production-engine-unavailable')
      await expect(client.createPlan('planner.unavailable', plannerInput()))
        .rejects.toBeInstanceOf(ProductionPlannerWorkerUnavailableError)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves requestId, forwards progress, and resolves a result', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const input = plannerInput()
    const progress = vi.fn()
    const promise = client.createPlan('planner.request', input, { onProgress: progress })
    expect(worker.posted[0]).toEqual({
      type: 'create_plan',
      requestId: 'planner.request',
      input,
    })
    worker.emit({
      type: 'progress',
      requestId: 'planner.request',
      progress: { expandedStates: 2, maxExpandedStates: 10 },
    })
    const result = { plan: createValidProductionPlan(), conflicts: [], warnings: [] }
    worker.emit({ type: 'create_plan_result', requestId: 'planner.request', result })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledWith({ expandedStates: 2, maxExpandedStates: 10 })
  })

  it('cancels locally, sends cancel, and ignores late or stale responses', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const promise = client.createPlan('planner.request', plannerInput())
    worker.emit({ type: 'error', requestId: 'stale', message: 'old error' })
    client.cancelPlan('planner.request')
    await expect(promise).rejects.toBeInstanceOf(PlannerCancelledError)
    expect(worker.posted.at(-1)).toEqual({ type: 'cancel', requestId: 'planner.request' })
    worker.emit({
      type: 'create_plan_result',
      requestId: 'planner.request',
      result: { plan: null, conflicts: [], warnings: [] },
    })
  })

  it('converts the Worker error response to a fatal client rejection', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const promise = client.createPlan('planner.request', plannerInput())
    worker.emit({ type: 'error', requestId: 'planner.request', message: 'prediction failed' })
    await expect(promise).rejects.toThrow('prediction failed')
  })
})
