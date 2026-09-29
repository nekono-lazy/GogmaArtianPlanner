/**
 * Issue #154 Phase 2-C2.5-D2-d: the Node memory / runtime effect of the single-pass held-aware Bonus stream (H1),
 * Research only. Never import from Production.
 *
 * Phase 2-C2.5-D2-c named H1 the primary optimization: the held-aware Bonus stream kept every raw solution of every
 * past depth in `set.depths`. D2-d removed that retention alone (`docs/SEARCH_SPEC.md` 5.6.8 single-pass consumer
 * contract; `steps[]`, the generation burst, the Skill stream and the ordinary Search are unchanged). This module
 * compares the Search-only runs of this Phase with the D2-a after-values (the same Search-only conditions) and, as a
 * reference, with the D2-c jit_default sampling runs (a profiler was attached there):
 *
 * ```text
 * D2-a RESULT + C2.5-A evidence -> workload (selectPhase2C25D2CWorkload(), unchanged) == D2-c RESULT workload
 *   -> this run's own pre-search context (the D2-a `contexts` child, unchanged) -> parity with C2.5-A and D2-a
 *   -> the D2-a `search` child (unchanged): minimal, then instrumented, one fresh 8 GB child each
 *   -> before (D2-a after-values, D2-c reference) / after (this run)
 * ```
 *
 * Nothing here re-implements a Search, a reservation, a workload rule or a child. Every "before" value is read from
 * the committed evidence; every "after" value comes from the raw run. A child failure is its own status, never "no
 * Candidate". `process.memoryUsage()` samples are sampled maxima, never a true peak.
 *
 * This module reads no file. The runner and the analyzer pass what they read; every ID comes from that evidence.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import {
  comparePhase2C25D2AControl,
  phase2c25d2aAfter,
  PHASE2C25D2A_CANDIDATE_STOP_BOUND,
  PHASE2C25D2A_CHILD_HEAP_MB,
  PHASE2C25D2A_CONCURRENCY,
  PHASE2C25D2A_MINIMAL_MEMORY_HEARTBEAT_MS,
  PHASE2C25D2A_MODES,
  PHASE2C25D2A_RUN_BUDGET_MS,
  PHASE2C25D2A_SNAPSHOT_POLICY,
  type Phase2C25D2AAfter,
  type Phase2C25D2AControlParity,
  type Phase2C25D2AMode,
  type Phase2C25D2ARawMode,
  type Phase2C25D2AStatus,
} from './plannerGlobalPhase2C25D2A'
import {
  phase2c25d2cWorkloadItems,
  type Phase2C25D2CWorkload,
  type Phase2C25D2CWorkloadItem,
} from './plannerGlobalPhase2C25D2C'

// ---------------------------------------------------------------- Research constants (the D2-a conditions, unchanged)

export const PHASE2C25D2D_CHILD_HEAP_MB = PHASE2C25D2A_CHILD_HEAP_MB
export const PHASE2C25D2D_CONCURRENCY = PHASE2C25D2A_CONCURRENCY
export const PHASE2C25D2D_CANDIDATE_STOP_BOUND = PHASE2C25D2A_CANDIDATE_STOP_BOUND
/** 20 minutes, the C2.5-A authority (`PHASE2C25A_RUN_BUDGET_MS`), fixed before the formal run. */
export const PHASE2C25D2D_RUN_BUDGET_MS = PHASE2C25D2A_RUN_BUDGET_MS
export const PHASE2C25D2D_SNAPSHOT_POLICY = PHASE2C25D2A_SNAPSHOT_POLICY
export const PHASE2C25D2D_MINIMAL_MEMORY_HEARTBEAT_MS = PHASE2C25D2A_MINIMAL_MEMORY_HEARTBEAT_MS
export const PHASE2C25D2D_MODES = PHASE2C25D2A_MODES
export type Phase2C25D2DMode = Phase2C25D2AMode
export type Phase2C25D2DStatus = Phase2C25D2AStatus

/** The workload is the D2-c one (same rule over the same D2-a RESULT); the runner also checks it equals the D2-c RESULT's. */
export function phase2c25d2dWorkloadItems(workload: Phase2C25D2CWorkload): Phase2C25D2CWorkloadItem[] {
  return phase2c25d2cWorkloadItems(workload)
}

