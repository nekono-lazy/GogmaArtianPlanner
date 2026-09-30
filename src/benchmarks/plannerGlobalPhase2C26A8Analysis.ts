/**
 * Issue #154 Phase 2-C2.6-A8: CPU profile analysis of the held-aware `frontier_reduction_sort` section, Research only.
 * Never import from Production.
 *
 * Pure functions over one V8 CPU profile (`Profiler.stop` result), the child's script table (scriptId -> url, inline
 * source maps), the profile window (both clocks read around `Profiler.start` / `Profiler.stop`, A5's alignment) and the
 * A3 held-aware section stream the child already writes durably (`gogma_phase_started` / `gogma_depth`):
 *
 * - the `frontier_reduction_sort` intervals, rebuilt from that stream. The A3 tracker stamps a section start before its
 *   durable write and records each section's exclusive wall time (`phase_started` -> `phase_completed`) in the depth
 *   record, so an interval is [start, start + phaseMs.frontier_reduction_sort) on the Research clock
 *   (`kernel_invoked.originChildProcessMs + elapsedMs`); the next boundary of the same depth (the next `phase_started`, or
 *   the depth completion) is its upper bound. Phase order, duplicates, depth / stream identity, negative durations,
 *   overlaps and missing boundaries fail closed;
 * - the population: only samples whose Research time falls inside a rebuilt interval;
 * - the pre-registered stack-aware classification (priority gc, observer overhead, representative stable serialization,
 *   frontier sort, representative compare, reduction loop, other) and the pre-registered decision rule;
 * - descriptive line ticks (`positionTicks`) of the registered frontier functions, whole-profile, source-mapped.
 *
 * Every rule here is fixed before the formal run. V8 folds builtins (Map get / set, the Array sort loop, spread) into the
 * calling JavaScript frame, and TurboFan may inline callees without restoring a frame, so the categories are named
 * `*_or_inlined` where a function boundary can be lost; nothing here claims "Map cost" or "sort cost" from a caller leaf.
 */
import { stableStringify } from '../domain/models/publicTypes'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimePhase } from '../domain/search/bonusStream'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import type { Phase2C26A2Authority, Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import type { Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import type { Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import { validatePhase2C26A4FormalRun } from './plannerGlobalPhase2C26A4Analysis'
import { PHASE2C26A4_SEARCH_INSTRUMENTATION } from './plannerGlobalPhase2C26A4'
import type { Phase2C26A5A4Authority, Phase2C26A5ProfileWindow } from './plannerGlobalPhase2C26A5'
import {
  normalizePhase2C26A5Url,
  phase2c26a5SampleTimesUs,
  validatePhase2C26A5ClockAlignment,
  validatePhase2C26A5CpuProfile,
  type CpuProfile,
  type CpuProfileCallFrame,
  type Phase2C26A5ClockAlignment,
  type Phase2C26A5ScriptTable,
} from './plannerGlobalPhase2C26A5Analysis'
import type { Phase2C26A6A5Authority } from './plannerGlobalPhase2C26A6'
import type { Phase2C26A6WorkPrefix } from './plannerGlobalPhase2C26A6Analysis'
import type { Phase2C26A7A6Authority } from './plannerGlobalPhase2C26A7'
import {
  PHASE2C26A8_CHILD_HEAP_MB,
  PHASE2C26A8_CONCURRENCY,
  PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS,
  PHASE2C26A8_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A8_ORIENTATION_BUDGET_MS,
  PHASE2C26A8_PRIMARY_NODE_FLAGS,
  PHASE2C26A8_PROFILER,
  PHASE2C26A8_REGISTERED_PRIMARY_COUNT,
  PHASE2C26A8_REQUIRED_SOURCE_FILES,
  PHASE2C26A8_SEARCH_INSTRUMENTATION,
  PHASE2C26A8_SECTION,
  selectPhase2C26A8DiagnosticRepresentative,
  validatePhase2C26A8ConditionParity,
  validatePhase2C26A8NoProductionChange,
  validatePhase2C26A8Selection,
  type Phase2C26A8A7Authority,
  type Phase2C26A8ProductionChangeValidation,
} from './plannerGlobalPhase2C26A8'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

export class Phase2C26A8AnalysisError extends Error {}

// ---------------------------------------------------------------- frontier_reduction_sort intervals (A3 stream)

/** Registered tolerance of the interval checks (ms): only floating point rounding of `start + wall`. */
export const PHASE2C26A8_INTERVAL_TOLERANCE_MS = 1e-6

export interface Phase2C26A8FrontierInterval {
  targetOrdinal: number
  streamIndex: number
  depth: number
  /** Research clock (the child's `performance.now()`), ms. */
  startMs: number
  endMs: number
  /** The next boundary of the same depth (next `phase_started`, or the depth completion), Research clock. */
  nextBoundaryMs: number
  frontierStatesBefore: number | null
  generatedStates: number | null
  frontierStatesAfter: number | null
}

export interface Phase2C26A8IntervalReconstruction {
  valid: boolean
  issues: string[]
  intervals: Phase2C26A8FrontierInterval[]
  /** A `frontier_reduction_sort` start whose depth never completed (the stream ended inside it). */
  openFrontier: { targetOrdinal: number; streamIndex: number; depth: number; startMs: number } | null
  phaseStartRecords: number
  depthRecords: number
  /** Sum of (next boundary - end): the time between the section end and the next A3 boundary (observer calls, return). */
  gapToNextBoundaryMs: number
}

interface PhaseStart { seq: number; elapsedMs: number; targetOrdinal: number; streamIndex: number; depth: number; phase: string }

/**
 * Rebuilds the `frontier_reduction_sort` intervals from the A3 held-aware records of one kernel child. Fails closed (with
 * the intervals it did rebuild) on a non-contiguous sequence, an unknown record, a phase out of the registered order or
 * started twice in one depth, a depth record of another depth / stream / Target, a phase without its wall time (or a wall
 * time without its start), a negative wall time, an end past the next boundary, a boundary before the depth start or after
 * its completion, or overlapping intervals. `originMs` maps the A3 elapsed clock onto the Research clock.
 */
export function reconstructPhase2C26A8FrontierIntervals(records: readonly unknown[], originMs: number,
  tolerance = PHASE2C26A8_INTERVAL_TOLERANCE_MS): Phase2C26A8IntervalReconstruction {
  const issues: string[] = []
  const intervals: Phase2C26A8FrontierInterval[] = []
  const issue = (message: string) => { if (issues.length < 50) issues.push(message) }
  if (num(originMs) === null) issue('the kernel origin is not a finite number')
  const all = records.filter(isObject)
  const known = all.filter(record => record.kind === 'gogma_phase_started' || record.kind === 'gogma_depth')
  if (known.length !== records.length) issue('an unknown held-aware record kind')
  const ordered = [...known].sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1))
  if (ordered.some((record, index) => record.seq !== index + 1)) issue('the held-aware sequence is not contiguous from 1')
  const phaseIndex = (phase: unknown) => RESERVED_GOGMA_RUNTIME_PHASES.indexOf(phase as ReservedGogmaRuntimePhase)
  let group: { targetOrdinal: number; streamIndex: number; depth: number; starts: PhaseStart[] } | null = null
  let phaseStartRecords = 0, depthRecords = 0, gap = 0
  const identity = (r: { targetOrdinal: unknown; streamIndex: unknown; depth: unknown }) => `t${String(r.targetOrdinal)}/s${String(r.streamIndex)}/d${String(r.depth)}`
  for (const record of ordered) {
    if (record.kind === 'gogma_phase_started') {
      phaseStartRecords += 1
      const start: PhaseStart = { seq: num(record.seq) ?? -1, elapsedMs: num(record.elapsedMs) ?? NaN, targetOrdinal: num(record.targetOrdinal) ?? -1,
        streamIndex: num(record.streamIndex) ?? -1, depth: num(record.depth) ?? -1, phase: String(record.phase) }
      if (!Number.isFinite(start.elapsedMs)) { issue(`seq ${start.seq}: phase start time is not finite`); continue }
      if (phaseIndex(start.phase) < 0) { issue(`seq ${start.seq}: unknown phase ${start.phase}`); continue }
      if (group === null) group = { targetOrdinal: start.targetOrdinal, streamIndex: start.streamIndex, depth: start.depth, starts: [] }
      else if (identity(group) !== identity(start)) {
        issue(`seq ${start.seq}: ${start.phase} of ${identity(start)} started while ${identity(group)} has no depth record (missing boundary / depth mismatch)`)
        group = { targetOrdinal: start.targetOrdinal, streamIndex: start.streamIndex, depth: start.depth, starts: [] }
      }
      const last = group.starts.at(-1)
      if (last !== undefined) {
        if (phaseIndex(start.phase) === phaseIndex(last.phase)) issue(`seq ${start.seq}: duplicate ${start.phase} start in ${identity(start)}`)
        else if (phaseIndex(start.phase) < phaseIndex(last.phase)) issue(`seq ${start.seq}: ${start.phase} after ${last.phase} in ${identity(start)} (phase order)`)
        if (start.elapsedMs < last.elapsedMs) issue(`seq ${start.seq}: phase start precedes the previous one (negative duration)`)
      }
      group.starts.push(start)
      continue
    }
    depthRecords += 1
    const depth = { seq: num(record.seq) ?? -1, targetOrdinal: num(record.targetOrdinal) ?? -1, streamIndex: num(record.streamIndex) ?? -1, depth: num(record.depth) ?? -1 }
    const phaseMs = isObject(record.phaseMs) ? record.phaseMs : null
    const startedMs = num(record.startedMs), completedMs = num(record.completedMs)
    const counts = isObject(record.counts) ? record.counts : {}
    if (phaseMs === null || startedMs === null || completedMs === null) { issue(`seq ${depth.seq}: malformed depth record`); group = null; continue }
    if (completedMs < startedMs) issue(`seq ${depth.seq}: depth completes before it starts (negative duration)`)
    const starts = group === null ? [] : group.starts
    if (group !== null && identity(group) !== identity(depth)) issue(`seq ${depth.seq}: depth record ${identity(depth)} closes the phases of ${identity(group)} (depth / stream mismatch)`)
    group = null
    const startedPhases = new Set(starts.map(s => s.phase))
    for (const key of Object.keys(phaseMs)) if (!startedPhases.has(key)) issue(`seq ${depth.seq}: ${key} has a wall time but no start (missing boundary)`)
    for (const [index, start] of starts.entries()) {
      const wall = num(phaseMs[start.phase])
      if (wall === null) { issue(`seq ${depth.seq}: ${start.phase} started but has no wall time (missing boundary)`); continue }
      if (wall < 0) { issue(`seq ${depth.seq}: ${start.phase} has a negative wall time`); continue }
      if (start.elapsedMs < startedMs - tolerance) issue(`seq ${start.seq}: ${start.phase} starts before its depth`)
      const next = index + 1 < starts.length ? starts[index + 1].elapsedMs : completedMs
      const end = start.elapsedMs + wall
      if (end > next + tolerance) issue(`seq ${start.seq}: ${start.phase} ends after its next boundary`)
      if (start.phase !== PHASE2C26A8_SECTION) continue
      gap += Math.max(0, next - end)
      intervals.push({ targetOrdinal: depth.targetOrdinal, streamIndex: depth.streamIndex, depth: depth.depth, startMs: originMs + start.elapsedMs, endMs: originMs + end,
        nextBoundaryMs: originMs + next, frontierStatesBefore: num(counts.frontierStatesBefore), generatedStates: num(counts.generatedStates),
        frontierStatesAfter: num(counts.frontierStatesAfter) })
    }
  }
  let openFrontier: Phase2C26A8IntervalReconstruction['openFrontier'] = null
  if (group !== null) {
    const open = group.starts.find(s => s.phase === PHASE2C26A8_SECTION)
    if (open) openFrontier = { targetOrdinal: open.targetOrdinal, streamIndex: open.streamIndex, depth: open.depth, startMs: originMs + open.elapsedMs }
  }
  intervals.sort((a, b) => a.startMs - b.startMs)
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].startMs < intervals[index - 1].endMs - tolerance) issue(`interval ${index} overlaps the previous one`)
  }
  if (openFrontier !== null && intervals.length > 0 && openFrontier.startMs < (intervals.at(-1) as Phase2C26A8FrontierInterval).endMs - tolerance) issue('the open interval overlaps a closed one')
  return { valid: issues.length === 0, issues, intervals, openFrontier, phaseStartRecords, depthRecords, gapToNextBoundaryMs: gap }
}

