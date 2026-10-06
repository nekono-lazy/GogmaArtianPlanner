import { describe, expect, it } from 'vitest'
import preB2I from '../../test/fixtures/predictKeepCachePreB2I.json'
import {
  PREDICT_KEEP_LAYOUTS,
  predictKeepCacheCases,
  predictKeepCacheFixture,
  recordPredictKeepCacheParity,
  type PredictKeepCacheCase,
  type PredictKeepCacheRecord,
} from '../../test/fixtures/predictKeepCacheParity'
import { keepFamilyLayoutKey } from '../rng/gogmaBonusFamily'
import bonusStreamSource from './bonusStream.ts?raw'
import { createTargetBonusStream, type BonusStreamBase } from './bonusStream'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from './counterReservation'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport } from './searchPredictionSupport'

/*
 * Global Planner Research Phase 2-C2.6-B2-C2B2I (Issue #154): the Keep memo of
 * `createTargetBonusStream()` is keyed by the `(gogmaCounter, familyLayoutKey)`
 * pair as `counter -> family layout key -> prediction` nested Maps instead of the
 * composite string `${gogmaCounter}\u0000${familyLayoutKey}`. The pair is the
 * same, so the ordinary stream, the held-aware stream and both Searches return
 * exactly what they returned before, with exactly the same Engine calls.
 */

const records = (preB2I as unknown as { records: PredictKeepCacheRecord[] }).records

describe('predictKeep nested (counter, family layout) memo: frozen pre-optimization records', () => {
  it('covers every case once, in order, and is not vacuous (tier sharing, Candidates, held positions)', () => {
    expect(records.map(record => record.name)).toEqual(predictKeepCacheCases.map(testCase => testCase.name))
    const keepCalls = (calls: string[]) => calls.filter(call => call.startsWith('keep:')).length
    for (const record of records) {
      const reserved = record.reserved as Array<{ calls: string[]; runtimeEvents: Array<{ counts: { generatedStates: number | null } }> }>
      // Fewer Keep predictions than generated states: states share one (counter, layout) prediction.
      for (const run of reserved) expect(keepCalls(run.calls)).toBeLessThan(run.runtimeEvents.reduce((total, event) => total + (event.counts.generatedStates ?? 0), 0))
      expect((record.candidateSearch as { result: { targetResult: { candidate: unknown } } }).result.targetResult.candidate).not.toBeNull()
      expect((record.alternativeSearch as Array<{ candidates: unknown[] }>).every(run => run.candidates.length > 0)).toBe(true)
    }
  })

  it.each(predictKeepCacheCases.map((testCase, index) => [testCase.name, index] as const))(
    '%s: the same ordinary / held-aware solutions, observer counts, Candidates, termination and Engine calls as the composite-key memo',
    async (_, index) => {
      expect(JSON.parse(JSON.stringify(await recordPredictKeepCacheParity(predictKeepCacheCases[index]!)))).toEqual(records[index])
    },
  )
})

// ---------------------------------------------------------------- the pair semantics, directly

const ONE_LAYOUT: PredictKeepCacheCase = { name: 'pair semantics', extent: 4, resetLayout: () => 'X', keepTier: (c) => c, owned: [{ layout: 'X', tier: 0 }] }
const BLIND: BonusStreamBase = { startGogmaCounter: 10, bonuses: null, restorationBonusScope: 'normal_artian' }

function streams(testCase: PredictKeepCacheCase, held?: number[]) {
  const fixture = predictKeepCacheFixture(testCase)
  const target = fixture.input.targetWeapons[0]!
  const make = () => createTargetBonusStream(
    target,
    { rngState: fixture.input.rngState, master: fixture.input.master, maxGogmaAdvance: testCase.extent,
      reservation: held === undefined ? EMPTY_COUNTER_RESERVATION : createCounterReservation(held, []) },
    fixture.engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(fixture.engine, target, fixture.input.master),
  )
  return { fixture, make }
}

const keepCallsAt = (calls: string[], counter: number) => calls.filter(call => call.startsWith(`keep:${counter}:`))
const layoutOf = (call: string) => call.split(':')[2]

