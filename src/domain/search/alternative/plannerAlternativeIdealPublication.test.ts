import { afterEach, describe, expect, it, vi } from 'vitest'
import { practicalOnlyBonuses } from '../../../test/fixtures/candidateSearch'
import {
  collect,
  counters,
  frontierFixture,
  IDEAL_SERIES,
  originOf,
  type FrontierFixtureOptions,
} from '../../../test/fixtures/plannerAlternativeFrontier'
import type {
  RestorationBonusSet,
  RouteOperation,
} from '../../models/publicTypes'
import { keepFamilyLayoutKey } from '../../rng/gogmaBonusFamily'
import { evaluateSkillCondition, satisfiesIdealBonuses } from '../../target'
import { createTargetBonusStream } from '../bonusStream'
import { candidateStableKey } from '../candidateProcessing'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { createLazyIdealCross } from '../lazyIdealCross'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import { createSearchPredictionSupport, type RouteSearchContext, type RouteSearchResult } from '../routeSearchShared'
import { createSearchExecutionContext } from '../searchExecution'
import { createTargetSkillStream } from '../skillStream'
import {
  evaluateBonusSolutions,
  evaluateSkillSolutions,
  type EvaluatedBonusSolution,
  type EvaluatedSkillSolution,
  type RouteBonusSolution,
  type RouteSkillSolution,
} from '../streamSolutions'
import { TargetSearchScheduler, type ScheduledComposition } from '../targetSearchScheduler'
import { visitPlannerAlternativeCandidates } from './plannerAlternativeSearch'
import { emptyPlannerAlternativeReservation, type PlannerAlternativeCandidate } from './plannerAlternativeTypes'

/*
 * Global Planner Research Phase 2-C2.5-D1 (Issue #154,
 * `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D1.md`): characterization
 * of the CURRENT Planner Alternative stream publication semantics that an
 * Ideal-only publication (Phase D2) would have to preserve exactly. Nothing
 * here changes Production behavior; every assertion holds on the current code.
 *
 * Fixture Counters: Normal 4, Skill 7, Gogma 10; every advance is +1.
 */

afterEach(() => vi.restoreAllMocks())

interface Recorded {
  events: string[]
  compositions: Array<{ event: number; base: string; composition: ScheduledComposition }>
  results: RouteSearchResult[]
  scheduler: TargetSearchScheduler
}

function baseLabel(operations: readonly RouteOperation[], source: string | null): string {
  const create = operations.find((operation) => operation.type === 'create_normal_artian')
  if (create) return `normal:count${create.count}`
  if (operations.some((operation) => operation.type === 'convert_normal_to_gogma')) return `owned-normal:${source}`
  return `existing:${source}`
}

/**
 * The Planner Alternative frontier of one fixture, driven directly on the real
 * `TargetSearchScheduler` with a recording composition handler: base
 * registrations, held-aware stream depth publications and compositions share one
 * event order, so a late subscriber is observable.
 */
