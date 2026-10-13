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
 * P-2 adds three judgements that never feed one another (design 12.2 / 12.4 / 12.6), over values the analysis module extracted from the
 * raw records (`globalAssignmentBrowserAnalysis.ts`): the semantic parity of one measurement environment (`parity_confirmed` /
 * `parity_mismatch` / `not_comparable`, judged on the comparison population of the committed measurement plan only), the cancel trial of
 * one cancel slot (`cancel_passed` / `cancel_failed` / `cancel_not_exercised`) and the tally of how every slot ended. None of them reads a
 * clock, a file or the Worker; the expected values are arguments (the D-1C public RESULT and the Node reference, read post hoc).
 */
import type { MaterializationRunOutcome } from '../materializationRunner'
import { differingSemanticFields, type D1aCandidateOutcome, type D1aUnmeasuredReason } from '../verificationProtocol'
import type { PlannerVerificationSemantic } from '../verify'
import type { GabCancelObservation, GabSettledBy, GabSettleOutcome } from './globalAssignmentBrowserHarness'
import type { GabRole } from './globalAssignmentBrowserProtocol'
import type { GabRunPurpose } from './globalAssignmentBrowserRunner'

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

// =====================================================================================================================================
// P-2: the semantic parity of one measurement environment (design 12.2 / 12.4)
// =====================================================================================================================================

/** Design 12.2: how a run purpose enters the semantic parity (`required` counts towards the planned runs; `additional` is compared when both Workers completed). */
export type GabComparisonRole = 'required' | 'additional' | 'excluded'

export function gabComparisonRole(purpose: GabRunPurpose): GabComparisonRole {
  switch (purpose) {
    case 'timing':
    case 'rerun': return 'required'
    case 'responsiveness':
    case 'memory': return 'additional'
    case 'cancel':
    case 'pilot': return 'excluded'
  }
}

/** Design 12.2: an environment that planned fewer required comparison runs than this never claims `parity_confirmed`. */
export const GAB_MINIMUM_REQUIRED_COMPARISON_RUNS = 2

/** The design 12.1 materialization items of one first Worker (or one reference process), in a form every source can give. */
export interface GabMaterializationParityView {
  semanticSha256: string
  planningTargetCount: number | null
  runOutcome: string | null
  verdict: string
  candidate: {
    ordinal: number; objective: number; targetCount: number; classification: string; materialized: number; notAttempted: number
    materializedBy: Record<string, number>; independentStops: Record<string, number>
  } | null
  /** The Entry fingerprint the semantic record names (`materializedEntriesFingerprintOfSemantic`). */
  entryFingerprint: string | null
  /** `hashStableValue` of each top-level field of the semantic record; null where only a summary exists (the D-1C public RESULT). */
  semanticKeyHashes: Record<string, string> | null
}

/** The design 12.1 Planner integration items of one Worker (or one reference process). */
export interface GabVerificationParityView {
  semanticSha256: string
  outcomeKind: string
  planningTargetCount: number
  materializedEntryCount: number
  entryFingerprint: string
  termination: { status: string; reachedLimits: string[]; limits: Record<string, number>; expandedStates: number; completedTargetCount: number; totalTargetCount: number } | null
  selectedEntryCount: number | null
  conflictCount: number | null
  rejectedCount: number | null
  resourceConflictCount: number | null
  warningCount: number | null
  fullPlannerRuns: number | null
  plannerPlanSteps: number | null
  planHash: string | null
  stepSemanticsHash: string | null
  traceReplay: { isValid: boolean | null; draftsTotal: number; draftsPhysical: number; draftsReserve: number; mismatchCount: number | null; counterPositionMismatchCount: number | null } | null
  physical: { physicalOperations: number | null; planSteps: number | null; nonPhysicalStepCount: number | null; streamAdvanceSum: number | null; objective: number; executedHash: string | null } | null
  semanticKeyHashes: Record<string, string> | null
}

