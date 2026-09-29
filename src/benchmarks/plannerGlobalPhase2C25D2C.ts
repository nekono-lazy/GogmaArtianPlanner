/**
 * Issue #154 Phase 2-C2.5-D2-c: heap profiling of the shallow Search-only OOM that remains after the Ideal-only
 * publication (D2-a), Research only. Never import from Production.
 *
 * Phase 2-C2.5-D2-a stopped materializing, ordering and retaining the non-Ideal held-aware Skill / Bonus solutions in
 * the scheduler. The two shallow OOM contexts still ran out of memory (Node D2-a, Chrome D2-b). This Phase does not
 * change the Search either: it re-runs exactly those Search inputs with the Phase 2-C2.5-C profiling conditions and
 * observes what is live now.
 *
 * ```text
 * D2-a RESULT -> workload (primary OOM = both D2-a modes out_of_memory; cleared reference = an earlier OOM
 *                representative that ended normally in both D2-a modes; the two C2.5-C completed controls)
 *   -> this run's own pre-search context (derivePhase2C25APreSearchContexts(), unchanged)
 *   -> parity with the C2.5-A pre-search evidence (field by field) and the D2-a context digest
 *   -> A. sampling run   (fresh child, 8 GB): the C2.5-C Search call + live-object sampling heap profile per threshold
 *   -> B. snapshot run   (fresh child, 512 MB, primary only): the same Search, a baseline snapshot, one near-limit snapshot
 * ```
 *
 * The Search call is `runPhase2C25CSearch()`, unchanged (the C2.5-A Search-only input, consumer stop at 1 Candidate).
 * The profiler only reads the heap between two yields. The progress observer is the execution-only Search
 * instrumentation hook reduced to counts; it never receives a state, a layout or a solution.
 *
 * This module reads no file. The runner passes the evidence it read; every ID comes from that evidence.
 */
import { hashStableValue, stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativeSearchInstrumentation } from '../domain/search'
import type { ReservedGogmaDepthObservation } from '../domain/search/bonusStream'
import type { ReservedSkillDepthObservation } from '../domain/search/skillStream'
import {
  createPhase2C25CProgressObserver,
  PHASE2C25C_CANDIDATE_STOP_BOUND,
  PHASE2C25C_CONCURRENCY,
  PHASE2C25C_NEAR_HEAP_LIMIT_SNAPSHOTS,
  PHASE2C25C_PROFILE_THRESHOLDS_MIB,
  PHASE2C25C_PROGRESS_HEARTBEAT_MS,
  PHASE2C25C_RUN_BUDGET_MS,
  PHASE2C25C_SAMPLING_CHILD_HEAP_MB,
  PHASE2C25C_SAMPLING_OPTIONS,
  PHASE2C25C_SAMPLING_VARIANTS,
  PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB,
  PHASE2C25C_SNAPSHOT_CHILD_HEAP_MB,
  type Phase2C25CProgress,
  type Phase2C25CWorkload,
  type Phase2C25CWorkloadItem,
} from './plannerGlobalPhase2C25C'

// ---------------------------------------------------------------- Research constants (the C2.5-C conditions, unchanged)

export const PHASE2C25D2C_SAMPLING_CHILD_HEAP_MB = PHASE2C25C_SAMPLING_CHILD_HEAP_MB
export const PHASE2C25D2C_SAMPLING_OPTIONS = PHASE2C25C_SAMPLING_OPTIONS
export const PHASE2C25D2C_SAMPLING_VARIANTS = PHASE2C25C_SAMPLING_VARIANTS
export const PHASE2C25D2C_PROFILE_THRESHOLDS_MIB = PHASE2C25C_PROFILE_THRESHOLDS_MIB
export const PHASE2C25D2C_SNAPSHOT_CHILD_HEAP_MB = PHASE2C25C_SNAPSHOT_CHILD_HEAP_MB
export const PHASE2C25D2C_NEAR_HEAP_LIMIT_SNAPSHOTS = PHASE2C25C_NEAR_HEAP_LIMIT_SNAPSHOTS
export const PHASE2C25D2C_CONCURRENCY = PHASE2C25C_CONCURRENCY
export const PHASE2C25D2C_RUN_BUDGET_MS = PHASE2C25C_RUN_BUDGET_MS
export const PHASE2C25D2C_SNAPSHOT_ANALYZER_HEAP_MB = PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB
export const PHASE2C25D2C_PROGRESS_HEARTBEAT_MS = PHASE2C25C_PROGRESS_HEARTBEAT_MS
export const PHASE2C25D2C_CANDIDATE_STOP_BOUND = PHASE2C25C_CANDIDATE_STOP_BOUND

