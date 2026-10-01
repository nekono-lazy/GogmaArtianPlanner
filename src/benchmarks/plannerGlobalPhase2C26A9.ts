/**
 * Issue #154 Phase 2-C2.6-A9: the effect of the first Production optimization of the held-aware Gogma
 * `frontier_reduction_sort` hotspot, Research only. Never import from Production.
 *
 * Phase 2-C2.6-A8 (Case S, `S_stable_serialization_dominant`) found that 66-68 % of the CPU samples inside
 * `frontier_reduction_sort` of its two profile-valid primaries are the `stableStringify()` of
 * `compareReservedRepresentative()` (`generateReservedDepth -> compareReservedRepresentative -> stableStringify ->
 * serializeStable`). A9 changes exactly one Production function: that comparator now reads `stableStringify(bonuses)`
 * through a lazy, instance-local WeakMap keyed by the five-slot object identity (the Reset / Keep prediction objects the
 * memos hand out). The ordering is unchanged (`lastResetDepth` descending, then the unchanged `stableStringify()` text
 * ascending), and nothing else of the stream changes.
 *
 * This module re-runs the A8 primaries under exactly the A8 conditions (jit_default, the A7 pair of section boundary
 * observers, the A5 V8 sampling CPU profiler over Search start + 120 s .. + 720 s; no no-inlining diagnostic) and the
 * analysis (`plannerGlobalPhase2C26A9Analysis.ts`) compares them with the A8 formal run: the A8 classification of the
 * frontier samples, the direct `frontier_reduction_sort` section time per representative comparison on the semantic
 * common prefix, and the semantic parity of that prefix.
 *
 * Authorities. The committed Phase 2-C2.6-A8 RESULT (formal, Case S) is the selection and before-evidence authority; it
 * must have been made against exactly the committed C2.6-A .. A7 RESULT files read (SHA chain). No orientation ID is
 * fixed here: the primaries and the profile-valid comparison set are derived from the A8 RESULT. The only Production
 * calculation change since the A8 measured HEAD is the registered file.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativeKernelInstrumentation } from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { Phase2C2KernelRecord, Phase2C2Orientation, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import type { Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { isPhase2C26A6ResearchOrTestSource } from './plannerGlobalPhase2C26A6'
import {
  createPhase2C26A8KernelInstrumentation,
  PHASE2C26A8_CHILD_HEAP_MB,
  PHASE2C26A8_CONCURRENCY,
  PHASE2C26A8_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A8_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A8_NODE_YIELD,
  PHASE2C26A8_ORIENTATION_BUDGET_MS,
  PHASE2C26A8_PRIMARY_NODE_FLAGS,
  PHASE2C26A8_PROFILER,
  PHASE2C26A8_REQUIRED_SOURCE_FILES,
  PHASE2C26A8_SEARCH_INSTRUMENTATION,
  PHASE2C26A8_SECTION,
  runPhase2C26A8Kernel,
  selectPhase2C26A8Tasks,
  validatePhase2C26A8ConditionParity,
  validatePhase2C26A8Selection,
  type Phase2C26A8A7Authority,
} from './plannerGlobalPhase2C26A8'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

/** The one section this phase optimizes and re-measures. */
export const PHASE2C26A9_SECTION = PHASE2C26A8_SECTION

// ---------------------------------------------------------------- conditions (= A8 primary conditions, no diagnostic)

