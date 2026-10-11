import { describe, expect, it } from 'vitest'
import { hashStableValue } from '../domain/models/hashing'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeSearchInput } from '../domain/search'
import { createCountingRngEngine } from './plannerAlternativeBenchmarkInstrumentation'
import { createIssue101NoIdealSearchInput, createLongHeldFixture } from './plannerAlternativeBenchmarkFixtures'
import {
  checkD2GAFormalTask,
  createD2GADiagnosticObserver,
  createD2GASeries,
  d2gaConversionSkillPositions,
  d2gaFormalSegments,
  d2gaReservationShape,
  d2gaRungExtent,
  D2GA_FORMAL_SOURCES,
  D2GA_ORIGIN_DIGEST,
  D2GA_PROTOCOL,
  readD2GAFormalTask,
  type D2GAFormalMemoryRow,
} from './plannerGlobalD2GA'

/*
 * Issue #154 D2-G-A (non-formal diagnosis). The diagnostic observer must be semantics-neutral: with and without it the delivered
 * `candidateStableKey` sequence, the Search summary (termination) and the prediction calls are identical. Only counts are asserted.
 */

const SLOW = 180_000

async function runSearch(input: PlannerAlternativeSearchInput, stopAfter: number | null, instrumented: boolean) {
  const engine = new ProductionRngEngine()
  const observer = instrumented ? createD2GADiagnosticObserver(engine) : null
  const plain = createCountingRngEngine(engine)
  const keys: string[] = []
  const execution = await visitPlannerAlternativeCandidates(structuredClone(input), observer?.countingEngine.engine ?? plain.engine, (candidate) => {
    keys.push(candidateStableKey(candidate))
    return stopAfter !== null && keys.length >= stopAfter ? 'stop' : 'continue'
  }, observer ? { instrumentation: observer.instrumentation } : {})
  return { keys, execution, counts: (observer?.countingEngine ?? plain).counts(), observer }
}

