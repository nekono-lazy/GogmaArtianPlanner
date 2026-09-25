import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../../test/fixtures/candidateSearch'
import { candidateId, ownedWeaponId } from '../../../test/fixtures/domainData'
import type { BuildCandidate, OwnedGogmaArtianWeapon, RestorationBonusSet } from '../../models/publicTypes'
import { keepFamilyLayoutKey } from '../../rng/gogmaBonusFamily'
import { satisfiesIdealTarget } from '../../target'
import { createTargetBonusStream } from '../bonusStream'
import { candidateStableKey } from '../candidateProcessing'
import { searchCandidates } from '../candidateSearch'
import type { ConstrainedSearchOrigin } from '../constrained/constrainedTypes'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import { createSearchPredictionSupport, type RouteSearchContext } from '../routeSearchShared'
import { createSearchExecutionContext } from '../searchExecution'
import { CandidateSearchError, type CandidateSearchInput } from '../searchTypes'
import { createTargetSkillStream } from '../skillStream'
import { TargetSearchScheduler } from '../targetSearchScheduler'
import { visitPlannerAlternativeCandidates } from './plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  PlannerAlternativeSearchError,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchInput,
} from './plannerAlternativeTypes'

/**
 * An unprotected owned Gogma whose first Reset Bonuses (Gogma 10) yields the
 * Ideal five slots and whose Skill reaches the Ideal Series Skill only at Skill
 * Counter 8, plus the fixture's confirmed Normal Counter. The canonical Ideal is
 * the existing-Gogma mixed Route (cost 3); the Normal Artian Routes (cost 4 for
 * one forge, one more per extra forge) are strictly more expensive Ideals the
 * initial Search never materializes. Every Normal offset forges the same
 * Practical-only slots, whose families differ from the Ideal, so the initial
 * Search's #104 reduction registers offset zero only.
 */
function fixture(bound = 5) {
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: bound, maxGogmaAdvance: bound, maxSkillAdvance: bound }
  input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
  input.ownedWeapons[0].restorationBonuses = practicalOnlyBonuses()
  input.ownedWeapons[0].isProtected = false
  input.ownedWeapons[0].seriesSkillId = 'series.other'
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const calls: string[] = []
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) => {
    calls.push('normal:' + normalCounter)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => {
    calls.push('skill:' + skillCounter)
    return { seriesSkillId: skillCounter === 8 ? 'series_skill.fixture.a' : 'series.other.' + skillCounter, groupSkillId: 'group_skill.fixture.a' }
  })
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    calls.push(operation.type + ':' + gogmaCounter + (operation.type === 'keep_bonuses' ? ':' + keepFamilyLayoutKey(operation.currentBonuses, input.master) : ''))
    if (operation.type === 'reset_bonuses' && gogmaCounter === 10) return structuredClone(input.targetWeapons[0].idealBonuses)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine, calls }
}

/** Two equally rated owned Gogma sources, the second one preferred by the Target. */
function preferredSourceFixture() {
  const f = fixture()
  const second: OwnedGogmaArtianWeapon = {
    ...(structuredClone(f.input.ownedWeapons[0]) as OwnedGogmaArtianWeapon),
    id: ownedWeaponId('owned.fixture.second'),
  }
  f.input.ownedWeapons.push(second)
  f.input.targetWeapons[0].preferredOwnedWeaponId = second.id
  return f
}

/** The fixture's own ideal current weapon: the canonical Ideal is the zero-operation current Route. */
function currentIdealFixture() {
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: 3, maxGogmaAdvance: 3, maxSkillAdvance: 3 }
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  return { input, engine, calls: [] as string[] }
}

const scenarios = [
  ['an existing-Gogma mixed canonical Ideal', fixture],
  ['a preferred source among equally rated sources', preferredSourceFixture],
  ['a zero-operation current canonical Ideal', currentIdealFixture],
] as const

const ordinaryOptions = { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 0 }

function originOf(input: CandidateSearchInput): ConstrainedSearchOrigin {
  return {
    rngState: input.rngState,
    normalCounters: input.normalCounters,
    ownedWeapons: input.ownedWeapons,
    targetWeapons: input.targetWeapons,
    master: input.master,
    calculationContext: input.calculationContext,
  }
}

