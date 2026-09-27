import { describe, expect, it, vi } from 'vitest'
import {
  createProductionPlan,
  defaultPlannerAlternativeTrialBounds,
  defaultPlannerOptions,
} from '../domain/planner'
import type {
  PlannerAlternativeRepairCalculationResult,
  PlannerAlternativeRepairInput,
  PlannerAlternativeWhatIfCalculationResult,
  PlannerAlternativeWhatIfInput,
  PlannerInput,
} from '../domain/planner'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { createCandidateSearchInput } from '../test/fixtures/candidateSearch'
import {
  ProductionRngEngine,
  PRODUCTION_RNG_ENGINE_VERSION,
} from '../domain/rng/production/productionRngEngine'
import {
  createProductionPlannerAlternativeComparison,
  createProductionPlannerAlternativeRepair,
  createProductionPlannerWorkerCalculations,
  createProductionPlannerWorkerDependencies,
} from './planner.worker.production'

/**
 * The Phase 4-B Production Worker *adapter* only: which extent and trial
 * bounds it hands to the Domain calculation. The calculation itself is
 * replaced here and covered by `plannerAlternativeWhatIf*.test.ts`.
 */
const domain = vi.hoisted(() => ({
  createPlannerAlternativeWhatIfComparison: vi.fn(),
  createPlannerAlternativeRepair: vi.fn(),
  createPlannerWhatIfComparison: vi.fn(),
  createProductionPlanWithConstrainedSearch: vi.fn(),
}))

vi.mock('../domain/planner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/planner')>()
  return {
    ...actual,
    createPlannerAlternativeWhatIfComparison: domain.createPlannerAlternativeWhatIfComparison,
    createPlannerAlternativeRepair: domain.createPlannerAlternativeRepair,
    // The legacy B8 / B9 Domain calculations stay in the Domain until Phase
    // 6-B2b; replaced here only to prove no Production adapter reaches them.
    createPlannerWhatIfComparison: domain.createPlannerWhatIfComparison,
    createProductionPlanWithConstrainedSearch: domain.createProductionPlanWithConstrainedSearch,
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
      artianBonusTypeMappings: search.master.artianBonusTypeMappings,
      materialCosts: search.master.materialCosts,
    },
    conflictResolutions: [],
  }
}

function alternativeInput(): PlannerAlternativeWhatIfInput {
  return {
    plannerInput: plannerInput(),
    scenarioResolution: {
      conflictKey: 'conflict.production.alternative',
      selectedBuildListEntryId: 'build-list.production.alternative' as never,
    },
    priorFixedBuildListEntryIds: ['build-list.production.prior' as never],
    priorExcludedRoutes: [{ targetWeaponId: 'target.production.prior' as never, routeKeys: ['route.prior'] }],
  }
}