async function recordFrontier(options: FrontierFixtureOptions): Promise<Recorded & ReturnType<typeof frontierFixture>> {
  const fixture = frontierFixture(options)
  const extent = options.extent ?? 5
  const target = fixture.input.targetWeapons[0]
  const events: string[] = []
  const compositions: Recorded['compositions'] = []
  const execution = createSearchExecutionContext()
  const support = createSearchPredictionSupport(fixture.engine, target, fixture.input.master)
  const context: RouteSearchContext = {
    frontierPolicy: 'planner_alternative',
    target,
    input: { ...originOf(fixture.input), maxNormalAdvance: extent },
    engine: fixture.engine,
    execution,
    predictionSupport: support,
    normalPredictions: new Map<number, RestorationBonusSet>(),
    skillStream: createTargetSkillStream(
      target,
      { rngState: fixture.input.rngState, master: fixture.input.master, maxSkillAdvance: extent },
      fixture.engine, execution, () => support.skill().supported,
      (observation) => events.push(`skill-depth:${observation.startSkillCounter}:${observation.depth}`),
    ),
    bonusStream: createTargetBonusStream(
      target,
      { rngState: fixture.input.rngState, master: fixture.input.master, maxGogmaAdvance: extent },
      fixture.engine, execution, support,
      (observation) => events.push(`gogma-depth:${observation.streamIndex}:${observation.depth}`),
    ),
  }
  const labels = new Map<ScheduledComposition['base'], string>()
  const scheduler = new TargetSearchScheduler(context, (composition) => {
    events.push('composition')
    compositions.push({ event: events.length - 1, base: labels.get(composition.base)!, composition })
  })
  const addBase = scheduler.addBase.bind(scheduler)
  scheduler.addBase = (base) => {
    const label = baseLabel(base.baseOperations, base.sourceOwnedWeaponId)
    labels.set(base, label)
    events.push(`base:${label}`)
    addBase(base)
  }
  const results: RouteSearchResult[] = []
  for (const search of [searchNormalArtianRoutes, searchOwnedNormalArtianRoutes, searchExistingGogmaRoutes]) {
    results.push(await search(context, scheduler))
  }
  while (await scheduler.step()) { /* drain the whole extent */ }
  for (const result of results) result.finalize?.()
  return { ...fixture, events, compositions, results, scheduler }
}

function positions(composition: ScheduledComposition): string {
  const bonus = composition.bonus.solution.operations.map((operation) =>
    'gogmaCounterBefore' in operation ? `${operation.type === 'reset_bonuses' ? 'R' : 'K'}${operation.gogmaCounterBefore}` : '?')
  const skill = composition.skill.solution.operations.map((operation) =>
    'skillCounterBefore' in operation ? operation.skillCounterBefore : '?')
  return `B[${bonus.join(',')}]S[${skill.join(',')}]`
}