const workloads = (): Array<[string, PlannerAlternativeSearchInput, number | null]> => [
  ['no-Ideal', createIssue101NoIdealSearchInput({ maxNormalAdvance: 2, maxGogmaAdvance: 20, maxSkillAdvance: 2 }), null],
  ['long Skill held', createLongHeldFixture('long_skill_held', { heldLength: 8, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 11 }).input, null],
  ['long Gogma held', createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, 12],
  ['long Gogma held, run to the end', createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held_blocked' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, null],
]

describe('D2-G-A diagnostic observer', () => {
  it('changes no delivered key sequence, termination or prediction call count', async () => {
    for (const [label, input, stopAfter] of workloads()) {
      const plain = await runSearch(input, stopAfter, false)
      const observed = await runSearch(input, stopAfter, true)
      expect(observed.keys, label).toEqual(plain.keys)
      expect(observed.execution, label).toEqual(plain.execution)
      expect(observed.counts, label).toEqual(plain.counts)
    }
  }, SLOW)

  it('keeps aggregates that agree with the existing observers and the section tracker', async () => {
    for (const [label, input, stopAfter] of workloads()) {
      const run = await runSearch(input, stopAfter, true)
      const final = run.observer!.final()
      const probe = final.probe
      expect(probe.settledWork, label).toBeGreaterThan(0)
      expect(probe.settledWork, label).toBe(probe.sections.schedulerSteps)
      expect(final.runtime.contractViolations, label).toBe(0)
      expect(probe.skill.retainedStates, label).toBe(final.skillDepths.totalStates)
      expect(probe.skill.transitions, label).toBe(final.skillDepths.totalTransitions)
      expect(probe.skill.streams, label).toBe(final.skillDepths.streams)
      expect(probe.gogma.generatedStates, label).toBe(final.gogmaDepths.totalGeneratedStates)
      expect(probe.gogma.streams, label).toBe(final.gogmaDepths.streams)
      expect(probe.gogma.liveFrontierStates, label).toBe(final.gogmaStreams.reduce((sum, s) => sum + s.lastFrontierStates, 0))
      expect(probe.skill.retainedStates, label).toBe(final.skillStreams.reduce((sum, s) => sum + s.retainedStates, 0))
      expect(probe.sections.bonusDepthWork + probe.sections.skillDepthWork, label).toBe(final.channels.reduce((sum, c) => sum + c.stats.works, 0))
      expect(probe.predictions, label).toEqual(run.counts)
    }
  }, SLOW)

  it('sees the held Skill run as retained states and the held Gogma run as a wider live frontier', async () => {
    const skill = await runSearch(createLongHeldFixture('long_skill_held', { heldLength: 8, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 11 }).input, null, true)
    const skillShort = await runSearch(createLongHeldFixture('long_skill_held', { heldLength: 2, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 11 }).input, null, true)
    expect(skill.observer!.probe().skill.retainedStates).toBeGreaterThan(skillShort.observer!.probe().skill.retainedStates)
    const gogma = await runSearch(createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, null, true)
    const gogmaShort = await runSearch(createLongHeldFixture('long_gogma_held', { heldLength: 1, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, null, true)
    expect(gogma.observer!.final().gogmaStreams[0]!.maxFrontierStates).toBeGreaterThan(gogmaShort.observer!.final().gogmaStreams[0]!.maxFrontierStates)
  }, SLOW)
})

describe('D2-G-A static helpers', () => {
  it('derives the conversion Skill positions with the Production walk (blocked skipped, held crossed, extent cut)', async () => {
    const body = { skill: { held: [10, 11, 12, 13, 14], blocked: [10, 12] }, gogma: { held: [], blocked: [] }, normal: [], exclusiveOwnedWeaponIds: [] }
    expect(await d2gaConversionSkillPositions(body, 10, 2)).toEqual({ positions: [11], beyondLimit: true })
    expect(await d2gaConversionSkillPositions(body, 10, 10)).toEqual({ positions: [11, 13, 14, 15], beyondLimit: false })
    expect(await d2gaConversionSkillPositions({ skill: { held: [], blocked: [] } }, 10, 4)).toEqual({ positions: [10], beyondLimit: false })
  })

  it('summarizes a reservation as counts and held runs', () => {
    const shape = d2gaReservationShape({ skill: { held: [3, 1, 2, 7], blocked: [1] }, gogma: { held: [5], blocked: [] }, normal: [{ counterId: 'w:8', held: [1, 2], blocked: [2] }] })
    expect(shape).toEqual([
      { stream: 'skill', counterId: null, held: 4, blocked: 1, heldRuns: [[1, 3], [7, 7]] },
      { stream: 'gogma', counterId: null, held: 1, blocked: 0, heldRuns: [[5, 5]] },
      { stream: 'normal', counterId: 'w:8', held: 2, blocked: 1, heldRuns: [[1, 2]] },
    ])
  })

  it('keeps a bounded, evenly thinned series', () => {
    const series = createD2GASeries<number>(2, 4)
    for (let i = 1; i <= 20; i += 1) series.offer(() => i)
    expect(series.values().length).toBeLessThan(4)
    expect(series.keepEvery()).toBeGreaterThan(2)
    expect(series.values()).toEqual([...series.values()].sort((a, b) => a - b))
  })

  it('splits a formal cumulative-maximum series into segments with the yield rate and the heap growth per million yields', () => {
    const rows: D2GAFormalMemoryRow[] = [0, 10, 20, 30].map((s, i) => ({ receivedAtMs: s * 1000, yields: [0, 1_000_000, 2_000_000, 2_100_000][i]!,
      maxima: { samples: i, maxHeapUsedBytes: [1, 3, 5, 5.5][i]! * 2 ** 30, maxRssBytes: 6 * 2 ** 30, lastElapsedMs: s * 1000 } }))
    const segments = d2gaFormalSegments(rows, [0, 20])
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ fromS: 0, toS: 20, heapMaxFromGb: 1, heapMaxToGb: 5, yieldsPerS: 100_000, heapGrowthGbPerMillionYields: 2 })
    expect(segments[1]).toMatchObject({ fromS: 20, toS: 30, yieldsPerS: 10_000, heapGrowthGbPerMillionYields: 5 })
    expect(d2gaFormalSegments([], [0])).toEqual([])
  })

  it('reads a formal task fail-closed and checks it against the registered context, origin and rung extent', () => {
    const reservationBody = { skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, normal: [], exclusiveOwnedWeaponIds: [] }
    const task = { unitId: 'DSC-K2-L0', contextId: 'K2-x', targetWeaponId: 't', supportBuildListEntryIds: ['a', 'b'], currentBuildListEntryId: 'o', rung: 'L0',
      extent: d2gaRungExtent('L0'), context: { reservationBody, reservationDigest: hashStableValue(reservationBody), originDigest: D2GA_ORIGIN_DIGEST, excludedRouteKeys: ['k'] },
      researchMaxPlanSteps: 20_000 }
    const read = readD2GAFormalTask({ task })
    expect(read.issues).toEqual([])
    // The real K2 digest differs from this synthetic body: the check names exactly that.
    expect(checkD2GAFormalTask(D2GA_PROTOCOL.units[0]!, read.task!)).toEqual([`reservation digest ${hashStableValue(reservationBody)} is not ${D2GA_FORMAL_SOURCES.K2.reservationDigest}`])
    expect(checkD2GAFormalTask(D2GA_PROTOCOL.units[2]!, read.task!)).toContain('rung L0 is not L1')
    expect(readD2GAFormalTask({ task: { ...task, researchMaxPlanSteps: 1000 } }).task).toBeNull()
    expect(readD2GAFormalTask({ task: { ...task, extent: { maxNormalAdvance: 1 } } }).issues).toContain('task.extent is not an extent')
    expect(readD2GAFormalTask(null).task).toBeNull()
  })

  it('registers the four-unit protocol before any measurement: K2 / K3 at L0 and L1 only, 12,288 MB, 15 / 90 minutes, no retry', () => {
    expect(D2GA_PROTOCOL.units.map(u => u.id)).toEqual(['K2-L0', 'K3-L0', 'K2-L1', 'K3-L1'])
    expect(D2GA_PROTOCOL.units.some(u => u.rung === 'L2')).toBe(false)
    expect(D2GA_PROTOCOL).toMatchObject({ childHeapMb: 12_288, childWallMs: 900_000, totalWallMs: 5_400_000, concurrency: 1, retry: 'none', fallback: 'none', forcedGc: false })
  })
})

describe('D2-G-A isolation', () => {
  const benchmarkSources = import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const codeOnly = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('imports no D2-C / D2-D / D2-E / D2-F module, no Phase 2-C2.5 module and no oracle', () => {
    const source = codeOnly(benchmarkSources['./plannerGlobalD2GA.ts']!)
    expect(source).not.toMatch(/from '\.\/plannerGlobalD2[C-F]/)
    expect(source).not.toMatch(/plannerGlobalPhase2C25|Oracle1657|ORACLE_|_1657_|readFile|node:fs/)
  })

  it('is never imported by Production', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD2GA/.test(source)).map(([path]) => path)).toEqual([])
  })
})
