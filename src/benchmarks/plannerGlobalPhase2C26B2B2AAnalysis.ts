/**
 * Issue #154 Phase 2-C2.6-B2-B2A post-hoc analysis only. It reads the finished B2-B2A raw run and, as explicit analyzer
 * arguments AFTER the run ended, the B2-B1 RESULT (task-selection authority), the B2-A RESULT and the 1,657 oracle RESULT
 * plus manifest (hash chain and the post-hoc comparison). It runs no Search, no kernel and no Planner and feeds nothing
 * back into any calculation.
 *
 * The oracle comparison is the unchanged Phase 2-C2 contract (`phase2c2OracleCoverage()` over the Phase 2-C2 Candidate
 * summaries the Search child recorded); nothing here re-implements oracle matching or fills a missing oracle field in.
 * A Candidate set this analysis reads is exactly what one Search context delivered before its consumer stop (capture
 * bound 32), its extent stop or its exhaustion; a timeout / out-of-memory / process failure is unmeasured, never
 * "Candidate 0".
 *
 * This measures Search delivery under known-compatible representative contexts only. The contexts were selected by
 * B2-B1's post-hoc oracle compatibility, so no result here shows that Production can choose them without the oracle.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C2CandidateSummary, Phase2C2SearchStatus } from './plannerGlobalPhase2C2'
import { phase2c2OracleCoverage } from './plannerGlobalPhase2C2Analysis'
import {
  PHASE2C26B2B2A_CAPTURE_BOUND,
  PHASE2C26B2B2A_REGISTERED_B2B1,
  phase2c26b2b2aNeedsFallback,
  type Phase2C26B2B2AChildRecord,
  type Phase2C26B2B2AExecutionClass,
  type Phase2C26B2B2APopulation,
  type Phase2C26B2B2ASearchRecord,
  type Phase2C26B2B2ASelection,
  type Phase2C26B2B2ATaskInput,
  type Phase2C26B2B2ATaskOutcome,
} from './plannerGlobalPhase2C26B2B2A'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compare(a, b)))
}

// ---------------------------------------------------------------- one run as the raw record holds it

/** One child process of the raw record (Stage 1 or the timeout fallback), as the runner wrote it. */
export interface Phase2C26B2B2ARun {
  taskId: string
  executionClass: Phase2C26B2B2AExecutionClass
  task: Phase2C26B2B2ATaskInput
  outcome: Phase2C26B2B2ATaskOutcome
  process: { outcome: string; wallMs: number; timedOut: boolean; budgetMs: number }
  childWallMs: number | null
  yields: number | null
  /** Sampled maxima (250 ms) plus the child's own maxRSS; null when the child wrote no record (timeout / OOM / failure). */
  memory: { sampledMaxHeapUsedBytes: number; sampledMaxRssBytes: number; maxRssKiB: number } | null
  /** The last IPC memory sample of the process (also kept for a killed child). */
  lastIpcMemory: { maxHeapUsedBytes: number; maxRssBytes: number } | null
  record: Phase2C26B2B2AChildRecord | null
}

export interface Phase2C26B2B2AFinal {
  taskId: string
  targetWeaponId: string
  /** Which run is the formal outcome: the fallback of a Stage 1 timeout, otherwise Stage 1. */
  formalRun: Phase2C26B2B2AExecutionClass
  stage1: Phase2C26B2B2ARun
  fallback: Phase2C26B2B2ARun | null
  final: Phase2C26B2B2ARun | null
  measured: boolean
  search: Phase2C26B2B2ASearchRecord | null
}

/**
 * The formal outcome per task: the Stage 1 run unless it timed out, then the one fallback run of the same task (missing
 * fallback = unmeasured). Stage 1 evidence of a timed-out task is kept.
 */
