/**
 * Issue #154 Phase 2-B: transient Research only. Never import from Production.
 *
 * A semantics-neutral timeline of every full Planner call of one Research run. It only reads clocks
 * (and, where the runtime exposes one, a heap probe):
 *
 * - the full Planner run through the existing `beforePlannerRun()` / `afterPlannerRun()` hooks,
 * - the scheduler's prepare / loop / finish split through the existing `PlannerExecutionOptions`
 *   hooks (`shouldCancel()` is called once per scheduler loop iteration, `yieldControl()` every
 *   `PLANNER_SCHEDULER_YIELD_INTERVAL` applied actions) - both are wrapped and forwarded unchanged,
 * - the shared Plan-generation tail through the optional `onPlanGenerationPhase()` observer.
 *
 * It is not `PlannerSchedulerInstrumentation` (the Issue #103 parity test observer), which it never uses.
 */
import type { PlannerExecutionOptions, ProductionPlanGenerationPhase } from '../domain/planner/plannerTypes'

export type GlobalResearchPlannerRunKind = 'baseline' | 'retained_prefix' | 'application' | 'final'

/**
 * A phase of one full Planner call, in order. `call_setup` / `call_return` are the Research wrapper time before the
 * first scheduler run and after the tail returned; `scheduler_handoff` is the gap between a scheduler run and the next
 * tail phase; `scheduler_finish` is the last loop iteration plus the scheduler's own `finish()`.
 */
export const PHASE2B_CALL_PHASES = ['call_setup', 'scheduler_prepare', 'scheduler_loop', 'scheduler_finish', 'scheduler_handoff', 'trace_replay',
  'post_processing', 'execution_projection', 'planning_input_snapshot', 'checkpoint_defence', 'rejected_build_list_entries',
  'required_materials', 'plan_assembly', 'call_return'] as const
export type Phase2BCallPhase = typeof PHASE2B_CALL_PHASES[number]

export interface Phase2BMark {
  readonly name: string
  /** Epoch-aligned ms (`performance.timeOrigin + performance.now()` in the runtime that measured it). */
  readonly atMs: number
  /** Heap probe right at the mark when the runtime exposes one (Node); null otherwise (Browser Worker). */
  readonly heapUsedBytes: number | null
}

export interface Phase2BSchedulerLoop {
  /** `shouldCancel()` calls inside the scheduler run = loop iterations. */
  readonly checks: number
  readonly firstCheckAtMs: number | null
  readonly lastCheckAtMs: number | null
  readonly yields: number
  /** Longest stretch without returning to the event loop inside this scheduler run (ms). */
  readonly maxSyncSegmentMs: number
  readonly maxSyncSegmentStartAtMs: number | null
  /** Start of the last synchronous stretch: the end of the last yield, or the scheduler start when it never yielded. */
  readonly lastSegmentStartAtMs: number
}

export interface Phase2BPlannerCallTimeline {
  readonly index: number
  readonly kind: GlobalResearchPlannerRunKind
  /** Discovery Search index for `application`, null otherwise. */
  readonly searchIndex: number | null
  readonly marks: readonly Phase2BMark[]
  /** One per scheduler full run (a runtime-unsupported retry adds one). */
  readonly schedulerRuns: readonly Phase2BSchedulerLoop[]
}

export interface Phase2BTimelineOptions {
  /** Epoch-aligned clock. */
  readonly nowMs: () => number
  /** Optional synchronous heap probe (Node `process.memoryUsage().heapUsed`); never estimated. */
  readonly heapUsedBytes?: () => number
}

interface OpenSchedulerRun {
  checks: number
  firstCheckAtMs: number | null
  lastCheckAtMs: number | null
  yields: number
  segmentStartAtMs: number
  maxSyncSegmentMs: number
  maxSyncSegmentStartAtMs: number | null
}

