import { describe, expect, it } from 'vitest'
import type { OwnedWeapon, RestorationBonusSet } from '../../domain/models/publicTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { applyReachOption, createEmptyPartialAssignment } from './assignmentFeasibility'
import { collectResourceAssignments, createResourceAssignmentSearch } from './assignmentSolver'
import {
  assignmentKeyOf, bruteForceAssignments, COUNTER_A, COUNTER_B, denseResetThenKeepBonus, gogmaSource, handBuiltReachTable, newNormalSource, noBonus, normalSource, targetId,
} from './assignmentTestFixture'
import type {
  ExpandedNodeInfo, PlanningTargetPriority, ResourceAssignmentCandidate, ResourceAssignmentSearch, ResourceAssignmentSearchRequest, VerifiedUpperBound,
} from './assignmentTypes'
import { createGlobalAssignmentContext } from './context'
import { reachOptionKey } from './reachOptions'
import { buildReachTable } from './reachTable'
import { createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, layoutKeyOf, OTHER_FAMILIES, ownedGogma } from './testFixture'
import { REACH_OPTION_SET_A1, type ReachTable, type ReachWindow } from './types'

/*
 * Issue #154 Global Assignment Phase B-1 (design 6.3 / 6.4 / 6.5 / 10.1 / 12 / 13.1 Phase B): the
 * deterministic MRV backtracking generator over hand-built ReachTables, judged against the independent
 * brute-force enumerator of `assignmentTestFixture.ts`. No oracle, no real Target or weapon ID.
 */
const REQUEST: ResourceAssignmentSearchRequest = { nodeBudget: 1_000_000, mrvLookahead: 8 }
type Built = ReturnType<typeof handBuiltReachTable>

function searchOf(built: Built, request: Partial<ResourceAssignmentSearchRequest> = {}): ResourceAssignmentSearch {
  const created = createResourceAssignmentSearch(built.table, built.planningTargets, { ...REQUEST, ...request })
  if (created.kind !== 'search') throw new Error(`${created.reason}: ${created.detail}`)
  return created.search
}

function drain(search: ResourceAssignmentSearch, maxNodes?: number) {
  const candidates: ResourceAssignmentCandidate[] = []
  let paused = 0
  while (true) {
    const event = search.next(maxNodes)
    if (event.kind === 'candidate') candidates.push(event.candidate)
    else if (event.kind === 'paused') paused += 1
    else return { candidates, completeness: event.completeness, paused, diagnostics: search.diagnostics }
  }
}

const keysOf = (candidates: readonly ResourceAssignmentCandidate[]) => candidates.map(candidate => assignmentKeyOf(candidate.chosen.values()))
const optionKey = (candidate: ResourceAssignmentCandidate, target: string) => reachOptionKey(candidate.chosen.get(targetId(target))!)

/** The solver's exhausted candidate set equals the brute force, with equal objectives and no duplicate. */
function expectBruteForceParity(built: Built, request: Partial<ResourceAssignmentSearchRequest> = {}) {
  const brute = bruteForceAssignments(built.table)
  const run = drain(searchOf(built, request))
  expect(run.completeness).toBe('exhausted')
  const keys = keysOf(run.candidates)
  expect(new Set(keys).size).toBe(keys.length)
  expect([...keys].sort()).toEqual(brute.map(assignment => assignment.key).sort())
  const objectiveByKey = new Map(brute.map(assignment => [assignment.key, assignment.objective]))
  for (const candidate of run.candidates) expect(candidate.objective).toBe(objectiveByKey.get(assignmentKeyOf(candidate.chosen.values())))
  if (brute.length > 0) expect(run.diagnostics.bestAssignment?.objective).toBe(Math.min(...brute.map(assignment => assignment.objective)))
  expect(run.diagnostics.pruned).toBe(0)
  return { brute, run }
}

const threeNewNormals = () => [newNormalSource(4, 'I'), newNormalSource(5), newNormalSource(6)]

/** Two Targets of one weapon type / element sharing every stream and the same three forge positions (the fire / dragon shape). */
function sharedStreams(): Built {
  return handBuiltReachTable({ targets: [{ id: 'target.a', sources: threeNewNormals() }, { id: 'target.b', sources: threeNewNormals() }] })
}

