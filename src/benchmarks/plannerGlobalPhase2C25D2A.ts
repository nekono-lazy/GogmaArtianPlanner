/**
 * Issue #154 Phase 2-C2.5-D2-a: the Node memory effect of the Ideal-only Planner Alternative publication, Research only.
 * Never import from Production.
 *
 * Phase 2-C2.5-D2-a changed the Planner Alternative held-aware Skill / Bonus publication of `TargetSearchScheduler` to
 * materialize, order, retain and publish only the Ideal absolute positions (the Candidate semantics are unchanged and
 * pinned by the D1 / D2-a tests). This module compares the Search-only runs of this Phase with Phase 2-C2.5-A:
 *
 * ```text
 * C2.5-A evidence -> workload (selectPhase2C25CWorkload(): every Search-only OOM representative + two completed controls)
 *   -> this run's own pre-search context (derivePhase2C25APreSearchContexts(), unchanged) -> field parity with C2.5-A
 *   -> runPhase2C25ASearchOnly() (unchanged): minimal, then instrumented, one fresh 8 GB child each
 *   -> before (C2.5-A evidence) / after (this run) comparison
 * ```
 *
 * Nothing here re-implements a Search, a reservation or a workload rule. Every "before" value is read from the
 * committed C2.5-A evidence; every "after" value comes from the raw run. A child failure is its own status, never "no
 * Candidate". `process.memoryUsage()` samples are sampled maxima, never a true peak.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import {
  PHASE2C25A_CANDIDATE_STOP_BOUND,
  PHASE2C25A_CHILD_HEAP_MB,
  PHASE2C25A_CONCURRENCY,
  PHASE2C25A_RUN_BUDGET_MS,
  PHASE2C25A_SNAPSHOT_POLICY,
  type Phase2C25AMemorySample,
  type Phase2C25AProgressSnapshot,
} from './plannerGlobalPhase2C25A'
import { phase2c25aComparableMetrics, type Phase2C25AComparableMetrics } from './plannerGlobalPhase2C25AAnalysis'
import { PHASE2C25C_WORKLOAD_RULE, type Phase2C25CWorkload, type Phase2C25CWorkloadItem } from './plannerGlobalPhase2C25C'

// ---------------------------------------------------------------- Research constants (the C2.5-A conditions, unchanged)

export const PHASE2C25D2A_CHILD_HEAP_MB = PHASE2C25A_CHILD_HEAP_MB
export const PHASE2C25D2A_CONCURRENCY = PHASE2C25A_CONCURRENCY
export const PHASE2C25D2A_CANDIDATE_STOP_BOUND = PHASE2C25A_CANDIDATE_STOP_BOUND
export const PHASE2C25D2A_RUN_BUDGET_MS = PHASE2C25A_RUN_BUDGET_MS
export const PHASE2C25D2A_SNAPSHOT_POLICY = PHASE2C25A_SNAPSHOT_POLICY
/**
 * The minimal mode has no Search instrumentation. Its child samples `process.memoryUsage()` on a timer outside the
 * Search (the heartbeat interval of the instrumented mode), so both modes report a sampled maximum.
 */
export const PHASE2C25D2A_MINIMAL_MEMORY_HEARTBEAT_MS = PHASE2C25A_SNAPSHOT_POLICY.heartbeatMs
export const PHASE2C25D2A_MODES = ['minimal', 'instrumented'] as const
export type Phase2C25D2AMode = typeof PHASE2C25D2A_MODES[number]
/** The workload rule is Phase 2-C2.5-C's, applied to the same C2.5-A evidence. */
export const PHASE2C25D2A_WORKLOAD_RULE = PHASE2C25C_WORKLOAD_RULE

export type Phase2C25D2AStatus =
  | 'first_candidate'
  | 'stopped_by_extent_before_candidate'
  | 'exhausted_before_candidate'
  | 'out_of_memory'
  | 'timeout'
  | 'process_failure'

const STATUSES: readonly Phase2C25D2AStatus[] = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate', 'out_of_memory', 'timeout', 'process_failure']

// ---------------------------------------------------------------- memory