export interface Phase2BPlannerCall {
  /** Existing hooks, forwarded to by the Research wrapper. */
  beforePlannerRun(): void
  afterPlannerRun(): void
  onPlanGenerationPhase(phase: ProductionPlanGenerationPhase): void
  /** Wraps `shouldCancel` / `yieldControl`: same return values, same awaited promise, `undefined` kept. */
  wrapExecution<T extends PlannerExecutionOptions>(options: T): T
  end(): void
}

/** The recorder of one Research run. `begin()` opens one full Planner call (`createProductionPlanWithObserver()`). */
export class Phase2BPlannerTimeline {
  readonly calls: Phase2BPlannerCallTimeline[] = []
  private readonly options: Phase2BTimelineOptions
  constructor(options: Phase2BTimelineOptions) { this.options = options }

  begin(kind: GlobalResearchPlannerRunKind, searchIndex: number | null = null): Phase2BPlannerCall {
    const { nowMs, heapUsedBytes } = this.options
    const marks: Phase2BMark[] = []
    const schedulerRuns: Phase2BSchedulerLoop[] = []
    const mark = (name: string, atMs = nowMs()) => { marks.push({ name, atMs, heapUsedBytes: heapUsedBytes ? heapUsedBytes() : null }) }
    let open: OpenSchedulerRun | null = null
    mark('call_start')
    this.calls.push({ index: this.calls.length, kind, searchIndex, marks, schedulerRuns })
    return {
      beforePlannerRun: () => {
        mark('scheduler_start')
        open = { checks: 0, firstCheckAtMs: null, lastCheckAtMs: null, yields: 0, segmentStartAtMs: marks.at(-1)!.atMs, maxSyncSegmentMs: 0, maxSyncSegmentStartAtMs: null }
      },
      afterPlannerRun: () => {
        const at = nowMs()
        const run = open
        if (run) {
          const segment = at - run.segmentStartAtMs
          if (segment > run.maxSyncSegmentMs) { run.maxSyncSegmentMs = segment; run.maxSyncSegmentStartAtMs = run.segmentStartAtMs }
          if (run.firstCheckAtMs !== null) marks.push({ name: 'scheduler_loop_start', atMs: run.firstCheckAtMs, heapUsedBytes: null })
          if (run.lastCheckAtMs !== null) marks.push({ name: 'scheduler_finish_start', atMs: run.lastCheckAtMs, heapUsedBytes: null })
          schedulerRuns.push({ checks: run.checks, firstCheckAtMs: run.firstCheckAtMs, lastCheckAtMs: run.lastCheckAtMs, yields: run.yields,
            maxSyncSegmentMs: run.maxSyncSegmentMs, maxSyncSegmentStartAtMs: run.maxSyncSegmentStartAtMs, lastSegmentStartAtMs: run.segmentStartAtMs })
        }
        open = null
        mark('scheduler_end', at)
      },
      onPlanGenerationPhase: phase => mark(phase),
      wrapExecution: <T extends PlannerExecutionOptions>(execution: T): T => {
        const shouldCancel = execution.shouldCancel
        const yieldControl = execution.yieldControl
        return {
          ...execution,
          ...(shouldCancel ? { shouldCancel: () => {
            if (open) { const at = nowMs(); open.checks += 1; open.firstCheckAtMs ??= at; open.lastCheckAtMs = at }
            return shouldCancel()
          } } : {}),
          // Returns the very Promise the original `yieldControl()` returned: no async wrapper, so the caller's
          // `await` adds no extra Promise boundary. The observation is a separate reaction registered on that
          // Promise before the caller awaits it; its rejection handler only swallows the observer's own derived
          // Promise, while the caller still receives the original rejection unchanged.
          ...(yieldControl ? { yieldControl: () => {
            const run = open
            if (run) {
              const at = nowMs(), segment = at - run.segmentStartAtMs
              run.yields += 1
              if (segment > run.maxSyncSegmentMs) { run.maxSyncSegmentMs = segment; run.maxSyncSegmentStartAtMs = run.segmentStartAtMs }
            }
            const promise = yieldControl()
            if (run) void promise.then(() => { run.segmentStartAtMs = nowMs() }, () => undefined)
            return promise
          } } : {}),
        }
      },
      end: () => mark('call_end'),
    }
  }
}