export function phase2c26b2b2aFinalOutcomes(tasks: readonly { taskId: string; targetWeaponId: string }[], stage1: readonly Phase2C26B2B2ARun[], fallback: readonly Phase2C26B2B2ARun[]): Phase2C26B2B2AFinal[] {
  return tasks.map(task => {
    const s1 = stage1.find(run => run.taskId === task.taskId)
    if (!s1) throw new Error(`Task ${task.taskId} has no Stage 1 run.`)
    const fb = fallback.find(run => run.taskId === task.taskId) ?? null
    const formalRun: Phase2C26B2B2AExecutionClass = phase2c26b2b2aNeedsFallback(s1.outcome) ? 'timeout_fallback' : 'stage1'
    const final = formalRun === 'stage1' ? s1 : fb
    const measured = final !== null && final.outcome.process === 'completed' && final.outcome.record === 'searched' && final.record?.status === 'searched'
    return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, formalRun, stage1: s1, fallback: fb, final, measured,
      search: measured && final!.record!.status === 'searched' ? final!.record!.search : null }
  })
}

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * Internal drift of the raw record: one Stage 1 run per selection; a fallback exactly for the Stage 1 timeouts (one each,
 * the same task); every searched record names its task's Target, fixed set, digests, capture bound and the default extent,
 * excludes exactly one Route key and never delivers it; deliveries are indexed 0..n-1 with unique keys; and the stop
 * flags agree with the count (a consumer stop is exactly 32 deliveries; an extent stop or exhaustion is fewer).
 */
