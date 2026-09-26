import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../../test/fixtures/candidateSearch'
import { ownedWeaponId } from '../../../test/fixtures/domainData'
import { measureNormalRouteSearch } from '../../../test/fixtures/normalRouteReduction'
import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../../models/publicTypes'
import { stableStringify } from '../../models/publicTypes'
import { keepFamilyLayoutKey } from '../../rng/gogmaBonusFamily'
import type { RngEngine, RngPredictionSupportInput } from '../../rng/rngEngine'
import { createTargetBonusStream } from '../bonusStream'
import { candidateStableKey } from '../candidateProcessing'
import { searchCandidates } from '../candidateSearch'
import { compareConstrainedCandidates } from '../constrained/constrainedCandidateFactory'
import type { ConstrainedSearchOrigin } from '../constrained/constrainedTypes'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import { createSearchPredictionSupport, type RouteSearchContext } from '../routeSearchShared'
import { createSearchExecutionContext } from '../searchExecution'
import { CandidateSearchError, type CandidateSearchInput } from '../searchTypes'
import { SearchWorkQueue } from '../searchWorkQueue'
import { createTargetSkillStream } from '../skillStream'
import { TargetSearchScheduler } from '../targetSearchScheduler'
import {
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchExecutionOptions,
} from './plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchInput,
} from './plannerAlternativeTypes'

/*
 * Phase 1-C of SEARCH_SPEC 5.6.8 / 13.2.6: the empty-reservation Planner
 * Alternative Search is complete over its extent. Fixture Counters: Normal 4,
 * Skill 7, Gogma 10; every advance is +1 (+count for a Normal creation).
 */

const IDEAL_SERIES = 'series_skill.fixture.a'

interface FrontierFixtureOptions {
  extent?: number
  /** Owned Gogma sources (unprotected, `gogma_artian` scope); none when empty. */
  owned?: Array<{ bonuses: 'ideal' | 'practical'; idealSkill: boolean }>
  /** A confirmed Normal Counter (predicted Normal Routes); otherwise the blind variant. */
  normalCounter?: boolean
  /** Reset Bonuses result at a Gogma Counter: the Ideal five slots or Practical-only ones. */
  resetIdealAt?: (gogmaCounter: number) => boolean
  /** Whether Reset Bonuses input is supported at all. */
  resetSupported?: boolean
  /** Keep Bonuses result; the default keeps the current slots Practical-only. */
  keepResult?: (gogmaCounter: number, current: RestorationBonusSet) => 'ideal' | 'practical' | 'current'
  /** Keep support per current five slots; supported everywhere by default. */
  keepSupportedFor?: (current: RestorationBonusSet) => boolean
  skillIdealAt?: (skillCounter: number) => boolean
}

function frontierFixture(options: FrontierFixtureOptions = {}) {
  const extent = options.extent ?? 5
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: extent, maxGogmaAdvance: extent, maxSkillAdvance: extent }
  const ideal = structuredClone(input.targetWeapons[0].idealBonuses)
  const template = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  input.ownedWeapons = (options.owned ?? []).map((owned, index): OwnedGogmaArtianWeapon => ({
    ...structuredClone(template),
    id: ownedWeaponId(`owned.fixture.${index}`),
    restorationBonuses: owned.bonuses === 'ideal' ? structuredClone(ideal) : practicalOnlyBonuses(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: owned.idealSkill ? IDEAL_SERIES : 'series.other',
    groupSkillId: null,
    isProtected: false,
  }))
  if (!options.normalCounter) input.normalCounters = []
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const calls: string[] = []
  const skillIdealAt = options.skillIdealAt ?? (() => false)
  const resetIdealAt = options.resetIdealAt ?? (() => false)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) => {
    calls.push('normal:' + normalCounter)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => {
    calls.push('skill:' + skillCounter)
    return { seriesSkillId: skillIdealAt(skillCounter) ? IDEAL_SERIES : 'series.other.' + skillCounter, groupSkillId: null }
  })
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      calls.push('reset:' + gogmaCounter)
      return resetIdealAt(gogmaCounter) ? structuredClone(ideal) : practicalOnlyBonuses()
    }
    calls.push('keep:' + gogmaCounter + ':' + keepFamilyLayoutKey(operation.currentBonuses, input.master))
    const result = options.keepResult?.(gogmaCounter, operation.currentBonuses) ?? 'practical'
    return result === 'ideal' ? structuredClone(ideal)
      : result === 'current' ? structuredClone(operation.currentBonuses) : practicalOnlyBonuses()
  })
  const support = engine.getPredictionSupport.bind(engine)
  vi.spyOn(engine, 'getPredictionSupport').mockImplementation((request: RngPredictionSupportInput) => {
    if (request.type === 'gogma_reset' && options.resetSupported === false) {
      return { supported: false, reason: 'engine_capability_unavailable' }
    }
    if (request.type === 'gogma_keep' && options.keepSupportedFor && !options.keepSupportedFor(request.currentBonuses)) {
      return { supported: false, reason: 'engine_capability_unavailable' }
    }
    return support(request)
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine, calls, ideal }
}

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