/** Research-clock origin of one kernel child (`kernel_invoked.originChildProcessMs`). */
export function phase2c26a8KernelOrigin(kernel: unknown): number | null {
  const k = isObject(kernel) ? kernel : {}
  const invoked = asArray(k.events).filter(isObject).find(record => record.kind === 'kernel_invoked')
  return invoked ? num(invoked.originChildProcessMs) : null
}

// ---------------------------------------------------------------- the registered functions

export type Phase2C26A8Role = 'reduction_owner' | 'representative' | 'frontier_comparator' | 'serialization' | 'key_compare'

/**
 * The registered named functions. `anonymousBySpan` attributes an anonymous frame whose source-mapped start lies in the
 * function's span to it (the `map` callbacks of `serializeStable`); it is off for the Search functions, whose own
 * callbacks (other sections' `map` / `find`) are not the function.
 */
export const PHASE2C26A8_FUNCTION_REGISTRY: readonly { role: Phase2C26A8Role; file: string; functionName: string; anonymousBySpan: boolean }[] = [
  { role: 'reduction_owner', file: 'src/domain/search/bonusStream.ts', functionName: 'generateReservedDepth', anonymousBySpan: false },
  { role: 'representative', file: 'src/domain/search/bonusStream.ts', functionName: 'compareReservedRepresentative', anonymousBySpan: false },
  { role: 'frontier_comparator', file: 'src/domain/search/bonusStream.ts', functionName: 'compareReservedFrontier', anonymousBySpan: false },
  { role: 'serialization', file: 'src/domain/models/hashing.ts', functionName: 'stableStringify', anonymousBySpan: true },
  { role: 'serialization', file: 'src/domain/models/hashing.ts', functionName: 'serializeStable', anonymousBySpan: true },
  { role: 'key_compare', file: 'src/domain/search/semanticKeys.ts', functionName: 'compareStableKeys', anonymousBySpan: true },
]

export interface Phase2C26A8FunctionSpan { file: string; functionName: string; startLine: number; endLine: number; indent: number }

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The 1-based source span of each registered function from the measured HEAD's source text: the unique line declaring
 * `function <name>` (any indentation, optionally `export` / `async`, generic parameters allowed) through the first
 * following line that is exactly the declaration's indentation plus `}`. Fails closed when a declaration is missing,
 * ambiguous or unterminated.
 */
export function derivePhase2C26A8FunctionSpans(sources: Readonly<Record<string, string>>,
  registry: readonly { file: string; functionName: string }[] = PHASE2C26A8_FUNCTION_REGISTRY): Phase2C26A8FunctionSpan[] {
  return registry.map(({ file, functionName }) => {
    const text = sources[file]
    if (typeof text !== 'string') throw new Phase2C26A8AnalysisError(`No source text for ${file}.`)
    const lines = text.split(/\r?\n/)
    const declaration = new RegExp(`^(\\s*)(export\\s+)?(async\\s+)?function\\s+${escapeRegExp(functionName)}\\s*[<(]`)
    const starts = lines.flatMap((line, index) => (declaration.test(line) ? [index] : []))
    if (starts.length !== 1) throw new Phase2C26A8AnalysisError(`${file}: ${starts.length} declarations of ${functionName}.`)
    const indent = (declaration.exec(lines[starts[0]]) as RegExpExecArray)[1]
    const close = new RegExp(`^${escapeRegExp(indent)}\\}\\s*$`)
    const end = lines.findIndex((line, index) => index > starts[0] && close.test(line))
    if (end < 0) throw new Phase2C26A8AnalysisError(`${file}: ${functionName} is not terminated by "${indent}}".`)
    return { file, functionName, startLine: starts[0] + 1, endLine: end + 1, indent: indent.length }
  })
}

