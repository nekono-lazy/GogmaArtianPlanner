/**
 * Issue #154 Phase 2-C2.6-A6: post-hoc analysis of the formal re-measurement after the allocation-free Bonus multiset
 * equality, Research only. Never import from Production.
 *
 * Nothing here runs a Planner or a Search. The A6 raw run has the Phase 2-C2.6-A4 raw shape (same runner contract, same
 * section boundary observer), so every orientation is first analyzed by the unchanged `analyzePhase2C26A4Kernel()`; this
 * module only adds the before / after comparison against the committed A4 formal evidence.
 *
 * Semantic parity. The optimization must not change what the Search computes. The Search is deterministic and each
 * completed Bonus / Skill depth work leaves one summary record (work identity and counts: raw / Ideal / evaluated
 * solutions, subscribers, retained count, exhaustion, unsupported predictions). The ordered work records of the A6 run
 * must equal the A4 formal raw run's on their common prefix (A4's raw file is accepted only when its SHA-256 is the one
 * the A4 RESULT recorded); any difference fails the formal series closed.
 *
 * Primary effect. On that common prefix both runs processed exactly the same raw solutions, so the `bonus_ideal_filter`
 * phase time summed over the prefix is a like-for-like before / after comparison (the 30-minute totals are not: the
 * faster run processes more). The whole-budget Search wall shares and per-raw-solution costs are reported beside it.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import type { Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import type { Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import { validatePhase2C26A4FormalRun, type Phase2C26A4OrientationAnalysis } from './plannerGlobalPhase2C26A4Analysis'
import type { Phase2C26A5A4Authority } from './plannerGlobalPhase2C26A5'
import {
  PHASE2C26A6_NODE_FLAGS,
  PHASE2C26A6_REGISTERED_PRIMARY_COUNT,
  validatePhase2C26A6ConditionParity,
  validatePhase2C26A6ProductionChange,
  validatePhase2C26A6Selection,
  type Phase2C26A6A5Authority,
  type Phase2C26A6Before,
  type Phase2C26A6ProductionChangeValidation,
} from './plannerGlobalPhase2C26A6'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const round = (value: number | null, digits = 4) => (value === null ? null : Number(value.toFixed(digits)))
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const ratio = (after: number | null, before: number | null) => (after === null || before === null || before <= 0 ? null : after / before)

/** The Bonus depth work phases whose prefix totals are compared (A4's registered outer phases of one Bonus depth work). */
export const PHASE2C26A6_PREFIX_PHASES = ['bonus_depth_read', 'bonus_notice_scan', 'bonus_ideal_filter', 'bonus_route_materialization', 'bonus_evaluate_sort',
  'bonus_channel_publication', 'bonus_depth_advance', 'self'] as const

// ---------------------------------------------------------------- work prefix (semantic parity + like-for-like cost)

interface WorkRecord {
  seq: number
  targetOrdinal: number
  section: string
  work: unknown
  counts: unknown
  phaseMs: Record<string, number>
  startedMs: number
  completedMs: number
}

function workRecords(kernel: unknown): WorkRecord[] {
  const k = isObject(kernel) ? kernel : {}
  return asArray(k.runtime).filter(isObject).filter(record => record.kind === 'search_work_summary')
    .map(record => ({ seq: num(record.seq) ?? -1, targetOrdinal: num(record.targetOrdinal) ?? -1, section: String(record.section), work: record.work ?? null,
      counts: record.counts ?? null, phaseMs: (isObject(record.phaseMs) ? record.phaseMs : {}) as Record<string, number>,
      startedMs: num(record.startedMs) ?? 0, completedMs: num(record.completedMs) ?? 0 }))
    .sort((a, b) => a.seq - b.seq)
}

/** The semantic identity of one completed work: which work, and what it computed (never its time). */
const workIdentity = (record: WorkRecord) => stableStringify({ targetOrdinal: record.targetOrdinal, section: record.section, work: record.work, counts: record.counts })

