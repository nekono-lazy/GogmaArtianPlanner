/**
 * Issue #154 Phase 2-C2.6-B2-C2B2G post-hoc analysis only. It reads the finished B2-C2B2G raw run, the durable profile snapshots its
 * Search child wrote (heartbeats, window boundaries, the final one when the Search completed; each holds the outer A4 runtime and the
 * inner A3 runtime observed on one frozen instant) and the runner start attestation, and, as explicit analyzer arguments AFTER the run
 * ended, the probe manifest, the Export and the committed B2-C2B2F / B2-C2B2E RESULTs. It runs no Search and feeds nothing back.
 *
 * Reconciliation (A7's definitions, one run, one instant). The outer `bonus_depth_read` section wraps one `readReservedDepth()` call and
 * the six inner sections run inside it, mutually exclusive, so at one observation instant
 *
 * ```text
 * innerSectionsMs  = sum of the six inner sections (completed + the open one up to the instant)
 *                 <= innerInclusiveMs (depth_started -> depth_completed, completed + the open depth)
 *                 <= bonusDepthReadMs (the outer bonus_depth_read inclusive, completed + the open one)
 * innerCoverageOfBonusDepthRead = innerSectionsMs / bonusDepthReadMs
 * remainder        = bonusDepthReadMs - innerSectionsMs
 *                  = inDepthOutsideSections (innerInclusive - innerSections) + outsideDepthBoundaries (bonusDepthRead - innerInclusive)
 * ```
 *
 * The decision is registered before the formal run: INVALID (authority / population / identity / excluded Route / provenance / an outer
 * or inner contract violation / a negative duration / broken reconciliation), INSUFFICIENT (no usable profile, a Search shorter than 60 s,
 * no observed read, coverage < 0.90), <SECTION>_DOMINANT (one section >= 0.50 of bonus_depth_read), MIXED (valid, none >= 0.50); every
 * other section >= 0.20 of bonus_depth_read is reported as secondary. The windows are descriptive only (never a decision input).
 */
import { stableStringify } from '../domain/models/hashing'
import { pearson } from './plannerGlobalPhase2C26A3Analysis'
import type { Phase2C26A3DepthRecord, Phase2C26A3PhaseTotals } from './plannerGlobalPhase2C26A3'
import {
  phase2c26b2c2b2fCategories,
  phase2c26b2c2b2fConditionIssues,
  phase2c26b2c2b2fSelectSnapshot,
  phase2c26b2c2b2fWindows,
  type Phase2C26B2C2B2FCategoryBreakdown,
} from './plannerGlobalPhase2C26B2C2B2FAnalysis'
import { phase2c26b2c2b2dEvidenceGrade } from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import {
  verifyPhase2C26B2C2B2GStartAttestation,
  PHASE2C26B2C2B2G_INNER_SECTIONS,
  PHASE2C26B2C2B2G_WINDOWS_MS,
  type Phase2C26B2C2B2GAttestationExpectation,
  type Phase2C26B2C2B2GInnerSection,
  type Phase2C26B2C2B2GProfileSnapshot,
} from './plannerGlobalPhase2C26B2C2B2G'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const share = (part: number, whole: number) => (whole > 0 ? part / whole : null)

// ---------------------------------------------------------------- registered decision rule (fixed before the formal run)

export const PHASE2C26B2C2B2G_COVERAGE_THRESHOLD = 0.9
export const PHASE2C26B2C2B2G_DOMINANT_THRESHOLD = 0.5
export const PHASE2C26B2C2B2G_SECONDARY_THRESHOLD = 0.2
/** A Search shorter than this is not a usable profile of a 30-minute time-bound Search (INSUFFICIENT). */
export const PHASE2C26B2C2B2G_MIN_SEARCH_WALL_MS = 60_000
/** The tolerance of the reconciliation inequalities (relative to bonus_depth_read, at least 1e-6 ms). */
export const PHASE2C26B2C2B2G_RECONCILIATION_TOLERANCE = 1e-6

export const PHASE2C26B2C2B2G_DECISION_CASES = ['B2C2B2G_INVALID', 'B2C2B2G_INSUFFICIENT', 'B2C2B2G_WINDOW_COLLECTION_DOMINANT', 'B2C2B2G_SUPPORT_EVALUATION_DOMINANT',
  'B2C2B2G_STATE_GENERATION_DOMINANT', 'B2C2B2G_SOLUTION_MATERIALIZATION_DOMINANT', 'B2C2B2G_FRONTIER_REDUCTION_SORT_DOMINANT', 'B2C2B2G_EXHAUSTION_SCAN_DOMINANT', 'B2C2B2G_MIXED'] as const
