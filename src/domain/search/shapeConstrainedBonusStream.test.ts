import { afterEach, describe, expect, it, vi } from 'vitest'
import { practicalOnlyBonuses } from '../../test/fixtures/candidateSearch'
import { keepCompatiblePracticalBonuses } from '../../test/fixtures/plannerAlternativeFrontier'
import { seamFixture, slotsText, type SeamFixtureOptions } from '../../test/fixtures/shapeConstrainedSeamFixture'
import type { RestorationBonusSet } from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import { keepFamilyLayoutKey } from '../rng/gogmaBonusFamily'
import {
  bonusAmendmentOperationType,
  bonusStreamBaseKey,
  createTargetBonusStream,
  type BonusShapePolicy,
  type BonusStreamBase,
  type ReservedBonusStreamSolution,
} from './bonusStream'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from './counterReservation'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport } from './searchPredictionSupport'
import { compareStableKeys } from './semanticKeys'

/*
 * Issue #154 Global Assignment Phase D-0A-2a (`docs/SEARCH_SPEC.md` 5.6.9, `docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md`
 * 5.3 item 8 / 7 / 15 "Bonus support契約" / "seam単体"): the Research-only `BonusStreamBase.shapePolicy` of the held-aware
 * Bonus stream. Fixture Counters: Gogma 10, every advance +1; the fake Keep keeps the family layout (RNG_SPEC 6.1).
 * Layout L = the Ideal's families (`keepCompatiblePracticalBonuses()`), layout P = `practicalOnlyBonuses()`.
 */

afterEach(() => vi.restoreAllMocks())

const at = (...positions: number[]) => (counter: number) => positions.includes(counter)

function shapeStream(options: SeamFixtureOptions & { extent: number; held?: number[]; blocked?: number[] }) {
  const fixture = seamFixture(options)
  const target = fixture.input.targetWeapons[0]
  const depthObservations: unknown[] = []
  const reservation = options.held === undefined ? EMPTY_COUNTER_RESERVATION : createCounterReservation(options.held, options.blocked ?? [])
  const stream = createTargetBonusStream(
    target,
    { rngState: fixture.input.rngState, master: fixture.input.master, maxGogmaAdvance: options.extent, reservation },
    fixture.engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(fixture.engine, target, fixture.input.master),
    (observation) => { depthObservations.push(observation) },
  )
  return { fixture, stream, depthObservations, master: fixture.input.master }
}

const gogmaBase = (bonuses: RestorationBonusSet, shapePolicy?: BonusShapePolicy): BonusStreamBase =>
  ({ startGogmaCounter: 10, bonuses, restorationBonusScope: 'gogma_artian', ...(shapePolicy === undefined ? {} : { shapePolicy }) })

/** The canonical operation history of one solution, e.g. `R11,K12,K13`. */
const history = (solution: ReservedBonusStreamSolution) => solution.steps
  .map((step, index) => `${bonusAmendmentOperationType(solution, index + 1) === 'reset_bonuses' ? 'R' : 'K'}${step.gogmaCounterBefore}`).join(',')

async function readAll(stream: ReturnType<typeof shapeStream>['stream'], base: BonusStreamBase) {
  const reads: Array<{ solutions: ReservedBonusStreamSolution[]; unsupportedPredictions: readonly unknown[]; exhausted: boolean }> = []
  for (let depth = 1; ; depth += 1) {
    const read = await stream.readReservedDepth(base, depth)
    reads.push(read)
    if (read.exhausted) return reads
    if (depth > 64) throw new Error('the stream never became exhausted')
  }
}

const histories = (reads: Awaited<ReturnType<typeof readAll>>) => reads.map((read) => read.solutions.map(history))

