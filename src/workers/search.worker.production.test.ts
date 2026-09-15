import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  ElementId,
  WeaponTypeId,
} from '../domain/models/publicTypes'
import {
  ProductionRngEngine,
  PRODUCTION_RNG_ENGINE_VERSION,
} from '../domain/rng/production/productionRngEngine'
import type { RngEngine, RngPredictionSupport, RngPredictionSupportInput } from '../domain/rng/rngEngine'
import { UnavailableRngEngine } from '../domain/rng/unavailableRngEngine'
import type {
  CandidateSearchInput,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '../domain/search'
import { createCandidateSearchInput, candidatesOf } from '../test/fixtures/candidateSearch'
import {
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedBowPoisonNormalVectors,
  gameVerifiedSwitchAxeFireNormalVectors,
} from '../test/fixtures/gameVerifiedNormalVectors'
import { createSearchWorkerController } from './search.worker'
import { createProductionSearchRngEngine } from './search.worker.production'

function createProductionSearchInput(
  weaponTypeId: WeaponTypeId = 'weapon.bow',
  elementId: ElementId = gameVerifiedBowElementalNormalVectors[0].elementId,
): CandidateSearchInput {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
  const vector = { ...gameVerifiedBowElementalNormalVectors[0], elementId }
  const input = createCandidateSearchInput()
  input.searchRunId = `production-search.${weaponTypeId}.${elementId}`
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
    artianBonusTypeMappings: loaded.data.artianBonusTypeMappings,
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
  const skills = createProductionSearchRngEngine().predictSkills({
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

/**
 * The Production Engine with Normal prediction declared unsupported for every
 * input. Every real weapon type now has a Production Normal pool, so the
 * fail-closed path (a confirmed Counter whose prediction alone is unavailable)
 * is exercised through this stub rather than through a real weapon type.
 */
class NormalPredictionUnsupportedEngine extends ProductionRngEngine {
  override getPredictionSupport(input: RngPredictionSupportInput): RngPredictionSupport {
    if (input.type === 'normal_artian') return { supported: false, reason: 'normal_pool_unverified' }
    return super.getPredictionSupport(input)
  }
}

async function runProductionSearch(input: CandidateSearchInput, engine: RngEngine = createProductionSearchRngEngine()) {
  const responses: SearchWorkerResponse[] = []
  const controller = createSearchWorkerController(
    engine,
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
    expect(result.targetResult.searchedRoutes)
      .toContain('normal_artian_to_gogma')
    expect(candidatesOf(result.targetResult)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        restorationBonusScope: 'gogma_artian',
        estimatedOperationCount: 3,
        finalBonuses: input.targetWeapons[0].idealBonuses,
        route: expect.objectContaining({ kind: 'normal_artian_to_gogma' }),
      }),
    ]))
  })

  it('predicts a Bow Poison Normal route from the Table B pool, so a Keep on the forged slots reaches an Ideal the Table A families could not', async () => {
    const input = createProductionSearchInput('weapon.bow', 'element.poison')
    const engine = createProductionSearchRngEngine()
    const baseSeed = '51231782'
    const forge = (elementId: ElementId) => engine.predictNormalArtian({
      baseSeed, weaponTypeId: 'weapon.bow', elementId, rarity: 8, normalCounter: 0, master: input.master,
    })
    // Counter 0 forges: Poison draws the direct game observation of the Table B
    // pool [6, 8] (no Element), Fire the Table A observation (with Element).
    const poisonForged = forge('element.poison')
    expect(poisonForged).toEqual(gameVerifiedBowPoisonNormalVectors[0].bonuses)
    expect(poisonForged.map((bonus) => bonus.bonusTypeId)).not.toContain('bonus_type.element')
    const fireForged = forge('element.fire')
    expect(fireForged).toEqual(gameVerifiedBowElementalNormalVectors[0].bonuses)
    expect(fireForged.map((bonus) => bonus.bonusTypeId)).toContain('bonus_type.element')

    // Keep preserves the family at every slot, so an Ideal built from a Keep on
    // the Table B forge holds no Element family at all; a Table A forge could
    // never Keep into it. This is what the Poison / Paralysis / Sleep pool
    // correction changes for Candidate Search.
    const idealFromPoisonSlots = engine.predictGogmaBonus({
      baseSeed, weaponTypeId: 'weapon.bow', elementId: 'element.poison', gogmaCounter: input.rngState.gogmaCounter.value!,
      operation: { type: 'keep_bonuses', currentBonuses: poisonForged }, master: input.master,
    })
    expect(idealFromPoisonSlots.map((bonus) => bonus.bonusTypeId)).not.toContain('bonus_type.element')
    input.targetWeapons[0].idealBonuses = idealFromPoisonSlots

    const responses = await runProductionSearch(input)
    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = resultResponse(responses).result
    expect(result.targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    expect(result.warnings.some(({ severity }) => severity === 'info')).toBe(false)
    const candidate = candidatesOf(result.targetResult).find(({ route }) =>
      route.kind === 'normal_artian_to_gogma' && route.operations.some((operation) => operation.type === 'keep_bonuses'))
    expect(candidate).toBeDefined()
    expect(candidate!.route.operations.map((operation) => operation.type))
      .toEqual(['create_normal_artian', 'convert_normal_to_gogma', 'keep_bonuses'])
    expect(candidate!.route.operations[0]).toEqual(expect.objectContaining({
      type: 'create_normal_artian', weaponTypeId: 'weapon.bow', rarity: 8, count: 1, normalCounterBefore: 0, normalCounterAfter: 1,
    }))
    expect(candidate!.finalBonuses).toEqual(idealFromPoisonSlots)
    expect(candidate!.restorationBonusScope).toBe('gogma_artian')
  })

  it('searches a Melee Great Sword Normal route with the predicted variant now that the Melee category is supported', async () => {
    const input = createProductionSearchInput('weapon.great_sword')
    const responses = await runProductionSearch(input)

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = resultResponse(responses).result
    expect(result.targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    // Production Normal prediction is now supported for the Melee category, so
    // the predicted variant runs with concrete Normal Counter positions and
    // the forced Reset notice of SEARCH_SPEC 6.1.1 is not emitted.
    expect(result.warnings.some(({ severity }) => severity === 'info')).toBe(false)
    const candidate = candidatesOf(result.targetResult).find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    expect(candidate).toBeDefined()
    expect(candidate?.route.operations[0]).toEqual(expect.objectContaining({
      type: 'create_normal_artian',
      weaponTypeId: 'weapon.great_sword',
      rarity: 8,
      count: 1,
      normalCounterBefore: 0,
      normalCounterAfter: 1,
    }))
    expect(candidate?.estimatedNormalAdvance).toBe(1)
    expect(candidate?.restorationBonusScope).toBe('gogma_artian')
  })

  it('searches a Switch Axe Normal route with the predicted variant through its own single pool', async () => {
    const input = createProductionSearchInput('weapon.switch_axe')
    const engine = createProductionSearchRngEngine()
    const forged = engine.predictNormalArtian({
      baseSeed: '51231782', weaponTypeId: 'weapon.switch_axe', elementId: 'element.fire', rarity: 8, normalCounter: 0, master: input.master,
    })
    // The forge at Counter 0 is the direct game observation (docs/RNG_REFERENCE_AUDIT.md 14.16).
    expect(forged).toEqual(gameVerifiedSwitchAxeFireNormalVectors[0].bonuses)
    // Aim the Target at a Keep on those forged slots, so the Candidate's final
    // bonuses can only come from the fixture families (Sharpness / Sharpness /
    // Affinity / Attack / Element) the Switch Axe pool predicted.
    const idealFromForgedSlots = engine.predictGogmaBonus({
      baseSeed: '51231782', weaponTypeId: 'weapon.switch_axe', elementId: 'element.fire', gogmaCounter: input.rngState.gogmaCounter.value!,
      operation: { type: 'keep_bonuses', currentBonuses: forged }, master: input.master,
    })
    input.targetWeapons[0].idealBonuses = idealFromForgedSlots
    const responses = await runProductionSearch(input, engine)

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = resultResponse(responses).result
    expect(result.calculationContext.rngEngineVersion).toBe('production-rng:c5-e7')
    expect(result.targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    // Production Normal prediction is supported, so the predicted variant runs
    // with concrete Normal Counter positions: no forced Reset notice and no
    // normal_pool_unverified skip.
    expect(result.warnings.some(({ severity }) => severity === 'info')).toBe(false)
    expect(JSON.stringify(result.warnings)).not.toContain('normal_pool_unverified')
    expect(result.targetResult.skippedRoutes.some(({ route }) => route === 'normal_artian_to_gogma')).toBe(false)
    const candidate = candidatesOf(result.targetResult).find(({ route }) =>
      route.kind === 'normal_artian_to_gogma' && route.operations.some((operation) => operation.type === 'keep_bonuses'))
    expect(candidate).toBeDefined()
    expect(candidate!.route.operations.map((operation) => operation.type))
      .toEqual(['create_normal_artian', 'convert_normal_to_gogma', 'keep_bonuses'])
    expect(candidate!.finalBonuses).toEqual(idealFromForgedSlots)
    expect(candidate?.route.operations[0]).toEqual(expect.objectContaining({
      type: 'create_normal_artian',
      weaponTypeId: 'weapon.switch_axe',
      rarity: 8,
      count: 1,
      normalCounterBefore: 0,
      normalCounterAfter: 1,
    }))
    expect(candidate?.estimatedNormalAdvance).toBe(1)
    expect(candidate?.restorationBonusScope).toBe('gogma_artian')
  })

  it('skips a Normal input the Engine declares unsupported without a Worker error', async () => {
    const input = createProductionSearchInput('weapon.great_sword')
    const responses = await runProductionSearch(input, new NormalPredictionUnsupportedEngine())

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const result = resultResponse(responses).result
    const targetResult = result.targetResult
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
    expect(candidatesOf(targetResult).every(({ route }) =>
      route.operations.every((operation) =>
        operation.type !== 'create_normal_artian' ||
        operation.normalCounterBefore === null,
      ),
    )).toBe(true)
  })

  it('creates a forced Reset Production Candidate without Normal prediction', async () => {
    const input = createProductionSearchInput('weapon.great_sword')
    const responses = await runProductionSearch(input, new NormalPredictionUnsupportedEngine())

    expect(responses.some(({ type }) => type === 'error')).toBe(false)
    const targetResult = resultResponse(responses).result.targetResult
    expect(targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    const candidate = candidatesOf(targetResult).find(
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
