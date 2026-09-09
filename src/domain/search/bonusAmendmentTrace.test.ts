import { describe, expect, it } from 'vitest'
import {
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { ownedWeaponId } from '../../test/fixtures/domainData'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import { createBuildCandidateMeaningFingerprint } from '../buildList'
import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../models/publicTypes'
import { validateBuildCandidate } from '../models/validation'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import { createCandidateBonusAmendmentTrace } from './candidateFactory'
import { searchCandidates } from './candidateSearch'
import { candidateDeduplicationKey, candidateStableKey } from './candidateProcessing'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const START_GOGMA_COUNTER = 10

type Family = 'attack' | 'element' | 'utility' | 'sharpness'
type Tier = 'l' | 'm' | 'h' | 'x'

const ranks: Record<Tier, string> = {
  l: 'bonus_rank.fixture.low',
  m: 'bonus_rank.fixture.middle',
  h: 'bonus_rank.fixture.high',
  x: 'bonus_rank.fixture.special',
}

/**
 * Builds one five-slot result from an ordered family layout plus per-slot
 * tiers. Keep preserves the family at each slot and rerolls only the tier, so
 * every Keep fixture below reuses its input's layout unchanged.
 */
function slots(
  layout: readonly [Family, Family, Family, Family, Family],
  tiers: readonly [Tier, Tier, Tier, Tier, Tier],
): RestorationBonusSet {
  const [a, b, c, d, e] = layout.map((family, index) =>
    restorationBonus(`bonus_type.fixture.${family}`, ranks[tiers[index]]),
  )
  return restorationBonusSet(a, b, c, d, e)
}

const LP = ['attack', 'attack', 'element', 'utility', 'utility'] as const
const L1 = ['attack', 'element', 'attack', 'utility', 'sharpness'] as const
const L2 = ['element', 'attack', 'attack', 'sharpness', 'utility'] as const
const L3 = ['attack', 'attack', 'element', 'sharpness', 'sharpness'] as const
const L4 = ['sharpness', 'attack', 'attack', 'element', 'utility'] as const

/** The source's own five slots; identical to the shared Practical fixture. */
const P0 = () => practicalOnlyBonuses()
const KP1 = () => slots(LP, ['h', 'h', 'm', 'm', 'l'])
const KP2 = () => slots(LP, ['h', 'h', 'm', 'h', 'l'])
const KP3 = () => slots(LP, ['h', 'h', 'm', 'x', 'l'])
const KP4 = () => slots(LP, ['h', 'h', 'h', 'l', 'l'])
const R1 = () => slots(L1, ['h', 'm', 'h', 'l', 'l'])
const K1b = () => slots(L1, ['h', 'm', 'h', 'l', 'm'])
const K1c = () => slots(L1, ['h', 'm', 'h', 'l', 'h'])
const K1d = () => slots(L1, ['h', 'm', 'h', 'l', 'x'])
const R2 = () => slots(L2, ['m', 'h', 'h', 'l', 'm'])
const C3 = () => slots(L2, ['m', 'h', 'h', 'm', 'm'])
const D4 = () => slots(L2, ['m', 'h', 'h', 'h', 'm'])
const R3 = () => slots(L3, ['h', 'h', 'm', 'l', 'm'])
const K3d = () => slots(L3, ['h', 'h', 'm', 'l', 'h'])
const R4 = () => slots(L4, ['m', 'h', 'h', 'x', 'l'])

/**
 * A four-deep Bonus stream over one unprotected Gogma source.
 *
 * Reset is predicted once per Counter position and Keep once per
 * `(Counter, ordered family layout)`, so the fixtures below describe exactly
 * the frontier the stream actually reaches. The Ideal five slots are never
 * produced, which keeps the search running to the configured depth.
 */
function createTraceFixtureInput(): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings.maxGogmaAdvance = 4
  input.settings.maxSkillAdvance = 1
  input.calculationContext.rngEngineVersion = 'fake-fixture:bonus-amendment-trace'
  input.targetWeapons[0].idealBonuses[3] = {
    bonusTypeId: 'bonus_type.fixture.utility',
    bonusRankId: 'bonus_rank.fixture.special',
  }
  input.targetWeapons[0].idealBonuses[4] = {
    bonusTypeId: 'bonus_type.fixture.sharpness',
    bonusRankId: 'bonus_rank.fixture.special',
  }
  const source = {
    ...structuredClone(input.ownedWeapons[0] as OwnedGogmaArtianWeapon),
    id: ownedWeaponId('owned.fixture.trace-source'),
    restorationBonusScope: 'gogma_artian',
    restorationBonuses: P0(),
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
    isProtected: false,
  } as OwnedGogmaArtianWeapon
  input.ownedWeapons = [source]
  return input
}

