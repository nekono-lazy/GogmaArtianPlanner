import { describe, expect, it, vi } from 'vitest'
import type {
  CreateProductionPlanCalculation,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
} from '../domain/planner'
import { defaultPlannerOptions } from '../domain/planner'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../test/fixtures/candidateSearch'
import {
  createValidBuildListEntry,
  createValidProductionPlan,
} from '../test/fixtures/domainData'
import {
  attachPlannerWorker,
  type PlannerWorkerCalculations,
} from './planner.worker'
import type {
  PlannerInteractionPreparationResult,
  PlannerWorkerProtocolRequest,
  PlannerWorkerProtocolResponse,
} from './plannerWorkerContracts'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../test/fixtures/plannerTermination'

function fixture(): { input: PlannerInput; dependencies: PlannerDependencies } {
  const search = createCandidateSearchInput()
  return {
    input: {
      rngState: search.rngState,
      normalCounters: search.normalCounters,
      ownedWeapons: search.ownedWeapons,
      targetWeapons: search.targetWeapons,
      buildListEntries: [createValidBuildListEntry()],
      calculationContext: search.calculationContext,
      options: { ...defaultPlannerOptions },
      master: {
        weaponBonusDefinitions: search.master.weaponBonusDefinitions,
        weaponTypes: search.master.weaponTypes,
        elements: search.master.elements,
        bonusTypes: search.master.bonusTypes,
        materialCosts: search.master.materialCosts,
        bonusRanks: search.master.bonusRanks,
        artianBonusTypeMappings: search.master.artianBonusTypeMappings,
      },
      conflictResolutions: [],
    },
    dependencies: {
      rngEngine: createCandidateSearchEngine(search),
      idFactory: {
        productionPlanId: () => 'plan.fixed.worker' as never,
        planStepId: () => 'step.fixed.worker' as never,
        ownedWeaponId: () => 'owned.fixed.worker' as never,
      },
      clock: { now: () => '2026-08-29T13:00:00.000Z' },
    },
  }
}

