import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RestorationBonus, RestorationBonusSet } from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import { keepFamilyLayoutKey } from '../rng/gogmaBonusFamily'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import { practicalOnlyBonuses } from '../../test/fixtures/candidateSearch'
import { frontierFixture } from '../../test/fixtures/plannerAlternativeFrontier'
import { reservedBonusStreamCases, reservedBonusStreamOf } from '../../test/fixtures/reservedBonusStreamSinglePass'
import { createTargetBonusStream, type BonusStreamBase, type ReservedBonusStreamSolution } from './bonusStream'
import { createCounterReservation } from './counterReservation'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport } from './searchPredictionSupport'
import { compareStableKeys } from './semanticKeys'

/*
 * Issue #154 Phase 2-C2.6-A9: the held-aware representative rule is unchanged by
 * the lazy per-object cache of `stableStringify(bonuses)` inside
 * `compareReservedRepresentative()`. Per (absolute position after the last own
 * amendment, Keep family layout) the frontier keeps the state with the largest
 * `lastResetDepth`, and on a tie the one whose ordered five slots have the
 * smaller `stableStringify()` text (`compareStableKeys`). Never a multiset key.
 *
 * The representative is observed only through the real stream: every state of
 * depth d + 1 extends a frontier state of depth d, and its result history node
 * `previous` is that frontier state's own node, so the parents of depth d + 1
 * are exactly the surviving representatives.
 */

afterEach(() => vi.restoreAllMocks())

type Node = ReservedBonusStreamSolution['results']

const positionOf = (solution: ReservedBonusStreamSolution) => solution.steps[solution.steps.length - 1].gogmaCounterBefore

/** The representative of every (position, family layout) key of one depth, by the documented rule. */
function expectedRepresentatives(solutions: readonly ReservedBonusStreamSolution[], master: Parameters<typeof keepFamilyLayoutKey>[1]) {
  const byKey = new Map<string, ReservedBonusStreamSolution>()
  for (const solution of solutions) {
    const key = `${positionOf(solution)}\u0000${keepFamilyLayoutKey(solution.bonuses, master)}`
    const current = byKey.get(key)
    const better = current === undefined || (solution.lastResetDepth - current.lastResetDepth ||
      -compareStableKeys(stableStringify(solution.bonuses), stableStringify(current.bonuses))) > 0
    if (better) byKey.set(key, solution)
  }
  return byKey
}

/** Reads one stream single-pass and checks every depth's parents against the documented representatives. */
async function checkRepresentativeRule(
  stream: ReturnType<typeof createTargetBonusStream>,
  base: BonusStreamBase,
  master: Parameters<typeof keepFamilyLayoutKey>[1],
) {
  const depths: ReservedBonusStreamSolution[][] = []
  let checkedParents = 0
  for (let depth = 1; ; depth += 1) {
    const read = await stream.readReservedDepth(base, depth)
    depths.push(read.solutions)
    if (depth > 1) {
      const representatives = new Set<Node>([...expectedRepresentatives(depths[depth - 2], master).values()].map((solution) => solution.results))
      const published = new Set<Node>(depths[depth - 2].map((solution) => solution.results))
      for (const solution of read.solutions) {
        const parent = solution.results.previous
        // A parent is a node of the previous depth (never an older one), and only a representative.
        expect(published.has(parent as Node)).toBe(true)
        expect(representatives.has(parent as Node)).toBe(true)
        checkedParents += 1
      }
    }
    if (read.exhausted) break
    if (depth > 64) throw new Error('the stream never became exhausted')
  }
  return { depths, checkedParents }
}

describe('held-aware representative rule (reservation and no reservation)', () => {
  it.each(reservedBonusStreamCases.map((testCase) => [testCase.name, testCase] as const))(
    '%s: every parent of the next depth is the documented representative of its (position, family layout)',
    async (_, testCase) => {
      const { stream, base, fixture } = reservedBonusStreamOf(testCase)
      await checkRepresentativeRule(stream, base, fixture.input.master)
    },
  )
})