function createTraceFixtureEngine(input: CandidateSearchInput): FakeRngEngine {
  const baseSeed = input.rngState.baseSeed.value as string
  const target = input.targetWeapons[0]
  const resets = [R1(), R2(), R3(), R4()]
  const keeps: Array<{
    offset: number
    current: RestorationBonusSet
    result: RestorationBonusSet
  }> = [
    { offset: 0, current: P0(), result: KP1() },
    { offset: 1, current: R1(), result: K1b() },
    { offset: 1, current: KP1(), result: KP2() },
    { offset: 2, current: R2(), result: C3() },
    { offset: 2, current: K1b(), result: K1c() },
    { offset: 2, current: KP2(), result: KP3() },
    { offset: 3, current: R3(), result: K3d() },
    { offset: 3, current: C3(), result: D4() },
    { offset: 3, current: K1c(), result: K1d() },
    { offset: 3, current: KP3(), result: KP4() },
  ]
  const fixtures: FakeRngFixtures = {
    version: 'bonus-amendment-trace',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: false,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: false,
      supportsKeepBonusesPrediction: true,
    },
    normalizedSeeds: [],
    normalArtianPredictions: [],
    // The Fake Engine matches fixtures by `JSON.stringify`, so the property
    // order below mirrors the call sites in `bonusStream.ts`.
    resetBonusPredictions: resets.map((result, index) => ({
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
    keepBonusPredictions: keeps.map(({ offset, current, result }) => ({
      input: {
        baseSeed,
        gogmaCounter: START_GOGMA_COUNTER + offset,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'keep_bonuses' as const, currentBonuses: current },
        master: input.master,
      },
      result,
    })),
    skillPredictions: [],
    gogmaCounterAdvances: resets.flatMap((_, index) => [
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
    skillCounterAdvances: [],
    normalCounterAdvances: [],
  }
  return new FakeRngEngine(fixtures)
}

function operationTypes(operations: readonly RouteOperation[]): string[] {
  return operations.map(({ type }) => type)
}

async function searchTraceCandidates(): Promise<BuildCandidate[]> {
  const input = createTraceFixtureInput()
  const engine = createTraceFixtureEngine(input)
  const result = await searchCandidates(input, engine, deterministicExecution)
  return result.targetResults[0].candidates
}

function findByOperationTypes(
  candidates: readonly BuildCandidate[],
  expected: readonly string[],
): BuildCandidate {
  const matches = candidates.filter(
    (candidate) =>
      operationTypes(candidate.route.operations).join(',') === expected.join(','),
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

const RESET_RESET_KEEP_KEEP = [
  'reset_bonuses',
  'reset_bonuses',
  'keep_bonuses',
  'keep_bonuses',
] as const

describe('Candidate bonus amendment trace', () => {
  it('associates every Reset and Keep with the result of that same operation', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP)

    expect(candidate.bonusAmendmentTrace).toEqual([
      {
        operationIndex: 0,
        operationType: 'reset_bonuses',
        restorationBonuses: R1(),
        restorationBonusScope: 'gogma_artian',
      },
      {
        operationIndex: 1,
        operationType: 'reset_bonuses',
        restorationBonuses: R2(),
        restorationBonusScope: 'gogma_artian',
      },
      {
        operationIndex: 2,
        operationType: 'keep_bonuses',
        restorationBonuses: C3(),
        restorationBonusScope: 'gogma_artian',
      },
      {
        operationIndex: 3,
        operationType: 'keep_bonuses',
        restorationBonuses: D4(),
        restorationBonusScope: 'gogma_artian',
      },
    ])
  })

  it('keeps every repeated Reset distinct instead of repeating the final result', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = findByOperationTypes(candidates, [
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
    ])

    const results = (candidate.bonusAmendmentTrace ?? []).map(
      ({ restorationBonuses }) => restorationBonuses,
    )
    expect(results).toEqual([R1(), R2(), R3(), R4()])
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(4)
    expect(
      results.filter(
        (result) => JSON.stringify(result) === JSON.stringify(candidate.finalBonuses),
      ),
    ).toHaveLength(1)
  })

  it('ends the trace on the Candidate final bonuses for every searched Route', async () => {
    const candidates = await searchTraceCandidates()
    expect(candidates.length).toBeGreaterThan(1)

    candidates.forEach((candidate) => {
      const trace = candidate.bonusAmendmentTrace ?? []
      expect(trace).toHaveLength(candidate.estimatedGogmaAdvance)
      const last = trace.at(-1)
      if (!last) return
      // The Route may continue with Reset Skills, so the comparison is against
      // the last bonus amendment, not the last operation.
      expect(last.restorationBonuses).toEqual(candidate.finalBonuses)
      expect(last.restorationBonusScope).toBe(candidate.restorationBonusScope)
    })
  })

  it('preserves the predicted slot order instead of a normalized multiset', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP)

    // L2 starts with element and ends with utility, so any sorting or multiset
    // normalization would reorder these slots.
    expect(
      candidate.bonusAmendmentTrace?.[3].restorationBonuses.map(
        ({ bonusTypeId, bonusRankId }) => `${bonusTypeId}/${bonusRankId}`,
      ),
    ).toEqual([
      'bonus_type.fixture.element/bonus_rank.fixture.middle',
      'bonus_type.fixture.attack/bonus_rank.fixture.high',
      'bonus_type.fixture.attack/bonus_rank.fixture.high',
      'bonus_type.fixture.sharpness/bonus_rank.fixture.high',
      'bonus_type.fixture.utility/bonus_rank.fixture.middle',
    ])
  })

  it('never attaches a bonus result to a non-amendment operation', async () => {
    const candidates = await searchTraceCandidates()
    expect(candidates.length).toBeGreaterThan(0)

    candidates.forEach((candidate) => {
      const trace = candidate.bonusAmendmentTrace ?? []
      trace.forEach((step) => {
        const operation = candidate.route.operations[step.operationIndex]
        expect(operation.type).toBe(step.operationType)
        expect(['reset_bonuses', 'keep_bonuses']).toContain(operation.type)
      })
    })
  })

  it('leaves Candidate semantic identity untouched', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP)
    const withoutTrace = structuredClone(candidate)
    delete withoutTrace.bonusAmendmentTrace

    expect(candidateStableKey(withoutTrace)).toBe(candidateStableKey(candidate))
    expect(candidateDeduplicationKey(withoutTrace)).toBe(
      candidateDeduplicationKey(candidate),
    )
    expect(createBuildCandidateMeaningFingerprint(withoutTrace)).toBe(
      createBuildCandidateMeaningFingerprint(candidate),
    )
    expect(withoutTrace.id).toBe(candidate.id)
    expect(withoutTrace.searchStateHash).toBe(candidate.searchStateHash)
    expect(withoutTrace.referencedOwnedWeaponsHash).toBe(
      candidate.referencedOwnedWeaponsHash,
    )
  })
})