/** Three Targets, two Normal Counters, owned Gogma / owned Normal / new Normal sources. */
function threeTargets(): Built {
  return handBuiltReachTable({ originNormal: { [COUNTER_A]: 4, [COUNTER_B]: 20 }, window: { skill: 4, gogma: 6, normal: 2 }, targets: [
    { id: 'target.a', sources: [gogmaSource('g1'), newNormalSource(4, 'I')], skill: { idealPositions: [8, 9] } },
    { id: 'target.b', sources: [normalSource('n1', 'I'), newNormalSource(5)], skill: { idealPositions: [9, 10] } },
    { id: 'target.c', weaponTypeId: 'weapon.fixture.b', normalCounterId: COUNTER_B, sources: [newNormalSource(20, 'L', COUNTER_B), newNormalSource(21, 'X', COUNTER_B)],
      skill: { idealPositions: [8, 10] }, bonus: { resetIdealPositions: [13] } },
  ] })
}

describe('Phase B-1 resource assignment solver against the brute force', () => {
  it('generates exactly the brute-force assignment set of two Targets sharing every stream', () => {
    const { brute, run } = expectBruteForceParity(sharedStreams())
    expect(brute.length).toBeGreaterThan(100)
    // The minimum (9 = Skill 4 + Gogma 3 + Normal 2) needs the one layout-I forge Kept at 11 by one Target and a Reset at 12 by the other.
    const minimum = run.candidates.filter(candidate => candidate.objective === 9)
    expect(minimum.length).toBeGreaterThan(0)
    for (const candidate of minimum) {
      const kinds = [optionKey(candidate, 'target.a'), optionKey(candidate, 'target.b')].map(key => key.split('|')[3]!.split(':')[0]).sort()
      expect(kinds).toEqual(['keep_from_source', 'reset'])
      expect(candidate.streamEnd).toEqual({ skill: 11, gogma: 13, normal: { [COUNTER_A]: 6 } })
    }
  })

  it('generates exactly the brute-force assignment set of three Targets over two Normal Counters and owned sources', () => {
    const { brute } = expectBruteForceParity(threeTargets())
    expect(brute.length).toBeGreaterThan(10)
  })

  it('agrees with the brute force whatever the MRV lookahead, which changes only the Target order', () => {
    const built = threeTargets()
    const expected = [...keysOf(drain(searchOf(built, { mrvLookahead: 1 })).candidates)].sort()
    for (const mrvLookahead of [2, 5, 10_000]) expect([...keysOf(drain(searchOf(built, { mrvLookahead })).candidates)].sort(), String(mrvLookahead)).toEqual(expected)
  })
})