/** What one Worker (or reference process) contributes to the comparison; a null part is one it did not produce. */
export interface GabWorkerParityView {
  phase0PlanningTargetCount: number | null
  /** First Worker only. */
  materialization: GabMaterializationParityView | null
  /** First: the Entry set it handed over; fresh: the Entry set it planned with. */
  entryFingerprint: string | null
  verification: GabVerificationParityView | null
}

/** A reference (the D-1C public RESULT, or the Node reference of the same measurement HEAD): one first and one fresh process. */
export interface GabReferenceView {
  first: GabWorkerParityView
  fresh: GabWorkerParityView
}

/** Design 12.4 step 1: a premise of the comparison that does not hold (the inputs are not comparable, so no difference is a mismatch). */
export type GabPremiseReason = 'export_identity_mismatch' | 'calculation_context_mismatch' | 'conditions_mismatch' | 'reference_inconsistent' | 'node_reference_head_mismatch'

export interface GabPremiseIssue {
  reason: GabPremiseReason
  /** What does not hold it: `plan`, `d1c_result`, `node_reference`, `registration` or a slot ID. */
  source: string
  detail: string
}

export type GabParityStatus = 'parity_confirmed' | 'parity_mismatch' | 'not_comparable'
export type GabParityReason = GabPremiseReason | 'node_reference_missing' | 'required_runs_incomplete' | 'planned_runs_below_minimum'
export type GabParityPart = 'phase0' | 'materialization' | 'entry_set' | 'verification'

/** One planned slot of the environment and the record bound to it (null: no record of the measurement is bound to it). */
export interface GabParitySlot {
  slotId: string
  purpose: GabRunPurpose
  record: {
    integrityIssueCount: number
    verdictKind: string
    first: { settle: string; view: GabWorkerParityView | null }
    fresh: { settle: string; view: GabWorkerParityView | null }
  } | null
}

export interface GabEnvironmentParityInput {
  environmentId: string
  /** The planned number of required comparison runs (the plan at the measured commit). */
  requiredComparisonRuns: number
  /** The environment's planned slots, in plan order. */
  slots: readonly GabParitySlot[]
  premiseIssues: readonly GabPremiseIssue[]
  d1c: GabReferenceView
  node: GabReferenceView | null
}

export interface GabParityMismatch {
  against: 'd1c_result' | 'node_reference' | 'browser_internal'
  slotId: string
  worker: GabRole
  part: GabParityPart
  fields: string[]
  /** `browser_internal`: the slot and Worker it was compared with. */
  comparedWith: { slotId: string; worker: GabRole } | null
}

export interface GabParitySlotStatus {
  slotId: string
  purpose: GabRunPurpose
  comparisonRole: GabComparisonRole
  recorded: boolean
  firstSettle: string | null
  freshSettle: string | null
  verdictKind: string | null
  integrityIssueCount: number | null
  /** Required: both Workers completed, met every condition and the record is intact (it counts towards the planned runs). */
  completed: boolean
  /** The Workers whose values entered the comparison. */
  comparedWorkers: GabRole[]
}

export interface GabEnvironmentParity {
  environmentId: string
  status: GabParityStatus
  /** Why, in the order of design 12.4 (the first decides the status; the rest are recorded beside it). */
  reasonCodes: GabParityReason[]
  premiseIssues: GabPremiseIssue[]
  /** The Node reference against the D-1C public RESULT: a finding of its own whatever the Browser shows (design 12.4 step 1). */
  referenceMismatches: { worker: GabRole; part: GabParityPart; fields: string[] }[]
  mismatches: GabParityMismatch[]
  requiredComparisonRuns: number
  completedRequiredRuns: number
  slots: GabParitySlotStatus[]
  comparedWorkerCount: number
  formal: false
  claims: string
}

const PARITY_CLAIMS = 'parity_confirmed means only that this environment\'s planned required comparison runs gave the semantic values of the Node reference of the same measurement HEAD and of the D-1C public RESULT; it is no performance, cancel, formal validity, acceptance or Production claim'