export type Phase2C25D2CVariantId = typeof PHASE2C25D2C_SAMPLING_VARIANTS[number]['id']

/**
 * Which sampling variants each workload role runs (a design decision fixed before the formal run):
 *
 * - primary OOM   both. `jit_default` is the Production-like JIT and the formal sampling evidence; `no_inlining` is the
 *                 diagnostic allocation-attribution condition (it attributes an allocation to the function performing
 *                 it; its heap is not claimed to equal the Production-like heap).
 * - cleared ref.  `jit_default` only. It is a reference for how the old C2.5-C major allocation / retention changed in
 *                 the Production-like condition; no hypothesis verdict reads it, so a diagnostic run adds nothing formal.
 * - controls      both, because `no_inlining` is used formally for the primaries: each variant's semantic contamination
 *                 is checked on both controls.
 */
export const PHASE2C25D2C_VARIANTS_BY_ROLE: Readonly<Record<Phase2C25D2CWorkloadRole, readonly Phase2C25D2CVariantId[]>> = {
  primary_oom: ['jit_default', 'no_inlining'],
  cleared_reference: ['jit_default'],
  control_first_candidate: ['jit_default', 'no_inlining'],
  control_stopped_by_extent: ['jit_default', 'no_inlining'],
}

/** Snapshot runs: the primary OOM contexts only. */
export const PHASE2C25D2C_SNAPSHOT_ROLES: readonly Phase2C25D2CWorkloadRole[] = ['primary_oom']

// ---------------------------------------------------------------- D2-a RESULT view

export type Phase2C25D2CStatus = 'first_candidate' | 'stopped_by_extent_before_candidate' | 'exhausted_before_candidate' | 'out_of_memory' | 'timeout' | 'process_failure'
const STATUSES: readonly Phase2C25D2CStatus[] = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate', 'out_of_memory', 'timeout', 'process_failure']
const NORMAL_ENDINGS: readonly Phase2C25D2CStatus[] = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate']

export interface Phase2C25D2CD2AModeRecord {
  status: Phase2C25D2CStatus
  searchSummary: Record<string, unknown> | null
  firstCandidateKeySha256: string | null
}

export interface Phase2C25D2CD2AContext {
  /** Position in the D2-a RESULT `contexts` array. */
  d2aIndex: number
  orientationId: string
  workIndex: number
  role: string
  kind: string
  targetWeaponId: string
  minimal: Phase2C25D2CD2AModeRecord
  instrumented: Phase2C25D2CD2AModeRecord
  /** `null` for an OOM representative; otherwise every D2-a mode's control semantic parity. */
  controlParityMatches: boolean | null
  /** The D2-a instrumented depth record (the last snapshot for an OOM child). */
  instrumentedDepth: { gogmaMaxDepth: number | null; maxGeneratedStatesPerDepth: number | null; depthOfMaxGeneratedStates: number | null; cumulativeGogmaGenerated: number | null }
}

export interface Phase2C25D2CD2AView {
  exportSha256: string
  measuredHead: string
  c25aEvidenceSha256: string
  workloadSelection: { oomRepresentatives: Phase2C25D2CSelectionItem[]; controls: Phase2C25D2CSelectionItem[] }
  contexts: Phase2C25D2CD2AContext[]
  contextParityMatches: boolean
}

export interface Phase2C25D2CSelectionItem {
  role: string
  evidenceIndex: number
  orientationId: string
  kind: string
  workIndex: number
  targetWeaponId: string
  contextDigest: string
}

function fail(where: string, message: string): never {
  throw new Error(`D2-a RESULT: ${where} ${message}`)
}
function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(where, 'is not an object.')
  return value as Record<string, unknown>
}
function str(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'is not a string.')
  return value
}
function int(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail(where, 'is not a non-negative integer.')
  return value
}
function nullableNumber(value: unknown, where: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(where, 'is not a finite number.')
  return value
}
function arr(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'is not an array.')
  return value
}

function modeRecord(value: unknown, where: string): Phase2C25D2CD2AModeRecord {
  const body = obj(obj(value, where).view, `${where}.view`)
  const status = str(body.status, `${where}.view.status`)
  if (!STATUSES.includes(status as Phase2C25D2CStatus)) fail(`${where}.view.status`, `${status} is unknown.`)
  return {
    status: status as Phase2C25D2CStatus,
    searchSummary: body.searchSummary === null ? null : obj(body.searchSummary, `${where}.view.searchSummary`),
    firstCandidateKeySha256: body.firstCandidateKeySha256 === null ? null : str(body.firstCandidateKeySha256, `${where}.view.firstCandidateKeySha256`),
  }
}

