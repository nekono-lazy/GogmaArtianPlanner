import type {
  BuildListEntry,
  BuildListEntryId,
  ConflictKind,
  PlanConflict,
  TargetWeaponId,
} from '../models/publicTypes'
import type { PlannerLaneProgress } from './plannerRouteLanes'
import type {
  PlannerRouteCommitmentObserver,
  PlannerRouteCommitmentRecord,
} from './plannerRouteCommitment'
import type {
  PlannerRunResult,
  PlannerRunTerminationStatus,
  PlannerSearchAction,
  PlannerSearchRejection,
  PlannerSearchRejectionReason,
} from './plannerTypes'

/**
 * Runtime-only observation of one deterministic scheduler run (Issue #103
 * Phase B, `docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 17).
 *
 * It is the scheduler counterpart of `PlannerSearchInstrumentation` and shares
 * its contract, but not its Beam depth model: a scheduler has no depth, no
 * beam, no successor array and no semantic dedup, so none of those are
 * reported here.
 *
 * - `undefined` is exactly the ordinary scheduler: no collector is created.
 * - When present, the collector only *reads* what the scheduler already
 *   decided. It never mutates the state, never reorders or filters an action,
 *   never calls the RNG Engine, and never changes `expandedStates` or a stop
 *   condition. The result with and without it is identical.
 * - Like `PlannerDependencies`, it carries functions and is never part of
 *   `PlannerInput`, a Worker DTO, a `PlannerResult`, a `ProductionPlan` or
 *   persistence. Its metrics are plain structured-clone data.
 *
 * A throw from a callback propagates unchanged.
 */
export interface PlannerSchedulerInstrumentation {
  /**
   * An optional monotonic clock (for example `performance.now`). When given,
   * `PlannerSchedulerRunMetrics.phaseMs` adds up the time of each scheduler
   * phase. No scheduler decision reads it.
   */
  readonly now?: () => number
  /** Called once when the schedule ends, including the early-return paths. */
  readonly onScheduleEnd?: (metrics: PlannerSchedulerRunMetrics) => void
}

/**
 * Why an Entry left the committed set (design 6.5 / 6.8 / 7.8).
 *
 * - `initial_resolution`   an explicit resolution selected another Entry
 * - `initial_precondition` its holding unit was already passed, or its source
 *   cannot be used, when the run started
 * - `provisional_outcome`  the provisional outcome of an unresolved collision
 * - `deadlock` / `stall`   no safe action was left (7.8)
 * - `precondition`         a committed lane head broke while scheduling (6.8)
 * - `action_rejected`      the chosen route action was rejected when applied
 * - `reserve_rejected`     the immediate reserve was rejected
 */
export type PlannerSchedulerDropCause =
  | 'initial_resolution'
  | 'initial_precondition'
  | 'provisional_outcome'
  | 'deadlock'
  | 'stall'
  | 'precondition'
  | 'action_rejected'
  | 'reserve_rejected'

export interface PlannerSchedulerDropRecord {
  buildListEntryId: BuildListEntryId
  targetWeaponId: TargetWeaponId | null
  cause: PlannerSchedulerDropCause
  reason: PlannerSearchRejectionReason
  actionType: PlannerSearchRejection['actionType']
  /** 0 for the initial commitment, otherwise the 1-based scheduler iteration. */
  iteration: number
  /** The provisional winner the Entry collided with, for `provisional_outcome`. */
  winnerBuildListEntryId: BuildListEntryId | null
  conflictKind: ConflictKind | null
  conflictId: string | null
}

/** One decided Entry of the provisional outcome loop (6.5) and whom it pushed out. */
export interface PlannerSchedulerProvisionalOutcome {
  winnerBuildListEntryId: BuildListEntryId
  winnerTargetWeaponId: TargetWeaponId
  loserBuildListEntryIds: BuildListEntryId[]
}

