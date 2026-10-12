import { describe, expect, it } from 'vitest'
import { createTargetStreamMenu } from './assignmentLowerBound'
import { denseResetThenKeepBonus, denseTwoLayoutResetThenKeepBonus, gogmaSource, handBuiltReachTable, positionsOfParity } from './assignmentTestFixture'
import { createResetThenKeepIndex, enumerateResetThenKeepRequirements, type ResetThenKeepIndex, type ResetThenKeepRequirement } from './reachOptions'
import type { ReachTable, TargetReach } from './types'

/*
 * Issue #154 Global Assignment Phase B-1 (PR #239 review): the compact `reset_then_keep` index returns
 * exactly the pairs of Phase A's generator, in its order, without holding the pairs.
 */
const pairs = (requirements: Iterable<ResetThenKeepRequirement>) => [...requirements].map(requirement => `${requirement.resetPosition}:${requirement.finalPosition}`)
const materialize = (index: ResetThenKeepIndex) => Array.from({ length: index.length }, (_, position) => index.at(position))
const take = (target: TargetReach, count: number) => {
  const taken: ResetThenKeepRequirement[] = []
  for (const requirement of enumerateResetThenKeepRequirements(target)) {
    taken.push(requirement)
    if (taken.length >= count) break
  }
  return taken
}

function row(bonus: Partial<TargetReach['bonus']>, window = 20): { target: TargetReach; table: ReachTable } {
  const { table } = handBuiltReachTable({ window: { skill: 4, gogma: window, normal: 3 }, targets: [{ id: 'target.a', sources: [gogmaSource('g')], bonus }] })
  return { target: table.targets[0]!, table }
}

function expectParity(target: TargetReach): ResetThenKeepIndex {
  const index = createResetThenKeepIndex(target)
  const expected = [...enumerateResetThenKeepRequirements(target)]
  expect(index.length).toBe(expected.length)
  expect(pairs(materialize(index))).toEqual(pairs(expected))
  expect([...index.finalPositions]).toEqual([...new Set(expected.map(requirement => requirement.finalPosition))])
  return index
}

