import { describe, expect, it, vi } from 'vitest'
import type {
  CreateConstrainedProductionPlanCalculation,
  CreateProductionPlanCalculation,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerOrchestrationBounds,
  PlannerResult,
  PlannerWhatIfCalculationResult,
  PlannerWhatIfRequest,
} from '../domain/planner'
import { defaultPlannerOptions, PlannerWhatIfCancelledError } from '../domain/planner'
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
  type CreatePlannerWhatIfComparisonCalculation,
  type PlannerWorkerCalculations,
} from './planner.worker'
import type {
  PlannerConstrainedWorkerRequest,
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
        lotteries: search.master.lotteries,
        materialCosts: search.master.materialCosts,
        bonusRanks: search.master.bonusRanks,
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

/**
 * Test-only bounds. They are deliberately small and local: B8-D1 adds no
 * Production `PlannerOrchestrationBounds` default anywhere, so every caller -
 * including a test - states them.
 */
const fixtureOrchestrationBounds: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 2,
  maxGeneratedBuildListEntries: 1,
  maxPlannerReruns: 3,
}

function fixtureWhatIfRequest(input = fixture().input): PlannerWhatIfRequest {
  return {
    plannerInput: input,
    scenarioResolution: {
      conflictKey: 'conflict.what-if.fixture',
      selectedBuildListEntryId: input.buildListEntries[0].id,
    },
    bounds: {
      maxCandidateTrialsPerTarget: 3,
      maxPlannerReruns: 7,
    },
  }
}