/** Leaf paths of a plain value (arrays are leaves; `semanticKeyHashes` is compared only when both sides carry one). */
function flattenView(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) flattenView(item, prefix === '' ? key : `${prefix}.${key}`, out)
    return
  }
  out.set(prefix, JSON.stringify(value ?? null))
}

/** The fields in which two views differ (`(absent)` when only one side has the part). */
function viewDifferences<T extends { semanticKeyHashes: Record<string, string> | null }>(left: T | null, right: T | null): string[] {
  if (left === null && right === null) return []
  if (left === null || right === null) return ['(absent)']
  const { semanticKeyHashes: leftKeys, ...leftRest } = left
  const { semanticKeyHashes: rightKeys, ...rightRest } = right
  const leftMap = new Map<string, string>()
  const rightMap = new Map<string, string>()
  flattenView(leftRest, '', leftMap)
  flattenView(rightRest, '', rightMap)
  if (leftKeys !== null && rightKeys !== null) {
    flattenView({ semanticKeyHashes: leftKeys }, '', leftMap)
    flattenView({ semanticKeyHashes: rightKeys }, '', rightMap)
  }
  return [...new Set([...leftMap.keys(), ...rightMap.keys()])].filter(key => leftMap.get(key) !== rightMap.get(key)).sort()
}

/** The parts in which two Workers' values differ; `withMaterialization` compares the first-Worker part too. */
function workerDifferences(left: GabWorkerParityView, right: GabWorkerParityView, withMaterialization: boolean): { part: GabParityPart; fields: string[] }[] {
  const parts: { part: GabParityPart; fields: string[] }[] = []
  if (left.phase0PlanningTargetCount !== right.phase0PlanningTargetCount) parts.push({ part: 'phase0', fields: ['phase0PlanningTargetCount'] })
  if (withMaterialization) {
    const fields = viewDifferences(left.materialization, right.materialization)
    if (fields.length > 0) parts.push({ part: 'materialization', fields })
  }
  if (left.entryFingerprint !== right.entryFingerprint) parts.push({ part: 'entry_set', fields: ['entryFingerprint'] })
  const verification = viewDifferences(left.verification, right.verification)
  if (verification.length > 0) parts.push({ part: 'verification', fields: verification })
  return parts
}

/**
 * The semantic parity of one environment (design 12.4), judged on the comparison population of the committed plan only:
 *
 * 1. a premise that does not hold (the Export, CalculationContext or conditions of a record or reference, or a Node reference that is
 *    not the D-1C one, or from another HEAD) -> `not_comparable` (no difference between such inputs is called a mismatch)
 * 2. the population: every Worker of a required slot (`timing` / `rerun`) that completed with an intact record, and both Workers of an
 *    additional slot (`responsiveness` / `memory`) when both completed with an intact record; `cancel` / `pilot` never
 * 3. a confirmed difference of any compared Worker from the D-1C public RESULT, the Node reference, or another compared Browser Worker
 *    -> `parity_mismatch`, even when the required runs are short (never hidden behind 4 / 5)
 * 4. no Node reference -> `not_comparable` (`node_reference_missing`)
 * 5. a required slot that is not completed (not run, a cancel, a timeout, a Worker error, a page loss, an integrity issue, conditions not
 *    met) -> `not_comparable` (`required_runs_incomplete`); fewer than two planned -> `planned_runs_below_minimum`
 * 6. otherwise `parity_confirmed`
 *
 * Nothing here substitutes a run, re-labels a purpose or changes the planned number: the slots and the number are the plan's.
 */
