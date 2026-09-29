import { afterEach, describe, expect, it, vi } from 'vitest'
import preD2D from '../../test/fixtures/reservedBonusStreamPreD2D.json'
import {
  recordReservedBonusStreamCase,
  reservedBonusStreamBase,
  reservedBonusStreamCases,
  reservedBonusStreamOf,
  type ReservedBonusStreamRecord,
} from '../../test/fixtures/reservedBonusStreamSinglePass'
import bonusStreamSource from './bonusStream.ts?raw'
import { bonusStreamBaseKey, type BonusStreamBase } from './bonusStream'

/*
 * Global Planner Research Phase 2-C2.5-D2-d (Issue #154,
 * `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2D.md`): the held-aware
 * Bonus stream keeps no raw solution of a depth it already returned, and its
 * `readReservedDepth()` is single-pass per `bonusStreamBaseKey()`
 * (`docs/SEARCH_SPEC.md` 5.6.8). A read the Production consumer never makes
 * fails closed; it never returns `[]` and never regenerates a past depth.
 */

afterEach(() => vi.restoreAllMocks())

const byName = (name: string) => {
  const found = reservedBonusStreamCases.find((testCase) => testCase.name === name)
  if (!found) throw new Error(`No case ${name}.`)
  return found
}
const contiguous = byName('contiguous gogma base, extent cut')
const held = byName('held and blocked positions')

describe('sequential single-pass reads', () => {
  const records = (preD2D as unknown as { records: ReservedBonusStreamRecord[] }).records

  it('covers every case exactly once, in case order, and is not vacuous', () => {
    expect(records.map((record) => record.name)).toEqual(reservedBonusStreamCases.map((testCase) => testCase.name))
    expect(records.filter((record) => record.reads.length > 2).length).toBeGreaterThan(3)
    expect(records.some((record) => record.reachesBeyondExtent)).toBe(true)
    expect(records.some((record) => !record.reachesBeyondExtent && record.reads[0].solutions.length > 0)).toBe(true)
    expect(records.some((record) => record.reads.at(-1)!.unsupportedPredictions.length > 0)).toBe(true)
    // Held positions give non-contiguous absolute steps.
    expect(records.some((record) => record.reads.some((read) => read.solutions.some((solution) =>
      solution.steps.some((step, index) => index > 0 && step.gogmaCounterBefore !== solution.steps[index - 1].gogmaCounterAfter))))).toBe(true)
  })

  it.each(reservedBonusStreamCases.map((testCase, index) => [testCase.name, index] as const))(
    '%s: the same raw solutions, order, steps, history, notices, exhaustion, extent and predictions as the pre-D2-d stream',
    async (_, index) => {
      expect(await recordReservedBonusStreamCase(reservedBonusStreamCases[index])).toEqual(records[index])
    },
  )

  it('returns the operation types of the canonical (depth, lastResetDepth) rule at their absolute positions', async () => {
    const { stream, base } = reservedBonusStreamOf(held)
    for (let depth = 1; ; depth += 1) {
      const read = await stream.readReservedDepth(base, depth)
      for (const solution of read.solutions) {
        expect(solution.depth).toBe(depth)
        expect(solution.steps).toHaveLength(depth)
        // The history chain is the steps, newest first.
        const chain: number[] = []
        for (let node = solution.results as unknown as { step: { gogmaCounterBefore: number }; previous: unknown } | null; node; node = node.previous as typeof node) {
          chain.unshift(node.step.gogmaCounterBefore)
        }
        expect(chain).toEqual(solution.steps.map((step) => step.gogmaCounterBefore))
        // Blocked position 12 is never used; every step is inside the window.
        expect(solution.steps.every((step) => step.gogmaCounterBefore !== 12 && step.gogmaCounterBefore < 15)).toBe(true)
      }
      if (read.exhausted) break
    }
  })
})

