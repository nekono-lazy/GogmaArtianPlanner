/**
 * Issue #154 Phase 2-C2.6-A9: before (A8 formal) / after (A9) analysis of the held-aware `frontier_reduction_sort`
 * optimization, Research only. Never import from Production.
 *
 * - The A9 CPU profiles are classified with the unchanged A8 rules (`analyzePhase2C26A8Profile()`, the A8 categories and
 *   the A8 profile validity, negative timeDelta fail-closed included). The new `reservedBonusStableKey` frame is not a
 *   registered function: a sample in it with a serialization frame below is still `representative_stable_serialization`
 *   (a cache miss), one without is `representative_compare_or_inlined` (the WeakMap lookup), exactly as the A8 rule reads
 *   any frame between the comparator and the serialization. A descriptive count of the helper frame is added.
 * - The before profile shares are the A8 RESULT's own, of A8's profile-valid primaries only.
 * - The direct section timing is compared on the semantic common prefix of the held-aware depth records (identity and
 *   counts equal on both sides), so the same work is timed on both sides: `frontier_reduction_sort` ms per
 *   representative comparison (`generatedStates - frontierStatesAfter`).
 * - Semantic parity: the A6 completed-work prefix, the A8 held-aware depth prefix and the lifecycle prefix.
 * - The pre-registered decision rule (Case O / P / N), fixed before the formal run.
 */
import { stableStringify } from '../domain/models/publicTypes'
import { RESERVED_GOGMA_RUNTIME_PHASES } from '../domain/search/bonusStream'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import type { Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import type { Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import { PHASE2C26A4_SEARCH_INSTRUMENTATION } from './plannerGlobalPhase2C26A4'
import { validatePhase2C26A4FormalRun } from './plannerGlobalPhase2C26A4Analysis'
import type { Phase2C26A5A4Authority, Phase2C26A5ProfileWindow } from './plannerGlobalPhase2C26A5'
import { normalizePhase2C26A5Url, phase2c26a5SampleTimesUs, validatePhase2C26A5ClockAlignment, type CpuProfile, type Phase2C26A5ScriptTable } from './plannerGlobalPhase2C26A5Analysis'
import type { Phase2C26A6A5Authority } from './plannerGlobalPhase2C26A6'
import type { Phase2C26A6WorkPrefix } from './plannerGlobalPhase2C26A6Analysis'
import type { Phase2C26A7A6Authority } from './plannerGlobalPhase2C26A7'
import type { Phase2C26A8A7Authority } from './plannerGlobalPhase2C26A8'
import {
  phase2c26a8KernelOrigin,
  resolvePhase2C26A8Frame,
  type Phase2C26A8Category,
  type Phase2C26A8DecisionRow,
  type Phase2C26A8DepthPrefix,
  type Phase2C26A8FunctionSpan,
  type Phase2C26A8IntervalReconstruction,
} from './plannerGlobalPhase2C26A8Analysis'
import {
  PHASE2C26A9_CHILD_HEAP_MB,
  PHASE2C26A9_CONCURRENCY,
  PHASE2C26A9_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A9_ORIENTATION_BUDGET_MS,
  PHASE2C26A9_PRIMARY_NODE_FLAGS,
  PHASE2C26A9_PROFILER,
  PHASE2C26A9_REGISTERED_PRIMARY_COUNT,
  PHASE2C26A9_REQUIRED_SOURCE_FILES,
  PHASE2C26A9_SEARCH_INSTRUMENTATION,
  PHASE2C26A9_SECTION,
  validatePhase2C26A9ConditionParity,
  validatePhase2C26A9ProductionChange,
  validatePhase2C26A9Selection,
  type Phase2C26A9A8Authority,
  type Phase2C26A9ProductionChangeValidation,
} from './plannerGlobalPhase2C26A9'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const ratio = (after: number, before: number) => (before > 0 ? after / before : null)

/** The A8 category the optimization targets. */
export const PHASE2C26A9_SERIALIZATION_CATEGORY: Phase2C26A8Category = 'representative_stable_serialization'

// ---------------------------------------------------------------- direct section timing on the semantic common prefix

const depthRecordsOf = (kernel: unknown) => asArray(isObject(kernel) ? kernel.gogmaRuntime : null).filter(isObject).filter(record => record.kind === 'gogma_depth')
  .sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1))