/** The source lines of the `frontier_reduction_sort` block in `generateReservedDepth` (after its start boundary, through its completion boundary). */
export interface Phase2C26A8FrontierBlock { file: string; startLine: number; endLine: number; lines: { line: number; text: string }[] }

export const PHASE2C26A8_FRONTIER_BLOCK_MARKERS = {
  file: 'src/domain/search/bonusStream.ts',
  started: "runtime.phase('phase_started', 'frontier_reduction_sort')",
  completed: "runtime.phase('phase_completed', 'frontier_reduction_sort')",
} as const

/** Derives the frontier block lines from the measured HEAD's source text; fails closed unless each marker is unique and ordered. */
export function derivePhase2C26A8FrontierBlock(source: string, markers = PHASE2C26A8_FRONTIER_BLOCK_MARKERS): Phase2C26A8FrontierBlock {
  const lines = source.split(/\r?\n/)
  const find = (marker: string) => lines.flatMap((line, index) => (line.includes(marker) ? [index] : []))
  const started = find(markers.started), completed = find(markers.completed)
  if (started.length !== 1 || completed.length !== 1 || completed[0] <= started[0]) {
    throw new Phase2C26A8AnalysisError(`${markers.file}: the frontier_reduction_sort markers are not unique and ordered.`)
  }
  const block = lines.slice(started[0] + 1, completed[0] + 1).map((text, offset) => ({ line: started[0] + 2 + offset, text: text.trim() }))
  return { file: markers.file, startLine: started[0] + 2, endLine: completed[0] + 1, lines: block }
}

// ---------------------------------------------------------------- frames

export type Phase2C26A8LeafKind = 'gc' | 'program' | 'idle' | 'root' | 'vite_module_runner' | 'vite_ssr_unmapped' | 'research_harness' | 'repository' | 'dependency'
  | 'node_internal' | 'native'

export interface Phase2C26A8Frame {
  functionName: string
  file: string
  /** 1-based source-mapped line of the function start (Repository frames with a source map), else null. */
  originalLine: number | null
  registered: string | null
  role: Phase2C26A8Role | null
  /** Whether a registered frame was matched by name (false: an anonymous frame by span). */
  byName: boolean
  kind: Phase2C26A8LeafKind
}

function kindOf(functionName: string, rawUrl: string, file: string, originalLine: number | null): Phase2C26A8LeafKind {
  if (functionName === '(garbage collector)') return 'gc'
  if (functionName === '(program)') return 'program'
  if (functionName === '(idle)') return 'idle'
  if (functionName === '(root)') return 'root'
  if (file.includes('vite/dist/node/module-runner')) return 'vite_module_runner'
  if (file.startsWith('src/benchmarks/') || file.startsWith('scripts/')) return 'research_harness'
  if (file.startsWith('src/')) return originalLine === null ? 'vite_ssr_unmapped' : 'repository'
  if (file.startsWith('node_modules/') || file.includes('/node_modules/')) return 'dependency'
  if (rawUrl.startsWith('node:')) return 'node_internal'
  return 'native'
}

/** Resolves one call frame to its Repository file, source-mapped function start and registered function. */
export function resolvePhase2C26A8Frame(callFrame: CpuProfileCallFrame, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26A8FunctionSpan[]): Phase2C26A8Frame {
  const rawUrl = callFrame.url !== '' ? callFrame.url : (scripts.urlOf(callFrame.scriptId) ?? '')
  const file = normalizePhase2C26A5Url(rawUrl)
  const repository = file.startsWith('src/')
  const originalLine = repository ? scripts.originalLine(callFrame.scriptId, callFrame.lineNumber, callFrame.columnNumber) : null
  let registered: string | null = null, role: Phase2C26A8Role | null = null, byName = false
  if (repository) {
    for (const entry of PHASE2C26A8_FUNCTION_REGISTRY) {
      if (entry.file !== file) continue
      const span = spans.find(s => s.file === entry.file && s.functionName === entry.functionName)
      const named = callFrame.functionName === entry.functionName
      const bySpan = entry.anonymousBySpan && callFrame.functionName === '' && span !== undefined && originalLine !== null
        && originalLine >= span.startLine && originalLine <= span.endLine
      if (named || bySpan) { registered = `${entry.file}#${entry.functionName}`; role = entry.role; byName = named; break }
    }
  }
  return { functionName: callFrame.functionName, file, originalLine, registered, role, byName, kind: kindOf(callFrame.functionName, rawUrl, file, originalLine) }
}

// ---------------------------------------------------------------- the registered classification

export type Phase2C26A8Category =
  | 'representative_stable_serialization'
  | 'representative_compare_or_inlined'
  | 'frontier_sort'
  | 'reduction_loop_or_inlined'
  | 'gc'
  | 'other_frontier'

/** The report order. The classification priority is PHASE2C26A8_CATEGORY_RULES. */
export const PHASE2C26A8_CATEGORIES: readonly Phase2C26A8Category[] = [
  'representative_stable_serialization', 'representative_compare_or_inlined', 'frontier_sort', 'reduction_loop_or_inlined', 'gc', 'other_frontier',
]

/** Descriptive reason of an `other_frontier` sample (never a decision input). */
export type Phase2C26A8OtherReason = 'observer_overhead' | 'serialization_without_representative' | 'program' | 'idle' | 'vite_loader' | 'native_or_internal' | 'other_repository' | 'other'

export const PHASE2C26A8_CATEGORY_RULES: readonly { priority: number; category: Phase2C26A8Category; rule: string }[] = [
  { priority: 1, category: 'gc', rule: 'the stack contains the V8 "(garbage collector)" frame' },
  { priority: 2, category: 'other_frontier', rule: 'observer overhead: a Research harness frame (src/benchmarks/, scripts/) deeper than a bonusStream.ts frame (the A3 observer and its durable write, called from the section boundary)' },
  { priority: 3, category: 'representative_stable_serialization', rule: 'a serialization frame (stableStringify / serializeStable in hashing.ts, named, or an anonymous frame in their spans) deeper than a compareReservedRepresentative frame; a serialization frame without that ancestor is never this category' },
  { priority: 4, category: 'frontier_sort', rule: 'a compareReservedFrontier frame (and whatever it calls, e.g. compareStableKeys); or a native leaf named "sort" whose nearest non-native ancestor is generateReservedDepth. V8 folds the Array.prototype.sort builtin loop (and the [...byKey.values()] spread) into the generateReservedDepth frame, so only comparator samples are separable' },
  { priority: 5, category: 'representative_compare_or_inlined', rule: 'a compareReservedRepresentative frame without a serialization frame under it: the lastResetDepth comparison, compareStableKeys, a Vite SSR import accessor on the way to stableStringify, and anything JIT-inlined into it without a frame' },
  { priority: 6, category: 'reduction_loop_or_inlined', rule: 'the leaf is the generateReservedDepth frame (by name), or a native leaf whose nearest non-native ancestor is it: the key template, Map get / set, the loop, the frontier array spread, the sort builtin loop and anything inlined into generateReservedDepth. Never "Map cost" on its own' },
  { priority: 7, category: 'other_frontier', rule: 'anything else inside a frontier interval ((program), a serialization frame without a representative ancestor, a Vite SSR loader frame, a native / Node internal frame without the registered ancestor, other Repository frames)' },
]

const isNative = (frame: Phase2C26A8Frame) => frame.kind === 'native'

