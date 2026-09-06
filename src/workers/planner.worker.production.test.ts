import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { describe, expect, it } from 'vitest'
import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  RestorationBonusSet,
  WeaponTypeId,
} from '../domain/models/publicTypes'
import {
  createProductionPlan,
  defaultPlannerOptions,
  type PlannerInput,
  type PlannerWorkerRequest,
  type PlannerWorkerResponse,
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
import { createCandidateSearchInput } from '../test/fixtures/candidateSearch'
import { gameVerifiedBowElementalNormalVectors } from '../test/fixtures/gameVerifiedNormalVectors'
import { createPlannerWorkerController } from './planner.worker'
import {
  createProductionPlannerRngEngine,
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
  target.idealBonuses = vector.bonuses.map((bonus) => ({ ...bonus })) as RestorationBonusSet
  target.practicalBonusConditions = []
  target.practicalAlternativeGroups = []
  const skills = createProductionPlannerRngEngine().predictSkills({
    baseSeed: String(vector.baseSeed),
    weaponTypeId,
    elementId: vector.elementId,
    skillCounter: 0,
    master: input.master,
  })
  target.idealSkillCondition = { ...skills, matchMode: 'all' }
  target.practicalSkillCondition = { ...skills, matchMode: 'all' }
  input.targetWeaponIds = [target.id]
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
  const candidate = searchResult.result.targetResults[0].candidates.find(
    ({ category, restorationBonusScope }) => category === 'practical' && restorationBonusScope === 'normal_artian',
  )
  if (!candidate) throw new Error('Production Search did not find the expected normal-scope Practical Candidate.')
  // B5-F1: conversion preserves the game-verified Normal slots, so this
  // unchanged two-operation smoke route is Practical even with exact labels.
  expect(candidate).toMatchObject({
    finalBonuses: searchInput.targetWeapons[0].idealBonuses,
    estimatedOperationCount: 2,
    restorationBonusScope: 'normal_artian',
    category: 'practical',
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
    const responses: PlannerWorkerResponse[] = []
    const dependencies = createProductionPlannerWorkerDependencies()
    const controller = createPlannerWorkerController(
      dependencies,
      createProductionPlan,
      (response) => responses.push(response),
    )
    const request: PlannerWorkerRequest = {
      type: 'create_plan',
      requestId: 'planner.production.smoke',
      input,
    }

    expect(structuredClone(request)).toEqual(request)
    expect(request).not.toHaveProperty('rngEngine')
    expect(input).not.toHaveProperty('rngEngine')
    await controller.handleMessage(structuredClone(request))

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = responses.find(
      (response): response is Extract<PlannerWorkerResponse, { type: 'create_plan_result' }> =>
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
