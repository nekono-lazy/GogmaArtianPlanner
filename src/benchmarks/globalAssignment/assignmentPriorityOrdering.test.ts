import { describe, expect, it } from 'vitest'
import { applyReachOption, createEmptyPartialAssignment } from './assignmentFeasibility'
import {
  compareValueOrder, createConversionPriorityEnumerator, createKeyedOptionEnumerator, createOrderedOptionEnumerator, createPrioritizedOptionEnumerator,
  createPriorityOrderingCounters, createTargetOptionLattice, indexedConversionsAt, valueOrderKey, type PrioritizedOptionEnumerator,
} from './assignmentOrdering'
import { COUNTER_A, gogmaSource, handBuiltReachTable, newNormalSource, normalSource } from './assignmentTestFixture'
import type { PartialResourceAssignment } from './assignmentTypes'
import { seededRandom } from './coverageSearchTestFixture'
import { enumerateReachOptions, reachOptionKey } from './reachOptions'
import type { ReachOption, ReachTable, SourceCandidate, TargetReach } from './types'

/*
 * Issue #154 Global Assignment Phase C-2 (design 6.3 coverage-driven value ordering): the prioritized
 * node enumerator reorders the Phase B-1 value order without ever re-keying its frontier. Whatever the
 * sequence of priority conversion positions, every option is delivered exactly once; a priority serves
 * the not-yet-delivered `c = x` options first in their own value order; nothing is materialized.
 */
const keyOf = (option: ReachOption) => reachOptionKey(option)
const conversionOf = (option: ReachOption) => (option.skillRequired.kind === 'conversion' ? option.skillRequired.conversionPosition : null)

const mixedSources = (): SourceCandidate[] => [gogmaSource('g', { layout: 'I' }), normalSource('n', 'L'), newNormalSource(4, 'I'), newNormalSource(5), newNormalSource(6)]
const { table } = handBuiltReachTable({ targets: [{ id: 'target.a', sources: mixedSources() }, { id: 'target.b', sources: [gogmaSource('g'), newNormalSource(4)] }] })
const [target, other] = table.targets as [TargetReach, TargetReach]

function baseOrder(row: TargetReach, reach: ReachTable, partial: PartialResourceAssignment): ReachOption[] {
  const enumerator = createOrderedOptionEnumerator(createTargetOptionLattice(row, reach), reach, partial)
  const delivered: ReachOption[] = []
  for (let option = enumerator.next(); option !== undefined; option = enumerator.next()) delivered.push(option)
  return delivered
}

/** Drains a prioritized enumerator whose priority is `script(deliveredSoFar)`. */
function drainPrioritized(row: TargetReach, reach: ReachTable, partial: PartialResourceAssignment, script: (delivered: number) => number | null) {
  const counters = createPriorityOrderingCounters()
  let count = 0
  const enumerator = createPrioritizedOptionEnumerator(createTargetOptionLattice(row, reach), reach, partial, () => script(count), counters)
  const delivered: ReachOption[] = []
  for (let option = enumerator.next(); option !== undefined; option = enumerator.next()) {
    delivered.push(option)
    count += 1
  }
  return { delivered, counters, enumerator }
}

const partials = (): PartialResourceAssignment[] => {
  const empty = createEmptyPartialAssignment(table)
  return [empty, applyReachOption(empty, [...enumerateReachOptions(other, table)][0]!)]
}

