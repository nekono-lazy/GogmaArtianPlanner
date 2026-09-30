/**
 * Issue #154 Phase 2-C2.6-A6: formal re-measurement after the allocation-free Bonus multiset equality, Research only.
 * Never import from Production.
 *
 * Phase 2-C2.6-A5 (Case MULTISET) found that 73-77 % of the CPU samples inside the `bonus_ideal_filter` section sat on
 * the multiset equality stack (`areRestorationBonusSetsEqual()` -> `countBonuses()` -> `bonusKey()`: a JSON key and a
 * `Map` count per side, per raw solution). A6 replaces only that helper in Production
 * (`src/domain/models/domainRules.ts`: a direct 5 x 5 match with a consumed-slot bit mask, the unordered multiset and
 * duplicate-count semantics unchanged) and re-measures the same primaries under exactly the Phase 2-C2.6-A4 conditions
 * and instrumentation (A4's `onSearchRuntime` section boundary observer alone, no CPU profiler), so the A4 formal run is
 * the "before" and this run the "after".
 *
 * Authorities. The committed Phase 2-C2.6-A5 RESULT (formal, Case MULTISET) is the optimization authority and the
 * primary selection authority (its selection is the A4 selection, i.e. the A3 one); it must have been made against
 * exactly the committed C2.6-A / A2 / A3 / A4 RESULT files read (SHA chain). The committed Phase 2-C2.6-A4 RESULT is the
 * "before" evidence. No orientation ID is fixed here.
 *
 * The only calculation difference from the A4 measured HEAD is the one Production file above: the runner and the
 * analyzer both fail closed unless every non-Research, non-test source change between the A4 (and A5) measured HEAD and
 * this measured HEAD is exactly that file.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import type { Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { selectPhase2C26A3Tasks, validatePhase2C26A3Selection } from './plannerGlobalPhase2C26A3'
import {
  PHASE2C26A4_CHILD_HEAP_MB,
  PHASE2C26A4_CONCURRENCY,
  PHASE2C26A4_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A4_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A4_NODE_YIELD,
  PHASE2C26A4_ORIENTATION_BUDGET_MS,
  PHASE2C26A4_SEARCH_INSTRUMENTATION,
} from './plannerGlobalPhase2C26A4'
import {
  PHASE2C26A5_PRIMARY_NODE_FLAGS,
  validatePhase2C26A5ConditionParity,
  type Phase2C26A5A4Authority,
} from './plannerGlobalPhase2C26A5'

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
export const PHASE2C26A6_CHILD_HEAP_MB = PHASE2C26A4_CHILD_HEAP_MB
export const PHASE2C26A6_ORIENTATION_BUDGET_MS = PHASE2C26A4_ORIENTATION_BUDGET_MS
export const PHASE2C26A6_CONCURRENCY = PHASE2C26A4_CONCURRENCY
export const PHASE2C26A6_NODE_YIELD = PHASE2C26A4_NODE_YIELD
export const PHASE2C26A6_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A4_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A6_HEARTBEAT_INTERVAL_MS = PHASE2C26A4_HEARTBEAT_INTERVAL_MS
/** The A4 section boundary observer alone: no CPU profiler, no A3 / A5 instrumentation. */
export const PHASE2C26A6_SEARCH_INSTRUMENTATION = PHASE2C26A4_SEARCH_INSTRUMENTATION
/** A4's (= A5's primary) child flags: the heap limit only, JIT default. */
export const PHASE2C26A6_NODE_FLAGS: readonly string[] = PHASE2C26A5_PRIMARY_NODE_FLAGS

// ---------------------------------------------------------------- the one Production change

/** The Production optimization of this phase: the only calculation source that may differ from the A4 / A5 measured HEADs. */
export const PHASE2C26A6_PRODUCTION_CHANGE: readonly string[] = ['src/domain/models/domainRules.ts']

/** Research harness and test-only sources: never part of the Production calculation. */
export function isPhase2C26A6ResearchOrTestSource(path: string): boolean {
  return path.startsWith('src/benchmarks/') || path.startsWith('src/test/') || /\.test\.tsx?$/.test(path)
}

