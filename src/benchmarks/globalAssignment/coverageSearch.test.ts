import { describe, expect, it } from 'vitest'
import { assignmentKeyOf, bruteForceAssignments, COUNTER_A, gogmaSource, handBuiltReachTable, normalSource, type HandBuiltTargetSpec } from './assignmentTestFixture'
import { collectResourceAssignments, createResourceAssignmentSearch } from './assignmentSolver'
import type { ExpandedNodeInfo, PlanningTargetPriority, ResourceAssignmentSearchEvent, ResourceAssignmentSearchRequest } from './assignmentTypes'
import { collectCoverageFeasibleAssignments, collectFromCoverageSearch, createCoverageSearch, noCandidateReason } from './coverageSearch'
import { bruteCoverageFeasible, bruteForceCoverageFeasible, randomCoverageTable } from './coverageSearchTestFixture'
import type {
  AssignmentCoverageInspection, CoverageFeasibleAssignment, CoverageSearch, CoverageSearchDiagnostics, CoverageSearchEvent, CoverageSearchRequest,
} from './coverageSearchTypes'
import { GlobalAssignmentInvariantError, type ReachOption, type ReachTable } from './types'

/*
 * Issue #154 Global Assignment Phase C-2 (design 4.6 / 6.3 / 6.4 / 8.1 / 10.3 / 12 / 13.1 Phase B-C):
 * the coverage-gated assignment search over hand-built ReachTables. No Engine, no Search, no Planner,
 * no oracle and no real Target or weapon ID. The reference is a brute force (C1 / C2 product plus a
 * position-by-position coverage predicate) independent of the solver and of the Phase C-1 module.
 */
const BASE: Omit<CoverageSearchRequest, 'coverageDrivenOrdering'> = { nodeBudget: 1_000_000, mrvLookahead: 8 }
const A = 'target.a'
const B = 'target.b'
const G = 'target.g'

const noKeep = (resetIdealPositions: number[]) => ({ resetIdealPositions, resetLayoutByPosition: new Map<number, string>(), keepIdealPositionsByLayout: new Map<string, number[]>(), keepUnsupportedLayouts: [] })

/** Skill 10..16, Gogma 50..53, Normal A 0..2 (`conversionLimit` 16, `resetSkillsLimit` 15). */
function table(targets: HandBuiltTargetSpec[]): { table: ReachTable; planningTargets: PlanningTargetPriority[] } {
  return handBuiltReachTable({
    originSkill: 10, originGogma: 50, originNormal: { [COUNTER_A]: 0 }, window: { skill: 6, gogma: 4, normal: 3 },
    targets: targets.map(target => ({ ...target, skill: { resetSkillsLimit: 15, conversionLimit: 16, ...target.skill } })),
  })
}

/**
 * Two converted Targets and nothing else in the Skill stream: the value order tries `c = s*` first (A at
 * 12, B at 13), which leaves the Skill origin uncovered; only an assignment converting at 10 is coverage-feasible.
 */
function conversionsOnly() {
  return table([
    { id: A, sources: [normalSource('owned.n.a')], skill: { idealPositions: [12, 14] }, bonus: noKeep([50, 52]) },
    { id: B, sources: [normalSource('owned.n.b')], skill: { idealPositions: [13, 15] }, bonus: noKeep([51, 53]) },
  ])
}

function searchOf(built: ReturnType<typeof table>, request: Partial<CoverageSearchRequest> & Pick<CoverageSearchRequest, 'coverageDrivenOrdering'>): CoverageSearch<CoverageFeasibleAssignment> {
  const created = createCoverageSearch(built.table, built.planningTargets, { ...BASE, ...request })
  if (created.kind !== 'search') throw new Error(created.detail)
  return created.search
}

function drain(search: CoverageSearch<CoverageFeasibleAssignment>, maxNodes?: number): { events: CoverageSearchEvent<CoverageFeasibleAssignment>[]; candidates: CoverageFeasibleAssignment[] } {
  const events: CoverageSearchEvent<CoverageFeasibleAssignment>[] = []
  const candidates: CoverageFeasibleAssignment[] = []
  for (let guard = 0; guard < 1_000_000; guard++) {
    const event = search.next(maxNodes)
    events.push(event)
    if (event.kind === 'candidate') candidates.push(event.candidate)
    if (event.kind === 'finished') return { events, candidates }
  }
  throw new Error('search did not finish')
}