const interactionResult: PlannerInteractionPreparationResult = {
  status: 'ready',
  validBuildListEntryIds: [createValidBuildListEntry().id],
  excludedBuildListEntries: [],
  currentConflicts: [],
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/** Keeps a calculation in flight so a second task can take its request id. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

function failingOrdinaryCalculation(): CreateProductionPlanCalculation {
  return vi.fn(async () => {
    throw new Error('Ordinary Planner calculation must not run for this request.')
  })
}

function failingPreparationCalculation() {
  return vi.fn((): PlannerInteractionPreparationResult => {
    throw new Error('Interaction preparation must not run for this request.')
  })
}

function attach(
  calculations: PlannerWorkerCalculations,
  dependencies: PlannerDependencies,
  responses: PlannerWorkerProtocolResponse[],
) {
  return attachPlannerWorker(
    {
      postMessage: (response) => responses.push(response),
      addEventListener: () => undefined,
    },
    () => dependencies,
    calculations,
  )
}

describe('Planner Worker contract', () => {
  it('accepts exactly the two current calculation request kinds and cancel (Issue #278 PR-4)', () => {
    type RequestKind = PlannerWorkerProtocolRequest['type']
    type ResponseKind = PlannerWorkerProtocolResponse['type']
    const requestKinds = [
      'create_plan',
      'prepare_interaction',
      'cancel',
    ] as const satisfies readonly RequestKind[]
    const responseKinds = [
      'create_plan_result',
      'prepare_interaction_result',
      'error',
    ] as const satisfies readonly ResponseKind[]
    // Compile-time exhaustiveness: no request or response kind exists beyond these.
    const noOtherRequestKind: [Exclude<RequestKind, (typeof requestKinds)[number]>] extends [never] ? true : false = true
    const noOtherResponseKind: [Exclude<ResponseKind, (typeof responseKinds)[number]>] extends [never] ? true : false = true
    // @ts-expect-error the legacy B8 constrained re-search request kind was removed in Phase 6-B1
    const legacyConstrained: RequestKind = 'create_constrained_plan'
    // @ts-expect-error the legacy B9 what-if request kind was removed in Phase 6-B1
    const legacyWhatIf: RequestKind = 'create_what_if_comparison'
    // @ts-expect-error the Planner Alternative what-if request kind was removed in Issue #278 PR-4
    const alternativeComparison: RequestKind = 'create_planner_alternative_comparison'
    // @ts-expect-error the Planner Alternative actual repair request kind was removed in Issue #278 PR-4
    const alternativeRepair: RequestKind = 'create_planner_alternative_repair'
    // @ts-expect-error the Planner Alternative what-if result was removed in Issue #278 PR-4
    const alternativeComparisonResult: ResponseKind = 'create_planner_alternative_comparison_result'
    // @ts-expect-error the Planner Alternative actual repair result was removed in Issue #278 PR-4
    const alternativeRepairResult: ResponseKind = 'create_planner_alternative_repair_result'
    expect([noOtherRequestKind, noOtherResponseKind]).toEqual([true, true])
    expect(requestKinds).not.toContain(legacyConstrained)
    expect(requestKinds).not.toContain(legacyWhatIf)
    expect(requestKinds).not.toContain(alternativeComparison)
    expect(requestKinds).not.toContain(alternativeRepair)
    expect(responseKinds).not.toContain('create_constrained_plan_result')
    expect(responseKinds).not.toContain('create_what_if_comparison_result')
    expect(responseKinds).not.toContain(alternativeComparisonResult)
    expect(responseKinds).not.toContain(alternativeRepairResult)
  })

  it('structured-clones only PlannerInput and creates dependencies inside the Worker boundary', async () => {
    const { input, dependencies } = fixture()
    const request: PlannerWorkerProtocolRequest = {
      type: 'create_plan',
      requestId: 'planner.fixture.request',
      generation: 1,
      input,
    }
    expect(structuredClone(request)).toEqual(request)
    expect(request).not.toHaveProperty('rngEngine')
    expect(input).not.toHaveProperty('rngEngine')

    const responses: PlannerWorkerProtocolResponse[] = []
    let listener: (event: { data: PlannerWorkerProtocolRequest }) => void = () => {
      throw new Error('Planner Worker listener was not attached.')
    }
    const createDependencies = vi.fn(() => dependencies)
    const calculate: CreateProductionPlanCalculation = vi.fn(async (
      plannerInput,
      runtime,
    ) => {
      const plan = createValidProductionPlan()
      plan.id = runtime.idFactory.productionPlanId()
      plan.steps[0].id = runtime.idFactory.planStepId()
      plan.createdAt = runtime.clock.now()
      plan.updatedAt = runtime.clock.now()
      expect(plannerInput).toBe(input)
      expect(runtime.rngEngine).toBe(dependencies.rngEngine)
      return {
        plan,
        conflicts: [],
        warnings: [],
        termination: completedPlannerTermination(),
      }
    })
    attachPlannerWorker({
      postMessage: (response) => responses.push(response),
      addEventListener: (_type, callback) => { listener = callback },
    }, createDependencies, {
      createPlan: calculate,
      prepareInteraction: failingPreparationCalculation(),
    })

    listener({ data: request })
    await vi.waitFor(() => expect(responses).toHaveLength(1))
    expect(createDependencies).toHaveBeenCalledOnce()
    expect(calculate).toHaveBeenCalledOnce()
    expect(responses[0]).toEqual(expect.objectContaining({
      type: 'create_plan_result',
      requestId: 'planner.fixture.request',
      generation: 1,
      result: expect.objectContaining({
        plan: expect.objectContaining({
          id: 'plan.fixed.worker',
          createdAt: '2026-08-29T13:00:00.000Z',
        }),
      }),
    }))
  })

  it('converts an unexpected Planner failure to the existing Worker error response', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const calculate: CreateProductionPlanCalculation = vi.fn(async () => {
      throw new Error('unexpected prediction failure')
    })
    const controller = attach(
      {
        createPlan: calculate,
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.fixture.error',
      generation: 1,
      input: fixture().input,
    })

    expect(responses).toEqual([{
      type: 'error',
      requestId: 'planner.fixture.error',
      generation: 1,
      message: 'unexpected prediction failure',
    }])
  })
})

describe('Planner Worker task generation and cancellation', () => {
  it('carries the typed termination across the Worker boundary as plain data', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    // A truncated search, with the diagnostic warning it also produces. The
    // Worker must forward both unchanged: it never rebuilds the termination
    // from the warning, and never drops it (PLANNER_SPEC 7.2.1, 14).
    const termination = incompletePlannerTermination(['max_plan_steps'], {
      limits: { maxPlanSteps: 300 },
      expandedStates: 300,
      completedTargetCount: 1,
      totalTargetCount: 2,
    })
    const controller = attach(
      {
        createPlan: async () => ({
          plan: createValidProductionPlan(),
          conflicts: [],
          warnings: [{
            kind: 'max_steps_reached' as const,
            message: 'Planner reached maxPlanSteps (300).',
          }],
          termination,
        }),
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.ordinary.termination',
      generation: 1,
      input,
    })

    const response = responses[0]
    expect(response.type).toBe('create_plan_result')
    expect(structuredClone(response)).toEqual(response)
    expect(
      response.type === 'create_plan_result'
        ? response.result.termination
        : null,
    ).toEqual(termination)
  })

  it('retires a superseded calculation so its stale result and error are never posted', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const first = deferred<PlannerResult>()
    const second = deferred<PlannerResult>()
    const pendingResults = [first.promise, second.promise]
    // Each call keeps its own execution options, so a later task cannot
    // overwrite the retired one's view of `shouldCancel`.
    const capturedOptions: (PlannerExecutionOptions | undefined)[] = []
    const createPlan: CreateProductionPlanCalculation = vi.fn(
      async (_input, _dependencies, executionOptions) => {
        capturedOptions.push(executionOptions)
        return pendingResults[capturedOptions.length - 1]
      },
    )
    const controller = attach(
      {
        createPlan,
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    const running = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.generation',
      generation: 1,
      input,
    })
    expect(capturedOptions[0]?.shouldCancel?.()).toBe(false)

    // A second task takes the id. It clears the cancelled flag, so only the
    // generation can keep the first calculation retired.
    const replacement = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.generation',
      generation: 2,
      input,
    })
    expect(capturedOptions[0]?.shouldCancel?.()).toBe(true)

    // The retired calculation's stale result is dropped.
    first.resolve({
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
    })
    await running
    expect(responses).toEqual([])

    const result = {
      plan: null,
      conflicts: [],
      warnings: [],
      termination: exhaustedPlannerTermination(),
    }
    // The replacement calculation is the one still holding the id.
    expect(createPlan).toHaveBeenCalledTimes(2)
    expect(capturedOptions[1]?.shouldCancel?.()).toBe(false)
    second.resolve(result)
    await replacement
    expect(responses).toEqual([
      {
        type: 'create_plan_result',
        requestId: 'planner.generation',
        generation: 2,
        result,
      },
    ])
  })

  it('keeps a cancelled calculation retired even after a new task clears the cancelled flag', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const cancelled = deferred<PlannerResult>()
    let cancelledOptions: PlannerExecutionOptions | undefined
    const createPlan: CreateProductionPlanCalculation = vi.fn(
      async (_input, _dependencies, executionOptions) => {
        if (cancelledOptions === undefined) {
          cancelledOptions = executionOptions
          return cancelled.promise
        }
        return {
      plan: null,
      conflicts: [],
      warnings: [],
      termination: exhaustedPlannerTermination(),
    }
      },
    )
    const controller = attach(
      {
        createPlan,
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    const running = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.cancel.revive',
      generation: 1,
      input,
    })
    await controller.handleMessage({
      type: 'cancel',
      requestId: 'planner.cancel.revive',
      generation: 1,
    })
    expect(cancelledOptions?.shouldCancel?.()).toBe(true)

    // The replacement takes the id with a fresh, uncancelled generation.
    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.cancel.revive',
      generation: 2,
      input,
    })
    expect(controller.isCancelled('planner.cancel.revive')).toBe(false)
    // The cancelled calculation stays retired all the same.
    expect(cancelledOptions?.shouldCancel?.()).toBe(true)

    cancelled.resolve({
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
    })
    await running
    expect(responses).toEqual([
      {
        type: 'create_plan_result',
        requestId: 'planner.cancel.revive',
        generation: 2,
        result: {
      plan: null,
      conflicts: [],
      warnings: [],
      termination: exhaustedPlannerTermination(),
    },
      },
    ])
  })

  it('drops a retired calculation failure instead of posting an error for the new task', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const first = deferred<PlannerResult>()
    const createPlan: CreateProductionPlanCalculation = vi.fn(async () => first.promise)
    const controller = attach(
      {
        createPlan,
        prepareInteraction: () => interactionResult,
      },
      dependencies,
      responses,
    )

    const running = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.retired.error',
      generation: 1,
      input,
    })
    // The new task is of the other kind and shares the logical request id.
    await controller.handleMessage({
      type: 'prepare_interaction',
      requestId: 'planner.retired.error',
      generation: 2,
      input,
    })
    first.reject(new Error('retired ordinary failure'))
    await running

    expect(responses).toEqual([
      {
        type: 'prepare_interaction_result',
        requestId: 'planner.retired.error',
        generation: 2,
        result: interactionResult,
      },
    ])
  })

  it('ignores a cancel minted for a superseded generation', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const first = deferred<PlannerResult>()
    const second = deferred<PlannerResult>()
    const pendingResults = [first.promise, second.promise]
    const capturedOptions: (PlannerExecutionOptions | undefined)[] = []
    const createPlan: CreateProductionPlanCalculation = vi.fn(
      async (_input, _dependencies, executionOptions) => {
        capturedOptions.push(executionOptions)
        return pendingResults[capturedOptions.length - 1]
      },
    )
    const controller = attach(
      {
        createPlan,
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    const running = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.stale.cancel',
      generation: 1,
      input,
    })
    const replacement = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.stale.cancel',
      generation: 2,
      input,
    })
    // The Client posted this cancel for generation 1 before generation 2 was
    // delivered; it must not reach generation 2.
    await controller.handleMessage({
      type: 'cancel',
      requestId: 'planner.stale.cancel',
      generation: 1,
    })
    expect(controller.isCancelled('planner.stale.cancel')).toBe(false)
    expect(capturedOptions[1]?.shouldCancel?.()).toBe(false)

    const result = {
      plan: null,
      conflicts: [],
      warnings: [],
      termination: exhaustedPlannerTermination(),
    }
    first.resolve({
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
    })
    second.resolve(result)
    await running
    await replacement
    expect(responses).toEqual([
      {
        type: 'create_plan_result',
        requestId: 'planner.stale.cancel',
        generation: 2,
        result,
      },
    ])
  })

  it('drops a task whose generation a newer one already superseded', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const createPlan: CreateProductionPlanCalculation = vi.fn(async () => ({
      plan: null,
      conflicts: [],
      warnings: [],
      termination: exhaustedPlannerTermination(),
    }))
    const controller = attach(
      {
        createPlan,
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.superseded.task',
      generation: 2,
      input,
    })
    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.superseded.task',
      generation: 1,
      input,
    })

    // The older task is never run, so it also posts nothing.
    expect(createPlan).toHaveBeenCalledOnce()
    expect(responses).toEqual([
      {
        type: 'create_plan_result',
        requestId: 'planner.superseded.task',
        generation: 2,
        result: {
      plan: null,
      conflicts: [],
      warnings: [],
      termination: exhaustedPlannerTermination(),
    },
      },
    ])
  })

  it('propagates cancellation into the calculation and posts nothing afterwards', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    let shouldCancel: (() => boolean) | undefined
    let cancelledDuringCalculation: boolean | null = null
    const controller = attach(
      {
        createPlan: async (
          _input,
          _dependencies,
          executionOptions,
        ) => {
          shouldCancel = executionOptions?.shouldCancel
          expect(shouldCancel?.()).toBe(false)
          await controller.handleMessage({
            type: 'cancel',
            requestId: 'planner.ordinary.cancel',
            generation: 1,
          })
          cancelledDuringCalculation = shouldCancel?.() ?? null
          // A cancelled ordinary Planner still returns a safe result.
          return {
            plan: null,
            conflicts: [],
            warnings: [],
            termination: exhaustedPlannerTermination(),
          }
        },
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.ordinary.cancel',
      generation: 1,
      input,
    })

    expect(cancelledDuringCalculation).toBe(true)
    expect(controller.isCancelled('planner.ordinary.cancel')).toBe(true)
    expect(responses).toEqual([])
  })
})

describe('Planner Worker interaction preparation (B10-B1)', () => {
  it.each<PlannerInteractionPreparationResult>([
    interactionResult,
    {
      status: 'invalid',
      issues: [{ path: 'beamWidth', code: 'invalid_integer', message: 'fixture issue' }],
      warnings: [{ kind: 'build_list_entry_stale', message: 'fixture warning' }],
      excludedBuildListEntries: [{
        buildListEntryId: createValidBuildListEntry().id,
        kind: 'build_list_entry_stale',
        reason: 'fixture diagnostic',
      }],
    },
  ])('dispatches only preparation and returns the typed $status result without progress', async (result) => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const calculations = {
      createPlan: failingOrdinaryCalculation(),
      prepareInteraction: vi.fn(() => result),
    }
    const controller = attach(calculations, dependencies, responses)
    const request: PlannerWorkerProtocolRequest = {
      type: 'prepare_interaction',
      requestId: 'planner.interaction',
      generation: 1,
      input,
    }
    expect(structuredClone(request)).toEqual(request)
    expect(Object.keys(request).sort()).toEqual(['generation', 'input', 'requestId', 'type'])
    await controller.handleMessage(request)
    expect(calculations.prepareInteraction).toHaveBeenCalledExactlyOnceWith(input, dependencies)
    expect(calculations.createPlan).not.toHaveBeenCalled()
    expect(responses).toEqual([{
      type: 'prepare_interaction_result',
      requestId: request.requestId,
      generation: 1,
      result,
    }])
    expect(structuredClone(responses)).toEqual(responses)
  })

  it('forwards unexpected preparation errors through the existing error response', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      prepareInteraction: () => { throw new Error('preparation prediction failure') },
    }, dependencies, responses)
    await controller.handleMessage({
      type: 'prepare_interaction', requestId: 'planner.interaction.error', generation: 1, input,
    })
    expect(responses).toEqual([{
      type: 'error', requestId: 'planner.interaction.error', generation: 1,
      message: 'preparation prediction failure',
    }])
  })

  it('supersedes in-flight ordinary work and ignores older preparation tasks and cancels', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const pending = deferred<PlannerResult>()
    let options: PlannerExecutionOptions | undefined
    const prepareInteraction = vi.fn(() => interactionResult)
    const controller = attach({
      createPlan: async (_input, _runtime, executionOptions) => {
        options = executionOptions
        return pending.promise
      },
      prepareInteraction,
    }, dependencies, responses)
    const requestId = 'planner.interaction.shared'
    const oldRun = controller.handleMessage({
      type: 'create_plan', requestId, generation: 1, input,
    })
    await controller.handleMessage({
      type: 'prepare_interaction', requestId, generation: 2, input,
    })
    expect(options?.shouldCancel?.()).toBe(true)
    pending.reject(new Error('retired ordinary failure'))
    await oldRun
    await controller.handleMessage({
      type: 'prepare_interaction', requestId, generation: 1, input,
    })
    await controller.handleMessage({ type: 'cancel', requestId, generation: 1 })
    expect(controller.isCancelled(requestId)).toBe(false)
    await controller.handleMessage({ type: 'cancel', requestId, generation: 2 })
    expect(controller.isCancelled(requestId)).toBe(true)
    expect(prepareInteraction).toHaveBeenCalledOnce()
    expect(responses).toEqual([{
      type: 'prepare_interaction_result', requestId, generation: 2, result: interactionResult,
    }])
  })

  it('retires an older generation of the same logical request id, of another kind or its own', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const ordinary = deferred<PlannerResult>()
    let ordinaryOptions: PlannerExecutionOptions | undefined
    const createPlan: CreateProductionPlanCalculation = vi.fn(async (_input, _runtime, executionOptions) => {
      ordinaryOptions = executionOptions
      return ordinary.promise
    })
    const prepareInteraction = vi.fn(() => interactionResult)
    const controller = attach({ createPlan, prepareInteraction }, dependencies, responses)
    const requestId = 'planner.interaction.generation'
    const oldRun = controller.handleMessage({
      type: 'create_plan', requestId, generation: 1, input,
    })
    await controller.handleMessage({
      type: 'prepare_interaction', requestId, generation: 2, input,
    })
    expect(ordinaryOptions?.shouldCancel?.()).toBe(true)
    // The retired ordinary calculation's result is dropped, not posted.
    ordinary.resolve({ plan: null, conflicts: [], warnings: [], termination: exhaustedPlannerTermination() })
    await oldRun
    // An older generation arriving late is dropped outright, of either kind.
    await controller.handleMessage({
      type: 'create_plan', requestId, generation: 1, input,
    })
    await controller.handleMessage({
      type: 'prepare_interaction', requestId, generation: 1, input,
    })
    expect(createPlan).toHaveBeenCalledOnce()
    expect(prepareInteraction).toHaveBeenCalledOnce()
    expect(responses).toEqual([{
      type: 'prepare_interaction_result', requestId, generation: 2, result: interactionResult,
    }])
  })
})
