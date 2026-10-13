/**
 * Issue #154 Production準備 P-1 (Research only; never imported by the app).
 *
 * The judgement of one Browser logical run (first Worker + fresh Worker) from the two settlements alone
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 12.1). The order is the D-1A `judgeD1aRun()` order - integrity issues, the first
 * Worker's settlement, its verification outcome, the fresh Worker's settlement, the fresh Phase 0 set against the first one, the fresh
 * outcome, the two semantic records - with `differingSemanticFields()` reused. What differs:
 *
 * - no D-0C identity is compared (design 6.2 #5). Its place is taken by `phase_d_prime_not_reached`: the first Worker completed but its
 *   materialization handed nothing to Phase D' (Phase 0 / A unsupported, no candidate, an incomplete or cancelled structural search, a
 *   fail-closed run); the materialization's own typed outcome is carried as it is
 * - a settlement other than `completed` (the main thread adopted no `gab_result`) is `unmeasured` with the D-1A reason of design 7.11 and
 *   the Browser classification kept beside it; a cancelled request (its result discarded or not) is never anything else. A first
 *   request that was never posted (`not_run`) is `unmeasured` too, and a logical run with a recorded cancel never reaches a fresh-side
 *   outcome or `browser_nonformal_conditions_met` (PR #257 Required fix 1)
 * - both Workers meeting every condition and agreeing is `browser_nonformal_conditions_met`: never `verified`, `nonformal_planner_verified`,
 *   a formal validity, an acceptance or a minimality claim
 *
 * The parity of P-2 (Node reference, D-1C RESULT, comparison population) is not judged here. Pure; no clock, file or expected value.
 */
import type { MaterializationRunOutcome } from '../materializationRunner'
import { differingSemanticFields, type D1aCandidateOutcome, type D1aUnmeasuredReason } from '../verificationProtocol'
import type { PlannerVerificationSemantic } from '../verify'
import type { GabSettleOutcome } from './globalAssignmentBrowserHarness'

/**
 * How one Worker's request ended, as the main thread recorded it: a harness settlement, `environment_unsupported` (no request was
 * posted), or the externally evidenced `page_lost` / `out_of_memory` (design 7.11; never set by the page itself in P-1).
 */
export type GabWorkerSettle = GabSettleOutcome | 'environment_unsupported' | 'page_lost' | 'out_of_memory'

export type GabUnmeasuredReason = D1aUnmeasuredReason | 'environment_unsupported'

/** Design 7.11: the D-1A process outcome of a Browser classification (the classification itself is kept in the verdict). */
export function gabUnmeasuredReason(settle: Exclude<GabWorkerSettle, 'completed'>): GabUnmeasuredReason {
  switch (settle) {
    case 'timeout': return 'timeout'
    case 'out_of_memory': return 'out_of_memory'
    case 'cancelled':
    case 'cancelled_terminated':
    case 'page_left': return 'cancelled'
    case 'worker_error':
    case 'worker_reported_error':
    case 'page_lost': return 'process_failure'
    case 'environment_unsupported': return 'environment_unsupported'
  }
}

export interface GabVerificationView {
  semantic: PlannerVerificationSemantic
  semanticSha256: string
}

export interface GabFirstWorkerView {
  /** `not_run`: no request was ever posted (the runner records why in `stoppedBeforeRequest`); never a fabricated settlement. */
  settle: GabWorkerSettle | 'not_run'
  /** Why a `not_run` first request was never posted: the logical run was cancelled or the page was left first (null otherwise). */
  stoppedBeforeRequest: 'cancel' | 'page_left' | null
  /** The materialization's own outcome when the first Worker completed (null otherwise). */
  materializationOutcome: MaterializationRunOutcome | null
  /** Null when Phase D' was not reached or the Worker did not complete. */
  verification: GabVerificationView | null
}

export interface GabFreshWorkerView {
  /** `not_run`: the runner never started it (the first Worker did not hand over an Entry set, or the logical run was cancelled). */
  settle: GabWorkerSettle | 'not_run'
  phase0PlanningTargetIds: string[] | null
  verification: GabVerificationView | null
}

export type GabLogicalRunSide = 'first' | 'fresh'

