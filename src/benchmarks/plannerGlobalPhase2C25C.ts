/**
 * Issue #154 Phase 2-C2.5-C: heap profiling of the Search-only OOM, Research only. Never import from Production.
 *
 * Phase 2-C2.5-A localized three kernel OOMs to the Planner Alternative Search alone (first Candidate never reached,
 * 8 GB). This Phase does not change the Search. It re-runs exactly those Search inputs and observes WHAT is live:
 *
 * ```text
 * C2.5-A evidence -> workload (OOM representatives + two completed controls; no hard-coded ID)
 *   -> this run's own pre-search context (derivePhase2C25APreSearchContexts(), unchanged) -> parity with C2.5-A
 *   -> A. sampling run   (fresh child, 8 GB): visitPlannerAlternativeCandidates() + live-object sampling heap profile,
 *                         captured the first time heapUsed crosses each Research threshold
 *   -> B. snapshot run   (fresh child, small heap): the same Search, a pre-Search baseline heap snapshot and one
 *                         near-heap-limit heap snapshot, no sampling profiler
 * ```
 *
 * The Search call itself is the one Phase 2-C2.5-A makes (same origin, Target, extent, reservation, excluded Route keys,
 * consumer stop at 1 Candidate). The profiler only reads the heap between two yields; it never returns anything the
 * Search reads, and a profiling failure is recorded as such, never as "no Candidate". The optional progress observer is
 * the execution-only Search instrumentation hook, reduced to a few numbers.
 *
 * This module reads no file. The runner passes the C2.5-A evidence it read; Target IDs, orientation IDs and Counter
 * positions all come from that evidence and from the run itself.
 */
import { hashStableValue, stableStringify } from '../domain/models/publicTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchInstrumentation,
  type PlannerAlternativeSearchSummary,
} from '../domain/search'
import type { ReservedGogmaDepthObservation } from '../domain/search/bonusStream'
import type { ReservedSkillDepthObservation } from '../domain/search/skillStream'
import {
  phase2c25aSearchStatus,
  PHASE2C25A_CANDIDATE_STOP_BOUND,
  type Phase2C25APreparedOrientation,
  type Phase2C25APreSearchContext,
  type Phase2C25ASearchStatus,
} from './plannerGlobalPhase2C25A'
import { positionRanges } from './plannerGlobalPhase2C2'

// ---------------------------------------------------------------- Research constants (none is a Production default)

/** The sampling child runs with the same heap limit as Phase 2-C2.5-A, so the Search dies where it died there. */
export const PHASE2C25C_SAMPLING_CHILD_HEAP_MB = 8192
/** `HeapProfiler.startSampling` interval: one sample per 256 KiB allocated on average. */
export const PHASE2C25C_SAMPLING_INTERVAL_BYTES = 256 * 1024
/** Stack depth recorded per sample; deep enough to reach the scheduler from a stream prediction. */
export const PHASE2C25C_SAMPLING_STACK_DEPTH = 64
/** Live-object profile: objects already collected by a major / minor GC are not part of the profile. */
export const PHASE2C25C_SAMPLING_OPTIONS = {
  samplingInterval: PHASE2C25C_SAMPLING_INTERVAL_BYTES,
  stackDepth: PHASE2C25C_SAMPLING_STACK_DEPTH,
  includeObjectsCollectedByMajorGC: false,
  includeObjectsCollectedByMinorGC: false,
} as const
/**
 * Sampling variants. V8's sampling heap profiler records one frame per physical stack frame, so an allocation made by a
 * function TurboFan / Maglev inlined into its caller is attributed to the caller. `jit_default` is the Production-like
 * JIT; `no_inlining` disables inlining only (a V8 code generation choice: the Search, its data and its live objects are
 * unchanged), so each allocation is attributed to the function that performs it. Both are Research conditions.
 */