function alternativeInput(input: CandidateSearchInput): PlannerAlternativeSearchInput {
  return {
    origin: originOf(input),
    targetWeaponId: input.targetWeaponId,
    extent: { ...input.settings },
    reservation: emptyPlannerAlternativeReservation,
    excludedRouteKeys: [],
  }
}

async function collect(
  input: CandidateSearchInput,
  engine: RngEngine,
  limit = Infinity,
  options: PlannerAlternativeSearchExecutionOptions = {},
) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates(alternativeInput(input), engine, (candidate) => {
    candidates.push(candidate)
    return candidates.length >= limit ? 'stop' : 'continue'
  }, options)
  return { candidates, execution }
}

async function ordinaryCanonical(input: CandidateSearchInput, engine: RngEngine): Promise<BuildCandidate | null> {
  const result = await searchCandidates(input, engine, { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 0 })
  return result.targetResult.candidate
}

function operationTypes(candidate: PlannerAlternativeCandidate): string[] {
  return candidate.route.operations.map((operation) => operation.type)
}

function counters(operations: readonly RouteOperation[], type: RouteOperation['type']): Array<number | null> {
  return operations.filter((operation) => operation.type === type).map((operation) =>
    'gogmaCounterBefore' in operation ? operation.gogmaCounterBefore
      : 'skillCounterBefore' in operation ? operation.skillCounterBefore
        : operation.type === 'create_normal_artian' ? operation.count : null)
}

afterEach(() => vi.restoreAllMocks())

describe('same-result later Counter positions (SEARCH_SPEC 5.6.4 / 5.6.8)', () => {
  it('returns a later Skill position reaching the same Skills, which the initial Search retains away', async () => {
    const options: FrontierFixtureOptions = {
      owned: [{ bonuses: 'ideal', idealSkill: false }],
      skillIdealAt: (skill) => skill === 8 || skill === 10,
    }
    const { input, engine } = frontierFixture(options)
    const { candidates } = await collect(input, engine)
    expect(candidates.map((candidate) => candidate.route.kind))
      .toEqual(['existing_gogma_reset_skills', 'existing_gogma_reset_skills'])
    expect(candidates.map((candidate) => counters(candidate.route.operations, 'reset_skills')))
      .toEqual([[7, 8], [7, 8, 9, 10]])
    expect(candidates.map((candidate) => candidate.seriesSkillId)).toEqual([IDEAL_SERIES, IDEAL_SERIES])
    expect(new Set(candidates.map(candidateStableKey)).size).toBe(2)

    const ordinary = frontierFixture(options)
    const canonical = await ordinaryCanonical(ordinary.input, ordinary.engine)
    expect(candidateStableKey(canonical!)).toBe(candidateStableKey(candidates[0]))
  })

  it('returns a later Gogma position reaching the same Bonus result, keeping the B2 family-layout frontier', async () => {
    const { input, engine } = frontierFixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
    })
    const { candidates } = await collect(input, engine)
    const existing = candidates.filter((candidate) => candidate.route.sourceOwnedWeaponId !== null)
    expect(existing.map(operationTypes)).toEqual([
      ['reset_bonuses'],
      ['reset_bonuses', 'reset_bonuses', 'reset_bonuses'],
    ])
    expect(existing.map((candidate) => counters(candidate.route.operations, 'reset_bonuses')))
      .toEqual([[10], [10, 11, 12]])
    expect(existing[0].finalBonuses).toEqual(existing[1].finalBonuses)
    expect(candidateStableKey(existing[0])).not.toBe(candidateStableKey(existing[1]))
  })
})

