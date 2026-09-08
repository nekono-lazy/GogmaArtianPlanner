import { describe, expect, it, vi } from 'vitest'
import {
  defaultPlannerOptions,
  defaultPlannerOrchestrationBounds,
} from '../domain/planner'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerOrchestrationBounds,
  PlannerOrchestrationResult,
  PlannerWhatIfCalculationResult,
  PlannerWhatIfRequest,
} from '../domain/planner'
import { defaultConstrainedEnumerationBounds } from '../domain/search'
import {
  ProductionRngEngine,
  PRODUCTION_RNG_ENGINE_VERSION,
} from '../domain/rng/production/productionRngEngine'
import {
  createCandidateSearchInput,
} from '../test/fixtures/candidateSearch'
import {
  createProductionConstrainedPlan,
  createProductionPlannerWhatIfComparison,
  createProductionPlannerWorkerCalculations,
  createProductionPlannerWorkerDependencies,
} from './planner.worker.production'

/**
 * The B8-C4b orchestration is replaced here on purpose: this file verifies the
 * B8-D1 Production Worker *adapter*, meaning exactly which bounds it hands to
 * that authority. The orchestration's own behaviour is covered by
 * `plannerConstrainedOrchestration.test.ts`.
 */
const orchestration = vi.hoisted(() => ({
  createProductionPlanWithConstrainedSearch: vi.fn(),
  createPlannerWhatIfComparison: vi.fn(),
}))

vi.mock('../domain/planner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/planner')>()
  return {
    ...actual,
    createProductionPlanWithConstrainedSearch:
      orchestration.createProductionPlanWithConstrainedSearch,
    createPlannerWhatIfComparison: orchestration.createPlannerWhatIfComparison,
  }
})

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

function emptyResult(): PlannerOrchestrationResult {
  return { plan: null, conflicts: [], warnings: [], generatedBuildListEntries: [] }
}