/** Where a scheduler run spends its time, when a clock was given. */
export interface PlannerSchedulerPhaseTimes {
  /** Zero-operation confirmations and the initial Route commitment. */
  initialize: number
  /** The dynamic commitment events of every iteration (6.8). */
  refreshCommitment: number
  /** Frontier classification and the canonical ordering of safe actions. */
  safeActions: number
  /** The one applied route action per iteration. */
  applyAction: number
  /** Immediate reserves, unit-less Routes included. */
  reserve: number
  /** Conflict collection, scoring and the result of `finish()`. */
  finish: number
}

export type PlannerSchedulerPhase = keyof PlannerSchedulerPhaseTimes

export interface PlannerSchedulerCounts {
  /** `createPlannerRouteCommitment()` plus every dynamic `canCommitPlannerRoute()`. */
  commitmentRuns: number
  /** Iterations of the provisional outcome loop, over every commitment run. */
  commitmentIterations: number
  /** Entries entering the initial provisional outcome loop. */
  initialCandidates: number
  initialCommitted: number
  initialDropped: number
  initialSecured: number
  initialNotNeeded: number
  /** `detectPlannerConflicts()` calls made by commitment. */
  collisionDetectionCount: number
  /** Conflicts those calls returned, summed. */
  detectedCollisionCount: number
  provisionalWinnerCount: number
  provisionalLoserCount: number
  /** `not_needed` / `released` -> `committed` during scheduling (6.8). */
  dynamicCommitCount: number
  /** `committed` -> `released` (cross satisfaction). */
  releaseCount: number
  /** `released` -> `committed` (the subset of `dynamicCommitCount`). */
  recommitCount: number
  deadlockDropCount: number
  stallDropCount: number
  /** Lane-head, applied-action and reserve precondition drops while scheduling. */
  preconditionDropCount: number
  /** `step()` calls. */
  schedulerIterationCount: number
  appliedRouteActionCount: number
  appliedReserveActionCount: number
  /** Safe actions listed per iteration, summed / at most. */
  safeActionCandidateCountTotal: number
  safeActionCandidateCountMax: number
  /** Iterations in which at least one stream position waited (7.3). */
  waitingIterationCount: number
  /** Waiting stream positions (and blind forges), summed over every iteration. */
  waitingStreamCountTotal: number
  /** Applied route actions that progressed two or more Entries. */
  physicalSharedActionCount: number
  /** Extra Entries those shared actions progressed (progressed count - 1, summed). */
  sharedProgressedEntryCount: number
  /** Units passed silently by `fastForwardPlannerRouteProgress()`. */
  fastForwardedUnitCount: number
  fastForwardedBonusUnitCount: number
  fastForwardedSkillUnitCount: number
  finalCommitted: number
  finalSecured: number
  finalReleased: number
  finalDropped: number
  finalNotNeeded: number
}

export interface PlannerSchedulerRunMetrics {
  /** `false` for an input that was finished before any scheduling. */
  reachedScheduler: boolean
  planningTargetCount: number
  searchEntryCount: number
  maxPlanSteps: number
  expandedStates: number
  traceLength: number
  terminationStatus: PlannerRunTerminationStatus
  completedTargetCount: number
  totalTargetCount: number
  counts: PlannerSchedulerCounts
  provisionalOutcomes: PlannerSchedulerProvisionalOutcome[]
  drops: PlannerSchedulerDropRecord[]
  /** `null` unless `PlannerSchedulerInstrumentation.now` was given. */
  phaseMs: PlannerSchedulerPhaseTimes | null
}

