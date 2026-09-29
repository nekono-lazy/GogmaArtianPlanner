import { afterEach, describe, expect, it, vi } from 'vitest'
import { practicalOnlyBonuses } from '../../../test/fixtures/candidateSearch'
import {
  frontierFixture,
  IDEAL_SERIES,
  originOf,
  type FrontierFixtureOptions,
} from '../../../test/fixtures/plannerAlternativeFrontier'
import {
  parityPatterns,
  recordParityPattern,
  type ParityPatternRecord,
} from '../../../test/fixtures/plannerAlternativeIdealPublicationParity'
import preD2 from '../../../test/fixtures/plannerAlternativeIdealPublicationPreD2.json'
import type {
  OwnedWeaponId,
  RestorationBonusSet,
  RouteOperation,
} from '../../models/publicTypes'
import { evaluateSkillCondition, satisfiesIdealBonuses } from '../../target'
import {
  bonusStreamBaseKey,
  createTargetBonusStream,
  type BonusAmendmentResultNode,
  type BonusStreamBase,
  type BonusStreamStep,
  type ReservedBonusStreamSolution,
  type TargetBonusStream,
  type UnsupportedAmendmentPrediction,
} from '../bonusStream'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import { createSearchPredictionSupport, type RouteSearchContext, type SearchPredictionSupport } from '../routeSearchShared'
import { createSearchExecutionContext } from '../searchExecution'
import {
  createTargetSkillStream,
  type ReservedSkillStreamSolution,
  type SkillStreamStep,
  type TargetSkillStream,
} from '../skillStream'
import type { EvaluatedBonusSolution, EvaluatedSkillSolution } from '../streamSolutions'
import {
  TargetSearchScheduler,
  type BonusStreamNotice,
  type ScheduledComposition,
  type ScheduledRouteBase,
} from '../targetSearchScheduler'

/*
 * Global Planner Research Phase 2-C2.5-D2-a (Issue #154,
 * `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2A.md`): the Ideal-only
 * publication of the Planner Alternative held-aware Skill / Bonus streams.
 *
 * Every absolute stream position is still read, predicted and judged with the
 * Ideal authority; only an Ideal one is materialized, ordered, retained and
 * published. The characterization of the pre-D2 semantics
 * (`plannerAlternativeIdealPublication.test.ts`, PR #173) stays unchanged and
 * must keep passing with its recorded expectations.
 */

afterEach(() => vi.restoreAllMocks())

/** The private channel maps, read white-box by these tests only. */
interface ChannelView {
  skills: Map<number, { retained: EvaluatedSkillSolution[]; subscribers: unknown[] }>
  bonuses: Map<string, { retained: EvaluatedBonusSolution[]; subscribers: unknown[] }>
}
const channelsOf = (scheduler: TargetSearchScheduler) => scheduler as unknown as ChannelView

function positions(composition: ScheduledComposition): string {
  const bonus = composition.bonus.solution.operations.map((operation) =>
    'gogmaCounterBefore' in operation ? `${operation.type === 'reset_bonuses' ? 'R' : 'K'}${operation.gogmaCounterBefore}` : '?')
  const skill = composition.skill.solution.operations.map((operation) =>
    'skillCounterBefore' in operation ? operation.skillCounterBefore : '?')
  return `B[${bonus.join(',')}]S[${skill.join(',')}]`
}

describe('exhaustive synthetic parity with the pre-D2 publication', () => {
  const records = (preD2 as { records: ParityPatternRecord[] }).records

  it('covers every grid pattern exactly once, in grid order', () => {
    expect(records.map((record) => record.name)).toEqual(parityPatterns.map((pattern) => pattern.name))
    // The grid is not vacuous: it delivers Candidates, drops non-Ideal
    // positions on both axes, stops by extent and exhausts naturally.
    expect(records.filter((record) => record.full.candidateCount > 0).length).toBeGreaterThan(20)
    expect(records.some((record) => record.full.summary.exhausted)).toBe(true)
    expect(records.some((record) => record.full.summary.stoppedByExtent)).toBe(true)
  })

  it.each(parityPatterns.map((pattern, index) => [pattern.name, index] as const))(
    '%s: same Candidates, stable keys, summary, exclusions and prediction calls',
    async (_, index) => {
      expect(await recordParityPattern(parityPatterns[index])).toEqual(records[index])
    },
  )
})