describe('Phase B-1 C1 / C2 exclusivity', () => {
  it('never assigns one OwnedWeapon or one Normal production target to two Targets', () => {
    const ownedOnly = handBuiltReachTable({ targets: [{ id: 'target.a', sources: [gogmaSource('g')] }, { id: 'target.b', sources: [gogmaSource('g')] }] })
    const result = collectResourceAssignments(ownedOnly.table, ownedOnly.planningTargets, REQUEST, 1000)
    expect(result.status).toBe('no_resource_assignment')
    if (result.status === 'no_resource_assignment') {
      expect(result.reason).toBe('resource_exclusivity')
      expect(result.targetsWithoutOption).toEqual([])
      expect(result.diagnostics.rejections.source).toBeGreaterThan(0)
    }
    const oneForge = handBuiltReachTable({ window: { skill: 4, gogma: 6, normal: 1 }, targets: [{ id: 'target.a', sources: [newNormalSource(4)] }, { id: 'target.b', sources: [newNormalSource(4)] }] })
    expect(collectResourceAssignments(oneForge.table, oneForge.planningTargets, REQUEST, 1000)).toMatchObject({ status: 'no_resource_assignment', reason: 'resource_exclusivity' })
    const twoOwned = handBuiltReachTable({ targets: [{ id: 'target.a', sources: [gogmaSource('g'), gogmaSource('h')] }, { id: 'target.b', sources: [gogmaSource('g'), gogmaSource('h')] }] })
    const { run } = expectBruteForceParity(twoOwned)
    expect(run.candidates.length).toBeGreaterThan(0)
    for (const candidate of run.candidates) expect(new Set(candidate.usedSources).size).toBe(2)
  })

  it('never lets two options share a required Skill position or a required Gogma position', () => {
    const skillClash = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [gogmaSource('g')], skill: { idealPositions: [8] } }, { id: 'target.b', sources: [gogmaSource('h')], skill: { idealPositions: [8] } },
    ] })
    expect(collectResourceAssignments(skillClash.table, skillClash.planningTargets, REQUEST, 1000)).toMatchObject({ status: 'no_resource_assignment', reason: 'resource_exclusivity' })
    const skillRoom = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [gogmaSource('g')], skill: { idealPositions: [8] } }, { id: 'target.b', sources: [gogmaSource('h')], skill: { idealPositions: [8, 9] } },
    ] })
    const { run } = expectBruteForceParity(skillRoom)
    for (const candidate of run.candidates) expect(candidate.requiredPositions.skill).toEqual([8, 9])
    const gogmaClash = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [gogmaSource('g')], bonus: { ...noBonus(), resetIdealPositions: [12] } }, { id: 'target.b', sources: [gogmaSource('h')], bonus: { ...noBonus(), resetIdealPositions: [12] } },
    ] })
    const clash = collectResourceAssignments(gogmaClash.table, gogmaClash.planningTargets, REQUEST, 1000)
    expect(clash).toMatchObject({ status: 'no_resource_assignment', reason: 'resource_exclusivity' })
    if (clash.status === 'no_resource_assignment') expect(clash.diagnostics.rejections.gogma_position).toBeGreaterThan(0)
    const gogmaRoom = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [gogmaSource('g')], bonus: { ...noBonus(), resetIdealPositions: [12] } }, { id: 'target.b', sources: [gogmaSource('h')], bonus: { ...noBonus(), resetIdealPositions: [12, 13] } },
    ] })
    for (const candidate of expectBruteForceParity(gogmaRoom).run.candidates) expect(candidate.requiredPositions.gogma).toEqual([12, 13])
  })

  it('keeps the Normal Counters of different weapon types independent at one numeric position', () => {
    const built = handBuiltReachTable({ originNormal: { [COUNTER_A]: 4, [COUNTER_B]: 4 }, window: { skill: 4, gogma: 6, normal: 1 }, targets: [
      { id: 'target.a', sources: [newNormalSource(4)], skill: { idealPositions: [8] }, bonus: { ...noBonus(), resetIdealPositions: [12] } },
      { id: 'target.b', weaponTypeId: 'weapon.fixture.b', normalCounterId: COUNTER_B, sources: [newNormalSource(4, 'X', COUNTER_B)], skill: { idealPositions: [10] }, bonus: { ...noBonus(), resetIdealPositions: [13] } },
    ] })
    const { run } = expectBruteForceParity(built)
    expect(run.candidates.length).toBeGreaterThan(0)
    expect(run.candidates[0]!.requiredPositions.normal).toEqual({ [COUNTER_A]: [4], [COUNTER_B]: [4] })
    expect(run.candidates[0]!.objective).toBe(4 + 4 + 1 + 1)
  })

  it('lets a required Reset sit on the skippable chain position between another Target\'s Reset and Keep', () => {
    const built = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [gogmaSource('g')], skill: { idealPositions: [8] }, bonus: { resetIdealPositions: [] } },   // only Reset -> Keep pairs
      { id: 'target.b', sources: [gogmaSource('h')], skill: { idealPositions: [10] }, bonus: { ...noBonus(), resetIdealPositions: [12] } },
    ] })
    const { run } = expectBruteForceParity(built)
    const coexisting = run.candidates.find(candidate => optionKey(candidate, 'target.a').endsWith('reset_then_keep:11:13') && optionKey(candidate, 'target.b').endsWith('reset:12'))
    expect(coexisting).toBeDefined()
    expect(coexisting!.requiredPositions.gogma).toEqual([11, 12, 13])
    expect(run.candidates.some(candidate => optionKey(candidate, 'target.a').endsWith('reset_then_keep:12:13'))).toBe(false)
  })

  it('treats a conversion whose Skill is Ideal at once as one required Skill position', () => {
    const built = handBuiltReachTable({ targets: [
      { id: 'target.a', sources: [normalSource('n1')], skill: { idealPositions: [8] }, bonus: { ...noBonus(), resetIdealPositions: [12] } },
      { id: 'target.b', sources: [normalSource('n2')], skill: { idealPositions: [10] }, bonus: { ...noBonus(), resetIdealPositions: [13] } },
    ] })
    const { run } = expectBruteForceParity(built)
    const pairs = run.candidates.map(candidate => [optionKey(candidate, 'target.a').split('|')[2], optionKey(candidate, 'target.b').split('|')[2]] as const)
    expect(pairs).toContainEqual(['conversion:8:8', 'conversion:7:10'])
    expect(pairs).toContainEqual(['conversion:8:8', 'conversion:10:10'])
    expect(pairs).not.toContainEqual(['conversion:8:8', 'conversion:8:10'])
    expect(pairs).not.toContainEqual(['conversion:7:8', 'conversion:7:10'])
    const single = run.candidates.find(candidate => optionKey(candidate, 'target.a').includes('conversion:8:8') && optionKey(candidate, 'target.b').includes('conversion:10:10'))!
    expect(single.requiredPositions.skill).toEqual([8, 10])
  })
})