describe('late subscriber replay under the planner_alternative policy (D1 §6)', () => {
  // Every predicted Normal offset forges the same Practical-only slots, so all
  // five offsets share one Bonus channel (same start and family layout) and,
  // converting at Skill 7, one Skill channel (start 8). Ideal Bonus: Reset at
  // 10 (depth 1) and the Reset chain 10..12 (depth 3); Ideal Skill: 8 (depth 1)
  // and 8..10 (depth 3). Every other stream position is non-Ideal.
  const options: FrontierFixtureOptions = {
    normalCounter: true,
    resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
    skillIdealAt: (skill) => skill === 8 || skill === 10,
  }

  it('registers Route bases after their shared channels already published a depth', async () => {
    const { events } = await recordFrontier(options)
    const bonusDepth1 = events.indexOf('gogma-depth:0:1')
    const skillDepth1 = events.indexOf('skill-depth:8:1')
    expect(bonusDepth1).toBeGreaterThanOrEqual(0)
    expect(skillDepth1).toBeGreaterThanOrEqual(0)
    // The first offset subscribes before any publication; offsets 2..4 are
    // registered inside later queue settles, after depth 1 of both channels.
    expect(events.indexOf('base:normal:count1')).toBeLessThan(Math.min(bonusDepth1, skillDepth1))
    for (const count of [3, 4, 5]) {
      expect(events.indexOf(`base:normal:count${count}`)).toBeGreaterThan(Math.max(bonusDepth1, skillDepth1))
    }
  })

  it('replays every earlier Ideal position to a late base, and no non-Ideal one composes', async () => {
    const { events, compositions } = await recordFrontier(options)
    // Only Ideal x Ideal compositions exist: the non-Ideal zero Bonus
    // (normal_artian scope), the non-Ideal zero Skill (conversion at 7) and every
    // non-Ideal stream position published into the channels compose nothing.
    expect(compositions.every(({ composition }) => composition.bonus.idealMatch && composition.skill.idealMatch)).toBe(true)
    const expectedPairs = [
      'B[R10]S[8]', 'B[R10]S[8,9,10]', 'B[R10,R11,R12]S[8]', 'B[R10,R11,R12]S[8,9,10]',
    ]
    for (const count of [1, 2, 3, 4, 5]) {
      const own = compositions.filter(({ base }) => base === `normal:count${count}`)
      expect(own.map(({ composition }) => positions(composition)).sort()).toEqual([...expectedPairs].sort())
    }
    // The late offset-4 base receives the depth-1 Ideal Bonus that was
    // published before it subscribed, i.e. through `channel.retained` replay.
    const lateBase = events.indexOf('base:normal:count5')
    const bonusDepth1 = events.indexOf('gogma-depth:0:1')
    expect(bonusDepth1).toBeLessThan(lateBase)
    expect(compositions.some(({ base, composition }) =>
      base === 'normal:count5' && composition.bonus.solution.gogmaAdvance === 1)).toBe(true)
  })

  it('makes a non-Ideal publication a no-op: Lazy Ideal Cross opens and wakes the same cells without it', () => {
    type Arrival = ['bonus' | 'skill', string, boolean]
    /**
     * Feeds one arrival sequence, settling one queued item after each arrival
     * like the scheduler's own work items would. `dropNonIdeal` models an
     * Ideal-only publication: the non-Ideal arrival disappears while the
     * scheduler work around it still settles.
     */
    const run = (feed: Arrival[], dropNonIdeal: boolean) => {
      const opened: string[] = []
      const woken: string[] = []
      const pending: Array<() => void> = []
      const cross = createLazyIdealCross({
        open: (bonus, skill, onSettled) => {
          opened.push(`${bonus.retentionKey}x${skill.semanticKey}`)
          pending.push(onSettled)
        },
        wake: (bonus, skill, resume) => {
          woken.push(`${bonus.retentionKey}x${skill.semanticKey}`)
          pending.push(resume)
        },
      })
      for (const [axis, name, idealMatch] of feed) {
        if (idealMatch || !dropNonIdeal) {
          if (axis === 'bonus') cross.addBonus({ idealMatch, retentionKey: name } as unknown as EvaluatedBonusSolution)
          else cross.addSkill({ idealMatch, semanticKey: name } as unknown as EvaluatedSkillSolution)
        }
        pending.shift()?.()
      }
      while (pending.length > 0) pending.shift()!()
      return { opened, woken }
    }
    const feed: Arrival[] = [
      ['bonus', 'n0', false], ['bonus', 'b0', true], ['skill', 'm0', false], ['skill', 'k0', true],
      ['bonus', 'n1', false], ['skill', 'm1', false], ['bonus', 'b1', true], ['bonus', 'b2', true],
      ['skill', 'k1', true], ['bonus', 'n2', false], ['skill', 'm2', false], ['skill', 'k2', true],
    ]
    const current = run(feed, false)
    expect(run(feed, true)).toEqual(current)
    expect([...current.opened].sort()).toEqual([
      'b0xk0', 'b0xk1', 'b0xk2', 'b1xk0', 'b1xk1', 'b1xk2', 'b2xk0', 'b2xk1', 'b2xk2',
    ])
    expect(current.opened.some((cell) => /[nm]/.test(cell))).toBe(false)
  })
})

describe('Ideal predicate inputs (D1 §7)', () => {
  it('decides Bonus Ideal from the raw completed five slots and scope alone', async () => {
    const { compositions, input } = await recordFrontier({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
    })
    const target = input.targetWeapons[0]
    expect(compositions.length).toBeGreaterThan(0)
    for (const { composition } of compositions) {
      const { finalBonuses, restorationBonusScope } = composition.bonus.solution
      expect(satisfiesIdealBonuses(target, finalBonuses, restorationBonusScope, input.master))
        .toBe(composition.bonus.idealMatch)
    }
  })

  it('decides Skill Ideal from the raw Series / Group Skills alone', () => {
    const target = frontierFixture().input.targetWeapons[0]
    const solutions = [IDEAL_SERIES, 'series.other'].map((seriesSkillId, index): RouteSkillSolution => ({
      resetCount: 1, seriesSkillId, groupSkillId: null, estimatedSkillAdvance: 1,
      operations: [{ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 7 + index, skillCounterAfter: 8 + index }],
      amendmentResults: [{ seriesSkillId, groupSkillId: null }],
    }))
    for (const evaluated of evaluateSkillSolutions(target, solutions)) {
      expect(evaluateSkillCondition(target.idealSkillCondition, evaluated.solution.seriesSkillId, evaluated.solution.groupSkillId))
        .toBe(evaluated.idealMatch)
    }
  })
})