/** What the runner knows of the logical run as a whole (required: a caller cannot judge without saying whether it was cancelled). */
export interface GabLogicalRunContext {
  /** A cancel was recorded on the logical run, at any point (a request's cancel, before a request, between the Workers, after a settlement). */
  cancelled: boolean
}

export type GabLogicalRunVerdict =
  /** Both Workers completed, met every in-process condition and their semantic records are identical. Non-formal; not `verified`. */
  | { kind: 'browser_nonformal_conditions_met'; physicalOperations: number; planSteps: number; objective: number; planningTargetCount: number; fullPlannerRuns: { first: number; fresh: number } }
  /** The D-1A typed outcomes other than `verified` / `unmeasured`, unchanged. */
  | Exclude<D1aCandidateOutcome, { kind: 'verified' } | { kind: 'unmeasured' }>
  | { kind: 'unmeasured'; run: GabLogicalRunSide; reason: GabUnmeasuredReason; browserSettle: GabWorkerSettle | 'not_run' }
  /** The first Worker completed without a handoff to Phase D': the materialization's own outcome, never a Planner result. */
  | { kind: 'phase_d_prime_not_reached'; run: 'first'; materializationOutcome: MaterializationRunOutcome }
  /** The run's records or provenance are broken: nothing they say is trusted (never a Planner result, never conditions met). */
  | { kind: 'invalid_run_integrity'; issues: string[] }

export interface GabLogicalRunJudgement {
  verdict: GabLogicalRunVerdict
  /** `browser_nonformal_conditions_met`, or `browser_nonformal_<kind>`. Never a formal status. */
  recordClassification: string
  /** The two Workers' semantic records as observed, whatever the verdict (null when one side has none). */
  crossWorker: { compared: boolean; identical: boolean | null; differingFields: string[] }
  formal: false
  formalValidity: 'not_claimed'
  acceptance: 'not_claimed'
  minimality: 'not_claimed'
}

function outcomeOf(run: GabLogicalRunSide, settle: GabWorkerSettle, semantic: PlannerVerificationSemantic): GabLogicalRunVerdict | null {
  const outcome = semantic.outcome
  switch (outcome.kind) {
    case 'conditions_met': return null
    case 'materialization_failed':
    case 'materialization_unconfirmed':
    case 'materialization_unsupported':
      return { kind: outcome.kind, run: 'first', targetWeaponId: outcome.targetWeaponId, outcomeKind: outcome.outcomeKind, outcomeReason: outcome.outcomeReason }
    case 'planning_target_set_changed': return { kind: outcome.kind, run, reasons: structuredClone(outcome.reasons) }
    case 'planner_rejected': return { kind: outcome.kind, run, reasons: structuredClone(outcome.reasons) }
    case 'objective_mismatch': return { kind: outcome.kind, run, physicalOperations: outcome.physicalOperations, objective: outcome.objective, reasons: structuredClone(outcome.reasons) }
    case 'unmeasured': return { kind: 'unmeasured', run, reason: outcome.reason, browserSettle: settle }
  }
}

function classification(verdict: GabLogicalRunVerdict): string {
  return verdict.kind === 'browser_nonformal_conditions_met' ? verdict.kind : `browser_nonformal_${verdict.kind}`
}

/** The judgement of a run whose records cannot be judged (the runner's fallback when the judgement itself failed): integrity only. */
export function gabIntegrityJudgement(issues: readonly string[]): GabLogicalRunJudgement {
  const verdict: GabLogicalRunVerdict = { kind: 'invalid_run_integrity', issues: [...issues] }
  return {
    verdict, recordClassification: classification(verdict), crossWorker: { compared: false, identical: null, differingFields: [] },
    formal: false, formalValidity: 'not_claimed', acceptance: 'not_claimed', minimality: 'not_claimed',
  }
}

/**
 * One Browser logical run's verdict. `integrityIssues` is required (a caller cannot judge without saying what it found): any issue is
 * `invalid_run_integrity` whatever the records say. A first request that was never posted is `unmeasured` (`cancelled` when the logical
 * run was cancelled or the page left before it, `process_failure` otherwise). A first-side outcome stands whatever the fresh side shows;
 * one side alone never meets the conditions. A logical run with a recorded cancel is never `browser_nonformal_conditions_met` and never
 * reports a fresh-side outcome: past the first side it is `unmeasured` (`cancelled`), even when its last request completed before the
 * cancel was recorded.
 */