export type Phase2C26B2C2B2GDecisionCase = typeof PHASE2C26B2C2B2G_DECISION_CASES[number]
const DOMINANT_CASE: Record<Phase2C26B2C2B2GInnerSection, Phase2C26B2C2B2GDecisionCase> = {
  window_collection: 'B2C2B2G_WINDOW_COLLECTION_DOMINANT', support_evaluation: 'B2C2B2G_SUPPORT_EVALUATION_DOMINANT', state_generation: 'B2C2B2G_STATE_GENERATION_DOMINANT',
  solution_materialization: 'B2C2B2G_SOLUTION_MATERIALIZATION_DOMINANT', frontier_reduction_sort: 'B2C2B2G_FRONTIER_REDUCTION_SORT_DOMINANT', exhaustion_scan: 'B2C2B2G_EXHAUSTION_SCAN_DOMINANT',
}

export const PHASE2C26B2C2B2G_DECISION_RULE = {
  sections: 'the six RESERVED_GOGMA_RUNTIME_PHASES (window_collection, support_evaluation, state_generation, solution_materialization, frontier_reduction_sort, exhaustion_scan), mutually exclusive inside one held-aware readReservedDepth(); no section of this phase\'s own',
  denominator: 'bonusDepthReadMs = the outer bonus_depth_read inclusive time of this run itself, observed on the same frozen instant as the inner sections (open read / phase / depth up to that instant); never a B2-C2B2F or A7 time',
  coverage: `innerCoverageOfBonusDepthRead = sum(six inner sections) / bonusDepthReadMs; INSUFFICIENT below ${PHASE2C26B2C2B2G_COVERAGE_THRESHOLD}`,
  remainder: 'bonusDepthReadMs - innerSectionsMs = inDepthOutsideSections (inner inclusive depth - sections) + outsideDepthBoundaries (bonusDepthReadMs - inner inclusive depth)',
  invalid: 'B2C2B2G_INVALID: an authority / population / Search input identity / excluded Route / provenance issue, an outer or inner tracker contract violation (an inner boundary outside an open bonus_depth_read included), a negative duration, or broken reconciliation (sections > inclusive > read beyond tolerance, depth records not summing to the tracker totals, the outer categories not a partition, outer / inner instants differing)',
  insufficient: `B2C2B2G_INSUFFICIENT: no usable profile snapshot, a Search wall below ${PHASE2C26B2C2B2G_MIN_SEARCH_WALL_MS} ms, no observed bonus_depth_read, or innerCoverageOfBonusDepthRead below ${PHASE2C26B2C2B2G_COVERAGE_THRESHOLD}`,
  dominant: `B2C2B2G_<SECTION>_DOMINANT: one inner section share of bonus_depth_read >= ${PHASE2C26B2C2B2G_DOMINANT_THRESHOLD}`,
  mixed: `B2C2B2G_MIXED: valid, no inner section >= ${PHASE2C26B2C2B2G_DOMINANT_THRESHOLD}; the next phase takes the (at most 2) largest sections >= ${PHASE2C26B2C2B2G_SECONDARY_THRESHOLD}`,
  secondary: `every other inner section with share of bonus_depth_read >= ${PHASE2C26B2C2B2G_SECONDARY_THRESHOLD} is reported as secondary`,
  outerSanity: 'the outer categories of this run are recorded (BONUS the largest, bonus_depth_read observed, before delivery, no outer nesting violation) and never compared numerically with B2-C2B2F',
  timeout: 'a timeout is a normal profiling outcome (never Candidate 0); a natural completion is profiled whole',
  windows: 'descriptive only, never a decision input',
  a7: 'A7 / A8 / A9 results are taxonomy and implementation references only, never decision inputs',
} as const

export const PHASE2C26B2C2B2G_NEXT_PHASE: Record<Phase2C26B2C2B2GDecisionCase, string> = {
  B2C2B2G_INVALID: '計測を無効扱いにし、原因を修正して同じprofilingをやり直す（条件は変えない）',
  B2C2B2G_INSUFFICIENT: 'instrumentation / coverage不足を先に解決する（未計測区間の特定）。60分への延長・16 GBへの変更はしない',
  B2C2B2G_WINDOW_COLLECTION_DOMINANT: 'window collection内部（frontier stateごとのreservedWindow()、window memo lookup / nextOperationPositions、window Set構築、positions集約）を調査する',
  B2C2B2G_SUPPORT_EVALUATION_DOMINANT: 'support evaluation内部（gogmaReset / gogmaKeep support判定、unsupported記録）を調査する',
  B2C2B2G_STATE_GENERATION_DOMINANT: 'state generation内部のCPU / allocation hotspot局所化（legal position iteration、Reset parent lookup、position × frontier Keep scan、windows[index].has、predictReset / predictKeep memo、advanceGogmaCounter、reservedGeneratedState()、execution.checkpoint()）',
  B2C2B2G_SOLUTION_MATERIALIZATION_DOMINANT: 'solution materialization内部（solution object生成、reservedBonusSteps()のresult chain走査）を局所化する',
  B2C2B2G_FRONTIER_REDUCTION_SORT_DOMINANT: 'A8方式（CPU attribution）を現行t02へ適用する価値を検討する。A9 cache後に残るfrontier reduction / sortのhotspotを切る',
  B2C2B2G_EXHAUSTION_SCAN_DOMINANT: 'exhaustion scan内部（reduced frontier stateごとのreservedWindow()、memo hit / miss）を調査する',
  B2C2B2G_MIXED: '>= 20 %のinner sectionを最大2つ選び、次Phaseでそれぞれ絞る',
}