export const PHASE2C25C_SAMPLING_VARIANTS = [
  { id: 'jit_default', v8Flags: [] as string[] },
  { id: 'no_inlining', v8Flags: ['--no-turbo-inlining', '--no-maglev-inlining'] },
] as const
/** A profile is captured the first time the Search-time `process.memoryUsage().heapUsed` exceeds each threshold (MiB). */
export const PHASE2C25C_PROFILE_THRESHOLDS_MIB = [512, 1024, 2048, 4096, 6144, 7168] as const
/** The snapshot child's heap limit: small, so the near-limit snapshot is taken from a heap a snapshot can serialize. */
export const PHASE2C25C_SNAPSHOT_CHILD_HEAP_MB = 512
/** `--heapsnapshot-near-heap-limit`: one snapshot per snapshot run. */
export const PHASE2C25C_NEAR_HEAP_LIMIT_SNAPSHOTS = 1
/** Every child of this Phase runs alone. */
export const PHASE2C25C_CONCURRENCY = 1
/** Wall-time budget of one child (preparation, profiling and snapshot writing included). */
export const PHASE2C25C_RUN_BUDGET_MS = 30 * 60 * 1000
/** Heap limit of the separate snapshot analyzer process (one snapshot per process). */
export const PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB = 16384
/** Progress heartbeat of both child kinds (numbers only, sent over IPC so an OOM keeps the last one). */
export const PHASE2C25C_PROGRESS_HEARTBEAT_MS = 1000
export const PHASE2C25C_CANDIDATE_STOP_BOUND = PHASE2C25A_CANDIDATE_STOP_BOUND

// ---------------------------------------------------------------- C2.5-A evidence view

export type Phase2C25CEvidenceStatus = 'out_of_memory' | 'first_candidate' | 'stopped_by_extent_before_candidate' | 'exhausted_before_candidate' | 'timeout' | 'process_failure'

export interface Phase2C25CEvidenceModeRecord {
  status: Phase2C25CEvidenceStatus
  searchSummary: Record<string, unknown> | null
  firstCandidateKeySha256: string | null
}

export interface Phase2C25CEvidenceContext {
  /** Position in the C2.5-A evidence `contexts` array: the stable order of this Phase. */
  evidenceIndex: number
  orientationId: string
  role: 'oom_representative' | 'completed_control'
  kind: string
  workIndex: number
  targetWeaponId: string
  classification: string
  minimal: Phase2C25CEvidenceModeRecord
  instrumented: Phase2C25CEvidenceModeRecord
}

export interface Phase2C25CEvidencePreSearchContext {
  orientationId: string
  workIndex: number
  targetWeaponId: string
  status: string
  invalidatedBuildListEntryId: string
  invalidatedRouteKeySha256: string
  fixedRouteBuildListEntryIds: string[]
  reservation: unknown
  excludedRouteKeySha256s: string[]
  extent: unknown
  originDigest: string
  contextDigest: string
}

export interface Phase2C25CEvidenceView {
  exportSha256: string
  measuredHead: string
  contexts: Phase2C25CEvidenceContext[]
  preSearchContexts: Map<string, Phase2C25CEvidencePreSearchContext>
}

const EVIDENCE_STATUSES: readonly Phase2C25CEvidenceStatus[] = ['out_of_memory', 'first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate', 'timeout', 'process_failure']

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`C2.5-A evidence: ${where} is not an object.`)
  return value as Record<string, unknown>
}
function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`C2.5-A evidence: ${where} is not a string.`)
  return value
}
function integer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`C2.5-A evidence: ${where} is not a non-negative integer.`)
  return value
}
function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`C2.5-A evidence: ${where} is not an array.`)
  return value.map((item, index) => text(item, `${where}[${index}]`))
}
function modeRecord(value: unknown, where: string): Phase2C25CEvidenceModeRecord {
  const body = record(value, where)
  const status = text(body.status, `${where}.status`)
  if (!EVIDENCE_STATUSES.includes(status as Phase2C25CEvidenceStatus)) throw new Error(`C2.5-A evidence: ${where}.status ${status} is unknown.`)
  const summary = body.searchSummary === null ? null : record(body.searchSummary, `${where}.searchSummary`)
  const key = body.firstCandidateKeySha256 === null ? null : text(body.firstCandidateKeySha256, `${where}.firstCandidateKeySha256`)
  return { status: status as Phase2C25CEvidenceStatus, searchSummary: summary, firstCandidateKeySha256: key }
}

export function phase2c25cContextKey(orientationId: string, workIndex: number): string {
  return `${orientationId}#${workIndex}`
}