describe('ordering parity of filter-then-evaluate (D1 §8)', () => {
  const fixture = () => frontierFixture()

  function bonusSolution(
    gogmaPositions: number[], types: Array<'reset_bonuses' | 'keep_bonuses'>,
    bonuses: RestorationBonusSet, scope: RouteBonusSolution['restorationBonusScope'] = 'gogma_artian',
  ): RouteBonusSolution {
    const operations = gogmaPositions.map((position, index): RouteOperation => ({
      type: types[index], sourceOwnedWeaponId: null, gogmaCounterBefore: position, gogmaCounterAfter: position + 1,
    }))
    const lastReset = types.lastIndexOf('reset_bonuses') + 1
    return {
      gogmaAdvance: operations.length, lastResetDepth: lastReset,
      finalBonuses: bonuses, restorationBonusScope: scope, operations,
      amendmentResults: operations.map(() => ({ restorationBonuses: bonuses, restorationBonusScope: 'gogma_artian' })),
    }
  }

  /** Deterministic permutations: identity, reverse, and a few rotations. */
  function permutations<T>(values: readonly T[]): T[][] {
    const result: T[][] = [[...values], [...values].reverse()]
    for (let shift = 1; shift < values.length; shift += 2) {
      result.push([...values.slice(shift), ...values.slice(0, shift)])
    }
    return result
  }

  it('orders the Ideal Bonus solutions identically whether non-Ideal ones are evaluated or not', () => {
    const { input } = fixture()
    const target = input.targetWeapons[0]
    const ideal = structuredClone(target.idealBonuses)
    // One depth (gogmaAdvance 2) with ties on every comparator key among
    // Ideal solutions (same result, same operation types, other positions), an
    // Ideal with another operation type key, and non-Ideal solutions whose keys
    // interleave with them (a normal-scope copy of the Ideal labels included).
    const raw = [
      bonusSolution([10, 11], ['reset_bonuses', 'reset_bonuses'], ideal),
      bonusSolution([10, 11], ['reset_bonuses', 'keep_bonuses'], practicalOnlyBonuses()),
      bonusSolution([11, 13], ['reset_bonuses', 'reset_bonuses'], ideal),
      bonusSolution([10, 12], ['reset_bonuses', 'keep_bonuses'], ideal),
      bonusSolution([12, 13], ['reset_bonuses', 'reset_bonuses'], practicalOnlyBonuses()),
      bonusSolution([10, 14], ['reset_bonuses', 'reset_bonuses'], ideal),
      bonusSolution([10, 11], ['keep_bonuses', 'keep_bonuses'], ideal, 'normal_artian'),
    ]
    for (const order of permutations(raw)) {
      const all = evaluateBonusSolutions(target, input, order)
      const idealFirst = evaluateBonusSolutions(target, input, order.filter((solution) =>
        satisfiesIdealBonuses(target, solution.finalBonuses, solution.restorationBonusScope, input.master)))
      expect(all.filter((entry) => entry.idealMatch).map((entry) => entry.solution))
        .toEqual(idealFirst.map((entry) => entry.solution))
      // Identity, not only structural equality: the same raw objects in the
      // same order.
      all.filter((entry) => entry.idealMatch).forEach((entry, index) =>
        expect(entry.solution).toBe(idealFirst[index].solution))
      expect(idealFirst.every((entry) => entry.idealMatch)).toBe(true)
    }
  })

  it('orders the Ideal Skill solutions identically whether non-Ideal ones are evaluated or not', () => {
    const { input } = fixture()
    const target = input.targetWeapons[0]
    const skill = (positions: number[], seriesSkillId: string): RouteSkillSolution => ({
      resetCount: positions.length, seriesSkillId, groupSkillId: null, estimatedSkillAdvance: positions.length,
      operations: positions.map((position) => ({ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: position, skillCounterAfter: position + 1 })),
      amendmentResults: positions.map(() => ({ seriesSkillId, groupSkillId: null })),
    })
    const raw = [
      skill([7, 8], IDEAL_SERIES), skill([7, 9], 'series.other.9'), skill([8, 9], IDEAL_SERIES),
      skill([7, 10], IDEAL_SERIES), skill([9, 10], 'series.other.10'), skill([8, 11], IDEAL_SERIES),
    ]
    for (const order of permutations(raw)) {
      const all = evaluateSkillSolutions(target, order)
      const idealFirst = evaluateSkillSolutions(target, order.filter((solution) =>
        evaluateSkillCondition(target.idealSkillCondition, solution.seriesSkillId, solution.groupSkillId)))
      const idealOfAll = all.filter((entry) => entry.idealMatch)
      expect(idealOfAll).toHaveLength(idealFirst.length)
      idealOfAll.forEach((entry, index) => expect(entry.solution).toBe(idealFirst[index].solution))
    }
  })

  it('sorts every Ideal of one held-aware Bonus depth before every non-Ideal of it, so `index` would not even move', () => {
    const { input } = fixture()
    const target = input.targetWeapons[0]
    const ideal = structuredClone(target.idealBonuses)
    // A held-aware depth publishes `gogma_artian` scope only, and a matched
    // Ideal count of 5 is reached only by the exact Ideal multiset, so the
    // second comparator key already puts the Ideal solutions first.
    const raw = [
      bonusSolution([10, 11], ['reset_bonuses', 'keep_bonuses'], practicalOnlyBonuses()),
      bonusSolution([12, 13], ['reset_bonuses', 'reset_bonuses'], ideal),
      bonusSolution([10, 12], ['reset_bonuses', 'reset_bonuses'], practicalOnlyBonuses()),
      bonusSolution([10, 11], ['reset_bonuses', 'keep_bonuses'], ideal),
    ]
    for (const order of permutations(raw)) {
      const all = evaluateBonusSolutions(target, input, order)
      expect(all.map((entry) => entry.idealMatch)).toEqual([true, true, false, false])
      const idealFirst = evaluateBonusSolutions(target, input, order.filter((solution) =>
        satisfiesIdealBonuses(target, solution.finalBonuses, solution.restorationBonusScope, input.master)))
      expect(idealFirst.map((entry) => [entry.index, entry.solution]))
        .toEqual(all.slice(0, 2).map((entry) => [entry.index, entry.solution]))
    }
  })
})