/** The registered category of one sampled stack (outermost first), with the descriptive reason of an `other_frontier` one. */
export function classifyPhase2C26A8Stack(stack: readonly Phase2C26A8Frame[]): { category: Phase2C26A8Category; otherReason: Phase2C26A8OtherReason | null } {
  const other = (otherReason: Phase2C26A8OtherReason) => ({ category: 'other_frontier' as const, otherReason })
  if (stack.some(frame => frame.kind === 'gc')) return { category: 'gc', otherReason: null }
  const firstBonus = stack.findIndex(frame => frame.file === 'src/domain/search/bonusStream.ts')
  if (firstBonus >= 0 && stack.some((frame, index) => index > firstBonus && frame.kind === 'research_harness')) return other('observer_overhead')
  const representative = stack.findIndex(frame => frame.role === 'representative')
  const serialization = stack.findIndex((frame, index) => frame.role === 'serialization' && representative >= 0 && index > representative)
  if (representative >= 0 && serialization > representative) return { category: 'representative_stable_serialization', otherReason: null }
  const leaf = stack.at(-1)
  const nearestNonNative = (() => { for (let index = stack.length - 1; index >= 0; index -= 1) if (!isNative(stack[index])) return stack[index]; return undefined })()
  if (stack.some(frame => frame.role === 'frontier_comparator')) return { category: 'frontier_sort', otherReason: null }
  if (leaf !== undefined && isNative(leaf) && leaf.functionName === 'sort' && nearestNonNative?.role === 'reduction_owner') return { category: 'frontier_sort', otherReason: null }
  if (representative >= 0) return { category: 'representative_compare_or_inlined', otherReason: null }
  if (leaf !== undefined && (leaf.role === 'reduction_owner' && leaf.byName)) return { category: 'reduction_loop_or_inlined', otherReason: null }
  if (leaf !== undefined && isNative(leaf) && nearestNonNative?.role === 'reduction_owner' && nearestNonNative.byName) return { category: 'reduction_loop_or_inlined', otherReason: null }
  if (stack.some(frame => frame.role === 'serialization')) return other('serialization_without_representative')
  if (leaf === undefined) return other('other')
  if (leaf.kind === 'program') return other('program')
  if (leaf.kind === 'idle') return other('idle')
  if (leaf.kind === 'vite_module_runner' || leaf.kind === 'vite_ssr_unmapped') return other('vite_loader')
  if (leaf.kind === 'native' || leaf.kind === 'node_internal') return other('native_or_internal')
  if (leaf.kind === 'repository') return other('other_repository')
  return other('other')
}

// ---------------------------------------------------------------- one profile

/** A CPU profile node's optional per-line self ticks (`positionTicks`, generated 1-based lines). */
interface PositionTicksNode { id: number; callFrame: CpuProfileCallFrame; positionTicks?: unknown }

export interface Phase2C26A8CategoryCount { category: Phase2C26A8Category; samples: number; share: number }

export interface Phase2C26A8LineTicks {
  /** Registered function this breakdown is of. */
  registered: string
  totalSelfTicks: number
  unmappedTicks: number
  /** Ticks by source-mapped original line inside the function's span, with the line text (whole profile, self ticks). */
  inSpan: { line: number; text: string; ticks: number; inFrontierBlock: boolean }[]
  /** Ticks mapped outside the function's span (positions of code inlined into it). */
  outsideSpanTicks: number
}

export interface Phase2C26A8WorkInWindow {
  /** Intervals overlapping the profile, and those only partly inside it. */
  intervals: number
  partialIntervals: number
  generatedStates: number
  frontierStatesAfter: number
  /**
   * generatedStates - frontierStatesAfter: in the current implementation every generated state after the first of its
   * (position, family layout) key calls compareReservedRepresentative exactly once, so this is the exact call count (of
   * the whole intervals overlapping the window). stableStringify runs only when lastResetDepth ties (short-circuit), so
   * the serialization call count is not 2 x this.
   */
  representativeCompareCalls: number
}