export function phase2c25d2dItemKey(item: Pick<Phase2C25D2CWorkloadItem, 'orientationId' | 'workIndex'>): string {
  return `${item.orientationId}#${item.workIndex}`
}

// ---------------------------------------------------------------- evidence readers

function fail(source: string, where: string, message: string): never {
  throw new Error(`${source}: ${where} ${message}`)
}
function obj(value: unknown, source: string, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(source, where, 'is not an object.')
  return value as Record<string, unknown>
}
function arr(value: unknown, source: string, where: string): unknown[] {
  if (!Array.isArray(value)) fail(source, where, 'is not an array.')
  return value
}

const STATUSES: readonly Phase2C25D2DStatus[] = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate', 'out_of_memory', 'timeout', 'process_failure']
const NORMAL_ENDINGS: readonly Phase2C25D2DStatus[] = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate']

/**
 * The D2-a after-values of every workload item, read from the committed D2-a RESULT at the item's `d2aIndex`, failing
 * closed when the RESULT names another context there or a mode is missing.
 */
export function parsePhase2C25D2DD2ABefore(d2aResult: unknown, items: readonly Phase2C25D2CWorkloadItem[]): Map<string, Record<Phase2C25D2DMode, Phase2C25D2AAfter>> {
  const source = 'D2-a RESULT'
  const root = obj(d2aResult, source, 'root')
  if (obj(root.provenance, source, 'provenance').formal !== true) fail(source, 'provenance.formal', 'is not true.')
  const contexts = arr(root.contexts, source, 'contexts')
  const out = new Map<string, Record<Phase2C25D2DMode, Phase2C25D2AAfter>>()
  for (const item of items) {
    const where = `contexts[${item.d2aIndex}]`
    const body = obj(contexts[item.d2aIndex], source, where)
    if (body.orientationId !== item.orientationId || body.workIndex !== item.workIndex || body.targetWeaponId !== item.targetWeaponId) {
      fail(source, where, `is not ${phase2c25d2dItemKey(item)}.`)
    }
    const after = obj(body.after, source, `${where}.after`)
    const modes = Object.fromEntries(PHASE2C25D2D_MODES.map(mode => {
      const value = obj(after[mode], source, `${where}.after.${mode}`)
      const view = obj(value.view, source, `${where}.after.${mode}.view`)
      if (value.mode !== mode) fail(source, `${where}.after.${mode}.mode`, `is ${String(value.mode)}.`)
      if (!STATUSES.includes(view.status as Phase2C25D2DStatus)) fail(source, `${where}.after.${mode}.view.status`, `${String(view.status)} is unknown.`)
      obj(value.memory, source, `${where}.after.${mode}.memory`)
      return [mode, value as unknown as Phase2C25D2AAfter]
    })) as Record<Phase2C25D2DMode, Phase2C25D2AAfter>
    out.set(phase2c25d2dItemKey(item), modes)
  }
  return out
}