describe('Ideal-only channel retention on the real streams', () => {
  /**
   * The raw held-aware depths the scheduler itself read, recorded by a test-only
   * decorator around the real streams. The decorator passes every read and every
   * result through unchanged; it never reads a stream on its own, because the
   * held-aware streams are single-pass (SEARCH_SPEC 5.6.8) and a re-read after
   * the scheduler would be a consumer contract violation, not an observation.
   */
  interface RecordedReads {
    bonus: Map<string, { depths: number[]; solutions: ReservedBonusStreamSolution[]; exhausted: boolean }>
    skill: Map<number, { depths: number[]; solutions: ReservedSkillStreamSolution[]; exhausted: boolean }>
  }

  function recordingStreams(bonusStream: TargetBonusStream, skillStream: TargetSkillStream, master: Parameters<typeof bonusStreamBaseKey>[1]) {
    const reads: RecordedReads = { bonus: new Map(), skill: new Map() }
    const bonus: TargetBonusStream = {
      ...bonusStream,
      readReservedDepth: async (base, depth) => {
        const result = await bonusStream.readReservedDepth(base, depth)
        const key = bonusStreamBaseKey(base, master)
        const record = reads.bonus.get(key) ?? { depths: [], solutions: [], exhausted: false }
        record.depths.push(depth)
        record.solutions.push(...result.solutions)
        record.exhausted = result.exhausted
        reads.bonus.set(key, record)
        return result
      },
    }
    const skill: TargetSkillStream = {
      ...skillStream,
      readReservedDepth: async (start, depth) => {
        const result = await skillStream.readReservedDepth(start, depth)
        const record = reads.skill.get(start) ?? { depths: [], solutions: [], exhausted: false }
        record.depths.push(depth)
        record.solutions.push(...result.solutions)
        record.exhausted = result.exhausted
        reads.skill.set(start, record)
        return result
      },
    }
    return { reads, bonus, skill }
  }

  /** The real held-aware frontier of one fixture, keeping the scheduler, the stream bases it registered and the reads it made. */
  async function drain(options: FrontierFixtureOptions) {
    const fixture = frontierFixture(options)
    const extent = options.extent ?? 5
    const target = fixture.input.targetWeapons[0]
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
      ),
      bonusStream: createTargetBonusStream(
        target,
        { rngState: fixture.input.rngState, master: fixture.input.master, maxGogmaAdvance: extent },
        fixture.engine, execution, support,
      ),
    }
    const recording = recordingStreams(context.bonusStream, context.skillStream, fixture.input.master)
    context.bonusStream = recording.bonus
    context.skillStream = recording.skill
    const compositions: ScheduledComposition[] = []
    const scheduler = new TargetSearchScheduler(context, (composition) => compositions.push(composition))
    const bonusBases = new Map<string, BonusStreamBase>()
    const skillStarts = new Set<number>()
    const addBase = scheduler.addBase.bind(scheduler)
    scheduler.addBase = (base) => {
      if (base.bonusBase) bonusBases.set(bonusStreamBaseKey(base.bonusBase, fixture.input.master), base.bonusBase)
      if (base.startSkillCounter !== null) skillStarts.add(base.startSkillCounter)
      addBase(base)
    }
    for (const search of [searchNormalArtianRoutes, searchOwnedNormalArtianRoutes, searchExistingGogmaRoutes]) {
      await search(context, scheduler)
    }
    while (await scheduler.step()) { /* drain the whole extent */ }
    return { fixture, context, target, scheduler, compositions, bonusBases, skillStarts, reads: recording.reads }
  }

  const options: FrontierFixtureOptions = {
    extent: 4,
    normalCounter: true,
    owned: [{ bonuses: 'practical', idealSkill: false }],
    resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
    keepResult: (gogma, current) =>
      gogma === 13 && JSON.stringify(current) === JSON.stringify(practicalOnlyBonuses()) ? 'ideal' : 'practical',
    skillIdealAt: (skill) => skill === 8 || skill === 10,
  }

  it('retains and publishes exactly the Ideal absolute positions of every channel, and nothing else', async () => {
    const { fixture, target, scheduler, bonusBases, skillStarts, reads } = await drain(options)
    const { skills, bonuses } = channelsOf(scheduler)
    expect(bonuses.size).toBeGreaterThan(0)
    expect(skills.size).toBeGreaterThan(0)
    // One channel per stream key, and every channel stream was read exactly
    // once per depth, 1, 2, 3, ..., up to its terminal read.
    expect([...reads.bonus.keys()].sort()).toEqual([...bonuses.keys()].sort())
    expect([...reads.skill.keys()].sort()).toEqual([...skills.keys()].sort())
    for (const record of [...reads.bonus.values(), ...reads.skill.values()]) {
      expect(record.depths).toEqual(record.depths.map((_, index) => index + 1))
      expect(record.exhausted).toBe(true)
    }
    let rawBonus = 0
    let idealBonus = 0
    for (const key of bonusBases.keys()) {
      const channel = bonuses.get(key)
      if (!channel) continue
      // The raw depths the scheduler's own single-pass reads returned.
      const read = reads.bonus.get(key)!
      rawBonus += read.solutions.length
      const ideal = read.solutions.filter((solution) =>
        satisfiesIdealBonuses(target, solution.bonuses, solution.restorationBonusScope, fixture.input.master))
      idealBonus += ideal.length
      expect(channel.retained.every((value) => value.idealMatch)).toBe(true)
      expect(channel.retained.map((value) => value.solution.finalBonuses)).toEqual(ideal.map((solution) => solution.bonuses))
      expect(channel.retained.map((value) => value.solution.operations.map((operation) =>
        'gogmaCounterBefore' in operation ? `${operation.type}@${operation.gogmaCounterBefore}` : null)))
        .toEqual(ideal.map((solution) => solution.steps.map((step, index) =>
          `${index < solution.lastResetDepth ? 'reset_bonuses' : 'keep_bonuses'}@${step.gogmaCounterBefore}`)))
    }
    let rawSkill = 0
    let idealSkill = 0
    for (const start of skillStarts) {
      const channel = skills.get(start)
      if (!channel) continue
      const read = reads.skill.get(start)!
      rawSkill += read.solutions.length
      const ideal = read.solutions.filter((solution) =>
        evaluateSkillCondition(target.idealSkillCondition, solution.seriesSkillId, solution.groupSkillId))
      idealSkill += ideal.length
      expect(channel.retained.every((value) => value.idealMatch)).toBe(true)
      expect(channel.retained.map((value) => value.solution.operations.map((operation) =>
        'skillCounterBefore' in operation ? operation.skillCounterBefore : null)))
        .toEqual(ideal.map((solution) => solution.steps.map((step) => step.skillCounterBefore)))
    }
    // Not vacuous: most raw positions are non-Ideal and were dropped.
    expect(idealBonus).toBeGreaterThan(0)
    expect(idealSkill).toBeGreaterThan(0)
    expect(rawBonus).toBeGreaterThan(idealBonus)
    expect(rawSkill).toBeGreaterThan(idealSkill)
  })

  it('keeps every same-result later Ideal position as its own retained solution', async () => {
    const { scheduler } = await drain(options)
    const retained = [...channelsOf(scheduler).bonuses.values()].flatMap((channel) => channel.retained)
    const byResult = new Map<string, string[]>()
    for (const value of retained) {
      const key = value.retentionKey
      const where = value.solution.operations.map((operation) =>
        'gogmaCounterBefore' in operation ? `${operation.type[0]}${operation.gogmaCounterBefore}` : '?').join(',')
      byResult.set(key, [...(byResult.get(key) ?? []), where])
    }
    // One Ideal result, reached at several absolute positions: none collapsed.
    const [only] = [...byResult.values()]
    expect(byResult.size).toBe(1)
    expect(new Set(only).size).toBe(only.length)
    expect(only.length).toBeGreaterThan(2)
  })
})

