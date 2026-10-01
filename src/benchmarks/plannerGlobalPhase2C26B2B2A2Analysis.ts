/**
 * Issue #154 Phase 2-C2.6-B2-B2A2 post-hoc analysis only. It reads the finished B2-B2A2 raw run and, as explicit analyzer
 * arguments AFTER the run ended, the B2-B2A RESULT (task-selection and prior-prefix authority), the B2-B1 / B2-A RESULTs
 * and the 1,657 oracle RESULT plus manifest (hash chain and the post-hoc comparison). It runs no Search, no kernel and no
 * Planner and feeds nothing back into any calculation.
 *
 * The oracle comparison is the unchanged Phase 2-C2 contract through the unchanged B2-B2A per-task comparison
 * (`phase2c26b2b2aCompare()` -> `phase2c2OracleCoverage()`), over the boundary cohort the Search child delivered (the
 * next-cost sentinel is not a cohort Candidate). Nothing here re-implements oracle matching. The ordering explanation of a
 * late exact Candidate reads only the six keys the Search comparator (`compareConstrainedCandidates()`) reads, in its order,
 * and is checked against that comparator's own recorded verdicts; it is not a ranking of its own.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C2CandidateSummary } from './plannerGlobalPhase2C2'
import { phase2c26b2b2aCompare, type Phase2C26B2B2AFinal } from './plannerGlobalPhase2C26B2B2AAnalysis'
import {
  PHASE2C26B2B2A2_COHORT_SAFETY_CAP,
  PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH,
  phase2c26b2b2a2NeedsFallback,
  type Phase2C26B2B2A2ChildRecord,
  type Phase2C26B2B2A2DeliveredCandidate,
  type Phase2C26B2B2A2ExecutionClass,
  type Phase2C26B2B2A2OrderingKeys,
  type Phase2C26B2B2A2PriorCandidate,
  type Phase2C26B2B2A2SearchRecord,
  type Phase2C26B2B2A2Selection,
  type Phase2C26B2B2A2TaskInput,
  type Phase2C26B2B2A2TaskOutcome,
} from './plannerGlobalPhase2C26B2B2A2'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compare(a, b)))
}
/** Numeric keys counted and listed in numeric order (`null` last). */
const countByNumber = (values: readonly (number | null)[]): { value: number | null; count: number }[] => {
  const map = new Map<number | null, number>()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return [...map.entries()].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a - b).map(([value, count]) => ({ value, count }))
}

// ---------------------------------------------------------------- one run as the raw record holds it

export interface Phase2C26B2B2A2Run {
  taskId: string
  executionClass: Phase2C26B2B2A2ExecutionClass
  task: Phase2C26B2B2A2TaskInput
  outcome: Phase2C26B2B2A2TaskOutcome
  process: { outcome: string; wallMs: number; timedOut: boolean; budgetMs: number }
  childWallMs: number | null
  yields: number | null
  memory: { sampledMaxHeapUsedBytes: number; sampledMaxRssBytes: number; maxRssKiB: number } | null
  lastIpcMemory: { maxHeapUsedBytes: number; maxRssBytes: number } | null
  record: Phase2C26B2B2A2ChildRecord | null
}

export interface Phase2C26B2B2A2Final {
  taskId: string
  targetWeaponId: string
  formalRun: Phase2C26B2B2A2ExecutionClass
  stage1: Phase2C26B2B2A2Run
  fallback: Phase2C26B2B2A2Run | null
  final: Phase2C26B2B2A2Run | null
  measured: boolean
  search: Phase2C26B2B2A2SearchRecord | null
}

/** The formal outcome per task: Stage 1 unless it timed out, then the one fallback run (missing fallback = unmeasured). */
export function phase2c26b2b2a2FinalOutcomes(tasks: readonly { taskId: string; targetWeaponId: string }[], stage1: readonly Phase2C26B2B2A2Run[], fallback: readonly Phase2C26B2B2A2Run[]): Phase2C26B2B2A2Final[] {
  return tasks.map(task => {
    const s1 = stage1.find(run => run.taskId === task.taskId)
    if (!s1) throw new Error(`Task ${task.taskId} has no Stage 1 run.`)
    const fb = fallback.find(run => run.taskId === task.taskId) ?? null
    const formalRun: Phase2C26B2B2A2ExecutionClass = phase2c26b2b2a2NeedsFallback(s1.outcome) ? 'timeout_fallback' : 'stage1'
    const final = formalRun === 'stage1' ? s1 : fb
    const search = final !== null && final.outcome.process === 'completed' && final.outcome.record === 'searched' && final.record?.status === 'searched' ? final.record.search : null
    return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, formalRun, stage1: s1, fallback: fb, final, measured: search !== null, search }
  })
}

// ---------------------------------------------------------------- the six comparator keys

/** The `compareConstrainedCandidates()` keys, in its order. */
export const PHASE2C26B2B2A2_ORDERING_KEYS = ['operation_cost', 'gogma_advance', 'skill_advance', 'normal_advance', 'preferred_source', 'stable_key'] as const
export type Phase2C26B2B2A2OrderingKey = typeof PHASE2C26B2B2A2_ORDERING_KEYS[number]

