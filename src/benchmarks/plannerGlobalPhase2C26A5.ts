/**
 * Issue #154 Phase 2-C2.6-A5: Bonus Ideal filter internal runtime localization, Research only. Never import from
 * Production.
 *
 * Phase 2-C2.6-A4 timed the whole Planner Alternative Search as one strict section hierarchy and found that the
 * `bonus_ideal_filter` section - `reserved.solutions.filter(solution => satisfiesIdealBonuses(...))` over every raw
 * solution of a held-aware Bonus depth - took 26-29 % of the Search wall time of all three primaries. That is the time of
 * the whole section, not of `satisfiesIdealBonuses()` alone. This phase asks where the CPU time inside that section goes,
 * without a per-solution timer (a timer around a ~1.5 us body, 3e8 times, would measure itself): a low-overhead V8
 * sampling CPU profiler (`node:inspector` `Profiler`, 10 ms) runs in the Research child over a fixed steady-state window,
 * and the child records the `bonus_ideal_filter` section boundaries A4's unchanged observer already reports. The analysis
 * (`plannerGlobalPhase2C26A5Analysis.ts`) keeps only the samples whose timestamp falls inside a filter interval and
 * classifies their stacks.
 *
 * Nothing in the Production Search changes: the only Search instrumentation is A4's `onSearchRuntime` observer (A4's
 * tracker, durable records and heartbeat unchanged); this module wraps it to stamp the filter boundaries. The profiler
 * is an external observation of the child and never a Search input.
 *
 * Authorities. The committed Phase 2-C2.6-A4 RESULT (formal, Case O, category `bonus_ideal_filter`) is the primary
 * selection authority; it must have been made against exactly the committed C2.6-A / A2 / A3 RESULT files read (SHA
 * chain). No orientation ID is fixed here: the primaries and the no-inlining diagnostic representative are derived from
 * the A4 RESULT.
 *
 * Conditions. Every A4 condition (heap, budget, concurrency 1, yield, extent, bounds, Research maxPlanSteps,
 * CalculationContext, empty lineage, Node flags of the primaries) is unchanged; only the profiler is added. No absolute
 * wall time is compared with A4 - only the sample shares inside each A5 profile.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativeKernelInstrumentation } from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { SearchRuntimeDepthWork, SearchRuntimeObserver } from '../domain/search/searchRuntime'
import type { Phase2C2KernelRecord, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import type { Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import type { Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import {
  PHASE2C26A4_CHILD_HEAP_MB,
  PHASE2C26A4_CONCURRENCY,
  PHASE2C26A4_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A4_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A4_NODE_YIELD,
  PHASE2C26A4_ORIENTATION_BUDGET_MS,
  PHASE2C26A4_SEARCH_INSTRUMENTATION,
  runPhase2C26A4Kernel,
  validatePhase2C26A4ConditionParity,
  type Phase2C26A4A3Authority,
} from './plannerGlobalPhase2C26A4'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- conditions

/** Phase 2-C2.6-A4's heap, budget, concurrency 1, yield, memory sampling, heartbeat and Search instrumentation, unchanged. */
export const PHASE2C26A5_CHILD_HEAP_MB = PHASE2C26A4_CHILD_HEAP_MB
export const PHASE2C26A5_ORIENTATION_BUDGET_MS = PHASE2C26A4_ORIENTATION_BUDGET_MS
export const PHASE2C26A5_CONCURRENCY = PHASE2C26A4_CONCURRENCY
export const PHASE2C26A5_NODE_YIELD = PHASE2C26A4_NODE_YIELD
export const PHASE2C26A5_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A4_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A5_HEARTBEAT_INTERVAL_MS = PHASE2C26A4_HEARTBEAT_INTERVAL_MS
export const PHASE2C26A5_SEARCH_INSTRUMENTATION = PHASE2C26A4_SEARCH_INSTRUMENTATION

/**
 * The pre-registered CPU profiler conditions (fixed before any formal run, never changed after seeing a result). The
 * window is relative to the start of the kernel's first Search (`search_runtime` section start): 120 s warmup, then
 * 600 s of sampling. The profiler is started / stopped from a timer, which runs only at an event loop yield of the
 * Search, so the actual start / stop are later than requested; both are recorded.
 */
