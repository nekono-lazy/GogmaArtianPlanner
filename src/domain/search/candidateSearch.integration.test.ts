import { describe, expect, it, vi } from 'vitest'
import { searchCandidates } from './candidateSearch'
import {
  belowPracticalBonuses,
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import type { NormalArtianCounter, OwnedWeapon } from '../models/publicTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import type { RngEngine } from '../rng/rngEngine'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

/** Narrow Engine decorator; the delegate keeps every unmentioned behaviour. */
function overrideEngine(
  engine: RngEngine,
  overrides: Partial<Pick<RngEngine, 'capabilities' | 'predictNormalArtian'>>,
): RngEngine {
  return {
    version: engine.version,
    capabilities: overrides.capabilities ?? engine.capabilities,
    getPredictionSupport: engine.getPredictionSupport.bind(engine),
    normalizeSeed: engine.normalizeSeed.bind(engine),
    predictGogmaBonus: engine.predictGogmaBonus.bind(engine),
    predictSkills: engine.predictSkills.bind(engine),
    predictNormalArtian:
      overrides.predictNormalArtian ?? engine.predictNormalArtian.bind(engine),
    advanceGogmaCounter: engine.advanceGogmaCounter.bind(engine),
    advanceSkillCounter: engine.advanceSkillCounter.bind(engine),
    advanceNormalCounter: engine.advanceNormalCounter.bind(engine),
  }
}

describe('Candidate Search routes', () => {
  it('searches only the forced Reset route when the relevant Counter is unconfirmed', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters[0].counter = null
    input.normalCounters[0].isConfirmed = false
    const predictNormalArtian = vi.fn()
    const result = await searchCandidates(
      input,
      overrideEngine(createCandidateSearchEngine(input, {
        resetResult: createRestorationBonusSet(),
      }), { predictNormalArtian }),
      deterministicExecution,
    )
    const targetResult = result.targetResults[0]
    // The RouteKind is searched, not skipped: the forced Reset variant needs no
    // Normal Artian Counter (SEARCH_SPEC 6.1.1).
    expect(targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    expect(targetResult.skippedRoutes).not.toContainEqual(
      expect.objectContaining({ route: 'normal_artian_to_gogma' }),
    )
    expect(predictNormalArtian).not.toHaveBeenCalled()
    // The fallback succeeded, so it is an informational notice in Japanese and
    // never leaks an internal reason enum into the normal UI.
    const notice = result.warnings.find(({ severity }) => severity === 'info')
    expect(notice?.severity).toBe('info')
    expect(notice?.message).toContain(
      '通常アーティアの初期ボーナスを使わないルートで検索しました。',
    )
    expect(notice?.message).toContain(
      '通常アーティアのカウンターが未確定のため、作成直後の復元ボーナスは予測していません。',
    )
    expect(notice?.message).toContain(
      '通常アーティアを1本作成して巨戟化したあと、復元ボーナスを再抽選して5枠を確定するルートを検索しています。',
    )
    expect(notice?.message).not.toContain('normal_counter_unconfirmed')
    expect(notice?.message).not.toContain('forced Reset Bonuses')
    expect(notice?.message).not.toContain('Normal Artian prediction was unavailable')
    const candidate = targetResult.candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
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
    expect(candidate?.estimatedGogmaAdvance).toBe(1)
    expect(candidate?.referencedOwnedWeaponsHash).toBeNull()
  })

  it('keeps the forced Reset route unavailable without a confirmed Gogma Counter', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters[0].counter = null
    input.normalCounters[0].isConfirmed = false
    input.rngState.gogmaCounter = { value: null, isConfirmed: false, source: null }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain('normal_artian_to_gogma')
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'normal_artian_to_gogma',
        reason: 'normal_counter_unconfirmed',
      }),
    )
  })

  it('keeps the forced Reset route unavailable without a confirmed Skill Counter', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters[0].counter = null
    input.normalCounters[0].isConfirmed = false
    input.rngState.skillCounter = { value: null, isConfirmed: false, source: null }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain('normal_artian_to_gogma')
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'normal_artian_to_gogma',
        reason: 'normal_counter_unconfirmed',
      }),
    )
  })

  it('searches the forced Reset route without Normal Artian prediction support', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    // The Normal Counter is confirmed here: only prediction is unavailable, so
    // the RouteKind falls back to the forced Reset variant (SEARCH_SPEC 6.1.1).
    expect(input.normalCounters[0]).toEqual(
      expect.objectContaining({ counter: 4, isConfirmed: true }),
    )
    const delegate = createCandidateSearchEngine(input, {
      resetResult: createRestorationBonusSet(),
    })
    const result = await searchCandidates(
      input,
      overrideEngine(delegate, {
        capabilities: {
          ...delegate.capabilities,
          supportsNormalArtianPrediction: false,
        },
        predictNormalArtian: vi.fn(() => {
          throw new Error('Normal prediction must not be called.')
        }),
      }),
      deterministicExecution,
    )
    const targetResult = result.targetResults[0]
    expect(targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    expect(targetResult.candidates.some(({ route }) =>
      route.kind === 'normal_artian_to_gogma' &&
      route.operations.some((operation) =>
        operation.type === 'create_normal_artian' &&
        operation.normalCounterBefore === null,
      ),
    )).toBe(true)
  })

  it('never creates more than one Normal Artian on the forced Reset route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    input.settings.maxNormalAdvance = 5
    input.settings.maxGogmaAdvance = 3
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const creations = result.targetResults[0].candidates
      .flatMap(({ route }) => route.operations)
      .filter((operation) => operation.type === 'create_normal_artian')
    expect(creations.length).toBeGreaterThan(0)
    expect(creations.every((operation) =>
      operation.type === 'create_normal_artian' && operation.count === 1,
    )).toBe(true)
  })

  it('produces no Candidate before the forced Reset rewrites the unknown slots', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const candidates = result.targetResults[0].candidates.filter(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(({ route, restorationBonusScope }) =>
      restorationBonusScope === 'gogma_artian' &&
      route.operations.some(({ type }) => type === 'reset_bonuses'),
    )).toBe(true)
  })

  it.each([6, 7])('never uses a rarity %i Normal Counter', async (rarity) => {
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
    const predictNormalArtian = vi.fn()
    const result = await searchCandidates(
      input,
      overrideEngine(createCandidateSearchEngine(input, {
        resetResult: createRestorationBonusSet(),
      }), { predictNormalArtian }),
      deterministicExecution,
    )
    // A rarity 6 / 7 Counter is not a searchable Counter, so no predicted
    // Normal offset exists. Only the forced Reset variant remains, and it
    // creates a rarity 8 weapon while reading no Counter at all.
    expect(predictNormalArtian).not.toHaveBeenCalled()
    const creations = result.targetResults[0].candidates
      .flatMap(({ route }) => route.operations)
      .filter((operation) => operation.type === 'create_normal_artian')
    expect(creations.every((operation) =>
      operation.type === 'create_normal_artian' &&
      operation.rarity === 8 &&
      operation.normalCounterBefore === null,
    )).toBe(true)
  })

  it('keeps the forced Reset route unavailable without Reset Bonuses support', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const delegate = createCandidateSearchEngine(input)
    const result = await searchCandidates(
      input,
      overrideEngine(delegate, {
        capabilities: { ...delegate.capabilities, supportsGogmaPrediction: false },
      }),
      deterministicExecution,
    )
    expect(result.targetResults[0].searchedRoutes).not.toContain('normal_artian_to_gogma')
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'normal_artian_to_gogma',
        reason: 'normal_counter_unconfirmed',
      }),
    )
    // Nothing was searched for this RouteKind, so this one stays a warning, and
    // it explains the cause without naming the internal reason enum.
    expect(result.warnings).toContainEqual(expect.objectContaining({
      severity: 'warning',
      message: expect.stringContaining(
        '通常アーティアの初期ボーナスを使わないルートも実行できなかったため、通常アーティア経由のルートは検索していません。',
      ),
    }))
    expect(result.warnings.some(({ message }) =>
      message.includes('gogma_prediction_unsupported'),
    )).toBe(false)
  })

  it('keeps the owned Normal route on its registered bonuses beside the forced Reset route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const source = input.ownedWeapons[0]
    const registeredBonuses = createRestorationBonusSet()
    input.ownedWeapons = [{
      ...source,
      kind: 'normal',
      rarity: 8,
      restorationBonuses: registeredBonuses,
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    } as OwnedWeapon]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const targetResult = result.targetResults[0]
    expect(targetResult.searchedRoutes).toEqual(expect.arrayContaining([
      'normal_artian_to_gogma',
      'owned_normal_artian_to_gogma',
    ]))
    // The owned Normal route keeps using its registered five slots, so a
    // conversion-only Candidate in `normal_artian` scope still exists.
    expect(targetResult.candidates).toContainEqual(expect.objectContaining({
      restorationBonusScope: 'gogma_artian',
      finalBonuses: createRestorationBonusSet(),
      route: expect.objectContaining({
        kind: 'owned_normal_artian_to_gogma',
        sourceOwnedWeaponId: source.id,
      }),
    }))
    // The blind variant never borrows those registered bonuses.
    expect(targetResult.candidates.every(({ route, restorationBonusScope }) =>
      route.kind !== 'normal_artian_to_gogma' ||
      restorationBonusScope === 'gogma_artian',
    )).toBe(true)
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

  it('generates a Gogma-scope Ideal conversion and Reset route entirely from explicit predictions', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates[0]
    expect(candidate.category).toBe('ideal')
    expect(candidate.restorationBonusScope).toBe('gogma_artian')
    expect(candidate.finalBonuses).toEqual(input.targetWeapons[0].idealBonuses)
    expect(candidate.route.kind).toBe('normal_artian_to_gogma')
    expect(candidate.route.sourceOwnedWeaponId).toBeNull()
    expect(candidate.route.operations.map(({ type }) => type)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
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
    expect(candidate.estimatedOperationCount).toBe(3)
    expect(candidate.estimatedNormalAdvance).toBe(1)
    expect(candidate.estimatedGogmaAdvance).toBe(1)
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
    // These inherited slots satisfy Practical; normal scope still requires
    // a supported amendment to reach Bonus Ideal, even with exact Ideal labels.
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        normalResult: practicalOnlyBonuses(),
        resetResult: createRestorationBonusSet(),
      }),
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
    // The conversion Skill must stay below Ideal, otherwise the Skill stream of
    // this Route is finished and Reset Skills is not searched.
    input.targetWeapons[0].idealSkillCondition = {
      seriesSkillId: 'series_skill.fixture.b',
      groupSkillId: null,
      matchMode: 'all',
    }
    input.targetWeapons[0].practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
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
      // A distinct Reset Skills result, so the stream-local retention keeps the
      // `resetCount = 1` solution instead of folding it into the conversion.
      createCandidateSearchEngine(input, {
        resetResult: createRestorationBonusSet(),
        resetSkillSeriesSkillId: 'series_skill.fixture.b',
      }),
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
      'reset_bonuses',
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
    expect(candidate?.estimatedOperationCount).toBe(3)
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
      // Below Ideal, so this Route base still searches Bonus amendments.
      restorationBonuses: practicalOnlyBonuses(),
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
      bonusTypeId: 'bonus_type.fixture.utility',
      bonusRankId: 'bonus_rank.fixture.low',
    }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: practical }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates[0]
    expect(candidate.category).toBe('practical')
    expect(candidate.idealDifference.matchedBonusCount).toBe(4)
    expect(candidate.similarityScore).toBe(5 / 6)
    expect(candidate.isSimilarToIdeal).toBe(true)
  })

  it('does not search Reset Skills from a protected source or call prediction', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = true
    // The Skill stream of a source that already satisfies the Ideal Skill
    // condition is finished, so this source must still need a Reset.
    input.ownedWeapons[0].seriesSkillId = 'series_skill.fixture.other'
    const engine = createCandidateSearchEngine(input)
    engine.capabilities.supportsGogmaPrediction = false
    engine.capabilities.supportsKeepBonusesPrediction = false
    const predictSkills = vi.spyOn(engine, 'predictSkills')
    const predictGogmaBonus = vi.spyOn(engine, 'predictGogmaBonus')
    const result = await searchCandidates(input, engine, deterministicExecution)
    expect(result.targetResults[0].candidates.some(
      ({ route }) => route.kind === 'existing_gogma_reset_skills',
    )).toBe(false)
    expect(result.targetResults[0].skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'existing_gogma_reset_skills',
        reason: 'no_unprotected_source_weapon',
      }),
    )
    expect(predictSkills).not.toHaveBeenCalled()
    expect(predictGogmaBonus).not.toHaveBeenCalled()
  })

  it('returns a protected Gogma that already satisfies the Target as a zero-operation candidate', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = true
    const engine = createCandidateSearchEngine(input)
    const predictSkills = vi.spyOn(engine, 'predictSkills')
    const predictGogmaBonus = vi.spyOn(engine, 'predictGogmaBonus')
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'existing_gogma_current',
    )
    expect(candidate).toMatchObject({
      route: {
        sourceOwnedWeaponId: input.ownedWeapons[0].id,
        operations: [],
      },
      estimatedOperationCount: 0,
      estimatedGogmaAdvance: 0,
      estimatedSkillAdvance: 0,
      estimatedNormalAdvance: null,
    })
    expect(predictSkills).not.toHaveBeenCalled()
    expect(predictGogmaBonus).not.toHaveBeenCalled()
  })

  it('keeps Gogma-only routes available with Gate and Normal Counter unknown', async () => {
    const input = createCandidateSearchInput()
    input.normalCounters = []
    input.rngState.counterGate = { value: null, isConfirmed: false, source: null }
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const targetResult = result.targetResults[0]
    expect(targetResult.searchedRoutes).toContain('existing_gogma_reset_bonuses')
    expect(targetResult.searchedRoutes).toContain('existing_gogma_reset_skills')
    // An unknown Normal Counter no longer removes the Normal RouteKind, but it
    // still removes every predicted Normal offset: only the forced Reset
    // variant remains, and it reads no Normal Counter (SEARCH_SPEC 6.1.1).
    expect(targetResult.candidates.every(({ route }) =>
      route.operations.every((operation) =>
        operation.type !== 'create_normal_artian' ||
        operation.normalCounterBefore === null,
      ),
    )).toBe(true)
  })

  it('keeps Search availability, results, and semantic hashes unchanged across legacy Gate states', async () => {
    const base = createCandidateSearchInput()
    base.routeFilter = 'existing_gogma'
    base.ownedWeapons[0].isProtected = false
    const unknown = structuredClone(base)
    unknown.rngState.counterGate = { value: null, isConfirmed: false, source: null }
    const imported = structuredClone(base)
    imported.rngState.counterGate = {
      value: 200,
      isConfirmed: true,
      source: 'gogma_seed_finder_import',
    }
    const run = (input: typeof base) => searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const [unknownResult, importedResult] = await Promise.all([run(unknown), run(imported)])
    expect(importedResult.targetResults[0].searchedRoutes)
      .toEqual(unknownResult.targetResults[0].searchedRoutes)
    expect(importedResult.targetResults[0].skippedRoutes)
      .toEqual(unknownResult.targetResults[0].skippedRoutes)
    expect(importedResult.targetResults[0].candidates.map(({ route, searchStateHash }) => ({ route, searchStateHash })))
      .toEqual(unknownResult.targetResults[0].candidates.map(({ route, searchStateHash }) => ({ route, searchStateHash })))
  })

  it('keeps owned-Normal conversion available when Gogma Counter is unknown', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    input.rngState.gogmaCounter = { value: null, isConfirmed: false, source: null }
    input.rngState.counterGate = { value: null, isConfirmed: false, source: null }
    const source = input.ownedWeapons[0]
    input.ownedWeapons = [{
      ...source,
      kind: 'normal',
      rarity: 8,
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    const targetResult = result.targetResults[0]
    expect(targetResult.searchedRoutes).toContain('owned_normal_artian_to_gogma')
    expect(targetResult.candidates).toEqual([])
    expect(targetResult.skippedRoutes).toContainEqual(expect.objectContaining({
      route: 'normal_artian_to_gogma',
      reason: 'normal_counter_unconfirmed',
    }))
  })

  it('skips Reset Skills when Skill capability is missing', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
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
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
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
    neitherInput.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
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
    skillInput.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
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
    keepInput.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
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
    input.ownedWeapons[0].restorationBonuses = practicalOnlyBonuses()
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
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
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
        reason: 'normal_scope_keep_prediction_unsupported',
      }),
    )
  })

  it('generates Reset Bonuses then Reset Skills as a concrete Mixed route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].seriesSkillId = 'series_skill.fixture.other'
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
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
    input.ownedWeapons[0].restorationBonuses = practicalOnlyBonuses()
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

  it('folds the amendment frontier by family layout and rebuilds canonical histories', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'existing_gogma'
    input.settings.maxGogmaAdvance = 5
    input.calculationContext.rngEngineVersion = 'fake-fixture:bounded-amendment-frontier'
    input.ownedWeapons[0].isProtected = false
    input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
    // No Ideal in bounds: retain the full-depth frontier/history coverage.
    input.targetWeapons[0].idealSkillCondition.groupSkillId = 'group.unreached'
    // Every state below gets its own completed five-slot multiset. The
    // stream-local retention keeps the smallest `gogmaAdvance` per outcome, so
    // repeating one Reset or Keep result across depths would collapse the
    // canonical histories this test covers into a single Candidate.
    // Layout R: attack / attack / element / utility / sharpness.
    const layoutR = (utilityRank: string, sharpnessRank: string) => {
      const bonuses = createRestorationBonusSet()
      bonuses[3] = { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: utilityRank }
      bonuses[4] = { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: sharpnessRank }
      return bonuses
    }
    // Layout K: element / attack / attack / utility / utility.
    const layoutK = (firstUtilityRank: string, secondUtilityRank: string) => {
      const bonuses = createRestorationBonusSet()
      bonuses[0] = { bonusTypeId: 'bonus_type.fixture.element', bonusRankId: 'bonus_rank.fixture.middle' }
      bonuses[1] = { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' }
      bonuses[2] = { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' }
      bonuses[3] = { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: firstUtilityRank }
      bonuses[4] = { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: secondUtilityRank }
      return bonuses
    }
    const low = 'bonus_rank.fixture.low'
    const middle = 'bonus_rank.fixture.middle'
    const high = 'bonus_rank.fixture.high'
    const special = 'bonus_rank.fixture.special'
    /** Reset result of depth `index + 1`, all in layout R. */
    const resetResults = [
      layoutR(low, low),
      layoutR(low, middle),
      layoutR(low, high),
      layoutR(low, special),
      layoutR(middle, low),
    ]
    /** Keep from the depth-`index + 1` Reset representative; stays in layout R. */
    const keepFromResetResults = [
      layoutR(high, low),
      layoutR(high, middle),
      layoutR(high, high),
      layoutR(high, special),
    ]
    /** The Keep-only chain; every state stays in layout K. */
    const sourceBonuses = layoutK(low, low)
    // Additional fixture-only tiers keep five distinct outcomes while the unmodified slot stays Ideal.
    for (const [id, order] of [['bonus_rank.fixture.extra1', 5], ['bonus_rank.fixture.extra2', 6]] as const) input.master.bonusRanks.push({ ...input.master.bonusRanks[0], id, order })
    const keepChainResults = [
      layoutK(low, middle),
      layoutK(low, high),
      layoutK(low, special),
      layoutK(low, 'bonus_rank.fixture.extra1'),
      layoutK(low, 'bonus_rank.fixture.extra2'),
    ]
    input.ownedWeapons[0].restorationBonuses = sourceBonuses
    const baseSeed = input.rngState.baseSeed.value as string
    const counters = [10, 11, 12, 13, 14]
    const makePrediction = (
      counter: number,
      operation: FakeRngFixtures['keepBonusPredictions'][number]['input']['operation'],
      result: ReturnType<typeof createRestorationBonusSet>,
    ) => ({
      input: {
        baseSeed,
        gogmaCounter: counter,
        weaponTypeId: input.targetWeapons[0].weaponTypeId,
        elementId: input.targetWeapons[0].elementId,
        operation,
        master: input.master,
      },
      result,
    })
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
      resetBonusPredictions: counters.map((counter, index) =>
        makePrediction(counter, { type: 'reset_bonuses' }, resetResults[index]),
      ),
      keepBonusPredictions: [
        // The layout K chain: each Keep reads the previous depth's own result.
        ...counters.map((counter, index) =>
          makePrediction(
            counter,
            {
              type: 'keep_bonuses',
              currentBonuses: index === 0 ? sourceBonuses : keepChainResults[index - 1],
            },
            keepChainResults[index],
          ),
        ),
        // Layout R appears from depth 2, and its representative is always that
        // depth's own Reset state (the most recent Reset).
        ...counters.slice(1).map((counter, index) =>
          makePrediction(
            counter,
            { type: 'keep_bonuses', currentBonuses: resetResults[index] },
            keepFromResetResults[index],
          ),
        ),
      ],
      skillPredictions: [],
      normalArtianPredictions: [],
      gogmaCounterAdvances: counters.flatMap((counter) => [
        { current: counter, operation: { type: 'reset_bonuses' as const }, result: counter + 1 },
        { current: counter, operation: { type: 'keep_bonuses' as const }, result: counter + 1 },
      ]),
      skillCounterAdvances: [],
      normalCounterAdvances: [],
    })
    const predictGogmaBonus = vi.spyOn(engine, 'predictGogmaBonus')
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates.filter(
      ({ route }) => route.kind !== 'existing_gogma_current',
    )
    const sequences = candidates.map(({ route }) =>
      route.operations.map(({ type }) => type).join(','),
    )

    // Reset ignores the current bonuses, so it is predicted once per position.
    const resetCounters = predictGogmaBonus.mock.calls
      .filter(([call]) => call.operation.type === 'reset_bonuses')
      .map(([call]) => call.gogmaCounter)
    expect(resetCounters).toEqual(counters)

    // Keep is predicted once per (Counter position, ordered family layout).
    const keepKeys = predictGogmaBonus.mock.calls
      .filter(([call]) => call.operation.type === 'keep_bonuses')
      .map(([call]) => [
        call.gogmaCounter,
        call.operation.type === 'keep_bonuses'
          ? call.operation.currentBonuses.map(({ bonusTypeId }) => bonusTypeId).join(' ')
          : '',
      ].join('|'))
    expect(new Set(keepKeys).size).toBe(keepKeys.length)
    // Layout K survives at every position; layout R appears from depth 2.
    expect(keepKeys).toHaveLength(counters.length + counters.length - 1)

    // Each depth keeps one representative per family layout, so depth d yields
    // the Reset state, the Keep of the Reset layout, and the Keep-only chain.
    expect(sequences.sort()).toEqual([
      'keep_bonuses',
      'keep_bonuses,keep_bonuses',
      'keep_bonuses,keep_bonuses,keep_bonuses',
      'keep_bonuses,keep_bonuses,keep_bonuses,keep_bonuses',
      'keep_bonuses,keep_bonuses,keep_bonuses,keep_bonuses,keep_bonuses',
      'reset_bonuses',
      'reset_bonuses,keep_bonuses',
      'reset_bonuses,reset_bonuses',
      'reset_bonuses,reset_bonuses,keep_bonuses',
      'reset_bonuses,reset_bonuses,reset_bonuses',
      'reset_bonuses,reset_bonuses,reset_bonuses,keep_bonuses',
      'reset_bonuses,reset_bonuses,reset_bonuses,reset_bonuses',
      'reset_bonuses,reset_bonuses,reset_bonuses,reset_bonuses,keep_bonuses',
      'reset_bonuses,reset_bonuses,reset_bonuses,reset_bonuses,reset_bonuses',
    ].sort())

    // The canonical history places every Reset before every Keep, so the
    // route-history duplicate `keep -> reset` is folded into `reset -> reset`.
    expect(sequences.every((sequence) =>
      !/keep_bonuses,.*reset_bonuses/.test(sequence),
    )).toBe(true)

    for (const [kind, sequence] of [
      ['existing_gogma_reset_bonuses', 'reset_bonuses,reset_bonuses'],
      ['existing_gogma_keep_bonuses', 'keep_bonuses,keep_bonuses'],
      ['existing_gogma_mixed', 'reset_bonuses,reset_bonuses,keep_bonuses'],
    ]) {
      expect(candidates.some(({ route }) =>
        route.kind === kind &&
        route.operations.map(({ type }) => type).join(',') === sequence,
      )).toBe(true)
    }

    const longest = candidates.find(({ route }) =>
      route.operations.length === 5 && route.operations[4].type === 'keep_bonuses',
    )
    expect(longest?.route.operations.map((operation) =>
      operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
        ? [operation.gogmaCounterBefore, operation.gogmaCounterAfter, operation.sourceOwnedWeaponId]
        : null,
    )).toEqual([
      [10, 11, input.ownedWeapons[0].id],
      [11, 12, input.ownedWeapons[0].id],
      [12, 13, input.ownedWeapons[0].id],
      [13, 14, input.ownedWeapons[0].id],
      [14, 15, input.ownedWeapons[0].id],
    ])
    expect(longest?.estimatedGogmaAdvance).toBe(5)
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
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
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
        'existing_gogma_current',
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
    // Practical overflow, rather than multiple Ideals omitted by B4 policy.
    input.targetWeapons[0].idealSkillCondition.groupSkillId = 'group.unreached'
    // Keep more than one candidate reachable: a source whose Skills already
    // satisfy Ideal contributes no Reset Skills candidate.
    input.ownedWeapons[0].seriesSkillId = 'series_skill.fixture.other'
    input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
    input.ownedWeapons.push({
      ...structuredClone(input.ownedWeapons[0]),
      id: 'owned.fixture.limit.second' as never,
    })
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    expect(result.targetResults[0].candidates).toHaveLength(1)
    // The zero-operation Practical dominates later Practical amendments, so
    // the configured display cap omits no retained Candidate.
    expect(result.isTruncated).toBe(false)

    input.routeFilter = 'normal_artian'
    const normalOnly = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
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
      'existing_gogma_current',
      'existing_gogma_reset_bonuses',
      'existing_gogma_keep_bonuses',
      'existing_gogma_reset_skills',
      'existing_gogma_mixed',
    ])

    input.routeFilter = 'existing_gogma'
    const existingOnly = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
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

  it('searches a Target that satisfies the Ideal implies Practical containment invariant', async () => {
    const input = createCandidateSearchInput()
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.warnings).toEqual([])
    expect(result.targetResults.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      input.targetWeapons[0].id,
    ])
  })

  it('excludes a Target whose idealBonuses break the containment invariant', async () => {
    const input = createCandidateSearchInput()
    input.targetWeapons[0].practicalBonusConditions = [
      {
        id: 'condition.fixture.unsatisfiable',
        bonusTypeId: 'bonus_type.fixture.element',
        minimumRankId: 'bonus_rank.fixture.high',
        requiredExCount: 0,
      },
    ]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults).toEqual([])
    // A genuine capability / definition problem keeps `warning`.
    expect(result.warnings).toEqual([
      {
        targetWeaponId: input.targetWeapons[0].id,
        severity: 'warning',
        message: expect.stringContaining('practicalBonusConditions[0]'),
      },
    ])
  })

  it('excludes a Target whose Skill conditions break the containment invariant', async () => {
    const input = createCandidateSearchInput()
    input.targetWeapons[0].idealSkillCondition = {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: 'group_skill.fixture.a',
      matchMode: 'any',
    }
    input.targetWeapons[0].practicalSkillCondition = {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: 'group_skill.fixture.a',
      matchMode: 'all',
    }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input),
      deterministicExecution,
    )
    expect(result.targetResults).toEqual([])
    expect(result.warnings).toEqual([
      {
        targetWeaponId: input.targetWeapons[0].id,
        severity: 'warning',
        message: expect.stringContaining('practicalSkillCondition'),
      },
    ])
  })
})
