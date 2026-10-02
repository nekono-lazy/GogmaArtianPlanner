/**
 * Issue #154 Phase 2-C2.6-B2-C2A-R2 post-hoc analysis only. It reads the finished R2 retry run (the task still unmeasured
 * after the R1 completion overlay, searched again with a 60-minute budget) and, after the run ended, the committed B2-C2A
 * RESULT (the original 318 measured tasks), the committed R1 RESULT (the R1 retry rows) and the oracle used by B2-C2A. It
 * runs no Search, no kernel and no Planner and feeds nothing back.
 *
 * The overlay is a completion overlay over the R1 one, not a new population:
 *
 * ```text
 * original  = B2-C2A RESULT task rows (318 measured, 2 timeout)                        never re-run, never rewritten
 * r1        = original rows, each R1-measured retry task replaced by its R1 row       must reproduce the R1 combined aggregates
 * retry     = the R2 child records of the R2 retry manifest tasks only                compared by the unchanged B2-C2A comparison
 * combined  = r1 rows, with each R2 retry task's row replaced by its R2 comparison (when measured)
 * ```
 *
 * The R2 contexts are judged by exactly the B2-C2A authorities: compatibility by `phase2c26b2c1TargetReach()` (via
 * `phase2c26b2c2aReach()`), Candidate coverage by `phase2c26b2b2aCompare()` -> `phase2c2OracleCoverage()` (via
 * `phase2c26b2c2aCompareContext()`), the raw capture by `validatePhase2C26B2C2ARaw()`, per-Target first exact by
 * `phase2c26b2c2aTargetRow()`, and the decision semantics by `phase2c26b2c2aDecision()`. Nothing re-implements oracle
 * matching. The recorded rows are read through the unchanged R1 `phase2c26b2c2ar1OriginalContext()`.
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
import type { Phase2C26B2C2AR1Authority } from './plannerGlobalPhase2C26B2C2AR1Authority'
import { phase2c26b2c2ar1OriginalContext, phase2c26b2c2ar1ReconstructionParity } from './plannerGlobalPhase2C26B2C2AR1Analysis'
import { PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS, type Phase2C26B2C2AR2RetryManifest } from './plannerGlobalPhase2C26B2C2AR2'
import {
  phase2c26b2c2ar2ChainIssues,
  phase2c26b2c2ar2R1RetryMeasured,
  phase2c26b2c2ar2TimeoutTaskIds,
  type Phase2C26B2C2AR2R1Authority,
  type Phase2C26B2C2AR2R1RetryRow,
} from './plannerGlobalPhase2C26B2C2AR2Authority'

const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

// ---------------------------------------------------------------- the R1 retry contexts, as recorded

/**
 * A recorded R1 retry row as the per-context comparison `phase2c26b2c2aTargetRow()` reads. Like the B2-C2A rows, the R1
 * RESULT keeps the first exact / partial index and the counts, not every index; the Target-row authority reads only the
 * per-policy `hit`, the first exact index / cost and whether a partial exists. Nothing here re-judges the oracle.
 */
export function phase2c26b2c2ar2R1Context(row: Phase2C26B2C2AR2R1RetryRow): Phase2C26B2C2AContextComparison {
  const measured = phase2c26b2c2ar2R1RetryMeasured(row)
  return { taskId: row.taskId, targetWeaponId: row.targetWeaponId, contextRank: row.contextRank, groupIndex: row.groupIndex, measured, compatible: row.compatible,
    captureComplete: measured ? row.captureComplete : null, safetyCapHit: measured ? row.safetyCapHit : null, candidateCount: measured ? row.candidateCount : null,
    capturedCosts: [...row.capturedCosts], coverage: row.coverage, exactIndexes: row.firstExactIndex === null ? [] : [row.firstExactIndex],
    partialIndexes: row.firstPartialIndex === null ? [] : [row.firstPartialIndex], firstExactIndex: row.firstExactIndex, firstExactCost: row.firstExactCost,
    firstPartialIndex: row.firstPartialIndex, hit: { ...row.hit }, sentinelExact: row.sentinelExact, reservationViolations: row.reservationViolations, inconsistencies: [] }
}

