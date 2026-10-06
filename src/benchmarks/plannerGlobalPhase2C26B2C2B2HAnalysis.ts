/**
 * Issue #154 Phase 2-C2.6-B2-C2B2H post-hoc analysis only: CPU attribution inside the held-aware `state_generation` section.
 * Research only. Never import from Production.
 *
 * Pure functions over one V8 CPU profile (`Profiler.stop` result), the child's script table (scriptId -> url, inline source maps),
 * the profile window (both clocks read around `Profiler.start` / `Profiler.stop`, A5's alignment), the durable section stream the
 * child wrote (one `gogma_boundary` record per held-aware boundary, Research clock) and B2-C2B2G's durable profile snapshots:
 *
 * - the `state_generation` intervals, rebuilt from the section stream: each is [its `phase_started`, its `phase_completed`) on the
 *   Research clock. Sequence gaps, unknown records, reversed time, a phase outside its depth, out of the registered order, started
 *   twice or completed without its start, a depth closed with an open phase, and overlapping intervals fail closed;
 * - the population: only samples whose Research time falls inside a rebuilt interval;
 * - the pre-registered stack-aware classification and the pre-registered decision rule over the ACTIVE samples (the interval samples
 *   less the explicit `(idle)` ones; `(program)` is never re-classified as Repository CPU and is reported on its own);
 * - descriptive line ticks (`positionTicks`) of the registered functions, whole profile, source-mapped, with the `state_generation`
 *   sub-block of each `generateReservedDepth()` line.
 *
 * Every rule here is fixed before the formal run. TurboFan / Maglev may inline a callee without restoring its frame, and V8 folds
 * builtins (Set has, Array find / push / sort, iteration) into the calling frame, so the owner category is named `_or_inlined`;
 * nothing here claims "Set.has cost" or "find cost" from a caller frame or a caller line. The Research yield wait inside
 * `state_generation` (setImmediate) is wall time, measured by B2-C2B2G's yield wrapper; it is never counted as checkpoint CPU.
 */
import { stableStringify } from '../domain/models/hashing'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimePhase } from '../domain/search/bonusStream'
import type { Phase2C26A3DepthRecord } from './plannerGlobalPhase2C26A3'
import type { Phase2C26A5ProfileWindow } from './plannerGlobalPhase2C26A5'
import {
  phase2c26a5SampleTimesUs,
  validatePhase2C26A5ClockAlignment,
  validatePhase2C26A5CpuProfile,
  type CpuProfile,
  type CpuProfileCallFrame,
  type Phase2C26A5ClockAlignment,
  type Phase2C26A5ScriptTable,
} from './plannerGlobalPhase2C26A5Analysis'
import { phase2c26b2c2b2fConditionIssues } from './plannerGlobalPhase2C26B2C2B2FAnalysis'
import { phase2c26b2c2b2dEvidenceGrade } from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import { phase2c26b2c2b2gCollectDepthRecords, phase2c26b2c2b2gInnerObservation } from './plannerGlobalPhase2C26B2C2B2GAnalysis'
import type { Phase2C26B2C2B2GProfileSnapshot } from './plannerGlobalPhase2C26B2C2B2G'
import {
  verifyPhase2C26B2C2B2HStartAttestation,
  PHASE2C26B2C2B2H_BUDGET_MS,
  PHASE2C26B2C2B2H_CPU_PROFILER,
  PHASE2C26B2C2B2H_NODE_FLAGS,
  PHASE2C26B2C2B2H_SECTION,
  type Phase2C26B2C2B2HAttestationExpectation,
} from './plannerGlobalPhase2C26B2C2B2H'
import {
  phase2c26b2c2b2hFrameLabel,
  resolvePhase2C26B2C2B2HFrame,
  PHASE2C26B2C2B2H_FUNCTION_REGISTRY,
  PHASE2C26B2C2B2H_PREDICTION_DIRECTORY,
  type Phase2C26B2C2B2HBlock,
  type Phase2C26B2C2B2HFrame,
  type Phase2C26B2C2B2HFunctionSpan,
} from './plannerGlobalPhase2C26B2C2B2HCpuProfile'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- registered rule (fixed before the formal run)

export const PHASE2C26B2C2B2H_DOMINANT_THRESHOLD = 0.5
export const PHASE2C26B2C2B2H_SECONDARY_THRESHOLD = 0.2
export const PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS = 300_000
export const PHASE2C26B2C2B2H_MIN_STATE_GENERATION_SAMPLES = 1_000
export const PHASE2C26B2C2B2H_MAX_NEGATIVE_TIME_DELTAS = 0
/** At or above this share of the active samples unattributed (observer overhead + program + other), the attribution is insufficient. */
export const PHASE2C26B2C2B2H_MAX_UNATTRIBUTED_ACTIVE_SHARE = 0.5
/** Only floating point rounding of the Research clock stamps. */
export const PHASE2C26B2C2B2H_INTERVAL_TOLERANCE_MS = 1e-6

export const PHASE2C26B2C2B2H_CATEGORIES = ['generation_owner_or_inlined', 'reset_prediction', 'keep_prediction', 'gogma_prediction_shared', 'state_construction_family_layout',
  'counter_advance', 'checkpoint_cpu', 'gc', 'observer_overhead', 'program', 'idle', 'other_state_generation'] as const
export type Phase2C26B2C2B2HCategory = typeof PHASE2C26B2C2B2H_CATEGORIES[number]
/** The categories a decision can name (a hotspot of state_generation code, or GC). */
export const PHASE2C26B2C2B2H_HOTSPOT_CATEGORIES: readonly Phase2C26B2C2B2HCategory[] = ['generation_owner_or_inlined', 'reset_prediction', 'keep_prediction', 'gogma_prediction_shared',
  'state_construction_family_layout', 'counter_advance', 'checkpoint_cpu', 'gc']
/** Active samples the classification cannot attribute to state_generation code. */
export const PHASE2C26B2C2B2H_UNATTRIBUTED_CATEGORIES: readonly Phase2C26B2C2B2HCategory[] = ['observer_overhead', 'program', 'other_state_generation']

export type Phase2C26B2C2B2HOtherReason = 'native_or_node_internal' | 'vite_loader' | 'other_repository' | 'dependency' | 'other'

