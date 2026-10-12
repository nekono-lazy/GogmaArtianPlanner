import { describe, expect, it } from 'vitest'
import { applyReachOption, createEmptyPartialAssignment, findResourceViolation } from './assignmentFeasibility'
import {
  compareValueOrder, countFeasibleOptionsUpTo, createOrderedOptionEnumerator, createTargetOptionLattice, indexedBonusStreams, indexedSkillRequirements, valueOrderKey,
} from './assignmentOrdering'
import { COUNTER_A, gogmaSource, handBuiltReachTable, newNormalSource, noBonus, normalSource } from './assignmentTestFixture'
import {
  enumerateBonusRequirements, enumerateReachOptions, enumerateReachOptionsOfSource, enumerateResetThenKeepRequirements, enumerateSkillRequirements, reachOptionKey,
} from './reachOptions'
import type { PartialResourceAssignment } from './assignmentTypes'
import type { ReachOption, ReachTable, SourceCandidate, TargetReach } from './types'

/*
 * Issue #154 Global Assignment Phase B-1 (design 6.3 / 6.4): the lazily merged value order equals the
 * fully sorted order, without materializing the option product; the MRV count reads feasibility only.
 */
const keys = (options: Iterable<ReachOption>) => [...options].map(option => reachOptionKey(option))

function sortedByValueOrder(target: TargetReach, table: ReachTable, partial: PartialResourceAssignment): string[] {
  return keys([...enumerateReachOptions(target, table)]
    .filter(option => !partial.usedSources.has(option.source.kind === 'new_normal' ? `normal:${option.source.counterId}:${option.source.position}` : `owned:${option.source.ownedWeaponId}`))
    .map(option => ({ option, key: valueOrderKey(option, partial) }))
    .sort((left, right) => compareValueOrder(left.key, right.key))
    .map(({ option }) => option))
}

function drain(target: TargetReach, table: ReachTable, partial: PartialResourceAssignment) {
  const enumerator = createOrderedOptionEnumerator(createTargetOptionLattice(target, table), table, partial)
  const delivered: ReachOption[] = []
  let maxFrontier = 0
  for (let option = enumerator.next(); option !== undefined; option = enumerator.next()) {
    delivered.push(option)
    maxFrontier = Math.max(maxFrontier, enumerator.frontierSize)
  }
  return { delivered, maxFrontier, enumerator }
}

const mixedSources = (): SourceCandidate[] => [gogmaSource('g', { layout: 'I' }), normalSource('n', 'L'), newNormalSource(4, 'I'), newNormalSource(5), newNormalSource(6)]

describe('Phase B-1 indexed requirement sequences', () => {
  const { table } = handBuiltReachTable({ targets: [{ id: 'target.a', sources: mixedSources(), skill: { idealPositions: [8, 10, 11] } }] })
  const target = table.targets[0]!

  it('index the Skill requirements of every source kind exactly as Phase A enumerates them', () => {
    for (const source of [...target.sources, gogmaSource('ideal', { currentSkillIdeal: true })]) {
      const expected = [...enumerateSkillRequirements(target, source, table)]
      const indexed = indexedSkillRequirements(target, source, table)
      expect(indexed.length, source.kind).toBe(expected.length)
      expect(Array.from({ length: indexed.length }, (_, index) => indexed.at(index))).toEqual(expected)
    }
    // Conversion blocks: s* = 8 -> 2 entries, 10 -> 4, 11 -> 5 (conversionLimit 11), addressed by prefix sums.
    const conversion = indexedSkillRequirements(target, normalSource('n'), table)
    expect(conversion.length).toBe(2 + 4 + 5)
    expect(conversion.at(1)).toEqual({ kind: 'conversion', conversionPosition: 7, finalPosition: 8 })
    expect(conversion.at(2)).toEqual({ kind: 'conversion', conversionPosition: 10, finalPosition: 10 })
    expect(conversion.at(10)).toEqual({ kind: 'conversion', conversionPosition: 7, finalPosition: 11 })
    expect(() => conversion.at(11)).toThrow(RangeError)
    const empty = indexedSkillRequirements({ ...target, skill: { ...target.skill, idealPositions: [] } }, normalSource('n'), table)
    expect(empty.length).toBe(0)
  })

  it('split the Bonus requirements into ascending streams whose concatenation is Phase A order', () => {
    const resetThenKeep = [...enumerateResetThenKeepRequirements(target)]
    expect(resetThenKeep.map(requirement => `${requirement.resetPosition}:${requirement.finalPosition}`)).toEqual(['11:13', '12:13', '11:15', '14:15'])
    for (const source of [...target.sources, gogmaSource('ideal', { currentBonusIdeal: true }), gogmaSource('nokeep', { layout: 'I', keepSupported: false })]) {
      const streams = indexedBonusStreams(target, source, resetThenKeep)
      const concatenated = streams.flatMap(stream => Array.from({ length: stream.length }, (_, index) => stream.at(index)))
      expect(concatenated, source.kind).toEqual([...enumerateBonusRequirements(target, source)])
      for (const stream of streams) {
        const finals = Array.from({ length: stream.length }, (_, index) => stream.at(index)).map(requirement => requirement.kind === 'none' ? -1 : requirement.finalPosition)
        expect(finals, 'ascending final positions').toEqual([...finals].sort((left, right) => left - right))
      }
    }
  })

  it('reproduce the full Phase A enumeration as the concatenation of the per-source enumerations', () => {
    expect(keys(enumerateReachOptions(target, table))).toEqual(target.sources.flatMap(source => keys(enumerateReachOptionsOfSource(target, table, source))))
  })
})