function selectionItem(value: unknown, where: string): Phase2C25D2CSelectionItem {
  const body = obj(value, where)
  return { role: str(body.role, `${where}.role`), evidenceIndex: int(body.evidenceIndex, `${where}.evidenceIndex`), orientationId: str(body.orientationId, `${where}.orientationId`),
    kind: str(body.kind, `${where}.kind`), workIndex: int(body.workIndex, `${where}.workIndex`), targetWeaponId: str(body.targetWeaponId, `${where}.targetWeaponId`),
    contextDigest: str(body.contextDigest, `${where}.contextDigest`) }
}

/** Reads the parts of the committed D2-a RESULT this Phase uses, failing closed on any unexpected shape. */
export function parsePhase2C25D2CD2AResult(json: unknown): Phase2C25D2CD2AView {
  const root = obj(json, 'root')
  const provenance = obj(root.provenance, 'provenance')
  if (provenance.formal !== true) fail('provenance.formal', 'is not true.')
  const selection = obj(root.workloadSelection, 'workloadSelection')
  const contexts = arr(root.contexts, 'contexts').map((raw, d2aIndex): Phase2C25D2CD2AContext => {
    const where = `contexts[${d2aIndex}]`
    const body = obj(raw, where)
    const after = obj(body.after, `${where}.after`)
    const parity = body.controlParity
    const controlParityMatches = parity === null ? null
      : arr(parity, `${where}.controlParity`).every((row, i) => obj(row, `${where}.controlParity[${i}]`).matches === true)
    const instrumented = obj(after.instrumented, `${where}.after.instrumented`)
    const metrics = instrumented.metrics === null || instrumented.metrics === undefined ? null : obj(instrumented.metrics, `${where}.after.instrumented.metrics`)
    const maxima = instrumented.gogmaDepthMaxima === null || instrumented.gogmaDepthMaxima === undefined ? null : obj(instrumented.gogmaDepthMaxima, `${where}.after.instrumented.gogmaDepthMaxima`)
    return {
      d2aIndex, orientationId: str(body.orientationId, `${where}.orientationId`), workIndex: int(body.workIndex, `${where}.workIndex`), role: str(body.role, `${where}.role`),
      kind: str(body.kind, `${where}.kind`), targetWeaponId: str(body.targetWeaponId, `${where}.targetWeaponId`),
      minimal: modeRecord(after.minimal, `${where}.after.minimal`), instrumented: modeRecord(after.instrumented, `${where}.after.instrumented`),
      controlParityMatches,
      instrumentedDepth: {
        gogmaMaxDepth: metrics === null ? null : nullableNumber(metrics.gogmaMaxDepth, `${where}.metrics.gogmaMaxDepth`),
        maxGeneratedStatesPerDepth: maxima === null ? null : nullableNumber(maxima.maxGeneratedStatesPerDepth, `${where}.gogmaDepthMaxima.maxGeneratedStatesPerDepth`),
        depthOfMaxGeneratedStates: maxima === null ? null : nullableNumber(maxima.depthOfMaxGeneratedStates, `${where}.gogmaDepthMaxima.depthOfMaxGeneratedStates`),
        cumulativeGogmaGenerated: metrics === null ? null : nullableNumber(metrics.cumulativeGogmaGenerated, `${where}.metrics.cumulativeGogmaGenerated`),
      },
    }
  })
  const parityRows = arr(obj(root.contextParity, 'contextParity').rows, 'contextParity.rows')
  return {
    exportSha256: str(provenance.exportSha256, 'provenance.exportSha256'),
    measuredHead: str(provenance.measuredHead, 'provenance.measuredHead'),
    c25aEvidenceSha256: str(provenance.c25aEvidenceSha256, 'provenance.c25aEvidenceSha256'),
    workloadSelection: {
      oomRepresentatives: arr(selection.oomRepresentatives, 'workloadSelection.oomRepresentatives').map((v, i) => selectionItem(v, `workloadSelection.oomRepresentatives[${i}]`)),
      controls: arr(selection.controls, 'workloadSelection.controls').map((v, i) => selectionItem(v, `workloadSelection.controls[${i}]`)),
    },
    contexts,
    contextParityMatches: parityRows.length > 0 && parityRows.every((row, i) => obj(row, `contextParity.rows[${i}]`).matches === true),
  }
}