export function judgeGabEnvironmentParity(input: GabEnvironmentParityInput): GabEnvironmentParity {
  const premiseIssues = [...input.premiseIssues]
  const referenceMismatches = input.node === null ? [] : (['first', 'fresh'] as const).flatMap(worker =>
    workerDifferences(input.node![worker], input.d1c[worker], worker === 'first').map(difference => ({ worker, ...difference })))
  if (referenceMismatches.length > 0) {
    premiseIssues.push({ reason: 'reference_inconsistent', source: 'node_reference', detail: `The Node reference differs from the D-1C public RESULT in ${referenceMismatches.map(item => `${item.worker} ${item.part}`).join(', ')}.` })
  }

  const compared: { slotId: string; worker: GabRole; view: GabWorkerParityView }[] = []
  const slots: GabParitySlotStatus[] = input.slots.map(slot => {
    const role = gabComparisonRole(slot.purpose)
    const record = slot.record
    const comparedWorkers: GabRole[] = []
    if (role !== 'excluded' && record !== null && record.integrityIssueCount === 0) {
      const completed = (['first', 'fresh'] as const).filter(worker => record[worker].settle === 'completed' && record[worker].view !== null)
      if (role === 'required' || completed.length === 2) {
        for (const worker of completed) {
          comparedWorkers.push(worker)
          compared.push({ slotId: slot.slotId, worker, view: record[worker].view! })
        }
      }
    }
    return {
      slotId: slot.slotId, purpose: slot.purpose, comparisonRole: role, recorded: record !== null,
      firstSettle: record?.first.settle ?? null, freshSettle: record?.fresh.settle ?? null, verdictKind: record?.verdictKind ?? null,
      integrityIssueCount: record?.integrityIssueCount ?? null,
      completed: role === 'required' ? record !== null && record.integrityIssueCount === 0 && record.verdictKind === 'browser_nonformal_conditions_met' && comparedWorkers.length === 2
        : role === 'additional' && comparedWorkers.length === 2,
      comparedWorkers,
    }
  })
  const required = slots.filter(slot => slot.comparisonRole === 'required')
  const completedRequiredRuns = required.filter(slot => slot.completed).length
  const base = {
    environmentId: input.environmentId, premiseIssues, referenceMismatches, requiredComparisonRuns: input.requiredComparisonRuns, completedRequiredRuns, slots,
    comparedWorkerCount: compared.length, formal: false as const, claims: PARITY_CLAIMS,
  }

  if (premiseIssues.length > 0) {
    return { ...base, status: 'not_comparable', reasonCodes: [...new Set(premiseIssues.map(issue => issue.reason))], mismatches: [] }
  }

  const mismatches: GabParityMismatch[] = []
  const firstOfRole: Partial<Record<GabRole, { slotId: string; worker: GabRole; view: GabWorkerParityView }>> = {}
  const firstCompared = compared[0] ?? null
  for (const item of compared) {
    const withMaterialization = item.worker === 'first'
    for (const difference of workerDifferences(item.view, input.d1c[item.worker], withMaterialization)) mismatches.push({ against: 'd1c_result', slotId: item.slotId, worker: item.worker, ...difference, comparedWith: null })
    if (input.node !== null) {
      for (const difference of workerDifferences(item.view, input.node[item.worker], withMaterialization)) mismatches.push({ against: 'node_reference', slotId: item.slotId, worker: item.worker, ...difference, comparedWith: null })
    }
    // Browser-internal, transitively: every Worker against the first compared Worker of its role (the materialization too for first
    // Workers), and the first compared Worker of the other role against the environment's first compared Worker (a first and a fresh
    // Worker of one logical run plan the same Entry set, so their Phase 0, Entry set and Planner values are the same).
    const sameRole = firstOfRole[item.worker]
    const against = sameRole ?? (firstCompared !== null && firstCompared.worker !== item.worker ? firstCompared : null)
    if (sameRole === undefined) firstOfRole[item.worker] = item
    if (against !== null && against !== item) {
      for (const difference of workerDifferences(item.view, against.view, withMaterialization && against.worker === 'first')) {
        mismatches.push({ against: 'browser_internal', slotId: item.slotId, worker: item.worker, ...difference, comparedWith: { slotId: against.slotId, worker: against.worker } })
      }
    }
  }
  if (mismatches.length > 0) return { ...base, status: 'parity_mismatch', reasonCodes: [], mismatches }

  const reasonCodes: GabParityReason[] = []
  if (input.node === null) reasonCodes.push('node_reference_missing')
  if (required.length === 0 || completedRequiredRuns < Math.max(required.length, input.requiredComparisonRuns)) reasonCodes.push('required_runs_incomplete')
  if (input.requiredComparisonRuns < GAB_MINIMUM_REQUIRED_COMPARISON_RUNS) reasonCodes.push('planned_runs_below_minimum')
  if (reasonCodes.length > 0) return { ...base, status: 'not_comparable', reasonCodes, mismatches }
  return { ...base, status: 'parity_confirmed', reasonCodes, mismatches }
}