/** Reads the parts of the C2.5-A committed evidence this Phase uses, failing closed on any unexpected shape. */
export function parsePhase2C25CEvidence(json: unknown): Phase2C25CEvidenceView {
  const root = record(json, 'root')
  const provenance = record(root.provenance, 'provenance')
  if (provenance.formal !== true) throw new Error('C2.5-A evidence: the committed evidence is not formal.')
  if (!Array.isArray(root.contexts)) throw new Error('C2.5-A evidence: contexts is not an array.')
  const contexts = root.contexts.map((raw, evidenceIndex): Phase2C25CEvidenceContext => {
    const where = `contexts[${evidenceIndex}]`
    const body = record(raw, where)
    const role = text(body.role, `${where}.role`)
    if (role !== 'oom_representative' && role !== 'completed_control') throw new Error(`C2.5-A evidence: ${where}.role ${role} is unknown.`)
    return {
      evidenceIndex, orientationId: text(body.orientationId, `${where}.orientationId`), role, kind: text(body.kind, `${where}.kind`),
      workIndex: integer(body.workIndex, `${where}.workIndex`), targetWeaponId: text(body.targetWeaponId, `${where}.targetWeaponId`),
      classification: text(body.classification, `${where}.classification`),
      minimal: modeRecord(body.minimal, `${where}.minimal`), instrumented: modeRecord(body.instrumented, `${where}.instrumented`),
    }
  })
  if (!Array.isArray(root.preSearchContexts)) throw new Error('C2.5-A evidence: preSearchContexts is not an array.')
  const preSearchContexts = new Map<string, Phase2C25CEvidencePreSearchContext>()
  root.preSearchContexts.forEach((rawOrientation, orientationIndex) => {
    const orientation = record(rawOrientation, `preSearchContexts[${orientationIndex}]`)
    const orientationId = text(orientation.orientationId, `preSearchContexts[${orientationIndex}].orientationId`)
    if (!Array.isArray(orientation.contexts)) throw new Error(`C2.5-A evidence: preSearchContexts[${orientationIndex}].contexts is not an array.`)
    orientation.contexts.forEach((rawContext, contextIndex) => {
      const where = `preSearchContexts[${orientationIndex}].contexts[${contextIndex}]`
      const body = record(rawContext, where)
      const context: Phase2C25CEvidencePreSearchContext = {
        orientationId, workIndex: integer(body.workIndex, `${where}.workIndex`), targetWeaponId: text(body.targetWeaponId, `${where}.targetWeaponId`),
        status: text(body.status, `${where}.status`), invalidatedBuildListEntryId: text(body.invalidatedBuildListEntryId, `${where}.invalidatedBuildListEntryId`),
        invalidatedRouteKeySha256: text(body.invalidatedRouteKeySha256, `${where}.invalidatedRouteKeySha256`),
        fixedRouteBuildListEntryIds: strings(body.fixedRouteBuildListEntryIds, `${where}.fixedRouteBuildListEntryIds`),
        reservation: body.reservation, excludedRouteKeySha256s: strings(body.excludedRouteKeySha256s, `${where}.excludedRouteKeySha256s`),
        extent: body.extent, originDigest: text(body.originDigest, `${where}.originDigest`), contextDigest: text(body.contextDigest, `${where}.contextDigest`),
      }
      const key = phase2c25cContextKey(orientationId, context.workIndex)
      if (preSearchContexts.has(key)) throw new Error(`C2.5-A evidence: duplicate pre-search context ${key}.`)
      preSearchContexts.set(key, context)
    })
  })
  return { exportSha256: text(provenance.exportSha256, 'provenance.exportSha256'), measuredHead: text(provenance.measuredHead, 'provenance.measuredHead'), contexts, preSearchContexts }
}

// ---------------------------------------------------------------- workload

export type Phase2C25CWorkloadRole = 'oom_representative' | 'control_first_candidate' | 'control_stopped_by_extent'

export interface Phase2C25CWorkloadItem {
  role: Phase2C25CWorkloadRole
  evidenceIndex: number
  orientationId: string
  kind: string
  workIndex: number
  targetWeaponId: string
  /** The C2.5-A pre-search context digest the child's re-derived context must equal. */
  contextDigest: string
  /** The C2.5-A outcome this Phase compares with (both C2.5-A modes agree for every selected context). */
  expected: Phase2C25CEvidenceModeRecord
}

export interface Phase2C25CWorkload {
  rule: string
  oomRepresentatives: Phase2C25CWorkloadItem[]
  controls: Phase2C25CWorkloadItem[]
}

