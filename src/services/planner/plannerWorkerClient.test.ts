import { describe, expect, it, vi } from 'vitest'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import type {
  PlannerExecutionOptions,
  PlannerOrchestrationBounds,
  PlannerOrchestrationResult,
  PlannerResult,
} from '../../domain/planner'
import { UnavailableRngEngine } from '../../domain/rng/unavailableRngEngine'
import {
  createPlannerWorkerController,
  type PlannerWorkerCalculations,
  type PlannerWorkerController,
} from '../../workers/planner.worker'
import type {
  PlannerWorkerProtocolRequest,
  PlannerWorkerProtocolResponse,
} from '../../workers/plannerWorkerContracts'
import { createValidBuildListEntry, createValidProductionPlan } from '../../test/fixtures/domainData'
import { createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import {
  createPlannerWorkerClient,
  createProductionPlannerWorkerClient,
  ProductionPlannerWorkerUnavailableError,
  PlannerCancelledError,
  PlannerWorkerProtocolError,
  type PlannerWorkerLike,
} from './plannerWorkerClient'
import { defaultPlannerOptions, type PlannerInput } from '../../domain/planner'

class FakeWorker implements PlannerWorkerLike {
  readonly posted: PlannerWorkerProtocolRequest[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: PlannerWorkerProtocolResponse }) => void) | null = null
  postMessage(message: PlannerWorkerProtocolRequest) { this.posted.push(message) }
  addEventListener(_type: 'message', listener: (event: { data: PlannerWorkerProtocolResponse }) => void) { this.listener = listener }
  removeEventListener(_type: 'message', listener: (event: { data: PlannerWorkerProtocolResponse }) => void) { if (this.listener === listener) this.listener = null }
  emit(data: PlannerWorkerProtocolResponse) { this.listener?.({ data }) }
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

/** Caller-required, exactly as PLANNER_SPEC 9.2.16 keeps them until B8-E. */
const orchestrationBounds: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 5,
  maxGeneratedBuildListEntries: 2,
  maxPlannerReruns: 9,
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
      // Same explicit unavailable error, never a main-thread fallback.
      await expect(client.createConstrainedPlan(
        'planner.unavailable.constrained',
        plannerInput(),
        orchestrationBounds,
      )).rejects.toBeInstanceOf(ProductionPlannerWorkerUnavailableError)
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
      generation: 1,
      input,
    })
    worker.emit({
      type: 'progress',
      requestId: 'planner.request',
      generation: 1,
      progress: { expandedStates: 2, maxExpandedStates: 10 },
    })
    const result = { plan: createValidProductionPlan(), conflicts: [], warnings: [] }
    worker.emit({
      type: 'create_plan_result',
      requestId: 'planner.request',
      generation: 1,
      result,
    })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledWith({ expandedStates: 2, maxExpandedStates: 10 })
  })

  it('cancels locally, sends cancel, and ignores late or stale responses', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const promise = client.createPlan('planner.request', plannerInput())
    worker.emit({
      type: 'error',
      requestId: 'stale',
      generation: 1,
      message: 'old error',
    })
    client.cancelPlan('planner.request')
    await expect(promise).rejects.toBeInstanceOf(PlannerCancelledError)
    // The cancel names the task instance being waited on, never just the id.
    expect(worker.posted.at(-1)).toEqual({
      type: 'cancel',
      requestId: 'planner.request',
      generation: 1,
    })
    worker.emit({
      type: 'create_plan_result',
      requestId: 'planner.request',
      generation: 1,
      result: { plan: null, conflicts: [], warnings: [] },
    })
  })

  it('converts the Worker error response to a fatal client rejection', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const promise = client.createPlan('planner.request', plannerInput())
    worker.emit({
      type: 'error',
      requestId: 'planner.request',
      generation: 1,
      message: 'prediction failed',
    })
    await expect(promise).rejects.toThrow('prediction failed')
  })
})