describe('fail-closed consumption', () => {
  const violation = /Single-pass violation/

  it('rejects a duplicate read of the same depth', async () => {
    const { stream, base } = reservedBonusStreamOf(contiguous)
    await stream.readReservedDepth(base, 1)
    await expect(stream.readReservedDepth(base, 1)).rejects.toThrow(/expects depth 2, got 1 \(a duplicate read\)/)
  })

  it('rejects a skip ahead', async () => {
    const { stream, base } = reservedBonusStreamOf(contiguous)
    await stream.readReservedDepth(base, 1)
    await expect(stream.readReservedDepth(base, 3)).rejects.toThrow(/expects depth 2, got 3 \(a skip ahead\)/)
  })

  it('rejects a backward read', async () => {
    const { stream, base } = reservedBonusStreamOf(contiguous)
    await stream.readReservedDepth(base, 1)
    await stream.readReservedDepth(base, 2)
    await expect(stream.readReservedDepth(base, 1)).rejects.toThrow(/expects depth 3, got 1 \(a backward read\)/)
  })

  it('rejects a first read other than depth 1', async () => {
    for (const depth of [0, 2, 1.5]) {
      const { stream, base } = reservedBonusStreamOf(contiguous)
      await expect(stream.readReservedDepth(base, depth)).rejects.toThrow(/expects depth 1/)
    }
  })

  it('rejects a read after the terminal read, and still answers reservedReachesBeyondExtent without predicting', async () => {
    const { stream, base, calls } = reservedBonusStreamOf(contiguous)
    let depth = 1
    while (!(await stream.readReservedDepth(base, depth)).exhausted) depth += 1
    const predicted = calls.length
    expect(stream.reservedReachesBeyondExtent(base)).toBe(true)
    await expect(stream.readReservedDepth(base, depth + 1)).rejects.toThrow(/returned exhausted at depth 4/)
    await expect(stream.readReservedDepth(base, depth)).rejects.toThrow(violation)
    expect(stream.reservedReachesBeyondExtent(base)).toBe(true)
    expect(calls.length).toBe(predicted)
  })

  it('accepts an empty terminal first read and rejects the next depth', async () => {
    for (const name of ['no Base Seed', 'natural end: blind base, reset unsupported', 'every window position blocked']) {
      const { stream, base } = reservedBonusStreamOf(byName(name))
      const read = await stream.readReservedDepth(base, 1)
      expect(read).toMatchObject({ solutions: [], exhausted: true })
      await expect(stream.readReservedDepth(base, 2)).rejects.toThrow(/returned exhausted at depth 1/)
    }
  })

  it('rejects a read while another read of the same stream is in flight', async () => {
    const { stream, base } = reservedBonusStreamOf(contiguous)
    const first = stream.readReservedDepth(base, 1)
    await expect(stream.readReservedDepth(base, 2)).rejects.toThrow(/already reading depth 1/)
    await expect(first).resolves.toMatchObject({ exhausted: false })
    await expect(stream.readReservedDepth(base, 2)).resolves.toMatchObject({ exhausted: false })
  })

  it('rejects every read after a failed read, never retrying the depth', async () => {
    const { stream, base, fixture } = reservedBonusStreamOf(contiguous)
    await stream.readReservedDepth(base, 1)
    vi.mocked(fixture.engine.predictGogmaBonus).mockImplementationOnce(() => { throw new Error('engine failure') })
    await expect(stream.readReservedDepth(base, 2)).rejects.toThrow('engine failure')
    await expect(stream.readReservedDepth(base, 2)).rejects.toThrow(/failed an earlier read/)
    await expect(stream.readReservedDepth(base, 3)).rejects.toThrow(/failed an earlier read/)
  })
})

describe('stream identity', () => {
  it('reads streams of different keys independently, each from depth 1, interleaved or alone', async () => {
    const other: BonusStreamBase = { ...reservedBonusStreamBase('gogma_practical'), startGogmaCounter: 11 }
    const { stream, base, fixture } = reservedBonusStreamOf(held)
    expect(bonusStreamBaseKey(other, fixture.input.master)).not.toBe(bonusStreamBaseKey(base, fixture.input.master))
    const interleaved = { first: [] as unknown[], second: [] as unknown[] }
    for (let depth = 1, done = [false, false]; !done[0] || !done[1]; depth += 1) {
      if (!done[0]) {
        const read = await stream.readReservedDepth(base, depth)
        interleaved.first.push(read.solutions)
        done[0] = read.exhausted
      }
      if (!done[1]) {
        const read = await stream.readReservedDepth(other, depth)
        interleaved.second.push(read.solutions)
        done[1] = read.exhausted
      }
    }
    const alone = async (streamBase: BonusStreamBase) => {
      const fresh = reservedBonusStreamOf(held)
      const out: unknown[] = []
      for (let depth = 1; ; depth += 1) {
        const read = await fresh.stream.readReservedDepth(streamBase, depth)
        out.push(read.solutions)
        if (read.exhausted) return out
      }
    }
    expect(interleaved.first).toEqual(await alone(base))
    expect(interleaved.second).toEqual(await alone(other))
  })

  it('treats two base objects with one bonusStreamBaseKey as one cursor, the identity the scheduler channel uses', async () => {
    const { stream, base, fixture } = reservedBonusStreamOf(contiguous)
    // Another object, another scope, the same key: start, policy and family layout.
    const same: BonusStreamBase = reservedBonusStreamBase('normal_known')
    expect(same).not.toBe(base)
    expect(bonusStreamBaseKey(same, fixture.input.master)).toBe(bonusStreamBaseKey(base, fixture.input.master))
    const first = await stream.readReservedDepth(base, 1)
    await expect(stream.readReservedDepth(same, 1)).rejects.toThrow(/expects depth 2, got 1 \(a duplicate read\)/)
    const second = await stream.readReservedDepth(same, 2)
    expect(second.solutions.every((solution) => solution.depth === 2)).toBe(true)
    expect(first.solutions.every((solution) => solution.depth === 1)).toBe(true)
  })
})

describe('no past-depth raw solution retention (structural audit)', () => {
  it('the held-aware stream state holds no raw solution collection', () => {
    const set = /interface ReservedSet \{([\s\S]*?)\n {2}\}/.exec(bonusStreamSource)
    expect(set).not.toBeNull()
    expect(set![1]).not.toMatch(/ReservedBonusStreamSolution/)
    expect(set![1]).not.toMatch(/\bdepths\b/)
    const read = /readReservedDepth: async \(base, depth\) => \{([\s\S]*?)\n {4}\},/.exec(bonusStreamSource)
    expect(read).not.toBeNull()
    expect(read![1]).not.toMatch(/depths/)
    // The ordinary `readDepth()` / `solve()` cache is outside this change and keeps its depths.
    expect(bonusStreamSource).toMatch(/solutions: cached\.depths\[depth - 1\]/)
  })
})
