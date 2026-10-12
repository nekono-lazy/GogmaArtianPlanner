import { describe, expect, it } from 'vitest'
import { COUNTER_A, COUNTER_B, gogmaSource, newNormalSource, normalSource } from './assignmentTestFixture'
import { checkStreamCoverage, deriveMaterializationOrder, selectCoverer, type CoverageHolder } from './coverage'
import {
  assignmentOf, conversion, coverageTable, keep, NONE, option, partitionProblems, reset, resetSkills, resetThenKeep, segmentsOf, targetId,
} from './coverageTestFixture'
import type { StreamCoverage, StreamCoverageResult } from './coverageTypes'
import { GlobalAssignmentInvariantError, type ReachTable } from './types'

/*
 * Issue #154 Global Assignment Phase C-1 (design 8.1 / 8.2 / 13.1 Phase C): the static coverage
 * pre-check, the coverer prediction and the materialization order over hand-built ReachTables. Pure:
 * no Engine, no Search, no Planner, no oracle and no real Target or weapon ID.
 */
const A = 'target.a'
const B = 'target.b'
const C = 'target.c'
const D = 'target.d'
const E = 'target.e'

/** An owned Gogma whose current Skills are Ideal: Skill requirement `none`, Gogma operations only. */
const skillIdealGogma = (id: string) => gogmaSource(id, { currentSkillIdeal: true })

function feasible(result: StreamCoverageResult): StreamCoverage[] {
  if (result.kind !== 'feasible') throw new Error(`expected feasible, got ${JSON.stringify(result)}`)
  for (const stream of result.coverage) expect(partitionProblems(stream), JSON.stringify(stream.stream)).toEqual([])
  return result.coverage
}

const streamOf = (coverage: readonly StreamCoverage[], kind: 'skill' | 'gogma' | string) =>
  coverage.find(value => (kind === 'skill' || kind === 'gogma' ? value.stream.kind === kind : value.stream.kind === 'normal' && value.stream.counterId === kind))!

/** The prompt's example (Skill origin 10): two conversions at 15 and 18, nothing holds Skill 10..14. */
function twoConversionsTable(withResetSkillsHolder: boolean): { table: ReachTable; options: ReturnType<typeof option>[] } {
  const table = coverageTable({ targets: [
    { id: A, sources: [normalSource('owned.n.a')] },
    { id: B, sources: [normalSource('owned.n.b')] },
    ...(withResetSkillsHolder ? [{ id: C, sources: [gogmaSource('owned.g.c')] }] : []),
  ] })
  const options = [
    option(table, A, normalSource('owned.n.a'), conversion(15, 20), reset(55)),
    option(table, B, normalSource('owned.n.b'), conversion(18, 24), reset(60)),
    ...(withResetSkillsHolder ? [option(table, C, gogmaSource('owned.g.c'), resetSkills(26), reset(62))] : []),
  ]
  return { table, options }
}