// ---------------------------------------------------------------- the inner side of one observation

const zeroTotals = (): Phase2C26A3PhaseTotals => Object.fromEntries(PHASE2C26B2C2B2G_INNER_SECTIONS.map(s => [s, 0])) as Phase2C26A3PhaseTotals

export interface Phase2C26B2C2B2GInnerObservation {
  atMs: number
  /** Completed sections plus the open one up to the instant (A3's analyzer semantics). */
  sectionMs: Phase2C26A3PhaseTotals
  /** Completed sections only (the open one is in `activePhase`). */
  completedSectionMs: Phase2C26A3PhaseTotals
  sectionCounts: Record<Phase2C26B2C2B2GInnerSection, number>
  /** Completed depths plus the open depth up to the instant. */
  inclusiveMs: number
  completedDepths: number
  maxDepthReached: number
  streams: number
  activePhase: { streamIndex: number; depth: number; phase: Phase2C26B2C2B2GInnerSection; elapsedMs: number } | null
  activeDepth: { streamIndex: number; depth: number; elapsedMs: number; phaseMs: Partial<Phase2C26A3PhaseTotals> } | null
  contractViolations: number
  contractViolationSamples: string[]
  outsideReadViolations: number
  outsideReadViolationSamples: string[]
}

/** The inner observation of one snapshot (target ordinal 0). */
export function phase2c26b2c2b2gInnerObservation(snapshot: Phase2C26B2C2B2GProfileSnapshot): Phase2C26B2C2B2GInnerObservation {
  const runtime = snapshot.inner.runtime
  const target = runtime.byTarget.find(t => t.targetOrdinal === 0) ?? null
  const completed = target === null ? zeroTotals() : { ...target.phaseTotalsMs }
  const sectionMs = { ...completed }
  const active = runtime.activePhase !== null && runtime.activePhase.targetOrdinal === 0 ? runtime.activePhase : null
  if (active !== null) sectionMs[active.phase] += active.elapsedMs
  const depth = runtime.activeDepth !== null && runtime.activeDepth.targetOrdinal === 0 ? runtime.activeDepth : null
  return { atMs: snapshot.inner.atMs, sectionMs, completedSectionMs: completed,
    sectionCounts: target === null ? Object.fromEntries(PHASE2C26B2C2B2G_INNER_SECTIONS.map(s => [s, 0])) as Record<Phase2C26B2C2B2GInnerSection, number> : { ...target.phaseCounts },
    inclusiveMs: (target?.inclusiveDepthMs ?? 0) + (depth?.elapsedMs ?? 0), completedDepths: target?.completedDepths ?? 0, maxDepthReached: target?.maxDepthReached ?? 0, streams: target?.streams ?? 0,
    activePhase: active === null ? null : { streamIndex: active.streamIndex, depth: active.depth, phase: active.phase, elapsedMs: active.elapsedMs },
    activeDepth: depth === null ? null : { streamIndex: depth.streamIndex, depth: depth.depth, elapsedMs: depth.elapsedMs, phaseMs: { ...depth.phaseMs } },
    contractViolations: runtime.contractViolations, contractViolationSamples: [...runtime.contractViolationSamples],
    outsideReadViolations: snapshot.inner.outsideReadViolations, outsideReadViolationSamples: [...snapshot.inner.outsideReadViolationSamples] }
}

// ---------------------------------------------------------------- outer <-> inner reconciliation of one observation

export interface Phase2C26B2C2B2GSectionRow {
  section: Phase2C26B2C2B2GInnerSection
  totalMs: number
  shareOfBonusDepthRead: number | null
  shareOfSearchWall: number | null
  /** Completed occurrences of the section (the open one excluded). */
  count: number
}

export interface Phase2C26B2C2B2GReconciliation {
  observedAtMs: { outer: number; inner: number }
  searchWallMs: number
  bonusDepthReadMs: number
  bonusDepthReadShareOfSearchWall: number | null
  innerSectionsMs: number
  innerInclusiveMs: number
  innerCoverageOfBonusDepthRead: number | null
  innerShareOfSearchWall: number | null
  remainderMs: number
  remainderShareOfBonusDepthRead: number | null
  remainderSplitMs: { inDepthOutsideSections: number; outsideDepthBoundaries: number }
  sections: Phase2C26B2C2B2GSectionRow[]
  /** Sections by descending time. */
  ranked: Phase2C26B2C2B2GInnerSection[]
  dominantSection: Phase2C26B2C2B2GInnerSection | null
  dominantShareOfBonusDepthRead: number | null
  secondLargestSection: Phase2C26B2C2B2GInnerSection | null
  secondLargestShareOfBonusDepthRead: number | null
  /** Every reconciliation inequality (an issue is a broken reconciliation, INVALID). */
  issues: string[]
}