describe('PlannerWorkerClient constrained plan (B8-D1)', () => {
  it('posts the constrained request with the exact caller orchestration bounds', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const input = plannerInput()
    const progress = vi.fn()
    const promise = client.createConstrainedPlan(
      'planner.constrained',
      input,
      orchestrationBounds,
      { onProgress: progress },
    )
    expect(worker.posted[0]).toEqual({
      type: 'create_constrained_plan',
      requestId: 'planner.constrained',
      generation: 1,
      input: { plannerInput: input, orchestrationBounds },
    })
    const posted = worker.posted[0]
    expect(posted.type === 'create_constrained_plan' && posted.input.orchestrationBounds)
      .toBe(orchestrationBounds)
    // Search enumeration bounds never cross this boundary.
    expect(posted).not.toHaveProperty('input.enumerationBounds')
    // The Beam progress response is shared with the ordinary request kind.
    worker.emit({
      type: 'progress',
      requestId: 'planner.constrained',
      generation: 1,
      progress: { expandedStates: 6, maxExpandedStates: 40 },
    })
    const result = {
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
      generatedBuildListEntries: [createValidBuildListEntry()],
    }
    worker.emit({
      type: 'create_constrained_plan_result',
      requestId: 'planner.constrained',
      generation: 1,
      result,
    })
    await expect(promise).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledWith({ expandedStates: 6, maxExpandedStates: 40 })
  })

  it('cancels a constrained request through the same cancelPlan path', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const promise = client.createConstrainedPlan(
      'planner.constrained.cancel',
      plannerInput(),
      orchestrationBounds,
    )
    client.cancelPlan('planner.constrained.cancel')
    await expect(promise).rejects.toBeInstanceOf(PlannerCancelledError)
    expect(worker.posted.at(-1)).toEqual({
      type: 'cancel',
      requestId: 'planner.constrained.cancel',
      generation: 1,
    })
  })

  it('rejects a constrained request through the shared Worker error response', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const promise = client.createConstrainedPlan(
      'planner.constrained.error',
      plannerInput(),
      orchestrationBounds,
    )
    worker.emit({
      type: 'error',
      requestId: 'planner.constrained.error',
      generation: 1,
      message: 'constrained enumeration failed',
    })
    await expect(promise).rejects.toThrow('constrained enumeration failed')
  })

  it('rejects both pending requests on dispose and refuses later calls', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const ordinary = client.createPlan('planner.dispose.ordinary', plannerInput())
    const constrained = client.createConstrainedPlan(
      'planner.dispose.constrained',
      plannerInput(),
      orchestrationBounds,
    )
    client.dispose()
    await expect(ordinary).rejects.toBeInstanceOf(PlannerCancelledError)
    await expect(constrained).rejects.toBeInstanceOf(PlannerCancelledError)
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(client.createConstrainedPlan(
      'planner.dispose.after',
      plannerInput(),
      orchestrationBounds,
    )).rejects.toThrow('Planner Worker Client is disposed.')
  })

  it('keeps the existing duplicate requestId semantics across both request kinds', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const first = client.createPlan('planner.shared.id', plannerInput())
    const second = client.createConstrainedPlan(
      'planner.shared.id',
      plannerInput(),
      orchestrationBounds,
    )
    await expect(first).rejects.toBeInstanceOf(PlannerCancelledError)
    // One logical id, two task instances.
    expect(worker.posted.map(({ requestId, generation }) => ({ requestId, generation })))
      .toEqual([
        { requestId: 'planner.shared.id', generation: 1 },
        { requestId: 'planner.shared.id', generation: 2 },
      ])
    const result = {
      plan: null,
      conflicts: [],
      warnings: [],
      generatedBuildListEntries: [],
    }
    worker.emit({
      type: 'create_constrained_plan_result',
      requestId: 'planner.shared.id',
      generation: 2,
      result,
    })
    await expect(second).resolves.toEqual(result)
  })

  it('fails closed when a result discriminant does not match the pending request kind', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const constrained = client.createConstrainedPlan(
      'planner.mismatch.constrained',
      plannerInput(),
      orchestrationBounds,
    )
    // Same id and same generation, so this really is a current-instance
    // protocol violation: an ordinary result carries no
    // `generatedBuildListEntries`, and resolving it would lose them.
    worker.emit({
      type: 'create_plan_result',
      requestId: 'planner.mismatch.constrained',
      generation: 1,
      result: { plan: createValidProductionPlan(), conflicts: [], warnings: [] },
    })
    await expect(constrained).rejects.toBeInstanceOf(PlannerWorkerProtocolError)

    const ordinary = client.createPlan('planner.mismatch.ordinary', plannerInput())
    worker.emit({
      type: 'create_constrained_plan_result',
      requestId: 'planner.mismatch.ordinary',
      generation: 2,
      result: {
        plan: createValidProductionPlan(),
        conflicts: [],
        warnings: [],
        generatedBuildListEntries: [createValidBuildListEntry()],
      },
    })
    await expect(ordinary).rejects.toBeInstanceOf(PlannerWorkerProtocolError)
  })

  it('ignores a wrong-discriminant response minted for a superseded generation', async () => {
    const worker = new FakeWorker()
    const client = createPlannerWorkerClient(worker, 'fixture')
    const ordinary = client.createPlan('planner.stale.discriminant', plannerInput())
    const constrained = client.createConstrainedPlan(
      'planner.stale.discriminant',
      plannerInput(),
      orchestrationBounds,
    )
    await expect(ordinary).rejects.toBeInstanceOf(PlannerCancelledError)

    // Generation 1's ordinary result. Same id, wrong discriminant for the live
    // pending request - but a stale instance, so it is ignored, not fatal.
    worker.emit({
      type: 'create_plan_result',
      requestId: 'planner.stale.discriminant',
      generation: 1,
      result: { plan: createValidProductionPlan(), conflicts: [], warnings: [] },
    })
    const result = {
      plan: null,
      conflicts: [],
      warnings: [],
      generatedBuildListEntries: [],
    }
    worker.emit({
      type: 'create_constrained_plan_result',
      requestId: 'planner.stale.discriminant',
      generation: 2,
      result,
    })
    await expect(constrained).resolves.toEqual(result)
  })
})