export const PHASE2C26B2C2B2H_CATEGORY_RULES: readonly { priority: number; category: Phase2C26B2C2B2HCategory; rule: string }[] = [
  { priority: 1, category: 'gc', rule: 'the stack contains the V8 "(garbage collector)" frame' },
  { priority: 2, category: 'idle', rule: 'the leaf is the V8 "(idle)" frame (excluded from the active denominator)' },
  { priority: 3, category: 'program', rule: 'the leaf is "(program)" or "(root)": V8 / native work without a JavaScript stack, never re-classified as Repository CPU' },
  { priority: 4, category: 'observer_overhead', rule: 'a Research harness frame (src/benchmarks/, scripts/) is deeper than every Repository frame (the two observers, B2-C2B2G\'s profiler, the section stream write, the yield wrapper and the runner timers / snapshots / memory sampling)' },
  { priority: 5, category: 'checkpoint_cpu', rule: 'a SearchExecutionContext.checkpoint frame (searchExecution.ts): its cancellation check and counter; the setImmediate wait it awaits is not CPU and is measured as yield wall time' },
  { priority: 6, category: 'reset_prediction', rule: 'a Reset-only prediction frame: predictReset (bonusStream.ts), predictProductionGogmaReset / predictProductionGogmaResetSlotsFromRawValues (gogmaPrediction.ts), productionGogmaResetCandidatesForWeaponAndElement / buildProductionWeightedGogmaResetPool (gameGogmaBonuses.ts), and whatever they call' },
  { priority: 7, category: 'keep_prediction', rule: 'a Keep-only prediction frame: predictKeep (bonusStream.ts, its memo key and lookup included), predictReferenceGogmaKeep / requireReferenceKeepFamily, hasKeepMaster / hasUnreadableKeepFamily, keepCurrentBonusFamily / toReferenceKeepCurrentBonus(es), and whatever they call' },
  { priority: 8, category: 'gogma_prediction_shared', rule: 'a prediction frame both operations reach (predictGogmaBonus, getPredictionSupport, requireSupport, normalizedBaseSeed, referenceGogmaBlock, predictReferenceGogmaSlots, requireNonNegativeSafeInteger) or any other src/domain/rng/production/ frame, without a Reset-only / Keep-only frame (the operation is not separable then)' },
  { priority: 9, category: 'counter_advance', rule: 'an advanceGogmaCounter / advanceOneCounter / validateCounter frame (productionRngEngine.ts)' },
  { priority: 10, category: 'state_construction_family_layout', rule: 'a reservedGeneratedState (bonusStream.ts) or keepFamilyLayoutKey / keepFamilyLayout / keepFamilyOfBonus / keepFamilyBonusTypeId (gogmaBonusFamily.ts, their map / find callbacks included) frame' },
  { priority: 11, category: 'generation_owner_or_inlined', rule: 'the leaf is generateReservedDepth (by name, or an anonymous closure in its span: the Reset parent find predicate, the position sort comparator), or a native leaf whose nearest non-native ancestor is it: the sorted position loop, the Reset parent lookup, the position x frontier Keep scan, windows[index].has, array iteration / push and anything JIT-inlined into it. Never "Set.has cost" or "find cost" on its own' },
  { priority: 12, category: 'other_state_generation', rule: 'anything else inside a state_generation interval (a native / Node internal leaf outside the owner such as the event loop turn of a yield, a Vite SSR loader frame, an unregistered Repository frame, a dependency)' },
]

export const PHASE2C26B2C2B2H_DECISION_CASES = ['B2C2B2H_INVALID', 'B2C2B2H_INSUFFICIENT', 'B2C2B2H_GENERATION_OWNER_DOMINANT', 'B2C2B2H_RESET_PREDICTION_DOMINANT',
  'B2C2B2H_KEEP_PREDICTION_DOMINANT', 'B2C2B2H_GOGMA_PREDICTION_SHARED_DOMINANT', 'B2C2B2H_STATE_CONSTRUCTION_DOMINANT', 'B2C2B2H_COUNTER_ADVANCE_DOMINANT',
  'B2C2B2H_CHECKPOINT_CPU_DOMINANT', 'B2C2B2H_GC_DOMINANT', 'B2C2B2H_MIXED'] as const
export type Phase2C26B2C2B2HDecisionCase = typeof PHASE2C26B2C2B2H_DECISION_CASES[number]
const DOMINANT_CASE: Partial<Record<Phase2C26B2C2B2HCategory, Phase2C26B2C2B2HDecisionCase>> = {
  generation_owner_or_inlined: 'B2C2B2H_GENERATION_OWNER_DOMINANT', reset_prediction: 'B2C2B2H_RESET_PREDICTION_DOMINANT', keep_prediction: 'B2C2B2H_KEEP_PREDICTION_DOMINANT',
  gogma_prediction_shared: 'B2C2B2H_GOGMA_PREDICTION_SHARED_DOMINANT', state_construction_family_layout: 'B2C2B2H_STATE_CONSTRUCTION_DOMINANT', counter_advance: 'B2C2B2H_COUNTER_ADVANCE_DOMINANT',
  checkpoint_cpu: 'B2C2B2H_CHECKPOINT_CPU_DOMINANT', gc: 'B2C2B2H_GC_DOMINANT',
}

export const PHASE2C26B2C2B2H_DECISION_RULE = {
  population: 'CPU samples whose Research time lies inside a state_generation interval rebuilt from the durable section stream ([phase_started, phase_completed) of this run itself)',
  denominator: 'active CPU samples = state_generation interval samples - explicit "(idle)" samples; "(program)", GC, observer overhead and other stay in the denominator and are reported on their own. The all-interval-sample shares are reported beside them',
  invalid: 'B2C2B2H_INVALID: an authority / population / Search input identity / excluded Route / hash chain / provenance / registered condition issue, or a semantic parity failure of the held-aware depth records against B2-C2B2G\'s formal run',
  insufficient: `B2C2B2H_INSUFFICIENT: an unusable capture (no profile / script table / required source map, a profiler error, a window not stopped by the registered stop or by the Search end), an invalid clock alignment, any negative timeDelta, an invalid interval reconstruction (gap, unknown record, reversed time, missing boundary, overlap, an open interval inside the profile), a profile shorter than ${PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS} ms, fewer than ${PHASE2C26B2C2B2H_MIN_STATE_GENERATION_SAMPLES} state_generation interval samples, a span derivation failure, a named registered frame not resolving to its declaration line, a Search / inner tracker contract violation or section stream write failure, or an unattributed active share >= ${PHASE2C26B2C2B2H_MAX_UNATTRIBUTED_ACTIVE_SHARE}`,
  dominant: `B2C2B2H_<CATEGORY>_DOMINANT: one hotspot category (${PHASE2C26B2C2B2H_HOTSPOT_CATEGORIES.join(', ')}) has an active share >= ${PHASE2C26B2C2B2H_DOMINANT_THRESHOLD}`,
  mixed: `B2C2B2H_MIXED: valid, no hotspot category >= ${PHASE2C26B2C2B2H_DOMINANT_THRESHOLD}; the next phase takes the (at most 2) largest hotspot categories >= ${PHASE2C26B2C2B2H_SECONDARY_THRESHOLD}`,
  secondary: `every other hotspot category with an active share >= ${PHASE2C26B2C2B2H_SECONDARY_THRESHOLD} is reported as secondary`,
  lineTicks: 'descriptive only (whole profile, self ticks of the registered functions, source-mapped); never a decision input, never a claim about an inlined callee from a caller line',
  yieldWait: 'the Research yield wait inside state_generation is wall time (B2-C2B2G\'s wrapper), reported beside the CPU shares and never counted as checkpoint CPU',
  runtime: 'nothing is compared numerically with B2-C2B2G (wall, depth / s, generated states / s, yields / s, heap): the CPU profiler changes the runtime; only the sample shares of this run are evidence',
} as const

