import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  RestorationBonusSet,
  WeaponTypeId,
} from '../domain/models/publicTypes'
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
import { createSearchWorkerController } from './search.worker'
import { createProductionSearchRngEngine } from './search.worker.production'

function createProductionSearchInput(
  weaponTypeId: WeaponTypeId = 'weapon.bow',
): CandidateSearchInput {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
  const vector = gameVerifiedBowElementalNormalVectors[0]
  const input = createCandidateSearchInput()
  input.searchRunId = `production-search.${weaponTypeId}`
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
  const skills = createProductionSearchRngEngine().predictSkills({
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

function resultResponse(
  responses: SearchWorkerResponse[],
): Extract<SearchWorkerResponse, { type: 'candidate_search_result' }> {
  const response = responses.find(
    (item): item is Extract<SearchWorkerResponse, { type: 'candidate_search_result' }> =>
      item.type === 'candidate_search_result',
  )
  if (!response) throw new Error('Candidate Search Worker did not return a result')
  return response
}

async function runProductionSearch(input: CandidateSearchInput) {
  const responses: SearchWorkerResponse[] = []
  const controller = createSearchWorkerController(
    createProductionSearchRngEngine(),
    (response) => responses.push(response),
  )
  const request: SearchWorkerRequest = {
    type: 'candidate_search',
    requestId: input.searchRunId,
    input,
  }
  await controller.handleMessage(structuredClone(request))
  return responses
}

describe('Production Candidate Search Worker composition', () => {
  it('creates ProductionRngEngine rather than UnavailableRngEngine', () => {
    const engine = createProductionSearchRngEngine()
    expect(engine).toBeInstanceOf(ProductionRngEngine)
    expect(engine).not.toBeInstanceOf(UnavailableRngEngine)
    expect(engine.version).toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(engine.capabilities.supportsSeedSearch).toBe(false)
  })

  it('searches a game-verified Bow Fire Normal route with Production RNG', async () => {
    const input = createProductionSearchInput()
    const responses = await runProductionSearch(input)

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = resultResponse(responses).result
    expect(result.calculationContext.rngEngineVersion)
      .toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(result.targetResults[0].searchedRoutes)
      .toContain('normal_artian_to_gogma')
    expect(result.targetResults[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'practical',
        restorationBonusScope: 'normal_artian',
        estimatedOperationCount: 2,
        finalBonuses: input.targetWeapons[0].idealBonuses,
        route: expect.objectContaining({ kind: 'normal_artian_to_gogma' }),
      }),
    ]))
  })

  it('skips an unsupported Production Normal input without a Worker error', async () => {
    const input = createProductionSearchInput('weapon.great_sword')
    const responses = await runProductionSearch(input)

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = resultResponse(responses).result
    const targetResult = result.targetResults[0]
    // The Production Engine does not support this Normal input, so no predicted
    // Normal offset exists. The forced Reset variant (SEARCH_SPEC 6.1.1) needs
    // no Normal prediction at all and still runs.
    // The Counter is confirmed here: only the prediction is unavailable, so the
    // notice must not claim the Counter is unconfirmed.
    expect(result.warnings).toContainEqual(expect.objectContaining({
      severity: 'info',
      message: expect.stringContaining(
        '通常アーティアの初期復元ボーナス予測を利用できないため、作成直後の復元ボーナスは予測していません。',
      ),
    }))
    const notice = result.warnings.find(({ severity }) => severity === 'info')
    expect(notice?.message).not.toContain('カウンターが未確定')
    expect(notice?.message).not.toContain('normal_prediction_unsupported')
    expect(targetResult.candidates.every(({ route }) =>
      route.operations.every((operation) =>
        operation.type !== 'create_normal_artian' ||
        operation.normalCounterBefore === null,
      ),
    )).toBe(true)
  })

  it('creates a forced Reset Production Candidate without Normal prediction', async () => {
    const input = createProductionSearchInput('weapon.great_sword')
    const responses = await runProductionSearch(input)

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const targetResult = resultResponse(responses).result.targetResults[0]
    expect(targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    const candidate = targetResult.candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    expect(candidate).toBeDefined()
    expect(candidate?.route.operations).toEqual([
      expect.objectContaining({
        type: 'create_normal_artian',
        rarity: 8,
        count: 1,
        normalCounterBefore: null,
        normalCounterAfter: null,
      }),
      expect.objectContaining({ type: 'convert_normal_to_gogma' }),
      expect.objectContaining({ type: 'reset_bonuses', sourceOwnedWeaponId: null }),
    ])
    expect(candidate?.restorationBonusScope).toBe('gogma_artian')
    expect(candidate?.estimatedNormalAdvance).toBeNull()
    expect(candidate?.estimatedSkillAdvance).toBe(1)
    expect(candidate?.estimatedGogmaAdvance).toBe(1)
    expect(candidate?.estimatedOperationCount).toBe(3)
    expect(candidate?.referencedOwnedWeaponsHash).toBeNull()
  })
})