describe('source audit of the Planner Alternative stream consumers (D1 §6 / §8 / §10)', () => {
  const sources = import.meta.glob(
    ['../targetSearchScheduler.ts', '../lazyIdealCross.ts', './*.ts', '!./*.test.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>

  it('covers the scheduler, the Lazy Ideal Cross and every Planner Alternative module', () => {
    expect(Object.keys(sources).sort()).toEqual([
      '../lazyIdealCross.ts',
      '../targetSearchScheduler.ts',
      './index.ts',
      './plannerAlternativeCandidateFactory.ts',
      './plannerAlternativeSearch.ts',
      './plannerAlternativeTypes.ts',
      './plannerAlternativeValidation.ts',
    ])
  })

  it('reads no evaluated-solution `index` on the Planner Alternative path', () => {
    for (const [path, source] of Object.entries(sources)) {
      expect(source.match(/\.index\b/g), path).toBeNull()
    }
  })

  it('subscribes only the Cross axis receivers and the base notice receiver to the channels', () => {
    const scheduler = sources['../targetSearchScheduler.ts']
    const subscriptions = [...scheduler.matchAll(/(\w+)\.push\(([^)]*)\)/g)]
      .filter(([, holder]) => holder === 'subscribers' || holder === 'noticeSubscribers')
      .map(([, holder, value]) => `${holder}:${value}`)
    expect(subscriptions).toEqual([
      'subscribers:cross.addSkill',
      'subscribers:cross.addBonus',
      'noticeSubscribers:base.onBonusNotice',
    ])
    // The Planner Alternative Cross is the Lazy Ideal Cross, whose receivers
    // return at once on a non-Ideal solution.
    const cross = sources['../lazyIdealCross.ts']
    expect(cross).toContain('if (!bonus.idealMatch) return')
    expect(cross).toContain('if (!skill.idealMatch) return')
  })
})

describe('notices from non-Ideal stream positions (D1 §9)', () => {
  it('reports the searched amendment RouteKinds even when no stream position is Ideal', async () => {
    const { compositions, results } = await recordFrontier({
      owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: () => false,
    })
    expect(compositions).toHaveLength(0)
    const existing = results[2]
    expect(existing.searchedRoutes).toEqual(expect.arrayContaining([
      'existing_gogma_reset_bonuses', 'existing_gogma_keep_bonuses', 'existing_gogma_mixed',
    ]))
  })

  it('reports an unsupported Keep input even when no stream position is Ideal', async () => {
    const practical = practicalOnlyBonuses()
    const { compositions, results } = await recordFrontier({
      owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: () => false,
      keepSupportedFor: (current) => JSON.stringify(current) !== JSON.stringify(practical),
    })
    expect(compositions).toHaveLength(0)
    expect(results[2].warnings.map((warning) => warning.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Keep Bonuses branches from OwnedWeapon'),
    ]))
  })
})