/** Duration of every call phase, from the marks alone (`scheduler_*` summed over retries). */
export function phase2bCallPhaseDurations(call: Phase2BPlannerCallTimeline): Record<Phase2BCallPhase, number> {
  const durations = Object.fromEntries(PHASE2B_CALL_PHASES.map(phase => [phase, 0])) as Record<Phase2BCallPhase, number>
  const sorted = [...call.marks].map((mark, order) => ({ ...mark, order })).sort((a, b) => a.atMs - b.atMs || a.order - b.order)
  const phaseOf = (name: string): Phase2BCallPhase | null => {
    switch (name) {
      case 'call_start': return 'call_setup'
      case 'scheduler_start': return 'scheduler_prepare'
      case 'scheduler_loop_start': return 'scheduler_loop'
      case 'scheduler_finish_start': return 'scheduler_finish'
      case 'scheduler_end': return 'scheduler_handoff'
      case 'completed': return 'call_return'
      case 'call_end': return null
      default: return (PHASE2B_CALL_PHASES as readonly string[]).includes(name) ? name as Phase2BCallPhase : null
    }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const phase = phaseOf(sorted[i].name)
    if (phase !== null) durations[phase] += sorted[i + 1].atMs - sorted[i].atMs
  }
  return durations
}

export function phase2bCallElapsedMs(call: Phase2BPlannerCallTimeline): number {
  const start = call.marks.find(mark => mark.name === 'call_start'), end = call.marks.find(mark => mark.name === 'call_end')
  return start && end ? end.atMs - start.atMs : 0
}

export interface Phase2BInterval { readonly name: string; readonly startMs: number; readonly endMs: number }

/** The phase intervals of every call (`other` between calls is not an interval). */
export function phase2bIntervals(calls: readonly Phase2BPlannerCallTimeline[]): Phase2BInterval[] {
  return calls.flatMap(call => {
    const sorted = [...call.marks].map((mark, order) => ({ ...mark, order })).sort((a, b) => a.atMs - b.atMs || a.order - b.order)
    const out: Phase2BInterval[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].name === 'call_end') continue
      out.push({ name: `${call.kind}#${call.index}:${sorted[i].name}`, startMs: sorted[i].atMs, endMs: sorted[i + 1].atMs })
    }
    return out
  })
}

export interface Phase2BPingSample { readonly sentAtMs: number; readonly receivedAtMs: number | null }
export interface Phase2BPingAttribution {
  readonly sentAtMs: number
  readonly rttMs: number
  /** Overlap (ms) of the ping's in-flight interval with each named interval; the rest is `unattributed`. */
  readonly overlapMs: Record<string, number>
}

/**
 * Attributes every ping slower than `thresholdMs` to the intervals it overlapped. Main thread and
 * Worker clocks are both epoch-aligned (`timeOrigin + now()`); the result is overlap, not causality.
 */
export function attributePingDelays(pings: readonly Phase2BPingSample[], intervals: readonly Phase2BInterval[], thresholdMs: number): Phase2BPingAttribution[] {
  return pings.filter((ping): ping is Phase2BPingSample & { receivedAtMs: number } => ping.receivedAtMs !== null && ping.receivedAtMs - ping.sentAtMs > thresholdMs)
    .map(ping => {
      const overlapMs: Record<string, number> = {}
      let covered = 0
      for (const interval of intervals) {
        const overlap = Math.min(ping.receivedAtMs, interval.endMs) - Math.max(ping.sentAtMs, interval.startMs)
        if (overlap > 0) { overlapMs[interval.name] = overlap; covered += overlap }
      }
      overlapMs.unattributed = Math.max(0, ping.receivedAtMs - ping.sentAtMs - covered)
      return { sentAtMs: ping.sentAtMs, rttMs: ping.receivedAtMs - ping.sentAtMs, overlapMs }
    })
}