describe('Phase B-1 objective', () => {
  it('counts a shared stream once and each Normal Counter separately, and keeps the partial stream ends monotone', () => {
    const built = threeTargets()
    const { run } = expectBruteForceParity(built)
    const perTargetSumOf = (candidate: ResourceAssignmentCandidate) => [...candidate.chosen.values()].reduce((sum, option) => sum + (option.streamEnd.skill - 7) + (option.streamEnd.gogma - 10)
      + Object.entries(option.streamEnd.normal).reduce((inner, [counterId, end]) => inner + end - built.table.originNormal[counterId]!, 0), 0)
    for (const candidate of run.candidates) {
      expect(candidate.objective).toBeLessThanOrEqual(perTargetSumOf(candidate))
      expect(candidate.objective).toBe((candidate.streamEnd.skill - 7) + (candidate.streamEnd.gogma - 10) + (candidate.streamEnd.normal[COUNTER_A]! - 4) + (candidate.streamEnd.normal[COUNTER_B]! - 20))
      let partial = createEmptyPartialAssignment(built.table)
      for (const id of candidate.assignmentOrder) {
        const next = applyReachOption(partial, candidate.chosen.get(id)!)
        expect(next.streamEnd.skill).toBeGreaterThanOrEqual(partial.streamEnd.skill)
        expect(next.streamEnd.gogma).toBeGreaterThanOrEqual(partial.streamEnd.gogma)
        for (const counterId of Object.keys(partial.streamEnd.normal)) expect(next.streamEnd.normal[counterId]).toBeGreaterThanOrEqual(partial.streamEnd.normal[counterId]!)
        partial = next
      }
      expect(partial.streamEnd).toEqual(candidate.streamEnd)
    }
    // Three Targets advance the shared Skill and Gogma streams: the assignment counts each stream once, not per Target.
    expect(run.candidates.some(candidate => candidate.objective < perTargetSumOf(candidate))).toBe(true)
  })
})

describe('Phase B-1 MRV and backtracking', () => {
  const trace = (built: Built, request: Partial<ResourceAssignmentSearchRequest> = {}) => {
    const nodes: ExpandedNodeInfo[] = []
    const run = drain(searchOf(built, { ...request, onNodeExpanded: node => nodes.push(node) }))
    return { nodes, run }
  }

  it('expands the Target with the fewest feasible options first', () => {
    const built = handBuiltReachTable({ targets: [
      { id: 'target.many', sources: threeNewNormals() },
      { id: 'target.one', sources: [gogmaSource('g', { currentSkillIdeal: true, currentBonusIdeal: true, isProtected: true })] },
    ] })
    const { nodes } = trace(built)
    expect(nodes[0]).toEqual({ nodes: 1, depth: 0, selectedTarget: 'target.one', feasibleOptionsUpToLookahead: 1 })
    expect(nodes[1]).toMatchObject({ depth: 1, selectedTarget: 'target.many', feasibleOptionsUpToLookahead: 8 })
  })

  it('breaks an option-count tie by Target priority descending, then Target ID ascending', () => {
    const single = (id: string, weapon: string, priority: 1 | 2 | 3 | 4 | 5) => ({ id, priority, sources: [gogmaSource(weapon, { currentSkillIdeal: true, currentBonusIdeal: true })] })
    const byPriority = trace(handBuiltReachTable({ targets: [single('target.a', 'g', 3), single('target.b', 'h', 5), single('target.c', 'i', 4)] }))
    expect(byPriority.nodes.map(node => node.selectedTarget)).toEqual(['target.b', 'target.c', 'target.a', null])
    const byId = trace(handBuiltReachTable({ targets: [single('target.c', 'g', 3), single('target.b', 'h', 3), single('target.a', 'i', 3)] }))
    expect(byId.nodes.map(node => node.selectedTarget)).toEqual(['target.a', 'target.b', 'target.c', null])
  })

  it('backtracks past values that strand the other Target and counts the C2 rejections and dead ends', () => {
    // Lookahead 1 ties the counts, so priority sends Target a first; a's cheapest values use Skill 8 or Reset 12, which b (one option) needs.
    const built = handBuiltReachTable({ targets: [
      { id: 'target.a', priority: 5, sources: [gogmaSource('g1')] },
      { id: 'target.b', priority: 3, sources: [gogmaSource('g2')], skill: { idealPositions: [8] }, bonus: { ...noBonus(), resetIdealPositions: [12] } },
    ] })
    const { nodes, run } = trace(built, { mrvLookahead: 1 })
    expect(nodes[0]).toMatchObject({ selectedTarget: 'target.a', feasibleOptionsUpToLookahead: 1 })
    expect(run.diagnostics.deadEnds).toBeGreaterThan(0)
    expect(run.diagnostics.deadEndsByTarget).toEqual({ 'target.b': run.diagnostics.deadEnds })
    expect(run.diagnostics.rejections.skill_position).toBeGreaterThan(0)
    expect(run.diagnostics.rejections.gogma_position).toBeGreaterThan(0)
    const brute = bruteForceAssignments(built.table)
    expect([...keysOf(run.candidates)].sort()).toEqual(brute.map(assignment => assignment.key).sort())
    for (const candidate of run.candidates) expect(optionKey(candidate, 'target.a')).toMatch(/reset_skills:10\|reset_then_keep:1[14]:1[35]$/)
  })
})