describe('Phase C-1 Counter coverage pre-check (design 8.1)', () => {
  it('reports the Skill origin uncovered when every Target converts after it', () => {
    const { table, options } = twoConversionsTable(false)
    const result = checkStreamCoverage(assignmentOf(table, options), table)
    expect(result.kind).toBe('coverage_infeasible')
    if (result.kind !== 'coverage_infeasible') return
    expect(result.firstUncovered).toEqual({
      stream: { kind: 'skill' }, from: 10, to: 14, firstUncoveredPosition: 10,
      previousRequired: null, nextRequired: { position: 15, targetWeaponId: A },
      reason: 'no_skill_holder_across_gap',
      reachingTargetsEnteringLater: [{ targetWeaponId: A, conversionPosition: 15 }, { targetWeaponId: B, conversionPosition: 18 }],
    })
    // The other Skill gaps are covered (A from 16, B from 19), and Gogma never fails: one uncovered gap only.
    expect(result.uncovered).toEqual([result.firstUncovered])
  })

  it('covers the Skill origin with an existing Gogma Reset Skills chain and lets an earlier conversion cover a later one\'s prefix', () => {
    const { table, options } = twoConversionsTable(true)
    const coverage = feasible(checkStreamCoverage(assignmentOf(table, options), table))
    const skill = streamOf(coverage, 'skill')
    expect(skill.origin).toBe(10)
    expect(skill.end).toBe(27)
    expect(segmentsOf(skill)).toEqual([
      ['chain', 10, 14, C], // before every conversion: only the owned Gogma's Reset Skills chain
      ['required', 15, 15, A],
      ['chain', 16, 17, A], // B converts at 18 itself; A (converted at 15, final 20) holds it, C reaches further
      ['required', 18, 18, B],
      ['chain', 19, 19, A], // nearest successor: A's own final Skill position follows
      ['required', 20, 20, A],
      ['chain', 21, 23, B],
      ['required', 24, 24, B],
      ['chain', 25, 25, C],
      ['required', 26, 26, C],
    ])
    expect(skill.required).toEqual([{ position: 15, targetWeaponId: A }, { position: 18, targetWeaponId: B }, { position: 20, targetWeaponId: A },
      { position: 24, targetWeaponId: B }, { position: 26, targetWeaponId: C }])
  })

  it('treats a conversion at the Skill origin as covering it, and never lets a conversion cover positions before itself', () => {
    const table = coverageTable({ targets: [{ id: A, sources: [normalSource('owned.n.a')] }, { id: D, sources: [gogmaSource('owned.g.d')] }] })
    const atOrigin = feasible(checkStreamCoverage(assignmentOf(table, [option(table, A, normalSource('owned.n.a'), conversion(10, 13), reset(55)),
      option(table, D, gogmaSource('owned.g.d'), resetSkills(15), reset(57))]), table))
    expect(segmentsOf(streamOf(atOrigin, 'skill'))).toEqual([['required', 10, 10, A], ['chain', 11, 12, A], ['required', 13, 13, A], ['chain', 14, 14, D], ['required', 15, 15, D]])

    // A alone converting at 12: Skill 10..11 lies before its conversion, and nobody else holds a weapon there.
    const alone = coverageTable({ targets: [{ id: A, sources: [normalSource('owned.n.a')] }] })
    const result = checkStreamCoverage(assignmentOf(alone, [option(alone, A, normalSource('owned.n.a'), conversion(12, 15), reset(55))]), alone)
    expect(result.kind).toBe('coverage_infeasible')
    if (result.kind === 'coverage_infeasible') {
      expect(result.firstUncovered).toMatchObject({ from: 10, to: 11, firstUncoveredPosition: 10, reachingTargetsEnteringLater: [{ targetWeaponId: A, conversionPosition: 12 }] })
    }
  })

  it('reports every uncovered Skill gap deterministically, the lowest first', () => {
    const table = coverageTable({ targets: [{ id: A, sources: [normalSource('owned.n.a')] }, { id: B, sources: [normalSource('owned.n.b')] }] })
    const assignment = assignmentOf(table, [option(table, A, normalSource('owned.n.a'), conversion(15, 15), reset(55)), option(table, B, normalSource('owned.n.b'), conversion(20, 20), reset(56))])
    const result = checkStreamCoverage(assignment, table)
    if (result.kind !== 'coverage_infeasible') throw new Error(result.kind)
    expect(result.uncovered.map(gap => [gap.from, gap.to, gap.previousRequired?.position ?? null, gap.nextRequired.position])).toEqual([[10, 14, null, 15], [16, 19, 15, 20]])
    expect(result.uncovered[1]!.reachingTargetsEnteringLater).toEqual([{ targetWeaponId: B, conversionPosition: 20 }])
    expect(result.firstUncovered).toBe(result.uncovered[0])
    expect(checkStreamCoverage(assignment, table)).toEqual(result)
  })

  it('covers the Gogma stream with Reset, Keep and Reset -> Keep chains (always feasible)', () => {
    const table = coverageTable({ targets: [
      { id: A, sources: [skillIdealGogma('owned.g.a')] },
      { id: B, sources: [skillIdealGogma('owned.g.b')] },
      { id: C, sources: [skillIdealGogma('owned.g.c')] },
    ] })
    const coverage = feasible(checkStreamCoverage(assignmentOf(table, [
      option(table, A, skillIdealGogma('owned.g.a'), NONE, reset(55)),
      option(table, B, skillIdealGogma('owned.g.b'), NONE, keep(60)),
      option(table, C, skillIdealGogma('owned.g.c'), NONE, resetThenKeep(52, 65)),
    ]), table))
    expect(segmentsOf(streamOf(coverage, 'gogma'))).toEqual([
      ['chain', 50, 51, C], // nearest successor C (its Reset at 52 follows) although A's final 55 is smaller
      ['required', 52, 52, C],
      ['chain', 53, 54, A],
      ['required', 55, 55, A],
      ['chain', 56, 59, B],
      ['required', 60, 60, B],
      ['chain', 61, 64, C], // the Keep part of C's Reset -> Keep chain
      ['required', 65, 65, C],
    ])
    // No Skill operation: the Skill stream is empty and asks for no coverer.
    expect(streamOf(coverage, 'skill')).toEqual({ stream: { kind: 'skill' }, origin: 10, end: 10, required: [], segments: [] })
  })

  it('lets the farthest production target forge each Normal Counter\'s prefix, one Counter per weapon type', () => {
    const table = coverageTable({ originNormal: { [COUNTER_A]: 0, [COUNTER_B]: 0 }, targets: [
      { id: A, sources: [newNormalSource(3)] },
      { id: B, sources: [newNormalSource(7)] },
      { id: C, weaponTypeId: 'weapon.fixture.b', normalCounterId: COUNTER_B, sources: [newNormalSource(2, 'X', COUNTER_B)] },
      { id: D, sources: [gogmaSource('owned.g.d')] },
    ] })
    const coverage = feasible(checkStreamCoverage(assignmentOf(table, [
      option(table, A, newNormalSource(3), conversion(11, 11), reset(55)),
      option(table, B, newNormalSource(7), conversion(12, 12), reset(56)),
      option(table, C, newNormalSource(2, 'X', COUNTER_B), conversion(13, 13), reset(57)),
      option(table, D, gogmaSource('owned.g.d'), resetSkills(10), reset(58)),
    ]), table))
    expect(segmentsOf(streamOf(coverage, COUNTER_A))).toEqual([['chain', 0, 2, B], ['required', 3, 3, A], ['chain', 4, 6, B], ['required', 7, 7, B]])
    expect(segmentsOf(streamOf(coverage, COUNTER_B))).toEqual([['chain', 0, 1, C], ['required', 2, 2, C]])
    expect(coverage.map(value => value.stream)).toEqual([{ kind: 'skill' }, { kind: 'gogma' }, { kind: 'normal', counterId: COUNTER_A }, { kind: 'normal', counterId: COUNTER_B }])
  })

  it('leaves a Normal Counter nobody forges empty', () => {
    const table = coverageTable({ originNormal: { [COUNTER_A]: 4, [COUNTER_B]: 9 }, targets: [{ id: A, sources: [gogmaSource('owned.g.a')] }] })
    const coverage = feasible(checkStreamCoverage(assignmentOf(table, [option(table, A, gogmaSource('owned.g.a'), resetSkills(12), reset(51))]), table))
    expect(streamOf(coverage, COUNTER_A)).toMatchObject({ origin: 4, end: 4, segments: [] })
    expect(streamOf(coverage, COUNTER_B)).toMatchObject({ origin: 9, end: 9, segments: [] })
  })

  it('never adds a chain position to the exclusive required positions', () => {
    const { table, options } = twoConversionsTable(true)
    const assignment = assignmentOf(table, options)
    const before = structuredClone(assignment)
    const coverage = feasible(checkStreamCoverage(assignment, table))
    const chainPositions = streamOf(coverage, 'skill').segments.filter(segment => segment.kind === 'chain').flatMap(segment => Array.from({ length: segment.to - segment.from + 1 }, (_, index) => segment.from + index))
    expect(chainPositions.filter(position => assignment.requiredPositions.skill.includes(position))).toEqual([])
    expect(streamOf(coverage, 'skill').required.map(value => value.position)).toEqual(assignment.requiredPositions.skill)
    // The assignment itself (ordinal, objective, sources, required positions) is unchanged.
    expect(assignment).toEqual(before)
  })

  it('is deterministic', () => {
    const { table, options } = twoConversionsTable(true)
    expect(checkStreamCoverage(assignmentOf(table, options), table)).toEqual(checkStreamCoverage(assignmentOf(table, [...options].reverse()), table))
  })
})