/** Empty reservation, no exclusion, and the same three extents as the ordinary Search settings. */
function alternativeInput(
  input: CandidateSearchInput,
  overrides: Partial<PlannerAlternativeSearchInput> = {},
): PlannerAlternativeSearchInput {
  return {
    origin: originOf(input),
    targetWeaponId: input.targetWeaponId,
    extent: {
      maxNormalAdvance: input.settings.maxNormalAdvance,
      maxGogmaAdvance: input.settings.maxGogmaAdvance,
      maxSkillAdvance: input.settings.maxSkillAdvance,
    },
    reservation: emptyPlannerAlternativeReservation,
    excludedRouteKeys: [],
    ...overrides,
  }
}

async function collect(
  input: PlannerAlternativeSearchInput,
  engine: Parameters<typeof visitPlannerAlternativeCandidates>[1],
  limit = Infinity,
) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates(input, engine, (candidate) => {
    candidates.push(candidate)
    return candidates.length >= limit ? 'stop' : 'continue'
  })
  return { candidates, execution }
}

async function ordinaryCanonical(f: ReturnType<typeof fixture>): Promise<BuildCandidate> {
  const result = await searchCandidates(f.input, f.engine, ordinaryOptions)
  expect(result.targetResult.candidate).not.toBeNull()
  return result.targetResult.candidate as BuildCandidate
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Planner Alternative Search API boundary (SEARCH_SPEC 5.6.8)', () => {
  const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const imports = Object.entries(sources)
    .filter(([path]) => !/\.test\.ts$/.test(path))
    .flatMap(([, source]) => source.match(/import[^;]*?from '[^']+'/g) ?? [])

  it('is a separate API that never reaches searchCandidates() or the ordinary request', () => {
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter((statement) => /from '\.\.\/candidateSearch'/.test(statement))).toEqual([])
    expect(imports.filter((statement) => /\bsearchCandidates\b/.test(statement))).toEqual([])
    expect(Object.keys(alternativeInput(fixture().input)).sort())
      .toEqual(['excludedRouteKeys', 'extent', 'origin', 'reservation', 'targetWeaponId'])
  })

  it('takes no extent default from AppSettings, Candidate Search defaults or the constrained bounds', () => {
    const forbidden = /\b(?:defaultCandidateSearchSettings|recommendedCandidateSearchDefaults|candidateSearchDefaults|defaultConstrainedEnumerationBounds|AppSettings|CandidateSearchSettings|settingsRepository)\b/
    expect(imports.filter((statement) => forbidden.test(statement))).toEqual([])
  })

  it('searches exactly the caller extent, independently of the origin request settings', async () => {
    // The ordinary settings (bound 5) are not an input: with a Skill extent of
    // 1 the existing-Gogma Route cannot reach its Ideal at Skill 8, and no Skill
    // position beyond the conversion Route's reach is predicted.
    const f = fixture(5)
    const { candidates } = await collect(
      alternativeInput(f.input, { extent: { maxNormalAdvance: 5, maxGogmaAdvance: 5, maxSkillAdvance: 1 } }),
      f.engine,
    )
    // Every Normal offset of the extent (no #104 reduction), nothing else.
    expect(candidates.map((candidate) => candidate.route.kind)).toEqual(Array(5).fill('normal_artian_to_gogma'))
    expect(f.calls.filter((call) => call.startsWith('skill:')).sort()).toEqual(['skill:7', 'skill:8'])
  })

  it('refuses an invalid extent instead of substituting a default', async () => {
    const f = fixture()
    for (const extent of [
      { maxNormalAdvance: 0, maxGogmaAdvance: 5, maxSkillAdvance: 5 },
      { maxNormalAdvance: 5, maxGogmaAdvance: 1.5, maxSkillAdvance: 5 },
      { maxNormalAdvance: 5, maxGogmaAdvance: 5, maxSkillAdvance: -1 },
    ]) {
      await expect(collect(alternativeInput(f.input, { extent }), f.engine))
        .rejects.toMatchObject({ name: 'PlannerAlternativeSearchError', code: 'invalid_input' })
    }
    expect(f.calls).toEqual([])
  })
})