describe('Phase B-1 determinism, yield and resume', () => {
  it('produces the same node sequence and candidate sequence on every run of one input', () => {
    const built = threeTargets()
    const record = () => {
      const nodes: ExpandedNodeInfo[] = []
      const run = drain(searchOf(built, { onNodeExpanded: node => nodes.push(node) }))
      return { nodes, keys: keysOf(run.candidates), ordinals: run.candidates.map(candidate => candidate.ordinal), diagnostics: run.diagnostics }
    }
    const first = record(), second = record()
    expect(second.nodes).toEqual(first.nodes)
    expect(second.keys).toEqual(first.keys)
    expect(first.ordinals).toEqual(first.keys.map((_, index) => index))
    expect(second.diagnostics).toEqual(first.diagnostics)
  })

  it('resumes after a pause from the same node and never regenerates a candidate', () => {
    const built = sharedStreams()
    const uninterrupted = drain(searchOf(built))
    const paused = drain(searchOf(built), 1)
    expect(paused.paused).toBeGreaterThan(0)
    expect(keysOf(paused.candidates)).toEqual(keysOf(uninterrupted.candidates))
    expect(paused.completeness).toBe('exhausted')
    expect(paused.diagnostics.expandedNodes).toBe(uninterrupted.diagnostics.expandedNodes)
    const stepped = drain(searchOf(built), 7)
    expect(keysOf(stepped.candidates)).toEqual(keysOf(uninterrupted.candidates))
  })

  it('reports the same end again after finishing and refuses a non-positive pause step', () => {
    const search = searchOf(sharedStreams())
    const run = drain(search)
    expect(run.completeness).toBe('exhausted')
    expect(search.next()).toEqual({ kind: 'finished', completeness: 'exhausted' })
    expect(search.diagnostics.completeness).toBe('exhausted')
    expect(() => search.next(0)).toThrow(RangeError)
  })
})

describe('Phase B-1 lower bound and verified upper bound', () => {
  const verified = (physicalOperations: number): VerifiedUpperBound => ({ physicalOperations, provenance: 'production_verified_plan' })

  it('prunes nothing without a verified upper bound and never promotes its own best assignment to one', () => {
    const { brute, run } = expectBruteForceParity(sharedStreams())
    const objectives = run.candidates.map(candidate => candidate.objective)
    const firstMinimum = objectives.indexOf(Math.min(...objectives))
    expect(objectives.slice(firstMinimum + 1).some(objective => objective > objectives[firstMinimum]!)).toBe(true)
    expect(run.diagnostics.bestAssignment).toEqual({ ordinal: firstMinimum, objective: 9 })
    expect(run.candidates.length).toBe(brute.length)
  })

  it('cuts only branches whose lower bound reaches the verified upper bound and keeps every cheaper assignment', () => {
    const built = sharedStreams()
    const brute = bruteForceAssignments(built.table)
    for (const upperBound of [10, 11, 12]) {
      const run = drain(searchOf(built, { readVerifiedUpperBound: () => verified(upperBound) }))
      expect(run.completeness).toBe('exhausted')
      expect(run.diagnostics.pruned).toBeGreaterThan(0)
      expect([...keysOf(run.candidates)].sort(), String(upperBound)).toEqual(brute.filter(assignment => assignment.objective < upperBound).map(assignment => assignment.key).sort())
    }
    const atMinimum = collectResourceAssignments(built.table, built.planningTargets, { ...REQUEST, readVerifiedUpperBound: () => verified(9) }, 1000)
    expect(atMinimum).toMatchObject({ status: 'no_resource_assignment', reason: 'upper_bound_pruning', completeness: 'exhausted' })
  })

  it('reads the upper bound anew before every expansion, so a bound arriving mid-search applies from then on', () => {
    const built = sharedStreams()
    let bound: VerifiedUpperBound | null = null
    const search = searchOf(built, { readVerifiedUpperBound: () => bound })
    const first = search.next()
    expect(first.kind).toBe('candidate')
    bound = verified(10)
    const rest = drain(search)
    expect(rest.diagnostics.pruned).toBeGreaterThan(0)
    for (const candidate of rest.candidates) expect(candidate.objective).toBeLessThan(10)
  })

  it('refuses a number that is not a Production-verified physical operation count', () => {
    const search = searchOf(sharedStreams(), { readVerifiedUpperBound: () => ({ physicalOperations: 9, provenance: 'best_structural' as unknown as 'production_verified_plan' }) })
    expect(() => search.next()).toThrow(RangeError)
    expect(() => searchOf(sharedStreams(), { readVerifiedUpperBound: () => verified(9.5) }).next()).toThrow(RangeError)
  })
})