export const PHASE2C25C_WORKLOAD_RULE = 'OOM representatives: every C2.5-A evidence context with role oom_representative, classification search_only_oom_reproduced and ' +
  'out_of_memory in both C2.5-A modes. Controls: in the C2.5-A evidence contexts order (its selection order, then work index), the first completed_control ' +
  'context ending first_candidate in both modes and the first ending stopped_by_extent_before_candidate in both modes. No Target, Entry or orientation ID is fixed in source.'

function workloadItem(context: Phase2C25CEvidenceContext, role: Phase2C25CWorkloadRole, view: Phase2C25CEvidenceView): Phase2C25CWorkloadItem {
  const pre = view.preSearchContexts.get(phase2c25cContextKey(context.orientationId, context.workIndex))
  if (!pre) throw new Error(`C2.5-A evidence has no pre-search context for ${context.orientationId}#${context.workIndex}.`)
  if (pre.targetWeaponId !== context.targetWeaponId) throw new Error(`C2.5-A evidence: the pre-search context of ${context.orientationId}#${context.workIndex} names another Target.`)
  return { role, evidenceIndex: context.evidenceIndex, orientationId: context.orientationId, kind: context.kind, workIndex: context.workIndex,
    targetWeaponId: context.targetWeaponId, contextDigest: pre.contextDigest, expected: context.minimal }
}

/** The workload of this Phase, derived from the C2.5-A evidence alone. */
export function selectPhase2C25CWorkload(view: Phase2C25CEvidenceView): Phase2C25CWorkload {
  const bothModes = (context: Phase2C25CEvidenceContext, status: Phase2C25CEvidenceStatus) => context.minimal.status === status && context.instrumented.status === status
  const oomRepresentatives = view.contexts
    .filter(c => c.role === 'oom_representative' && c.classification === 'search_only_oom_reproduced' && bothModes(c, 'out_of_memory'))
    .map(c => workloadItem(c, 'oom_representative', view))
  if (oomRepresentatives.length === 0) throw new Error('C2.5-A evidence holds no Search-only OOM representative.')
  const controls = view.contexts.filter(c => c.role === 'completed_control')
  const firstCandidate = controls.find(c => bothModes(c, 'first_candidate'))
  const extentStop = controls.find(c => bothModes(c, 'stopped_by_extent_before_candidate'))
  if (!firstCandidate || !extentStop) throw new Error('C2.5-A evidence lacks a completed control of each normal termination.')
  return { rule: PHASE2C25C_WORKLOAD_RULE, oomRepresentatives,
    controls: [workloadItem(firstCandidate, 'control_first_candidate', view), workloadItem(extentStop, 'control_stopped_by_extent', view)] }
}

// ---------------------------------------------------------------- context parity

/** The C2.5-A evidence form of a normalized reservation (position ranges). */
export function phase2c25cReservationEvidenceForm(reservation: Phase2C25APreSearchContext['reservation']): unknown {
  if (reservation === null) return null
  return {
    normal: reservation.normal.map(n => ({ counterId: n.counterId, held: positionRanges(n.held), blocked: positionRanges(n.blocked) })),
    skill: { held: positionRanges(reservation.skill.held), blocked: positionRanges(reservation.skill.blocked) },
    gogma: { held: positionRanges(reservation.gogma.held), blocked: positionRanges(reservation.gogma.blocked) },
    exclusiveOwnedWeaponIds: [...reservation.exclusiveOwnedWeaponIds],
  }
}

export interface Phase2C25CContextParity {
  orientationId: string
  workIndex: number
  matches: boolean
  fields: { field: string; matches: boolean }[]
}

/**
 * This run's re-derived pre-search context against the C2.5-A evidence, field by field. `digest` hashes a raw Route
 * key the way the C2.5-A evidence did (the runner passes SHA-256). Any mismatch invalidates the formal profiling.
 */
