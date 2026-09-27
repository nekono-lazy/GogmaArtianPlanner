/**
 * Issue #154 Phase 1-E: transient Research only. Never import from Production.
 * The only data input is the original Export: every attempt is executed from it by the caller, and the
 * retained set / pending order of an initial attempt are derived by that run itself. No anchor, prior
 * report, Target ID, order, snapshot or oracle enters this controller.
 */
import { compareExtentVariants, createSingleAxisExtentFallback, EXTENT_AXES, EXTENT_PROBE_FACTOR, extentVariantSignature, isGlobalPlanSuccess,
  type ExtentAxis, type ExtentVariantOutcome } from './plannerGlobalOptimizationExtentProbe'
import type { GlobalResearchExtentFallback } from './plannerGlobalOptimizationResearch'
import { PHASE1C_BOUNDS, runDiscoveryRetries, type AttemptSummary, type DiscoveryState, type RetryBounds, type StopReason } from './plannerGlobalOptimizationRetry'

export interface Phase1EBounds {
  /** Fallback Searches allowed in one attempt; reaching it blocks the attempt (`fallback_episode_limit`). */
  maxFallbackEpisodesPerAttempt: number
  /** Axis strategies run from the original Export (at most Normal / Gogma / Skill). */
  axisStrategies: number
  /** Phase 1-C retry bounds per axis strategy, used only when every initial strategy is partial. */
  retry: RetryBounds
}
export const PHASE1E_BOUNDS: Phase1EBounds = { maxFallbackEpisodesPerAttempt: 3, axisStrategies: EXTENT_AXES.length, retry: PHASE1C_BOUNDS }

export function validatePhase1EBounds(bounds: Phase1EBounds): void {
  if (!Number.isSafeInteger(bounds.maxFallbackEpisodesPerAttempt) || bounds.maxFallbackEpisodesPerAttempt < 1 || bounds.maxFallbackEpisodesPerAttempt > 6 ||
    !Number.isSafeInteger(bounds.axisStrategies) || bounds.axisStrategies < 1 || bounds.axisStrategies > EXTENT_AXES.length ||
    !Number.isSafeInteger(bounds.retry.orderingAttempts) || bounds.retry.orderingAttempts < 1 || bounds.retry.orderingAttempts > PHASE1C_BOUNDS.orderingAttempts ||
    !Number.isSafeInteger(bounds.retry.maxStates) || bounds.retry.maxStates < 1 || bounds.retry.maxStates > PHASE1C_BOUNDS.maxStates ||
    !Number.isSafeInteger(bounds.retry.releaseDepth) || bounds.retry.releaseDepth < 0 || bounds.retry.releaseDepth > PHASE1C_BOUNDS.releaseDepth) throw new Error('Invalid Phase 1-E bounds')
}

/** The generic Target-independent fallback of one axis strategy, with the Phase 1-E episode bound. */
export function createPhase1EFallback(axis: ExtentAxis, timeBudgetMs: number, bounds: Phase1EBounds = PHASE1E_BOUNDS): GlobalResearchExtentFallback {
  validatePhase1EBounds(bounds)
  return createSingleAxisExtentFallback(axis, timeBudgetMs, bounds.maxFallbackEpisodesPerAttempt)
}
export const phase1eStrategyName = (axis: ExtentAxis) => `${axis}-${EXTENT_PROBE_FACTOR}x-fallback`

export type PriorityEntries = readonly { id: string; targetWeaponId: string }[]
/** The state an initial attempt derived itself: its retained set plus the ordinary Planner priority of the rest. */
export function derivedAttemptState(retainedEntryIds: readonly string[], priorityEntries: PriorityEntries, extent: DiscoveryState['extent']): DiscoveryState {
  return { retainedEntryIds: [...retainedEntryIds], pendingTargetIds: priorityEntries.filter(e => !retainedEntryIds.includes(e.id)).map(e => e.targetWeaponId), extent: { ...extent } }
}

