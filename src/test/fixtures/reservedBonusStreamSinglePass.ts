import type { RestorationBonusSet } from '../../domain/models/publicTypes'
import {
  createTargetBonusStream,
  type BonusStreamBase,
  type ReservedBonusStreamSolution,
} from '../../domain/search/bonusStream'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from '../../domain/search/counterReservation'
import { createSearchPredictionSupport } from '../../domain/search/searchPredictionSupport'
import { createSearchExecutionContext } from '../../domain/search/searchExecution'
import { frontierFixture, keepCompatiblePracticalBonuses, type FrontierFixtureOptions } from './plannerAlternativeFrontier'

/*
 * Global Planner Research Phase 2-C2.5-D2-d (Issue #154): the held-aware Bonus
 * stream `readReservedDepth()` read single-pass, depth 1, 2, 3, ... up to its
 * terminal read, exactly as `TargetSearchScheduler.bonusChannel` reads it.
 *
 * `recordReservedBonusStreamCase()` reduces one such pass to what a read hands
 * the consumer: every raw solution of every depth in order (depth,
 * lastResetDepth, five slots, scope, the absolute steps and the whole result
 * history chain), the unsupported notices, `exhausted`, then
 * `reservedReachesBeyondExtent()` and the prediction calls.
 *
 * The expected records were produced ONCE by this very function on the
 * pre-D2-d stream (main 1c87b02, which kept every past depth in `set.depths`)
 * and are frozen in `reservedBonusStreamPreD2D.json`. A test never regenerates
 * them.
 *
 * Issue #154 (before B2J): the frontier fixture's fake Keep used to change the
 * slot families (a Keep of the Practical-only slots yielded the Ideal, a Keep of
 * the Ideal yielded the Practical-only slots), which RNG_SPEC 6.1 forbids. The
 * fake Keep now keeps the family layout and rerolls the tiers only, and the
 * Practical bases below are `keepCompatiblePracticalBonuses()` (the Ideal family
 * layout) so a Keep can still reach the Ideal. The former `current` Keep (the
 * current tiers returned unchanged) read the current ranks, so those cases use
 * the rank-independent `low` tier instead. The frozen records were
 * re-recorded ONCE by this function with that contract-valid fixture on the
 * same historical stream (main 1c87b02, through a temporary worktree), not on
 * the current implementation; see the JSON `provenance`.
 */

export interface ReservedBonusStreamCase {
  name: string
  options: FrontierFixtureOptions
  extent: number
  held?: number[]
  blocked?: number[]
  /**
   * The Route base: an owned Gogma-scope Practical base, a blind Normal, or a
   * known Normal-scope one. The Practical five slots are
   * `keepCompatiblePracticalBonuses()`, so a Keep of the base may reach the Ideal.
   */
  base: 'gogma_practical' | 'blind' | 'normal_known' | 'normal_known_keep_only'
  /** Drop the Base Seed, so the stream is terminal before depth 1. */
  noSeed?: boolean
}

const at = (...positions: number[]) => (counter: number) => positions.includes(counter)

export const reservedBonusStreamCases: ReservedBonusStreamCase[] = [
  { name: 'contiguous gogma base, extent cut', extent: 4, base: 'gogma_practical',
    options: { resetIdealAt: at(11), keepResult: (gogma) => (gogma === 12 ? 'ideal' : 'practical') } },
  { name: 'held and blocked positions', extent: 5, held: [11, 12, 13], blocked: [12], base: 'gogma_practical',
    options: { resetIdealAt: at(10, 13), keepResult: (gogma) => (gogma === 13 ? 'ideal' : gogma === 11 ? 'low' : 'practical') } },
  { name: 'blind base over held positions', extent: 4, held: [10, 11], base: 'blind',
    options: { resetIdealAt: at(12), keepResult: (gogma) => (gogma === 13 ? 'ideal' : 'low') } },
  { name: 'known normal base, keep only, held', extent: 4, held: [11], base: 'normal_known_keep_only',
    options: { keepResult: (gogma) => (gogma === 12 ? 'ideal' : 'low') } },
  { name: 'known normal base, full policy', extent: 3, held: [12], blocked: [12], base: 'normal_known',
    options: { resetIdealAt: at(10) } },
  { name: 'reset unsupported', extent: 4, base: 'gogma_practical',
    options: { resetSupported: false, keepResult: (gogma) => (gogma === 12 ? 'ideal' : 'low') } },
  { name: 'keep unsupported', extent: 3, held: [11], base: 'gogma_practical',
    options: { keepSupportedFor: () => false, resetIdealAt: at(12) } },
  { name: 'natural end: blind base, reset unsupported', extent: 4, base: 'blind', options: { resetSupported: false } },
  { name: 'every window position blocked', extent: 3, held: [10, 11, 12], blocked: [10, 11, 12], base: 'gogma_practical', options: {} },
  { name: 'empty terminal depth after a non-empty one', extent: 3, base: 'gogma_practical',
    options: { resetSupported: false, keepResult: () => 'ideal',
      keepSupportedFor: (current) => JSON.stringify(current) === JSON.stringify(keepCompatiblePracticalBonuses()) } },
  { name: 'no Base Seed', extent: 4, base: 'gogma_practical', noSeed: true, options: {} },
]