export function validatePhase2C26B2B2ARaw(input: { selections: readonly Phase2C26B2B2ASelection[]; tasks: readonly Phase2C26B2B2ATaskInput[]; stage1: readonly Phase2C26B2B2ARun[]; fallback: readonly Phase2C26B2B2ARun[]; smoke: boolean }): string[] {
  const issues: string[] = []
  const { selections, tasks, stage1, fallback } = input
  if (!input.smoke) {
    if (tasks.length !== selections.length) issues.push(`tasks ${tasks.length} is not the ${selections.length} selections`)
    if (!same(tasks.map(t => t.targetWeaponId), selections.map(s => s.targetWeaponId))) issues.push('the tasks are not the selections in order')
    if (stage1.length !== tasks.length) issues.push('Stage 1 did not run every task once')
  }
  const taskById = new Map(tasks.map(t => [t.taskId, t]))
  if (new Set(stage1.map(r => r.taskId)).size !== stage1.length) issues.push('a task ran twice in Stage 1')
  const expectedFallback = stage1.filter(r => phase2c26b2b2aNeedsFallback(r.outcome)).map(r => r.taskId).sort(compare)
  const ranFallback = fallback.map(r => r.taskId).sort(compare)
  if (!input.smoke && !same(ranFallback, expectedFallback)) issues.push('the fallback runs are not exactly the Stage 1 timeouts')
  if (input.smoke && ranFallback.some(id => !expectedFallback.includes(id))) issues.push('a fallback ran for a task that did not time out')
  for (const run of [...stage1, ...fallback]) {
    const task = taskById.get(run.taskId)
    if (!task) { issues.push(`${run.taskId}: not a planned task`); continue }
    // The fallback child receives the identical task; only its execution class differs.
    if (!same({ ...run.task, executionClass: null }, { ...task, executionClass: null })) issues.push(`${run.taskId}/${run.executionClass}: the child received another task`)
    if (run.task.executionClass !== run.executionClass) issues.push(`${run.taskId}: execution class drift`)
    if (run.outcome.process === 'completed' && run.record === null) issues.push(`${run.taskId}/${run.executionClass}: a completed child without a record`)
    if (run.record === null || run.record.status !== 'searched') continue
    const s = run.record.search
    const at = `${run.taskId}/${run.executionClass}`
    if (s.targetWeaponId !== task.targetWeaponId || s.fixedSetId !== task.fixedSetId || s.searchInputDigest !== task.searchInputDigest || s.reservationDigest !== task.reservationDigest
      || s.cardinality !== task.cardinality) issues.push(`${at}: the record is not the task's context`)
    if (s.captureBound !== PHASE2C26B2B2A_CAPTURE_BOUND || task.captureBound !== PHASE2C26B2B2A_CAPTURE_BOUND) issues.push(`${at}: capture bound drift`)
    if (!same(s.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push(`${at}: the extent is not the Production default`)
    if (s.excludedRouteKeys.length !== 1) issues.push(`${at}: not exactly one excluded Route key`)
    if (s.candidates.some(c => s.excludedRouteKeys.includes(c.stableKey))) issues.push(`${at}: an excluded Route was delivered`)
    if (s.candidates.length !== s.summary.deliveredCandidates) issues.push(`${at}: delivered count drift`)
    if (s.candidates.some((c, i) => c.deliveryIndex !== i)) issues.push(`${at}: delivery index drift`)
    if (new Set(s.candidates.map(c => c.stableKey)).size !== s.candidates.length) issues.push(`${at}: a Candidate was delivered twice`)
    if (s.candidates.some(c => c.summary.targetWeaponId !== task.targetWeaponId)) issues.push(`${at}: a Candidate of another Target`)
    const flags = s.summary
    const statusOk = s.status === 'consumer_stop' ? flags.stoppedByConsumer && s.candidates.length === PHASE2C26B2B2A_CAPTURE_BOUND
      : s.status === 'stopped_by_extent' ? !flags.stoppedByConsumer && flags.stoppedByExtent && s.candidates.length < PHASE2C26B2B2A_CAPTURE_BOUND
        : !flags.stoppedByConsumer && !flags.stoppedByExtent && flags.exhausted && s.candidates.length < PHASE2C26B2B2A_CAPTURE_BOUND
    if (!statusOk) issues.push(`${at}: the stop status disagrees with the flags / count`)
    if (run.outcome.searchStatus !== s.status || run.outcome.delivered !== s.candidates.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- oracle comparison (the unchanged Phase 2-C2 contract)

export type Phase2C26B2B2ADeliveryClass = 'exact' | 'partial' | 'capture_or_ordering_unresolved' | 'completed_without_oracle_match' | 'not_comparable' | 'unmeasured'
export const PHASE2C26B2B2A_DELIVERY_CLASSES: readonly Phase2C26B2B2ADeliveryClass[] = ['exact', 'partial', 'capture_or_ordering_unresolved', 'completed_without_oracle_match', 'not_comparable', 'unmeasured']

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }
type Coverage = ReturnType<typeof phase2c2OracleCoverage>['targets'][number]

/** A one-Target portfolio of delivered Candidates in the Phase 2-C2 shape (every one a Search alternative at the default extent). */
function portfolioOf(targetWeaponId: string, candidates: readonly { stableKey: string; summary: Phase2C2CandidateSummary }[]) {
  return [{ targetWeaponId, candidates: candidates.map(c => ({ stableKey: c.stableKey, origin: 'alternative' as const, summary: c.summary, provenance: [{ extentLabel: 'default' }], kernelFound: false })) }]
}

export interface Phase2C26B2B2ATargetComparison {
  targetWeaponId: string
  /** The Phase 2-C2 coverage of the oracle Route by this context's delivered Candidates. */
  coverage: Coverage['coverage'] | null
  /** `phase2c2OracleCoverage()`'s matched key (exact preferred, earliest delivered at that level). */
  matchedStableKey: string | null
  matchedDeliveryIndex: number | null
  /** Every delivery index whose Candidate alone covers the oracle Route exactly / partially (the same contract per Candidate). */
  exactDeliveryIndexes: number[]
  partialDeliveryIndexes: number[]
  closestDifferences: string[]
  undetermined: string[]
  missingOracleFields: string[]
  oracleHeldRoute: boolean | null
  deliveryClass: Phase2C26B2B2ADeliveryClass
  inconsistencies: string[]
}

/**
 * The delivery class of one task. Only a measured Search is compared; the comparison is `phase2c2OracleCoverage()`. A miss
 * is split by how the Search ended: a consumer stop at the capture bound leaves the oracle Route possibly beyond the
 * capture (`capture_or_ordering_unresolved`), an extent stop / exhaustion means the Search finished without publishing
 * it (`completed_without_oracle_match`).
 */
export function phase2c26b2b2aCompare(final: Phase2C26B2B2AFinal, oracle: Oracle): Phase2C26B2B2ATargetComparison {
  const base = { targetWeaponId: final.targetWeaponId, coverage: null, matchedStableKey: null, matchedDeliveryIndex: null, exactDeliveryIndexes: [], partialDeliveryIndexes: [],
    closestDifferences: [], undetermined: [], missingOracleFields: [], oracleHeldRoute: null, inconsistencies: [] as string[] }
  if (!final.measured || final.search === null) return { ...base, deliveryClass: 'unmeasured' }
  const search = final.search
  const pick = (coverage: ReturnType<typeof phase2c2OracleCoverage>) => coverage.targets.find(row => row.targetWeaponId === final.targetWeaponId)
  const row = pick(phase2c2OracleCoverage(portfolioOf(final.targetWeaponId, search.candidates), oracle))
  if (!row) return { ...base, deliveryClass: 'not_comparable', inconsistencies: [`${final.targetWeaponId}: no oracle Route for this Target`] }
  const perCandidate = search.candidates.map(c => pick(phase2c2OracleCoverage(portfolioOf(final.targetWeaponId, [c]), oracle))!.coverage)
  const exactDeliveryIndexes = perCandidate.flatMap((level, i) => level === 'exact' ? [i] : [])
  const partialDeliveryIndexes = perCandidate.flatMap((level, i) => level === 'partial_comparable' ? [i] : [])
  const matchedDeliveryIndex = row.matchedStableKey === null ? null : search.candidates.findIndex(c => c.stableKey === row.matchedStableKey)
  const inconsistencies: string[] = []
  // The whole-portfolio verdict must be the best single-Candidate verdict, matched at its earliest index.
  const expectedIndex = row.coverage === 'exact' ? exactDeliveryIndexes[0] : row.coverage === 'partial_comparable' ? partialDeliveryIndexes[0] : undefined
  if ((row.coverage === 'exact' || row.coverage === 'partial_comparable') && matchedDeliveryIndex !== expectedIndex) inconsistencies.push(`${final.targetWeaponId}: the matched delivery index is not the earliest at its level`)
  if (row.coverage === 'uncovered' && (exactDeliveryIndexes.length > 0 || partialDeliveryIndexes.length > 0)) inconsistencies.push(`${final.targetWeaponId}: uncovered, yet a single Candidate covers`)
  if (row.coverage === 'partial_comparable' && exactDeliveryIndexes.length > 0) inconsistencies.push(`${final.targetWeaponId}: partial, yet a single Candidate is exact`)
  const deliveryClass: Phase2C26B2B2ADeliveryClass = row.coverage === 'exact' ? 'exact' : row.coverage === 'partial_comparable' ? 'partial'
    : row.coverage === 'not_comparable' ? 'not_comparable'
      : search.status === 'consumer_stop' ? 'capture_or_ordering_unresolved' : 'completed_without_oracle_match'
  return { targetWeaponId: final.targetWeaponId, coverage: row.coverage, matchedStableKey: row.matchedStableKey, matchedDeliveryIndex: matchedDeliveryIndex === -1 ? null : matchedDeliveryIndex,
    exactDeliveryIndexes, partialDeliveryIndexes, closestDifferences: row.closestDifferences, undetermined: row.undetermined, missingOracleFields: row.missingOracleFields,
    oracleHeldRoute: row.oracleHeldRoute, deliveryClass, inconsistencies }
}

// ---------------------------------------------------------------- aggregation

export const PHASE2C26B2B2A_INDEX_BUCKETS = ['0', '1', '2-3', '4-7', '8-15', '16-31'] as const
export type Phase2C26B2B2AIndexBucket = typeof PHASE2C26B2B2A_INDEX_BUCKETS[number]

export function phase2c26b2b2aIndexBucket(index: number): Phase2C26B2B2AIndexBucket {
  if (!Number.isInteger(index) || index < 0 || index >= PHASE2C26B2B2A_CAPTURE_BOUND) throw new Error(`Delivery index ${index} is outside 0..${PHASE2C26B2B2A_CAPTURE_BOUND - 1}.`)
  return index === 0 ? '0' : index === 1 ? '1' : index <= 3 ? '2-3' : index <= 7 ? '4-7' : index <= 15 ? '8-15' : '16-31'
}

export interface Phase2C26B2B2ARow {
  targetWeaponId: string
  population: Phase2C26B2B2APopulation
  cardinality: number
  comparison: Phase2C26B2B2ATargetComparison
  final: Phase2C26B2B2AFinal
}

export function phase2c26b2b2aDeliveryDistribution(rows: readonly Phase2C26B2B2ARow[]) {
  const by = (cls: Phase2C26B2B2ADeliveryClass) => rows.filter(row => row.comparison.deliveryClass === cls).length
  const indexes = (cls: 'exact' | 'partial') => Object.fromEntries(PHASE2C26B2B2A_INDEX_BUCKETS.map(bucket => [bucket,
    rows.filter(row => row.comparison.deliveryClass === cls && row.comparison.matchedDeliveryIndex !== null && phase2c26b2b2aIndexBucket(row.comparison.matchedDeliveryIndex) === bucket).length]))
  return {
    targets: rows.length,
    measured: rows.filter(row => row.final.measured).length,
    exact: by('exact'), partial: by('partial'), capture_or_ordering_unresolved: by('capture_or_ordering_unresolved'),
    completed_without_oracle_match: by('completed_without_oracle_match'), not_comparable: by('not_comparable'), unmeasured: by('unmeasured'),
    /** The first matching delivery index (exact rows by their first exact index, partial rows by their first partial index). */
    exactDeliveryIndex: indexes('exact'),
    partialDeliveryIndex: indexes('partial'),
    /** Exact only at index 8 or later: outside the Phase 2-C2 / B1 capture bound 8. */
    exactBeyondCapture8: rows.filter(row => row.comparison.deliveryClass === 'exact' && (row.comparison.matchedDeliveryIndex ?? -1) >= 8).length,
    byCardinality: Object.fromEntries(['1', '2'].map(k => [`K${k}`, Object.fromEntries(PHASE2C26B2B2A_DELIVERY_CLASSES.map(cls => [cls,
      rows.filter(row => String(row.cardinality) === k && row.comparison.deliveryClass === cls).length]))])),
  }
}

const lateStart = (summary: Phase2C2CandidateSummary) => Boolean(summary.gogma?.startsAfterOrigin || summary.skill?.startsAfterOrigin || summary.normal?.startsAfterOrigin)

export function phase2c26b2b2aDiversity(rows: readonly Phase2C26B2B2ARow[]) {
  const searches = rows.flatMap(row => row.final.search ? [row.final.search] : [])
  const candidates = searches.flatMap(s => s.candidates)
  return {
    measuredSearches: searches.length,
    totalDelivered: candidates.length,
    uniqueStableKeysPerTarget: Object.fromEntries(rows.filter(row => row.final.search).map(row => [row.targetWeaponId, new Set(row.final.search!.candidates.map(c => c.stableKey)).size])),
    deliveredCountDistribution: countBy(searches, s => String(s.candidates.length)),
    termination: { consumer_stop: searches.filter(s => s.status === 'consumer_stop').length, stopped_by_extent: searches.filter(s => s.status === 'stopped_by_extent').length,
      exhausted: searches.filter(s => s.status === 'exhausted').length } as Record<Phase2C2SearchStatus, number>,
    excludedCandidates: searches.reduce((sum, s) => sum + s.summary.excludedCandidates, 0),
    sourceKind: countBy(candidates, c => c.summary.sourceKind),
    routeKind: countBy(candidates, c => c.summary.routeKind),
    heldRoute: candidates.filter(c => c.summary.heldRoute).length,
    lateStart: { any: candidates.filter(c => lateStart(c.summary)).length, gogma: candidates.filter(c => c.summary.gogma?.startsAfterOrigin).length,
      skill: candidates.filter(c => c.summary.skill?.startsAfterOrigin).length, normal: candidates.filter(c => c.summary.normal?.startsAfterOrigin).length },
    targetsWithHeldRoute: rows.filter(row => row.final.search?.candidates.some(c => c.summary.heldRoute)).length,
    reservationViolations: candidates.filter(c => !c.reservationCheck.respects).length,
  }
}

const sortedNumbers = (values: readonly number[]) => [...values].sort((a, b) => a - b)
/** Nearest-rank percentile (`p` in 0..100). */
export function phase2c26b2b2aPercentile(values: readonly number[], p: number): number | null {
  const s = sortedNumbers(values)
  if (s.length === 0) return null
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!
}
export function phase2c26b2b2aMedian(values: readonly number[]): number | null {
  const s = sortedNumbers(values)
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

export function phase2c26b2b2aExecution(finals: readonly Phase2C26B2B2AFinal[], stage1: readonly Phase2C26B2B2ARun[], fallback: readonly Phase2C26B2B2ARun[]) {
  const tally = (runs: readonly Phase2C26B2B2ARun[]) => ({
    runs: runs.length,
    completed: runs.filter(r => r.outcome.process === 'completed' && r.outcome.record === 'searched').length,
    contextMismatch: runs.filter(r => r.outcome.record === 'context_mismatch').length,
    timeout: runs.filter(r => r.outcome.process === 'timeout').length,
    outOfMemory: runs.filter(r => r.outcome.process === 'out_of_memory').length,
    processFailure: runs.filter(r => r.outcome.process === 'process_failure').length,
  })
  const measured = finals.filter(f => f.measured)
  const searchMs = measured.map(f => f.search!.elapsedMs)
  const processMs = measured.map(f => f.final!.process.wallMs)
  const peakHeap = [...stage1, ...fallback].map(r => Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0))
  const peakRss = [...stage1, ...fallback].map(r => Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0))
  const stats = (values: readonly number[]) => ({ min: values.length ? Math.min(...values) : null, median: phase2c26b2b2aMedian(values), p90: phase2c26b2b2aPercentile(values, 90),
    max: values.length ? Math.max(...values) : null })
  return {
    stage1: tally(stage1),
    fallback: { attempted: fallback.length, ...tally(fallback) },
    final: { measured: measured.length, unmeasured: finals.length - measured.length, byFormalRun: countBy(finals, f => f.formalRun) },
    /** The Search itself (visit + capture), measured tasks only. */
    searchElapsedMs: stats(searchMs),
    /** The whole child process (loader, Export read, snapshot re-derivation, Search), measured tasks only. */
    processWallMs: stats(processMs),
    peakHeapBytesMax: peakHeap.length ? Math.max(...peakHeap) : null,
    peakRssBytesMax: peakRss.length ? Math.max(...peakRss) : null,
    yields: stats(measured.map(f => f.final!.yields ?? 0)),
  }
}

// ---------------------------------------------------------------- decision (registered before the formal run)

export type Phase2C26B2B2ADecisionCase = 'B2B2A_ALL_EXACT' | 'B2B2A_PARTIAL_DELIVERY' | 'B2B2A_NO_EXACT' | 'B2B2A_INCOMPLETE' | 'B2B2A_INVALID'

export const PHASE2C26B2B2A_DECISION_RULE = {
  order: [
    'B2B2A_INVALID: a B2-B1 authority mismatch, an Export / B2-A / oracle / manifest hash-chain mismatch, a task count other than 20 (2 historically covered + 18 newly recovered), a K1-only fixture violation, a representative reconstruction / reservation digest / extent mismatch, a context mismatch inside a Search child, a delivered Candidate violating its own reservation (respectsPhase2C2Reservation().respects === false), a provenance failure, a raw / result inconsistency, or a comparison inconsistency',
    'B2B2A_INCOMPLETE: no invalid reason, and some task is still unmeasured after the timeout fallback (timeout / out of memory / process failure)',
    'B2B2A_ALL_EXACT: 20 / 20 measured and 20 / 20 exact',
    'B2B2A_NO_EXACT: 20 / 20 measured and 0 exact',
    'B2B2A_PARTIAL_DELIVERY: 20 / 20 measured and 1..19 exact',
  ],
  exact: 'phase2c2OracleCoverage().coverage === "exact" only; partial_comparable is recorded separately and never counted as exact',
  miss: 'consumer stop at 32 without exact / partial = capture_or_ordering_unresolved (the Route may lie beyond the capture); extent stop / exhaustion without exact / partial = completed_without_oracle_match',
  unmeasured: 'timeout / out of memory / process failure after the fallback; never Candidate 0',
  selection: 'oracle-guided diagnostic selection (B2-B1 post-hoc compatibility); the Search runner never reads the oracle',
} as const

export const PHASE2C26B2B2A_RECOMMENDATION: Record<Phase2C26B2B2ADecisionCase, string> = {
  B2B2A_ALL_EXACT: 'known-compatible / default-extent representative contextでは全oracle RouteがSearchからpublishされる。次はoracle非依存のcontext scheduler設計と、extent不足19件の別probe（B2-B2B）',
  B2B2A_PARTIAL_DELIVERY: 'exactになったRouteと未deliveryを分離し、capture_or_ordering_unresolvedはordering / capture probeへ、completed_without_oracle_matchはSearch composition / publication gap調査へ進む。oracle非依存context scheduler設計とextent不足19件（B2-B2B）はその後',
  B2B2A_NO_EXACT: 'reservation compatibilityだけではSearch publicationを説明できない。Search composition / publication semanticsの研究を先に行う',
  B2B2A_INCOMPLETE: 'Search delivery率を確定しない。未完走taskのSearch performance / completion問題を先に扱う',
  B2B2A_INVALID: '次へ進まず原因調査',
}

export function phase2c26b2b2aDecision(input: { invalidReasons: readonly string[]; tasks: number; measured: number; exact: number }) {
  const { tasks, measured, exact } = input
  if (![tasks, measured, exact].every(v => Number.isInteger(v) && v >= 0) || measured > tasks || exact > measured) throw new Error(`Inconsistent Phase 2-C2.6-B2-B2A decision input: ${JSON.stringify(input)}`)
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2B2A_REGISTERED_B2B1.tasks.total ? [`task_count_${tasks}`] : [])]
  const caseId: Phase2C26B2B2ADecisionCase = reasons.length > 0 ? 'B2B2A_INVALID' : measured < tasks ? 'B2B2A_INCOMPLETE'
    : exact === tasks ? 'B2B2A_ALL_EXACT' : exact === 0 ? 'B2B2A_NO_EXACT' : 'B2B2A_PARTIAL_DELIVERY'
  return { case: caseId, reasons, recommendation: PHASE2C26B2B2A_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2B2AAnalysisInput {
  selections: readonly Phase2C26B2B2ASelection[]
  tasks: readonly Phase2C26B2B2ATaskInput[]
  stage1: readonly Phase2C26B2B2ARun[]
  fallback: readonly Phase2C26B2B2ARun[]
  oracle: Oracle
  smoke: boolean
}

/** Raw consistency, final outcomes, the oracle comparison per task, the aggregates and every invalid reason found here. */
export function runPhase2C26B2B2AAnalysis({ selections, tasks, stage1, fallback, oracle, smoke }: Phase2C26B2B2AAnalysisInput) {
  const invalidReasons: string[] = validatePhase2C26B2B2ARaw({ selections, tasks, stage1, fallback, smoke }).map(issue => `raw: ${issue}`)
  const ranTasks = tasks.filter(task => stage1.some(run => run.taskId === task.taskId))
  const finals = phase2c26b2b2aFinalOutcomes(ranTasks, stage1, fallback)
  const selectionOf = new Map(selections.map(s => [s.targetWeaponId, s]))
  const rows: Phase2C26B2B2ARow[] = finals.map(final => {
    const selection = selectionOf.get(final.targetWeaponId)
    if (!selection) throw new Error(`Task ${final.taskId} is not a selection.`)
    const comparison = phase2c26b2b2aCompare(final, oracle)
    invalidReasons.push(...comparison.inconsistencies.map(i => `comparison: ${i}`))
    return { targetWeaponId: final.targetWeaponId, population: selection.population, cardinality: selection.representative.cardinality, comparison, final }
  })
  for (const run of [...stage1, ...fallback]) {
    if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}/${run.executionClass}: context mismatch in the Search child`)
    if (run.record?.status === 'searched') {
      const violations = run.record.search.candidates.filter(c => !c.reservationCheck.respects)
      if (violations.length > 0) invalidReasons.push(`semantic_failure: ${run.taskId}/${run.executionClass}: ${violations.length} delivered Candidate(s) violate the reservation`)
    }
  }
  const newly = rows.filter(row => row.population === 'newly_recovered_default_extent')
  const controls = rows.filter(row => row.population === 'historically_covered_control')
  const aggregates = {
    all: phase2c26b2b2aDeliveryDistribution(rows),
    newlyRecoveredDefaultExtent: phase2c26b2b2aDeliveryDistribution(newly),
    historicallyCoveredControl: phase2c26b2b2aDeliveryDistribution(controls),
    diversity: phase2c26b2b2aDiversity(rows),
    execution: phase2c26b2b2aExecution(finals, stage1, fallback),
  }
  return { rows, finals, aggregates, invalidReasons,
    decisionInput: { tasks: rows.length, measured: rows.filter(row => row.final.measured).length, exact: rows.filter(row => row.comparison.deliveryClass === 'exact').length } }
}