export const PHASE2C26B2C2B2H_NEXT_PHASE: Record<Phase2C26B2C2B2HDecisionCase, string> = {
  B2C2B2H_INVALID: '計測を無効扱いにし、原因を修正して同じprofilingをやり直す（条件は変えない）',
  B2C2B2H_INSUFFICIENT: 'profiling quality（clock alignment、interval再構築、sample数、source map / frame解決、attribution）を先に改善する。optimizationへ進まない',
  B2C2B2H_GENERATION_OWNER_DOMINANT: 'JIT inlineによりposition loop / Reset parent lookup / frontier scan / windows.has等を関数単位で分離できていない可能性が高い。まずline ticksを確認し、line attributionでも不十分ならA5 / A8型のno-inlining diagnosticを1回だけ次Phaseで検討する（自動実行しない）',
  B2C2B2H_RESET_PREDICTION_DOMINANT: 'Reset RNG prediction（predictReset memo、predictProductionGogmaReset、weighted pool / draw）を詳細化する',
  B2C2B2H_KEEP_PREDICTION_DOMINANT: 'predictKeep / Production Gogma Keep prediction（memo key生成とlookup、Keep family解決、reference Keep draw）を詳細化する',
  B2C2B2H_GOGMA_PREDICTION_SHARED_DOMINANT: 'predictGogmaBonusの共有部分（normalizedBaseSeed、support再判定、reference block / slot draw）を詳細化する',
  B2C2B2H_STATE_CONSTRUCTION_DOMINANT: 'reservedGeneratedState / keepFamilyLayoutKey / allocation系を詳細化する',
  B2C2B2H_COUNTER_ADVANCE_DOMINANT: 'advanceGogmaCounter（validateCounter / safe integer check）を詳細化する',
  B2C2B2H_CHECKPOINT_CPU_DOMINANT: 'checkpoint自身のCPUとyield wallを分け、checkpoint頻度 / cancellation check等を検討する',
  B2C2B2H_GC_DOMINANT: 'allocation profilingを次Phase候補にする',
  B2C2B2H_MIXED: '>= 20 %のhotspot categoryを最大2つ選び、次Phaseでそれぞれ絞る',
}

// ---------------------------------------------------------------- state_generation intervals (durable section stream)

export interface Phase2C26B2C2B2HInterval {
  streamIndex: number
  depth: number
  /** Research clock (the child's `performance.now()`), ms. */
  startMs: number
  endMs: number
  generatedStates: number | null
}

export interface Phase2C26B2C2B2HIntervalReconstruction {
  valid: boolean
  issues: string[]
  intervals: Phase2C26B2C2B2HInterval[]
  /** A section start whose completion the stream never reached (a budget kill inside it). */
  openInterval: { streamIndex: number; depth: number; startMs: number } | null
  records: number
  depthsCompleted: number
  phaseCompletions: Record<ReservedGogmaRuntimePhase, number>
}

/**
 * Rebuilds the intervals of one held-aware section from the durable `gogma_boundary` records. Fails closed (keeping the intervals
 * it did rebuild) on an unknown record, a sequence not contiguous from 1, a non-finite or decreasing time, a depth started while
 * another is open or closed while a phase is open, a phase outside its depth, out of the registered order, started twice in one
 * depth or completed without its start, and overlapping intervals. An open interval at the end of the stream is reported, not an
 * issue (the analysis decides whether it lies inside the profile).
 */
export function reconstructPhase2C26B2C2B2HIntervals(records: readonly unknown[], section: ReservedGogmaRuntimePhase = PHASE2C26B2C2B2H_SECTION,
  tolerance = PHASE2C26B2C2B2H_INTERVAL_TOLERANCE_MS): Phase2C26B2C2B2HIntervalReconstruction {
  const issues: string[] = []
  const issue = (message: string) => { if (issues.length < 50) issues.push(message) }
  const intervals: Phase2C26B2C2B2HInterval[] = []
  const phaseCompletions = Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(p => [p, 0])) as Record<ReservedGogmaRuntimePhase, number>
  const known = records.filter((r): r is Json => isObject(r) && r.kind === 'gogma_boundary')
  if (known.length !== records.length) issue('an unknown section stream record')
  const ordered = [...known].sort((a, b) => (num(a.seq) ?? -1) - (num(b.seq) ?? -1))
  if (ordered.some((r, i) => r.seq !== i + 1)) issue('the section stream sequence is not contiguous from 1')
  const phaseIndex = (phase: unknown) => RESERVED_GOGMA_RUNTIME_PHASES.indexOf(phase as ReservedGogmaRuntimePhase)
  let depth: { streamIndex: number; depth: number; lastPhase: number } | null = null
  let phase: { phase: ReservedGogmaRuntimePhase; streamIndex: number; depth: number; startMs: number } | null = null
  let lastAt = -Infinity
  let depthsCompleted = 0
  for (const r of ordered) {
    const at = num(r.atMs), streamIndex = num(r.streamIndex) ?? -1, d = num(r.depth) ?? -1
    const where = `seq ${String(r.seq)} s${streamIndex}/d${d} ${String(r.type)}${r.phase ? ` ${String(r.phase)}` : ''}`
    if (at === null) { issue(`${where}: time is not finite`); continue }
    if (at < lastAt - tolerance) issue(`${where}: time goes back (reversed boundary)`)
    lastAt = Math.max(lastAt, at)
    const sameDepth = depth !== null && depth.streamIndex === streamIndex && depth.depth === d
    switch (r.type) {
      case 'depth_started':
        if (depth !== null) issue(`${where}: started while s${depth.streamIndex}/d${depth.depth} is open (missing depth completion)`)
        if (phase !== null) { issue(`${where}: started while ${phase.phase} is open (missing boundary)`); phase = null }
        depth = { streamIndex, depth: d, lastPhase: -1 }
        break
      case 'phase_started': {
        const index = phaseIndex(r.phase)
        if (index < 0) { issue(`${where}: unknown phase`); break }
        if (!sameDepth) issue(`${where}: phase outside its depth (missing boundary / depth mismatch)`)
        if (phase !== null) issue(`${where}: started while ${phase.phase} is open (missing boundary)`)
        if (depth !== null && sameDepth) {
          if (index === depth.lastPhase) issue(`${where}: duplicate phase start`)
          else if (index < depth.lastPhase) issue(`${where}: phase order`)
          depth.lastPhase = index
        }
        phase = { phase: r.phase as ReservedGogmaRuntimePhase, streamIndex, depth: d, startMs: at }
        break
      }
      case 'phase_completed': {
        if (phase === null || phase.phase !== r.phase || phase.streamIndex !== streamIndex || phase.depth !== d) {
          issue(`${where}: completed without its start (missing boundary)`)
          phase = null
          break
        }
        if (at < phase.startMs - tolerance) issue(`${where}: negative duration`)
        phaseCompletions[phase.phase] += 1
        if (phase.phase === section) intervals.push({ streamIndex, depth: d, startMs: phase.startMs, endMs: at, generatedStates: num(r.generatedStates) })
        phase = null
        break
      }
      case 'depth_completed':
        if (!sameDepth) issue(`${where}: completed without its start (missing boundary / depth mismatch)`)
        if (phase !== null) { issue(`${where}: completed while ${phase.phase} is open (missing boundary)`); phase = null }
        depth = null
        depthsCompleted += 1
        break
      default:
        issue(`${where}: unknown boundary type`)
    }
  }
  const openInterval = phase !== null && phase.phase === section ? { streamIndex: phase.streamIndex, depth: phase.depth, startMs: phase.startMs } : null
  intervals.sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < intervals.length; i += 1) if (intervals[i]!.startMs < intervals[i - 1]!.endMs - tolerance) issue(`interval ${i} overlaps the previous one`)
  if (openInterval !== null && intervals.length > 0 && openInterval.startMs < intervals.at(-1)!.endMs - tolerance) issue('the open interval overlaps a closed one')
  return { valid: issues.length === 0, issues, intervals, openInterval, records: records.length, depthsCompleted, phaseCompletions }
}

// ---------------------------------------------------------------- stack classification

const isNative = (frame: Phase2C26B2C2B2HFrame) => frame.kind === 'native'
const isRepositoryFrame = (frame: Phase2C26B2C2B2HFrame) => frame.kind === 'repository' || frame.kind === 'vite_ssr_unmapped'

