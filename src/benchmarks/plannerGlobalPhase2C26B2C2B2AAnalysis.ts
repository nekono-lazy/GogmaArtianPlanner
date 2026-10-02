/**
 * Issue #154 Phase 2-C2.6-B2-C2B2A post-hoc analysis only. It reads the finished B2-C2B2A raw run (with every child
 * record) and, as explicit analyzer arguments AFTER the run ended, the B2-C2B1 RESULT (E1 population and L2 authority), the
 * B2-C1 RESULT (P1 first-compatible authority), the B2-B1 RESULT (schedule parity / hash chain), the B2-C2A RESULT
 * (diagnostic runtime comparison only), the 1,657 oracle RESULT and its manifest. It runs no Search, no kernel and no
 * Planner and feeds nothing back into any calculation.
 *
 * The comparison reuses, unchanged, the B2-C2A per-context comparison (`phase2c26b2c2aCompareContext()` ->
 * `phase2c26b2b2aCompare()` -> `phase2c2OracleCoverage()`) and the B2-C2A post-hoc reservation compatibility
 * (`phase2c26b2c2aReach()` -> `phase2c26b2c1TargetReach()`). B2-C2B2A adds the L2 extent checks, the 32-rank budget and two
 * further fail-closed rules: a partial Candidate (or partial sentinel) from a reservation-incompatible context.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { phase2c26b2b2aCompare, type Phase2C26B2B2AFinal } from './plannerGlobalPhase2C26B2B2AAnalysis'
import { phase2c26b2b2a2FirstDecidingKey, phase2c26b2b2a2OracleOperationCost } from './plannerGlobalPhase2C26B2B2A2Analysis'
import { phase2c26b2c1Percentile } from './plannerGlobalPhase2C26B2C1Analysis'
import {
  phase2c26b2c2aCompareContext,
  phase2c26b2c2aPolicyLength,
  PHASE2C26B2C2A_CAPTURE_POLICIES,
  type Phase2C26B2C2ACapturePolicy,
  type Phase2C26B2C2AContextComparison,
  type Phase2C26B2C2AReach,
  type Phase2C26B2C2ARun,
} from './plannerGlobalPhase2C26B2C2AAnalysis'
import {
  PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2A_CONTEXT_BUDGET,
  PHASE2C26B2C2B2A_EXPECTED_TASKS,
  PHASE2C26B2C2B2A_EXTENT,
  PHASE2C26B2C2B2A_MAX_COST_COHORTS,
  PHASE2C26B2C2B2A_TARGETS,
  type Phase2C26B2C2B2AChildRecord,
  type Phase2C26B2C2B2ASearchRecord,
  type Phase2C26B2C2B2ATaskInput,
  type Phase2C26B2C2B2ATaskOutcome,
} from './plannerGlobalPhase2C26B2C2B2A'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compare(a, b)))
}
const countByNumber = (values: readonly number[]): { value: number; count: number }[] => {
  const map = new Map<number, number>()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return [...map.entries()].sort(([a], [b]) => a - b).map(([value, count]) => ({ value, count }))
}

// ---------------------------------------------------------------- registered before the formal run

export type Phase2C26B2C2B2ACapturePolicy = Phase2C26B2C2ACapturePolicy
export const PHASE2C26B2C2B2A_CAPTURE_POLICIES = PHASE2C26B2C2A_CAPTURE_POLICIES
/** The context budgets the RESULT reports (diagnostic, never Production defaults). */
export const PHASE2C26B2C2B2A_BUDGETS = [1, 2, 4, 8, 16, 32] as const
export const phase2c26b2c2b2aPolicyLength = phase2c26b2c2aPolicyLength

// ---------------------------------------------------------------- one run as the raw record holds it

export interface Phase2C26B2C2B2ARun {
  taskId: string
  task: Phase2C26B2C2B2ATaskInput
  outcome: Phase2C26B2C2B2ATaskOutcome
  process: { outcome: string; wallMs: number; timedOut: boolean; budgetMs: number }
  childWallMs: number | null
  scheduleMs: number | null
  yields: number | null
  memory: { sampledMaxHeapUsedBytes: number; sampledMaxRssBytes: number; maxRssKiB: number } | null
  lastIpcMemory: { maxHeapUsedBytes: number; maxRssBytes: number } | null
  /** The child record's `result` (loaded from the run dir and checked against its SHA-256 by the analyzer). */
  record: Phase2C26B2C2B2AChildRecord | null
}

const deliveries = (s: Phase2C26B2C2B2ASearchRecord): Phase2C26B2B2A2DeliveredCandidate[] => [...s.candidates, ...(s.nextCostSentinel ? [s.nextCostSentinel] : [])]
const searchOf = (run: Phase2C26B2C2B2ARun | undefined): Phase2C26B2C2B2ASearchRecord | null =>
  run && run.outcome.process === 'completed' && run.outcome.record === 'searched' && run.record?.status === 'searched' ? run.record.search : null

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * Internal drift of the raw run (the B2-C2A rules with the L2 extent): every task carries the common L2 extent; every
 * searched record names its task's Target, rank, group, digests (default and L2), representative and capture rule at L2,
 * excludes exactly one Route key and never delivers it; deliveries are indexed 0..n-1 with unique keys; the comparator
 * verdict is "earlier first" and agrees with the six keys; the captured costs are the first <= 4 distinct costs and the
 * sentinel a fifth; the termination agrees with the flags. A cheaper Candidate after a dearer one is a semantic failure.
 */