/** What one held-aware depth computed (never its time); the A8 depth identity. */
const depthIdentity = (record: Json) => stableStringify({ targetOrdinal: record.targetOrdinal ?? null, streamIndex: record.streamIndex ?? null,
  startGogmaCounter: record.startGogmaCounter ?? null, depth: record.depth ?? null, exhausted: record.exhausted ?? null, counts: record.counts ?? null })

export interface Phase2C26A9SectionTotals {
  depths: number
  generatedStates: number
  frontierStatesAfter: number
  /** generatedStates - frontierStatesAfter: the exact compareReservedRepresentative call count. */
  representativeCompareCalls: number
  /** Exclusive wall time per held-aware section (the A3 depth record `phaseMs`), summed. */
  sectionMs: Record<string, number>
  inclusiveMs: number
}

function totalsOf(records: readonly Json[]): Phase2C26A9SectionTotals {
  const sectionMs: Record<string, number> = Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(phase => [phase, 0]))
  let generated = 0, frontier = 0, inclusive = 0
  for (const record of records) {
    const counts = isObject(record.counts) ? record.counts : {}
    generated += num(counts.generatedStates) ?? 0
    frontier += num(counts.frontierStatesAfter) ?? 0
    inclusive += num(record.inclusiveMs) ?? 0
    const phaseMs = isObject(record.phaseMs) ? record.phaseMs : {}
    for (const phase of RESERVED_GOGMA_RUNTIME_PHASES) sectionMs[phase] += num(phaseMs[phase]) ?? 0
  }
  return { depths: records.length, generatedStates: generated, frontierStatesAfter: frontier, representativeCompareCalls: generated - frontier, sectionMs, inclusiveMs: inclusive }
}

export interface Phase2C26A9DirectTiming {
  valid: boolean
  issues: string[]
  beforeDepths: number
  afterDepths: number
  /** Leading depth records equal on both sides (identity and counts); the timing compares exactly these. */
  commonDepths: number
  before: Phase2C26A9SectionTotals
  after: Phase2C26A9SectionTotals
  frontier: {
    beforeMs: number
    afterMs: number
    ratio: number | null
    beforeNsPerCompareCall: number | null
    afterNsPerCompareCall: number | null
    /** after / before of ns per representative comparison (the registered direct measure). */
    perCompareCallRatio: number | null
    beforeNsPerGeneratedState: number | null
    afterNsPerGeneratedState: number | null
  }
  /** after / before per held-aware section over the common prefix. */
  sectionRatios: Record<string, number | null>
}

/**
 * The direct `frontier_reduction_sort` timing of the A8 ("before") and A9 ("after") kernels of one orientation over the
 * leading held-aware depth records that are identical on both sides. A depth mismatch ends the common prefix and makes
 * the timing invalid (the semantic parity reports it).
 */
export function comparePhase2C26A9DirectTiming(beforeKernel: unknown, afterKernel: unknown): Phase2C26A9DirectTiming {
  const before = depthRecordsOf(beforeKernel), after = depthRecordsOf(afterKernel)
  const issues: string[] = []
  const limit = Math.min(before.length, after.length)
  let common = 0
  while (common < limit && depthIdentity(before[common]) === depthIdentity(after[common])) common += 1
  if (common < limit) issues.push(`held-aware depth record ${common} differs (identity or counts)`)
  if (common === 0) issues.push('no common held-aware depth record')
  const b = totalsOf(before.slice(0, common)), a = totalsOf(after.slice(0, common))
  const ns = (ms: number, n: number) => (n > 0 ? (ms * 1e6) / n : null)
  const fb = b.sectionMs[PHASE2C26A9_SECTION], fa = a.sectionMs[PHASE2C26A9_SECTION]
  const perBefore = ns(fb, b.representativeCompareCalls), perAfter = ns(fa, a.representativeCompareCalls)
  return { valid: issues.length === 0, issues, beforeDepths: before.length, afterDepths: after.length, commonDepths: common, before: b, after: a,
    frontier: { beforeMs: fb, afterMs: fa, ratio: ratio(fa, fb), beforeNsPerCompareCall: perBefore, afterNsPerCompareCall: perAfter,
      perCompareCallRatio: perBefore !== null && perAfter !== null ? ratio(perAfter, perBefore) : null,
      beforeNsPerGeneratedState: ns(fb, b.generatedStates), afterNsPerGeneratedState: ns(fa, a.generatedStates) },
    sectionRatios: Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(phase => [phase, ratio(a.sectionMs[phase], b.sectionMs[phase])])) }
}

