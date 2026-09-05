import { describe, expect, it, vi } from 'vitest'
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
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import type {
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
} from '../models/publicTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import { gogmaKeepFamilyLayoutKey } from '../rng/gogmaBonusFamily'
import { searchCandidates } from './candidateSearch'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const START_GOGMA_COUNTER = 10
const START_SKILL_COUNTER = 7
const START_NORMAL_COUNTER = 4

const IDEAL_SERIES_SKILL = 'series_skill.fixture.a'
const OTHER_SERIES_SKILL = 'series_skill.fixture.other'

const attackHigh = () => restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high')
const elementMiddle = () => restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle')
const utilityLow = () => restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low')
const utilityHigh = () => restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.high')
const sharpnessHigh = () => restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.high')
const sharpnessLow = () => restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.low')

/** Layout A: attack / attack / element / utility / sharpness. Ideal multiset. */
const layoutA = (): RestorationBonusSet => createRestorationBonusSet()
/** Layout A, one tier lower. */
const layoutALower = (): RestorationBonusSet =>
  restorationBonusSet(attackHigh(), attackHigh(), elementMiddle(), utilityLow(), sharpnessLow())
/** Layout B: attack / element / attack / utility / utility. */
const layoutB = (): RestorationBonusSet =>
  restorationBonusSet(attackHigh(), elementMiddle(), attackHigh(), utilityLow(), utilityLow())
const layoutBHigher = (): RestorationBonusSet =>
  restorationBonusSet(attackHigh(), elementMiddle(), attackHigh(), utilityLow(), utilityHigh())
/** Layout C: attack / attack / element / sharpness / utility. Ideal multiset. */
const layoutC = (): RestorationBonusSet =>
  restorationBonusSet(attackHigh(), attackHigh(), elementMiddle(), sharpnessHigh(), utilityLow())
/** Layout S: element / attack / attack / utility / utility. */
const layoutS = (): RestorationBonusSet =>
  restorationBonusSet(elementMiddle(), attackHigh(), attackHigh(), utilityLow(), utilityLow())
/** Layout S with different tiers; the same family layout. */
const layoutSLower = (): RestorationBonusSet =>
  restorationBonusSet(
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.high'),
    attackHigh(),
    attackHigh(),
    utilityLow(),
    utilityHigh(),
  )

interface BonusFixtureOptions {
  /** Reset result at Counter `START_GOGMA_COUNTER + index`. */
  resets: RestorationBonusSet[]
  keeps?: Array<{
    counterOffset: number
    currentBonuses: RestorationBonusSet
    result: RestorationBonusSet
  }>
  keepSupported?: boolean
  skillSupported?: boolean
  /** Skill positions to publish, relative to the starting Skill Counter. */
  skillPositions?: number
  /** Relative Skill position whose prediction satisfies the Ideal condition. */
  idealSkillIndex?: number
  /** Normal Artian prediction per forge offset, for conversion Routes. */
  normals?: RestorationBonusSet[]
}