export interface Phase2C26B2C2B2HClassification {
  category: Phase2C26B2C2B2HCategory
  otherReason: Phase2C26B2C2B2HOtherReason | null
  /** Descriptive detail of an owner sample: `self`, `closure:<line>` (anonymous by span) or `native:<name>`. */
  ownerDetail: string | null
}

/** The registered category of one sampled stack (outermost first). */
export function classifyPhase2C26B2C2B2HStack(stack: readonly Phase2C26B2C2B2HFrame[]): Phase2C26B2C2B2HClassification {
  const result = (category: Phase2C26B2C2B2HCategory, otherReason: Phase2C26B2C2B2HOtherReason | null = null, ownerDetail: string | null = null) => ({ category, otherReason, ownerDetail })
  if (stack.some(frame => frame.kind === 'gc')) return result('gc')
  const leaf = stack.at(-1)
  if (leaf === undefined) return result('other_state_generation', 'other')
  if (leaf.kind === 'idle') return result('idle')
  if (leaf.kind === 'program' || leaf.kind === 'root') return result('program')
  let deepestResearch = -1, deepestRepository = -1
  stack.forEach((frame, index) => {
    if (frame.kind === 'research_harness') deepestResearch = index
    if (isRepositoryFrame(frame)) deepestRepository = index
  })
  if (deepestResearch >= 0 && deepestResearch > deepestRepository) return result('observer_overhead')
  const has = (role: Phase2C26B2C2B2HFrame['role']) => stack.some(frame => frame.role === role)
  if (has('checkpoint')) return result('checkpoint_cpu')
  if (has('reset_prediction')) return result('reset_prediction')
  if (has('keep_prediction')) return result('keep_prediction')
  if (has('prediction_shared') || stack.some(frame => frame.role === null && frame.file.startsWith(PHASE2C26B2C2B2H_PREDICTION_DIRECTORY))) return result('gogma_prediction_shared')
  if (has('counter_advance')) return result('counter_advance')
  if (has('state_construction')) return result('state_construction_family_layout')
  if (leaf.role === 'owner') return result('generation_owner_or_inlined', null, leaf.byName ? 'self' : `closure:${String(leaf.originalLine)}`)
  if (isNative(leaf)) {
    let nearest: Phase2C26B2C2B2HFrame | undefined
    for (let index = stack.length - 1; index >= 0; index -= 1) if (!isNative(stack[index]!)) { nearest = stack[index]; break }
    if (nearest?.role === 'owner') return result('generation_owner_or_inlined', null, `native:${leaf.functionName || '(anonymous)'}`)
    return result('other_state_generation', 'native_or_node_internal')
  }
  if (leaf.kind === 'node_internal') return result('other_state_generation', 'native_or_node_internal')
  if (leaf.kind === 'vite_module_runner' || leaf.kind === 'vite_ssr_unmapped') return result('other_state_generation', 'vite_loader')
  if (leaf.kind === 'repository') return result('other_state_generation', 'other_repository')
  if (leaf.kind === 'dependency') return result('other_state_generation', 'dependency')
  return result('other_state_generation', 'other')
}

// ---------------------------------------------------------------- one profile

interface PositionTicksNode { id: number; callFrame: CpuProfileCallFrame; positionTicks?: unknown; children?: number[] }

export interface Phase2C26B2C2B2HCount { category: Phase2C26B2C2B2HCategory; samples: number; shareOfActive: number | null; shareOfInterval: number | null }

export interface Phase2C26B2C2B2HLineTicks {
  registered: string
  totalSelfTicks: number
  unmappedTicks: number
  /** Ticks by source-mapped original line inside the function's span, with the line text and (owner only) its state_generation sub-block. */
  inSpan: { line: number; text: string; ticks: number; subBlock: string | null }[]
  /** Ticks mapped outside the span, by the registered function of the same file whose span holds the line (code inlined into this one), or `unregistered`. */
  outsideSpan: { into: string; ticks: number }[]
}

export interface Phase2C26B2C2B2HProfileAnalysis {
  alignment: Phase2C26A5ClockAlignment
  intervalValidation: { valid: boolean; issues: string[]; count: number; openIntervalInsideProfile: boolean }
  allProfileSamples: number
  windowSamples: number
  observedIntervalUs: { median: number | null; mean: number | null }
  intervalsInProfile: number
  partialIntervalsInProfile: number
  intervalMsInProfile: number
  intervalShareOfProfile: number | null
  intervalSamples: number
  idleSamples: number
  activeSamples: number
  programSamples: number
  gcSamples: number
  idleShareOfInterval: number | null
  /** idle + program (the user-facing `idle_or_program` view) over all interval samples. */
  idleOrProgramShareOfInterval: number | null
  programShareOfActive: number | null
  gcShareOfActive: number | null
  /** observer overhead + program + other, of the active samples. */
  unattributedActiveShare: number | null
  categories: Phase2C26B2C2B2HCount[]
  otherReasons: { reason: Phase2C26B2C2B2HOtherReason; samples: number; shareOfActive: number | null }[]
  ownerDetails: { detail: string; samples: number; shareOfActive: number | null }[]
  leafKinds: { kind: string; samples: number; shareOfInterval: number | null }[]
  /** Active samples with generateReservedDepth anywhere on the stack (descriptive). */
  ownerOnStackActiveShare: number | null
  topFunctions: { function: string; samples: number; shareOfActive: number | null }[]
  topLeaves: { leaf: string; category: Phase2C26B2C2B2HCategory; samples: number; shareOfActive: number | null }[]
  topStacks: { stack: string; category: Phase2C26B2C2B2HCategory; samples: number; shareOfActive: number | null }[]
  registeredInclusive: { registered: string; role: string; samples: number; shareOfActive: number | null }[]
  /** Samples within the boundary tolerance (1 ms + the clock offset spread) of an interval start / end (descriptive). */
  boundaryNearSamples: number
  /** reservedGeneratedState runs only inside state_generation: its samples inside / outside the intervals (descriptive alignment sanity). */
  stateGenerationOnlySamples: { inside: number; outside: number }
  /** A named registered frame whose source-mapped start is not its declaration line (a resolution failure). */
  registeredLineMismatches: string[]
  /** Source-map resolution over every profile node: Repository (src/) frames with / without an original line, and the named registered ones. */
  sourceMapResolution: { repositoryNodes: number; mappedNodes: number; unmappedNodes: number; registeredNamedNodes: number; registeredAnonymousNodes: number }
  lineTicks: Phase2C26B2C2B2HLineTicks[]
  /** The owner's self line ticks summed by state_generation sub-block (descriptive). */
  ownerSubBlockTicks: { subBlock: string; ticks: number }[]
  workInWindow: { intervals: number; partialIntervals: number; generatedStates: number }
}

function lastStartAtOrBefore(starts: Float64Array, t: number): number {
  let lo = 0, hi = starts.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid]! <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

function positionTicksOf(node: PositionTicksNode): { line: number; ticks: number }[] {
  return asArray(node.positionTicks).filter(isObject).flatMap(t => (num(t.line) !== null && num(t.ticks) !== null ? [{ line: t.line as number, ticks: t.ticks as number }] : []))
}

/** Structural validation of an untrusted profile, including the optional `positionTicks` shape (A5's checks plus that). */
export function validatePhase2C26B2C2B2HCpuProfile(json: unknown): CpuProfile {
  const profile = validatePhase2C26A5CpuProfile(json)
  for (const node of profile.nodes as PositionTicksNode[]) {
    if (node.positionTicks === undefined) continue
    if (!Array.isArray(node.positionTicks) || node.positionTicks.some(t => !isObject(t) || num(t.line) === null || num(t.ticks) === null)) {
      throw new Error(`Invalid CPU profile: node ${node.id} has malformed positionTicks.`)
    }
  }
  return profile
}

