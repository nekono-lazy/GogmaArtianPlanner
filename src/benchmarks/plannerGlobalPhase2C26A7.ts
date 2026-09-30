/**
 * Issue #154 Phase 2-C2.6-A7: formal re-localization of the `bonus_depth_read` internal runtime after Phase 2-C2.6-A6,
 * Research only. Never import from Production.
 *
 * Phase 2-C2.6-A6 (Case R) left `bonus_depth_read` - the whole held-aware Gogma `readReservedDepth()` - at 91-92 % of
 * the primary Search wall time, and all three primaries still timed out. A3 once timed the six sections inside that read
 * (`RESERVED_GOGMA_RUNTIME_PHASES`), but before A5 / A6 and without the outer Search hierarchy, so its per-section
 * evidence is taxonomy only, never the current result. This phase attaches, in the same run and on the same clock, both
 * existing observers: A4's Search section boundary observer (`onSearchRuntime`, which times `bonus_depth_read` as one
 * leaf) and A3's held-aware section boundary observer (`onGogmaReservedRuntime`, which times the six sections inside it).
 * No new Production seam is added and no calculation changes; the heartbeat takes both trackers' snapshots on one frozen
 * `now()`, so the outer read and the inner sections are compared at the same instant.
 *
 * Authorities. The committed Phase 2-C2.6-A6 RESULT (formal, Case R) is the primary selection and current bottleneck
 * authority; it must have been made against exactly the committed C2.6-A / A2 / A3 / A4 / A5 RESULT files read (SHA
 * chain), and each of its primaries must have `bonus_depth_read` as its largest outer category at a share of at least
 * 0.90. No orientation ID is fixed here. There is no Production change since the A6 measured HEAD.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type {
  PlannerAlternativeKernelInstrumentation,
} from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import type { Phase2C2KernelRecord, Phase2C2Orientation, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import { runPhase2C26AKernel, type Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import type { Phase2C26A2Authority, Phase2C26A2LifecycleRecord, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import {
  createPhase2C26A3RuntimeTracker,
  PHASE2C26A3_PHASES,
  selectPhase2C26A3Tasks,
  validatePhase2C26A3Selection,
  type Phase2C26A3DepthRecord,
  type Phase2C26A3Phase,
  type Phase2C26A3PhaseStartRecord,
  type Phase2C26A3RuntimeSnapshot,
} from './plannerGlobalPhase2C26A3'
import {
  createPhase2C26A4KernelProgress,
  PHASE2C26A4_SEARCH_INSTRUMENTATION,
  type Phase2C26A4Heartbeat,
  type Phase2C26A4SearchSummaryRecord,
  type Phase2C26A4SectionStartRecord,
  type Phase2C26A4WorkSummaryRecord,
} from './plannerGlobalPhase2C26A4'
import {
  isPhase2C26A6ResearchOrTestSource,
  PHASE2C26A6_CHILD_HEAP_MB,
  PHASE2C26A6_CONCURRENCY,
  PHASE2C26A6_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A6_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A6_NODE_FLAGS,
  PHASE2C26A6_NODE_YIELD,
  PHASE2C26A6_ORIENTATION_BUDGET_MS,
  validatePhase2C26A6ConditionParity,
  type Phase2C26A6A5Authority,
} from './plannerGlobalPhase2C26A6'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

export const PHASE2C26A7_INNER_SECTIONS = PHASE2C26A3_PHASES
export type Phase2C26A7InnerSection = Phase2C26A3Phase

// ---------------------------------------------------------------- conditions

/** Phase 2-C2.6-A6's heap, budget, concurrency 1, yield, memory sampling, heartbeat and heap-only Node flags, unchanged. */
export const PHASE2C26A7_CHILD_HEAP_MB = PHASE2C26A6_CHILD_HEAP_MB
export const PHASE2C26A7_ORIENTATION_BUDGET_MS = PHASE2C26A6_ORIENTATION_BUDGET_MS
export const PHASE2C26A7_CONCURRENCY = PHASE2C26A6_CONCURRENCY
export const PHASE2C26A7_NODE_YIELD = PHASE2C26A6_NODE_YIELD
export const PHASE2C26A7_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A6_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A7_HEARTBEAT_INTERVAL_MS = PHASE2C26A6_HEARTBEAT_INTERVAL_MS
export const PHASE2C26A7_NODE_FLAGS: readonly string[] = PHASE2C26A6_NODE_FLAGS
/**
 * The one condition that differs from A6: the held-aware section boundary observer is attached beside the Search
 * section boundary observer. The heavy depth / work observers stay off, and no CPU profiler runs.
 */