// ------------------------------------------------------------------ explicit tie-break fixtures

const ATTACK = 'bonus_type.fixture.attack'
const ELEMENT = 'bonus_type.fixture.element'
const UTILITY = 'bonus_type.fixture.utility'
const SHARPNESS = 'bonus_type.fixture.sharpness'
const LOW = 'bonus_rank.fixture.low'
const MIDDLE = 'bonus_rank.fixture.middle'
const HIGH = 'bonus_rank.fixture.high'

const set = (...bonuses: RestorationBonus[]): RestorationBonusSet => restorationBonusSet(...(bonuses as [RestorationBonus, RestorationBonus, RestorationBonus, RestorationBonus, RestorationBonus]))
/** Layout A = attack / attack / element / utility / utility (the base layout). */
const layoutA = (firstAttack: string) => set(restorationBonus(ATTACK, firstAttack), restorationBonus(ATTACK, HIGH), restorationBonus(ELEMENT, MIDDLE),
  restorationBonus(UTILITY, LOW), restorationBonus(UTILITY, LOW))
/** Layout B = element / attack / attack / utility / utility. */
const layoutB = () => set(restorationBonus(ELEMENT, MIDDLE), restorationBonus(ATTACK, HIGH), restorationBonus(ATTACK, HIGH),
  restorationBonus(UTILITY, LOW), restorationBonus(UTILITY, LOW))
/** Layout S = sharpness x 5 (only ever a Reset result). */
const layoutS = (rank: string) => set(...Array.from({ length: 5 }, () => restorationBonus(SHARPNESS, rank)))
/** Layout U = utility x 5 (a Keep result no other state shares). */
const layoutU = () => set(...Array.from({ length: 5 }, () => restorationBonus(UTILITY, LOW)))

/**
 * Gogma 10, extent 4 (positions 10 .. 13), positions 10 and 11 held: a depth-1 Reset may stand at 10, 11 or 12, so two
 * depth-1 Resets (at 10 and 11, both lastResetDepth 1, different layouts) both reach Gogma 12 at depth 2, where their
 * Keeps yield the same layout A with different tiers: a lastResetDepth tie the stable serialization breaks.
 */
function tieFixture(keepAt12FromA: RestorationBonusSet, keepAt12FromB: RestorationBonusSet, resetAt12: RestorationBonusSet) {
  const fixture = frontierFixture({ extent: 4 })
  const master = fixture.input.master
  const objects = new Map<string, RestorationBonusSet>()
  // One object per distinct prediction, as the real memos hand out (the stream must not depend on that either).
  const once = (key: string, make: () => RestorationBonusSet) => {
    if (!objects.has(key)) objects.set(key, make())
    return objects.get(key) as RestorationBonusSet
  }
  vi.mocked(fixture.engine.predictGogmaBonus).mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      if (gogmaCounter === 10) return once('reset:10', () => layoutA(MIDDLE))
      if (gogmaCounter === 11) return once('reset:11', layoutB)
      if (gogmaCounter === 12) return once('reset:12', () => resetAt12)
      return once(`reset:${gogmaCounter}`, () => layoutS(LOW))
    }
    const layout = keepFamilyLayoutKey(operation.currentBonuses, master)
    if (gogmaCounter === 12 && layout === keepFamilyLayoutKey(layoutA(LOW), master)) return once('keep:12:A', () => keepAt12FromA)
    if (gogmaCounter === 12 && layout === keepFamilyLayoutKey(layoutB(), master)) return once('keep:12:B', () => keepAt12FromB)
    return once(`keep:${gogmaCounter}:${layout}`, layoutU)
  })
  const target = fixture.input.targetWeapons[0]
  const stream = createTargetBonusStream(
    target,
    { rngState: fixture.input.rngState, master, maxGogmaAdvance: 4, reservation: createCounterReservation([10, 11], []) },
    fixture.engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(fixture.engine, target, master),
  )
  const base: BonusStreamBase = { startGogmaCounter: 10, bonuses: practicalOnlyBonuses(), restorationBonusScope: 'gogma_artian' }
  return { stream, base, master }
}