/**
 * Classifies one CPU profile's samples inside the rebuilt `state_generation` intervals. When the clock alignment or the interval
 * reconstruction is not valid, no sample is mapped (`intervalSamples = 0`) and the profile is no evidence.
 */
export function analyzePhase2C26B2C2B2HProfile(profile: CpuProfile, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26B2C2B2HFunctionSpan[],
  sourceTexts: Readonly<Record<string, string>>, block: Phase2C26B2C2B2HBlock,
  window: Pick<Phase2C26A5ProfileWindow, 'startPre' | 'startPost' | 'stopPre' | 'stopPost'>, reconstruction: Phase2C26B2C2B2HIntervalReconstruction): Phase2C26B2C2B2HProfileAnalysis {
  const alignment = validatePhase2C26A5ClockAlignment(profile, window)
  const intervals = reconstruction.intervals
  const openInside = reconstruction.openInterval !== null && alignment.researchProfileEndMs !== null && reconstruction.openInterval.startMs < alignment.researchProfileEndMs
  const intervalIssues = [...reconstruction.issues, ...(openInside ? ['an open (never completed) state_generation interval starts inside the profile window'] : [])]
  const intervalValidation = { valid: intervalIssues.length === 0, issues: intervalIssues.slice(0, 20), count: intervals.length, openIntervalInsideProfile: openInside }
  const { timesUs } = phase2c26a5SampleTimesUs(profile)
  const deltas = profile.timeDeltas.filter(d => d >= 0).sort((a, b) => a - b)
  const observedIntervalUs = { median: deltas.length === 0 ? null : deltas[Math.floor(deltas.length / 2)]!, mean: deltas.length === 0 ? null : deltas.reduce((a, b) => a + b, 0) / deltas.length }

  const nodes = new Map(profile.nodes.map(node => [node.id, node as PositionTicksNode]))
  const parent = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const frameMemo = new Map<number, Phase2C26B2C2B2HFrame>()
  const frameOf = (id: number) => {
    let frame = frameMemo.get(id)
    if (!frame) { frame = resolvePhase2C26B2C2B2HFrame(nodes.get(id)!.callFrame, scripts, spans); frameMemo.set(id, frame) }
    return frame
  }
  const stackMemo = new Map<number, Phase2C26B2C2B2HFrame[]>()
  const stackOf = (leafId: number) => {
    let stack = stackMemo.get(leafId)
    if (!stack) {
      stack = []
      for (let id: number | undefined = leafId; id !== undefined; id = parent.get(id)) stack.unshift(frameOf(id))
      stackMemo.set(leafId, stack)
    }
    return stack
  }
  const classMemo = new Map<number, Phase2C26B2C2B2HClassification>()
  const classOf = (leafId: number) => {
    let c = classMemo.get(leafId)
    if (!c) { c = classifyPhase2C26B2C2B2HStack(stackOf(leafId)); classMemo.set(leafId, c) }
    return c
  }

  const usable = alignment.valid && intervalValidation.valid && alignment.offsetMs !== null
  const offset = alignment.offsetMs ?? 0
  const starts = new Float64Array(intervals.map(i => i.startMs)), ends = new Float64Array(intervals.map(i => i.endMs))
  const counts = new Map<Phase2C26B2C2B2HCategory, number>(PHASE2C26B2C2B2H_CATEGORIES.map(c => [c, 0]))
  const otherCounts = new Map<Phase2C26B2C2B2HOtherReason, number>()
  const ownerCounts = new Map<string, number>()
  const leafKinds = new Map<string, number>()
  const leaves = new Map<string, { category: Phase2C26B2C2B2HCategory; samples: number }>()
  const stacks = new Map<string, { category: Phase2C26B2C2B2HCategory; samples: number }>()
  const functions = new Map<string, number>()
  const inclusive = new Map<string, number>()
  let intervalSamples = 0, windowSamples = 0, boundaryNear = 0, ownerOnStack = 0, onlyInside = 0, onlyOutside = 0
  const tolerance = 1 + (alignment.offsetSpreadMs ?? 0)
  if (usable) {
    for (let i = 0; i < profile.samples.length; i += 1) {
      const t = timesUs[i]! / 1000 - offset
      if (alignment.researchProfileStartMs !== null && alignment.researchProfileEndMs !== null && t >= alignment.researchProfileStartMs && t <= alignment.researchProfileEndMs) windowSamples += 1
      const k = lastStartAtOrBefore(starts, t)
      const inside = k >= 0 && t < ends[k]!
      const leafId = profile.samples[i]!
      const stack = stackOf(leafId)
      const near = (j: number) => j >= 0 && j < starts.length && (Math.abs(t - starts[j]!) <= tolerance || Math.abs(t - ends[j]!) <= tolerance)
      if (near(k) || near(k + 1)) boundaryNear += 1
      const generationOnly = stack.some(frame => frame.registered !== null && frame.registered.endsWith('#reservedGeneratedState'))
      if (generationOnly) { if (inside) onlyInside += 1; else onlyOutside += 1 }
      if (!inside) continue
      intervalSamples += 1
      const { category, otherReason, ownerDetail } = classOf(leafId)
      counts.set(category, (counts.get(category) ?? 0) + 1)
      const leaf = stack.at(-1)!
      leafKinds.set(leaf.kind, (leafKinds.get(leaf.kind) ?? 0) + 1)
      if (category === 'idle') continue
      if (otherReason !== null) otherCounts.set(otherReason, (otherCounts.get(otherReason) ?? 0) + 1)
      if (ownerDetail !== null) ownerCounts.set(ownerDetail, (ownerCounts.get(ownerDetail) ?? 0) + 1)
      if (stack.some(frame => frame.role === 'owner')) ownerOnStack += 1
      const leafKey = phase2c26b2c2b2hFrameLabel(leaf)
      const leafEntry = leaves.get(leafKey) ?? { category, samples: 0 }
      leafEntry.samples += 1
      leaves.set(leafKey, leafEntry)
      const stackKey = stack.slice(-8).map(phase2c26b2c2b2hFrameLabel).join(' > ')
      const stackEntry = stacks.get(stackKey) ?? { category, samples: 0 }
      stackEntry.samples += 1
      stacks.set(stackKey, stackEntry)
      const seenFunctions = new Set<string>(), seenRegistered = new Set<string>()
      for (const frame of stack) {
        const label = `${frame.functionName || '(anonymous)'}@${frame.file || '-'}`
        if (!seenFunctions.has(label)) { seenFunctions.add(label); functions.set(label, (functions.get(label) ?? 0) + 1) }
        if (frame.registered !== null && !seenRegistered.has(frame.registered)) { seenRegistered.add(frame.registered); inclusive.set(frame.registered, (inclusive.get(frame.registered) ?? 0) + 1) }
      }
    }
  }
  const idle = counts.get('idle') ?? 0
  const active = intervalSamples - idle
  const ofActive = (n: number) => (active > 0 ? n / active : null)
  const ofInterval = (n: number) => (intervalSamples > 0 ? n / intervalSamples : null)
  let intervalsInProfile = 0, partial = 0, intervalMsInProfile = 0, generatedStates = 0
  if (alignment.researchProfileStartMs !== null && alignment.researchProfileEndMs !== null) {
    for (const interval of intervals) {
      const a = Math.max(interval.startMs, alignment.researchProfileStartMs), b = Math.min(interval.endMs, alignment.researchProfileEndMs)
      if (b <= a) continue
      intervalsInProfile += 1
      intervalMsInProfile += b - a
      generatedStates += interval.generatedStates ?? 0
      if (a > interval.startMs || b < interval.endMs) partial += 1
    }
  }

  // Registered frame resolution: a named registered frame must start on its declaration line.
  const mismatches = new Set<string>()
  const resolution = { repositoryNodes: 0, mappedNodes: 0, unmappedNodes: 0, registeredNamedNodes: 0, registeredAnonymousNodes: 0 }
  for (const node of profile.nodes) {
    const frame = frameOf(node.id)
    if (frame.file.startsWith('src/')) {
      resolution.repositoryNodes += 1
      if (frame.originalLine === null) resolution.unmappedNodes += 1
      else resolution.mappedNodes += 1
    }
    if (frame.registered !== null) {
      if (frame.byName) resolution.registeredNamedNodes += 1
      else resolution.registeredAnonymousNodes += 1
    }
    if (frame.registered === null || !frame.byName) continue
    const span = spans.find(s => `${s.file}#${s.functionName}` === frame.registered)
    if (span === undefined || frame.originalLine !== span.startLine) mismatches.add(`${frame.registered}@${String(frame.originalLine)} (declaration ${String(span?.startLine)})`)
  }

  // Descriptive, whole-profile self line ticks of the registered functions.
  const blockLabel = new Map(block.lines.map(l => [l.line, l.label]))
  const lineTicks: Phase2C26B2C2B2HLineTicks[] = []
  for (const entry of PHASE2C26B2C2B2H_FUNCTION_REGISTRY) {
    const registered = `${entry.file}#${entry.functionName}`
    const span = spans.find(s => s.file === entry.file && s.functionName === entry.functionName)
    const text = (sourceTexts[entry.file] ?? '').split(/\r?\n/)
    const byLine = new Map<number, number>()
    const outside = new Map<string, number>()
    let total = 0, unmapped = 0
    for (const node of profile.nodes as PositionTicksNode[]) {
      const frame = frameOf(node.id)
      if (frame.registered !== registered || !frame.byName) continue
      for (const tick of positionTicksOf(node)) {
        total += tick.ticks
        const line = scripts.originalLine(node.callFrame.scriptId, tick.line - 1, 0)
        if (line === null) { unmapped += tick.ticks; continue }
        if (span !== undefined && line >= span.startLine && line <= span.endLine) { byLine.set(line, (byLine.get(line) ?? 0) + tick.ticks); continue }
        const into = spans.find(s => s.file === entry.file && line >= s.startLine && line <= s.endLine)
        const key = into === undefined ? 'unregistered' : `${into.file}#${into.functionName}`
        outside.set(key, (outside.get(key) ?? 0) + tick.ticks)
      }
    }
    if (total === 0) continue
    const inSpan = [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([line, ticks]) => ({ line, text: (text[line - 1] ?? '').trim(), ticks,
      subBlock: entry.role === 'owner' && entry.file === block.file ? blockLabel.get(line) ?? null : null }))
    lineTicks.push({ registered, totalSelfTicks: total, unmappedTicks: unmapped, inSpan,
      outsideSpan: [...outside.entries()].map(([into, ticks]) => ({ into, ticks })).sort((a, b) => b.ticks - a.ticks || (a.into < b.into ? -1 : 1)) })
  }
  const owner = lineTicks.find(l => l.registered === `${block.file}#generateReservedDepth`)
  const subTicks = new Map<string, number>()
  for (const line of owner?.inSpan ?? []) if (line.subBlock !== null) subTicks.set(line.subBlock, (subTicks.get(line.subBlock) ?? 0) + line.ticks)

  const rank = <T extends { samples: number }>(entries: [string, T][], top: number) => entries.sort(([ka, a], [kb, b]) => b.samples - a.samples || (ka < kb ? -1 : 1)).slice(0, top)
  const roleOf = (registered: string) => PHASE2C26B2C2B2H_FUNCTION_REGISTRY.find(e => `${e.file}#${e.functionName}` === registered)?.role ?? 'unknown'
  const sum = (...categories: Phase2C26B2C2B2HCategory[]) => categories.reduce((total, c) => total + (counts.get(c) ?? 0), 0)
  return {
    alignment, intervalValidation, allProfileSamples: profile.samples.length, windowSamples, observedIntervalUs,
    intervalsInProfile, partialIntervalsInProfile: partial, intervalMsInProfile, intervalShareOfProfile: alignment.profileDurationMs > 0 ? intervalMsInProfile / alignment.profileDurationMs : null,
    intervalSamples, idleSamples: idle, activeSamples: active, programSamples: counts.get('program') ?? 0, gcSamples: counts.get('gc') ?? 0,
    idleShareOfInterval: ofInterval(idle), idleOrProgramShareOfInterval: ofInterval(idle + (counts.get('program') ?? 0)), programShareOfActive: ofActive(counts.get('program') ?? 0), gcShareOfActive: ofActive(counts.get('gc') ?? 0),
    unattributedActiveShare: ofActive(sum(...PHASE2C26B2C2B2H_UNATTRIBUTED_CATEGORIES)),
    categories: PHASE2C26B2C2B2H_CATEGORIES.map(category => ({ category, samples: counts.get(category) ?? 0,
      shareOfActive: category === 'idle' ? null : ofActive(counts.get(category) ?? 0), shareOfInterval: ofInterval(counts.get(category) ?? 0) })),
    otherReasons: [...otherCounts.entries()].map(([reason, samples]) => ({ reason, samples, shareOfActive: ofActive(samples) })).sort((a, b) => b.samples - a.samples || (a.reason < b.reason ? -1 : 1)),
    ownerDetails: rank([...ownerCounts.entries()].map(([k, samples]) => [k, { samples }] as [string, { samples: number }]), 25).map(([detail, e]) => ({ detail, samples: e.samples, shareOfActive: ofActive(e.samples) })),
    leafKinds: [...leafKinds.entries()].map(([kind, samples]) => ({ kind, samples, shareOfInterval: ofInterval(samples) })).sort((a, b) => b.samples - a.samples || (a.kind < b.kind ? -1 : 1)),
    ownerOnStackActiveShare: ofActive(ownerOnStack),
    topFunctions: rank([...functions.entries()].map(([k, samples]) => [k, { samples }] as [string, { samples: number }]), 30).map(([fn, e]) => ({ function: fn, samples: e.samples, shareOfActive: ofActive(e.samples) })),
    topLeaves: rank([...leaves.entries()], 30).map(([leaf, e]) => ({ leaf, category: e.category, samples: e.samples, shareOfActive: ofActive(e.samples) })),
    topStacks: rank([...stacks.entries()], 25).map(([stack, e]) => ({ stack, category: e.category, samples: e.samples, shareOfActive: ofActive(e.samples) })),
    registeredInclusive: [...inclusive.entries()].map(([registered, samples]) => ({ registered, role: roleOf(registered), samples, shareOfActive: ofActive(samples) }))
      .sort((a, b) => b.samples - a.samples || (a.registered < b.registered ? -1 : 1)),
    boundaryNearSamples: boundaryNear, stateGenerationOnlySamples: { inside: onlyInside, outside: onlyOutside },
    registeredLineMismatches: [...mismatches].sort(), sourceMapResolution: resolution, lineTicks,
    ownerSubBlockTicks: [...subTicks.entries()].map(([subBlock, ticks]) => ({ subBlock, ticks })).sort((a, b) => b.ticks - a.ticks || (a.subBlock < b.subBlock ? -1 : 1)),
    workInWindow: { intervals: intervalsInProfile, partialIntervals: partial, generatedStates },
  }
}