describe('Phase C-2 prioritized value order (design 6.3)', () => {
  it('delivers exactly the Phase B-1 order when no priority is named', () => {
    for (const partial of partials()) {
      const { delivered, counters } = drainPrioritized(target, table, partial, () => null)
      expect(delivered.map(keyOf)).toEqual(baseOrder(target, table, partial).map(keyOf))
      expect(counters).toEqual({ phaseActivations: 0, priorityDeliveries: 0, prioritySkips: 0, baseSkips: 0 })
    }
  })

  it('keeps the keyed enumerator strictly ascending and equal to the ordered one', () => {
    for (const partial of partials()) {
      const keyed = createKeyedOptionEnumerator(createTargetOptionLattice(target, table), table, partial)
      const delivered = []
      for (let value = keyed.next(); value !== undefined; value = keyed.next()) delivered.push(value)
      expect(delivered.map(value => keyOf(value.option))).toEqual(baseOrder(target, table, partial).map(keyOf))
      for (let index = 1; index < delivered.length; index++) expect(compareValueOrder(delivered[index - 1]!.key, delivered[index]!.key)).toBeLessThan(0)
    }
  })

  it('serves the not-yet-delivered c = x options first, in value order, from where the base stood', () => {
    const partial = createEmptyPartialAssignment(table)
    const base = baseOrder(target, table, partial)
    for (const switchAt of [0, 1, 5, 17]) {
      for (const x of [7, 8, 9, 10]) {
        const { delivered, counters } = drainPrioritized(target, table, partial, count => (count >= switchAt ? x : null))
        const head = base.slice(0, switchAt)
        const remainingAtX = base.slice(switchAt).filter(option => conversionOf(option) === x)
        expect(delivered.slice(0, switchAt).map(keyOf)).toEqual(head.map(keyOf))
        expect(delivered.slice(switchAt, switchAt + remainingAtX.length).map(keyOf)).toEqual(remainingAtX.map(keyOf))
        // Afterwards the base order resumes, passing over exactly the options the phase delivered.
        expect(delivered.slice(switchAt + remainingAtX.length).map(keyOf)).toEqual(base.slice(switchAt).filter(option => conversionOf(option) !== x).map(keyOf))
        expect(counters.priorityDeliveries).toBe(remainingAtX.length)
        expect(counters.baseSkips).toBe(remainingAtX.length)
        expect(remainingAtX.length).toBeGreaterThan(0)
      }
    }
  })

  it('delivers every option exactly once under any sequence of priorities (switches, repeats, unreachable positions, null)', () => {
    for (const partial of partials()) {
      const expected = baseOrder(target, table, partial).map(keyOf).sort()
      for (let seed = 1; seed <= 200; seed++) {
        const random = seededRandom(seed)
        const changes = new Map<number, number | null>()
        for (let step = 0; step < 40; step++) {
          const roll = random()
          changes.set(Math.floor(random() * 60), roll < 0.15 ? null : roll < 0.25 ? 3 + Math.floor(random() * 3) : 7 + Math.floor(random() * 5))
        }
        let current: number | null = null
        const script = (count: number) => {
          if (changes.has(count)) current = changes.get(count)!
          return current
        }
        const { delivered, counters } = drainPrioritized(target, table, partial, script)
        const keys = delivered.map(keyOf)
        expect(new Set(keys).size, `seed ${seed}`).toBe(keys.length)
        expect([...keys].sort(), `seed ${seed}`).toEqual(expected)
        expect(counters.priorityDeliveries).toBeLessThanOrEqual(keys.length)
      }
    }
  })

  it('restricts a priority phase to one conversion position without materializing the product', () => {
    expect(indexedConversionsAt(target, gogmaSource('g'), table, 7).length).toBe(0)
    expect(indexedConversionsAt(target, normalSource('n'), table, 6).length).toBe(0)
    const at9 = indexedConversionsAt(target, normalSource('n'), table, 9)
    expect(Array.from({ length: at9.length }, (_, index) => at9.at(index))).toEqual([{ kind: 'conversion', conversionPosition: 9, finalPosition: 10 }])
    const at7 = indexedConversionsAt(target, normalSource('n'), table, 7)
    expect(Array.from({ length: at7.length }, (_, index) => at7.at(index))).toEqual([
      { kind: 'conversion', conversionPosition: 7, finalPosition: 8 }, { kind: 'conversion', conversionPosition: 7, finalPosition: 10 },
    ])
    expect(() => at7.at(2)).toThrow(RangeError)
    // The restricted merge delivers exactly the c = x subsequence of the full order.
    const partial = createEmptyPartialAssignment(table)
    const restricted = createConversionPriorityEnumerator(createTargetOptionLattice(target, table), table, partial, 7)
    const delivered: ReachOption[] = []
    for (let value = restricted.next(); value !== undefined; value = restricted.next()) {
      delivered.push(value.option)
      expect(value.key).toEqual(valueOrderKey(value.option, partial))
    }
    expect(delivered.map(keyOf)).toEqual(baseOrder(target, table, partial).filter(option => conversionOf(option) === 7).map(keyOf))
  })

  it('stays lazy on a huge row: a priority at the Skill origin yields its first options at once with a bounded frontier', () => {
    const idealPositions = Array.from({ length: 2000 }, (_, index) => 8 + index)
    const resets = Array.from({ length: 2000 }, (_, index) => 10 + index)
    const { table: huge } = handBuiltReachTable({ window: { skill: 3000, gogma: 3000, normal: 1500 }, targets: [{
      id: 'target.huge',
      sources: Array.from({ length: 1500 }, (_, index) => newNormalSource(4 + index)),
      skill: { idealPositions, resetSkillsLimit: 100_000, conversionLimit: 100_000 },
      bonus: { resetIdealPositions: resets, resetLayoutByPosition: new Map(), keepIdealPositionsByLayout: new Map() },
    }] })
    const counters = createPriorityOrderingCounters()
    let priority: number | null = null
    const enumerator: PrioritizedOptionEnumerator = createPrioritizedOptionEnumerator(createTargetOptionLattice(huge.targets[0]!, huge), huge,
      createEmptyPartialAssignment(huge), () => priority, counters)
    const started = performance.now()
    const before = Array.from({ length: 3 }, () => enumerator.next()!)
    priority = 7
    const prioritized = Array.from({ length: 3 }, () => enumerator.next()!)
    priority = 12
    const switched = Array.from({ length: 2 }, () => enumerator.next()!)
    expect(performance.now() - started).toBeLessThan(4000)
    expect(before.map(keyOf)).toEqual([
      `target.huge|normal:${COUNTER_A}:4|conversion:8:8|reset:10`, `target.huge|normal:${COUNTER_A}:4|conversion:7:8|reset:10`, `target.huge|normal:${COUNTER_A}:5|conversion:8:8|reset:10`,
    ])
    // c = 7 next in value order (increments 4, 5, 5), skipping (4, 7, 8, reset 10), which the base already delivered.
    expect(prioritized.map(keyOf)).toEqual([
      `target.huge|normal:${COUNTER_A}:5|conversion:7:8|reset:10`, `target.huge|normal:${COUNTER_A}:4|conversion:7:8|reset:11`, `target.huge|normal:${COUNTER_A}:4|conversion:7:9|reset:10`,
    ])
    expect(switched.every(option => conversionOf(option) === 12)).toBe(true)
    // The frontier is the 1,500 base roots plus the active phase's roots and a few opened cells - never the product.
    expect(enumerator.frontierSize).toBeLessThan(2 * 1500 + 20)
    expect(enumerator.priorityRanges).toBe(2)
    expect(counters.phaseActivations).toBe(2)
  })
})