export const PHASE2C26A7_SEARCH_INSTRUMENTATION = {
  onSearchRuntime: true, onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false,
} as const

// ---------------------------------------------------------------- no Production change

/** A7 is Research only: no Production calculation source may differ from the A6 measured HEAD. */
export const PHASE2C26A7_PRODUCTION_CHANGE: readonly string[] = []

export interface Phase2C26A7ProductionChangeValidation {
  valid: boolean
  issues: string[]
  changed: string[]
  productionChanged: string[]
}

/** The changed paths under `src` since the A6 measured HEAD must hold no Production calculation source (Research / test only). */
export function validatePhase2C26A7NoProductionChange(changedSrcPaths: readonly string[]): Phase2C26A7ProductionChangeValidation {
  const changed = [...changedSrcPaths]
  const issues: string[] = []
  const outsideSrc = changed.filter(path => !path.startsWith('src/'))
  if (outsideSrc.length > 0) issues.push(`paths outside src were given: ${outsideSrc.join(', ')}`)
  const productionChanged = [...new Set(changed.filter(path => path.startsWith('src/') && !isPhase2C26A6ResearchOrTestSource(path)))].sort()
  if (productionChanged.length > 0) issues.push(`Production calculation change since the A6 measured HEAD: ${productionChanged.join(', ')}`)
  return { valid: issues.length === 0, issues, changed, productionChanged }
}

// ---------------------------------------------------------------- the Phase 2-C2.6-A6 RESULT (selection / bottleneck authority)

/** The registered Phase 2-C2.6-A6 RESULT this phase is made against. */
export const PHASE2C26A7_REGISTERED_A6 = {
  orientations: 3,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 },
  primarySearchCompleted: 0,
  semanticFailures: 0,
  decisionCase: 'R_filter_reduced_timeout_remains',
  /** Each A6 primary's largest outer category, at least at this Search wall share (the A6 evidence this phase acts on). */
  bottleneckCategory: 'bonus_depth_read',
  bottleneckShareThreshold: 0.9,
} as const
export const PHASE2C26A7_REGISTERED_PRIMARY_COUNT = 3

export interface Phase2C26A7A6Reference {
  orientationId: string
  childOutcome: string
  searchWallMs: number
  maxCategory: string
  bonusDepthReadShare: number
  bonusIdealFilterShare: number
  bonusNoticeScanShare: number
  rawSolutions: number
  bonusDepthWorks: number
}

export interface Phase2C26A7A6Authority {
  measuredHead: string
  analysisHead: string
  conditions: Json
  primaryOrientationIds: string[]
  references: Phase2C26A7A6Reference[]
  decisionCase: string
  /** The A6 raw run the A6 RESULT recorded (the semantic parity reference). */
  runSha256: string
}

export interface Phase2C26A7A6AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A7A6Authority | null
}