describe('extent and prediction over non-Ideal depths (D1 §9)', () => {
  it('reads and predicts every Gogma and Skill position of the extent when none is Ideal', async () => {
    const { input, engine, calls } = frontierFixture({
      owned: [{ bonuses: 'practical', idealSkill: false }],
    })
    const { candidates, execution } = await collect(input, engine)
    expect(candidates).toHaveLength(0)
    expect(execution.summary).toEqual({
      deliveredCandidates: 0, excludedCandidates: 0, exhausted: false, stoppedByExtent: true,
    })
    const resets = calls.filter((call) => call.startsWith('reset:'))
    const skills = calls.filter((call) => call.startsWith('skill:'))
    expect(resets).toEqual(['reset:10', 'reset:11', 'reset:12', 'reset:13', 'reset:14'])
    expect(skills).toEqual(['skill:7', 'skill:8', 'skill:9', 'skill:10', 'skill:11', 'skill:12'])
  })

  it('is exhausted, not stopped by extent, when the non-Ideal Bonus stream ends naturally', async () => {
    const { input, engine } = frontierFixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetSupported: false,
      keepResult: () => 'current',
      keepSupportedFor: () => false,
    })
    const { candidates, execution } = await collect(input, engine)
    expect(candidates).toHaveLength(0)
    expect(execution.summary.exhausted).toBe(true)
    expect(execution.summary.stoppedByExtent).toBe(false)
  })
})

/**
 * The D2 semantic baseline: one complete bounded run mixing predicted Normal
 * offsets, an existing Gogma, same-result later positions, off-axis pairs and
 * non-Ideal positions on both axes. An Ideal-only publication must reproduce
 * the delivered sequence, the summary and the prediction calls exactly.
 */
