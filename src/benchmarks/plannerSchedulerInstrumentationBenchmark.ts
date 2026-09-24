import {
  runPlannerDeterministicSchedule,
  type PlannerBeamSearchResult,
  type PlannerDependencies,
  type PlannerInput,
  type PlannerSchedulerRunMetrics,
} from '../domain/planner'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  createDeterministicPlannerDependencies,
  digestPlannerBeamSearchResult,
  type PlannerSearchResultDigest,
} from './plannerSearchInstrumentationBenchmark'

/**
 * Issue #103 Phase B deterministic scheduler instrumentation harness.
 *
 * It runs `runPlannerDeterministicSchedule()` once - never through the
 * Production Planner Worker, which still runs the Beam Search - optionally with
 * the semantics-neutral `schedulerInstrumentation`, and returns plain
 * structured-clone data. The digest is the Beam harness digest, so the two
 * strategies share one comparable shape; the metrics are the scheduler's own
 * and carry no Beam depth, trim or dedup field.
 */

export interface PlannerSchedulerInstrumentationRunOptions {
  /** `false` runs the scheduler with no observer at all, for the overhead baseline. */
  readonly instrumented: boolean
  readonly now?: () => number
  readonly shouldCancel?: () => boolean
  readonly yieldControl?: () => Promise<void>
  /** Live forwarding of `expandedStates` (applied actions). */
  readonly onProgress?: (expandedStates: number) => void
}

export interface PlannerSchedulerInstrumentationRunResult {
  readonly instrumented: boolean
  readonly options: PlannerInput['options']
  /** The schedule alone; Trace Replay and the projection are not included. */
  readonly elapsedMs: number
  readonly metrics: PlannerSchedulerRunMetrics | null
  readonly digest: PlannerSearchResultDigest
}

export async function executePlannerSchedulerInstrumentation(
  input: PlannerInput,
  engine: RngEngine,
  options: PlannerSchedulerInstrumentationRunOptions,
): Promise<{
  run: PlannerSchedulerInstrumentationRunResult
  result: PlannerBeamSearchResult
  dependencies: PlannerDependencies
}> {
  const now = options.now ?? (() => performance.now())
  const dependencies = createDeterministicPlannerDependencies(engine)
  let metrics: PlannerSchedulerRunMetrics | null = null
  const startedAt = now()
  const result = await runPlannerDeterministicSchedule(input, dependencies, {
    shouldCancel: options.shouldCancel,
    yieldControl: options.yieldControl,
    onProgress:
      options.onProgress === undefined
        ? undefined
        : ({ expandedStates }) => options.onProgress?.(expandedStates),
    schedulerInstrumentation: options.instrumented
      ? {
          now,
          onScheduleEnd: (value) => {
            metrics = value
          },
        }
      : undefined,
  })
  const elapsedMs = now() - startedAt
  return {
    run: {
      instrumented: options.instrumented,
      options: { ...input.options },
      elapsedMs,
      metrics,
      digest: digestPlannerBeamSearchResult(result),
    },
    result,
    dependencies,
  }
}

export async function runPlannerSchedulerInstrumentation(
  input: PlannerInput,
  engine: RngEngine,
  options: PlannerSchedulerInstrumentationRunOptions,
): Promise<PlannerSchedulerInstrumentationRunResult> {
  return (await executePlannerSchedulerInstrumentation(input, engine, options)).run
}

/** A short text rendering of the scheduler metrics, for the page and the record. */
export function formatPlannerSchedulerMetrics(metrics: PlannerSchedulerRunMetrics): string {
  const c = metrics.counts
  const phase = metrics.phaseMs
  const lines = [
    `scheduler: reached ${metrics.reachedScheduler}; termination ${metrics.terminationStatus}; completed ${metrics.completedTargetCount} / ${metrics.totalTargetCount}; expandedStates ${metrics.expandedStates}; trace ${metrics.traceLength}`,
    `commitment: runs ${c.commitmentRuns}, iterations ${c.commitmentIterations}; initial candidates ${c.initialCandidates} -> committed ${c.initialCommitted} / dropped ${c.initialDropped} / secured ${c.initialSecured} / not needed ${c.initialNotNeeded}`,
    `collisions: detections ${c.collisionDetectionCount}, detected ${c.detectedCollisionCount}; provisional winners ${c.provisionalWinnerCount} / losers ${c.provisionalLoserCount}`,
    `dynamic: commits ${c.dynamicCommitCount} (recommits ${c.recommitCount}), releases ${c.releaseCount}; drops deadlock ${c.deadlockDropCount} / stall ${c.stallDropCount} / precondition ${c.preconditionDropCount}`,
    `iterations ${c.schedulerIterationCount}: route actions ${c.appliedRouteActionCount}, reserves ${c.appliedReserveActionCount}; safe candidates total ${c.safeActionCandidateCountTotal} / max ${c.safeActionCandidateCountMax}; waiting iterations ${c.waitingIterationCount} (streams ${c.waitingStreamCountTotal})`,
    `sharing: shared physical actions ${c.physicalSharedActionCount} (+${c.sharedProgressedEntryCount} Entries); fast-forwarded units ${c.fastForwardedUnitCount} (bonus ${c.fastForwardedBonusUnitCount} / skill ${c.fastForwardedSkillUnitCount})`,
    `final: committed ${c.finalCommitted}, secured ${c.finalSecured}, released ${c.finalReleased}, dropped ${c.finalDropped}, not needed ${c.finalNotNeeded}`,
  ]
  if (phase !== null) {
    lines.push(
      `phase ms: initialize ${phase.initialize.toFixed(1)}, refresh ${phase.refreshCommitment.toFixed(1)}, safeActions ${phase.safeActions.toFixed(1)}, apply ${phase.applyAction.toFixed(1)}, reserve ${phase.reserve.toFixed(1)}, finish ${phase.finish.toFixed(1)}`,
    )
  }
  if (metrics.drops.length > 0) {
    lines.push('drops:')
    metrics.drops.forEach((drop) =>
      lines.push(
        `  - ${drop.buildListEntryId} (${drop.targetWeaponId ?? '-'}): ${drop.cause} / ${drop.reason} @${drop.iteration}${drop.winnerBuildListEntryId === null ? '' : ` winner ${drop.winnerBuildListEntryId} (${drop.conflictKind})`}`,
      ),
    )
  }
  return lines.join('\n')
}
