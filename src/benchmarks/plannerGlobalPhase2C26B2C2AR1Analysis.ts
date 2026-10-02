/**
 * Issue #154 Phase 2-C2.6-B2-C2A-R1 post-hoc analysis only. It reads the finished R1 retry run (the B2-C2A timeout
 * subset searched again) and, after the run ended, the committed B2-C2A RESULT (the original 318 measured tasks, never
 * re-run) plus the oracle used by B2-C2A. It runs no Search, no kernel and no Planner and feeds nothing back.
 *
 * The overlay is a completion overlay, not a new population:
 *
 * ```text
 * original  = B2-C2A RESULT task rows (318 measured, 2 timeout)          the RESULT is never rewritten
 * retry     = the R1 child records of the retry manifest tasks only      compared by the unchanged B2-C2A comparison
 * combined  = original rows, with each retry task's row replaced by its retry comparison (when measured)
 * ```
 *
 * The retried contexts are judged by exactly the B2-C2A authorities: compatibility by `phase2c26b2c1TargetReach()` (via
 * `phase2c26b2c2aReach()`), Candidate coverage by `phase2c26b2b2aCompare()` -> `phase2c2OracleCoverage()` (via
 * `phase2c26b2c2aCompareContext()`), the raw capture by `validatePhase2C26B2C2ARaw()`, per-Target first exact by
 * `phase2c26b2c2aTargetRow()`, and the decision semantics by `phase2c26b2c2aDecision()`. Nothing re-implements oracle
 * matching.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2ATaskInput } from './plannerGlobalPhase2C26B2C2A'
import {
  phase2c26b2c2aBudgetCoverage,
  phase2c26b2c2aCascade,
  phase2c26b2c2aCompareContext,
  phase2c26b2c2aDecision,
  phase2c26b2c2aTargetRow,
  validatePhase2C26B2C2ARaw,
  PHASE2C26B2C2A_CAPTURE_POLICIES,
  type Phase2C26B2C2ACapturePolicy,
  type Phase2C26B2C2AContextComparison,
  type Phase2C26B2C2ADecisionCase,
  type Phase2C26B2C2AReach,
  type Phase2C26B2C2ARun,
  type Phase2C26B2C2ATargetRow,
} from './plannerGlobalPhase2C26B2C2AAnalysis'
import { PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS, type Phase2C26B2C2AR1RetryManifest } from './plannerGlobalPhase2C26B2C2AR1'
import { phase2c26b2c2ar1TimeoutTaskIds, type Phase2C26B2C2AR1Authority, type Phase2C26B2C2AR1OriginalTaskRow } from './plannerGlobalPhase2C26B2C2AR1Authority'

const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

// ---------------------------------------------------------------- the original contexts, as recorded

/** A B2-C2A task row is measured when its child completed with a Search record. */
export const phase2c26b2c2ar1OriginalMeasured = (row: Pick<Phase2C26B2C2AR1OriginalTaskRow, 'process' | 'record'>) => row.process === 'completed' && row.record === 'searched'

/**
 * A recorded B2-C2A task row as the per-context comparison `phase2c26b2c2aTargetRow()` reads. The RESULT keeps the first
 * exact / partial index and the counts, not every index, so `exactIndexes` / `partialIndexes` carry the first index only:
 * the Target-row authority reads the per-policy `hit`, the first exact index / cost and whether a partial exists, and never
 * the other indexes. Nothing here re-judges the oracle.
 */
export function phase2c26b2c2ar1OriginalContext(row: Phase2C26B2C2AR1OriginalTaskRow): Phase2C26B2C2AContextComparison {
  const measured = phase2c26b2c2ar1OriginalMeasured(row)
  return { taskId: row.taskId, targetWeaponId: row.targetWeaponId, contextRank: row.contextRank, groupIndex: row.groupIndex, measured, compatible: row.compatible,
    captureComplete: measured ? row.captureComplete : null, safetyCapHit: measured ? row.safetyCapHit : null, candidateCount: measured ? row.candidateCount : null,
    capturedCosts: [...row.capturedCosts], coverage: row.coverage, exactIndexes: row.firstExactIndex === null ? [] : [row.firstExactIndex],
    partialIndexes: row.firstPartialIndex === null ? [] : [row.firstPartialIndex], firstExactIndex: row.firstExactIndex, firstExactCost: row.firstExactCost,
    firstPartialIndex: row.firstPartialIndex, hit: { ...row.hit }, sentinelExact: row.sentinelExact, reservationViolations: row.reservationViolations, inconsistencies: [] }
}