export function emptyPlannerSchedulerCounts(): PlannerSchedulerCounts {
  return {
    commitmentRuns: 0,
    commitmentIterations: 0,
    initialCandidates: 0,
    initialCommitted: 0,
    initialDropped: 0,
    initialSecured: 0,
    initialNotNeeded: 0,
    collisionDetectionCount: 0,
    detectedCollisionCount: 0,
    provisionalWinnerCount: 0,
    provisionalLoserCount: 0,
    dynamicCommitCount: 0,
    releaseCount: 0,
    recommitCount: 0,
    deadlockDropCount: 0,
    stallDropCount: 0,
    preconditionDropCount: 0,
    schedulerIterationCount: 0,
    appliedRouteActionCount: 0,
    appliedReserveActionCount: 0,
    safeActionCandidateCountTotal: 0,
    safeActionCandidateCountMax: 0,
    waitingIterationCount: 0,
    waitingStreamCountTotal: 0,
    physicalSharedActionCount: 0,
    sharedProgressedEntryCount: 0,
    fastForwardedUnitCount: 0,
    fastForwardedBonusUnitCount: 0,
    fastForwardedSkillUnitCount: 0,
    finalCommitted: 0,
    finalSecured: 0,
    finalReleased: 0,
    finalDropped: 0,
    finalNotNeeded: 0,
  }
}

function emptyPhaseTimes(): PlannerSchedulerPhaseTimes {
  return {
    initialize: 0,
    refreshCommitment: 0,
    safeActions: 0,
    applyAction: 0,
    reserve: 0,
    finish: 0,
  }
}

export interface PlannerSchedulerMetricsContext {
  instrumentation: PlannerSchedulerInstrumentation
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>
  planningTargetCount: number
  searchEntryCount: number
  options: { maxPlanSteps: number }
}

/**
 * The scheduler side of `PlannerSchedulerInstrumentation`. The scheduler holds
 * `null` instead of one when no instrumentation was supplied, so every hook is
 * a single optional call that does nothing.
 */
export class PlannerSchedulerMetricsCollector implements PlannerRouteCommitmentObserver {
  private readonly context: PlannerSchedulerMetricsContext
  private readonly counts = emptyPlannerSchedulerCounts()
  private readonly phaseMs = emptyPhaseTimes()
  private readonly provisionalOutcomes: PlannerSchedulerProvisionalOutcome[] = []
  private readonly drops: PlannerSchedulerDropRecord[] = []
  /** 0 while the initial commitment runs. */
  private iteration = 0
  /** The cause the next status change to `dropped` is attributed to. */
  private pendingDropCause: PlannerSchedulerDropCause | null = null
  private readonly provisionalWinnerByLoser = new Map<
    BuildListEntryId,
    { winner: BuildListEntryId; conflict: PlanConflict }
  >()

  constructor(context: PlannerSchedulerMetricsContext) {
    this.context = context
  }

  /** The optional clock reading, or `undefined` when none was given. */
  mark(): number | undefined {
    return this.context.instrumentation.now?.()
  }

  addPhaseTime(phase: PlannerSchedulerPhase, startedAt: number | undefined): void {
    const now = this.context.instrumentation.now
    if (startedAt === undefined || now === undefined) return
    this.phaseMs[phase] += now() - startedAt
  }

  // --- PlannerRouteCommitmentObserver -----------------------------------

  commitmentRun(): void {
    this.counts.commitmentRuns += 1
  }

  collisionDetection(detectedConflicts: number): void {
    this.counts.collisionDetectionCount += 1
    this.counts.detectedCollisionCount += detectedConflicts
  }

  commitmentIteration(): void {
    this.counts.commitmentIterations += 1
  }

  provisionalOutcome(
    winner: BuildListEntry,
    losers: readonly { entry: BuildListEntry; conflict: PlanConflict }[],
  ): void {
    this.counts.provisionalWinnerCount += 1
    this.counts.provisionalLoserCount += losers.length
    this.provisionalOutcomes.push({
      winnerBuildListEntryId: winner.id,
      winnerTargetWeaponId: winner.targetWeaponId,
      loserBuildListEntryIds: losers.map(({ entry }) => entry.id),
    })
    losers.forEach(({ entry, conflict }) =>
      this.provisionalWinnerByLoser.set(entry.id, { winner: winner.id, conflict }),
    )
  }

  // --- scheduler hooks --------------------------------------------------