describe('empty reservation first-result parity (SEARCH_SPEC 13.2.6)', () => {
  it.each(scenarios)('returns the ordinary canonical Ideal first for %s', async (_, create) => {
    const canonical = await ordinaryCanonical(create())
    const f = create()
    const { candidates } = await collect(alternativeInput(f.input), f.engine, 1)
    expect(candidates).toHaveLength(1)
    expect(candidateStableKey(candidates[0])).toBe(candidateStableKey(canonical))
    // The same estimates, hashes and traces as the ordinary BuildCandidate.
    expect(candidates[0]).toMatchObject({
      estimatedOperationCount: canonical.estimatedOperationCount,
      estimatedGogmaAdvance: canonical.estimatedGogmaAdvance,
      estimatedSkillAdvance: canonical.estimatedSkillAdvance,
      estimatedNormalAdvance: canonical.estimatedNormalAdvance,
      requiredMaterials: canonical.requiredMaterials,
      searchStateHash: canonical.searchStateHash,
      referencedOwnedWeaponsHash: canonical.referencedOwnedWeaponsHash,
      calculationContext: canonical.calculationContext,
      bonusAmendmentTrace: canonical.bonusAmendmentTrace,
      skillAmendmentTrace: canonical.skillAmendmentTrace,
    })
    expect(candidates[0].conversionSkillTrace).toEqual(canonical.conversionSkillTrace)
  })

  it('leaves the ordinary Search result unchanged when run against the same input objects', async () => {
    const f = fixture()
    const snapshot = structuredClone(f.input)
    const before = await ordinaryCanonical(f)
    await collect(alternativeInput(f.input), f.engine)
    expect(f.input).toEqual(snapshot)
    const after = await ordinaryCanonical(f)
    expect(candidateStableKey(after)).toBe(candidateStableKey(before))
  })
})

describe('continuation past the canonical Ideal', () => {
  it('keeps returning the next Ideal while the consumer asks for it', async () => {
    const canonical = await ordinaryCanonical(fixture())
    const f = fixture()
    const { candidates, execution } = await collect(alternativeInput(f.input), f.engine)
    expect(candidates.map((candidate) => candidate.route.kind))
      .toEqual(['existing_gogma_mixed', ...Array(5).fill('normal_artian_to_gogma')])
    expect(candidateStableKey(candidates[0])).toBe(candidateStableKey(canonical))
    expect(candidates[1].estimatedOperationCount).toBeGreaterThan(canonical.estimatedOperationCount)
    const costs = candidates.map((candidate) => candidate.estimatedOperationCount)
    expect(costs).toEqual([3, 4, 5, 6, 7, 8])
    // The extent, not the search space, ended it: the Normal, Gogma and Skill
    // streams all have further reachable positions.
    expect(execution).toEqual({
      targetWeaponId: f.input.targetWeaponId,
      summary: { deliveredCandidates: 6, excludedCandidates: 0, exhausted: false, stoppedByExtent: true },
      stoppedByConsumer: false,
    })
  })

  it('stops as soon as the consumer says so', async () => {
    const f = fixture()
    const { candidates, execution } = await collect(alternativeInput(f.input), f.engine, 1)
    expect(candidates).toHaveLength(1)
    expect(execution.stoppedByConsumer).toBe(true)
    expect(execution.summary).toEqual({ deliveredCandidates: 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false })
  })

  it('returns only Ideal Candidates', async () => {
    const f = fixture()
    const target = f.input.targetWeapons[0]
    const { candidates } = await collect(alternativeInput(f.input), f.engine)
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(satisfiesIdealTarget(
        target, candidate.finalBonuses, candidate.restorationBonusScope,
        candidate.seriesSkillId, candidate.groupSkillId, f.input.master,
      )).toBe(true)
    }
  })

  it('orders equally costly Candidates by the six-key order, preferred source before the stable key', async () => {
    const f = preferredSourceFixture()
    const { candidates } = await collect(alternativeInput(f.input), f.engine)
    const cheapest = candidates.filter((candidate) => candidate.estimatedOperationCount === 3)
    expect(cheapest.map((candidate) => candidate.route.sourceOwnedWeaponId))
      .toEqual(['owned.fixture.second', 'owned.fixture.source'])

    const flipped = preferredSourceFixture()
    flipped.input.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.source')
    const again = await collect(alternativeInput(flipped.input), flipped.engine)
    expect(again.candidates.filter((candidate) => candidate.estimatedOperationCount === 3)
      .map((candidate) => candidate.route.sourceOwnedWeaponId))
      .toEqual(['owned.fixture.source', 'owned.fixture.second'])
  })

  it('rejects with the ordinary cancellation while searching', async () => {
    const f = fixture()
    let checks = 0
    await expect(visitPlannerAlternativeCandidates(alternativeInput(f.input), f.engine, () => 'continue', {
      shouldCancel: () => ++checks > 2,
    })).rejects.toSatisfy((error) => error instanceof CandidateSearchError && error.code === 'cancelled')
  })
})

