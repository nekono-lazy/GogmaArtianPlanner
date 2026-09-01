import { describe, expect, it, vi } from 'vitest'
import type {
  CreateProductionPlanCalculation,
  PlannerDependencies,
  PlannerInput,
  PlannerWorkerRequest,
  PlannerWorkerResponse,
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
import { attachPlannerWorker } from './planner.worker'

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

describe('Planner Worker contract', () => {
  it('structured-clones only PlannerInput and creates dependencies inside the Worker boundary', async () => {
    const { input, dependencies } = fixture()
    const request: PlannerWorkerRequest = {
      type: 'create_plan',
      requestId: 'planner.fixture.request',
      input,
    }
    expect(structuredClone(request)).toEqual(request)
    expect(request).not.toHaveProperty('rngEngine')
    expect(input).not.toHaveProperty('rngEngine')

    const responses: PlannerWorkerResponse[] = []
    let listener: (event: { data: PlannerWorkerRequest }) => void = () => {
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
      return { plan, conflicts: [], warnings: [] }
    })
    attachPlannerWorker({
      postMessage: (response) => responses.push(response),
      addEventListener: (_type, callback) => { listener = callback },
    }, createDependencies, calculate)

    listener({ data: request })
    await vi.waitFor(() => expect(responses).toHaveLength(1))
    expect(createDependencies).toHaveBeenCalledOnce()
    expect(calculate).toHaveBeenCalledOnce()
    expect(responses[0]).toEqual(expect.objectContaining({
      type: 'create_plan_result',
      requestId: 'planner.fixture.request',
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
    const responses: PlannerWorkerResponse[] = []
    const calculate: CreateProductionPlanCalculation = vi.fn(async () => {
      throw new Error('unexpected prediction failure')
    })
    const controller = attachPlannerWorker({
      postMessage: (response) => responses.push(response),
      addEventListener: () => undefined,
    }, () => dependencies, calculate)

    await controller.handleMessage({
      type: 'create_plan',
      requestId: 'planner.fixture.error',
      input: fixture().input,
    })

    expect(responses).toEqual([{
      type: 'error',
      requestId: 'planner.fixture.error',
      message: 'unexpected prediction failure',
    }])
  })
})