describe('Production Planner Alternative what-if Worker adapter (Phase 4-B)', () => {
  it('passes the Domain Production extent and trial bounds explicitly, and the wire input unchanged', async () => {
    const result: PlannerAlternativeWhatIfCalculationResult = {
      status: 'invalid_prior_fixed_entry',
      buildListEntryId: 'build-list.production.prior' as never,
      detail: 'fixture',
    }
    domain.createPlannerAlternativeWhatIfComparison.mockResolvedValue(result)
    const input = alternativeInput()
    const before = structuredClone(input)
    const dependencies = createProductionPlannerWorkerDependencies()
    const executionOptions = { shouldCancel: () => false }

    await expect(createProductionPlannerAlternativeComparison(input, dependencies, executionOptions)).resolves.toBe(result)

    expect(domain.createPlannerAlternativeWhatIfComparison).toHaveBeenCalledOnce()
    const [request, calledDependencies, options] = domain.createPlannerAlternativeWhatIfComparison.mock.calls[0]
    // The values of the two Domain authorities, not restated numbers.
    expect(request.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(request.bounds).toEqual(defaultPlannerAlternativeTrialBounds)
    expect(Object.keys(request).sort()).toEqual([
      'bounds',
      'extent',
      'plannerInput',
      'priorExcludedRoutes',
      'priorFixedBuildListEntryIds',
      'scenarioResolution',
    ])
    expect(request.plannerInput).toBe(input.plannerInput)
    expect(request.scenarioResolution).toBe(input.scenarioResolution)
    expect(request.priorFixedBuildListEntryIds).toBe(input.priorFixedBuildListEntryIds)
    expect(request.priorExcludedRoutes).toBe(input.priorExcludedRoutes)
    expect(calledDependencies).toBe(dependencies)
    expect(options).toEqual({ executionOptions })
    expect(options.executionOptions).toBe(executionOptions)
    // The wire input is not mutated, and a Domain default object is never handed out to be mutated.
    expect(input).toEqual(before)
    expect(request.extent).not.toBe(defaultPlannerAlternativeSearchExtent)
    expect(request.bounds).not.toBe(defaultPlannerAlternativeTrialBounds)
    expect(domain.createPlannerWhatIfComparison).not.toHaveBeenCalled()
  })

  it('passes the same Domain Production extent and trial bounds to the actual repair, and the wire input unchanged', async () => {
    const result: PlannerAlternativeRepairCalculationResult = {
      status: 'invalid_prior_fixed_entry',
      buildListEntryId: 'build-list.production.prior' as never,
      detail: 'fixture',
    }
    domain.createPlannerAlternativeWhatIfComparison.mockClear()
    domain.createPlannerAlternativeRepair.mockResolvedValue(result)
    const input: PlannerAlternativeRepairInput = {
      plannerInput: plannerInput(),
      decision: { conflictKey: 'conflict.production.repair', selectedBuildListEntryId: 'build-list.production.repair' as never },
      lineage: { decisions: [] },
    }
    const before = structuredClone(input)
    const dependencies = createProductionPlannerWorkerDependencies()
    const executionOptions = { shouldCancel: () => false }

    await expect(createProductionPlannerAlternativeRepair(input, dependencies, executionOptions)).resolves.toBe(result)

    expect(domain.createPlannerAlternativeRepair).toHaveBeenCalledOnce()
    const [request, calledDependencies, options] = domain.createPlannerAlternativeRepair.mock.calls[0]
    expect(request.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(request.bounds).toEqual(defaultPlannerAlternativeTrialBounds)
    expect(Object.keys(request).sort()).toEqual(['bounds', 'decision', 'extent', 'lineage', 'plannerInput'])
    expect(request.plannerInput).toBe(input.plannerInput)
    expect(request.decision).toBe(input.decision)
    expect(request.lineage).toBe(input.lineage)
    expect(calledDependencies).toBe(dependencies)
    expect(options).toEqual({ executionOptions })
    expect(input).toEqual(before)
    expect(request.extent).not.toBe(defaultPlannerAlternativeSearchExtent)
    expect(request.bounds).not.toBe(defaultPlannerAlternativeTrialBounds)
    expect(domain.createPlannerAlternativeWhatIfComparison).not.toHaveBeenCalled()
  })

  it('exports no Planner Alternative default of its own', async () => {
    const productionModule = await import('./planner.worker.production')
    expect(productionModule).not.toHaveProperty('defaultPlannerAlternativeSearchExtent')
    expect(productionModule).not.toHaveProperty('defaultPlannerAlternativeTrialBounds')
  })
})

describe('Production Planner Worker calculations (Phase 6-B1)', () => {
  it('wires exactly the four current calculations to their Production authorities', () => {
    const calculations = createProductionPlannerWorkerCalculations()
    expect(Object.keys(calculations).sort()).toEqual([
      'createPlan',
      'createPlannerAlternativeComparison',
      'createPlannerAlternativeRepair',
      'prepareInteraction',
    ])
    expect(calculations.createPlan).toBe(createProductionPlan)
    expect(calculations.createPlannerAlternativeComparison).toBe(createProductionPlannerAlternativeComparison)
    expect(calculations.createPlannerAlternativeRepair).toBe(createProductionPlannerAlternativeRepair)
    expect(calculations).not.toHaveProperty('createConstrainedPlan')
    expect(calculations).not.toHaveProperty('createWhatIfComparison')
  })

  it('exports no legacy B8 / B9 adapter and no legacy bounds default', async () => {
    const productionModule = await import('./planner.worker.production')
    expect(Object.keys(productionModule).sort()).toEqual([
      'createProductionPlannerAlternativeComparison',
      'createProductionPlannerAlternativeRepair',
      'createProductionPlannerRngEngine',
      'createProductionPlannerWorkerCalculations',
      'createProductionPlannerWorkerDependencies',
    ])
    expect(productionModule).not.toHaveProperty('defaultPlannerOrchestrationBounds')
    expect(productionModule).not.toHaveProperty('defaultPlannerWhatIfBounds')
    expect(productionModule).not.toHaveProperty('defaultConstrainedEnumerationBounds')
  })

  it('reaches no legacy B8 / B9 Domain calculation through any current adapter', async () => {
    domain.createPlannerAlternativeWhatIfComparison.mockResolvedValue({
      status: 'invalid_prior_fixed_entry', buildListEntryId: 'build-list.production.prior' as never, detail: 'fixture',
    })
    domain.createPlannerAlternativeRepair.mockResolvedValue({
      status: 'invalid_prior_fixed_entry', buildListEntryId: 'build-list.production.prior' as never, detail: 'fixture',
    })
    domain.createPlannerWhatIfComparison.mockClear()
    domain.createProductionPlanWithConstrainedSearch.mockClear()
    const dependencies = createProductionPlannerWorkerDependencies()
    await createProductionPlannerAlternativeComparison(alternativeInput(), dependencies)
    await createProductionPlannerAlternativeRepair({
      plannerInput: plannerInput(),
      decision: { conflictKey: 'conflict.production.repair', selectedBuildListEntryId: 'build-list.production.repair' as never },
      lineage: null,
    }, dependencies)
    createProductionPlannerWorkerCalculations().prepareInteraction(plannerInput(), dependencies)
    expect(domain.createPlannerWhatIfComparison).not.toHaveBeenCalled()
    expect(domain.createProductionPlanWithConstrainedSearch).not.toHaveBeenCalled()
  })

  it('keeps the Production RNG Engine unchanged', () => {
    const dependencies = createProductionPlannerWorkerDependencies()
    expect(dependencies.rngEngine).toBeInstanceOf(ProductionRngEngine)
    expect(dependencies.rngEngine.version).toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })
})
