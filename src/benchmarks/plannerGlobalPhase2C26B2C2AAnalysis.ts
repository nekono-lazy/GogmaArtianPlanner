/**
 * Issue #154 Phase 2-C2.6-B2-C2A post-hoc analysis only. It reads the finished B2-C2A raw run (with every child record)
 * and, as explicit analyzer arguments AFTER the run ended, the B2-C1 RESULT (population and P1 first-compatible
 * authority), the B2-B1 / B2-B2A / B2-B2A2 RESULTs (hash chain), the 1,657 oracle RESULT and its manifest. It runs no
 * Search, no kernel and no Planner and feeds nothing back into any calculation.
 *
 * Two post-hoc questions only:
 *   1. reservation compatibility of each searched context with the oracle Route: the unchanged B2-C1 per-Target audit
 *      (`phase2c26b2c1TargetReach()` -> `phase2c26b2aReachability()`), which must reproduce B2-C1's P1 first-compatible
 *      rank exactly;
 *   2. oracle coverage of each captured Candidate: the unchanged B2-B2A per-task comparison (`phase2c26b2b2aCompare()` ->
 *      `phase2c2OracleCoverage()`), per Candidate and per context. Nothing here re-implements oracle matching.
 * The three capture policies are cut from the one capture: C8 / C32 are its first 8 / 32 Candidates, C4C is all of it, so
 * C8 ⊆ C32 ⊆ C4C always (a capture of fewer than 32 makes C32 the whole capture, reported separately).
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { phase2c26b2aRouteView, type Phase2C26B2AOracle, type Phase2C26B2AOracleRouteSpec, type Phase2C26B2AOrigins } from './plannerGlobalPhase2C26B2AAnalysis'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { phase2c26b2b2aCompare, type Phase2C26B2B2AFinal } from './plannerGlobalPhase2C26B2B2AAnalysis'
import { phase2c26b2b2a2FirstDecidingKey, phase2c26b2b2a2OracleOperationCost } from './plannerGlobalPhase2C26B2B2A2Analysis'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { phase2c26b2c1Percentile, phase2c26b2c1TargetReach } from './plannerGlobalPhase2C26B2C1Analysis'
import {
  PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2A_CAPTURE_PREFIXES,
  PHASE2C26B2C2A_CONTEXT_BUDGET,
  PHASE2C26B2C2A_EXPECTED_TASKS,
  PHASE2C26B2C2A_MAX_COST_COHORTS,
  PHASE2C26B2C2A_VALIDATION_TARGETS,
  type Phase2C26B2C2AChildRecord,
  type Phase2C26B2C2ASearchRecord,
  type Phase2C26B2C2ATaskInput,
  type Phase2C26B2C2ATaskOutcome,
} from './plannerGlobalPhase2C26B2C2A'

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

export type Phase2C26B2C2ACapturePolicy = 'C8' | 'C32' | 'C4C'
export const PHASE2C26B2C2A_CAPTURE_POLICIES: readonly Phase2C26B2C2ACapturePolicy[] = ['C8', 'C32', 'C4C']
/** The context budgets the RESULT reports (diagnostic, never Production defaults). */
export const PHASE2C26B2C2A_BUDGETS = [1, 2, 4, 8, 12, 16] as const

/** The Candidates of one capture that a policy reads: C8 / C32 the first 8 / 32 of the capture, C4C all of it. */
export function phase2c26b2c2aPolicyLength(policy: Phase2C26B2C2ACapturePolicy, captured: number): number {
  return policy === 'C4C' ? captured : Math.min(captured, PHASE2C26B2C2A_CAPTURE_PREFIXES[policy])
}

// ---------------------------------------------------------------- one run as the raw record holds it

export interface Phase2C26B2C2ARun {
  taskId: string
  task: Phase2C26B2C2ATaskInput
  outcome: Phase2C26B2C2ATaskOutcome
  process: { outcome: string; wallMs: number; timedOut: boolean; budgetMs: number }
  childWallMs: number | null
  scheduleMs: number | null
  yields: number | null
  memory: { sampledMaxHeapUsedBytes: number; sampledMaxRssBytes: number; maxRssKiB: number } | null
  lastIpcMemory: { maxHeapUsedBytes: number; maxRssBytes: number } | null
  /** The child record's `result` (loaded from the run dir and checked against its SHA-256 by the analyzer). */
  record: Phase2C26B2C2AChildRecord | null
}