/** Reconciles the outer `bonus_depth_read` and the inner sections of one observation (both of the same snapshot, one frozen instant). */
export function phase2c26b2c2b2gReconcile(outer: { atMs: number; inclusiveMs: Record<string, number> }, inner: Phase2C26B2C2B2GInnerObservation): Phase2C26B2C2B2GReconciliation {
  const searchWallMs = outer.inclusiveMs.search_runtime ?? 0
  const read = outer.inclusiveMs.bonus_depth_read ?? 0
  const sectionsMs = PHASE2C26B2C2B2G_INNER_SECTIONS.reduce((sum, s) => sum + inner.sectionMs[s], 0)
  const tol = Math.max(1e-6, Math.abs(read) * PHASE2C26B2C2B2G_RECONCILIATION_TOLERANCE)
  const issues: string[] = []
  if (outer.atMs !== inner.atMs) issues.push(`the outer and inner observation instants differ (${outer.atMs} vs ${inner.atMs})`)
  for (const s of PHASE2C26B2C2B2G_INNER_SECTIONS) {
    if (!(inner.sectionMs[s] >= 0)) issues.push(`${s} has a negative or non-finite duration`)
    if (!(inner.sectionCounts[s] >= 0)) issues.push(`${s} has a negative count`)
  }
  if (!(read >= 0) || !(searchWallMs >= 0) || !(inner.inclusiveMs >= 0)) issues.push('a negative or non-finite outer / inner inclusive duration')
  if (sectionsMs > inner.inclusiveMs + tol) issues.push(`the inner sections (${sectionsMs} ms) exceed the inner inclusive depth time (${inner.inclusiveMs} ms)`)
  if (inner.inclusiveMs > read + tol) issues.push(`the inner inclusive depth time (${inner.inclusiveMs} ms) exceeds bonus_depth_read (${read} ms)`)
  if (read > searchWallMs + tol) issues.push('bonus_depth_read exceeds the Search wall')
  const sections = PHASE2C26B2C2B2G_INNER_SECTIONS.map(section => ({ section, totalMs: inner.sectionMs[section], shareOfBonusDepthRead: share(inner.sectionMs[section], read),
    shareOfSearchWall: share(inner.sectionMs[section], searchWallMs), count: inner.sectionCounts[section] }))
  const ranked = [...PHASE2C26B2C2B2G_INNER_SECTIONS].sort((a, b) => inner.sectionMs[b] - inner.sectionMs[a] || PHASE2C26B2C2B2G_INNER_SECTIONS.indexOf(a) - PHASE2C26B2C2B2G_INNER_SECTIONS.indexOf(b))
  const dominant = sectionsMs > 0 ? ranked[0]! : null
  const second = sectionsMs > 0 && inner.sectionMs[ranked[1]!] > 0 ? ranked[1]! : null
  return { observedAtMs: { outer: outer.atMs, inner: inner.atMs }, searchWallMs, bonusDepthReadMs: read, bonusDepthReadShareOfSearchWall: share(read, searchWallMs),
    innerSectionsMs: sectionsMs, innerInclusiveMs: inner.inclusiveMs, innerCoverageOfBonusDepthRead: share(sectionsMs, read), innerShareOfSearchWall: share(sectionsMs, searchWallMs),
    remainderMs: read - sectionsMs, remainderShareOfBonusDepthRead: share(read - sectionsMs, read),
    remainderSplitMs: { inDepthOutsideSections: inner.inclusiveMs - sectionsMs, outsideDepthBoundaries: read - inner.inclusiveMs },
    sections, ranked, dominantSection: dominant, dominantShareOfBonusDepthRead: dominant === null ? null : share(inner.sectionMs[dominant], read),
    secondLargestSection: second, secondLargestShareOfBonusDepthRead: second === null ? null : share(inner.sectionMs[second], read), issues }
}

const observedOf = (snapshot: Phase2C26B2C2B2GProfileSnapshot) => snapshot.runtime.observed.find(o => o.targetOrdinal === 0) ?? null

/** The reconciliation of one snapshot (null when the outer side observed no target). */
export function phase2c26b2c2b2gSnapshotReconciliation(snapshot: Phase2C26B2C2B2GProfileSnapshot): Phase2C26B2C2B2GReconciliation | null {
  const observed = observedOf(snapshot)
  if (observed === null) return null
  return phase2c26b2c2b2gReconcile({ atMs: snapshot.runtime.atMs, inclusiveMs: observed.inclusiveMs }, phase2c26b2c2b2gInnerObservation(snapshot))
}

