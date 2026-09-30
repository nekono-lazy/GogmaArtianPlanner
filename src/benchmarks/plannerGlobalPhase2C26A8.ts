/**
 * Issue #154 Phase 2-C2.6-A8: formal CPU attribution inside the held-aware Gogma `frontier_reduction_sort` section,
 * Research only. Never import from Production.
 *
 * Phase 2-C2.6-A7 (Case F) timed `bonus_depth_read` and the six `readReservedDepth()` sections in one run and found that
 * `frontier_reduction_sort` - the per-(position, family layout) representative reduction of one held-aware depth and the
 * sort of the reduced frontier - is the largest section in all three primaries (53-59 % of `bonus_depth_read`, 48-54 %
 * of the Search wall). One orientation already handles 3-4e8 generated states in 30 minutes, so a per-state timer or
 * callback inside the reduction would measure itself. This phase therefore adds no Production seam: it keeps exactly the
 * A7 instrumentation (A4's `onSearchRuntime` and A3's `onGogmaReservedRuntime`, whose durable held-aware stream already
 * carries every section boundary) and adds the A5 V8 sampling CPU profiler (`node:inspector` `Profiler`, 10 ms, Search
 * start + 120 s .. + 720 s). The analysis (`plannerGlobalPhase2C26A8Analysis.ts`) rebuilds the `frontier_reduction_sort`
 * intervals from the A3 stream, keeps only the samples whose timestamp falls inside one, and classifies their stacks.
 *
 * Authorities. The committed Phase 2-C2.6-A7 RESULT (formal, Case F, section `frontier_reduction_sort`) is the primary
 * selection and hotspot authority; it must have been made against exactly the committed C2.6-A .. A6 RESULT files read
 * (SHA chain). No orientation ID is fixed here: the primaries and the no-inlining diagnostic representative are derived
 * from the A7 RESULT. There is no Production calculation change since the A7 measured HEAD.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativeKernelInstrumentation } from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { SearchRuntimeObserver } from '../domain/search/searchRuntime'
import type { Phase2C2KernelRecord, Phase2C2Orientation, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import type { Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { PHASE2C26A5_DIAGNOSTIC_BUDGET_MS, PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS, PHASE2C26A5_PROFILER } from './plannerGlobalPhase2C26A5'
import { isPhase2C26A6ResearchOrTestSource } from './plannerGlobalPhase2C26A6'
import {
  PHASE2C26A7_CHILD_HEAP_MB,
  PHASE2C26A7_CONCURRENCY,
  PHASE2C26A7_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A7_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A7_NODE_FLAGS,
  PHASE2C26A7_NODE_YIELD,
  PHASE2C26A7_ORIENTATION_BUDGET_MS,
  PHASE2C26A7_SEARCH_INSTRUMENTATION,
  runPhase2C26A7Kernel,
  selectPhase2C26A7Tasks,
  validatePhase2C26A7ConditionParity,
  validatePhase2C26A7Selection,
  type Phase2C26A7A6Authority,
} from './plannerGlobalPhase2C26A7'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

/** The one section this phase attributes. */
export const PHASE2C26A8_SECTION = 'frontier_reduction_sort' as const

// ---------------------------------------------------------------- conditions

/** Phase 2-C2.6-A7's heap, budget, concurrency 1, yield, memory sampling, heartbeat and heap-only Node flags, unchanged. */
export const PHASE2C26A8_CHILD_HEAP_MB = PHASE2C26A7_CHILD_HEAP_MB
export const PHASE2C26A8_ORIENTATION_BUDGET_MS = PHASE2C26A7_ORIENTATION_BUDGET_MS
export const PHASE2C26A8_CONCURRENCY = PHASE2C26A7_CONCURRENCY
export const PHASE2C26A8_NODE_YIELD = PHASE2C26A7_NODE_YIELD
export const PHASE2C26A8_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A7_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A8_HEARTBEAT_INTERVAL_MS = PHASE2C26A7_HEARTBEAT_INTERVAL_MS
/** The Production-like primary evidence: JIT default, only the heap flag (= A7). */
export const PHASE2C26A8_PRIMARY_NODE_FLAGS: readonly string[] = PHASE2C26A7_NODE_FLAGS
/** The A7 pair of section boundary observers, unchanged (no depth / work observer, no new seam). */
export const PHASE2C26A8_SEARCH_INSTRUMENTATION = PHASE2C26A7_SEARCH_INSTRUMENTATION
/**
 * The A5 CPU profiler conditions, unchanged (fixed before any formal run): 10 ms requested sampling, the window relative
 * to the kernel's first Search start, 120 s warmup, then 600 s of sampling. Started / stopped from timers, so only at an
 * event loop yield; the actual delays are recorded. The only registered difference from A7.
 */
