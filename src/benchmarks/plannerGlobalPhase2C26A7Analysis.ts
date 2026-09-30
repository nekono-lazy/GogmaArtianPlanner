/**
 * Issue #154 Phase 2-C2.6-A7: post-hoc analysis of the formal `bonus_depth_read` internal runtime re-localization,
 * Research only. Never import from Production.
 *
 * Nothing here runs a Planner or a Search. The A7 raw run carries two record streams per kernel child, both unchanged
 * from earlier phases: the Phase 2-C2.6-A4 Search section stream (`runtime`, heartbeats' `searchRuntime`) and the Phase
 * 2-C2.6-A3 held-aware section stream (`gogmaRuntime`, heartbeats' `gogmaRuntime`). Each is analyzed by its own
 * unchanged analyzer (`analyzePhase2C26A4Kernel()` / `analyzePhase2C26A3Kernel()`); this module only connects them.
 *
 * Connection. The outer `bonus_depth_read` section wraps exactly one `readReservedDepth()` call, and the six inner
 * sections run inside it, so for the same run and the same observation instant (the Search completion, or the last
 * heartbeat, whose two snapshots were taken on one frozen clock) `sum(inner sections) <= bonus_depth_read`. The
 * difference is the read remainder, split into the time inside `depth_started` -> `depth_completed` but outside the six
 * sections and the time inside `bonus_depth_read` but outside the depth boundaries (cursor claim, stream lookup, promise
 * resolution). Shares are reported against both the Search wall time and `bonus_depth_read`.
 *
 * Semantic parity. The added observer must not change what the Search computes: the ordered completed-work records of
 * the A7 run must equal the A6 formal raw run's on their common prefix (A6's raw file is accepted only when its SHA-256
 * is the one the A6 RESULT recorded).
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import type { Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import { analyzePhase2C26A3Kernel, pearson, type Phase2C26A3OrientationAnalysis } from './plannerGlobalPhase2C26A3Analysis'
import { PHASE2C26A4_SEARCH_INSTRUMENTATION, type Phase2C26A4A3Authority, type Phase2C26A4A3Reference } from './plannerGlobalPhase2C26A4'
import { analyzePhase2C26A4Kernel, validatePhase2C26A4FormalRun, type Phase2C26A4OrientationAnalysis } from './plannerGlobalPhase2C26A4Analysis'
import type { Phase2C26A5A4Authority } from './plannerGlobalPhase2C26A5'
import type { Phase2C26A6A5Authority } from './plannerGlobalPhase2C26A6'
import type { Phase2C26A6WorkPrefix } from './plannerGlobalPhase2C26A6Analysis'
import {
  PHASE2C26A7_INNER_SECTIONS,
  PHASE2C26A7_NODE_FLAGS,
  PHASE2C26A7_REGISTERED_PRIMARY_COUNT,
  PHASE2C26A7_SEARCH_INSTRUMENTATION,
  validatePhase2C26A7ConditionParity,
  validatePhase2C26A7NoProductionChange,
  validatePhase2C26A7Selection,
  type Phase2C26A7A6Authority,
  type Phase2C26A7A6Reference,
  type Phase2C26A7InnerSection,
  type Phase2C26A7ProductionChangeValidation,
} from './plannerGlobalPhase2C26A7'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const round = (value: number | null, digits = 4) => (value === null ? null : Number(value.toFixed(digits)))
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const share = (part: number, whole: number) => (whole > 0 ? part / whole : null)

function distribution(values: readonly number[]) {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return { count: sorted.length, min: round(sorted[0]), median: round(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
    max: round(sorted.at(-1) as number) }
}

/** The outer categories this phase reports beside the read (A4's vocabulary). */
export const PHASE2C26A7_OUTER_FOCUS = ['bonus_depth_read', 'bonus_ideal_filter', 'bonus_notice_scan'] as const

// ---------------------------------------------------------------- record streams

const gogmaRecordsOf = (kernel: Json) => asArray(kernel.gogmaRuntime).filter(isObject)
const heartbeatsOf = (kernel: Json) => asArray(kernel.heartbeats).filter(isObject).filter(record => record.kind === 'heartbeat')