describe('shapePolicy generation rules (5.3 item 8)', () => {
  it('reset: Resets only, at every legal position up to finalPosition, and nothing after it', async () => {
    const { stream, fixture } = shapeStream({ extent: 5, held: [10, 11], resetIdealAt: at(12) })
    const base = gogmaBase(practicalOnlyBonuses(), { kind: 'reset', finalPosition: 12 })
    const reads = await readAll(stream, base)
    // One Reset per position and depth: its history is the first Reset chain reaching it (the Production rule).
    expect(histories(reads)).toEqual([['R10', 'R11', 'R12'], ['R10,R11', 'R10,R12'], ['R10,R11,R12']])
    expect(fixture.calls).toEqual(['reset:10', 'reset:11', 'reset:12'])
    // Only the Reset support is evaluated; the Keep support is never queried.
    expect(fixture.supportQueries).toEqual(['gogma_reset'])
    expect(reads.flatMap((read) => read.unsupportedPredictions)).toEqual([])
    // The window ends at finalPosition: that is the shape's own end, never an extent stop.
    expect(stream.reservedReachesBeyondExtent(base)).toBe(false)
  })

  it('keep: Keeps only, every Keep reading the base layout, and no Reset is generated or queried', async () => {
    const { stream, fixture, master } = shapeStream({ extent: 5, held: [10, 11], keepResult: (g) => (g === 12 ? 'ideal' : 'practical') })
    const base = gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 12 })
    const reads = await readAll(stream, base)
    expect(histories(reads)).toEqual([['K10', 'K11', 'K12'], ['K10,K11', 'K10,K12', 'K11,K12'], ['K10,K11,K12']])
    expect(fixture.calls.every((call) => call.startsWith('keep:'))).toBe(true)
    expect(new Set(fixture.calls.map((call) => call.split(':').slice(2).join(':')))).toEqual(new Set([keepFamilyLayoutKey(base.bonuses!, master)]))
    expect(fixture.supportQueries.every((query) => query.startsWith('gogma_keep:'))).toBe(true)
    expect(stream.reservedReachesBeyondExtent(base)).toBe(false)
  })

  it('reset_then_keep: Resets at or before resetPosition, Keeps only after the Reset at resetPosition', async () => {
    const { stream, fixture } = shapeStream({ extent: 4, held: [10, 11, 12], resetAt: (g) => (g === 11 ? keepCompatiblePracticalBonuses() : null),
      keepResult: (g) => (g === 13 ? 'ideal' : 'practical') })
    const base = gogmaBase(practicalOnlyBonuses(), { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 13 })
    const reads = await readAll(stream, base)
    expect(histories(reads)).toEqual([
      ['R10', 'R11'],
      ['R10,R11', 'R11,K12', 'R11,K13'],
      ['R10,R11,K12', 'R10,R11,K13', 'R11,K12,K13'],
      ['R10,R11,K12,K13'],
    ])
    // No Reset after resetPosition, no Keep before it or from another Reset.
    expect(fixture.calls.filter((call) => call.startsWith('reset:'))).toEqual(['reset:10', 'reset:11'])
    expect(fixture.calls.filter((call) => call.startsWith('keep:')).every((call) => Number(call.split(':')[1]) > 11)).toBe(true)
    // The Reset stage queries no Keep support: only the Reset at resetPosition (layout L) and the Keeps after it are Kept.
    const keepQueries = fixture.supportQueries.filter((query) => query.startsWith('gogma_keep:'))
    expect(keepQueries).toEqual([`gogma_keep:${slotsText(keepCompatiblePracticalBonuses())}`])
    expect(fixture.supportQueries.filter((query) => query === 'gogma_reset')).toEqual(['gogma_reset'])
    expect(stream.reservedReachesBeyondExtent(base)).toBe(false)
  })

  it('places no own operation after finalPosition, predicts nothing there, and records no extent stop although the extent reaches further', async () => {
    const production = shapeStream({ extent: 6, resetIdealAt: at(11) })
    const shaped = shapeStream({ extent: 6, resetIdealAt: at(11) })
    const plainBase = gogmaBase(practicalOnlyBonuses())
    const shapeBase = gogmaBase(practicalOnlyBonuses(), { kind: 'reset', finalPosition: 11 })
    const plain = await readAll(production.stream, plainBase)
    const reads = await readAll(shaped.stream, shapeBase)
    expect(reads.flatMap((read) => read.solutions).every((solution) => solution.steps.every((step) => step.gogmaCounterBefore <= 11))).toBe(true)
    expect(shaped.fixture.calls.every((call) => Number(call.split(':')[1]) <= 11)).toBe(true)
    expect(shaped.stream.reservedReachesBeyondExtent(shapeBase)).toBe(false)
    // The Production stream of the same base reads to the extent and records the stop there.
    expect(plain.at(-1)!.solutions.some((solution) => solution.steps.at(-1)!.gogmaCounterBefore === 15)).toBe(true)
    expect(production.stream.reservedReachesBeyondExtent(plainBase)).toBe(true)
  })

  it('follows the held window: a held position is crossed or used, a blocked one only crossed', async () => {
    const { stream } = shapeStream({ extent: 5, held: [11, 12], blocked: [12], keepResult: () => 'practical' })
    const base = gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 13 })
    const reads = await readAll(stream, base)
    expect(histories(reads)).toEqual([['K10'], ['K10,K11', 'K10,K13'], ['K10,K11,K13']])
  })

  it('keeps the Production frontier rule: one representative per (position, family layout), larger lastResetDepth first', async () => {
    const { stream, master } = shapeStream({ extent: 5, held: [10, 11, 12], resetAt: (g) => (g <= 11 ? keepCompatiblePracticalBonuses() : null) })
    const base = gogmaBase(practicalOnlyBonuses(), { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 14 })
    const reads = await readAll(stream, base)
    let checked = 0
    for (let index = 1; index < reads.length; index += 1) {
      const previous = reads[index - 1].solutions
      const representatives = new Map<string, ReservedBonusStreamSolution>()
      for (const solution of previous) {
        const key = `${solution.steps.at(-1)!.gogmaCounterBefore}\u0000${keepFamilyLayoutKey(solution.bonuses, master)}`
        const current = representatives.get(key)
        const better = current === undefined || (solution.lastResetDepth - current.lastResetDepth
          || -compareStableKeys(stableStringify(solution.bonuses), stableStringify(current.bonuses))) > 0
        if (better) representatives.set(key, solution)
      }
      const kept = new Set([...representatives.values()].map((solution) => solution.results))
      for (const solution of reads[index].solutions) {
        expect(kept.has(solution.results.previous as ReservedBonusStreamSolution['results'])).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('shapePolicy support contract (5.3 item 8, 15 "Bonus support契約")', () => {
  it('Reset supported / Keep unsupported: a Reset-only lane is generated and no Keep support is queried', async () => {
    const { stream, fixture } = shapeStream({ extent: 3, resetIdealAt: at(11), keepSupportedFor: () => false })
    const reads = await readAll(stream, gogmaBase(practicalOnlyBonuses(), { kind: 'reset', finalPosition: 11 }))
    expect(histories(reads)).toEqual([['R10'], ['R10,R11']])
    expect(fixture.supportQueries).toEqual(['gogma_reset'])
    expect(reads.flatMap((read) => read.unsupportedPredictions)).toEqual([])
  })

  it('Keep supported / Reset unsupported: a Keep-only lane is generated and no Reset support is queried', async () => {
    const { stream, fixture } = shapeStream({ extent: 3, resetSupported: false, keepResult: (g) => (g === 11 ? 'ideal' : 'practical') })
    const reads = await readAll(stream, gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 11 }))
    expect(histories(reads)).toEqual([['K10'], ['K10,K11']])
    expect(fixture.supportQueries).not.toContain('gogma_reset')
    expect(reads.flatMap((read) => read.unsupportedPredictions)).toEqual([])
  })

  it('reports the unsupported Reset of a Reset-only lane, and of the Reset stage of a Reset-then-Keep lane', async () => {
    for (const policy of [{ kind: 'reset', finalPosition: 11 }, { kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 }] as BonusShapePolicy[]) {
      const { stream, fixture } = shapeStream({ extent: 3, resetSupported: false })
      const reads = await readAll(stream, gogmaBase(practicalOnlyBonuses(), policy))
      expect(reads).toHaveLength(1)
      expect(reads[0]).toMatchObject({ solutions: [], exhausted: true, unsupportedPredictions: [{ type: 'reset_bonuses', reason: 'engine_capability_unavailable' }] })
      expect(fixture.supportQueries).toEqual(['gogma_reset'])
      expect(fixture.calls).toEqual([])
    }
  })

  it('reports the unsupported Keep of a Keep-only lane, and of the Keep stage of a Reset-then-Keep lane only', async () => {
    const keepOnly = shapeStream({ extent: 3, keepSupportedFor: () => false })
    const keepReads = await readAll(keepOnly.stream, gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 11 }))
    expect(keepReads[0]).toMatchObject({ solutions: [], exhausted: true, unsupportedPredictions: [{ type: 'keep_bonuses', reason: 'engine_capability_unavailable' }] })
    expect(keepOnly.fixture.supportQueries).not.toContain('gogma_reset')

    // The Reset stage generates (its Keep support is not asked); the Keep stage after the Reset at 10 is refused.
    const both = shapeStream({ extent: 3, keepSupportedFor: () => false })
    const reads = await readAll(both.stream, gogmaBase(practicalOnlyBonuses(), { kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 }))
    expect(histories(reads)).toEqual([['R10'], []])
    expect(reads[0].unsupportedPredictions).toEqual([])
    expect(reads.at(-1)!.unsupportedPredictions).toEqual([{ type: 'keep_bonuses', reason: 'engine_capability_unavailable' }])
    expect(both.fixture.supportQueries).toEqual(['gogma_reset', `gogma_keep:${slotsText(practicalOnlyBonuses())}`])
  })

  it('needs no Keep capability on a Reset-only lane and generates no Keep without it on a Keep stage', async () => {
    const resetOnly = shapeStream({ extent: 3, capabilities: { supportsKeepBonusesPrediction: false }, resetIdealAt: at(11) })
    expect(histories(await readAll(resetOnly.stream, gogmaBase(practicalOnlyBonuses(), { kind: 'reset', finalPosition: 11 })))).toEqual([['R10'], ['R10,R11']])
    const keepOnly = shapeStream({ extent: 3, capabilities: { supportsKeepBonusesPrediction: false } })
    const reads = await readAll(keepOnly.stream, gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 11 }))
    expect(reads).toEqual([{ solutions: [], unsupportedPredictions: [], exhausted: true }])
    expect(keepOnly.fixture.supportQueries).toEqual([])
  })
})