// ---------------------------------------------------------------- workload

export type Phase2C25D2CWorkloadRole = 'primary_oom' | 'cleared_reference' | 'control_first_candidate' | 'control_stopped_by_extent'

export interface Phase2C25D2CWorkloadItem {
  role: Phase2C25D2CWorkloadRole
  /** Position in the C2.5-A evidence `contexts` (the C2.5-C / D2-a workload order). */
  evidenceIndex: number
  /** Position in the D2-a RESULT `contexts`. */
  d2aIndex: number
  orientationId: string
  kind: string
  workIndex: number
  targetWeaponId: string
  /** The pre-search context digest the child's re-derived context must equal (C2.5-A = C2.5-C = D2-a). */
  contextDigest: string
  /** The D2-a outcome this Phase compares with (both D2-a modes agree for every selected context). */
  expected: Phase2C25D2CD2AModeRecord
  /** The D2-a instrumented depth record (reference only). */
  d2aDepth: Phase2C25D2CD2AContext['instrumentedDepth']
}

export interface Phase2C25D2CWorkload {
  rule: string
  primary: Phase2C25D2CWorkloadItem[]
  clearedReferences: Phase2C25D2CWorkloadItem[]
  controls: Phase2C25D2CWorkloadItem[]
}

export const PHASE2C25D2C_WORKLOAD_RULE = 'Primary OOM: every D2-a RESULT context with role oom_representative that is out_of_memory in both D2-a modes (minimal, instrumented). ' +
  'Cleared reference: every D2-a RESULT context with role oom_representative that ended normally (first_candidate / stopped_by_extent_before_candidate / ' +
  'exhausted_before_candidate) with the same status in both D2-a modes. Controls: the D2-a workloadSelection controls, which must equal the C2.5-C rule ' +
  '(selectPhase2C25CWorkload) re-applied by the runner to the C2.5-A evidence and must have D2-a control semantic parity in every mode. ' +
  'An OOM representative that is neither (modes differ, timeout, process failure) is reported unselected. No Target, Entry or orientation ID is fixed in source.'

const sameItem = (left: Pick<Phase2C25D2CSelectionItem, 'orientationId' | 'workIndex' | 'targetWeaponId' | 'contextDigest'>, right: typeof left) =>
  left.orientationId === right.orientationId && left.workIndex === right.workIndex && left.targetWeaponId === right.targetWeaponId && left.contextDigest === right.contextDigest

/**
 * The workload of this Phase, from the D2-a RESULT, cross-checked against the C2.5-C workload the runner re-derived
 * from the C2.5-A evidence (`c25cWorkload`). Fails closed on any disagreement.
 */