// ---------------------------------------------------------------- decision (registered before the formal retry)

export type Phase2C26B2C2AR2DecisionCase = 'B2C2AR2_ALL_C4C' | 'B2C2AR2_ALL_C32' | 'B2C2AR2_ALL_C8' | 'B2C2AR2_INCOMPLETE' | 'B2C2AR2_INVALID'

export const PHASE2C26B2C2AR2_DECISION_RULE = {
  order: [
    'B2C2AR2_INVALID: an R1 RESULT authority mismatch (SHA-256, formal, measured / analysis HEAD, benchmark code, calculation change, case other than B2C2AR1_INCOMPLETE, overlay other than 318 + 1 = 319 / 320 with 1 unresolved, combined exact Targets other than C8 18 / C32 18 / C4C 20, hash chain, invalid reasons, R1 conditions), a B2-C2A RESULT authority mismatch (the unchanged R1 parser), an R1 / B2-C2A chain mismatch, a retry manifest other than the tasks unmeasured after the R1 overlay (count, IDs, source hashes), a Target manifest / Export / oracle / hash-chain mismatch, a 320-task or retry-task reconstruction mismatch, a schedule parity failure, an extent / capture / heap / concurrency / budget condition drift, a retry run outside the manifest or run twice, a context mismatch, a raw / record inconsistency (validatePhase2C26B2C2ARaw), a Candidate reservation violation (sentinel included), an exact or partial Candidate (or exact sentinel) from a reservation-incompatible context, a recomputed compatibility other than the B2-C2A row (or the R1 retry row), a recomputed P1 first compatible rank other than B2-C1\'s, a first exact rank before the first compatible rank, the original rows not reproducing the B2-C2A Target aggregates, the R1 overlay not reproducing the R1 combined aggregates, a combined exact count below the R1 combined one, or a provenance failure',
    'B2C2AR2_INCOMPLETE: no invalid reason, and the retry task was not measured (timeout / out of memory / process failure: never Candidate 0, never retried again in this Phase), or the combined B2-C2A decision semantics are otherwise INCOMPLETE',
    'B2C2AR2_ALL_C8 / B2C2AR2_ALL_C32 / B2C2AR2_ALL_C4C: retry 1 / 1 measured, combined 320 / 320 measured, no invalid reason, and the B2-C2A decision semantics over the combined rows give ALL_C8 / ALL_C32 / ALL_C4C (ALL_C4C: C4C 20 / 20 with C32 < 20)',
    'a combined B2C2A_PARTIAL cannot arise from a valid overlay (the R1 combined authority already holds C4C 20 / 20 and an overlay never removes an exact) and is recorded as B2C2AR2_INVALID',
  ],
  overlay: 'B2-C2A rows for every task; an R1 retry task row replaced by its R1 row when R1 measured it (must reproduce the R1 combined aggregates); an R2 retry task row replaced by its R2 comparison only when the R2 child completed with a Search record; no task counted twice; no task outside the R2 retry manifest overlaid by R2',
  semantics: 'phase2c26b2c2aDecision() over the combined 320 contexts: 20 Targets, unmeasured = combined contexts without a Search record, exact Targets per capture policy, unresolved safety cap only for Targets without a C4C exact',
} as const