type StreamFactory = typeof createTargetBonusStream

export function reservedBonusStreamBase(kind: ReservedBonusStreamCase['base']): BonusStreamBase {
  switch (kind) {
    case 'gogma_practical':
      return { startGogmaCounter: 10, bonuses: keepCompatiblePracticalBonuses(), restorationBonusScope: 'gogma_artian' }
    case 'blind':
      return { startGogmaCounter: 10, bonuses: null, restorationBonusScope: 'normal_artian' }
    case 'normal_known':
      return { startGogmaCounter: 10, bonuses: keepCompatiblePracticalBonuses(), restorationBonusScope: 'normal_artian' }
    case 'normal_known_keep_only':
      return { startGogmaCounter: 10, bonuses: keepCompatiblePracticalBonuses(), restorationBonusScope: 'normal_artian', amendmentPolicy: 'keep_only' }
  }
}

/** The real held-aware Bonus stream of one case, plus its base and the fixture's prediction call log. */
export function reservedBonusStreamOf(testCase: ReservedBonusStreamCase, factory: StreamFactory = createTargetBonusStream) {
  const fixture = frontierFixture({ ...testCase.options, extent: testCase.extent })
  const target = fixture.input.targetWeapons[0]
  const rngState = testCase.noSeed
    ? { ...fixture.input.rngState, baseSeed: { ...fixture.input.rngState.baseSeed, value: null, isConfirmed: false } }
    : fixture.input.rngState
  const reservation = testCase.held === undefined ? EMPTY_COUNTER_RESERVATION : createCounterReservation(testCase.held, testCase.blocked ?? [])
  const stream = factory(
    target,
    { rngState, master: fixture.input.master, maxGogmaAdvance: testCase.extent, reservation },
    fixture.engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(fixture.engine, target, fixture.input.master),
  )
  return { stream, base: reservedBonusStreamBase(testCase.base), calls: fixture.calls, fixture }
}

function history(solution: ReservedBonusStreamSolution) {
  const chain: Array<{ depth: number; bonuses: RestorationBonusSet; scope: string; step: unknown }> = []
  for (let node = solution.results as (typeof solution.results & { step?: unknown }) | null; node !== null; node = node.previous as typeof node) {
    chain.push({ depth: node.depth, bonuses: node.result.restorationBonuses, scope: node.result.restorationBonusScope, step: node.step })
  }
  return chain
}

export function projectReservedBonusSolution(solution: ReservedBonusStreamSolution) {
  return {
    depth: solution.depth,
    lastResetDepth: solution.lastResetDepth,
    bonuses: solution.bonuses,
    restorationBonusScope: solution.restorationBonusScope,
    steps: solution.steps,
    history: history(solution),
  }
}

export interface ReservedBonusStreamRecord {
  name: string
  reads: Array<{
    depth: number
    solutions: ReturnType<typeof projectReservedBonusSolution>[]
    unsupportedPredictions: unknown[]
    exhausted: boolean
  }>
  reachesBeyondExtent: boolean
  calls: string[]
}

/** One single-pass read of the whole stream, depth 1 up to the terminal read. */
export async function recordReservedBonusStreamCase(testCase: ReservedBonusStreamCase, factory: StreamFactory = createTargetBonusStream): Promise<ReservedBonusStreamRecord> {
  const { stream, base, calls } = reservedBonusStreamOf(testCase, factory)
  const reads: ReservedBonusStreamRecord['reads'] = []
  for (let depth = 1; ; depth += 1) {
    const read = await stream.readReservedDepth(base, depth)
    reads.push({ depth, solutions: read.solutions.map(projectReservedBonusSolution), unsupportedPredictions: [...read.unsupportedPredictions], exhausted: read.exhausted })
    if (read.exhausted) break
    if (depth > 64) throw new Error(`${testCase.name}: the stream never became exhausted.`)
  }
  return { name: testCase.name, reads, reachesBeyondExtent: stream.reservedReachesBeyondExtent(base), calls: [...calls] }
}