describe('Production constrained Planner Worker adapter (B8-D1)', () => {
  it('passes the B8-B2 enumeration bounds authority and the caller orchestration bounds unchanged', async () => {
    orchestration.createProductionPlanWithConstrainedSearch.mockResolvedValue(
      emptyResult(),
    )
    const input = plannerInput()
    const dependencies: PlannerDependencies = createProductionPlannerWorkerDependencies()
    // Deliberately uneven values: a clamp, a default, or a field-wise
    // completion would show up as a different object here.
    const orchestrationBounds: PlannerOrchestrationBounds = {
      maxCandidateTrialsPerConflict: 7,
      maxGeneratedBuildListEntries: 3,
      maxPlannerReruns: 11,
    }
    const executionOptions = { shouldCancel: () => false }

    await createProductionConstrainedPlan(
      input,
      orchestrationBounds,
      dependencies,
      executionOptions,
    )

    expect(orchestration.createProductionPlanWithConstrainedSearch)
      .toHaveBeenCalledOnce()
    const [
      calledInput,
      calledDependencies,
      calledOptions,
    ] = orchestration.createProductionPlanWithConstrainedSearch.mock.calls[0]
    expect(calledInput).toBe(input)
    expect(calledDependencies).toBe(dependencies)
    // The constant itself, imported from its Search Domain authority rather
    // than copied into the adapter.
    expect(calledOptions.enumerationBounds).toBe(defaultConstrainedEnumerationBounds)
    expect(calledOptions.enumerationBounds).toEqual({
      maxNormalForgeCount: 40,
      maxGogmaAdvance: 30,
      maxSkillResetCount: 100,
      maxOffAxisPairEvaluations: 500,
    })
    expect(calledOptions.orchestrationBounds).toBe(orchestrationBounds)
    expect(calledOptions.executionOptions).toBe(executionOptions)
    expect(Object.keys(calledOptions).sort()).toEqual([
      'enumerationBounds',
      'executionOptions',
      'orchestrationBounds',
    ])
  })

  it('still forwards caller bounds unchanged now that a Production default exists (B8-E2b)', async () => {
    orchestration.createProductionPlanWithConstrainedSearch.mockClear()
    orchestration.createProductionPlanWithConstrainedSearch.mockResolvedValue(
      emptyResult(),
    )
    // Every field differs from the B8-E2b Production default, so a silent
    // substitution or a field-wise completion towards 2 / 1 / 4 would show.
    const orchestrationBounds: PlannerOrchestrationBounds = {
      maxCandidateTrialsPerConflict: 5,
      maxGeneratedBuildListEntries: 2,
      maxPlannerReruns: 9,
    }
    const before = structuredClone(orchestrationBounds)

    await createProductionConstrainedPlan(
      plannerInput(),
      orchestrationBounds,
      createProductionPlannerWorkerDependencies(),
      { shouldCancel: () => false },
    )

    const [, , calledOptions] =
      orchestration.createProductionPlanWithConstrainedSearch.mock.calls[0]
    expect(calledOptions.orchestrationBounds).toBe(orchestrationBounds)
    expect(calledOptions.orchestrationBounds).toEqual(before)
    expect(calledOptions.orchestrationBounds).not.toEqual(
      defaultPlannerOrchestrationBounds,
    )
    expect(orchestrationBounds).toEqual(before)
  })

  it('adds no Production PlannerOrchestrationBounds default of its own', async () => {
    orchestration.createProductionPlanWithConstrainedSearch.mockResolvedValue(
      emptyResult(),
    )
    const productionModule = await import('./planner.worker.production')
    // The adapter exports no orchestration default of any name; the only
    // Production bounds default in reach is the enumeration one.
    expect(Object.keys(productionModule).sort()).toEqual([
      'createProductionConstrainedPlan',
      'createProductionPlannerRngEngine',
      'createProductionPlannerWhatIfComparison',
      'createProductionPlannerWorkerCalculations',
      'createProductionPlannerWorkerDependencies',
    ])
    expect(defaultConstrainedEnumerationBounds).toBeDefined()
  })

  it('exposes all calculations and keeps the Production RNG Engine unchanged', () => {
    const calculations = createProductionPlannerWorkerCalculations()
    expect(Object.keys(calculations).sort()).toEqual([
      'createConstrainedPlan',
      'createPlan',
      'createWhatIfComparison',
    ])
    expect(calculations.createConstrainedPlan).toBe(createProductionConstrainedPlan)
    const dependencies = createProductionPlannerWorkerDependencies()
    expect(dependencies.rngEngine).toBeInstanceOf(ProductionRngEngine)
    expect(dependencies.rngEngine.version).toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })

  it('adds only the Production enumeration extent to a what-if request', async () => {
    const result: PlannerWhatIfCalculationResult = {
      status: 'planner_input_not_ready',
      issues: [],
      warnings: [],
      excludedBuildListEntries: [],
    }
    orchestration.createPlannerWhatIfComparison.mockResolvedValue(result)
    const request: PlannerWhatIfRequest = {
      plannerInput: plannerInput(),
      scenarioResolution: {
        conflictKey: 'conflict.production.what-if',
        selectedBuildListEntryId: 'build-list.production.what-if' as never,
      },
      bounds: {
        maxCandidateTrialsPerCategoryPerTarget: 7,
        maxPlannerReruns: 13,
      },
    }
    const before = structuredClone(request)
    const dependencies = createProductionPlannerWorkerDependencies()
    const executionOptions = { shouldCancel: () => false }

    await expect(createProductionPlannerWhatIfComparison(
      request,
      dependencies,
      executionOptions,
    )).resolves.toBe(result)

    expect(orchestration.createPlannerWhatIfComparison).toHaveBeenCalledOnce()
    const [calledRequest, calledDependencies, calledOptions] =
      orchestration.createPlannerWhatIfComparison.mock.calls[0]
    expect(calledRequest).toBe(request)
    expect(calledDependencies).toBe(dependencies)
    expect(calledOptions.enumerationBounds).toBe(
      defaultConstrainedEnumerationBounds,
    )
    expect(calledOptions.executionOptions).toBe(executionOptions)
    expect(Object.keys(calledOptions).sort()).toEqual([
      'enumerationBounds',
      'executionOptions',
    ])
    expect(request).toEqual(before)
    expect(calledRequest.bounds).toBe(request.bounds)
    expect(calledRequest).not.toHaveProperty('enumerationBounds')
  })

  it('defines no PlannerWhatIfBounds default in the Production adapter', async () => {
    const productionModule = await import('./planner.worker.production')
    expect(productionModule).not.toHaveProperty('defaultPlannerWhatIfBounds')
  })
})