/** Runs the search to exhaustion and records every inspection and expanded node. */
function trace(built: ReturnType<typeof table>, coverageDrivenOrdering: boolean, maxNodes?: number) {
  const inspections: AssignmentCoverageInspection[] = []
  const nodes: ExpandedNodeInfo[] = []
  const search = searchOf(built, { coverageDrivenOrdering, onAssignmentInspected: value => inspections.push(value), onNodeExpanded: node => nodes.push(node) })
  const { candidates, events } = drain(search, maxNodes)
  return { search, inspections, nodes, candidates, events, diagnostics: search.diagnostics }
}

const keyOfAssignment = (candidate: CoverageFeasibleAssignment) => assignmentKeyOf(candidate.assignment.chosen.values())
const conversionAt = (options: Iterable<ReachOption>, position: number) => [...options].some(option => option.skillRequired.kind === 'conversion' && option.skillRequired.conversionPosition === position)

describe('Phase C-2 coverage-gated assignment search (design 6.3 / 8.1)', () => {
  it('never delivers a coverage-rejected complete assignment and keeps searching from the next value', () => {
    for (const ordering of [false, true]) {
      const run = trace(conversionsOnly(), ordering)
      // The first complete assignment converts at 12 / 13 and leaves Skill 10..11 uncovered.
      expect(run.inspections[0]).toMatchObject({ ordinal: 0, verdict: 'coverage_infeasible', priorityConversionPosition: null })
      expect(run.inspections[0]!.firstUncovered).toMatchObject({ stream: { kind: 'skill' }, from: 10, firstUncoveredPosition: 10, previousRequired: null })
      // Every delivered assignment passed the pre-check and is coverage-feasible for the independent predicate; no rejected one is delivered.
      const delivered = new Set(run.candidates.map(candidate => candidate.assignment.ordinal))
      for (const inspection of run.inspections) {
        expect(delivered.has(inspection.ordinal)).toBe(inspection.verdict === 'coverage_feasible')
        expect(bruteCoverageFeasible([...inspection.assignment.chosen.values()], conversionsOnly().table)).toBe(inspection.verdict === 'coverage_feasible')
      }
      expect(run.candidates.length).toBeGreaterThan(0)
      expect(run.candidates.every(candidate => conversionAt(candidate.assignment.chosen.values(), 10))).toBe(true)
      // Every complete assignment is inspected once, in generation order.
      expect(run.inspections.map(value => value.ordinal)).toEqual(run.inspections.map((_, index) => index))
      expect(run.diagnostics).toMatchObject({
        completeAssignmentsInspected: run.inspections.length,
        coverageRejections: run.inspections.filter(value => value.verdict === 'coverage_infeasible').length,
        coverageFeasible: run.candidates.length,
        lowestUncoveredPosition: 10,
        completeness: 'exhausted',
      })
      expect(run.diagnostics.resource.candidates).toBe(run.inspections.length)
      expect(run.diagnostics.firstRejection).toMatchObject({ ordinal: 0, firstUncovered: { firstUncoveredPosition: 10 } })
      expect(run.diagnostics.rejectionsByFirstUncoveredPosition.reduce((sum, row) => sum + row.count, 0)).toBe(run.diagnostics.coverageRejections)
    }
  })

  it('tries the options converting at the lowest uncovered Skill position first after a rejection, and reaches a coverage-feasible assignment sooner', () => {
    const ordered = trace(conversionsOnly(), true)
    const plain = trace(conversionsOnly(), false)
    // Right after the first rejection (x = 10) the next complete assignment converts at 10 and is coverage-feasible.
    expect(ordered.inspections[1]).toMatchObject({ verdict: 'coverage_feasible', priorityConversionPosition: 10 })
    expect(conversionAt(ordered.inspections[1]!.assignment.chosen.values(), 10)).toBe(true)
    expect(ordered.diagnostics.assignmentsUntilFirstCoverageFeasible).toBe(2)
    expect(plain.diagnostics.assignmentsUntilFirstCoverageFeasible!).toBeGreaterThan(2)
    expect(ordered.diagnostics.coverageDrivenOrdering).toMatchObject({ enabled: true, currentPriorityConversionPosition: 10 })
    expect(ordered.diagnostics.coverageDrivenOrdering.priorityChanges).toBeGreaterThanOrEqual(1)
    expect(ordered.diagnostics.coverageDrivenOrdering.phaseActivations).toBeGreaterThan(0)
    expect(ordered.diagnostics.coverageDrivenOrdering.priorityDeliveries).toBeGreaterThan(0)
    expect(plain.diagnostics.coverageDrivenOrdering).toEqual({
      enabled: false, phaseActivations: 0, priorityDeliveries: 0, prioritySkips: 0, baseSkips: 0, currentPriorityConversionPosition: null, priorityChanges: 0,
    })
    // The best coverage-feasible objective is kept apart from the underlying best resource assignment.
    expect(ordered.diagnostics.bestCoverageFeasible).not.toBeNull()
    expect(ordered.diagnostics.resource.bestAssignment!.objective).toBeLessThanOrEqual(ordered.diagnostics.bestCoverageFeasible!.objective)
  })

  it('finds the same coverage-feasible set with and without the ordering, equal to an independent brute force, without duplicates', () => {
    const tables = [conversionsOnly(), ...Array.from({ length: 40 }, (_, seed) => randomCoverageTable(seed + 1))]
    let nonTrivial = 0
    for (const built of tables) {
      const reference = bruteForceCoverageFeasible(built.table).map(value => value.key).sort()
      const ordered = trace(built, true).candidates.map(keyOfAssignment)
      const plain = trace(built, false).candidates.map(keyOfAssignment)
      expect(new Set(ordered).size).toBe(ordered.length)
      expect(new Set(plain).size).toBe(plain.length)
      expect([...ordered].sort()).toEqual(reference)
      expect([...plain].sort()).toEqual(reference)
      if (reference.length > 0 && trace(built, false).diagnostics.coverageRejections > 0) nonTrivial += 1
    }
    // The random tables exercise rejections, not only trivially covered inputs.
    expect(nonTrivial).toBeGreaterThan(5)
  })

  it('finds a coverage-feasible assignment whenever a complete resource assignment exists (Phase A enumerates every c in origin..s*)', () => {
    // Lemma of the Phase C-2 record: lowering the conversion of a Target that converts after the lowest uncovered
    // position p to p covers p and uncovers nothing below it, so an exhausted coverage_infeasible needs an inconsistent table.
    for (let seed = 1; seed <= 60; seed++) {
      const built = randomCoverageTable(seed)
      const resource = bruteForceAssignments(built.table)
      const feasible = resource.filter(assignment => bruteCoverageFeasible(assignment.options, built.table))
      expect(feasible.length > 0, `seed ${seed}`).toBe(resource.length > 0)
      if (resource.length === 0) continue
      // The same stream ends (so the same objective) are reachable coverage-feasibly: the smallest objective is kept.
      expect(Math.min(...feasible.map(value => value.objective)), `seed ${seed}`).toBe(Math.min(...resource.map(value => value.objective)))
    }
  })

  it('resumes after next(maxNodes) pauses with the same candidates, inspections and diagnostics', () => {
    for (const built of [conversionsOnly(), randomCoverageTable(7), randomCoverageTable(13)]) {
      for (const ordering of [false, true]) {
        const whole = trace(built, ordering)
        for (const maxNodes of [1, 2, 3, 7]) {
          const paused = trace(built, ordering, maxNodes)
          expect(paused.candidates.map(keyOfAssignment)).toEqual(whole.candidates.map(keyOfAssignment))
          expect(paused.candidates.map(value => value.assignment.ordinal)).toEqual(whole.candidates.map(value => value.assignment.ordinal))
          expect(paused.inspections.map(value => [value.ordinal, value.verdict, value.priorityConversionPosition])).toEqual(whole.inspections.map(value => [value.ordinal, value.verdict, value.priorityConversionPosition]))
          expect(paused.nodes).toEqual(whole.nodes)
          expect(paused.diagnostics).toEqual(whole.diagnostics)
          for (const event of paused.events) if (event.kind === 'paused') expect(event.nodesThisCall).toBeLessThanOrEqual(maxNodes)
        }
      }
    }
  })

  it('is deterministic: the same input gives the same node sequence, inspections and priorities', () => {
    for (const built of [conversionsOnly(), randomCoverageTable(3), randomCoverageTable(21)]) {
      const first = trace(built, true)
      const second = trace(built, true)
      expect(second.nodes).toEqual(first.nodes)
      expect(second.inspections.map(value => [value.ordinal, value.verdict, value.priorityConversionPosition, assignmentKeyOf(value.assignment.chosen.values())]))
        .toEqual(first.inspections.map(value => [value.ordinal, value.verdict, value.priorityConversionPosition, assignmentKeyOf(value.assignment.chosen.values())]))
      expect(second.diagnostics).toEqual(first.diagnostics)
    }
  })

  it('reports a node budget or a cancel as search_incomplete, never as coverage infeasibility, even when every inspected assignment was rejected', () => {
    // Nodes: the root (A), its child (B) and the first leaf, which is rejected; the budget stops the next node.
    const budget = collectCoverageFeasibleAssignments(conversionsOnly().table, conversionsOnly().planningTargets, { ...BASE, nodeBudget: 3, coverageDrivenOrdering: false }, 10)
    expect(budget).toMatchObject({ status: 'search_incomplete', completeness: 'node_budget_reached', candidates: [] })
    if (budget.status !== 'search_incomplete') return
    expect(budget.diagnostics).toMatchObject({ completeAssignmentsInspected: 1, coverageRejections: 1, coverageFeasible: 0, completeness: 'node_budget_reached' })

    let inspected = 0
    const built = conversionsOnly()
    const cancelled = collectCoverageFeasibleAssignments(built.table, built.planningTargets, {
      ...BASE, coverageDrivenOrdering: true, onAssignmentInspected: () => { inspected += 1 }, shouldCancel: () => inspected >= 1,
    }, 10)
    expect(cancelled).toMatchObject({ status: 'search_incomplete', completeness: 'cancelled', candidates: [] })
    if (cancelled.status === 'search_incomplete') expect(cancelled.diagnostics.coverageRejections).toBe(1)
  })

  it('reports the candidate limit as candidate_limit_reached, not as an exhausted window', () => {
    const built = conversionsOnly()
    const limited = collectCoverageFeasibleAssignments(built.table, built.planningTargets, { ...BASE, coverageDrivenOrdering: true }, 1)
    expect(limited).toMatchObject({ status: 'candidates_found', completeness: 'candidate_limit_reached' })
    if (limited.status === 'candidates_found') expect(limited.candidates).toHaveLength(1)
  })

  it('treats chain positions as no resource: a required position may sit inside another Target\'s chain reach', () => {
    // G (owned Gogma, Reset Skills only at 14) holds Skill 10..13 with its chain; A converts inside that reach.
    const built = table([
      { id: A, sources: [normalSource('owned.n.a')], skill: { idealPositions: [12] }, bonus: noKeep([51]) },
      { id: G, sources: [gogmaSource('owned.g.g')], skill: { idealPositions: [14] }, bonus: noKeep([52]) },
    ])
    const run = trace(built, true)
    // Every conversion of A (c = 12, 11, 10 with s* = 12) coexists with G's Reset Skills at 14: three candidates, the brute force's set.
    expect(run.candidates.map(keyOfAssignment).sort()).toEqual(bruteForceCoverageFeasible(built.table).map(value => value.key).sort())
    expect(run.candidates).toHaveLength(3)
    const atTwelve = run.candidates.find(candidate => conversionAt(candidate.assignment.chosen.values(), 12))!
    // Only the required positions are occupied (C2); G's chain over 10..11 and 13 is no resource, and A's required 12 sits inside G's reach.
    expect(atTwelve.assignment.requiredPositions.skill).toEqual([12, 14])
    const skill = atTwelve.coverage.find(stream => stream.stream.kind === 'skill')!
    expect(skill.segments.map(segment => [segment.kind, segment.from, segment.to, segment.covererTargetWeaponId])).toEqual([
      ['chain', 10, 11, G], ['required', 12, 12, A], ['chain', 13, 13, G], ['required', 14, 14, G],
    ])
  })

  it('distinguishes target_without_option, resource_exclusivity, coverage_infeasible and upper_bound_pruning only for an exhausted tree', () => {
    const exhausted = (built: ReturnType<typeof table>, request: Partial<CoverageSearchRequest> = {}) =>
      collectCoverageFeasibleAssignments(built.table, built.planningTargets, { ...BASE, coverageDrivenOrdering: true, ...request }, 10)
    // A Target without any option in the window.
    expect(exhausted(table([
      { id: A, sources: [normalSource('owned.n.a')], skill: { idealPositions: [12] }, bonus: noKeep([51]) },
      { id: B, sources: [normalSource('owned.n.b')], skill: { idealPositions: [] }, bonus: noKeep([52]) },
    ]))).toMatchObject({ status: 'no_structural_candidate', completeness: 'exhausted', reason: 'target_without_option', targetsWithoutOption: [B] })
    // Options for both Targets, one shared owned weapon (C1): no complete resource assignment at all.
    expect(exhausted(table([
      { id: A, sources: [normalSource('owned.n.shared')], skill: { idealPositions: [12] }, bonus: noKeep([51]) },
      { id: B, sources: [normalSource('owned.n.shared')], skill: { idealPositions: [13] }, bonus: noKeep([52]) },
    ]))).toMatchObject({ status: 'no_structural_candidate', completeness: 'exhausted', reason: 'resource_exclusivity' })
    // A Production-verified upper bound of 0 cuts every child: the cut part is not called coverage-infeasible.
    expect(exhausted(conversionsOnly(), { readVerifiedUpperBound: () => ({ physicalOperations: 0, provenance: 'production_verified_plan' }) }))
      .toMatchObject({ status: 'no_structural_candidate', completeness: 'exhausted', reason: 'upper_bound_pruning' })

    // coverage_infeasible needs complete assignments that all fail the pre-check, which a consistent table never
    // produces (see the lemma above); the classification is fixed on a scripted search.
    const scripted = scriptedSearch(['rejected', 'rejected'], 'exhausted')
    expect(scripted.next()).toEqual({ kind: 'finished', completeness: 'exhausted' })
    expect(noCandidateReason(scripted)).toBe('coverage_infeasible')
    const classified = collectFromCoverageSearch({ kind: 'search', search: scriptedSearch(['rejected', 'rejected'], 'exhausted') }, conversionsOnly().table, 5)
    expect(classified).toMatchObject({ status: 'no_structural_candidate', completeness: 'exhausted', reason: 'coverage_infeasible', targetsWithoutOption: [] })
    // The same rejections ended by a budget or a cancel conclude nothing.
    for (const completeness of ['node_budget_reached', 'cancelled'] as const) {
      expect(collectFromCoverageSearch({ kind: 'search', search: scriptedSearch(['rejected', 'rejected'], completeness) }, conversionsOnly().table, 5))
        .toMatchObject({ status: 'search_incomplete', completeness, candidates: [] })
    }
    expect(noCandidateReason(scriptedSearch([], 'exhausted'))).toBe('resource_exclusivity')
  })

  it('throws an internal inconsistency instead of reading it as a coverage failure', () => {
    // The solver accepts a negative origin that the Phase C-1 validation refuses: the gate must fail closed, not reject the assignment.
    const built = handBuiltReachTable({
      originSkill: -1, originGogma: 50, originNormal: { [COUNTER_A]: 0 }, window: { skill: 6, gogma: 4, normal: 3 },
      targets: [{ id: A, sources: [normalSource('owned.n.a')], skill: { idealPositions: [1], resetSkillsLimit: 4, conversionLimit: 5 }, bonus: noKeep([51]) }],
    })
    const search = searchOf(built, { coverageDrivenOrdering: true })
    expect(() => search.next()).toThrow(GlobalAssignmentInvariantError)
  })

  it('refuses a request without an explicit ordering choice and forwards the solver\'s own input refusals', () => {
    const built = conversionsOnly()
    expect(createCoverageSearch(built.table, built.planningTargets, { ...BASE } as CoverageSearchRequest)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_request' })
    expect(createCoverageSearch(built.table, built.planningTargets, { ...BASE, nodeBudget: 0, coverageDrivenOrdering: true })).toMatchObject({ kind: 'invalid_input', reason: 'invalid_request' })
    expect(createCoverageSearch(built.table, [...built.planningTargets].reverse(), { ...BASE, coverageDrivenOrdering: true })).toMatchObject({ kind: 'invalid_input', reason: 'planning_target_mismatch' })
    expect(collectCoverageFeasibleAssignments(built.table, built.planningTargets, { ...BASE, coverageDrivenOrdering: true }, 0)).toMatchObject({ status: 'invalid_input', reason: 'invalid_candidate_limit' })
  })
})

describe('Phase C-2 keeps the Phase B-1 search unchanged (design 14)', () => {
  const REQUEST: ResourceAssignmentSearchRequest = { nodeBudget: 1_000_000, mrvLookahead: 8 }
  const B1_DIAGNOSTIC_KEYS = ['bestAssignment', 'candidates', 'completeness', 'deadEnds', 'deadEndsByTarget', 'expandedNodes', 'maxDepth', 'pruned', 'rejections']

  function events(built: ReturnType<typeof table>, request: ResourceAssignmentSearchRequest) {
    const created = createResourceAssignmentSearch(built.table, built.planningTargets, request)
    if (created.kind !== 'search') throw new Error(created.detail)
    const sequence: ResourceAssignmentSearchEvent[] = []
    while (true) {
      const event = created.search.next()
      sequence.push(event)
      if (event.kind === 'finished') return { sequence, search: created.search }
    }
  }

  it('gives the same sequence and diagnostics with no priority provider and with a provider that never names a position', () => {
    for (const built of [conversionsOnly(), randomCoverageTable(5), randomCoverageTable(9)]) {
      const plain = events(built, REQUEST)
      const nullPriority = events(built, { ...REQUEST, readPriorityConversionPosition: () => null })
      expect(nullPriority.sequence).toEqual(plain.sequence)
      expect(nullPriority.search.diagnostics).toEqual(plain.search.diagnostics)
      expect(Object.keys(plain.search.diagnostics).sort()).toEqual(B1_DIAGNOSTIC_KEYS)
      expect(plain.search.priorityOrdering).toEqual({ enabled: false, phaseActivations: 0, priorityDeliveries: 0, prioritySkips: 0, baseSkips: 0 })
      expect(nullPriority.search.priorityOrdering).toMatchObject({ enabled: true, phaseActivations: 0, priorityDeliveries: 0 })
    }
  })

  it('inspects exactly the Phase B-1 candidate sequence when the ordering is off', () => {
    for (const built of [conversionsOnly(), randomCoverageTable(11)]) {
      const b1 = collectResourceAssignments(built.table, built.planningTargets, REQUEST, 1_000_000)
      if (b1.status !== 'assignments_found') throw new Error(b1.status)
      const inspected: AssignmentCoverageInspection[] = []
      drain(searchOf(built, { coverageDrivenOrdering: false, onAssignmentInspected: value => inspected.push(value) }))
      expect(inspected.map(value => value.assignment)).toEqual(b1.candidates)
    }
  })
})

/** A scripted coverage search (classification tests only): one inspection per entry, then the given end. */
function scriptedSearch(verdicts: ('rejected' | 'feasible')[], end: 'exhausted' | 'node_budget_reached' | 'cancelled'): CoverageSearch<CoverageFeasibleAssignment> {
  const built = conversionsOnly()
  let index = 0
  let rejections = 0
  const diagnostics = (): CoverageSearchDiagnostics => {
    const created = createResourceAssignmentSearch(built.table, built.planningTargets, { nodeBudget: 1, mrvLookahead: 1 })
    if (created.kind !== 'search') throw new Error(created.detail)
    return {
      resource: created.search.diagnostics, completeAssignmentsInspected: index, coverageRejections: rejections, coverageFeasible: index - rejections,
      bestCoverageFeasible: null, firstRejection: null, lowestUncoveredPosition: null, rejectionsByFirstUncoveredPosition: [], assignmentsUntilFirstCoverageFeasible: null,
      coverageDrivenOrdering: { enabled: false, phaseActivations: 0, priorityDeliveries: 0, prioritySkips: 0, baseSkips: 0, currentPriorityConversionPosition: null, priorityChanges: 0 },
      completeness: index >= verdicts.length ? end : 'running',
    }
  }
  return {
    get diagnostics() { return diagnostics() },
    targetsWithoutOption: [],
    next: () => {
      while (index < verdicts.length) {
        const verdict = verdicts[index]!
        index += 1
        if (verdict === 'rejected') { rejections += 1; continue }
        throw new Error('scripted feasible candidates are not used')
      }
      return { kind: 'finished', completeness: end }
    },
  }
}