// ---------------------------------------------------------------- the outer sanity check (recorded, not compared with B2-C2B2F)

export function phase2c26b2c2b2gOuterSanity(snapshot: Phase2C26B2C2B2GProfileSnapshot) {
  const observed = observedOf(snapshot)
  const categories: Phase2C26B2C2B2FCategoryBreakdown | null = observed === null ? null : phase2c26b2c2b2fCategories(observed)
  const target = snapshot.runtime.byTarget.find(t => t.targetOrdinal === 0) ?? null
  const ranked = categories === null ? [] : (['BONUS', 'SKILL', 'COMPOSITION', 'SCHEDULER_OVERHEAD', 'DELIVERY', 'REGISTRATION_SETUP'] as const).slice().sort((a, b) => categories.shares[b] - categories.shares[a])
  const deliveryFlushes = (target?.sectionCounts.delivery_flush ?? 0) + (snapshot.runtime.activeStack.some(f => f.section === 'delivery_flush') ? 1 : 0)
  return {
    categories,
    largestCategory: ranked[0] ?? null,
    checks: {
      bonusIsLargestCategory: ranked[0] === 'BONUS',
      bonusDepthReadObserved: (observed?.inclusiveMs.bonus_depth_read ?? 0) > 0,
      beforeFirstDelivery: deliveryFlushes === 0,
      outerContractViolationsZero: snapshot.runtime.contractViolations === 0,
      outerPartitionMatches: categories?.partition.matches === true,
    },
    deliveryFlushes,
    bonusDepthReadShareOfSearchWall: categories === null || observed === null ? null : share(observed.inclusiveMs.bonus_depth_read, categories.searchWallMs),
    note: 'Recorded for this run only. The added observer can move absolute shares, so nothing is required to equal B2-C2B2F.',
  }
}

// ---------------------------------------------------------------- the depth records (read from the counts the Search reported)

export interface Phase2C26B2C2B2GDepthRecordCollection {
  valid: boolean
  issues: string[]
  records: Phase2C26A3DepthRecord[]
}

/**
 * Collects the inner depth records the snapshots handed out (each completed depth exactly once): the count equals the last snapshot's
 * emitted count, the seq is strictly increasing, and the per-section sums of the records plus the open depth's completed sections equal
 * the tracker's completed section totals (no double count, nothing lost).
 */
export function phase2c26b2c2b2gCollectDepthRecords(snapshots: readonly Phase2C26B2C2B2GProfileSnapshot[]): Phase2C26B2C2B2GDepthRecordCollection {
  const records = snapshots.flatMap(s => s.newDepthRecords ?? [])
  const issues: string[] = []
  const last = snapshots.at(-1) ?? null
  if (last === null) return { valid: false, issues: ['no snapshot'], records }
  if (records.length !== last.depthRecordsEmitted) issues.push(`${records.length} depth records collected, ${last.depthRecordsEmitted} emitted`)
  if (records.length !== last.inner.counts.completedDepths) issues.push(`${records.length} depth records, ${last.inner.counts.completedDepths} completed depths counted`)
  records.forEach((r, i) => { if (i > 0 && !(r.seq > records[i - 1]!.seq)) issues.push(`depth record ${i} seq is not increasing`) })
  const inner = phase2c26b2c2b2gInnerObservation(last)
  if (inner.completedDepths !== records.length) issues.push(`the tracker counted ${inner.completedDepths} completed depths, ${records.length} records`)
  for (const section of PHASE2C26B2C2B2G_INNER_SECTIONS) {
    const sum = records.reduce((total, r) => total + (r.phaseMs[section] ?? 0), 0) + (inner.activeDepth?.phaseMs[section] ?? 0)
    const tol = Math.max(1e-6, Math.abs(inner.completedSectionMs[section]) * 1e-9)
    if (Math.abs(sum - inner.completedSectionMs[section]) > tol) issues.push(`${section}: the depth records sum to ${sum} ms, the tracker to ${inner.completedSectionMs[section]} ms`)
  }
  return { valid: issues.length === 0, issues, records }
}

