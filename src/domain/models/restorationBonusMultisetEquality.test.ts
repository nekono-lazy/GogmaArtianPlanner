import { describe, expect, it } from 'vitest'
import { MasterDataDomainError } from '../master/masterSelectors'
import { satisfiesIdealBonuses } from '../target/targetEvaluator'
import { createValidTargetWeapon } from '../../test/fixtures/domainData'
import { targetEvaluationMaster } from '../../test/fixtures/targetEvaluation'
import type { RestorationBonus, RestorationBonusSet } from './common'
import { areRestorationBonusSetsEqual, areRestorationBonusSlotsEqual } from './domainRules'

/**
 * Test-only reference: the implementation `areRestorationBonusSetsEqual()` had
 * before Issue #154 Phase 2-C2.6-A6 (a JSON `[bonusTypeId, bonusRankId]` key and
 * a `Map` count per side). The Production helper must agree with it on every
 * input; it is kept here only as the semantic oracle.
 */
function referenceMultisetEqual(left: RestorationBonusSet, right: RestorationBonusSet): boolean {
  const count = (bonuses: RestorationBonusSet) => {
    const counts = new Map<string, number>()
    bonuses.forEach((bonus) => {
      const key = JSON.stringify([bonus.bonusTypeId, bonus.bonusRankId])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return counts
  }
  const leftCounts = count(left)
  const rightCounts = count(right)
  if (leftCounts.size !== rightCounts.size) return false
  return [...leftCounts].every(([key, value]) => rightCounts.get(key) === value)
}

const bonus = (bonusTypeId: string, bonusRankId: string): RestorationBonus => ({ bonusTypeId, bonusRankId })
const set = (...bonuses: RestorationBonus[]): RestorationBonusSet => bonuses as RestorationBonusSet

const A = bonus('bonus_type.attack', 'bonus_rank.ii')
const B = bonus('bonus_type.attack', 'bonus_rank.iii')
const C = bonus('bonus_type.affinity', 'bonus_rank.ii')
const D = bonus('bonus_type.element', 'bonus_rank.ex')
const E = bonus('bonus_type.sharpness_capacity', 'bonus_rank.base')

/** Every ordered five-slot set over `alphabet` (alphabet.length ** 5 sets), in a fixed order. */
function allOrderedSets(alphabet: readonly RestorationBonus[]): RestorationBonusSet[] {
  const sets: RestorationBonusSet[] = []
  const size = alphabet.length
  for (let code = 0; code < size ** 5; code += 1) {
    const slots: RestorationBonus[] = []
    let rest = code
    for (let slot = 0; slot < 5; slot += 1) {
      slots.push({ ...alphabet[rest % size] })
      rest = Math.floor(rest / size)
    }
    sets.push(slots as RestorationBonusSet)
  }
  return sets
}

/** Every ordering of five slots (120 permutations). */
function permutations(values: readonly number[]): number[][] {
  if (values.length <= 1) return [[...values]]
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]))
}
const permuted = (source: RestorationBonusSet, order: readonly number[]) =>
  order.map((slot) => ({ ...source[slot] })) as RestorationBonusSet