export const PHASE2C26A8_PROFILER = PHASE2C26A5_PROFILER
/** The diagnostic only (never Production-like): no TurboFan / Maglev inlining, as in A5. */
export const PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS: readonly string[] = PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS
/** The diagnostic stops its own run once its profile is written; this is only the parent's safety kill. */
export const PHASE2C26A8_DIAGNOSTIC_BUDGET_MS = PHASE2C26A5_DIAGNOSTIC_BUDGET_MS

/** The Repository source files whose frames the classification needs; each must have a source map in the child. */
export const PHASE2C26A8_REQUIRED_SOURCE_FILES: readonly string[] = [
  'src/domain/search/bonusStream.ts',
  'src/domain/models/hashing.ts',
  'src/domain/search/semanticKeys.ts',
]

// ---------------------------------------------------------------- no Production change

/** A8 is Research only: no Production calculation source may differ from the A7 measured HEAD. */
export const PHASE2C26A8_PRODUCTION_CHANGE: readonly string[] = []

export interface Phase2C26A8ProductionChangeValidation {
  valid: boolean
  issues: string[]
  changed: string[]
  productionChanged: string[]
}

/** The changed paths under `src` since the A7 measured HEAD must hold no Production calculation source (Research / test only). */
export function validatePhase2C26A8NoProductionChange(changedSrcPaths: readonly string[]): Phase2C26A8ProductionChangeValidation {
  const changed = [...changedSrcPaths]
  const issues: string[] = []
  const outsideSrc = changed.filter(path => !path.startsWith('src/'))
  if (outsideSrc.length > 0) issues.push(`paths outside src were given: ${outsideSrc.join(', ')}`)
  const productionChanged = [...new Set(changed.filter(path => path.startsWith('src/') && !isPhase2C26A6ResearchOrTestSource(path)))].sort()
  if (productionChanged.length > 0) issues.push(`Production calculation change since the A7 measured HEAD: ${productionChanged.join(', ')}`)
  return { valid: issues.length === 0, issues, changed, productionChanged }
}

// ---------------------------------------------------------------- the Phase 2-C2.6-A7 RESULT (selection / hotspot authority)

/** The registered Phase 2-C2.6-A7 RESULT this phase is made against. */
export const PHASE2C26A8_REGISTERED_A7 = {
  orientations: 3,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 },
  primarySearchCompleted: 0,
  semanticFailures: 0,
  contractViolations: 0,
  decisionCase: 'F_dominant_inner_section',
  decisionSection: PHASE2C26A8_SECTION,
  /** Each A7 primary's dominant inner section, with at least this inner coverage of `bonus_depth_read`. */
  coverageThreshold: 0.9,
} as const
export const PHASE2C26A8_REGISTERED_PRIMARY_COUNT = 3

/** A7's own evidence for one primary, referenced (never compared as absolute wall time). */
export interface Phase2C26A8A7Reference {
  orientationId: string
  childOutcome: string
  searchWallMs: number
  bonusDepthReadMs: number
  innerCoverageOfBonusDepthRead: number
  dominantSection: string
  frontierReductionSortMs: number
  frontierShareOfBonusDepthRead: number
  frontierShareOfSearchWall: number
  generatedStates: number | null
  frontierStatesAfter: number | null
  completedDepths: number | null
}

export interface Phase2C26A8A7Authority {
  measuredHead: string
  analysisHead: string
  conditions: Json
  primaryOrientationIds: string[]
  references: Phase2C26A8A7Reference[]
  decisionCase: string
  decisionSection: string
  /** The A7 raw run the A7 RESULT recorded (the semantic parity reference). */
  runSha256: string
}

export interface Phase2C26A8A7AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A8A7Authority | null
}