describe('Phase C-1 coverer choice (design 8.2)', () => {
  it('picks the nearest successor, else the smallest final position, and lets one Target cover several gaps', () => {
    const { table, options } = twoConversionsTable(true)
    const skill = streamOf(feasible(checkStreamCoverage(assignmentOf(table, options), table)), 'skill')
    const chain = skill.segments.filter(segment => segment.kind === 'chain').map(segment => [segment.from, segment.covererTargetWeaponId])
    // 16..17: the successor B converts at 18 (cannot fill), A (final 20) beats C (final 26).
    // 19 and 21..23: the successors A and B fill them. 10..14 and 25: C, twice.
    expect(chain).toEqual([[10, C], [16, A], [19, A], [21, B], [25, C]])
  })

  it('breaks an equal final position by owned source first, then by Target ID, and never outranks the nearest successor', () => {
    // C2 keeps one stream's final positions distinct, so a valid assignment never reaches these keys; they are the
    // defensive total order of the chooser, exercised on hand-made filler lists.
    const holder = (id: string, final: number, owned: boolean): CoverageHolder => ({ targetWeaponId: targetId(id), entry: 10, final, owned, conversionPosition: null })
    const next = { position: 30, targetWeaponId: targetId(E) }
    expect(selectCoverer([holder(D, 40, false), holder(C, 40, true), holder(B, 41, true)], next).targetWeaponId).toBe(C)
    expect(selectCoverer([holder(D, 40, true), holder(C, 40, true)], next).targetWeaponId).toBe(C)
    expect(selectCoverer([holder(D, 40, false), holder(C, 40, false)], next).targetWeaponId).toBe(C)
    expect(selectCoverer([holder(A, 35, true), holder(E, 50, false)], next).targetWeaponId).toBe(E)
    expect(() => selectCoverer([], next)).toThrow(GlobalAssignmentInvariantError)
  })
})