/** The task fields the reconstruction must reproduce for every B2-C2A row (the spec's task identity). */
const TASK_FIELDS = ['taskId', 'targetWeaponId', 'contextRank', 'groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId',
  'representativeFixedTargetWeaponIds', 'searchInputDigest'] as const

/** Every reconstructed task against the B2-C2A row of the same ID: the same 320 IDs, each with the same task identity. */
export function phase2c26b2c2ar1ReconstructionParity(tasks: readonly Phase2C26B2C2ATaskInput[], taskRows: readonly Phase2C26B2C2AR1OriginalTaskRow[]): string[] {
  const issues: string[] = []
  if (tasks.length !== taskRows.length) issues.push(`${tasks.length} reconstructed tasks, ${taskRows.length} B2-C2A rows`)
  const rowOf = new Map(taskRows.map(row => [row.taskId, row]))
  for (const task of tasks) {
    const row = rowOf.get(task.taskId)
    if (!row) { issues.push(`${task.taskId}: no B2-C2A row`); continue }
    const drift = TASK_FIELDS.filter(key => !same(task[key], row[key]))
    if (drift.length > 0) issues.push(`${task.taskId}: ${drift.join(', ')} differ from B2-C2A`)
  }
  for (const row of taskRows) if (!tasks.some(t => t.taskId === row.taskId)) issues.push(`${row.taskId}: not reconstructed`)
  return issues
}

// ---------------------------------------------------------------- decision (registered before the formal retry)

export type Phase2C26B2C2AR1DecisionCase = 'B2C2AR1_ALL_C4C' | 'B2C2AR1_ALL_C32' | 'B2C2AR1_ALL_C8' | 'B2C2AR1_INCOMPLETE' | 'B2C2AR1_INVALID'

export const PHASE2C26B2C2AR1_DECISION_RULE = {
  order: [
    'B2C2AR1_INVALID: a B2-C2A RESULT authority mismatch (SHA-256, formal, calculation change, case other than B2C2A_INCOMPLETE, counts other than 318 completed / 2 timeout / 0 OOM / 0 failure / 0 context mismatch, exact Targets other than C8 18 / C32 18 / C4C 20, invalid reasons), a retry manifest other than the B2-C2A timeout rows (count, IDs, source hashes), a Target manifest / Export / oracle / hash-chain mismatch, a 320-task or retry-task reconstruction mismatch, a schedule parity failure, an extent / capture / budget condition drift, a retry run outside the manifest or run twice, a context mismatch, a raw / record inconsistency (validatePhase2C26B2C2ARaw), a Candidate reservation violation (sentinel included), an exact or partial Candidate (or exact sentinel) from a reservation-incompatible context, a recomputed compatibility other than the B2-C2A row, a recomputed P1 first compatible rank other than B2-C1\'s, a first exact rank before the first compatible rank, the original rows not reproducing the B2-C2A Target aggregates, a combined exact count below the original, or a provenance failure',
    'B2C2AR1_INCOMPLETE: no invalid reason, and a retry task was not measured (timeout / out of memory / process failure: never Candidate 0, never retried again in this Phase), or the combined B2-C2A decision semantics are otherwise INCOMPLETE',
    'B2C2AR1_ALL_C8 / B2C2AR1_ALL_C32 / B2C2AR1_ALL_C4C: retry 2 / 2 measured, combined 320 / 320 measured, no invalid reason, and the B2-C2A decision semantics over the combined rows give ALL_C8 / ALL_C32 / ALL_C4C (ALL_C4C: C4C 20 / 20 with C32 < 20)',
    'a combined B2C2A_PARTIAL cannot arise from a valid overlay (the original authority already holds C4C 20 / 20 and an overlay never removes an exact) and is recorded as B2C2AR1_INVALID',
  ],
  overlay: 'original B2-C2A rows for every task outside the retry manifest; a retry task row is replaced only by its R1 retry comparison when the retry child completed with a Search record; no task counted twice; no task outside the retry manifest overlaid',
  semantics: 'phase2c26b2c2aDecision() over the combined 320 contexts: 20 Targets, unmeasured = combined contexts without a Search record, exact Targets per capture policy, unresolved safety cap only for Targets without a C4C exact',
} as const