/** The A3 analyzer's view of one A7 kernel: the held-aware stream as `runtime`, the same heartbeats. */
export function phase2c26a7InnerView(kernel: unknown): Json {
  const k = isObject(kernel) ? kernel : {}
  return { ...k, runtime: gogmaRecordsOf(k) }
}

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A7FormalRunValidation {
  valid: boolean
  failures: string[]
  a4FormalRun: { valid: boolean; failures: string[] }
  searchInstrumentation: unknown
  a4ShaMatches: boolean
  a5ShaMatches: boolean
  a6ShaMatches: boolean
  nodeFlags: unknown
  conditionParity: ReturnType<typeof validatePhase2C26A7ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A7Selection> | null
  productionChangeRecordedByRunner: Phase2C26A7ProductionChangeValidation | null
  productionChangeRederived: Phase2C26A7ProductionChangeValidation
  a6RawShaMatches: boolean
  workPrefix: { orientationId: string; valid: boolean; issues: string[]; commonWorks: number }[]
  innerRecordIssues: { orientationId: string; issue: string }[]
}

/**
 * The raw run is the formal A7 series only when: its Search instrumentation is exactly A7's (the A4 observer plus the
 * held-aware section observer) and, with that one registered difference set aside, it passes the A4 formal-run contract
 * unchanged (same C2.6-A / A2 / A3 authorities and Export, clean non-smoke committed code, concurrency 1, heap / budget /
 * heartbeat, baseline / condition / selection parity, well-formed A4 record streams with no contract violation); it was
 * made against exactly the A4 / A5 / A6 RESULT files read; its Node flags and conditions pass the A7 parity (which
 * chains to A6 / A5 / A4); the orientations are exactly the A6 selection; no Production calculation source changed since
 * the A6 measured HEAD (as the runner recorded it and as re-derived from git); the held-aware record stream of every
 * kernel is contiguous with no contract violation; the A6 raw run is the one the A6 RESULT recorded; and every
 * orientation's completed work records equal A6's on their common prefix.
 */