describe('complete bounded frontier baseline for Phase D2 (D1 §16)', () => {
  const options: FrontierFixtureOptions = {
    normalCounter: true,
    owned: [{ bonuses: 'practical', idealSkill: false }],
    resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
    keepResult: (gogma) => (gogma === 13 ? 'ideal' : 'practical'),
    skillIdealAt: (skill) => skill === 8 || skill === 10,
  }

  function project(candidate: PlannerAlternativeCandidate): string {
    const operations = candidate.route.operations
    const create = counters(operations, 'create_normal_artian')
    const bonus = operations.flatMap((operation) =>
      operation.type === 'reset_bonuses' ? [`R${operation.gogmaCounterBefore}`]
        : operation.type === 'keep_bonuses' ? [`K${operation.gogmaCounterBefore}`] : [])
    const skill = counters(operations, 'reset_skills')
    const convert = counters(operations, 'convert_normal_to_gogma')
    return `${candidate.route.kind}|n${create.join('')}|c${convert.join('')}|B${bonus.join(',')}|S${skill.join(',')}`
  }

  it('delivers the complete Candidate sequence, summary and prediction calls of the current publication', async () => {
    const { input, engine, calls } = frontierFixture(options)
    const { candidates, execution } = await collect(input, engine)
    expect(candidates.map(project)).toEqual(BASELINE_SEQUENCE)
    expect(new Set(candidates.map(candidateStableKey)).size).toBe(candidates.length)
    expect(execution.summary).toEqual({
      deliveredCandidates: BASELINE_SEQUENCE.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: true,
    })
    expect(execution.stoppedByConsumer).toBe(false)
    expect(execution.skippedExcludedRouteKeys).toEqual([])
    expect(calls).toEqual(baselineCalls(input.master, input.targetWeapons[0].idealBonuses))
  })

  it('keeps the same sequence after excluding and skipping the first Candidate', async () => {
    const first = frontierFixture(options)
    const { candidates } = await collect(first.input, first.engine)
    const excludedKey = candidateStableKey(candidates[0])
    const second = frontierFixture(options)
    const { candidates: rest, execution } = await visitExcluding(second, [excludedKey])
    expect(rest.map(project)).toEqual(BASELINE_SEQUENCE.slice(1))
    expect(execution.summary.excludedCandidates).toBe(1)
    expect(execution.skippedExcludedRouteKeys).toEqual([excludedKey])
  })
})

async function visitExcluding(fixture: ReturnType<typeof frontierFixture>, excludedRouteKeys: string[]) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates({
    origin: originOf(fixture.input),
    targetWeaponId: fixture.input.targetWeaponId,
    extent: { ...fixture.input.settings },
    reservation: emptyPlannerAlternativeReservation,
    excludedRouteKeys,
  }, fixture.engine, (candidate) => {
    candidates.push(candidate)
    return 'continue'
  })
  return { candidates, execution }
}

