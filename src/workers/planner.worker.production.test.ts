import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  WeaponTypeId,
} from '../domain/models/publicTypes'
import {
  defaultPlannerOptions,
  preparePlannerInitialContext,
  type PlannerInput,
} from '../domain/planner'
import {
  ProductionRngEngine,
  PRODUCTION_RNG_ENGINE_VERSION,
} from '../domain/rng/production/productionRngEngine'
import { UnavailableRngEngine } from '../domain/rng/unavailableRngEngine'
import type {
  CandidateSearchInput,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '../domain/search'
import { createCandidateSearchInput, candidatesOf } from '../test/fixtures/candidateSearch'
import { gameVerifiedBowElementalNormalVectors } from '../test/fixtures/gameVerifiedNormalVectors'
import {
  fixture as beamFixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../test/fixtures/plannerBeam'
import { createPlannerWorkerController } from './planner.worker'
import type {
  PlannerWorkerProtocolRequest,
  PlannerWorkerProtocolResponse,
} from './plannerWorkerContracts'
import {
  createProductionPlannerRngEngine,
  createProductionPlannerWorkerCalculations,
  createProductionPlannerWorkerDependencies,
} from './planner.worker.production'
import { createSearchWorkerController } from './search.worker'
import { createProductionSearchRngEngine } from './search.worker.production'

function createProductionSearchInput(
  weaponTypeId: WeaponTypeId = 'weapon.bow',
): CandidateSearchInput {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
  const vector = gameVerifiedBowElementalNormalVectors[0]
  const input = createCandidateSearchInput()
  input.searchRunId = `production-planner.${weaponTypeId}`
  input.routeFilter = 'normal_artian'
  input.ownedWeapons = []
  input.rngState.baseSeed = {
    value: String(vector.baseSeed),
    isConfirmed: true,
    source: 'manual',
  }
  input.rngState.skillCounter = {
    value: 0,
    isConfirmed: true,
    source: 'manual',
  }
  input.rngState.counterGate = {
    value: null,
    isConfirmed: false,
    source: null,
  }
  input.normalCounters[0] = {
    ...input.normalCounters[0],
    id: `${weaponTypeId}:8`,
    weaponTypeId,
    counter: vector.normalCounter,
    isConfirmed: true,
  }
  input.master = {
    weaponBonusDefinitions: loaded.data.weaponBonusDefinitions,
    weaponTypes: loaded.data.weaponTypes,
    elements: loaded.data.elements,
    bonusTypes: loaded.data.bonusTypes,
    bonusRanks: loaded.data.bonusRanks,
    lotteries: loaded.data.lotteries,
    materialCosts: loaded.data.materialCosts,
  }
  input.calculationContext = {
    gameVersion: loaded.data.manifest.gameVersion,
    masterDataVersion: loaded.data.manifest.dataVersion,
    rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  }

  const target = input.targetWeapons[0]
  target.weaponTypeId = weaponTypeId
  target.elementId = vector.elementId
  target.idealBonuses = new ProductionRngEngine().predictGogmaBonus({ baseSeed: String(vector.baseSeed), weaponTypeId, elementId: vector.elementId, gogmaCounter: input.rngState.gogmaCounter.value!, operation: { type: 'reset_bonuses' }, master: input.master })
  target.practicalBonusConditions = []
  target.alternativeBonusRules = []
  const skills = createProductionPlannerRngEngine().predictSkills({
    baseSeed: String(vector.baseSeed),
    weaponTypeId,
    elementId: vector.elementId,
    skillCounter: 0,
    master: input.master,
  })
  target.idealSkillCondition = { ...skills, matchMode: 'all' }
  target.practicalSkillCondition = { ...skills, matchMode: 'all' }
  input.targetWeaponId = target.id
  return input
}

async function createProductionPlannerInput(): Promise<PlannerInput> {
  const searchInput = createProductionSearchInput()
  const searchResponses: SearchWorkerResponse[] = []
  const searchController = createSearchWorkerController(
    createProductionSearchRngEngine(),
    (response) => searchResponses.push(response),
  )
  const searchRequest: SearchWorkerRequest = {
    type: 'candidate_search',
    requestId: searchInput.searchRunId,
    input: searchInput,
  }
  await searchController.handleMessage(structuredClone(searchRequest))
  const searchResult = searchResponses.find(
    (response): response is Extract<SearchWorkerResponse, { type: 'candidate_search_result' }> =>
      response.type === 'candidate_search_result',
  )
  if (!searchResult) throw new Error('Production Search did not provide the Planner smoke Candidate.')
  const candidate = candidatesOf(searchResult.result.targetResult).find(
    ({ restorationBonusScope }) => restorationBonusScope === 'gogma_artian',
  )
  if (!candidate) throw new Error('Production Search did not find the expected Gogma-scope Ideal Candidate.')
  // B5-F1: conversion preserves the game-verified Normal slots, so this
  // unchanged two-operation smoke route is Practical even with exact labels.
  expect(candidate).toMatchObject({
    finalBonuses: searchInput.targetWeapons[0].idealBonuses,
    estimatedOperationCount: 3,
    restorationBonusScope: 'gogma_artian',
  })
  const target = searchInput.targetWeapons[0]
  const entry = createBuildListEntry(candidate, target, {
    createdAt: '2026-09-01T00:00:00.000Z',
  })
  return {
    rngState: searchInput.rngState,
    normalCounters: searchInput.normalCounters,
    ownedWeapons: searchInput.ownedWeapons,
    targetWeapons: searchInput.targetWeapons,
    buildListEntries: [entry],
    calculationContext: searchInput.calculationContext,
    options: { ...defaultPlannerOptions },
    master: {
      weaponBonusDefinitions: searchInput.master.weaponBonusDefinitions,
      weaponTypes: searchInput.master.weaponTypes,
      elements: searchInput.master.elements,
      bonusTypes: searchInput.master.bonusTypes,
      bonusRanks: searchInput.master.bonusRanks,
      lotteries: searchInput.master.lotteries,
      materialCosts: searchInput.master.materialCosts,
    },
    conflictResolutions: [],
  }
}

describe('Production Planner Worker composition', () => {
  it('creates ProductionRngEngine rather than UnavailableRngEngine', () => {
    const engine = createProductionPlannerRngEngine()
    expect(engine).toBeInstanceOf(ProductionRngEngine)
    expect(engine).not.toBeInstanceOf(UnavailableRngEngine)
    expect(engine.version).toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })

  it('creates a plan for a game-verified Bow Fire Normal route through Production RNG', async () => {
    const input = await createProductionPlannerInput()
    const responses: PlannerWorkerProtocolResponse[] = []
    const dependencies = createProductionPlannerWorkerDependencies()
    const controller = createPlannerWorkerController(
      dependencies,
      createProductionPlannerWorkerCalculations(),
      (response) => responses.push(response),
    )
    const request: PlannerWorkerProtocolRequest = {
      type: 'create_plan',
      requestId: 'planner.production.smoke',
      generation: 1,
      input,
    }

    expect(structuredClone(request)).toEqual(request)
    expect(request).not.toHaveProperty('rngEngine')
    expect(input).not.toHaveProperty('rngEngine')
    await controller.handleMessage(structuredClone(request))

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = responses.find(
      (response): response is Extract<PlannerWorkerProtocolResponse, { type: 'create_plan_result' }> =>
        response.type === 'create_plan_result',
    )
    expect(result?.result.plan).toEqual(expect.objectContaining({
      calculationContext: expect.objectContaining({
        rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      }),
      selectedBuildListEntryIds: [input.buildListEntries[0].id],
      steps: expect.arrayContaining([
        expect.objectContaining({ operationType: 'create_normal_artian' }),
        expect.objectContaining({ operationType: 'convert_normal_to_gogma' }),
      ]),
    }))
  })
})

function interactionFixture() {
  const targets = [target('target.interaction.a'), target('target.interaction.b'), target('target.interaction.excluded')]
  const sources = [sourceWeapon('owned.interaction.a'), sourceWeapon('owned.interaction.b'), sourceWeapon('owned.interaction.excluded')]
  const entries = targets.map((goal, index) =>
    routeEntry(`entry.interaction.${index}`, goal, resetRoute(sources[index].id)),
  )
  const scenario = beamFixture(targets, entries, sources)
  // Persisted isStale is still false: current Domain validation must exclude it.
  targets[2].priority = 5
  return { ...scenario, entries }
}

describe('Production Worker interaction projection (B10-B1)', () => {
  it('projects only validated IDs, excluded diagnostics and current initial Conflicts', () => {
    const { input, dependencies, entries } = interactionFixture()
    const initial = preparePlannerInitialContext(input, dependencies)
    expect(initial.status).toBe('ready')
    if (initial.status !== 'ready') throw new Error('Expected ready fixture')
    const conflict = initial.context.initialConflictDetection.conflicts[0]
    expect(initial.context.initialConflictDetection.conflicts).toHaveLength(1)
    input.conflictResolutions = [{ conflictKey: conflict.id, selectedBuildListEntryId: entries[1].id }]
    const prepared = preparePlannerInitialContext(input, dependencies)
    if (prepared.status !== 'ready') throw new Error('Expected ready resolved fixture')
    expect(prepared.context.initialConflictDetection.conflicts[0].selectedBuildListEntryId).toBe(entries[1].id)
    expect(prepared.context.initialConflictDetection.conflicts[0].recommendedBuildListEntryId).not.toBeNull()
    const before = structuredClone(input)
    const result = createProductionPlannerWorkerCalculations().prepareInteraction(input, dependencies)
    expect(result).toEqual({
      status: 'ready',
      validBuildListEntryIds: [entries[0].id, entries[1].id],
      excludedBuildListEntries: [{
        buildListEntryId: entries[2].id,
        reason: prepared.context.excludedBuildListEntries[0].reason,
      }],
      currentConflicts: [{
        id: conflict.id,
        buildListEntryIds: [entries[0].id, entries[1].id],
        checkpointParticipants: [],
      }],
    })
    expect(result.status === 'ready' && result.validBuildListEntryIds)
      .toEqual(prepared.context.validBuildListEntries.map(({ entry }) => entry.id))
    expect(structuredClone(result)).toEqual(result)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(input).toEqual(before)
  })

  it('uses shareability while retaining validation-valid IDs without Route unit plans', () => {
    const goalA = target('target.interaction.shared.a')
    const goalB = target('target.interaction.shared.b')
    const source = sourceWeapon('owned.interaction.shared')
    const entries = [
      routeEntry('entry.interaction.shared.a', goalA, resetRoute(source.id)),
      routeEntry('entry.interaction.shared.b', goalB, resetRoute(source.id)),
    ]
    const { input, dependencies } = beamFixture([goalA, goalB], entries, [source])
    const calculate = createProductionPlannerWorkerCalculations().prepareInteraction
    // Same counter and same shareable physical action are not a Conflict.
    expect(calculate(input, dependencies)).toEqual({
      status: 'ready', validBuildListEntryIds: entries.map(({ id }) => id),
      excludedBuildListEntries: [], currentConflicts: [],
    })
    // Validation-valid entries need not have usable Route unit plans. Their IDs
    // still come from validBuildListEntries, never allSearchEntries or raw input.
    for (const entry of entries) {
      const operation = entry.candidateSnapshot.route.operations[0]
      if (operation.type !== 'reset_bonuses') throw new Error('Expected Reset fixture')
      operation.gogmaCounterAfter += 1
    }
    const prepared = preparePlannerInitialContext(input, dependencies)
    if (prepared.status !== 'ready') throw new Error('Expected ready fixture')
    expect(prepared.context.allSearchEntries).toEqual([])
    expect(prepared.context.validBuildListEntries).toHaveLength(2)
    expect(calculate(input, dependencies)).toEqual({
      status: 'ready', validBuildListEntryIds: entries.map(({ id }) => id),
      excludedBuildListEntries: [], currentConflicts: [],
    })
  })

  it.each(['validation', 'initial_inventory'] as const)(
    'preserves typed invalid %s issues, warnings and exclusion diagnostics without repair',
    (failure) => {
      const { input, dependencies, entries } = interactionFixture()
      if (failure === 'validation') {
        input.options.beamWidth = 0
      } else {
        input.ownedWeapons.push(structuredClone(input.ownedWeapons[0]))
      }
      const expected = preparePlannerInitialContext(input, dependencies)
      if (expected.status !== 'invalid') throw new Error('Expected invalid fixture')
      expect(expected.issues.length).toBeGreaterThan(0)
      expect(expected.warnings.length).toBeGreaterThan(0)
      expect(expected.excludedBuildListEntries.map(({ entry }) => entry.id)).toEqual([entries[2].id])
      const before = structuredClone(input)
      const result = createProductionPlannerWorkerCalculations().prepareInteraction(input, dependencies)
      expect(result).toEqual({
        status: 'invalid',
        issues: expected.issues,
        warnings: expected.warnings,
        excludedBuildListEntries: expected.excludedBuildListEntries.map(
          ({ entry, reason }) => ({ buildListEntryId: entry.id, reason }),
        ),
      })
      expect(structuredClone(result)).toEqual(result)
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
      expect(input).toEqual(before)
    },
  )

  it.each(['protection', 'capability', 'prediction_support'] as const)(
    'reflects the existing %s exclusion authority',
    (failure) => {
      const { input, dependencies } = interactionFixture()
      if (failure === 'protection') {
        input.ownedWeapons[0].isProtected = true
      } else if (failure === 'capability') {
        dependencies.rngEngine.capabilities.supportsGogmaPrediction = false
      } else {
        vi.spyOn(dependencies.rngEngine, 'getPredictionSupport').mockReturnValue({
          supported: false, reason: 'reference_adapter_unsupported',
        })
      }
      const expected = preparePlannerInitialContext(input, dependencies)
      if (expected.status !== 'ready') throw new Error('Expected ready fixture')
      expect(expected.context.excludedBuildListEntries.length).toBeGreaterThan(1)
      const result = createProductionPlannerWorkerCalculations().prepareInteraction(input, dependencies)
      expect(result).toEqual({
        status: 'ready',
        validBuildListEntryIds: expected.context.validBuildListEntries.map(({ entry }) => entry.id),
        excludedBuildListEntries: expected.context.excludedBuildListEntries.map(
          ({ entry, reason }) => ({ buildListEntryId: entry.id, reason }),
        ),
        currentConflicts: [],
      })
    },
  )

  it('prepares real Production input inside the Worker without creating a Plan or progress', async () => {
    const input = await createProductionPlannerInput()
    const before = structuredClone(input)
    const dependencies = createProductionPlannerWorkerDependencies()
    const createPlanId = vi.spyOn(dependencies.idFactory, 'productionPlanId')
    const clock = vi.spyOn(dependencies.clock, 'now')
    const responses: PlannerWorkerProtocolResponse[] = []
    const controller = createPlannerWorkerController(
      dependencies, createProductionPlannerWorkerCalculations(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'prepare_interaction', requestId: 'production.interaction', generation: 1,
      input: structuredClone(input),
    })
    expect(responses).toEqual([{
      type: 'prepare_interaction_result', requestId: 'production.interaction', generation: 1,
      result: {
        status: 'ready', validBuildListEntryIds: [input.buildListEntries[0].id],
        excludedBuildListEntries: [], currentConflicts: [],
      },
    }])
    expect(createPlanId).not.toHaveBeenCalled()
    expect(clock).not.toHaveBeenCalled()
    expect(input).toEqual(before)
  })
})