/*
 * A controlled held-aware stream on the real scheduler: the raw solutions are
 * hand-made, and each non-Ideal one counts every read of the fields only a
 * materialization needs (`steps`, `results`). The Ideal predicate reads the
 * completed five slots / scope or Skills; the notices read depth and
 * `lastResetDepth`.
 */
describe('materialization of the controlled held-aware stream', () => {
  const touched = { steps: 0, results: 0 }

  function node(depth: number, bonuses: RestorationBonusSet): BonusAmendmentResultNode {
    let previous: BonusAmendmentResultNode | null = null
    for (let current = 1; current <= depth; current += 1) {
      previous = { depth: current, result: { restorationBonuses: bonuses, restorationBonusScope: 'gogma_artian' }, previous }
    }
    return previous!
  }

  function rawBonus(at: number[], types: string, bonuses: RestorationBonusSet, ideal: boolean): ReservedBonusStreamSolution {
    const steps: BonusStreamStep[] = at.map((position) => ({ gogmaCounterBefore: position, gogmaCounterAfter: position + 1 }))
    const results = node(at.length, bonuses)
    const solution = {
      depth: at.length,
      lastResetDepth: types.lastIndexOf('R') + 1,
      bonuses,
      restorationBonusScope: 'gogma_artian' as const,
    }
    if (ideal) return { ...solution, steps, results }
    return Object.defineProperties(solution, {
      steps: { get: () => { touched.steps += 1; return steps }, enumerable: true },
      results: { get: () => { touched.results += 1; return results }, enumerable: true },
    }) as ReservedBonusStreamSolution
  }

  function rawSkill(at: number[], seriesSkillId: string, ideal: boolean): ReservedSkillStreamSolution {
    const steps: SkillStreamStep[] = at.map((position) => ({
      skillCounterBefore: position, skillCounterAfter: position + 1, seriesSkillId, groupSkillId: null,
    }))
    const solution = { resetCount: at.length, seriesSkillId, groupSkillId: null }
    if (ideal) return { ...solution, steps }
    return Object.defineProperty(solution, 'steps', {
      get: () => { touched.steps += 1; return steps }, enumerable: true,
    }) as ReservedSkillStreamSolution
  }

  function controlled(options: { bonusDepths: ReservedBonusStreamSolution[][]; skillDepths: ReservedSkillStreamSolution[][]; unsupported?: UnsupportedAmendmentPrediction[] }) {
    const { input } = frontierFixture()
    const target = input.targetWeapons[0]
    const reads: string[] = []
    const bonusStream = {
      readReservedDepth: async (_: BonusStreamBase, depth: number) => {
        reads.push(`bonus:${depth}`)
        return {
          solutions: options.bonusDepths[depth - 1] ?? [],
          unsupportedPredictions: depth >= 3 ? options.unsupported ?? [] : [],
          exhausted: depth >= options.bonusDepths.length,
        }
      },
      reservedReachesBeyondExtent: () => true,
    } as unknown as TargetBonusStream
    const skillStream = {
      readReservedDepth: async (_: number, depth: number) => {
        reads.push(`skill:${depth}`)
        return { solutions: options.skillDepths[depth - 1] ?? [], exhausted: depth >= options.skillDepths.length }
      },
      reservedReachesBeyondExtent: () => false,
    } as unknown as TargetSkillStream
    const context: RouteSearchContext = {
      frontierPolicy: 'planner_alternative',
      target,
      input: { ...originOf(input), maxNormalAdvance: 1 },
      engine: frontierFixture().engine,
      execution: createSearchExecutionContext(),
      predictionSupport: {} as SearchPredictionSupport,
      skillStream,
      bonusStream,
    }
    const compositions: Array<{ base: string; composition: ScheduledComposition }> = []
    const labels = new Map<ScheduledRouteBase, string>()
    const scheduler = new TargetSearchScheduler(context, (composition) =>
      compositions.push({ base: labels.get(composition.base)!, composition }))
    const notices: Array<{ base: string; notice: BonusStreamNotice }> = []
    const base = (label: string): ScheduledRouteBase => {
      const value: ScheduledRouteBase = {
        kindResolution: { type: 'existing_gogma' },
        sourceOwnedWeaponId: `owned.controlled.${label}` as OwnedWeaponId,
        baseOperations: [] as RouteOperation[],
        conversionSkill: null,
        zeroBonus: {
          gogmaAdvance: 0, lastResetDepth: 0, finalBonuses: practicalOnlyBonuses(),
          restorationBonusScope: 'gogma_artian', operations: [], amendmentResults: [],
        },
        zeroSkill: {
          resetCount: 0, seriesSkillId: 'series.other', groupSkillId: null,
          estimatedSkillAdvance: 0, operations: [], amendmentResults: [],
        },
        startSkillCounter: 7,
        bonusBase: { startGogmaCounter: 10, bonuses: practicalOnlyBonuses(), restorationBonusScope: 'gogma_artian' },
        onBonusNotice: (notice) => notices.push({ base: label, notice }),
        onCandidate: () => undefined,
      }
      labels.set(value, label)
      return value
    }
    return { target, scheduler, compositions, notices, reads, base }
  }

  const ideal = () => structuredClone(frontierFixture().input.targetWeapons[0].idealBonuses)
  const practical = practicalOnlyBonuses
  const NON_IDEAL_WIDTH = 40

  const streams = () => ({
    bonusDepths: [
      [rawBonus([10], 'R', practical(), false), rawBonus([11], 'R', ideal(), true), rawBonus([12], 'R', practical(), false)],
      [
        rawBonus([10, 11], 'RK', practical(), false), rawBonus([10, 12], 'RR', ideal(), true),
        rawBonus([11, 13], 'RR', ideal(), true), rawBonus([12, 13], 'RK', practical(), false),
      ],
      // A depth of non-Ideal positions only: still read, never materialized.
      Array.from({ length: NON_IDEAL_WIDTH }, (_, index) =>
        rawBonus([10, 11 + (index % 3), 14 + index], index % 2 === 0 ? 'KKK' : 'RKK', practical(), false)),
      [rawBonus([10, 11, 12, 13], 'RRRR', ideal(), true)],
    ],
    skillDepths: [
      [rawSkill([7], 'series.other.7', false), rawSkill([8], IDEAL_SERIES, true), rawSkill([9], 'series.other.9', false)],
      [rawSkill([7, 8], 'series.other.8', false), rawSkill([8, 9], 'series.other.9', false)],
      [rawSkill([7, 8, 9], IDEAL_SERIES, true), rawSkill([8, 9, 10], IDEAL_SERIES, true)],
    ],
    unsupported: [{ type: 'keep_bonuses', reason: 'engine_capability_unavailable' }] as UnsupportedAmendmentPrediction[],
  })

  const expectedPairs = ['B[R11]', 'B[R10,R12]', 'B[R11,R13]', 'B[R10,R11,R12,R13]'].flatMap((bonus) =>
    ['S[8]', 'S[7,8,9]', 'S[8,9,10]'].map((skill) => `${bonus}${skill}`)).sort()

  it('never reads the materialization fields of a non-Ideal position, yet reads every depth', async () => {
    touched.steps = 0
    touched.results = 0
    const { scheduler, compositions, reads, base } = controlled(streams())
    scheduler.addBase(base('first'))
    while (await scheduler.step()) { /* drain */ }
    expect(touched).toEqual({ steps: 0, results: 0 })
    expect(reads.filter((read) => read.startsWith('bonus:'))).toEqual(['bonus:1', 'bonus:2', 'bonus:3', 'bonus:4'])
    expect(reads.filter((read) => read.startsWith('skill:'))).toEqual(['skill:1', 'skill:2', 'skill:3'])
    // Exhausted Bonus stream whose window cut a reachable position.
    expect(scheduler.stoppedByExtent).toBe(true)
    expect(compositions.map(({ composition }) => positions(composition)).sort()).toEqual(expectedPairs)
  })

  it('delivers to a subscriber exactly one evaluated solution per Ideal position', async () => {
    const { scheduler, base } = controlled(streams())
    scheduler.addBase(base('first'))
    const { skills, bonuses } = channelsOf(scheduler)
    const bonusDelivered: EvaluatedBonusSolution[] = []
    const skillDelivered: EvaluatedSkillSolution[] = []
    const [bonusChannel] = [...bonuses.values()]
    const [skillChannel] = [...skills.values()]
    bonusChannel.subscribers.push((value: EvaluatedBonusSolution) => bonusDelivered.push(value))
    skillChannel.subscribers.push((value: EvaluatedSkillSolution) => skillDelivered.push(value))
    while (await scheduler.step()) { /* drain */ }
    expect(bonusDelivered).toHaveLength(4)
    expect(skillDelivered).toHaveLength(3)
    expect([...bonusDelivered, ...skillDelivered].every((value) => value.idealMatch)).toBe(true)
    expect(bonusChannel.retained).toEqual(bonusDelivered)
    expect(skillChannel.retained).toEqual(skillDelivered)
    // Same Ideal result at R10,R12 and at R11,R13: two distinct solutions.
    const depthTwo = bonusDelivered.filter((value) => value.solution.gogmaAdvance === 2)
    expect(depthTwo).toHaveLength(2)
    expect(depthTwo[0].retentionKey).toBe(depthTwo[1].retentionKey)
  })

  it('replays every published Ideal position to a late subscriber', async () => {
    const { scheduler, compositions, reads, base } = controlled(streams())
    scheduler.addBase(base('first'))
    // Settle until depth 1 of both channels was published (lower bound 1),
    // then subscribe a second base; a later lower bound would break the
    // monotone queue, exactly as a real late base never arrives cheaper.
    while (!(reads.includes('bonus:1') && reads.includes('skill:1'))) await scheduler.step()
    const { skills, bonuses } = channelsOf(scheduler)
    const replayed = {
      bonus: [...bonuses.values()][0].retained.map((value) => value.solution.gogmaAdvance),
      skill: [...skills.values()][0].retained.map((value) => value.solution.resetCount),
    }
    expect(replayed).toEqual({ bonus: [1], skill: [1] })
    scheduler.addBase(base('late'))
    while (await scheduler.step()) { /* drain */ }
    const of = (label: string) => compositions.filter((entry) => entry.base === label)
      .map(({ composition }) => positions(composition)).sort()
    expect(of('first')).toEqual(expectedPairs)
    expect(of('late')).toEqual(expectedPairs)
  })

  it('reports the notices of non-Ideal positions, also to a late subscriber', async () => {
    const { scheduler, notices, base } = controlled({
      ...streams(),
      // No Ideal position at all on the Bonus axis.
      bonusDepths: streams().bonusDepths.map((depth) => depth.filter((solution) =>
        JSON.stringify(solution.bonuses) === JSON.stringify(practical()))),
    })
    scheduler.addBase(base('first'))
    while (await scheduler.step()) { /* drain */ }
    scheduler.addBase(base('late'))
    const kinds = (label: string) => notices.filter((entry) => entry.base === label).map(({ notice }) =>
      notice.type === 'route_kind' ? notice.kind : `unsupported:${notice.prediction.type}`)
    const expected = ['existing_gogma_reset_bonuses', 'existing_gogma_mixed', 'existing_gogma_keep_bonuses', 'unsupported:keep_bonuses']
    expect(kinds('first')).toEqual(expected)
    expect(kinds('late')).toEqual(expected)
    expect([...channelsOf(scheduler).bonuses.values()][0].retained).toEqual([])
  })

  it('applies the Ideal Bonus authority to every raw position, its Master rank assertion included', async () => {
    const unknownRank = practical().map((bonus, index) =>
      index === 0 ? { ...bonus, bonusRankId: 'bonus_rank.fixture.unknown' } : bonus) as RestorationBonusSet
    const { scheduler, base } = controlled({
      bonusDepths: [[rawBonus([10], 'R', unknownRank, false)]],
      skillDepths: [[rawSkill([7], 'series.other.7', false)]],
    })
    scheduler.addBase(base('first'))
    await expect((async () => { while (await scheduler.step()) { /* drain */ } })()).rejects.toThrow(/bonus_rank\.fixture\.unknown/)
  })
})

describe('source audit of the Ideal-only publication', () => {
  const scheduler = import.meta.glob('../targetSearchScheduler.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const source = scheduler['../targetSearchScheduler.ts']

  it('filters the held-aware raw solutions with the existing Ideal authorities before any materialization', () => {
    expect(source).toContain('reserved.solutions.filter((solution) => evaluateSkillCondition(')
    expect(source).toContain('reserved.solutions.filter((solution) => satisfiesIdealBonuses(')
    // No held-aware raw solution is mapped to a materialized one before the filter.
    expect(source).not.toContain('reserved.solutions.map(')
    // The Bonus notices are still taken from every raw state, before the filter.
    const noticeLoop = source.indexOf('for (const solution of reserved.solutions)')
    const filter = source.indexOf('reserved.solutions.filter((solution) => satisfiesIdealBonuses(')
    expect(noticeLoop).toBeGreaterThan(0)
    expect(noticeLoop).toBeLessThan(filter)
  })
})