export interface Phase2C26A6ProductionChangeValidation {
  valid: boolean
  issues: string[]
  /** Every changed path under `src`, as given. */
  changed: string[]
  /** The changed Production calculation sources (Research / test sources removed), sorted. */
  productionChanged: string[]
}

/**
 * The changed paths under `src` between an earlier measured HEAD and this measured HEAD (`git diff --name-only`) must
 * hold exactly the registered Production change once Research / test sources are removed: any other Production change
 * would make the before / after comparison not the effect of this optimization alone.
 */
export function validatePhase2C26A6ProductionChange(changedSrcPaths: readonly string[]): Phase2C26A6ProductionChangeValidation {
  const changed = [...changedSrcPaths]
  const issues: string[] = []
  const outsideSrc = changed.filter(path => !path.startsWith('src/'))
  if (outsideSrc.length > 0) issues.push(`paths outside src were given: ${outsideSrc.join(', ')}`)
  const productionChanged = [...new Set(changed.filter(path => path.startsWith('src/') && !isPhase2C26A6ResearchOrTestSource(path)))].sort()
  const expected = [...PHASE2C26A6_PRODUCTION_CHANGE].sort()
  const extra = productionChanged.filter(path => !expected.includes(path))
  const missing = expected.filter(path => !productionChanged.includes(path))
  if (extra.length > 0) issues.push(`unregistered Production change: ${extra.join(', ')}`)
  if (missing.length > 0) issues.push(`the registered Production change is missing: ${missing.join(', ')}`)
  return { valid: issues.length === 0, issues, changed, productionChanged }
}

// ---------------------------------------------------------------- the Phase 2-C2.6-A5 RESULT (optimization / selection authority)

/** The registered Phase 2-C2.6-A5 RESULT this phase is made against. */
export const PHASE2C26A6_REGISTERED_A5 = {
  orientations: 3,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 },
  decisionCase: 'MULTISET_multiset_equality',
  /** A5's registered multiset threshold, which each A5 primary must itself reach (the A5 evidence this phase acts on). */
  multisetThreshold: 0.35,
} as const
export const PHASE2C26A6_REGISTERED_PRIMARY_COUNT = 3

export interface Phase2C26A6A5Reference {
  orientationId: string
  childOutcome: string
  filterIntervalSamples: number
  multisetShare: number
  rankShare: number
  filterCallSiteShare: number
  gcShare: number
}

export interface Phase2C26A6A5Authority {
  measuredHead: string
  analysisHead: string
  conditions: Json
  primaryOrientationIds: string[]
  references: Phase2C26A6A5Reference[]
  decisionCase: string
}

export interface Phase2C26A6A5AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A6A5Authority | null
}

function a5Reference(value: unknown): Phase2C26A6A5Reference | null {
  if (!isObject(value) || typeof value.orientationId !== 'string' || value.variant !== 'jit_default' || !isObject(value.decisionRow)) return null
  const row = value.decisionRow
  const shares = isObject(row.shares) ? row.shares : null
  if (row.valid !== true || row.orientationId !== value.orientationId || shares === null) return null
  const multiset = num(shares.multiset_equality), rank = num(shares.rank_reference_validation), filter = num(shares.filter_or_inlined_predicate), gc = num(shares.gc)
  const samples = num(row.filterIntervalSamples)
  if (multiset === null || rank === null || filter === null || gc === null || samples === null) return null
  return { orientationId: value.orientationId, childOutcome: String(value.childOutcome), filterIntervalSamples: samples, multisetShare: multiset,
    rankShare: rank, filterCallSiteShare: filter, gcShare: gc }
}

/**
 * Reads the committed Phase 2-C2.6-A5 RESULT as untrusted JSON and fails closed unless it is the registered formal A5
 * result (Case MULTISET, 3 valid jit_default primaries, 3 timeouts, every primary with a multiset share >= 0.35) made
 * against exactly the C2.6-A / A2 / A3 / A4 RESULT files read (SHA chain, including every SHA A5 recorded for A4's own
 * chain), and its selection is the A4 selection. The primaries are that selection, never fixed here.
 */