/** Whole-run held-aware totals of one kernel (descriptive; the two runs reach different depths). */
export function phase2c26a9WholeRunTotals(kernel: unknown): Phase2C26A9SectionTotals {
  return totalsOf(depthRecordsOf(kernel))
}

// ---------------------------------------------------------------- lifecycle prefix (Candidate / trial / Planner progression)

export interface Phase2C26A9LifecyclePrefix {
  valid: boolean
  issues: string[]
  beforeEvents: number
  afterEvents: number
  commonEvents: number
  firstMismatch: { index: number; before: unknown; after: unknown } | null
}

const lifecycleOf = (kernel: unknown) => asArray(isObject(kernel) ? kernel.events : null).filter(isObject).filter(record => record.kind === 'lifecycle')
  .sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1))
/** What one lifecycle event says (the kernel event and the cumulative prediction counts), never its time. */
const lifecycleIdentity = (record: Json) => stableStringify({ event: record.event ?? null, predictionCounts: record.predictionCounts ?? null,
  search: record.search ?? null, searchDepths: record.searchDepths ?? null })

/** The ordered kernel lifecycle events (Target / Search / Candidate / trial / Planner run) must be equal on their common prefix. */
export function comparePhase2C26A9LifecyclePrefix(beforeKernel: unknown, afterKernel: unknown): Phase2C26A9LifecyclePrefix {
  const before = lifecycleOf(beforeKernel), after = lifecycleOf(afterKernel)
  const common = Math.min(before.length, after.length)
  const issues: string[] = []
  let firstMismatch: Phase2C26A9LifecyclePrefix['firstMismatch'] = null
  for (let index = 0; index < common; index += 1) {
    if (lifecycleIdentity(before[index]) !== lifecycleIdentity(after[index])) {
      firstMismatch = { index, before: JSON.parse(lifecycleIdentity(before[index])), after: JSON.parse(lifecycleIdentity(after[index])) }
      break
    }
  }
  if (common === 0) issues.push('no common lifecycle event')
  if (firstMismatch !== null) issues.push(`lifecycle event ${firstMismatch.index} differs`)
  return { valid: issues.length === 0, issues, beforeEvents: before.length, afterEvents: after.length, commonEvents: common, firstMismatch }
}

// ---------------------------------------------------------------- the cache helper frame (descriptive)

export const PHASE2C26A9_CACHE_HELPER = { file: 'src/domain/search/bonusStream.ts', functionName: 'reservedBonusStableKey' } as const

export interface Phase2C26A9CacheHelperSamples {
  /** frontier samples (inside a rebuilt interval) holding the helper frame. */
  withHelper: number
  /** ... with a serialization frame deeper than the helper (a cache miss being serialized). */
  helperWithSerialization: number
  /** ... without one (the WeakMap lookup / return, or JIT-inlined serialization without a frame). */
  helperWithoutSerialization: number
  frontierSamples: number
}

/**
 * Descriptive count of the new helper frame among the samples inside the rebuilt frontier intervals (the same
 * population as the A8 analysis). Returns zeros when the clocks or the reconstruction are not valid, as A8 maps nothing.
 */