export interface Phase2C25D2ASampledMemory {
  samples: number
  /** Sampled maxima of `process.memoryUsage()` fields; never a true peak. */
  sampledMax: Pick<Phase2C25AMemorySample, 'heapUsed' | 'heapTotal' | 'rss'> | null
  /** The last sample received (for an OOM child: the last one before the process died). */
  last: Pick<Phase2C25AMemorySample, 'heapUsed' | 'heapTotal' | 'rss'> | null
  lastAtElapsedMs: number | null
}

/** The sampled maxima of a list of memory samples. */
export function phase2c25d2aSampledMemory(samples: readonly { elapsedMs: number; memory: Pick<Phase2C25AMemorySample, 'heapUsed' | 'heapTotal' | 'rss'> }[]): Phase2C25D2ASampledMemory {
  if (samples.length === 0) return { samples: 0, sampledMax: null, last: null, lastAtElapsedMs: null }
  const max = samples.reduce((out, { memory }) => ({ heapUsed: Math.max(out.heapUsed, memory.heapUsed), heapTotal: Math.max(out.heapTotal, memory.heapTotal),
    rss: Math.max(out.rss, memory.rss) }), { heapUsed: 0, heapTotal: 0, rss: 0 })
  const last = samples[samples.length - 1]
  return { samples: samples.length, sampledMax: max, last: { heapUsed: last.memory.heapUsed, heapTotal: last.memory.heapTotal, rss: last.memory.rss }, lastAtElapsedMs: last.elapsedMs }
}

// ---------------------------------------------------------------- the C2.5-A "before" view

export interface Phase2C25D2AV8FatalGc {
  lastGc: { atMs: number; kind: string; beforeMb: number; beforeCommittedMb: number; afterMb: number; afterCommittedMb: number }
  fatal: boolean
}

export interface Phase2C25D2AModeView {
  status: Phase2C25D2AStatus
  searchElapsedMs: number | null
  timeToFirstMs: number | null
  searchSummary: Record<string, unknown> | null
  firstCandidateKeySha256: string | null
  firstCandidate: unknown
  predictionCounts: PlannerAlternativePredictionCounts | null
  predictionCountsAtFirstCandidate: PlannerAlternativePredictionCounts | null
  preSearchMemory: Phase2C25AMemorySample | null
  postSearchMemory: Phase2C25AMemorySample | null
  maxRssKiB: number | null
  heapSizeLimitBytes: number | null
  /** V8's own numbers at the fatal GC of an OOM child (stderr), not a sampled value. */
  v8FatalGc: Phase2C25D2AV8FatalGc | null
}

export interface Phase2C25D2ABefore {
  orientationId: string
  workIndex: number
  classification: string
  minimal: Phase2C25D2AModeView
  instrumented: Phase2C25D2AModeView
  /**
   * The C2.5-A instrumented last snapshot metrics: for an OOM run the last snapshot the parent received before the
   * process died, so its memory values are the last sample / sampled maximum, not the heap at the death.
   */
  instrumentedMetrics: Phase2C25AComparableMetrics | null
  instrumentedLastSnapshot: { elapsedMs: number; memory: Phase2C25AMemorySample; sampledMax: Phase2C25AMemorySample; cumulative: Phase2C25AProgressSnapshot['cumulative']
    maxDepth: { skill: number; gogma: number }; settledWorkItems: number; predictionCounts: PlannerAlternativePredictionCounts } | null
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`C2.5-A evidence: ${where} is not an object.`)
  return value as Record<string, unknown>
}
function num(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`C2.5-A evidence: ${where} is not a finite number.`)
  return value
}
function nullable<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null || value === undefined ? null : read(value)
}
function status(value: unknown, where: string): Phase2C25D2AStatus {
  if (!STATUSES.includes(value as Phase2C25D2AStatus)) throw new Error(`C2.5-A evidence: ${where} status ${String(value)} is unknown.`)
  return value as Phase2C25D2AStatus
}
function counts(value: unknown, where: string): PlannerAlternativePredictionCounts {
  const body = obj(value, where)
  return { predictNormalArtian: num(body.predictNormalArtian, `${where}.predictNormalArtian`), predictSkills: num(body.predictSkills, `${where}.predictSkills`),
    resetBonuses: num(body.resetBonuses, `${where}.resetBonuses`), keepBonuses: num(body.keepBonuses, `${where}.keepBonuses`) }
}
function memory(value: unknown, where: string): Phase2C25AMemorySample {
  const body = obj(value, where)
  return { heapUsed: num(body.heapUsed, `${where}.heapUsed`), heapTotal: num(body.heapTotal, `${where}.heapTotal`), rss: num(body.rss, `${where}.rss`),
    external: num(body.external, `${where}.external`), arrayBuffers: num(body.arrayBuffers, `${where}.arrayBuffers`) }
}

