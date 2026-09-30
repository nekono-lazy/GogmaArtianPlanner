/**
 * Issue #154 Phase 2-C2.6-A5: CPU profile analysis of the Bonus Ideal filter, Research only. Never import from
 * Production.
 *
 * Pure functions over one V8 CPU profile (`Profiler.stop` result), the child's script table (scriptId -> url, inline
 * source maps), the profile window (both clocks read around `Profiler.start` / `Profiler.stop`) and the compact
 * `bonus_ideal_filter` intervals the child stamped:
 *
 * - validation of the untrusted profile and the reconstruction of each sample's timestamp
 *   (`startTime + cumulative timeDeltas`, the V8 monotonic clock, which is `process.hrtime`'s clock);
 * - the clock alignment: the Research clock (`performance.now()`) and the profile clock differ by a constant offset,
 *   read as clock pairs around both profiler calls; the profile's own `startTime` / `endTime` must fall inside those
 *   brackets, so a sample maps onto the Research clock without guessing (otherwise the profile is no evidence);
 * - the population: only samples whose Research time falls inside a filter interval;
 * - the pre-registered stack-aware classification (priority gc, rank_reference_validation, multiset_equality,
 *   predicate_self_or_inlined, filter_or_inlined_predicate, other_unresolved) and the pre-registered decision rule.
 *
 * Every rule here was fixed before the formal run. Anonymous frames (`forEach` / `find` / `every` callbacks, and the
 * functions TurboFan inlines into them) are attributed to the registered named function whose source span contains the
 * frame's source-mapped function start; the spans are derived from the measured HEAD's source text, never typed in.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { validatePhase2C26A2BaselineParity, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { validatePhase2C26A3Selection, type Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import type { Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import {
  PHASE2C26A5_CHILD_HEAP_MB,
  PHASE2C26A5_CONCURRENCY,
  PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS,
  PHASE2C26A5_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A5_ORIENTATION_BUDGET_MS,
  PHASE2C26A5_PRIMARY_NODE_FLAGS,
  PHASE2C26A5_PROFILER,
  PHASE2C26A5_REGISTERED_PRIMARY_COUNT,
  PHASE2C26A5_REQUIRED_SOURCE_FILES,
  PHASE2C26A5_SEARCH_INSTRUMENTATION,
  selectPhase2C26A5DiagnosticRepresentative,
  validatePhase2C26A5ConditionParity,
  type Phase2C26A5A4Authority,
  type Phase2C26A5ClockPair,
  type Phase2C26A5FilterInterval,
  type Phase2C26A5ProfileWindow,
} from './plannerGlobalPhase2C26A5'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- the CPU profile

export interface CpuProfileCallFrame {
  functionName: string
  scriptId: string
  url: string
  lineNumber: number
  columnNumber: number
}
export interface CpuProfileNode {
  id: number
  callFrame: CpuProfileCallFrame
  children?: number[]
  hitCount?: number
}
export interface CpuProfile {
  nodes: CpuProfileNode[]
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

export class Phase2C26A5ProfileError extends Error {}
const fail = (message: string): never => { throw new Phase2C26A5ProfileError(`Invalid CPU profile: ${message}`) }

/** Structural validation of an untrusted `Profiler.stop` profile; fails closed. */
export function validatePhase2C26A5CpuProfile(json: unknown): CpuProfile {
  if (!isObject(json)) return fail('the root is not an object.')
  for (const key of ['nodes', 'samples', 'timeDeltas']) if (!Array.isArray(json[key])) fail(`${key} is not an array.`)
  if (num(json.startTime) === null || num(json.endTime) === null) fail('startTime / endTime is not a number.')
  if ((json.endTime as number) < (json.startTime as number)) fail('endTime precedes startTime.')
  const nodes = json.nodes as unknown[]
  if (nodes.length === 0) fail('no node.')
  const ids = new Set<number>()
  for (const node of nodes) {
    if (!isObject(node) || typeof node.id !== 'number' || !isObject(node.callFrame)) fail('a node is malformed.')
    const n = node as Json
    const frame = n.callFrame as Json
    if (typeof frame.functionName !== 'string' || typeof frame.scriptId !== 'string' || typeof frame.url !== 'string'
      || typeof frame.lineNumber !== 'number' || typeof frame.columnNumber !== 'number') fail(`node ${String(n.id)} has a malformed callFrame.`)
    if (n.children !== undefined && (!Array.isArray(n.children) || (n.children as unknown[]).some(c => typeof c !== 'number'))) fail(`node ${String(n.id)} has malformed children.`)
    if (ids.has(n.id as number)) fail(`node id ${String(n.id)} appears twice.`)
    ids.add(n.id as number)
  }
  for (const node of nodes as CpuProfileNode[]) for (const child of node.children ?? []) if (!ids.has(child)) fail(`node ${node.id} names unknown child ${child}.`)
  const samples = json.samples as unknown[], deltas = json.timeDeltas as unknown[]
  if (samples.length !== deltas.length) fail('samples and timeDeltas differ in length.')
  for (const sample of samples) if (typeof sample !== 'number' || !ids.has(sample)) fail(`a sample names unknown node ${String(sample)}.`)
  for (const delta of deltas) if (num(delta) === null) fail('a timeDelta is not a number.')
  return json as unknown as CpuProfile
}

/** Each sample's timestamp (profile clock, microseconds): `startTime` plus the cumulative `timeDeltas`. */
export function phase2c26a5SampleTimesUs(profile: CpuProfile): { timesUs: Float64Array; negativeDeltas: number; sumDeltasUs: number } {
  const timesUs = new Float64Array(profile.samples.length)
  let t = profile.startTime, negativeDeltas = 0, sum = 0
  for (let i = 0; i < profile.timeDeltas.length; i++) {
    const delta = profile.timeDeltas[i]
    if (delta < 0) negativeDeltas += 1
    t += delta
    sum += delta
    timesUs[i] = t
  }
  return { timesUs, negativeDeltas, sumDeltasUs: sum }
}

// ---------------------------------------------------------------- clock alignment

/** The registered tolerance of every clock bracket check (ms). */
export const PHASE2C26A5_CLOCK_TOLERANCE_MS = 1