describe('Phase B-1 budget, cancel and result classification', () => {
  it('stops at the node budget as node_budget_reached and completes within a sufficient one', () => {
    const built = sharedStreams()
    const tiny = drain(searchOf(built, { nodeBudget: 1 }))
    expect(tiny.completeness).toBe('node_budget_reached')
    expect(tiny.candidates).toEqual([])
    expect(tiny.diagnostics.expandedNodes).toBe(1)
    const some = collectResourceAssignments(built.table, built.planningTargets, { ...REQUEST, nodeBudget: 40 }, 1000)
    expect(some.status).toBe('search_incomplete')
    if (some.status === 'search_incomplete') {
      expect(some.completeness).toBe('node_budget_reached')
      expect(some.diagnostics.expandedNodes).toBe(40)
      expect(some.candidates.length).toBeGreaterThan(0)
      expect(some.diagnostics.bestAssignment).not.toBeNull()
    }
    const full = collectResourceAssignments(built.table, built.planningTargets, REQUEST, 100_000)
    expect(full.status).toBe('assignments_found')
    if (full.status === 'assignments_found') expect(full.completeness).toBe('exhausted')
  })

  it('reports a cancel as cancelled, apart from exhaustion and from the budget, and keeps the candidates confirmed before it in order', () => {
    const built = sharedStreams()
    let polls = 0
    const result = collectResourceAssignments(built.table, built.planningTargets, { ...REQUEST, shouldCancel: () => ++polls > 25 }, 1000)
    expect(result.status).toBe('search_incomplete')
    if (result.status === 'search_incomplete') {
      expect(result.completeness).toBe('cancelled')
      expect(result.diagnostics.completeness).toBe('cancelled')
      const uninterrupted = drain(searchOf(built))
      expect(keysOf(result.candidates)).toEqual(keysOf(uninterrupted.candidates).slice(0, result.candidates.length))
    }
  })

  it('polls the cancel seam inside a long option walk of one node and reports nothing of that node', () => {
    // Target a (one option, Skill 8) is assigned first; Target b's 125,250 options all need Skill 8, so its MRV count walks every one.
    const built = handBuiltReachTable({ window: { skill: 4, gogma: 1000, normal: 3 }, targets: [
      { id: 'target.a', priority: 5, sources: [gogmaSource('g1')], skill: { idealPositions: [8] }, bonus: { ...noBonus(), resetIdealPositions: [12] } },
      { id: 'target.b', priority: 3, sources: [gogmaSource('g2')], skill: { idealPositions: [8] }, bonus: denseResetThenKeepBonus() },
    ] })
    let polls = 0
    const cancelled = drain(searchOf(built, { shouldCancel: () => ++polls >= 3 }))
    expect(cancelled.completeness).toBe('cancelled')
    expect(cancelled.candidates).toEqual([])
    expect(polls).toBe(3)
    // The walk was cut inside the second node: the dead end and its exact rejection count were never reached.
    expect(cancelled.diagnostics.expandedNodes).toBe(2)
    expect(cancelled.diagnostics.deadEnds).toBe(0)
    expect(cancelled.diagnostics.rejections.skill_position).toBe(0)
    const uninterrupted = drain(searchOf(built))
    expect(uninterrupted.completeness).toBe('exhausted')
    expect(uninterrupted.candidates).toEqual([])
    expect(uninterrupted.diagnostics.deadEnds).toBe(1)
    expect(uninterrupted.diagnostics.rejections.skill_position).toBe(125_250)
    const result = collectResourceAssignments(built.table, built.planningTargets, REQUEST, 10)
    expect(result).toMatchObject({ status: 'no_resource_assignment', reason: 'resource_exclusivity' })
  })

  it('distinguishes a Target without any option from an exclusivity dead end', () => {
    const empty = handBuiltReachTable({ targets: [{ id: 'target.a', sources: threeNewNormals() }, { id: 'target.none', sources: [] }] })
    const withoutOption = collectResourceAssignments(empty.table, empty.planningTargets, REQUEST, 1000)
    expect(withoutOption).toMatchObject({ status: 'no_resource_assignment', completeness: 'exhausted', reason: 'target_without_option', targetsWithoutOption: ['target.none'] })
    if (withoutOption.status === 'no_resource_assignment') {
      expect(withoutOption.diagnostics.expandedNodes).toBe(1)
      expect(withoutOption.window).toEqual(empty.table.window)
      expect(withoutOption.scanned).toEqual(empty.table.scanned)
    }
    const noRequirement = handBuiltReachTable({ targets: [{ id: 'target.a', sources: [gogmaSource('g')], bonus: noBonus() }] })
    expect(collectResourceAssignments(noRequirement.table, noRequirement.planningTargets, REQUEST, 1000)).toMatchObject({ status: 'no_resource_assignment', reason: 'target_without_option', targetsWithoutOption: ['target.a'] })
  })

  it('reaches the first complete assignment of a conflict-free six-Target table in depth-many nodes', () => {
    // Six owned Gogmas, six Ideal Skill positions and six Ideal Resets: every Target has 6 x 6 options and the first branch never strands anyone.
    const built = handBuiltReachTable({ window: { skill: 8, gogma: 10, normal: 3 }, targets: Array.from({ length: 6 }, (_, index) => ({
      id: `target.${index}`, sources: [gogmaSource(`g${index}`)],
      skill: { idealPositions: [8, 9, 10, 11, 12, 13], resetSkillsLimit: 14, conversionLimit: 15 },
      bonus: { ...noBonus(), resetIdealPositions: [12, 13, 14, 15, 16, 17] },
    })) })
    const search = searchOf(built, { nodeBudget: 10_000 })
    const first = search.next()
    expect(first.kind).toBe('candidate')
    expect(search.diagnostics.expandedNodes).toBe(7)
    expect(search.diagnostics.deadEnds).toBe(0)
    if (first.kind === 'candidate') {
      expect(first.candidate.requiredPositions.skill).toEqual([8, 9, 10, 11, 12, 13])
      expect(first.candidate.requiredPositions.gogma).toEqual([12, 13, 14, 15, 16, 17])
      expect(first.candidate.objective).toBe(7 + 8)
    }
    // The tree holds 6! x 6! complete assignments; a node budget bounds the walk and reports it as incomplete, never as "none".
    const bounded = collectResourceAssignments(built.table, built.planningTargets, { ...REQUEST, nodeBudget: 500 }, 1_000_000)
    expect(bounded.status).toBe('search_incomplete')
    if (bounded.status === 'search_incomplete') expect(bounded.candidates.length).toBeGreaterThan(0)
  })

  it('stops at the candidate limit without claiming exhaustion', () => {
    const built = sharedStreams()
    const result = collectResourceAssignments(built.table, built.planningTargets, REQUEST, 3)
    expect(result).toMatchObject({ status: 'assignments_found', completeness: 'candidate_limit_reached' })
    if (result.status === 'assignments_found') {
      expect(result.candidates.map(candidate => candidate.ordinal)).toEqual([0, 1, 2])
      expect(result.diagnostics.completeness).toBe('running')
    }
  })

  it('rejects an invalid request, an inconsistent table and a planning Target mismatch as typed input errors', () => {
    const built = sharedStreams()
    expect(createResourceAssignmentSearch(built.table, built.planningTargets, { nodeBudget: 0, mrvLookahead: 8 })).toMatchObject({ kind: 'invalid_input', reason: 'invalid_request' })
    expect(createResourceAssignmentSearch(built.table, built.planningTargets, { nodeBudget: 10, mrvLookahead: 1.5 })).toMatchObject({ kind: 'invalid_input', reason: 'invalid_request' })
    expect(createResourceAssignmentSearch(built.table, [...built.planningTargets].reverse(), REQUEST)).toMatchObject({ kind: 'invalid_input', reason: 'planning_target_mismatch' })
    expect(createResourceAssignmentSearch(built.table, built.planningTargets.slice(0, 1), REQUEST)).toMatchObject({ kind: 'invalid_input', reason: 'planning_target_mismatch' })
    const duplicated: ReachTable = { ...built.table, targets: [built.table.targets[0]!, built.table.targets[0]!] }
    expect(createResourceAssignmentSearch(duplicated, [built.planningTargets[0]!, built.planningTargets[0]!], REQUEST)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_reach_table' })
    const unknownCounter: ReachTable = { ...built.table, originNormal: {} }
    expect(createResourceAssignmentSearch(unknownCounter, built.planningTargets, REQUEST)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_reach_table' })
    const noTargets: ReachTable = { ...built.table, targets: [] }
    expect(createResourceAssignmentSearch(noTargets, [], REQUEST)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_reach_table' })
    expect(collectResourceAssignments(built.table, built.planningTargets, REQUEST, 0)).toMatchObject({ status: 'invalid_input', reason: 'invalid_candidate_limit' })
    expect(collectResourceAssignments(built.table, built.planningTargets, { nodeBudget: -1, mrvLookahead: 8 }, 5)).toMatchObject({ status: 'invalid_input', reason: 'invalid_request' })
  })
})

describe('Phase B-1 on a Phase A ReachTable', () => {
  const WINDOW: ReachWindow = { skill: 3, gogma: 4, normal: 3 }
  const SERIES_A = 'series_skill.fixture.a'
  const ELEMENT_A = 'element.fixture.a'
  const L_IDEAL = layoutKeyOf(IDEAL_BONUSES)
  const REORDERED_GOGMA: RestorationBonusSet = [
    { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.low' }, IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0],
    { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
  ]
  const IDEAL_ORDER_NORMAL: RestorationBonusSet = [IDEAL_BONUSES[0], IDEAL_BONUSES[1], IDEAL_BONUSES[2], IDEAL_BONUSES[3],
    { bonusTypeId: 'bonus_type.fixture.normal_sharpness', bonusRankId: 'bonus_rank.fixture.low' }]
  const skillAt = (series: string | null) => ({ seriesSkillId: series, groupSkillId: null })

  /** Element a: Ideal Skill at 8 / 10, Ideal Reset at 12, reordered Reset layout at 11, Keep-Ideal at 13 (any layout) and 11 (Ideal order). Element b: Skill 9, Reset 10, Keep 12. */
  function scanEngine() {
    return createTableEngine({
      skill: (position, _type, element) => skillAt((element === ELEMENT_A ? [8, 10] : [9]).includes(position) ? SERIES_A : 'series_skill.fixture.other'),
      reset: (position, _type, element) => element === ELEMENT_A
        ? position === 12 ? structuredClone(IDEAL_BONUSES) : position === 11 ? structuredClone(REORDERED_GOGMA) : structuredClone(OTHER_FAMILIES)
        : position === 10 ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES),
      keep: (position, current, _type, element) => element === ELEMENT_A
        ? position === 13 || (position === 11 && layoutKeyOf(current) === L_IDEAL) ? keepToIdealRanks(current) : keepToLowRanks(current)
        : position === 12 ? keepToIdealRanks(current) : keepToLowRanks(current),
      normal: (position, _type, element) => element === ELEMENT_A
        ? position === 5 ? structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) : position === 6 ? structuredClone(IDEAL_ORDER_NORMAL) : structuredClone(OTHER_FAMILIES)
        : position === 4 ? structuredClone(IDEAL_ORDER_NORMAL) : structuredClone(OTHER_FAMILIES),
    })
  }

  it('assigns three planning Targets of a scanned table exactly as the brute force does, from the context\'s own Target order', async () => {
    const fixture = await createGlobalAssignmentFixture({ sameElementTarget: true })
    const engine = scanEngine()
    const owned: OwnedWeapon[] = [ownedGogma('owned.g1'), ownedGogma('owned.g5', { restorationBonuses: structuredClone(IDEAL_BONUSES) })]
    const input = { ...fixture.input, ownedWeapons: [...fixture.input.ownedWeapons, ...owned] }
    const contextResult = createGlobalAssignmentContext(input, globalResearchDependencies(engine.engine))
    if (contextResult.kind !== 'context') throw new Error(contextResult.detail)
    const tableResult = await buildReachTable(contextResult.context, engine.engine, WINDOW, REACH_OPTION_SET_A1)
    if (tableResult.kind !== 'reach_table') throw new Error(JSON.stringify(tableResult))
    const table = tableResult.table
    const planningTargets: readonly PlanningTargetPriority[] = contextResult.context.planningTargets
    expect(table.targets.map(target => target.targetWeaponId)).toEqual(planningTargets.map(target => target.id))
    const brute = bruteForceAssignments(table)
    expect(brute.length).toBeGreaterThan(0)
    const result = collectResourceAssignments(table, planningTargets, REQUEST, 100_000)
    expect(result.status).toBe('assignments_found')
    if (result.status !== 'assignments_found') return
    expect(result.completeness).toBe('exhausted')
    expect([...keysOf(result.candidates)].sort()).toEqual(brute.map(assignment => assignment.key).sort())
    for (const candidate of result.candidates) {
      expect([...candidate.chosen.keys()]).toEqual(planningTargets.map(target => target.id))
      for (const option of candidate.chosen.values()) expect(option.verification).toBe('necessary_only')
      expect(new Set(candidate.usedSources).size).toBe(3)
    }
    expect(result.diagnostics.bestAssignment?.objective).toBe(Math.min(...brute.map(assignment => assignment.objective)))
    // The two element-a Targets compete for the same Skill / Gogma positions and the same forges; element b has its own positions.
    expect(result.diagnostics.rejections.skill_position + result.diagnostics.rejections.gogma_position + result.diagnostics.rejections.source).toBeGreaterThan(0)
  })
})
