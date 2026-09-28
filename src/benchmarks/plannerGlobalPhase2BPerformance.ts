/**
 * Issue #154 Phase 2-B: transient Research only. Never import from Production.
 *
 * Summaries of measured Planner call timelines (timing), of their overlap with main-thread pings
 * (responsiveness) and with externally sampled Worker heap values (memory). Pure functions over recorded
 * numbers; nothing here runs or influences a calculation.
 */
import { PHASE2B_CALL_PHASES, phase2bCallElapsedMs, phase2bCallPhaseDurations, type GlobalResearchPlannerRunKind,
  type Phase2BCallPhase, type Phase2BInterval, type Phase2BPlannerCallTimeline } from './plannerGlobalPhase2BTimeline'

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export interface Phase2BKindSummary {
  readonly kind: GlobalResearchPlannerRunKind
  readonly calls: number
  readonly schedulerRuns: number
  readonly elapsedMs: number
  readonly phasesMs: Readonly<Record<Phase2BCallPhase, number>>
  /** Longest stretch without an event loop return inside any scheduler run of this kind. */
  readonly maxSchedulerSyncSegmentMs: number
  readonly schedulerLoopIterations: number
  readonly schedulerYields: number
}

/** Planner calls of one Research run grouped by kind (baseline / retained_prefix / application / final). */
export function summarizePlannerCallsByKind(calls: readonly Phase2BPlannerCallTimeline[]): Phase2BKindSummary[] {
  const kinds: GlobalResearchPlannerRunKind[] = ['baseline', 'retained_prefix', 'application', 'final']
  return kinds.map(kind => {
    const own = calls.filter(call => call.kind === kind)
    const phasesMs = Object.fromEntries(PHASE2B_CALL_PHASES.map(phase => [phase, 0])) as Record<Phase2BCallPhase, number>
    for (const call of own) for (const [phase, ms] of Object.entries(phase2bCallPhaseDurations(call))) phasesMs[phase as Phase2BCallPhase] += ms
    const runs = own.flatMap(call => call.schedulerRuns)
    return { kind, calls: own.length, schedulerRuns: runs.length, elapsedMs: own.reduce((sum, call) => sum + phase2bCallElapsedMs(call), 0), phasesMs,
      maxSchedulerSyncSegmentMs: runs.reduce((max, run) => Math.max(max, run.maxSyncSegmentMs), 0),
      schedulerLoopIterations: runs.reduce((sum, run) => sum + run.checks, 0), schedulerYields: runs.reduce((sum, run) => sum + run.yields, 0) }
  })
}

/**
 * The longest synchronous stretch of one final call that is visible from the timeline: from the scheduler's last
 * event loop return (its last yield, or its start when it never yielded) to the end of the call. The Research
 * continuation after the call keeps running synchronously until the Worker's next await, so this is a lower bound
 * of the event loop block, not its full length.
 */
export function finalCallTailSyncMs(call: Phase2BPlannerCallTimeline): { readonly fromMs: number; readonly toMs: number; readonly durationMs: number } | null {
  const end = call.marks.find(mark => mark.name === 'call_end')
  const lastRun = call.schedulerRuns.at(-1)
  if (!end || !lastRun) return null
  return { fromMs: lastRun.lastSegmentStartAtMs, toMs: end.atMs, durationMs: end.atMs - lastRun.lastSegmentStartAtMs }
}

export interface Phase2BHeapSample { readonly atMs: number; readonly usedBytes: number }
export interface Phase2BIntervalHeap {
  readonly name: string
  readonly durationMs: number
  readonly samples: number
  /** The last sample at or before the interval start, and the first at or after its end (nearest outside samples). */
  readonly beforeBytes: number | null
  readonly afterBytes: number | null
  readonly maxInsideBytes: number | null
  /** afterBytes - beforeBytes (sampled; includes uncollected garbage). */
  readonly deltaBytes: number | null
}

/** Maps sampled Worker heap values onto intervals (sampled max, never a continuous peak). */
export function attributeHeapSamples(samples: readonly Phase2BHeapSample[], intervals: readonly Phase2BInterval[]): Phase2BIntervalHeap[] {
  const sorted = [...samples].sort((a, b) => a.atMs - b.atMs)
  return intervals.map(interval => {
    const inside = sorted.filter(sample => sample.atMs >= interval.startMs && sample.atMs <= interval.endMs)
    const before = [...sorted].reverse().find(sample => sample.atMs <= interval.startMs) ?? null
    const after = sorted.find(sample => sample.atMs >= interval.endMs) ?? null
    return { name: interval.name, durationMs: interval.endMs - interval.startMs, samples: inside.length, beforeBytes: before?.usedBytes ?? null,
      afterBytes: after?.usedBytes ?? null, maxInsideBytes: inside.length ? Math.max(...inside.map(sample => sample.usedBytes)) : null,
      deltaBytes: before && after ? after.usedBytes - before.usedBytes : null }
  })
}
