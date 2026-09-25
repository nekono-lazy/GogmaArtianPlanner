import {
  runPlannerBeamSearch,
  createPlannerSearchStateSemanticKey,
  type PlannerBeamSearchInput,
  type PlannerBeamSearchResult,
  type PlannerDependencies,
  type PlannerRunResultOf,
  type PlannerSearchDepthMetrics,
  type PlannerSearchRunMetrics,
  type PlannerTerminationOf,
} from '../domain/planner'
import type {
  OwnedWeaponId,
  PlanStepId,
  ProductionPlanId,
} from '../domain/models/publicTypes'
import { hashStableValue } from '../domain/models/publicTypes'
import type { RngEngine } from '../domain/rng/rngEngine'

/**
 * Issue #103 Planner search instrumentation harness.
 *
 * It runs the Beam Search oracle `runPlannerBeamSearch()` - the Production
 * Planner up to Issue #103 Phase B; Production has run the deterministic
 * scheduler since Phase C - once, optionally with the
 * `searchInstrumentation` observer, and returns plain structured-clone data so
 * a Browser Worker can post it back unchanged. It never persists anything.
 *
 * The runtime ID factory and Clock are deterministic here so two runs of one
 * input can be compared field by field. The Beam Search itself never reads a
 * reserved ID or the Clock to decide anything: reserved IDs are normalized out
 * of the semantic key, and the Clock is read only by Plan generation, which
 * this harness does not run.
 */

export interface PlannerSearchInstrumentationRunOptions {
  /** `false` runs the search with no observer at all, for the overhead baseline. */
  readonly instrumented: boolean
  readonly collectDiagnosticProjections?: boolean
  readonly now?: () => number
  readonly shouldCancel?: () => boolean
  readonly yieldControl?: () => Promise<void>
  /** Live per-depth forwarding, for example to a benchmark page. */
  readonly onDepth?: (metrics: PlannerSearchDepthMetrics) => void
}

/** The parts of a full Planner run result (either strategy) the parity check compares. */
export interface PlannerSearchResultDigest {
  terminationStatus: PlannerBeamSearchResult['termination']['status']
  reachedLimits: string[]
  expandedStates: number
  completed: boolean
  cancelled: boolean
  completedTargetCount: number
  totalTargetCount: number
  conflictIds: string[]
  rejectionCount: number
  rejectionsHash: string
  warningKinds: string[]
  bestStateTraceLength: number | null
  bestStateSemanticKeyHash: string | null
  bestStateEvaluationScore: number | null
}

export interface PlannerSearchInstrumentationRunResult {
  readonly instrumented: boolean
  readonly collectDiagnosticProjections: boolean
  readonly options: PlannerBeamSearchInput['options']
  readonly elapsedMs: number
  /** Main-clock milliseconds per depth, measured in the observer callback. */
  readonly depthElapsedMs: number[]
  readonly depths: PlannerSearchDepthMetrics[]
  readonly run: PlannerSearchRunMetrics | null
  readonly digest: PlannerSearchResultDigest
}

export function createDeterministicPlannerDependencies(
  rngEngine: RngEngine,
): PlannerDependencies {
  let plan = 0
  let step = 0
  let weapon = 0
  return {
    rngEngine,
    idFactory: {
      productionPlanId: () => `plan.issue103.${++plan}` as ProductionPlanId,
      planStepId: () => `step.issue103.${++step}` as PlanStepId,
      ownedWeaponId: () => `owned.issue103.reserved.${++weapon}` as OwnedWeaponId,
    },
    clock: { now: () => '2026-09-24T00:00:00.000Z' },
  }
}

/**
 * One digest shape for both strategies: the Beam Search oracle result and the
 * scheduler's Production `PlannerRunResult` differ only in the limit kinds and
 * bounds their termination can name, which the digest records as plain data.
 */
export function digestPlannerRunResult(
  result: PlannerRunResultOf<PlannerTerminationOf<string, unknown>>,
): PlannerSearchResultDigest {
  const best = result.bestState
  return {
    terminationStatus: result.termination.status,
    reachedLimits: [...result.termination.reachedLimits],
    expandedStates: result.expandedStates,
    completed: result.completed,
    cancelled: result.cancelled,
    completedTargetCount: result.termination.completedTargetCount,
    totalTargetCount: result.termination.totalTargetCount,
    conflictIds: result.conflicts.map(({ id }) => id),
    rejectionCount: result.rejections.length,
    rejectionsHash: hashStableValue(result.rejections),
    warningKinds: result.warnings.map(({ kind }) => kind),
    bestStateTraceLength: best?.trace.length ?? null,
    bestStateSemanticKeyHash:
      best === null ? null : hashStableValue(createPlannerSearchStateSemanticKey(best)),
    bestStateEvaluationScore: best?.evaluationScore ?? null,
  }
}

export async function runPlannerSearchInstrumentation(
  input: PlannerBeamSearchInput,
  engine: RngEngine,
  options: PlannerSearchInstrumentationRunOptions,
): Promise<PlannerSearchInstrumentationRunResult> {
  return (await executePlannerSearchInstrumentation(input, engine, options)).run
}

/**
 * unPlannerSearchInstrumentation() that also returns the raw search result
 * and the dependencies it ran with, so a caller can continue with Trace Replay
 * and the Production projection (Issue #103 Phase B parity). Measured time is
 * the search alone.
 */
export async function executePlannerSearchInstrumentation(
  input: PlannerBeamSearchInput,
  engine: RngEngine,
  options: PlannerSearchInstrumentationRunOptions,
): Promise<{
  run: PlannerSearchInstrumentationRunResult
  result: PlannerBeamSearchResult
  dependencies: PlannerDependencies
}> {
  const dependencies = createDeterministicPlannerDependencies(engine)
  const now = options.now ?? (() => performance.now())
  const depths: PlannerSearchDepthMetrics[] = []
  const depthElapsedMs: number[] = []
  let run: PlannerSearchRunMetrics | null = null
  const collectDiagnosticProjections = options.collectDiagnosticProjections === true
  const startedAt = now()
  let depthStartedAt = startedAt
  const result = await runPlannerBeamSearch(
    input,
    dependencies,
    {
      shouldCancel: options.shouldCancel,
      yieldControl: options.yieldControl,
      searchInstrumentation: options.instrumented
        ? {
            collectDiagnosticProjections,
            now,
            onDepth: (metrics) => {
              const at = now()
              depthElapsedMs.push(at - depthStartedAt)
              depthStartedAt = at
              depths.push(metrics)
              options.onDepth?.(metrics)
            },
            onSearchEnd: (metrics) => {
              run = metrics
            },
          }
        : undefined,
    },
  )
  const elapsedMs = now() - startedAt
  return {
    run: {
      instrumented: options.instrumented,
      collectDiagnosticProjections: options.instrumented && collectDiagnosticProjections,
      options: { ...input.options },
      elapsedMs,
      depthElapsedMs,
      depths,
      run,
      digest: digestPlannerRunResult(result),
    },
    result,
    dependencies,
  }
}