export function comparePhase2C25CContextParity(derived: Phase2C25APreSearchContext, evidence: Phase2C25CEvidencePreSearchContext | undefined,
  digest: (value: string) => string): Phase2C25CContextParity {
  if (evidence === undefined) {
    return { orientationId: derived.orientationId, workIndex: derived.workIndex, matches: false, fields: [{ field: 'present_in_c25a_evidence', matches: false }] }
  }
  const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right)
  const fields = [
    { field: 'orientationId', matches: derived.orientationId === evidence.orientationId },
    { field: 'workIndex', matches: derived.workIndex === evidence.workIndex },
    { field: 'targetWeaponId', matches: derived.targetWeaponId === evidence.targetWeaponId },
    { field: 'status', matches: derived.status === evidence.status },
    { field: 'invalidatedBuildListEntryId', matches: derived.invalidatedBuildListEntryId === evidence.invalidatedBuildListEntryId },
    { field: 'invalidatedRouteKey', matches: digest(derived.invalidatedRouteKey) === evidence.invalidatedRouteKeySha256 },
    { field: 'fixedRouteBuildListEntryIds', matches: same(derived.fixedRouteBuildListEntryIds, evidence.fixedRouteBuildListEntryIds) },
    { field: 'reservation', matches: same(phase2c25cReservationEvidenceForm(derived.reservation), evidence.reservation) },
    { field: 'excludedRouteKeys', matches: same(derived.excludedRouteKeys.map(digest), evidence.excludedRouteKeySha256s) },
    { field: 'extent', matches: same(derived.extent, evidence.extent) },
    { field: 'originDigest', matches: derived.originDigest === evidence.originDigest },
    { field: 'contextDigest', matches: derived.contextDigest === evidence.contextDigest },
  ]
  return { orientationId: derived.orientationId, workIndex: derived.workIndex, matches: fields.every(f => f.matches), fields }
}

// ---------------------------------------------------------------- light progress (numbers only)

export interface Phase2C25CProgress {
  gogmaEvents: number
  skillEvents: number
  maxDepth: { skill: number; gogma: number }
  cumulative: { gogmaGeneratedStates: number; gogmaFrontierStates: number; skillStates: number }
  lastEvent: null | { type: 'skill' | 'gogma'; streamIndex: number; startCounter: number; depth: number; states: number }
}

/**
 * The execution-only held-aware depth hooks, reduced to a handful of numbers: which stream depth the Search reached,
 * never a state, a layout or a solution. It is the only instrumentation of both child kinds.
 */
export function createPhase2C25CProgressObserver() {
  const progress: Phase2C25CProgress = {
    gogmaEvents: 0, skillEvents: 0, maxDepth: { skill: 0, gogma: 0 },
    cumulative: { gogmaGeneratedStates: 0, gogmaFrontierStates: 0, skillStates: 0 }, lastEvent: null,
  }
  const instrumentation: PlannerAlternativeSearchInstrumentation = {
    onGogmaReservedDepth: (event: ReservedGogmaDepthObservation) => {
      progress.gogmaEvents += 1
      progress.maxDepth.gogma = Math.max(progress.maxDepth.gogma, event.depth)
      progress.cumulative.gogmaGeneratedStates += event.generatedStates
      progress.cumulative.gogmaFrontierStates += event.frontierStates
      progress.lastEvent = { type: 'gogma', streamIndex: event.streamIndex, startCounter: event.startGogmaCounter, depth: event.depth, states: event.generatedStates }
    },
    onSkillReservedDepth: (event: ReservedSkillDepthObservation) => {
      progress.skillEvents += 1
      progress.maxDepth.skill = Math.max(progress.maxDepth.skill, event.depth)
      progress.cumulative.skillStates += event.states
      progress.lastEvent = { type: 'skill', streamIndex: event.streamIndex, startCounter: event.startSkillCounter, depth: event.depth, states: event.states }
    },
  }
  return { instrumentation, snapshot: (): Phase2C25CProgress => structuredClone(progress) }
}

// ---------------------------------------------------------------- heap threshold profiling boundary

/** Tracks which Research thresholds (MiB) the observed heapUsed crossed; each threshold is reported once. */
export function createPhase2C25CThresholdTracker(thresholdsMiB: readonly number[]) {
  const sorted = [...thresholdsMiB].sort((a, b) => a - b)
  if (sorted.some((value, index) => !Number.isInteger(value) || value <= 0 || (index > 0 && value === sorted[index - 1]))) {
    throw new Error('Heap thresholds must be distinct positive integers (MiB).')
  }
  const reached = new Set<number>()
  return {
    /** The thresholds `heapUsedBytes` crosses for the first time, ascending. */
    observe(heapUsedBytes: number): number[] {
      const crossed = sorted.filter(threshold => !reached.has(threshold) && heapUsedBytes > threshold * 1024 * 1024)
      crossed.forEach(threshold => reached.add(threshold))
      return crossed
    },
    reached: () => sorted.filter(threshold => reached.has(threshold)),
    notReached: () => sorted.filter(threshold => !reached.has(threshold)),
  }
}