export interface Phase1EExecution<T extends AttemptSummary> {
  attempt: T
  /** Stable ordinary Planner priority of the original Build List, as the child derived it from the Export. */
  priorityEntries: PriorityEntries
}
export interface Phase1EDependencies<T extends AttemptSummary> {
  /** Fallback-free Phase 0 control from the original Export. */
  control(): Promise<Phase1EExecution<T>>
  /** One axis strategy from the original Export. Receives the axis only: the run derives retained set and order itself. */
  initial(axis: ExtentAxis): Promise<Phase1EExecution<T>>
  /** A Phase 1-C retry state under the same axis strategy, executed again from the original Export. */
  retry(axis: ExtentAxis, state: DiscoveryState, strategy: string, reason: string, attemptId: number): Promise<T>
  nowMs(): number
  shouldStop(): 'cancelled' | 'time_budget' | null
}

export interface Phase1EVariant<T extends AttemptSummary> {
  axis: ExtentAxis
  strategy: string
  stage: 'initial' | 'retry'
  attempt: T
  outcome: ExtentVariantOutcome
  /** Controller elapsed time when this attempt finished (includes the control). */
  finishedAtMs: number
}

export function phase1eVariantOutcome(axis: ExtentAxis, attempt: AttemptSummary): ExtentVariantOutcome {
  const f = attempt.report.final
  return { signature: extentVariantSignature(attempt.signature, phase1eStrategyName(axis)), planningTargetCount: attempt.report.planningTargetCount, stop: attempt.stop,
    final: f ? { completedTargetCount: f.completedTargetCount, conflicts: f.conflicts, rejected: f.rejected, resourceConflictRejected: f.resourceConflictRejected,
      steps: f.steps, traceReplay: f.traceReplay, status: f.status } : null }
}

/** A completed variant, once observed, is never replaced by a later failure, cancel or deadline. */
export function phase1eControllerOutcome(variants: readonly ExtentVariantOutcome[], stop: string | null): 'completed' | string {
  return variants.some(isGlobalPlanSuccess) ? 'completed' : stop ?? 'not_completed'
}

function samePriority(a: PriorityEntries, b: PriorityEntries) {
  return a.length === b.length && a.every((e, i) => e.id === b[i].id && e.targetWeaponId === b[i].targetWeaponId)
}

/**
 * Control -> every axis strategy from the original Export -> (only when all of them are partial) the
 * bounded Phase 1-C retry per axis, best initial axis first, ending at the first axis that completes.
 * Variants are compared by their final Global Plan only (`compareExtentVariants`), never by a Candidate.
 */