export const PHASE2C26A9_CHILD_HEAP_MB = PHASE2C26A8_CHILD_HEAP_MB
export const PHASE2C26A9_ORIENTATION_BUDGET_MS = PHASE2C26A8_ORIENTATION_BUDGET_MS
export const PHASE2C26A9_CONCURRENCY = PHASE2C26A8_CONCURRENCY
export const PHASE2C26A9_NODE_YIELD = PHASE2C26A8_NODE_YIELD
export const PHASE2C26A9_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A8_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A9_HEARTBEAT_INTERVAL_MS = PHASE2C26A8_HEARTBEAT_INTERVAL_MS
/** The Production-like primary evidence: JIT default, only the heap flag (= A8 primary). */
export const PHASE2C26A9_PRIMARY_NODE_FLAGS: readonly string[] = PHASE2C26A8_PRIMARY_NODE_FLAGS
/** The A7 pair of section boundary observers, unchanged (= A8). */
export const PHASE2C26A9_SEARCH_INSTRUMENTATION = PHASE2C26A8_SEARCH_INSTRUMENTATION
/** The A5 / A8 CPU profiler conditions, unchanged: 10 ms requested sampling, Search start + 120 s .. + 720 s. */
export const PHASE2C26A9_PROFILER = PHASE2C26A8_PROFILER
export const PHASE2C26A9_REQUIRED_SOURCE_FILES: readonly string[] = PHASE2C26A8_REQUIRED_SOURCE_FILES
/** A9 runs no no-inlining diagnostic (A8 already ran one); the primaries are the only evidence. */
export const PHASE2C26A9_DIAGNOSTIC = false as const

// ---------------------------------------------------------------- the one registered Production change

/** The one Production calculation source A9 changes since the A8 measured HEAD. */
export const PHASE2C26A9_PRODUCTION_CHANGE: readonly string[] = ['src/domain/search/bonusStream.ts']

export interface Phase2C26A9ProductionChangeValidation {
  valid: boolean
  issues: string[]
  changed: string[]
  productionChanged: string[]
}

/**
 * The changed paths under `src` since the A8 measured HEAD: the Production calculation sources among them (Research /
 * test sources excluded) must be exactly the registered file, no more and no fewer.
 */
export function validatePhase2C26A9ProductionChange(changedSrcPaths: readonly string[]): Phase2C26A9ProductionChangeValidation {
  const changed = [...changedSrcPaths]
  const issues: string[] = []
  const outsideSrc = changed.filter(path => !path.startsWith('src/'))
  if (outsideSrc.length > 0) issues.push(`paths outside src were given: ${outsideSrc.join(', ')}`)
  const productionChanged = [...new Set(changed.filter(path => path.startsWith('src/') && !isPhase2C26A6ResearchOrTestSource(path)))].sort()
  const registered = [...PHASE2C26A9_PRODUCTION_CHANGE].sort()
  const extra = productionChanged.filter(path => !registered.includes(path))
  const missing = registered.filter(path => !productionChanged.includes(path))
  if (extra.length > 0) issues.push(`unregistered Production calculation change since the A8 measured HEAD: ${extra.join(', ')}`)
  if (missing.length > 0) issues.push(`the registered Production change is absent since the A8 measured HEAD: ${missing.join(', ')}`)
  return { valid: issues.length === 0, issues, changed, productionChanged }
}

/**
 * Source-level registration of the one change (A9 measured HEAD): the held-aware comparator reads the serialization
 * through the instance-local WeakMap helper, keeps `lastResetDepth` first, and the ordinary `compareRepresentative()`
 * still serializes directly. A text check over the source only; the behaviour is fixed by the stream tests.
 */