export const PHASE2C26B2C2AR2_RECOMMENDATION: Record<Phase2C26B2C2AR2DecisionCase, string> = {
  B2C2AR2_ALL_C4C: 'default extent 20件のB2-C2A evidenceは320 / 320 measuredで完了。次はextent不足20件についてscheduler-selected contextを使ったextent requirement / Search probeへ。K2-minimal 9件（P1 rank 50〜306）は同じtop16 brute-forceへ進む前にTarget-relative K2 feature / grouping改善を検討。residual unreached 3件は引き続きalternative-to-alternative support（別系統）。P1 / budget 16 / C4C / 60分budgetのProduction採用ではない',
  B2C2AR2_ALL_C32: 'default extent 20件は320 / 320 measuredで完了（C32で閉じる）。次はextent不足20件のscheduler-selected context extent requirement / Search probeへ（K2-minimal 9件は別途）。Production採用ではない',
  B2C2AR2_ALL_C8: 'default extent 20件は320 / 320 measuredで完了（C8で閉じる）。次はextent不足20件のscheduler-selected context extent requirement / Search probeへ（K2-minimal 9件は別途）。Production採用ではない',
  B2C2AR2_INCOMPLETE: '60分budgetでも未完走。このPhaseでは120分retry・extent変更・capture縮小・Search最適化を追加しない。次は未完走taskのruntime特性（Search進行の観測、所要時間の見積もり）を別Phaseで扱うか、より長いbudgetでの再測定を別途判断する',
  B2C2AR2_INVALID: '次へ進まず原因修正',
}

const CASE_MAP: Record<Phase2C26B2C2ADecisionCase, Phase2C26B2C2AR2DecisionCase> = {
  B2C2A_ALL_C8: 'B2C2AR2_ALL_C8', B2C2A_ALL_C32: 'B2C2AR2_ALL_C32', B2C2A_ALL_C4C: 'B2C2AR2_ALL_C4C', B2C2A_PARTIAL: 'B2C2AR2_INVALID', B2C2A_INCOMPLETE: 'B2C2AR2_INCOMPLETE', B2C2A_INVALID: 'B2C2AR2_INVALID',
}

export interface Phase2C26B2C2AR2DecisionInput {
  invalidReasons: readonly string[]
  retrySelected: number
  retryMeasured: number
  /** Retry tasks that ended in a timeout / out of memory / process failure. */
  retryUnmeasured: number
  combined: { tasks: number; targets: number; unmeasuredTasks: number; exactTargets: Record<Phase2C26B2C2ACapturePolicy, number>; unresolvedSafetyCapTargets: number }
  /** The R1 combined exact Targets (the overlay R2 completes). */
  r1ExactTargets: Record<Phase2C26B2C2ACapturePolicy, number>
}