describe('Phase C-1 materialization order (design 8.2)', () => {
  it('places conversions by position, each after the Targets holding the Skill positions below it', () => {
    const { table, options } = twoConversionsTable(true)
    const assignment = assignmentOf(table, options)
    const coverage = feasible(checkStreamCoverage(assignment, table))
    const plan = deriveMaterializationOrder(assignment, table, coverage)
    expect(plan.order).toEqual([C, A, B])
    expect(plan.skillDependencies).toEqual([
      { targetWeaponId: A, conversionPosition: 15, prerequisiteTargetWeaponIds: [C] },
      { targetWeaponId: B, conversionPosition: 18, prerequisiteTargetWeaponIds: [C, A] },
    ])
    expect(deriveMaterializationOrder(assignment, table, coverage)).toEqual(plan)
  })

  it('also places a required-position owner below a conversion first, though it covers no gap there', () => {
    // D's Reset Skills sits at the Skill origin (no gap before it); E's chain covers 11 and 13..19.
    const table = coverageTable({ targets: [{ id: A, sources: [normalSource('owned.n.a')] }, { id: D, sources: [gogmaSource('owned.g.d')] }, { id: E, sources: [gogmaSource('owned.g.e')] }] })
    const assignment = assignmentOf(table, [
      option(table, A, normalSource('owned.n.a'), conversion(12, 12), reset(51)),
      option(table, D, gogmaSource('owned.g.d'), resetSkills(10), reset(52)),
      option(table, E, gogmaSource('owned.g.e'), resetSkills(20), reset(53)),
    ])
    const coverage = feasible(checkStreamCoverage(assignment, table))
    expect(segmentsOf(streamOf(coverage, 'skill')).slice(0, 3)).toEqual([['required', 10, 10, D], ['chain', 11, 11, E], ['required', 12, 12, A]])
    const plan = deriveMaterializationOrder(assignment, table, coverage)
    expect(plan.order).toEqual([D, E, A])
    expect(plan.skillDependencies).toEqual([{ targetWeaponId: A, conversionPosition: 12, prerequisiteTargetWeaponIds: [D, E] }])
  })

  it('orders the remaining Targets by max stream advance, then Target ID, each exactly once', () => {
    const table = coverageTable({ targets: [
      { id: A, sources: [skillIdealGogma('owned.g.a')] },
      { id: B, sources: [skillIdealGogma('owned.g.b')] },
      { id: C, sources: [gogmaSource('owned.g.c')] },
      { id: D, sources: [skillIdealGogma('owned.g.d')] },
    ] })
    const assignment = assignmentOf(table, [
      option(table, A, skillIdealGogma('owned.g.a'), NONE, reset(58)), // advance 9
      option(table, B, skillIdealGogma('owned.g.b'), NONE, reset(53)), // advance 4
      option(table, C, gogmaSource('owned.g.c'), resetSkills(13), reset(51)), // advance max(4, 2) = 4
      option(table, D, skillIdealGogma('owned.g.d'), NONE, reset(70)), // advance 21
    ])
    const plan = deriveMaterializationOrder(assignment, table, feasible(checkStreamCoverage(assignment, table)))
    expect(plan.order).toEqual([B, C, A, D])
    expect(plan.skillDependencies).toEqual([])
  })

  it('fails closed when a Skill position below a conversion belongs to the Target itself or to a later conversion', () => {
    const { table, options } = twoConversionsTable(true)
    const assignment = assignmentOf(table, options)
    const coverage = feasible(checkStreamCoverage(assignment, table))
    const tamper = (coverer: string) => coverage.map(value => value.stream.kind !== 'skill' ? value
      : { ...value, segments: value.segments.map(segment => segment.from === 10 ? { ...segment, covererTargetWeaponId: targetId(coverer) } : segment) })
    for (const coverer of [A, B]) {
      let error: unknown
      try {
        deriveMaterializationOrder(assignment, table, tamper(coverer))
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(GlobalAssignmentInvariantError)
      expect((error as GlobalAssignmentInvariantError).code).toBe('coverage_invariant')
    }
  })
})

describe('Phase C-1 coverage input validation', () => {
  const { table, options } = twoConversionsTable(true)
  const valid = () => assignmentOf(table, options)

  it('rejects an option the ReachTable row does not offer, before any coverage judgement', () => {
    const foreign = option(coverageTable({ targets: [{ id: A, sources: [normalSource('owned.n.other')] }] }), A, normalSource('owned.n.other'), conversion(15, 20), reset(55))
    expect(checkStreamCoverage(assignmentOf(table, [foreign, ...options.slice(1)]), table)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_option' })
    const protectedTable = coverageTable({ targets: [{ id: A, sources: [gogmaSource('owned.g.p', { isProtected: true })] }] })
    const forged = option(protectedTable, A, gogmaSource('owned.g.p', { isProtected: true }), resetSkills(12), reset(55))
    expect(checkStreamCoverage(assignmentOf(protectedTable, [forged]), protectedTable)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_option' })
  })

  it('rejects an inconsistent requirement, stream end or window', () => {
    const tampered = [
      { ...options[0]!, streamEnd: { ...options[0]!.streamEnd, skill: 99 } },
      { ...options[0]!, skillRequired: conversion(21, 20) },
      { ...options[0]!, skillRequired: resetSkills(20) },
      { ...options[0]!, bonusRequired: reset(10) },
    ]
    for (const value of tampered) {
      expect(checkStreamCoverage(assignmentOf(table, [value, ...options.slice(1)]), table)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_option' })
    }
  })

  it('rejects a C1 / C2 conflict, a Target set mismatch and a tampered aggregate', () => {
    const shared = option(table, B, normalSource('owned.n.b'), conversion(15, 24), reset(60))
    expect(checkStreamCoverage(assignmentOf(table, [options[0]!, shared, options[2]!]), table)).toMatchObject({ kind: 'invalid_input', reason: 'resource_conflict' })
    expect(checkStreamCoverage(assignmentOf(table, options.slice(0, 2)), table)).toMatchObject({ kind: 'invalid_input', reason: 'planning_target_mismatch' })
    expect(checkStreamCoverage({ ...valid(), objective: valid().objective - 1 }, table)).toMatchObject({ kind: 'invalid_input', reason: 'aggregate_mismatch' })
    expect(checkStreamCoverage({ ...valid(), streamEnd: { ...valid().streamEnd, gogma: 70 } }, table)).toMatchObject({ kind: 'invalid_input', reason: 'aggregate_mismatch' })
    expect(checkStreamCoverage({ ...valid(), requiredPositions: { ...valid().requiredPositions, skill: [15, 18] } }, table)).toMatchObject({ kind: 'invalid_input', reason: 'aggregate_mismatch' })
    expect(checkStreamCoverage({ ...valid(), assignmentOrder: [targetId(A)] }, table)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_candidate' })
    expect(checkStreamCoverage(valid(), table).kind).toBe('feasible')
  })
})