function a6Reference(value: unknown, a4Style: Json | null): Phase2C26A7A6Reference | null {
  if (!isObject(value) || typeof value.orientationId !== 'string') return null
  const outcome = isObject(value.outcome) ? value.outcome : {}
  const wall = isObject(value.searchWallMs) ? num(value.searchWallMs.after) : null
  const share = isObject(value.afterCategoryShare) ? value.afterCategoryShare : null
  const raw = isObject(value.rawSolutions) ? num(value.rawSolutions.after) : null
  const works = isObject(value.bonusDepthWorks) ? num(value.bonusDepthWorks.after) : null
  if (share === null || wall === null || raw === null || works === null || typeof value.maxCategoryAfter !== 'string') return null
  const read = num(share.bonus_depth_read), filter = num(share.bonus_ideal_filter), notice = num(share.bonus_notice_scan)
  if (read === null || filter === null || notice === null) return null
  // The A4-style view of the same row must agree on the largest outer category.
  const a4Search = a4Style && isObject(a4Style.primarySearch) ? a4Style.primarySearch : null
  if (a4Style === null || a4Style.orientationId !== value.orientationId || a4Search === null || a4Search.maxCategory !== value.maxCategoryAfter) return null
  return { orientationId: value.orientationId, childOutcome: String(outcome.after), searchWallMs: wall, maxCategory: value.maxCategoryAfter,
    bonusDepthReadShare: read, bonusIdealFilterShare: filter, bonusNoticeScanShare: notice, rawSolutions: raw, bonusDepthWorks: works }
}

/**
 * Reads the committed Phase 2-C2.6-A6 RESULT as untrusted JSON and fails closed unless it is the registered formal A6
 * result (Case R, 3 primaries, 3 timeouts, no completed primary Search, no semantic failure, each primary's largest outer
 * category `bonus_depth_read` at a share >= 0.90) made against exactly the C2.6-A / A2 / A3 / A4 / A5 RESULT files read
 * (SHA chain, including every SHA A6 recorded for A5's own chain), and its selection is the A5 selection. The primaries
 * are that selection, never fixed here.
 */