describe('lazy off-axis Cross pairs (SEARCH_SPEC 5.6.8)', () => {
  const offAxis: FrontierFixtureOptions = {
    owned: [{ bonuses: 'practical', idealSkill: false }],
    resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
    skillIdealAt: (skill) => skill === 7 || skill === 9,
  }

  it('returns every Ideal Bonus x Ideal Skill pair, the off-axis B1 x K1 included', async () => {
    const { input, engine } = frontierFixture(offAxis)
    const { candidates } = await collect(input, engine)
    const mixed = candidates.filter((candidate) => candidate.route.kind === 'existing_gogma_mixed')
    expect(mixed.map((candidate) => [
      counters(candidate.route.operations, 'reset_bonuses'),
      counters(candidate.route.operations, 'reset_skills'),
    ])).toEqual([
      [[10], [7]],
      // Gogma advance is the second ordering key, so B0 x K1 precedes B1 x K0.
      [[10], [7, 8, 9]],
      [[10, 11, 12], [7]],
      [[10, 11, 12], [7, 8, 9]],
    ])
    expect(mixed.map((candidate) => candidate.estimatedOperationCount)).toEqual([2, 4, 4, 6])
  })

  it('keeps the initial Search Cross-only and returns its canonical Ideal first', async () => {
    const alternative = frontierFixture(offAxis)
    const { candidates } = await collect(alternative.input, alternative.engine, 1)
    const ordinary = frontierFixture(offAxis)
    const canonical = await ordinaryCanonical(ordinary.input, ordinary.engine)
    expect(candidateStableKey(candidates[0])).toBe(candidateStableKey(canonical!))
  })

  it('opens the grid lazily: an early consumer stop never generates the Cartesian product', async () => {
    const grid: FrontierFixtureOptions = {
      extent: 12,
      owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: () => true,
      skillIdealAt: () => true,
    }
    const complete = frontierFixture(grid)
    const all = await collect(complete.input, complete.engine)
    // The existing Gogma's whole 12 x 12 Ideal grid is reachable ...
    expect(all.candidates.filter((candidate) => candidate.route.kind === 'existing_gogma_mixed')).toHaveLength(144)

    const enqueue = vi.spyOn(SearchWorkQueue.prototype, 'enqueue')
    const early = frontierFixture(grid)
    const { candidates, execution } = await collect(early.input, early.engine, 3)
    expect(candidates).toHaveLength(3)
    expect(execution.stoppedByConsumer).toBe(true)
    // ... but three Candidates open a handful of cells, never the 144.
    expect(enqueue.mock.calls.length).toBeLessThan(30)
  })
})

describe('#104 Normal Route base reduction is not applied (SEARCH_SPEC 6.1.2 / 5.6.8)', () => {
  const normalOptions: FrontierFixtureOptions = {
    normalCounter: true,
    resetIdealAt: (gogma) => gogma === 10,
    skillIdealAt: (skill) => skill === 8,
  }

  it('returns a Route for every predicted Normal offset of the extent', async () => {
    const { input, engine, calls } = frontierFixture(normalOptions)
    const { candidates } = await collect(input, engine)
    const normal = candidates.filter((candidate) => candidate.route.kind === 'normal_artian_to_gogma')
    // Offsets 1 ... 4 forge Practical-only slots whose families differ from
    // the Ideal, so #104 would never register them; here each is a Route.
    expect(normal.map((candidate) => counters(candidate.route.operations, 'create_normal_artian')))
      .toEqual([[1], [2], [3], [4], [5]])
    expect(normal.map((candidate) => candidate.estimatedNormalAdvance)).toEqual([1, 2, 3, 4, 5])
    // One lazy Normal prediction per offset, never more.
    expect(calls.filter((call) => call.startsWith('normal:'))).toEqual(['normal:4', 'normal:5', 'normal:6', 'normal:7', 'normal:8'])
  })

  it('leaves the initial Search reduction in place for the same input', async () => {
    const { input, engine } = frontierFixture(normalOptions)
    const reduced = await measureNormalRouteSearch(input, engine, true, true)
    expect(reduced.metrics.normalBases).toBe(1)
    const first = frontierFixture(normalOptions)
    const { candidates } = await collect(first.input, first.engine, 1)
    expect(candidateStableKey(candidates[0])).toBe(candidateStableKey(reduced.candidate!))
  })

  it('does not replicate the blind variant or give it a Normal Counter position', async () => {
    const { input, engine, calls } = frontierFixture({ resetIdealAt: (gogma) => gogma === 10, skillIdealAt: (skill) => skill === 7 })
    const { candidates } = await collect(input, engine)
    const creations = candidates.flatMap((candidate) => candidate.route.operations)
      .filter((operation) => operation.type === 'create_normal_artian')
    expect(creations.length).toBeGreaterThan(0)
    for (const creation of creations) {
      expect(creation).toMatchObject({ count: 1, normalCounterBefore: null, normalCounterAfter: null })
    }
    expect(calls.filter((call) => call.startsWith('normal:'))).toEqual([])
  })
})