// =====================================================================================================================================
// P-2: a cancel trial (design 12.6), judged apart from the parity
// =====================================================================================================================================

export type GabCancelTrialStatus = 'cancel_passed' | 'cancel_failed' | 'cancel_not_exercised'

/** One Worker of the cancel slot's record, as the main thread recorded it. */
export interface GabCancelTrialWorker {
  role: GabRole
  settle: string
  requestStarted: boolean
  settledBy: GabSettledBy | null
  resultAdopted: boolean
  cancelRequested: boolean
  errorCode: string | null
  cancel: GabCancelObservation | null
  /** The Worker's own `gab_cancelled` observation (the stage it stopped at, and how). */
  stoppedAt: string | null
  via: string | null
  audit: { settleCount: number; adoptedResults: number; cancelAccepted: boolean } | null
  terminated: boolean | null
  lateResponses: number
}

export interface GabCancelTrialInput {
  slotId: string
  plannedTrigger: { role: GabRole; onProgressKey: string; delayMs: number }
  record: {
    cancel: { source: string; phase: string; role: GabRole | null; acceptedByRequest: string | null; requestedAtMs: number; triggered: { role: GabRole; onProgressKey: string; delayMs: number } | null } | null
    first: GabCancelTrialWorker
    fresh: GabCancelTrialWorker
  } | null
  /** An external observation of the slot (the driver): the page was lost, or an OOM was evidenced. */
  external: 'page_lost' | 'out_of_memory' | null
  /** The slot the plan placed after the trial to re-run (null: none planned); `completed`: both of its Workers completed. */
  rerun: { slotId: string; recorded: boolean; completed: boolean } | null
}

export interface GabCancelTrial {
  slotId: string
  status: GabCancelTrialStatus
  reasonCodes: string[]
  plannedTrigger: { role: GabRole; onProgressKey: string; delayMs: number }
  cancelPhase: string | null
  cancelledRole: GabRole | null
  settle: string | null
  settledBy: string | null
  stoppedAt: string | null
  via: string | null
  /** Main ms from the request post to the cancel's acceptance, then to the Worker's ack and to the settlement. */
  acceptedAtMs: number | null
  ackMs: number | null
  settledMs: number | null
  ignoredResultAfterCancel: boolean
  adoptedResults: number | null
  settleCount: number | null
  terminated: boolean | null
  lateResponses: number | null
  freshStarted: boolean | null
  rerun: { slotId: string; recorded: boolean; completed: boolean } | null
}

/**
 * One cancel trial (design 12.6). `cancel_passed`: the planned trigger's cancel was accepted while the request ran, that request settled
 * exactly once as `cancelled` (a `gab_cancelled`, or a `gab_result` dropped unadopted) or `cancelled_terminated`, no result was adopted,
 * the Worker was terminated, no fresh Worker started after a first-side cancel, and the re-run slot the plan placed after it completed.
 * `cancel_failed`: any of those does not hold (an error while cancelling is a failure even though no result was adopted).
 * `cancel_not_exercised`: no request was running when the cancel came (or none came, or the record was lost): neither a pass nor a failure.
 */
