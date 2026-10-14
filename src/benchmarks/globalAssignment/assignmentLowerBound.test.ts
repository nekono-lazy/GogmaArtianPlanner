import { describe, expect, it } from 'vitest'
import { applyReachOption, createEmptyPartialAssignment, findResourceViolation } from './assignmentFeasibility'
import { createTargetStreamMenus, minimalStreamEnds, partialAssignmentLowerBound } from './assignmentLowerBound'
import { bruteForceAssignments, bruteMinCompletionObjective, COUNTER_A, COUNTER_B, gogmaSource, handBuiltReachTable, newNormalSource, noBonus, normalSource } from './assignmentTestFixture'
import { enumerateReachOptions } from './reachOptions'
import type { ReachOption, ReachTable } from './types'

/*
 * Issue #154 Global Assignment Phase B-1 (design 10.1): `LB(partial)` never exceeds the objective of
 * any completion of the partial assignment, judged against the brute force, and it reads resources only.
 */
// The Phase B-1 modules live in the Production Domain module since Issue #260 PR-2 (the Research files are adapters), so the
// dependency direction is checked there, by the same module names.
const research = Object.fromEntries(Object.entries(import.meta.glob('../../domain/planner/buildListOptimization/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
  .map(([path, source]) => [path.replace('../../domain/planner/buildListOptimization/', './'), source]))

function twoTargets(): ReachTable {
  return handBuiltReachTable({ targets: [
    { id: 'target.a', sources: [newNormalSource(4, 'I'), newNormalSource(5), newNormalSource(6)] },
    { id: 'target.b', sources: [newNormalSource(4, 'I'), newNormalSource(5), newNormalSource(6)] },
  ] }).table
}

function threeTargetsTwoCounters(): ReachTable {
  return handBuiltReachTable({ originNormal: { [COUNTER_A]: 4, [COUNTER_B]: 20 }, window: { skill: 4, gogma: 6, normal: 2 }, targets: [
    { id: 'target.a', sources: [gogmaSource('g1'), newNormalSource(4, 'I')], skill: { idealPositions: [8, 9] } },
    { id: 'target.b', sources: [normalSource('n1', 'I'), newNormalSource(5)], skill: { idealPositions: [9, 10] } },
    { id: 'target.c', weaponTypeId: 'weapon.fixture.b', normalCounterId: COUNTER_B, sources: [newNormalSource(20, 'L', COUNTER_B), newNormalSource(21, 'X', COUNTER_B)],
      skill: { idealPositions: [8, 10] }, bonus: { resetIdealPositions: [13] } },
  ] }).table
}

/** Every partial assignment the brute force walks through, in Target order, with the exact min completion objective. */
function assertAdmissible(table: ReachTable): number {
  const menus = createTargetStreamMenus(table)
  let checked = 0
  const walk = (prefix: ReachOption[]) => {
    const partial = prefix.reduce((state, option) => applyReachOption(state, option), createEmptyPartialAssignment(table))
    const unassigned = table.targets.slice(prefix.length).map(target => menus.get(target.targetWeaponId)!)
    const bound = partialAssignmentLowerBound(partial, unassigned, table)
    const minimum = bruteMinCompletionObjective(table, prefix)
    if (minimum !== null) {
      expect(bound, `LB of ${prefix.map(option => option.targetWeaponId).join(',')} (${prefix.length} assigned)`).toBeLessThanOrEqual(minimum)
      checked += 1
    }
    const next = table.targets[prefix.length]
    if (!next) return
    for (const option of enumerateReachOptions(next, table)) {
      if (findResourceViolation(option, partial) !== null) continue
      if (bruteForceAssignments(table, [...prefix, option]).length === 0) {
        // Feasible so far but no completion: the bound may be anything, including +Infinity; it must still be a number.
        const stranded = applyReachOption(partial, option)
        expect(typeof partialAssignmentLowerBound(stranded, unassigned.slice(1), table)).toBe('number')
        continue
      }
      walk([...prefix, option])
    }
  }
  walk([])
  return checked
}

describe('Phase B-1 partial assignment lower bound', () => {
  it('is admissible on every brute-force prefix of a two-Target shared-stream table', () => {
    expect(assertAdmissible(twoTargets())).toBeGreaterThan(100)
  })

  it('is admissible on a three-Target table with owned sources and a second Normal Counter', () => {
    expect(assertAdmissible(threeTargetsTwoCounters())).toBeGreaterThan(50)
  })

  it('equals Σ (floor − origin) at the root and never falls below the assigned stream ends', () => {
    const table = twoTargets()
    const menus = [...createTargetStreamMenus(table).values()]
    const empty = createEmptyPartialAssignment(table)
    // Both Targets: first Ideal Skill 8 -> end 9; cheapest Gogma end 12 (Keep from layout I at 11); cheapest forge 4 -> end 5.
    expect(partialAssignmentLowerBound(empty, menus, table)).toBe(2 + 2 + 1)
    const first = [...enumerateReachOptions(table.targets[0]!, table)].find(option => option.streamEnd.skill === 11 && option.streamEnd.gogma === 16 && option.streamEnd.normal[COUNTER_A] === 7)!
    const partial = applyReachOption(empty, first)
    // The assigned ends (11 / 16 / 7) dominate every floor: LB = objective so far = 4 + 6 + 3.
    expect(partialAssignmentLowerBound(partial, menus.slice(1), table)).toBe(13)
    expect(partialAssignmentLowerBound(partial, menus.slice(1), table)).toBeLessThanOrEqual(bruteMinCompletionObjective(table, [first])!)
  })

  it('reports +Infinity when an unassigned Target has no unused source or no unused position on a stream', () => {
    const { table } = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [gogmaSource('g')] },
      { id: 'target.b', sources: [gogmaSource('g')] },
      { id: 'target.c', sources: [gogmaSource('h')], skill: { idealPositions: [8] }, bonus: noBonus() },
    ] })
    const menus = createTargetStreamMenus(table)
    const [a, b, c] = table.targets
    const taken = applyReachOption(createEmptyPartialAssignment(table), [...enumerateReachOptions(a!, table)][0]!)
    expect(minimalStreamEnds(menus.get(b!.targetWeaponId)!, taken, table)).toEqual({ skill: Number.POSITIVE_INFINITY, gogma: Number.POSITIVE_INFINITY, normal: { counterId: COUNTER_A, end: Number.POSITIVE_INFINITY } })
    expect(partialAssignmentLowerBound(taken, [menus.get(b!.targetWeaponId)!], table)).toBe(Number.POSITIVE_INFINITY)
    // c has a source and a Skill position but no Bonus requirement at all: Gogma +Infinity, Skill finite.
    const ends = minimalStreamEnds(menus.get(c!.targetWeaponId)!, createEmptyPartialAssignment(table), table)
    expect(ends.skill).toBe(9)
    expect(ends.gogma).toBe(Number.POSITIVE_INFINITY)
    expect(ends.normal).toEqual({ counterId: COUNTER_A, end: 4 })
  })

  it('relaxes per stream: an owned source keeps the Normal floor at its origin and the Reset of a reset_then_keep is ignored', () => {
    const { table } = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [normalSource('n', 'X'), newNormalSource(6)], bonus: { resetIdealPositions: [] } },
    ] })
    const menu = createTargetStreamMenus(table).get(table.targets[0]!.targetWeaponId)!
    const empty = createEmptyPartialAssignment(table)
    // Gogma: only reset_then_keep remains (finals 13 / 15), the Reset position is not required to be free.
    expect(minimalStreamEnds(menu, empty, table)).toEqual({ skill: 9, gogma: 14, normal: { counterId: COUNTER_A, end: 4 } })
    const usedNormal = { ...empty, usedSources: new Set(['owned:n']) }
    expect(minimalStreamEnds(menu, usedNormal, table).normal).toEqual({ counterId: COUNTER_A, end: 7 })
    const usedGogma = { ...empty, usedGogmaPositions: new Set([13]) }
    expect(minimalStreamEnds(menu, usedGogma, table).gogma).toBe(16)
  })

  it('depends one way: feasibility reads no bound, the bound reads no enumeration, filter or solver, only the solver prunes', () => {
    const importsOf = (path: string) => [...research[path]!.matchAll(/from '([^']+)'/g)].map(match => match[1]!).sort()
    expect(importsOf('./assignmentFeasibility.ts')).toEqual(['./assignmentTypes', './buildListOptimizationTypes', './reachOptions'])
    expect(importsOf('./assignmentLowerBound.ts')).toEqual(['./assignmentTypes', './buildListOptimizationTypes', './reachOptions'])
    expect(importsOf('./assignmentOrdering.ts')).toEqual(['./assignmentFeasibility', './assignmentTypes', './buildListOptimizationTypes', './reachOptions'])
    expect(importsOf('./assignmentSolver.ts')).toEqual(['./assignmentFeasibility', './assignmentLowerBound', './assignmentOrdering', './assignmentTypes', './buildListOptimizationTypes', './reachOptions'])
    // The bound names no option enumeration and no feasibility filter; the comparison against an upper bound lives in the solver alone.
    expect(research['./assignmentLowerBound.ts']).not.toMatch(/findResourceViolation|enumerateReachOptions|countFeasibleOptionsUpTo|readVerifiedUpperBound|physicalOperations/)
    expect(research['./assignmentFeasibility.ts']).not.toMatch(/partialAssignmentLowerBound|minimalStreamEnds|readVerifiedUpperBound/)
    expect(research['./assignmentOrdering.ts']).not.toMatch(/partialAssignmentLowerBound|minimalStreamEnds|readVerifiedUpperBound/)
  })
})