describe('six-key ordering over the whole frontier (SEARCH_SPEC 5.6.3 / 5.6.8)', () => {
  const mixedFrontier = (reverseSources: boolean) => {
    const f = frontierFixture({
      normalCounter: true,
      owned: [
        { bonuses: 'practical', idealSkill: false },
        { bonuses: 'practical', idealSkill: false },
      ],
      resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
      skillIdealAt: (skill) => skill === 8 || skill === 10,
    })
    f.input.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.1')
    if (reverseSources) f.input.ownedWeapons.reverse()
    return f
  }

  it('delivers same-result, off-axis and later-offset Candidates in the six-key order', async () => {
    const f = mixedFrontier(false)
    const { candidates } = await collect(f.input, f.engine)
    const keys = candidates.map(candidateStableKey)
    expect(new Set(keys).size).toBe(keys.length)
    const sorted = [...candidates].sort((left, right) =>
      compareConstrainedCandidates(left, right, f.input.targetWeapons[0].preferredOwnedWeaponId))
    expect(keys).toEqual(sorted.map(candidateStableKey))
    // The mix really is present.
    expect(candidates.some((candidate) => counters(candidate.route.operations, 'reset_bonuses').length === 3)).toBe(true)
    expect(candidates.some((candidate) =>
      counters(candidate.route.operations, 'reset_bonuses').length === 3 &&
      counters(candidate.route.operations, 'reset_skills').length === 4)).toBe(true)
    expect(candidates.some((candidate) => (counters(candidate.route.operations, 'create_normal_artian')[0] ?? 0) > 1)).toBe(true)
    // Equally rated sources: the preferred one first.
    const cheapest = candidates.filter((candidate) => candidate.estimatedOperationCount === candidates[0].estimatedOperationCount)
    expect(cheapest.map((candidate) => candidate.route.sourceOwnedWeaponId))
      .toEqual(['owned.fixture.1', 'owned.fixture.0'])
  })

  it('does not depend on the source registration order', async () => {
    const forward = mixedFrontier(false)
    const reversed = mixedFrontier(true)
    const one = await collect(forward.input, forward.engine)
    const two = await collect(reversed.input, reversed.engine)
    expect(two.candidates.map(candidateStableKey)).toEqual(one.candidates.map(candidateStableKey))
  })

  it('keeps first-result parity with the ordinary canonical Ideal', async () => {
    const alternative = mixedFrontier(false)
    const { candidates } = await collect(alternative.input, alternative.engine, 1)
    const ordinary = mixedFrontier(false)
    const canonical = await ordinaryCanonical(ordinary.input, ordinary.engine)
    expect(candidateStableKey(candidates[0])).toBe(candidateStableKey(canonical!))
  })
})

