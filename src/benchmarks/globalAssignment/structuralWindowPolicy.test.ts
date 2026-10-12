import { describe, expect, it } from 'vitest'
import { COUNTER_A, handBuiltReachTable, normalSource } from './assignmentTestFixture'
import { decideWindowTransition } from './assignmentWindowPolicy'
import { collectCoverageFeasibleAssignments } from './coverageSearch'
import { decideStructuralWindowTransition, structuralStageOutcomeOf, type StructuralStageOutcome, type StructuralWindowDecision } from './structuralWindowPolicy'
import type { ReachWindow } from './types'

/*
 * Issue #154 Global Assignment Phase C-2 (design 4.6 / 10.3 / 12): the window ladder transition rule over
 * the typed outcome of one coverage-gated search. Only exhausted trees without a structural candidate
 * widen - `coverage_infeasible` included -; a budget, a cancel or a limit never does; nothing concludes
 * infeasibility. The Phase B-2A decision is a separate authority and is unchanged.
 */
const W0: ReachWindow = { normal: 3, gogma: 6, skill: 4 }
const W1: ReachWindow = { normal: 6, gogma: 12, skill: 8 }
const TWO_RUNGS = [W0, W1]
const ONE_RUNG = [W0]

const outcomes: Record<string, StructuralStageOutcome> = {
  targetWithoutOption: { kind: 'no_structural_candidate', reason: 'target_without_option' },
  resourceExclusivity: { kind: 'no_structural_candidate', reason: 'resource_exclusivity' },
  coverageInfeasible: { kind: 'no_structural_candidate', reason: 'coverage_infeasible' },
  upperBoundPruning: { kind: 'no_structural_candidate', reason: 'upper_bound_pruning' },
  enumerated: { kind: 'structural_candidates_found', completeness: 'exhausted' },
  candidateLimit: { kind: 'structural_candidates_found', completeness: 'candidate_limit_reached' },
  nodeBudget: { kind: 'search_incomplete', completeness: 'node_budget_reached' },
  cancelled: { kind: 'search_incomplete', completeness: 'cancelled' },
  scanCancelled: { kind: 'scan_cancelled' },
  timeout: { kind: 'unmeasured', reason: 'timeout' },
  unsupported: { kind: 'unsupported_input', reason: 'unconfirmed_counter' },
  invalid: { kind: 'invalid_input', reason: 'planning_target_mismatch' },
}

function expectHold(decision: StructuralWindowDecision, conclusion: StructuralWindowDecision['conclusion']) {
  expect(decision).toMatchObject({ action: 'hold', conclusion, nextRungIndex: null, ladderExhausted: false, concludesInfeasibility: false })
}