export function countPhase2C26A9CacheHelperSamples(profile: CpuProfile, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26A8FunctionSpan[],
  window: Pick<Phase2C26A5ProfileWindow, 'startPre' | 'startPost' | 'stopPre' | 'stopPost'>, reconstruction: Phase2C26A8IntervalReconstruction): Phase2C26A9CacheHelperSamples {
  const result = { withHelper: 0, helperWithSerialization: 0, helperWithoutSerialization: 0, frontierSamples: 0 }
  const alignment = validatePhase2C26A5ClockAlignment(profile, window)
  if (!alignment.valid || alignment.offsetMs === null || !reconstruction.valid) return result
  const offset = alignment.offsetMs
  const intervals = reconstruction.intervals
  const starts = intervals.map(i => i.startMs), ends = intervals.map(i => i.endMs)
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))
  const parent = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const kindMemo = new Map<number, 'helper' | 'serialization' | null>()
  const kindOf = (id: number) => {
    if (kindMemo.has(id)) return kindMemo.get(id) as 'helper' | 'serialization' | null
    const callFrame = (nodes.get(id) as CpuProfile['nodes'][number]).callFrame
    const file = normalizePhase2C26A5Url(callFrame.url !== '' ? callFrame.url : (scripts.urlOf(callFrame.scriptId) ?? ''))
    let kind: 'helper' | 'serialization' | null = null
    if (file === PHASE2C26A9_CACHE_HELPER.file && callFrame.functionName === PHASE2C26A9_CACHE_HELPER.functionName) kind = 'helper'
    else if (resolvePhase2C26A8Frame(callFrame, scripts, spans).role === 'serialization') kind = 'serialization'
    kindMemo.set(id, kind)
    return kind
  }
  const { timesUs } = phase2c26a5SampleTimesUs(profile)
  for (let i = 0; i < profile.samples.length; i++) {
    const t = timesUs[i] / 1000 - offset
    let lo = 0, hi = starts.length - 1, k = -1
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= t) { k = mid; lo = mid + 1 } else hi = mid - 1 }
    if (!(k >= 0 && t < ends[k])) continue
    result.frontierSamples += 1
    // Outermost first: is there a helper frame, and a serialization frame deeper than it?
    const stack: ('helper' | 'serialization' | null)[] = []
    for (let id: number | undefined = profile.samples[i]; id !== undefined; id = parent.get(id)) stack.unshift(kindOf(id))
    const helper = stack.indexOf('helper')
    if (helper < 0) continue
    result.withHelper += 1
    if (stack.some((kind, index) => index > helper && kind === 'serialization')) result.helperWithSerialization += 1
    else result.helperWithoutSerialization += 1
  }
  return result
}

// ---------------------------------------------------------------- the pre-registered decision rule

export const PHASE2C26A9_DECISION_RULE = {
  comparisonSet: 'the A8 profile-valid primaries (A8 RESULT summary.decision.validPrimaries); an A8-invalid profile is never a before value',
  serializationCategory: PHASE2C26A9_SERIALIZATION_CATEGORY,
  /** A clear serialization reduction: A9 share <= this x A8 share (each primary of the comparison set, A9 profile valid). */
  clearSerializationReductionMaxRatio: 0.5,
  /** A clear direct improvement: A9 frontier_reduction_sort ns per representative comparison <= this x A8, on the common prefix. */
  clearDirectImprovementMaxRatio: 0.75,
  /** A regression: A9 frontier_reduction_sort ns per representative comparison > this x A8, on the common prefix. */
  directRegressionMinRatio: 1,
  profileValidity: 'the unchanged A8 rule (phase2c26a8DecisionRow): complete capture, valid clock alignment and interval reconstruction, negativeDeltas = 0 (no timestamp correction), >= 5,000 frontier samples, every named registered frame at its declaration line, comparator samples outside the intervals <= 1 %',
  semanticParity: 'every primary (all three): the A6 completed-work prefix, the A8 held-aware depth prefix and the lifecycle prefix against the A8 formal raw run are valid, and the direct timing common prefix is mismatch-free',
  order: [
    'N semantic_mismatch: any primary fails the semantic parity (whatever the performance)',
    'O optimization_adopted: every comparison-set primary has a valid A9 profile with a serialization share <= 0.5 x its A8 share AND a direct frontier ns / comparison <= 0.75 x its A8 value',
    'N regression: any comparison-set primary has a direct frontier ns / comparison > 1.0 x its A8 value',
    'N no_effect: no comparison-set primary has a valid A9 serialization share below its A8 share, or none has a direct frontier ns / comparison below its A8 value',
    'P partial_or_shifted: otherwise (semantic parity valid, some reduction, but not every O condition)',
  ],
} as const