export const phase2c26b2c2b2hActiveShare = (analysis: Pick<Phase2C26B2C2B2HProfileAnalysis, 'categories'>, category: Phase2C26B2C2B2HCategory): number =>
  analysis.categories.find(c => c.category === category)?.shareOfActive ?? 0

// ---------------------------------------------------------------- profile quality (INSUFFICIENT reasons)

export interface Phase2C26B2C2B2HCaptureFacts {
  profileWritten: boolean
  scriptTableWritten: boolean
  requiredSourceMaps: Record<string, boolean>
  window: { stoppedBy: string | null; error: string | null; actualProfileDurationMs: number | null } | null
  spanDerivationError: string | null
  /** From the last B2-C2B2G snapshot of the run. */
  outerContractViolations: number | null
  innerContractViolations: number | null
  outsideReadViolations: number | null
  boundaryWriteFailures: number | null
}

/** The registered quality rules of one profile (each issue is an INSUFFICIENT reason). */
export function phase2c26b2c2b2hProfileQuality(capture: Phase2C26B2C2B2HCaptureFacts, analysis: Phase2C26B2C2B2HProfileAnalysis | null): string[] {
  const issues: string[] = []
  if (!capture.profileWritten) issues.push('no CPU profile was written')
  if (!capture.scriptTableWritten) issues.push('no script table was written')
  for (const [file, ok] of Object.entries(capture.requiredSourceMaps)) if (ok !== true) issues.push(`no source map for ${file}`)
  if (capture.window === null) issues.push('no profile window record')
  else {
    if (capture.window.error !== null) issues.push(`profile window error: ${capture.window.error}`)
    if (capture.window.stoppedBy !== 'window' && capture.window.stoppedBy !== 'kernel_ended') issues.push(`the profile was not stopped by the registered stop or the Search end (${String(capture.window.stoppedBy)})`)
    if (!(typeof capture.window.actualProfileDurationMs === 'number' && capture.window.actualProfileDurationMs >= PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS)) {
      issues.push(`the actual profile duration ${String(capture.window.actualProfileDurationMs)} ms is below ${PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS} ms`)
    }
  }
  if (capture.spanDerivationError !== null) issues.push(`span derivation: ${capture.spanDerivationError}`)
  for (const [name, value] of [['outer Search contract violations', capture.outerContractViolations], ['inner tracker contract violations', capture.innerContractViolations],
    ['inner boundaries outside an open bonus_depth_read', capture.outsideReadViolations], ['section stream write failures', capture.boundaryWriteFailures]] as const) {
    if (value !== 0) issues.push(`${name}: ${String(value)}`)
  }
  if (analysis === null) return [...issues, 'no profile analysis']
  if (!analysis.alignment.valid) issues.push(...analysis.alignment.issues.map(i => `clock: ${i}`))
  if (!(analysis.alignment.negativeDeltas <= PHASE2C26B2C2B2H_MAX_NEGATIVE_TIME_DELTAS)) issues.push(`CPU profile contains negative timeDeltas: ${analysis.alignment.negativeDeltas}`)
  if (!analysis.intervalValidation.valid) issues.push(...analysis.intervalValidation.issues.map(i => `intervals: ${i}`))
  if (!(analysis.alignment.profileDurationMs >= PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS)) issues.push(`the profile spans ${analysis.alignment.profileDurationMs} ms, below ${PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS} ms`)
  if (analysis.intervalSamples < PHASE2C26B2C2B2H_MIN_STATE_GENERATION_SAMPLES) issues.push(`state_generation interval samples ${analysis.intervalSamples} < ${PHASE2C26B2C2B2H_MIN_STATE_GENERATION_SAMPLES}`)
  if (analysis.registeredLineMismatches.length > 0) issues.push(`registered frame line mismatch: ${analysis.registeredLineMismatches.join(', ')}`)
  if (analysis.unattributedActiveShare !== null && analysis.unattributedActiveShare >= PHASE2C26B2C2B2H_MAX_UNATTRIBUTED_ACTIVE_SHARE) {
    issues.push(`the unattributed active share ${analysis.unattributedActiveShare.toFixed(4)} is >= ${PHASE2C26B2C2B2H_MAX_UNATTRIBUTED_ACTIVE_SHARE}`)
  }
  return issues
}

