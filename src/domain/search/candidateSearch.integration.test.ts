import { describe, expect, it } from 'vitest'
import { searchCandidates } from './candidateSearch'
import {
  belowPracticalBonuses,
  createCandidateSearchEngine,
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import type { NormalArtianCounter, OwnedWeapon } from '../models/publicTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

describe('Candidate Search routes', () => {
  it('skips a Normal route when the relevant Counter is unconfirmed', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters[0].counter = null
    input.normalCounters[0].isConfirmed = false
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].skippedRoutes).not.toContainEqual(expect.objectContaining({ route: 'normal_artian_to_gogma', reason: 'normal_prediction_unsupported' }))
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'normal_artian_to_gogma',
        reason: 'normal_counter_unconfirmed',
      }),
    )
  })

  it.each([6, 7])('does not search a newly-created rarity %i Normal route', async (rarity) => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = [
      {
        ...input.normalCounters[0],
        id: `${input.normalCounters[0].weaponTypeId}:${rarity}`,
        rarity,
      } as unknown as NormalArtianCounter,
    ]
    input.ownedWeapons = []
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'normal_artian_to_gogma',
    )
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'normal_artian_to_gogma',
        reason: 'normal_counter_unconfirmed',
      }),
    )
  })

  it('does not skip a Normal route only because the placeholder LotteryMaster is disabled', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.master.lotteries = []
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).toContain('normal_artian_to_gogma')
    expect(result.targetResults[0].skippedRoutes).not.toContainEqual(expect.objectContaining({ route: 'normal_artian_to_gogma', reason: 'normal_prediction_unsupported' }))

  })

  it('generates an Ideal Normal route entirely from explicit predictions', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates[0]
    expect(candidate.category).toBe('ideal')
    expect(candidate.route.kind).toBe('normal_artian_to_gogma')
    expect(candidate.route.sourceOwnedWeaponId).toBeNull()
    expect(candidate.route.operations.map(({ type }) => type)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
    ])
    expect(candidate.route.operations[0]).toEqual(
      expect.objectContaining({ rarity: 8 }),
    )
    expect(candidate.route.operations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'keep_bonuses' })]),
    )
    expect(candidate.referencedOwnedWeaponsHash).toBeNull()
    expect(candidate.searchStateHash).toMatch(/^fnv1a32:/)
    expect(candidate.calculationContext).toEqual(input.calculationContext)
    expect(candidate.searchRunId).toBe(input.searchRunId)
    expect(candidate.estimatedOperationCount).toBe(2)
    expect(candidate.estimatedNormalAdvance).toBe(1)
    expect(candidate.estimatedGogmaAdvance).toBe(0)
    expect(candidate.estimatedSkillAdvance).toBe(1)
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'owned_normal_artian_to_gogma',
        reason: 'no_owned_weapon_available',
      }),
    )
  })

  it('searches a Normal conversion followed by transient Reset Bonuses', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates.find(({ route }) =>
      route.kind === 'normal_artian_to_gogma' &&
      route.operations.some(({ type }) => type === 'reset_bonuses'),
    )
    expect(candidate?.route.operations.map(({ type }) => type)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
    ])
    expect(candidate?.route.operations[2]).toMatchObject({
      sourceOwnedWeaponId: null,
    })
  })

  it('converts an unprotected owned Normal Artian through explicit Engine fixtures', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const source = input.ownedWeapons[0]
    input.ownedWeapons = [
      {
        ...source,
        kind: 'normal',
        rarity: 8,
        restorationBonuses: createRestorationBonusSet(),
        seriesSkillId: null,
        groupSkillId: null,
        status: null,
        isProtected: false,
      },
    ]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) =>
        route.kind === 'owned_normal_artian_to_gogma' &&
        route.operations.some(({ type }) => type === 'reset_skills'),
    )
    expect(candidate).toBeDefined()
    expect(candidate?.route.sourceOwnedWeaponId).toBe(source.id)
    expect(candidate?.route.operations.map(({ type }) => type)).toEqual([
      'convert_normal_to_gogma',
      'reset_skills',
    ])
    expect(candidate?.route.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create_normal_artian' }),
      ]),
    )
    expect(candidate?.route.operations[1]).toEqual(
      expect.objectContaining({ sourceOwnedWeaponId: null }),
    )
    expect(candidate?.referencedOwnedWeaponsHash).toMatch(/^fnv1a32:/)
    expect(candidate?.estimatedOperationCount).toBe(2)
    expect(result.targetResults[0].searchedRoutes).toContain(
      'owned_normal_artian_to_gogma',
    )
  })

  it('searches an owned Normal conversion followed by transient Reset Bonuses', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const source = {
      ...input.ownedWeapons[0],
      kind: 'normal' as const,
      rarity: 8 as const,
      restorationBonusScope: 'normal_artian' as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }
    input.ownedWeapons = [source]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates.find(({ route }) =>
      route.kind === 'owned_normal_artian_to_gogma' &&
      route.operations.some(({ type }) => type === 'reset_bonuses'),
    )
    expect(candidate?.route.operations.map(({ type }) => type)).toEqual([
      'convert_normal_to_gogma',
      'reset_bonuses',
    ])
    expect(candidate?.route.operations[1]).toMatchObject({
      sourceOwnedWeaponId: null,
    })
  })

  it('does not convert a protected owned Normal Artian', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const source = input.ownedWeapons[0]
    input.ownedWeapons = [
      {
        ...source,
        kind: 'normal',
        rarity: 8,
        seriesSkillId: null,
        groupSkillId: null,
        status: null,
        isProtected: true,
      },
    ]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'owned_normal_artian_to_gogma',
    )
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'owned_normal_artian_to_gogma',
        reason: 'no_unprotected_source_weapon',
      }),
    )
  })

  it.each([6, 7])('does not convert an owned rarity %i Normal Artian', async (rarity) => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const source = input.ownedWeapons[0]
    input.ownedWeapons = [
      {
        ...source,
        kind: 'normal',
        rarity,
        seriesSkillId: null,
        groupSkillId: null,
        status: null,
        isProtected: false,
      } as unknown as OwnedWeapon,
    ]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'owned_normal_artian_to_gogma',
    )
  })

  it('does not create candidates below the Practical line', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        normalResult: belowPracticalBonuses(),
      }),
      deterministicExecution,
    )
    expect(result.targetResults[0].skippedRoutes).not.toContainEqual(expect.objectContaining({ route: 'normal_artian_to_gogma', reason: 'normal_prediction_unsupported' }))
  })

  it('creates a Practical candidate with Similarity attributes', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const practical = createRestorationBonusSet()
    practical[4] = {
      bonusTypeId: 'bonus_type.fixture.critical',
      bonusRankId: 'bonus_rank.fixture.low',
    }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { normalResult: practical }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates[0]
    expect(candidate.category).toBe('practical')
    expect(candidate.idealDifference.matchedBonusCount).toBe(4)
    expect(candidate.similarityScore).toBe(5 / 6)
    expect(candidate.isSimilarToIdeal).toBe(true)
  })

  it('searches Reset Skills from a protected source without Gogma or Keep capability', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = true
    const engine = createCandidateSearchEngine(input)
    engine.capabilities.supportsGogmaPrediction = false
    engine.capabilities.supportsKeepBonusesPrediction = false
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'existing_gogma_reset_skills',
    )
    expect(candidate).toBeDefined()
    expect(candidate?.finalBonuses).toEqual(
      input.ownedWeapons[0].restorationBonuses,
    )
    expect(candidate?.seriesSkillId).toBe('series_skill.fixture.a')
    expect(candidate?.route.sourceOwnedWeaponId).toBe(input.ownedWeapons[0].id)
    expect(candidate?.referencedOwnedWeaponsHash).toMatch(/^fnv1a32:/)
    expect(candidate?.estimatedGogmaAdvance).toBe(0)
    expect(candidate?.estimatedNormalAdvance).toBeNull()
  })

  it('skips Reset Skills when Skill capability is missing', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = true
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { skillSupported: false }),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'existing_gogma_reset_skills',
    )
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'existing_gogma_reset_skills',
        reason: 'skill_prediction_unsupported',
      }),
    )
  })

  it('does not generate Reset Skills or Mixed candidates from an unconfirmed Skill Counter', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.rngState.skillCounter = { value: 7, isConfirmed: false, source: 'manual' }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const targetResult = result.targetResults[0]
    expect(targetResult.searchedRoutes).toContain('existing_gogma_reset_bonuses')
    expect(targetResult.searchedRoutes).not.toContain('existing_gogma_reset_skills')
    expect(targetResult.skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'existing_gogma_reset_skills',
      reason: 'rng_state_unconfirmed',
    }))
    expect(targetResult.candidates.some(({ route }) =>
      route.operations.some(({ type }) => type === 'reset_skills'),
    )).toBe(false)
  })

  it('reports Existing Gogma Mixed as searched only when a concrete mixed operation sequence is explored', async () => {
    const neitherInput = createCandidateSearchInput()
    neitherInput.routeFilter = 'existing_gogma'
    neitherInput.ownedWeapons[0].isProtected = false
    const neitherEngine = createCandidateSearchEngine(neitherInput)
    neitherEngine.capabilities.supportsSkillPrediction = false
    neitherEngine.capabilities.supportsKeepBonusesPrediction = false
    const neither = await searchCandidates(
      neitherInput,
      neitherEngine,
      deterministicExecution,
    )
    expect(neither.targetResults[0].searchedRoutes).toContain(
      'existing_gogma_reset_bonuses',
    )
    expect(neither.targetResults[0].searchedRoutes).not.toContain(
      'existing_gogma_mixed',
    )
    expect(neither.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({ route: 'existing_gogma_mixed' }),
    )
    expect(neither.targetResults[0].candidates.some(({ route }) =>
      route.kind === 'existing_gogma_mixed',
    )).toBe(false)

    const skillInput = createCandidateSearchInput()
    skillInput.routeFilter = 'existing_gogma'
    skillInput.ownedWeapons[0].isProtected = false
    const skill = await searchCandidates(
      skillInput,
      createCandidateSearchEngine(skillInput),
      deterministicExecution,
    )
    expect(skill.targetResults[0].searchedRoutes).toContain(
      'existing_gogma_mixed',
    )

    const keepInput = createCandidateSearchInput()
    keepInput.routeFilter = 'existing_gogma'
    keepInput.ownedWeapons[0].isProtected = false
    const keepEngine = createCandidateSearchEngine(keepInput, { keepSupported: true })
    keepEngine.capabilities.supportsSkillPrediction = false
    const keep = await searchCandidates(keepInput, keepEngine, deterministicExecution)
    expect(keep.targetResults[0].searchedRoutes).toContain('existing_gogma_reset_bonuses')
    expect(keep.targetResults[0].searchedRoutes).toContain('existing_gogma_keep_bonuses')
    expect(keep.targetResults[0].searchedRoutes).not.toContain('existing_gogma_mixed')
    expect(keep.targetResults[0].skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'existing_gogma_mixed',
      reason: 'skill_prediction_unsupported',
    }))
  })

  it('generates Reset Bonuses only from an unprotected source and uses Engine output', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
    const predicted = createRestorationBonusSet()
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: predicted }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'existing_gogma_reset_bonuses',
    )
    expect(candidate?.finalBonuses).toEqual(predicted)
    expect(candidate?.finalBonuses).not.toEqual(
      input.ownedWeapons[0].restorationBonuses,
    )
    expect(candidate?.route.operations[0].type).toBe('reset_bonuses')
  })

  it('excludes protected sources from destructive routes', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = true
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'existing_gogma_reset_bonuses',
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'existing_gogma_keep_bonuses',
    )
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({ reason: 'no_unprotected_source_weapon' }),
    )
  })

  it('uses Engine Keep selections and Engine Keep prediction without copying source bonuses', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonuses = createRestorationBonusSet()
    const predicted = [...createRestorationBonusSet()].reverse() as ReturnType<typeof createRestorationBonusSet>
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        keepSupported: true,
        keepResult: predicted,
        skillSupported: false,
      }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'existing_gogma_keep_bonuses',
    )
    expect(candidate?.finalBonuses).toEqual(predicted)
    expect(candidate?.route.operations[0]).toEqual(
      expect.objectContaining({
        type: 'keep_bonuses',
      }),
    )
  })

  it('reports Keep unsupported instead of constructing a guessed route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'existing_gogma_keep_bonuses',
    )
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({ reason: 'keep_prediction_unsupported' }),
    )
  })

  it('does not start Keep from inherited Normal-scope Gogma bonuses', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonusScope = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        keepSupported: true,
        resetResult: createRestorationBonusSet(),
      }),
      deterministicExecution,
    )
    expect(result.targetResults[0].candidates.some(({ route }) =>
      route.operations[0]?.type === 'keep_bonuses',
    )).toBe(false)
    expect(result.targetResults[0].candidates.some(({ route }) =>
      route.operations.map(({ type }) => type).join(',') === 'reset_bonuses',
    )).toBe(true)
    expect(result.targetResults[0].searchedRoutes).not.toContain(
      'existing_gogma_keep_bonuses',
    )
    expect(result.targetResults[0].searchedRoutes).toContain(
      'existing_gogma_mixed',
    )
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'existing_gogma_keep_bonuses',
        reason: 'normal_scope_requires_reset',
      }),
    )
  })

  it('generates Reset Bonuses then Reset Skills as a concrete Mixed route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].seriesSkillId = 'series_skill.fixture.other'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        resetResult: createRestorationBonusSet(),
      }),
      deterministicExecution,
    )
    const mixed = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'existing_gogma_mixed',
    )
    expect(mixed?.route.operations.map(({ type }) => type)).toEqual([
      'reset_bonuses',
      'reset_skills',
    ])
    expect(mixed?.route.sourceOwnedWeaponId).toBe(input.ownedWeapons[0].id)
  })

  it('generates Keep Bonuses then Reset Skills as the other bounded Mixed route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].seriesSkillId = 'series_skill.fixture.other'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        keepSupported: true,
        resetResult: belowPracticalBonuses(),
        keepResult: createRestorationBonusSet(),
      }),
      deterministicExecution,
    )
    const mixed = result.targetResults[0].candidates.find(
      ({ route }) =>
        route.kind === 'existing_gogma_mixed' &&
        route.operations[0].type === 'keep_bonuses',
    )
    expect(mixed?.route.operations.map(({ type }) => type)).toEqual([
      'keep_bonuses',
      'reset_skills',
    ])
  })

  it('bounds amendment frontier growth while retaining Reset and Keep chains', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.settings.maxGogmaAdvance = 20
    input.calculationContext.rngEngineVersion = 'fake-fixture:bounded-amendment-frontier'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
    const reset = createRestorationBonusSet()
    reset[4] = {
      bonusTypeId: 'bonus_type.fixture.element',
      bonusRankId: 'bonus_rank.fixture.high',
    }
    const keep = structuredClone(reset)
    const firstKeepBonus = keep[0]
    keep[0] = keep[4]
    keep[4] = firstKeepBonus
    input.ownedWeapons[0].restorationBonuses = keep
    const baseSeed = input.rngState.baseSeed.value as string
    const counterGate = input.rngState.counterGate.value as number
    const makePrediction = (
      counter: number,
      operation: FakeRngFixtures['keepBonusPredictions'][number]['input']['operation'],
      result: ReturnType<typeof createRestorationBonusSet>,
    ) => ({
      input: {
        baseSeed,
        gogmaCounter: counter,
        counterGate,
        weaponTypeId: input.targetWeapons[0].weaponTypeId,
        elementId: input.targetWeapons[0].elementId,
        operation,
        master: input.master,
      },
      result,
    })
    const resetBonusPredictions = Array.from({ length: 20 }, (_, index) =>
      makePrediction(10 + index, { type: 'reset_bonuses' }, reset),
    )
    const keepBonusPredictions = Array.from({ length: 20 }, (_, index) => [
      makePrediction(10 + index, { type: 'keep_bonuses', currentBonuses: reset }, keep),
      makePrediction(10 + index, { type: 'keep_bonuses', currentBonuses: keep }, keep),
    ]).flat()
    const engine = new FakeRngEngine({
      version: 'bounded-amendment-frontier',
      capabilities: {
        supportsSeedSearch: false,
        supportsNormalArtianPrediction: false,
        supportsGogmaPrediction: true,
        supportsSkillPrediction: false,
        supportsKeepBonusesPrediction: true,
      },
      normalizedSeeds: [],
      resetBonusPredictions,
      keepBonusPredictions,
      skillPredictions: [],
      normalArtianPredictions: [],
      gogmaCounterAdvances: Array.from({ length: 20 }, (_, index) => [
        { current: 10 + index, operation: { type: 'reset_bonuses' as const }, result: 11 + index },
        { current: 10 + index, operation: { type: 'keep_bonuses' as const }, result: 11 + index },
      ]).flat(),
      skillCounterAdvances: [],
      normalCounterAdvances: [],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates
    expect(candidates.length).toBeGreaterThan(20)
    expect(candidates.length).toBeLessThanOrEqual(160)
    expect(candidates.some(({ route }) =>
      route.operations.map(({ type }) => type).join(',') === 'keep_bonuses,reset_bonuses',
    )).toBe(true)
    expect(candidates.map(({ route }) =>
      route.operations.map(({ type }) => type).join(','),
    )).toContain('reset_bonuses,keep_bonuses')
    for (const [operations, kind] of [
      ['reset_bonuses', 'existing_gogma_reset_bonuses'],
      ['reset_bonuses,reset_bonuses', 'existing_gogma_reset_bonuses'],
      ['keep_bonuses', 'existing_gogma_keep_bonuses'],
      ['keep_bonuses,keep_bonuses', 'existing_gogma_keep_bonuses'],
      ['reset_bonuses,keep_bonuses', 'existing_gogma_mixed'],
      ['keep_bonuses,reset_bonuses', 'existing_gogma_mixed'],
    ]) {
      expect(candidates.some(({ route }) =>
        route.kind === kind &&
        route.operations.map(({ type }) => type).join(',') === operations,
      )).toBe(true)
    }
    for (const operations of [
      'reset_bonuses,reset_bonuses,reset_bonuses',
      'keep_bonuses,keep_bonuses,keep_bonuses',
      'reset_bonuses,keep_bonuses,reset_bonuses',
    ]) {
      expect(candidates.some(({ route }) =>
        route.operations.map(({ type }) => type).join(',') === operations,
      )).toBe(true)
    }
  })

  it('aggregates enabled Material Costs from concrete operations', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.master.materialCosts = [
      {
        id: 'cost.fixture.skill.common',
        operationType: 'reset_skills',
        weaponTypeId: null,
        materialId: 'material.fixture.a',
        quantity: 2,
        isEnabled: true,
      },
      {
        id: 'cost.fixture.convert.weapon',
        operationType: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        materialId: 'material.fixture.a',
        quantity: 3,
        isEnabled: true,
      },
      {
        id: 'cost.fixture.disabled',
        operationType: 'create_normal_artian',
        weaponTypeId: null,
        materialId: 'material.fixture.a',
        quantity: 99,
        isEnabled: false,
      },
    ]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].candidates[0].requiredMaterials).toEqual([
      { materialId: 'material.fixture.a', quantity: 3 },
    ])
  })

  it('returns explicit context-incompatible skips without running routes', async () => {
    const input = createCandidateSearchInput()
    input.calculationContext.rngEngineVersion = 'different-engine'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).toEqual([])
    expect(result.targetResults[0].skippedRoutes).toEqual([
      ...[
        'normal_artian_to_gogma',
        'owned_normal_artian_to_gogma',
        'existing_gogma_reset_bonuses',
        'existing_gogma_keep_bonuses',
        'existing_gogma_reset_skills',
        'existing_gogma_mixed',
      ].map((route) =>
        expect.objectContaining({
          route,
          reason: 'calculation_context_incompatible',
        }),
      ),
    ])
  })

  it('applies route filters and candidate limits deterministically', async () => {
    const input = createCandidateSearchInput()
    input.settings.maxCandidatesPerTarget = 1
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].candidates).toHaveLength(1)
    expect(result.isTruncated).toBe(true)

    input.routeFilter = 'normal_artian'
    const normalOnly = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(normalOnly.targetResults[0].searchedRoutes).toEqual([
      'normal_artian_to_gogma',
    ])
    expect(normalOnly.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'existing_gogma_reset_skills',
        reason: 'disabled_by_filter',
      }),
    )
    expect(
      normalOnly.targetResults[0].skippedRoutes
        .filter(({ reason }) => reason === 'disabled_by_filter')
        .map(({ route }) => route),
    ).toEqual([
      'existing_gogma_reset_bonuses',
      'existing_gogma_keep_bonuses',
      'existing_gogma_reset_skills',
      'existing_gogma_mixed',
    ])

    input.routeFilter = 'existing_gogma'
    const existingOnly = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(
      existingOnly.targetResults[0].skippedRoutes
        .filter(({ reason }) => reason === 'disabled_by_filter')
        .map(({ route }) => route),
    ).toEqual([
      'normal_artian_to_gogma',
      'owned_normal_artian_to_gogma',
    ])
    const overlap = existingOnly.targetResults[0].searchedRoutes.filter(
      (route) =>
        existingOnly.targetResults[0].skippedRoutes.some(
          (skipped) => skipped.route === route,
        ),
    )
    expect(overlap).toEqual([])
  })
})