const deliveries = (s: Phase2C26B2C2ASearchRecord): Phase2C26B2B2A2DeliveredCandidate[] => [...s.candidates, ...(s.nextCostSentinel ? [s.nextCostSentinel] : [])]
const searchOf = (run: Phase2C26B2C2ARun | undefined): Phase2C26B2C2ASearchRecord | null =>
  run && run.outcome.process === 'completed' && run.outcome.record === 'searched' && run.record?.status === 'searched' ? run.record.search : null

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * Internal drift of the raw run. Every searched record names its task's Target, rank, group, digests, representative and
 * capture rule at the default extent, excludes exactly one Route key and never delivers it; deliveries are indexed 0..n-1
 * with unique keys; the recorded comparator verdict against the previous delivery is "earlier first" every time and agrees
 * with the six recorded keys; the captured costs are the first <= 4 distinct costs, the sentinel is a fifth; and the
 * termination agrees with the flags and counts. A delivered cost below an earlier one (a non-monotonic sequence) is a
 * semantic failure.
 */
export function validatePhase2C26B2C2ARaw(input: { tasks: readonly Phase2C26B2C2ATaskInput[]; runs: readonly Phase2C26B2C2ARun[]; smoke: boolean }): string[] {
  const issues: string[] = []
  const { tasks, runs } = input
  if (!input.smoke && runs.length !== tasks.length) issues.push(`Stage 1 ran ${runs.length} of ${tasks.length} tasks`)
  if (new Set(runs.map(r => r.taskId)).size !== runs.length) issues.push('a task ran twice')
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
      || !same(s.representativeFixedTargetWeaponIds, task.representativeFixedTargetWeaponIds) || s.searchInputDigest !== task.searchInputDigest) issues.push(`${at}: the record is not the task's context`)
    if (s.maxCostCohorts !== PHASE2C26B2C2A_MAX_COST_COHORTS || s.candidateSafetyCap !== PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP) issues.push(`${at}: capture rule drift`)
    if (!same(s.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push(`${at}: the extent is not the Production default`)
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
    if (!same(distinct, s.capturedCosts) || s.distinctCostCohorts !== s.capturedCosts.length || s.capturedCosts.length > PHASE2C26B2C2A_MAX_COST_COHORTS) issues.push(`${at}: captured cost cohorts drift`)
    const sentinelCost = s.nextCostSentinel?.orderingKeys.estimatedOperationCount
    if (s.nextCostSentinel && (s.capturedCosts.length !== PHASE2C26B2C2A_MAX_COST_COHORTS || s.capturedCosts.includes(sentinelCost!))) issues.push(`${at}: the sentinel is not the first Candidate of a fifth cost`)
    const f = s.summary
    const below = s.candidates.length < PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP
    const ok = s.termination === 'four_cost_cohorts_drained' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel !== null && !s.safetyCapHit && s.captureComplete && below
      : s.termination === 'candidate_safety_cap' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel === null && s.safetyCapHit && !s.captureComplete
        && s.candidates.length === PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP
        : s.termination === 'stopped_by_extent' ? s.status === 'stopped_by_extent' && !f.stoppedByConsumer && f.stoppedByExtent && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
          : s.termination === 'exhausted' && s.status === 'exhausted' && !f.stoppedByConsumer && !f.stoppedByExtent && f.exhausted && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
    if (!ok) issues.push(`${at}: the termination disagrees with the flags / counts`)
    if (run.outcome.searchStatus !== s.status || run.outcome.termination !== s.termination || run.outcome.candidateCount !== s.candidates.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- post-hoc reservation compatibility (unchanged B2-C1 audit)

export interface Phase2C26B2C2AReach {
  targetWeaponId: string
  compatibleGroupIndexes: number[]
  /** The recomputed P1 first reservation-compatible rank (must equal B2-C1's). */
  p1FirstCompatibleRank: number | null
  inconsistencies: string[]
}

/**
 * Every context of every validation Target judged against its oracle Route by the unchanged B2-C1 audit helper, with the
 * B2-C1 origins (`schedule.origins`, the Route's weapon-type Normal Counter of the snapshot origin).
 */
export async function phase2c26b2c2aReach(schedule: Phase2C26B2C1Schedule, targetWeaponIds: readonly string[], manifest: readonly Phase2C26B2AOracleRouteSpec[],
  oracle: Pick<Phase2C26B2AOracle, 'routes'>): Promise<Phase2C26B2C2AReach[]> {
  const weaponTypeOf = new Map(oracle.routes.map(route => [route.targetWeaponId, route.weaponTypeId]))
  const out: Phase2C26B2C2AReach[] = []
  for (const targetWeaponId of targetWeaponIds) {
    const spec = manifest.find(s => s.targetWeaponId === targetWeaponId)
    const weaponTypeId = weaponTypeOf.get(targetWeaponId)
    if (!spec || weaponTypeId === undefined) { out.push({ targetWeaponId, compatibleGroupIndexes: [], p1FirstCompatibleRank: null, inconsistencies: [`${targetWeaponId}: no oracle Route`] }); continue }
    const view = phase2c26b2aRouteView(spec, weaponTypeId)
    const origins: Phase2C26B2AOrigins = { skill: schedule.origins.skill, gogma: schedule.origins.gogma,
      normal: schedule.snapshot.origin.normalCounters.find(c => c.counterId === view.normalCounterId)?.counter ?? null }
    const reach = await phase2c26b2c1TargetReach({ view, origins, schedule, rows: schedule.contexts.filter(c => c.targetWeaponId === targetWeaponId), supporters: null })
    out.push({ targetWeaponId, compatibleGroupIndexes: reach.compatibleGroupIndexes, p1FirstCompatibleRank: reach.firstCompatible.P1.rank, inconsistencies: reach.inconsistencies })
  }
  return out
}

// ---------------------------------------------------------------- oracle comparison per context (unchanged B2-B2A comparison)

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

export interface Phase2C26B2C2AContextComparison {
  taskId: string
  targetWeaponId: string
  contextRank: number
  groupIndex: number
  measured: boolean
  compatible: boolean
  captureComplete: boolean | null
  safetyCapHit: boolean | null
  candidateCount: number | null
  capturedCosts: number[]
  /** `phase2c2OracleCoverage()` over the whole capture (C4C). */
  coverage: string | null
  exactIndexes: number[]
  partialIndexes: number[]
  firstExactIndex: number | null
  firstExactCost: number | null
  firstPartialIndex: number | null
  hit: Record<Phase2C26B2C2ACapturePolicy, boolean>
  /** Diagnostic only: the sentinel (outside every policy) alone covers the oracle Route exactly. */
  sentinelExact: boolean
  reservationViolations: number
  inconsistencies: string[]
}

const asFinal = (targetWeaponId: string, taskId: string, status: string, candidates: readonly Phase2C26B2B2A2DeliveredCandidate[]) =>
  ({ taskId, targetWeaponId, formalRun: 'stage1', stage1: null, fallback: null, final: null, measured: true, search: { status, candidates } }) as unknown as Phase2C26B2B2AFinal

/** One context against the oracle Route: per-Candidate exact / partial indexes, the policies that hold an exact one, and the semantic checks. */
export function phase2c26b2c2aCompareContext(run: Phase2C26B2C2ARun | undefined, task: Phase2C26B2C2ATaskInput, compatible: boolean, oracle: Oracle): Phase2C26B2C2AContextComparison {
  const s = searchOf(run)
  const base = { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, compatible }
  if (s === null) {
    return { ...base, measured: false, captureComplete: null, safetyCapHit: null, candidateCount: null, capturedCosts: [], coverage: null, exactIndexes: [], partialIndexes: [], firstExactIndex: null,
      firstExactCost: null, firstPartialIndex: null, hit: { C8: false, C32: false, C4C: false }, sentinelExact: false, reservationViolations: 0, inconsistencies: [] }
  }
  const c = phase2c26b2b2aCompare(asFinal(task.targetWeaponId, task.taskId, s.status, s.candidates), oracle)
  const inconsistencies = [...c.inconsistencies]
  if (c.coverage === 'not_comparable' || c.coverage === null) inconsistencies.push(`${task.taskId}: the oracle Route is not comparable`)
  const firstExactIndex = c.exactDeliveryIndexes[0] ?? null
  const hit = Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(p => [p, firstExactIndex !== null && firstExactIndex < phase2c26b2c2aPolicyLength(p, s.candidates.length)])) as Record<Phase2C26B2C2ACapturePolicy, boolean>
  const sentinelExact = s.nextCostSentinel === null ? false : phase2c26b2b2aCompare(asFinal(task.targetWeaponId, task.taskId, s.status, [s.nextCostSentinel]), oracle).coverage === 'exact'
  const reservationViolations = deliveries(s).filter(d => !d.reservationCheck.respects).length
  if (reservationViolations > 0) inconsistencies.push(`semantic_failure: ${task.taskId}: ${reservationViolations} delivered Candidate(s) violate the reservation`)
  if (firstExactIndex !== null && !compatible) inconsistencies.push(`semantic_failure: ${task.taskId}: an exact Candidate from a reservation-incompatible context`)
  if (sentinelExact && !compatible) inconsistencies.push(`semantic_failure: ${task.taskId}: the sentinel is exact from a reservation-incompatible context`)
  return { ...base, measured: true, captureComplete: s.captureComplete, safetyCapHit: s.safetyCapHit, candidateCount: s.candidates.length, capturedCosts: [...s.capturedCosts], coverage: c.coverage,
    exactIndexes: c.exactDeliveryIndexes, partialIndexes: c.partialDeliveryIndexes, firstExactIndex, firstExactCost: firstExactIndex === null ? null : s.candidates[firstExactIndex]!.orderingKeys.estimatedOperationCount,
    firstPartialIndex: c.partialDeliveryIndexes[0] ?? null, hit, sentinelExact, reservationViolations, inconsistencies }
}

// ---------------------------------------------------------------- per Target

export interface Phase2C26B2C2AFirstExact {
  firstExactContextRank: number | null
  firstExactCandidateIndex: number | null
  firstExactOperationCost: number | null
  /** `firstExactContextRank - b2c1FirstCompatibleRank` (never negative). */
  deltaFromFirstCompatible: number | null
}

export type Phase2C26B2C2AMissClass = 'unmeasured' | 'no_compatible_context_in_budget' | 'safety_cap_unresolved' | 'capture_insufficient' | 'compatible_non_delivery'

export interface Phase2C26B2C2ATargetRow {
  targetWeaponId: string
  b2c1FirstCompatibleRank: number | null
  recomputedFirstCompatibleRank: number | null
  compatibleRanksInBudget: number[]
  measuredContexts: number
  fullyMeasured: boolean
  safetyCapContexts: number
  oracleOperationCost: number | null
  policies: Record<Phase2C26B2C2ACapturePolicy, Phase2C26B2C2AFirstExact>
  /** The smallest policy that reaches an exact Candidate within the budget. */
  recovery: Phase2C26B2C2ACapturePolicy | 'none'
  /** Why C4C misses (null when it does not). */
  missClass: Phase2C26B2C2AMissClass | null
  partialWithoutExact: boolean
}

export function phase2c26b2c2aTargetRow(targetWeaponId: string, contexts: readonly Phase2C26B2C2AContextComparison[], b2c1FirstCompatibleRank: number | null,
  reach: Phase2C26B2C2AReach | undefined, oracleOperationCost: number | null): { row: Phase2C26B2C2ATargetRow; inconsistencies: string[] } {
  const inconsistencies: string[] = []
  const ordered = [...contexts].sort((a, b) => a.contextRank - b.contextRank)
  const policies = Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(policy => {
    const first = ordered.find(c => c.hit[policy])
    const rank = first?.contextRank ?? null
    if (rank !== null && b2c1FirstCompatibleRank !== null && rank < b2c1FirstCompatibleRank) {
      inconsistencies.push(`semantic_failure: ${targetWeaponId}: ${policy} first exact rank ${rank} is before the B2-C1 first compatible rank ${b2c1FirstCompatibleRank}`)
    }
    return [policy, { firstExactContextRank: rank, firstExactCandidateIndex: first?.firstExactIndex ?? null, firstExactOperationCost: first?.firstExactCost ?? null,
      deltaFromFirstCompatible: rank === null || b2c1FirstCompatibleRank === null ? null : rank - b2c1FirstCompatibleRank }]
  })) as Record<Phase2C26B2C2ACapturePolicy, Phase2C26B2C2AFirstExact>
  const recovery = PHASE2C26B2C2A_CAPTURE_POLICIES.find(p => policies[p].firstExactContextRank !== null) ?? 'none'
  const compatible = ordered.filter(c => c.compatible)
  let missClass: Phase2C26B2C2AMissClass | null = null
  if (recovery === 'none') {
    if (ordered.some(c => !c.measured)) missClass = 'unmeasured'
    else if (compatible.length === 0) missClass = 'no_compatible_context_in_budget'
    else if (compatible.some(c => c.safetyCapHit)) missClass = 'safety_cap_unresolved'
    else if (oracleOperationCost !== null && compatible.every(c => c.capturedCosts.length === PHASE2C26B2C2A_MAX_COST_COHORTS && oracleOperationCost > Math.max(...c.capturedCosts))) missClass = 'capture_insufficient'
    else missClass = 'compatible_non_delivery'
  }
  return { inconsistencies, row: {
    targetWeaponId, b2c1FirstCompatibleRank, recomputedFirstCompatibleRank: reach?.p1FirstCompatibleRank ?? null, compatibleRanksInBudget: compatible.map(c => c.contextRank),
    measuredContexts: ordered.filter(c => c.measured).length, fullyMeasured: ordered.length === PHASE2C26B2C2A_CONTEXT_BUDGET && ordered.every(c => c.measured),
    safetyCapContexts: ordered.filter(c => c.safetyCapHit === true).length, oracleOperationCost, policies, recovery, missClass,
    partialWithoutExact: recovery === 'none' && ordered.some(c => c.partialIndexes.length > 0),
  } }
}

// ---------------------------------------------------------------- aggregation

const stats = (values: readonly number[]) => ({ count: values.length, min: values.length === 0 ? null : Math.min(...values), median: phase2c26b2c1Percentile(values, 50),
  p90: phase2c26b2c1Percentile(values, 90), p95: phase2c26b2c1Percentile(values, 95), max: values.length === 0 ? null : Math.max(...values) })

/** Targets reaching an exact Candidate within each context budget, per capture policy. */
export function phase2c26b2c2aBudgetCoverage(rows: readonly Phase2C26B2C2ATargetRow[]) {
  return Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(policy => [policy, Object.fromEntries(PHASE2C26B2C2A_BUDGETS.map(budget =>
    [`top${budget}`, rows.filter(row => row.policies[policy].firstExactContextRank !== null && row.policies[policy].firstExactContextRank! <= budget).length]))]))
}