export function validatePhase2C26A9OptimizationSource(bonusStreamSource: string): { valid: boolean; issues: string[] } {
  const issues: string[] = []
  const lines = bonusStreamSource.split(/\r?\n/)
  const block = (name: string) => {
    const start = lines.findIndex(line => new RegExp(`^\\s*function\\s+${name}\\s*\\(`).test(line))
    if (start < 0) return null
    const indent = (/^(\s*)/.exec(lines[start]) as RegExpExecArray)[1]
    const end = lines.findIndex((line, index) => index > start && line === `${indent}}`)
    return end < 0 ? null : lines.slice(start, end + 1).join('\n')
  }
  const reserved = block('compareReservedRepresentative')
  const ordinary = block('compareRepresentative')
  const helper = block('reservedBonusStableKey')
  const compact = (text: string | null) => (text ?? '').replace(/\s+/g, '')
  if (reserved === null) issues.push('compareReservedRepresentative is missing')
  else if (!compact(reserved).includes('right.lastResetDepth-left.lastResetDepth||compareStableKeys(reservedBonusStableKey(left.bonuses),reservedBonusStableKey(right.bonuses))')) {
    issues.push('compareReservedRepresentative is not lastResetDepth descending, then the cached stable serialization ascending')
  }
  if (ordinary === null) issues.push('compareRepresentative is missing')
  else if (!compact(ordinary).includes('compareStableKeys(stableStringify(left.bonuses),stableStringify(right.bonuses))')) issues.push('the ordinary compareRepresentative changed')
  if (helper === null) issues.push('reservedBonusStableKey is missing')
  else {
    const body = compact(helper)
    if (!body.includes('reservedBonusStableKeys.get(bonuses)') || !body.includes('stableStringify(bonuses)') || !body.includes('reservedBonusStableKeys.set(bonuses,key)')) {
      issues.push('reservedBonusStableKey is not a lazy get / stableStringify / set')
    }
  }
  const declarations = lines.filter(line => /reservedBonusStableKeys\s*=/.test(line))
  if (declarations.length !== 1 || !/=\s*new WeakMap<RestorationBonusSet, string>\(\)/.test(declarations[0] ?? '')) issues.push('the cache is not one WeakMap<RestorationBonusSet, string>')
  // Instance-local: declared inside createTargetBonusStream (indented), never at module level.
  if (declarations.length === 1 && !/^\s+const /.test(declarations[0])) issues.push('the cache is not instance-local')
  return { valid: issues.length === 0, issues }
}

// ---------------------------------------------------------------- the Phase 2-C2.6-A8 RESULT (selection / before authority)

export const PHASE2C26A9_REGISTERED_A8 = {
  orientations: 3,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 },
  semanticFailures: 0,
  contractViolations: 0,
  decisionCase: 'S_stable_serialization_dominant',
  decisionCategory: 'representative_stable_serialization',
  /** A8's own majority. */
  minimumValidPrimaries: 2,
} as const
export const PHASE2C26A9_REGISTERED_PRIMARY_COUNT = 3

/** A8's own evidence for one primary (the "before" of A9). */
export interface Phase2C26A9A8Reference {
  orientationId: string
  childOutcome: string
  /** A8 profile quality (its decision row). An invalid A8 profile is never a before value. */
  profileValid: boolean
  invalidReasons: string[]
  negativeTimeDeltas: number | null
  frontierSamples: number
  shares: Record<string, number>
  largestCategory: string | null
  /** A8 whole-run held-aware depth totals. */
  completedDepths: number | null
  generatedStates: number | null
  frontierStatesAfter: number | null
  representativeCompareCalls: number | null
}

export interface Phase2C26A9A8Authority {
  measuredHead: string
  analysisHead: string
  conditions: Json
  profilerConfig: Json
  primaryOrientationIds: string[]
  /** A8 primaries whose profile was a valid decision input (the formal profile before / after comparison set). */
  validPrimaryOrientationIds: string[]
  references: Phase2C26A9A8Reference[]
  decisionCase: string
  /** The A8 raw run the A8 RESULT recorded (semantic parity and direct timing reference). */
  runSha256: string
}

export interface Phase2C26A9A8AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A9A8Authority | null
}

function a8Reference(value: unknown): Phase2C26A9A8Reference | null {
  if (!isObject(value) || typeof value.orientationId !== 'string' || !isObject(value.decisionRow)) return null
  const row = value.decisionRow
  if (typeof row.valid !== 'boolean' || !isObject(row.shares) || num(row.frontierSamples) === null) return null
  const shares: Record<string, number> = {}
  for (const [key, share] of Object.entries(row.shares)) {
    if (num(share) === null) return null
    shares[key] = share as number
  }
  const totals = isObject(value.depthWorkWholeRun) ? value.depthWorkWholeRun : {}
  return { orientationId: value.orientationId, childOutcome: String(value.childOutcome), profileValid: row.valid,
    invalidReasons: asArray(row.invalidReasons).map(String), negativeTimeDeltas: num(row.negativeTimeDeltas), frontierSamples: row.frontierSamples as number, shares,
    largestCategory: typeof row.largestCategory === 'string' ? row.largestCategory : null, completedDepths: num(totals.completedDepths),
    generatedStates: num(totals.generatedStates), frontierStatesAfter: num(totals.frontierStatesAfter), representativeCompareCalls: num(totals.representativeCompareCalls) }
}

