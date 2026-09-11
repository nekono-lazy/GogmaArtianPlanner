import { describe, expect, it, vi } from 'vitest'
import { searchCandidates } from './candidateSearch'
import {
  belowPracticalBonuses,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import {
  createRestorationBonusSet,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import type {
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
} from '../models/publicTypes'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const START_SKILL_COUNTER = 7
const START_GOGMA_COUNTER = 10

/** Ideal Skill for the shared fixture Target is `series_skill.fixture.a`. */
const IDEAL_SERIES_SKILL = 'series_skill.fixture.a'
const OTHER_SERIES_SKILL = 'series_skill.fixture.other'

const START_NORMAL_COUNTER = 4

interface StreamFixtureOptions {
  /** Skill positions to publish, relative to the starting Skill Counter. */
  skillPositions: number
  gogmaPositions: number
  /** Relative Skill position whose prediction satisfies the Ideal condition. */
  idealSkillIndex?: number
  /**
   * Publishes a different Series Skill per non-Ideal position. The B3
   * stream-local retention keeps only the smallest `resetCount` per
   * `(seriesSkillId, groupSkillId)`, so a fixture that repeats one Skill can
   * never exercise the full `1 ... M` Reset range.
   */
  distinctSkills?: boolean
  /** Normal forge counts to publish, for conversion Routes. */
  normalForges?: number
  resetResult?: RestorationBonusSet
  /** Inherited five slots of a conversion Route base. */
  normalResult?: RestorationBonusSet
}

function createStreamFixtureEngine(
  input: CandidateSearchInput,
  options: StreamFixtureOptions,
): FakeRngEngine {
  const baseSeed = input.rngState.baseSeed.value as string
  const target = input.targetWeapons[0]
  const resetResult = options.resetResult ?? practicalOnlyBonuses()
  const normalResult = options.normalResult ?? createRestorationBonusSet()
  const normalForges = options.normalForges ?? 0
  const fixtures: FakeRngFixtures = {
    version: 'skill-stream-independence',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: normalForges > 0,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: false,
    },
    normalizedSeeds: [],
    normalArtianPredictions: Array.from({ length: normalForges }, (_, index) => ({
      input: {
        baseSeed,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        rarity: 8 as const,
        normalCounter: START_NORMAL_COUNTER + index,
        master: input.master,
      },
      result: normalResult,
    })),
    resetBonusPredictions: Array.from({ length: options.gogmaPositions }, (_, index) => ({
      input: {
        baseSeed,
        gogmaCounter: START_GOGMA_COUNTER + index,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'reset_bonuses' as const },
        master: input.master,
      },
      result: resetResult,
    })),
    keepBonusPredictions: [],
    skillPredictions: Array.from({ length: options.skillPositions }, (_, index) => ({
      input: {
        baseSeed,
        skillCounter: START_SKILL_COUNTER + index,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master: input.master,
      },
      result: {
        seriesSkillId: index === (options.idealSkillIndex ?? 0)
          ? IDEAL_SERIES_SKILL
          : options.distinctSkills
            ? `${OTHER_SERIES_SKILL}.${index}`
            : OTHER_SERIES_SKILL,
        groupSkillId: 'group_skill.fixture.a',
      },
    })),
    normalCounterAdvances: Array.from({ length: normalForges }, (_, index) => ({
      current: START_NORMAL_COUNTER,
      operation: { type: 'create_normal_artian' as const, count: index + 1 },
      result: START_NORMAL_COUNTER + index + 1,
    })),
    gogmaCounterAdvances: Array.from({ length: options.gogmaPositions }, (_, index) => ({
      current: START_GOGMA_COUNTER + index,
      operation: { type: 'reset_bonuses' as const },
      result: START_GOGMA_COUNTER + index + 1,
    })),
    skillCounterAdvances: [
      ...Array.from({ length: options.skillPositions }, (_, index) => ({
        current: START_SKILL_COUNTER + index,
        operation: { type: 'reset_skills' as const },
        result: START_SKILL_COUNTER + index + 1,
      })),
      {
        current: START_SKILL_COUNTER,
        operation: { type: 'convert_normal_to_gogma' as const },
        result: START_SKILL_COUNTER + 1,
      },
    ],
  }
  return new FakeRngEngine(fixtures)
}