describe('determinism and run independence', () => {
  it('returns the same Candidate sequence for the same input, whatever the Clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const first = fixture()
    const one = await collect(alternativeInput(first.input), first.engine)
    vi.setSystemTime(new Date('2030-06-15T12:34:56.000Z'))
    const second = fixture()
    const two = await collect(alternativeInput(second.input), second.engine)
    expect(two.candidates.map(candidateStableKey)).toEqual(one.candidates.map(candidateStableKey))
    expect(two.candidates).toEqual(one.candidates)
    expect(randomUUID).not.toHaveBeenCalled()
  })

  it('does not depend on the ordinary request searchRunId, which is not an input at all', async () => {
    const first = fixture()
    first.input.searchRunId = 'search-run.a'
    const second = fixture()
    second.input.searchRunId = 'search-run.b'
    const one = await collect(alternativeInput(first.input), first.engine)
    const two = await collect(alternativeInput(second.input), second.engine)
    expect(two.candidates).toEqual(one.candidates)
  })

  it('carries no BuildCandidate identity, run or time metadata', async () => {
    const f = fixture()
    const { candidates } = await collect(alternativeInput(f.input), f.engine)
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty('id')
      expect(candidate).not.toHaveProperty('searchRunId')
      expect(candidate).not.toHaveProperty('createdAt')
      expect(candidate).not.toHaveProperty('intermediateStateGroups')
    }
  })
})

describe('observation traces', () => {
  it('records the Bonus, Skill and conversion observations of each Route', async () => {
    const f = fixture()
    const { candidates } = await collect(alternativeInput(f.input), f.engine)
    const [mixed, normal] = candidates
    expect(mixed.bonusAmendmentTrace).toEqual([expect.objectContaining({ operationIndex: 0, operationType: 'reset_bonuses', restorationBonusScope: 'gogma_artian' })])
    expect(mixed.skillAmendmentTrace).toEqual([
      { operationIndex: 1, operationType: 'reset_skills', seriesSkillId: 'series.other.7', groupSkillId: 'group_skill.fixture.a' },
      { operationIndex: 2, operationType: 'reset_skills', seriesSkillId: 'series_skill.fixture.a', groupSkillId: 'group_skill.fixture.a' },
    ])
    expect(mixed).not.toHaveProperty('conversionSkillTrace')
    expect(normal.conversionSkillTrace).toEqual({
      operationIndex: 1, operationType: 'convert_normal_to_gogma',
      seriesSkillId: 'series.other.7', groupSkillId: 'group_skill.fixture.a',
    })
    expect(normal.bonusAmendmentTrace.map(({ operationIndex }) => operationIndex)).toEqual([2])
    expect(normal.skillAmendmentTrace).toEqual([
      { operationIndex: 3, operationType: 'reset_skills', seriesSkillId: 'series_skill.fixture.a', groupSkillId: 'group_skill.fixture.a' },
    ])
  })

  it('adds no prediction call: the same calls as driving the seam without building any Candidate', async () => {
    const f = fixture()
    await collect(alternativeInput(f.input), f.engine)

    // The Phase 1-A seam over the same Planner Alternative frontier with a
    // handler that builds no Candidate and no trace at all.
    const bare = fixture()
    const target = bare.input.targetWeapons[0]
    const execution = createSearchExecutionContext()
    const support = createSearchPredictionSupport(bare.engine, target, bare.input.master)
    const context: RouteSearchContext = {
      frontierPolicy: 'planner_alternative',
      target,
      input: { ...originOf(bare.input), maxNormalAdvance: 5 },
      engine: bare.engine, execution, predictionSupport: support,
      normalPredictions: new Map<number, RestorationBonusSet>(),
      skillStream: createTargetSkillStream(target, { rngState: bare.input.rngState, master: bare.input.master, maxSkillAdvance: 5 }, bare.engine, execution, () => support.skill().supported),
      bonusStream: createTargetBonusStream(target, { rngState: bare.input.rngState, master: bare.input.master, maxGogmaAdvance: 5 }, bare.engine, execution, support),
    }
    const scheduler = new TargetSearchScheduler(context, () => undefined)
    for (const search of [searchNormalArtianRoutes, searchOwnedNormalArtianRoutes, searchExistingGogmaRoutes]) {
      await search(context, scheduler)
    }
    while (await scheduler.step()) { /* drain */ }

    expect(f.calls.length).toBeGreaterThan(0)
    expect(f.calls).toEqual(bare.calls)
  })
})