export function parsePhase2C26A6ResultAuthority(json: unknown, actual: { c26a: string; a2: string; a3: string; a4: string; a5: string },
  a5: Pick<Phase2C26A6A5Authority, 'primaryOrientationIds' | 'measuredHead'>, c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A7A6AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A7A6AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A6 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const selection = isObject(json.selectionValidation) ? json.selectionValidation : null
  const rule = isObject(json.selectionRule) ? json.selectionRule : null
  if (!provenance || !summary || !conditions || !selection || !rule) return fail('A6 RESULT lacks provenance / summary / conditions / selection')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (asArray(provenance.calculationCodeChangedSinceMeasuredHead).length !== 0 || !Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead)) {
    issues.push('A6 provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  }
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (selection.valid !== true) issues.push('selectionValidation.valid is not true')
  if (!isObject(json.conditionParity) || json.conditionParity.valid !== true) issues.push('conditionParity.valid is not true')
  if (!isObject(json.baselineParity) || json.baselineParity.valid !== true) issues.push('baselineParity.valid is not true')
  const expected = PHASE2C26A7_REGISTERED_A6
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  if (summary.primarySearchCompleted !== expected.primarySearchCompleted) issues.push(`summary.primarySearchCompleted ${String(summary.primarySearchCompleted)} is not ${expected.primarySearchCompleted}`)
  if (summary.semanticFailures !== expected.semanticFailures) issues.push(`summary.semanticFailures ${String(summary.semanticFailures)} is not ${expected.semanticFailures}`)
  const decision = isObject(summary.decision) ? summary.decision : {}
  if (decision.case !== expected.decisionCase) issues.push(`summary.decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  if (!isObject(json.conclusion) || !isObject(json.conclusion.decision) || json.conclusion.decision.case !== expected.decisionCase) issues.push('conclusion.decision.case differs from the registered case')
  if (provenance.c26a5MeasuredHead !== a5.measuredHead) issues.push('A6 provenance.c26a5MeasuredHead is not the A5 measured HEAD')
  if (typeof provenance.measuredHead !== 'string' || !/^[0-9a-f]{40}$/.test(provenance.measuredHead)) issues.push('A6 provenance.measuredHead is not a commit SHA')

  // The SHA chain: A6 was made against exactly the C2.6-A / A2 / A3 / A4 / A5 files read, and every SHA A6 recorded agrees.
  const chain = isObject(provenance.authorityShaChain) ? provenance.authorityShaChain : {}
  const a5Chain = isObject(chain.a5ChainRecordedByA5) ? chain.a5ChainRecordedByA5 : {}
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
    [chain.c26aShaRecordedByA5, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA5'],
    [chain.a2ShaRecordedByA5, actual.a2, 'provenance.authorityShaChain.a2ShaRecordedByA5'],
    [chain.a3ShaRecordedByA5, actual.a3, 'provenance.authorityShaChain.a3ShaRecordedByA5'],
    [chain.a4ShaRecordedByA5, actual.a4, 'provenance.authorityShaChain.a4ShaRecordedByA5'],
    [a5Chain.c26aShaRecordedByA4, actual.c26a, 'provenance.authorityShaChain.a5ChainRecordedByA5.c26aShaRecordedByA4'],
    [a5Chain.a2ShaRecordedByA4, actual.a2, 'provenance.authorityShaChain.a5ChainRecordedByA5.a2ShaRecordedByA4'],
    [a5Chain.a3ShaRecordedByA4, actual.a3, 'provenance.authorityShaChain.a5ChainRecordedByA5.a3ShaRecordedByA4'],
    [a4Chain.c26aShaRecordedByA2, actual.c26a, 'provenance.authorityShaChain.a5ChainRecordedByA5.a4ChainRecordedByA4.c26aShaRecordedByA2'],
    [a4Chain.c26aShaRecordedByA3, actual.c26a, 'provenance.authorityShaChain.a5ChainRecordedByA5.a4ChainRecordedByA4.c26aShaRecordedByA3'],
    [a4Chain.c26aShaRecordedByA3ForA2, actual.c26a, 'provenance.authorityShaChain.a5ChainRecordedByA5.a4ChainRecordedByA4.c26aShaRecordedByA3ForA2'],
    [a4Chain.a2ShaRecordedByA3, actual.a2, 'provenance.authorityShaChain.a5ChainRecordedByA5.a4ChainRecordedByA4.a2ShaRecordedByA3'],
  ]
  for (const [recorded, actualSha, field] of shaChecks) if (recorded !== actualSha) issues.push(`A6 ${field} is not the SHA-256 of the file read`)
  if (chain.allMatchFilesRead !== true || a5Chain.allMatchFilesRead !== true || a4Chain.allMatchFilesRead !== true) issues.push('A6 provenance.authorityShaChain.allMatchFilesRead is not true')
  const sources = isObject(json.sources) ? json.sources : {}
  const sourceChecks: [string, string][] = [['c26aResult', actual.c26a], ['c26a2Result', actual.a2], ['c26a3Result', actual.a3], ['c26a4Result', actual.a4], ['c26a5Result', actual.a5]]
  for (const [key, sha] of sourceChecks) if (!isObject(sources[key]) || (sources[key] as Json).sha256 !== sha) issues.push(`A6 sources.${key}.sha256 differs`)
  const runSha = isObject(sources.run) && typeof sources.run.sha256 === 'string' && /^[0-9a-f]{64}$/.test(sources.run.sha256) ? sources.run.sha256 : null
  if (runSha === null) issues.push('A6 sources.run.sha256 is missing')
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A6 provenance.exportSha256 is not the C2.6-A Export')
  if (conditions.exportSha256 !== c26a.conditions.exportSha256) issues.push('A6 conditions.exportSha256 is not the C2.6-A Export')

  const primaries = asArray(selection.expected).filter((id): id is string => typeof id === 'string')
  if (primaries.length !== asArray(selection.expected).length) issues.push('A6 selectionValidation.expected is malformed')
  if (!same(primaries, asArray(selection.actual))) issues.push('A6 selectionValidation.actual is not its expected list')
  if (!same(primaries, asArray(rule.primaryOrientationIds))) issues.push('A6 selectionRule.primaryOrientationIds is not its selection')
  if (!same(primaries, a5.primaryOrientationIds)) issues.push('A6 selection is not the A5 primary set')
  if (new Set(primaries).size !== primaries.length) issues.push('A6 selection has a duplicate')
  if (primaries.length !== PHASE2C26A7_REGISTERED_PRIMARY_COUNT) issues.push(`A6 selection has ${primaries.length} primaries, not ${PHASE2C26A7_REGISTERED_PRIMARY_COUNT}`)
  const a4StyleRows = isObject(json.a4StyleAfter) ? asArray(json.a4StyleAfter.perOrientation).filter(isObject) : []
  const references: Phase2C26A7A6Reference[] = []
  for (const value of asArray(json.perOrientation)) {
    const id = isObject(value) ? value.orientationId : null
    const reference = a6Reference(value, a4StyleRows.find(row => row.orientationId === id) ?? null)
    if (reference === null) { issues.push('an A6 perOrientation row is malformed or disagrees with its A4-style row'); continue }
    references.push(reference)
    const row = value as Json
    if (row.semanticFailures !== 0) issues.push(`A6 row ${reference.orientationId} has a semantic failure`)
    if (!isObject(row.searchCompleted) || row.searchCompleted.after !== false) issues.push(`A6 row ${reference.orientationId} completed its primary Search`)
  }
  if (!same(references.map(r => r.orientationId), primaries)) issues.push('A6 perOrientation is not exactly its selection, in order')
  for (const reference of references) {
    if (reference.childOutcome !== 'timeout') issues.push(`A6 row ${reference.orientationId} is not a timeout`)
    if (reference.maxCategory !== expected.bottleneckCategory) issues.push(`A6 row ${reference.orientationId} largest outer category is ${reference.maxCategory}, not ${expected.bottleneckCategory}`)
    if (!(reference.bonusDepthReadShare >= expected.bottleneckShareThreshold)) {
      issues.push(`A6 row ${reference.orientationId} bonus_depth_read share ${reference.bonusDepthReadShare} < ${expected.bottleneckShareThreshold}`)
    }
  }
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), conditions,
    primaryOrientationIds: primaries, references, decisionCase: String(decision.case), runSha256: runSha as string } }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A7ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean; note?: string }[]
}

/**
 * Every A6 condition must be equal (concurrency 1 and the heap-only Node flags included), and the current conditions
 * must pass A6's own parity against A5 (which carries A5's parity against A4 / A3 / C2.6-A / A2). The Search
 * instrumentation is the one registered difference: A6's must be the A4 observer alone (its evidence), A7's the A4
 * observer plus the held-aware section observer.
 */
export function validatePhase2C26A7ConditionParity(current: Phase2C26A2RunConditions & { nodeFlags: readonly string[]; searchInstrumentation: unknown },
  a6Conditions: Json, a5Conditions: Json, a4Conditions: Json, a3Conditions: Json, c26a: Pick<Phase2C26A2Authority, 'conditions'>, a2Conditions: Json): Phase2C26A7ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage', 'nodeFlags'] as const
  const currentJson = current as unknown as Json
  const checks: Phase2C26A7ConditionParity['checks'] = keys.map(condition => ({ condition: `a6.${condition}`, current: currentJson[condition], authority: a6Conditions[condition],
    matches: same(currentJson[condition], a6Conditions[condition]) }))
  checks.push({ condition: 'nodeFlags are the A6 primary flags', current: current.nodeFlags, authority: PHASE2C26A7_NODE_FLAGS, matches: same(current.nodeFlags, PHASE2C26A7_NODE_FLAGS) })
  checks.push({ condition: 'A6 searchInstrumentation is the A4 observer alone', current: a6Conditions.searchInstrumentation, authority: PHASE2C26A4_SEARCH_INSTRUMENTATION,
    matches: same(a6Conditions.searchInstrumentation, PHASE2C26A4_SEARCH_INSTRUMENTATION) })
  checks.push({ condition: 'A7 searchInstrumentation', current: current.searchInstrumentation, authority: PHASE2C26A7_SEARCH_INSTRUMENTATION,
    matches: same(current.searchInstrumentation, PHASE2C26A7_SEARCH_INSTRUMENTATION),
    note: 'The one registered difference from A6: onGogmaReservedRuntime is attached beside onSearchRuntime. Absolute wall time is never compared with A6 / A3.' })
  const a6Parity = validatePhase2C26A6ConditionParity(current, a5Conditions, a4Conditions, a3Conditions, c26a, a2Conditions)
  for (const check of a6Parity.checks) checks.push({ condition: `a5.${check.condition}`, current: check.current, authority: check.authority, matches: check.matches })
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- selection

/** The current baseline's tasks of the A6 primaries, in baseline order as A3 - A6 took them (never an ID fixed here). */
export function selectPhase2C26A7Tasks(tasks: readonly Phase2C26AKernelTask[], a6: Pick<Phase2C26A7A6Authority, 'primaryOrientationIds'>): Phase2C26AKernelTask[] {
  return selectPhase2C26A3Tasks(tasks, a6.primaryOrientationIds)
}

export function validatePhase2C26A7Selection(orientations: readonly Phase2C2Orientation[], a6: Pick<Phase2C26A7A6Authority, 'primaryOrientationIds'>,
  c26a: Pick<Phase2C26A2Authority, 'orientations'>) {
  return validatePhase2C26A3Selection(orientations, a6.primaryOrientationIds, c26a)
}

// ---------------------------------------------------------------- in-child kernel progress (both observers, one clock)

export interface Phase2C26A7Heartbeat extends Phase2C26A4Heartbeat {
  /** The held-aware section tracker's snapshot, taken on the same frozen `now()` as `searchRuntime`. */
  gogmaRuntime: Phase2C26A3RuntimeSnapshot
}

/**
 * The child-side aggregator of one kernel run: A4's kernel progress (lifecycle records and the Search section boundary
 * tracker), unchanged, plus A3's held-aware section tracker, unchanged, sharing one clock origin. Each Target's Search
 * instrumentation is exactly the two boundary observers. A heartbeat freezes the clock for its duration so both trackers'
 * snapshots are taken at the same instant (no event runs during a heartbeat: it is synchronous).
 */
export function createPhase2C26A7KernelProgress(options: {
  now: () => number
  predictionCounts: () => PlannerAlternativePredictionCounts
  emitLifecycle: (record: Phase2C26A2LifecycleRecord) => void
  emitSectionStarted: (record: Phase2C26A4SectionStartRecord) => void
  emitWorkSummary: (record: Phase2C26A4WorkSummaryRecord) => void
  emitSearchSummary: (record: Phase2C26A4SearchSummaryRecord) => void
  emitGogmaPhaseStarted: (record: Phase2C26A3PhaseStartRecord) => void
  emitGogmaDepth: (record: Phase2C26A3DepthRecord) => void
}) {
  let frozen: number | null = null
  let origin: number | null = null
  const clock = () => frozen ?? options.now()
  const outer = createPhase2C26A4KernelProgress({ now: clock, predictionCounts: options.predictionCounts, emitLifecycle: options.emitLifecycle,
    emitSectionStarted: options.emitSectionStarted, emitWorkSummary: options.emitWorkSummary, emitSearchSummary: options.emitSearchSummary })
  const inner = createPhase2C26A3RuntimeTracker({ now: clock, origin: () => origin ?? clock(), emitPhaseStarted: options.emitGogmaPhaseStarted, emitDepth: options.emitGogmaDepth })
  const instrumentation: PlannerAlternativeKernelInstrumentation = {
    onEvent: outer.instrumentation.onEvent,
    searchInstrumentationForTarget: (targetWeaponId, targetOrdinal) => ({
      ...(outer.instrumentation.searchInstrumentationForTarget?.(targetWeaponId, targetOrdinal) ?? {}),
      onGogmaReservedRuntime: inner.observerForTarget(targetOrdinal),
    }),
  }
  return {
    /** Starts the shared Research clock; call immediately before the kernel is invoked. Returns the origin. */
    start(): number { origin = outer.start(); return origin },
    instrumentation,
    heartbeat(): Phase2C26A7Heartbeat {
      frozen = options.now()
      try {
        const heartbeat = outer.heartbeat()
        return { ...heartbeat, gogmaRuntime: inner.snapshot() }
      } finally {
        frozen = null
      }
    },
  }
}

/** One profiled kernel child calculation: the unchanged Phase 2-C2.6-A kernel helper with the A7 instrumentation. */
export function runPhase2C26A7Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26AKernel(input, task, { ...dependencies, kernelInstrumentation: instrumentation })
}