function gogmaSource(
  input: CandidateSearchInput,
  id: string,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  const base = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  return {
    ...structuredClone(base),
    id: ownedWeaponId(id),
    seriesSkillId: OTHER_SERIES_SKILL,
    groupSkillId: 'group_skill.fixture.a',
    restorationBonusScope: 'gogma_artian',
    isProtected: false,
    ...overrides,
  } as OwnedGogmaArtianWeapon
}

function normalSource(input: CandidateSearchInput, id: string) {
  const base = input.ownedWeapons[0]
  return {
    ...structuredClone(base),
    id: ownedWeaponId(id),
    kind: 'normal' as const,
    rarity: 8 as const,
    restorationBonusScope: 'normal_artian' as const,
    restorationBonuses: createRestorationBonusSet(),
    seriesSkillId: null,
    groupSkillId: 'group_skill.fixture.a',
    status: null,
    isProtected: false,
  } as unknown as CandidateSearchInput['ownedWeapons'][number]
}

function conversionInput(maxSkillAdvance: number, maxGogmaAdvance: number) {
  const input = createCandidateSearchInput()
  input.routeFilter = 'normal_artian'
  input.settings.maxSkillAdvance = maxSkillAdvance
  input.settings.maxGogmaAdvance = maxGogmaAdvance
  input.settings.maxNormalAdvance = 1
  input.calculationContext.rngEngineVersion = 'fake-fixture:skill-stream-independence'
  return input
}

function existingGogmaInput(maxSkillAdvance: number, maxGogmaAdvance: number) {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings.maxSkillAdvance = maxSkillAdvance
  input.settings.maxGogmaAdvance = maxGogmaAdvance
  input.calculationContext.rngEngineVersion = 'fake-fixture:skill-stream-independence'
  return input
}

function skillCounterCalls(engine: FakeRngEngine) {
  const spy = vi.spyOn(engine, 'predictSkills')
  return {
    spy,
    counters: () => spy.mock.calls.map(([call]) => call.skillCounter),
  }
}