export function validatePhase2C26B2C2B2ARaw(input: { tasks: readonly Phase2C26B2C2B2ATaskInput[]; runs: readonly Phase2C26B2C2B2ARun[]; smoke: boolean }): string[] {
  const issues: string[] = []
  const { tasks, runs } = input
  if (!input.smoke && runs.length !== tasks.length) issues.push(`Stage 1 ran ${runs.length} of ${tasks.length} tasks`)
  if (new Set(runs.map(r => r.taskId)).size !== runs.length) issues.push('a task ran twice')
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a planned task repeats')
  for (const task of tasks) if (!same(task.extent, { ...PHASE2C26B2C2B2A_EXTENT })) issues.push(`${task.taskId}: the task extent is not the common L2 extent`)
  const taskById = new Map(tasks.map(t => [t.taskId, t]))
  for (const run of runs) {
    const task = taskById.get(run.taskId)
    if (!task) { issues.push(`${run.taskId}: not a planned task`); continue }
    if (!same(run.task, task)) issues.push(`${run.taskId}: the child received another task`)
    if (run.outcome.process === 'completed' && run.record === null) issues.push(`${run.taskId}: a completed child without a record`)
    if (run.record !== null && run.record.taskId !== run.taskId) issues.push(`${run.taskId}: the record names another task`)
    const s = run.record?.status === 'searched' ? run.record.search : null
    if (s === null) continue
    const at = run.taskId
    if (s.targetWeaponId !== task.targetWeaponId || s.contextRank !== task.contextRank || s.groupIndex !== task.groupIndex || s.reservationDigest !== task.reservationDigest
      || s.targetEligibleMinCardinality !== task.targetEligibleMinCardinality || s.representativeFixedSetId !== task.representativeFixedSetId
      || !same(s.representativeFixedTargetWeaponIds, task.representativeFixedTargetWeaponIds) || s.searchInputDigest !== task.searchInputDigest
      || s.defaultSearchInputDigest !== task.defaultSearchInputDigest) issues.push(`${at}: the record is not the task's context`)
    if (s.maxCostCohorts !== PHASE2C26B2C2B2A_MAX_COST_COHORTS || s.candidateSafetyCap !== PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP) issues.push(`${at}: capture rule drift`)
    if (!same(s.extent, { ...PHASE2C26B2C2B2A_EXTENT })) issues.push(`${at}: the extent is not the common L2 extent`)
    if (s.searchInputDigest === s.defaultSearchInputDigest) issues.push(`${at}: the L2 digest equals the default digest`)
    if (s.excludedRouteKeys.length !== 1) issues.push(`${at}: not exactly one excluded Route key`)
    const all = deliveries(s)
    if (all.some(c => s.excludedRouteKeys.includes(c.stableKey))) issues.push(`${at}: an excluded Route was delivered`)
    if (all.length !== s.summary.deliveredCandidates) issues.push(`${at}: delivered count drift`)
    if (all.some((c, i) => c.deliveryIndex !== i)) issues.push(`${at}: delivery index drift`)
    if (new Set(all.map(c => c.stableKey)).size !== all.length) issues.push(`${at}: a Candidate was delivered twice`)
    if (all.some(c => c.summary.estimatedOperationCount !== c.orderingKeys.estimatedOperationCount) || s.costReadIssues.length > 0) issues.push(`${at}: the summary cost is not the Candidate cost`)
    if (s.nonmonotonicIndexes.length > 0 || all.some((c, i) => i > 0 && c.orderingKeys.estimatedOperationCount < all[i - 1]!.orderingKeys.estimatedOperationCount)) {
      issues.push(`semantic_failure: ${at}: Candidate cost nonmonotonic (a cheaper Candidate after a dearer one)`)
    }
    if (all.some((c, i) => (i === 0) !== (c.comparatorWithPrevious === null))) issues.push(`${at}: comparator record drift`)
    if (all.some((c, i) => i > 0 && c.comparatorWithPrevious !== -1)) issues.push(`${at}: the Search comparator does not put a delivery after its predecessor`)
    if (all.some((c, i) => i > 0 && phase2c26b2b2a2FirstDecidingKey(all[i - 1]!, c).sign !== c.comparatorWithPrevious)) issues.push(`${at}: the six recorded keys disagree with the Search comparator`)
    const distinct = [...new Set(s.candidates.map(c => c.orderingKeys.estimatedOperationCount))]
    if (!same(distinct, s.capturedCosts) || s.distinctCostCohorts !== s.capturedCosts.length || s.capturedCosts.length > PHASE2C26B2C2B2A_MAX_COST_COHORTS) issues.push(`${at}: captured cost cohorts drift`)
    const sentinelCost = s.nextCostSentinel?.orderingKeys.estimatedOperationCount
    if (s.nextCostSentinel && (s.capturedCosts.length !== PHASE2C26B2C2B2A_MAX_COST_COHORTS || s.capturedCosts.includes(sentinelCost!))) issues.push(`${at}: the sentinel is not the first Candidate of a fifth cost`)
    const f = s.summary
    const below = s.candidates.length < PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP
    const ok = s.termination === 'four_cost_cohorts_drained' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel !== null && !s.safetyCapHit && s.captureComplete && below
      : s.termination === 'candidate_safety_cap' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel === null && s.safetyCapHit && !s.captureComplete
        && s.candidates.length === PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP
        : s.termination === 'stopped_by_extent' ? s.status === 'stopped_by_extent' && !f.stoppedByConsumer && f.stoppedByExtent && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
          : s.termination === 'exhausted' && s.status === 'exhausted' && !f.stoppedByConsumer && !f.stoppedByExtent && f.exhausted && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
    if (!ok) issues.push(`${at}: the termination disagrees with the flags / counts`)
    if (run.outcome.searchStatus !== s.status || run.outcome.termination !== s.termination || run.outcome.candidateCount !== s.candidates.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- oracle comparison per context (unchanged B2-C2A comparison + partial rules)

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

export interface Phase2C26B2C2B2AContextComparison extends Phase2C26B2C2AContextComparison {
  /** Diagnostic: the sentinel alone covers the oracle Route partially (never counted). */
  sentinelPartial: boolean
}

const asFinal = (targetWeaponId: string, taskId: string, status: string, candidates: readonly Phase2C26B2B2A2DeliveredCandidate[]) =>
  ({ taskId, targetWeaponId, formalRun: 'stage1', stage1: null, fallback: null, final: null, measured: true, search: { status, candidates } }) as unknown as Phase2C26B2B2AFinal

/**
 * One context against the oracle Route through the unchanged B2-C2A comparison (exact / partial indexes, policy hits,
 * exact-from-incompatible, exact sentinel from incompatible and reservation violations fail closed), plus: a partial
 * Candidate or a partial sentinel from a reservation-incompatible context fails closed too.
 */
export function phase2c26b2c2b2aCompareContext(run: Phase2C26B2C2B2ARun | undefined, task: Phase2C26B2C2B2ATaskInput, compatible: boolean, oracle: Oracle): Phase2C26B2C2B2AContextComparison {
  const base = phase2c26b2c2aCompareContext(run as unknown as Phase2C26B2C2ARun | undefined, task as never, compatible, oracle)
  const s = searchOf(run)
  const sentinelPartial = s === null || s.nextCostSentinel === null ? false
    : phase2c26b2b2aCompare(asFinal(task.targetWeaponId, task.taskId, s.status, [s.nextCostSentinel]), oracle).coverage === 'partial_comparable'
  const inconsistencies = [...base.inconsistencies]
  if (!compatible && base.partialIndexes.length > 0) inconsistencies.push(`semantic_failure: ${task.taskId}: a partial Candidate from a reservation-incompatible context`)
  if (!compatible && sentinelPartial) inconsistencies.push(`semantic_failure: ${task.taskId}: the sentinel is partial from a reservation-incompatible context`)
  return { ...base, sentinelPartial, inconsistencies }
}

// ---------------------------------------------------------------- per Target

export interface Phase2C26B2C2B2AFirstExact {
  firstExactContextRank: number | null
  firstExactCandidateIndex: number | null
  firstExactOperationCost: number | null
  /** `firstExactContextRank - b2c1FirstCompatibleRank` (never negative; positive is legal). */
  deltaFromFirstCompatible: number | null
}

export type Phase2C26B2C2B2AMissClass = 'unmeasured' | 'no_compatible_context_in_budget' | 'safety_cap_unresolved' | 'capture_insufficient' | 'compatible_non_delivery'

export interface Phase2C26B2C2B2ATargetRow {
  targetWeaponId: string
  b2c1FirstCompatibleRank: number | null
  recomputedFirstCompatibleRank: number | null
  compatibleRanksInBudget: number[]
  /** Compatible contexts holding a C4C exact Candidate / holding none. */
  compatibleWithExactRanks: number[]
  compatibleWithoutExactRanks: number[]
  measuredContexts: number
  fullyMeasured: boolean
  safetyCapContexts: number
  oracleOperationCost: number | null
  policies: Record<Phase2C26B2C2B2ACapturePolicy, Phase2C26B2C2B2AFirstExact>
  /** The smallest policy that reaches an exact Candidate within the budget. */
  recovery: Phase2C26B2C2B2ACapturePolicy | 'none'
  missClass: Phase2C26B2C2B2AMissClass | null
  partialWithoutExact: boolean
}

/** The B2-C2A per-Target rule over 32 ranks: a first exact rank before the first compatible rank fails closed; after it is legal. */
export function phase2c26b2c2b2aTargetRow(targetWeaponId: string, contexts: readonly Phase2C26B2C2B2AContextComparison[], b2c1FirstCompatibleRank: number | null,
  reach: Phase2C26B2C2AReach | undefined, oracleOperationCost: number | null): { row: Phase2C26B2C2B2ATargetRow; inconsistencies: string[] } {
  const inconsistencies: string[] = []
  const ordered = [...contexts].sort((a, b) => a.contextRank - b.contextRank)
  const policies = Object.fromEntries(PHASE2C26B2C2B2A_CAPTURE_POLICIES.map(policy => {
    const first = ordered.find(c => c.hit[policy])
    const rank = first?.contextRank ?? null
    if (rank !== null && b2c1FirstCompatibleRank !== null && rank < b2c1FirstCompatibleRank) {
      inconsistencies.push(`semantic_failure: ${targetWeaponId}: ${policy} first exact rank ${rank} is before the B2-C1 first compatible rank ${b2c1FirstCompatibleRank}`)
    }
    return [policy, { firstExactContextRank: rank, firstExactCandidateIndex: first?.firstExactIndex ?? null, firstExactOperationCost: first?.firstExactCost ?? null,
      deltaFromFirstCompatible: rank === null || b2c1FirstCompatibleRank === null ? null : rank - b2c1FirstCompatibleRank }]
  })) as Record<Phase2C26B2C2B2ACapturePolicy, Phase2C26B2C2B2AFirstExact>
  const recovery = PHASE2C26B2C2B2A_CAPTURE_POLICIES.find(p => policies[p].firstExactContextRank !== null) ?? 'none'
  const compatible = ordered.filter(c => c.compatible)
  let missClass: Phase2C26B2C2B2AMissClass | null = null
  if (recovery === 'none') {
    if (ordered.some(c => !c.measured)) missClass = 'unmeasured'
    else if (compatible.length === 0) missClass = 'no_compatible_context_in_budget'
    else if (compatible.some(c => c.safetyCapHit)) missClass = 'safety_cap_unresolved'
    else if (oracleOperationCost !== null && compatible.every(c => c.capturedCosts.length === PHASE2C26B2C2B2A_MAX_COST_COHORTS && oracleOperationCost > Math.max(...c.capturedCosts))) missClass = 'capture_insufficient'
    else missClass = 'compatible_non_delivery'
  }
  return { inconsistencies, row: {
    targetWeaponId, b2c1FirstCompatibleRank, recomputedFirstCompatibleRank: reach?.p1FirstCompatibleRank ?? null, compatibleRanksInBudget: compatible.map(c => c.contextRank),
    compatibleWithExactRanks: compatible.filter(c => c.hit.C4C).map(c => c.contextRank), compatibleWithoutExactRanks: compatible.filter(c => c.measured && !c.hit.C4C).map(c => c.contextRank),
    measuredContexts: ordered.filter(c => c.measured).length, fullyMeasured: ordered.length === PHASE2C26B2C2B2A_CONTEXT_BUDGET && ordered.every(c => c.measured),
    safetyCapContexts: ordered.filter(c => c.safetyCapHit === true).length, oracleOperationCost, policies, recovery, missClass,
    partialWithoutExact: recovery === 'none' && ordered.some(c => c.partialIndexes.length > 0),
  } }
}

// ---------------------------------------------------------------- aggregation

const stats = (values: readonly number[]) => ({ count: values.length, min: values.length === 0 ? null : Math.min(...values), median: phase2c26b2c1Percentile(values, 50),
  p90: phase2c26b2c1Percentile(values, 90), p95: phase2c26b2c1Percentile(values, 95), max: values.length === 0 ? null : Math.max(...values) })

export function phase2c26b2c2b2aBudgetCoverage(rows: readonly Phase2C26B2C2B2ATargetRow[]) {
  return Object.fromEntries(PHASE2C26B2C2B2A_CAPTURE_POLICIES.map(policy => [policy, Object.fromEntries(PHASE2C26B2C2B2A_BUDGETS.map(budget =>
    [`top${budget}`, rows.filter(row => row.policies[policy].firstExactContextRank !== null && row.policies[policy].firstExactContextRank! <= budget).length]))]))
}

export function phase2c26b2c2b2aCascade(rows: readonly Phase2C26B2C2B2ATargetRow[]) {
  return { c8: rows.filter(r => r.recovery === 'C8').length, c8MissC32: rows.filter(r => r.recovery === 'C32').length, c32MissC4C: rows.filter(r => r.recovery === 'C4C').length,
    c4cMiss: rows.filter(r => r.recovery === 'none').length }
}

export function phase2c26b2c2b2aCompatibility(contexts: readonly Phase2C26B2C2B2AContextComparison[]) {
  const measured = contexts.filter(c => c.measured)
  const compatible = measured.filter(c => c.compatible)
  const incompatible = measured.filter(c => !c.compatible)
  return {
    contexts: contexts.length,
    measured: measured.length,
    compatibleSearched: compatible.length,
    compatibleWithExact: Object.fromEntries(PHASE2C26B2C2B2A_CAPTURE_POLICIES.map(p => [p, compatible.filter(c => c.hit[p]).length])),
    compatibleWithoutExact: { all: compatible.filter(c => !c.hit.C4C).length, captureComplete: compatible.filter(c => !c.hit.C4C && c.captureComplete).length,
      safetyCap: compatible.filter(c => !c.hit.C4C && c.safetyCapHit).length, partialOnly: compatible.filter(c => !c.hit.C4C && c.partialIndexes.length > 0).length,
      sentinelExact: compatible.filter(c => !c.hit.C4C && c.sentinelExact).length },
    incompatibleSearched: incompatible.length,
    incompatibleWithExact: incompatible.filter(c => c.hit.C4C || c.sentinelExact).length,
    incompatibleWithPartial: incompatible.filter(c => c.partialIndexes.length > 0 || c.sentinelPartial).length,
    byRank: Array.from({ length: PHASE2C26B2C2B2A_CONTEXT_BUDGET }, (_, i) => i + 1).map(rank => {
      const at = measured.filter(c => c.contextRank === rank)
      return { rank, measured: at.length, compatible: at.filter(c => c.compatible).length, exactC8: at.filter(c => c.hit.C8).length, exactC32: at.filter(c => c.hit.C32).length, exactC4C: at.filter(c => c.hit.C4C).length }
    }),
  }
}

const peakOf = (r: Phase2C26B2C2B2ARun) => ({ heap: Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0),
  rss: Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0) })

export function phase2c26b2c2b2aExecution(tasks: readonly Phase2C26B2C2B2ATaskInput[], runs: readonly Phase2C26B2C2B2ARun[]) {
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const measured = runs.filter(r => searchOf(r) !== null)
  const targets = [...new Set(tasks.map(t => t.targetWeaponId))]
  const measuredPerTarget = targets.map(id => tasks.filter(t => t.targetWeaponId === id && searchOf(runOf.get(t.taskId)) !== null).length)
  const searchMs = (r: Phase2C26B2C2B2ARun) => searchOf(r)!.elapsedMs
  return {
    tasks: tasks.length,
    runs: runs.length,
    completed: measured.length,
    contextMismatch: runs.filter(r => r.outcome.record === 'context_mismatch').length,
    timeout: runs.filter(r => r.outcome.process === 'timeout').length,
    outOfMemory: runs.filter(r => r.outcome.process === 'out_of_memory').length,
    processFailure: runs.filter(r => r.outcome.process === 'process_failure').length,
    notRun: tasks.filter(t => !runOf.has(t.taskId)).length,
    safetyCapUnresolved: measured.filter(r => searchOf(r)!.safetyCapHit).length,
    targets: { total: targets.length, fullyMeasured: measuredPerTarget.filter(n => n === PHASE2C26B2C2B2A_CONTEXT_BUDGET).length,
      partiallyMeasured: measuredPerTarget.filter(n => n > 0 && n < PHASE2C26B2C2B2A_CONTEXT_BUDGET).length, unmeasured: measuredPerTarget.filter(n => n === 0).length },
    processWallMs: stats(runs.map(r => r.process.wallMs)),
    processWallMsTotal: runs.reduce((sum, r) => sum + r.process.wallMs, 0),
    searchElapsedMs: stats(measured.map(searchMs)),
    scheduleMs: stats(measured.map(r => r.scheduleMs ?? 0)),
    peakHeapBytes: stats(runs.map(r => peakOf(r).heap)),
    peakRssBytes: stats(runs.map(r => peakOf(r).rss)),
    peakHeapBytesMax: runs.length === 0 ? null : Math.max(...runs.map(r => peakOf(r).heap)),
    peakRssBytesMax: runs.length === 0 ? null : Math.max(...runs.map(r => peakOf(r).rss)),
    yields: stats(measured.map(r => r.yields ?? 0)),
    byRank: Array.from({ length: PHASE2C26B2C2B2A_CONTEXT_BUDGET }, (_, i) => i + 1).map(rank => {
      const at = measured.filter(r => r.task.contextRank === rank)
      return { rank, measured: at.length, timeout: runs.filter(r => r.task.contextRank === rank && r.outcome.process === 'timeout').length,
        searchElapsedMs: stats(at.map(searchMs)), peakHeapBytesMax: at.length === 0 ? null : Math.max(...at.map(r => peakOf(r).heap)) }
    }),
  }
}

const lateStart = (s: Phase2C26B2B2A2DeliveredCandidate['summary']) => Boolean(s.gogma?.startsAfterOrigin || s.skill?.startsAfterOrigin || s.normal?.startsAfterOrigin)

/** The captured Candidates of every measured context (no oracle). Not a global Candidate portfolio. */
export function phase2c26b2c2b2aCandidates(tasks: readonly Phase2C26B2C2B2ATaskInput[], runs: readonly Phase2C26B2C2B2ARun[]) {
  const searches = runs.map(searchOf).filter((s): s is Phase2C26B2C2B2ASearchRecord => s !== null)
  const captured = searches.flatMap(s => s.candidates)
  const targets = [...new Set(tasks.map(t => t.targetWeaponId))]
  const unique = targets.map(id => new Set(searches.filter(s => s.targetWeaponId === id).flatMap(s => s.candidates.map(c => c.stableKey))).size)
  return {
    contexts: searches.length,
    totalDelivered: searches.reduce((sum, s) => sum + s.summary.deliveredCandidates, 0),
    totalCaptured: captured.length,
    sentinels: searches.filter(s => s.nextCostSentinel !== null).length,
    uniqueStableKeysPerTarget: { ...stats(unique), total: unique.reduce((a, b) => a + b, 0) },
    captureLength: { ...stats(searches.map(s => s.candidates.length)), zero: searches.filter(s => s.candidates.length === 0).length,
      belowC8: searches.filter(s => s.candidates.length < 8).length, belowC32: searches.filter(s => s.candidates.length < 32).length },
    termination: countBy(searches, s => s.termination),
    costCohorts: countBy(searches, s => String(s.distinctCostCohorts)),
    routeKind: countBy(captured, c => c.summary.routeKind),
    sourceKind: countBy(captured, c => c.summary.sourceKind),
    heldRoute: captured.filter(c => c.summary.heldRoute).length,
    lateStart: { any: captured.filter(c => lateStart(c.summary)).length, gogma: captured.filter(c => c.summary.gogma?.startsAfterOrigin).length,
      skill: captured.filter(c => c.summary.skill?.startsAfterOrigin).length, normal: captured.filter(c => c.summary.normal?.startsAfterOrigin).length },
    estimatedOperationCount: countByNumber(captured.map(c => c.orderingKeys.estimatedOperationCount)),
    reservationViolations: searches.reduce((sum, s) => sum + deliveries(s).filter(d => !d.reservationCheck.respects).length, 0),
  }
}

// ---------------------------------------------------------------- decision (registered before the formal run)

export type Phase2C26B2C2B2ADecisionCase = 'B2C2B2A_ALL_C8' | 'B2C2B2A_ALL_C32' | 'B2C2B2A_ALL_C4C' | 'B2C2B2A_PARTIAL' | 'B2C2B2A_INCOMPLETE' | 'B2C2B2A_INVALID'

export const PHASE2C26B2C2B2A_DECISION_RULE = {
  order: [
    'B2C2B2A_INVALID: a B2-C2B1 / B2-C1 / B2-B1 authority mismatch, an E1 population or Target manifest mismatch, a Target count other than 11, a task count other than 352, a P1 definition drift, a P1 schedule parity mismatch, a context rank duplicated / missing, a reservation digest / origin drift, a task or record extent other than the common L2 extent (a Target-specific extent included), a default / L2 Search input digest drift, an oracle / hash-chain / Export / CalculationContext / RNG mismatch, a recomputed P1 first compatible rank other than B2-C1\'s, a context mismatch in a Search child, a task outside the manifest or run twice, a Candidate reservation violation (sentinel included), an exact or partial Candidate (or an exact / partial sentinel) from a reservation-incompatible context, a first exact rank before the first compatible rank, a nonmonotonic Candidate cost sequence, a provenance failure, or a raw / result inconsistency',
    'B2C2B2A_INCOMPLETE: no invalid reason, and a task was not measured (timeout / out of memory / process failure: never Candidate 0, never retried in this Phase)',
    'B2C2B2A_ALL_C8: all 352 tasks measured and C8 reaches an exact Candidate for 11 / 11 E1 Targets within P1 rank <= 32',
    'B2C2B2A_ALL_C32: all measured, C8 < 11, C32 11 / 11',
    'B2C2B2A_ALL_C4C: all measured, C32 < 11, C4C 11 / 11 (a safety-capped capture still counts its exact Candidates: they lie inside the first four cohorts)',
    'B2C2B2A_INCOMPLETE: all measured, C4C < 11, and a Target without a C4C exact has a safety-capped compatible context in its 32 (its C4C failure is undetermined)',
    'B2C2B2A_PARTIAL: all measured, no invalid reason, C4C < 11 and every missing Target fully determined (0 / 11 is registered here too and flagged)',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C',
  exact: 'phase2c26b2c2aCompareContext() -> phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate; partial_comparable is recorded and never counted as exact',
  firstExact: 'per Target and policy the smallest P1 rank whose context holds an exact Candidate in that policy; every rank 1..32 was searched regardless. first exact rank > first compatible rank is a legal measurement',
  compatible: 'phase2c26b2c2aReach() (phase2c26b2c1TargetReach() -> phase2c26b2aReachability()) over the re-derived schedule; must reproduce the B2-C1 P1 first compatible ranks',
  extent: 'every task and every Search at the common L2 extent { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }; the schedule / reservation universe / P1 ordering stay at the Production default extent',
} as const

export const PHASE2C26B2C2B2A_RECOMMENDATION: Record<Phase2C26B2C2B2ADecisionCase, string> = {
  B2C2B2A_ALL_C8: 'E1はcommon L2 extentでP1 scheduler-selected context + 既存SearchによるRoute deliveryがこのExportでは成立。次はL1 / escalationによるruntime削減、E2（K2-minimal）のTarget-relative K2 feature / grouping研究を別Phaseで検討。Production採用ではない',
  B2C2B2A_ALL_C32: 'E1はcommon L2 extentで成立（C8では不足、C32で閉じる）。次はL1 / escalationとE2研究を別Phaseで検討。Production採用ではない',
  B2C2B2A_ALL_C4C: 'E1はcommon L2 extentで成立（equal-cost cohort単位のcaptureが必要）。次はL1 / escalationとE2研究を別Phaseで検討。Production採用ではない',
  B2C2B2A_PARTIAL: '未回収E1 Targetをcompatible contextなのにSearch non-delivery / capture不足 / context rank 32外に分離して原因を研究する',
  B2C2B2A_INCOMPLETE: 'timeout / OOM / safety capを先に扱う（timeout taskの長時間再測定、extentによるresource explosion調査、Search runtime最適化のいずれかをレビュー後に決める）',
  B2C2B2A_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2B2ADecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  unmeasuredTasks: number
  exactTargets: Record<Phase2C26B2C2B2ACapturePolicy, number>
  /** Targets without a C4C exact that hold a safety-capped compatible context. */
  unresolvedSafetyCapTargets: number
}

export function phase2c26b2c2b2aDecision(input: Phase2C26B2C2B2ADecisionInput) {
  const { tasks, targets, unmeasuredTasks, exactTargets, unresolvedSafetyCapTargets } = input
  const values = [tasks, targets, unmeasuredTasks, unresolvedSafetyCapTargets, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || unmeasuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets
    || unresolvedSafetyCapTargets > targets - exactTargets.C4C) throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2A decision input: ${JSON.stringify(input)}`)
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2B2A_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2B2A_TARGETS ? [`target_count_${targets}`] : [])]
  const all = PHASE2C26B2C2B2A_TARGETS
  const caseId: Phase2C26B2C2B2ADecisionCase = reasons.length > 0 ? 'B2C2B2A_INVALID'
    : unmeasuredTasks > 0 ? 'B2C2B2A_INCOMPLETE'
      : exactTargets.C8 === all ? 'B2C2B2A_ALL_C8'
        : exactTargets.C32 === all ? 'B2C2B2A_ALL_C32'
          : exactTargets.C4C === all ? 'B2C2B2A_ALL_C4C'
            : unresolvedSafetyCapTargets > 0 ? 'B2C2B2A_INCOMPLETE'
              : 'B2C2B2A_PARTIAL'
  return { case: caseId, reasons, noExactTarget: caseId === 'B2C2B2A_PARTIAL' && exactTargets.C4C === 0, recommendation: PHASE2C26B2C2B2A_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the B2-C2A RESULT (diagnostic runtime comparison only)

/** The B2-C2A default-extent Stage 1 this phase compares its runtime with (diagnostic only; never a decision input). */
export const PHASE2C26B2C2B2A_REGISTERED_B2C2A = { resultSha256: '9b2736cc0a58c039837207d4caa41a6360715e7dd72e26237a6366b80d1bd74f', decisionCase: 'B2C2A_INCOMPLETE' } as const

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads the committed B2-C2A RESULT for its default-extent Stage 1 execution aggregates only: the registered SHA-256, formal
 * with no calculation change, the registered case, no invalid reason, the same B2-C1 RESULT and Export.
 */
export function parsePhase2C26B2C2B2AB2C2ADiagnostic(json: unknown, resultSha256: string, expected: { b2c1ResultSha256: string; exportSha256: string }) {
  const reg = PHASE2C26B2C2B2A_REGISTERED_B2C2A
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.conditions)) {
    return { valid: false, issues: ['B2-C2A RESULT lacks provenance / decision / aggregates / conditions'], diagnostic: null }
  }
  const { provenance, decision, aggregates, conditions } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2A RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (provenance.b2c1ResultSha256 !== expected.b2c1ResultSha256) issues.push('provenance.b2c1ResultSha256 is not the B2-C1 RESULT of this phase')
  if (provenance.exportSha256 !== expected.exportSha256) issues.push('provenance.exportSha256 is not the Export of this phase')
  const execution = isObject(aggregates.execution) ? aggregates.execution : null
  const candidates = isObject(aggregates.candidates) ? aggregates.candidates : null
  if (!execution || !candidates) issues.push('aggregates.execution / candidates is missing')
  if (issues.length > 0) return { valid: false, issues, diagnostic: null }
  const pick = (e: Json) => ({ tasks: e.tasks, completed: e.completed, timeout: e.timeout, outOfMemory: e.outOfMemory, processFailure: e.processFailure, safetyCapUnresolved: e.safetyCapUnresolved,
    processWallMs: e.processWallMs, searchElapsedMs: e.searchElapsedMs, peakHeapBytesMax: e.peakHeapBytesMax, peakRssBytesMax: e.peakRssBytesMax, yields: e.yields })
  return { valid: true, issues: [], diagnostic: { resultSha256, measuredHead: String(provenance.measuredHead), stage1: conditions.stage1, extent: conditions.extent,
    execution: pick(execution!), candidates: { termination: candidates!.termination, captureLength: candidates!.captureLength, costCohorts: candidates!.costCohorts } } }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2C2B2AAnalysisInput {
  targetWeaponIds: readonly string[]
  tasks: readonly Phase2C26B2C2B2ATaskInput[]
  runs: readonly Phase2C26B2C2B2ARun[]
  reach: readonly Phase2C26B2C2AReach[]
  /** B2-C1's recorded P1 first compatible rank per E1 Target. */
  b2c1FirstCompatible: ReadonlyMap<string, number | null>
  oracle: Oracle
  smoke: boolean
}

/** Raw consistency, the per-context comparison, the per-Target first exact, every aggregate and every invalid reason found here. */
export function runPhase2C26B2C2B2AAnalysis({ targetWeaponIds, tasks, runs, reach, b2c1FirstCompatible, oracle, smoke }: Phase2C26B2C2B2AAnalysisInput) {
  const invalidReasons: string[] = validatePhase2C26B2C2B2ARaw({ tasks, runs, smoke }).map(issue => issue.startsWith('semantic_failure') ? issue : `raw: ${issue}`)
  const manifestTargets = new Set(targetWeaponIds)
  for (const task of tasks) if (!manifestTargets.has(task.targetWeaponId)) invalidReasons.push(`raw: ${task.taskId}: a task outside the manifest`)
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  for (const r of reach) {
    invalidReasons.push(...r.inconsistencies.map(i => `reach: ${i}`))
    if (r.p1FirstCompatibleRank !== (b2c1FirstCompatible.get(r.targetWeaponId) ?? null)) invalidReasons.push(`authority: ${r.targetWeaponId}: recomputed P1 first compatible rank ${String(r.p1FirstCompatibleRank)} is not B2-C1's ${String(b2c1FirstCompatible.get(r.targetWeaponId))}`)
  }
  for (const run of runs) if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}: context mismatch in the Search child`)
  const contexts = tasks.map(task => phase2c26b2c2b2aCompareContext(runOf.get(task.taskId), task, reachOf.get(task.targetWeaponId)?.compatibleGroupIndexes.includes(task.groupIndex) ?? false, oracle))
  for (const c of contexts) invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
  const rows: Phase2C26B2C2B2ATargetRow[] = []
  for (const targetWeaponId of targetWeaponIds) {
    const { row, inconsistencies } = phase2c26b2c2b2aTargetRow(targetWeaponId, contexts.filter(c => c.targetWeaponId === targetWeaponId), b2c1FirstCompatible.get(targetWeaponId) ?? null,
      reachOf.get(targetWeaponId), phase2c26b2b2a2OracleOperationCost(oracle, targetWeaponId))
    invalidReasons.push(...inconsistencies)
    if (!smoke && row.b2c1FirstCompatibleRank !== null && !row.compatibleRanksInBudget.includes(row.b2c1FirstCompatibleRank)) invalidReasons.push(`authority: ${targetWeaponId}: the B2-C1 first compatible rank is not a compatible searched context`)
    rows.push(row)
  }
  const execution = phase2c26b2c2b2aExecution(tasks, runs)
  const exactTargets = Object.fromEntries(PHASE2C26B2C2B2A_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2B2ACapturePolicy, number>
  const unresolvedSafetyCapTargets = rows.filter(r => r.recovery === 'none' && contexts.some(c => c.targetWeaponId === r.targetWeaponId && c.compatible && c.safetyCapHit === true)).length
  const unmeasuredTasks = tasks.length - execution.completed - execution.contextMismatch
  const recovered = rows.filter(r => r.policies.C4C.firstExactContextRank !== null)
  return {
    contexts, rows, invalidReasons,
    aggregates: {
      exactTargets, budgetCoverage: phase2c26b2c2b2aBudgetCoverage(rows), cascade: phase2c26b2c2b2aCascade(rows), compatibility: phase2c26b2c2b2aCompatibility(contexts),
      missClasses: countBy(rows.filter(r => r.missClass !== null), r => r.missClass!), partialWithoutExact: rows.filter(r => r.partialWithoutExact).length,
      firstExactDelta: Object.fromEntries(PHASE2C26B2C2B2A_CAPTURE_POLICIES.map(p => [p, countByNumber(rows.flatMap(r => r.policies[p].deltaFromFirstCompatible === null ? [] : [r.policies[p].deltaFromFirstCompatible!]))])),
      /** The B2-C2A default-extent observation, re-asked for E1 at L2 (a comparison, never a decision condition). */
      firstExactEqualsFirstCompatible: { recoveredC4C: recovered.length, equal: recovered.filter(r => r.policies.C4C.deltaFromFirstCompatible === 0).length,
        later: recovered.filter(r => (r.policies.C4C.deltaFromFirstCompatible ?? 0) > 0).length },
      execution, candidates: phase2c26b2c2b2aCandidates(tasks, runs),
    },
    decisionInput: { tasks: tasks.length, targets: targetWeaponIds.length, unmeasuredTasks: Math.max(0, unmeasuredTasks), exactTargets, unresolvedSafetyCapTargets },
  }
}
