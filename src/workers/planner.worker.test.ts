import { describe, expect, it, vi } from 'vitest'
import type {
  CreateProductionPlanCalculation,
  PlannerAlternativeRepairCalculationResult,
  PlannerAlternativeRepairInput,
  PlannerAlternativeWhatIfCalculationResult,
  PlannerAlternativeWhatIfInput,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
} from '../domain/planner'
import {
  defaultPlannerOptions,
  PlannerAlternativeCancelledError,
} from '../domain/planner'
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
  type CreatePlannerAlternativeComparisonCalculation,
  type CreatePlannerAlternativeRepairCalculation,
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

function fixturePlannerAlternativeInput(input = fixture().input): PlannerAlternativeWhatIfInput {
  return {
    plannerInput: input,
    scenarioResolution: {
      conflictKey: 'conflict.planner-alternative.fixture',
      selectedBuildListEntryId: input.buildListEntries[0].id,
    },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
  }
}

const fixturePlannerAlternativeResult: PlannerAlternativeWhatIfCalculationResult = {
  status: 'invalid_prior_fixed_entry',
  buildListEntryId: createValidBuildListEntry().id,
  detail: 'fixture result',
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

function failingPlannerAlternativeComparisonCalculation(): CreatePlannerAlternativeComparisonCalculation {
  return vi.fn(async () => {
    throw new Error('Planner Alternative what-if calculation must not run for this request.')
  })
}

function failingPlannerAlternativeRepairCalculation(): CreatePlannerAlternativeRepairCalculation {
  return vi.fn(async () => {
    throw new Error('Planner Alternative repair calculation must not run for this request.')
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
  it('accepts exactly the four current calculation request kinds and cancel (Phase 6-B1)', () => {
    type RequestKind = PlannerWorkerProtocolRequest['type']
    type ResponseKind = PlannerWorkerProtocolResponse['type']
    const requestKinds = [
      'create_plan',
      'create_planner_alternative_comparison',
      'create_planner_alternative_repair',
      'prepare_interaction',
      'cancel',
    ] as const satisfies readonly RequestKind[]
    const responseKinds = [
      'create_plan_result',
      'create_planner_alternative_comparison_result',
      'create_planner_alternative_repair_result',
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
    expect([noOtherRequestKind, noOtherResponseKind]).toEqual([true, true])
    expect(requestKinds).not.toContain(legacyConstrained)
    expect(requestKinds).not.toContain(legacyWhatIf)
    expect(responseKinds).not.toContain('create_constrained_plan_result')
    expect(responseKinds).not.toContain('create_what_if_comparison_result')
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
      createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        prepareInteraction: failingPreparationCalculation(),
        createPlannerAlternativeComparison: async () => fixturePlannerAlternativeResult,
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
    await controller.handleMessage({
      type: 'create_planner_alternative_comparison',
      requestId: 'planner.retired.error',
      generation: 2,
      input: fixturePlannerAlternativeInput(input),
    })
    first.reject(new Error('retired ordinary failure'))
    await running

    expect(responses).toEqual([
      {
        type: 'create_planner_alternative_comparison_result',
        requestId: 'planner.retired.error',
        generation: 2,
        result: fixturePlannerAlternativeResult,
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
        createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
        createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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

const interactionResult: PlannerInteractionPreparationResult = {
  status: 'ready',
  validBuildListEntryIds: [createValidBuildListEntry().id],
  excludedBuildListEntries: [],
  currentConflicts: [],
}

describe('Planner Worker interaction preparation (B10-B1)', () => {
  it.each<PlannerInteractionPreparationResult>([
    interactionResult,
    {
      status: 'invalid',
      issues: [{ path: 'beamWidth', code: 'invalid_integer', message: 'fixture issue' }],
      warnings: [{ kind: 'build_list_entry_stale', message: 'fixture warning' }],
      excludedBuildListEntries: [{
        buildListEntryId: createValidBuildListEntry().id,
        reason: 'fixture diagnostic',
      }],
    },
  ])('dispatches only preparation and returns the typed $status result without progress', async (result) => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const calculations = {
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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
    expect(calculations.createPlannerAlternativeComparison).not.toHaveBeenCalled()
    expect(calculations.createPlannerAlternativeRepair).not.toHaveBeenCalled()
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
      createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
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

  it('supersedes in-flight Planner Alternative work and ignores older preparation tasks and cancels', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const pending = deferred<PlannerAlternativeWhatIfCalculationResult>()
    let options: PlannerExecutionOptions | undefined
    const prepareInteraction = vi.fn(() => interactionResult)
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: async (_input, _runtime, executionOptions) => {
        options = executionOptions
        return pending.promise
      },
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
      prepareInteraction,
    }, dependencies, responses)
    const requestId = 'planner.interaction.shared'
    const oldRun = controller.handleMessage({
      type: 'create_planner_alternative_comparison', requestId, generation: 1,
      input: fixturePlannerAlternativeInput(input),
    })
    await controller.handleMessage({
      type: 'prepare_interaction', requestId, generation: 2, input,
    })
    expect(options?.shouldCancel?.()).toBe(true)
    pending.reject(new Error('retired Planner Alternative failure'))
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
})

describe('Planner Worker Planner Alternative what-if routing (Phase 4-B)', () => {
  it('routes only the new request kind, verbatim, with no extent or bounds on the wire', async () => {
    const { input, dependencies } = fixture()
    const alternativeInput = fixturePlannerAlternativeInput(input)
    const request: PlannerWorkerProtocolRequest = {
      type: 'create_planner_alternative_comparison',
      requestId: 'planner.alternative.routing',
      generation: 1,
      input: alternativeInput,
    }
    expect(structuredClone(request)).toEqual(request)
    expect(Object.keys(request.input).sort()).toEqual([
      'plannerInput',
      'priorExcludedRoutes',
      'priorFixedBuildListEntryIds',
      'scenarioResolution',
    ])
    const responses: PlannerWorkerProtocolResponse[] = []
    const createPlan = failingOrdinaryCalculation()
    const createPlannerAlternativeRepair = failingPlannerAlternativeRepairCalculation()
    const createPlannerAlternativeComparison: CreatePlannerAlternativeComparisonCalculation = vi.fn(
      async (received, runtime, executionOptions) => {
        expect(received).toBe(alternativeInput)
        expect(runtime).toBe(dependencies)
        expect(Object.keys(executionOptions ?? {}).sort()).toEqual(['shouldCancel', 'yieldControl'])
        return fixturePlannerAlternativeResult
      },
    )
    const controller = attach({
      createPlan,
      createPlannerAlternativeComparison,
      createPlannerAlternativeRepair,
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)

    await controller.handleMessage(request)

    expect(createPlan).not.toHaveBeenCalled()
    expect(createPlannerAlternativeRepair).not.toHaveBeenCalled()
    expect(createPlannerAlternativeComparison).toHaveBeenCalledOnce()
    expect(responses).toEqual([{
      type: 'create_planner_alternative_comparison_result',
      requestId: 'planner.alternative.routing',
      generation: 1,
      result: fixturePlannerAlternativeResult,
    }])
    expect(structuredClone(responses[0])).toEqual(responses[0])
  })

  it('reports an unexpected failure through the shared error response', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: async () => { throw new Error('alternative prediction failed') },
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)
    await controller.handleMessage({
      type: 'create_planner_alternative_comparison', requestId: 'planner.alternative.error', generation: 1,
      input: fixturePlannerAlternativeInput(),
    })
    expect(responses).toEqual([{
      type: 'error', requestId: 'planner.alternative.error', generation: 1, message: 'alternative prediction failed',
    }])
  })

  it('cancels by generation and posts nothing for the cancelled task', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    let cancelledDuringCalculation = false
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: async (_input, _runtime, executionOptions) => {
        expect(executionOptions?.shouldCancel?.()).toBe(false)
        await controller.handleMessage({ type: 'cancel', requestId: 'planner.alternative.cancel', generation: 1 })
        cancelledDuringCalculation = executionOptions?.shouldCancel?.() ?? false
        throw new PlannerAlternativeCancelledError()
      },
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)
    await controller.handleMessage({
      type: 'create_planner_alternative_comparison', requestId: 'planner.alternative.cancel', generation: 1,
      input: fixturePlannerAlternativeInput(),
    })
    expect(cancelledDuringCalculation).toBe(true)
    expect(controller.isCancelled('planner.alternative.cancel')).toBe(true)
    expect(responses).toEqual([])
  })

  it('reports a Domain cancellation signal when the current generation was not cancelled', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: async () => {
        throw new PlannerAlternativeCancelledError('unexpected current signal')
      },
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)
    await controller.handleMessage({
      type: 'create_planner_alternative_comparison', requestId: 'planner.alternative.current-signal', generation: 1,
      input: fixturePlannerAlternativeInput(),
    })
    expect(responses).toEqual([{
      type: 'error', requestId: 'planner.alternative.current-signal', generation: 1, message: 'unexpected current signal',
    }])
  })

  it('retires an older generation of the same logical request id, of another kind or its own', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const ordinary = deferred<PlannerResult>()
    let ordinaryOptions: PlannerExecutionOptions | undefined
    const controller = attach({
      createPlan: async (_input, _runtime, executionOptions) => {
        ordinaryOptions = executionOptions
        return ordinary.promise
      },
      createPlannerAlternativeComparison: async () => fixturePlannerAlternativeResult,
      createPlannerAlternativeRepair: failingPlannerAlternativeRepairCalculation(),
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)
    const requestId = 'planner.alternative.generation'
    const oldRun = controller.handleMessage({
      type: 'create_plan', requestId, generation: 1, input,
    })
    await controller.handleMessage({
      type: 'create_planner_alternative_comparison', requestId, generation: 2, input: fixturePlannerAlternativeInput(input),
    })
    expect(ordinaryOptions?.shouldCancel?.()).toBe(true)
    ordinary.resolve({ plan: null, conflicts: [], warnings: [], termination: exhaustedPlannerTermination() })
    await oldRun
    // An older generation arriving late is dropped outright.
    await controller.handleMessage({
      type: 'create_planner_alternative_comparison', requestId, generation: 1, input: fixturePlannerAlternativeInput(input),
    })
    expect(responses).toEqual([{
      type: 'create_planner_alternative_comparison_result', requestId, generation: 2, result: fixturePlannerAlternativeResult,
    }])
  })
})

describe('Planner Worker Planner Alternative actual repair routing (Phase 5-B)', () => {
  function repairInput(input = fixture().input): PlannerAlternativeRepairInput {
    return {
      plannerInput: input,
      decision: { conflictKey: 'conflict.planner-alternative.repair', selectedBuildListEntryId: input.buildListEntries[0].id },
      lineage: null,
    }
  }

  const repairResult: PlannerAlternativeRepairCalculationResult = {
    status: 'invalid_prior_fixed_entry',
    buildListEntryId: createValidBuildListEntry().id,
    detail: 'fixture repair result',
  }

  it('routes only the repair request kind, verbatim, with no extent or bounds on the wire', async () => {
    const { input, dependencies } = fixture()
    const wire = repairInput(input)
    const request: PlannerWorkerProtocolRequest = {
      type: 'create_planner_alternative_repair', requestId: 'planner.repair.routing', generation: 1, input: wire,
    }
    expect(structuredClone(request)).toEqual(request)
    expect(Object.keys(request.input).sort()).toEqual(['decision', 'lineage', 'plannerInput'])
    const responses: PlannerWorkerProtocolResponse[] = []
    const createPlan = failingOrdinaryCalculation()
    const createPlannerAlternativeComparison = failingPlannerAlternativeComparisonCalculation()
    const createPlannerAlternativeRepair: CreatePlannerAlternativeRepairCalculation = vi.fn(
      async (received, runtime, executionOptions) => {
        expect(received).toBe(wire)
        expect(runtime).toBe(dependencies)
        expect(Object.keys(executionOptions ?? {}).sort()).toEqual(['shouldCancel', 'yieldControl'])
        return repairResult
      },
    )
    const controller = attach({
      createPlan,
      createPlannerAlternativeComparison,
      createPlannerAlternativeRepair,
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)

    await controller.handleMessage(request)

    expect(createPlan).not.toHaveBeenCalled()
    expect(createPlannerAlternativeComparison).not.toHaveBeenCalled()
    expect(createPlannerAlternativeRepair).toHaveBeenCalledOnce()
    expect(responses).toEqual([{
      type: 'create_planner_alternative_repair_result', requestId: 'planner.repair.routing', generation: 1, result: repairResult,
    }])
    expect(structuredClone(responses[0])).toEqual(responses[0])
  })

  it('cancels by generation and posts nothing for the cancelled repair', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
      createPlannerAlternativeRepair: async (_input, _runtime, executionOptions) => {
        await controller.handleMessage({ type: 'cancel', requestId: 'planner.repair.cancel', generation: 1 })
        expect(executionOptions?.shouldCancel?.()).toBe(true)
        throw new PlannerAlternativeCancelledError()
      },
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)
    await controller.handleMessage({
      type: 'create_planner_alternative_repair', requestId: 'planner.repair.cancel', generation: 1, input: repairInput(),
    })
    expect(responses).toEqual([])
  })

  it('reports an unexpected repair failure through the shared error response', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createPlannerAlternativeComparison: failingPlannerAlternativeComparisonCalculation(),
      createPlannerAlternativeRepair: async () => { throw new Error('repair prediction failed') },
      prepareInteraction: failingPreparationCalculation(),
    }, dependencies, responses)
    await controller.handleMessage({
      type: 'create_planner_alternative_repair', requestId: 'planner.repair.error', generation: 1, input: repairInput(),
    })
    expect(responses).toEqual([{ type: 'error', requestId: 'planner.repair.error', generation: 1, message: 'repair prediction failed' }])
  })
})
