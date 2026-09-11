import { describe, expect, it } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { ownedWeaponId } from '../../test/fixtures/domainData'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import { createBuildCandidateMeaningFingerprint } from '../buildList'
import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../models/publicTypes'
import { validateBuildCandidate } from '../models/validation'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import {
  createCandidateBonusAmendmentTrace,
  createCandidateSkillAmendmentTrace,
} from './candidateFactory'
import { searchCandidates } from './candidateSearch'
import { candidateDeduplicationKey, candidateStableKey } from './candidateProcessing'
import { CandidateSearchError } from './searchTypes'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const START_SKILL_COUNTER = 7
const START_GOGMA_COUNTER = 10

/**
 * Source Skills plus one distinct Series / Group pair per Reset Skills
 * position, so the stream-local retention of SEARCH_SPEC 5.5.2 keeps all three
 * Reset depths and a shifted binding is immediately visible.
 */
const SOURCE_SKILLS = { seriesSkillId: 'series_skill.fixture.s0', groupSkillId: 'group_skill.fixture.a' }
const RESET_SKILLS = [
  { seriesSkillId: 'series_skill.fixture.s1', groupSkillId: 'group_skill.fixture.a' },
  { seriesSkillId: 'series_skill.fixture.s2', groupSkillId: 'group_skill.fixture.a' },
  { seriesSkillId: 'series_skill.fixture.s3', groupSkillId: 'group_skill.fixture.a' },
]

/** Practical but not Ideal, so neither stream terminates early. */
function resetBonusResult(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.middle'),
  )
}

/**
 * One unprotected Gogma source whose current Skills do not satisfy the Target's
 * Ideal Skill condition, so the Skill stream really runs to `maxSkillAdvance`.
 */
function createSkillTraceInput(): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings.maxSkillAdvance = 3
  input.settings.maxGogmaAdvance = 1
  input.calculationContext.rngEngineVersion = 'fake-fixture:skill-amendment-trace'
  input.targetWeapons[0].idealSkillCondition = { seriesSkillId: 'series_skill.fixture.ideal', groupSkillId: 'group_skill.fixture.a', matchMode: 'all' }
  input.targetWeapons[0].practicalSkillCondition = { seriesSkillId: null, groupSkillId: 'group_skill.fixture.a', matchMode: 'all' }
  const source = {
    ...structuredClone(input.ownedWeapons[0] as OwnedGogmaArtianWeapon),
    id: ownedWeaponId('owned.fixture.skill-trace-source'),
    restorationBonusScope: 'gogma_artian',
    restorationBonuses: practicalOnlyBonuses(),
    ...SOURCE_SKILLS,
    isProtected: false,
  } as OwnedGogmaArtianWeapon
  input.ownedWeapons = [source]
  return input
}

function createSkillTraceEngine(input: CandidateSearchInput): FakeRngEngine {
  const baseSeed = input.rngState.baseSeed.value as string
  const target = input.targetWeapons[0]
  const skillInput = (skillCounter: number) => ({
    baseSeed,
    skillCounter,
    weaponTypeId: target.weaponTypeId,
    elementId: target.elementId,
    master: input.master,
  })
  const fixtures: FakeRngFixtures = {
    version: 'skill-amendment-trace',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: false,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: false,
    },
    normalizedSeeds: [],
    normalArtianPredictions: [],
    resetBonusPredictions: [
      {
        input: {
          baseSeed,
          gogmaCounter: START_GOGMA_COUNTER,
          weaponTypeId: target.weaponTypeId,
          elementId: target.elementId,
          operation: { type: 'reset_bonuses' as const },
          master: input.master,
        },
        result: resetBonusResult(),
      },
    ],
    keepBonusPredictions: [],
    skillPredictions: RESET_SKILLS.map((result, index) => ({
      input: skillInput(START_SKILL_COUNTER + index),
      result,
    })),
    gogmaCounterAdvances: [
      {
        current: START_GOGMA_COUNTER,
        operation: { type: 'reset_bonuses' as const },
        result: START_GOGMA_COUNTER + 1,
      },
    ],
    skillCounterAdvances: RESET_SKILLS.map((_, index) => ({
      current: START_SKILL_COUNTER + index,
      operation: { type: 'reset_skills' as const },
      result: START_SKILL_COUNTER + index + 1,
    })),
    normalCounterAdvances: [],
  }
  return new FakeRngEngine(fixtures)
}