/** The registered R2 rule: the B2-C2A decision semantics re-applied to the combined rows, plus the R2 completion checks. */
export function phase2c26b2c2ar2Decision(input: Phase2C26B2C2AR2DecisionInput) {
  const { retrySelected, retryMeasured, retryUnmeasured, combined, r1ExactTargets } = input
  const reasons = [...input.invalidReasons]
  if (retrySelected !== PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS) reasons.push(`retry_selected_${retrySelected}`)
  if (retryMeasured + retryUnmeasured !== retrySelected) reasons.push('retry_outcome_count_inconsistent')
  for (const p of PHASE2C26B2C2A_CAPTURE_POLICIES) if (combined.exactTargets[p] < r1ExactTargets[p]) reasons.push(`combined_${p}_below_r1`)
  if (combined.unmeasuredTasks !== retryUnmeasured) reasons.push('combined_unmeasured_is_not_the_unmeasured_retry_tasks')
  const base = phase2c26b2c2aDecision({ invalidReasons: reasons, ...combined })
  const caseId: Phase2C26B2C2AR2DecisionCase = base.case === 'B2C2A_PARTIAL' ? 'B2C2AR2_INVALID' : CASE_MAP[base.case]
  const allReasons = base.case === 'B2C2A_PARTIAL' ? [...base.reasons, 'combined_partial_contradicts_the_r1_C4C_authority'] : base.reasons
  return { case: caseId, reasons: allReasons, combinedB2C2ACase: base.case, recommendation: PHASE2C26B2C2AR2_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2C2AR2AnalysisInput {
  b2c2a: Phase2C26B2C2AR1Authority
  r1: Phase2C26B2C2AR2R1Authority
  retryManifest: Phase2C26B2C2AR2RetryManifest
  /** The 320 tasks the R2 tasks child reconstructed (equal to the analyzer's own reconstruction, checked by the caller). */
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

const targetRowsOf = (contexts: readonly Phase2C26B2C2AContextComparison[], b2c2a: Phase2C26B2C2AR1Authority, reach: readonly Phase2C26B2C2AReach[], cost: (id: string) => number | null) => {
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  const firstCompatible = new Map(b2c2a.targets.map(t => [t.targetWeaponId, t.b2c1FirstCompatibleRank]))
  const rows: Phase2C26B2C2ATargetRow[] = []
  const inconsistencies: string[] = []
  for (const id of b2c2a.targetWeaponIds) {
    const out = phase2c26b2c2aTargetRow(id, contexts.filter(c => c.targetWeaponId === id), firstCompatible.get(id) ?? null, reachOf.get(id), cost(id))
    rows.push(out.row)
    inconsistencies.push(...out.inconsistencies)
  }
  const exactTargets = Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2ACapturePolicy, number>
  return { rows, inconsistencies, exactTargets, budgetCoverage: phase2c26b2c2aBudgetCoverage(rows), cascade: phase2c26b2c2aCascade(rows),
    unresolvedSafetyCapTargets: rows.filter(r => r.recovery === 'none' && r.safetyCapContexts > 0).length, fullyMeasuredTargets: rows.filter(r => r.fullyMeasured).length }
}

const samePolicies = (row: Phase2C26B2C2ATargetRow, recorded: { policies: Record<Phase2C26B2C2ACapturePolicy, { firstExactContextRank: number | null; firstExactCandidateIndex: number | null; firstExactOperationCost: number | null }> }) =>
  PHASE2C26B2C2A_CAPTURE_POLICIES.every(p => same(row.policies[p].firstExactContextRank, recorded.policies[p].firstExactContextRank)
    && same(row.policies[p].firstExactCandidateIndex, recorded.policies[p].firstExactCandidateIndex) && same(row.policies[p].firstExactOperationCost, recorded.policies[p].firstExactOperationCost))

/**
 * Raw consistency of the R2 retry records, the retry selection against the authorities, the post-hoc compatibility of every
 * context against the B2-C2A rows (and the R1 retry rows), the R2 retry comparisons, the original-only recomputation (must
 * reproduce the B2-C2A Target aggregates), the R1-overlay recomputation (must reproduce the R1 combined aggregates), the R2
 * completion overlay and the combined Target rows. Every invalid reason found here is returned.
 */
export function runPhase2C26B2C2AR2Analysis({ b2c2a, r1, retryManifest, tasks, selectedTasks, runs, reach, oracle, oracleOperationCost, smoke }: Phase2C26B2C2AR2AnalysisInput) {
  const invalidReasons: string[] = []
  // The authorities describe one chain (the R1 retry rows are the B2-C2A unmeasured rows), and the retry selection is the R1
  // timeout rows, nothing else.
  invalidReasons.push(...phase2c26b2c2ar2ChainIssues(b2c2a, r1))
  const timeoutIds = phase2c26b2c2ar2TimeoutTaskIds(r1.retryRows)
  if (!same(retryManifest.taskIds, timeoutIds)) invalidReasons.push(`retry_manifest: taskIds ${retryManifest.taskIds.join(',')} are not the R1 timeout rows ${timeoutIds.join(',')}`)
  if (retryManifest.taskIds.length !== PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS) invalidReasons.push(`retry_manifest: ${retryManifest.taskIds.length} tasks, not ${PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS}`)
  if (retryManifest.sourceR1ResultSha256 !== r1.resultSha256) invalidReasons.push('retry_manifest: sourceR1ResultSha256 is not the R1 authority')
  if (retryManifest.sourceR1RetryManifestSha256 !== r1.retryManifestSha256) invalidReasons.push('retry_manifest: sourceR1RetryManifestSha256 is not the R1 authority')
  if (retryManifest.sourceB2C2AResultSha256 !== b2c2a.resultSha256) invalidReasons.push('retry_manifest: sourceB2C2AResultSha256 is not the B2-C2A authority')
  if (retryManifest.sourceTargetManifestSha256 !== b2c2a.targetManifestSha256) invalidReasons.push('retry_manifest: sourceTargetManifestSha256 is not the B2-C2A authority')
  if (retryManifest.exportSha256 !== b2c2a.exportSha256 || retryManifest.exportSha256 !== r1.exportSha256) invalidReasons.push('retry_manifest: exportSha256 is not the authority')
  // 320-task and retry-task reconstruction.
  invalidReasons.push(...phase2c26b2c2ar1ReconstructionParity(tasks, b2c2a.taskRows).map(i => `reconstruction: ${i}`))
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
  for (const target of b2c2a.targets) {
    const recomputed = reachOf.get(target.targetWeaponId)?.p1FirstCompatibleRank ?? null
    if (recomputed !== target.b2c1FirstCompatibleRank) invalidReasons.push(`authority: ${target.targetWeaponId}: recomputed P1 first compatible rank ${String(recomputed)} is not B2-C1's ${String(target.b2c1FirstCompatibleRank)}`)
  }
  const compatibleOf = (row: { targetWeaponId: string; groupIndex: number }) => reachOf.get(row.targetWeaponId)?.compatibleGroupIndexes.includes(row.groupIndex) ?? false
  const compatibilityParity = b2c2a.taskRows.map(row => ({ taskId: row.taskId, recorded: row.compatible, recomputed: compatibleOf(row) }))
  for (const p of compatibilityParity) if (p.recorded !== p.recomputed) invalidReasons.push(`compatibility_parity: ${p.taskId}: recomputed ${String(p.recomputed)}, B2-C2A recorded ${String(p.recorded)}`)
  for (const row of r1.retryRows) if (row.compatible !== compatibleOf(row)) invalidReasons.push(`compatibility_parity: ${row.taskId}: recomputed ${String(compatibleOf(row))}, R1 recorded ${String(row.compatible)}`)

  // The R2 retry comparisons (the unchanged B2-C2A per-context comparison) and the R2 semantic invariants.
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const retryContexts = selectedTasks.map(task => phase2c26b2c2aCompareContext(runOf.get(task.taskId), task, compatibleOf(task), oracle))
  for (const c of retryContexts) {
    invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
    if (c.measured && !c.compatible && c.partialIndexes.length > 0) invalidReasons.push(`semantic_failure: ${c.taskId}: a partial Candidate from a reservation-incompatible context`)
  }

  // The original rows alone must reproduce the B2-C2A Target aggregates (a raw / result consistency guard).
  const originalContexts = b2c2a.taskRows.map(phase2c26b2c2ar1OriginalContext)
  const original = targetRowsOf(originalContexts, b2c2a, reach, oracleOperationCost)
  const originalReproduction = {
    exactTargets: same(original.exactTargets, b2c2a.exactTargets),
    budgetCoverage: same(original.budgetCoverage, b2c2a.budgetCoverage),
    cascade: same(original.cascade, b2c2a.cascade),
    targets: b2c2a.targets.every(t => {
      const row = original.rows.find(r => r.targetWeaponId === t.targetWeaponId)
      return row !== undefined && row.recovery === t.recovery && row.missClass === t.missClass && row.safetyCapContexts === t.safetyCapContexts && samePolicies(row, t)
    }),
  }
  for (const [name, ok] of Object.entries(originalReproduction)) if (!ok) invalidReasons.push(`raw_result: the original rows do not reproduce the B2-C2A ${name}`)
  invalidReasons.push(...original.inconsistencies.map(i => `original: ${i}`))

  // The R1 overlay (original rows, each R1-measured retry row replaced by its R1 row) must reproduce the R1 combined aggregates.
  const r1RowOf = new Map(r1.retryRows.map(row => [row.taskId, row]))
  const r1Contexts = originalContexts.map(c => {
    const row = r1RowOf.get(c.taskId)
    if (row === undefined || !phase2c26b2c2ar2R1RetryMeasured(row)) return c
    if (c.measured) invalidReasons.push(`r1_overlay: ${c.taskId}: the original row was already measured`)
    return phase2c26b2c2ar2R1Context(row)
  })
  const r1Base = targetRowsOf(r1Contexts, b2c2a, reach, oracleOperationCost)
  const r1Measured = r1Contexts.filter(c => c.measured).length
  const r1Reproduction = {
    measured: r1Measured === r1.overlay.combined.measured,
    exactTargets: same(r1Base.exactTargets, r1.combined.exactTargets),
    budgetCoverage: same(r1Base.budgetCoverage, r1.combined.budgetCoverage),
    cascade: same(r1Base.cascade, r1.combined.cascade),
    unresolvedSafetyCapTargets: r1Base.unresolvedSafetyCapTargets === r1.combined.unresolvedSafetyCapTargets,
    fullyMeasuredTargets: r1Base.fullyMeasuredTargets === r1.combined.fullyMeasuredTargets,
    targets: r1.combinedTargets.length === r1Base.rows.length && r1.combinedTargets.every(t => {
      const row = r1Base.rows.find(r => r.targetWeaponId === t.targetWeaponId)
      return row !== undefined && row.recovery === t.recovery && row.missClass === t.missClass && row.safetyCapContexts === t.safetyCapContexts
        && row.measuredContexts === t.measuredContexts && row.fullyMeasured === t.fullyMeasured && samePolicies(row, t)
    }),
  }
  for (const [name, ok] of Object.entries(r1Reproduction)) if (!ok) invalidReasons.push(`raw_result: the R1 overlay does not reproduce the R1 combined ${name}`)
  invalidReasons.push(...r1Base.inconsistencies.map(i => `r1_overlay: ${i}`))

  // The R2 completion overlay: a retry task row is replaced only when the R2 retry measured it.
  const retryOf = new Map(retryContexts.map(c => [c.taskId, c]))
  const combinedContexts = r1Contexts.map(c => {
    const retry = retryIds.has(c.taskId) ? retryOf.get(c.taskId) : undefined
    if (retry === undefined || !retry.measured) return c
    if (c.measured) invalidReasons.push(`overlay: ${c.taskId}: the R1 overlay row was already measured`)
    return retry
  })
  const combined = targetRowsOf(combinedContexts, b2c2a, reach, oracleOperationCost)
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
    original: { tasks: b2c2a.taskRows.length, measured: originalMeasured, timeout: b2c2a.taskRows.filter(r => r.process === 'timeout').length },
    r1: { tasks: r1Contexts.length, measured: r1Measured, unmeasured: r1Contexts.length - r1Measured },
    retry,
    combined: { tasks: combinedContexts.length, measured: combinedMeasured, unmeasured: combinedContexts.length - combinedMeasured,
      resolvedByR1: r1Measured - originalMeasured, resolvedByR2: combinedMeasured - r1Measured, unresolved: combinedContexts.length - combinedMeasured },
  }
  if (overlay.combined.measured !== r1Measured + retryMeasured) invalidReasons.push('overlay: combined measured is not the R1 overlay + measured R2 retry')
  const decisionInput: Phase2C26B2C2AR2DecisionInput = { invalidReasons, retrySelected: retry.selected, retryMeasured, retryUnmeasured,
    combined: { tasks: combinedContexts.length, targets: b2c2a.targetWeaponIds.length, unmeasuredTasks: overlay.combined.unmeasured, exactTargets: combined.exactTargets,
      unresolvedSafetyCapTargets: combined.unresolvedSafetyCapTargets },
    r1ExactTargets: r1.combined.exactTargets }
  return { invalidReasons, compatibilityParity, retryContexts, originalReproduction, r1Reproduction, overlay, original, r1Base, combined, combinedContexts, decisionInput }
}