describe('createCandidateBonusAmendmentTrace', () => {
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
  const resetSkills: RouteOperation = {
    type: 'reset_skills',
    sourceOwnedWeaponId: null,
    skillCounterBefore: 8,
    skillCounterAfter: 9,
  }

  it('binds results to the amendment operation positions inside the whole Route', () => {
    const trace = createCandidateBonusAmendmentTrace(
      [
        conversion,
        amendment(10, 'reset_bonuses'),
        amendment(11, 'keep_bonuses'),
        resetSkills,
      ],
      [
        { restorationBonuses: R1(), restorationBonusScope: 'gogma_artian' },
        { restorationBonuses: C3(), restorationBonusScope: 'gogma_artian' },
      ],
    )

    expect(trace).toEqual([
      {
        operationIndex: 1,
        operationType: 'reset_bonuses',
        restorationBonuses: R1(),
        restorationBonusScope: 'gogma_artian',
      },
      {
        operationIndex: 2,
        operationType: 'keep_bonuses',
        restorationBonuses: C3(),
        restorationBonusScope: 'gogma_artian',
      },
    ])
  })

  it('distinguishes the same family multiset held in a different slot order', () => {
    const first = slots(L1, ['h', 'm', 'h', 'l', 'l'])
    const second = slots(L2, ['m', 'h', 'h', 'l', 'l'])
    const trace = createCandidateBonusAmendmentTrace(
      [amendment(10, 'reset_bonuses'), amendment(11, 'reset_bonuses')],
      [
        { restorationBonuses: first, restorationBonusScope: 'gogma_artian' },
        { restorationBonuses: second, restorationBonusScope: 'gogma_artian' },
      ],
    )

    const families = trace.map(({ restorationBonuses }) =>
      restorationBonuses.map(({ bonusTypeId }) => bonusTypeId),
    )
    expect([...families[0]].sort()).toEqual([...families[1]].sort())
    expect(families[0]).not.toEqual(families[1])
    expect(trace[0].restorationBonuses).toEqual(first)
    expect(trace[1].restorationBonuses).toEqual(second)
  })

  it('rejects a result count that does not match the Route amendments', () => {
    expect(() =>
      createCandidateBonusAmendmentTrace(
        [amendment(10, 'reset_bonuses'), amendment(11, 'keep_bonuses')],
        [{ restorationBonuses: R1(), restorationBonusScope: 'gogma_artian' }],
      ),
    ).toThrow(/bonus amendment operation/)
  })
})

