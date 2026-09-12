import { describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
  candidatesOf,
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
  /**
   * Group Skill published at `START_SKILL_COUNTER + index`.
   *
   * The fixture Target leaves the Group Skill unconstrained, so varying it is
   * how several distinct Skill solutions can all satisfy the Ideal condition.
   */
  groupSkills?: (string | null)[]
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
      result: {
        seriesSkillId,
        groupSkillId: options.groupSkills?.[index] ?? 'group_skill.fixture.a',
      },
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
    groupSkillId: 'group_skill.fixture.a',
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
  }
}

const operationTypes = (candidate: BuildCandidate) =>
  candidate.route.operations.map(({ type }) => type).join(',')

const axisShape = (candidate: BuildCandidate) => [
  candidate.estimatedGogmaAdvance,
  candidate.estimatedSkillAdvance,
]

describe('Candidate composition follows the Cross rule (SEARCH_SPEC 5.5.4)', () => {
  /**
   * One Ideal Bonus solution and three Ideal Skill solutions.
   *
   * The Ideal five slots are an exact multiset, so the Bonus axis can hold at
   * most one entry: stream retention keeps its smallest Gogma depth. The Ideal
   * Skill condition leaves the Group Skill unconstrained, so three distinct
   * Skill outcomes all satisfy it and the Skill axis holds three entries.
   */
  function crossFixture() {
    const input = compositionInput(3, 3)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.cross', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.source',
      })
    ]
    const engine = createCompositionEngine(input, {
      resets: [
        createRestorationBonusSet(),
        practicalBonuses(RANKS[2]),
        practicalBonuses(RANKS[3]),
      ],
      skills: [
        'series_skill.fixture.a',
        'series_skill.fixture.a',
        'series_skill.fixture.a',
      ],
      groupSkills: [
        'group_skill.fixture.k1',
        'group_skill.fixture.k2',
        'group_skill.fixture.k3',
      ],
    })
    return { input, engine }
  }

  it('composes |B| + |K| - 1 pairs per Route base, not |B| x |K|', async () => {
    const { input, engine } = crossFixture()
    const createCandidateId = vi.fn(
      ({ semanticHash }: { semanticHash: string }) =>
        `candidate.${semanticHash}` as BuildCandidate['id'],
    )
    const result = await searchCandidates(input, engine, {
      ...deterministicExecution,
      createCandidateId,
    })

    // |B| = 1, because the Ideal five slots are one exact multiset and stream
    // retention keeps its smallest Gogma depth. The Cross therefore never
    // composes a Cartesian product, and the target-wide queue stops at the
    // canonical Ideal, so the cheapest pair is the only one composed at all.
    expect(createCandidateId).toHaveBeenCalledTimes(1)
    expect(candidatesOf(result.targetResult)).toHaveLength(1)
  })

  it('fixes the Bonus anchor on the Skill axis', async () => {
    const { input, engine } = crossFixture()
    const result = await searchCandidates(input, engine, deterministicExecution)
    // Every composed pair keeps the single Ideal Bonus solution fixed, so the
    // Skill axis is the only one that can vary.
    expect(candidatesOf(result.targetResult).map(axisShape)).toEqual([[1, 1]])
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
      return candidatesOf(result.targetResult).map((candidate) => [
        candidate.route.kind,
        candidate.route.sourceOwnedWeaponId,
        operationTypes(candidate),
        ...axisShape(candidate),
      ])
    }

    expect(await run(true)).toEqual(await run(false))
  })

  it('composes only Ideal results, and the Target evaluator agrees', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.category', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.other',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [createRestorationBonusSet()],
      skills: ['series_skill.fixture.a'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = candidatesOf(result.targetResult)

    expect(candidates).toHaveLength(1)
    for (const candidate of candidates) {
      const expected = evaluateTargetCandidate(
        input.targetWeapons[0],
        candidate.finalBonuses,
        candidate.restorationBonusScope,
        candidate.seriesSkillId,
        candidate.groupSkillId,
        input.master,
      )
      // Every composed result satisfies both axes at Ideal.
      expect(expected.bonusMatch).toBe('ideal')
      expect(expected.skillMatch).toBe('ideal')
      expect(candidate.idealDifference).toEqual(expected.idealDifference)
    }
  })
})