  /** The initial commitment finished; `candidates` entered the provisional loop. */
  initialCommitment(
    records: readonly PlannerRouteCommitmentRecord[],
    candidates: number,
  ): void {
    const counts = this.counts
    counts.initialCandidates = candidates
    records.forEach((record) => {
      switch (record.status) {
        case 'committed':
          counts.initialCommitted += 1
          return
        case 'secured':
          counts.initialSecured += 1
          return
        case 'not_needed':
          counts.initialNotNeeded += 1
          return
        case 'released':
          return
        case 'dropped': {
          counts.initialDropped += 1
          const rejection = record.rejection
          if (rejection === null) return
          const provisional = this.provisionalWinnerByLoser.get(record.buildListEntryId)
          this.recordDrop(
            record.buildListEntryId,
            provisional !== undefined
              ? 'provisional_outcome'
              : rejection.reason === 'conflict_resolution_not_selected'
                ? 'initial_resolution'
                : 'initial_precondition',
            rejection,
            provisional,
          )
        }
      }
    })
  }

  /** The cause the next `dropped` status change belongs to. */
  expectDrop(cause: PlannerSchedulerDropCause): void {
    this.pendingDropCause = cause
  }

  /** One commitment status change while scheduling (6.8 / 7.8). */
  statusChange(
    entryId: BuildListEntryId,
    before: PlannerRouteCommitmentRecord['status'] | null,
    after: PlannerRouteCommitmentRecord['status'],
    rejection: PlannerSearchRejection | null,
  ): void {
    const counts = this.counts
    if (after === 'committed' && (before === 'not_needed' || before === 'released')) {
      counts.dynamicCommitCount += 1
      if (before === 'released') counts.recommitCount += 1
    }
    if (after === 'released' && before === 'committed') counts.releaseCount += 1
    if (after === 'dropped' && before !== 'dropped' && rejection !== null) {
      const cause = this.pendingDropCause ?? 'precondition'
      switch (cause) {
        case 'deadlock':
          counts.deadlockDropCount += 1
          break
        case 'stall':
          counts.stallDropCount += 1
          break
        default:
          counts.preconditionDropCount += 1
      }
      this.recordDrop(entryId, cause, rejection, undefined)
    }
    this.pendingDropCause = null
  }

  private recordDrop(
    entryId: BuildListEntryId,
    cause: PlannerSchedulerDropCause,
    rejection: PlannerSearchRejection,
    provisional: { winner: BuildListEntryId; conflict: PlanConflict } | undefined,
  ) {
    this.drops.push({
      buildListEntryId: entryId,
      targetWeaponId: this.context.entriesById.get(entryId)?.targetWeaponId ?? null,
      cause,
      reason: rejection.reason,
      actionType: rejection.actionType,
      iteration: this.iteration,
      winnerBuildListEntryId: provisional?.winner ?? null,
      conflictKind: provisional?.conflict.kind ?? null,
      conflictId: provisional?.conflict.id ?? null,
    })
  }

  beginIteration(): void {
    this.iteration += 1
    this.counts.schedulerIterationCount += 1
  }

  safeActionsListed(candidates: number, waitingStreams: number): void {
    const counts = this.counts
    counts.safeActionCandidateCountTotal += candidates
    counts.safeActionCandidateCountMax = Math.max(counts.safeActionCandidateCountMax, candidates)
    counts.waitingStreamCountTotal += waitingStreams
    if (waitingStreams > 0) counts.waitingIterationCount += 1
  }