/** The capture-policy cascade: recovered by C8; C8 miss recovered by C32; C32 miss recovered by C4C; C4C miss. */
export function phase2c26b2c2aCascade(rows: readonly Phase2C26B2C2ATargetRow[]) {
  return { c8: rows.filter(r => r.recovery === 'C8').length, c8MissC32: rows.filter(r => r.recovery === 'C32').length, c32MissC4C: rows.filter(r => r.recovery === 'C4C').length,
    c4cMiss: rows.filter(r => r.recovery === 'none').length }
}

export function phase2c26b2c2aCompatibility(contexts: readonly Phase2C26B2C2AContextComparison[]) {
  const measured = contexts.filter(c => c.measured)
  const compatible = measured.filter(c => c.compatible)
  return {
    contexts: contexts.length,
    measured: measured.length,
    compatibleSearched: compatible.length,
    compatibleWithExact: Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(p => [p, compatible.filter(c => c.hit[p]).length])),
    compatibleWithoutExact: { all: compatible.filter(c => !c.hit.C4C).length, captureComplete: compatible.filter(c => !c.hit.C4C && c.captureComplete).length,
      safetyCap: compatible.filter(c => !c.hit.C4C && c.safetyCapHit).length, partialOnly: compatible.filter(c => !c.hit.C4C && c.partialIndexes.length > 0).length,
      sentinelExact: compatible.filter(c => !c.hit.C4C && c.sentinelExact).length },
    incompatibleSearched: measured.length - compatible.length,
    incompatibleWithExact: measured.filter(c => !c.compatible && (c.hit.C4C || c.sentinelExact)).length,
    incompatibleWithPartial: measured.filter(c => !c.compatible && c.partialIndexes.length > 0).length,
    byRank: Array.from({ length: PHASE2C26B2C2A_CONTEXT_BUDGET }, (_, i) => i + 1).map(rank => {
      const at = measured.filter(c => c.contextRank === rank)
      return { rank, measured: at.length, compatible: at.filter(c => c.compatible).length, exactC8: at.filter(c => c.hit.C8).length, exactC32: at.filter(c => c.hit.C32).length, exactC4C: at.filter(c => c.hit.C4C).length }
    }),
  }
}