function beforeMode(value: unknown, where: string): Phase2C25D2AModeView {
  const body = obj(value, where)
  return {
    status: status(body.status, where),
    searchElapsedMs: nullable(body.searchElapsedMs, v => num(v, `${where}.searchElapsedMs`)),
    timeToFirstMs: nullable(body.timeToFirstMs, v => num(v, `${where}.timeToFirstMs`)),
    searchSummary: nullable(body.searchSummary, v => obj(v, `${where}.searchSummary`)),
    firstCandidateKeySha256: nullable(body.firstCandidateKeySha256, v => { if (typeof v !== 'string') throw new Error(`C2.5-A evidence: ${where}.firstCandidateKeySha256 is not a string.`); return v }),
    firstCandidate: body.firstCandidate ?? null,
    predictionCounts: nullable(body.predictionCounts, v => counts(v, `${where}.predictionCounts`)),
    predictionCountsAtFirstCandidate: nullable(body.predictionCountsAtFirstCandidate, v => counts(v, `${where}.predictionCountsAtFirstCandidate`)),
    preSearchMemory: nullable(body.preSearchMemory, v => memory(v, `${where}.preSearchMemory`)),
    postSearchMemory: nullable(body.postSearchMemory, v => memory(v, `${where}.postSearchMemory`)),
    maxRssKiB: nullable(body.maxRssKiB, v => num(v, `${where}.maxRssKiB`)),
    heapSizeLimitBytes: nullable(body.heapSizeLimitBytes, v => num(v, `${where}.heapSizeLimitBytes`)),
    v8FatalGc: (body.v8FatalGc ?? null) as Phase2C25D2AV8FatalGc | null,
  }
}

/**
 * The C2.5-A "before" record of every workload item, read from the committed evidence `contexts` at the item's
 * `evidenceIndex`, failing closed when the evidence names another context there.
 */
export function parsePhase2C25D2ABefore(evidence: unknown, items: readonly Phase2C25CWorkloadItem[]): Map<string, Phase2C25D2ABefore> {
  const root = obj(evidence, 'root')
  if (!Array.isArray(root.contexts)) throw new Error('C2.5-A evidence: contexts is not an array.')
  const out = new Map<string, Phase2C25D2ABefore>()
  for (const item of items) {
    const where = `contexts[${item.evidenceIndex}]`
    const body = obj(root.contexts[item.evidenceIndex], where)
    if (body.orientationId !== item.orientationId || body.workIndex !== item.workIndex || body.targetWeaponId !== item.targetWeaponId) {
      throw new Error(`C2.5-A evidence: ${where} is not ${item.orientationId}#${item.workIndex}.`)
    }
    const growth = body.growth === null || body.growth === undefined ? null : obj(body.growth, `${where}.growth`)
    const last = growth === null ? null : obj(growth.lastSnapshot, `${where}.growth.lastSnapshot`)
    out.set(phase2c25d2aItemKey(item), {
      orientationId: item.orientationId, workIndex: item.workIndex, classification: String(body.classification),
      minimal: beforeMode(body.minimal, `${where}.minimal`), instrumented: beforeMode(body.instrumented, `${where}.instrumented`),
      instrumentedMetrics: (body.metrics ?? null) as Phase2C25AComparableMetrics | null,
      instrumentedLastSnapshot: last === null ? null : {
        elapsedMs: num(last.elapsedMs, `${where}.growth.lastSnapshot.elapsedMs`), memory: memory(last.memory, `${where}.growth.lastSnapshot.memory`),
        sampledMax: memory(last.sampledMax, `${where}.growth.lastSnapshot.sampledMax`),
        cumulative: last.cumulative as Phase2C25AProgressSnapshot['cumulative'], maxDepth: last.maxDepth as { skill: number; gogma: number },
        settledWorkItems: num(last.settledWorkItems, `${where}.growth.lastSnapshot.settledWorkItems`), predictionCounts: counts(last.predictionCounts, `${where}.growth.lastSnapshot.predictionCounts`),
      },
    })
  }
  return out
}