export function selectPhase2C25D2CWorkload(view: Phase2C25D2CD2AView, c25cWorkload: Phase2C25CWorkload): Phase2C25D2CWorkload & { unselected: { orientationId: string; workIndex: number; reason: string }[] } {
  const selection = [...view.workloadSelection.oomRepresentatives, ...view.workloadSelection.controls]
  const find = (item: Phase2C25D2CSelectionItem) => {
    const context = view.contexts.find(c => c.orientationId === item.orientationId && c.workIndex === item.workIndex)
    if (!context || context.targetWeaponId !== item.targetWeaponId) throw new Error(`D2-a RESULT has no context for ${item.orientationId}#${item.workIndex}.`)
    return context
  }
  const c25cItems: Phase2C25CWorkloadItem[] = [...c25cWorkload.oomRepresentatives, ...c25cWorkload.controls]
  if (c25cItems.length !== selection.length || !c25cItems.every((item, i) => item.role === selection[i].role && item.evidenceIndex === selection[i].evidenceIndex && sameItem(item, selection[i]))) {
    throw new Error('The D2-a workloadSelection differs from the C2.5-C workload re-derived from the C2.5-A evidence.')
  }
  const toItem = (item: Phase2C25D2CSelectionItem, role: Phase2C25D2CWorkloadRole): Phase2C25D2CWorkloadItem => {
    const context = find(item)
    return { role, evidenceIndex: item.evidenceIndex, d2aIndex: context.d2aIndex, orientationId: item.orientationId, kind: item.kind, workIndex: item.workIndex,
      targetWeaponId: item.targetWeaponId, contextDigest: item.contextDigest, expected: context.minimal, d2aDepth: context.instrumentedDepth }
  }
  const primary: Phase2C25D2CWorkloadItem[] = []
  const clearedReferences: Phase2C25D2CWorkloadItem[] = []
  const unselected: { orientationId: string; workIndex: number; reason: string }[] = []
  for (const item of view.workloadSelection.oomRepresentatives) {
    const context = find(item)
    if (context.role !== 'oom_representative') throw new Error(`D2-a RESULT context ${item.orientationId}#${item.workIndex} is not an OOM representative.`)
    const { minimal, instrumented } = context
    if (minimal.status === 'out_of_memory' && instrumented.status === 'out_of_memory') primary.push(toItem(item, 'primary_oom'))
    else if (NORMAL_ENDINGS.includes(minimal.status) && minimal.status === instrumented.status) clearedReferences.push(toItem(item, 'cleared_reference'))
    else unselected.push({ orientationId: item.orientationId, workIndex: item.workIndex, reason: `D2-a modes ${minimal.status} / ${instrumented.status}` })
  }
  const controls = view.workloadSelection.controls.map(item => {
    const context = find(item)
    if (context.controlParityMatches !== true) throw new Error(`D2-a control ${item.orientationId}#${item.workIndex} lacks semantic parity.`)
    if (context.minimal.status !== context.instrumented.status) throw new Error(`D2-a control ${item.orientationId}#${item.workIndex} differs between modes.`)
    if (item.role !== 'control_first_candidate' && item.role !== 'control_stopped_by_extent') throw new Error(`Unknown control role ${item.role}.`)
    return toItem(item, item.role)
  })
  if (primary.length === 0) throw new Error('The D2-a RESULT holds no OOM representative that is still out of memory in both modes.')
  if (!controls.some(c => c.role === 'control_first_candidate') || !controls.some(c => c.role === 'control_stopped_by_extent')) throw new Error('The D2-a RESULT lacks a control of each normal termination.')
  return { rule: PHASE2C25D2C_WORKLOAD_RULE, primary, clearedReferences, controls, unselected }
}

/** Every selected item in run order: primary, cleared references, controls. */
export function phase2c25d2cWorkloadItems(workload: Phase2C25D2CWorkload): Phase2C25D2CWorkloadItem[] {
  return [...workload.primary, ...workload.clearedReferences, ...workload.controls]
}

export function phase2c25d2cWorkloadDigest(workload: Phase2C25D2CWorkload): string {
  return hashStableValue({ rule: workload.rule, items: phase2c25d2cWorkloadItems(workload) })
}

/** The sampling run plan: (variant, item) pairs in run order, variant-major as in C2.5-C. */
export function phase2c25d2cSamplingPlan(workload: Phase2C25D2CWorkload): { variant: Phase2C25D2CVariantId; item: Phase2C25D2CWorkloadItem }[] {
  const items = phase2c25d2cWorkloadItems(workload)
  return PHASE2C25D2C_SAMPLING_VARIANTS.flatMap(v => items.filter(item => PHASE2C25D2C_VARIANTS_BY_ROLE[item.role].includes(v.id)).map(item => ({ variant: v.id, item })))
}

// ---------------------------------------------------------------- progress (numbers only)

export interface Phase2C25D2CDepthRecord {
  streamIndex: number
  depth: number
  generatedStates: number
  frontierStates: number
}

export interface Phase2C25D2CProgress extends Phase2C25CProgress {
  /** Per held-aware Gogma depth: generated and frontier counts only. */
  gogmaDepths: Phase2C25D2CDepthRecord[]
  gogmaDepthMaxima: {
    maxGeneratedStatesInOneDepth: number
    depthOfMaxGenerated: number | null
    streamIndexOfMaxGenerated: number | null
    maxFrontierStatesInOneDepth: number
    depthOfMaxFrontier: number | null
    streamIndexOfMaxFrontier: number | null
  }
}

/**
 * The C2.5-C progress observer plus per-depth generated / frontier counts of the held-aware Gogma stream, computed from
 * the same execution-only depth events. It reads only the counts the event carries; no state object reaches it.
 */