// ---------------------------------------------------------------- decision

export function phase2c26b2c2b2hDecision(input: { invalidReasons: readonly string[]; insufficientReasons: readonly string[]; analysis: Phase2C26B2C2B2HProfileAnalysis | null }) {
  const base = { scope: 'A profiling decision about where the CPU of the held-aware state_generation section goes for this one oracle-guided Search input on the current main (active CPU sample shares). It is never an optimization decision, never a Route exact judgement and never Production evidence.' }
  const empty = { dominant: null, dominantShareOfActive: null, secondary: [] as { category: Phase2C26B2C2B2HCategory; shareOfActive: number }[], nextPhaseCategories: [] as Phase2C26B2C2B2HCategory[] }
  if (input.invalidReasons.length > 0) return { ...base, case: 'B2C2B2H_INVALID' as Phase2C26B2C2B2HDecisionCase, reasons: [...input.invalidReasons], ...empty, nextPhase: PHASE2C26B2C2B2H_NEXT_PHASE.B2C2B2H_INVALID }
  const insufficient = [...input.insufficientReasons]
  const a = input.analysis
  if (a === null) insufficient.push('no profile analysis')
  if (insufficient.length > 0 || a === null) return { ...base, case: 'B2C2B2H_INSUFFICIENT' as Phase2C26B2C2B2HDecisionCase, reasons: insufficient, ...empty, nextPhase: PHASE2C26B2C2B2H_NEXT_PHASE.B2C2B2H_INSUFFICIENT }
  const ranked = [...PHASE2C26B2C2B2H_HOTSPOT_CATEGORIES].sort((x, y) => phase2c26b2c2b2hActiveShare(a, y) - phase2c26b2c2b2hActiveShare(a, x)
    || PHASE2C26B2C2B2H_HOTSPOT_CATEGORIES.indexOf(x) - PHASE2C26B2C2B2H_HOTSPOT_CATEGORIES.indexOf(y))
  const secondaryOf = (exclude: Phase2C26B2C2B2HCategory | null) => ranked.filter(c => c !== exclude && phase2c26b2c2b2hActiveShare(a, c) >= PHASE2C26B2C2B2H_SECONDARY_THRESHOLD)
    .map(category => ({ category, shareOfActive: phase2c26b2c2b2hActiveShare(a, category) }))
  const top = ranked[0]!
  if (phase2c26b2c2b2hActiveShare(a, top) >= PHASE2C26B2C2B2H_DOMINANT_THRESHOLD) {
    const caseId = DOMINANT_CASE[top]!
    return { ...base, case: caseId, reasons: [], dominant: top, dominantShareOfActive: phase2c26b2c2b2hActiveShare(a, top), secondary: secondaryOf(top), nextPhaseCategories: [top],
      nextPhase: PHASE2C26B2C2B2H_NEXT_PHASE[caseId] }
  }
  const secondary = secondaryOf(null)
  return { ...base, case: 'B2C2B2H_MIXED' as Phase2C26B2C2B2HDecisionCase, reasons: [], dominant: null, dominantShareOfActive: null, secondary,
    nextPhaseCategories: secondary.slice(0, 2).map(s => s.category), nextPhase: PHASE2C26B2C2B2H_NEXT_PHASE.B2C2B2H_MIXED }
}