export function judgeGabCancelTrial(input: GabCancelTrialInput): GabCancelTrial {
  const record = input.record
  const base: GabCancelTrial = {
    slotId: input.slotId, status: 'cancel_not_exercised', reasonCodes: [], plannedTrigger: { ...input.plannedTrigger }, cancelPhase: record?.cancel?.phase ?? null, cancelledRole: record?.cancel?.role ?? null,
    settle: null, settledBy: null, stoppedAt: null, via: null, acceptedAtMs: null, ackMs: null, settledMs: null, ignoredResultAfterCancel: false, adoptedResults: null, settleCount: null,
    terminated: null, lateResponses: null, freshStarted: record === null ? null : record.fresh.requestStarted, rerun: input.rerun === null ? null : { ...input.rerun },
  }
  if (record === null) return { ...base, reasonCodes: [input.external === null ? 'slot_not_run' : `record_lost_${input.external}`] }
  const cancel = record.cancel
  if (cancel === null) return { ...base, reasonCodes: ['cancel_not_triggered'] }
  const planned = input.plannedTrigger
  if (cancel.source !== 'trigger' || cancel.triggered === null || cancel.triggered.role !== planned.role || cancel.triggered.onProgressKey !== planned.onProgressKey || cancel.triggered.delayMs !== planned.delayMs) {
    return { ...base, reasonCodes: ['cancel_not_from_planned_trigger'] }
  }
  if (cancel.phase !== 'request_running' || cancel.role === null) return { ...base, reasonCodes: ['no_request_running'] }
  const worker = record[cancel.role]
  const observation = worker.cancel
  const failures: string[] = []
  if (worker.audit === null) failures.push('no_harness_audit')
  else {
    if (worker.audit.settleCount !== 1) failures.push('settle_count_not_one')
    if (worker.audit.adoptedResults !== 0) failures.push('result_adopted')
    if (!worker.audit.cancelAccepted) failures.push('cancel_not_accepted')
  }
  if (worker.resultAdopted && !failures.includes('result_adopted')) failures.push('result_adopted')
  switch (worker.settle) {
    case 'cancelled':
      if (worker.settledBy === 'gab_error') failures.push('worker_reported_error_during_cancel')
      else if (worker.settledBy !== 'gab_cancelled' && worker.settledBy !== 'ignored_gab_result') failures.push(`unexpected_settle_path_${String(worker.settledBy)}`)
      break
    case 'cancelled_terminated': break
    case 'worker_error': failures.push('worker_error_during_cancel'); break
    case 'completed': if (!failures.includes('result_adopted')) failures.push('result_adopted'); break
    default: failures.push(`${worker.settle}_during_cancel`)
  }
  if (worker.terminated !== true) failures.push('worker_not_terminated')
  if (cancel.role === 'first' && record.fresh.requestStarted) failures.push('fresh_started_after_cancel')
  if (input.rerun !== null && !input.rerun.completed) failures.push(input.rerun.recorded ? 'rerun_not_completed' : 'rerun_not_run')
  return {
    ...base, status: failures.length === 0 ? 'cancel_passed' : 'cancel_failed', reasonCodes: failures,
    settle: worker.settle, settledBy: worker.settledBy, stoppedAt: worker.stoppedAt, via: worker.via,
    acceptedAtMs: observation?.acceptedAtMs ?? null, ackMs: observation?.ackMs ?? null, settledMs: observation?.settledMs ?? null,
    ignoredResultAfterCancel: observation?.ignoredResultAfterCancel !== null && observation?.ignoredResultAfterCancel !== undefined,
    adoptedResults: worker.audit?.adoptedResults ?? null, settleCount: worker.audit?.settleCount ?? null, terminated: worker.terminated, lateResponses: worker.lateResponses,
  }
}

// =====================================================================================================================================
// P-2: how every slot ended (design 12.6), tallied apart from the parity and the cancel trials
// =====================================================================================================================================