export interface Phase2C26A8ProfileAnalysis {
  alignment: Phase2C26A5ClockAlignment
  intervalValidation: { valid: boolean; issues: string[]; count: number }
  allProfileSamples: number
  /** Samples whose Research time lies in the aligned profile window (all of them when the clocks align). */
  windowSamples: number
  observedIntervalUs: { median: number | null; mean: number | null }
  intervalsInProfile: number
  intervalMsInProfile: number
  intervalShareOfProfile: number | null
  frontierSamples: number
  frontierSampleShare: number | null
  categories: Phase2C26A8CategoryCount[]
  otherReasons: { reason: Phase2C26A8OtherReason; samples: number; share: number }[]
  /** Leaf kind composition of every frontier sample, and per category. */
  leafKinds: { kind: Phase2C26A8LeafKind; samples: number; share: number }[]
  categoryLeafKinds: Record<Phase2C26A8Category, Record<string, number>>
  repositoryAttributedSamples: number
  unattributedOrNativeSamples: number
  gcSamples: number
  topLeaves: { leaf: string; category: Phase2C26A8Category; samples: number; share: number }[]
  topStacks: { stack: string; category: Phase2C26A8Category; samples: number; share: number }[]
  /** Registered-function inclusive samples inside the frontier intervals (a function counted once per sample). */
  registeredInclusive: { registered: string; samples: number; share: number }[]
  /** Samples holding compareReservedRepresentative / compareReservedFrontier (frontier-only functions) inside / outside the intervals. */
  comparatorSamples: { inside: number; outside: number; outsideShare: number | null }
  /** Samples within the tolerance of an interval boundary (descriptive). */
  boundarySamples: number
  /** A named registered frame whose source-mapped start is not its declaration line (a resolution failure). */
  registeredLineMismatches: string[]
  /** Descriptive, whole-profile line ticks of the registered frontier functions. */
  lineTicks: Phase2C26A8LineTicks[]
  /** In-interval samples whose leaf is the generateReservedDepth frame, beside its frontier-block line ticks (consistency, descriptive). */
  reductionLeafCheck: { inIntervalLeafSamples: number; frontierBlockLineTicks: number; functionStartLineTicks: number }
  workInWindow: Phase2C26A8WorkInWindow
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

function positionTicksOf(node: PositionTicksNode): { line: number; ticks: number }[] {
  return asArray(node.positionTicks).filter(isObject).flatMap(t => (num(t.line) !== null && num(t.ticks) !== null ? [{ line: t.line as number, ticks: t.ticks as number }] : []))
}

/**
 * Classifies one CPU profile's samples inside the rebuilt `frontier_reduction_sort` intervals. When the clock alignment
 * or the interval reconstruction is not valid, no sample is mapped (`frontierSamples = 0`) and the profile is no evidence.
 */
export function analyzePhase2C26A8Profile(profile: CpuProfile, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26A8FunctionSpan[],
  sourceTexts: Readonly<Record<string, string>>, frontierBlock: Phase2C26A8FrontierBlock,
  window: Pick<Phase2C26A5ProfileWindow, 'startPre' | 'startPost' | 'stopPre' | 'stopPost'>, reconstruction: Phase2C26A8IntervalReconstruction): Phase2C26A8ProfileAnalysis {
  const alignment = validatePhase2C26A5ClockAlignment(profile, window)
  const intervals = reconstruction.intervals
  const intervalIssues = [...reconstruction.issues]
  if (reconstruction.openFrontier !== null && alignment.researchProfileEndMs !== null && reconstruction.openFrontier.startMs < alignment.researchProfileEndMs) {
    intervalIssues.push('an open (never completed) frontier interval starts inside the profile window')
  }
  const intervalValidation = { valid: intervalIssues.length === 0, issues: intervalIssues.slice(0, 20), count: intervals.length }
  const { timesUs } = phase2c26a5SampleTimesUs(profile)
  const deltas = profile.timeDeltas.filter(d => d >= 0).sort((a, b) => a - b)
  const observedIntervalUs = { median: deltas.length === 0 ? null : deltas[Math.floor(deltas.length / 2)],
    mean: deltas.length === 0 ? null : deltas.reduce((a, b) => a + b, 0) / deltas.length }

  const nodes = new Map(profile.nodes.map(node => [node.id, node as PositionTicksNode]))
  const parent = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const frameMemo = new Map<number, Phase2C26A8Frame>()
  const frameOf = (id: number) => {
    let frame = frameMemo.get(id)
    if (!frame) { frame = resolvePhase2C26A8Frame((nodes.get(id) as PositionTicksNode).callFrame, scripts, spans); frameMemo.set(id, frame) }
    return frame
  }
  const stackMemo = new Map<number, Phase2C26A8Frame[]>()
  const stackOf = (leafId: number) => {
    let stack = stackMemo.get(leafId)
    if (!stack) {
      stack = []
      for (let id: number | undefined = leafId; id !== undefined; id = parent.get(id)) stack.unshift(frameOf(id))
      stackMemo.set(leafId, stack)
    }
    return stack
  }
  const label = (f: Phase2C26A8Frame) => `${f.functionName || '(anonymous)'}@${f.file || '-'}${f.originalLine === null ? '' : `:${f.originalLine}`}`

  const usable = alignment.valid && intervalValidation.valid && alignment.offsetMs !== null
  const offset = alignment.offsetMs ?? 0
  const starts = new Float64Array(intervals.map(i => i.startMs)), ends = new Float64Array(intervals.map(i => i.endMs))
  const categoryCounts = new Map<Phase2C26A8Category, number>(PHASE2C26A8_CATEGORIES.map(c => [c, 0]))
  const otherCounts = new Map<Phase2C26A8OtherReason, number>()
  const leafKinds = new Map<Phase2C26A8LeafKind, number>()
  const categoryLeafKinds = Object.fromEntries(PHASE2C26A8_CATEGORIES.map(c => [c, {} as Record<string, number>])) as Record<Phase2C26A8Category, Record<string, number>>
  const leaves = new Map<string, { category: Phase2C26A8Category; samples: number }>()
  const stacks = new Map<string, { category: Phase2C26A8Category; samples: number }>()
  const inclusive = new Map<string, number>()
  let frontierSamples = 0, windowSamples = 0, boundarySamples = 0, comparatorInside = 0, comparatorOutside = 0, reductionLeafInside = 0
  const tolerance = PHASE2C26A8_INTERVAL_TOLERANCE_MS + 1 + (alignment.offsetSpreadMs ?? 0)
  if (usable) {
    for (let i = 0; i < profile.samples.length; i++) {
      const t = timesUs[i] / 1000 - offset
      if (alignment.researchProfileStartMs !== null && alignment.researchProfileEndMs !== null && t >= alignment.researchProfileStartMs && t <= alignment.researchProfileEndMs) windowSamples += 1
      const k = lastStartAtOrBefore(starts, t)
      const inside = k >= 0 && t < ends[k]
      const stack = stackOf(profile.samples[i])
      const near = (j: number) => j >= 0 && j < starts.length && (Math.abs(t - starts[j]) <= tolerance || Math.abs(t - ends[j]) <= tolerance)
      if (near(k) || near(k + 1)) boundarySamples += 1
      const comparator = stack.some(frame => frame.role === 'representative' || frame.role === 'frontier_comparator')
      if (!inside) { if (comparator) comparatorOutside += 1; continue }
      if (comparator) comparatorInside += 1
      frontierSamples += 1
      const { category, otherReason } = classifyPhase2C26A8Stack(stack)
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
      if (otherReason !== null) otherCounts.set(otherReason, (otherCounts.get(otherReason) ?? 0) + 1)
      const leaf = stack.at(-1) as Phase2C26A8Frame
      if (leaf.role === 'reduction_owner' && leaf.byName) reductionLeafInside += 1
      leafKinds.set(leaf.kind, (leafKinds.get(leaf.kind) ?? 0) + 1)
      categoryLeafKinds[category][leaf.kind] = (categoryLeafKinds[category][leaf.kind] ?? 0) + 1
      const leafKey = label(leaf)
      const leafEntry = leaves.get(leafKey) ?? { category, samples: 0 }
      leafEntry.samples += 1
      leaves.set(leafKey, leafEntry)
      const stackKey = stack.slice(-8).map(label).join(' > ')
      const stackEntry = stacks.get(stackKey) ?? { category, samples: 0 }
      stackEntry.samples += 1
      stacks.set(stackKey, stackEntry)
      const seen = new Set<string>()
      for (const frame of stack) if (frame.registered !== null && !seen.has(frame.registered)) { seen.add(frame.registered); inclusive.set(frame.registered, (inclusive.get(frame.registered) ?? 0) + 1) }
    }
  }
  const share = (n: number) => (frontierSamples === 0 ? 0 : n / frontierSamples)
  let intervalsInProfile = 0, intervalMsInProfile = 0
  const work: Phase2C26A8WorkInWindow = { intervals: 0, partialIntervals: 0, generatedStates: 0, frontierStatesAfter: 0, representativeCompareCalls: 0 }
  if (alignment.researchProfileStartMs !== null && alignment.researchProfileEndMs !== null) {
    for (const interval of intervals) {
      const a = Math.max(interval.startMs, alignment.researchProfileStartMs), b = Math.min(interval.endMs, alignment.researchProfileEndMs)
      if (b <= a) continue
      intervalsInProfile += 1
      intervalMsInProfile += b - a
      work.intervals += 1
      if (a > interval.startMs || b < interval.endMs) work.partialIntervals += 1
      work.generatedStates += interval.generatedStates ?? 0
      work.frontierStatesAfter += interval.frontierStatesAfter ?? 0
      work.representativeCompareCalls += (interval.generatedStates ?? 0) - (interval.frontierStatesAfter ?? 0)
    }
  }

  // Registered frame resolution: a named registered frame must start on its declaration line.
  const mismatches = new Set<string>()
  for (const node of profile.nodes) {
    const frame = frameOf(node.id)
    if (frame.registered === null || !frame.byName) continue
    const span = spans.find(s => `${s.file}#${s.functionName}` === frame.registered)
    if (span === undefined || frame.originalLine !== span.startLine) mismatches.add(`${frame.registered}@${String(frame.originalLine)} (declaration ${String(span?.startLine)})`)
  }

  // Descriptive, whole-profile self line ticks of the registered frontier functions.
  const lineTicks: Phase2C26A8LineTicks[] = []
  const blockLines = new Set(frontierBlock.lines.map(l => l.line))
  for (const entry of PHASE2C26A8_FUNCTION_REGISTRY.filter(e => e.role !== 'serialization' && e.role !== 'key_compare')) {
    const registered = `${entry.file}#${entry.functionName}`
    const span = spans.find(s => s.file === entry.file && s.functionName === entry.functionName)
    const text = (sourceTexts[entry.file] ?? '').split(/\r?\n/)
    const byLine = new Map<number, number>()
    let total = 0, unmapped = 0, outside = 0
    for (const node of profile.nodes as PositionTicksNode[]) {
      const frame = frameOf(node.id)
      if (frame.registered !== registered || !frame.byName) continue
      for (const tick of positionTicksOf(node)) {
        total += tick.ticks
        const line = scripts.originalLine(node.callFrame.scriptId, tick.line - 1, 0)
        if (line === null) { unmapped += tick.ticks; continue }
        if (span === undefined || line < span.startLine || line > span.endLine) { outside += tick.ticks; continue }
        byLine.set(line, (byLine.get(line) ?? 0) + tick.ticks)
      }
    }
    const inSpan = [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([line, ticks]) => ({ line, text: (text[line - 1] ?? '').trim(), ticks,
      inFrontierBlock: entry.file === frontierBlock.file && blockLines.has(line) }))
    lineTicks.push({ registered, totalSelfTicks: total, unmappedTicks: unmapped, inSpan, outsideSpanTicks: outside })
  }
  const owner = lineTicks.find(l => l.registered.endsWith('#generateReservedDepth'))
  const ownerSpan = spans.find(s => s.functionName === 'generateReservedDepth')
  const reductionLeafCheck = { inIntervalLeafSamples: reductionLeafInside,
    frontierBlockLineTicks: owner?.inSpan.filter(l => l.inFrontierBlock).reduce((sum, l) => sum + l.ticks, 0) ?? 0,
    functionStartLineTicks: owner?.inSpan.find(l => l.line === ownerSpan?.startLine)?.ticks ?? 0 }

  const rank = <T extends { samples: number }>(entries: [string, T][], top: number) => entries.sort(([ka, a], [kb, b]) => b.samples - a.samples || (ka < kb ? -1 : 1)).slice(0, top)
  const categories = PHASE2C26A8_CATEGORIES.map(category => ({ category, samples: categoryCounts.get(category) ?? 0, share: share(categoryCounts.get(category) ?? 0) }))
  const kindCount = (...kinds: Phase2C26A8LeafKind[]) => kinds.reduce((sum, kind) => sum + (leafKinds.get(kind) ?? 0), 0)
  return {
    alignment, intervalValidation,
    allProfileSamples: profile.samples.length, windowSamples, observedIntervalUs,
    intervalsInProfile, intervalMsInProfile, intervalShareOfProfile: alignment.profileDurationMs > 0 ? intervalMsInProfile / alignment.profileDurationMs : null,
    frontierSamples, frontierSampleShare: profile.samples.length === 0 ? null : frontierSamples / profile.samples.length,
    categories,
    otherReasons: [...otherCounts.entries()].map(([reason, samples]) => ({ reason, samples, share: share(samples) })).sort((a, b) => b.samples - a.samples || (a.reason < b.reason ? -1 : 1)),
    leafKinds: [...leafKinds.entries()].map(([kind, samples]) => ({ kind, samples, share: share(samples) })).sort((a, b) => b.samples - a.samples || (a.kind < b.kind ? -1 : 1)),
    categoryLeafKinds,
    repositoryAttributedSamples: kindCount('repository'),
    unattributedOrNativeSamples: kindCount('program', 'idle', 'root', 'native', 'node_internal', 'vite_module_runner', 'vite_ssr_unmapped', 'dependency'),
    gcSamples: categoryCounts.get('gc') ?? 0,
    topLeaves: rank([...leaves.entries()], 25).map(([leaf, e]) => ({ leaf, category: e.category, samples: e.samples, share: share(e.samples) })),
    topStacks: rank([...stacks.entries()], 20).map(([stack, e]) => ({ stack, category: e.category, samples: e.samples, share: share(e.samples) })),
    registeredInclusive: [...inclusive.entries()].map(([registered, samples]) => ({ registered, samples, share: share(samples) }))
      .sort((a, b) => b.samples - a.samples || (a.registered < b.registered ? -1 : 1)),
    comparatorSamples: { inside: comparatorInside, outside: comparatorOutside, outsideShare: comparatorInside + comparatorOutside === 0 ? null : comparatorOutside / (comparatorInside + comparatorOutside) },
    boundarySamples,
    registeredLineMismatches: [...mismatches].sort(),
    lineTicks,
    reductionLeafCheck,
    workInWindow: work,
  }
}

/** Structural validation of an untrusted profile, including the optional `positionTicks` shape. */
export function validatePhase2C26A8CpuProfile(json: unknown): CpuProfile {
  const profile = validatePhase2C26A5CpuProfile(json)
  for (const node of profile.nodes as PositionTicksNode[]) {
    if (node.positionTicks === undefined) continue
    if (!Array.isArray(node.positionTicks) || node.positionTicks.some(t => !isObject(t) || num(t.line) === null || num(t.ticks) === null)) {
      throw new Phase2C26A8AnalysisError(`Invalid CPU profile: node ${node.id} has malformed positionTicks.`)
    }
  }
  return profile
}

export const phase2c26a8CategoryShare = (analysis: Pick<Phase2C26A8ProfileAnalysis, 'categories'>, category: Phase2C26A8Category): number =>
  analysis.categories.find(c => c.category === category)?.share ?? 0

// ---------------------------------------------------------------- the pre-registered decision rule

export const PHASE2C26A8_DECISION_RULE = {
  registeredPrimaryCount: PHASE2C26A8_REGISTERED_PRIMARY_COUNT,
  majority: 2,
  minimumFrontierSamples: 5_000,
  dominantShareThreshold: 0.25,
  /** compareReservedRepresentative / compareReservedFrontier run only inside the section: outside-interval samples must stay rare. */
  maxComparatorOutsideShare: 0.01,
  validity: [
    'a complete capture (profile, script table with every required source map, window stopped by the registered stop, no error)',
    'a valid clock alignment (A5 rule) and a valid interval reconstruction (no open interval inside the profile)',
    'frontier_reduction_sort interval samples >= 5,000',
    'every named registered frame resolves to its declaration line',
    'comparator samples outside the intervals <= 1 % of all comparator samples',
  ],
  order: [
    'S representative_stable_serialization_dominant: >= 2 valid primaries where representative_stable_serialization is the unique largest category and >= 0.25',
    'T frontier_sort_dominant: >= 2 valid primaries where frontier_sort is the unique largest category and >= 0.25',
    'R reduction_loop_dominant_unresolved: >= 2 valid primaries where reduction_loop_or_inlined is the unique largest category and >= 0.25',
    'C representative_compare_dominant: >= 2 valid primaries where representative_compare_or_inlined is the unique largest category and >= 0.25',
    'M mixed_or_insufficient: otherwise (fewer than 2 valid primaries, a disagreement, gc / other_frontier largest, or a largest share < 0.25)',
  ],
} as const

export type Phase2C26A8DecisionCase = 'S_stable_serialization_dominant' | 'T_frontier_sort_dominant' | 'R_reduction_loop_dominant_unresolved'
  | 'C_representative_compare_dominant' | 'M_mixed_or_insufficient'

const CASE_OF: Partial<Record<Phase2C26A8Category, Phase2C26A8DecisionCase>> = {
  representative_stable_serialization: 'S_stable_serialization_dominant',
  frontier_sort: 'T_frontier_sort_dominant',
  reduction_loop_or_inlined: 'R_reduction_loop_dominant_unresolved',
  representative_compare_or_inlined: 'C_representative_compare_dominant',
}
const CASE_ORDER: readonly Phase2C26A8Category[] = ['representative_stable_serialization', 'frontier_sort', 'reduction_loop_or_inlined', 'representative_compare_or_inlined']

export const PHASE2C26A8_RECOMMENDATION: Record<Phase2C26A8DecisionCase, string> = {
  S_stable_serialization_dominant: '次Phaseでrepresentative比較用のstable key / prepared representation / serialization回避の最小optimization設計へ進む（representative ruleの意味: lastResetDepth降順、同値ならbonusesのstable serialization昇順、を変えない。frontier順序・state shape・generationは変えない）。',
  T_frontier_sort_dominant: '次Phaseでfrontier sort / ordering実装を詳細化または最適化する（compareReservedFrontierの順序 = position昇順、familyLayoutKey昇順を維持）。',
  R_reduction_loop_dominant_unresolved: 'CPU profilerだけではkey生成 / Map / loop / inline / sort builtinを分離できない。Production optimizationへ進まず、次Phaseでこのcategoryだけをさらに局所化する方法（microbenchmark、行単位の別計測等）を設計する。',
  C_representative_compare_dominant: '次Phaseでcomparator内部（lastResetDepth比較、compareStableKeys、inline部分）を追加調査する。',
  M_mixed_or_insufficient: 'primary間でhotspotが一致しない、sample不足、またはother / GCが最大。optimizationへ進まず追加調査する。',
}

export interface Phase2C26A8DecisionRow {
  orientationId: string
  valid: boolean
  invalidReasons: string[]
  frontierSamples: number
  shares: Record<Phase2C26A8Category, number>
  /** The unique largest category (null on a tie). */
  largestCategory: Phase2C26A8Category | null
  largestShare: number
}

export function phase2c26a8DecisionRow(orientationId: string, analysis: Phase2C26A8ProfileAnalysis | null, captureIssues: readonly string[] = []): Phase2C26A8DecisionRow {
  const rule = PHASE2C26A8_DECISION_RULE
  const invalidReasons = [...captureIssues]
  if (analysis === null) invalidReasons.push('no profile')
  else {
    if (!analysis.alignment.valid) invalidReasons.push(...analysis.alignment.issues.map(i => `clock: ${i}`))
    if (!analysis.intervalValidation.valid) invalidReasons.push(...analysis.intervalValidation.issues.map(i => `intervals: ${i}`))
    if (analysis.frontierSamples < rule.minimumFrontierSamples) invalidReasons.push(`frontierSamples ${analysis.frontierSamples} < ${rule.minimumFrontierSamples}`)
    if (analysis.registeredLineMismatches.length > 0) invalidReasons.push(`registered frame line mismatch: ${analysis.registeredLineMismatches.join(', ')}`)
    const outside = analysis.comparatorSamples.outsideShare
    if (outside !== null && outside > rule.maxComparatorOutsideShare) invalidReasons.push(`comparator samples outside the intervals ${outside} > ${rule.maxComparatorOutsideShare}`)
  }
  const shares = Object.fromEntries(PHASE2C26A8_CATEGORIES.map(c => [c, analysis === null ? 0 : phase2c26a8CategoryShare(analysis, c)])) as Record<Phase2C26A8Category, number>
  const max = Math.max(...PHASE2C26A8_CATEGORIES.map(c => shares[c]))
  const leaders = PHASE2C26A8_CATEGORIES.filter(c => shares[c] === max)
  return { orientationId, valid: invalidReasons.length === 0, invalidReasons, frontierSamples: analysis?.frontierSamples ?? 0, shares,
    largestCategory: leaders.length === 1 && max > 0 ? leaders[0] : null, largestShare: max }
}

/** The pre-registered decision over the primary (jit_default) rows only; the no-inlining diagnostic never enters it. */
export function phase2c26a8Decision(rows: readonly Phase2C26A8DecisionRow[], pooled: Record<Phase2C26A8Category, number>) {
  const rule = PHASE2C26A8_DECISION_RULE
  const valid = rows.filter(row => row.valid)
  const dominantBy = (category: Phase2C26A8Category) => valid.filter(row => row.largestCategory === category && row.shares[category] >= rule.dominantShareThreshold).map(row => row.orientationId)
  const atThreshold = Object.fromEntries(CASE_ORDER.map(category => [category, dominantBy(category)])) as Record<string, string[]>
  const topPooled = [...PHASE2C26A8_CATEGORIES].sort((a, b) => pooled[b] - pooled[a] || PHASE2C26A8_CATEGORIES.indexOf(a) - PHASE2C26A8_CATEGORIES.indexOf(b)).slice(0, 2)
  let decisionCase: Phase2C26A8DecisionCase = 'M_mixed_or_insufficient'
  let category: Phase2C26A8Category | null = null
  let reason: string
  if (rows.length !== rule.registeredPrimaryCount) reason = `primary count ${rows.length} is not the registered ${rule.registeredPrimaryCount}`
  else if (valid.length < rule.majority) reason = `${valid.length} valid primaries (< ${rule.majority})`
  else {
    const hit = CASE_ORDER.find(c => atThreshold[c].length >= rule.majority)
    if (hit !== undefined) {
      category = hit
      decisionCase = CASE_OF[hit] as Phase2C26A8DecisionCase
      reason = `${hit} is the unique largest category and >= ${rule.dominantShareThreshold} in ${atThreshold[hit].join(', ')}`
    } else {
      reason = `no category is the unique largest at >= ${rule.dominantShareThreshold} in ${rule.majority} valid primaries (${valid.map(row => `${row.orientationId}:${String(row.largestCategory)}@${row.largestShare.toFixed(4)}`).join(', ')}); top pooled: ${topPooled.join(', ')}`
    }
  }
  return {
    rule,
    validPrimaries: valid.map(row => row.orientationId),
    invalidPrimaries: rows.filter(row => !row.valid).map(row => ({ orientationId: row.orientationId, reasons: row.invalidReasons })),
    largestByPrimary: Object.fromEntries(rows.map(row => [row.orientationId, { category: row.largestCategory, share: row.largestShare, valid: row.valid }])),
    primariesAtThreshold: atThreshold,
    topPooledCategories: topPooled,
    case: decisionCase,
    category,
    reason,
    recommendation: PHASE2C26A8_RECOMMENDATION[decisionCase],
  }
}

/** Pooled category shares over the valid primaries' frontier samples (sample-weighted). */
export function phase2c26a8PooledShares(rows: readonly { valid: boolean; analysis: Phase2C26A8ProfileAnalysis | null }[]): Record<Phase2C26A8Category, number> {
  const counts = new Map<Phase2C26A8Category, number>(PHASE2C26A8_CATEGORIES.map(c => [c, 0]))
  let total = 0
  for (const row of rows) {
    if (!row.valid || row.analysis === null) continue
    total += row.analysis.frontierSamples
    for (const c of row.analysis.categories) counts.set(c.category, (counts.get(c.category) ?? 0) + c.samples)
  }
  return Object.fromEntries(PHASE2C26A8_CATEGORIES.map(c => [c, total === 0 ? 0 : (counts.get(c) ?? 0) / total])) as Record<Phase2C26A8Category, number>
}

// ---------------------------------------------------------------- semantic parity with the A7 formal raw run

export interface Phase2C26A8DepthPrefix {
  valid: boolean
  issues: string[]
  beforeDepths: number
  afterDepths: number
  commonDepths: number
  firstMismatch: { index: number; before: unknown; after: unknown } | null
  commonGeneratedStates: number
  commonFrontierStatesAfter: number
}

const depthRecordsOf = (kernel: unknown) => asArray(isObject(kernel) ? kernel.gogmaRuntime : null).filter(isObject).filter(record => record.kind === 'gogma_depth')
  .sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1))
