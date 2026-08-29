import { describe, expect, it } from 'vitest'
import { searchCandidates } from './candidateSearch'
import {
  belowPracticalBonuses,
  createCandidateSearchEngine,
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'

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
    expect(result.targetResults[0].candidates).toEqual([])
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({ reason: 'normal_counter_unconfirmed' }),
    )
  })

  it('skips a Normal route with master_data_unavailable when its Lottery is missing', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.master.lotteries = []
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).toEqual([])
    expect(result.targetResults[0].candidates).toEqual([])
    expect(result.targetResults[0].skippedRoutes).toContainEqual({
      route: 'normal_artian',
      reason: 'master_data_unavailable',
      detail:
        "Normal Artian Lottery master data is unavailable for 'weapon.fixture.a:rare7'.",
    })
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
      'reset_skills',
    ])
    expect(candidate.route.operations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'keep_bonuses' })]),
    )
    expect(candidate.route.operations[2]).toEqual(
      expect.objectContaining({ sourceOwnedWeaponId: null }),
    )
    expect(candidate.referencedOwnedWeaponsHash).toBeNull()
    expect(candidate.searchStateHash).toMatch(/^fnv1a32:/)
    expect(candidate.calculationContext).toEqual(input.calculationContext)
    expect(candidate.searchRunId).toBe(input.searchRunId)
    expect(candidate.estimatedOperationCount).toBe(3)
    expect(candidate.estimatedNormalAdvance).toBe(1)
    expect(candidate.estimatedGogmaAdvance).toBe(1)
    expect(candidate.estimatedSkillAdvance).toBe(1)
  })

  it('does not create candidates below the Practical line', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        gogmaNewResult: belowPracticalBonuses(),
      }),
      deterministicExecution,
    )
    expect(result.targetResults[0].candidates).toEqual([])
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
      createCandidateSearchEngine(input, { gogmaNewResult: practical }),
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
      expect.objectContaining({ reason: 'skill_capability_missing' }),
    )
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
        selection: {
          mode: 'engine_defined',
          engineParameters: { fixture: 'explicit' },
        },
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
      { materialId: 'material.fixture.a', quantity: 5 },
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
      expect.objectContaining({ reason: 'calculation_context_incompatible' }),
      expect.objectContaining({ reason: 'calculation_context_incompatible' }),
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
      expect.objectContaining({ reason: 'disabled_by_filter' }),
    )
  })
})