export function createPhase2C25D2CProgressObserver() {
  const base = createPhase2C25CProgressObserver()
  const gogmaDepths: Phase2C25D2CDepthRecord[] = []
  const maxima: Phase2C25D2CProgress['gogmaDepthMaxima'] = {
    maxGeneratedStatesInOneDepth: 0, depthOfMaxGenerated: null, streamIndexOfMaxGenerated: null,
    maxFrontierStatesInOneDepth: 0, depthOfMaxFrontier: null, streamIndexOfMaxFrontier: null,
  }
  const instrumentation: PlannerAlternativeSearchInstrumentation = {
    onGogmaReservedDepth: (event: ReservedGogmaDepthObservation) => {
      base.instrumentation.onGogmaReservedDepth?.(event)
      gogmaDepths.push({ streamIndex: event.streamIndex, depth: event.depth, generatedStates: event.generatedStates, frontierStates: event.frontierStates })
      if (event.generatedStates > maxima.maxGeneratedStatesInOneDepth) {
        maxima.maxGeneratedStatesInOneDepth = event.generatedStates
        maxima.depthOfMaxGenerated = event.depth
        maxima.streamIndexOfMaxGenerated = event.streamIndex
      }
      if (event.frontierStates > maxima.maxFrontierStatesInOneDepth) {
        maxima.maxFrontierStatesInOneDepth = event.frontierStates
        maxima.depthOfMaxFrontier = event.depth
        maxima.streamIndexOfMaxFrontier = event.streamIndex
      }
    },
    onSkillReservedDepth: (event: ReservedSkillDepthObservation) => { base.instrumentation.onSkillReservedDepth?.(event) },
  }
  return {
    instrumentation,
    snapshot: (): Phase2C25D2CProgress => ({ ...base.snapshot(), gogmaDepths: gogmaDepths.map(d => ({ ...d })), gogmaDepthMaxima: { ...maxima } }),
  }
}

// ---------------------------------------------------------------- semantic parity against D2-a

export interface Phase2C25D2CSemanticParity {
  orientationId: string
  workIndex: number
  role: Phase2C25D2CWorkloadRole
  variant: string
  statusMatches: boolean
  searchSummaryMatches: boolean
  firstCandidateKeyMatches: boolean
  extentAndExhaustionMatch: boolean
  contaminated: boolean
}

/**
 * A normally ending run (control or cleared reference) of this Phase against the D2-a outcome: status, Search summary,
 * first Candidate key (hashed with `digest`, as D2-a did) and the extent / exhausted flags must all be equal.
 */
export function comparePhase2C25D2CSemantics(item: Phase2C25D2CWorkloadItem, variant: string,
  run: { status: string; searchSummary: unknown; firstCandidateKey: string | null } | null, digest: (value: string) => string): Phase2C25D2CSemanticParity {
  const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right)
  const flags = (summary: unknown) => {
    if (typeof summary !== 'object' || summary === null) return null
    const s = summary as Record<string, unknown>
    return { exhausted: s.exhausted, stoppedByExtent: s.stoppedByExtent }
  }
  const statusMatches = run !== null && run.status === item.expected.status
  const searchSummaryMatches = run !== null && same(run.searchSummary, item.expected.searchSummary)
  const firstCandidateKeyMatches = run !== null && (run.firstCandidateKey === null ? null : digest(run.firstCandidateKey)) === item.expected.firstCandidateKeySha256
  const extentAndExhaustionMatch = run !== null && same(flags(run.searchSummary), flags(item.expected.searchSummary))
  return { orientationId: item.orientationId, workIndex: item.workIndex, role: item.role, variant, statusMatches, searchSummaryMatches, firstCandidateKeyMatches,
    extentAndExhaustionMatch, contaminated: !(statusMatches && searchSummaryMatches && firstCandidateKeyMatches && extentAndExhaustionMatch) }
}

// ---------------------------------------------------------------- thresholds not reached (OOM primary)

export type Phase2C25D2CThresholdMissReason = 'reached' | 'out_of_memory_before_threshold' | 'search_ended_before_threshold' | 'child_failed_before_threshold' | 'profile_failed'

/**
 * Why a threshold has no profile. An OOM child that never crossed a threshold between two yields died before it; a
 * normally ending child ended before it (not a failure); a threshold whose capture threw is `profile_failed`.
 */
export function phase2c25d2cThresholdMiss(threshold: number, run: { outcome: string; capturedThresholds: readonly number[]; failedThresholds: readonly number[] }): Phase2C25D2CThresholdMissReason {
  if (run.capturedThresholds.includes(threshold)) return 'reached'
  if (run.failedThresholds.includes(threshold)) return 'profile_failed'
  if (run.outcome === 'out_of_memory') return 'out_of_memory_before_threshold'
  if (NORMAL_ENDINGS.includes(run.outcome as Phase2C25D2CStatus)) return 'search_ended_before_threshold'
  return 'child_failed_before_threshold'
}