describe('shapePolicy stream contract (5.3 item 8, 15 "seam単体")', () => {
  const policy: BonusShapePolicy = { kind: 'keep', finalPosition: 12 }

  it('refuses the ordinary readDepth() / solve() / reachesBeyondExtent() of a shape-constrained base', async () => {
    const { stream, fixture } = shapeStream({ extent: 4 })
    const base = gogmaBase(keepCompatiblePracticalBonuses(), policy)
    await expect(stream.readDepth(base, 1)).rejects.toThrow(/never reads a shape-constrained base/)
    await expect(stream.solve(base)).rejects.toThrow(/never reads a shape-constrained base/)
    expect(() => stream.reachesBeyondExtent(base)).toThrow(/never reads a shape-constrained base/)
    expect(fixture.calls).toEqual([])
    expect(fixture.supportQueries).toEqual([])
  })

  it.each(['keep_only', 'all'] as const)('refuses shapePolicy combined with amendmentPolicy %s', async (amendmentPolicy) => {
    const { stream } = shapeStream({ extent: 4 })
    await expect(stream.readReservedDepth({ ...gogmaBase(keepCompatiblePracticalBonuses(), policy), amendmentPolicy }, 1))
      .rejects.toThrow(/never combines with amendmentPolicy/)
  })

  it.each([
    ['a final position beyond the Gogma window', { kind: 'reset', finalPosition: 14 }, keepCompatiblePracticalBonuses()],
    ['a final position before the stream start', { kind: 'keep', finalPosition: 9 }, keepCompatiblePracticalBonuses()],
    ['a fractional position', { kind: 'reset', finalPosition: 11.5 }, keepCompatiblePracticalBonuses()],
    ['a Reset position not before the final one', { kind: 'reset_then_keep', resetPosition: 12, finalPosition: 12 }, keepCompatiblePracticalBonuses()],
    ['a Keep-only lane from unknown five slots', { kind: 'keep', finalPosition: 12 }, null],
  ] as const)('refuses %s before reading anything', async (_, shapePolicy, bonuses) => {
    const { stream, fixture } = shapeStream({ extent: 4 })
    const base: BonusStreamBase = bonuses === null
      ? { startGogmaCounter: 10, bonuses: null, restorationBonusScope: 'normal_artian', shapePolicy: shapePolicy as BonusShapePolicy }
      : gogmaBase(bonuses, shapePolicy as BonusShapePolicy)
    await expect(stream.readReservedDepth(base, 1)).rejects.toThrow(/Invalid Bonus shapePolicy/)
    expect(fixture.calls).toEqual([])
  })

  it('reads single-pass: a skip ahead, a duplicate, a backward read and a read after the terminal one all throw', async () => {
    const { stream } = shapeStream({ extent: 4 })
    const base = gogmaBase(keepCompatiblePracticalBonuses(), policy)
    await expect(stream.readReservedDepth(base, 2)).rejects.toThrow(/Single-pass violation/)
    const fresh = shapeStream({ extent: 4 })
    await fresh.stream.readReservedDepth(base, 1)
    await expect(fresh.stream.readReservedDepth(base, 1)).rejects.toThrow(/duplicate read/)
    const again = shapeStream({ extent: 4 })
    const reads = await readAll(again.stream, base)
    await expect(again.stream.readReservedDepth(base, reads.length + 1)).rejects.toThrow(/returned exhausted/)
    const backward = shapeStream({ extent: 4 })
    await backward.stream.readReservedDepth(base, 1)
    await backward.stream.readReservedDepth(base, 2)
    await expect(backward.stream.readReservedDepth(base, 1)).rejects.toThrow(/backward read/)
  })

  it('separates the stream key by shape, and keeps a base without one on its Production key', () => {
    const { master } = shapeStream({ extent: 4 })
    const production = gogmaBase(keepCompatiblePracticalBonuses())
    const keys = [
      production,
      gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 12 }),
      gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 13 }),
      gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'reset', finalPosition: 12 }),
      gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 12 }),
      gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'reset_then_keep', resetPosition: 10, finalPosition: 12 }),
    ].map((base) => bonusStreamBaseKey(base, master))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toBe(stableStringify([10, 'all', keepFamilyLayoutKey(keepCompatiblePracticalBonuses(), master)]))
    // One shape over one layout is one stream, whatever the tiers: one single-pass cursor.
    const tiers = keepCompatiblePracticalBonuses().map((bonus) => ({ ...bonus, bonusRankId: 'bonus_rank.fixture.high' })) as RestorationBonusSet
    expect(bonusStreamBaseKey(gogmaBase(tiers, policy), master)).toBe(keys[1])
  })

  it('shares one cursor between two bases of one shape-constrained key', async () => {
    const { stream } = shapeStream({ extent: 4 })
    await stream.readReservedDepth(gogmaBase(keepCompatiblePracticalBonuses(), policy), 1)
    const tiers = keepCompatiblePracticalBonuses().map((bonus) => ({ ...bonus, bonusRankId: 'bonus_rank.fixture.high' })) as RestorationBonusSet
    await expect(stream.readReservedDepth(gogmaBase(tiers, policy), 1)).rejects.toThrow(/duplicate read/)
  })

  it('reports the held-aware depth observation of each shape-constrained depth', async () => {
    const { stream, depthObservations } = shapeStream({ extent: 4, resetIdealAt: at(11) })
    await readAll(stream, gogmaBase(practicalOnlyBonuses(), { kind: 'reset', finalPosition: 11 }))
    expect(depthObservations).toEqual([
      { streamIndex: 0, startGogmaCounter: 10, depth: 1, generatedStates: 1, frontierStates: 1, absolutePositions: 1, familyLayouts: 1 },
      { streamIndex: 0, startGogmaCounter: 10, depth: 2, generatedStates: 1, frontierStates: 1, absolutePositions: 1, familyLayouts: 1 },
    ])
  })
})