function a7Reference(value: unknown): Phase2C26A8A7Reference | null {
  if (!isObject(value) || typeof value.orientationId !== 'string' || !isObject(value.inner) || !isObject(value.outer)) return null
  const inner = value.inner
  const read = isObject(value.outer.bonus_depth_read) ? num(value.outer.bonus_depth_read.ms) : null
  const wall = num(value.searchWallMs), coverage = num(inner.innerCoverageOfBonusDepthRead)
  const section = asArray(inner.sections).filter(isObject).find(row => row.section === PHASE2C26A8_SECTION)
  if (read === null || wall === null || coverage === null || section === undefined || typeof inner.dominantSection !== 'string') return null
  const ms = num(section.totalMs), ofRead = num(section.shareOfBonusDepthRead), ofWall = num(section.shareOfSearchWall)
  if (ms === null || ofRead === null || ofWall === null) return null
  const totals = isObject(value.depthAnalytics) && isObject(value.depthAnalytics.totals) ? value.depthAnalytics.totals : {}
  return { orientationId: value.orientationId, childOutcome: String(value.childOutcome), searchWallMs: wall, bonusDepthReadMs: read, innerCoverageOfBonusDepthRead: coverage,
    dominantSection: inner.dominantSection, frontierReductionSortMs: ms, frontierShareOfBonusDepthRead: ofRead, frontierShareOfSearchWall: ofWall,
    generatedStates: num(totals.generatedStates), frontierStatesAfter: num(totals.frontierStatesAfter), completedDepths: num(inner.completedDepths) }
}

/**
 * Reads the committed Phase 2-C2.6-A7 RESULT as untrusted JSON and fails closed unless it is the registered formal A7
 * result (Case F, section `frontier_reduction_sort`, 3 primaries, 3 timeouts, no OOM / process failure / semantic failure /
 * contract violation, each primary's dominant inner section `frontier_reduction_sort` with an inner coverage >= 0.90) made
 * against exactly the C2.6-A .. A6 RESULT files read (SHA chain, including every SHA A7 recorded for A6's own chain) and
 * the A6 raw run the A6 RESULT recorded, and its selection is the A6 selection. The primaries are that selection.
 */