const nullableAscending = (left: number | null, right: number | null) => left === null ? (right === null ? 0 : 1) : right === null ? -1 : left - right

/**
 * The first of the six comparator keys on which `left` and `right` differ, and the sign there (negative: `left` first).
 * It reads the recorded keys exactly as `compareConstrainedCandidates()` reads the Candidates (a null Normal advance last,
 * the stable key by code-unit order); `equal` only for the same stable key.
 */
export function phase2c26b2b2a2FirstDecidingKey(left: { stableKey: string; orderingKeys: Phase2C26B2B2A2OrderingKeys }, right: { stableKey: string; orderingKeys: Phase2C26B2B2A2OrderingKeys }):
  { key: Phase2C26B2B2A2OrderingKey | 'equal'; sign: number } {
  const l = left.orderingKeys, r = right.orderingKeys
  const steps: [Phase2C26B2B2A2OrderingKey, number][] = [
    ['operation_cost', l.estimatedOperationCount - r.estimatedOperationCount],
    ['gogma_advance', l.estimatedGogmaAdvance - r.estimatedGogmaAdvance],
    ['skill_advance', l.estimatedSkillAdvance - r.estimatedSkillAdvance],
    ['normal_advance', nullableAscending(l.estimatedNormalAdvance, r.estimatedNormalAdvance)],
    ['preferred_source', l.preferredSourceRank - r.preferredSourceRank],
    ['stable_key', compare(left.stableKey, right.stableKey)],
  ]
  for (const [key, value] of steps) if (value !== 0) return { key, sign: Math.sign(value) }
  return { key: 'equal', sign: 0 }
}

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/** Every delivery in delivery order: the cohort, then the sentinel. */
const deliveries = (s: Phase2C26B2B2A2SearchRecord): Phase2C26B2B2A2DeliveredCandidate[] => [...s.cohort, ...(s.nextCostSentinel ? [s.nextCostSentinel] : [])]

/**
 * Internal drift of the raw record: one Stage 1 run per selection, a fallback exactly for the Stage 1 timeouts; every
 * searched record names its task's Target, fixed set, digests, boundary cost, safety cap and the default extent, excludes
 * exactly one Route key and never delivers it; deliveries are indexed 0..n-1 with unique keys; the cohort costs at most
 * the boundary and the sentinel more; delivered costs never decrease; the recorded comparator verdict against the previous
 * delivery is "earlier first" every time and agrees with the six recorded keys; and the termination agrees with the flags
 * and the counts (a sentinel or the cap is a consumer stop; a natural end is not, and never reaches the cap).
 */