const round = (value: number | null, digits = 4) => (value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)))
function distribution(values: readonly number[]) {
  if (values.length === 0) return { count: 0, min: null, median: null, mean: null, max: null, sum: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return { count: sorted.length, min: round(sorted[0]!), median: round(sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2), mean: round(sum / sorted.length),
    max: round(sorted.at(-1)!), sum: round(sum) }
}

/** The count units each section is reported per (descriptive only; ns per unit per completed depth). */
const PER_UNIT: Record<Phase2C26B2C2B2GInnerSection, 'frontierStatesBefore' | 'generatedStates' | 'frontierStatesAfter'> = {
  window_collection: 'frontierStatesBefore', support_evaluation: 'frontierStatesBefore', state_generation: 'generatedStates', solution_materialization: 'generatedStates',
  frontier_reduction_sort: 'generatedStates', exhaustion_scan: 'frontierStatesAfter',
}

/** Descriptive statistics of the completed inner depths (counts the Search reported; no extra scan). */
export function phase2c26b2c2b2gDepthStatistics(records: readonly Phase2C26A3DepthRecord[]) {
  const c = (pick: (r: Phase2C26A3DepthRecord) => number | null) => records.map(pick).filter((v): v is number => v !== null)
  const byStream = new Map<number, { depths: number; maxDepth: number; generatedStates: number; startGogmaCounter: number; exhausted: boolean; sectionMs: number }>()
  for (const r of records) {
    const s = byStream.get(r.streamIndex) ?? { depths: 0, maxDepth: 0, generatedStates: 0, startGogmaCounter: r.startGogmaCounter, exhausted: false, sectionMs: 0 }
    s.depths += 1; s.maxDepth = Math.max(s.maxDepth, r.depth); s.generatedStates += r.counts.generatedStates ?? 0; s.exhausted ||= r.exhausted
    s.sectionMs += PHASE2C26B2C2B2G_INNER_SECTIONS.reduce((sum, p) => sum + (r.phaseMs[p] ?? 0), 0)
    byStream.set(r.streamIndex, s)
  }
  const perUnitNs = Object.fromEntries(PHASE2C26B2C2B2G_INNER_SECTIONS.map(section => {
    const unit = PER_UNIT[section]
    const values = records.map(r => ({ ms: r.phaseMs[section] ?? null, n: r.counts[unit] })).filter((x): x is { ms: number; n: number } => x.ms !== null && x.n !== null && x.n > 0)
      .map(x => (x.ms * 1e6) / x.n)
    return [section, { unit, ...distribution(values) }]
  }))
  const generated = c(r => r.counts.generatedStates)
  const sectionTotal = records.map(r => PHASE2C26B2C2B2G_INNER_SECTIONS.reduce((sum, p) => sum + (r.phaseMs[p] ?? 0), 0))
  return {
    depths: records.length,
    counts: {
      frontierStatesBefore: distribution(c(r => r.counts.frontierStatesBefore)),
      legalPositionCount: distribution(c(r => r.counts.legalPositionCount)),
      generatedStates: distribution(generated),
      frontierStatesAfter: distribution(c(r => r.counts.frontierStatesAfter)),
      windowMemoEntries: distribution(c(r => r.counts.windowMemoEntries)),
    },
    sectionMsPerDepth: Object.fromEntries(PHASE2C26B2C2B2G_INNER_SECTIONS.map(section => [section, distribution(records.map(r => r.phaseMs[section] ?? 0))])),
    inclusiveMsPerDepth: distribution(records.map(r => r.inclusiveMs)),
    perUnitNs,
    correlations: {
      generatedStates_vs_sectionsMs: round(pearson(records.map(r => r.counts.generatedStates ?? 0), sectionTotal)),
      generatedStates_vs_stateGenerationMs: round(pearson(records.map(r => r.counts.generatedStates ?? 0), records.map(r => r.phaseMs.state_generation ?? 0))),
      frontierStatesBefore_vs_sectionsMs: round(pearson(records.map(r => r.counts.frontierStatesBefore), sectionTotal)),
      legalPositionCount_vs_sectionsMs: round(pearson(records.map(r => r.counts.legalPositionCount ?? 0), sectionTotal)),
    },
    byStream: [...byStream.entries()].sort(([a], [b]) => a - b).map(([streamIndex, s]) => ({ streamIndex, ...s })),
    top: [...records].sort((a, b) => (b.counts.generatedStates ?? 0) - (a.counts.generatedStates ?? 0)).slice(0, 5)
      .map(r => ({ streamIndex: r.streamIndex, depth: r.depth, counts: { ...r.counts }, phaseMs: { ...r.phaseMs }, inclusiveMs: r.inclusiveMs })),
  }
}

// ---------------------------------------------------------------- descriptive windows (Search elapsed)

export interface Phase2C26B2C2B2GWindow {
  fromMs: number
  toMs: number
  observedFromMs: number | null
  observedToMs: number | null
  partial: boolean
  outerShares: Phase2C26B2C2B2FCategoryBreakdown['shares'] | null
  bonusDepthReadMs: number | null
  innerSectionsMs: number | null
  innerCoverageOfBonusDepthRead: number | null
  sections: Record<Phase2C26B2C2B2GInnerSection, { ms: number; shareOfBonusDepthRead: number | null }> | null
  dominantSection: Phase2C26B2C2B2GInnerSection | null
  completedDepths: number | null
  generatedStates: number | null
  frontierStatesBefore: number | null
  frontierStatesAfter: number | null
  legalPositions: number | null
  maxDepthReached: number | null
  yieldsCount: number | null
}

/**
 * The registered windows (Search elapsed 0-10 / 10-20 / 20-30 minutes) as differences of cumulative snapshots: the window start is the
 * Search start (zero) or the window-boundary snapshot at its start; the end is the boundary snapshot at its end, or else the last
 * durable snapshot (partial). Outer and inner of one window come from the same snapshots (one instant each). Descriptive only.
 */
export function phase2c26b2c2b2gWindows(snapshots: readonly Phase2C26B2C2B2GProfileSnapshot[]): Phase2C26B2C2B2GWindow[] {
  const outerWindows = phase2c26b2c2b2fWindows(snapshots)
  const boundary = (ms: number) => snapshots.find(s => s.reason === 'window_boundary' && s.windowBoundaryMs === ms) ?? null
  const last = snapshots.at(-1) ?? null
  return PHASE2C26B2C2B2G_WINDOWS_MS.map(([fromMs, toMs], index) => {
    const outerWindow = outerWindows[index]!
    const startSnapshot = fromMs === 0 ? null : boundary(fromMs)
    const endBoundary = boundary(toMs)
    const end = endBoundary ?? (last !== null && (last.searchElapsedMs ?? -1) > fromMs ? last : null)
    const none: Phase2C26B2C2B2GWindow = { fromMs, toMs, observedFromMs: null, observedToMs: null, partial: true, outerShares: null, bonusDepthReadMs: null, innerSectionsMs: null,
      innerCoverageOfBonusDepthRead: null, sections: null, dominantSection: null, completedDepths: null, generatedStates: null, frontierStatesBefore: null, frontierStatesAfter: null,
      legalPositions: null, maxDepthReached: null, yieldsCount: null }
    if (end === null || (fromMs !== 0 && startSnapshot === null)) return none
    const endOuter = observedOf(end)
    if (endOuter === null) return none
    const startOuter = startSnapshot === null ? null : observedOf(startSnapshot)
    const endInner = phase2c26b2c2b2gInnerObservation(end)
    const startInner = startSnapshot === null ? null : phase2c26b2c2b2gInnerObservation(startSnapshot)
    const read = endOuter.inclusiveMs.bonus_depth_read - (startOuter?.inclusiveMs.bonus_depth_read ?? 0)
    const sectionMs = Object.fromEntries(PHASE2C26B2C2B2G_INNER_SECTIONS.map(s => [s, endInner.sectionMs[s] - (startInner?.sectionMs[s] ?? 0)])) as Record<Phase2C26B2C2B2GInnerSection, number>
    const sum = PHASE2C26B2C2B2G_INNER_SECTIONS.reduce((total, s) => total + sectionMs[s], 0)
    const d = (pick: (s: Phase2C26B2C2B2GProfileSnapshot) => number) => pick(end) - (startSnapshot === null ? 0 : pick(startSnapshot))
    const dominant = sum > 0 ? [...PHASE2C26B2C2B2G_INNER_SECTIONS].sort((a, b) => sectionMs[b] - sectionMs[a])[0]! : null
    return { fromMs, toMs, observedFromMs: startSnapshot?.searchElapsedMs ?? 0, observedToMs: end.searchElapsedMs, partial: endBoundary === null,
      outerShares: outerWindow.categories?.shares ?? null, bonusDepthReadMs: read, innerSectionsMs: sum, innerCoverageOfBonusDepthRead: share(sum, read),
      sections: Object.fromEntries(PHASE2C26B2C2B2G_INNER_SECTIONS.map(s => [s, { ms: sectionMs[s], shareOfBonusDepthRead: share(sectionMs[s], read) }])) as Phase2C26B2C2B2GWindow['sections'],
      dominantSection: dominant, completedDepths: d(s => s.inner.counts.completedDepths), generatedStates: d(s => s.inner.counts.generatedStatesSum),
      frontierStatesBefore: d(s => s.inner.counts.frontierStatesBeforeSum), frontierStatesAfter: d(s => s.inner.counts.frontierStatesAfterSum),
      legalPositions: d(s => s.inner.counts.legalPositionCountSum), maxDepthReached: endInner.maxDepthReached, yieldsCount: d(s => s.yields.count) }
  })
}

// ---------------------------------------------------------------- snapshot selection

/** B2-C2B2F's rule (seq strictly increasing, time non-decreasing, at most one final, last) plus: every snapshot's outer and inner instants equal. */
export function phase2c26b2c2b2gSelectSnapshot(snapshots: readonly Phase2C26B2C2B2GProfileSnapshot[]) {
  const selection = phase2c26b2c2b2fSelectSnapshot(snapshots)
  const issues = [...selection.issues]
  snapshots.forEach((s, i) => {
    if (!isObject(s.inner) || !isObject(s.inner.runtime)) issues.push(`snapshot ${i} has no inner runtime`)
    else if (s.inner.atMs !== s.runtime.atMs) issues.push(`snapshot ${i} outer / inner instants differ`)
  })
  return { ...selection, valid: selection.valid && issues.length === selection.issues.length, issues, last: selection.last as Phase2C26B2C2B2GProfileSnapshot | null }
}

// ---------------------------------------------------------------- decision

export interface Phase2C26B2C2B2GDecisionInput {
  invalidReasons: readonly string[]
  insufficientReasons: readonly string[]
  reconciliation: Phase2C26B2C2B2GReconciliation | null
}

export function phase2c26b2c2b2gDecision(input: Phase2C26B2C2B2GDecisionInput) {
  const r = input.reconciliation
  const shareOf = (s: Phase2C26B2C2B2GInnerSection) => (r === null ? 0 : r.sections.find(x => x.section === s)?.shareOfBonusDepthRead ?? 0)
  const secondaryOf = (exclude: Phase2C26B2C2B2GInnerSection | null) => r === null ? [] : r.ranked.filter(s => s !== exclude && shareOf(s) >= PHASE2C26B2C2B2G_SECONDARY_THRESHOLD)
  const base = { scope: 'A profiling decision about which held-aware readReservedDepth() section dominates bonus_depth_read of this one oracle-guided Search input on the current main. It is never an optimization decision, never a Route exact judgement and never Production evidence.' }
  const invalid = [...input.invalidReasons, ...(r?.issues ?? []).map(i => `reconciliation: ${i}`)]
  if (invalid.length > 0) return { ...base, case: 'B2C2B2G_INVALID' as Phase2C26B2C2B2GDecisionCase, reasons: invalid, dominant: null, dominantShareOfBonusDepthRead: null, secondary: [], nextPhaseSections: [], nextPhase: PHASE2C26B2C2B2G_NEXT_PHASE.B2C2B2G_INVALID }
  const insufficient = [...input.insufficientReasons]
  if (r === null) insufficient.push('no reconciliation')
  else {
    if (r.searchWallMs < PHASE2C26B2C2B2G_MIN_SEARCH_WALL_MS) insufficient.push(`the Search wall ${r.searchWallMs.toFixed(0)} ms is below ${PHASE2C26B2C2B2G_MIN_SEARCH_WALL_MS} ms`)
    if (!(r.bonusDepthReadMs > 0)) insufficient.push('no bonus_depth_read was observed')
    else if (r.innerCoverageOfBonusDepthRead === null || r.innerCoverageOfBonusDepthRead < PHASE2C26B2C2B2G_COVERAGE_THRESHOLD) insufficient.push(`innerCoverageOfBonusDepthRead ${r.innerCoverageOfBonusDepthRead?.toFixed(4)} is below ${PHASE2C26B2C2B2G_COVERAGE_THRESHOLD}`)
  }
  if (insufficient.length > 0 || r === null) return { ...base, case: 'B2C2B2G_INSUFFICIENT' as Phase2C26B2C2B2GDecisionCase, reasons: insufficient, dominant: null, dominantShareOfBonusDepthRead: null, secondary: [], nextPhaseSections: [], nextPhase: PHASE2C26B2C2B2G_NEXT_PHASE.B2C2B2G_INSUFFICIENT }
  const top = r.ranked[0]!
  if (shareOf(top) >= PHASE2C26B2C2B2G_DOMINANT_THRESHOLD) {
    const caseId = DOMINANT_CASE[top]
    return { ...base, case: caseId, reasons: [], dominant: top, dominantShareOfBonusDepthRead: shareOf(top), secondary: secondaryOf(top), nextPhaseSections: [top], nextPhase: PHASE2C26B2C2B2G_NEXT_PHASE[caseId] }
  }
  return { ...base, case: 'B2C2B2G_MIXED' as Phase2C26B2C2B2GDecisionCase, reasons: [], dominant: null, dominantShareOfBonusDepthRead: null, secondary: secondaryOf(null),
    nextPhaseSections: secondaryOf(null).slice(0, 2), nextPhase: PHASE2C26B2C2B2G_NEXT_PHASE.B2C2B2G_MIXED }
}

// ---------------------------------------------------------------- launch provenance and raw conditions

export interface Phase2C26B2C2B2GLaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/** B2-C2B2F's launch provenance rule with this phase's attestation. */
export function phase2c26b2c2b2gLaunchProvenance(input: { attestationFile: { sha256: string; body: unknown } | null; recordedAttestationSha256: string | null;
  environment: Record<string, unknown>; expected: Phase2C26B2C2B2GAttestationExpectation }): Phase2C26B2C2B2GLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [], reason: 'The runner start attestation is missing.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2GStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues, reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

export const phase2c26b2c2b2gEvidenceGrade = phase2c26b2c2b2dEvidenceGrade
/** B2-C2B2F's: the profiling budget (30 minutes) and heap (12,288 MB), once (no retry), no CPU profiler / inspector flag. */
export const phase2c26b2c2b2gConditionIssues = phase2c26b2c2b2fConditionIssues