describe('exhausted versus stopped by extent (SEARCH_SPEC 5.6.8)', () => {
  const practicalKey = stableStringify(practicalOnlyBonuses())

  it('is exhausted when the Bonus stream runs out naturally inside the extent', async () => {
    // Reset is unsupported and Keep is supported only from the Practical-only
    // slots, whose Keep yields the Ideal: after one Keep nothing is generable.
    const options: FrontierFixtureOptions = {
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetSupported: false,
      keepResult: () => 'ideal',
      keepSupportedFor: (current) => stableStringify(current) === practicalKey,
    }
    for (const extent of [5, 1]) {
      const { input, engine } = frontierFixture({ ...options, extent })
      const { candidates, execution } = await collect(input, engine)
      expect(candidates.map((candidate) => candidate.route.kind)).toEqual(['existing_gogma_keep_bonuses'])
      // At extent 1 the stream reads its last depth exactly at the extent, but
      // one more depth would generate nothing: that is not stopped by extent.
      expect(execution).toMatchObject({
        stoppedByConsumer: false,
        skippedExcludedRouteKeys: [],
        summary: { exhausted: true, stoppedByExtent: false },
      })
    }
  })

  it('is stopped by extent when a Gogma position beyond the extent is still reachable', async () => {
    const { input, engine } = frontierFixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      keepResult: () => 'ideal',
    })
    const { execution } = await collect(input, engine)
    expect(execution.summary).toMatchObject({ exhausted: false, stoppedByExtent: true })
  })

  it('is stopped by extent when only the Reset Skills count cuts reachable work', async () => {
    const { input, engine } = frontierFixture({
      owned: [{ bonuses: 'ideal', idealSkill: false }],
      resetSupported: false,
      skillIdealAt: (skill) => skill === 8,
    })
    const { candidates, execution } = await collect(input, engine)
    expect(candidates.map((candidate) => candidate.route.kind)).toEqual(['existing_gogma_reset_skills'])
    expect(execution.summary).toMatchObject({ exhausted: false, stoppedByExtent: true })
  })

  it('is stopped by extent when only the Normal forge count cuts reachable work', async () => {
    // The conversion Skill is Ideal (no Skill stream) and no amendment can be
    // predicted from a forged Normal (Reset unsupported), so the only unread
    // work is the next Normal offset.
    const options: FrontierFixtureOptions = {
      normalCounter: true,
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetSupported: false,
      keepResult: () => 'ideal',
      keepSupportedFor: (current) => stableStringify(current) === practicalKey,
      skillIdealAt: (skill) => skill === 7,
    }
    const { input, engine } = frontierFixture(options)
    const { execution } = await collect(input, engine)
    expect(execution.summary).toMatchObject({ exhausted: false, stoppedByExtent: true })

    const without = frontierFixture({ ...options, normalCounter: false })
    expect((await collect(without.input, without.engine)).execution.summary)
      .toMatchObject({ exhausted: true, stoppedByExtent: false })
  })

  it('reports neither when the consumer stops', async () => {
    const { input, engine } = frontierFixture({
      owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: () => true,
      skillIdealAt: () => true,
    })
    const { execution } = await collect(input, engine, 2)
    expect(execution).toEqual({
      targetWeaponId: input.targetWeaponId,
      summary: { deliveredCandidates: 2, excludedCandidates: 0, exhausted: false, stoppedByExtent: false },
      stoppedByConsumer: true,
      skippedExcludedRouteKeys: [],
    })
  })
})

describe('cancellation and Worker yield inside long stream and pair work', () => {
  it('cancels inside a long Skill stream solve, predicting nothing after the request', async () => {
    const { input, engine, calls } = frontierFixture({ extent: 200, owned: [{ bonuses: 'ideal', idealSkill: false }] })
    const skillCalls = () => calls.filter((call) => call.startsWith('skill:')).length
    await expect(collect(input, engine, Infinity, { shouldCancel: () => skillCalls() >= 20 }))
      .rejects.toSatisfy((error) => error instanceof CandidateSearchError && error.code === 'cancelled')
    expect(skillCalls()).toBe(20)
  })

  it('yields to the Worker while it searches a long frontier', async () => {
    const { input, engine } = frontierFixture({ extent: 200, owned: [{ bonuses: 'ideal', idealSkill: false }] })
    const yieldControl = vi.fn(() => Promise.resolve())
    await collect(input, engine, Infinity, { yieldControl })
    expect(yieldControl.mock.calls.length).toBeGreaterThan(3)
  })

  it('cancels while composing and delivering a large pair grid', async () => {
    const { input, engine } = frontierFixture({
      extent: 12,
      owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: () => true,
      skillIdealAt: () => true,
    })
    const delivered: PlannerAlternativeCandidate[] = []
    await expect(visitPlannerAlternativeCandidates(alternativeInput(input), engine, (candidate) => {
      delivered.push(candidate)
      return 'continue'
    }, { shouldCancel: () => delivered.length >= 5 }))
      .rejects.toSatisfy((error) => error instanceof CandidateSearchError && error.code === 'cancelled')
    expect(delivered).toHaveLength(5)
  })
})