async function searchSkillTraceCandidates(): Promise<BuildCandidate[]> {
  const input = createSkillTraceInput()
  const result = await searchCandidates(
    input,
    createSkillTraceEngine(input),
    deterministicExecution,
  )
  return result.targetResults[0].candidates
}

function resetSkillsCount(candidate: BuildCandidate): number {
  return candidate.route.operations.filter(({ type }) => type === 'reset_skills').length
}

function findByResetSkillsCount(
  candidates: readonly BuildCandidate[],
  count: number,
): BuildCandidate {
  const matches = candidates.filter(
    (candidate) =>
      candidate.route.kind === 'existing_gogma_reset_skills' &&
      resetSkillsCount(candidate) === count,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

describe('Candidate skill amendment trace', () => {
  it('records the predicted Skills of a single Reset Skills operation', async () => {
    const candidates = await searchSkillTraceCandidates()
    const candidate = findByResetSkillsCount(candidates, 1)

    expect(candidate.skillAmendmentTrace).toEqual([
      { operationIndex: 0, operationType: 'reset_skills', ...RESET_SKILLS[0] },
    ])
    expect(candidate.seriesSkillId).toBe(RESET_SKILLS[0].seriesSkillId)
    expect(candidate.groupSkillId).toBe(RESET_SKILLS[0].groupSkillId)
  })

  it('binds each of several consecutive Reset Skills to its own predicted result', async () => {
    const candidates = await searchSkillTraceCandidates()
    const candidate = findByResetSkillsCount(candidates, 3)

    expect(candidate.skillAmendmentTrace).toEqual([
      { operationIndex: 0, operationType: 'reset_skills', ...RESET_SKILLS[0] },
      { operationIndex: 1, operationType: 'reset_skills', ...RESET_SKILLS[1] },
      { operationIndex: 2, operationType: 'reset_skills', ...RESET_SKILLS[2] },
    ])
    // The last Reset is the Candidate's own result; an off-by-one binding would
    // put `s2 / g2` here instead.
    expect(candidate.seriesSkillId).toBe(RESET_SKILLS[2].seriesSkillId)
    expect(candidate.groupSkillId).toBe(RESET_SKILLS[2].groupSkillId)
  })

  it('ends every trace on the Candidate final Skills without repeating them', async () => {
    const candidates = await searchSkillTraceCandidates()
    expect(candidates.length).toBeGreaterThan(1)

    candidates.forEach((candidate) => {
      const trace = candidate.skillAmendmentTrace ?? []
      expect(trace).toHaveLength(resetSkillsCount(candidate))
      const last = trace.at(-1)
      if (!last) return
      expect(last.seriesSkillId).toBe(candidate.seriesSkillId)
      expect(last.groupSkillId).toBe(candidate.groupSkillId)
      expect(new Set(trace.map(({ seriesSkillId }) => seriesSkillId)).size).toBe(trace.length)
    })
  })

  it('records an empty trace for a Candidate that never resets Skills', async () => {
    const candidates = await searchSkillTraceCandidates()
    const bonusOnly = candidates.filter(
      (candidate) => candidate.route.kind === 'existing_gogma_reset_bonuses',
    )

    expect(bonusOnly.length).toBeGreaterThan(0)
    bonusOnly.forEach((candidate) => {
      // A Search-generated Candidate always carries the observation, so zero
      // Reset Skills is `[]` and never the legacy `undefined`.
      expect(candidate.skillAmendmentTrace).toEqual([])
      expect(candidate.seriesSkillId).toBe(SOURCE_SKILLS.seriesSkillId)
    })
  })

  it('never attaches a Skill result to a non-Reset-Skills operation', async () => {
    const candidates = await searchSkillTraceCandidates()
    expect(candidates.length).toBeGreaterThan(0)

    candidates.forEach((candidate) => {
      ;(candidate.skillAmendmentTrace ?? []).forEach((step) => {
        expect(candidate.route.operations[step.operationIndex].type).toBe('reset_skills')
        expect(step.operationType).toBe('reset_skills')
      })
    })
  })

  it('leaves Candidate semantic identity untouched', async () => {
    const candidates = await searchSkillTraceCandidates()
    const candidate = findByResetSkillsCount(candidates, 3)
    const withoutTrace = structuredClone(candidate)
    delete withoutTrace.skillAmendmentTrace
    const alteredTrace = structuredClone(candidate)
    alteredTrace.skillAmendmentTrace = [
      { operationIndex: 0, operationType: 'reset_skills', seriesSkillId: null, groupSkillId: null },
    ]

    for (const variant of [withoutTrace, alteredTrace]) {
      expect(candidateStableKey(variant)).toBe(candidateStableKey(candidate))
      expect(candidateDeduplicationKey(variant)).toBe(candidateDeduplicationKey(candidate))
      expect(createBuildCandidateMeaningFingerprint(variant)).toBe(
        createBuildCandidateMeaningFingerprint(candidate),
      )
      expect(variant.id).toBe(candidate.id)
      expect(variant.searchStateHash).toBe(candidate.searchStateHash)
      expect(variant.referencedOwnedWeaponsHash).toBe(candidate.referencedOwnedWeaponsHash)
    }
  })

  it('validates a Candidate saved before the field existed', async () => {
    const candidates = await searchSkillTraceCandidates()
    const legacy = structuredClone(findByResetSkillsCount(candidates, 3))
    delete legacy.skillAmendmentTrace

    expect(validateBuildCandidate(legacy).isValid).toBe(true)
  })

  it('rejects a trace whose last entry disagrees with the Candidate Skills', async () => {
    const candidates = await searchSkillTraceCandidates()
    const broken = structuredClone(findByResetSkillsCount(candidates, 3))
    broken.skillAmendmentTrace = (broken.skillAmendmentTrace ?? []).map((step, index) => ({
      ...step,
      ...(index === 2 ? RESET_SKILLS[0] : {}),
    }))

    const validation = validateBuildCandidate(broken)
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toContain(
      'skillAmendmentTrace[2].seriesSkillId',
    )
  })

  it('rejects a trace whose entry count does not match the Route', async () => {
    const candidates = await searchSkillTraceCandidates()
    const broken = structuredClone(findByResetSkillsCount(candidates, 3))
    broken.skillAmendmentTrace = (broken.skillAmendmentTrace ?? []).slice(0, 2)

    const validation = validateBuildCandidate(broken)
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toContain('skillAmendmentTrace')
  })
})

describe('Candidate skill amendment trace across RouteKinds', () => {
  /**
   * The trace is produced by the shared Skill stream, so it is not tied to one
   * RouteKind: a conversion Route records its Reset Skills the same way an
   * existing-Gogma Route does, and the conversion operation itself never gets
   * an entry.
   */
  it('records Reset Skills on a conversion Route without touching the conversion', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    // The conversion assigns `series_skill.fixture.a`, so the Ideal Skill must
    // be something else or the Skill stream stops before any Reset Skills.
    input.targetWeapons[0].practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
    input.targetWeapons[0].idealSkillCondition = {
      seriesSkillId: 'series_skill.fixture.b',
      groupSkillId: null,
      matchMode: 'all',
    }
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        resetResult: practicalOnlyBonuses(),
        resetSkillSeriesSkillId: 'series_skill.fixture.b',
      }),
      deterministicExecution,
    )
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) =>
        route.kind === 'normal_artian_to_gogma' &&
        route.operations.some(({ type }) => type === 'reset_skills'),
    )

    expect(candidate).toBeDefined()
    const trace = candidate?.skillAmendmentTrace ?? []
    expect(trace).toHaveLength(1)
    expect(candidate?.route.operations[trace[0].operationIndex].type).toBe('reset_skills')
    expect(trace[0].seriesSkillId).toBe('series_skill.fixture.b')
    expect(trace[0].seriesSkillId).toBe(candidate?.seriesSkillId)
    // The initial Skill assignment of `convert_normal_to_gogma` is out of scope
    // for this trace and must not be reported as a Reset Skills result.
    const conversionIndex = (candidate?.route.operations ?? []).findIndex(
      ({ type }) => type === 'convert_normal_to_gogma',
    )
    expect(conversionIndex).toBeGreaterThanOrEqual(0)
    expect(trace.map(({ operationIndex }) => operationIndex)).not.toContain(conversionIndex)
  })
})