export type Phase2C26A9DecisionCase = 'O_optimization_adopted' | 'P_partial_or_shifted' | 'N_not_adopted'

export const PHASE2C26A9_RECOMMENDATION: Record<Phase2C26A9DecisionCase, string> = {
  O_optimization_adopted: 'optimizationを採用する。次は54 orientation再評価へ進む候補（その前に必要ならA9後のhotspotを確認する）。',
  P_partial_or_shifted: 'semantic parityは維持され一部改善したが、事前登録のO条件をすべては満たさない。optimization自体の効果とA9後のhotspot（最大category）を整理し、次hotspotを確認してから54 orientationへ進むか判断する。',
  N_not_adopted: 'このoptimizationをそのまま採用しない（semantic mismatch、効果なし、または明確なregression）。原因を調査する。',
}

export interface Phase2C26A9ComparisonRow {
  orientationId: string
  a8Share: number
  a9ProfileValid: boolean
  a9InvalidReasons: string[]
  a9Share: number | null
  /** a9Share / a8Share (null when the A9 profile is invalid). */
  shareRatio: number | null
  directPerCompareCallRatio: number | null
  serializationReduced: boolean
  serializationLower: boolean
  directImproved: boolean
  directLower: boolean
  directRegression: boolean
}

export function phase2c26a9ComparisonRow(orientationId: string, a8: { share: number }, a9: Pick<Phase2C26A8DecisionRow, 'valid' | 'invalidReasons' | 'shares'> | null,
  direct: Pick<Phase2C26A9DirectTiming, 'valid'> & { frontier: Pick<Phase2C26A9DirectTiming['frontier'], 'perCompareCallRatio'> } | null): Phase2C26A9ComparisonRow {
  const rule = PHASE2C26A9_DECISION_RULE
  const a9Valid = a9 !== null && a9.valid
  const a9Share = a9Valid ? a9.shares[rule.serializationCategory] : null
  const shareRatio = a9Share !== null && a8.share > 0 ? a9Share / a8.share : null
  const directRatio = direct !== null && direct.valid ? direct.frontier.perCompareCallRatio : null
  return { orientationId, a8Share: a8.share, a9ProfileValid: a9Valid, a9InvalidReasons: a9 === null ? ['no A9 profile row'] : [...a9.invalidReasons], a9Share, shareRatio,
    directPerCompareCallRatio: directRatio,
    serializationReduced: shareRatio !== null && shareRatio <= rule.clearSerializationReductionMaxRatio,
    serializationLower: shareRatio !== null && shareRatio < 1,
    directImproved: directRatio !== null && directRatio <= rule.clearDirectImprovementMaxRatio,
    directLower: directRatio !== null && directRatio < 1,
    directRegression: directRatio !== null && directRatio > rule.directRegressionMinRatio }
}