describe('waiting row wake-up stays cancellable and yields (SEARCH_SPEC 5.6.8)', () => {
  // Every Reset is an Ideal Bonus row, but the only Ideal Skill is the last
  // Reset Skills position (Skill 406 = the existing Gogma's depth 400). Its
  // lower bound is 400, so about 400 rows per Route base wait for that one
  // column when it arrives.
  const ARRIVAL = 'skill:406'
  const waitingRows = () => frontierFixture({
    extent: 400,
    owned: [{ bonuses: 'practical', idealSkill: false }],
    resetIdealAt: () => true,
    skillIdealAt: (skill) => skill === 406,
  })

  /**
   * Logs every queued work item, scheduler checkpoint and Worker yield, marking
   * the work queued once the Skill column arrived: that is the waiting row
   * wake-up (and the cells it opens).
   */
  function instrument(calls: string[]) {
    const events: string[] = []
    let arrived = false
    const note = () => { arrived ||= calls.includes(ARRIVAL) }
    const enqueue = SearchWorkQueue.prototype.enqueue
    vi.spyOn(SearchWorkQueue.prototype, 'enqueue').mockImplementation(function (this: SearchWorkQueue, work) {
      note()
      events.push(arrived ? 'expand' : 'enqueue')
      return enqueue.call(this, work)
    })
    const longestRun = (breaker: string) => {
      let longest = 0
      let run = 0
      for (const event of events) {
        if (event === 'expand') longest = Math.max(longest, ++run)
        else if (event === breaker) run = 0
      }
      return longest
    }
    return { events, arrived: () => arrived, longestRun }
  }

  it('observes cancellation before every waiting row was resumed', async () => {
    const { input, engine, calls } = waitingRows()
    const log = instrument(calls)
    let checksAfterArrival = 0
    await expect(collect(input, engine, Infinity, {
      shouldCancel: () => {
        log.events.push('check')
        if (log.arrived()) checksAfterArrival += 1
        return checksAfterArrival > 3
      },
    })).rejects.toSatisfy((error) => error instanceof CandidateSearchError && error.code === 'cancelled')

    // Hundreds of rows were waiting for the column ...
    const resetsBeforeArrival = calls.slice(0, calls.indexOf(ARRIVAL)).filter((call) => call.startsWith('reset:'))
    expect(resetsBeforeArrival.length).toBeGreaterThanOrEqual(399)
    // ... yet the cancel was observed after a handful of wake-up steps, not
    // after a synchronous pass over all of them.
    const expanded = log.events.filter((event) => event === 'expand').length
    expect(expanded).toBeGreaterThan(0)
    expect(expanded).toBeLessThan(20)
  })

  it('passes a checkpoint and yields to the Worker while resuming the waiting rows', async () => {
    const { input, engine, calls } = waitingRows()
    const log = instrument(calls)
    const { candidates } = await collect(input, engine, 120, {
      shouldCancel: () => { log.events.push('check'); return false },
      yieldControl: async () => { log.events.push('yield') },
    })
    expect(candidates).toHaveLength(120)
    const afterArrival = log.events.slice(log.events.indexOf('expand'))
    expect(afterArrival.filter((event) => event === 'expand').length).toBeGreaterThanOrEqual(120)
    // Never more than a few wake-up / cell items between two checkpoints, and
    // the Worker is yielded to inside the wake-up, well before a whole batch
    // of roughly 400 rows could be expanded without one.
    expect(log.longestRun('check')).toBeLessThanOrEqual(4)
    expect(afterArrival).toContain('yield')
    expect(log.longestRun('yield')).toBeLessThan(200)
  })
})