export const PHASE2C26A5_PROFILER = {
  requestedSamplingIntervalUs: 10_000,
  warmupMs: 120_000,
  profileStopMs: 720_000,
  requestedProfileDurationMs: 600_000,
} as const

/** The Production-like primary evidence: JIT default, only the A4 heap flag. */
export const PHASE2C26A5_PRIMARY_NODE_FLAGS: readonly string[] = [`--max-old-space-size=${PHASE2C26A5_CHILD_HEAP_MB}`]
/** The diagnostic only (never Production-like): function-level attribution without TurboFan / Maglev inlining. */
export const PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS: readonly string[] = ['--no-turbo-inlining', '--no-maglev-inlining', `--max-old-space-size=${PHASE2C26A5_CHILD_HEAP_MB}`]
/**
 * The diagnostic child stops its own kernel run once its profile is written (it need not reproduce the 30-minute
 * outcome); this budget is only the parent's safety kill.
 */
export const PHASE2C26A5_DIAGNOSTIC_BUDGET_MS = 900_000

/** The Repository source files whose frames the classification needs; each must have a source map in the child. */
export const PHASE2C26A5_REQUIRED_SOURCE_FILES: readonly string[] = [
  'src/domain/target/targetEvaluator.ts',
  'src/domain/target/bonusConditionEvaluator.ts',
  'src/domain/master/masterSelectors.ts',
  'src/domain/models/domainRules.ts',
  'src/domain/search/targetSearchScheduler.ts',
]

/** The registered Phase 2-C2.6-A4 RESULT this phase is made against. */
export const PHASE2C26A5_REGISTERED_A4 = {
  orientations: 3,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 },
  decisionCase: 'O_outer_bottleneck',
  decisionCategory: 'bonus_ideal_filter',
  /** Every A4 primary must itself satisfy these (the A4 evidence this phase localizes). */
  coverageThreshold: 0.9,
  filterShareThreshold: 0.1,
} as const
export const PHASE2C26A5_REGISTERED_PRIMARY_COUNT = 3

// ---------------------------------------------------------------- the Phase 2-C2.6-A4 RESULT (selection authority)

/** A4's own evidence for one primary, referenced (never compared as absolute wall time). */
export interface Phase2C26A5A4Reference {
  orientationId: string
  childOutcome: string
  searchWallMs: number
  coverage: number
  bonusIdealFilterShare: number
  bonusDepthReadShare: number
  bonusNoticeScanShare: number
  bonusIdealFilterMs: number
  rawSolutions: number | null
  idealSolutions: number | null
  /** Median over completed Bonus depth works of the section time / raw solutions (ns), as A4 recorded it. */
  bonusIdealFilterMedianNsPerRawSolution: number | null
  deliveredCandidates: number | null
  predictionCounts: Json | null
}

export interface Phase2C26A5A4Authority {
  measuredHead: string
  analysisHead: string
  conditions: Json
  primaryOrientationIds: string[]
  references: Phase2C26A5A4Reference[]
  /** The SHA-256 A4 recorded for each earlier authority (each equal to the file read). */
  recordedShas: { c26a: string; a2: string; a3: string }
}

export interface Phase2C26A5A4AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A5A4Authority | null
}

