import { describe, expect, it, vi } from 'vitest'
import type { OwnedGogmaArtianWeapon, RestorationBonusSet } from '../models/publicTypes'
import type {
  GogmaBonusPredictionInput,
  RngEngine,
  RngPredictionSupport,
  RngPredictionSupportInput,
} from '../rng/rngEngine'
import { searchCandidates } from './candidateSearch'
import {
  belowPracticalBonuses,
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import {
  createRestorationBonusSet,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

type EngineOverrides = Partial<Pick<
  RngEngine,
  'getPredictionSupport' | 'predictGogmaBonus' | 'predictSkills' | 'predictNormalArtian'
>>

function overrideEngine(engine: RngEngine, overrides: EngineOverrides): RngEngine {
  return {
    version: engine.version,
    capabilities: engine.capabilities,
    getPredictionSupport: overrides.getPredictionSupport
      ?? engine.getPredictionSupport.bind(engine),
    normalizeSeed: engine.normalizeSeed.bind(engine),
    predictGogmaBonus: overrides.predictGogmaBonus
      ?? engine.predictGogmaBonus.bind(engine),
    predictSkills: overrides.predictSkills ?? engine.predictSkills.bind(engine),
    predictNormalArtian: overrides.predictNormalArtian
      ?? engine.predictNormalArtian.bind(engine),
    advanceGogmaCounter: engine.advanceGogmaCounter.bind(engine),
    advanceSkillCounter: engine.advanceSkillCounter.bind(engine),
    advanceNormalCounter: engine.advanceNormalCounter.bind(engine),
  }
}

function orderedBonusKey(bonuses: RestorationBonusSet): string {
  return JSON.stringify(bonuses)
}

function swapBonuses(
  bonuses: RestorationBonusSet,
  left: number,
  right: number,
): RestorationBonusSet {
  const result = structuredClone(bonuses)
  const leftBonus = result[left]
  const rightBonus = result[right]
  if (!leftBonus || !rightBonus) throw new Error('Fixture bonus index is invalid')
  result[left] = rightBonus
  result[right] = leftBonus
  return result
}

describe('Candidate Search input-level RNG support', () => {
  it('skips only an unsupported Normal target and continues supported targets', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = []
    const supportedTarget = input.targetWeapons[0]
    const unsupportedTarget = {
      ...structuredClone(supportedTarget),
      id: targetWeaponId('target.fixture.unsupported-normal'),
      weaponTypeId: 'weapon.fixture.unsupported-normal',
      priority: 5 as const,
    }
    input.targetWeapons = [supportedTarget, unsupportedTarget]
    input.targetWeaponIds = [unsupportedTarget.id, supportedTarget.id]
    input.normalCounters.push({
      ...structuredClone(input.normalCounters[0]),
      id: `${unsupportedTarget.weaponTypeId}:8`,
      weaponTypeId: unsupportedTarget.weaponTypeId,
    })

    const delegate = createCandidateSearchEngine(input)
    const predictNormalArtian = vi.fn(delegate.predictNormalArtian.bind(delegate))
    const engine = overrideEngine(delegate, {
      getPredictionSupport: (supportInput): RngPredictionSupport =>
        supportInput.type === 'normal_artian' &&
        supportInput.weaponTypeId === unsupportedTarget.weaponTypeId
          ? { supported: false, reason: 'normal_pool_unverified' }
          : delegate.getPredictionSupport(supportInput),
      predictNormalArtian,
    })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const unsupported = result.targetResults.find(
      ({ targetWeaponId }) => targetWeaponId === unsupportedTarget.id,
    )
    const supported = result.targetResults.find(
      ({ targetWeaponId }) => targetWeaponId === supportedTarget.id,
    )

    expect(unsupported?.candidates).toEqual([])
    expect(unsupported?.skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'normal_artian_to_gogma',
      reason: 'normal_prediction_unsupported',
    }))
    expect(supported?.candidates).not.toHaveLength(0)
    expect(predictNormalArtian).toHaveBeenCalledTimes(1)
    expect(predictNormalArtian).toHaveBeenCalledWith(expect.objectContaining({
      weaponTypeId: supportedTarget.weaponTypeId,
    }))

    const conversion = supported?.candidates[0]?.route.operations.find(
      ({ type }) => type === 'convert_normal_to_gogma',
    )
    expect(conversion).toEqual(expect.objectContaining({
      skillCounterBefore: 7,
      skillCounterAfter: 8,
    }))
    expect(supported?.candidates[0]).toEqual(expect.objectContaining({
      estimatedNormalAdvance: 1,
      estimatedSkillAdvance: 1,
      estimatedGogmaAdvance: 0,
    }))
  })

  it('excludes unsupported Skill routes without failing supported Reset routes', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
    const delegate = createCandidateSearchEngine(input, {
      resetResult: createRestorationBonusSet(),
    })
    const engine = overrideEngine(delegate, {
      getPredictionSupport: (supportInput): RngPredictionSupport =>
        supportInput.type === 'skill'
          ? { supported: false, reason: 'reference_adapter_unsupported' }
          : delegate.getPredictionSupport(supportInput),
    })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const targetResult = result.targetResults[0]

    expect(targetResult.skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'existing_gogma_reset_skills',
      reason: 'skill_prediction_unsupported',
    }))
    expect(targetResult.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route: expect.objectContaining({ kind: 'existing_gogma_reset_bonuses' }),
      }),
    ]))
  })

  it('does not infer Mixed searched from separately searched Reset and Keep routes', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.settings.maxGogmaAdvance = 1
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
    const delegate = createCandidateSearchEngine(input, {
      resetResult: createRestorationBonusSet(),
      keepResult: createRestorationBonusSet(),
      keepSupported: true,
    })
    const engine = overrideEngine(delegate, {
      getPredictionSupport: (supportInput): RngPredictionSupport =>
        supportInput.type === 'skill'
          ? { supported: false, reason: 'reference_adapter_unsupported' }
          : delegate.getPredictionSupport(supportInput),
    })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const targetResult = result.targetResults[0]

    expect(targetResult.searchedRoutes).toContain('existing_gogma_reset_bonuses')
    expect(targetResult.searchedRoutes).toContain('existing_gogma_keep_bonuses')
    expect(targetResult.searchedRoutes).not.toContain('existing_gogma_mixed')
    expect(targetResult.skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'existing_gogma_mixed',
      reason: 'skill_prediction_unsupported',
    }))
    expect(targetResult.skippedRoutes).not.toContainEqual(expect.objectContaining({
      route: 'existing_gogma_mixed',
      reason: 'keep_prediction_unsupported',
    }))
  })

  it('keeps supported Keep routes searchable when Reset Master support is unavailable', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
    const delegate = createCandidateSearchEngine(input, {
      keepSupported: true,
      keepResult: createRestorationBonusSet(),
    })
    const engine = overrideEngine(delegate, {
      getPredictionSupport: (supportInput): RngPredictionSupport =>
        supportInput.type === 'gogma_reset'
          ? { supported: false, reason: 'master_data_unavailable' }
          : delegate.getPredictionSupport(supportInput),
    })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const targetResult = result.targetResults[0]

    expect(targetResult.skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'existing_gogma_reset_bonuses',
      reason: 'master_data_unavailable',
    }))
    expect(targetResult.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route: expect.objectContaining({ kind: 'existing_gogma_keep_bonuses' }),
      }),
    ]))
  })

  it('isolates unsupported Keep sources while preserving supported Keep and Reset branches', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    // Keep every supported source in the Practical set; B4 retains only one Ideal.
    input.targetWeapons[0].idealSkillCondition.groupSkillId = 'group.unreached'
    const sourceA = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
    sourceA.id = ownedWeaponId('owned.fixture.keep-a')
    sourceA.isProtected = false
    sourceA.restorationBonusScope = 'gogma_artian'
    // Below Ideal, so every source still searches Bonus amendments; the slot
    // families stay distinct so A, B and C keep different family layouts.
    sourceA.restorationBonuses = practicalOnlyBonuses()
    const sourceB = {
      ...structuredClone(sourceA),
      id: ownedWeaponId('owned.fixture.keep-b'),
      restorationBonuses: swapBonuses(sourceA.restorationBonuses, 0, 2),
    }
    const sourceC = {
      ...structuredClone(sourceA),
      id: ownedWeaponId('owned.fixture.keep-c'),
      restorationBonuses: swapBonuses(sourceA.restorationBonuses, 1, 3),
    }
    input.ownedWeapons = [sourceA, sourceB, sourceC]

    const delegate = createCandidateSearchEngine(input, {
      keepSupported: true,
      resetResult: createRestorationBonusSet(),
    })
    delegate.capabilities.supportsSkillPrediction = false
    const keepPredictionKeys: string[] = []
    const predictGogmaBonus = vi.fn((predictionInput: GogmaBonusPredictionInput) => {
      if (predictionInput.operation.type === 'keep_bonuses') {
        keepPredictionKeys.push(orderedBonusKey(predictionInput.operation.currentBonuses))
        return createRestorationBonusSet()
      }
      return delegate.predictGogmaBonus(predictionInput)
    })
    const unsupportedKey = orderedBonusKey(sourceB.restorationBonuses)
    const engine = overrideEngine(delegate, {
      getPredictionSupport: (supportInput): RngPredictionSupport =>
        supportInput.type === 'gogma_keep' &&
        orderedBonusKey(supportInput.currentBonuses) === unsupportedKey
          ? { supported: false, reason: 'unsupported_current_bonus' }
          : delegate.getPredictionSupport(supportInput),
      predictGogmaBonus,
    })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const targetResult = result.targetResults[0]
    const keepSourceIds = targetResult.candidates
      .filter(({ route }) => route.operations[0]?.type === 'keep_bonuses')
      .map(({ route }) => route.sourceOwnedWeaponId)
    const resetSourceIds = targetResult.candidates
      .filter(({ route }) => route.operations[0]?.type === 'reset_bonuses')
      .map(({ route }) => route.sourceOwnedWeaponId)

    expect(keepSourceIds).toEqual(expect.arrayContaining([sourceA.id, sourceC.id]))
    expect(keepSourceIds).not.toContain(sourceB.id)
    expect(resetSourceIds).toContain(sourceB.id)
    expect(keepPredictionKeys).toEqual(expect.arrayContaining([
      orderedBonusKey(sourceA.restorationBonuses),
      orderedBonusKey(sourceC.restorationBonuses),
    ]))
    expect(keepPredictionKeys).not.toContain(unsupportedKey)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      targetWeaponId: input.targetWeapons[0].id,
      message: expect.stringContaining(String(sourceB.id)),
    }))
  })

  it('propagates unexpected getPredictionSupport failures', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = []
    const delegate = createCandidateSearchEngine(input)
    const failure = new Error('unexpected support failure')
    const engine = overrideEngine(delegate, {
      getPredictionSupport: (supportInput: RngPredictionSupportInput) => {
        if (supportInput.type === 'normal_artian') throw failure
        return delegate.getPredictionSupport(supportInput)
      },
    })

    await expect(searchCandidates(input, engine, deterministicExecution)).rejects.toBe(failure)
  })

  it('propagates unexpected predictor failures after support succeeds', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = []
    const delegate = createCandidateSearchEngine(input)
    const failure = new Error('unexpected prediction failure')
    const engine = overrideEngine(delegate, {
      predictNormalArtian: () => { throw failure },
    })

    await expect(searchCandidates(input, engine, deterministicExecution)).rejects.toBe(failure)
  })
})