export function parsePhase2C26A7ResultAuthority(json: unknown, actual: { c26a: string; a2: string; a3: string; a4: string; a5: string; a6: string },
  a6: Pick<Phase2C26A7A6Authority, 'primaryOrientationIds' | 'measuredHead' | 'runSha256'>, c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A8A7AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A8A7AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A7 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const selection = isObject(json.selectionValidation) ? json.selectionValidation : null
  const rule = isObject(json.selectionRule) ? json.selectionRule : null
  if (!provenance || !summary || !conditions || !selection || !rule) return fail('A7 RESULT lacks provenance / summary / conditions / selection')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) {
    issues.push('A7 provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  }
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (selection.valid !== true) issues.push('selectionValidation.valid is not true')
  if (!isObject(json.conditionParity) || json.conditionParity.valid !== true) issues.push('conditionParity.valid is not true')
  if (!isObject(json.baselineParity) || json.baselineParity.valid !== true) issues.push('baselineParity.valid is not true')
  const expected = PHASE2C26A8_REGISTERED_A7
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  if (summary.primarySearchCompleted !== expected.primarySearchCompleted) issues.push(`summary.primarySearchCompleted ${String(summary.primarySearchCompleted)} is not ${expected.primarySearchCompleted}`)
  if (summary.semanticFailures !== expected.semanticFailures) issues.push(`summary.semanticFailures ${String(summary.semanticFailures)} is not ${expected.semanticFailures}`)
  if (summary.contractViolations !== expected.contractViolations) issues.push(`summary.contractViolations ${String(summary.contractViolations)} is not ${expected.contractViolations}`)
  const decision = isObject(summary.decision) ? summary.decision : {}
  if (decision.case !== expected.decisionCase) issues.push(`summary.decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  if (decision.section !== expected.decisionSection) issues.push(`summary.decision.section ${String(decision.section)} is not ${expected.decisionSection}`)
  const conclusion = isObject(json.conclusion) && isObject(json.conclusion.decision) ? json.conclusion.decision : {}
  if (conclusion.case !== expected.decisionCase || conclusion.section !== expected.decisionSection) issues.push('conclusion.decision differs from the registered case / section')
  if (provenance.c26a6MeasuredHead !== a6.measuredHead) issues.push('A7 provenance.c26a6MeasuredHead is not the A6 measured HEAD')
  if (typeof provenance.measuredHead !== 'string' || !/^[0-9a-f]{40}$/.test(provenance.measuredHead)) issues.push('A7 provenance.measuredHead is not a commit SHA')

  // The SHA chain: A7 was made against exactly the C2.6-A .. A6 files read, and every SHA A7 recorded (down A6's own chain) agrees.
  const chain = isObject(provenance.authorityShaChain) ? provenance.authorityShaChain : {}
  const a6Chain = isObject(chain.a6ChainRecordedByA6) ? chain.a6ChainRecordedByA6 : {}
  const a5Chain = isObject(a6Chain.a5ChainRecordedByA5) ? a6Chain.a5ChainRecordedByA5 : {}
  const a4Chain = isObject(a5Chain.a4ChainRecordedByA4) ? a5Chain.a4ChainRecordedByA4 : {}
  const shaChecks: [unknown, string, string][] = [
    [provenance.c26aResultSha256, actual.c26a, 'provenance.c26aResultSha256'],
    [provenance.c26aResultRecordedByRunner, actual.c26a, 'provenance.c26aResultRecordedByRunner'],
    [provenance.c26a2ResultSha256, actual.a2, 'provenance.c26a2ResultSha256'],
    [provenance.c26a2ResultRecordedByRunner, actual.a2, 'provenance.c26a2ResultRecordedByRunner'],
    [provenance.c26a3ResultSha256, actual.a3, 'provenance.c26a3ResultSha256'],
    [provenance.c26a3ResultRecordedByRunner, actual.a3, 'provenance.c26a3ResultRecordedByRunner'],
    [provenance.c26a4ResultSha256, actual.a4, 'provenance.c26a4ResultSha256'],
    [provenance.c26a4ResultRecordedByRunner, actual.a4, 'provenance.c26a4ResultRecordedByRunner'],
    [provenance.c26a5ResultSha256, actual.a5, 'provenance.c26a5ResultSha256'],
    [provenance.c26a5ResultRecordedByRunner, actual.a5, 'provenance.c26a5ResultRecordedByRunner'],
    [provenance.c26a6ResultSha256, actual.a6, 'provenance.c26a6ResultSha256'],
    [provenance.c26a6ResultRecordedByRunner, actual.a6, 'provenance.c26a6ResultRecordedByRunner'],
    [provenance.a6RunSha256, a6.runSha256, 'provenance.a6RunSha256'],
    [provenance.a6RunShaRecordedByA6, a6.runSha256, 'provenance.a6RunShaRecordedByA6'],
    [chain.c26aShaRecordedByA6, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA6'],
    [chain.a2ShaRecordedByA6, actual.a2, 'provenance.authorityShaChain.a2ShaRecordedByA6'],
    [chain.a3ShaRecordedByA6, actual.a3, 'provenance.authorityShaChain.a3ShaRecordedByA6'],
    [chain.a4ShaRecordedByA6, actual.a4, 'provenance.authorityShaChain.a4ShaRecordedByA6'],
    [chain.a5ShaRecordedByA6, actual.a5, 'provenance.authorityShaChain.a5ShaRecordedByA6'],
    [a6Chain.c26aShaRecordedByA5, actual.c26a, 'provenance.authorityShaChain.a6ChainRecordedByA6.c26aShaRecordedByA5'],
    [a6Chain.a2ShaRecordedByA5, actual.a2, 'provenance.authorityShaChain.a6ChainRecordedByA6.a2ShaRecordedByA5'],
    [a6Chain.a3ShaRecordedByA5, actual.a3, 'provenance.authorityShaChain.a6ChainRecordedByA6.a3ShaRecordedByA5'],
    [a6Chain.a4ShaRecordedByA5, actual.a4, 'provenance.authorityShaChain.a6ChainRecordedByA6.a4ShaRecordedByA5'],
    [a5Chain.c26aShaRecordedByA4, actual.c26a, 'provenance.authorityShaChain.a6ChainRecordedByA6.a5ChainRecordedByA5.c26aShaRecordedByA4'],
    [a5Chain.a2ShaRecordedByA4, actual.a2, 'provenance.authorityShaChain.a6ChainRecordedByA6.a5ChainRecordedByA5.a2ShaRecordedByA4'],
    [a5Chain.a3ShaRecordedByA4, actual.a3, 'provenance.authorityShaChain.a6ChainRecordedByA6.a5ChainRecordedByA5.a3ShaRecordedByA4'],
    [a4Chain.c26aShaRecordedByA2, actual.c26a, 'provenance.authorityShaChain...a4ChainRecordedByA4.c26aShaRecordedByA2'],
    [a4Chain.c26aShaRecordedByA3, actual.c26a, 'provenance.authorityShaChain...a4ChainRecordedByA4.c26aShaRecordedByA3'],
    [a4Chain.c26aShaRecordedByA3ForA2, actual.c26a, 'provenance.authorityShaChain...a4ChainRecordedByA4.c26aShaRecordedByA3ForA2'],
    [a4Chain.a2ShaRecordedByA3, actual.a2, 'provenance.authorityShaChain...a4ChainRecordedByA4.a2ShaRecordedByA3'],
  ]
  for (const [recorded, actualSha, field] of shaChecks) if (recorded !== actualSha) issues.push(`A7 ${field} is not the SHA-256 of the file read`)
  if (provenance.a6RawShaMatches !== true) issues.push('A7 provenance.a6RawShaMatches is not true')
  if (chain.allMatchFilesRead !== true || a6Chain.allMatchFilesRead !== true || a5Chain.allMatchFilesRead !== true || a4Chain.allMatchFilesRead !== true) {
    issues.push('A7 provenance.authorityShaChain.allMatchFilesRead is not true')
  }
  const sources = isObject(json.sources) ? json.sources : {}
  const sourceChecks: [string, string][] = [['c26aResult', actual.c26a], ['c26a2Result', actual.a2], ['c26a3Result', actual.a3], ['c26a4Result', actual.a4],
    ['c26a5Result', actual.a5], ['c26a6Result', actual.a6], ['a6Run', a6.runSha256]]
  for (const [key, sha] of sourceChecks) if (!isObject(sources[key]) || (sources[key] as Json).sha256 !== sha) issues.push(`A7 sources.${key}.sha256 differs`)
  const runSha = isObject(sources.run) && typeof sources.run.sha256 === 'string' && /^[0-9a-f]{64}$/.test(sources.run.sha256) ? sources.run.sha256 : null
  if (runSha === null) issues.push('A7 sources.run.sha256 is missing')
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A7 provenance.exportSha256 is not the C2.6-A Export')
  if (conditions.exportSha256 !== c26a.conditions.exportSha256) issues.push('A7 conditions.exportSha256 is not the C2.6-A Export')
  if (!same(conditions.searchInstrumentation, PHASE2C26A7_SEARCH_INSTRUMENTATION)) issues.push('A7 conditions.searchInstrumentation is not the A7 pair of observers')
  if (conditions.cpuProfiler !== false) issues.push('A7 conditions.cpuProfiler is not false')

  const primaries = asArray(selection.expected).filter((id): id is string => typeof id === 'string')
  if (primaries.length !== asArray(selection.expected).length) issues.push('A7 selectionValidation.expected is malformed')
  if (!same(primaries, asArray(selection.actual))) issues.push('A7 selectionValidation.actual is not its expected list')
  if (!same(primaries, asArray(rule.primaryOrientationIds))) issues.push('A7 selectionRule.primaryOrientationIds is not its selection')
  if (!same(primaries, a6.primaryOrientationIds)) issues.push('A7 selection is not the A6 primary set')
  if (new Set(primaries).size !== primaries.length) issues.push('A7 selection has a duplicate')
  if (primaries.length !== PHASE2C26A8_REGISTERED_PRIMARY_COUNT) issues.push(`A7 selection has ${primaries.length} primaries, not ${PHASE2C26A8_REGISTERED_PRIMARY_COUNT}`)
  const dominantByPrimary = isObject(decision.dominantByPrimary) ? decision.dominantByPrimary : {}
  const references: Phase2C26A8A7Reference[] = []
  for (const value of asArray(json.perOrientation)) {
    const reference = a7Reference(value)
    if (reference === null) { issues.push('an A7 perOrientation row is malformed'); continue }
    references.push(reference)
    const row = value as Json
    const violations = isObject(row.contractViolations) ? row.contractViolations : {}
    if (row.semanticFailures !== 0) issues.push(`A7 row ${reference.orientationId} has a semantic failure`)
    if (row.searchCompleted !== false) issues.push(`A7 row ${reference.orientationId} completed its primary Search`)
    if (violations.outer !== 0 || violations.inner !== 0) issues.push(`A7 row ${reference.orientationId} has a contract violation`)
    if (dominantByPrimary[reference.orientationId] !== reference.dominantSection) issues.push(`A7 row ${reference.orientationId} dominant section disagrees with the decision`)
  }
  if (!same(references.map(r => r.orientationId), primaries)) issues.push('A7 perOrientation is not exactly its selection, in order')
  for (const reference of references) {
    if (reference.childOutcome !== 'timeout') issues.push(`A7 row ${reference.orientationId} is not a timeout`)
    if (reference.dominantSection !== expected.decisionSection) issues.push(`A7 row ${reference.orientationId} dominant section is ${reference.dominantSection}, not ${expected.decisionSection}`)
    if (!(reference.innerCoverageOfBonusDepthRead >= expected.coverageThreshold)) {
      issues.push(`A7 row ${reference.orientationId} innerCoverageOfBonusDepthRead ${reference.innerCoverageOfBonusDepthRead} < ${expected.coverageThreshold}`)
    }
  }
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), conditions,
    primaryOrientationIds: primaries, references, decisionCase: String(decision.case), decisionSection: String(decision.section), runSha256: runSha as string } }
}

// ---------------------------------------------------------------- the no-inlining diagnostic representative

export interface Phase2C26A8DiagnosticSelection {
  rule: string
  /** The A7 primaries in the rule's order (descending `frontier_reduction_sort` share of `bonus_depth_read`, ties in A7 selection order). */
  ordered: { orientationId: string; frontierShareOfBonusDepthRead: number; a7SelectionIndex: number }[]
  representativeOrientationId: string
}

/**
 * One diagnostic representative, derived mechanically from the A7 evidence: the A7 primary with the largest
 * `frontier_reduction_sort` share of `bonus_depth_read` (ties in A7 selection order). No ID is fixed.
 */
export function selectPhase2C26A8DiagnosticRepresentative(a7: Pick<Phase2C26A8A7Authority, 'primaryOrientationIds' | 'references'>): Phase2C26A8DiagnosticSelection {
  const ordered = a7.primaryOrientationIds.map((orientationId, a7SelectionIndex) => {
    const reference = a7.references.find(r => r.orientationId === orientationId)
    if (!reference) throw new Error(`A7 primary ${orientationId} has no reference row`)
    return { orientationId, frontierShareOfBonusDepthRead: reference.frontierShareOfBonusDepthRead, a7SelectionIndex }
  }).sort((a, b) => b.frontierShareOfBonusDepthRead - a.frontierShareOfBonusDepthRead || a.a7SelectionIndex - b.a7SelectionIndex)
  if (ordered.length === 0) throw new Error('No A7 primary to select a diagnostic representative from')
  return {
    rule: 'A7 primaries sorted by frontier_reduction_sort shareOfBonusDepthRead descending (ties: A7 selection order); the first one',
    ordered,
    representativeOrientationId: ordered[0].orientationId,
  }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A8ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean; note?: string }[]
}

/**
 * Every A7 condition must be equal (concurrency 1, the heap-only Node flags and the A7 pair of observers included), and
 * the current conditions must pass A7's own parity against A6 (which chains to A5 / A4 / A3 / C2.6-A / A2). The CPU
 * profiler is the one registered difference: A7 ran none.
 */
export function validatePhase2C26A8ConditionParity(current: Phase2C26A2RunConditions & { nodeFlags: readonly string[]; searchInstrumentation: unknown },
  a7Conditions: Json, a6Conditions: Json, a5Conditions: Json, a4Conditions: Json, a3Conditions: Json, c26a: Pick<Phase2C26A2Authority, 'conditions'>,
  a2Conditions: Json): Phase2C26A8ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage',
    'nodeFlags', 'searchInstrumentation'] as const
  const currentJson = current as unknown as Json
  const checks: Phase2C26A8ConditionParity['checks'] = keys.map(condition => ({ condition: `a7.${condition}`, current: currentJson[condition], authority: a7Conditions[condition],
    matches: same(currentJson[condition], a7Conditions[condition]) }))
  checks.push({ condition: 'nodeFlags are the A7 primary flags', current: current.nodeFlags, authority: PHASE2C26A8_PRIMARY_NODE_FLAGS, matches: same(current.nodeFlags, PHASE2C26A8_PRIMARY_NODE_FLAGS) })
  checks.push({ condition: 'searchInstrumentation is the A7 pair of observers', current: current.searchInstrumentation, authority: PHASE2C26A8_SEARCH_INSTRUMENTATION,
    matches: same(current.searchInstrumentation, PHASE2C26A8_SEARCH_INSTRUMENTATION) })
  checks.push({ condition: 'A7 ran no CPU profiler', current: a7Conditions.cpuProfiler, authority: false, matches: a7Conditions.cpuProfiler === false,
    note: 'The one registered difference from A7: the V8 sampling CPU profiler over Search start + 120 s .. + 720 s. Absolute wall time is never compared with A7.' })
  checks.push({ condition: 'concurrency is 1', current: current.concurrency, authority: PHASE2C26A8_CONCURRENCY, matches: current.concurrency === PHASE2C26A8_CONCURRENCY })
  const a7Parity = validatePhase2C26A7ConditionParity(current, a6Conditions, a5Conditions, a4Conditions, a3Conditions, c26a, a2Conditions)
  for (const check of a7Parity.checks) checks.push({ condition: `a7parity.${check.condition}`, current: check.current, authority: check.authority, matches: check.matches })
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- selection

/** The current baseline's tasks of the A7 primaries, in baseline order as A3 - A7 took them (never an ID fixed here). */
export function selectPhase2C26A8Tasks(tasks: readonly Phase2C26AKernelTask[], a7: Pick<Phase2C26A8A7Authority, 'primaryOrientationIds'>): Phase2C26AKernelTask[] {
  return selectPhase2C26A7Tasks(tasks, a7)
}

export function validatePhase2C26A8Selection(orientations: readonly Phase2C2Orientation[], a7: Pick<Phase2C26A8A7Authority, 'primaryOrientationIds'>,
  c26a: Pick<Phase2C26A2Authority, 'orientations'>) {
  return validatePhase2C26A7Selection(orientations, a7, c26a)
}

// ---------------------------------------------------------------- the profile window anchor

/**
 * The A8 kernel instrumentation: the A7 instrumentation (A4 lifecycle + the two section boundary observers) unchanged,
 * with each Target's `onSearchRuntime` wrapped only to report the kernel's first Search start (the profile window anchor,
 * as in A5). The wrapped observer runs first and receives every event unchanged; nothing else is attached.
 */
export function createPhase2C26A8KernelInstrumentation(a7: PlannerAlternativeKernelInstrumentation, options: { now: () => number; onSearchStarted: (atMs: number) => void }):
  PlannerAlternativeKernelInstrumentation {
  let searchStarted = false
  return {
    onEvent: a7.onEvent,
    searchInstrumentationForTarget: (targetWeaponId, targetOrdinal) => {
      const inner = a7.searchInstrumentationForTarget?.(targetWeaponId, targetOrdinal)
      const base = inner?.onSearchRuntime
      if (inner === undefined || base === undefined || inner.onGogmaReservedRuntime === undefined) {
        throw new Error('The A7 instrumentation must provide onSearchRuntime and onGogmaReservedRuntime for every Target.')
      }
      const wrapped: SearchRuntimeObserver = (event) => {
        base(event)
        if (!searchStarted && event.type === 'section_started' && event.section === 'search_runtime') {
          searchStarted = true
          options.onSearchStarted(options.now())
        }
      }
      return { ...inner, onSearchRuntime: wrapped }
    },
  }
}

/** One profiled kernel child calculation: the unchanged A7 kernel helper with the A8 (= A7 + Search start anchor) instrumentation. */
export function runPhase2C26A8Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26A7Kernel(input, task, dependencies, instrumentation)
}