describe('excludedRouteKeys', () => {
  it('skips an excluded canonical Ideal, continues to the next Ideal and counts the exclusion', async () => {
    const canonical = await ordinaryCanonical(fixture())
    const f = fixture()
    const { candidates, execution } = await collect(
      alternativeInput(f.input, { excludedRouteKeys: [candidateStableKey(canonical)] }),
      f.engine,
    )
    expect(candidates.map((candidate) => candidate.route.kind)).toEqual(Array(5).fill('normal_artian_to_gogma'))
    expect(candidates.map(candidateStableKey)).not.toContain(candidateStableKey(canonical))
    expect(execution.summary).toEqual({ deliveredCandidates: 5, excludedCandidates: 1, exhausted: false, stoppedByExtent: true })
  })

  it('treats a key that matches nothing as no exclusion and prunes no search work', async () => {
    const plain = fixture()
    const one = await collect(alternativeInput(plain.input), plain.engine)
    const unmatched = fixture()
    const two = await collect(alternativeInput(unmatched.input, { excludedRouteKeys: ['not-a-route-key'] }), unmatched.engine)
    expect(two.candidates).toEqual(one.candidates)
    expect(two.execution.summary.excludedCandidates).toBe(0)
    expect(unmatched.calls).toEqual(plain.calls)
  })
})

describe('reservation (Phase 1: empty only)', () => {
  const nonEmpty: Array<[string, PlannerAlternativeReservation]> = [
    ['a held Skill position', { ...emptyPlannerAlternativeReservation, skill: { held: [7], blocked: [] } }],
    ['a blocked Gogma position', { ...emptyPlannerAlternativeReservation, gogma: { held: [10], blocked: [10] } }],
    ['a held Normal position', { ...emptyPlannerAlternativeReservation, normal: [{ counterId: 'normal-counter.fixture', held: [4], blocked: [] }] }],
    ['an exclusive OwnedWeapon', { ...emptyPlannerAlternativeReservation, exclusiveOwnedWeaponIds: [ownedWeaponId('owned.fixture.source')] }],
  ]

  it.each(nonEmpty)('refuses %s instead of searching it as empty', async (_, reservation) => {
    const f = fixture()
    const visitor = vi.fn(() => 'continue' as const)
    await expect(visitPlannerAlternativeCandidates(alternativeInput(f.input, { reservation }), f.engine, visitor))
      .rejects.toSatisfy((error) => error instanceof PlannerAlternativeSearchError && error.code === 'unsupported_reservation')
    expect(visitor).not.toHaveBeenCalled()
    expect(f.calls).toEqual([])
  })

  it('treats a Normal Counter entry that reserves no position as empty', async () => {
    const f = fixture()
    const { candidates } = await collect(alternativeInput(f.input, {
      reservation: { ...emptyPlannerAlternativeReservation, normal: [{ counterId: 'normal-counter.fixture', held: [], blocked: [] }] },
    }), f.engine)
    expect(candidates.length).toBeGreaterThan(0)
  })
})

describe('input validation', () => {
  it('refuses a Target outside the origin', async () => {
    const f = fixture()
    await expect(collect(alternativeInput(f.input, { targetWeaponId: f.input.targetWeaponId + '.missing' as typeof f.input.targetWeaponId }), f.engine))
      .rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('refuses an Engine that does not match the origin CalculationContext', async () => {
    const f = fixture()
    const input = alternativeInput(f.input)
    input.origin = { ...input.origin, calculationContext: { ...input.origin.calculationContext, rngEngineVersion: 'another-engine' } }
    await expect(collect(input, f.engine)).rejects.toMatchObject({ code: 'calculation_context_incompatible' })
  })

  it('still builds ordinary BuildCandidates with their own identity (unchanged ordinary factory)', async () => {
    const f = fixture()
    const result = await searchCandidates(f.input, f.engine, {
      ...ordinaryOptions,
      createCandidateId: ({ semanticHash }) => candidateId(semanticHash),
    })
    expect(result.targetResult.candidate).toMatchObject({ searchRunId: f.input.searchRunId, createdAt: SEARCH_FIXTURE_TIME })
  })
})