/** Recorded on the current (pre-D2) publication: the delivered six-key order. */
const BASELINE_SEQUENCE: string[] = [
  'existing_gogma_mixed|n|c|BR10|S7,8',
  'normal_artian_to_gogma|n1|c7|BR10|S8',
  'normal_artian_to_gogma|n2|c7|BR10|S8',
  'existing_gogma_mixed|n|c|BR10|S7,8,9,10',
  'existing_gogma_mixed|n|c|BR10,R11,R12|S7,8',
  'normal_artian_to_gogma|n3|c7|BR10|S8',
  'normal_artian_to_gogma|n1|c7|BR10|S8,9,10',
  'normal_artian_to_gogma|n1|c7|BR10,R11,R12|S8',
  'existing_gogma_mixed|n|c|BR10,R11,K12,K13|S7,8',
  'existing_gogma_mixed|n|c|BR10,R11,R12,K13|S7,8',
  'normal_artian_to_gogma|n4|c7|BR10|S8',
  'normal_artian_to_gogma|n2|c7|BR10|S8,9,10',
  'normal_artian_to_gogma|n2|c7|BR10,R11,R12|S8',
  'existing_gogma_mixed|n|c|BR10,R11,R12|S7,8,9,10',
  'normal_artian_to_gogma|n1|c7|BR10,R11,K12,K13|S8',
  'normal_artian_to_gogma|n1|c7|BR10,R11,R12,K13|S8',
  'normal_artian_to_gogma|n5|c7|BR10|S8',
  'normal_artian_to_gogma|n3|c7|BR10|S8,9,10',
  'normal_artian_to_gogma|n3|c7|BR10,R11,R12|S8',
  'normal_artian_to_gogma|n1|c7|BR10,R11,R12|S8,9,10',
  'normal_artian_to_gogma|n2|c7|BR10,R11,K12,K13|S8',
  'normal_artian_to_gogma|n2|c7|BR10,R11,R12,K13|S8',
  'existing_gogma_mixed|n|c|BR10,R11,K12,K13|S7,8,9,10',
  'existing_gogma_mixed|n|c|BR10,R11,R12,K13|S7,8,9,10',
  'normal_artian_to_gogma|n4|c7|BR10|S8,9,10',
  'normal_artian_to_gogma|n4|c7|BR10,R11,R12|S8',
  'normal_artian_to_gogma|n2|c7|BR10,R11,R12|S8,9,10',
  'normal_artian_to_gogma|n3|c7|BR10,R11,K12,K13|S8',
  'normal_artian_to_gogma|n3|c7|BR10,R11,R12,K13|S8',
  'normal_artian_to_gogma|n1|c7|BR10,R11,K12,K13|S8,9,10',
  'normal_artian_to_gogma|n1|c7|BR10,R11,R12,K13|S8,9,10',
  'normal_artian_to_gogma|n5|c7|BR10|S8,9,10',
  'normal_artian_to_gogma|n5|c7|BR10,R11,R12|S8',
  'normal_artian_to_gogma|n3|c7|BR10,R11,R12|S8,9,10',
  'normal_artian_to_gogma|n4|c7|BR10,R11,K12,K13|S8',
  'normal_artian_to_gogma|n4|c7|BR10,R11,R12,K13|S8',
  'normal_artian_to_gogma|n2|c7|BR10,R11,K12,K13|S8,9,10',
  'normal_artian_to_gogma|n2|c7|BR10,R11,R12,K13|S8,9,10',
  'normal_artian_to_gogma|n4|c7|BR10,R11,R12|S8,9,10',
  'normal_artian_to_gogma|n5|c7|BR10,R11,K12,K13|S8',
  'normal_artian_to_gogma|n5|c7|BR10,R11,R12,K13|S8',
  'normal_artian_to_gogma|n3|c7|BR10,R11,K12,K13|S8,9,10',
  'normal_artian_to_gogma|n3|c7|BR10,R11,R12,K13|S8,9,10',
  'normal_artian_to_gogma|n5|c7|BR10,R11,R12|S8,9,10',
  'normal_artian_to_gogma|n4|c7|BR10,R11,K12,K13|S8,9,10',
  'normal_artian_to_gogma|n4|c7|BR10,R11,R12,K13|S8,9,10',
  'normal_artian_to_gogma|n5|c7|BR10,R11,K12,K13|S8,9,10',
  'normal_artian_to_gogma|n5|c7|BR10,R11,R12,K13|S8,9,10',
]
/**
 * Recorded on the current (pre-D2) publication: every prediction, in call
 * order, one line per Skill position. `practical` / `ideal` are the Keep
 * family layouts of the Practical-only and the Ideal five slots.
 */
function baselineCalls(master: Parameters<typeof keepFamilyLayoutKey>[1], ideal: RestorationBonusSet): string[] {
  const practical = keepFamilyLayoutKey(practicalOnlyBonuses(), master)
  const idealLayout = keepFamilyLayoutKey(ideal, master)
  return [
    'skill:7', 'reset:10', `keep:10:${practical}`, 'normal:4',
    'skill:8', 'reset:11', `keep:11:${idealLayout}`, `keep:11:${practical}`, 'normal:5',
    'skill:9', 'reset:12', `keep:12:${practical}`, 'normal:6',
    'skill:10', 'reset:13', `keep:13:${idealLayout}`, `keep:13:${practical}`, 'normal:7',
    'skill:11', 'reset:14', `keep:14:${idealLayout}`, `keep:14:${practical}`, 'normal:8',
    'skill:12',
  ]
}