export interface Phase2C25CProfilingEvent {
  thresholdsMiB: number[]
  heapUsedBytes: number
  outcome: 'captured' | 'profile_failed'
  error: string | null
}

/**
 * The Search's `yieldControl`, wrapped: between two yields it reads heapUsed and, when a Research threshold was crossed
 * for the first time, calls `capture` once for every threshold crossed at that point. `capture` returns nothing the
 * Search reads; a capture that throws is recorded as `profile_failed` and the Search continues unchanged.
 */
export function createPhase2C25CProfilingYield(options: {
  yieldControl: () => Promise<void>
  heapUsed: () => number
  tracker: ReturnType<typeof createPhase2C25CThresholdTracker>
  capture: (thresholdsMiB: number[], heapUsedBytes: number) => Promise<void> | void
  onEvent?: (event: Phase2C25CProfilingEvent) => void
  /** Stop capturing after this returns true (the consumer stopped; nothing Search-time is left to profile). */
  isStopped?: () => boolean
}) {
  const events: Phase2C25CProfilingEvent[] = []
  const yieldControl = async () => {
    if (!(options.isStopped?.() ?? false)) {
      const heapUsedBytes = options.heapUsed()
      const thresholdsMiB = options.tracker.observe(heapUsedBytes)
      if (thresholdsMiB.length > 0) {
        let event: Phase2C25CProfilingEvent
        try {
          await options.capture(thresholdsMiB, heapUsedBytes)
          event = { thresholdsMiB, heapUsedBytes, outcome: 'captured', error: null }
        } catch (error) {
          event = { thresholdsMiB, heapUsedBytes, outcome: 'profile_failed', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
        }
        events.push(event)
        options.onEvent?.(event)
      }
    }
    await options.yieldControl()
  }
  return { yieldControl, events: () => [...events] }
}

// ---------------------------------------------------------------- the Search call

export interface Phase2C25CSearchRecord {
  orientationId: string
  targetWeaponId: string
  workIndex: number
  contextDigest: string
  status: Phase2C25ASearchStatus
  searchSummary: PlannerAlternativeSearchSummary & { stoppedByConsumer: boolean; skippedExcludedRouteKeys: number }
  /** Raw `candidateStableKey()` of the first Candidate; the runner hashes it before any evidence. */
  firstCandidateKey: string | null
  elapsedMs: number
}

/**
 * The Search of one pre-search context, exactly as Phase 2-C2.5-A's `runPhase2C25ASearchOnly()` calls it: the prepared
 * scenario origin, the context's Target, a spread copy of its extent, the reservation the Planner authority returned and
 * the excluded Route keys, with a consumer that stops at the first delivered Candidate. Only `yieldControl` and the
 * optional execution-only instrumentation are this Phase's.
 */
export async function runPhase2C25CSearch(prepared: Phase2C25APreparedOrientation, workIndex: number, engine: RngEngine, options: {
  yieldControl?: () => Promise<void>
  instrumentation?: PlannerAlternativeSearchInstrumentation
  now?: () => number
  onFirstCandidate?: () => void
}): Promise<Phase2C25CSearchRecord> {
  const context = prepared.contexts[workIndex]
  if (!context) throw new Error(`No pre-search context at work index ${workIndex}.`)
  if (context.status !== 'searchable' || context.searchReservation === null) throw new Error(`Context ${context.orientationId}/${context.targetWeaponId} is not searched by the kernel.`)
  const now = options.now ?? (() => performance.now())
  const searchInput = { origin: prepared.prepared.scenario.origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent },
    reservation: context.searchReservation, excludedRouteKeys: context.excludedRouteKeys }
  let first: PlannerAlternativeCandidate | null = null
  const started = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, (candidate) => {
    if (first === null) {
      first = candidate
      options.onFirstCandidate?.()
    }
    return 'stop'
  }, { yieldControl: options.yieldControl, instrumentation: options.instrumentation })
  const elapsedMs = now() - started
  const firstCandidate = first as PlannerAlternativeCandidate | null
  return {
    orientationId: context.orientationId, targetWeaponId: context.targetWeaponId, workIndex, contextDigest: context.contextDigest,
    status: phase2c25aSearchStatus(execution.summary, execution.stoppedByConsumer, execution.summary.deliveredCandidates),
    searchSummary: { ...execution.summary, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length },
    firstCandidateKey: firstCandidate === null ? null : candidateStableKey(firstCandidate),
    elapsedMs,
  }
}