export interface Phase2C26A5ClockAlignment {
  valid: boolean
  issues: string[]
  /** hrtime ms - performance.now() ms (the constant offset of the two clocks), mean of the four pairs. */
  offsetMs: number | null
  offsetSpreadMs: number | null
  maxPairPrecisionMs: number | null
  profileStartMs: number
  profileEndMs: number
  profileDurationMs: number
  sumDeltasMs: number
  negativeDeltas: number
  startBracketMs: [number, number] | null
  stopBracketMs: [number, number] | null
  /** Profile start / end on the Research clock. */
  researchProfileStartMs: number | null
  researchProfileEndMs: number | null
}

/**
 * The profile is aligned with the Research clock only when both clocks are one monotonic clock plus a constant offset:
 * the four clock pairs agree on the offset (spread <= tolerance), each pair is precise (<= tolerance), the profile's
 * `startTime` lies inside the hrtime bracket of `Profiler.start` and its `endTime` inside that of `Profiler.stop`, and
 * the samples lie inside [startTime, endTime]. Otherwise no sample is mapped (the profile is no formal evidence).
 */
export function validatePhase2C26A5ClockAlignment(profile: CpuProfile, window: Pick<Phase2C26A5ProfileWindow, 'startPre' | 'startPost' | 'stopPre' | 'stopPost'>,
  tolerance = PHASE2C26A5_CLOCK_TOLERANCE_MS): Phase2C26A5ClockAlignment {
  const issues: string[] = []
  const { timesUs, negativeDeltas, sumDeltasUs } = phase2c26a5SampleTimesUs(profile)
  const profileStartMs = profile.startTime / 1000, profileEndMs = profile.endTime / 1000
  const pairs = [window.startPre, window.startPost, window.stopPre, window.stopPost]
  const base = { profileStartMs, profileEndMs, profileDurationMs: profileEndMs - profileStartMs, sumDeltasMs: sumDeltasUs / 1000, negativeDeltas }
  if (pairs.some(pair => pair === null || num(pair.perfMs) === null || num(pair.hrMs) === null || num(pair.precisionMs) === null)) {
    return { valid: false, issues: ['a clock pair around the profiler calls is missing'], offsetMs: null, offsetSpreadMs: null, maxPairPrecisionMs: null,
      startBracketMs: null, stopBracketMs: null, researchProfileStartMs: null, researchProfileEndMs: null, ...base }
  }
  const [startPre, startPost, stopPre, stopPost] = pairs as Phase2C26A5ClockPair[]
  const offsets = pairs.map(pair => (pair as Phase2C26A5ClockPair).hrMs - (pair as Phase2C26A5ClockPair).perfMs)
  const offsetMs = offsets.reduce((a, b) => a + b, 0) / offsets.length
  const offsetSpreadMs = Math.max(...offsets) - Math.min(...offsets)
  const maxPairPrecisionMs = Math.max(...pairs.map(pair => (pair as Phase2C26A5ClockPair).precisionMs))
  if (offsetSpreadMs > tolerance) issues.push(`the clock offset spread ${offsetSpreadMs} ms exceeds ${tolerance} ms`)
  if (maxPairPrecisionMs > tolerance) issues.push(`a clock pair precision ${maxPairPrecisionMs} ms exceeds ${tolerance} ms`)
  const startBracketMs: [number, number] = [startPre.hrMs, startPost.hrMs]
  const stopBracketMs: [number, number] = [stopPre.hrMs, stopPost.hrMs]
  if (profileStartMs < startBracketMs[0] - tolerance || profileStartMs > startBracketMs[1] + tolerance) issues.push('profile startTime is outside the Profiler.start hrtime bracket')
  if (profileEndMs < stopBracketMs[0] - tolerance || profileEndMs > stopBracketMs[1] + tolerance) issues.push('profile endTime is outside the Profiler.stop hrtime bracket')
  let minUs = Infinity, maxUs = -Infinity
  for (const t of timesUs) { if (t < minUs) minUs = t; if (t > maxUs) maxUs = t }
  if (timesUs.length > 0 && (minUs / 1000 < profileStartMs - tolerance || maxUs / 1000 > profileEndMs + tolerance)) issues.push('a sample lies outside [startTime, endTime]')
  if (timesUs.length === 0) issues.push('the profile has no sample')
  return { valid: issues.length === 0, issues, offsetMs, offsetSpreadMs, maxPairPrecisionMs, startBracketMs, stopBracketMs,
    researchProfileStartMs: profileStartMs - offsetMs, researchProfileEndMs: profileEndMs - offsetMs, ...base }
}

// ---------------------------------------------------------------- filter intervals

export interface Phase2C26A5IntervalValidation {
  valid: boolean
  issues: string[]
  count: number
}

/** Intervals must be finite, positive-length, sorted by start and non-overlapping (the section is synchronous). */
export function validatePhase2C26A5FilterIntervals(intervals: readonly Phase2C26A5FilterInterval[]): Phase2C26A5IntervalValidation {
  const issues: string[] = []
  let previousEnd = -Infinity
  for (const [index, interval] of intervals.entries()) {
    if (num(interval.startMs) === null || num(interval.endMs) === null) { issues.push(`interval ${index} is not finite`); continue }
    if (!(interval.endMs >= interval.startMs)) issues.push(`interval ${index} ends before it starts`)
    if (interval.startMs < previousEnd) issues.push(`interval ${index} overlaps or precedes the previous one`)
    previousEnd = interval.endMs
  }
  return { valid: issues.length === 0, issues: issues.slice(0, 20), count: intervals.length }
}