export const GAB_SETTLE_CLASSES = Object.freeze([
  'completed', 'cancelled', 'cancelled_terminated', 'timeout', 'worker_error', 'worker_reported_error', 'page_left', 'page_lost', 'out_of_memory', 'environment_unsupported', 'not_run',
] as const)

export interface GabOutcomeTallySlot {
  slotId: string
  purpose: GabRunPurpose
  record: { firstSettle: string; freshSettle: string; interrupted: boolean; ignoredResultAfterCancel: { first: boolean; fresh: boolean } } | null
  external: 'page_lost' | 'out_of_memory' | null
}

export interface GabOutcomeTally {
  plannedSlots: number
  recordedSlots: number
  /** Planned slots with no record (never run, or the record was lost: `external` says which were lost). */
  unrecordedSlots: string[]
  external: { page_lost: number; out_of_memory: number }
  bySettle: { first: Record<string, number>; fresh: Record<string, number> }
  byPurpose: Record<string, { slots: number; recorded: number; firstCompleted: number; freshCompleted: number }>
  ignoredResultAfterCancel: number
  interrupted: number
  /** Slots meant to complete (every purpose but `cancel`) that did not complete both Workers, with how they ended. */
  incomplete: { slotId: string; purpose: GabRunPurpose; firstSettle: string | null; freshSettle: string | null; external: string | null }[]
  unplannedRecords: { count: number; reasonCounts: Record<string, number> }
}

/** The tally of every planned slot's ending and of the unplanned records (independent of the parity: nothing here reads it). */
export function tallyGabOutcomes(slots: readonly GabOutcomeTallySlot[], unplanned: readonly { reason: string }[]): GabOutcomeTally {
  const zero = () => Object.fromEntries(GAB_SETTLE_CLASSES.map(name => [name, 0])) as Record<string, number>
  const tally: GabOutcomeTally = {
    plannedSlots: slots.length, recordedSlots: 0, unrecordedSlots: [], external: { page_lost: 0, out_of_memory: 0 }, bySettle: { first: zero(), fresh: zero() }, byPurpose: {},
    ignoredResultAfterCancel: 0, interrupted: 0, incomplete: [], unplannedRecords: { count: unplanned.length, reasonCounts: {} },
  }
  for (const slot of slots) {
    const purpose = (tally.byPurpose[slot.purpose] ??= { slots: 0, recorded: 0, firstCompleted: 0, freshCompleted: 0 })
    purpose.slots += 1
    if (slot.external !== null) tally.external[slot.external] += 1
    const record = slot.record
    if (record === null) {
      tally.unrecordedSlots.push(slot.slotId)
      if (slot.purpose !== 'cancel') tally.incomplete.push({ slotId: slot.slotId, purpose: slot.purpose, firstSettle: null, freshSettle: null, external: slot.external })
      continue
    }
    tally.recordedSlots += 1
    purpose.recorded += 1
    tally.bySettle.first[record.firstSettle] = (tally.bySettle.first[record.firstSettle] ?? 0) + 1
    tally.bySettle.fresh[record.freshSettle] = (tally.bySettle.fresh[record.freshSettle] ?? 0) + 1
    if (record.firstSettle === 'completed') purpose.firstCompleted += 1
    if (record.freshSettle === 'completed') purpose.freshCompleted += 1
    if (record.ignoredResultAfterCancel.first) tally.ignoredResultAfterCancel += 1
    if (record.ignoredResultAfterCancel.fresh) tally.ignoredResultAfterCancel += 1
    if (record.interrupted) tally.interrupted += 1
    if (slot.purpose !== 'cancel' && (record.firstSettle !== 'completed' || record.freshSettle !== 'completed')) {
      tally.incomplete.push({ slotId: slot.slotId, purpose: slot.purpose, firstSettle: record.firstSettle, freshSettle: record.freshSettle, external: slot.external })
    }
  }
  for (const { reason } of unplanned) tally.unplannedRecords.reasonCounts[reason] = (tally.unplannedRecords.reasonCounts[reason] ?? 0) + 1
  return tally
}