function createBonusFixtureEngine(
  input: CandidateSearchInput,
  options: BonusFixtureOptions,
): FakeRngEngine {
  const baseSeed = input.rngState.baseSeed.value as string
  const target = input.targetWeapons[0]
  const skillPositions = options.skillPositions ?? 0
  const normals = options.normals ?? []
  const counters = options.resets.map((_, index) => START_GOGMA_COUNTER + index)
  const fixtures: FakeRngFixtures = {
    version: 'bonus-stream-independence',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: normals.length > 0,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: options.skillSupported ?? false,
      supportsKeepBonusesPrediction: options.keepSupported ?? false,
    },
    normalizedSeeds: [],
    normalArtianPredictions: normals.map((result, index) => ({
      input: {
        baseSeed,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        rarity: 8 as const,
        normalCounter: START_NORMAL_COUNTER + index,
        master: input.master,
      },
      result,
    })),
    resetBonusPredictions: options.resets.map((result, index) => ({
      input: {
        baseSeed,
        gogmaCounter: START_GOGMA_COUNTER + index,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'reset_bonuses' as const },
        master: input.master,
      },
      result,
    })),
    keepBonusPredictions: (options.keeps ?? []).map(({ counterOffset, currentBonuses, result }) => ({
      input: {
        baseSeed,
        gogmaCounter: START_GOGMA_COUNTER + counterOffset,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'keep_bonuses' as const, currentBonuses },
        master: input.master,
      },
      result,
    })),
    skillPredictions: Array.from({ length: skillPositions }, (_, index) => ({
      input: {
        baseSeed,
        skillCounter: START_SKILL_COUNTER + index,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master: input.master,
      },
      result: {
        seriesSkillId: index === options.idealSkillIndex
          ? IDEAL_SERIES_SKILL
          : OTHER_SERIES_SKILL,
        groupSkillId: null,
      },
    })),
    gogmaCounterAdvances: counters.flatMap((counter) => [
      { current: counter, operation: { type: 'reset_bonuses' as const }, result: counter + 1 },
      { current: counter, operation: { type: 'keep_bonuses' as const }, result: counter + 1 },
    ]),
    skillCounterAdvances: [
      ...Array.from({ length: skillPositions }, (_, index) => ({
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
    normalCounterAdvances: normals.map((_, index) => ({
      current: START_NORMAL_COUNTER,
      operation: { type: 'create_normal_artian' as const, count: index + 1 },
      result: START_NORMAL_COUNTER + index + 1,
    })),
  }
  return new FakeRngEngine(fixtures)
}

function existingGogmaInput(maxGogmaAdvance: number): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings.maxGogmaAdvance = maxGogmaAdvance
  input.settings.maxSkillAdvance = 1
  input.calculationContext.rngEngineVersion = 'fake-fixture:bonus-stream-independence'
  return input
}

function gogmaSource(
  input: CandidateSearchInput,
  id: string,
  bonuses: RestorationBonusSet,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  const base = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  return {
    ...structuredClone(base),
    id: ownedWeaponId(id),
    restorationBonusScope: 'gogma_artian',
    restorationBonuses: bonuses,
    seriesSkillId: IDEAL_SERIES_SKILL,
    groupSkillId: null,
    isProtected: false,
    ...overrides,
  } as OwnedGogmaArtianWeapon
}

function gogmaCalls(engine: FakeRngEngine) {
  const spy = vi.spyOn(engine, 'predictGogmaBonus')
  return {
    resetCounters: () => spy.mock.calls
      .filter(([call]) => call.operation.type === 'reset_bonuses')
      .map(([call]) => call.gogmaCounter),
    keepKeys: () => spy.mock.calls.flatMap(([call]) =>
      call.operation.type === 'keep_bonuses'
        ? [`${call.gogmaCounter}|${gogmaKeepFamilyLayoutKey(call.operation.currentBonuses)}`]
        : [],
    ),
    keepInputs: () => spy.mock.calls.flatMap(([call]) =>
      call.operation.type === 'keep_bonuses'
        ? [{ counter: call.gogmaCounter, currentBonuses: call.operation.currentBonuses }]
        : [],
    ),
    total: () => spy.mock.calls.length,
  }
}

function operationTypes(operations: readonly { type: string }[]): string {
  return operations.map(({ type }) => type).join(',')
}

describe('Bonus stream state search', () => {
  it('predicts Reset once per Gogma Counter position regardless of the frontier size', async () => {
    const input = existingGogmaInput(3)
    input.ownedWeapons = [gogmaSource(input, 'owned.fixture.bonus-reset', layoutS())]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA(), layoutB(), layoutC()],
      keepSupported: true,
      keeps: [
        { counterOffset: 0, currentBonuses: layoutS(), result: layoutS() },
        { counterOffset: 1, currentBonuses: layoutA(), result: layoutALower() },
        { counterOffset: 1, currentBonuses: layoutS(), result: layoutS() },
        { counterOffset: 2, currentBonuses: layoutB(), result: layoutBHigher() },
        { counterOffset: 2, currentBonuses: layoutALower(), result: layoutALower() },
        { counterOffset: 2, currentBonuses: layoutS(), result: layoutS() },
      ],
    })
    const calls = gogmaCalls(engine)
    await searchCandidates(input, engine, deterministicExecution)

    expect(calls.resetCounters()).toEqual([10, 11, 12])
    expect(calls.resetCounters().length).toBeLessThanOrEqual(
      input.settings.maxGogmaAdvance,
    )
  })

  it('shares the same Reset Counter positions across source weapons', async () => {
    const run = async (sourceCount: number) => {
      const input = existingGogmaInput(3)
      input.ownedWeapons = Array.from({ length: sourceCount }, (_, index) =>
        gogmaSource(input, `owned.fixture.bonus-source-${index}`, belowPracticalBonuses()),
      )
      const engine = createBonusFixtureEngine(input, {
        resets: [layoutA(), layoutB(), layoutC()],
      })
      const calls = gogmaCalls(engine)
      await searchCandidates(input, engine, deterministicExecution)
      return calls.resetCounters()
    }

    const single = await run(1)
    const many = await run(3)
    expect(single).toEqual([10, 11, 12])
    expect(many).toEqual([10, 11, 12])
    expect(many.length).toBeLessThan(3 * 3)
  })

  it('does not repeat Reset prediction per Normal candidate offset', async () => {
    const run = async (maxNormalAdvance: number) => {
      const input = createCandidateSearchInput()
      input.routeFilter = 'normal_artian'
      input.ownedWeapons = []
      input.settings.maxGogmaAdvance = 3
      input.settings.maxSkillAdvance = 1
      input.settings.maxNormalAdvance = maxNormalAdvance
      input.calculationContext.rngEngineVersion = 'fake-fixture:bonus-stream-independence'
      const engine = createBonusFixtureEngine(input, {
        resets: [layoutA(), layoutB(), layoutC()],
        skillSupported: true,
        skillPositions: 2,
        idealSkillIndex: 0,
        normals: Array.from({ length: maxNormalAdvance }, () => practicalOnlyBonuses()),
      })
      const calls = gogmaCalls(engine)
      const result = await searchCandidates(input, engine, deterministicExecution)
      return { resetCounters: calls.resetCounters(), result }
    }

    const single = await run(1)
    const many = await run(4)
    expect(single.resetCounters).toEqual([10, 11, 12])
    expect(many.resetCounters).toEqual([10, 11, 12])
    // Every offset still composes with the shared depth >= 1 Bonus solutions.
    expect(many.result.targetResults[0].candidates.filter(({ route }) =>
      route.operations.some(({ type }) => type === 'reset_bonuses'),
    ).length).toBeGreaterThan(
      single.result.targetResults[0].candidates.filter(({ route }) =>
        route.operations.some(({ type }) => type === 'reset_bonuses'),
      ).length,
    )
  })

  it('predicts Keep once per family layout even when the tiers differ', async () => {
    const input = existingGogmaInput(1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.bonus-tier-a', layoutS()),
      gogmaSource(input, 'owned.fixture.bonus-tier-b', layoutSLower()),
    ]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA()],
      keepSupported: true,
      keeps: [{ counterOffset: 0, currentBonuses: layoutS(), result: layoutB() }],
    })
    const calls = gogmaCalls(engine)
    await searchCandidates(input, engine, deterministicExecution)

    expect(gogmaKeepFamilyLayoutKey(layoutSLower()))
      .toBe(gogmaKeepFamilyLayoutKey(layoutS()))
    expect(calls.keepKeys()).toEqual([`10|${gogmaKeepFamilyLayoutKey(layoutS())}`])
    expect(calls.resetCounters()).toEqual([10])
  })

  it('predicts Keep separately for two sources whose slot order differs', async () => {
    const input = existingGogmaInput(1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.bonus-order-a', layoutB()),
      gogmaSource(input, 'owned.fixture.bonus-order-b', layoutS()),
    ]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA()],
      keepSupported: true,
      keeps: [
        { counterOffset: 0, currentBonuses: layoutB(), result: layoutBHigher() },
        { counterOffset: 0, currentBonuses: layoutS(), result: layoutS() },
      ],
    })
    const calls = gogmaCalls(engine)
    await searchCandidates(input, engine, deterministicExecution)

    // Same bonus multiset, different slot order: two different family layouts.
    expect(new Set(layoutB().map(({ bonusTypeId }) => bonusTypeId)))
      .toEqual(new Set(layoutS().map(({ bonusTypeId }) => bonusTypeId)))
    expect(gogmaKeepFamilyLayoutKey(layoutB()))
      .not.toBe(gogmaKeepFamilyLayoutKey(layoutS()))
    expect(calls.keepKeys()).toHaveLength(2)
    expect(new Set(calls.keepKeys()).size).toBe(2)
  })

  it('folds one family layout into the most recent Reset representative', async () => {
    const input = existingGogmaInput(2)
    // Reset at position 10 and Keep from the source both land on layout A, so
    // depth 1 holds two states of the same layout with different tiers.
    input.ownedWeapons = [gogmaSource(input, 'owned.fixture.bonus-fold', layoutALower())]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA(), layoutC()],
      keepSupported: true,
      keeps: [
        { counterOffset: 0, currentBonuses: layoutALower(), result: layoutALower() },
        { counterOffset: 1, currentBonuses: layoutA(), result: layoutALower() },
      ],
    })
    const calls = gogmaCalls(engine)
    const result = await searchCandidates(input, engine, deterministicExecution)

    // One representative survives, and it is the depth-1 Reset state.
    const secondKeep = calls.keepInputs().filter(({ counter }) => counter === 11)
    expect(secondKeep).toHaveLength(1)
    expect(secondKeep[0].currentBonuses).toEqual(layoutA())
    // The folded Keep-only state was still published as a depth-1 Candidate.
    expect(result.targetResults[0].candidates.map(({ route }) =>
      operationTypes(route.operations),
    )).toContain('keep_bonuses')
  })

  it('rebuilds the canonical Reset-then-Keep operation sequence of every depth', async () => {
    const input = existingGogmaInput(3)
    input.ownedWeapons = [gogmaSource(input, 'owned.fixture.bonus-canonical', layoutS())]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA(), layoutB(), layoutC()],
      keepSupported: true,
      keeps: [
        { counterOffset: 0, currentBonuses: layoutS(), result: layoutS() },
        { counterOffset: 1, currentBonuses: layoutA(), result: layoutALower() },
        { counterOffset: 1, currentBonuses: layoutS(), result: layoutS() },
        { counterOffset: 2, currentBonuses: layoutB(), result: layoutBHigher() },
        { counterOffset: 2, currentBonuses: layoutALower(), result: layoutALower() },
        { counterOffset: 2, currentBonuses: layoutS(), result: layoutS() },
      ],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const source = input.ownedWeapons[0]
    const depthThree = result.targetResults[0].candidates
      .filter(({ route }) => route.operations.length === 3)
      .map(({ route }) => operationTypes(route.operations))
      .sort()

    expect(depthThree).toEqual([
      'keep_bonuses,keep_bonuses,keep_bonuses',
      'reset_bonuses,keep_bonuses,keep_bonuses',
      'reset_bonuses,reset_bonuses,keep_bonuses',
      'reset_bonuses,reset_bonuses,reset_bonuses',
    ])

    for (const sequence of depthThree) {
      const candidate = result.targetResults[0].candidates.find(
        ({ route }) => operationTypes(route.operations) === sequence,
      )
      expect(candidate?.route.operations.map((operation) =>
        operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
          ? [operation.gogmaCounterBefore, operation.gogmaCounterAfter, operation.sourceOwnedWeaponId]
          : null,
      )).toEqual([
        [10, 11, source.id],
        [11, 12, source.id],
        [12, 13, source.id],
      ])
      expect(candidate?.estimatedGogmaAdvance).toBe(3)
    }
  })

  it('records a null transient source for a converted Route amendment', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    input.settings.maxGogmaAdvance = 2
    input.settings.maxSkillAdvance = 1
    input.calculationContext.rngEngineVersion = 'fake-fixture:bonus-stream-independence'
    const source = {
      ...structuredClone(input.ownedWeapons[0]),
      kind: 'normal' as const,
      rarity: 8 as const,
      restorationBonusScope: 'normal_artian' as const,
      restorationBonuses: practicalOnlyBonuses(),
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    } as unknown as CandidateSearchInput['ownedWeapons'][number]
    input.ownedWeapons = [source]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA(), layoutC()],
      keepSupported: true,
      skillSupported: true,
      skillPositions: 2,
      idealSkillIndex: 0,
      keeps: [{ counterOffset: 1, currentBonuses: layoutA(), result: layoutALower() }],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    // Normal-scope Keep stays unsupported, so depth 1 is Reset only.
    expect(candidates.map(({ route }) => operationTypes(route.operations)))
      .not.toContain('convert_normal_to_gogma,keep_bonuses')
    const mixed = candidates.find(({ route }) =>
      operationTypes(route.operations) === 'convert_normal_to_gogma,reset_bonuses,keep_bonuses',
    )
    expect(mixed?.route.sourceOwnedWeaponId).toBe(source.id)
    expect(mixed?.route.operations.slice(1).map((operation) =>
      operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
        ? [operation.type, operation.gogmaCounterBefore, operation.sourceOwnedWeaponId]
        : null,
    )).toEqual([
      ['reset_bonuses', 10, null],
      ['keep_bonuses', 11, null],
    ])
  })

  it('performs no Bonus amendment search when the current bonuses already satisfy Ideal', async () => {
    const input = existingGogmaInput(3)
    input.settings.maxSkillAdvance = 2
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.bonus-ideal', createRestorationBonusSet(), {
        seriesSkillId: OTHER_SERIES_SKILL,
      }),
    ]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutB(), layoutC(), layoutB()],
      keepSupported: true,
      skillSupported: true,
      skillPositions: 2,
      idealSkillIndex: 0,
    })
    const calls = gogmaCalls(engine)
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(calls.total()).toBe(0)
    expect(candidates.some(({ route }) =>
      route.operations.some(({ type }) =>
        type === 'reset_bonuses' || type === 'keep_bonuses',
      ),
    )).toBe(false)
    // Only the Bonus stream stopped; the Skill stream still reaches Ideal.
    const resetSkills = candidates.find(({ route }) =>
      route.kind === 'existing_gogma_reset_skills',
    )
    expect(resetSkills?.category).toBe('ideal')
    expect(operationTypes(resetSkills?.route.operations ?? [])).toBe('reset_skills')
  })

  it('keeps searching the Bonus stream when the current bonuses are Practical only', async () => {
    const input = existingGogmaInput(2)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.bonus-practical', practicalOnlyBonuses()),
    ]
    const engine = createBonusFixtureEngine(input, {
      resets: [layoutA(), layoutC()],
      keepSupported: true,
      keeps: [
        { counterOffset: 0, currentBonuses: practicalOnlyBonuses(), result: layoutB() },
        { counterOffset: 1, currentBonuses: layoutA(), result: layoutALower() },
        { counterOffset: 1, currentBonuses: layoutB(), result: layoutBHigher() },
      ],
    })
    const calls = gogmaCalls(engine)
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(calls.resetCounters()).toEqual([10, 11])
    const ideal = candidates.find(({ category }) => category === 'ideal')
    expect(operationTypes(ideal?.route.operations ?? [])).toBe('reset_bonuses')
    expect(candidates.some(({ category }) => category === 'practical')).toBe(true)
  })

  it('does not grow the Skill prediction count with the Bonus family layout count', async () => {
    const run = async (maxGogmaAdvance: number) => {
      const input = existingGogmaInput(maxGogmaAdvance)
      input.settings.maxSkillAdvance = 2
      input.ownedWeapons = [
        gogmaSource(input, 'owned.fixture.bonus-skill-regression', layoutS(), {
          seriesSkillId: OTHER_SERIES_SKILL,
        }),
      ]
      const engine = createBonusFixtureEngine(input, {
        resets: [layoutA(), layoutB(), layoutC()].slice(0, maxGogmaAdvance),
        keepSupported: true,
        skillSupported: true,
        skillPositions: 2,
        idealSkillIndex: 0,
        keeps: [
          { counterOffset: 0, currentBonuses: layoutS(), result: layoutS() },
          { counterOffset: 1, currentBonuses: layoutA(), result: layoutALower() },
          { counterOffset: 1, currentBonuses: layoutS(), result: layoutS() },
          { counterOffset: 2, currentBonuses: layoutB(), result: layoutBHigher() },
          { counterOffset: 2, currentBonuses: layoutALower(), result: layoutALower() },
          { counterOffset: 2, currentBonuses: layoutS(), result: layoutS() },
        ],
      })
      const skills = vi.spyOn(engine, 'predictSkills')
      const gogma = gogmaCalls(engine)
      await searchCandidates(input, engine, deterministicExecution)
      return {
        skillCounters: skills.mock.calls.map(([call]) => call.skillCounter),
        gogmaTotal: gogma.total(),
      }
    }

    const narrow = await run(1)
    const wide = await run(3)
    expect(narrow.skillCounters).toEqual([7, 8])
    expect(wide.skillCounters).toEqual([7, 8])
    expect(wide.gogmaTotal).toBeGreaterThan(narrow.gogmaTotal)
  })
})