describe('Skill stream independence', () => {
  it('predicts each Skill Counter position once regardless of the source count', async () => {
    const run = async (sourceCount: number) => {
      const input = existingGogmaInput(3, 1)
      input.ownedWeapons = Array.from({ length: sourceCount }, (_, index) =>
        gogmaSource(input, `owned.fixture.stream-${index}`),
      )
      // No Ideal in bounds: this test covers the full configured Reset range.
      const engine = createStreamFixtureEngine(input, {
        idealSkillIndex: 99,
        distinctSkills: true,
        skillPositions: 4,
        gogmaPositions: 1,
      })
      const calls = skillCounterCalls(engine)
      const result = await searchCandidates(input, engine, deterministicExecution)
      return { calls: calls.counters(), result }
    }

    const single = await run(1)
    const many = await run(3)

    expect(single.calls).toEqual([7, 8, 9])
    expect(many.calls).toEqual([7, 8, 9])
    expect(many.calls).toHaveLength(3)
    expect(many.calls.length).toBeLessThan(3 * 3)
    expect(
      many.result.targetResults[0].candidates.filter(({ route }) =>
        route.kind === 'existing_gogma_reset_skills',
      ).length,
    ).toBeGreaterThan(single.result.targetResults[0].candidates.filter(({ route }) =>
      route.kind === 'existing_gogma_reset_skills',
    ).length)
  })

  it('predicts Skill Counter positions S ... S + M - 1 only, for Reset Skills 1 ... M', async () => {
    const input = existingGogmaInput(3, 1)
    input.ownedWeapons = [gogmaSource(input, 'owned.fixture.stream-range')]
    // No Ideal in bounds: this test covers the full configured Reset range.
      const engine = createStreamFixtureEngine(input, {
        idealSkillIndex: 99,
      skillPositions: 5,
      gogmaPositions: 1,
      distinctSkills: true,
    })
    const calls = skillCounterCalls(engine)
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(calls.counters()).toEqual([7, 8, 9])
    expect(calls.counters()).not.toContain(10)

    const resetSkillRoutes = result.targetResults[0].candidates
      .filter(({ route }) => route.kind === 'existing_gogma_reset_skills')
      .map(({ route }) => route.operations)
    const resetCounts = resetSkillRoutes.map((operations) => operations.length)
    expect(Math.max(...resetCounts)).toBe(3)
    expect(resetSkillRoutes.every((operations) =>
      operations.every((operation) => operation.type === 'reset_skills'),
    )).toBe(true)
    const longest = resetSkillRoutes.find((operations) => operations.length === 3)
    expect(longest?.map((operation) =>
      operation.type === 'reset_skills' ? operation.skillCounterBefore : null,
    )).toEqual([7, 8, 9])
  })

  it('does not change the Skill prediction count when only maxGogmaAdvance grows', async () => {
    const run = async (maxGogmaAdvance: number) => {
      const input = existingGogmaInput(3, maxGogmaAdvance)
      input.ownedWeapons = [
        gogmaSource(input, 'owned.fixture.stream-gogma', {
          isProtected: false,
          restorationBonuses: belowPracticalBonuses(),
        }),
      ]
      const engine = createStreamFixtureEngine(input, {
        skillPositions: 4,
        gogmaPositions: maxGogmaAdvance,
      })
      const skills = skillCounterCalls(engine)
      const gogma = vi.spyOn(engine, 'predictGogmaBonus')
      await searchCandidates(input, engine, deterministicExecution)
      return { skills: skills.counters(), gogmaCalls: gogma.mock.calls.length }
    }

    const narrow = await run(1)
    const wide = await run(10)

    expect(narrow.skills).toEqual([7, 8, 9])
    expect(wide.skills).toEqual([7, 8, 9])
    expect(wide.gogmaCalls).toBeGreaterThan(narrow.gogmaCalls)
  })

  it('does not change the Gogma prediction count when only maxSkillAdvance grows', async () => {
    const run = async (maxSkillAdvance: number) => {
      const input = existingGogmaInput(maxSkillAdvance, 3)
      input.ownedWeapons = [
        gogmaSource(input, 'owned.fixture.stream-skill', {
          isProtected: false,
          restorationBonuses: belowPracticalBonuses(),
        }),
      ]
      const engine = createStreamFixtureEngine(input, {
        skillPositions: maxSkillAdvance + 1,
        gogmaPositions: 3,
      })
      const gogma = vi.spyOn(engine, 'predictGogmaBonus')
      await searchCandidates(input, engine, deterministicExecution)
      return gogma.mock.calls.length
    }

    const wide = await run(4)
    expect(wide).toBeGreaterThan(0)
    expect(wide).toBe(await run(1))
  })

  it('stops the Skill stream when the Normal conversion Skill already satisfies Ideal', async () => {
    const input = conversionInput(3, 1)
    input.ownedWeapons = []
    const engine = createStreamFixtureEngine(input, {
      skillPositions: 5,
      gogmaPositions: 1,
      idealSkillIndex: 0,
      normalForges: 1,
      normalResult: practicalOnlyBonuses(),
      resetResult: createRestorationBonusSet(),
    })
    const calls = skillCounterCalls(engine)
    const gogma = vi.spyOn(engine, 'predictGogmaBonus')
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(calls.counters()).toEqual([7])
    expect(candidates.some(({ route }) =>
      route.operations.some(({ type }) => type === 'reset_skills'),
    )).toBe(false)
    // Bonus Reset produces a candidate without any Reset Skills.
    expect(candidates.some(({ route }) =>
      route.kind === 'normal_artian_to_gogma' &&
      route.operations.map(({ type }) => type).join(',') ===
        'create_normal_artian,convert_normal_to_gogma,reset_bonuses',
    )).toBe(true)
    // Only the Skill stream stopped; the Bonus stream kept searching.
    expect(gogma.mock.calls.length).toBeGreaterThan(0)
    expect(candidates.some(({ route }) =>
      route.operations.some(({ type }) => type === 'reset_bonuses'),
    )).toBe(true)
  })

  it('stops the Skill stream when the owned Normal conversion Skill already satisfies Ideal', async () => {
    const input = conversionInput(3, 1)
    input.normalCounters = []
    input.ownedWeapons = [
      {
        ...normalSource(input, 'owned.fixture.stream-owned-normal-ideal'),
        restorationBonuses: practicalOnlyBonuses(),
      },
    ]
    const engine = createStreamFixtureEngine(input, {
      skillPositions: 5,
      gogmaPositions: 1,
      idealSkillIndex: 0,
      resetResult: createRestorationBonusSet(),
    })
    const calls = skillCounterCalls(engine)
    const gogma = vi.spyOn(engine, 'predictGogmaBonus')
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(calls.counters()).toEqual([7])
    expect(candidates.some(({ route }) =>
      route.operations.some(({ type }) => type === 'reset_skills'),
    )).toBe(false)
    expect(candidates.some(({ route }) =>
      route.kind === 'owned_normal_artian_to_gogma' &&
      route.operations.map(({ type }) => type).join(',') === 'convert_normal_to_gogma,reset_bonuses',
    )).toBe(true)
    expect(gogma.mock.calls.length).toBeGreaterThan(0)
  })

  it('covers S ... S + M with Reset capped at M when the Normal conversion Skill is not Ideal', async () => {
    const run = async (maxNormalAdvance: number) => {
      const input = conversionInput(3, 1)
      input.settings.maxNormalAdvance = maxNormalAdvance
      input.ownedWeapons = []
      // No Ideal in bounds: this test covers the full configured Reset range.
      const engine = createStreamFixtureEngine(input, {
        idealSkillIndex: 99,
        skillPositions: 5,
        gogmaPositions: 1,
        distinctSkills: true,
        normalForges: maxNormalAdvance,
      })
      const calls = skillCounterCalls(engine)
      const result = await searchCandidates(input, engine, deterministicExecution)
      return { calls: calls.counters(), result }
    }

    const single = await run(1)
    const many = await run(4)

    // Conversion uses S; Reset Skills 1 ... M use S + 1 ... S + M.
    expect(single.calls).toEqual([7, 8, 9, 10])
    expect(many.calls).toEqual([7, 8, 9, 10])
    expect(many.calls).not.toContain(11)

    const resetCounts = many.result.targetResults[0].candidates.map(({ route }) =>
      route.operations.filter(({ type }) => type === 'reset_skills').length,
    )
    expect(Math.max(...resetCounts)).toBe(3)
  })

  it('covers S ... S + M once for every owned Normal source when the conversion Skill is not Ideal', async () => {
    const run = async (sourceCount: number) => {
      const input = conversionInput(3, 1)
      input.normalCounters = []
      input.ownedWeapons = Array.from({ length: sourceCount }, (_, index) =>
        normalSource(input, `owned.fixture.stream-owned-normal-${index}`),
      )
      // No Ideal in bounds: this test covers the full configured Reset range.
      const engine = createStreamFixtureEngine(input, {
        idealSkillIndex: 99,
        distinctSkills: true,
        skillPositions: 5,
        gogmaPositions: 1,
      })
      const calls = skillCounterCalls(engine)
      const result = await searchCandidates(input, engine, deterministicExecution)
      return { calls: calls.counters(), result }
    }

    const single = await run(1)
    const many = await run(3)

    expect(single.calls).toEqual([7, 8, 9, 10])
    expect(many.calls).toEqual([7, 8, 9, 10])
    expect(many.calls.length).toBeLessThan(3 * 4)
    expect(
      many.result.targetResults[0].candidates.filter(({ route }) =>
        route.kind === 'owned_normal_artian_to_gogma',
      ).length,
    ).toBeGreaterThan(single.result.targetResults[0].candidates.filter(({ route }) =>
      route.kind === 'owned_normal_artian_to_gogma',
    ).length)
  })

  it('performs no Skill prediction when the current Skills already satisfy the Ideal condition', async () => {
    const input = existingGogmaInput(3, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.stream-ideal', {
        seriesSkillId: IDEAL_SERIES_SKILL,
      }),
    ]
    const engine = createStreamFixtureEngine(input, {
      skillPositions: 4,
      gogmaPositions: 1,
    })
    const calls = skillCounterCalls(engine)
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(calls.counters()).toEqual([])
    expect(result.targetResults[0].candidates.some(({ route }) =>
      route.operations.some(({ type }) => type === 'reset_skills'),
    )).toBe(false)
    // Only the current-state Route is searched because no amendment is needed.
    expect(result.targetResults[0].searchedRoutes).toContain(
      'existing_gogma_current',
    )
  })

  it('keeps searching the Bonus stream of a source whose Skills already satisfy Ideal', async () => {
    const input = existingGogmaInput(3, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.stream-ideal-skill', {
        seriesSkillId: IDEAL_SERIES_SKILL,
        restorationBonuses: belowPracticalBonuses(),
        isProtected: false,
      }),
    ]
    const engine = createStreamFixtureEngine(input, {
      skillPositions: 4,
      gogmaPositions: 1,
      resetResult: createRestorationBonusSet(),
    })
    const calls = skillCounterCalls(engine)
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(calls.counters()).toEqual([])
    const reset = result.targetResults[0].candidates.find(({ route }) =>
      route.kind === 'existing_gogma_reset_bonuses',
    )
    expect(reset?.route.operations.map(({ type }) => type)).toEqual(['reset_bonuses'])
    expect(reset?.category).toBe('ideal')
  })

  it('keeps the zero-Reset Practical solution while continuing the Ideal Skill search', async () => {
    const input = existingGogmaInput(3, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.stream-practical', {
        seriesSkillId: OTHER_SERIES_SKILL,
        restorationBonuses: belowPracticalBonuses(),
        isProtected: false,
      }),
    ]
    const engine = createStreamFixtureEngine(input, {
      skillPositions: 4,
      gogmaPositions: 1,
      resetResult: createRestorationBonusSet(),
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    const zeroReset = candidates.find(({ route }) =>
      route.operations.map(({ type }) => type).join(',') === 'reset_bonuses',
    )
    expect(zeroReset?.category).toBe('practical')
    expect(zeroReset?.seriesSkillId).toBe(OTHER_SERIES_SKILL)

    const reachedIdeal = candidates.find(({ route }) =>
      route.operations.map(({ type }) => type).join(',') === 'reset_bonuses,reset_skills',
    )
    expect(reachedIdeal?.category).toBe('ideal')
    expect(reachedIdeal?.seriesSkillId).toBe(IDEAL_SERIES_SKILL)
    expect(reachedIdeal?.route.kind).toBe('existing_gogma_mixed')
  })

  it('keeps a Reset Skills only route Bonus-preserving', async () => {
    const input = existingGogmaInput(2, 1)
    const source = gogmaSource(input, 'owned.fixture.stream-skill-only', {
      restorationBonuses: createRestorationBonusSet(),
      restorationBonusScope: 'gogma_artian',
      seriesSkillId: OTHER_SERIES_SKILL,
      isProtected: false,
    })
    input.ownedWeapons = [source]
    const engine = createStreamFixtureEngine(input, {
      skillPositions: 3,
      gogmaPositions: 1,
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidate = result.targetResults[0].candidates.find(({ route }) =>
      route.kind === 'existing_gogma_reset_skills',
    )

    expect(candidate?.route.sourceOwnedWeaponId).toBe(source.id)
    expect(candidate?.finalBonuses).toEqual(source.restorationBonuses)
    expect(candidate?.restorationBonusScope).toBe('gogma_artian')
    expect(candidate?.seriesSkillId).toBe(IDEAL_SERIES_SKILL)
    expect(candidate?.estimatedGogmaAdvance).toBe(0)
    expect(candidate?.estimatedNormalAdvance).toBeNull()
    expect(candidate?.route.operations[0]).toEqual(expect.objectContaining({
      type: 'reset_skills',
      sourceOwnedWeaponId: source.id,
      skillCounterBefore: 7,
      skillCounterAfter: 8,
    }))
  })
})