export function phase2c25d2aItemKey(item: Pick<Phase2C25CWorkloadItem, 'orientationId' | 'workIndex'>): string {
  return `${item.orientationId}#${item.workIndex}`
}

// ---------------------------------------------------------------- the "after" view of this run

export interface Phase2C25D2AAfter {
  mode: Phase2C25D2AMode
  view: Phase2C25D2AModeView
  memory: Phase2C25D2ASampledMemory
  /** Instrumented mode: the last snapshot's comparable metrics (for an OOM, the last one received before the death). */
  metrics: Phase2C25AComparableMetrics | null
  /** Instrumented mode: the last full snapshot's per-depth maxima. */
  gogmaDepthMaxima: { maxGeneratedStatesPerDepth: number; depthOfMaxGeneratedStates: number | null; reachedDepths: number } | null
  /** Instrumented mode: the prediction counts of the last snapshot (the only counts an OOM run leaves). */
  lastSnapshotPredictionCounts: PlannerAlternativePredictionCounts | null
}

/**
 * One mode of one context in this run, from what the parent received: the final record (if any), the child outcome,
 * the memory samples and, for the instrumented mode, the last full progress snapshot.
 */
export function phase2c25d2aAfter(mode: Phase2C25D2AMode, run: {
  status: Phase2C25D2AStatus
  ready: { preSearchMemory: Phase2C25AMemorySample; heapSizeLimitBytes: number } | null
  final: null | { record: { elapsedMs: number; timeToFirstMs: number | null; searchSummary: Record<string, unknown>; firstCandidateKeySha256: string | null; firstCandidateSummary: unknown
    predictionCounts: PlannerAlternativePredictionCounts | null; predictionCountsAtFirstCandidate: PlannerAlternativePredictionCounts | null }; postSearchMemory: Phase2C25AMemorySample; maxRssKiB: number }
  memorySamples: readonly { elapsedMs: number; memory: Pick<Phase2C25AMemorySample, 'heapUsed' | 'heapTotal' | 'rss'> }[]
  lastSnapshot: Phase2C25AProgressSnapshot | null
  v8FatalGc: Phase2C25D2AV8FatalGc | null
}): Phase2C25D2AAfter {
  const record = run.final?.record ?? null
  const gogmaDepths = run.lastSnapshot?.gogmaDepths ?? null
  const maxGenerated = gogmaDepths === null ? 0 : gogmaDepths.reduce((max, depth) => Math.max(max, depth.generatedStates), 0)
  return {
    mode,
    view: {
      status: run.status, searchElapsedMs: record?.elapsedMs ?? null, timeToFirstMs: record?.timeToFirstMs ?? null, searchSummary: record?.searchSummary ?? null,
      firstCandidateKeySha256: record?.firstCandidateKeySha256 ?? null, firstCandidate: record?.firstCandidateSummary ?? null,
      predictionCounts: record?.predictionCounts ?? null, predictionCountsAtFirstCandidate: record?.predictionCountsAtFirstCandidate ?? null,
      preSearchMemory: run.ready?.preSearchMemory ?? null, postSearchMemory: run.final?.postSearchMemory ?? null, maxRssKiB: run.final?.maxRssKiB ?? null,
      heapSizeLimitBytes: run.ready?.heapSizeLimitBytes ?? null, v8FatalGc: run.v8FatalGc,
    },
    // The pre-Search sample ("ready") and the post-Search sample ("final") belong to the same sampled series.
    memory: phase2c25d2aSampledMemory([
      ...(run.ready === null ? [] : [{ elapsedMs: 0, memory: run.ready.preSearchMemory }]),
      ...run.memorySamples,
      ...(run.final === null ? [] : [{ elapsedMs: run.final.record.elapsedMs, memory: run.final.postSearchMemory }]),
    ]),
    metrics: run.lastSnapshot === null ? null : phase2c25aComparableMetrics(run.lastSnapshot),
    gogmaDepthMaxima: gogmaDepths === null ? null : { maxGeneratedStatesPerDepth: maxGenerated,
      depthOfMaxGeneratedStates: gogmaDepths.find(depth => depth.generatedStates === maxGenerated)?.depth ?? null, reachedDepths: gogmaDepths.length },
    lastSnapshotPredictionCounts: run.lastSnapshot?.predictionCounts ?? null,
  }
}