describe('Phase C-2 window transition (design 10.3)', () => {
  it('widens for every exhausted no-candidate reason, coverage_infeasible included', () => {
    expect(decideStructuralWindowTransition(outcomes.targetWithoutOption!, 0, TWO_RUNGS)).toMatchObject({ action: 'expand', conclusion: 'no_option_in_window', nextRungIndex: 1, ladderExhausted: false, concludesInfeasibility: false })
    expect(decideStructuralWindowTransition(outcomes.resourceExclusivity!, 0, TWO_RUNGS)).toMatchObject({ action: 'expand', conclusion: 'no_resource_assignment_in_window', nextRungIndex: 1 })
    expect(decideStructuralWindowTransition(outcomes.coverageInfeasible!, 0, TWO_RUNGS)).toMatchObject({ action: 'expand', conclusion: 'no_coverage_feasible_assignment_in_window', nextRungIndex: 1, concludesInfeasibility: false })
    // At the top rung the registered ladder is exhausted - still not the absence of a feasible Plan.
    const top = decideStructuralWindowTransition(outcomes.coverageInfeasible!, 0, ONE_RUNG)
    expect(top).toMatchObject({ action: 'expand', nextRungIndex: null, ladderExhausted: true, concludesInfeasibility: false })
    expect(top.note).toMatch(/not the absence of a feasible Plan/)
  })

  it('holds for a budget, a cancel, a candidate limit, structural candidates, an upper bound cut and every non-search end', () => {
    expectHold(decideStructuralWindowTransition(outcomes.nodeBudget!, 0, TWO_RUNGS), 'search_incomplete')
    expectHold(decideStructuralWindowTransition(outcomes.cancelled!, 0, TWO_RUNGS), 'interrupted')
    expectHold(decideStructuralWindowTransition(outcomes.scanCancelled!, 0, TWO_RUNGS), 'interrupted')
    expectHold(decideStructuralWindowTransition(outcomes.candidateLimit!, 0, TWO_RUNGS), 'structural_candidates_found_remainder_unconfirmed')
    expectHold(decideStructuralWindowTransition(outcomes.enumerated!, 0, TWO_RUNGS), 'structural_candidates_enumerated')
    expectHold(decideStructuralWindowTransition(outcomes.upperBoundPruning!, 0, TWO_RUNGS), 'upper_bound_pruned')
    expectHold(decideStructuralWindowTransition(outcomes.timeout!, 0, TWO_RUNGS), 'unmeasured')
    expectHold(decideStructuralWindowTransition(outcomes.unsupported!, 0, TWO_RUNGS), 'unsupported_input')
    expectHold(decideStructuralWindowTransition(outcomes.invalid!, 0, TWO_RUNGS), 'invalid_input')
  })

  it('never concludes infeasibility and refuses an invalid ladder or rung', () => {
    for (const outcome of Object.values(outcomes)) {
      for (const [ladder, rung] of [[TWO_RUNGS, 0], [TWO_RUNGS, 1], [ONE_RUNG, 0]] as const) expect(decideStructuralWindowTransition(outcome, rung, ladder).concludesInfeasibility).toBe(false)
    }
    expect(() => decideStructuralWindowTransition(outcomes.nodeBudget!, 2, TWO_RUNGS)).toThrow(RangeError)
    expect(() => decideStructuralWindowTransition(outcomes.nodeBudget!, 0, [W1, W0])).toThrow(RangeError)
    expect(() => decideStructuralWindowTransition(outcomes.nodeBudget!, 0, [])).toThrow(RangeError)
  })

  it('maps collected results to stage outcomes: a node budget stop holds even when every inspected assignment was rejected', () => {
    // Two converted Targets: the first complete assignment leaves the Skill origin uncovered; a budget of 3 nodes stops right after it.
    const noKeep = (positions: number[]) => ({ resetIdealPositions: positions, resetLayoutByPosition: new Map<number, string>(), keepIdealPositionsByLayout: new Map<string, number[]>(), keepUnsupportedLayouts: [] })
    const { table, planningTargets } = handBuiltReachTable({
      originSkill: 10, originGogma: 50, originNormal: { [COUNTER_A]: 0 }, window: { skill: 6, gogma: 4, normal: 3 },
      targets: [
        { id: 'target.a', sources: [normalSource('owned.n.a')], skill: { idealPositions: [12, 14], resetSkillsLimit: 15, conversionLimit: 16 }, bonus: noKeep([50, 52]) },
        { id: 'target.b', sources: [normalSource('owned.n.b')], skill: { idealPositions: [13, 15], resetSkillsLimit: 15, conversionLimit: 16 }, bonus: noKeep([51, 53]) },
      ],
    })
    const stopped = collectCoverageFeasibleAssignments(table, planningTargets, { nodeBudget: 3, mrvLookahead: 8, coverageDrivenOrdering: true }, 10)
    expect(stopped.status === 'search_incomplete' && stopped.diagnostics.coverageRejections).toBe(1)
    expect(structuralStageOutcomeOf(stopped)).toEqual({ kind: 'search_incomplete', completeness: 'node_budget_reached' })
    expectHold(decideStructuralWindowTransition(structuralStageOutcomeOf(stopped), 0, TWO_RUNGS), 'search_incomplete')
    const found = collectCoverageFeasibleAssignments(table, planningTargets, { nodeBudget: 1_000, mrvLookahead: 8, coverageDrivenOrdering: true }, 1_000)
    expect(structuralStageOutcomeOf(found)).toEqual({ kind: 'structural_candidates_found', completeness: 'exhausted' })
    expect(structuralStageOutcomeOf(collectCoverageFeasibleAssignments(table, planningTargets, { nodeBudget: 1_000, mrvLookahead: 8, coverageDrivenOrdering: true }, 0)))
      .toEqual({ kind: 'invalid_input', reason: 'invalid_candidate_limit' })
  })

  it('leaves the Phase B-2A decision unchanged', () => {
    expect(decideWindowTransition({ kind: 'no_resource_assignment', reason: 'resource_exclusivity' }, 0, TWO_RUNGS)).toMatchObject({ action: 'expand', conclusion: 'no_assignment_in_window', nextRungIndex: 1 })
    expect(decideWindowTransition({ kind: 'assignments_found', completeness: 'exhausted' }, 0, TWO_RUNGS)).toMatchObject({ action: 'hold', conclusion: 'assignments_enumerated' })
    expect(decideWindowTransition({ kind: 'search_incomplete', completeness: 'node_budget_reached' }, 0, TWO_RUNGS)).toMatchObject({ action: 'hold', conclusion: 'search_incomplete' })
  })
})
