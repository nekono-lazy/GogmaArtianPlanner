import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RestorationBonus, RestorationBonusSet } from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import { keepFamilyLayoutKey, keepFamilyOfBonus } from '../rng/gogmaBonusFamily'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import { practicalOnlyBonuses } from '../../test/fixtures/candidateSearch'
import { frontierFixture, keepContractGuard } from '../../test/fixtures/plannerAlternativeFrontier'
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
/** Layout A = attack / attack / element / utility / utility (the base layout, `practicalOnlyBonuses()`). */
const layoutA = (firstAttack: string) => set(restorationBonus(ATTACK, firstAttack), restorationBonus(ATTACK, HIGH), restorationBonus(ELEMENT, MIDDLE),
  restorationBonus(UTILITY, LOW), restorationBonus(UTILITY, LOW))
/** Layout S = sharpness x 5 (only ever a Reset result). */
const layoutS = (rank: string) => set(...Array.from({ length: 5 }, () => restorationBonus(SHARPNESS, rank)))

/**
 * Gogma 10, extent 4 (positions 10 .. 13), positions 10 and 11 held: a depth-1 Reset may stand at 10, 11 or 12, so the
 * depth-1 Resets at 10 and 11 (both lastResetDepth 1, both layout A with different tiers) both reach Gogma 12 at depth 2.
 *
 * The fake Keep obeys RNG_SPEC 6.1 (checked by `keepContractGuard()`): it keeps the family layout and reads the current
 * slots only through it, so the Keep at Gogma 12 of every layout A state is `keepAt12` (a layout A tier reroll), and
 * every other Keep rerolls the current families to their low tier. Before Issue #154 B2J this fixture let a Keep of
 * layout B yield layout A to build a tie of two different five slots; a Keep can never change families, so it no
 * longer does. With a contract-valid Keep, two states of one (position, family layout, lastResetDepth) are Keeps of one
 * memoized (Gogma Counter, family layout) prediction and hold the same five slots, so through the real stream the stable
 * serialization tie-break only ever compares equal texts.
 */
function tieFixture(keepAt12: RestorationBonusSet, resetAt12: RestorationBonusSet) {
  const fixture = frontierFixture({ extent: 4 })
  const master = fixture.input.master
  const guardKeep = keepContractGuard(master)
  const objects = new Map<string, RestorationBonusSet>()
  // One object per distinct prediction, as the real memos hand out (the stream must not depend on that either).
  const once = (key: string, make: () => RestorationBonusSet) => {
    if (!objects.has(key)) objects.set(key, make())
    return objects.get(key) as RestorationBonusSet
  }
  const layoutAKey = keepFamilyLayoutKey(layoutA(LOW), master)
  vi.mocked(fixture.engine.predictGogmaBonus).mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      if (gogmaCounter === 10) return once('reset:10', () => layoutA(MIDDLE))
      if (gogmaCounter === 11) return once('reset:11', () => layoutA(LOW))
      if (gogmaCounter === 12) return once('reset:12', () => resetAt12)
      return once(`reset:${gogmaCounter}`, () => layoutS(LOW))
    }
    const layout = keepFamilyLayoutKey(operation.currentBonuses, master)
    const result = gogmaCounter === 12 && layout === layoutAKey
      ? once('keep:12:A', () => keepAt12)
      : once(`keep:${gogmaCounter}:${layout}`, () => operation.currentBonuses.map((bonus) =>
        restorationBonus(keepFamilyOfBonus(bonus, master), LOW)) as RestorationBonusSet)
    return guardKeep(gogmaCounter, operation.currentBonuses, result)
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
async function readTie(keepAt12: RestorationBonusSet, resetAt12: RestorationBonusSet) {
  const { stream, base, master } = tieFixture(keepAt12, resetAt12)
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
  const keepAt12 = layoutA(HIGH)

  it('a larger lastResetDepth wins before the stable serialization is read', async () => {
    // The depth-2 Reset at Gogma 12 has layout A too (lastResetDepth 2), with a larger serialization than the Keeps.
    const resetAt12 = layoutA(MIDDLE)
    expect(compareStableKeys(stableStringify(resetAt12), stableStringify(keepAt12))).toBeGreaterThan(0)
    const { depth2AtTieKey, parentsThrough12, checkedParents } = await readTie(keepAt12, resetAt12)
    expect(checkedParents).toBeGreaterThan(0)
    // The Keeps of the depth-1 Resets at 10 and 11 (lastResetDepth 1) and the depth-2 Reset (lastResetDepth 2).
    expect(depth2AtTieKey.map((solution) => solution.lastResetDepth).sort()).toEqual([1, 1, 2])
    const reset = depth2AtTieKey.find((solution) => solution.lastResetDepth === 2) as ReservedBonusStreamSolution
    expect(reset.bonuses).toBe(resetAt12)
    expect([...parentsThrough12]).toEqual([reset.results])
  })

  it('same position, same layout, same lastResetDepth: one state is extended, and the tie holds the same five slots', async () => {
    // No Reset of layout A at Gogma 12: the Keeps of the two depth-1 Resets tie on lastResetDepth 1.
    const { depth2AtTieKey, parentsThrough12, checkedParents } = await readTie(keepAt12, layoutS(MIDDLE))
    expect(checkedParents).toBeGreaterThan(0)
    const tied = depth2AtTieKey.filter((solution) => solution.lastResetDepth === 1)
    // Both tied states are published as raw solutions before the reduction, from two different parents.
    expect(tied).toHaveLength(2)
    expect(tied[0].results.previous).not.toBe(tied[1].results.previous)
    // A Keep reads its current slots only through their family layout (RNG_SPEC 6.1), so both tied states hold the
    // one Keep prediction of (Gogma 12, layout A): the stable serialization tie-break compares equal texts.
    expect(tied.map((solution) => solution.bonuses)).toEqual([keepAt12, keepAt12])
    expect(tied[0].bonuses).toBe(tied[1].bonuses)
    // Exactly one of them is the representative extended at depth 3.
    const extended = tied.filter((solution) => parentsThrough12.has(solution.results))
    expect(extended).toHaveLength(1)
    expect([...parentsThrough12]).toEqual([extended[0].results])
  })
})