function a4Reference(value: unknown): Phase2C26A5A4Reference | null {
  if (!isObject(value) || typeof value.orientationId !== 'string' || !isObject(value.primarySearch)) return null
  const search = value.primarySearch
  const share = isObject(search.categoryShare) ? search.categoryShare : null
  const totals = isObject(search.categoryTotalsMs) ? search.categoryTotalsMs : null
  const searchWallMs = num(search.searchWallMs), coverage = num(search.coverage)
  if (share === null || totals === null || searchWallMs === null || coverage === null) return null
  const filterShare = num(share.bonus_ideal_filter), readShare = num(share.bonus_depth_read), noticeShare = num(share.bonus_notice_scan)
  const filterMs = num(totals.bonus_ideal_filter)
  if (filterShare === null || readShare === null || noticeShare === null || filterMs === null) return null
  const depth = isObject(search.bonusDepth) ? search.bonusDepth : {}
  const work = isObject(value.bonusWork) ? value.bonusWork : {}
  const ns = isObject(work.nsPerRawSolution) && isObject(work.nsPerRawSolution.bonus_ideal_filter) ? work.nsPerRawSolution.bonus_ideal_filter : {}
  const counters = isObject(value.counters) ? value.counters : {}
  return {
    orientationId: value.orientationId, childOutcome: String(value.childOutcome), searchWallMs, coverage,
    bonusIdealFilterShare: filterShare, bonusDepthReadShare: readShare, bonusNoticeScanShare: noticeShare, bonusIdealFilterMs: filterMs,
    rawSolutions: num(depth.rawSolutions), idealSolutions: num(depth.idealSolutions), bonusIdealFilterMedianNsPerRawSolution: num(ns.median),
    deliveredCandidates: num(counters.deliveredCandidates), predictionCounts: isObject(value.predictionCounts) ? value.predictionCounts : null,
  }
}

/**
 * Reads the committed Phase 2-C2.6-A4 RESULT as untrusted JSON and fails closed unless it is the registered formal A4
 * result (Case O, category `bonus_ideal_filter`, 3 primaries, 3 timeouts, every primary with coverage >= 0.90 and a
 * `bonus_ideal_filter` share >= 0.10) made against exactly the C2.6-A / A2 / A3 RESULT files read (SHA chain, including
 * the SHAs A4 recorded for the earlier authorities), and its selection is the A3 primary set. The primaries are the A4
 * selection, never fixed here.
 */