/** Index of the last interval starting at or before `t`, or -1; `starts` ascending. */
function lastStartAtOrBefore(starts: Float64Array, t: number): number {
  let lo = 0, hi = starts.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

// ---------------------------------------------------------------- frames and the registered classification

export interface Phase2C26A5ScriptTable {
  /** scriptId -> url from the child's `Debugger.scriptParsed` (a Vite SSR frame may report an empty url). */
  urlOf(scriptId: string): string | null
  /** The 1-based original source line of a 0-based generated position, when the script has a source map. */
  originalLine(scriptId: string, lineNumber: number, columnNumber: number): number | null
}

/** One row of the child's script table file. */
export interface Phase2C26A5ScriptRow { scriptId: string; url: string; file?: string; sourceMap: unknown | null }

/** The subset of a source map consumer the table needs (`source-map-js` `SourceMapConsumer`, injected by the scripts). */
export interface Phase2C26A5SourceMapConsumer {
  originalPositionFor(position: { line: number; column: number; bias?: number }): { line: number | null }
}
/** `source-map-js` bias constants. */
export const PHASE2C26A5_SOURCE_MAP_BIAS = { greatestLowerBound: 1, leastUpperBound: 2 } as const

/**
 * The script table over the child's rows. A 0-based generated function start maps to its original line with the
 * greatest-lower-bound mapping of that generated line and, when the start precedes every mapping of the line (a Vite SSR
 * rewrite can move a function start before the first segment), the least-upper-bound mapping of the same line.
 */
export function createPhase2C26A5ScriptTable(rows: readonly Phase2C26A5ScriptRow[], createConsumer: (sourceMap: unknown) => Phase2C26A5SourceMapConsumer): Phase2C26A5ScriptTable {
  const byId = new Map(rows.map(row => [row.scriptId, row]))
  const consumers = new Map<string, Phase2C26A5SourceMapConsumer>()
  return {
    urlOf: id => byId.get(id)?.url ?? null,
    originalLine: (id, lineNumber, columnNumber) => {
      const row = byId.get(id)
      if (!row || row.sourceMap === null || row.sourceMap === undefined) return null
      let consumer = consumers.get(id)
      if (!consumer) { consumer = createConsumer(row.sourceMap); consumers.set(id, consumer) }
      const position = { line: lineNumber + 1, column: columnNumber }
      const lower = consumer.originalPositionFor({ ...position, bias: PHASE2C26A5_SOURCE_MAP_BIAS.greatestLowerBound })
      if (lower.line !== null && lower.line !== undefined) return lower.line
      const upper = consumer.originalPositionFor({ ...position, bias: PHASE2C26A5_SOURCE_MAP_BIAS.leastUpperBound })
      return upper.line ?? null
    },
  }
}

/** A frame url normalized to a Repository-relative path (`src/...`), a dependency path, or the raw value. */
export function normalizePhase2C26A5Url(url: string): string {
  let value = url.replace(/\\/g, '/')
  value = value.replace(/^file:\/\/\/?/, '')
  const src = value.search(/(^|\/)src\//)
  if (src >= 0 && !value.includes('/node_modules/')) return value.slice(value.indexOf('src/', src))
  const nm = value.lastIndexOf('/node_modules/')
  if (nm >= 0) return value.slice(nm + 1)
  return value
}

export type Phase2C26A5Category =
  | 'gc'
  | 'rank_reference_validation'
  | 'multiset_equality'
  | 'predicate_self_or_inlined'
  | 'filter_or_inlined_predicate'
  | 'other_unresolved'

/** The registered priority: the first matching category wins. */
export const PHASE2C26A5_CATEGORIES: readonly Phase2C26A5Category[] = [
  'gc', 'rank_reference_validation', 'multiset_equality', 'predicate_self_or_inlined', 'filter_or_inlined_predicate', 'other_unresolved',
]
/** The unresolved bucket of the attribution quality rule. */
export const PHASE2C26A5_UNRESOLVED_CATEGORIES: readonly Phase2C26A5Category[] = ['predicate_self_or_inlined', 'filter_or_inlined_predicate', 'other_unresolved']

/** The registered named functions of each named category (a frame of one of them anywhere in the stack). */
export const PHASE2C26A5_FUNCTION_REGISTRY: readonly { category: Exclude<Phase2C26A5Category, 'gc' | 'filter_or_inlined_predicate' | 'other_unresolved'>; file: string; functionName: string }[] = [
  { category: 'rank_reference_validation', file: 'src/domain/target/bonusConditionEvaluator.ts', functionName: 'assertRestorationBonusRankReferences' },
  { category: 'rank_reference_validation', file: 'src/domain/master/masterSelectors.ts', functionName: 'getBonusRank' },
  { category: 'rank_reference_validation', file: 'src/domain/master/masterSelectors.ts', functionName: 'requireById' },
  { category: 'multiset_equality', file: 'src/domain/models/domainRules.ts', functionName: 'areRestorationBonusSetsEqual' },
  { category: 'multiset_equality', file: 'src/domain/models/domainRules.ts', functionName: 'countBonuses' },
  { category: 'multiset_equality', file: 'src/domain/models/domainRules.ts', functionName: 'bonusKey' },
  { category: 'predicate_self_or_inlined', file: 'src/domain/target/targetEvaluator.ts', functionName: 'satisfiesIdealBonuses' },
]
/** The file of the filter call site (`TargetSearchScheduler`'s Bonus Ideal filter and its callback). */
export const PHASE2C26A5_FILTER_CALL_SITE_FILE = 'src/domain/search/targetSearchScheduler.ts'

export const PHASE2C26A5_CATEGORY_RULES: readonly { category: Phase2C26A5Category; rule: string }[] = [
  { category: 'gc', rule: 'the stack contains the V8 "(garbage collector)" frame' },
  { category: 'rank_reference_validation', rule: 'the stack contains assertRestorationBonusRankReferences (bonusConditionEvaluator.ts) or getBonusRank / requireById (masterSelectors.ts), named or an anonymous frame whose source-mapped start lies in one of their source spans' },
  { category: 'multiset_equality', rule: 'the stack contains areRestorationBonusSetsEqual / countBonuses / bonusKey (domainRules.ts), named or an anonymous frame in their spans (a native JSON.stringify / Map frame under bonusKey / countBonuses is therefore multiset)' },
  { category: 'predicate_self_or_inlined', rule: 'the stack contains satisfiesIdealBonuses (targetEvaluator.ts) but none of the above: its own work (scope check, calls) and anything JIT-inlined into it without a frame; never "the scope check alone"' },
  { category: 'filter_or_inlined_predicate', rule: 'none of the above, and the innermost (leaf) frame is in targetSearchScheduler.ts: the filter callback or the method holding the Array.prototype.filter call (builtin loop, callback, or a predicate inlined into it); never "pure Array.prototype.filter overhead"' },
  { category: 'other_unresolved', rule: 'anything else inside a filter interval ((program), (idle), a Vite SSR module runner import accessor, a Research harness frame, native frames without a registered ancestor, other files)' },
]

export interface Phase2C26A5FunctionSpan { file: string; functionName: string; startLine: number; endLine: number }

/**
 * The 1-based source span of each registered function, from the measured HEAD's source text: the unique line declaring
 * `function <name>` (optionally `export`, generic parameters allowed) through the first following line that is exactly
 * `}`. Fails closed when a declaration is missing, ambiguous or unterminated.
 */
export function derivePhase2C26A5FunctionSpans(sources: Readonly<Record<string, string>>,
  registry: readonly { file: string; functionName: string }[] = PHASE2C26A5_FUNCTION_REGISTRY): Phase2C26A5FunctionSpan[] {
  return registry.map(({ file, functionName }) => {
    const text = sources[file]
    if (typeof text !== 'string') throw new Phase2C26A5ProfileError(`No source text for ${file}.`)
    const lines = text.split(/\r?\n/)
    const declaration = new RegExp(`^(export\\s+)?function\\s+${functionName}\\s*[<(]`)
    const starts = lines.flatMap((line, index) => (declaration.test(line) ? [index] : []))
    if (starts.length !== 1) throw new Phase2C26A5ProfileError(`${file}: ${starts.length} declarations of ${functionName}.`)
    const end = lines.findIndex((line, index) => index > starts[0] && /^\}\s*$/.test(line))
    if (end < 0) throw new Phase2C26A5ProfileError(`${file}: ${functionName} is not terminated by a column-0 "}".`)
    return { file, functionName, startLine: starts[0] + 1, endLine: end + 1 }
  })
}

export type Phase2C26A5LeafKind = 'gc' | 'program' | 'idle' | 'root' | 'vite_module_runner' | 'vite_ssr_unmapped' | 'research_harness' | 'repository' | 'dependency' | 'native_or_builtin'

export interface Phase2C26A5Frame {
  functionName: string
  file: string
  /** 1-based source-mapped line of the function start (Repository frames with a source map), else null. */
  originalLine: number | null
  /** The registered function this frame belongs to (by name, or an anonymous frame by span), else null. */
  registered: string | null
  registeredCategory: Phase2C26A5Category | null
  leafKind: Phase2C26A5LeafKind
}

/**
 * The descriptive kind of a frame. A Repository frame whose function start has no source-mapped line lies in the Vite SSR
 * module preamble (an export accessor), a loader artifact a Production bundle does not have.
 */
function leafKindOf(functionName: string, file: string, originalLine: number | null): Phase2C26A5LeafKind {
  if (functionName === '(garbage collector)') return 'gc'
  if (functionName === '(program)') return 'program'
  if (functionName === '(idle)') return 'idle'
  if (functionName === '(root)') return 'root'
  if (file.includes('vite/dist/node/module-runner')) return 'vite_module_runner'
  if (file.startsWith('src/benchmarks/') || file.startsWith('scripts/')) return 'research_harness'
  if (file.startsWith('src/')) return originalLine === null ? 'vite_ssr_unmapped' : 'repository'
  if (file.startsWith('node_modules/') || file.includes('/node_modules/')) return 'dependency'
  return 'native_or_builtin'
}

/** Resolves one call frame to its Repository file, source-mapped function start and registered function. */
export function resolvePhase2C26A5Frame(callFrame: CpuProfileCallFrame, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26A5FunctionSpan[]): Phase2C26A5Frame {
  const rawUrl = callFrame.url !== '' ? callFrame.url : (scripts.urlOf(callFrame.scriptId) ?? '')
  const file = normalizePhase2C26A5Url(rawUrl)
  const repository = file.startsWith('src/')
  const originalLine = repository ? scripts.originalLine(callFrame.scriptId, callFrame.lineNumber, callFrame.columnNumber) : null
  let registered: string | null = null, registeredCategory: Phase2C26A5Category | null = null
  if (repository) {
    for (const entry of PHASE2C26A5_FUNCTION_REGISTRY) {
      if (entry.file !== file) continue
      const span = spans.find(s => s.file === entry.file && s.functionName === entry.functionName)
      const byName = callFrame.functionName === entry.functionName
      const bySpan = callFrame.functionName === '' && span !== undefined && originalLine !== null && originalLine >= span.startLine && originalLine <= span.endLine
      if (byName || bySpan) { registered = `${entry.file}#${entry.functionName}`; registeredCategory = entry.category; break }
    }
  }
  return { functionName: callFrame.functionName, file, originalLine, registered, registeredCategory, leafKind: leafKindOf(callFrame.functionName, file, originalLine) }
}

/** The registered category of one sampled stack (outermost first). */
export function classifyPhase2C26A5Stack(stack: readonly Phase2C26A5Frame[]): Phase2C26A5Category {
  if (stack.some(frame => frame.leafKind === 'gc')) return 'gc'
  for (const category of ['rank_reference_validation', 'multiset_equality', 'predicate_self_or_inlined'] as const) {
    if (stack.some(frame => frame.registeredCategory === category)) return category
  }
  const leaf = stack.at(-1)
  if (leaf !== undefined && leaf.file === PHASE2C26A5_FILTER_CALL_SITE_FILE) return 'filter_or_inlined_predicate'
  return 'other_unresolved'
}

// ---------------------------------------------------------------- one profile

export interface Phase2C26A5CategoryCount { category: Phase2C26A5Category; samples: number; share: number }

export interface Phase2C26A5ProfileAnalysis {
  alignment: Phase2C26A5ClockAlignment
  intervalValidation: Phase2C26A5IntervalValidation
  allProfileSamples: number
  observedIntervalUs: { median: number | null; mean: number | null }
  /** Filter intervals overlapping the profile, their clipped total and that total's share of the profile duration. */
  intervalsInProfile: number
  intervalMsInProfile: number
  intervalShareOfProfile: number | null
  filterIntervalSamples: number
  filterSampleShare: number | null
  categories: Phase2C26A5CategoryCount[]
  unresolvedShare: number | null
  leafKinds: { leafKind: Phase2C26A5LeafKind; samples: number; share: number }[]
  /** Filter samples by leaf function (`file#function@line`), top 25. */
  topLeaves: { leaf: string; category: Phase2C26A5Category; samples: number; share: number }[]
  /** Filter samples by the innermost 8 frames, top 20. */
  topStacks: { stack: string; category: Phase2C26A5Category; samples: number; share: number }[]
  /** Registered-function inclusive samples inside the filter intervals (a frame counted once per sample). */
  registeredInclusive: { registered: string; samples: number; share: number }[]
  /** Samples OUTSIDE the filter intervals whose stack holds a registered frame (descriptive; the predicate has other callers). */
  registeredOutsideFilterSamples: number
  /** Filter / non-filter samples within the clock tolerance of an interval boundary (descriptive). */
  boundarySamples: number
}

/**
 * Classifies one CPU profile's samples inside the filter intervals. When the clock alignment or the intervals are not
 * valid, no sample is mapped (`filterIntervalSamples = 0`) and the profile is no evidence.
 */
export function analyzePhase2C26A5Profile(profile: CpuProfile, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26A5FunctionSpan[],
  window: Pick<Phase2C26A5ProfileWindow, 'startPre' | 'startPost' | 'stopPre' | 'stopPost'>, intervals: readonly Phase2C26A5FilterInterval[]): Phase2C26A5ProfileAnalysis {
  const alignment = validatePhase2C26A5ClockAlignment(profile, window)
  const intervalValidation = validatePhase2C26A5FilterIntervals(intervals)
  const { timesUs } = phase2c26a5SampleTimesUs(profile)
  const deltas = profile.timeDeltas.filter(d => d >= 0).sort((a, b) => a - b)
  const observedIntervalUs = { median: deltas.length === 0 ? null : deltas[Math.floor(deltas.length / 2)],
    mean: deltas.length === 0 ? null : deltas.reduce((a, b) => a + b, 0) / deltas.length }

  const nodes = new Map(profile.nodes.map(node => [node.id, node]))
  const parent = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const frameMemo = new Map<number, Phase2C26A5Frame>()
  const frameOf = (id: number) => {
    let frame = frameMemo.get(id)
    if (!frame) { frame = resolvePhase2C26A5Frame((nodes.get(id) as CpuProfileNode).callFrame, scripts, spans); frameMemo.set(id, frame) }
    return frame
  }
  const stackMemo = new Map<number, Phase2C26A5Frame[]>()
  const stackOf = (leafId: number) => {
    let stack = stackMemo.get(leafId)
    if (!stack) {
      stack = []
      for (let id: number | undefined = leafId; id !== undefined; id = parent.get(id)) stack.unshift(frameOf(id))
      stackMemo.set(leafId, stack)
    }
    return stack
  }
  const frameLabel = (f: Phase2C26A5Frame) => `${f.functionName || '(anonymous)'}@${f.file || '-'}${f.originalLine === null ? '' : `:${f.originalLine}`}`

  const usable = alignment.valid && intervalValidation.valid && alignment.offsetMs !== null
  const offset = alignment.offsetMs ?? 0
  const starts = new Float64Array(intervals.map(i => i.startMs)), ends = new Float64Array(intervals.map(i => i.endMs))
  const categoryCounts = new Map<Phase2C26A5Category, number>(PHASE2C26A5_CATEGORIES.map(c => [c, 0]))
  const leafKinds = new Map<Phase2C26A5LeafKind, number>()
  const leaves = new Map<string, { category: Phase2C26A5Category; samples: number }>()
  const stacks = new Map<string, { category: Phase2C26A5Category; samples: number }>()
  const inclusive = new Map<string, number>()
  let filterSamples = 0, outsideRegistered = 0, boundarySamples = 0
  const tolerance = PHASE2C26A5_CLOCK_TOLERANCE_MS + (alignment.offsetSpreadMs ?? 0)
  if (usable) {
    for (let i = 0; i < profile.samples.length; i++) {
      const t = timesUs[i] / 1000 - offset
      const k = lastStartAtOrBefore(starts, t)
      const index = k >= 0 && t < ends[k] ? k : -1
      const stack = stackOf(profile.samples[i])
      const near = (j: number) => j >= 0 && j < starts.length && (Math.abs(t - starts[j]) <= tolerance || Math.abs(t - ends[j]) <= tolerance)
      if (near(k) || near(k + 1)) boundarySamples += 1
      if (index < 0) {
        if (stack.some(frame => frame.registered !== null)) outsideRegistered += 1
        continue
      }
      filterSamples += 1
      const category = classifyPhase2C26A5Stack(stack)
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
      const leaf = stack.at(-1) as Phase2C26A5Frame
      leafKinds.set(leaf.leafKind, (leafKinds.get(leaf.leafKind) ?? 0) + 1)
      const leafKey = frameLabel(leaf)
      const leafEntry = leaves.get(leafKey) ?? { category, samples: 0 }
      leafEntry.samples += 1
      leaves.set(leafKey, leafEntry)
      const stackKey = stack.slice(-8).map(frameLabel).join(' > ')
      const stackEntry = stacks.get(stackKey) ?? { category, samples: 0 }
      stackEntry.samples += 1
      stacks.set(stackKey, stackEntry)
      const seen = new Set<string>()
      for (const frame of stack) if (frame.registered !== null && !seen.has(frame.registered)) { seen.add(frame.registered); inclusive.set(frame.registered, (inclusive.get(frame.registered) ?? 0) + 1) }
    }
  }
  const share = (n: number) => (filterSamples === 0 ? 0 : n / filterSamples)
  const categories = PHASE2C26A5_CATEGORIES.map(category => ({ category, samples: categoryCounts.get(category) ?? 0, share: share(categoryCounts.get(category) ?? 0) }))
  const unresolved = PHASE2C26A5_UNRESOLVED_CATEGORIES.reduce((sum, c) => sum + (categoryCounts.get(c) ?? 0), 0)
  let intervalsInProfile = 0, intervalMsInProfile = 0
  if (alignment.researchProfileStartMs !== null && alignment.researchProfileEndMs !== null) {
    for (const interval of intervals) {
      const a = Math.max(interval.startMs, alignment.researchProfileStartMs), b = Math.min(interval.endMs, alignment.researchProfileEndMs)
      if (b > a) { intervalsInProfile += 1; intervalMsInProfile += b - a }
    }
  }
  const rank = <T extends { samples: number }>(entries: [string, T][], top: number) => entries.sort(([ka, a], [kb, b]) => b.samples - a.samples || (ka < kb ? -1 : 1)).slice(0, top)
  return {
    alignment, intervalValidation,
    allProfileSamples: profile.samples.length, observedIntervalUs,
    intervalsInProfile, intervalMsInProfile, intervalShareOfProfile: alignment.profileDurationMs > 0 ? intervalMsInProfile / alignment.profileDurationMs : null,
    filterIntervalSamples: filterSamples, filterSampleShare: profile.samples.length === 0 ? null : filterSamples / profile.samples.length,
    categories, unresolvedShare: filterSamples === 0 ? null : unresolved / filterSamples,
    leafKinds: [...leafKinds.entries()].map(([leafKind, samples]) => ({ leafKind, samples, share: share(samples) })).sort((a, b) => b.samples - a.samples || (a.leafKind < b.leafKind ? -1 : 1)),
    topLeaves: rank([...leaves.entries()], 25).map(([leaf, e]) => ({ leaf, category: e.category, samples: e.samples, share: share(e.samples) })),
    topStacks: rank([...stacks.entries()], 20).map(([stack, e]) => ({ stack, category: e.category, samples: e.samples, share: share(e.samples) })),
    registeredInclusive: [...inclusive.entries()].map(([registered, samples]) => ({ registered, samples, share: share(samples) }))
      .sort((a, b) => b.samples - a.samples || (a.registered < b.registered ? -1 : 1)),
    registeredOutsideFilterSamples: outsideRegistered,
    boundarySamples,
  }
}

export const phase2c26a5CategoryShare = (analysis: Pick<Phase2C26A5ProfileAnalysis, 'categories'>, category: Phase2C26A5Category): number =>
  analysis.categories.find(c => c.category === category)?.share ?? 0

// ---------------------------------------------------------------- the pre-registered decision rule

export const PHASE2C26A5_DECISION_RULE = {
  majority: 2,
  minimumFilterIntervalSamples: 5_000,
  unresolvedThreshold: 0.35,
  gcThreshold: 0.2,
  rankThreshold: 0.35,
  multisetThreshold: 0.35,
  order: [
    'U0 insufficient_samples: fewer than 2 primaries have a valid clock alignment / intervals and >= 5,000 filter interval samples',
    'U1 jit_attribution_insufficient: >= 2 valid primaries have predicate_self_or_inlined + filter_or_inlined_predicate + other_unresolved >= 0.35',
    'GC: >= 2 valid primaries have gc >= 0.20',
    'RANK: >= 2 valid primaries have rank_reference_validation >= 0.35',
    'MULTISET: >= 2 valid primaries have multiset_equality >= 0.35',
    'MIXED: otherwise (the two largest pooled categories are the next candidates)',
  ],
} as const

export type Phase2C26A5DecisionCase = 'U0_insufficient_samples' | 'U1_jit_attribution_insufficient' | 'GC_allocation_or_gc' | 'RANK_rank_reference_validation'
  | 'MULTISET_multiset_equality' | 'MIXED_mixed_internal_cost'

export const PHASE2C26A5_RECOMMENDATION: Record<Phase2C26A5DecisionCase, string> = {
  U0_insufficient_samples: '次Phaseでprofiling条件（window / sampling interval / primary）を見直す。optimizationへ進まない。',
  U1_jit_attribution_insufficient: '次Phaseでtargeted microbenchmark / 別profilerによりinline部分を局所化する（no-inlining diagnosticは補助資料）。Production-like条件では内部dominance未確定のため直接optimizationへ進まない。',
  GC_allocation_or_gc: '次Phaseでfilter内のallocation attribution（allocation profile / targeted microbenchmark）を行う。CPU helperだけを直接最適化しない。',
  RANK_rank_reference_validation: '次Phaseでrank reference validationのoptimization設計（Target invariant validationの再利用、Master rank lookup構造、per-Target prepared predicate等を候補として比較。unknown BonusRankのDomain Error・scope判定より前のvalidation・normal scopeでもthrowする契約を維持）。',
  MULTISET_multiset_equality: '次Phaseでmultiset equalityのoptimization設計（precomputed Ideal multiset表現、allocation-free 5-slot multiset比較等を候補として比較。unordered multiset・重複数の意味を維持し、slot-order semanticsと混同しない。rank validationのerror timingも維持）。',
  MIXED_mixed_internal_cost: '次Phaseで上位2 categoryのoptimization候補をmicrobenchmark / 設計で比較する。',
}

export interface Phase2C26A5DecisionRow {
  orientationId: string
  valid: boolean
  invalidReasons: string[]
  filterIntervalSamples: number
  shares: Record<Phase2C26A5Category, number>
  unresolvedShare: number
}

export function phase2c26a5DecisionRow(orientationId: string, analysis: Phase2C26A5ProfileAnalysis | null, captureIssues: readonly string[] = []): Phase2C26A5DecisionRow {
  const invalidReasons = [...captureIssues]
  if (analysis === null) invalidReasons.push('no profile')
  else {
    if (!analysis.alignment.valid) invalidReasons.push(...analysis.alignment.issues.map(i => `clock: ${i}`))
    if (!analysis.intervalValidation.valid) invalidReasons.push(...analysis.intervalValidation.issues.map(i => `intervals: ${i}`))
    if (analysis.filterIntervalSamples < PHASE2C26A5_DECISION_RULE.minimumFilterIntervalSamples) {
      invalidReasons.push(`filterIntervalSamples ${analysis.filterIntervalSamples} < ${PHASE2C26A5_DECISION_RULE.minimumFilterIntervalSamples}`)
    }
  }
  const shares = Object.fromEntries(PHASE2C26A5_CATEGORIES.map(c => [c, analysis === null ? 0 : phase2c26a5CategoryShare(analysis, c)])) as Record<Phase2C26A5Category, number>
  return { orientationId, valid: invalidReasons.length === 0, invalidReasons, filterIntervalSamples: analysis?.filterIntervalSamples ?? 0, shares,
    unresolvedShare: analysis?.unresolvedShare ?? 0 }
}

/** The pre-registered decision over the primary (jit_default) rows only; the diagnostic never enters it. */
export function phase2c26a5Decision(rows: readonly Phase2C26A5DecisionRow[], pooled: Record<Phase2C26A5Category, number>) {
  const rule = PHASE2C26A5_DECISION_RULE
  const valid = rows.filter(row => row.valid)
  const at = (predicate: (row: Phase2C26A5DecisionRow) => boolean) => valid.filter(predicate).map(row => row.orientationId)
  const unresolved = at(row => row.unresolvedShare >= rule.unresolvedThreshold)
  const gc = at(row => row.shares.gc >= rule.gcThreshold)
  const rank = at(row => row.shares.rank_reference_validation >= rule.rankThreshold)
  const multiset = at(row => row.shares.multiset_equality >= rule.multisetThreshold)
  const topPooled = [...PHASE2C26A5_CATEGORIES].sort((a, b) => pooled[b] - pooled[a] || PHASE2C26A5_CATEGORIES.indexOf(a) - PHASE2C26A5_CATEGORIES.indexOf(b)).slice(0, 2)
  let decisionCase: Phase2C26A5DecisionCase
  let reason: string
  if (valid.length < rule.majority) { decisionCase = 'U0_insufficient_samples'; reason = `${valid.length} valid primaries (< ${rule.majority})` }
  else if (unresolved.length >= rule.majority) { decisionCase = 'U1_jit_attribution_insufficient'; reason = `unresolved >= ${rule.unresolvedThreshold} in ${unresolved.join(', ')}` }
  else if (gc.length >= rule.majority) { decisionCase = 'GC_allocation_or_gc'; reason = `gc >= ${rule.gcThreshold} in ${gc.join(', ')}` }
  else if (rank.length >= rule.majority) { decisionCase = 'RANK_rank_reference_validation'; reason = `rank_reference_validation >= ${rule.rankThreshold} in ${rank.join(', ')}` }
  else if (multiset.length >= rule.majority) { decisionCase = 'MULTISET_multiset_equality'; reason = `multiset_equality >= ${rule.multisetThreshold} in ${multiset.join(', ')}` }
  else { decisionCase = 'MIXED_mixed_internal_cost'; reason = `no single category reaches its threshold in >= ${rule.majority} valid primaries; top pooled: ${topPooled.join(', ')}` }
  return {
    rule,
    validPrimaries: valid.map(row => row.orientationId),
    invalidPrimaries: rows.filter(row => !row.valid).map(row => ({ orientationId: row.orientationId, reasons: row.invalidReasons })),
    primariesAtThreshold: { unresolved, gc, rank_reference_validation: rank, multiset_equality: multiset },
    topPooledCategories: topPooled,
    case: decisionCase,
    reason,
    recommendation: PHASE2C26A5_RECOMMENDATION[decisionCase],
  }
}

/** Pooled category shares over the valid primaries' filter samples (sample-weighted). */
export function phase2c26a5PooledShares(rows: readonly { valid: boolean; analysis: Phase2C26A5ProfileAnalysis | null }[]): Record<Phase2C26A5Category, number> {
  const counts = new Map<Phase2C26A5Category, number>(PHASE2C26A5_CATEGORIES.map(c => [c, 0]))
  let total = 0
  for (const row of rows) {
    if (!row.valid || row.analysis === null) continue
    total += row.analysis.filterIntervalSamples
    for (const c of row.analysis.categories) counts.set(c.category, (counts.get(c.category) ?? 0) + c.samples)
  }
  return Object.fromEntries(PHASE2C26A5_CATEGORIES.map(c => [c, total === 0 ? 0 : (counts.get(c) ?? 0) / total])) as Record<Phase2C26A5Category, number>
}

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A5FormalRunValidation {
  valid: boolean
  failures: string[]
  rawStatus: unknown
  smokeIsNull: boolean
  uncommittedBenchmarkCode: unknown
  shaMatches: { c26a: boolean; a2: boolean; a3: boolean; a4: boolean; export: boolean }
  probeValid: boolean
  profilerConfig: unknown
  searchInstrumentation: unknown
  baselineParity: ReturnType<typeof validatePhase2C26A2BaselineParity> | null
  conditionParity: ReturnType<typeof validatePhase2C26A5ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A3Selection> | null
  diagnosticRepresentative: { expected: string; actual: unknown; matches: boolean }
  recordIssues: { id: string; issue: string }[]
}

/**
 * The raw run is the formal A5 series only when it is a clean, non-smoke run of committed code against the same four
 * authority files and Export, whose profiler probe succeeded, with the registered heap / concurrency 1 / budget /
 * heartbeat / profiler window / Node flags and A4's section boundary observer as the only Search instrumentation, the
 * analyzer's own re-derivation of the baseline, condition and selection parity passes, the diagnostic ran on the
 * representative the rule derives from A4, and every profiled child left a profile, a script table (with a source map
 * for every required file), a profile window and a filter interval snapshot with no boundary contract violation.
 */
export function validatePhase2C26A5FormalRun(raw: unknown, c26a: Phase2C26A2Authority, a2: Phase2C26A3A2Authority, a3: Phase2C26A4A3Authority,
  a4: Phase2C26A5A4Authority, shas: { c26a: string; a2: string; a3: string; a4: string }): Phase2C26A5FormalRunValidation {
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  if (r.status !== 'completed') failures.push(`raw status is ${String(r.status)}`)
  const smokeIsNull = environment.smoke === null
  if (!smokeIsNull) failures.push('a smoke run is never formal')
  if (environment.uncommittedBenchmarkCode !== false) failures.push('benchmark code was not committed')
  const shaMatches = {
    c26a: environment.c26aResultSha256 === shas.c26a, a2: environment.c26a2ResultSha256 === shas.a2, a3: environment.c26a3ResultSha256 === shas.a3,
    a4: environment.c26a4ResultSha256 === shas.a4,
    export: environment.exportSha256 === c26a.conditions.exportSha256 && environment.exportSha256 === a4.conditions.exportSha256,
  }
  for (const [key, matches] of Object.entries(shaMatches)) if (!matches) failures.push(`the raw run was not made against this ${key} file`)
  const probe = isObject(r.probe) ? r.probe : {}
  const probeValid = probe.valid === true
  if (!probeValid) failures.push('the profiler probe did not succeed')
  const profilerConfig = environment.profiler
  if (!same(profilerConfig, PHASE2C26A5_PROFILER)) failures.push('the profiler window / sampling interval is not the registered one')
  const searchInstrumentation = environment.searchInstrumentation
  if (!same(searchInstrumentation, PHASE2C26A5_SEARCH_INSTRUMENTATION)) failures.push('the Search instrumentation is not A4\'s section boundary observer alone')
  if (environment.childHeapLimitMb !== PHASE2C26A5_CHILD_HEAP_MB || environment.concurrency !== PHASE2C26A5_CONCURRENCY || environment.orientationBudgetMs !== PHASE2C26A5_ORIENTATION_BUDGET_MS
    || environment.heartbeatIntervalMs !== PHASE2C26A5_HEARTBEAT_INTERVAL_MS) failures.push('run environment is not the registered heap / concurrency 1 / budget / heartbeat')
  if (!same(environment.nodeFlags, PHASE2C26A5_PRIMARY_NODE_FLAGS)) failures.push('primary Node flags are not the registered ones')
  if (!same(environment.diagnosticNodeFlags, PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS)) failures.push('diagnostic Node flags are not the registered ones')

  const baseline = isObject(r.baseline) ? r.baseline : null
  let baselineParity = null, conditionParity = null
  if (!baseline || !isObject(baseline.summary)) failures.push('baseline record missing')
  else {
    baselineParity = validatePhase2C26A2BaselineParity(baseline.summary as never, asArray(baseline.orientations) as Phase2C2Orientation[], c26a)
    if (!baselineParity.valid) failures.push(...baselineParity.issues.map(issue => `baseline parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions & { nodeFlags: string[] } : null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A5ConditionParity(current, a4.conditions, a3.conditions, c26a, a2.conditions)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `condition parity: ${issue}`))
    const actual = { childHeapLimitMb: environment.childHeapLimitMb, concurrency: environment.concurrency, orientationBudgetMs: environment.orientationBudgetMs,
      nodeYield: environment.nodeYield, exportSha256: environment.exportSha256, nodeFlags: environment.nodeFlags }
    for (const [key, value] of Object.entries(actual)) if (!same(value, (current as unknown as Json)[key])) failures.push(`currentConditions.${key} is not the run environment's`)
    for (const kernel of [...kernels, ...(isObject(r.diagnostic) ? [r.diagnostic] : [])]) {
      const conditions = isObject(kernel.task) && isObject(kernel.task.conditions) ? kernel.task.conditions : {}
      if (!same(conditions.extent, current.extent) || !same(conditions.bounds, current.bounds)) failures.push(`${String(kernel.orientationId)} ran with other extent / bounds`)
    }
  }
  const selection = validatePhase2C26A3Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean),
    a4.primaryOrientationIds, c26a)
  if (!selection.valid) failures.push('the profiled orientations are not exactly the A4 primary set')
  if (a4.primaryOrientationIds.length !== PHASE2C26A5_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')
  const expectedRepresentative = selectPhase2C26A5DiagnosticRepresentative(a4).representativeOrientationId
  const diagnostic = isObject(r.diagnostic) ? r.diagnostic : null
  const diagnosticRepresentative = { expected: expectedRepresentative, actual: diagnostic?.orientationId ?? null, matches: diagnostic?.orientationId === expectedRepresentative }
  if (!diagnosticRepresentative.matches) failures.push('the diagnostic did not run on the rule\'s representative')

  const recordIssues: Phase2C26A5FormalRunValidation['recordIssues'] = []
  const profiled = [...kernels.map(k => ({ k, variant: 'jit_default' })), ...(diagnostic ? [{ k: diagnostic, variant: 'no_inlining' }] : [])]
  for (const { k, variant } of profiled) {
    const id = `${variant}:${String(k.orientationId)}`
    if (k.variant !== variant) recordIssues.push({ id, issue: `variant is ${String(k.variant)}` })
    const flags = isObject(k.process) ? k.process.nodeFlags : null
    if (!same(flags, variant === 'jit_default' ? PHASE2C26A5_PRIMARY_NODE_FLAGS : PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS)) recordIssues.push({ id, issue: 'child Node flags differ' })
    const capture = isObject(k.capture) ? k.capture : null
    if (!capture) { recordIssues.push({ id, issue: 'no profile capture' }); continue }
    if (!isObject(capture.profile) || typeof capture.profile.file !== 'string' || typeof capture.profile.sha256 !== 'string') recordIssues.push({ id, issue: 'profile file record missing' })
    if (!isObject(capture.scripts) || typeof capture.scripts.file !== 'string' || typeof capture.scripts.sha256 !== 'string') recordIssues.push({ id, issue: 'script table record missing' })
    const required = isObject(capture.scripts) && isObject(capture.scripts.requiredSourceMaps) ? capture.scripts.requiredSourceMaps : {}
    for (const file of PHASE2C26A5_REQUIRED_SOURCE_FILES) if (required[file] !== true) recordIssues.push({ id, issue: `no source map for ${file}` })
    const window = isObject(capture.window) ? capture.window : {}
    if (window.error !== null) recordIssues.push({ id, issue: `profile window error ${String(window.error)}` })
    if (window.stoppedBy !== 'window') recordIssues.push({ id, issue: `profile stopped by ${String(window.stoppedBy)}` })
    const intervals = isObject(capture.intervals) ? capture.intervals : {}
    if (intervals.violations !== 0) recordIssues.push({ id, issue: `${String(intervals.violations)} filter boundary violations` })
    if (intervals.openAtSnapshot !== null) recordIssues.push({ id, issue: 'a filter section was open at the profile stop' })
  }
  if (recordIssues.length > 0) failures.push('profile record issues')
  return { valid: failures.length === 0, failures, rawStatus: r.status, smokeIsNull, uncommittedBenchmarkCode: environment.uncommittedBenchmarkCode, shaMatches,
    probeValid, profilerConfig, searchInstrumentation, baselineParity, conditionParity, selection, diagnosticRepresentative, recordIssues }
}