describe('areRestorationBonusSetsEqual (unordered multiset with duplicate counts)', () => {
  it('accepts the same set in the same order', () => {
    expect(areRestorationBonusSetsEqual(set(A, B, C, D, E), set(A, B, C, D, E))).toBe(true)
  })

  it('accepts a permutation, and every permutation of all five slots', () => {
    expect(areRestorationBonusSetsEqual(set(A, B, C, D, E), set(E, C, A, D, B))).toBe(true)
    const source = set(A, B, C, D, E)
    const orders = permutations([0, 1, 2, 3, 4])
    expect(orders).toHaveLength(120)
    for (const order of orders) expect(areRestorationBonusSetsEqual(source, permuted(source, order))).toBe(true)
  })

  it('accepts every permutation of a set holding duplicates', () => {
    const source = set(A, A, B, C, C)
    for (const order of permutations([0, 1, 2, 3, 4])) {
      expect(areRestorationBonusSetsEqual(source, permuted(source, order))).toBe(true)
      expect(areRestorationBonusSetsEqual(permuted(source, order), source)).toBe(true)
    }
  })

  it('rejects sets whose duplicate counts differ, in either direction', () => {
    expect(areRestorationBonusSetsEqual(set(A, A, B, C, D), set(A, B, B, C, D))).toBe(false)
    expect(areRestorationBonusSetsEqual(set(A, B, B, C, D), set(A, A, B, C, D))).toBe(false)
    expect(areRestorationBonusSetsEqual(set(A, A, A, A, A), set(A, A, A, A, B))).toBe(false)
    expect(areRestorationBonusSetsEqual(set(A, A, A, A, B), set(A, A, A, A, A))).toBe(false)
  })

  it('requires both bonusTypeId and bonusRankId to match', () => {
    const typeDiffers = bonus('bonus_type.affinity', A.bonusRankId)
    const rankDiffers = bonus(A.bonusTypeId, 'bonus_rank.ex')
    expect(areRestorationBonusSetsEqual(set(A, B, C, D, E), set(typeDiffers, B, C, D, E))).toBe(false)
    expect(areRestorationBonusSetsEqual(set(A, B, C, D, E), set(rankDiffers, B, C, D, E))).toBe(false)
  })

  it('never mutates its inputs', () => {
    const left = set(A, A, B, C, D)
    const right = set(D, C, A, B, A)
    const leftBefore = structuredClone(left)
    const rightBefore = structuredClone(right)
    for (const bonuses of [left, right]) {
      bonuses.forEach((slot) => Object.freeze(slot))
      Object.freeze(bonuses)
    }
    expect(areRestorationBonusSetsEqual(left, right)).toBe(true)
    expect(areRestorationBonusSetsEqual(left, set(A, B, B, C, D))).toBe(false)
    expect(left).toEqual(leftBefore)
    expect(right).toEqual(rightBefore)
  })

  it('agrees with the former JSON key / Map count reference on every pair of ordered sets over four bonuses', () => {
    // A / B share a type, A / C share a rank, D differs in both: type-only and rank-only differences are covered.
    const sets = allOrderedSets([A, B, C, D])
    expect(sets).toHaveLength(1024)
    let equalPairs = 0
    for (const left of sets) {
      for (const right of sets) {
        const expected = referenceMultisetEqual(left, right)
        if (areRestorationBonusSetsEqual(left, right) !== expected) {
          throw new Error(`Mismatch for ${JSON.stringify(left)} vs ${JSON.stringify(right)}: expected ${expected}`)
        }
        if (expected) equalPairs += 1
      }
    }
    // Both outcomes were exercised: the equal pairs are exactly the sum over the 56 multisets of (orderings)^2.
    const orderingsPerMultiset = new Map<string, number>()
    for (const bonuses of sets) {
      const key = bonuses.map((slot) => `${slot.bonusTypeId}|${slot.bonusRankId}`).sort().join(';')
      orderingsPerMultiset.set(key, (orderingsPerMultiset.get(key) ?? 0) + 1)
    }
    expect(orderingsPerMultiset.size).toBe(56)
    expect(equalPairs).toBe([...orderingsPerMultiset.values()].reduce((sum, count) => sum + count * count, 0))
  }, 15_000)

  it('agrees with the reference for IDs whose concatenation or JSON quoting could collide', () => {
    // ('ab', 'c') vs ('a', 'bc') collide under naive concatenation; the quote / bracket / separator characters
    // exercise JSON key escaping. The reference keys them apart, and so must the direct comparison.
    const tricky = [
      bonus('ab', 'c'),
      bonus('a', 'bc'),
      bonus('a","b', 'c'),
      bonus('["a"', '"b"]'),
      bonus('', ''),
    ]
    const sets = allOrderedSets(tricky.slice(0, 3))
    const extra = allOrderedSets(tricky.slice(2))
    for (const pool of [sets, extra]) {
      for (const left of pool) {
        for (const right of pool) {
          expect(areRestorationBonusSetsEqual(left, right)).toBe(referenceMultisetEqual(left, right))
        }
      }
    }
    expect(areRestorationBonusSetsEqual(set(tricky[0], A, A, A, A), set(tricky[1], A, A, A, A))).toBe(false)
  })

  it('stays distinct from the slot-order-sensitive comparison Keep uses', () => {
    const left = set(A, B, C, D, E)
    const right = set(B, A, C, D, E)
    expect(areRestorationBonusSetsEqual(left, right)).toBe(true)
    expect(areRestorationBonusSlotsEqual(left, right)).toBe(false)
    expect(areRestorationBonusSlotsEqual(left, set(A, B, C, D, E))).toBe(true)
  })
})

describe('satisfiesIdealBonuses keeps its contract over the multiset comparison', () => {
  const target = createValidTargetWeapon()
  const ideal = target.idealBonuses
  const reversed = [...ideal].reverse().map((slot) => ({ ...slot })) as RestorationBonusSet

  it('accepts a Gogma-scope permutation of the Ideal and rejects the same labels in Normal scope', () => {
    expect(satisfiesIdealBonuses(target, reversed, 'gogma_artian', targetEvaluationMaster)).toBe(true)
    expect(satisfiesIdealBonuses(target, reversed, 'normal_artian', targetEvaluationMaster)).toBe(false)
  })

  it('rejects a Gogma-scope result whose duplicate counts differ from the Ideal', () => {
    const changed = structuredClone(ideal)
    const duplicated = changed.findIndex((slot, index) =>
      changed.some((other, otherIndex) => otherIndex !== index && other.bonusTypeId === slot.bonusTypeId && other.bonusRankId === slot.bonusRankId))
    expect(duplicated).toBeGreaterThanOrEqual(0)
    const unique = changed.find((slot) => changed.filter((other) => other.bonusTypeId === slot.bonusTypeId && other.bonusRankId === slot.bonusRankId).length === 1)!
    changed[duplicated] = { ...unique }
    expect(satisfiesIdealBonuses(target, changed, 'gogma_artian', targetEvaluationMaster)).toBe(false)
  })

  it.each(['normal_artian', 'gogma_artian'] as const)('still validates both sides before comparing in %s scope', (scope) => {
    const badResult = structuredClone(reversed)
    badResult[0].bonusRankId = 'bonus_rank.fixture.missing'
    expect(() => satisfiesIdealBonuses(target, badResult, scope, targetEvaluationMaster)).toThrow(MasterDataDomainError)
    const badTarget = structuredClone(target)
    badTarget.idealBonuses[4].bonusRankId = 'bonus_rank.fixture.missing'
    expect(() => satisfiesIdealBonuses(badTarget, reversed, scope, targetEvaluationMaster)).toThrow(MasterDataDomainError)
  })
})
