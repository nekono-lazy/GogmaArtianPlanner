import { describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import {
  createRestorationBonusSet,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  RestorationBonusSet,
} from '../models/publicTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import { evaluateTargetCandidate } from '../target'
import { searchCandidates } from './candidateSearch'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const START_GOGMA_COUNTER = 10
const START_SKILL_COUNTER = 7
const START_NORMAL_COUNTER = 4
const ENGINE_VERSION = 'candidate-composition'

const attackHigh = () => restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high')
const attackMiddle = () => restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.middle')
const elementMiddle = () => restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle')
const utilityLow = () => restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low')

/**
 * A Practical five-slot result of layout `attack / attack / element / utility /
 * sharpness`, distinguished by the sharpness tier so every state of the fixture
 * has its own completed multiset.
 */
const practicalBonuses = (sharpnessRank: string): RestorationBonusSet =>
  restorationBonusSet(
    attackHigh(),
    attackHigh(),
    elementMiddle(),
    utilityLow(),
    restorationBonus('bonus_type.fixture.sharpness', sharpnessRank),
  )

/** Fails the `attack >= high x2` Practical bonus condition. */
const belowPracticalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(
    attackMiddle(),
    attackMiddle(),
    elementMiddle(),
    utilityLow(),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.low'),
  )

/** Layout `element / attack / attack / utility / utility`; a Keep-only chain. */
const keepChainBonuses = (utilityRank: string): RestorationBonusSet =>
  restorationBonusSet(
    elementMiddle(),
    attackHigh(),
    attackHigh(),
    utilityLow(),
    restorationBonus('bonus_type.fixture.utility', utilityRank),
  )

const RANKS = [
  'bonus_rank.fixture.low',
  'bonus_rank.fixture.middle',
  'bonus_rank.fixture.high',
  'bonus_rank.fixture.special',
]

interface CompositionFixtureOptions {
  /** Reset result at `START_GOGMA_COUNTER + index`. */
  resets: RestorationBonusSet[]
  keeps?: Array<{
    counterOffset: number
    currentBonuses: RestorationBonusSet
    result: RestorationBonusSet
  }>
  keepSupported?: boolean
  /** Series Skill published at `START_SKILL_COUNTER + index`. */
  skills: (string | null)[]
  /** Normal Artian prediction per forge offset, for conversion Routes. */
  normals?: RestorationBonusSet[]
}

function createCompositionEngine(
  input: CandidateSearchInput,
  options: CompositionFixtureOptions,
): FakeRngEngine {
  const baseSeed = input.rngState.baseSeed.value as string
  const target = input.targetWeapons[0]
  const normals = options.normals ?? []
  const fixtures: FakeRngFixtures = {
    version: ENGINE_VERSION,
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: normals.length > 0,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
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
    keepBonusPredictions: (options.keeps ?? []).map(
      ({ counterOffset, currentBonuses, result }) => ({
        input: {
          baseSeed,
          gogmaCounter: START_GOGMA_COUNTER + counterOffset,
          weaponTypeId: target.weaponTypeId,
          elementId: target.elementId,
          operation: { type: 'keep_bonuses' as const, currentBonuses },
          master: input.master,
        },
        result,
      }),
    ),
    skillPredictions: options.skills.map((seriesSkillId, index) => ({
      input: {
        baseSeed,
        skillCounter: START_SKILL_COUNTER + index,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master: input.master,
      },
      result: { seriesSkillId, groupSkillId: null },
    })),
    normalCounterAdvances: normals.map((_, index) => ({
      current: START_NORMAL_COUNTER,
      operation: { type: 'create_normal_artian' as const, count: index + 1 },
      result: START_NORMAL_COUNTER + index + 1,
    })),
    gogmaCounterAdvances: options.resets.flatMap((_, index) => [
      {
        current: START_GOGMA_COUNTER + index,
        operation: { type: 'reset_bonuses' as const },
        result: START_GOGMA_COUNTER + index + 1,
      },
      {
        current: START_GOGMA_COUNTER + index,
        operation: { type: 'keep_bonuses' as const },
        result: START_GOGMA_COUNTER + index + 1,
      },
    ]),
    skillCounterAdvances: [
      ...options.skills.map((_, index) => ({
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

function compositionInput(
  maxGogmaAdvance: number,
  maxSkillAdvance: number,
): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings.maxGogmaAdvance = maxGogmaAdvance
  input.settings.maxSkillAdvance = maxSkillAdvance
  input.calculationContext.rngEngineVersion = `fake-fixture:${ENGINE_VERSION}`
  return input
}

function gogmaSource(
  input: CandidateSearchInput,
  id: string,
  restorationBonuses: RestorationBonusSet,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  const base = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  return {
    ...structuredClone(base),
    id: ownedWeaponId(id),
    restorationBonuses,
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.source',
    groupSkillId: null,
    isProtected: false,
    ...overrides,
  } as OwnedGogmaArtianWeapon
}

function normalSource(
  input: CandidateSearchInput,
  id: string,
  restorationBonuses: RestorationBonusSet,
): OwnedWeapon {
  return {
    ...structuredClone(input.ownedWeapons[0]),
    id: ownedWeaponId(id),
    kind: 'normal' as const,
    rarity: 8 as const,
    restorationBonuses,
    restorationBonusScope: 'normal_artian' as const,
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
  } as unknown as OwnedWeapon
}

const operationTypes = (candidate: BuildCandidate) =>
  candidate.route.operations.map(({ type }) => type).join(',')

const axisShape = (candidate: BuildCandidate) => [
  candidate.estimatedGogmaAdvance,
  candidate.estimatedSkillAdvance,
]

describe('Candidate composition follows the Cross rule (SEARCH_SPEC 5.5.4)', () => {
  /**
   * Four Bonus solutions (`d = 0 ... 3`) and four Skill solutions
   * (`k = 0 ... 3`), all Practical and all with distinct outcomes.
   */
  function crossFixture() {
    const input = compositionInput(3, 3)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.cross', practicalBonuses(RANKS[0])),
    ]
    const engine = createCompositionEngine(input, {
      resets: [
        practicalBonuses(RANKS[1]),
        practicalBonuses(RANKS[2]),
        practicalBonuses(RANKS[3]),
      ],
      skills: [
        'series_skill.fixture.k1',
        'series_skill.fixture.k2',
        'series_skill.fixture.k3',
      ],
    })
    return { input, engine }
  }

  it('produces |B| + |K| - 1 pairs per Route base, not |B| x |K|', async () => {
    const { input, engine } = crossFixture()
    const createCandidateId = vi.fn(
      ({ semanticHash }: { semanticHash: string }) =>
        `candidate.${semanticHash}` as BuildCandidate['id'],
    )
    const result = await searchCandidates(input, engine, {
      ...deterministicExecution,
      createCandidateId,
    })
    const candidates = result.targetResults[0].candidates

    // |B(practical)| = 4 (d = 0 ... 3), |K(practical)| = 4 (k = 0 ... 3).
    // The Cross yields 7 pairs, and `(d = 0, k = 0)` is not a Candidate.
    expect(createCandidateId).toHaveBeenCalledTimes(6)
    expect(candidates).toHaveLength(6)
    expect(candidates.length).toBeLessThan(4 * 4)
  })

  it('fixes the Skill anchor on the Bonus axis and the Bonus anchor on the Skill axis', async () => {
    const { input, engine } = crossFixture()
    const result = await searchCandidates(input, engine, deterministicExecution)
    const shapes = result.targetResults[0].candidates.map(axisShape)

    expect(shapes.sort()).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [2, 0],
      [3, 0],
    ])
    // No off-axis pair: never both streams advanced at once.
    expect(shapes.every(([gogma, skill]) => gogma === 0 || skill === 0)).toBe(true)
  })

  it('is unchanged when the Route base evaluation order changes', async () => {
    const run = async (reverseSources: boolean) => {
      const input = compositionInput(2, 2)
      const sources = [
        gogmaSource(input, 'owned.fixture.order-a', practicalBonuses(RANKS[0])),
        gogmaSource(input, 'owned.fixture.order-b', keepChainBonuses(RANKS[1])),
      ]
      input.ownedWeapons = reverseSources ? [...sources].reverse() : sources
      const engine = createCompositionEngine(input, {
        resets: [practicalBonuses(RANKS[1]), practicalBonuses(RANKS[2])],
        skills: ['series_skill.fixture.k1', 'series_skill.fixture.k2'],
      })
      const result = await searchCandidates(input, engine, deterministicExecution)
      return result.targetResults[0].candidates.map((candidate) => [
        candidate.route.kind,
        candidate.route.sourceOwnedWeaponId,
        operationTypes(candidate),
        ...axisShape(candidate),
      ])
    }

    expect(await run(true)).toEqual(await run(false))
  })

  it('does not change the composed set when resultFilter changes', async () => {
    const run = async (resultFilter: CandidateSearchInput['resultFilter']) => {
      const { input, engine } = crossFixture()
      input.resultFilter = resultFilter
      const gogma = vi.spyOn(engine, 'predictGogmaBonus')
      const skill = vi.spyOn(engine, 'predictSkills')
      const result = await searchCandidates(input, engine, deterministicExecution)
      return {
        gogmaCalls: gogma.mock.calls.length,
        skillCalls: skill.mock.calls.length,
        shapes: result.targetResults[0].candidates.map(axisShape).sort(),
      }
    }

    const all = await run('all')
    const practical = await run('practical')
    const ideal = await run('ideal')

    expect(practical.gogmaCalls).toBe(all.gogmaCalls)
    expect(practical.skillCalls).toBe(all.skillCalls)
    expect(ideal.gogmaCalls).toBe(all.gogmaCalls)
    expect(ideal.skillCalls).toBe(all.skillCalls)
    expect(practical.shapes).toEqual(all.shapes)
  })

  it('lets the Target evaluator decide the final category of a Practical Cross pair', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.category', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.other',
      }),
    ]
    const engine = createCompositionEngine(input, {
      // The Bonus anchor of the Practical Cross is also the Ideal result, and
      // the Skill anchor is also the Ideal Skill.
      resets: [createRestorationBonusSet()],
      skills: ['series_skill.fixture.a'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(candidates.some(({ category }) => category === 'ideal')).toBe(true)
    for (const candidate of candidates) {
      const expected = evaluateTargetCandidate(
        input.targetWeapons[0],
        candidate.finalBonuses,
        candidate.restorationBonusScope,
        candidate.seriesSkillId,
        candidate.groupSkillId,
        input.master,
        input.settings.similarityThreshold,
      )
      expect(candidate.category).toBe(expected.category)
      expect(candidate.idealDifference).toEqual(expected.idealDifference)
      expect(candidate.similarityScore).toBe(expected.similarityScore)
      expect(candidate.isSimilarToIdeal).toBe(expected.isSimilarToIdeal)
    }
  })
})

describe('Zero-operation stream solutions (SEARCH_SPEC 5.5.5)', () => {
  it('produces no Candidate for an existing Gogma d = 0 and k = 0 pair', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.zero', practicalBonuses(RANKS[0])),
    ]
    const engine = createCompositionEngine(input, {
      // Both streams reach exactly the Route base's own current state again.
      resets: [practicalBonuses(RANKS[0])],
      skills: ['series_skill.fixture.source'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(result.targetResults[0].candidates).toEqual([])
  })

  it('anchors the Skill axis on d = 0 when only the current bonuses are Practical', async () => {
    const input = compositionInput(1, 2)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.zero-bonus', practicalBonuses(RANKS[0])),
    ]
    const engine = createCompositionEngine(input, {
      resets: [belowPracticalBonuses()],
      skills: ['series_skill.fixture.k1', 'series_skill.fixture.k2'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(candidates.map(axisShape).sort()).toEqual([[0, 1], [0, 2]])
    expect(candidates.every(({ route }) =>
      route.kind === 'existing_gogma_reset_skills',
    )).toBe(true)
  })

  it('anchors the Bonus axis on k = 0 when only the current Skills are usable', async () => {
    const input = compositionInput(2, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.zero-skill', belowPracticalBonuses()),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[0]), practicalBonuses(RANKS[1])],
      skills: ['series_skill.fixture.k1'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(result.targetResults[0].candidates.map(axisShape).sort())
      .toEqual([[1, 0], [1, 1], [2, 0]])
  })

  it('keeps searching Ideal from a Practical-only current state', async () => {
    const input = compositionInput(2, 2)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.practical-only', practicalBonuses(RANKS[0]), {
        seriesSkillId: 'series_skill.fixture.other',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[1]), createRestorationBonusSet()],
      skills: ['series_skill.fixture.k1', 'series_skill.fixture.a'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    // The zero-operation Practical state did not stop either stream.
    expect(candidates.some(({ finalBonuses }) =>
      finalBonuses.every((bonus, index) =>
        bonus.bonusTypeId === createRestorationBonusSet()[index].bonusTypeId &&
        bonus.bonusRankId === createRestorationBonusSet()[index].bonusRankId,
      ),
    )).toBe(true)
    expect(candidates.some(({ seriesSkillId }) =>
      seriesSkillId === 'series_skill.fixture.a',
    )).toBe(true)
  })

  it('still composes a conversion Route at d = 0 and k = 0', async () => {
    const input = compositionInput(1, 1)
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = [
      normalSource(input, 'owned.fixture.conversion', practicalBonuses(RANKS[0])),
    ]
    input.normalCounters = []
    const engine = createCompositionEngine(input, {
      resets: [belowPracticalBonuses()],
      // A conversion Route covers M + 1 Skill positions: the conversion itself
      // plus Reset Skills 1 ... M (SEARCH_SPEC 3.1).
      skills: ['series_skill.fixture.k1', 'series_skill.fixture.k2'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(candidates.some((candidate) =>
      operationTypes(candidate) === 'convert_normal_to_gogma',
    )).toBe(true)
  })
})

describe('Composed RouteKind and operation order', () => {
  it('derives existing Gogma RouteKinds from the composed (d, k) pair', async () => {
    const input = compositionInput(2, 1)
    input.ownedWeapons = [
      // Below Practical, so the Bonus anchor is an amendment result and the
      // Skill axis composes with `d > 0`.
      gogmaSource(input, 'owned.fixture.kinds', belowPracticalBonuses()),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[0]), practicalBonuses(RANKS[1])],
      keepSupported: true,
      keeps: [
        {
          counterOffset: 0,
          currentBonuses: belowPracticalBonuses(),
          result: keepChainBonuses(RANKS[1]),
        },
        {
          counterOffset: 1,
          currentBonuses: practicalBonuses(RANKS[0]),
          result: practicalBonuses(RANKS[2]),
        },
        {
          counterOffset: 1,
          currentBonuses: keepChainBonuses(RANKS[1]),
          result: keepChainBonuses(RANKS[2]),
        },
      ],
      skills: ['series_skill.fixture.k1'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const byKind = new Map(
      result.targetResults[0].candidates.map((candidate) => [
        `${candidate.route.kind}|${operationTypes(candidate)}`,
        candidate,
      ]),
    )

    // Reset only with k = 0.
    expect([...byKind.keys()]).toContain('existing_gogma_reset_bonuses|reset_bonuses')
    // Keep only with k = 0.
    expect([...byKind.keys()]).toContain('existing_gogma_keep_bonuses|keep_bonuses')
    // Reset then Keep with k = 0.
    expect([...byKind.keys()]).toContain(
      'existing_gogma_mixed|reset_bonuses,keep_bonuses',
    )
    // d > 0 with k > 0.
    expect([...byKind.keys()]).toContain(
      'existing_gogma_mixed|reset_bonuses,reset_skills',
    )
  })

  it('uses existing_gogma_reset_skills for d = 0 with k > 0', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.skill-only', practicalBonuses(RANKS[0])),
    ]
    const engine = createCompositionEngine(input, {
      resets: [belowPracticalBonuses()],
      skills: ['series_skill.fixture.k1'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(candidates).toHaveLength(1)
    expect(candidates[0].route.kind).toBe('existing_gogma_reset_skills')
    expect(operationTypes(candidates[0])).toBe('reset_skills')
  })

  it('places Bonus operations before Skill operations in every RouteKind', async () => {
    const input = compositionInput(2, 2)
    input.routeFilter = 'all'
    input.normalCounters[0].counter = START_NORMAL_COUNTER
    input.settings.maxNormalAdvance = 1
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.order-gogma', belowPracticalBonuses()),
      normalSource(input, 'owned.fixture.order-normal', belowPracticalBonuses()),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[0]), practicalBonuses(RANKS[1])],
      skills: [
        'series_skill.fixture.k1',
        'series_skill.fixture.k2',
        'series_skill.fixture.k3',
      ],
      normals: [belowPracticalBonuses()],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const sequences = result.targetResults[0].candidates.map(operationTypes)
    const bonusTypes = ['reset_bonuses', 'keep_bonuses']

    expect(sequences.length).toBeGreaterThan(0)
    for (const sequence of sequences) {
      const types = sequence.split(',')
      const lastBonus = types.reduce(
        (last, type, index) => (bonusTypes.includes(type) ? index : last),
        -1,
      )
      const firstSkill = types.indexOf('reset_skills')
      if (lastBonus >= 0 && firstSkill >= 0) {
        expect(lastBonus).toBeLessThan(firstSkill)
      }
      // Conversion Routes always open with their base operations.
      const streamIndexes = [lastBonus, firstSkill].filter((index) => index >= 0)
      if (types.includes('convert_normal_to_gogma') && streamIndexes.length > 0) {
        expect(types.indexOf('convert_normal_to_gogma'))
          .toBeLessThan(Math.min(...streamIndexes))
      }
      if (types.includes('create_normal_artian')) {
        expect(types[0]).toBe('create_normal_artian')
        expect(types[1]).toBe('convert_normal_to_gogma')
      }
    }
    expect(sequences.some((sequence) =>
      sequence === 'create_normal_artian,convert_normal_to_gogma,reset_bonuses',
    )).toBe(true)
    expect(sequences.some((sequence) =>
      sequence === 'convert_normal_to_gogma,reset_bonuses,reset_skills',
    )).toBe(true)
    expect(sequences.some((sequence) =>
      sequence === 'reset_bonuses,reset_skills',
    )).toBe(true)
  })

  it('keeps a protected source on the Skill axis only', async () => {
    const input = compositionInput(2, 2)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.protected', practicalBonuses(RANKS[0]), {
        isProtected: true,
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[1]), practicalBonuses(RANKS[2])],
      skills: ['series_skill.fixture.k1', 'series_skill.fixture.k2'],
    })
    const gogma = vi.spyOn(engine, 'predictGogmaBonus')
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = result.targetResults[0].candidates

    expect(gogma).not.toHaveBeenCalled()
    expect(candidates.map(axisShape).sort()).toEqual([[0, 1], [0, 2]])
    expect(candidates.every(({ route }) =>
      route.kind === 'existing_gogma_reset_skills',
    )).toBe(true)
  })
})

describe('Stream solutions are shared across Route bases', () => {
  it('does not repeat a prediction per owned Gogma source', async () => {
    const run = async (sourceCount: number) => {
      const input = compositionInput(2, 2)
      input.ownedWeapons = Array.from({ length: sourceCount }, (_, index) =>
        gogmaSource(
          input,
          `owned.fixture.share-${index}`,
          keepChainBonuses(RANKS[index % RANKS.length]),
        ),
      )
      const engine = createCompositionEngine(input, {
        resets: [practicalBonuses(RANKS[0]), practicalBonuses(RANKS[1])],
        skills: ['series_skill.fixture.k1', 'series_skill.fixture.k2'],
      })
      const gogma = vi.spyOn(engine, 'predictGogmaBonus')
      const skill = vi.spyOn(engine, 'predictSkills')
      await searchCandidates(input, engine, deterministicExecution)
      return { gogma: gogma.mock.calls.length, skill: skill.mock.calls.length }
    }

    const single = await run(1)
    const many = await run(4)

    expect(many.skill).toBe(single.skill)
    expect(many.gogma).toBe(single.gogma)
  })

  it('does not repeat a prediction per Normal offset', async () => {
    const run = async (maxNormalAdvance: number) => {
      const input = compositionInput(2, 2)
      input.routeFilter = 'normal_artian'
      input.ownedWeapons = []
      input.normalCounters[0].counter = START_NORMAL_COUNTER
      input.settings.maxNormalAdvance = maxNormalAdvance
      const engine = createCompositionEngine(input, {
        resets: [practicalBonuses(RANKS[0]), practicalBonuses(RANKS[1])],
        skills: [
          'series_skill.fixture.k1',
          'series_skill.fixture.k2',
          'series_skill.fixture.k3',
        ],
        normals: Array.from({ length: maxNormalAdvance }, (_, index) =>
          keepChainBonuses(RANKS[index % RANKS.length]),
        ),
      })
      const gogma = vi.spyOn(engine, 'predictGogmaBonus')
      const skill = vi.spyOn(engine, 'predictSkills')
      await searchCandidates(input, engine, deterministicExecution)
      return { gogma: gogma.mock.calls.length, skill: skill.mock.calls.length }
    }

    const single = await run(1)
    const many = await run(4)

    expect(many.skill).toBe(single.skill)
    expect(many.gogma).toBe(single.gogma)
  })

  it('keeps different Route bases separate even when they reach the same result', async () => {
    const input = compositionInput(1, 1)
    const shared = keepChainBonuses(RANKS[0])
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.same-a', shared),
      gogmaSource(input, 'owned.fixture.same-b', structuredClone(shared)),
    ]
    const engine = createCompositionEngine(input, {
      resets: [belowPracticalBonuses()],
      skills: ['series_skill.fixture.k1'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const sources = result.targetResults[0].candidates.map(
      ({ route }) => route.sourceOwnedWeaponId,
    )

    expect(new Set(sources).size).toBe(2)
  })
})