export function phase2c26b2c2aExecution(tasks: readonly Phase2C26B2C2ATaskInput[], runs: readonly Phase2C26B2C2ARun[]) {
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const peak = (r: Phase2C26B2C2ARun) => ({ heap: Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0),
    rss: Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0) })
  const measured = runs.filter(r => searchOf(r) !== null)
  const targets = [...new Set(tasks.map(t => t.targetWeaponId))]
  const measuredPerTarget = targets.map(id => tasks.filter(t => t.targetWeaponId === id && searchOf(runOf.get(t.taskId)) !== null).length)
  const searchMs = (r: Phase2C26B2C2ARun) => searchOf(r)!.elapsedMs
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
    targets: { total: targets.length, fullyMeasured: measuredPerTarget.filter(n => n === PHASE2C26B2C2A_CONTEXT_BUDGET).length,
      partiallyMeasured: measuredPerTarget.filter(n => n > 0 && n < PHASE2C26B2C2A_CONTEXT_BUDGET).length, unmeasured: measuredPerTarget.filter(n => n === 0).length },
    processWallMs: stats(runs.map(r => r.process.wallMs)),
    searchElapsedMs: stats(measured.map(searchMs)),
    scheduleMs: stats(measured.map(r => r.scheduleMs ?? 0)),
    peakHeapBytesMax: runs.length === 0 ? null : Math.max(...runs.map(r => peak(r).heap)),
    peakRssBytesMax: runs.length === 0 ? null : Math.max(...runs.map(r => peak(r).rss)),
    yields: stats(measured.map(r => r.yields ?? 0)),
    byRank: Array.from({ length: PHASE2C26B2C2A_CONTEXT_BUDGET }, (_, i) => i + 1).map(rank => {
      const at = measured.filter(r => r.task.contextRank === rank)
      return { rank, measured: at.length, searchElapsedMs: stats(at.map(searchMs)), peakHeapBytesMax: at.length === 0 ? null : Math.max(...at.map(r => peak(r).heap)) }
    }),
  }
}