/** The depth-2 states at Gogma 12 of layout A, and the depth-3 histories through Gogma 12. */
async function readTie(keepAt12FromA: RestorationBonusSet, keepAt12FromB: RestorationBonusSet, resetAt12: RestorationBonusSet) {
  const { stream, base, master } = tieFixture(keepAt12FromA, keepAt12FromB, resetAt12)
  const { depths, checkedParents } = await checkRepresentativeRule(stream, base, master)
  const layoutAKey = keepFamilyLayoutKey(layoutA(LOW), master)
  const depth2AtTieKey = depths[1].filter((solution) => positionOf(solution) === 12 && keepFamilyLayoutKey(solution.bonuses, master) === layoutAKey)
  // Depth-3 parents that are the depth-2 states of the tie key (Gogma 12, layout A).
  const depth3Through12 = depths[2].filter((solution) => solution.steps[1].gogmaCounterBefore === 12)
  const parentsThrough12 = new Set(depth3Through12.map((solution) => solution.results.previous)
    .filter((node) => node !== null && keepFamilyLayoutKey(node.result.restorationBonuses as RestorationBonusSet, master) === layoutAKey))
  return { depth2AtTieKey, parentsThrough12, checkedParents }
}

describe('held-aware representative tie-break through the real stream', () => {
  const low = layoutA(LOW), high = layoutA(HIGH)
  // stableStringify orders the rank id first: "bonus_rank.fixture.high" < "bonus_rank.fixture.low".
  it('the fixture tiers really order by the stable serialization', () => {
    expect(compareStableKeys(stableStringify(high), stableStringify(low))).toBeLessThan(0)
  })

  it.each([
    ['the later generated state', low, high, high],
    ['the earlier generated state', high, low, high],
  ] as const)('same position, same layout, same lastResetDepth: the smaller stable serialization wins (%s)', async (_, fromA, fromB, winner) => {
    const { depth2AtTieKey, parentsThrough12, checkedParents } = await readTie(fromA, fromB, layoutS(MIDDLE))
    expect(checkedParents).toBeGreaterThan(0)
    // Both tied states are published as raw solutions before the reduction.
    expect(depth2AtTieKey).toHaveLength(2)
    expect(depth2AtTieKey.map((solution) => solution.lastResetDepth)).toEqual([1, 1])
    expect(depth2AtTieKey.map((solution) => solution.bonuses)).toEqual([fromA, fromB])
    // Only the winner is extended at depth 3.
    const representative = depth2AtTieKey.find((solution) => solution.bonuses === winner) as ReservedBonusStreamSolution
    const loser = depth2AtTieKey.find((solution) => solution !== representative) as ReservedBonusStreamSolution
    expect(parentsThrough12.has(representative.results)).toBe(true)
    expect(parentsThrough12.has(loser.results)).toBe(false)
  })

  it('a larger lastResetDepth wins before the stable serialization is read', async () => {
    // The depth-2 Reset at Gogma 12 has layout A too (lastResetDepth 2), with the largest serialization of the three.
    const resetAt12 = layoutA(MIDDLE)
    expect(compareStableKeys(stableStringify(resetAt12), stableStringify(high))).toBeGreaterThan(0)
    expect(compareStableKeys(stableStringify(resetAt12), stableStringify(low))).toBeGreaterThan(0)
    const { depth2AtTieKey, parentsThrough12 } = await readTie(low, high, resetAt12)
    expect(depth2AtTieKey.map((solution) => solution.lastResetDepth).sort()).toEqual([1, 1, 2])
    const reset = depth2AtTieKey.find((solution) => solution.lastResetDepth === 2) as ReservedBonusStreamSolution
    expect([...parentsThrough12]).toEqual([reset.results])
  })
})