describe('Zero-operation stream solutions (SEARCH_SPEC 5.5.5)', () => {
  it('produces an existing-current Candidate for a d = 0 and k = 0 pair', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.zero', createRestorationBonusSet(), {
        seriesSkillId: 'series_skill.fixture.a',
      }),
    ]
    // The source already satisfies both Ideal axes, so neither stream is
    // searched and the zero-operation Candidate is the whole result.
    const engine = createCompositionEngine(input, { resets: [], skills: [] })
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(candidatesOf(result.targetResult)).toHaveLength(1)
    expect(candidatesOf(result.targetResult)[0].route).toEqual({
      kind: 'existing_gogma_current',
      sourceOwnedWeaponId: input.ownedWeapons[0].id,
      operations: [],
    })
  })

  it('anchors the Skill axis on d = 0 when the current bonuses are already Ideal', async () => {
    const input = compositionInput(1, 2)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.zero-bonus', createRestorationBonusSet(), {
        seriesSkillId: 'series_skill.fixture.source',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [],
      skills: ['series_skill.fixture.a', 'series_skill.fixture.a'],
      groupSkills: ['group_skill.fixture.k1', 'group_skill.fixture.k2'],
    })
    const createCandidateId = vi.fn(
      ({ semanticHash }: { semanticHash: string }) =>
        `candidate.${semanticHash}` as BuildCandidate['id'],
    )
    const result = await searchCandidates(input, engine, {
      ...deterministicExecution,
      createCandidateId,
    })

    // The Bonus axis holds only its zero-operation solution, so every composed
    // pair is a Reset Skills Route, and the queue stops at the cheapest one.
    expect(createCandidateId).toHaveBeenCalledTimes(1)
    expect(candidatesOf(result.targetResult).map(axisShape)).toEqual([[0, 1]])
    expect(candidatesOf(result.targetResult)[0].route.kind)
      .toBe('existing_gogma_reset_skills')
  })

  it('anchors the Bonus axis on k = 0 when the current Skills are already Ideal', async () => {
    const input = compositionInput(2, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.zero-skill', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.a',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [createRestorationBonusSet(), practicalBonuses(RANKS[1])],
      skills: [],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(candidatesOf(result.targetResult).map(axisShape)).toEqual([[1, 0]])
    expect(candidatesOf(result.targetResult)[0].route.kind)
      .toBe('existing_gogma_reset_bonuses')
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
      groupSkills: ['group_skill.fixture.a', 'group_skill.fixture.a'],
    })
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = candidatesOf(result.targetResult)

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

  it('rejects a normal-scope conversion at d = 0 and k = 0', async () => {
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
    const candidates = candidatesOf(result.targetResult).filter(({ route }) =>
      route.kind === 'existing_gogma_reset_skills',
    )

    expect(candidates.some((candidate) =>
      operationTypes(candidate) === 'convert_normal_to_gogma',
    )).toBe(false)
  })
})