describe('G3: the Bonus family-layout frontier (design 3.7 / 7)', () => {
  it('upper variant: the Production stream folds a Keep chain into a same-layout Reset; the Keep-only lane keeps it', async () => {
    // Keep from the source (layout L) to 13; the Reset at 12 also has layout L and stands inside the Keep chain.
    const options: SeamFixtureOptions & { extent: number } = { extent: 4,
      resetAt: (g) => (g === 12 ? keepCompatiblePracticalBonuses() : null), keepResult: (g) => (g === 13 ? 'ideal' : 'practical') }
    const production = shapeStream(options)
    const plain = histories(await readAll(production.stream, gogmaBase(keepCompatiblePracticalBonuses())))
    expect(plain[3]).toContain('R10,R11,R12,K13')
    expect(plain.flat()).not.toContain('K10,K11,K12,K13')
    const shaped = shapeStream(options)
    const keep = histories(await readAll(shaped.stream, gogmaBase(keepCompatiblePracticalBonuses(), { kind: 'keep', finalPosition: 13 })))
    expect(keep[3]).toEqual(['K10,K11,K12,K13'])
  })

  it('lower variant: with q..g1 held, the Production stream folds the shape\'s minimal Reset-then-Keep history into the q one', async () => {
    // q = 10 and g1 = 11 both held, both Resets of layout L; r = 12 is the first position that is not held, g* = 13.
    const options: SeamFixtureOptions & { extent: number; held: number[] } = { extent: 4, held: [10, 11],
      resetAt: (g) => (g === 10 || g === 11 ? keepCompatiblePracticalBonuses() : null), keepResult: (g) => (g === 13 ? 'ideal' : 'practical') }
    const production = shapeStream(options)
    const plain = histories(await readAll(production.stream, gogmaBase(practicalOnlyBonuses())))
    // Minimal own operations (3): the Keep chain from the Reset at 11 is folded into the one from the Reset at 10.
    expect(plain[2]).toContain('R10,K12,K13')
    expect(plain[2]).not.toContain('R11,K12,K13')
    // Observed (not in the design's estimate): one depth deeper the history through the Reset at 11 survives again,
    // behind a skippable Reset at 10 (required positions {11, 13}, one more own operation).
    expect(plain[3]).toContain('R10,R11,K12,K13')
    const shaped = shapeStream(options)
    const reads = histories(await readAll(shaped.stream, gogmaBase(practicalOnlyBonuses(), { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 13 })))
    expect(reads[2]).toContain('R11,K12,K13')
    expect(reads.flat()).not.toContain('R10,K12,K13')
  })
})