// ---------------------------------------------------------------- outcomes and control contamination

export type Phase2C25CChildOutcome = 'completed' | 'out_of_memory' | 'timeout' | 'process_failure'

export type Phase2C25CRunOutcome =
  | Phase2C25ASearchStatus
  | 'out_of_memory'
  | 'timeout'
  | 'process_failure'
  | 'snapshot_written_then_oom'
  | 'snapshot_failed'

export type Phase2C25CSnapshotFileState = 'complete' | 'partial' | 'not_written' | 'written_before_search'

/**
 * One outcome per run. A sampling run is its Search outcome (or the child failure); a profiling failure is kept in
 * `profilingOutcome`, never folded into a Search status. A snapshot run is `snapshot_written_then_oom` only when a
 * complete near-limit snapshot was written after the Search started and the child then died out of memory; every
 * other near-limit snapshot state is `snapshot_failed`, and a normally ending Search keeps its Search status.
 */
export function classifyPhase2C25CRun(run: {
  kind: 'sampling' | 'snapshot'
  childOutcome: Phase2C25CChildOutcome
  searchStatus: Phase2C25ASearchStatus | null
  profilingFailures?: number
  snapshot?: Phase2C25CSnapshotFileState
}): { outcome: Phase2C25CRunOutcome; profilingOutcome: 'ok' | 'profile_failed' | 'not_applicable' } {
  const profilingOutcome = run.kind === 'sampling' ? ((run.profilingFailures ?? 0) > 0 ? 'profile_failed' as const : 'ok' as const) : 'not_applicable' as const
  if (run.childOutcome === 'completed' && run.searchStatus === null) throw new Error('A completed child must report its Search status.')
  if (run.kind === 'sampling') {
    if (run.childOutcome === 'completed') return { outcome: run.searchStatus as Phase2C25ASearchStatus, profilingOutcome }
    return { outcome: run.childOutcome, profilingOutcome }
  }
  if (run.childOutcome === 'timeout' || run.childOutcome === 'process_failure') return { outcome: run.childOutcome, profilingOutcome }
  if (run.childOutcome === 'out_of_memory') return { outcome: run.snapshot === 'complete' ? 'snapshot_written_then_oom' : 'snapshot_failed', profilingOutcome }
  return { outcome: run.searchStatus as Phase2C25ASearchStatus, profilingOutcome }
}

export interface Phase2C25CControlComparison {
  orientationId: string
  workIndex: number
  statusMatches: boolean
  searchSummaryMatches: boolean
  firstCandidateKeyMatches: boolean
  contaminated: boolean
}

/**
 * Profiler contamination check of one completed control: its termination status, its Search summary and its first
 * Candidate key (hashed with `digest`, as C2.5-A did) must equal the C2.5-A evidence.
 */
export function comparePhase2C25CControl(item: Phase2C25CWorkloadItem, run: { status: string; searchSummary: unknown; firstCandidateKey: string | null } | null,
  digest: (value: string) => string): Phase2C25CControlComparison {
  const statusMatches = run !== null && run.status === item.expected.status
  const searchSummaryMatches = run !== null && stableStringify(run.searchSummary) === stableStringify(item.expected.searchSummary)
  const firstCandidateKeyMatches = run !== null && (run.firstCandidateKey === null ? null : digest(run.firstCandidateKey)) === item.expected.firstCandidateKeySha256
  return { orientationId: item.orientationId, workIndex: item.workIndex, statusMatches, searchSummaryMatches, firstCandidateKeyMatches,
    contaminated: !(statusMatches && searchSummaryMatches && firstCandidateKeyMatches) }
}

/** A stable digest of a workload item, so the raw run records exactly which inputs were profiled. */
export function phase2c25cWorkloadDigest(workload: Phase2C25CWorkload): string {
  return hashStableValue(workload)
}