export const PHASE2C26B2C2AR1_RECOMMENDATION: Record<Phase2C26B2C2AR1DecisionCase, string> = {
  B2C2AR1_ALL_C4C: 'default extent 20件は完了。次はextent不足20件についてscheduler-selected contextを使ったextent requirement / Search probeへ。K2-minimal 9件（P1 rank 50〜306）は同じtop16 brute-forceへ進む前にTarget-relative K2 feature / grouping改善を検討。residual unreached 3件は引き続きalternative-to-alternative support（別系統）。P1 / budget 16 / C4CのProduction採用ではない',
  B2C2AR1_ALL_C32: 'default extent 20件は完了（C32で閉じる）。次はextent不足20件のscheduler-selected context extent requirement / Search probeへ（K2-minimal 9件は別途）。Production採用ではない',
  B2C2AR1_ALL_C8: 'default extent 20件は完了（C8で閉じる）。次はextent不足20件のscheduler-selected context extent requirement / Search probeへ（K2-minimal 9件は別途）。Production採用ではない',
  B2C2AR1_INCOMPLETE: '未完走taskだけについてruntime completionを継続する（このPhaseでは60分retry・extent変更・capture縮小・concurrency変更・Search最適化を追加しない）',
  B2C2AR1_INVALID: '次へ進まず原因修正',
}

const CASE_MAP: Record<Phase2C26B2C2ADecisionCase, Phase2C26B2C2AR1DecisionCase> = {
  B2C2A_ALL_C8: 'B2C2AR1_ALL_C8', B2C2A_ALL_C32: 'B2C2AR1_ALL_C32', B2C2A_ALL_C4C: 'B2C2AR1_ALL_C4C', B2C2A_PARTIAL: 'B2C2AR1_INVALID', B2C2A_INCOMPLETE: 'B2C2AR1_INCOMPLETE', B2C2A_INVALID: 'B2C2AR1_INVALID',
}

export interface Phase2C26B2C2AR1DecisionInput {
  invalidReasons: readonly string[]
  retrySelected: number
  retryMeasured: number
  /** Retry tasks that ended in a timeout / out of memory / process failure. */
  retryUnmeasured: number
  combined: { tasks: number; targets: number; unmeasuredTasks: number; exactTargets: Record<Phase2C26B2C2ACapturePolicy, number>; unresolvedSafetyCapTargets: number }
  originalExactTargets: Record<Phase2C26B2C2ACapturePolicy, number>
}