/** What one held-aware depth computed (never its time). */
const depthIdentity = (record: Json) => stableStringify({ targetOrdinal: record.targetOrdinal ?? null, streamIndex: record.streamIndex ?? null,
  startGogmaCounter: record.startGogmaCounter ?? null, depth: record.depth ?? null, exhausted: record.exhausted ?? null, counts: record.counts ?? null })

/**
 * The ordered held-aware depth records of the A7 formal ("before") and A8 ("after") kernels of one orientation must be
 * equal on their common prefix: same stream / depth and the same counts (frontier before, legal positions, generated
 * states, frontier after, window memo entries). Complements the A4 completed-work prefix.
 */
export function comparePhase2C26A8DepthPrefix(beforeKernel: unknown, afterKernel: unknown): Phase2C26A8DepthPrefix {
  const before = depthRecordsOf(beforeKernel), after = depthRecordsOf(afterKernel)
  const common = Math.min(before.length, after.length)
  const issues: string[] = []
  let firstMismatch: Phase2C26A8DepthPrefix['firstMismatch'] = null
  let generated = 0, frontier = 0
  for (let index = 0; index < common; index += 1) {
    if (depthIdentity(before[index]) !== depthIdentity(after[index])) {
      firstMismatch = { index, before: JSON.parse(depthIdentity(before[index])), after: JSON.parse(depthIdentity(after[index])) }
      break
    }
    const counts = isObject(before[index].counts) ? before[index].counts as Json : {}
    generated += num(counts.generatedStates) ?? 0
    frontier += num(counts.frontierStatesAfter) ?? 0
  }
  if (common === 0) issues.push('no common held-aware depth record')
  if (firstMismatch !== null) issues.push(`held-aware depth record ${firstMismatch.index} differs (identity or counts)`)
  return { valid: issues.length === 0, issues, beforeDepths: before.length, afterDepths: after.length, commonDepths: common, firstMismatch,
    commonGeneratedStates: generated, commonFrontierStatesAfter: frontier }
}

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A8FormalRunValidation {
  valid: boolean
  failures: string[]
  a4FormalRun: { valid: boolean; failures: string[] }
  shaMatches: Record<'a4' | 'a5' | 'a6' | 'a7', boolean>
  probeValid: boolean
  profilerConfig: unknown
  searchInstrumentation: unknown
  nodeFlags: unknown
  diagnosticNodeFlags: unknown
  conditionParity: ReturnType<typeof validatePhase2C26A8ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A8Selection> | null
  diagnosticRepresentative: { expected: string; actual: unknown; matches: boolean }
  productionChangeRecordedByRunner: Phase2C26A8ProductionChangeValidation | null
  productionChangeRederived: Phase2C26A8ProductionChangeValidation
  a7RawShaMatches: boolean
  workPrefix: { orientationId: string; valid: boolean; issues: string[]; commonWorks: number }[]
  depthPrefix: { orientationId: string; valid: boolean; issues: string[]; commonDepths: number }[]
  recordIssues: { id: string; issue: string }[]
}