/** The pre-registered A9 decision. `semanticParity` covers every primary; `rows` are the comparison set (A8-valid primaries). */
export function phase2c26a9Decision(rows: readonly Phase2C26A9ComparisonRow[], semanticParity: readonly { orientationId: string; valid: boolean }[]) {
  const rule = PHASE2C26A9_DECISION_RULE
  const mismatched = semanticParity.filter(row => !row.valid).map(row => row.orientationId)
  let decisionCase: Phase2C26A9DecisionCase
  let reason: string
  if (semanticParity.length !== PHASE2C26A9_REGISTERED_PRIMARY_COUNT) { decisionCase = 'N_not_adopted'; reason = `semantic parity covers ${semanticParity.length} primaries, not ${PHASE2C26A9_REGISTERED_PRIMARY_COUNT}` }
  else if (mismatched.length > 0) { decisionCase = 'N_not_adopted'; reason = `semantic mismatch: ${mismatched.join(', ')}` }
  else if (rows.length === 0) { decisionCase = 'N_not_adopted'; reason = 'no comparison-set primary' }
  else if (rows.every(row => row.a9ProfileValid && row.serializationReduced && row.directImproved)) {
    decisionCase = 'O_optimization_adopted'
    reason = `every comparison-set primary: serialization share <= ${rule.clearSerializationReductionMaxRatio} x A8 and frontier ns / comparison <= ${rule.clearDirectImprovementMaxRatio} x A8 (${rows.map(row => `${row.orientationId}: share ${row.shareRatio?.toFixed(3)} x, direct ${row.directPerCompareCallRatio?.toFixed(3)} x`).join('; ')})`
  } else if (rows.some(row => row.directRegression)) {
    decisionCase = 'N_not_adopted'
    reason = `regression: frontier ns / comparison > ${rule.directRegressionMinRatio} x A8 in ${rows.filter(row => row.directRegression).map(row => row.orientationId).join(', ')}`
  } else if (!rows.some(row => row.serializationLower) || !rows.some(row => row.directLower)) {
    decisionCase = 'N_not_adopted'
    reason = `no effect: serialization share lower in ${rows.filter(row => row.serializationLower).length}, direct lower in ${rows.filter(row => row.directLower).length} of ${rows.length} comparison-set primaries`
  } else {
    decisionCase = 'P_partial_or_shifted'
    reason = `not every O condition: ${rows.map(row => `${row.orientationId}: profile ${row.a9ProfileValid ? 'valid' : 'invalid'}, share ${row.shareRatio?.toFixed(3) ?? '-'} x, direct ${row.directPerCompareCallRatio?.toFixed(3) ?? '-'} x`).join('; ')}`
  }
  return { rule, comparisonSet: rows.map(row => row.orientationId), rows, semanticParity, case: decisionCase, reason, recommendation: PHASE2C26A9_RECOMMENDATION[decisionCase] }
}

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A9FormalRunValidation {
  valid: boolean
  failures: string[]
  a4FormalRun: { valid: boolean; failures: string[] }
  shaMatches: Record<'a4' | 'a5' | 'a6' | 'a7' | 'a8', boolean>
  probeValid: boolean
  profilerConfig: unknown
  searchInstrumentation: unknown
  nodeFlags: unknown
  conditionParity: ReturnType<typeof validatePhase2C26A9ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A9Selection> | null
  productionChangeRecordedByRunner: Phase2C26A9ProductionChangeValidation | null
  productionChangeRederived: Phase2C26A9ProductionChangeValidation
  optimizationSource: { valid: boolean; issues: string[] }
  a8RawShaMatches: boolean
  parityCoverage: { work: string[]; depth: string[]; lifecycle: string[] }
  recordIssues: { id: string; issue: string }[]
}

/**
 * The raw run is the formal A9 series only when: its Search instrumentation is exactly the A7 pair and, with the A4
 * observer set in its place, it passes the A4 formal-run contract unchanged (clean non-smoke committed code, concurrency
 * 1, heap / budget / heartbeat, baseline / condition / selection parity, well-formed record streams); it was made against
 * exactly the A4 .. A8 RESULT files read; the profiler probe succeeded with the registered profiler and Node flags; its
 * conditions pass the A9 parity (A8 conditions, chaining to A7 .. A2); the orientations are exactly the A8 selection and
 * no diagnostic ran; the only Production calculation change since the A8 measured HEAD is the registered file (as
 * recorded and as re-derived from git) and its measured source holds the registered optimization; every profiled child
 * left a complete capture, its kernel origin and a contiguous held-aware stream with no contract violation; the A8 raw
 * run is the one the A8 RESULT recorded; and the parity comparisons cover exactly the A8 primaries. A semantic mismatch
 * is not a formal failure: it is the registered Case N.
 */