  /**
   * One applied route action. Fast-forwarded units are read off the progress
   * difference: whatever lane progress moved beyond the one unit each
   * progressed Entry executed was passed silently. `before` is the shallow
   * progress record read right before the action; progress objects are
   * replaced, never mutated, so it still holds the old values.
   */
  routeActionApplied(
    action: PlannerSearchAction | undefined,
    before: Readonly<Record<string, PlannerLaneProgress>>,
    after: Readonly<Record<string, PlannerLaneProgress>>,
  ): void {
    const counts = this.counts
    counts.appliedRouteActionCount += 1
    if (action === undefined) return
    const progressed = new Set<string>(action.progressedBuildListEntryIds)
    if (progressed.size > 1) {
      counts.physicalSharedActionCount += 1
      counts.sharedProgressedEntryCount += progressed.size - 1
    }
    const lane =
      action.actionType === 'reset_bonuses' || action.actionType === 'keep_bonuses'
        ? 'bonus'
        : action.actionType === 'reset_skills'
          ? 'skill'
          : 'base'
    Object.entries(after).forEach(([entryId, progress]) => {
      const previous = before[entryId] ?? { base: 0, bonus: 0, skill: 0 }
      if (progress === previous) return
      const executed = progressed.has(entryId) ? 1 : 0
      const bonus = Math.max(progress.bonus - previous.bonus - (lane === 'bonus' ? executed : 0), 0)
      const skill = Math.max(progress.skill - previous.skill - (lane === 'skill' ? executed : 0), 0)
      counts.fastForwardedBonusUnitCount += bonus
      counts.fastForwardedSkillUnitCount += skill
      counts.fastForwardedUnitCount += bonus + skill
    })
  }

  reserveApplied(): void {
    this.counts.appliedReserveActionCount += 1
  }

  finish(
    result: PlannerRunResult,
    records: readonly PlannerRouteCommitmentRecord[],
  ): void {
    const counts = this.counts
    records.forEach(({ status }) => {
      switch (status) {
        case 'committed':
          counts.finalCommitted += 1
          return
        case 'secured':
          counts.finalSecured += 1
          return
        case 'released':
          counts.finalReleased += 1
          return
        case 'dropped':
          counts.finalDropped += 1
          return
        case 'not_needed':
          counts.finalNotNeeded += 1
      }
    })
    this.context.instrumentation.onScheduleEnd?.({
      reachedScheduler: true,
      planningTargetCount: this.context.planningTargetCount,
      searchEntryCount: this.context.searchEntryCount,
      maxPlanSteps: this.context.options.maxPlanSteps,
      expandedStates: result.expandedStates,
      traceLength: result.bestState?.trace.length ?? 0,
      terminationStatus: result.termination.status,
      completedTargetCount: result.termination.completedTargetCount,
      totalTargetCount: result.termination.totalTargetCount,
      counts: { ...counts },
      provisionalOutcomes: this.provisionalOutcomes.map((outcome) => ({
        ...outcome,
        loserBuildListEntryIds: [...outcome.loserBuildListEntryIds],
      })),
      drops: this.drops.map((drop) => ({ ...drop })),
      phaseMs: this.context.instrumentation.now === undefined ? null : { ...this.phaseMs },
    })
  }
}

/**
 * `null` when no instrumentation was supplied; the context is then never
 * built, so an uninstrumented schedule does no extra work at all.
 */
export function createPlannerSchedulerMetricsCollector(
  instrumentation: PlannerSchedulerInstrumentation | undefined,
  context: () => Omit<PlannerSchedulerMetricsContext, 'instrumentation'>,
): PlannerSchedulerMetricsCollector | null {
  if (instrumentation === undefined) return null
  return new PlannerSchedulerMetricsCollector({ ...context(), instrumentation })
}

/**
 * The metrics of a run the scheduler finished before scheduling anything: a
 * validation failure, no planning Target, or a contradictory resolution set.
 */
export function reportUnscheduledPlannerRun(
  instrumentation: PlannerSchedulerInstrumentation | undefined,
  input: { maxPlanSteps: number; searchEntryCount: number },
  result: PlannerRunResult,
): void {
  instrumentation?.onScheduleEnd?.({
    reachedScheduler: false,
    planningTargetCount: result.termination.totalTargetCount,
    searchEntryCount: input.searchEntryCount,
    maxPlanSteps: input.maxPlanSteps,
    expandedStates: result.expandedStates,
    traceLength: result.bestState?.trace.length ?? 0,
    terminationStatus: result.termination.status,
    completedTargetCount: result.termination.completedTargetCount,
    totalTargetCount: result.termination.totalTargetCount,
    counts: emptyPlannerSchedulerCounts(),
    provisionalOutcomes: [],
    drops: [],
    phaseMs: instrumentation.now === undefined ? null : emptyPhaseTimes(),
  })
}