/**
 * The raw run is the formal A8 series only when: its Search instrumentation is exactly the A7 pair and, with the A4
 * observer set in its place, it passes the A4 formal-run contract unchanged (same C2.6-A / A2 / A3 authorities and
 * Export, clean non-smoke committed code, concurrency 1, heap / budget / heartbeat, baseline / condition / selection
 * parity, well-formed A4 record streams); it was made against exactly the A4 / A5 / A6 / A7 RESULT files read; the
 * profiler probe succeeded with the registered window / sampling interval and Node flags; its conditions pass the A8
 * parity (chaining to A7 / A6 / ...); the orientations are exactly the A7 selection and the diagnostic ran on the
 * representative the rule derives from A7; no Production calculation source changed since the A7 measured HEAD (as
 * recorded and as re-derived from git); every profiled child left a complete capture, its kernel origin and a contiguous
 * held-aware stream with no contract violation; the A7 raw run is the one the A7 RESULT recorded; and every primary's
 * completed work records and held-aware depth records equal A7's on their common prefix.
 */
export function validatePhase2C26A8FormalRun(raw: unknown, authorities: { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority;
  a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority; a6: Phase2C26A7A6Authority; a7: Phase2C26A8A7Authority },
shas: { c26a: string; a2: string; a3: string; a4: string; a5: string; a6: string; a7: string },
evidence: { productionChangeSinceA7: readonly string[]; a7RawShaMatches: boolean; workPrefix: readonly { orientationId: string; prefix: Phase2C26A6WorkPrefix }[];
  depthPrefix: readonly { orientationId: string; prefix: Phase2C26A8DepthPrefix }[] }): Phase2C26A8FormalRunValidation {
  const { c26a, a2, a3, a4, a5, a6, a7 } = authorities
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  const searchInstrumentation = environment.searchInstrumentation
  const instrumentationIsA8 = same(searchInstrumentation, PHASE2C26A8_SEARCH_INSTRUMENTATION)
  if (!instrumentationIsA8) failures.push('the Search instrumentation is not the A7 pair of boundary observers')
  const a4View = instrumentationIsA8 ? { ...r, environment: { ...environment, searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION } } : r
  const a4Run = validatePhase2C26A4FormalRun(a4View, c26a, a2, a3, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 })
  if (!a4Run.valid) failures.push(...a4Run.failures.map(failure => `A4 formal-run contract: ${failure}`))
  const shaMatches = { a4: environment.c26a4ResultSha256 === shas.a4, a5: environment.c26a5ResultSha256 === shas.a5, a6: environment.c26a6ResultSha256 === shas.a6,
    a7: environment.c26a7ResultSha256 === shas.a7 }
  for (const [key, matches] of Object.entries(shaMatches)) if (!matches) failures.push(`the raw run was not made against this C2.6-${key.toUpperCase()} RESULT`)
  const probe = isObject(r.probe) ? r.probe : {}
  const probeValid = probe.valid === true
  if (!probeValid) failures.push('the profiler probe did not succeed')
  const profilerConfig = environment.profiler
  if (!same(profilerConfig, PHASE2C26A8_PROFILER)) failures.push('the profiler window / sampling interval is not the registered one')
  if (environment.childHeapLimitMb !== PHASE2C26A8_CHILD_HEAP_MB || environment.concurrency !== PHASE2C26A8_CONCURRENCY
    || environment.orientationBudgetMs !== PHASE2C26A8_ORIENTATION_BUDGET_MS || environment.heartbeatIntervalMs !== PHASE2C26A8_HEARTBEAT_INTERVAL_MS) {
    failures.push('run environment is not the registered heap / concurrency 1 / budget / heartbeat')
  }
  if (!same(environment.nodeFlags, PHASE2C26A8_PRIMARY_NODE_FLAGS)) failures.push('primary Node flags are not the registered ones')
  if (!same(environment.diagnosticNodeFlags, PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS)) failures.push('diagnostic Node flags are not the registered ones')

  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions : null
  let conditionParity = null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A8ConditionParity({ ...current, nodeFlags: asArray(environment.nodeFlags) as string[], searchInstrumentation },
      a7.conditions, a6.conditions, a5.conditions, a4.conditions, a3.conditions, c26a, a2.conditions)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `A8 condition parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const diagnostic = isObject(r.diagnostic) ? r.diagnostic : null
  const selection = validatePhase2C26A8Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean), a7, c26a)
  if (!selection.valid) failures.push('the profiled orientations are not exactly the A7 primary set')
  if (a7.primaryOrientationIds.length !== PHASE2C26A8_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')
  const expectedRepresentative = selectPhase2C26A8DiagnosticRepresentative(a7).representativeOrientationId
  const diagnosticRepresentative = { expected: expectedRepresentative, actual: diagnostic?.orientationId ?? null, matches: diagnostic?.orientationId === expectedRepresentative }
  if (!diagnosticRepresentative.matches) failures.push('the diagnostic did not run on the rule\'s representative')
  if (diagnostic !== null) {
    const conditions = isObject(diagnostic.task) && isObject(diagnostic.task.conditions) ? diagnostic.task.conditions : {}
    if (current && (!same(conditions.extent, current.extent) || !same(conditions.bounds, current.bounds))) failures.push('the diagnostic ran with other extent / bounds')
  }

  const recorded = isObject(environment.productionChange) ? environment.productionChange : null
  const recordedSinceA7 = recorded ? validatePhase2C26A8NoProductionChange(asArray(recorded.sinceA7MeasuredHead) as string[]) : null
  if (!recordedSinceA7) failures.push('the runner did not record the Production change since the A7 measured HEAD')
  else if (!recordedSinceA7.valid) failures.push('the runner recorded a Production calculation change since the A7 measured HEAD')
  if (recorded && recorded.a7MeasuredHead !== a7.measuredHead) failures.push('the runner recorded the Production change against another measured HEAD')
  const rederived = validatePhase2C26A8NoProductionChange(evidence.productionChangeSinceA7)
  if (!rederived.valid) failures.push('the re-derived Production change since the A7 measured HEAD is not empty')

  const recordIssues: Phase2C26A8FormalRunValidation['recordIssues'] = []
  const profiled = [...kernels.map(k => ({ k, variant: 'jit_default' })), ...(diagnostic ? [{ k: diagnostic, variant: 'no_inlining' }] : [])]
  for (const { k, variant } of profiled) {
    const id = `${variant}:${String(k.orientationId)}`
    if (k.variant !== variant) recordIssues.push({ id, issue: `variant is ${String(k.variant)}` })
    const flags = isObject(k.process) ? k.process.nodeFlags : null
    if (!same(flags, variant === 'jit_default' ? PHASE2C26A8_PRIMARY_NODE_FLAGS : PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS)) recordIssues.push({ id, issue: 'child Node flags differ' })
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
    for (const file of PHASE2C26A8_REQUIRED_SOURCE_FILES) if (required[file] !== true) recordIssues.push({ id, issue: `no source map for ${file}` })
    const window = isObject(capture.window) ? capture.window : {}
    if (window.error !== null) recordIssues.push({ id, issue: `profile window error ${String(window.error)}` })
    if (window.stoppedBy !== 'window') recordIssues.push({ id, issue: `profile stopped by ${String(window.stoppedBy)}` })
  }
  if (recordIssues.length > 0) failures.push('profile / record issues')

  if (!evidence.a7RawShaMatches) failures.push('the A7 raw run is not the one the A7 RESULT recorded')
  const workPrefix = evidence.workPrefix.map(({ orientationId, prefix }) => ({ orientationId, valid: prefix.valid, issues: prefix.issues, commonWorks: prefix.commonWorks }))
  if (!same(workPrefix.map(w => w.orientationId), a7.primaryOrientationIds)) failures.push('the work prefix comparison does not cover exactly the A7 primaries')
  for (const row of workPrefix) if (!row.valid) failures.push(`work prefix ${row.orientationId}: ${row.issues.join('; ')}`)
  const depthPrefix = evidence.depthPrefix.map(({ orientationId, prefix }) => ({ orientationId, valid: prefix.valid, issues: prefix.issues, commonDepths: prefix.commonDepths }))
  if (!same(depthPrefix.map(w => w.orientationId), a7.primaryOrientationIds)) failures.push('the held-aware depth prefix comparison does not cover exactly the A7 primaries')
  for (const row of depthPrefix) if (!row.valid) failures.push(`held-aware depth prefix ${row.orientationId}: ${row.issues.join('; ')}`)

  return { valid: failures.length === 0, failures, a4FormalRun: { valid: a4Run.valid, failures: a4Run.failures }, shaMatches, probeValid, profilerConfig, searchInstrumentation,
    nodeFlags: environment.nodeFlags, diagnosticNodeFlags: environment.diagnosticNodeFlags, conditionParity, selection, diagnosticRepresentative,
    productionChangeRecordedByRunner: recordedSinceA7, productionChangeRederived: rederived, a7RawShaMatches: evidence.a7RawShaMatches, workPrefix, depthPrefix, recordIssues }
}