export interface Phase2C26A6WorkPrefix {
  valid: boolean
  issues: string[]
  beforeWorks: number
  afterWorks: number
  /** Number of leading work records compared (min of both). */
  commonWorks: number
  /** The first differing index, or null. */
  firstMismatch: { index: number; before: unknown; after: unknown } | null
  /** Whether the shorter run's records are all in the common prefix (always true when valid). */
  afterCoversBefore: boolean
  commonBonusWorks: number
  commonRawSolutions: number
  commonIdealSolutions: number
  /** Kernel-clock span from the first common work's start to the last common work's completion. */
  prefixSpanMs: { before: number; after: number; ratio: number | null } | null
  /** Per phase: summed over the common Bonus depth works (identical raw solutions on both sides). */
  phaseTotalsMs: Record<string, { before: number; after: number; ratio: number | null; beforeNsPerRawSolution: number | null; afterNsPerRawSolution: number | null }>
}

/**
 * Compares the ordered completed-work records of the A4 formal ("before") and A6 ("after") kernels of one orientation.
 * Every common record must have the same work identity and counts; the phase times are then compared over that prefix.
 */
export function comparePhase2C26A6WorkPrefix(beforeKernel: unknown, afterKernel: unknown): Phase2C26A6WorkPrefix {
  const before = workRecords(beforeKernel), after = workRecords(afterKernel)
  const issues: string[] = []
  const common = Math.min(before.length, after.length)
  let firstMismatch: Phase2C26A6WorkPrefix['firstMismatch'] = null
  for (let index = 0; index < common; index += 1) {
    if (workIdentity(before[index]) !== workIdentity(after[index])) {
      firstMismatch = { index, before: JSON.parse(workIdentity(before[index])), after: JSON.parse(workIdentity(after[index])) }
      break
    }
  }
  if (common === 0) issues.push('no common completed work record')
  if (firstMismatch !== null) issues.push(`work record ${firstMismatch.index} differs (identity or counts)`)
  const bonus = (records: WorkRecord[]) => records.slice(0, common).filter(r => r.section === 'bonus_depth_work')
  const beforeBonus = bonus(before), afterBonus = bonus(after)
  const countOf = (record: WorkRecord, key: string) => (isObject(record.counts) ? num(record.counts[key]) ?? 0 : 0)
  const commonRawSolutions = beforeBonus.reduce((sum, r) => sum + countOf(r, 'rawSolutions'), 0)
  const commonIdealSolutions = beforeBonus.reduce((sum, r) => sum + countOf(r, 'idealSolutions'), 0)
  const phaseTotalsMs = Object.fromEntries(PHASE2C26A6_PREFIX_PHASES.map(phase => {
    const sum = (records: WorkRecord[]) => records.reduce((total, r) => total + (num(r.phaseMs[phase]) ?? 0), 0)
    const b = sum(beforeBonus), a = sum(afterBonus)
    const per = (ms: number) => (commonRawSolutions > 0 ? round((ms * 1e6) / commonRawSolutions, 2) : null)
    return [phase, { before: b, after: a, ratio: round(ratio(a, b)), beforeNsPerRawSolution: per(b), afterNsPerRawSolution: per(a) }]
  }))
  const span = (records: WorkRecord[]) => records[common - 1].completedMs - records[0].startedMs
  const prefixSpanMs = common === 0 ? null : { before: span(before), after: span(after), ratio: round(ratio(span(after), span(before))) }
  return { valid: issues.length === 0, issues, beforeWorks: before.length, afterWorks: after.length, commonWorks: common, firstMismatch,
    afterCoversBefore: after.length >= before.length, commonBonusWorks: beforeBonus.length, commonRawSolutions, commonIdealSolutions, prefixSpanMs, phaseTotalsMs }
}

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A6FormalRunValidation {
  valid: boolean
  failures: string[]
  a4FormalRun: { valid: boolean; failures: string[] }
  a4ShaMatches: boolean
  a5ShaMatches: boolean
  nodeFlags: unknown
  conditionParity: ReturnType<typeof validatePhase2C26A6ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A6Selection> | null
  productionChangeRecordedByRunner: { sinceA4MeasuredHead: Phase2C26A6ProductionChangeValidation; sinceA5MeasuredHead: Phase2C26A6ProductionChangeValidation } | null
  productionChangeRederived: { sinceA4MeasuredHead: Phase2C26A6ProductionChangeValidation; sinceA5MeasuredHead: Phase2C26A6ProductionChangeValidation }
  a4RawShaMatches: boolean
  workPrefix: { orientationId: string; valid: boolean; issues: string[] }[]
}