/**
 * Reads the committed Phase 2-C2.6-A8 RESULT as untrusted JSON and fails closed unless it is the registered formal A8
 * result (Case S, 3 primaries, 3 timeouts, no semantic failure / contract violation, at least A8's majority of
 * profile-valid primaries, each valid one's largest category the stable serialization) made against exactly the
 * C2.6-A .. A7 RESULT files read and the A7 raw run the A7 RESULT recorded, with A7's selection. The primaries are that
 * selection; the profile-valid ones are A8's own `decision.validPrimaries`.
 */
export function parsePhase2C26A8ResultAuthority(json: unknown, actual: { c26a: string; a2: string; a3: string; a4: string; a5: string; a6: string; a7: string },
  a7: Pick<Phase2C26A8A7Authority, 'primaryOrientationIds' | 'measuredHead' | 'runSha256'>, c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A9A8AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A9A8AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A8 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const profilerConfig = isObject(json.profilerConfig) ? json.profilerConfig : null
  const selection = isObject(json.selectionValidation) ? json.selectionValidation : null
  const rule = isObject(json.selectionRule) ? json.selectionRule : null
  if (!provenance || !summary || !conditions || !profilerConfig || !selection || !rule) return fail('A8 RESULT lacks provenance / summary / conditions / profilerConfig / selection')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) {
    issues.push('A8 provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  }
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (selection.valid !== true) issues.push('selectionValidation.valid is not true')
  if (!isObject(json.conditionParity) || json.conditionParity.valid !== true) issues.push('conditionParity.valid is not true')
  if (!isObject(json.baselineParity) || json.baselineParity.valid !== true) issues.push('baselineParity.valid is not true')
  const expected = PHASE2C26A9_REGISTERED_A8
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  if (summary.semanticFailures !== expected.semanticFailures) issues.push(`summary.semanticFailures ${String(summary.semanticFailures)} is not ${expected.semanticFailures}`)
  if (summary.contractViolations !== expected.contractViolations) issues.push(`summary.contractViolations ${String(summary.contractViolations)} is not ${expected.contractViolations}`)
  const decision = isObject(summary.decision) ? summary.decision : {}
  if (decision.case !== expected.decisionCase) issues.push(`summary.decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  if (decision.category !== expected.decisionCategory) issues.push(`summary.decision.category ${String(decision.category)} is not ${expected.decisionCategory}`)
  const conclusion = isObject(json.conclusion) && isObject(json.conclusion.decision) ? json.conclusion.decision : {}
  if (conclusion.case !== expected.decisionCase) issues.push('conclusion.decision.case differs from the registered case')
  if (typeof provenance.measuredHead !== 'string' || !/^[0-9a-f]{40}$/.test(provenance.measuredHead)) issues.push('A8 provenance.measuredHead is not a commit SHA')
  if (provenance.c26a7MeasuredHead !== a7.measuredHead) issues.push('A8 provenance.c26a7MeasuredHead is not the A7 measured HEAD')

  // The SHA chain: A8 was made against exactly the C2.6-A .. A7 files read and the A7 raw run A7 recorded.
  const chain = isObject(provenance.authorityShaChain) ? provenance.authorityShaChain : {}
  const shaChecks: [unknown, string, string][] = [
    [provenance.c26aResultSha256, actual.c26a, 'provenance.c26aResultSha256'], [provenance.c26aResultRecordedByRunner, actual.c26a, 'provenance.c26aResultRecordedByRunner'],
    [provenance.c26a2ResultSha256, actual.a2, 'provenance.c26a2ResultSha256'], [provenance.c26a2ResultRecordedByRunner, actual.a2, 'provenance.c26a2ResultRecordedByRunner'],
    [provenance.c26a3ResultSha256, actual.a3, 'provenance.c26a3ResultSha256'], [provenance.c26a3ResultRecordedByRunner, actual.a3, 'provenance.c26a3ResultRecordedByRunner'],
    [provenance.c26a4ResultSha256, actual.a4, 'provenance.c26a4ResultSha256'], [provenance.c26a4ResultRecordedByRunner, actual.a4, 'provenance.c26a4ResultRecordedByRunner'],
    [provenance.c26a5ResultSha256, actual.a5, 'provenance.c26a5ResultSha256'], [provenance.c26a5ResultRecordedByRunner, actual.a5, 'provenance.c26a5ResultRecordedByRunner'],
    [provenance.c26a6ResultSha256, actual.a6, 'provenance.c26a6ResultSha256'], [provenance.c26a6ResultRecordedByRunner, actual.a6, 'provenance.c26a6ResultRecordedByRunner'],
    [provenance.c26a7ResultSha256, actual.a7, 'provenance.c26a7ResultSha256'], [provenance.c26a7ResultRecordedByRunner, actual.a7, 'provenance.c26a7ResultRecordedByRunner'],
    [provenance.a7RunSha256, a7.runSha256, 'provenance.a7RunSha256'], [provenance.a7RunShaRecordedByA7, a7.runSha256, 'provenance.a7RunShaRecordedByA7'],
    [chain.c26aShaRecordedByA7, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA7'], [chain.a2ShaRecordedByA7, actual.a2, 'provenance.authorityShaChain.a2ShaRecordedByA7'],
    [chain.a3ShaRecordedByA7, actual.a3, 'provenance.authorityShaChain.a3ShaRecordedByA7'], [chain.a4ShaRecordedByA7, actual.a4, 'provenance.authorityShaChain.a4ShaRecordedByA7'],
    [chain.a5ShaRecordedByA7, actual.a5, 'provenance.authorityShaChain.a5ShaRecordedByA7'], [chain.a6ShaRecordedByA7, actual.a6, 'provenance.authorityShaChain.a6ShaRecordedByA7'],
  ]
  for (const [recorded, actualSha, field] of shaChecks) if (recorded !== actualSha) issues.push(`A8 ${field} is not the SHA-256 of the file read`)
  if (provenance.a7RawShaMatches !== true) issues.push('A8 provenance.a7RawShaMatches is not true')
  if (chain.allMatchFilesRead !== true) issues.push('A8 provenance.authorityShaChain.allMatchFilesRead is not true')
  const sources = isObject(json.sources) ? json.sources : {}
  const sourceChecks: [string, string][] = [['c26aResult', actual.c26a], ['c26a2Result', actual.a2], ['c26a3Result', actual.a3], ['c26a4Result', actual.a4],
    ['c26a5Result', actual.a5], ['c26a6Result', actual.a6], ['c26a7Result', actual.a7], ['a7Run', a7.runSha256]]
  for (const [key, sha] of sourceChecks) if (!isObject(sources[key]) || (sources[key] as Json).sha256 !== sha) issues.push(`A8 sources.${key}.sha256 differs`)
  const runSha = isObject(sources.run) && typeof sources.run.sha256 === 'string' && /^[0-9a-f]{64}$/.test(sources.run.sha256) ? sources.run.sha256 : null
  if (runSha === null) issues.push('A8 sources.run.sha256 is missing')
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A8 provenance.exportSha256 is not the C2.6-A Export')
  if (conditions.exportSha256 !== c26a.conditions.exportSha256) issues.push('A8 conditions.exportSha256 is not the C2.6-A Export')
  if (!same(conditions.searchInstrumentation, PHASE2C26A9_SEARCH_INSTRUMENTATION)) issues.push('A8 conditions.searchInstrumentation is not the A7 pair of observers')
  if (conditions.cpuProfiler !== true) issues.push('A8 conditions.cpuProfiler is not true')
  if (!same(conditions.nodeFlags, PHASE2C26A9_PRIMARY_NODE_FLAGS)) issues.push('A8 conditions.nodeFlags are not the primary flags')
  for (const key of Object.keys(PHASE2C26A9_PROFILER) as (keyof typeof PHASE2C26A9_PROFILER)[]) {
    if (profilerConfig[key] !== PHASE2C26A9_PROFILER[key]) issues.push(`A8 profilerConfig.${key} is not the registered profiler`)
  }

  const primaries = asArray(selection.expected).filter((id): id is string => typeof id === 'string')
  if (primaries.length !== asArray(selection.expected).length) issues.push('A8 selectionValidation.expected is malformed')
  if (!same(primaries, asArray(selection.actual))) issues.push('A8 selectionValidation.actual is not its expected list')
  if (!same(primaries, asArray(rule.primaryOrientationIds))) issues.push('A8 selectionRule.primaryOrientationIds is not its selection')
  if (!same(primaries, a7.primaryOrientationIds)) issues.push('A8 selection is not the A7 primary set')
  if (new Set(primaries).size !== primaries.length) issues.push('A8 selection has a duplicate')
  if (primaries.length !== PHASE2C26A9_REGISTERED_PRIMARY_COUNT) issues.push(`A8 selection has ${primaries.length} primaries, not ${PHASE2C26A9_REGISTERED_PRIMARY_COUNT}`)

  const validPrimaries = asArray(decision.validPrimaries).filter((id): id is string => typeof id === 'string')
  if (validPrimaries.length !== asArray(decision.validPrimaries).length) issues.push('A8 decision.validPrimaries is malformed')
  if (validPrimaries.length < expected.minimumValidPrimaries) issues.push(`A8 has ${validPrimaries.length} profile-valid primaries (< ${expected.minimumValidPrimaries})`)
  const quality = isObject(summary.profileQuality) ? summary.profileQuality : {}
  if (quality.validPrimaries !== validPrimaries.length) issues.push('A8 summary.profileQuality.validPrimaries disagrees with decision.validPrimaries')
  const references: Phase2C26A9A8Reference[] = []
  for (const value of asArray(json.perPrimary)) {
    const reference = a8Reference(value)
    if (reference === null) { issues.push('an A8 perPrimary row is malformed'); continue }
    references.push(reference)
    const row = value as Json
    const parity = isObject(row.semanticParity) ? row.semanticParity : {}
    if (!(isObject(parity.workPrefix) && parity.workPrefix.valid === true && isObject(parity.depthPrefix) && parity.depthPrefix.valid === true)) {
      issues.push(`A8 row ${reference.orientationId} has no valid semantic parity`)
    }
    if (reference.childOutcome !== 'timeout') issues.push(`A8 row ${reference.orientationId} is not a timeout`)
    if (reference.profileValid !== validPrimaries.includes(reference.orientationId)) issues.push(`A8 row ${reference.orientationId} profile validity disagrees with the decision`)
    if (reference.profileValid && reference.largestCategory !== expected.decisionCategory) issues.push(`A8 row ${reference.orientationId} largest category is not ${expected.decisionCategory}`)
    if (reference.profileValid && reference.negativeTimeDeltas !== 0) issues.push(`A8 row ${reference.orientationId} is valid with negative timeDeltas`)
  }
  if (!same(references.map(r => r.orientationId), primaries)) issues.push('A8 perPrimary is not exactly its selection, in order')
  if (!validPrimaries.every(id => primaries.includes(id))) issues.push('A8 decision.validPrimaries holds a non-primary')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), conditions, profilerConfig,
    primaryOrientationIds: primaries, validPrimaryOrientationIds: primaries.filter(id => validPrimaries.includes(id)), references, decisionCase: String(decision.case),
    runSha256: runSha as string } }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A9ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean; note?: string }[]
}

/**
 * Every A8 primary condition must be equal (concurrency 1, the heap-only Node flags, the A7 pair of observers and the
 * registered profiler included), and the current conditions must pass A8's own parity against A7 (which chains to A6 ..
 * A2). The only difference from A8 is the registered Production change; A9 runs no diagnostic.
 */
export function validatePhase2C26A9ConditionParity(current: Phase2C26A2RunConditions & { nodeFlags: readonly string[]; searchInstrumentation: unknown; profiler: unknown },
  a8: Pick<Phase2C26A9A8Authority, 'conditions' | 'profilerConfig'>, a7Conditions: Json, a6Conditions: Json, a5Conditions: Json, a4Conditions: Json, a3Conditions: Json,
  c26a: Pick<Phase2C26A2Authority, 'conditions'>, a2Conditions: Json): Phase2C26A9ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage',
    'nodeFlags', 'searchInstrumentation'] as const
  const currentJson = current as unknown as Json
  const checks: Phase2C26A9ConditionParity['checks'] = keys.map(condition => ({ condition: `a8.${condition}`, current: currentJson[condition], authority: a8.conditions[condition],
    matches: same(currentJson[condition], a8.conditions[condition]) }))
  const profiler = isObject(current.profiler) ? current.profiler : {}
  for (const key of Object.keys(PHASE2C26A9_PROFILER) as (keyof typeof PHASE2C26A9_PROFILER)[]) {
    checks.push({ condition: `a8.profiler.${key}`, current: profiler[key], authority: a8.profilerConfig[key], matches: profiler[key] === a8.profilerConfig[key] })
    checks.push({ condition: `profiler.${key} is registered`, current: profiler[key], authority: PHASE2C26A9_PROFILER[key], matches: profiler[key] === PHASE2C26A9_PROFILER[key] })
  }
  checks.push({ condition: 'A8 ran the CPU profiler', current: a8.conditions.cpuProfiler, authority: true, matches: a8.conditions.cpuProfiler === true,
    note: 'Same profiler, same window: the only registered difference from A8 is the Production change (and no diagnostic).' })
  const a8Parity = validatePhase2C26A8ConditionParity(current, a7Conditions, a6Conditions, a5Conditions, a4Conditions, a3Conditions, c26a, a2Conditions)
  for (const check of a8Parity.checks) checks.push({ condition: `a8parity.${check.condition}`, current: check.current, authority: check.authority, matches: check.matches })
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- selection

/** The current baseline's tasks of the A8 primaries, in baseline order (never an ID fixed here). */
export function selectPhase2C26A9Tasks(tasks: readonly Phase2C26AKernelTask[], a8: Pick<Phase2C26A9A8Authority, 'primaryOrientationIds'>): Phase2C26AKernelTask[] {
  return selectPhase2C26A8Tasks(tasks, a8)
}

export function validatePhase2C26A9Selection(orientations: readonly Phase2C2Orientation[], a8: Pick<Phase2C26A9A8Authority, 'primaryOrientationIds'>,
  c26a: Pick<Phase2C26A2Authority, 'orientations'>) {
  return validatePhase2C26A8Selection(orientations, a8, c26a)
}

// ---------------------------------------------------------------- the kernel (A8 instrumentation, unchanged)

/** The A8 kernel instrumentation unchanged (A7 lifecycle + both section observers + the Search start anchor). */
export function createPhase2C26A9KernelInstrumentation(a7: PlannerAlternativeKernelInstrumentation, options: { now: () => number; onSearchStarted: (atMs: number) => void }):
  PlannerAlternativeKernelInstrumentation {
  return createPhase2C26A8KernelInstrumentation(a7, options)
}

/** One profiled kernel child calculation: the unchanged A8 (= A7) kernel helper. */
export function runPhase2C26A9Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26A8Kernel(input, task, dependencies, instrumentation)
}