export function parsePhase2C26A4ResultAuthority(json: unknown, actual: { c26a: string; a2: string; a3: string },
  a3: Pick<Phase2C26A4A3Authority, 'primaryOrientationIds'>, c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A5A4AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A5A4AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A4 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const selection = isObject(json.selectionValidation) ? json.selectionValidation : null
  const rule = isObject(json.selectionRule) ? json.selectionRule : null
  if (!provenance || !summary || !conditions || !selection || !rule) return fail('A4 RESULT lacks provenance / summary / conditions / selection')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (selection.valid !== true) issues.push('selectionValidation.valid is not true')
  const expected = PHASE2C26A5_REGISTERED_A4
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  const decision = isObject(summary.decision) ? summary.decision : {}
  if (decision.case !== expected.decisionCase) issues.push(`summary.decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  if (decision.category !== expected.decisionCategory) issues.push(`summary.decision.category ${String(decision.category)} is not ${expected.decisionCategory}`)

  // The SHA chain: A4 was made against exactly the C2.6-A / A2 / A3 files read, and every SHA A4 recorded agrees.
  const chain = isObject(provenance.authorityShaChain) ? provenance.authorityShaChain : {}
  const shaChecks: [unknown, string, string][] = [
    [provenance.c26aResultSha256, actual.c26a, 'provenance.c26aResultSha256'],
    [provenance.c26aResultRecordedByRunner, actual.c26a, 'provenance.c26aResultRecordedByRunner'],
    [provenance.c26a2ResultSha256, actual.a2, 'provenance.c26a2ResultSha256'],
    [provenance.c26a2ResultRecordedByRunner, actual.a2, 'provenance.c26a2ResultRecordedByRunner'],
    [provenance.c26a3ResultSha256, actual.a3, 'provenance.c26a3ResultSha256'],
    [provenance.c26a3ResultRecordedByRunner, actual.a3, 'provenance.c26a3ResultRecordedByRunner'],
    [chain.c26aShaRecordedByA2, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA2'],
    [chain.c26aShaRecordedByA3, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA3'],
    [chain.c26aShaRecordedByA3ForA2, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA3ForA2'],
    [chain.a2ShaRecordedByA3, actual.a2, 'provenance.authorityShaChain.a2ShaRecordedByA3'],
  ]
  for (const [recorded, actualSha, field] of shaChecks) if (recorded !== actualSha) issues.push(`A4 ${field} is not the SHA-256 of the file read`)
  if (chain.allMatchFilesRead !== true) issues.push('A4 provenance.authorityShaChain.allMatchFilesRead is not true')
  const sources = isObject(json.sources) ? json.sources : {}
  if (!isObject(sources.c26aResult) || sources.c26aResult.sha256 !== actual.c26a) issues.push('A4 sources.c26aResult.sha256 differs')
  if (!isObject(sources.c26a2Result) || sources.c26a2Result.sha256 !== actual.a2) issues.push('A4 sources.c26a2Result.sha256 differs')
  if (!isObject(sources.c26a3Result) || sources.c26a3Result.sha256 !== actual.a3) issues.push('A4 sources.c26a3Result.sha256 differs')
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A4 provenance.exportSha256 is not the C2.6-A Export')
  if (conditions.exportSha256 !== c26a.conditions.exportSha256) issues.push('A4 conditions.exportSha256 is not the C2.6-A Export')

  const primaries = asArray(selection.expected).filter((id): id is string => typeof id === 'string')
  if (primaries.length !== asArray(selection.expected).length) issues.push('A4 selectionValidation.expected is malformed')
  if (!same(primaries, asArray(selection.actual))) issues.push('A4 selectionValidation.actual is not its expected list')
  if (!same(primaries, asArray(rule.primaryOrientationIds))) issues.push('A4 selectionRule.primaryOrientationIds is not its selection')
  if (!same(primaries, a3.primaryOrientationIds)) issues.push('A4 selection is not the A3 primary set')
  if (new Set(primaries).size !== primaries.length) issues.push('A4 selection has a duplicate')
  if (primaries.length !== PHASE2C26A5_REGISTERED_PRIMARY_COUNT) issues.push(`A4 selection has ${primaries.length} primaries, not ${PHASE2C26A5_REGISTERED_PRIMARY_COUNT}`)
  const references: Phase2C26A5A4Reference[] = []
  for (const value of asArray(json.perOrientation)) {
    const reference = a4Reference(value)
    if (reference === null) { issues.push('an A4 perOrientation row is malformed'); continue }
    references.push(reference)
  }
  if (!same(references.map(r => r.orientationId), primaries)) issues.push('A4 perOrientation is not exactly its selection, in order')
  for (const reference of references) {
    if (reference.childOutcome !== 'timeout') issues.push(`A4 row ${reference.orientationId} is not a timeout`)
    if (!(reference.coverage >= expected.coverageThreshold)) issues.push(`A4 row ${reference.orientationId} coverage ${reference.coverage} < ${expected.coverageThreshold}`)
    if (!(reference.bonusIdealFilterShare >= expected.filterShareThreshold)) issues.push(`A4 row ${reference.orientationId} bonus_ideal_filter share ${reference.bonusIdealFilterShare} < ${expected.filterShareThreshold}`)
  }
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), conditions,
    primaryOrientationIds: primaries, references, recordedShas: { c26a: actual.c26a, a2: actual.a2, a3: actual.a3 } } }
}

// ---------------------------------------------------------------- the no-inlining diagnostic representative

export interface Phase2C26A5DiagnosticSelection {
  rule: string
  /** The A4 primaries in the rule's order (ascending `bonus_ideal_filter` share, ties in A4 selection order). */
  ordered: { orientationId: string; bonusIdealFilterShare: number; a4SelectionIndex: number }[]
  representativeOrientationId: string
}

/**
 * One diagnostic representative, derived mechanically from the A4 evidence: sort the A4 primaries by their
 * `bonus_ideal_filter` share ascending (ties in A4 selection order) and take the middle one. No ID is fixed.
 */
export function selectPhase2C26A5DiagnosticRepresentative(a4: Pick<Phase2C26A5A4Authority, 'primaryOrientationIds' | 'references'>): Phase2C26A5DiagnosticSelection {
  const ordered = a4.primaryOrientationIds.map((orientationId, a4SelectionIndex) => {
    const reference = a4.references.find(r => r.orientationId === orientationId)
    if (!reference) throw new Error(`A4 primary ${orientationId} has no reference row`)
    return { orientationId, bonusIdealFilterShare: reference.bonusIdealFilterShare, a4SelectionIndex }
  }).sort((a, b) => a.bonusIdealFilterShare - b.bonusIdealFilterShare || a.a4SelectionIndex - b.a4SelectionIndex)
  if (ordered.length === 0) throw new Error('No A4 primary to select a diagnostic representative from')
  return {
    rule: 'A4 primaries sorted by bonus_ideal_filter share ascending (ties: A4 selection order); the middle one (index floor(n / 2))',
    ordered,
    representativeOrientationId: ordered[Math.floor(ordered.length / 2)].orientationId,
  }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A5ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean }[]
}

/**
 * Every A4 primary condition must be equal (concurrency 1 and the primary Node flags included), and A4's own conditions
 * must pass A4's parity against A3 / C2.6-A / A2.
 */
export function validatePhase2C26A5ConditionParity(current: Phase2C26A2RunConditions & { nodeFlags: readonly string[] }, a4Conditions: Json,
  a3Conditions: Json, c26a: Pick<Phase2C26A2Authority, 'conditions'>, a2Conditions: Json): Phase2C26A5ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage', 'nodeFlags'] as const
  const currentJson = current as unknown as Json
  const checks: Phase2C26A5ConditionParity['checks'] = keys.map(condition => ({ condition, current: currentJson[condition], authority: a4Conditions[condition],
    matches: same(currentJson[condition], a4Conditions[condition]) }))
  checks.push({ condition: 'concurrency is 1', current: current.concurrency, authority: PHASE2C26A5_CONCURRENCY, matches: current.concurrency === PHASE2C26A5_CONCURRENCY })
  checks.push({ condition: 'primary nodeFlags', current: current.nodeFlags, authority: PHASE2C26A5_PRIMARY_NODE_FLAGS, matches: same(current.nodeFlags, PHASE2C26A5_PRIMARY_NODE_FLAGS) })
  checks.push({ condition: 'A4 searchInstrumentation', current: PHASE2C26A5_SEARCH_INSTRUMENTATION, authority: a4Conditions.searchInstrumentation,
    matches: same(PHASE2C26A5_SEARCH_INSTRUMENTATION, a4Conditions.searchInstrumentation) })
  const a4Parity = validatePhase2C26A4ConditionParity(a4Conditions as unknown as Phase2C26A2RunConditions, a3Conditions, c26a, a2Conditions)
  for (const check of a4Parity.checks) checks.push({ condition: `a4.${check.condition}`, current: check.current, authority: check.authority, matches: check.matches })
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

/** Type-only re-export for callers that also need the A2 authority shape. */
export type Phase2C26A5A2Authority = Phase2C26A3A2Authority

// ---------------------------------------------------------------- filter interval tracker

export interface Phase2C26A5FilterInterval {
  targetOrdinal: number
  /** Research clock (`performance.now()` of the child), ms. */
  startMs: number
  endMs: number
  /** The enclosing `bonus_depth_work`'s channel / depth, when reported. */
  channel: number | null
  depth: number | null
}

export interface Phase2C26A5FilterIntervalSnapshot {
  intervals: Phase2C26A5FilterInterval[]
  /** Filter sections completed after the tracker was frozen (counted, not kept). */
  completedAfterFreeze: number
  /** A filter section open at the snapshot instant (never expected at a timer callback: the section is synchronous). */
  openAtSnapshot: { targetOrdinal: number; startMs: number } | null
  violations: number
  violationSamples: string[]
}

/**
 * Stamps the `bonus_ideal_filter` section boundaries A4's observer already receives. The start is stamped AFTER A4's
 * own handling of the start event (its durable section start record) and the end BEFORE A4's handling of the
 * completion, so the interval bounds the filter call itself and none of A4's Research work. It keeps one compact record
 * per filter section (never per solution), and after `freeze()` it only counts. It never throws into the Search; a
 * boundary contract breach is counted.
 */
export function createPhase2C26A5FilterIntervalTracker(options: {
  now: () => number
  onSearchStarted?: (atMs: number) => void
}) {
  const intervals: Phase2C26A5FilterInterval[] = []
  const work = new Map<number, SearchRuntimeDepthWork | null>()
  let open: { targetOrdinal: number; startMs: number; work: SearchRuntimeDepthWork | null } | null = null
  let frozen = false
  let completedAfterFreeze = 0
  let searchStarted = false
  let violations = 0
  const samples: string[] = []
  const violate = (message: string) => { violations += 1; if (samples.length < 20) samples.push(message) }
  return {
    wrap(base: SearchRuntimeObserver, targetOrdinal: number): SearchRuntimeObserver {
      return (event) => {
        if (event.type === 'section_started') {
          base(event)
          if (event.section === 'search_runtime' && !searchStarted) { searchStarted = true; options.onSearchStarted?.(options.now()) }
          if (event.section === 'bonus_depth_work') work.set(targetOrdinal, event.work ?? null)
          if (event.section === 'bonus_ideal_filter') {
            if (open !== null) violate(`t${targetOrdinal}: filter started while another is open`)
            open = { targetOrdinal, startMs: options.now(), work: work.get(targetOrdinal) ?? null }
          }
          return
        }
        if (event.section === 'bonus_ideal_filter') {
          const endMs = options.now()
          if (open === null || open.targetOrdinal !== targetOrdinal) violate(`t${targetOrdinal}: filter completed while none is open`)
          else if (frozen) completedAfterFreeze += 1
          else intervals.push({ targetOrdinal, startMs: open.startMs, endMs, channel: open.work?.channel ?? null, depth: open.work?.depth ?? null })
          open = null
        }
        if (event.section === 'bonus_depth_work') work.delete(targetOrdinal)
        base(event)
      }
    },
    /** Stops keeping intervals (the profile has stopped); later ones are only counted. */
    freeze(): void { frozen = true },
    snapshot(): Phase2C26A5FilterIntervalSnapshot {
      return { intervals: intervals.map(i => ({ ...i })), completedAfterFreeze, openAtSnapshot: open === null ? null : { targetOrdinal: open.targetOrdinal, startMs: open.startMs },
        violations, violationSamples: [...samples] }
    },
  }
}

/**
 * The A5 kernel instrumentation: A4's lifecycle / Search instrumentation unchanged, with each Target's `onSearchRuntime`
 * wrapped by the filter interval tracker. No other Search instrumentation is attached.
 */
export function createPhase2C26A5KernelInstrumentation(a4: PlannerAlternativeKernelInstrumentation,
  tracker: Pick<ReturnType<typeof createPhase2C26A5FilterIntervalTracker>, 'wrap'>): PlannerAlternativeKernelInstrumentation {
  return {
    onEvent: a4.onEvent,
    searchInstrumentationForTarget: (targetWeaponId, targetOrdinal) => {
      const inner = a4.searchInstrumentationForTarget?.(targetWeaponId, targetOrdinal)
      const base = inner?.onSearchRuntime
      if (inner === undefined || base === undefined) throw new Error('The A4 instrumentation must provide onSearchRuntime for every Target.')
      return { ...inner, onSearchRuntime: tracker.wrap(base, targetOrdinal) }
    },
  }
}

// ---------------------------------------------------------------- profile window controller

/** One reading of both clocks: `performance.now()` (the Research clock) and `process.hrtime` (the V8 profile clock), ms. */
export interface Phase2C26A5ClockPair {
  perfMs: number
  hrMs: number
  /** Width of the perf reads bracketing the hrtime read (the pair's own precision). */
  precisionMs: number
}

export interface Phase2C26A5ProfileWindow {
  requestedSamplingIntervalUs: number
  warmupMs: number
  profileStopMs: number
  requestedProfileDurationMs: number
  /** Research clock of the kernel's first Search start. */
  searchStartedMs: number | null
  startPre: Phase2C26A5ClockPair | null
  startPost: Phase2C26A5ClockPair | null
  stopPre: Phase2C26A5ClockPair | null
  stopPost: Phase2C26A5ClockPair | null
  /** Relative to the Search start. */
  actualStartElapsedMs: number | null
  actualStopElapsedMs: number | null
  actualProfileDurationMs: number | null
  startDelayMs: number | null
  stopDelayMs: number | null
  stoppedBy: 'window' | 'kernel_ended' | null
  error: string | null
}

/**
 * Starts the profiler `warmupMs` after the kernel's first Search starts and stops it `profileStopMs` after, from timers
 * (so only at an event loop yield), reading both clocks around each call. The profiler operations are injected (the
 * child passes `node:inspector`). On stop it freezes the interval tracker and hands the profile to `onCaptured`. A
 * failure is recorded, never thrown into the Search.
 */
export function createPhase2C26A5ProfileController(options: {
  clockPair: () => Phase2C26A5ClockPair
  setTimer: (callback: () => void, delayMs: number) => void
  startProfiler: () => Promise<void>
  stopProfiler: () => Promise<unknown>
  onCaptured: (profile: unknown, window: Phase2C26A5ProfileWindow) => void | Promise<void>
  onFrozen?: () => void
  config?: typeof PHASE2C26A5_PROFILER
}) {
  const config = options.config ?? PHASE2C26A5_PROFILER
  const window: Phase2C26A5ProfileWindow = {
    requestedSamplingIntervalUs: config.requestedSamplingIntervalUs, warmupMs: config.warmupMs, profileStopMs: config.profileStopMs,
    requestedProfileDurationMs: config.requestedProfileDurationMs, searchStartedMs: null, startPre: null, startPost: null, stopPre: null, stopPost: null,
    actualStartElapsedMs: null, actualStopElapsedMs: null, actualProfileDurationMs: null, startDelayMs: null, stopDelayMs: null, stoppedBy: null, error: null,
  }
  let state: 'waiting' | 'scheduled' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' = 'waiting'
  let captured: Promise<void> | null = null
  const elapsed = (pair: Phase2C26A5ClockPair) => pair.perfMs - (window.searchStartedMs as number)
  const fail = (error: unknown) => { state = 'failed'; window.error = String(error) }

  const stop = async (by: 'window' | 'kernel_ended') => {
    if (state !== 'running') return
    state = 'stopping'
    try {
      window.stopPre = options.clockPair()
      const profile = await options.stopProfiler()
      window.stopPost = options.clockPair()
      options.onFrozen?.()
      window.stoppedBy = by
      window.actualStopElapsedMs = elapsed(window.stopPre)
      window.stopDelayMs = window.actualStopElapsedMs - config.profileStopMs
      window.actualProfileDurationMs = window.stopPre.perfMs - (window.startPost as Phase2C26A5ClockPair).perfMs
      state = 'stopped'
      await options.onCaptured(profile, { ...window })
    } catch (error) { fail(error) }
  }
  const start = async () => {
    if (state !== 'scheduled') return
    state = 'starting'
    try {
      window.startPre = options.clockPair()
      await options.startProfiler()
      window.startPost = options.clockPair()
      window.actualStartElapsedMs = elapsed(window.startPost)
      window.startDelayMs = window.actualStartElapsedMs - config.warmupMs
      state = 'running'
      options.setTimer(() => { captured = stop('window') }, Math.max(0, window.searchStartedMs as number + config.profileStopMs - window.startPost.perfMs))
    } catch (error) { fail(error) }
  }
  return {
    /** Call once, at the kernel's first Search start (Research clock). */
    onSearchStarted(atMs: number): void {
      if (state !== 'waiting') return
      window.searchStartedMs = atMs
      state = 'scheduled'
      options.setTimer(() => { void start() }, config.warmupMs)
    },
    /** Call when the kernel returned or threw: stops a running profile early (`kernel_ended`). */
    async onKernelEnded(): Promise<void> {
      if (state === 'running') await stop('kernel_ended')
      else if (captured !== null) await captured
    },
    /** Resolves when a `window` stop has written its capture. */
    async settled(): Promise<void> { if (captured !== null) await captured },
    state: () => state,
    window: (): Phase2C26A5ProfileWindow => ({ ...window }),
  }
}

/** One profiled kernel child calculation: the unchanged A4 kernel helper with the A5 (= A4 + interval stamps) instrumentation. */
export function runPhase2C26A5Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26A4Kernel(input, task, dependencies, instrumentation)
}