export function validatePhase2C26B2B2A2Raw(input: { selections: readonly Phase2C26B2B2A2Selection[]; tasks: readonly Phase2C26B2B2A2TaskInput[]; stage1: readonly Phase2C26B2B2A2Run[];
  fallback: readonly Phase2C26B2B2A2Run[]; smoke: boolean }): string[] {
  const issues: string[] = []
  const { selections, tasks, stage1, fallback } = input
  if (!input.smoke) {
    if (tasks.length !== selections.length) issues.push(`tasks ${tasks.length} is not the ${selections.length} selections`)
    if (!same(tasks.map(t => [t.targetWeaponId, t.boundaryCost]), selections.map(s => [s.targetWeaponId, s.boundaryCost]))) issues.push('the tasks are not the selections (Target / boundary cost) in order')
    if (stage1.length !== tasks.length) issues.push('Stage 1 did not run every task once')
  }
  const taskById = new Map(tasks.map(t => [t.taskId, t]))
  if (new Set(stage1.map(r => r.taskId)).size !== stage1.length) issues.push('a task ran twice in Stage 1')
  const expectedFallback = stage1.filter(r => phase2c26b2b2a2NeedsFallback(r.outcome)).map(r => r.taskId).sort(compare)
  const ranFallback = fallback.map(r => r.taskId).sort(compare)
  if (!input.smoke && !same(ranFallback, expectedFallback)) issues.push('the fallback runs are not exactly the Stage 1 timeouts')
  if (input.smoke && ranFallback.some(id => !expectedFallback.includes(id))) issues.push('a fallback ran for a task that did not time out')
  for (const run of [...stage1, ...fallback]) {
    const task = taskById.get(run.taskId)
    if (!task) { issues.push(`${run.taskId}: not a planned task`); continue }
    if (!same({ ...run.task, executionClass: null }, { ...task, executionClass: null })) issues.push(`${run.taskId}/${run.executionClass}: the child received another task`)
    if (run.task.executionClass !== run.executionClass) issues.push(`${run.taskId}: execution class drift`)
    if (run.task.cohortSafetyCap !== PHASE2C26B2B2A2_COHORT_SAFETY_CAP) issues.push(`${run.taskId}: safety cap drift`)
    if (run.outcome.process === 'completed' && run.record === null) issues.push(`${run.taskId}/${run.executionClass}: a completed child without a record`)
    if (run.record === null || run.record.status !== 'searched') continue
    const s = run.record.search
    const at = `${run.taskId}/${run.executionClass}`
    if (s.targetWeaponId !== task.targetWeaponId || s.fixedSetId !== task.fixedSetId || s.searchInputDigest !== task.searchInputDigest || s.reservationDigest !== task.reservationDigest
      || s.cardinality !== task.cardinality) issues.push(`${at}: the record is not the task's context`)
    if (s.boundaryCost !== task.boundaryCost || s.cohortSafetyCap !== PHASE2C26B2B2A2_COHORT_SAFETY_CAP) issues.push(`${at}: boundary cost / safety cap drift`)
    if (!same(s.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push(`${at}: the extent is not the Production default`)
    if (s.excludedRouteKeys.length !== 1) issues.push(`${at}: not exactly one excluded Route key`)
    const all = deliveries(s)
    if (all.some(c => s.excludedRouteKeys.includes(c.stableKey))) issues.push(`${at}: an excluded Route was delivered`)
    if (all.length !== s.summary.deliveredCandidates) issues.push(`${at}: delivered count drift`)
    if (all.some((c, i) => c.deliveryIndex !== i)) issues.push(`${at}: delivery index drift`)
    if (new Set(all.map(c => c.stableKey)).size !== all.length) issues.push(`${at}: a Candidate was delivered twice`)
    if (all.some(c => c.summary.targetWeaponId !== task.targetWeaponId)) issues.push(`${at}: a Candidate of another Target`)
    if (all.some(c => c.summary.estimatedOperationCount !== c.orderingKeys.estimatedOperationCount) || s.costReadIssues.length > 0) issues.push(`${at}: the summary cost is not the Candidate cost`)
    if (s.cohort.some(c => c.orderingKeys.estimatedOperationCount > s.boundaryCost)) issues.push(`${at}: a cohort Candidate costs more than the boundary`)
    if (s.nextCostSentinel && s.nextCostSentinel.orderingKeys.estimatedOperationCount <= s.boundaryCost) issues.push(`${at}: the sentinel does not cost more than the boundary`)
    if (all.some((c, i) => i > 0 && c.orderingKeys.estimatedOperationCount < all[i - 1]!.orderingKeys.estimatedOperationCount)) issues.push(`${at}: boundary sequence non-monotonic (a cheaper Candidate after a dearer one)`)
    if (all.some((c, i) => (i === 0) !== (c.comparatorWithPrevious === null))) issues.push(`${at}: comparator record drift`)
    if (all.some((c, i) => i > 0 && c.comparatorWithPrevious !== -1)) issues.push(`${at}: the Search comparator does not put a delivery after its predecessor`)
    if (all.some((c, i) => i > 0 && phase2c26b2b2a2FirstDecidingKey(all[i - 1]!, c).sign !== c.comparatorWithPrevious)) issues.push(`${at}: the six recorded keys disagree with the Search comparator`)
    const f = s.summary
    const ok = s.termination === 'next_cost_sentinel' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel !== null && !s.safetyCapHit && s.cohortDrained
      && s.cohort.length < PHASE2C26B2B2A2_COHORT_SAFETY_CAP
      : s.termination === 'cohort_safety_cap' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel === null && s.safetyCapHit && !s.cohortDrained
        && s.cohort.length === PHASE2C26B2B2A2_COHORT_SAFETY_CAP
        : s.termination === 'stopped_by_extent' ? s.status === 'stopped_by_extent' && !f.stoppedByConsumer && f.stoppedByExtent && s.nextCostSentinel === null && !s.safetyCapHit && s.cohortDrained
          && s.cohort.length < PHASE2C26B2B2A2_COHORT_SAFETY_CAP
          : s.termination === 'exhausted' && s.status === 'exhausted' && !f.stoppedByConsumer && !f.stoppedByExtent && f.exhausted && s.nextCostSentinel === null && !s.safetyCapHit && s.cohortDrained
            && s.cohort.length < PHASE2C26B2B2A2_COHORT_SAFETY_CAP
    if (!ok) issues.push(`${at}: the termination disagrees with the flags / counts`)
    if (run.outcome.searchStatus !== s.status || run.outcome.termination !== s.termination || run.outcome.cohortCandidates !== s.cohort.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- prior-prefix parity (B2-B2A deliveries 0..31)

/** The compact stream form the B2-B2A RESULT records (`required` is not in it). */
const compactStream = (s: Phase2C2CandidateSummary['gogma']) => s === null ? null
  : { first: s.first, last: s.last, operations: s.operations, positions: s.positions, crossesHeldPositions: s.crossesHeldPositions, startsAfterOrigin: s.startsAfterOrigin }

export interface Phase2C26B2B2A2PrefixParity {
  targetWeaponId: string
  compared: number
  stableKeyMatches: number
  /** Field names that differ, per delivery index (empty when all 32 match). */
  mismatches: { deliveryIndex: number; fields: string[] }[]
  valid: boolean
}

/**
 * The first 32 deliveries of this run against the B2-B2A RESULT: delivery index, stable key SHA-256, Route kind, source
 * kind, operation cost, the three compact stream uses and the held-Route flag. `rawPrior` (the B2-B2A raw record, when its
 * SHA-256 is the one the RESULT names) adds the estimated advances and the whole summary. Fewer than 32 deliveries is a
 * mismatch.
 */
export function phase2c26b2b2a2PrefixParity(targetWeaponId: string, current: readonly Phase2C26B2B2A2DeliveredCandidate[], prior: readonly Phase2C26B2B2A2PriorCandidate[],
  sha: (value: string) => string, rawPrior: readonly { stableKey: string; summary: Phase2C2CandidateSummary }[] | null): Phase2C26B2B2A2PrefixParity {
  const length = PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH
  const mismatches: Phase2C26B2B2A2PrefixParity['mismatches'] = []
  let stableKeyMatches = 0
  for (let i = 0; i < length; i += 1) {
    const c = current[i], p = prior[i], raw = rawPrior?.[i]
    const fields: string[] = []
    if (!c || !p) { mismatches.push({ deliveryIndex: i, fields: ['missing'] }); continue }
    if (c.deliveryIndex !== p.deliveryIndex) fields.push('deliveryIndex')
    if (sha(c.stableKey) === p.stableKeySha256) stableKeyMatches += 1
    else fields.push('stableKeySha256')
    if (c.summary.routeKind !== p.routeKind) fields.push('routeKind')
    if (c.summary.sourceKind !== p.sourceKind) fields.push('sourceKind')
    if (c.summary.estimatedOperationCount !== p.estimatedOperationCount) fields.push('estimatedOperationCount')
    for (const stream of ['normal', 'gogma', 'skill'] as const) if (!same(compactStream(c.summary[stream]), p[stream])) fields.push(`stream:${stream}`)
    if (c.summary.heldRoute !== p.heldRoute) fields.push('heldRoute')
    if (rawPrior !== null) {
      if (!raw) fields.push('raw:missing')
      else {
        if (raw.stableKey !== c.stableKey) fields.push('raw:stableKey')
        if (!same(raw.summary.estimatedAdvances, c.summary.estimatedAdvances)) fields.push('raw:estimatedAdvances')
        if (!same(raw.summary, c.summary)) fields.push('raw:summary')
      }
    }
    if (fields.length > 0) mismatches.push({ deliveryIndex: i, fields })
  }
  return { targetWeaponId, compared: length, stableKeyMatches, mismatches, valid: mismatches.length === 0 && stableKeyMatches === length }
}

// ---------------------------------------------------------------- oracle comparison and the cohort class

export type Phase2C26B2B2A2CohortClass = 'late_exact_in_boundary_cohort' | 'partial_in_boundary_cohort' | 'boundary_cohort_drained_without_match' | 'safety_cap_unresolved' | 'not_comparable' | 'unmeasured'
export const PHASE2C26B2B2A2_COHORT_CLASSES: readonly Phase2C26B2B2A2CohortClass[] = ['late_exact_in_boundary_cohort', 'partial_in_boundary_cohort', 'boundary_cohort_drained_without_match',
  'safety_cap_unresolved', 'not_comparable', 'unmeasured']

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

/** The oracle Route's own operation count (`materialization.estimated.operations`), or null when it does not hold one. */
export function phase2c26b2b2a2OracleOperationCost(oracle: Oracle, targetWeaponId: string): number | null {
  const route = oracle.routes.find(r => typeof r === 'object' && r !== null && (r as { targetWeaponId?: unknown }).targetWeaponId === targetWeaponId) as
    { materialization?: { estimated?: { operations?: unknown } } } | undefined
  const value = route?.materialization?.estimated?.operations
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** One predecessor's first deciding key against the exact Candidate, in the registered labels. */
export const PHASE2C26B2B2A2_PRECEDENCE_LABELS: Record<Phase2C26B2B2A2OrderingKey, string> = {
  operation_cost: 'lower_operation_cost',
  gogma_advance: 'same_cost_lower_gogma_advance',
  skill_advance: 'same_gogma_lower_skill_advance',
  normal_advance: 'same_skill_lower_normal_advance',
  preferred_source: 'same_stream_advances_preferred_source',
  stable_key: 'stable_key_tie_break',
}

export interface Phase2C26B2B2A2OrderingExplanation {
  exactDeliveryIndex: number
  exactOrderingKeys: Phase2C26B2B2A2OrderingKeys
  predecessors: number
  /** Predecessors counted by the first comparator key that put them first. */
  precededBy: Record<string, number>
  /** Predecessors of the same operation cost, by their Gogma advance relative to the exact Candidate. */
  sameCostPredecessorGogmaAdvance: { lower: number; equal: number }
  /** A predecessor the six keys would put after the exact Candidate (never expected). */
  inconsistencies: number[]
}

/** Why each Candidate before the exact one was delivered first, in `compareConstrainedCandidates()` key order. */
export function phase2c26b2b2a2OrderingExplanation(cohort: readonly Phase2C26B2B2A2DeliveredCandidate[], exactIndex: number): Phase2C26B2B2A2OrderingExplanation {
  const exact = cohort[exactIndex]
  if (!exact) throw new Error(`No cohort Candidate at ${exactIndex}.`)
  const precededBy: Record<string, number> = Object.fromEntries(Object.values(PHASE2C26B2B2A2_PRECEDENCE_LABELS).map(label => [label, 0]))
  const inconsistencies: number[] = []
  let lower = 0, equal = 0
  for (const predecessor of cohort.slice(0, exactIndex)) {
    const decided = phase2c26b2b2a2FirstDecidingKey(predecessor, exact)
    if (decided.key === 'equal' || decided.sign !== -1) { inconsistencies.push(predecessor.deliveryIndex); continue }
    precededBy[PHASE2C26B2B2A2_PRECEDENCE_LABELS[decided.key]]! += 1
    if (predecessor.orderingKeys.estimatedOperationCount === exact.orderingKeys.estimatedOperationCount) {
      if (predecessor.orderingKeys.estimatedGogmaAdvance < exact.orderingKeys.estimatedGogmaAdvance) lower += 1
      else if (predecessor.orderingKeys.estimatedGogmaAdvance === exact.orderingKeys.estimatedGogmaAdvance) equal += 1
    }
  }
  return { exactDeliveryIndex: exactIndex, exactOrderingKeys: { ...exact.orderingKeys }, predecessors: exactIndex, precededBy, sameCostPredecessorGogmaAdvance: { lower, equal }, inconsistencies }
}

export interface Phase2C26B2B2A2TargetComparison {
  targetWeaponId: string
  boundaryCost: number
  oracleOperationCost: number | null
  coverage: string | null
  matchedStableKey: string | null
  matchedDeliveryIndex: number | null
  exactDeliveryIndexes: number[]
  partialDeliveryIndexes: number[]
  firstExactIndex: number | null
  firstPartialIndex: number | null
  /** The first exact (else partial) index lies at or beyond B2-B2A's capture (index 32). */
  beyondPriorCapture: boolean | null
  closestDifferences: string[]
  undetermined: string[]
  oracleHeldRoute: boolean | null
  cohortClass: Phase2C26B2B2A2CohortClass
  orderingExplanation: Phase2C26B2B2A2OrderingExplanation | null
  inconsistencies: string[]
}

/**
 * The class of one task. Only a measured drain is compared; the comparison is the unchanged B2-B2A per-task comparison over
 * the boundary cohort (the sentinel excluded). An exact match is a late exact in the boundary cohort only at index 32 or
 * later with the boundary cost (anything else contradicts the B2-B2A prefix or the oracle cost and is an inconsistency);
 * a miss is drained (sentinel / natural end) or unresolved (safety cap).
 */
export function phase2c26b2b2a2Compare(final: Phase2C26B2B2A2Final, boundaryCost: number, oracle: Oracle): Phase2C26B2B2A2TargetComparison {
  const oracleOperationCost = phase2c26b2b2a2OracleOperationCost(oracle, final.targetWeaponId)
  const base = { targetWeaponId: final.targetWeaponId, boundaryCost, oracleOperationCost, coverage: null, matchedStableKey: null, matchedDeliveryIndex: null, exactDeliveryIndexes: [],
    partialDeliveryIndexes: [], firstExactIndex: null, firstPartialIndex: null, beyondPriorCapture: null, closestDifferences: [], undetermined: [], oracleHeldRoute: null,
    orderingExplanation: null }
  const inconsistencies: string[] = []
  if (oracleOperationCost !== boundaryCost) inconsistencies.push(`${final.targetWeaponId}: the oracle operation cost ${String(oracleOperationCost)} is not the boundary cost ${boundaryCost}`)
  if (!final.measured || final.search === null) return { ...base, cohortClass: 'unmeasured', inconsistencies }
  const search = final.search
  // The unchanged B2-B2A comparison, over the cohort as one measured Search (its own status-based class is not used).
  const asB2B2A = { taskId: final.taskId, targetWeaponId: final.targetWeaponId, formalRun: final.formalRun, stage1: null, fallback: null, final: null, measured: true,
    search: { status: search.status, candidates: search.cohort } } as unknown as Phase2C26B2B2AFinal
  const c = phase2c26b2b2aCompare(asB2B2A, oracle)
  inconsistencies.push(...c.inconsistencies)
  const firstExactIndex = c.exactDeliveryIndexes[0] ?? null
  const firstPartialIndex = c.partialDeliveryIndexes[0] ?? null
  const first = firstExactIndex ?? firstPartialIndex
  let cohortClass: Phase2C26B2B2A2CohortClass
  if (c.coverage === 'not_comparable') cohortClass = 'not_comparable'
  else if (firstExactIndex !== null) {
    cohortClass = 'late_exact_in_boundary_cohort'
    if (firstExactIndex < PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH) inconsistencies.push(`${final.targetWeaponId}: exact at ${firstExactIndex}, inside the B2-B2A prefix that had none`)
    if (search.cohort[firstExactIndex]!.orderingKeys.estimatedOperationCount !== boundaryCost) inconsistencies.push(`${final.targetWeaponId}: the exact Candidate does not cost the boundary cost`)
  } else if (firstPartialIndex !== null) {
    cohortClass = 'partial_in_boundary_cohort'
    if (firstPartialIndex < PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH) inconsistencies.push(`${final.targetWeaponId}: partial at ${firstPartialIndex}, inside the B2-B2A prefix that had none`)
  } else cohortClass = search.cohortDrained ? 'boundary_cohort_drained_without_match' : 'safety_cap_unresolved'
  const orderingExplanation = firstExactIndex === null ? null : phase2c26b2b2a2OrderingExplanation(search.cohort, firstExactIndex)
  if (orderingExplanation && orderingExplanation.inconsistencies.length > 0) inconsistencies.push(`${final.targetWeaponId}: a predecessor the six keys put after the exact Candidate`)
  return { ...base, coverage: c.coverage, matchedStableKey: c.matchedStableKey, matchedDeliveryIndex: c.matchedDeliveryIndex, exactDeliveryIndexes: c.exactDeliveryIndexes,
    partialDeliveryIndexes: c.partialDeliveryIndexes, firstExactIndex, firstPartialIndex, beyondPriorCapture: first === null ? null : first >= PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH,
    closestDifferences: c.closestDifferences, undetermined: c.undetermined, oracleHeldRoute: c.oracleHeldRoute, cohortClass, orderingExplanation, inconsistencies }
}

// ---------------------------------------------------------------- cohort description

const lateStart = (summary: Phase2C2CandidateSummary) => Boolean(summary.gogma?.startsAfterOrigin || summary.skill?.startsAfterOrigin || summary.normal?.startsAfterOrigin)

/** The distributions of a set of deliveries (no oracle). */
export function phase2c26b2b2a2Distribution(candidates: readonly Phase2C26B2B2A2DeliveredCandidate[]) {
  return {
    candidates: candidates.length,
    routeKind: countBy(candidates, c => c.summary.routeKind),
    sourceKind: countBy(candidates, c => c.summary.sourceKind),
    estimatedGogmaAdvance: countByNumber(candidates.map(c => c.orderingKeys.estimatedGogmaAdvance)),
    estimatedSkillAdvance: countByNumber(candidates.map(c => c.orderingKeys.estimatedSkillAdvance)),
    estimatedNormalAdvance: countByNumber(candidates.map(c => c.orderingKeys.estimatedNormalAdvance)),
    preferredSourceRank: countByNumber(candidates.map(c => c.orderingKeys.preferredSourceRank)),
    heldRoute: candidates.filter(c => c.summary.heldRoute).length,
    lateStart: { any: candidates.filter(c => lateStart(c.summary)).length, gogma: candidates.filter(c => c.summary.gogma?.startsAfterOrigin).length,
      skill: candidates.filter(c => c.summary.skill?.startsAfterOrigin).length, normal: candidates.filter(c => c.summary.normal?.startsAfterOrigin).length },
    reservationViolations: candidates.filter(c => !c.reservationCheck.respects).length,
  }
}

/** The boundary cohort of one measured drain: every delivery costing exactly the boundary cost, plus the cohort counts. */
export function phase2c26b2b2a2Cohort(search: Phase2C26B2B2A2SearchRecord) {
  const boundary = search.cohort.filter(c => c.orderingKeys.estimatedOperationCount === search.boundaryCost)
  return {
    boundaryCost: search.boundaryCost,
    deliveredUpToBoundary: search.cohort.length,
    cohortCandidateCount: boundary.length,
    belowBoundary: search.cohort.length - boundary.length,
    firstBoundaryIndex: boundary[0]?.deliveryIndex ?? null,
    lastBoundaryIndex: boundary.at(-1)?.deliveryIndex ?? null,
    nextCostSentinel: search.nextCostSentinel === null ? null : { deliveryIndex: search.nextCostSentinel.deliveryIndex, estimatedOperationCount: search.nextCostSentinel.orderingKeys.estimatedOperationCount },
    termination: search.termination,
    status: search.status,
    cohortDrained: search.cohortDrained,
    safetyCapHit: search.safetyCapHit,
    boundaryCohort: phase2c26b2b2a2Distribution(boundary),
  }
}

// ---------------------------------------------------------------- decision (registered before the formal run)

export type Phase2C26B2B2A2DecisionCase = 'B2B2A2_ALL_LATE_EXACT' | 'B2B2A2_PARTIAL_LATE_EXACT' | 'B2B2A2_NO_MATCH_AFTER_DRAIN' | 'B2B2A2_INCOMPLETE' | 'B2B2A2_INVALID'

export const PHASE2C26B2B2A2_DECISION_RULE = {
  order: [
    'B2B2A2_INVALID: a B2-B2A authority mismatch, a hash-chain mismatch (B2-B1 / B2-A / oracle / manifest / Export against the B2-B2A record), a task count other than 2, a selected row that is not capture_or_ordering_unresolved (consumer stop at 32, uncovered, no exact / partial index), a context reconstruction mismatch (against the B2-B1 representative or the B2-B2A row), a context mismatch inside a Search child, a first-32 prefix mismatch, a default-extent mismatch, a non-monotonic delivery cost sequence or a comparator disagreement, an oracle operation cost other than the boundary cost, a delivered Candidate (sentinel included) violating its reservation, a provenance failure, or a raw / result inconsistency',
    'B2B2A2_ALL_LATE_EXACT: 2 / 2 measured and 2 / 2 exact (late_exact_in_boundary_cohort)',
    'B2B2A2_PARTIAL_LATE_EXACT: 2 / 2 measured, exactly 1 exact, the other drained (any match level) or safety_cap_unresolved',
    'B2B2A2_NO_MATCH_AFTER_DRAIN: 2 / 2 measured, 0 exact, 2 / 2 cohortDrained',
    'B2B2A2_INCOMPLETE: no invalid reason and none of the above (a safety-cap stop without an exact on a 0-exact run, or a task unmeasured after the timeout fallback)',
  ],
  boundary: 'boundaryCost = B2-B2A search.candidates[31].summary.estimatedOperationCount, per task; continue while cost <= boundaryCost, stop at the first cost > boundaryCost (the next-cost sentinel, not a cohort Candidate)',
  drained: 'cohortDrained = sentinel delivered OR the Search ended naturally (exhausted / stopped by extent); a safety-cap stop (8192 Candidates <= boundaryCost) is never drained',
  exact: 'phase2c2OracleCoverage().coverage === "exact" over the cohort only; partial_comparable is recorded separately and never counted as exact; an oracle match never stops the Search',
  unmeasured: 'timeout / out of memory / process failure after the fallback; never Candidate 0',
  selection: 'oracle-guided diagnostic selection (B2-B2A post-hoc deliveryClass); the Search runner never reads the oracle',
} as const

export const PHASE2C26B2B2A2_RECOMMENDATION: Record<Phase2C26B2B2A2DecisionCase, string> = {
  B2B2A2_ALL_LATE_EXACT: '2件ともcurrent Searchのboundary cost cohort内でoracle Routeがpublishされる（B2-B2Aのmissはcapture 32 / tie orderingで説明できる）。次はoracle非依存context schedulerとProductionで必要なCandidate capture policyの研究、その後extent不足19件へ。capture boundを直ちに増やす結論ではない',
  B2B2A2_PARTIAL_LATE_EXACT: 'exactになった1件と未解決1件を分離し、残1件のpublication gap（Route base generation / Ideal publication / composition / materialization / compatibility監査）を研究する',
  B2B2A2_NO_MATCH_AFTER_DRAIN: 'capture不足ではない。boundary cost cohortを最後までdrainしてもoracle Routeがpublishされないため、Search composition / publication semanticsの調査を先に行う（即Search bugとは断定しない）',
  B2B2A2_INCOMPLETE: 'cohortのdrainを確定しない。safety cap / runtime条件を再設計してから再測定する',
  B2B2A2_INVALID: '次へ進まず原因調査',
}

export function phase2c26b2b2a2Decision(input: { invalidReasons: readonly string[]; tasks: number; measured: number; exact: number; drained: number }) {
  const { tasks, measured, exact, drained } = input
  if (![tasks, measured, exact, drained].every(v => Number.isInteger(v) && v >= 0) || measured > tasks || exact > measured || drained > measured) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-B2A2 decision input: ${JSON.stringify(input)}`)
  }
  const expected = 2
  const reasons = [...input.invalidReasons, ...(tasks !== expected ? [`task_count_${tasks}`] : [])]
  const caseId: Phase2C26B2B2A2DecisionCase = reasons.length > 0 ? 'B2B2A2_INVALID'
    : measured === tasks && exact === tasks ? 'B2B2A2_ALL_LATE_EXACT'
      : measured === tasks && exact === 1 ? 'B2B2A2_PARTIAL_LATE_EXACT'
        : measured === tasks && exact === 0 && drained === tasks ? 'B2B2A2_NO_MATCH_AFTER_DRAIN'
          : 'B2B2A2_INCOMPLETE'
  return { case: caseId, reasons, recommendation: PHASE2C26B2B2A2_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- execution

export function phase2c26b2b2a2Execution(finals: readonly Phase2C26B2B2A2Final[], stage1: readonly Phase2C26B2B2A2Run[], fallback: readonly Phase2C26B2B2A2Run[]) {
  const tally = (runs: readonly Phase2C26B2B2A2Run[]) => ({
    runs: runs.length,
    completed: runs.filter(r => r.outcome.process === 'completed' && r.outcome.record === 'searched').length,
    contextMismatch: runs.filter(r => r.outcome.record === 'context_mismatch').length,
    timeout: runs.filter(r => r.outcome.process === 'timeout').length,
    outOfMemory: runs.filter(r => r.outcome.process === 'out_of_memory').length,
    processFailure: runs.filter(r => r.outcome.process === 'process_failure').length,
  })
  const peak = (r: Phase2C26B2B2A2Run) => ({ heap: Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0),
    rss: Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0) })
  return {
    stage1: tally(stage1),
    fallback: { attempted: fallback.length, ...tally(fallback) },
    final: { measured: finals.filter(f => f.measured).length, unmeasured: finals.filter(f => !f.measured).length, byFormalRun: countBy(finals, f => f.formalRun) },
    perTask: finals.map(f => ({ taskId: f.taskId, targetWeaponId: f.targetWeaponId, formalRun: f.formalRun, searchElapsedMs: f.search?.elapsedMs ?? null,
      processWallMs: f.final?.process.wallMs ?? null, yields: f.final?.yields ?? null, peakHeapBytes: f.final ? peak(f.final).heap : null, peakRssBytes: f.final ? peak(f.final).rss : null })),
  }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2B2A2Row {
  targetWeaponId: string
  selection: Phase2C26B2B2A2Selection
  final: Phase2C26B2B2A2Final
  prefixParity: Phase2C26B2B2A2PrefixParity | null
  comparison: Phase2C26B2B2A2TargetComparison
  cohort: ReturnType<typeof phase2c26b2b2a2Cohort> | null
}

export interface Phase2C26B2B2A2AnalysisInput {
  selections: readonly Phase2C26B2B2A2Selection[]
  tasks: readonly Phase2C26B2B2A2TaskInput[]
  stage1: readonly Phase2C26B2B2A2Run[]
  fallback: readonly Phase2C26B2B2A2Run[]
  oracle: Oracle
  sha: (value: string) => string
  /** The B2-B2A raw first-32 deliveries per Target (when the raw file was supplied and verified), else null. */
  rawPriorByTarget: ReadonlyMap<string, readonly { stableKey: string; summary: Phase2C2CandidateSummary }[]> | null
  smoke: boolean
}

/** Raw consistency, final outcomes, prefix parity, the oracle comparison per task, the cohort descriptions and every invalid reason found here. */
export function runPhase2C26B2B2A2Analysis({ selections, tasks, stage1, fallback, oracle, sha, rawPriorByTarget, smoke }: Phase2C26B2B2A2AnalysisInput) {
  const invalidReasons: string[] = validatePhase2C26B2B2A2Raw({ selections, tasks, stage1, fallback, smoke }).map(issue => `raw: ${issue}`)
  const ranTasks = tasks.filter(task => stage1.some(run => run.taskId === task.taskId))
  const finals = phase2c26b2b2a2FinalOutcomes(ranTasks, stage1, fallback)
  const selectionOf = new Map(selections.map(s => [s.targetWeaponId, s]))
  const rows: Phase2C26B2B2A2Row[] = finals.map(final => {
    const selection = selectionOf.get(final.targetWeaponId)
    if (!selection) throw new Error(`Task ${final.taskId} is not a selection.`)
    const prefixParity = final.search === null ? null
      : phase2c26b2b2a2PrefixParity(final.targetWeaponId, final.search.cohort, selection.priorPrefix, sha, rawPriorByTarget?.get(final.targetWeaponId) ?? null)
    if (prefixParity && !prefixParity.valid) invalidReasons.push(`prefix: ${final.targetWeaponId}: the first ${PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH} deliveries differ from B2-B2A (${prefixParity.mismatches.length} indexes)`)
    if (rawPriorByTarget !== null && !rawPriorByTarget.has(final.targetWeaponId)) invalidReasons.push(`prefix: ${final.targetWeaponId}: the B2-B2A raw record holds no prefix for this Target`)
    const comparison = phase2c26b2b2a2Compare(final, selection.boundaryCost, oracle)
    invalidReasons.push(...comparison.inconsistencies.map(i => `comparison: ${i}`))
    return { targetWeaponId: final.targetWeaponId, selection, final, prefixParity, comparison, cohort: final.search === null ? null : phase2c26b2b2a2Cohort(final.search) }
  })
  for (const run of [...stage1, ...fallback]) {
    if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}/${run.executionClass}: context mismatch in the Search child`)
    if (run.record?.status === 'searched') {
      const violations = deliveries(run.record.search).filter(c => !c.reservationCheck.respects)
      if (violations.length > 0) invalidReasons.push(`semantic_failure: ${run.taskId}/${run.executionClass}: ${violations.length} delivered Candidate(s) violate the reservation`)
    }
  }
  const by = (cls: Phase2C26B2B2A2CohortClass) => rows.filter(row => row.comparison.cohortClass === cls).length
  const aggregates = {
    tasks: rows.length,
    measured: rows.filter(row => row.final.measured).length,
    classes: Object.fromEntries(PHASE2C26B2B2A2_COHORT_CLASSES.map(cls => [cls, by(cls)])),
    exact: by('late_exact_in_boundary_cohort'),
    drained: rows.filter(row => row.final.search?.cohortDrained === true).length,
    safetyCapHit: rows.filter(row => row.final.search?.safetyCapHit === true).length,
    prefixParityValid: rows.filter(row => row.prefixParity?.valid === true).length,
    reservationViolations: rows.reduce((sum, row) => sum + (row.final.search ? deliveries(row.final.search).filter(c => !c.reservationCheck.respects).length : 0), 0),
    execution: phase2c26b2b2a2Execution(finals, stage1, fallback),
  }
  return { rows, finals, aggregates, invalidReasons,
    decisionInput: { tasks: rows.length, measured: aggregates.measured, exact: aggregates.exact, drained: aggregates.drained } }
}