// ---------------------------------------------------------------- yield wait (wall, B2-C2B2G's wrapper)

export interface Phase2C26B2C2B2HYieldWait {
  wholeRun: { stateGenerationWallMs: number; yieldCount: number; yieldWaitMs: number; stateGenerationYieldWaitShare: number | null }
  /** Differences of the cumulative snapshots bracketing the profile window (5 s granularity; descriptive). */
  profileWindow: { fromAtMs: number; toAtMs: number; stateGenerationWallMs: number; yieldCount: number; yieldWaitMs: number; stateGenerationYieldWaitShare: number | null } | null
}

/**
 * The Research yield wait inside `state_generation` from B2-C2B2G's snapshots: the whole run (last snapshot) and, when the profile
 * window is known on the snapshot clock (Research elapsed since the profiler origin), the snapshots bracketing it.
 */
export function phase2c26b2c2b2hYieldWait(snapshots: readonly Phase2C26B2C2B2GProfileSnapshot[], profileWindowAtMs: { fromMs: number; toMs: number } | null): Phase2C26B2C2B2HYieldWait | null {
  const last = snapshots.at(-1)
  if (last === undefined) return null
  const facts = (s: Phase2C26B2C2B2GProfileSnapshot) => {
    const slot = s.inner.yieldsByInnerSection[PHASE2C26B2C2B2H_SECTION] ?? { count: 0, totalMs: 0 }
    return { wallMs: phase2c26b2c2b2gInnerObservation(s).sectionMs[PHASE2C26B2C2B2H_SECTION], count: slot.count, waitMs: slot.totalMs }
  }
  const whole = facts(last)
  let profileWindow: Phase2C26B2C2B2HYieldWait['profileWindow'] = null
  if (profileWindowAtMs !== null) {
    const before = [...snapshots].reverse().find(s => s.atMs <= profileWindowAtMs.fromMs) ?? null
    const after = snapshots.find(s => s.atMs >= profileWindowAtMs.toMs) ?? null
    if (before !== null && after !== null) {
      const b = facts(before), e = facts(after)
      const wall = e.wallMs - b.wallMs, wait = e.waitMs - b.waitMs
      profileWindow = { fromAtMs: before.atMs, toAtMs: after.atMs, stateGenerationWallMs: wall, yieldCount: e.count - b.count, yieldWaitMs: wait, stateGenerationYieldWaitShare: wall > 0 ? wait / wall : null }
    }
  }
  return { wholeRun: { stateGenerationWallMs: whole.wallMs, yieldCount: whole.count, yieldWaitMs: whole.waitMs, stateGenerationYieldWaitShare: whole.wallMs > 0 ? whole.waitMs / whole.wallMs : null },
    profileWindow }
}

// ---------------------------------------------------------------- semantic parity with B2-C2B2G's formal run

export interface Phase2C26B2C2B2HDepthParity {
  valid: boolean
  issues: string[]
  b2c2b2gDepths: number
  b2c2b2hDepths: number
  commonDepths: number
  firstMismatch: { index: number; b2c2b2g: unknown; b2c2b2h: unknown } | null
  commonGeneratedStates: number
}

/** What one held-aware depth computed (never its time). */
const depthIdentity = (r: Phase2C26A3DepthRecord) => stableStringify({ streamIndex: r.streamIndex, startGogmaCounter: r.startGogmaCounter, depth: r.depth, exhausted: r.exhausted, counts: r.counts })

/**
 * The held-aware depth records of B2-C2B2G's formal run and of this run (each collected by B2-C2B2G's collector, which fails closed on
 * a lost or doubled record) must be equal on their common prefix: same stream, start counter, depth, exhaustion and counts (frontier
 * before, legal positions, generated states, frontier after, window memo entries). The CPU profiler must not change what the Search
 * computes.
 */
export function phase2c26b2c2b2hDepthParity(b2c2b2gSnapshots: readonly Phase2C26B2C2B2GProfileSnapshot[], b2c2b2hSnapshots: readonly Phase2C26B2C2B2GProfileSnapshot[]): Phase2C26B2C2B2HDepthParity {
  const g = phase2c26b2c2b2gCollectDepthRecords(b2c2b2gSnapshots), h = phase2c26b2c2b2gCollectDepthRecords(b2c2b2hSnapshots)
  const issues = [...g.issues.map(i => `B2-C2B2G depth records: ${i}`), ...h.issues.map(i => `B2-C2B2H depth records: ${i}`)]
  const common = Math.min(g.records.length, h.records.length)
  let firstMismatch: Phase2C26B2C2B2HDepthParity['firstMismatch'] = null
  let generated = 0
  for (let index = 0; index < common; index += 1) {
    if (depthIdentity(g.records[index]!) !== depthIdentity(h.records[index]!)) {
      firstMismatch = { index, b2c2b2g: JSON.parse(depthIdentity(g.records[index]!)), b2c2b2h: JSON.parse(depthIdentity(h.records[index]!)) }
      break
    }
    generated += g.records[index]!.counts.generatedStates ?? 0
  }
  if (common === 0) issues.push('no common held-aware depth record')
  if (firstMismatch !== null) issues.push(`held-aware depth record ${firstMismatch.index} differs (identity or counts)`)
  return { valid: issues.length === 0, issues, b2c2b2gDepths: g.records.length, b2c2b2hDepths: h.records.length, commonDepths: common, firstMismatch, commonGeneratedStates: generated }
}

// ---------------------------------------------------------------- launch provenance and raw conditions

export interface Phase2C26B2C2B2HLaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/** B2-C2B2G's launch provenance rule with this phase's attestation. */
export function phase2c26b2c2b2hLaunchProvenance(input: { attestationFile: { sha256: string; body: unknown } | null; recordedAttestationSha256: string | null;
  environment: Record<string, unknown>; expected: Phase2C26B2C2B2HAttestationExpectation }): Phase2C26B2C2B2HLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [], reason: 'The runner start attestation is missing.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2HStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes', 'cpuProfilerConfig'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues, reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

export const phase2c26b2c2b2hEvidenceGrade = phase2c26b2c2b2dEvidenceGrade

/**
 * B2-C2B2G's (B2-C2B2F's) run conditions - one Search run (no retry), the 30-minute budget, the 12,288 MB heap flag, no CPU profiler
 * / inspector command-line flag - plus: the Node flags are exactly the registered heap flag (JIT default: no inlining diagnostic) and
 * the profiler window / sampling is the registered one.
 */
export function phase2c26b2c2b2hConditionIssues(input: { smoke: boolean; runs: readonly { taskId: string; process: { budgetMs: number; nodeFlags?: string[] } }[]; cpuProfilerConfig: unknown }): string[] {
  const issues = phase2c26b2c2b2fConditionIssues(input)
  for (const run of input.runs) {
    if (!input.smoke && run.process.budgetMs !== PHASE2C26B2C2B2H_BUDGET_MS) issues.push(`${run.taskId}: the child budget is not the registered one`)
    if (!same(run.process.nodeFlags ?? null, PHASE2C26B2C2B2H_NODE_FLAGS)) issues.push(`${run.taskId}: the Node flags are not exactly ${PHASE2C26B2C2B2H_NODE_FLAGS.join(' ')}`)
  }
  if (!input.smoke && !same(input.cpuProfilerConfig, PHASE2C26B2C2B2H_CPU_PROFILER)) issues.push('the CPU profiler window / sampling interval is not the registered one')
  return [...new Set(issues)]
}