export function parsePhase2C26A5ResultAuthority(json: unknown, actual: { c26a: string; a2: string; a3: string; a4: string },
  a4: Pick<Phase2C26A5A4Authority, 'primaryOrientationIds' | 'measuredHead'>, c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A6A5AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A6A5AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A5 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const selection = isObject(json.selectionValidation) ? json.selectionValidation : null
  const rule = isObject(json.selectionRule) ? json.selectionRule : null
  if (!provenance || !summary || !conditions || !selection || !rule) return fail('A5 RESULT lacks provenance / summary / conditions / selection')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (selection.valid !== true) issues.push('selectionValidation.valid is not true')
  if (!isObject(json.conditionParity) || json.conditionParity.valid !== true) issues.push('conditionParity.valid is not true')
  if (!isObject(json.baselineParity) || json.baselineParity.valid !== true) issues.push('baselineParity.valid is not true')
  const expected = PHASE2C26A6_REGISTERED_A5
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  const decision = isObject(summary.decision) ? summary.decision : {}
  if (decision.case !== expected.decisionCase) issues.push(`summary.decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  if (provenance.c26a4MeasuredHead !== a4.measuredHead) issues.push('A5 provenance.c26a4MeasuredHead is not the A4 measured HEAD')

  // The SHA chain: A5 was made against exactly the C2.6-A / A2 / A3 / A4 files read, and every SHA A5 recorded agrees.
  const chain = isObject(provenance.authorityShaChain) ? provenance.authorityShaChain : {}
  const a4Chain = isObject(chain.a4ChainRecordedByA4) ? chain.a4ChainRecordedByA4 : {}
  const shaChecks: [unknown, string, string][] = [
    [provenance.c26aResultSha256, actual.c26a, 'provenance.c26aResultSha256'],
    [provenance.c26aResultRecordedByRunner, actual.c26a, 'provenance.c26aResultRecordedByRunner'],
    [provenance.c26a2ResultSha256, actual.a2, 'provenance.c26a2ResultSha256'],
    [provenance.c26a2ResultRecordedByRunner, actual.a2, 'provenance.c26a2ResultRecordedByRunner'],
    [provenance.c26a3ResultSha256, actual.a3, 'provenance.c26a3ResultSha256'],
    [provenance.c26a3ResultRecordedByRunner, actual.a3, 'provenance.c26a3ResultRecordedByRunner'],
    [provenance.c26a4ResultSha256, actual.a4, 'provenance.c26a4ResultSha256'],
    [provenance.c26a4ResultRecordedByRunner, actual.a4, 'provenance.c26a4ResultRecordedByRunner'],
    [chain.c26aShaRecordedByA4, actual.c26a, 'provenance.authorityShaChain.c26aShaRecordedByA4'],
    [chain.a2ShaRecordedByA4, actual.a2, 'provenance.authorityShaChain.a2ShaRecordedByA4'],
    [chain.a3ShaRecordedByA4, actual.a3, 'provenance.authorityShaChain.a3ShaRecordedByA4'],
    [a4Chain.c26aShaRecordedByA2, actual.c26a, 'provenance.authorityShaChain.a4ChainRecordedByA4.c26aShaRecordedByA2'],
    [a4Chain.c26aShaRecordedByA3, actual.c26a, 'provenance.authorityShaChain.a4ChainRecordedByA4.c26aShaRecordedByA3'],
    [a4Chain.c26aShaRecordedByA3ForA2, actual.c26a, 'provenance.authorityShaChain.a4ChainRecordedByA4.c26aShaRecordedByA3ForA2'],
    [a4Chain.a2ShaRecordedByA3, actual.a2, 'provenance.authorityShaChain.a4ChainRecordedByA4.a2ShaRecordedByA3'],
  ]
  for (const [recorded, actualSha, field] of shaChecks) if (recorded !== actualSha) issues.push(`A5 ${field} is not the SHA-256 of the file read`)
  if (chain.allMatchFilesRead !== true || a4Chain.allMatchFilesRead !== true) issues.push('A5 provenance.authorityShaChain.allMatchFilesRead is not true')
  const sources = isObject(json.sources) ? json.sources : {}
  const sourceChecks: [string, string][] = [['c26aResult', actual.c26a], ['c26a2Result', actual.a2], ['c26a3Result', actual.a3], ['c26a4Result', actual.a4]]
  for (const [key, sha] of sourceChecks) if (!isObject(sources[key]) || (sources[key] as Json).sha256 !== sha) issues.push(`A5 sources.${key}.sha256 differs`)
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A5 provenance.exportSha256 is not the C2.6-A Export')
  if (conditions.exportSha256 !== c26a.conditions.exportSha256) issues.push('A5 conditions.exportSha256 is not the C2.6-A Export')

  const primaries = asArray(selection.expected).filter((id): id is string => typeof id === 'string')
  if (primaries.length !== asArray(selection.expected).length) issues.push('A5 selectionValidation.expected is malformed')
  if (!same(primaries, asArray(selection.actual))) issues.push('A5 selectionValidation.actual is not its expected list')
  if (!same(primaries, asArray(rule.primaryOrientationIds))) issues.push('A5 selectionRule.primaryOrientationIds is not its selection')
  if (!same(primaries, a4.primaryOrientationIds)) issues.push('A5 selection is not the A4 primary set')
  if (new Set(primaries).size !== primaries.length) issues.push('A5 selection has a duplicate')
  if (primaries.length !== PHASE2C26A6_REGISTERED_PRIMARY_COUNT) issues.push(`A5 selection has ${primaries.length} primaries, not ${PHASE2C26A6_REGISTERED_PRIMARY_COUNT}`)
  const validPrimaries = asArray(decision.validPrimaries)
  if (!same(validPrimaries, primaries)) issues.push('A5 decision.validPrimaries is not its selection')
  const atThreshold = isObject(decision.primariesAtThreshold) ? asArray(decision.primariesAtThreshold.multiset_equality) : []
  if (!same(atThreshold, primaries)) issues.push('A5 decision.primariesAtThreshold.multiset_equality is not its whole selection')
  const references: Phase2C26A6A5Reference[] = []
  for (const value of asArray(json.perPrimary)) {
    const reference = a5Reference(value)
    if (reference === null) { issues.push('an A5 perPrimary row is malformed or not a valid jit_default row'); continue }
    references.push(reference)
  }
  if (!same(references.map(r => r.orientationId), primaries)) issues.push('A5 perPrimary is not exactly its selection, in order')
  for (const reference of references) {
    if (reference.childOutcome !== 'timeout') issues.push(`A5 row ${reference.orientationId} is not a timeout`)
    if (!(reference.multisetShare >= expected.multisetThreshold)) issues.push(`A5 row ${reference.orientationId} multiset share ${reference.multisetShare} < ${expected.multisetThreshold}`)
  }
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), conditions,
    primaryOrientationIds: primaries, references, decisionCase: String(decision.case) } }
}

// ---------------------------------------------------------------- the "before": Phase 2-C2.6-A4 perOrientation rows

/** The A4 formal "before" of one primary (read from the committed A4 RESULT, never re-measured). */
export interface Phase2C26A6Before {
  orientationId: string
  childOutcome: string
  resultClass: string
  searchCompleted: boolean
  searchWallMs: number
  categoryTotalsMs: Record<string, number>
  categoryShare: Record<string, number>
  coverage: number
  rawSolutions: number
  idealSolutions: number
  bonusDepthWorks: number
  bonusIdealFilterMedianNsPerRawSolution: number
  bonusDepthReadMedianNsPerRawSolution: number
  counters: Json
  predictionCounts: Json
  memory: Json
}

/** Reads the A4 perOrientation rows of the given primaries, failing closed on a missing or malformed row. */
export function readPhase2C26A6Before(a4Json: unknown, primaryOrientationIds: readonly string[]): { valid: boolean; issues: string[]; rows: Phase2C26A6Before[] } {
  const issues: string[] = []
  const rows: Phase2C26A6Before[] = []
  const perOrientation = isObject(a4Json) ? asArray(a4Json.perOrientation).filter(isObject) : []
  for (const id of primaryOrientationIds) {
    const row = perOrientation.find(r => r.orientationId === id)
    const search = row && isObject(row.primarySearch) ? row.primarySearch : null
    const depth = search && isObject(search.bonusDepth) ? search.bonusDepth : null
    const work = row && isObject(row.bonusWork) && isObject(row.bonusWork.nsPerRawSolution) ? row.bonusWork.nsPerRawSolution : null
    const filterNs = work && isObject(work.bonus_ideal_filter) ? num(work.bonus_ideal_filter.median) : null
    const readNs = work && isObject(work.bonus_depth_read) ? num(work.bonus_depth_read.median) : null
    const wall = search ? num(search.searchWallMs) : null
    const coverage = search ? num(search.coverage) : null
    const raw = depth ? num(depth.rawSolutions) : null
    const ideal = depth ? num(depth.idealSolutions) : null
    const works = depth ? num(depth.works) : null
    if (!row || !search || !isObject(search.categoryTotalsMs) || !isObject(search.categoryShare) || wall === null || coverage === null || raw === null
      || ideal === null || works === null || filterNs === null || readNs === null || typeof search.completed !== 'boolean') {
      issues.push(`A4 perOrientation row ${id} is missing or malformed`)
      continue
    }
    rows.push({ orientationId: id, childOutcome: String(row.childOutcome), resultClass: String(row.resultClass), searchCompleted: search.completed, searchWallMs: wall,
      categoryTotalsMs: search.categoryTotalsMs as Record<string, number>, categoryShare: search.categoryShare as Record<string, number>, coverage,
      rawSolutions: raw, idealSolutions: ideal, bonusDepthWorks: works, bonusIdealFilterMedianNsPerRawSolution: filterNs, bonusDepthReadMedianNsPerRawSolution: readNs,
      counters: isObject(row.counters) ? row.counters : {}, predictionCounts: isObject(row.predictionCounts) ? row.predictionCounts : {},
      memory: isObject(row.memory) ? row.memory : {} })
  }
  return { valid: issues.length === 0, issues, rows }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A6ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean }[]
}

/**
 * Every A5 primary condition must be equal (concurrency 1, the primary Node flags and the A4 Search instrumentation
 * included), and the current conditions must pass A5's own parity against A4 (which carries A4's parity against A3 /
 * C2.6-A / A2).
 */
export function validatePhase2C26A6ConditionParity(current: Phase2C26A2RunConditions & { nodeFlags: readonly string[] }, a5Conditions: Json, a4Conditions: Json,
  a3Conditions: Json, c26a: Pick<Phase2C26A2Authority, 'conditions'>, a2Conditions: Json): Phase2C26A6ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage', 'nodeFlags'] as const
  const currentJson = current as unknown as Json
  const checks: Phase2C26A6ConditionParity['checks'] = keys.map(condition => ({ condition: `a5.${condition}`, current: currentJson[condition], authority: a5Conditions[condition],
    matches: same(currentJson[condition], a5Conditions[condition]) }))
  checks.push({ condition: 'nodeFlags are the A4 / A5 primary flags', current: current.nodeFlags, authority: PHASE2C26A6_NODE_FLAGS, matches: same(current.nodeFlags, PHASE2C26A6_NODE_FLAGS) })
  checks.push({ condition: 'A5 searchInstrumentation', current: PHASE2C26A6_SEARCH_INSTRUMENTATION, authority: a5Conditions.searchInstrumentation,
    matches: same(PHASE2C26A6_SEARCH_INSTRUMENTATION, a5Conditions.searchInstrumentation) })
  const a5Parity = validatePhase2C26A5ConditionParity(current, a4Conditions, a3Conditions, c26a, a2Conditions)
  for (const check of a5Parity.checks) checks.push({ condition: `a4.${check.condition}`, current: check.current, authority: check.authority, matches: check.matches })
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- selection

/** The current baseline's tasks of the A5 primaries, in baseline order as A3 / A4 / A5 took them (never an ID fixed here). */
export function selectPhase2C26A6Tasks(tasks: readonly Phase2C26AKernelTask[], a5: Pick<Phase2C26A6A5Authority, 'primaryOrientationIds'>): Phase2C26AKernelTask[] {
  return selectPhase2C26A3Tasks(tasks, a5.primaryOrientationIds)
}

export function validatePhase2C26A6Selection(orientations: readonly Phase2C2Orientation[], a5: Pick<Phase2C26A6A5Authority, 'primaryOrientationIds'>,
  c26a: Pick<Phase2C26A2Authority, 'orientations'>) {
  return validatePhase2C26A3Selection(orientations, a5.primaryOrientationIds, c26a)
}
