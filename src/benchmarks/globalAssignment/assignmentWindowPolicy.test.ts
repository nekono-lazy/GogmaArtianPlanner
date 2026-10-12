import { describe, expect, it } from 'vitest'
import { decideWindowTransition, type AssignmentStageOutcome, type WindowTransitionDecision } from './assignmentWindowPolicy'
import type { ReachWindow } from './types'

/*
 * Issue #154 Global Assignment Phase B-2A (design 10.3 / 12): the window ladder transition rule over the typed
 * outcome of one run. Only exhausted trees without a complete assignment widen; nothing concludes infeasibility.
 */
const W0: ReachWindow = { normal: 3, gogma: 6, skill: 4 }
const W1: ReachWindow = { normal: 6, gogma: 12, skill: 8 }
const TWO_RUNGS = [W0, W1]
const ONE_RUNG = [W0]

const outcomes: Record<string, AssignmentStageOutcome> = {
  targetWithoutOption: { kind: 'no_resource_assignment', reason: 'target_without_option' },
  resourceExclusivity: { kind: 'no_resource_assignment', reason: 'resource_exclusivity' },
  upperBoundPruning: { kind: 'no_resource_assignment', reason: 'upper_bound_pruning' },
  enumerated: { kind: 'assignments_found', completeness: 'exhausted' },
  candidateLimit: { kind: 'assignments_found', completeness: 'candidate_limit_reached' },
  nodeBudget: { kind: 'search_incomplete', completeness: 'node_budget_reached' },
  cancelled: { kind: 'search_incomplete', completeness: 'cancelled' },
  scanCancelled: { kind: 'scan_cancelled' },
  timeout: { kind: 'unmeasured', reason: 'timeout' },
  outOfMemory: { kind: 'unmeasured', reason: 'out_of_memory' },
  processFailure: { kind: 'unmeasured', reason: 'process_failure' },
  unsupported: { kind: 'unsupported_input', reason: 'unconfirmed_counter' },
  invalid: { kind: 'invalid_input', reason: 'planning_target_mismatch' },
}

function expectHold(decision: WindowTransitionDecision, conclusion: WindowTransitionDecision['conclusion']) {
  expect(decision).toMatchObject({ action: 'hold', conclusion, nextRungIndex: null, ladderExhausted: false, concludesInfeasibility: false })
}

describe('Phase B-2A window transition (design 10.3)', () => {
  it('widens after an exhausted tree found a Target without any option, naming the next rung', () => {
    expect(decideWindowTransition(outcomes.targetWithoutOption!, 0, TWO_RUNGS)).toMatchObject({
      action: 'expand', conclusion: 'no_assignment_in_window', rungIndex: 0, nextRungIndex: 1, ladderExhausted: false, concludesInfeasibility: false,
    })
  })

  it('widens after an exhausted tree found options for every Target but no complete assignment under C1 / C2', () => {
    expect(decideWindowTransition(outcomes.resourceExclusivity!, 0, TWO_RUNGS)).toMatchObject({ action: 'expand', conclusion: 'no_assignment_in_window', nextRungIndex: 1, ladderExhausted: false })
  })

  it('at the top rung reports the registered ladder exhausted, never infeasibility', () => {
    for (const outcome of [outcomes.targetWithoutOption!, outcomes.resourceExclusivity!]) {
      const decision = decideWindowTransition(outcome, 0, ONE_RUNG)
      expect(decision).toMatchObject({ action: 'expand', conclusion: 'no_assignment_in_window', nextRungIndex: null, ladderExhausted: true, concludesInfeasibility: false })
      expect(decision.note).toMatch(/not the absence of a feasible Plan/)
      expect(decideWindowTransition(outcome, 1, TWO_RUNGS)).toMatchObject({ rungIndex: 1, nextRungIndex: null, ladderExhausted: true })
    }
  })

  it('holds without widening when the node budget stopped the search', () => {
    expectHold(decideWindowTransition(outcomes.nodeBudget!, 0, TWO_RUNGS), 'search_incomplete')
  })

  it('holds when the candidate limit stopped the collection: assignments exist, the remainder is unconfirmed', () => {
    expectHold(decideWindowTransition(outcomes.candidateLimit!, 0, TWO_RUNGS), 'assignments_found_remainder_unconfirmed')
  })

  it('holds when the exhausted tree enumerated every assignment of the window', () => {
    expectHold(decideWindowTransition(outcomes.enumerated!, 0, TWO_RUNGS), 'assignments_enumerated')
  })

  it('holds after a cancel of the search or of the scan', () => {
    expectHold(decideWindowTransition(outcomes.cancelled!, 0, TWO_RUNGS), 'interrupted')
    expectHold(decideWindowTransition(outcomes.scanCancelled!, 0, TWO_RUNGS), 'interrupted')
  })

  it('holds after a timeout, an out-of-memory or a process failure (unmeasured, never no_resource_assignment)', () => {
    for (const outcome of [outcomes.timeout!, outcomes.outOfMemory!, outcomes.processFailure!]) expectHold(decideWindowTransition(outcome, 0, TWO_RUNGS), 'unmeasured')
  })

  it('holds for an unsupported or invalid input and flags upper_bound_pruning without a bound as an anomaly', () => {
    expectHold(decideWindowTransition(outcomes.unsupported!, 0, TWO_RUNGS), 'unsupported_input')
    expectHold(decideWindowTransition(outcomes.invalid!, 0, TWO_RUNGS), 'invalid_input')
    expectHold(decideWindowTransition(outcomes.upperBoundPruning!, 0, TWO_RUNGS), 'anomalous_outcome')
  })

  it('never concludes infeasibility for any outcome at any rung', () => {
    for (const outcome of Object.values(outcomes)) {
      for (const [ladder, rung] of [[TWO_RUNGS, 0], [TWO_RUNGS, 1], [ONE_RUNG, 0]] as const) {
        const decision = decideWindowTransition(outcome, rung, ladder)
        expect(decision.concludesInfeasibility).toBe(false)
        expect(decision.rungIndex).toBe(rung)
        if (decision.action === 'hold') expect(decision.nextRungIndex).toBeNull()
      }
    }
  })

  it('refuses a rung outside the ladder and an invalid ladder', () => {
    expect(() => decideWindowTransition(outcomes.enumerated!, 2, TWO_RUNGS)).toThrow(RangeError)
    expect(() => decideWindowTransition(outcomes.enumerated!, -1, TWO_RUNGS)).toThrow(RangeError)
    expect(() => decideWindowTransition(outcomes.enumerated!, 0, [])).toThrow(/Invalid window ladder/)
    expect(() => decideWindowTransition(outcomes.enumerated!, 0, [W1, W0])).toThrow(/narrows/)
  })

  it('has no coverage_infeasible outcome (Phase C is not implemented)', () => {
    // @ts-expect-error -- the Phase B-2A outcome type carries no Phase C coverage reason.
    const outcome: AssignmentStageOutcome = { kind: 'no_resource_assignment', reason: 'coverage_infeasible' }
    expect(outcome.kind).toBe('no_resource_assignment')
  })
})