/**
 * The duplicate-requestId contract spans both sides and both threads.
 *
 * `postMessage()` is asynchronous, so a Client that has already replaced its
 * pending Promise may still receive the superseded task's response *before* the
 * replacement task has been delivered to the Worker at all - a window the
 * Worker-local ownership guard cannot close on its own. This fake Worker
 * therefore delivers in both directions only when a test says so.
 */
class DeliveryControlledWorker implements PlannerWorkerLike {
  readonly toWorker: PlannerWorkerProtocolRequest[] = []
  readonly toClient: PlannerWorkerProtocolResponse[] = []
  readonly terminate = vi.fn()
  private listener: ((event: { data: PlannerWorkerProtocolResponse }) => void) | null = null
  private controller: PlannerWorkerController | null = null

  attach(controller: PlannerWorkerController) {
    this.controller = controller
  }
  postMessage(message: PlannerWorkerProtocolRequest) {
    this.toWorker.push(message)
  }
  addEventListener(
    _type: 'message',
    listener: (event: { data: PlannerWorkerProtocolResponse }) => void,
  ) {
    this.listener = listener
  }
  removeEventListener(
    _type: 'message',
    listener: (event: { data: PlannerWorkerProtocolResponse }) => void,
  ) {
    if (this.listener === listener) this.listener = null
  }
  /** Called by the controller; queued rather than delivered. */
  receive(response: PlannerWorkerProtocolResponse) {
    this.toClient.push(response)
  }
  /** Delivers one queued request to the Worker; the returned Promise settles with it. */
  deliverToWorker(index = 0): Promise<void> {
    const [message] = this.toWorker.splice(index, 1)
    if (message === undefined || this.controller === null) return Promise.resolve()
    return this.controller.handleMessage(message)
  }
  /** Delivers one queued response back to the main thread. */
  deliverToClient(index = 0) {
    const [response] = this.toClient.splice(index, 1)
    if (response !== undefined) this.listener?.({ data: response })
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

function integration() {
  const worker = new DeliveryControlledWorker()
  const ordinaryCalls: PlannerExecutionOptions[] = []
  const constrainedCalls: PlannerExecutionOptions[] = []
  const ordinaryResults: Deferred<PlannerResult>[] = []
  const constrainedResults: Deferred<PlannerOrchestrationResult>[] = []
  const calculations: PlannerWorkerCalculations = {
    createPlan: async (_input, _dependencies, executionOptions) => {
      ordinaryCalls.push(executionOptions ?? {})
      const pending = deferred<PlannerResult>()
      ordinaryResults.push(pending)
      return pending.promise
    },
    createConstrainedPlan: async (
      _input,
      _bounds,
      _dependencies,
      executionOptions,
    ) => {
      constrainedCalls.push(executionOptions ?? {})
      const pending = deferred<PlannerOrchestrationResult>()
      constrainedResults.push(pending)
      return pending.promise
    },
  }
  const dependencies = {
    rngEngine: new UnavailableRngEngine(),
    idFactory: {
      productionPlanId: () => 'plan.integration' as never,
      planStepId: () => 'step.integration' as never,
      ownedWeaponId: () => 'owned.integration' as never,
    },
    clock: { now: () => '2026-09-01T00:00:00.000Z' as never },
  }
  const controller = createPlannerWorkerController(
    dependencies,
    calculations,
    (response) => worker.receive(response),
  )
  worker.attach(controller)
  const client = createPlannerWorkerClient(worker, 'fixture')
  return {
    worker,
    client,
    controller,
    ordinaryCalls,
    constrainedCalls,
    ordinaryResults,
    constrainedResults,
  }
}

/** Lets every already-resolved microtask continuation run. */
async function settleMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const ordinaryResult: PlannerResult = { plan: null, conflicts: [], warnings: [] }
const constrainedResult: PlannerOrchestrationResult = {
  plan: null,
  conflicts: [],
  warnings: [],
  generatedBuildListEntries: [],
}

describe('Planner Worker / Client task generation across an asynchronous boundary (B8-D1)', () => {
  it('ignores a superseded ordinary result that arrives before the replacement task is delivered', async () => {
    const session = integration()
    // 1. The ordinary task reaches the Worker and starts.
    const ordinary = session.client.createPlan('planner.race', plannerInput())
    const ordinaryRun = session.worker.deliverToWorker()
    expect(session.ordinaryCalls).toHaveLength(1)

    // 2. The Client replaces its pending Promise, but the constrained task is
    //    still in flight to the Worker.
    const constrained = session.client.createConstrainedPlan(
      'planner.race',
      plannerInput(),
      orchestrationBounds,
    )
    await expect(ordinary).rejects.toBeInstanceOf(PlannerCancelledError)
    expect(session.worker.toWorker).toHaveLength(1)
    expect(session.constrainedCalls).toHaveLength(0)

    // 3. The superseded ordinary calculation finishes first. The Worker still
    //    holds generation 1 as current, so it does post the result.
    session.ordinaryResults[0].resolve({
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
    })
    await ordinaryRun
    expect(session.worker.toClient).toEqual([
      expect.objectContaining({
        type: 'create_plan_result',
        requestId: 'planner.race',
        generation: 1,
      }),
    ])

    // 4. It reaches the Client, whose live pending request is the constrained
    //    one. The generation mismatch makes it stale, not a protocol violation.
    let settled = false
    void constrained.then(() => { settled = true }, () => { settled = true })
    session.worker.deliverToClient()
    await settleMicrotasks()
    // 5.
    expect(settled).toBe(false)

    // 6-8. The replacement task finally reaches the Worker and completes.
    const constrainedRun = session.worker.deliverToWorker()
    expect(session.constrainedCalls).toHaveLength(1)
    session.constrainedResults[0].resolve(constrainedResult)
    await constrainedRun
    session.worker.deliverToClient()
    await expect(constrained).resolves.toEqual(constrainedResult)
  })

  it('ignores a superseded constrained result and error that arrive before the replacement task is delivered', async () => {
    const session = integration()
    const constrained = session.client.createConstrainedPlan(
      'planner.race.reverse',
      plannerInput(),
      orchestrationBounds,
    )
    const constrainedRun = session.worker.deliverToWorker()
    const ordinary = session.client.createPlan('planner.race.reverse', plannerInput())
    await expect(constrained).rejects.toBeInstanceOf(PlannerCancelledError)

    // The superseded constrained calculation fails while the Worker still
    // holds its generation, so its error response is posted.
    session.constrainedResults[0].reject(new Error('superseded constrained failure'))
    await constrainedRun
    expect(session.worker.toClient).toEqual([
      {
        type: 'error',
        requestId: 'planner.race.reverse',
        generation: 1,
        message: 'superseded constrained failure',
      },
    ])

    let settled = false
    void ordinary.then(() => { settled = true }, () => { settled = true })
    session.worker.deliverToClient()
    await settleMicrotasks()
    // The stale error never fails the live ordinary request.
    expect(settled).toBe(false)

    const ordinaryRun = session.worker.deliverToWorker()
    session.ordinaryResults[0].resolve(ordinaryResult)
    await ordinaryRun
    session.worker.deliverToClient()
    await expect(ordinary).resolves.toEqual(ordinaryResult)
  })

  it('ignores stale progress from a superseded task instance', async () => {
    const session = integration()
    const staleProgress = vi.fn()
    const currentProgress = vi.fn()
    const ordinary = session.client.createPlan('planner.race.progress', plannerInput(), {
      onProgress: staleProgress,
    })
    const ordinaryRun = session.worker.deliverToWorker()
    const constrained = session.client.createConstrainedPlan(
      'planner.race.progress',
      plannerInput(),
      orchestrationBounds,
      { onProgress: currentProgress },
    )
    await expect(ordinary).rejects.toBeInstanceOf(PlannerCancelledError)

    // The Worker has not seen the replacement task yet, so it still forwards
    // the superseded calculation's progress.
    session.ordinaryCalls[0].onProgress?.({ expandedStates: 9, maxExpandedStates: 99 })
    expect(session.worker.toClient).toEqual([
      {
        type: 'progress',
        requestId: 'planner.race.progress',
        generation: 1,
        progress: { expandedStates: 9, maxExpandedStates: 99 },
      },
    ])
    session.worker.deliverToClient()
    expect(staleProgress).not.toHaveBeenCalled()
    expect(currentProgress).not.toHaveBeenCalled()

    session.ordinaryResults[0].resolve(ordinaryResult)
    await ordinaryRun
    session.worker.deliverToClient()

    const constrainedRun = session.worker.deliverToWorker()
    session.constrainedCalls[0].onProgress?.({ expandedStates: 2, maxExpandedStates: 20 })
    session.worker.deliverToClient()
    expect(currentProgress).toHaveBeenCalledExactlyOnceWith({
      expandedStates: 2,
      maxExpandedStates: 20,
    })

    session.constrainedResults[0].resolve(constrainedResult)
    await constrainedRun
    session.worker.deliverToClient()
    await expect(constrained).resolves.toEqual(constrainedResult)
  })

  it('never lets a cancel for a superseded instance stop the replacement task', async () => {
    const session = integration()
    const constrained = session.client.createConstrainedPlan(
      'planner.race.cancel',
      plannerInput(),
      orchestrationBounds,
    )
    const constrainedRun = session.worker.deliverToWorker()

    // Cancel generation 1, then immediately start generation 2. Both messages
    // are queued; the task is delivered first, so the cancel arrives late.
    session.client.cancelPlan('planner.race.cancel')
    await expect(constrained).rejects.toBeInstanceOf(PlannerCancelledError)
    const ordinary = session.client.createPlan('planner.race.cancel', plannerInput())
    expect(session.worker.toWorker.map(({ type, generation }) => ({ type, generation })))
      .toEqual([
        { type: 'cancel', generation: 1 },
        { type: 'create_plan', generation: 2 },
      ])

    const ordinaryRun = session.worker.deliverToWorker(1)
    await session.worker.deliverToWorker(0)
    expect(session.controller.isCancelled('planner.race.cancel')).toBe(false)
    expect(session.ordinaryCalls[0].shouldCancel?.()).toBe(false)
    // The superseded instance is still cancelled.
    expect(session.constrainedCalls[0].shouldCancel?.()).toBe(true)

    session.constrainedResults[0].resolve(constrainedResult)
    await constrainedRun
    session.ordinaryResults[0].resolve(ordinaryResult)
    await ordinaryRun
    session.worker.toClient.forEach(() => session.worker.deliverToClient())
    await expect(ordinary).resolves.toEqual(ordinaryResult)
  })
})