export function validatePhase2C26A7FormalRun(raw: unknown, authorities: { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority;
  a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority; a6: Phase2C26A7A6Authority }, shas: { c26a: string; a2: string; a3: string; a4: string; a5: string; a6: string },
evidence: { productionChangeSinceA6: readonly string[]; a6RawShaMatches: boolean; workPrefix: readonly { orientationId: string; prefix: Phase2C26A6WorkPrefix }[] }): Phase2C26A7FormalRunValidation {
  const { c26a, a2, a3, a4, a5, a6 } = authorities
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  const searchInstrumentation = environment.searchInstrumentation
  const instrumentationIsA7 = same(searchInstrumentation, PHASE2C26A7_SEARCH_INSTRUMENTATION)
  if (!instrumentationIsA7) failures.push('the Search instrumentation is not the A7 pair of boundary observers')
  // The A4 contract with the one registered difference set aside (only when it is exactly that difference).
  const a4View = instrumentationIsA7 ? { ...r, environment: { ...environment, searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION } } : r
  const a4Run = validatePhase2C26A4FormalRun(a4View, c26a, a2, a3, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 })
  if (!a4Run.valid) failures.push(...a4Run.failures.map(failure => `A4 formal-run contract: ${failure}`))
  const a4ShaMatches = environment.c26a4ResultSha256 === shas.a4
  if (!a4ShaMatches) failures.push('the raw run was not made against this C2.6-A4 RESULT')
  const a5ShaMatches = environment.c26a5ResultSha256 === shas.a5
  if (!a5ShaMatches) failures.push('the raw run was not made against this C2.6-A5 RESULT')
  const a6ShaMatches = environment.c26a6ResultSha256 === shas.a6
  if (!a6ShaMatches) failures.push('the raw run was not made against this C2.6-A6 RESULT')
  if (!same(environment.nodeFlags, PHASE2C26A7_NODE_FLAGS)) failures.push('the child Node flags are not the A6 primary flags')

  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions : null
  let conditionParity = null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A7ConditionParity({ ...current, nodeFlags: asArray(environment.nodeFlags) as string[], searchInstrumentation },
      a6.conditions, a5.conditions, a4.conditions, a3.conditions, c26a, a2.conditions)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `A7 condition parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const selection = validatePhase2C26A7Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean), a6, c26a)
  if (!selection.valid) failures.push('the measured orientations are not exactly the A6 primary set')
  if (a6.primaryOrientationIds.length !== PHASE2C26A7_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')

  const recorded = isObject(environment.productionChange) ? environment.productionChange : null
  const recordedSinceA6 = recorded ? validatePhase2C26A7NoProductionChange(asArray(recorded.sinceA6MeasuredHead) as string[]) : null
  if (!recordedSinceA6) failures.push('the runner did not record the Production change since the A6 measured HEAD')
  else if (!recordedSinceA6.valid) failures.push('the runner recorded a Production calculation change since the A6 measured HEAD')
  if (recorded && recorded.a6MeasuredHead !== a6.measuredHead) failures.push('the runner recorded the Production change against another measured HEAD')
  const rederived = validatePhase2C26A7NoProductionChange(evidence.productionChangeSinceA6)
  if (!rederived.valid) failures.push('the re-derived Production change since the A6 measured HEAD is not empty')

  const innerRecordIssues: Phase2C26A7FormalRunValidation['innerRecordIssues'] = []
  for (const kernel of kernels) {
    const id = String(kernel.orientationId)
    const records = gogmaRecordsOf(kernel)
    if (records.length === 0) innerRecordIssues.push({ orientationId: id, issue: 'no held-aware runtime record' })
    const kinds = new Set(['gogma_phase_started', 'gogma_depth'])
    if (records.some(record => !kinds.has(String(record.kind)))) innerRecordIssues.push({ orientationId: id, issue: 'unknown held-aware record kind' })
    const ordered = [...records].sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1))
    if (ordered.some((record, index) => record.seq !== index + 1)) innerRecordIssues.push({ orientationId: id, issue: 'held-aware sequence is not contiguous from 1' })
    const heartbeats = heartbeatsOf(kernel)
    const gogma = isObject(heartbeats.at(-1)?.gogmaRuntime) ? heartbeats.at(-1)?.gogmaRuntime as Json : null
    if (gogma === null) innerRecordIssues.push({ orientationId: id, issue: 'last heartbeat has no held-aware runtime' })
    else if (gogma.contractViolations !== 0) innerRecordIssues.push({ orientationId: id, issue: `${String(gogma.contractViolations)} held-aware contract violations` })
    const search = isObject(heartbeats.at(-1)?.searchRuntime) ? heartbeats.at(-1)?.searchRuntime as Json : null
    if (gogma !== null && search !== null && gogma.contractViolations === 0 && num(search.atMs) === null) innerRecordIssues.push({ orientationId: id, issue: 'last heartbeat has no Search runtime instant' })
  }
  if (innerRecordIssues.length > 0) failures.push('held-aware record stream issues')

  if (!evidence.a6RawShaMatches) failures.push('the A6 raw run is not the one the A6 RESULT recorded')
  const workPrefix = evidence.workPrefix.map(({ orientationId, prefix }) => ({ orientationId, valid: prefix.valid, issues: prefix.issues, commonWorks: prefix.commonWorks }))
  if (!same(workPrefix.map(w => w.orientationId), a6.primaryOrientationIds)) failures.push('the work prefix comparison does not cover exactly the A6 primaries')
  for (const row of workPrefix) if (!row.valid) failures.push(`work prefix ${row.orientationId}: ${row.issues.join('; ')}`)

  return { valid: failures.length === 0, failures, a4FormalRun: { valid: a4Run.valid, failures: a4Run.failures }, searchInstrumentation, a4ShaMatches, a5ShaMatches,
    a6ShaMatches, nodeFlags: environment.nodeFlags, conditionParity, selection, productionChangeRecordedByRunner: recordedSinceA6, productionChangeRederived: rederived,
    a6RawShaMatches: evidence.a6RawShaMatches, workPrefix, innerRecordIssues }
}

// ---------------------------------------------------------------- one orientation: outer <-> inner

interface WorkSummary { seq: number; targetOrdinal: number; section: string; work: { channel: number; depth: number } | null; counts: Json | null; phaseMs: Json }
interface DepthRecord { seq: number; targetOrdinal: number; streamIndex: number; depth: number; counts: Json; phaseMs: Json; inclusiveMs: number }

/** The per-work join of the primary Search: the k-th outer Bonus depth work is the k-th held-aware depth read. */
export interface Phase2C26A7WorkJoin {
  valid: boolean
  issues: string[]
  outerWorks: number
  innerDepths: number
  joined: number
  /** sum(inner sections) / bonus_depth_read, per joined work. */
  coverage: ReturnType<typeof distribution>
  /** inner inclusive depth / bonus_depth_read, per joined work. */
  inclusiveCoverage: ReturnType<typeof distribution>
  /** Summed over the joined works (completed works only). */
  totalsMs: { bonusDepthRead: number; innerSections: number; innerInclusive: number; inDepthOutsideSections: number; outsideDepthBoundaries: number }
  /** Descriptive: the read remainder against the work's raw solutions / generated states. */
  correlations: { rawSolutions_vs_readRemainder: number | null; generatedStates_vs_readRemainder: number | null; rawSolutions_vs_bonusDepthRead: number | null }
}

export function joinPhase2C26A7Works(kernel: unknown): Phase2C26A7WorkJoin {
  const k = isObject(kernel) ? kernel : {}
  const works = asArray(k.runtime).filter(isObject).filter(r => r.kind === 'search_work_summary' && r.section === 'bonus_depth_work' && r.targetOrdinal === 0)
    .map(r => r as unknown as WorkSummary).sort((a, b) => a.seq - b.seq)
  const depths = gogmaRecordsOf(k).filter(r => r.kind === 'gogma_depth' && r.targetOrdinal === 0).map(r => r as unknown as DepthRecord).sort((a, b) => a.seq - b.seq)
  const issues: string[] = []
  const joined = Math.min(works.length, depths.length)
  // Every completed outer work has completed its inner read; the inner stream may hold one more (the kill came between them).
  if (depths.length < works.length || depths.length > works.length + 1) issues.push(`outer works ${works.length} vs inner depths ${depths.length}`)
  const coverage: number[] = [], inclusiveCoverage: number[] = []
  const totals = { bonusDepthRead: 0, innerSections: 0, innerInclusive: 0, inDepthOutsideSections: 0, outsideDepthBoundaries: 0 }
  const raw: number[] = [], generated: number[] = [], remainder: number[] = [], read: number[] = []
  for (let index = 0; index < joined; index += 1) {
    const work = works[index], depth = depths[index]
    if (work.work?.depth !== depth.depth) { issues.push(`work ${index}: outer depth ${String(work.work?.depth)} vs inner depth ${depth.depth}`); break }
    const readMs = num(work.phaseMs.bonus_depth_read) ?? 0
    const sections = PHASE2C26A7_INNER_SECTIONS.reduce((sum, section) => sum + (num(depth.phaseMs[section]) ?? 0), 0)
    const inclusive = num(depth.inclusiveMs) ?? 0
    totals.bonusDepthRead += readMs; totals.innerSections += sections; totals.innerInclusive += inclusive
    totals.inDepthOutsideSections += inclusive - sections; totals.outsideDepthBoundaries += readMs - inclusive
    if (readMs > 0) { coverage.push(sections / readMs); inclusiveCoverage.push(inclusive / readMs) }
    raw.push(num(work.counts?.rawSolutions) ?? 0); generated.push(num(depth.counts?.generatedStates) ?? 0); remainder.push(readMs - sections); read.push(readMs)
  }
  return { valid: issues.length === 0, issues, outerWorks: works.length, innerDepths: depths.length, joined, coverage: distribution(coverage),
    inclusiveCoverage: distribution(inclusiveCoverage), totalsMs: totals,
    correlations: { rawSolutions_vs_readRemainder: round(pearson(raw, remainder)), generatedStates_vs_readRemainder: round(pearson(generated, remainder)),
      rawSolutions_vs_bonusDepthRead: round(pearson(raw, read)) } }
}

export interface Phase2C26A7SectionRow {
  section: Phase2C26A7InnerSection
  totalMs: number
  shareOfSearchWall: number | null
  shareOfBonusDepthRead: number | null
  /** Share of the six sections' sum (the A3 composition vocabulary, for the descriptive comparison only). */
  shareOfInnerSections: number | null
}

export interface Phase2C26A7OrientationAnalysis {
  orientationId: string
  childOutcome: string
  resultClass: string
  searchCompleted: boolean
  observationPoint: string | null
  /** The outer and inner observation instants (equal by construction for a timeout: one frozen heartbeat clock). */
  observedAtMs: { outer: number | null; inner: number | null }
  searchWallMs: number | null
  outerCoverage: number | null
  maxOuterCategory: string | null
  deliveredCandidates: number | null
  trialsStarted: number | null
  fullPlannerRunsStarted: number | null
  semanticFailures: number
  contractViolations: { outer: number | null; inner: number | null }
  memory: Json
  predictionCounts: Json
  rawSolutions: number | null
  bonusDepthWorks: number | null
  outer: Record<typeof PHASE2C26A7_OUTER_FOCUS[number], { ms: number | null; shareOfSearchWall: number | null }>
  inner: {
    sections: Phase2C26A7SectionRow[]
    sumMs: number
    /** sum(inner sections) / bonus_depth_read. */
    innerCoverageOfBonusDepthRead: number | null
    innerShareOfSearchWall: number | null
    readRemainderMs: number | null
    readRemainderShareOfBonusDepthRead: number | null
    readRemainderShareOfSearchWall: number | null
    /** The remainder split: inside depth_started -> depth_completed but outside the six sections, and outside the depth boundaries. */
    remainderSplitMs: { inDepthOutsideSections: number | null; outsideDepthBoundaries: number | null }
    dominantSection: Phase2C26A7InnerSection | null
    dominantShareOfBonusDepthRead: number | null
    completedDepths: number | null
    maxDepthReached: number | null
    streams: number | null
    activeAtObservation: Json | null
  }
  workJoin: Phase2C26A7WorkJoin
  /** A3's unchanged depth analytics of the A7 held-aware stream (completed depths of the primary Search). */
  depthAnalytics: {
    ratios: Json
    correlations: Json
    extraRatios: Json
    totals: Json
    maxGeneratedRecord: Json | null
    maxFrontierRecord: Json | null
    byDepth: Phase2C26A3OrientationAnalysis['byDepth']
    phaseDistributions: Phase2C26A3OrientationAnalysis['phaseDistributions']
  }
  activeAtEnd: { outer: Json; inner: Json }
  a6Reference: Phase2C26A7A6Reference | null
  /** Descriptive only: A3's section composition of the same primary (never compared as absolute time). */
  a3Composition: { dominantPhase: string; phaseShareOfMeasured: Record<string, number> } | null
}

export function analyzePhase2C26A7Kernel(kernel: unknown, sha256: (value: string) => string, a6Reference: Phase2C26A7A6Reference | null,
  a3Reference: Phase2C26A4A3Reference | null, prefix: Phase2C26A6WorkPrefix | null): Phase2C26A7OrientationAnalysis {
  const outer: Phase2C26A4OrientationAnalysis = analyzePhase2C26A4Kernel(kernel, sha256, a3Reference)
  const innerAnalysis: Phase2C26A3OrientationAnalysis = analyzePhase2C26A3Kernel(phase2c26a7InnerView(kernel), sha256)
  const k = isObject(kernel) ? kernel : {}
  const lastHeartbeat = heartbeatsOf(k).at(-1) ?? null
  const search = outer.primarySearch
  const innerSearch = innerAnalysis.primarySearch
  const wall = search?.searchWallMs ?? null
  const readMs = search ? search.categoryTotalsMs.bonus_depth_read : null
  const totals = innerSearch?.phaseTotalsMs ?? null
  const sumMs = totals === null ? 0 : PHASE2C26A7_INNER_SECTIONS.reduce((sum, section) => sum + totals[section], 0)
  const sections: Phase2C26A7SectionRow[] = PHASE2C26A7_INNER_SECTIONS.map(section => {
    const ms = totals?.[section] ?? 0
    return { section, totalMs: ms, shareOfSearchWall: wall === null ? null : round(share(ms, wall)), shareOfBonusDepthRead: readMs === null ? null : round(share(ms, readMs)),
      shareOfInnerSections: round(share(ms, sumMs)) }
  })
  const dominant = totals === null ? null : PHASE2C26A7_INNER_SECTIONS.reduce((best, section) => (totals[section] > totals[best] ? section : best), PHASE2C26A7_INNER_SECTIONS[0])
  const remainder = readMs === null || totals === null ? null : readMs - sumMs
  const inclusive = innerSearch?.inclusiveDepthReadMs ?? null
  const counters = isObject(outer.counters) ? outer.counters : {}
  const outerViolations = isObject(lastHeartbeat?.searchRuntime) ? num((lastHeartbeat?.searchRuntime as Json).contractViolations) : null
  const innerViolations = isObject(lastHeartbeat?.gogmaRuntime) ? num((lastHeartbeat?.gogmaRuntime as Json).contractViolations) : null
  // One extra unit the A3 analyzer does not compute: frontier_reduction_sort per frontier state after the reduction.
  const depthRecords = gogmaRecordsOf(k).filter(r => r.kind === 'gogma_depth' && r.targetOrdinal === 0)
  const perAfter = depthRecords.map(r => ({ ms: num((r.phaseMs as Json | undefined)?.frontier_reduction_sort), after: num((r.counts as Json | undefined)?.frontierStatesAfter) }))
    .filter((x): x is { ms: number; after: number } => x.ms !== null && x.after !== null && x.after > 0).map(x => (x.ms * 1e6) / x.after)
  return {
    orientationId: outer.orientationId, childOutcome: outer.childOutcome, resultClass: outer.resultClass, searchCompleted: search?.completed ?? false,
    observationPoint: search?.observationPoint ?? null, observedAtMs: { outer: search?.observedAtMs ?? null, inner: innerSearch?.observedAtMs ?? null },
    searchWallMs: wall, outerCoverage: search?.coverage ?? null, maxOuterCategory: search?.maxCategory ?? null,
    deliveredCandidates: num(counters.deliveredCandidates), trialsStarted: num(counters.trialsStarted), fullPlannerRunsStarted: num(counters.fullPlannerRunsStarted),
    semanticFailures: prefix === null || prefix.valid ? 0 : 1,
    contractViolations: { outer: outerViolations, inner: innerViolations },
    memory: outer.memory, predictionCounts: outer.predictionCounts,
    rawSolutions: search ? num(search.bonusDepth?.rawSolutions) : null, bonusDepthWorks: search ? num(search.bonusDepth?.works) : null,
    outer: Object.fromEntries(PHASE2C26A7_OUTER_FOCUS.map(category => {
      const ms = search ? search.categoryTotalsMs[category] : null
      return [category, { ms, shareOfSearchWall: ms === null || wall === null ? null : round(share(ms, wall)) }]
    })) as Phase2C26A7OrientationAnalysis['outer'],
    inner: {
      sections, sumMs,
      innerCoverageOfBonusDepthRead: readMs === null || totals === null ? null : round(share(sumMs, readMs)),
      innerShareOfSearchWall: wall === null || totals === null ? null : round(share(sumMs, wall)),
      readRemainderMs: remainder,
      readRemainderShareOfBonusDepthRead: remainder === null || readMs === null ? null : round(share(remainder, readMs)),
      readRemainderShareOfSearchWall: remainder === null || wall === null ? null : round(share(remainder, wall)),
      remainderSplitMs: { inDepthOutsideSections: inclusive === null ? null : inclusive - sumMs, outsideDepthBoundaries: inclusive === null || readMs === null ? null : readMs - inclusive },
      dominantSection: dominant,
      dominantShareOfBonusDepthRead: dominant === null || totals === null || readMs === null ? null : round(share(totals[dominant], readMs)),
      completedDepths: innerSearch?.completedDepths ?? null, maxDepthReached: innerSearch?.maxDepthReached ?? null, streams: innerSearch?.streams ?? null,
      activeAtObservation: (innerSearch?.activeAtObservation ?? null) as Json | null,
    },
    workJoin: joinPhase2C26A7Works(kernel),
    depthAnalytics: {
      ratios: innerAnalysis.ratios, correlations: innerAnalysis.correlations,
      extraRatios: { unit: 'ns per unit, per completed depth record', frontier_reduction_sort_per_frontierStateAfter: (() => {
        const d = distribution(perAfter)
        return { count: d.count, min: d.min === null ? null : round(d.min, 2), median: d.median === null ? null : round(d.median, 2), max: d.max === null ? null : round(d.max, 2) }
      })() },
      totals: innerAnalysis.totals, maxGeneratedRecord: innerAnalysis.maxGeneratedRecord as Json | null, maxFrontierRecord: innerAnalysis.maxFrontierRecord as Json | null,
      byDepth: innerAnalysis.byDepth, phaseDistributions: innerAnalysis.phaseDistributions,
    },
    activeAtEnd: { outer: outer.activeAtEnd as unknown as Json, inner: innerAnalysis.activeAtEnd as unknown as Json },
    a6Reference,
    a3Composition: a3Reference === null ? null : { dominantPhase: a3Reference.dominantPhase, phaseShareOfMeasured: { ...a3Reference.phaseShareOfMeasured } },
  }
}

// ---------------------------------------------------------------- decision (pre-registered before the formal run)

export const PHASE2C26A7_DECISION_RULE = {
  registeredPrimaryCount: PHASE2C26A7_REGISTERED_PRIMARY_COUNT,
  majority: 2,
  /** innerCoverageOfBonusDepthRead = sum(the six inner sections) / bonus_depth_read, same run, same observation instant. */
  coverageThreshold: 0.9,
  order: [
    'U inner_coverage_gap: >= 2 primaries have innerCoverageOfBonusDepthRead < 0.90 (the six sections do not explain bonus_depth_read)',
    'F dominant_inner_section: >= 2 primaries have innerCoverageOfBonusDepthRead >= 0.90 and the same largest inner section (the section with the largest wall time)',
    'M mixed: otherwise (the dominant sections differ, or the coverage is mixed)',
  ],
} as const

export type Phase2C26A7DecisionCase = 'U_inner_coverage_gap' | 'F_dominant_inner_section' | 'M_mixed'

/** What the next phase isolates when a section dominates (from the current implementation, never measured here). */
export const PHASE2C26A7_SECTION_NEXT: Record<Phase2C26A7InnerSection, string> = {
  window_collection: 'frontier stateごとのreservedWindow()（window memo lookup / nextOperationPositions）、window Set構築、positions Set集約を分離計時する。',
  support_evaluation: 'gogmaReset / gogmaKeep support判定（frontier stateごと）とunsupported記録を分離計時する。',
  state_generation: 'legal position iteration（positions sort含む）、Reset parent lookup（frontier.find）、position × frontier Keep scan、windows[index].has(position)、prediction lookup / calls（predictReset / predictKeep memo）、advanceGogmaCounter、reservedGeneratedState()（family layout key生成・result node）、execution.checkpoint()を分離計時する。',
  solution_materialization: 'solution object生成とreservedBonusSteps()（result chain走査）を分離計時する。',
  frontier_reduction_sort: 'frontier key生成（`${position}\\0${familyLayoutKey}`）、Map lookup / set、compareReservedRepresentative()（lastResetDepth比較とstableStringify(left.bonuses) / stableStringify(right.bonuses)）、frontier array materialization（[...byKey.values()]）、compareReservedFrontier sortを分離計時する。',
  exhaustion_scan: 'reduced frontier stateごとのreservedWindow()（memo hit / miss）を分離計時する。',
}

export const PHASE2C26A7_RECOMMENDATION: Record<Phase2C26A7DecisionCase, string> = {
  U_inner_coverage_gap: '既存6 sectionでbonus_depth_readを十分説明できていない。optimizationへ進まず、read remainder（depth境界内のsection外 / depth境界外のcursor claim・stream lookup・promise解決）を局所化する。',
  F_dominant_inner_section: 'dominant inner sectionを次のoptimization / 詳細局所化候補とする（本Phaseではoptimizationしない）。',
  M_mixed: 'primary間でdominant sectionまたはcoverageが分かれた。optimizationへ進まず、context差（depth / frontier規模 / legal position数）を調査する。',
}

export function phase2c26a7Decision(rows: readonly Phase2C26A7OrientationAnalysis[]) {
  const rule = PHASE2C26A7_DECISION_RULE
  const coverage = Object.fromEntries(rows.map(r => [r.orientationId, r.inner.innerCoverageOfBonusDepthRead]))
  const dominantByPrimary = Object.fromEntries(rows.map(r => [r.orientationId, r.inner.dominantSection]))
  const uncovered = rows.filter(r => r.inner.innerCoverageOfBonusDepthRead === null || r.inner.innerCoverageOfBonusDepthRead < rule.coverageThreshold).map(r => r.orientationId)
  const covered = rows.filter(r => r.inner.innerCoverageOfBonusDepthRead !== null && r.inner.innerCoverageOfBonusDepthRead >= rule.coverageThreshold)
  const groups = new Map<Phase2C26A7InnerSection, string[]>()
  for (const row of covered) {
    if (row.inner.dominantSection === null) continue
    groups.set(row.inner.dominantSection, [...(groups.get(row.inner.dominantSection) ?? []), row.orientationId])
  }
  const leading = [...groups.entries()].filter(([, ids]) => ids.length >= rule.majority).sort((a, b) => b[1].length - a[1].length)[0] ?? null
  let decisionCase: Phase2C26A7DecisionCase, reason: string, section: Phase2C26A7InnerSection | null = null
  if (rows.length !== rule.registeredPrimaryCount) { decisionCase = 'M_mixed'; reason = `primary count ${rows.length} is not the registered ${rule.registeredPrimaryCount}` }
  else if (uncovered.length >= rule.majority) {
    decisionCase = 'U_inner_coverage_gap'; reason = `innerCoverageOfBonusDepthRead < ${rule.coverageThreshold} in ${uncovered.join(', ')}`
  } else if (leading !== null) {
    decisionCase = 'F_dominant_inner_section'; section = leading[0]
    reason = `innerCoverageOfBonusDepthRead >= ${rule.coverageThreshold} and the largest inner section is ${leading[0]} in ${leading[1].join(', ')}`
  } else {
    decisionCase = 'M_mixed'
    reason = `no inner section is the largest in ${rule.majority} covered primaries (${rows.map(r => `${r.orientationId}:${r.inner.dominantSection}@${r.inner.innerCoverageOfBonusDepthRead}`).join(', ')})`
  }
  const recommendation = decisionCase === 'F_dominant_inner_section' && section !== null
    ? `${section}: ${PHASE2C26A7_RECOMMENDATION.F_dominant_inner_section} 次Phase: ${PHASE2C26A7_SECTION_NEXT[section]}`
    : PHASE2C26A7_RECOMMENDATION[decisionCase]
  return { rule, coverage, dominantByPrimary, uncoveredPrimaries: uncovered, coveredPrimaries: covered.map(r => r.orientationId),
    dominantGroups: Object.fromEntries(groups), case: decisionCase, section, reason, recommendation }
}

export function summarizePhase2C26A7(rows: readonly Phase2C26A7OrientationAnalysis[]) {
  const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0)
  const wall = sum(rows.map(r => r.searchWallMs)), read = sum(rows.map(r => r.outer.bonus_depth_read.ms)), inner = sum(rows.map(r => r.inner.sumMs))
  const pooledSections = Object.fromEntries(PHASE2C26A7_INNER_SECTIONS.map(section => {
    const ms = sum(rows.map(r => r.inner.sections.find(s => s.section === section)?.totalMs ?? null))
    return [section, { ms, shareOfSearchWall: round(share(ms, wall)), shareOfBonusDepthRead: round(share(ms, read)) }]
  }))
  return {
    orientations: rows.length,
    childStatus: Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(s => [s, rows.filter(r => r.childOutcome === s).length])),
    primarySearchCompleted: rows.filter(r => r.searchCompleted).length,
    semanticFailures: sum(rows.map(r => r.semanticFailures)),
    contractViolations: sum(rows.map(r => (r.contractViolations.outer ?? 0) + (r.contractViolations.inner ?? 0))),
    deliveredCandidates: sum(rows.map(r => r.deliveredCandidates)),
    trialsStarted: sum(rows.map(r => r.trialsStarted)),
    fullPlannerRunsStarted: sum(rows.map(r => r.fullPlannerRunsStarted)),
    rawSolutions: sum(rows.map(r => r.rawSolutions)),
    bonusDepthWorks: sum(rows.map(r => r.bonusDepthWorks)),
    pooled: {
      searchWallMs: wall, bonusDepthReadMs: read, innerSectionsMs: inner,
      bonusDepthReadShareOfSearchWall: round(share(read, wall)), innerCoverageOfBonusDepthRead: round(share(inner, read)),
      readRemainderMs: read - inner, sections: pooledSections,
    },
    decision: phase2c26a7Decision(rows),
  }
}