/** The D2-c jit_default sampling run of one context (a profiler was attached: reference only, never a parity baseline). */
export interface Phase2C25D2DD2CReference {
  runId: string
  outcome: string
  wallMs: number | null
  heapSizeLimitBytes: number | null
  lastProgress: null | {
    elapsedMs: number | null
    heapUsed: number | null
    rss: number | null
    maxDepth: { skill: number | null; gogma: number | null }
    cumulative: { gogmaGeneratedStates: number | null; gogmaFrontierStates: number | null; skillStates: number | null }
    maxGeneratedStatesInOneDepth: number | null
    depthOfMaxGenerated: number | null
  }
}

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * The D2-c workload items (for the equality check with this run's workload) and the jit_default sampling run of
 * every item. Fails closed on a non-formal RESULT, a missing workload or a missing jit_default run.
 */
export function parsePhase2C25D2DD2CResult(d2cResult: unknown) {
  const source = 'D2-c RESULT'
  const root = obj(d2cResult, source, 'root')
  const provenance = obj(root.provenance, source, 'provenance')
  if (provenance.formal !== true) fail(source, 'provenance.formal', 'is not true.')
  const workload = obj(root.workload, source, 'workload')
  const items = ['primary', 'clearedReferences', 'controls'].flatMap(key => arr(workload[key], source, `workload.${key}`).map((raw, index) => {
    const body = obj(raw, source, `workload.${key}[${index}]`)
    return { role: String(body.role), orientationId: String(body.orientationId), workIndex: Number(body.workIndex), targetWeaponId: String(body.targetWeaponId),
      contextDigest: String(body.contextDigest) }
  }))
  const references = new Map<string, Phase2C25D2DD2CReference>()
  for (const [index, raw] of arr(root.samplingRuns, source, 'samplingRuns').entries()) {
    const run = obj(raw, source, `samplingRuns[${index}]`)
    if (run.variant !== 'jit_default') continue
    const last = run.lastProgress === null || run.lastProgress === undefined ? null : obj(run.lastProgress, source, `samplingRuns[${index}].lastProgress`)
    const memory = last === null ? null : obj(last.memory, source, `samplingRuns[${index}].lastProgress.memory`)
    const maxDepth = last === null ? null : obj(last.maxDepth, source, `samplingRuns[${index}].lastProgress.maxDepth`)
    const cumulative = last === null ? null : obj(last.cumulative, source, `samplingRuns[${index}].lastProgress.cumulative`)
    const maxima = last === null || last.gogmaDepthMaxima === null || last.gogmaDepthMaxima === undefined ? null
      : obj(last.gogmaDepthMaxima, source, `samplingRuns[${index}].lastProgress.gogmaDepthMaxima`)
    references.set(String(run.contextKey), {
      runId: String(run.runId), outcome: String(run.outcome), wallMs: numberOrNull(run.wallMs), heapSizeLimitBytes: numberOrNull(run.heapSizeLimitBytes),
      lastProgress: last === null ? null : {
        elapsedMs: numberOrNull(last.elapsedMs), heapUsed: numberOrNull(memory?.heapUsed), rss: numberOrNull(memory?.rss),
        maxDepth: { skill: numberOrNull(maxDepth?.skill), gogma: numberOrNull(maxDepth?.gogma) },
        cumulative: { gogmaGeneratedStates: numberOrNull(cumulative?.gogmaGeneratedStates), gogmaFrontierStates: numberOrNull(cumulative?.gogmaFrontierStates),
          skillStates: numberOrNull(cumulative?.skillStates) },
        maxGeneratedStatesInOneDepth: numberOrNull(maxima?.maxGeneratedStatesInOneDepth), depthOfMaxGenerated: numberOrNull(maxima?.depthOfMaxGenerated),
      },
    })
  }
  return { items, references, measuredHead: String(provenance.measuredHead) }
}

/** The run's workload must be exactly the D2-c one (role, context, target, digest, order). */
export function assertPhase2C25D2DWorkloadMatchesD2C(workload: Phase2C25D2CWorkload, d2cItems: ReturnType<typeof parsePhase2C25D2DD2CResult>['items']): void {
  const mine = phase2c25d2dWorkloadItems(workload).map(item => ({ role: item.role, orientationId: item.orientationId, workIndex: item.workIndex,
    targetWeaponId: item.targetWeaponId, contextDigest: item.contextDigest }))
  if (stableStringify(mine) !== stableStringify(d2cItems)) throw new Error('The D2-d workload differs from the D2-c RESULT workload.')
}

// ---------------------------------------------------------------- comparison

/** `before` / `d2c` / `after` of one number (the D2-c value is a profiled reference, `null` where it has none). */
export interface Phase2C25D2DValue<T = number | null> { d2a: T; d2c: T; d2d: T }

export interface Phase2C25D2DComparisonRow {
  orientationId: string
  workIndex: number
  role: Phase2C25D2CWorkloadItem['role']
  mode: Phase2C25D2DMode
  status: Phase2C25D2DValue<string | null>
  sampledMaxHeapUsed: Phase2C25D2DValue
  sampledMaxHeapTotal: Phase2C25D2DValue
  sampledMaxRss: Phase2C25D2DValue
  lastSampleHeapUsed: Phase2C25D2DValue
  lastSampleAtElapsedMs: Phase2C25D2DValue
  /** V8's heap at the fatal GC (MB, before the collection) of an OOM child. */
  v8FatalGcBeforeMb: Phase2C25D2DValue
  maxRssKiB: Phase2C25D2DValue
  gogmaMaxDepth: Phase2C25D2DValue
  skillMaxDepth: Phase2C25D2DValue
  cumulativeGogmaGenerated: Phase2C25D2DValue
  cumulativeGogmaFrontier: Phase2C25D2DValue
  cumulativeSkillStates: Phase2C25D2DValue
  maxGogmaGeneratedPerDepth: Phase2C25D2DValue
  depthOfMaxGogmaGenerated: Phase2C25D2DValue
  settledWorkItems: Phase2C25D2DValue
  predictionCounts: { d2a: PlannerAlternativePredictionCounts | null; d2d: PlannerAlternativePredictionCounts | null }
  timeToFirstMs: Phase2C25D2DValue
  searchElapsedMs: Phase2C25D2DValue
}

/**
 * One (context, mode) row. The D2-c column is filled for the instrumented mode only (its sampling child ran the same
 * progress observer), and only as a profiled reference.
 */
export function phase2c25d2dComparisonRow(item: Pick<Phase2C25D2CWorkloadItem, 'orientationId' | 'workIndex' | 'role'>, mode: Phase2C25D2DMode,
  d2a: Phase2C25D2AAfter, d2c: Phase2C25D2DD2CReference | null, d2d: Phase2C25D2AAfter): Phase2C25D2DComparisonRow {
  const ref = mode === 'instrumented' ? d2c : null
  const last = ref?.lastProgress ?? null
  const v = <T>(a: T, c: T, d: T): Phase2C25D2DValue<T> => ({ d2a: a, d2c: c, d2d: d })
  return {
    orientationId: item.orientationId, workIndex: item.workIndex, role: item.role, mode,
    status: v<string | null>(d2a.view.status, ref?.outcome ?? null, d2d.view.status),
    sampledMaxHeapUsed: v(d2a.memory.sampledMax?.heapUsed ?? null, null, d2d.memory.sampledMax?.heapUsed ?? null),
    sampledMaxHeapTotal: v(d2a.memory.sampledMax?.heapTotal ?? null, null, d2d.memory.sampledMax?.heapTotal ?? null),
    sampledMaxRss: v(d2a.memory.sampledMax?.rss ?? null, null, d2d.memory.sampledMax?.rss ?? null),
    lastSampleHeapUsed: v(d2a.memory.last?.heapUsed ?? null, last?.heapUsed ?? null, d2d.memory.last?.heapUsed ?? null),
    lastSampleAtElapsedMs: v(d2a.memory.lastAtElapsedMs, last?.elapsedMs ?? null, d2d.memory.lastAtElapsedMs),
    v8FatalGcBeforeMb: v(d2a.view.v8FatalGc?.lastGc.beforeMb ?? null, null, d2d.view.v8FatalGc?.lastGc.beforeMb ?? null),
    maxRssKiB: v(d2a.view.maxRssKiB, null, d2d.view.maxRssKiB),
    gogmaMaxDepth: v(d2a.metrics?.gogmaMaxDepth ?? null, last?.maxDepth.gogma ?? null, d2d.metrics?.gogmaMaxDepth ?? null),
    skillMaxDepth: v(d2a.metrics?.skillMaxDepth ?? null, last?.maxDepth.skill ?? null, d2d.metrics?.skillMaxDepth ?? null),
    cumulativeGogmaGenerated: v(d2a.metrics?.cumulativeGogmaGenerated ?? null, last?.cumulative.gogmaGeneratedStates ?? null, d2d.metrics?.cumulativeGogmaGenerated ?? null),
    cumulativeGogmaFrontier: v(d2a.metrics?.cumulativeGogmaFrontier ?? null, last?.cumulative.gogmaFrontierStates ?? null, d2d.metrics?.cumulativeGogmaFrontier ?? null),
    cumulativeSkillStates: v(d2a.metrics?.cumulativeSkillStates ?? null, last?.cumulative.skillStates ?? null, d2d.metrics?.cumulativeSkillStates ?? null),
    maxGogmaGeneratedPerDepth: v(d2a.gogmaDepthMaxima?.maxGeneratedStatesPerDepth ?? null, null, d2d.gogmaDepthMaxima?.maxGeneratedStatesPerDepth ?? null),
    depthOfMaxGogmaGenerated: v(d2a.gogmaDepthMaxima?.depthOfMaxGeneratedStates ?? null, null, d2d.gogmaDepthMaxima?.depthOfMaxGeneratedStates ?? null),
    settledWorkItems: v(d2a.metrics?.settledWorkItems ?? null, null, d2d.metrics?.settledWorkItems ?? null),
    predictionCounts: { d2a: d2a.view.predictionCounts ?? d2a.lastSnapshotPredictionCounts, d2d: d2d.view.predictionCounts ?? d2d.lastSnapshotPredictionCounts },
    timeToFirstMs: v(d2a.view.timeToFirstMs, null, d2d.view.timeToFirstMs),
    searchElapsedMs: v(d2a.view.searchElapsedMs, null, d2d.view.searchElapsedMs),
  }
}

/**
 * The outcome of one primary (D2-a OOM) context after H1, as the plain ending it reached. A normal ending is the
 * ending it is; a timeout is a runtime limit that became visible, never "solved"; an OOM is still an OOM.
 */
export function phase2c25d2dPrimaryOutcome(minimal: Phase2C25D2DStatus, instrumented: Phase2C25D2DStatus): {
  leftOom: boolean
  endedNormally: boolean
  consistent: boolean
  reached: Phase2C25D2DStatus | 'modes_differ'
} {
  return {
    leftOom: minimal !== 'out_of_memory' && instrumented !== 'out_of_memory',
    endedNormally: NORMAL_ENDINGS.includes(minimal) && NORMAL_ENDINGS.includes(instrumented),
    consistent: minimal === instrumented,
    reached: minimal === instrumented ? minimal : 'modes_differ',
  }
}

function semanticDigest(after: Phase2C25D2AAfter): string | null {
  if (after.view.searchSummary === null) return null
  return stableStringify({ status: after.view.status, summary: after.view.searchSummary, firstCandidateKeySha256: after.view.firstCandidateKeySha256 })
}

// ---------------------------------------------------------------- H1 structural audit of the measured source

export interface Phase2C25D2DSourceAudit {
  /** The held-aware stream state (`interface ReservedSet`) holds a raw solution collection. */
  reservedSetHoldsRawSolutions: boolean
  /** `readReservedDepth()` reads a `depths` collection. */
  readReservedDepthReadsDepths: boolean
  /** A single-pass cursor check guards `readReservedDepth()`. */
  singlePassCursor: boolean
  /** The ordinary `readDepth()` / `solve()` cache still keeps its depths (outside H1). */
  ordinaryDepthCacheKept: boolean
  /** `steps: reservedBonusSteps(...)` is still built for every raw solution (H2 not implemented). */
  stepsStillBuiltPerRawSolution: boolean
}

/** A structural reading of `bonusStream.ts` (behavioural tests are the primary evidence; this only records the shape). */
export function auditPhase2C25D2DBonusStreamSource(source: string): Phase2C25D2DSourceAudit {
  const set = /interface ReservedSet \{([\s\S]*?)\n {2}\}/.exec(source)
  const read = /readReservedDepth: async \(base, depth\) => \{([\s\S]*?)\n {4}\},/.exec(source)
  if (set === null || read === null) throw new Error('bonusStream.ts: the held-aware stream state or readReservedDepth() was not found.')
  return {
    reservedSetHoldsRawSolutions: /ReservedBonusStreamSolution|\bdepths\b/.test(set[1]),
    readReservedDepthReadsDepths: /depths/.test(read[1]),
    singlePassCursor: /claimReservedDepth\(/.test(read[1]) && /Single-pass violation/.test(source),
    ordinaryDepthCacheKept: /solutions: cached\.depths\[depth - 1\]/.test(source),
    stepsStillBuiltPerRawSolution: /steps: reservedBonusSteps\(state\.results\)/.test(source),
  }
}

// ---------------------------------------------------------------- post-hoc analysis of one raw run

export interface Phase2C25D2DRawRun {
  runs: { item: Phase2C25D2CWorkloadItem; modes: Partial<Record<Phase2C25D2DMode, Phase2C25D2ARawMode>> }[]
}

export interface Phase2C25D2DParity extends Phase2C25D2AControlParity {
  role: Phase2C25D2CWorkloadItem['role']
}

/**
 * The formal before / after comparison of one raw D2-d run: per context and mode the after view and the comparison
 * row; the semantic parity with D2-a for every context that ended normally in D2-a (cleared reference and controls);
 * and for every primary context what it reached (a new observation, never "parity").
 */
export function analyzePhase2C25D2DRun(raw: Phase2C25D2DRawRun, d2aResult: unknown, d2cResult: unknown) {
  const items = raw.runs.map(run => run.item)
  const d2a = parsePhase2C25D2DD2ABefore(d2aResult, items)
  const d2c = parsePhase2C25D2DD2CResult(d2cResult).references
  const contexts = raw.runs.map(({ item, modes }) => {
    const key = phase2c25d2dItemKey(item)
    const prior = d2a.get(key) as Record<Phase2C25D2DMode, Phase2C25D2AAfter>
    const ran = PHASE2C25D2D_MODES.filter(mode => modes[mode] !== undefined)
    const after = Object.fromEntries(ran.map(mode => {
      const m = modes[mode] as Phase2C25D2ARawMode
      return [mode, phase2c25d2aAfter(mode, { status: m.status, ready: m.ready, final: m.final, memorySamples: m.memorySamples, lastSnapshot: m.lastSnapshot, v8FatalGc: m.v8FatalGc })]
    })) as Partial<Record<Phase2C25D2DMode, Phase2C25D2AAfter>>
    const rows = ran.map(mode => phase2c25d2dComparisonRow(item, mode, prior[mode], d2c.get(key) ?? null, after[mode] as Phase2C25D2AAfter))
    // D2-a ended normally in both modes (cleared reference, controls): semantic parity is required.
    const d2aNormal = NORMAL_ENDINGS.includes(prior.minimal.view.status) && NORMAL_ENDINGS.includes(prior.instrumented.view.status)
    const semanticParityWithD2A: Phase2C25D2DParity[] | null = !d2aNormal ? null
      : ran.map(mode => ({ ...comparePhase2C25D2AControl(item, mode, prior[mode].view, (after[mode] as Phase2C25D2AAfter).view), role: item.role }))
    const minimalDigest = after.minimal === undefined ? null : semanticDigest(after.minimal)
    const instrumentedDigest = after.instrumented === undefined ? null : semanticDigest(after.instrumented)
    const processes = Object.fromEntries(ran.map(mode => [mode, (modes[mode] as Phase2C25D2ARawMode).process]))
    return {
      orientationId: item.orientationId, workIndex: item.workIndex, role: item.role, kind: item.kind, targetWeaponId: item.targetWeaponId,
      d2a: { minimalStatus: prior.minimal.view.status, instrumentedStatus: prior.instrumented.view.status },
      d2c: d2c.get(key) ?? null,
      after, rows, processes, semanticParityWithD2A,
      modeSemanticParity: minimalDigest === null || instrumentedDigest === null ? null : minimalDigest === instrumentedDigest,
      primaryOutcome: item.role === 'primary_oom' && after.minimal !== undefined && after.instrumented !== undefined
        ? phase2c25d2dPrimaryOutcome(after.minimal.view.status, after.instrumented.view.status) : null,
      // A primary that ended normally is a first observation: its Candidate / summary / counts have no D2-a baseline.
      newObservation: item.role !== 'primary_oom' ? null : Object.fromEntries(ran.map(mode => {
        const view = (after[mode] as Phase2C25D2AAfter).view
        const metrics = (after[mode] as Phase2C25D2AAfter).metrics
        return [mode, { status: view.status, searchSummary: view.searchSummary, firstCandidateKeySha256: view.firstCandidateKeySha256,
          predictionCounts: view.predictionCounts ?? (after[mode] as Phase2C25D2AAfter).lastSnapshotPredictionCounts,
          searchElapsedMs: view.searchElapsedMs, timeToFirstMs: view.timeToFirstMs, finalOrLastGogmaDepth: metrics?.gogmaMaxDepth ?? null }]
      })),
    }
  })
  const primary = contexts.filter(context => context.role === 'primary_oom')
  const parityContexts = contexts.filter(context => context.semanticParityWithD2A !== null)
  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {})
  return {
    totals: {
      contexts: contexts.length, primary: primary.length,
      primaryLeftOom: primary.filter(context => context.primaryOutcome?.leftOom === true).length,
      primaryEndedNormally: primary.filter(context => context.primaryOutcome?.endedNormally === true).length,
      primaryOutcomes: count(primary.map(context => context.primaryOutcome?.reached ?? 'not_run')),
      semanticParityContexts: parityContexts.length,
      semanticParityWithD2A: parityContexts.every(context => (context.semanticParityWithD2A as Phase2C25D2DParity[]).every(row => row.matches)),
      modeSemanticParityFailures: contexts.filter(context => context.modeSemanticParity === false).length,
    },
    contexts,
  }
}