describe('Composed RouteKind and operation order', () => {
  /**
   * A Search returns exactly one canonical Ideal Candidate, so each RouteKind
   * is exercised by making that Route's own final result the Target's Ideal.
   */
  it('uses existing_gogma_reset_bonuses for d > 0 with k = 0', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.reset-only', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.a',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [createRestorationBonusSet()],
      skills: [],
    })
    const [candidate] = candidatesOf(
      (await searchCandidates(input, engine, deterministicExecution)).targetResult,
    )
    expect(candidate.route.kind).toBe('existing_gogma_reset_bonuses')
    expect(operationTypes(candidate)).toBe('reset_bonuses')
  })

  it('uses existing_gogma_keep_bonuses for a Keep-only chain with k = 0', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.keep-only', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.a',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[0])],
      keepSupported: true,
      keeps: [
        {
          counterOffset: 0,
          currentBonuses: belowPracticalBonuses(),
          result: createRestorationBonusSet(),
        },
      ],
      skills: [],
    })
    const [candidate] = candidatesOf(
      (await searchCandidates(input, engine, deterministicExecution)).targetResult,
    )
    expect(candidate.route.kind).toBe('existing_gogma_keep_bonuses')
    expect(operationTypes(candidate)).toBe('keep_bonuses')
  })

  it('uses existing_gogma_reset_skills for d = 0 with k > 0', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.skill-only', createRestorationBonusSet(), {
        seriesSkillId: 'series_skill.fixture.other',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [],
      skills: ['series_skill.fixture.a'],
    })
    const [candidate] = candidatesOf(
      (await searchCandidates(input, engine, deterministicExecution)).targetResult,
    )
    expect(candidate.route.kind).toBe('existing_gogma_reset_skills')
    expect(operationTypes(candidate)).toBe('reset_skills')
  })

  it('places Bonus operations before Skill operations in a mixed Route', async () => {
    const input = compositionInput(1, 1)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.order-gogma', belowPracticalBonuses(), {
        seriesSkillId: 'series_skill.fixture.other',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [createRestorationBonusSet()],
      skills: ['series_skill.fixture.a'],
    })
    const [candidate] = candidatesOf(
      (await searchCandidates(input, engine, deterministicExecution)).targetResult,
    )
    expect(candidate.route.kind).toBe('existing_gogma_mixed')
    expect(operationTypes(candidate)).toBe('reset_bonuses,reset_skills')
  })

  it('opens a conversion Route with its base operations', async () => {
    const input = compositionInput(1, 1)
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = []
    input.normalCounters[0].counter = START_NORMAL_COUNTER
    input.settings.maxNormalAdvance = 1
    const engine = createCompositionEngine(input, {
      resets: [createRestorationBonusSet()],
      // The conversion itself reads the Skill stream, and it already assigns
      // the Target's Ideal Series Skill, so no Reset Skills is needed.
      skills: ['series_skill.fixture.a'],
      normals: [belowPracticalBonuses()],
    })
    const [candidate] = candidatesOf(
      (await searchCandidates(input, engine, deterministicExecution)).targetResult,
    )
    expect(operationTypes(candidate)).toBe(
      'create_normal_artian,convert_normal_to_gogma,reset_bonuses',
    )
  })

  it('keeps a protected source only as its current-state candidate', async () => {
    const input = compositionInput(2, 2)
    input.ownedWeapons = [
      gogmaSource(input, 'owned.fixture.protected', createRestorationBonusSet(), {
        seriesSkillId: 'series_skill.fixture.a',
        isProtected: true,
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [practicalBonuses(RANKS[1]), practicalBonuses(RANKS[2])],
      skills: ['series_skill.fixture.k1', 'series_skill.fixture.k2'],
    })
    const gogma = vi.spyOn(engine, 'predictGogmaBonus')
    const skills = vi.spyOn(engine, 'predictSkills')
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = candidatesOf(result.targetResult)

    expect(gogma).not.toHaveBeenCalled()
    expect(skills).not.toHaveBeenCalled()
    expect(candidates.map(axisShape)).toEqual([[0, 0]])
    expect(candidates[0].route.kind).toBe('existing_gogma_current')
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
      gogmaSource(input, 'owned.fixture.same-a', shared, {
        seriesSkillId: 'series_skill.fixture.a',
      }),
      gogmaSource(input, 'owned.fixture.same-b', structuredClone(shared), {
        seriesSkillId: 'series_skill.fixture.a',
      }),
    ]
    const engine = createCompositionEngine(input, {
      resets: [createRestorationBonusSet()],
      skills: [],
    })
    // Both bases reach the same Ideal result, so both are composed as separate
    // Candidates; only one of them becomes the canonical Ideal, which is why
    // the separation is observed on the composition rather than on the result.
    const composedHashes: string[] = []
    await searchCandidates(input, engine, {
      ...deterministicExecution,
      createCandidateId: ({ semanticHash }) => {
        composedHashes.push(semanticHash)
        return `candidate.${semanticHash}` as BuildCandidate['id']
      },
    })

    // Two composed Candidates with different semantic identities: the source
    // OwnedWeapon is part of the Route, so one base never absorbs the other.
    expect(new Set(composedHashes).size).toBe(2)
  })
})