/** Issue paths of an invalid Candidate, so a test pins the failing rule. */
function issuePaths(candidate: BuildCandidate): string[] {
  const validation = validateBuildCandidate(candidate)
  expect(validation.isValid).toBe(false)
  return validation.issues.map(({ path }) => path)
}

describe('Candidate validation of the amendment trace', () => {
  it('accepts a Candidate persisted before the trace existed', async () => {
    const candidates = await searchTraceCandidates()
    const legacy = structuredClone(candidates[0])
    delete legacy.bonusAmendmentTrace

    expect(validateBuildCandidate(legacy).isValid).toBe(true)
  })

  it('rejects a trace whose entries do not follow the Route amendments', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP)
    const trace = candidate.bonusAmendmentTrace ?? []
    const shifted = structuredClone(candidate)
    shifted.bonusAmendmentTrace = [...trace.slice(1), trace[0]]
    const shortened = structuredClone(candidate)
    shortened.bonusAmendmentTrace = trace.slice(0, 2)

    expect(validateBuildCandidate(candidate).isValid).toBe(true)
    expect(validateBuildCandidate(shifted).isValid).toBe(false)
    expect(validateBuildCandidate(shortened).isValid).toBe(false)
  })

  it('accepts a searched Candidate whose trace ends on its own final bonuses', async () => {
    const candidates = await searchTraceCandidates()
    expect(candidates.length).toBeGreaterThan(1)

    candidates.forEach((candidate) => {
      expect(validateBuildCandidate(candidate).isValid).toBe(true)
    })
  })

  it('rejects a last amendment whose five slots differ from finalBonuses', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = structuredClone(
      findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP),
    )
    const trace = candidate.bonusAmendmentTrace ?? []
    const last = trace[trace.length - 1]
    last.restorationBonuses = [
      ...last.restorationBonuses.slice(0, 4),
      restorationBonus('bonus_type.fixture.utility', ranks.l),
    ] as RestorationBonusSet

    expect(last.restorationBonuses).not.toEqual(candidate.finalBonuses)
    expect(issuePaths(candidate)).toContain('bonusAmendmentTrace[3].restorationBonuses')
  })

  it('rejects a last amendment holding the same multiset in another slot order', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = structuredClone(
      findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP),
    )
    const trace = candidate.bonusAmendmentTrace ?? []
    const last = trace[trace.length - 1]
    const [first, second, ...rest] = last.restorationBonuses
    last.restorationBonuses = [second, first, ...rest] as RestorationBonusSet

    // The multiset comparison would accept this permutation, which is exactly
    // why the final-entry check compares slot by slot: slot order is the Keep
    // prediction input.
    expect(
      areRestorationBonusSetsEqual(last.restorationBonuses, candidate.finalBonuses),
    ).toBe(true)
    expect(last.restorationBonuses).not.toEqual(candidate.finalBonuses)
    expect(issuePaths(candidate)).toContain('bonusAmendmentTrace[3].restorationBonuses')
  })

  it('rejects a last amendment whose scope differs from the Candidate scope', async () => {
    const candidates = await searchTraceCandidates()
    const candidate = structuredClone(
      findByOperationTypes(candidates, RESET_RESET_KEEP_KEEP),
    )
    const trace = candidate.bonusAmendmentTrace ?? []
    const last = trace[trace.length - 1]
    last.restorationBonusScope = 'normal_artian'

    expect(candidate.restorationBonusScope).toBe('gogma_artian')
    expect(issuePaths(candidate)).toContain(
      'bonusAmendmentTrace[3].restorationBonusScope',
    )
  })
})
