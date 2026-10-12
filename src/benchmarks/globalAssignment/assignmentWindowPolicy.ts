/**
 * Issue #154 Global Assignment Phase B-2A (Research only; never imported by the app).
 *
 * The window ladder transition rule of `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 10.3 as a pure
 * decision over the typed outcome of one assignment-only run. Only the *kind* of outcome decides
 * (never an oracle value, an incumbent or an objective): an exhausted tree without any complete
 * assignment (`target_without_option` / `resource_exclusivity`) asks for the next rung; reaching the node
 * budget, the candidate limit, a cancel, an unsupported input or an unmeasured run holds the current rung
 * and concludes nothing about the window. Phase C's `coverage_infeasible` is not an outcome this Phase
 * can produce, so the outcome type does not carry it.
 *
 * No decision here ever says a feasible Plan does not exist (design 12): the strongest conclusion is
 * "this window and these exclusivity constraints held no complete assignment", and at the top rung "the
 * registered ladder held none".
 */
import type { ReachWindow } from './types'
import { validateWindowLadder } from './assignmentProtocol'

/** The typed end of one assignment-only run (Phase B-1's `ResourceAssignmentSearchResult` statuses plus the stage and process ends around it). */
export type AssignmentStageOutcome =
  | { kind: 'assignments_found'; completeness: 'exhausted' | 'candidate_limit_reached' }
  | { kind: 'no_resource_assignment'; reason: 'target_without_option' | 'resource_exclusivity' | 'upper_bound_pruning' }
  | { kind: 'search_incomplete'; completeness: 'node_budget_reached' | 'cancelled' }
  /** The ReachTable scan was cancelled before the solver started. */
  | { kind: 'scan_cancelled' }
  | { kind: 'unsupported_input'; reason: string }
  | { kind: 'invalid_input'; reason: string }
  /** Decided by the parent process (wall-clock, heap, exit), never by the calculation (G6 / G7). */
  | { kind: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure' }

export type WindowTransitionConclusion =
  /** Exhausted tree, no complete assignment in this window: the next rung is the candidate remedy. */
  | 'no_assignment_in_window'
  /** Exhausted tree with at least one complete assignment: the window's resource assignments are fully enumerated. */
  | 'assignments_enumerated'
  /** The candidate limit stopped the collection: assignments exist, the rest of the tree is unconfirmed. */
  | 'assignments_found_remainder_unconfirmed'
  /** The node budget stopped the search: unexplored branches remain. */
  | 'search_incomplete'
  /** A cancel stopped the scan or the search. */
  | 'interrupted'
  | 'unmeasured'
  | 'unsupported_input'
  | 'invalid_input'
  /** `upper_bound_pruning` without any upper bound: a B-2A run never supplies one, so this is an anomaly to investigate, not a window fact. */
  | 'anomalous_outcome'

export interface WindowTransitionDecision {
  /** `expand`: the design 10.3 rule asks for the next rung. `hold`: stay (or stop) without widening. */
  action: 'expand' | 'hold'
  conclusion: WindowTransitionConclusion
  rungIndex: number
  /** The rung to scan next when `action` is `expand` and the ladder has one; otherwise null. */
  nextRungIndex: number | null
  /** `expand` was asked at the top rung: the registered ladder held no complete assignment (still not infeasibility). */
  ladderExhausted: boolean
  /** Always false: no outcome of this Phase proves that a feasible Plan does not exist (design 10.3 / 12). */
  concludesInfeasibility: false
  note: string
}

export function decideWindowTransition(outcome: AssignmentStageOutcome, rungIndex: number, ladder: readonly ReachWindow[]): WindowTransitionDecision {
  const ladderIssues = validateWindowLadder(ladder)
  if (ladderIssues.length > 0) throw new RangeError(`Invalid window ladder: ${ladderIssues.join(' ')}`)
  if (!Number.isSafeInteger(rungIndex) || rungIndex < 0 || rungIndex >= ladder.length) throw new RangeError(`rungIndex ${String(rungIndex)} is outside the ladder (0..${ladder.length - 1}).`)
  const hold = (conclusion: WindowTransitionConclusion, note: string): WindowTransitionDecision =>
    ({ action: 'hold', conclusion, rungIndex, nextRungIndex: null, ladderExhausted: false, concludesInfeasibility: false, note })
  const expand = (note: string): WindowTransitionDecision => {
    const hasNext = rungIndex + 1 < ladder.length
    return {
      action: 'expand', conclusion: 'no_assignment_in_window', rungIndex, nextRungIndex: hasNext ? rungIndex + 1 : null, ladderExhausted: !hasNext, concludesInfeasibility: false,
      note: hasNext ? `${note} The design 10.3 rule asks for rung ${rungIndex + 1}.` : `${note} Rung ${rungIndex} is the top of the registered ladder, so the registered ladder held no complete assignment; this is not the absence of a feasible Plan.`,
    }
  }
  switch (outcome.kind) {
    case 'no_resource_assignment':
      if (outcome.reason === 'target_without_option') return expand('The exhausted tree found a planning Target with no reach option inside this window.')
      if (outcome.reason === 'resource_exclusivity') return expand('Every planning Target has options inside this window, but the exhausted tree found no complete assignment under C1 / C2.')
      return hold('anomalous_outcome', 'upper_bound_pruning was reported although an assignment-only run supplies no VerifiedUpperBound; the run is inconsistent and widens nothing.')
    case 'assignments_found':
      return outcome.completeness === 'exhausted'
        ? hold('assignments_enumerated', 'The exhausted tree enumerated every complete assignment of this window; Phase B candidates exist and no widening is asked.')
        : hold('assignments_found_remainder_unconfirmed', 'The candidate limit stopped the collection: complete assignments exist, the rest of the tree is unconfirmed, and nothing is said about a wider window.')
    case 'search_incomplete':
      return outcome.completeness === 'node_budget_reached'
        ? hold('search_incomplete', 'The node budget stopped the search with unexplored branches; the node budget is reviewed first, the window is not widened.')
        : hold('interrupted', 'The search was cancelled; nothing is concluded about this window.')
    case 'scan_cancelled':
      return hold('interrupted', 'The ReachTable scan was cancelled before the solver started; nothing is concluded about this window.')
    case 'unmeasured':
      return hold('unmeasured', `The run is unmeasured (${outcome.reason}); the execution envelope is reviewed first, the window is not widened.`)
    case 'unsupported_input':
      return hold('unsupported_input', `The input does not satisfy the Phase A premises (${outcome.reason}); a window is not the remedy.`)
    case 'invalid_input':
      return hold('invalid_input', `The solver refused its input (${outcome.reason}); the run is inconsistent and widens nothing.`)
  }
}