const fixtureWhatIfResult: PlannerWhatIfCalculationResult = {
  status: 'invalid_fixed_resolution',
  reason: 'scenario_resolution_not_valid',
  conflictKey: 'conflict.what-if.fixture',
  selectedBuildListEntryId: createValidBuildListEntry().id,
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

function failingConstrainedCalculation(): CreateConstrainedProductionPlanCalculation {
  return vi.fn(async () => {
    throw new Error('Constrained Planner calculation must not run for this request.')
  })
}

function failingWhatIfCalculation(): CreatePlannerWhatIfComparisonCalculation {
  return vi.fn(async () => {
    throw new Error('What-if Planner calculation must not run for this request.')
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
    const createConstrainedPlan = failingConstrainedCalculation()
    attachPlannerWorker({
      postMessage: (response) => responses.push(response),
      addEventListener: (_type, callback) => { listener = callback },
    }, createDependencies, {
      createPlan: calculate,
      createConstrainedPlan,
      prepareInteraction: failingPreparationCalculation(),
      createWhatIfComparison: failingWhatIfCalculation(),
    })

    listener({ data: request })
    await vi.waitFor(() => expect(responses).toHaveLength(1))
    expect(createDependencies).toHaveBeenCalledOnce()
    expect(calculate).toHaveBeenCalledOnce()
    expect(createConstrainedPlan).not.toHaveBeenCalled()
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
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
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

describe('Planner Worker constrained request routing (B8-D1)', () => {
  it('structured-clones only the PlannerInput and the caller orchestration bounds', () => {
    const { input } = fixture()
    const request: PlannerConstrainedWorkerRequest = {
      type: 'create_constrained_plan',
      requestId: 'planner.constrained.clone',
      generation: 1,
      input: {
        plannerInput: input,
        orchestrationBounds: fixtureOrchestrationBounds,
      },
    }
    expect(structuredClone(request)).toEqual(request)
    expect(Object.keys(request.input).sort()).toEqual([
      'orchestrationBounds',
      'plannerInput',
    ])
    expect(request.input).not.toHaveProperty('enumerationBounds')
    expect(request.input.plannerInput).not.toHaveProperty('rngEngine')
  })

  it('routes to the constrained calculation only, with the exact caller bounds and shared runtime options', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const createPlan = failingOrdinaryCalculation()
    const generatedEntry = createValidBuildListEntry()
    const createConstrainedPlan: CreateConstrainedProductionPlanCalculation = vi.fn(
      async (plannerInput, orchestrationBounds, runtime, executionOptions) => {
        expect(plannerInput).toBe(input)
        // Passed through by identity, never re-created, clamped, or completed.
        expect(orchestrationBounds).toBe(fixtureOrchestrationBounds)
        expect(runtime).toBe(dependencies)
        expect(typeof executionOptions?.shouldCancel).toBe('function')
        expect(typeof executionOptions?.yieldControl).toBe('function')
        executionOptions?.onProgress?.({ expandedStates: 4, maxExpandedStates: 20 })
        return {
          plan: createValidProductionPlan(),
          conflicts: [],
          warnings: [],
          termination: completedPlannerTermination(),
          generatedBuildListEntries: [generatedEntry],
        }
      },
    )
    const controller = attach(
      {
        createPlan,
        createConstrainedPlan,
        createWhatIfComparison: failingWhatIfCalculation(),
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_constrained_plan',
      requestId: 'planner.constrained.request',
      generation: 1,
      input: { plannerInput: input, orchestrationBounds: fixtureOrchestrationBounds },
    })

    expect(createPlan).not.toHaveBeenCalled()
    expect(createConstrainedPlan).toHaveBeenCalledOnce()
    // The Beam progress response is shared with the ordinary request kind.
    expect(responses[0]).toEqual({
      type: 'progress',
      requestId: 'planner.constrained.request',
      generation: 1,
      progress: { expandedStates: 4, maxExpandedStates: 20 },
    })
    expect(responses[1]).toEqual({
      type: 'create_constrained_plan_result',
      requestId: 'planner.constrained.request',
      generation: 1,
      result: expect.objectContaining({
        generatedBuildListEntries: [generatedEntry],
      }),
    })
    expect(responses).toHaveLength(2)
  })

  it('keeps generatedBuildListEntries in the structured-cloneable response', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const generatedEntry = createValidBuildListEntry()
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: async () => ({
          plan: createValidProductionPlan(),
          conflicts: [],
          warnings: [],
          termination: completedPlannerTermination(),
          generatedBuildListEntries: [generatedEntry],
        }),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_constrained_plan',
      requestId: 'planner.constrained.generated',
      generation: 1,
      input: { plannerInput: input, orchestrationBounds: fixtureOrchestrationBounds },
    })

    const response = responses[0]
    expect(response.type).toBe('create_constrained_plan_result')
    expect(structuredClone(response)).toEqual(response)
    expect(
      response.type === 'create_constrained_plan_result'
        ? response.result.generatedBuildListEntries
        : null,
    ).toEqual([generatedEntry])
  })

  it('carries the typed termination across the Worker boundary as plain data', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    // A truncated search, with the diagnostic warning it also produces. The
    // Worker must forward both unchanged: it never rebuilds the termination
    // from the warning, and never drops it (PLANNER_SPEC 7.2.1, 14).
    const termination = incompletePlannerTermination(['max_expanded_states'], {
      limits: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 10_000 },
      expandedStates: 10_000,
      completedTargetCount: 1,
      totalTargetCount: 2,
    })
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: async () => ({
          plan: createValidProductionPlan(),
          conflicts: [],
          warnings: [{
            kind: 'max_expanded_states_reached' as const,
            message: 'Planner reached maxExpandedStates (10000).',
          }],
          termination,
          generatedBuildListEntries: [],
        }),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_constrained_plan',
      requestId: 'planner.constrained.termination',
      generation: 1,
      input: { plannerInput: input, orchestrationBounds: fixtureOrchestrationBounds },
    })

    const response = responses[0]
    expect(response.type).toBe('create_constrained_plan_result')
    expect(structuredClone(response)).toEqual(response)
    expect(
      response.type === 'create_constrained_plan_result'
        ? response.result.termination
        : null,
    ).toEqual(termination)
  })

  it('reports a constrained failure as the existing Worker error response without reclassifying it', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: async () => {
          throw new Error('constrained materialization invariant failed')
        },
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_constrained_plan',
      requestId: 'planner.constrained.error',
      generation: 1,
      input: { plannerInput: input, orchestrationBounds: fixtureOrchestrationBounds },
    })

    expect(responses).toEqual([{
      type: 'error',
      requestId: 'planner.constrained.error',
      generation: 1,
      message: 'constrained materialization invariant failed',
    }])
    expect(responses.some(({ type }) => type.endsWith('_result'))).toBe(false)
  })

  it('retires a superseded calculation so its stale progress, result, and error are never posted', async () => {
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
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
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

    // Stale progress from the retired calculation is dropped.
    capturedOptions[0]?.onProgress?.({ expandedStates: 1, maxExpandedStates: 10 })
    expect(responses).toEqual([])

    // So is its stale result.
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
    capturedOptions[1]?.onProgress?.({ expandedStates: 3, maxExpandedStates: 10 })
    second.resolve(result)
    await replacement
    expect(responses).toEqual([
      {
        type: 'progress',
        requestId: 'planner.generation',
        generation: 2,
        progress: { expandedStates: 3, maxExpandedStates: 10 },
      },
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
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
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
    const constrainedResult = {
      plan: null,
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
      generatedBuildListEntries: [],
    }
    const controller = attach(
      {
        createPlan,
        createConstrainedPlan: async () => constrainedResult,
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
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
      type: 'create_constrained_plan',
      requestId: 'planner.retired.error',
      generation: 2,
      input: { plannerInput: input, orchestrationBounds: fixtureOrchestrationBounds },
    })
    first.reject(new Error('retired ordinary failure'))
    await running

    expect(responses).toEqual([
      {
        type: 'create_constrained_plan_result',
        requestId: 'planner.retired.error',
        generation: 2,
        result: constrainedResult,
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
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
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
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
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

  it('propagates cancellation into the constrained calculation and posts nothing afterwards', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    let shouldCancel: (() => boolean) | undefined
    let cancelledDuringCalculation: boolean | null = null
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: async (
          _input,
          _bounds,
          _dependencies,
          executionOptions,
        ) => {
          shouldCancel = executionOptions?.shouldCancel
          expect(shouldCancel?.()).toBe(false)
          await controller.handleMessage({
            type: 'cancel',
            requestId: 'planner.constrained.cancel',
            generation: 1,
          })
          cancelledDuringCalculation = shouldCancel?.() ?? null
          // A cancelled ordinary Planner still returns a safe result.
          return {
    plan: null,
    conflicts: [],
    warnings: [],
    termination: exhaustedPlannerTermination(),
    generatedBuildListEntries: [],
  }
        },
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: failingWhatIfCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_constrained_plan',
      requestId: 'planner.constrained.cancel',
      generation: 1,
      input: { plannerInput: input, orchestrationBounds: fixtureOrchestrationBounds },
    })

    expect(cancelledDuringCalculation).toBe(true)
    expect(controller.isCancelled('planner.constrained.cancel')).toBe(true)
    expect(responses).toEqual([])
  })
})

describe('Planner Worker what-if request routing (B9-C)', () => {
  it('structured-clones only PlannerWhatIfRequest and routes it unchanged with shared runtime options', async () => {
    const { input, dependencies } = fixture()
    const whatIfRequest = fixtureWhatIfRequest(input)
    const request: PlannerWorkerProtocolRequest = {
      type: 'create_what_if_comparison',
      requestId: 'planner.what-if.routing',
      generation: 1,
      input: whatIfRequest,
    }
    expect(structuredClone(request)).toEqual(request)
    expect(Object.keys(request.input).sort()).toEqual([
      'bounds',
      'plannerInput',
      'scenarioResolution',
    ])
    expect(request.input).not.toHaveProperty('enumerationBounds')
    expect(request.input.plannerInput).not.toHaveProperty('rngEngine')
    expect(request).not.toHaveProperty('clock')
    expect(request).not.toHaveProperty('idFactory')

    const responses: PlannerWorkerProtocolResponse[] = []
    const createPlan = failingOrdinaryCalculation()
    const createConstrainedPlan = failingConstrainedCalculation()
    const createWhatIfComparison: CreatePlannerWhatIfComparisonCalculation = vi.fn(
      async (received, runtime, executionOptions) => {
        expect(received).toBe(whatIfRequest)
        expect(runtime).toBe(dependencies)
        expect(typeof executionOptions?.shouldCancel).toBe('function')
        expect(typeof executionOptions?.yieldControl).toBe('function')
        executionOptions?.onProgress?.({ expandedStates: 5, maxExpandedStates: 21 })
        return fixtureWhatIfResult
      },
    )
    const controller = attach(
      {
        createPlan,
        createConstrainedPlan,
        createWhatIfComparison,
        prepareInteraction: failingPreparationCalculation(),
      },
      dependencies,
      responses,
    )

    await controller.handleMessage(request)

    expect(createPlan).not.toHaveBeenCalled()
    expect(createConstrainedPlan).not.toHaveBeenCalled()
    expect(createWhatIfComparison).toHaveBeenCalledOnce()
    expect(responses).toEqual([
      {
        type: 'progress',
        requestId: 'planner.what-if.routing',
        generation: 1,
        progress: { expandedStates: 5, maxExpandedStates: 21 },
      },
      {
        type: 'create_what_if_comparison_result',
        requestId: 'planner.what-if.routing',
        generation: 1,
        result: fixtureWhatIfResult,
      },
    ])
    expect(structuredClone(responses[1])).toEqual(responses[1])
  })

  it('reports an unexpected what-if failure through the shared error response', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: async () => {
          throw new Error('what-if prediction failed')
        },
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_what_if_comparison',
      requestId: 'planner.what-if.error',
      generation: 1,
      input: fixtureWhatIfRequest(),
    })

    expect(responses).toEqual([{
      type: 'error',
      requestId: 'planner.what-if.error',
      generation: 1,
      message: 'what-if prediction failed',
    }])
  })

  it('uses generation cancellation as authority and suppresses the Domain cancellation signal', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    let cancelledDuringCalculation = false
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: async (_request, _runtime, executionOptions) => {
          expect(executionOptions?.shouldCancel?.()).toBe(false)
          await controller.handleMessage({
            type: 'cancel',
            requestId: 'planner.what-if.cancel',
            generation: 1,
          })
          cancelledDuringCalculation = executionOptions?.shouldCancel?.() ?? false
          throw new PlannerWhatIfCancelledError()
        },
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_what_if_comparison',
      requestId: 'planner.what-if.cancel',
      generation: 1,
      input: fixtureWhatIfRequest(),
    })

    expect(cancelledDuringCalculation).toBe(true)
    expect(controller.isCancelled('planner.what-if.cancel')).toBe(true)
    expect(responses).toEqual([])
  })

  it('reports a Domain cancellation signal when the current generation was not cancelled', async () => {
    const { dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = attach(
      {
        createPlan: failingOrdinaryCalculation(),
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: async () => {
          throw new PlannerWhatIfCancelledError('unexpected current signal')
        },
      },
      dependencies,
      responses,
    )

    await controller.handleMessage({
      type: 'create_what_if_comparison',
      requestId: 'planner.what-if.current-signal',
      generation: 1,
      input: fixtureWhatIfRequest(),
    })

    expect(responses).toEqual([{
      type: 'error',
      requestId: 'planner.what-if.current-signal',
      generation: 1,
      message: 'unexpected current signal',
    }])
  })

  it('retires an ordinary generation when a what-if task takes the same logical request id', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const ordinaryResult = deferred<PlannerResult>()
    let ordinaryOptions: PlannerExecutionOptions | undefined
    const controller = attach(
      {
        createPlan: async (_input, _runtime, executionOptions) => {
          ordinaryOptions = executionOptions
          return ordinaryResult.promise
        },
        createConstrainedPlan: failingConstrainedCalculation(),
        prepareInteraction: failingPreparationCalculation(),
        createWhatIfComparison: async () => fixtureWhatIfResult,
      },
      dependencies,
      responses,
    )

    const oldRun = controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.what-if.generation',
      generation: 1,
      input,
    })
    await controller.handleMessage({
      type: 'create_what_if_comparison',
      requestId: 'planner.what-if.generation',
      generation: 2,
      input: fixtureWhatIfRequest(input),
    })
    expect(ordinaryOptions?.shouldCancel?.()).toBe(true)
    ordinaryOptions?.onProgress?.({ expandedStates: 1, maxExpandedStates: 4 })
    ordinaryResult.reject(new Error('stale ordinary error'))
    await oldRun

    expect(responses).toEqual([{
      type: 'create_what_if_comparison_result',
      requestId: 'planner.what-if.generation',
      generation: 2,
      result: fixtureWhatIfResult,
    }])
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
      createConstrainedPlan: failingConstrainedCalculation(),
      createWhatIfComparison: failingWhatIfCalculation(),
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
    expect(calculations.createConstrainedPlan).not.toHaveBeenCalled()
    expect(calculations.createWhatIfComparison).not.toHaveBeenCalled()
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
      createConstrainedPlan: failingConstrainedCalculation(),
      createWhatIfComparison: failingWhatIfCalculation(),
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

  it('supersedes in-flight what-if work and ignores older preparation tasks and cancels', async () => {
    const { input, dependencies } = fixture()
    const responses: PlannerWorkerProtocolResponse[] = []
    const pending = deferred<PlannerWhatIfCalculationResult>()
    let options: PlannerExecutionOptions | undefined
    const prepareInteraction = vi.fn(() => interactionResult)
    const controller = attach({
      createPlan: failingOrdinaryCalculation(),
      createConstrainedPlan: failingConstrainedCalculation(),
      createWhatIfComparison: async (_input, _runtime, executionOptions) => {
        options = executionOptions
        return pending.promise
      },
      prepareInteraction,
    }, dependencies, responses)
    const requestId = 'planner.interaction.shared'
    const oldRun = controller.handleMessage({
      type: 'create_what_if_comparison', requestId, generation: 1,
      input: fixtureWhatIfRequest(input),
    })
    await controller.handleMessage({
      type: 'prepare_interaction', requestId, generation: 2, input,
    })
    expect(options?.shouldCancel?.()).toBe(true)
    options?.onProgress?.({ expandedStates: 1, maxExpandedStates: 10 })
    pending.reject(new Error('retired what-if failure'))
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
