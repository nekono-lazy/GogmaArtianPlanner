/**
 * Issue #154 Global Assignment Phase C-2 (Research only; never imported by the app).
 *
 * The design 10.3 window ladder transition rule over the typed outcome of one coverage-gated search
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.6 / 10.3 / 12). A separate decision from the Phase B-2A
 * `decideWindowTransition()`, which stays the authority of the assignment-only runner and its registered
 * B-2B protocol and is not changed: this one adds `coverage_infeasible`, which only Phase C produces.
 *
 * Only the kind of outcome decides. An exhausted tree that delivered no structural candidate - for
 * `target_without_option`, `resource_exclusivity` or `coverage_infeasible` - asks for the next rung; a node
 * budget, a cancel, a candidate limit, an unsupported or invalid input, an unmeasured run and an upper
 * bound cut hold the current rung and conclude nothing about the window. Phase D outcomes (materialization,
 * Planner verification) do not exist yet, so a window holding structural candidates is held: whether they
 * come true is Phase D's question. No decision ever says a feasible Plan does not exist (design 12).
 */
import { validateWindowLadder } from './assignmentProtocol'
import type { CoverageSearchResult, NoStructuralCandidateReason } from './coverageSearchTypes'
import type { ReachWindow } from './types'

/** The typed end of one coverage-gated search (the `CoverageSearchResult` statuses plus the stage and process ends around it). */
export type StructuralStageOutcome =
  | { kind: 'structural_candidates_found'; completeness: 'exhausted' | 'candidate_limit_reached' }
  | { kind: 'no_structural_candidate'; reason: NoStructuralCandidateReason }
  | { kind: 'search_incomplete'; completeness: 'node_budget_reached' | 'cancelled' }
  /** The ReachTable scan was cancelled before the search started. */
  | { kind: 'scan_cancelled' }
  | { kind: 'unsupported_input'; reason: string }
  | { kind: 'invalid_input'; reason: string }
  /** Decided by the parent process (wall-clock, heap, exit), never by the calculation (G6 / G7). */
  | { kind: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure' }

export type StructuralWindowConclusion =
  /** Exhausted tree, no reach option for some planning Target in this window. */
  | 'no_option_in_window'
  /** Exhausted tree, options for every Target but no complete resource assignment under C1 / C2. */
  | 'no_resource_assignment_in_window'
  /** Exhausted tree, complete resource assignments exist but none passes the static coverage pre-check. */
  | 'no_coverage_feasible_assignment_in_window'
  /** Exhausted tree with structural candidates: fully enumerated; whether any comes true is Phase D's question. */
  | 'structural_candidates_enumerated'
  /** The candidate limit stopped the collection: structural candidates exist, the rest of the tree is unconfirmed. */
  | 'structural_candidates_found_remainder_unconfirmed'
  /** A Production-verified upper bound cut part of the tree (design 10.3 `verified` row: Phase B does not widen). */
  | 'upper_bound_pruned'
  /** The node budget stopped the search: unexplored branches remain. */
  | 'search_incomplete'
  /** A cancel stopped the scan or the search. */
  | 'interrupted'
  | 'unmeasured'
  | 'unsupported_input'
  | 'invalid_input'

export interface StructuralWindowDecision {
  /** `expand`: the design 10.3 rule asks for the next rung. `hold`: stay (or stop) without widening. */
  action: 'expand' | 'hold'
  conclusion: StructuralWindowConclusion
  rungIndex: number
  /** The rung to scan next when `action` is `expand` and the ladder has one; otherwise null. */
  nextRungIndex: number | null
  /** `expand` was asked at the top rung: the registered ladder held no structural candidate (still not infeasibility). */
  ladderExhausted: boolean
  /** Always false: no outcome of this Phase proves that a feasible Plan does not exist (design 10.3 / 12). */
  concludesInfeasibility: false
  note: string
}

export function decideStructuralWindowTransition(outcome: StructuralStageOutcome, rungIndex: number, ladder: readonly ReachWindow[]): StructuralWindowDecision {
  const ladderIssues = validateWindowLadder(ladder)
  if (ladderIssues.length > 0) throw new RangeError(`Invalid window ladder: ${ladderIssues.join(' ')}`)
  if (!Number.isSafeInteger(rungIndex) || rungIndex < 0 || rungIndex >= ladder.length) throw new RangeError(`rungIndex ${String(rungIndex)} is outside the ladder (0..${ladder.length - 1}).`)
  const hold = (conclusion: StructuralWindowConclusion, note: string): StructuralWindowDecision =>
    ({ action: 'hold', conclusion, rungIndex, nextRungIndex: null, ladderExhausted: false, concludesInfeasibility: false, note })
  const expand = (conclusion: StructuralWindowConclusion, note: string): StructuralWindowDecision => {
    const hasNext = rungIndex + 1 < ladder.length
    return {
      action: 'expand', conclusion, rungIndex, nextRungIndex: hasNext ? rungIndex + 1 : null, ladderExhausted: !hasNext, concludesInfeasibility: false,
      note: hasNext ? `${note} The design 10.3 rule asks for rung ${rungIndex + 1}.` : `${note} Rung ${rungIndex} is the top of the registered ladder, so the registered ladder held no structural candidate; this is not the absence of a feasible Plan.`,
    }
  }
  switch (outcome.kind) {
    case 'no_structural_candidate':
      if (outcome.reason === 'target_without_option') return expand('no_option_in_window', 'The exhausted tree found a planning Target with no reach option inside this window.')
      if (outcome.reason === 'resource_exclusivity') return expand('no_resource_assignment_in_window', 'Every planning Target has options inside this window, but the exhausted tree found no complete assignment under C1 / C2.')
      if (outcome.reason === 'coverage_infeasible') {
        return expand('no_coverage_feasible_assignment_in_window', 'The exhausted tree found complete resource assignments, but none passes the static Counter coverage pre-check (a later Reset Skills or conversion position of the next rung may cover the uncovered Skill positions).')
      }
      return hold('upper_bound_pruned', 'A Production-verified upper bound cut part of the tree; nothing is concluded about the cut part, and Phase B does not widen after a verified result.')
    case 'structural_candidates_found':
      return outcome.completeness === 'exhausted'
        ? hold('structural_candidates_enumerated', 'The exhausted tree enumerated every structural candidate of this window; whether one comes true is decided by Phase D / D\', not by widening.')
        : hold('structural_candidates_found_remainder_unconfirmed', 'The candidate limit stopped the collection: structural candidates exist, the rest of the tree is unconfirmed, and nothing is said about a wider window.')
    case 'search_incomplete':
      return outcome.completeness === 'node_budget_reached'
        ? hold('search_incomplete', 'The node budget stopped the search with unexplored branches; coverage infeasibility of this window is not concluded, the node budget is reviewed first, the window is not widened.')
        : hold('interrupted', 'The search was cancelled; nothing is concluded about this window.')
    case 'scan_cancelled':
      return hold('interrupted', 'The ReachTable scan was cancelled before the search started; nothing is concluded about this window.')
    case 'unmeasured':
      return hold('unmeasured', `The run is unmeasured (${outcome.reason}); the execution envelope is reviewed first, the window is not widened.`)
    case 'unsupported_input':
      return hold('unsupported_input', `The input does not satisfy the Phase A premises (${outcome.reason}); a window is not the remedy.`)
    case 'invalid_input':
      return hold('invalid_input', `The search refused its input (${outcome.reason}); the run is inconsistent and widens nothing.`)
  }
}

/** The stage outcome of a collected coverage-gated search result. */
export function structuralStageOutcomeOf(result: CoverageSearchResult<unknown>): StructuralStageOutcome {
  switch (result.status) {
    case 'candidates_found':
      return { kind: 'structural_candidates_found', completeness: result.completeness }
    case 'no_structural_candidate':
      return { kind: 'no_structural_candidate', reason: result.reason }
    case 'search_incomplete':
      return { kind: 'search_incomplete', completeness: result.completeness }
    case 'invalid_input':
      return { kind: 'invalid_input', reason: result.reason }
  }
}