export function validatePhase2C26A9FormalRun(raw: unknown, authorities: { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority;
  a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority; a6: Phase2C26A7A6Authority; a7: Phase2C26A8A7Authority; a8: Phase2C26A9A8Authority },
shas: { c26a: string; a2: string; a3: string; a4: string; a5: string; a6: string; a7: string; a8: string },
evidence: { productionChangeSinceA8: readonly string[]; optimizationSource: { valid: boolean; issues: string[] }; a8RawShaMatches: boolean;
  workPrefix: readonly { orientationId: string; prefix: Phase2C26A6WorkPrefix }[]; depthPrefix: readonly { orientationId: string; prefix: Phase2C26A8DepthPrefix }[];
  lifecyclePrefix: readonly { orientationId: string; prefix: Phase2C26A9LifecyclePrefix }[] }): Phase2C26A9FormalRunValidation {
  const { c26a, a2, a3, a4, a5, a6, a7, a8 } = authorities
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  const searchInstrumentation = environment.searchInstrumentation
  const instrumentationIsA9 = same(searchInstrumentation, PHASE2C26A9_SEARCH_INSTRUMENTATION)
  if (!instrumentationIsA9) failures.push('the Search instrumentation is not the A7 pair of boundary observers')
  const a4View = instrumentationIsA9 ? { ...r, environment: { ...environment, searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION } } : r
  const a4Run = validatePhase2C26A4FormalRun(a4View, c26a, a2, a3, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 })
  if (!a4Run.valid) failures.push(...a4Run.failures.map(failure => `A4 formal-run contract: ${failure}`))
  const shaMatches = { a4: environment.c26a4ResultSha256 === shas.a4, a5: environment.c26a5ResultSha256 === shas.a5, a6: environment.c26a6ResultSha256 === shas.a6,
    a7: environment.c26a7ResultSha256 === shas.a7, a8: environment.c26a8ResultSha256 === shas.a8 }
  for (const [key, matches] of Object.entries(shaMatches)) if (!matches) failures.push(`the raw run was not made against this C2.6-${key.toUpperCase()} RESULT`)
  const probe = isObject(r.probe) ? r.probe : {}
  const probeValid = probe.valid === true
  if (!probeValid) failures.push('the profiler probe did not succeed')
  const profilerConfig = environment.profiler
  if (!same(profilerConfig, PHASE2C26A9_PROFILER)) failures.push('the profiler window / sampling interval is not the registered one')
  if (environment.childHeapLimitMb !== PHASE2C26A9_CHILD_HEAP_MB || environment.concurrency !== PHASE2C26A9_CONCURRENCY
    || environment.orientationBudgetMs !== PHASE2C26A9_ORIENTATION_BUDGET_MS || environment.heartbeatIntervalMs !== PHASE2C26A9_HEARTBEAT_INTERVAL_MS) {
    failures.push('run environment is not the registered heap / concurrency 1 / budget / heartbeat')
  }
  if (!same(environment.nodeFlags, PHASE2C26A9_PRIMARY_NODE_FLAGS)) failures.push('primary Node flags are not the registered ones')
  if (r.diagnostic !== null) failures.push('A9 runs no diagnostic')

  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions : null
  let conditionParity = null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A9ConditionParity({ ...current, nodeFlags: asArray(environment.nodeFlags) as string[], searchInstrumentation, profiler: profilerConfig },
      a8, a7.conditions, a6.conditions, a5.conditions, a4.conditions, a3.conditions, c26a, a2.conditions)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `A9 condition parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const selection = validatePhase2C26A9Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean), a8, c26a)
  if (!selection.valid) failures.push('the profiled orientations are not exactly the A8 primary set')
  if (a8.primaryOrientationIds.length !== PHASE2C26A9_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')

  const recorded = isObject(environment.productionChange) ? environment.productionChange : null
  const recordedSinceA8 = recorded ? validatePhase2C26A9ProductionChange(asArray(recorded.sinceA8MeasuredHead) as string[]) : null
  if (!recordedSinceA8) failures.push('the runner did not record the Production change since the A8 measured HEAD')
  else if (!recordedSinceA8.valid) failures.push('the runner recorded a Production change other than the registered one since the A8 measured HEAD')
  if (recorded && recorded.a8MeasuredHead !== a8.measuredHead) failures.push('the runner recorded the Production change against another measured HEAD')
  const rederived = validatePhase2C26A9ProductionChange(evidence.productionChangeSinceA8)
  if (!rederived.valid) failures.push('the re-derived Production change since the A8 measured HEAD is not exactly the registered one')
  if (!evidence.optimizationSource.valid) failures.push(`the measured bonusStream.ts is not the registered optimization: ${evidence.optimizationSource.issues.join('; ')}`)

  const recordIssues: Phase2C26A9FormalRunValidation['recordIssues'] = []
  for (const k of kernels) {
    const id = `jit_default:${String(k.orientationId)}`
    if (k.variant !== 'jit_default') recordIssues.push({ id, issue: `variant is ${String(k.variant)}` })
    const flags = isObject(k.process) ? k.process.nodeFlags : null
    if (!same(flags, PHASE2C26A9_PRIMARY_NODE_FLAGS)) recordIssues.push({ id, issue: 'child Node flags differ' })
    if (phase2c26a8KernelOrigin(k) === null) recordIssues.push({ id, issue: 'no kernel origin (kernel_invoked)' })
    const gogma = asArray(k.gogmaRuntime).filter(isObject)
    if (gogma.length === 0) recordIssues.push({ id, issue: 'no held-aware runtime record' })
    if ([...gogma].sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1)).some((record, index) => record.seq !== index + 1)) recordIssues.push({ id, issue: 'held-aware sequence is not contiguous from 1' })
    const heartbeats = asArray(k.heartbeats).filter(isObject).filter(record => record.kind === 'heartbeat')
    const gogmaRuntime = isObject(heartbeats.at(-1)?.gogmaRuntime) ? heartbeats.at(-1)?.gogmaRuntime as Json : null
    if (gogmaRuntime === null) recordIssues.push({ id, issue: 'last heartbeat has no held-aware runtime' })
    else if (gogmaRuntime.contractViolations !== 0) recordIssues.push({ id, issue: `${String(gogmaRuntime.contractViolations)} held-aware contract violations` })
    const capture = isObject(k.capture) ? k.capture : null
    if (!capture) { recordIssues.push({ id, issue: 'no profile capture' }); continue }
    if (!isObject(capture.profile) || typeof capture.profile.file !== 'string' || typeof capture.profile.sha256 !== 'string') recordIssues.push({ id, issue: 'profile file record missing' })
    if (!isObject(capture.scripts) || typeof capture.scripts.file !== 'string' || typeof capture.scripts.sha256 !== 'string') recordIssues.push({ id, issue: 'script table record missing' })
    const required = isObject(capture.scripts) && isObject(capture.scripts.requiredSourceMaps) ? capture.scripts.requiredSourceMaps : {}
    for (const file of PHASE2C26A9_REQUIRED_SOURCE_FILES) if (required[file] !== true) recordIssues.push({ id, issue: `no source map for ${file}` })
    const window = isObject(capture.window) ? capture.window : {}
    if (window.error !== null) recordIssues.push({ id, issue: `profile window error ${String(window.error)}` })
    if (window.stoppedBy !== 'window') recordIssues.push({ id, issue: `profile stopped by ${String(window.stoppedBy)}` })
  }
  if (recordIssues.length > 0) failures.push('profile / record issues')

  if (!evidence.a8RawShaMatches) failures.push('the A8 raw run is not the one the A8 RESULT recorded')
  const parityCoverage = { work: evidence.workPrefix.map(w => w.orientationId), depth: evidence.depthPrefix.map(w => w.orientationId),
    lifecycle: evidence.lifecyclePrefix.map(w => w.orientationId) }
  for (const [name, ids] of Object.entries(parityCoverage)) {
    if (!same(ids, a8.primaryOrientationIds)) failures.push(`the ${name} prefix comparison does not cover exactly the A8 primaries`)
  }
  return { valid: failures.length === 0, failures, a4FormalRun: { valid: a4Run.valid, failures: a4Run.failures }, shaMatches, probeValid, profilerConfig, searchInstrumentation,
    nodeFlags: environment.nodeFlags, conditionParity, selection, productionChangeRecordedByRunner: recordedSinceA8, productionChangeRederived: rederived,
    optimizationSource: evidence.optimizationSource, a8RawShaMatches: evidence.a8RawShaMatches, parityCoverage, recordIssues }
}