describe('Phase B-1 ordered option enumeration', () => {
  const { table } = handBuiltReachTable({ targets: [
    { id: 'target.a', sources: mixedSources() },
    { id: 'target.b', sources: [newNormalSource(5), gogmaSource('h')] },
  ] })
  const [target, other] = table.targets

  it('delivers every option of the unused sources in the design 6.3 value order, exactly once', () => {
    const empty = createEmptyPartialAssignment(table)
    const { delivered, enumerator } = drain(target!, table, empty)
    expect(keys(delivered)).toEqual(sortedByValueOrder(target!, table, empty))
    expect(new Set(keys(delivered)).size).toBe(delivered.length)
    expect(delivered.length).toBe([...enumerateReachOptions(target!, table)].length)
    expect(enumerator.excludedUsedSources).toBe(0)
    expect(enumerator.next()).toBeUndefined()
    // Key 1 is the Σ stream-end increment, so the first option is the cheapest one from the origin.
    expect(keys(delivered)[0]).toBe(`target.a|owned:g|reset_skills:8|keep_from_source:11`)
  })

  it('reorders against a partial assignment whose stream ends clip some increments, and skips a used source whole', () => {
    const first = [...enumerateReachOptions(other!, table)].find(option => option.source.kind === 'new_normal' && option.streamEnd.skill === 11 && option.bonusRequired.kind === 'reset_then_keep' && option.streamEnd.gogma === 16)!
    const partial = applyReachOption(createEmptyPartialAssignment(table), first)
    const { delivered, enumerator } = drain(target!, table, partial)
    expect(keys(delivered)).toEqual(sortedByValueOrder(target!, table, partial))
    expect(enumerator.excludedUsedSources).toBe(1)
    expect(delivered.some(option => option.source.kind === 'new_normal' && option.source.position === 5)).toBe(false)
    // Every Skill / Gogma increment is clipped to 0 now: owned sources (no Normal forge) come first, ordered by position.
    expect(delivered[0]!.source.kind).not.toBe('new_normal')
    expect(valueOrderKey(delivered[0]!, partial).components[0]).toBe(0)
    // Position feasibility is not filtered here: an option on a used Skill position is still delivered for the caller to judge.
    expect(delivered.some(option => findResourceViolation(option, partial) === 'skill_position')).toBe(true)
  })

  it('is lazy: the first options of a huge product come out at once with a bounded frontier', () => {
    const idealPositions = Array.from({ length: 2000 }, (_, index) => 8 + index)
    const resets = Array.from({ length: 2000 }, (_, index) => 10 + index)
    const { table: huge } = handBuiltReachTable({ window: { skill: 3000, gogma: 3000, normal: 1500 }, targets: [{
      id: 'target.huge',
      sources: Array.from({ length: 1500 }, (_, index) => newNormalSource(4 + index)),
      skill: { idealPositions, resetSkillsLimit: 100_000, conversionLimit: 100_000 },
      bonus: { resetIdealPositions: resets, resetLayoutByPosition: new Map(), keepIdealPositionsByLayout: new Map() },
    }] })
    const enumerator = createOrderedOptionEnumerator(createTargetOptionLattice(huge.targets[0]!, huge), huge, createEmptyPartialAssignment(huge))
    const started = performance.now()
    const first = Array.from({ length: 3 }, () => enumerator.next()!)
    expect(performance.now() - started).toBeLessThan(2000)
    // Increments 4, 4, 5: at the tie on 5 the smaller final Gogma position (Reset 10 from forge 5) precedes Reset 11 from forge 4.
    expect(keys(first)).toEqual([
      `target.huge|normal:${COUNTER_A}:4|conversion:8:8|reset:10`, `target.huge|normal:${COUNTER_A}:4|conversion:7:8|reset:10`, `target.huge|normal:${COUNTER_A}:5|conversion:8:8|reset:10`,
    ])
    // The frontier holds the 1,500 lattice roots plus the few cells opened so far - never the 1,500 x 2,001,000 x 2,000 product.
    expect(enumerator.frontierSize).toBeLessThan(1500 + 10)
    expect(enumerator.delivered).toBe(3)
  })

  it('yields nothing for a Target whose sources are all used or have no requirement on one axis', () => {
    const { table: silent } = handBuiltReachTable({ targets: [{ id: 'target.s', sources: [gogmaSource('g')], bonus: noBonus() }] })
    expect(drain(silent.targets[0]!, silent, createEmptyPartialAssignment(silent)).delivered).toEqual([])
    const used = { ...createEmptyPartialAssignment(table), usedSources: new Set(target!.sources.map(source => source.kind === 'new_normal' ? `normal:${source.counterId}:${source.position}` : `owned:${source.ownedWeaponId}`)) }
    const { delivered, enumerator } = drain(target!, table, used)
    expect(delivered).toEqual([])
    expect(enumerator.excludedUsedSources).toBe(5)
  })
})