/**
 * The raw run is the formal A6 series only when it passes the A4 formal-run contract unchanged (same C2.6-A / A2 / A3
 * authorities and Export, clean non-smoke committed code, concurrency 1, the section boundary observer alone, baseline /
 * condition / selection parity, well-formed record streams) and, in addition: it was made against exactly the A4 / A5
 * RESULT files read; its Node flags and conditions pass the A5 parity (which chains to A4); the orientations are exactly
 * the A5 selection; the only Production calculation change since the A4 and A5 measured HEADs is the registered one
 * (both as the runner recorded it and as the analyzer re-derived it from git); the A4 raw run is the one the A4 RESULT
 * recorded; and every orientation's completed work records equal A4's on their common prefix.
 */
export function validatePhase2C26A6FormalRun(raw: unknown, authorities: { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority;
  a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority }, shas: { c26a: string; a2: string; a3: string; a4: string; a5: string },
evidence: { productionChangeSinceA4: readonly string[]; productionChangeSinceA5: readonly string[]; a4RawShaMatches: boolean;
  workPrefix: readonly { orientationId: string; prefix: Phase2C26A6WorkPrefix }[] }): Phase2C26A6FormalRunValidation {
  const { c26a, a2, a3, a4, a5 } = authorities
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  const a4Run = validatePhase2C26A4FormalRun(raw, c26a, a2, a3, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 })
  if (!a4Run.valid) failures.push(...a4Run.failures.map(failure => `A4 formal-run contract: ${failure}`))
  const a4ShaMatches = environment.c26a4ResultSha256 === shas.a4
  if (!a4ShaMatches) failures.push('the raw run was not made against this C2.6-A4 RESULT')
  const a5ShaMatches = environment.c26a5ResultSha256 === shas.a5
  if (!a5ShaMatches) failures.push('the raw run was not made against this C2.6-A5 RESULT')
  if (stableStringify(environment.nodeFlags ?? null) !== stableStringify(PHASE2C26A6_NODE_FLAGS)) failures.push('the child Node flags are not the A4 / A5 primary flags')

  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions : null
  let conditionParity = null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A6ConditionParity({ ...current, nodeFlags: asArray(environment.nodeFlags) as string[] }, a5.conditions, a4.conditions, a3.conditions,
      c26a, a2.conditions)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `A6 condition parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const selection = validatePhase2C26A6Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean), a5, c26a)
  if (!selection.valid) failures.push('the measured orientations are not exactly the A5 primary set')
  if (a5.primaryOrientationIds.length !== PHASE2C26A6_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')

  const recorded = isObject(environment.productionChange) ? environment.productionChange : null
  const recordedSinceA4 = recorded ? validatePhase2C26A6ProductionChange(asArray(recorded.sinceA4MeasuredHead) as string[]) : null
  const recordedSinceA5 = recorded ? validatePhase2C26A6ProductionChange(asArray(recorded.sinceA5MeasuredHead) as string[]) : null
  if (!recordedSinceA4 || !recordedSinceA5) failures.push('the runner did not record the Production change')
  else if (!recordedSinceA4.valid || !recordedSinceA5.valid) failures.push('the Production change the runner recorded is not exactly the registered one')
  if (recorded && (recorded.a4MeasuredHead !== a4.measuredHead || recorded.a5MeasuredHead !== a5.measuredHead)) failures.push('the runner recorded the Production change against other measured HEADs')
  const rederivedSinceA4 = validatePhase2C26A6ProductionChange(evidence.productionChangeSinceA4)
  const rederivedSinceA5 = validatePhase2C26A6ProductionChange(evidence.productionChangeSinceA5)
  if (!rederivedSinceA4.valid || !rederivedSinceA5.valid) failures.push('the re-derived Production change is not exactly the registered one')

  if (!evidence.a4RawShaMatches) failures.push('the A4 raw run is not the one the A4 RESULT recorded')
  const workPrefix = evidence.workPrefix.map(({ orientationId, prefix }) => ({ orientationId, valid: prefix.valid, issues: prefix.issues }))
  if (!same(workPrefix.map(w => w.orientationId), a5.primaryOrientationIds)) failures.push('the work prefix comparison does not cover exactly the A5 primaries')
  for (const row of workPrefix) if (!row.valid) failures.push(`work prefix ${row.orientationId}: ${row.issues.join('; ')}`)

  return { valid: failures.length === 0, failures, a4FormalRun: { valid: a4Run.valid, failures: a4Run.failures }, a4ShaMatches, a5ShaMatches,
    nodeFlags: environment.nodeFlags, conditionParity, selection,
    productionChangeRecordedByRunner: recordedSinceA4 && recordedSinceA5 ? { sinceA4MeasuredHead: recordedSinceA4, sinceA5MeasuredHead: recordedSinceA5 } : null,
    productionChangeRederived: { sinceA4MeasuredHead: rederivedSinceA4, sinceA5MeasuredHead: rederivedSinceA5 }, a4RawShaMatches: evidence.a4RawShaMatches, workPrefix }
}

// ---------------------------------------------------------------- before / after per orientation

const FOCUS = ['bonus_ideal_filter', 'bonus_depth_read', 'bonus_notice_scan'] as const

export interface Phase2C26A6Comparison {
  orientationId: string
  outcome: { before: string; after: string }
  resultClass: { before: string; after: string }
  searchCompleted: { before: boolean; after: boolean }
  searchWallMs: { before: number; after: number | null }
  coverage: { before: number; after: number | null }
  maxCategoryAfter: string | null
  deliveredCandidates: number | null
  trialsStarted: number | null
  fullPlannerRunsStarted: number | null
  semanticFailures: number
  /** Whole-budget values at each run's own observation point (not like-for-like: the faster run processes more). */
  budget: Record<typeof FOCUS[number], { beforeMs: number; afterMs: number | null; beforeShare: number; afterShare: number | null;
    beforeNsPerRawSolution: number | null; afterNsPerRawSolution: number | null; beforeMedianNsPerRawSolution: number | null; afterMedianNsPerRawSolution: number | null }>
  rawSolutions: { before: number; after: number | null; ratio: number | null }
  idealSolutions: { before: number; after: number | null }
  bonusDepthWorks: { before: number; after: number | null }
  predictionCounts: { before: Json; after: Json }
  memoryAfter: Json
  /** Like-for-like: the common work prefix (identical raw solutions). */
  prefix: {
    commonWorks: number
    commonBonusWorks: number
    commonRawSolutions: number
    spanMs: Phase2C26A6WorkPrefix['prefixSpanMs']
    phaseTotalsMs: Phase2C26A6WorkPrefix['phaseTotalsMs']
    filterRatio: number | null
  }
  afterCategoryShare: Record<string, number> | null
}

export function comparePhase2C26A6Orientation(after: Phase2C26A4OrientationAnalysis, before: Phase2C26A6Before, prefix: Phase2C26A6WorkPrefix): Phase2C26A6Comparison {
  const search = after.primarySearch
  const counters = isObject(after.counters) ? after.counters : {}
  const afterRaw = search ? num(search.bonusDepth?.rawSolutions) : null
  const nsPer = (ms: number | null, raw: number | null) => (ms === null || raw === null || raw <= 0 ? null : round((ms * 1e6) / raw, 2))
  const median = (phase: string) => num(after.bonusWork.nsPerRawSolution[phase]?.median)
  const budget = Object.fromEntries(FOCUS.map(category => {
    const afterMs = search ? search.categoryTotalsMs[category] : null
    const beforeMs = num(before.categoryTotalsMs[category]) ?? 0
    return [category, { beforeMs, afterMs, beforeShare: num(before.categoryShare[category]) ?? 0, afterShare: search ? search.categoryShare[category] : null,
      beforeNsPerRawSolution: nsPer(beforeMs, before.rawSolutions), afterNsPerRawSolution: nsPer(afterMs, afterRaw),
      beforeMedianNsPerRawSolution: category === 'bonus_ideal_filter' ? before.bonusIdealFilterMedianNsPerRawSolution
        : category === 'bonus_depth_read' ? before.bonusDepthReadMedianNsPerRawSolution : null,
      afterMedianNsPerRawSolution: median(category) }]
  })) as Phase2C26A6Comparison['budget']
  return {
    orientationId: after.orientationId,
    outcome: { before: before.childOutcome, after: after.childOutcome },
    resultClass: { before: before.resultClass, after: after.resultClass },
    searchCompleted: { before: before.searchCompleted, after: search?.completed ?? false },
    searchWallMs: { before: before.searchWallMs, after: search?.searchWallMs ?? null },
    coverage: { before: before.coverage, after: search?.coverage ?? null },
    maxCategoryAfter: search?.maxCategory ?? null,
    deliveredCandidates: num(counters.deliveredCandidates), trialsStarted: num(counters.trialsStarted), fullPlannerRunsStarted: num(counters.fullPlannerRunsStarted),
    semanticFailures: prefix.valid ? 0 : 1,
    budget,
    rawSolutions: { before: before.rawSolutions, after: afterRaw, ratio: round(ratio(afterRaw, before.rawSolutions)) },
    idealSolutions: { before: before.idealSolutions, after: search ? num(search.bonusDepth?.idealSolutions) : null },
    bonusDepthWorks: { before: before.bonusDepthWorks, after: search ? num(search.bonusDepth?.works) : null },
    predictionCounts: { before: before.predictionCounts, after: isObject(after.predictionCounts) ? after.predictionCounts : {} },
    memoryAfter: isObject(after.memory) ? after.memory : {},
    prefix: { commonWorks: prefix.commonWorks, commonBonusWorks: prefix.commonBonusWorks, commonRawSolutions: prefix.commonRawSolutions, spanMs: prefix.prefixSpanMs,
      phaseTotalsMs: prefix.phaseTotalsMs, filterRatio: prefix.phaseTotalsMs.bonus_ideal_filter?.ratio ?? null },
    afterCategoryShare: search ? { ...search.categoryShare } : null,
  }
}

// ---------------------------------------------------------------- decision (pre-registered before the formal run)

export const PHASE2C26A6_DECISION_RULE = {
  majority: 2,
  /** `bonus_ideal_filter` time over the common work prefix, after / before, at or below which the filter counts as reduced. */
  filterReducedRatio: 0.5,
  order: [
    'C primary_search_completed: >= 2 primaries completed their primary Search within the 30-minute budget',
    'R filter_reduced_timeout_remains: >= 2 primaries have a common-prefix bonus_ideal_filter ratio (after / before) <= 0.5',
    'F filter_improvement_small: >= 2 primaries have that ratio > 0.5',
    'M mixed: otherwise',
  ],
} as const

export type Phase2C26A6DecisionCase = 'C_primary_search_completed' | 'R_filter_reduced_timeout_remains' | 'F_filter_improvement_small' | 'M_mixed'

export const PHASE2C26A6_RECOMMENDATION: Record<Phase2C26A6DecisionCase, string> = {
  C_primary_search_completed: 'primary Searchが実用時間で完走する状態になった。54 orientation再評価、またはC2.6-B（Candidate portfolio / 1,657 oracle coverage）へ戻る準備へ進む。',
  R_filter_reduced_timeout_remains: 'filter hotspotは縮小したがtimeoutが残る。A3で既に最大だったbonus_depth_read内部（frontier_reduction_sort / state_generation）を次の候補として再評価する。',
  F_filter_improvement_small: 'filter改善が小さい。Target Ideal prepared representation（Ideal multisetの事前計算）等の追加を検討する。',
  M_mixed: 'primary間で結果が分かれた。optimizationを追加せず、差の原因を局所化する。',
}

export function phase2c26a6Decision(rows: readonly Phase2C26A6Comparison[]) {
  const rule = PHASE2C26A6_DECISION_RULE
  const completed = rows.filter(r => r.searchCompleted.after).map(r => r.orientationId)
  const reduced = rows.filter(r => r.prefix.filterRatio !== null && r.prefix.filterRatio <= rule.filterReducedRatio).map(r => r.orientationId)
  const small = rows.filter(r => r.prefix.filterRatio !== null && r.prefix.filterRatio > rule.filterReducedRatio).map(r => r.orientationId)
  let decisionCase: Phase2C26A6DecisionCase, reason: string
  if (rows.length !== PHASE2C26A6_REGISTERED_PRIMARY_COUNT) { decisionCase = 'M_mixed'; reason = `primary count ${rows.length} is not the registered ${PHASE2C26A6_REGISTERED_PRIMARY_COUNT}` }
  else if (completed.length >= rule.majority) { decisionCase = 'C_primary_search_completed'; reason = `primary Search completed in ${completed.join(', ')}` }
  else if (reduced.length >= rule.majority) { decisionCase = 'R_filter_reduced_timeout_remains'; reason = `common-prefix filter ratio <= ${rule.filterReducedRatio} in ${reduced.join(', ')}; primary Search completed in ${completed.length} / ${rows.length}` }
  else if (small.length >= rule.majority) { decisionCase = 'F_filter_improvement_small'; reason = `common-prefix filter ratio > ${rule.filterReducedRatio} in ${small.join(', ')}` }
  else { decisionCase = 'M_mixed'; reason = 'no case reached the majority' }
  return { rule, completedPrimaries: completed, filterReducedPrimaries: reduced, filterSmallPrimaries: small,
    filterRatioByPrimary: Object.fromEntries(rows.map(r => [r.orientationId, r.prefix.filterRatio])), case: decisionCase, reason, recommendation: PHASE2C26A6_RECOMMENDATION[decisionCase] }
}

export function summarizePhase2C26A6(rows: readonly Phase2C26A6Comparison[]) {
  const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0)
  const prefixPhase = (phase: string, side: 'before' | 'after') => sum(rows.map(r => r.prefix.phaseTotalsMs[phase]?.[side] ?? null))
  const pooledPrefix = Object.fromEntries(PHASE2C26A6_PREFIX_PHASES.map(phase => {
    const before = prefixPhase(phase, 'before'), after = prefixPhase(phase, 'after')
    return [phase, { before, after, ratio: round(ratio(after, before)) }]
  }))
  return {
    orientations: rows.length,
    childStatus: Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(s => [s, rows.filter(r => r.outcome.after === s).length])),
    primarySearchCompleted: rows.filter(r => r.searchCompleted.after).length,
    semanticFailures: sum(rows.map(r => r.semanticFailures)),
    deliveredCandidates: sum(rows.map(r => r.deliveredCandidates)),
    commonRawSolutions: sum(rows.map(r => r.prefix.commonRawSolutions)),
    pooledPrefixPhaseTotalsMs: pooledPrefix,
    rawSolutionsInBudget: { before: sum(rows.map(r => r.rawSolutions.before)), after: sum(rows.map(r => r.rawSolutions.after)) },
    decision: phase2c26a6Decision(rows),
  }
}