describe('prediction independence (SEARCH_SPEC 3.1 / 5.6.8)', () => {
  const base: FrontierFixtureOptions = {
    normalCounter: true,
    owned: [{ bonuses: 'practical', idealSkill: false }],
  }
  const run = async (options: FrontierFixtureOptions) => {
    const f = frontierFixture(options)
    const { candidates } = await collect(f.input, f.engine)
    return { calls: f.calls, candidates }
  }

  it('does not predict more Skills when there are more Ideal Bonus solutions', async () => {
    const few = await run({ ...base, resetIdealAt: (gogma) => gogma === 10, skillIdealAt: (skill) => skill === 8 || skill === 9 })
    const many = await run({ ...base, resetIdealAt: () => true, skillIdealAt: (skill) => skill === 8 || skill === 9 })
    expect(many.candidates.length).toBeGreaterThan(few.candidates.length)
    const skills = (calls: string[]) => calls.filter((call) => call.startsWith('skill:'))
    expect(skills(many.calls)).toEqual(skills(few.calls))
  })

  it('does not predict more Gogma Bonuses when there are more Ideal Skill solutions', async () => {
    const few = await run({ ...base, resetIdealAt: (gogma) => gogma === 10 || gogma === 12, skillIdealAt: (skill) => skill === 8 })
    const many = await run({ ...base, resetIdealAt: (gogma) => gogma === 10 || gogma === 12, skillIdealAt: () => true })
    expect(many.candidates.length).toBeGreaterThan(few.candidates.length)
    const gogma = (calls: string[]) => calls.filter((call) => call.startsWith('reset:') || call.startsWith('keep:'))
    expect(gogma(many.calls)).toEqual(gogma(few.calls))
  })

  it('adds no prediction for off-axis materialization: the same calls as the bare Alternative frontier', async () => {
    const options: FrontierFixtureOptions = { ...base, resetIdealAt: () => true, skillIdealAt: () => true }
    const full = await run(options)
    expect(full.candidates.length).toBeGreaterThan(0)

    const bare = frontierFixture(options)
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
    expect(full.calls).toEqual(bare.calls)
  })

  it('predicts each Skill position and each Reset position at most once', async () => {
    const { calls } = await run({ ...base, resetIdealAt: () => true, skillIdealAt: () => true })
    const repeated = (prefix: string) => {
      const list = calls.filter((call) => call.startsWith(prefix))
      return list.length - new Set(list).size
    }
    expect(repeated('skill:')).toBe(0)
    expect(repeated('reset:')).toBe(0)
    expect(repeated('keep:')).toBe(0)
    expect(repeated('normal:')).toBe(0)
  })
})

describe('the ordinary Candidate Search is unchanged', () => {
  it('keeps the canonical Ideal and prediction call sequence of an off-axis fixture', async () => {
    const f = frontierFixture({
      normalCounter: true,
      owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
      skillIdealAt: (skill) => skill === 8 || skill === 10,
    })
    const canonical = await ordinaryCanonical(f.input, f.engine)
    // Recorded against the pre-Phase-1-C implementation.
    expect(canonical!.route.operations.map((operation) => operation.type))
      .toEqual(['reset_bonuses', 'reset_skills', 'reset_skills'])
    expect(f.calls).toEqual(ordinaryOffAxisCalls(f.input))
  })
})

/**
 * The ordinary Search prediction sequence of the off-axis fixture, recorded
 * against the pre-Phase-1-C implementation: canonical-Ideal stop, retention
 * and the #104 reduction (Normal 5 predicted, never registered) all intact.
 */
function ordinaryOffAxisCalls(input: CandidateSearchInput): string[] {
  const practical = keepFamilyLayoutKey(practicalOnlyBonuses(), input.master)
  const ideal = keepFamilyLayoutKey(input.targetWeapons[0].idealBonuses, input.master)
  return [
    'skill:7', 'reset:10', `keep:10:${practical}`, 'normal:4',
    'skill:8', 'reset:11', `keep:11:${ideal}`, `keep:11:${practical}`, 'normal:5',
    'skill:9', 'reset:12', `keep:12:${practical}`,
  ]
}