describe('Phase B-1 MRV option count', () => {
  const { table } = handBuiltReachTable({ targets: [{ id: 'target.a', sources: mixedSources() }, { id: 'target.b', sources: [gogmaSource('g'), newNormalSource(4)] }] })
  const [target, other] = table.targets

  it('counts resource-feasible options up to the lookahead and skips a used source whole', () => {
    const empty = createEmptyPartialAssignment(table)
    const total = [...enumerateReachOptions(target!, table)].length
    expect(countFeasibleOptionsUpTo(target!, table, empty, 1_000_000)).toEqual({ count: total, rejections: { source: 0, skill_position: 0, gogma_position: 0, normal_position: 0 } })
    expect(countFeasibleOptionsUpTo(target!, table, empty, 3).count).toBe(3)
    // The other Target's first option: owned Gogma g, Reset Skills 8, Reset 12 - Target a's own source g is now used.
    const taken = applyReachOption(empty, [...enumerateReachOptions(other!, table)][0]!)
    const all = [...enumerateReachOptions(target!, table)]
    const brute = all.filter(option => findResourceViolation(option, taken) === null).length
    expect(brute).toBeLessThan(total)
    const counted = countFeasibleOptionsUpTo(target!, table, taken, 1_000_000)
    expect(counted.count).toBe(brute)
    // A used source is skipped whole and counted once; the position rejections count the options actually walked.
    expect(counted.rejections.source).toBe(1)
    expect(counted.rejections.skill_position).toBe(all.filter(option => option.source.kind !== 'owned_gogma' && findResourceViolation(option, taken) === 'skill_position').length)
    expect(counted.rejections.gogma_position).toBe(all.filter(option => option.source.kind !== 'owned_gogma' && findResourceViolation(option, taken) === 'gogma_position').length)
    // The lookahead stops the walk, so a saturated count reports only what it saw.
    expect(countFeasibleOptionsUpTo(target!, table, taken, 1).count).toBe(1)
    expect(() => countFeasibleOptionsUpTo(target!, table, empty, 0)).toThrow(RangeError)
  })
})