describe('predictKeep nested (counter, family layout) memo: pair semantics', () => {
  it('A (held-aware): one Gogma Counter and one family layout share one prediction across tiers, with the first state\'s slots as the Engine input', async () => {
    // Held 10..12: the depth-1 Resets at 10, 11 and 12 (layout X, tiers differing per Counter) all Keep at 13 at depth 2.
    const { fixture, make } = streams(ONE_LAYOUT, [10, 11, 12])
    const stream = make()
    const depth1 = await stream.readReservedDepth(BLIND, 1)
    const depth2 = await stream.readReservedDepth(BLIND, 2)
    const keepsAt13 = depth2.solutions.filter(solution => solution.lastResetDepth === 1 && solution.steps.at(-1)!.gogmaCounterBefore === 13)
    const parents = keepsAt13.map(solution => solution.steps[0]!.gogmaCounterBefore)
    expect(parents).toEqual([10, 11, 12])
    const parentSlots = parents.map(position => depth1.solutions.find(solution => solution.steps[0]!.gogmaCounterBefore === position)!.bonuses)
    expect(new Set(parentSlots.map(slots => JSON.stringify(slots))).size).toBe(3)
    expect(new Set(parentSlots.map(slots => keepFamilyLayoutKey(slots, fixture.input.master))).size).toBe(1)
    const calls = keepCallsAt(fixture.calls, 13)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.split(':').slice(3).join(':')).toBe(JSON.stringify(parentSlots[0]!.map(bonus => ({ bonusRankId: bonus.bonusRankId, bonusTypeId: bonus.bonusTypeId }))))
    // The one prediction (its very object) is every such state's five slots.
    for (const solution of keepsAt13) expect(solution.bonuses).toBe(keepsAt13[0]!.bonuses)
  })

  it('A (ordinary): two known sources of one family layout and different tiers share one Keep prediction per Counter', async () => {
    const { fixture, make } = streams(ONE_LAYOUT)
    const stream = make()
    const slots = (tier: number) => PREDICT_KEEP_LAYOUTS.X.map((bonusTypeId, slot) => ({ bonusTypeId, bonusRankId: (['bonus_rank.fixture.low', 'bonus_rank.fixture.middle', 'bonus_rank.fixture.high'] as const)[(tier + slot) % 3]! }))
    const bases: BonusStreamBase[] = [0, 1].map(tier => ({ startGogmaCounter: 10, bonuses: slots(tier) as never, restorationBonusScope: 'gogma_artian' }))
    expect(keepFamilyLayoutKey(bases[0]!.bonuses!, fixture.input.master)).toBe(keepFamilyLayoutKey(bases[1]!.bonuses!, fixture.input.master))
    const reads = [await stream.readDepth(bases[0]!, 1), await stream.readDepth(bases[1]!, 1)]
    expect(keepCallsAt(fixture.calls, 10)).toHaveLength(1)
    const keeps = reads.map(read => read.solutions.find(solution => solution.lastResetDepth === 0)!)
    expect(keeps[1]!.bonuses).toBe(keeps[0]!.bonuses)
  })

  it('B: one Gogma Counter with two family layouts makes two predictions; C: one family layout at two Counters makes two predictions', async () => {
    const twoLayouts: PredictKeepCacheCase = { ...ONE_LAYOUT, resetLayout: (c) => (c % 2 === 0 ? 'X' : 'Y') }
    const { fixture, make } = streams(twoLayouts)
    const stream = make()
    for (let depth = 1; !(await stream.readReservedDepth(BLIND, depth)).exhausted; depth += 1);
    const master = fixture.input.master
    const key = (layout: keyof typeof PREDICT_KEEP_LAYOUTS) => keepFamilyLayoutKey(PREDICT_KEEP_LAYOUTS[layout].map(bonusTypeId => ({ bonusTypeId, bonusRankId: 'bonus_rank.fixture.low' })) as never, master)
    expect(key('X')).not.toBe(key('Y'))
    // B: Counter 12 sees layout X (from 10) and Y (from 11): two predictions, one per layout.
    expect(keepCallsAt(fixture.calls, 12).map(layoutOf).sort()).toEqual([key('X'), key('Y')].sort())
    // C: layout X is predicted at 11, 12 and 13 separately (never one prediction for two Counters).
    const xCounters = fixture.calls.filter(call => call.startsWith('keep:') && layoutOf(call) === key('X')).map(call => Number(call.split(':')[1]))
    expect(xCounters).toEqual([...new Set(xCounters)])
    expect(xCounters.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the memo per stream instance: a second stream predicts again', async () => {
    const { fixture, make } = streams(ONE_LAYOUT, [10, 11, 12])
    for (const stream of [make(), make()]) {
      await stream.readReservedDepth(BLIND, 1)
      await stream.readReservedDepth(BLIND, 2)
    }
    expect(keepCallsAt(fixture.calls, 13)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- the source shape of the change

describe('predictKeep nested (counter, family layout) memo: source shape', () => {
  const body = /\n {2}function predictKeep\(([\s\S]*?)\n {2}\}\n/.exec(bonusStreamSource)?.[1] ?? ''

  it('declares the Keep memo as counter -> family layout key -> prediction and builds no composite key in predictKeep', () => {
    expect(bonusStreamSource).toMatch(/const keepPredictions = new Map<number, Map<string, RestorationBonusSet>>\(\)/)
    expect(bonusStreamSource).not.toMatch(/new Map<string, RestorationBonusSet>\(\)\n/)
    expect(body).not.toBe('')
    expect(body).not.toMatch(/\\u0000/)
    expect(body).not.toMatch(/`\$\{gogmaCounter\}/)
    expect(body).toMatch(/keepPredictions\.get\(gogmaCounter\)/)
    expect(body).toMatch(/\.get\(familyLayoutKey\)/)
  })

  it('registers the prediction only after the Engine returned it (no entry and no inner Map before a successful prediction)', () => {
    const predictedAt = body.indexOf('engine.predictGogmaBonus(')
    expect(predictedAt).toBeGreaterThan(0)
    const writes = [...body.matchAll(/\.set\(|new Map\(/g)].map(match => match.index!)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every(index => index > predictedAt)).toBe(true)
  })

  it('leaves the frontier reduction key and the Reset memo unchanged', () => {
    expect(bonusStreamSource).toContain('const key = `${state.position}\\u0000${state.familyLayoutKey}`')
    expect(bonusStreamSource).toContain('const resetPredictions = new Map<number, RestorationBonusSet>()')
  })
})