export async function runPhase1EController<T extends AttemptSummary>(deps: Phase1EDependencies<T>, bounds: Phase1EBounds = PHASE1E_BOUNDS) {
  validatePhase1EBounds(bounds)
  const start = deps.nowMs()
  const elapsed = () => deps.nowMs() - start
  const variants: Phase1EVariant<T>[] = []
  const executed = new Set<string>()
  let priorityEntries: PriorityEntries | null = null
  let firstCompleted: { axis: ExtentAxis; stage: 'initial' | 'retry'; attemptId: number; elapsedMs: number; variantIndex: number } | null = null
  let stop: 'cancelled' | 'time_budget' | null
  const acceptPriority = (entries: PriorityEntries) => {
    // Each child derives it from the same original Export; a difference means the input changed.
    if (priorityEntries && !samePriority(priorityEntries, entries)) throw new Error('Priority entries differ between fresh runs of the original Export.')
    priorityEntries ??= structuredClone(entries)
  }
  const observe = (axis: ExtentAxis, stage: 'initial' | 'retry', attempt: T) => {
    const outcome = phase1eVariantOutcome(axis, attempt)
    if (executed.has(outcome.signature)) throw new Error('Duplicate Phase 1-E variant state.')
    executed.add(outcome.signature)
    const variant = { axis, strategy: phase1eStrategyName(axis), stage, attempt, outcome, finishedAtMs: elapsed() }
    variants.push(variant)
    if (!firstCompleted && isGlobalPlanSuccess(outcome)) firstCompleted = { axis, stage, attemptId: attempt.attemptId, elapsedMs: variant.finishedAtMs, variantIndex: variants.length - 1 }
    return attempt
  }

  stop = deps.shouldStop()
  let control: (Phase1EExecution<T> & { finishedAtMs: number }) | null = null
  if (!stop) {
    const executedControl = await deps.control()
    acceptPriority(executedControl.priorityEntries)
    control = { ...executedControl, finishedAtMs: elapsed() }
  }
  const initial: Phase1EVariant<T>[] = []
  for (const axis of EXTENT_AXES.slice(0, bounds.axisStrategies)) {
    stop ??= deps.shouldStop()
    if (stop) break
    const run = await deps.initial(axis)
    acceptPriority(run.priorityEntries)
    observe(axis, 'initial', run.attempt)
    initial.push(variants.at(-1)!)
  }
  const initialSuccess = initial.some(v => isGlobalPlanSuccess(v.outcome))
  const allInitialRan = initial.length === bounds.axisStrategies
  const retries: { axis: ExtentAxis; stopReason: StopReason; stageStops: { strategy: string; reason: StopReason }[]; cycleCount: number; attemptIds: number[] }[] = []
  // Retry only when every initial axis strategy ran to a partial result: a completed one makes it unnecessary.
  const retryStarted = !initialSuccess && allInitialRan && !stop && priorityEntries !== null
  if (retryStarted) {
    const ranked = [...initial].sort((a, b) => compareExtentVariants(a.outcome, b.outcome))
    for (const first of ranked) {
      stop ??= deps.shouldStop()
      if (stop) break
      const result = await runDiscoveryRetries(first.attempt, priorityEntries!, async (state, strategy, reason, attemptId) =>
        observe(first.axis, 'retry', await deps.retry(first.axis, state, strategy, reason, attemptId)), bounds.retry, () => deps.shouldStop())
      retries.push({ axis: first.axis, stopReason: result.stopReason, stageStops: result.stageStops, cycleCount: result.cycleCount, attemptIds: result.attempts.map(a => a.attemptId) })
      if (result.attempts.some(a => a.stop === 'completed')) break
      if (result.stopReason === 'cancelled' || result.stopReason === 'time_budget') { stop = result.stopReason; break }
    }
  }
  const ranking = [...variants].sort((a, b) => compareExtentVariants(a.outcome, b.outcome))
  const winner = ranking.find(v => isGlobalPlanSuccess(v.outcome)) ?? null
  const outcome = phase1eControllerOutcome(variants.map(v => v.outcome), stop)
  return { control, initial, initialSuccess, retryStarted, retries, variants, ranking, winner, firstCompleted: firstCompleted as typeof firstCompleted,
    outcome, stop, cancel: { requested: stop === 'cancelled', completedBeforeStop: stop !== null && variants.some(v => isGlobalPlanSuccess(v.outcome)) },
    priorityEntries, elapsedMs: elapsed() }
}

/**
 * Fresh reproduction of a winner from the original Export with the axis strategy (and bounds) only.
 * An initial winner is one fresh initial run. A retry winner reruns that axis' whole chain; every state it
 * executes is again derived by the chain itself, never taken from the winner.
 */
export async function reproducePhase1EWinner<T extends AttemptSummary>(winner: Pick<Phase1EVariant<T>, 'axis' | 'stage' | 'outcome'>,
  deps: Pick<Phase1EDependencies<T>, 'initial' | 'retry' | 'shouldStop'>, bounds: Phase1EBounds = PHASE1E_BOUNDS): Promise<T | null> {
  validatePhase1EBounds(bounds)
  const first = await deps.initial(winner.axis)
  if (winner.stage === 'initial') return first.attempt
  const result = await runDiscoveryRetries(first.attempt, first.priorityEntries, (state, strategy, reason, attemptId) =>
    deps.retry(winner.axis, state, strategy, reason, attemptId), bounds.retry, () => deps.shouldStop())
  return result.attempts.find(a => phase1eVariantOutcome(winner.axis, a).signature === winner.outcome.signature) as T | undefined ?? null
}