// ---------------------------------------------------------------- control semantic parity

export interface Phase2C25D2AControlParity {
  orientationId: string
  workIndex: number
  mode: Phase2C25D2AMode
  statusMatches: boolean
  searchSummaryMatches: boolean
  firstCandidateKeyMatches: boolean
  /** Instrumented mode only (`null` in minimal, which counts nothing). */
  predictionCountsMatch: boolean | null
  extentAndExhaustionMatch: boolean
  matches: boolean
}

/**
 * A completed control of this run against C2.5-A: status, Search summary, first Candidate key digest, prediction
 * counts (instrumented) and the extent / exhausted flags must all be equal. Any difference is a Search semantic change,
 * a Required failure that outranks every memory result.
 */
export function comparePhase2C25D2AControl(item: Pick<Phase2C25CWorkloadItem, 'orientationId' | 'workIndex'>, mode: Phase2C25D2AMode,
  before: Phase2C25D2AModeView, after: Phase2C25D2AModeView): Phase2C25D2AControlParity {
  const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right)
  const flags = (summary: Record<string, unknown> | null) => summary === null ? null : { exhausted: summary.exhausted, stoppedByExtent: summary.stoppedByExtent }
  const statusMatches = before.status === after.status
  const searchSummaryMatches = same(before.searchSummary, after.searchSummary)
  const firstCandidateKeyMatches = before.firstCandidateKeySha256 === after.firstCandidateKeySha256
  const predictionCountsMatch = mode === 'minimal' ? null : same(before.predictionCounts, after.predictionCounts)
  const extentAndExhaustionMatch = same(flags(before.searchSummary), flags(after.searchSummary))
  return { orientationId: item.orientationId, workIndex: item.workIndex, mode, statusMatches, searchSummaryMatches, firstCandidateKeyMatches, predictionCountsMatch,
    extentAndExhaustionMatch, matches: statusMatches && searchSummaryMatches && firstCandidateKeyMatches && predictionCountsMatch !== false && extentAndExhaustionMatch }
}

// ---------------------------------------------------------------- before / after comparison rows

export interface Phase2C25D2AComparisonRow {
  orientationId: string
  workIndex: number
  role: Phase2C25CWorkloadItem['role']
  mode: Phase2C25D2AMode
  status: { before: Phase2C25D2AStatus; after: Phase2C25D2AStatus }
  /**
   * Before: the C2.5-A instrumented sampled maximum (its last snapshot for an OOM); the C2.5-A minimal mode sampled no
   * memory, so its before value is `null`. After: this run's sampled maximum. Neither is a true peak.
   */
  sampledMaxHeapUsed: { before: number | null; after: number | null }
  sampledMaxHeapTotal: { before: number | null; after: number | null }
  sampledMaxRss: { before: number | null; after: number | null }
  /** V8's heap at the fatal GC (MB, before the collection) of an OOM child; `null` otherwise. */
  v8FatalGcBeforeMb: { before: number | null; after: number | null }
  maxRssKiB: { before: number | null; after: number | null }
  gogmaMaxDepth: { before: number | null; after: number | null }
  skillMaxDepth: { before: number | null; after: number | null }
  cumulativeGogmaGenerated: { before: number | null; after: number | null }
  cumulativeGogmaFrontier: { before: number | null; after: number | null }
  settledWorkItems: { before: number | null; after: number | null }
  predictionCounts: { before: PlannerAlternativePredictionCounts | null; after: PlannerAlternativePredictionCounts | null }
  timeToFirstMs: { before: number | null; after: number | null }
  searchElapsedMs: { before: number | null; after: number | null }
}