/** The registered R1 rule: the B2-C2A decision semantics re-applied to the combined rows, plus the R1 completion checks. */
export function phase2c26b2c2ar1Decision(input: Phase2C26B2C2AR1DecisionInput) {
  const { retrySelected, retryMeasured, retryUnmeasured, combined, originalExactTargets } = input
  const reasons = [...input.invalidReasons]
  if (retrySelected !== PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS) reasons.push(`retry_selected_${retrySelected}`)
  if (retryMeasured + retryUnmeasured !== retrySelected) reasons.push('retry_outcome_count_inconsistent')
  for (const p of PHASE2C26B2C2A_CAPTURE_POLICIES) if (combined.exactTargets[p] < originalExactTargets[p]) reasons.push(`combined_${p}_below_original`)
  if (combined.unmeasuredTasks !== retryUnmeasured) reasons.push('combined_unmeasured_is_not_the_unmeasured_retry_tasks')
  const base = phase2c26b2c2aDecision({ invalidReasons: reasons, ...combined })
  const caseId: Phase2C26B2C2AR1DecisionCase = base.case === 'B2C2A_PARTIAL' ? 'B2C2AR1_INVALID' : CASE_MAP[base.case]
  const allReasons = base.case === 'B2C2A_PARTIAL' ? [...base.reasons, 'combined_partial_contradicts_the_original_C4C_authority'] : base.reasons
  return { case: caseId, reasons: allReasons, combinedB2C2ACase: base.case, recommendation: PHASE2C26B2C2AR1_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2C2AR1AnalysisInput {
  authority: Phase2C26B2C2AR1Authority
  retryManifest: Phase2C26B2C2AR1RetryManifest
  /** The 320 tasks the R1 tasks child reconstructed (equal to the analyzer's own reconstruction, checked by the caller). */
  tasks: readonly Phase2C26B2C2ATaskInput[]
  /** The tasks the retry runner selected and searched. */
  selectedTasks: readonly Phase2C26B2C2ATaskInput[]
  runs: readonly Phase2C26B2C2ARun[]
  /** The unchanged B2-C2A post-hoc compatibility over the re-derived schedule (all 20 Targets). */
  reach: readonly Phase2C26B2C2AReach[]
  oracle: Oracle
  /** `phase2c26b2b2a2OracleOperationCost()` per Target (miss classification only). */
  oracleOperationCost: (targetWeaponId: string) => number | null
  smoke: boolean
}

const targetRowsOf = (contexts: readonly Phase2C26B2C2AContextComparison[], authority: Phase2C26B2C2AR1Authority, reach: readonly Phase2C26B2C2AReach[], cost: (id: string) => number | null) => {
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  const firstCompatible = new Map(authority.targets.map(t => [t.targetWeaponId, t.b2c1FirstCompatibleRank]))
  const rows: Phase2C26B2C2ATargetRow[] = []
  const inconsistencies: string[] = []
  for (const id of authority.targetWeaponIds) {
    const out = phase2c26b2c2aTargetRow(id, contexts.filter(c => c.targetWeaponId === id), firstCompatible.get(id) ?? null, reachOf.get(id), cost(id))
    rows.push(out.row)
    inconsistencies.push(...out.inconsistencies)
  }
  const exactTargets = Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2ACapturePolicy, number>
  return { rows, inconsistencies, exactTargets, budgetCoverage: phase2c26b2c2aBudgetCoverage(rows), cascade: phase2c26b2c2aCascade(rows),
    unresolvedSafetyCapTargets: rows.filter(r => r.recovery === 'none' && r.safetyCapContexts > 0).length }
}

/**
 * Raw consistency of the retry records, the retry selection against the authority, the post-hoc compatibility of every
 * context against the B2-C2A rows, the retry comparisons, the original-only recomputation (must reproduce the B2-C2A Target
 * aggregates), the completion overlay and the combined Target rows. Every invalid reason found here is returned.
 */
export function runPhase2C26B2C2AR1Analysis({ authority, retryManifest, tasks, selectedTasks, runs, reach, oracle, oracleOperationCost, smoke }: Phase2C26B2C2AR1AnalysisInput) {
  const invalidReasons: string[] = []
  // The retry selection is the authority's timeout rows, nothing else.
  const timeoutIds = phase2c26b2c2ar1TimeoutTaskIds(authority.taskRows)
  if (!same(retryManifest.taskIds, timeoutIds)) invalidReasons.push(`retry_manifest: taskIds ${retryManifest.taskIds.join(',')} are not the B2-C2A timeout rows ${timeoutIds.join(',')}`)
  if (retryManifest.taskIds.length !== PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS) invalidReasons.push(`retry_manifest: ${retryManifest.taskIds.length} tasks, not ${PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS}`)
  if (retryManifest.sourceB2C2AResultSha256 !== authority.resultSha256) invalidReasons.push('retry_manifest: sourceB2C2AResultSha256 is not the authority')
  if (retryManifest.sourceTargetManifestSha256 !== authority.targetManifestSha256) invalidReasons.push('retry_manifest: sourceTargetManifestSha256 is not the authority')
  if (retryManifest.exportSha256 !== authority.exportSha256) invalidReasons.push('retry_manifest: exportSha256 is not the authority')
  // 320-task and retry-task reconstruction.
  invalidReasons.push(...phase2c26b2c2ar1ReconstructionParity(tasks, authority.taskRows).map(i => `reconstruction: ${i}`))
  const taskById = new Map(tasks.map(t => [t.taskId, t]))
  if (!same(selectedTasks.map(t => t.taskId), retryManifest.taskIds)) invalidReasons.push('retry_selection: the selected tasks are not the retry manifest tasks in order')
  for (const task of selectedTasks) if (!same(task, taskById.get(task.taskId))) invalidReasons.push(`retry_selection: ${task.taskId} is not the reconstructed task`)
  // Retry runs: only manifest tasks, each once; the unchanged raw validation over the selected tasks.
  const retryIds = new Set(retryManifest.taskIds)
  for (const run of runs) if (!retryIds.has(run.taskId)) invalidReasons.push(`retry_run: ${run.taskId} is not a retry manifest task`)
  if (new Set(runs.map(r => r.taskId)).size !== runs.length) invalidReasons.push('retry_run: a task ran twice')
  invalidReasons.push(...validatePhase2C26B2C2ARaw({ tasks: selectedTasks, runs, smoke }).map(i => i.startsWith('semantic_failure') ? i : `raw: ${i}`))
  for (const run of runs) if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}: context mismatch in the retry Search child`)

  // Post-hoc compatibility: every context against the B2-C2A row (never used for selection), and B2-C1 first compatible rank.
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  for (const r of reach) invalidReasons.push(...r.inconsistencies.map(i => `reach: ${i}`))
  for (const target of authority.targets) {
    const recomputed = reachOf.get(target.targetWeaponId)?.p1FirstCompatibleRank ?? null
    if (recomputed !== target.b2c1FirstCompatibleRank) invalidReasons.push(`authority: ${target.targetWeaponId}: recomputed P1 first compatible rank ${String(recomputed)} is not B2-C1's ${String(target.b2c1FirstCompatibleRank)}`)
  }
  const compatibleOf = (row: Pick<Phase2C26B2C2AR1OriginalTaskRow, 'targetWeaponId' | 'groupIndex'>) => reachOf.get(row.targetWeaponId)?.compatibleGroupIndexes.includes(row.groupIndex) ?? false
  const compatibilityParity = authority.taskRows.map(row => ({ taskId: row.taskId, recorded: row.compatible, recomputed: compatibleOf(row) }))
  for (const p of compatibilityParity) if (p.recorded !== p.recomputed) invalidReasons.push(`compatibility_parity: ${p.taskId}: recomputed ${String(p.recomputed)}, B2-C2A recorded ${String(p.recorded)}`)

  // The retry comparisons (the unchanged B2-C2A per-context comparison) and the R1 semantic invariants.
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const retryContexts = selectedTasks.map(task => phase2c26b2c2aCompareContext(runOf.get(task.taskId), task, compatibleOf(task), oracle))
  for (const c of retryContexts) {
    invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
    if (c.measured && !c.compatible && c.partialIndexes.length > 0) invalidReasons.push(`semantic_failure: ${c.taskId}: a partial Candidate from a reservation-incompatible context`)
  }

  // The original rows alone must reproduce the B2-C2A Target aggregates (a raw / result consistency guard).
  const originalContexts = authority.taskRows.map(phase2c26b2c2ar1OriginalContext)
  const original = targetRowsOf(originalContexts, authority, reach, oracleOperationCost)
  const originalReproduction = {
    exactTargets: same(original.exactTargets, authority.exactTargets),
    budgetCoverage: same(original.budgetCoverage, authority.budgetCoverage),
    cascade: same(original.cascade, authority.cascade),
    targets: authority.targets.every(t => {
      const row = original.rows.find(r => r.targetWeaponId === t.targetWeaponId)
      return row !== undefined && row.recovery === t.recovery && row.missClass === t.missClass && row.safetyCapContexts === t.safetyCapContexts
        && PHASE2C26B2C2A_CAPTURE_POLICIES.every(p => same(row.policies[p].firstExactContextRank, t.policies[p].firstExactContextRank)
          && same(row.policies[p].firstExactCandidateIndex, t.policies[p].firstExactCandidateIndex) && same(row.policies[p].firstExactOperationCost, t.policies[p].firstExactOperationCost))
    }),
  }
  for (const [name, ok] of Object.entries(originalReproduction)) if (!ok) invalidReasons.push(`raw_result: the original rows do not reproduce the B2-C2A ${name}`)
  invalidReasons.push(...original.inconsistencies.map(i => `original: ${i}`))

  // The completion overlay: a retry task row is replaced only when the retry measured it.
  const retryOf = new Map(retryContexts.map(c => [c.taskId, c]))
  const combinedContexts = originalContexts.map(c => {
    const retry = retryIds.has(c.taskId) ? retryOf.get(c.taskId) : undefined
    if (retry === undefined || !retry.measured) return c
    if (c.measured) invalidReasons.push(`overlay: ${c.taskId}: the original row was already measured`)
    return retry
  })
  const combined = targetRowsOf(combinedContexts, authority, reach, oracleOperationCost)
  invalidReasons.push(...combined.inconsistencies)

  const retryMeasured = retryContexts.filter(c => c.measured).length
  const retryProcess = (outcome: string) => runs.filter(r => retryIds.has(r.taskId) && r.outcome.process === outcome).length
  const retry = { selected: selectedTasks.length, runs: runs.length, measured: retryMeasured, timeout: retryProcess('timeout'), outOfMemory: retryProcess('out_of_memory'),
    processFailure: retryProcess('process_failure'), contextMismatch: runs.filter(r => r.outcome.record === 'context_mismatch').length,
    notRun: selectedTasks.filter(t => !runOf.has(t.taskId)).length }
  const retryUnmeasured = retry.selected - retryMeasured
  const originalMeasured = originalContexts.filter(c => c.measured).length
  const combinedMeasured = combinedContexts.filter(c => c.measured).length
  const overlay = {
    original: { tasks: authority.taskRows.length, measured: originalMeasured, timeout: authority.taskRows.filter(r => r.process === 'timeout').length },
    retry,
    combined: { tasks: combinedContexts.length, measured: combinedMeasured, unmeasured: combinedContexts.length - combinedMeasured,
      resolvedByRetry: combinedMeasured - originalMeasured, unresolved: unresolvedTimeouts(authority, retryMeasured) },
  }
  if (overlay.combined.measured !== originalMeasured + retryMeasured) invalidReasons.push('overlay: combined measured is not original + measured retry')
  const decisionInput: Phase2C26B2C2AR1DecisionInput = { invalidReasons, retrySelected: retry.selected, retryMeasured, retryUnmeasured,
    combined: { tasks: combinedContexts.length, targets: authority.targetWeaponIds.length, unmeasuredTasks: overlay.combined.unmeasured, exactTargets: combined.exactTargets,
      unresolvedSafetyCapTargets: combined.unresolvedSafetyCapTargets },
    originalExactTargets: authority.exactTargets }
  return { invalidReasons, compatibilityParity, retryContexts, originalReproduction, overlay, original, combined, combinedContexts, decisionInput }
}

/** The original timeout count minus the retry tasks measured (never negative). */
const unresolvedTimeouts = (authority: Pick<Phase2C26B2C2AR1Authority, 'taskRows'>, retryMeasured: number) => Math.max(0, authority.taskRows.filter(r => r.process === 'timeout').length - retryMeasured)