const lateStart = (s: Phase2C26B2B2A2DeliveredCandidate['summary']) => Boolean(s.gogma?.startsAfterOrigin || s.skill?.startsAfterOrigin || s.normal?.startsAfterOrigin)

/** The captured Candidates of every measured context (no oracle). Not a global Candidate portfolio. */
export function phase2c26b2c2aCandidates(tasks: readonly Phase2C26B2C2ATaskInput[], runs: readonly Phase2C26B2C2ARun[]) {
  const searches = runs.map(searchOf).filter((s): s is Phase2C26B2C2ASearchRecord => s !== null)
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
      belowC8: searches.filter(s => s.candidates.length < PHASE2C26B2C2A_CAPTURE_PREFIXES.C8).length, belowC32: searches.filter(s => s.candidates.length < PHASE2C26B2C2A_CAPTURE_PREFIXES.C32).length },
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

export type Phase2C26B2C2ADecisionCase = 'B2C2A_ALL_C8' | 'B2C2A_ALL_C32' | 'B2C2A_ALL_C4C' | 'B2C2A_PARTIAL' | 'B2C2A_INCOMPLETE' | 'B2C2A_INVALID'

export const PHASE2C26B2C2A_DECISION_RULE = {
  order: [
    'B2C2A_INVALID: a B2-C1 authority mismatch, a Target manifest mismatch, a Target count other than 20, a task count other than 320, a P1 definition drift, a P1 schedule parity mismatch, a context rank duplicated / missing, a reservation digest / origin / extent mismatch, an oracle / hash-chain mismatch, a recomputed P1 first compatible rank other than B2-C1\'s, a context mismatch in a Search child, a Candidate reservation violation (sentinel included), an exact Candidate (or exact sentinel) from a reservation-incompatible context, a first exact rank before the first compatible rank, a nonmonotonic Candidate cost sequence, a provenance failure, or a raw / result inconsistency',
    'B2C2A_INCOMPLETE: no invalid reason, and a task was not measured (timeout / out of memory / process failure: never Candidate 0, never retried in this Phase)',
    'B2C2A_ALL_C8: all 320 tasks measured and C8 reaches an exact Candidate for 20 / 20 Targets within P1 rank <= 16',
    'B2C2A_ALL_C32: all measured, C8 < 20, C32 20 / 20',
    'B2C2A_ALL_C4C: all measured, C32 < 20, C4C 20 / 20 (a safety-capped capture still counts its exact Candidates: they lie inside the first four cohorts)',
    'B2C2A_INCOMPLETE: all measured, C4C < 20, and a Target without a C4C exact has a safety-capped context in its 16 (its C4C is undetermined)',
    'B2C2A_PARTIAL: all measured, C4C < 20 and every missing Target fully determined (the user-defined range is 1..19; 0 / 20 is registered here too and flagged)',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C; a capture shorter than 32 makes C32 the whole capture',
  exact: 'phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate; partial_comparable is recorded and never counted as exact',
  firstExact: 'per Target and policy the smallest P1 rank whose context holds an exact Candidate in that policy; every rank was searched regardless',
  compatible: 'phase2c26b2c1TargetReach() (phase2c26b2aReachability()) over the re-derived schedule; must reproduce B2-C1 P1 first compatible ranks',
} as const

export const PHASE2C26B2C2A_RECOMMENDATION: Record<Phase2C26B2C2ADecisionCase, string> = {
  B2C2A_ALL_C8: 'default extent層のscheduler mechanismはこのExportでは実Searchまで成立。次はextent不足20件についてscheduler-selected contextを使ったextent probeへ（K2-minimal 9件はTarget-relative K2 feature / grouping改善も別途検討）。P1 / budget 16 / capture 8のProduction採用ではない',
  B2C2A_ALL_C32: 'default extent層のscheduler mechanismはこのExportでは実Searchまで成立（C8では不足、C32で閉じる）。次はextent不足20件のscheduler-selected context extent probeへ（K2-minimal 9件は別途）。Production採用ではない',
  B2C2A_ALL_C4C: 'default extent層のscheduler mechanismはこのExportでは実Searchまで成立（equal-cost cohort単位のcaptureが必要）。次はextent不足20件のscheduler-selected context extent probeへ（K2-minimal 9件は別途）。Production採用ではない',
  B2C2A_PARTIAL: '未回収Targetをcompatible contextなのにSearch non-delivery / capture不足 / context rank16外に分離して原因を研究する',
  B2C2A_INCOMPLETE: 'runtime / Search completion（timeout / OOM / safety cap）を先に扱い、timeout subsetは別Phaseで再測定する',
  B2C2A_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2ADecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  unmeasuredTasks: number
  exactTargets: Record<Phase2C26B2C2ACapturePolicy, number>
  /** Targets without a C4C exact that hold a safety-capped context. */
  unresolvedSafetyCapTargets: number
}

export function phase2c26b2c2aDecision(input: Phase2C26B2C2ADecisionInput) {
  const { tasks, targets, unmeasuredTasks, exactTargets, unresolvedSafetyCapTargets } = input
  const values = [tasks, targets, unmeasuredTasks, unresolvedSafetyCapTargets, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || unmeasuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets
    || unresolvedSafetyCapTargets > targets - exactTargets.C4C) throw new Error(`Inconsistent Phase 2-C2.6-B2-C2A decision input: ${JSON.stringify(input)}`)
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2A_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2A_VALIDATION_TARGETS ? [`target_count_${targets}`] : [])]
  const all = PHASE2C26B2C2A_VALIDATION_TARGETS
  const caseId: Phase2C26B2C2ADecisionCase = reasons.length > 0 ? 'B2C2A_INVALID'
    : unmeasuredTasks > 0 ? 'B2C2A_INCOMPLETE'
      : exactTargets.C8 === all ? 'B2C2A_ALL_C8'
        : exactTargets.C32 === all ? 'B2C2A_ALL_C32'
          : exactTargets.C4C === all ? 'B2C2A_ALL_C4C'
            : unresolvedSafetyCapTargets > 0 ? 'B2C2A_INCOMPLETE'
              : 'B2C2A_PARTIAL'
  return { case: caseId, reasons, noExactTarget: caseId === 'B2C2A_PARTIAL' && exactTargets.C4C === 0, recommendation: PHASE2C26B2C2A_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2C2AAnalysisInput {
  targetWeaponIds: readonly string[]
  tasks: readonly Phase2C26B2C2ATaskInput[]
  runs: readonly Phase2C26B2C2ARun[]
  reach: readonly Phase2C26B2C2AReach[]
  /** B2-C1's recorded P1 first compatible rank per validation Target. */
  b2c1FirstCompatible: ReadonlyMap<string, number | null>
  oracle: Oracle
  smoke: boolean
}

/** Raw consistency, the per-context comparison, the per-Target first exact, every aggregate and every invalid reason found here. */
export function runPhase2C26B2C2AAnalysis({ targetWeaponIds, tasks, runs, reach, b2c1FirstCompatible, oracle, smoke }: Phase2C26B2C2AAnalysisInput) {
  const invalidReasons: string[] = validatePhase2C26B2C2ARaw({ tasks, runs, smoke }).map(issue => issue.startsWith('semantic_failure') ? issue : `raw: ${issue}`)
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  for (const r of reach) {
    invalidReasons.push(...r.inconsistencies.map(i => `reach: ${i}`))
    if (r.p1FirstCompatibleRank !== (b2c1FirstCompatible.get(r.targetWeaponId) ?? null)) invalidReasons.push(`authority: ${r.targetWeaponId}: recomputed P1 first compatible rank ${String(r.p1FirstCompatibleRank)} is not B2-C1's ${String(b2c1FirstCompatible.get(r.targetWeaponId))}`)
  }
  for (const run of runs) if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}: context mismatch in the Search child`)
  const contexts = tasks.map(task => phase2c26b2c2aCompareContext(runOf.get(task.taskId), task, reachOf.get(task.targetWeaponId)?.compatibleGroupIndexes.includes(task.groupIndex) ?? false, oracle))
  for (const c of contexts) invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
  const rows: Phase2C26B2C2ATargetRow[] = []
  for (const targetWeaponId of targetWeaponIds) {
    const { row, inconsistencies } = phase2c26b2c2aTargetRow(targetWeaponId, contexts.filter(c => c.targetWeaponId === targetWeaponId), b2c1FirstCompatible.get(targetWeaponId) ?? null,
      reachOf.get(targetWeaponId), phase2c26b2b2a2OracleOperationCost(oracle, targetWeaponId))
    invalidReasons.push(...inconsistencies)
    if (!smoke && row.b2c1FirstCompatibleRank !== null && !row.compatibleRanksInBudget.includes(row.b2c1FirstCompatibleRank)) invalidReasons.push(`authority: ${targetWeaponId}: the B2-C1 first compatible rank is not a compatible searched context`)
    rows.push(row)
  }
  const execution = phase2c26b2c2aExecution(tasks, runs)
  const exactTargets = Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2ACapturePolicy, number>
  const unresolvedSafetyCapTargets = rows.filter(r => r.recovery === 'none' && r.safetyCapContexts > 0).length
  const unmeasuredTasks = tasks.length - execution.completed - execution.contextMismatch
  return {
    contexts, rows, invalidReasons,
    aggregates: {
      exactTargets, budgetCoverage: phase2c26b2c2aBudgetCoverage(rows), cascade: phase2c26b2c2aCascade(rows), compatibility: phase2c26b2c2aCompatibility(contexts),
      missClasses: countBy(rows.filter(r => r.missClass !== null), r => r.missClass!), partialWithoutExact: rows.filter(r => r.partialWithoutExact).length,
      firstExactDelta: Object.fromEntries(PHASE2C26B2C2A_CAPTURE_POLICIES.map(p => [p, countByNumber(rows.flatMap(r => r.policies[p].deltaFromFirstCompatible === null ? [] : [r.policies[p].deltaFromFirstCompatible!]))])),
      execution, candidates: phase2c26b2c2aCandidates(tasks, runs),
    },
    decisionInput: { tasks: tasks.length, targets: targetWeaponIds.length, unmeasuredTasks: Math.max(0, unmeasuredTasks), exactTargets, unresolvedSafetyCapTargets },
  }
}