describe('createCandidateSkillAmendmentTrace', () => {
  const resetSkills = (skillCounterBefore: number): RouteOperation => ({
    type: 'reset_skills',
    sourceOwnedWeaponId: null,
    skillCounterBefore,
    skillCounterAfter: skillCounterBefore + 1,
  })
  const amendment = (
    gogmaCounterBefore: number,
    type: 'reset_bonuses' | 'keep_bonuses',
  ): RouteOperation => ({
    type,
    sourceOwnedWeaponId: null,
    gogmaCounterBefore,
    gogmaCounterAfter: gogmaCounterBefore + 1,
  })
  const conversion: RouteOperation = {
    type: 'convert_normal_to_gogma',
    weaponTypeId: 'weapon.fixture.a',
    skillCounterBefore: 7,
    skillCounterAfter: 8,
  }

  it('binds results to the Reset Skills positions inside the whole Route', () => {
    const trace = createCandidateSkillAmendmentTrace(
      [conversion, amendment(10, 'reset_bonuses'), resetSkills(8), resetSkills(9)],
      [RESET_SKILLS[0], RESET_SKILLS[1]],
    )

    expect(trace).toEqual([
      { operationIndex: 2, operationType: 'reset_skills', ...RESET_SKILLS[0] },
      { operationIndex: 3, operationType: 'reset_skills', ...RESET_SKILLS[1] },
    ])
  })

  it('coexists with the bonus trace without overlapping operation indexes', () => {
    const operations: RouteOperation[] = [
      amendment(10, 'reset_bonuses'),
      amendment(11, 'keep_bonuses'),
      resetSkills(7),
      resetSkills(8),
    ]
    const bonusTrace = createCandidateBonusAmendmentTrace(operations, [
      { restorationBonuses: resetBonusResult(), restorationBonusScope: 'gogma_artian' },
      { restorationBonuses: practicalOnlyBonuses(), restorationBonusScope: 'gogma_artian' },
    ])
    const skillTrace = createCandidateSkillAmendmentTrace(operations, [
      RESET_SKILLS[0],
      RESET_SKILLS[1],
    ])

    expect(bonusTrace.map(({ operationIndex }) => operationIndex)).toEqual([0, 1])
    expect(skillTrace.map(({ operationIndex }) => operationIndex)).toEqual([2, 3])
    bonusTrace.forEach(({ operationIndex, operationType }) =>
      expect(operations[operationIndex].type).toBe(operationType),
    )
    skillTrace.forEach(({ operationIndex }) =>
      expect(operations[operationIndex].type).toBe('reset_skills'),
    )
  })

  it('rejects a result count that does not match the Route Reset Skills', () => {
    expect(() =>
      createCandidateSkillAmendmentTrace(
        [resetSkills(7), resetSkills(8)],
        [RESET_SKILLS[0]],
      ),
    ).toThrow(CandidateSearchError)
  })

  it('never pads a missing result with the Route final Skills', () => {
    expect(() =>
      createCandidateSkillAmendmentTrace([resetSkills(7), resetSkills(8)], []),
    ).toThrow(/2 Reset Skills operation\(s\) but 0 predicted result\(s\)/)
  })
})