export function judgeBrowserLogicalRun(first: GabFirstWorkerView, fresh: GabFreshWorkerView, integrityIssues: readonly string[], logicalRun: GabLogicalRunContext): GabLogicalRunJudgement {
  const compared = first.verification !== null && fresh.verification !== null
  const differingFields = compared ? differingSemanticFields(first.verification!.semantic, fresh.verification!.semantic) : []
  const crossWorker = { compared, identical: compared ? first.verification!.semanticSha256 === fresh.verification!.semanticSha256 && differingFields.length === 0 : null, differingFields }
  const judged = (verdict: GabLogicalRunVerdict): GabLogicalRunJudgement => ({
    verdict, recordClassification: classification(verdict), crossWorker, formal: false, formalValidity: 'not_claimed', acceptance: 'not_claimed', minimality: 'not_claimed',
  })

  if (integrityIssues.length > 0) return judged({ kind: 'invalid_run_integrity', issues: [...integrityIssues] })
  if (first.settle === 'not_run') return judged({ kind: 'unmeasured', run: 'first', reason: first.stoppedBeforeRequest !== null ? 'cancelled' : 'process_failure', browserSettle: 'not_run' })
  if (first.settle !== 'completed') return judged({ kind: 'unmeasured', run: 'first', reason: gabUnmeasuredReason(first.settle), browserSettle: first.settle })
  if (first.verification === null) {
    if (first.materializationOutcome === null) return judged({ kind: 'unmeasured', run: 'first', reason: 'process_failure', browserSettle: first.settle })
    return judged({ kind: 'phase_d_prime_not_reached', run: 'first', materializationOutcome: structuredClone(first.materializationOutcome) })
  }
  const firstOutcome = outcomeOf('first', first.settle, first.verification.semantic)
  if (firstOutcome !== null) return judged(firstOutcome)

  if (logicalRun.cancelled) return judged({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled', browserSettle: fresh.settle })
  if (fresh.settle === 'not_run') return judged({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled', browserSettle: 'not_run' })
  if (fresh.settle !== 'completed') return judged({ kind: 'unmeasured', run: 'fresh', reason: gabUnmeasuredReason(fresh.settle), browserSettle: fresh.settle })
  if (fresh.verification === null || fresh.phase0PlanningTargetIds === null) return judged({ kind: 'unmeasured', run: 'fresh', reason: 'process_failure', browserSettle: fresh.settle })
  const firstPhase0 = first.verification.semantic.finalInput?.phase0PlanningTargetIds ?? []
  const freshPhase0 = new Set(fresh.phase0PlanningTargetIds)
  const added = fresh.phase0PlanningTargetIds.filter(id => !firstPhase0.includes(id))
  const removed = firstPhase0.filter(id => !freshPhase0.has(id))
  if (added.length > 0 || removed.length > 0) {
    const reasons: Extract<GabLogicalRunVerdict, { kind: 'planning_target_set_changed' }>['reasons'] = []
    if (added.length > 0) reasons.push({ code: 'planning_target_added', targetWeaponIds: added })
    if (removed.length > 0) reasons.push({ code: 'planning_target_removed', targetWeaponIds: removed })
    return judged({ kind: 'planning_target_set_changed', run: 'fresh', reasons })
  }
  const freshOutcome = outcomeOf('fresh', fresh.settle, fresh.verification.semantic)
  if (freshOutcome !== null) return judged(freshOutcome)
  if (crossWorker.identical !== true) return judged({ kind: 'planner_rejected', run: 'cross_process', reasons: [{ code: 'fresh_planner_mismatch', differingFields }] })

  const physical = first.verification.semantic.physical!
  return judged({
    kind: 'browser_nonformal_conditions_met', physicalOperations: physical.physicalOperations!, planSteps: physical.planSteps!, objective: physical.objective,
    planningTargetCount: first.verification.semantic.candidate.planningTargetCount,
    fullPlannerRuns: { first: first.verification.semantic.planner!.fullPlannerRuns, fresh: fresh.verification.semantic.planner!.fullPlannerRuns },
  })
}