describe('Reset -> Keep compact index', () => {
  it('reproduces the generator pair by pair on the default row', () => {
    const index = expectParity(row({}).target)
    expect(pairs(materialize(index))).toEqual(['11:13', '12:13', '11:15', '14:15'])
    expect([...index.finalPositions]).toEqual([13, 15])
    expect(index.footprint).toEqual({ resetPositions: 3, layouts: 2, finalGroups: 2, layoutReferences: 3 })
  })

  it('matches the generator on one layout with several Resets, several layouts reaching one Keep position, and their merge order', () => {
    const several = expectParity(row({ resetLayoutByPosition: new Map([[10, 'I'], [11, 'I'], [12, 'I'], [13, 'X']]), keepIdealPositionsByLayout: new Map([['I', [12, 14]]]) }).target)
    expect(pairs(materialize(several))).toEqual(['10:12', '11:12', '10:14', '11:14', '12:14'])
    const merged = expectParity(row({ resetLayoutByPosition: new Map([[10, 'I'], [11, 'L'], [12, 'I'], [13, 'L']]), keepIdealPositionsByLayout: new Map([['I', [13]], ['L', [13, 14]]]) }).target)
    expect(pairs(materialize(merged))).toEqual(['10:13', '11:13', '12:13', '11:14', '13:14'])
    expect(merged.footprint.layoutReferences).toBe(3)
  })

  it('never pairs a Reset with itself, with a later Keep only, through an unsupported layout, or across two slot orders of one multiset', () => {
    const same = expectParity(row({ resetLayoutByPosition: new Map([[12, 'I']]), keepIdealPositionsByLayout: new Map([['I', [12, 13]]]) }).target)
    expect(pairs(materialize(same))).toEqual(['12:13'])
    const noEarlier = expectParity(row({ resetLayoutByPosition: new Map([[12, 'I']]), keepIdealPositionsByLayout: new Map([['I', [11, 13]]]) }).target)
    expect(pairs(materialize(noEarlier))).toEqual(['12:13'])
    expect([...noEarlier.finalPositions]).toEqual([13])
    const unsupported = expectParity(row({ resetLayoutByPosition: new Map([[10, 'I'], [11, 'L']]), keepIdealPositionsByLayout: new Map([['I', [12]], ['L', [12]]]), keepUnsupportedLayouts: ['L'] }).target)
    expect(pairs(materialize(unsupported))).toEqual(['10:12'])
    // `a\u0000b` and `b\u0000a` are one family multiset in two slot orders: Keep preserves the slot order, so they never mix.
    const ordered = expectParity(row({ resetLayoutByPosition: new Map([[10, 'a\u0000b'], [11, 'b\u0000a']]), keepIdealPositionsByLayout: new Map([['a\u0000b', [12]], ['b\u0000a', [13]]]) }).target)
    expect(pairs(materialize(ordered))).toEqual(['10:12', '11:13'])
    const empty = expectParity(row({ resetLayoutByPosition: new Map([[10, 'X']]), keepIdealPositionsByLayout: new Map([['I', [12]]]) }).target)
    expect(empty.length).toBe(0)
    expect([...empty.finalPositions]).toEqual([])
    expect(() => empty.at(0)).toThrow(RangeError)
    expect(() => same.at(1)).toThrow(RangeError)
    expect(() => same.at(-1)).toThrow(RangeError)
  })

  it('indexes a dense 500 x 500 row of 125,250 requirements without holding the pairs', () => {
    const { target, table } = row(denseResetThenKeepBonus(), 1000)
    const index = createResetThenKeepIndex(target)
    expect(index.length).toBe(125_250)
    expect(index.footprint).toEqual({ resetPositions: 500, layouts: 1, finalGroups: 500, layoutReferences: 500 })
    expect([...index.finalPositions]).toEqual(positionsOfParity(11, 1009, 1))
    expect(index.at(0)).toEqual({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 })
    expect(index.at(1)).toEqual({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 13 })
    expect(index.at(2)).toEqual({ kind: 'reset_then_keep', resetPosition: 12, finalPosition: 13 })
    // The group of final 509 (the 250th Keep position) starts at 1 + 2 + ... + 249 = 31,125 and holds the 250 Resets 10 .. 508.
    expect(index.at(31_125)).toEqual({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 509 })
    expect(index.at(31_125 + 249)).toEqual({ kind: 'reset_then_keep', resetPosition: 508, finalPosition: 509 })
    expect(index.at(31_125 + 250)).toEqual({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 511 })
    expect(index.at(125_249)).toEqual({ kind: 'reset_then_keep', resetPosition: 1008, finalPosition: 1009 })
    // The leading requirements agree with the generator without exhausting it.
    expect(pairs(Array.from({ length: 300 }, (_, position) => index.at(position)))).toEqual(pairs(take(target, 300)))
    // The lower bound's finals come from the same index: no pair is enumerated there either.
    expect(createTargetStreamMenu(target, table, index).resetThenKeepFinals).toBe(index.finalPositions)
    expect(createTargetStreamMenu(target, table).resetThenKeepFinals).toEqual(positionsOfParity(11, 1009, 1))
  })

  it('merges two layouts at a dense Keep position by rank, matching an independent count and the generator', () => {
    const { target } = row(denseTwoLayoutResetThenKeepBonus(), 1000)
    const index = createResetThenKeepIndex(target)
    // Independent count: per final, the even positions below it whose layout's Keep is Ideal there.
    let expectedLength = 0
    const expectedFinals: number[] = []
    for (const finalPosition of positionsOfParity(11, 1009, 1)) {
      const count = positionsOfParity(10, finalPosition - 1, 0).filter(position => position % 4 === 2 || finalPosition >= 511).length
      if (count > 0) { expectedLength += count; expectedFinals.push(finalPosition) }
    }
    expect(index.length).toBe(expectedLength)
    expect([...index.finalPositions]).toEqual(expectedFinals)
    expect(index.footprint).toEqual({ resetPositions: 500, layouts: 2, finalGroups: 500, layoutReferences: 500 + 250 })
    expect(pairs(Array.from({ length: 3000 }, (_, position) => index.at(position)))).toEqual(pairs(take(target, 3000)))
    // The last group (final 1009) merges all 500 Resets of both layouts: 10 (I), 12 (L), 14 (I), ..., 1008 (L).
    expect(index.at(index.length - 500)).toEqual({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 1009 })
    expect(index.at(index.length - 499)).toEqual({ kind: 'reset_then_keep', resetPosition: 12, finalPosition: 1009 })
    expect(index.at(index.length - 498)).toEqual({ kind: 'reset_then_keep', resetPosition: 14, finalPosition: 1009 })
    expect(index.at(index.length - 1)).toEqual({ kind: 'reset_then_keep', resetPosition: 1008, finalPosition: 1009 })
    // A final below 511 reads layout I only: 10, 14, 18, ... (every other even position).
    const start509 = positionsOfParity(11, 507, 1).reduce((sum, finalPosition) => sum + positionsOfParity(10, finalPosition - 1, 0).filter(position => position % 4 === 2).length, 0)
    expect(index.at(start509)).toEqual({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 509 })
    expect(index.at(start509 + 1)).toEqual({ kind: 'reset_then_keep', resetPosition: 14, finalPosition: 509 })
  })

  it('is deterministic for the same row', () => {
    const { target } = row(denseTwoLayoutResetThenKeepBonus(), 1000)
    const first = createResetThenKeepIndex(target), second = createResetThenKeepIndex(target)
    expect(second.length).toBe(first.length)
    for (const position of [0, 1, 2, 777, 12_345, first.length - 1]) expect(second.at(position)).toEqual(first.at(position))
  })
})