export function phase2c25d2aComparisonRow(item: Pick<Phase2C25CWorkloadItem, 'orientationId' | 'workIndex' | 'role'>, mode: Phase2C25D2AMode,
  before: Phase2C25D2ABefore, after: Phase2C25D2AAfter): Phase2C25D2AComparisonRow {
  const beforeView = mode === 'minimal' ? before.minimal : before.instrumented
  const beforeMetrics = mode === 'instrumented' ? before.instrumentedMetrics : null
  const beforeSampled = mode === 'instrumented' ? before.instrumentedLastSnapshot?.sampledMax ?? null : null
  // A completed instrumented run's counts are the final record's; an OOM run's are its last snapshot's.
  const beforeCounts = beforeView.predictionCounts ?? (mode === 'instrumented' ? before.instrumentedLastSnapshot?.predictionCounts ?? null : null)
  const afterCounts = after.view.predictionCounts ?? after.lastSnapshotPredictionCounts
  return {
    orientationId: item.orientationId, workIndex: item.workIndex, role: item.role, mode,
    status: { before: beforeView.status, after: after.view.status },
    sampledMaxHeapUsed: { before: beforeSampled?.heapUsed ?? null, after: after.memory.sampledMax?.heapUsed ?? null },
    sampledMaxHeapTotal: { before: beforeSampled?.heapTotal ?? null, after: after.memory.sampledMax?.heapTotal ?? null },
    sampledMaxRss: { before: beforeSampled?.rss ?? null, after: after.memory.sampledMax?.rss ?? null },
    v8FatalGcBeforeMb: { before: beforeView.v8FatalGc?.lastGc.beforeMb ?? null, after: after.view.v8FatalGc?.lastGc.beforeMb ?? null },
    maxRssKiB: { before: beforeView.maxRssKiB, after: after.view.maxRssKiB },
    gogmaMaxDepth: { before: beforeMetrics?.gogmaMaxDepth ?? null, after: after.metrics?.gogmaMaxDepth ?? null },
    skillMaxDepth: { before: beforeMetrics?.skillMaxDepth ?? null, after: after.metrics?.skillMaxDepth ?? null },
    cumulativeGogmaGenerated: { before: beforeMetrics?.cumulativeGogmaGenerated ?? null, after: after.metrics?.cumulativeGogmaGenerated ?? null },
    cumulativeGogmaFrontier: { before: beforeMetrics?.cumulativeGogmaFrontier ?? null, after: after.metrics?.cumulativeGogmaFrontier ?? null },
    settledWorkItems: { before: beforeMetrics?.settledWorkItems ?? null, after: after.metrics?.settledWorkItems ?? null },
    predictionCounts: { before: beforeCounts, after: afterCounts },
    timeToFirstMs: { before: beforeView.timeToFirstMs, after: after.view.timeToFirstMs },
    searchElapsedMs: { before: beforeView.searchElapsedMs, after: after.view.searchElapsedMs },
  }
}

/**
 * The outcome of one OOM representative after D2-a, as a plain statement of what it reached. A normal ending is
 * reported as the ending it is (first Candidate, extent stop, exhaustion), never as "memory issue solved".
 */
export function phase2c25d2aOomOutcome(minimal: Phase2C25D2AStatus, instrumented: Phase2C25D2AStatus): {
  leftOom: boolean
  consistent: boolean
  reached: Phase2C25D2AStatus | 'modes_differ'
} {
  const leftOom = minimal !== 'out_of_memory' && instrumented !== 'out_of_memory'
  return { leftOom, consistent: minimal === instrumented, reached: minimal === instrumented ? minimal : 'modes_differ' }
}

/** The measured workload items in run order: OOM representatives, then the controls. */
export function phase2c25d2aWorkloadItems(workload: Phase2C25CWorkload): Phase2C25CWorkloadItem[] {
  return [...workload.oomRepresentatives, ...workload.controls]
}

// ---------------------------------------------------------------- post-hoc analysis of one raw run

export interface Phase2C25D2ARawMode {
  status: Phase2C25D2AStatus
  childOutcome: string
  ready: { preSearchMemory: Phase2C25AMemorySample; heapSizeLimitBytes: number; preparationMs: number } | null
  final: null | {
    record: { elapsedMs: number; timeToFirstMs: number | null; searchSummary: Record<string, unknown>; firstCandidateKeySha256: string | null; firstCandidateSummary: unknown
      predictionCounts: PlannerAlternativePredictionCounts | null; predictionCountsAtFirstCandidate: PlannerAlternativePredictionCounts | null }
    postSearchMemory: Phase2C25AMemorySample
    maxRssKiB: number
  }
  memorySamples: { elapsedMs: number; memory: Phase2C25AMemorySample }[]
  lastSnapshot: Phase2C25AProgressSnapshot | null
  snapshots: number
  v8FatalGc: Phase2C25D2AV8FatalGc | null
  process: { wallMs: number; exitCode: number | null; signal: string | null; timedOut: boolean }
}

export interface Phase2C25D2ARawRun {
  runs: { item: Phase2C25CWorkloadItem; modes: Partial<Record<Phase2C25D2AMode, Phase2C25D2ARawMode>> }[]
}

function semanticDigest(view: Phase2C25D2AModeView): string | null {
  if (view.searchSummary === null) return null
  return stableStringify({ status: view.status, summary: view.searchSummary, firstCandidateKeySha256: view.firstCandidateKeySha256 })
}

/**
 * The formal before / after comparison of one raw D2-a run against the C2.5-A evidence: per context and mode the
 * after view, the comparison row, the control semantic parity, and per OOM representative what it reached.
 */
export function analyzePhase2C25D2ARun(raw: Phase2C25D2ARawRun, c25aEvidence: unknown) {
  const before = parsePhase2C25D2ABefore(c25aEvidence, raw.runs.map(run => run.item))
  const contexts = raw.runs.map(({ item, modes }) => {
    const prior = before.get(phase2c25d2aItemKey(item)) as Phase2C25D2ABefore
    const after = Object.fromEntries(PHASE2C25D2A_MODES.filter(mode => modes[mode] !== undefined).map(mode => {
      const m = modes[mode] as Phase2C25D2ARawMode
      return [mode, phase2c25d2aAfter(mode, { status: m.status, ready: m.ready, final: m.final, memorySamples: m.memorySamples, lastSnapshot: m.lastSnapshot, v8FatalGc: m.v8FatalGc })]
    })) as Partial<Record<Phase2C25D2AMode, Phase2C25D2AAfter>>
    const rows = PHASE2C25D2A_MODES.filter(mode => after[mode] !== undefined).map(mode => phase2c25d2aComparisonRow(item, mode, prior, after[mode] as Phase2C25D2AAfter))
    const controlParity = item.role === 'oom_representative' ? null
      : PHASE2C25D2A_MODES.filter(mode => after[mode] !== undefined).map(mode =>
        comparePhase2C25D2AControl(item, mode, mode === 'minimal' ? prior.minimal : prior.instrumented, (after[mode] as Phase2C25D2AAfter).view))
    const minimalDigest = after.minimal === undefined ? null : semanticDigest(after.minimal.view)
    const instrumentedDigest = after.instrumented === undefined ? null : semanticDigest(after.instrumented.view)
    return {
      orientationId: item.orientationId, workIndex: item.workIndex, role: item.role, kind: item.kind, targetWeaponId: item.targetWeaponId,
      before: { classification: prior.classification, minimalStatus: prior.minimal.status, instrumentedStatus: prior.instrumented.status },
      after, rows, controlParity,
      modeSemanticParity: minimalDigest === null || instrumentedDigest === null ? null : minimalDigest === instrumentedDigest,
      oomOutcome: item.role === 'oom_representative' && after.minimal !== undefined && after.instrumented !== undefined
        ? phase2c25d2aOomOutcome(after.minimal.view.status, after.instrumented.view.status) : null,
    }
  })
  const oom = contexts.filter(context => context.role === 'oom_representative')
  const controls = contexts.filter(context => context.role !== 'oom_representative')
  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {})
  return {
    totals: {
      contexts: contexts.length, oomRepresentatives: oom.length, controls: controls.length,
      oomRepresentativesLeftOom: oom.filter(context => context.oomOutcome?.leftOom === true).length,
      oomRepresentativeOutcomes: count(oom.map(context => context.oomOutcome?.reached ?? 'not_run')),
      controlsSemanticParity: controls.every(context => context.controlParity !== null && context.controlParity.every(row => row.matches)),
      modeSemanticParityFailures: contexts.filter(context => context.modeSemanticParity === false).length,
    },
    contexts,
  }
}
