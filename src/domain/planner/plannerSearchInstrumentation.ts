import type {
  BuildListEntry,
  BuildListEntryId,
  ConflictKind,
  PlanConflict,
  RouteKind,
  TargetWeaponId,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import type { PlannerRouteUnit } from './plannerRouteProgress'
import type { PlannerRouteLane } from './plannerRouteLanes'
import { createPlannerSearchStateSemanticKey } from './plannerScoring'
import type {
  PlannerSearchAction,
  PlannerSearchRejection,
  PlannerSearchRejectionReason,
  PlannerSearchState,
  PlannerSearchTerminationStatus,
} from './plannerTypes'

/**
 * Runtime-only observation of one Beam Search (Issue #103 measurement phase).
 *
 * It exists so a benchmark or a test can see *where* a Beam Search spends its
 * `maxExpandedStates` budget. It is semantics-neutral by contract:
 *
 * - `undefined` is exactly the previous Beam Search: no collector is created
 *   and no extra work runs.
 * - When present, the collector only *reads* search states the Beam Search
 *   already built. It never clones, mutates, reorders, or filters a state, never
 *   calls the RNG Engine, and never changes a comparator, a semantic key, a
 *   stop condition, or `expandedStates`. The result of a search with and
 *   without it is identical.
 * - Like `PlannerDependencies`, it carries functions and is therefore never part
 *   of `PlannerInput`, a Worker DTO, a `PlannerResult`, a `ProductionPlan`, or
 *   persistence. Its metrics are plain data delivered to the callbacks only.
 *
 * A throw from a callback propagates unchanged; it is never converted into a
 * Planner result.
 */
export interface PlannerSearchInstrumentation {
  /**
   * Also compute the two diagnostic projections of
   * `PlannerSearchDepthMetrics.diagnosticProjections`. They serialize every
   * successor once more, so they are opt-in and excluded from the overhead of
   * the ordinary metrics.
   */
  readonly collectDiagnosticProjections?: boolean
  /**
   * An optional monotonic clock (for example `performance.now`). When given,
   * the collector adds the time spent in four Beam Search phases to
   * `PlannerSearchDepthMetrics.phaseMs`. The Domain never reads a clock of its
   * own, and no search decision reads this one.
   */
  readonly now?: () => number
  /** Called once per Beam Search depth, after the semantic dedup and the trim. */
  readonly onDepth?: (metrics: PlannerSearchDepthMetrics) => void
  /** Called once when the search returns, including the early-return paths. */
  readonly onSearchEnd?: (metrics: PlannerSearchRunMetrics) => void
}

export type PlannerSearchInstrumentationLane = PlannerRouteLane | 'reserve'

export interface PlannerSearchLaneCounts {
  base: number
  bonus: number
  skill: number
  reserve: number
}

export interface PlannerSearchStreamLaneCounts {
  bonus: number
  skill: number
}

export type PlannerSearchConflictKindCounts = Record<ConflictKind, number>

export type PlannerSearchRejectionReasonCounts = Partial<
  Record<PlannerSearchRejectionReason, number>
>

/**
 * Two coarser projections of a search state, used only to count how many
 * successors *would* coincide under them. Neither is a valid deduplication key
 * and neither is used by the search: they only tell a reader how much of the
 * semantic uniqueness comes from the fields they leave out.
 *
 * - `traceFree`: the Beam Search semantic key (`createPlannerSearchStateSemanticKey`)
 *   computed with an empty trace, so two successors that differ only in the
 *   order / identity of their past actions coincide. Everything else the
 *   semantic key carries (source mutation versions, route runtime, inventory,
 *   ...) still separates them.
 * - `progress`: Counter values, per-Entry lane progress, reached checkpoints,
 *   secured Entries and Target satisfaction only. Two successors coincide when
 *   they reached the same Route progress at the same Counters, whichever Entry
 *   physically executed a shared-position unit.
 */
export interface PlannerSearchDiagnosticProjections {
  successorsAfterTraceFreeKey: number
  successorsAfterProgressKey: number
  keptBeamDistinctProgressKeys: number
}

export type PlannerSearchDepthStop = 'max_expanded_states' | 'cancelled' | null

/**
 * Where a depth spends its time, when `PlannerSearchInstrumentation.now` is
 * given. `beamStateSetup`: conflict detection, required-unit indexing and the
 * pending reserves of each expanded beam state. `applyAction`: building each
 * route-operation successor (state clone included). `successorEvaluation`:
 * conflict detection and scoring of each pushed successor. `dedupAndTrim`:
 * semantic keys, comparator sort and slice.
 */
export interface PlannerSearchPhaseTimes {
  beamStateSetup: number
  applyAction: number
  successorEvaluation: number
  dedupAndTrim: number
}

export type PlannerSearchPhase = keyof PlannerSearchPhaseTimes

export interface PlannerSearchDepthMetrics {
  /** 0-based Beam Search iteration. */
  depth: number
  /** States in the beam this depth started from. */
  beamInputStates: number
  /** Beam states whose successor generation ran (fully or until a stop). */
  expandedBeamStates: number
  /** Beam states that were already complete and generated nothing. */
  completeBeamStates: number
  /** Beam states at `maxPlanSteps` that generated nothing. */
  stepLimitBeamStates: number
  /** Beam states never visited because the search stopped during this depth. */
  unvisitedBeamStates: number
  /** Successor attempts built, rejected ones included. */
  attemptedActions: number
  /** Attempts that returned a rejection instead of a state (occurrences). */
  rejectedAttempts: number
  /** Skippable units never generated because a required unit owns the position. */
  prunedDominatedSkippableUnits: number
  /** Units not generated because a conflict resolution selected another Entry. */
  conflictBlockedUnits: number
  /**
   * Successors pushed this depth. Each one is one `expandedStates` increment:
   * `maxExpandedStates` bounds this number, not the number of beam states.
   */
  generatedSuccessors: number
  /** Generated successors by the lane of the action that produced them. */
  generatedSuccessorsByLane: PlannerSearchLaneCounts
  successorsBeforeSemanticDedup: number
  successorsAfterSemanticDedup: number
  semanticDuplicatesRemoved: number
  statesBeforeBeamTrim: number
  statesAfterBeamTrim: number
  beamTrimmedStates: number
  /** Completed planning Targets over the kept beam (after the trim). */
  bestCompletedTargetCount: number
  worstCompletedTargetCount: number
  /** Index = completed Target count, value = kept beam states. */
  completedTargetCountDistribution: number[]
  /** Completed Target count of the state the comparator ranks first. */
  topRankedCompletedTargetCount: number
  /** Over every deduplicated successor, before the trim. */
  maxCompletedTargetCountBeforeTrim: number
  /** Over the trimmed-away states only; `null` when nothing was trimmed. */
  maxCompletedTargetCountAmongTrimmed: number | null
  /** Trimmed states completing more Targets than the best kept state. */
  trimmedStatesAboveKeptBest: number
  bestEvaluationScore: number | null
  lowestKeptEvaluationScore: number | null
  bestTrimmedEvaluationScore: number | null
  /** Longest trace (Plan actions, reserves included) in the kept beam. */
  maxKeptTraceLength: number
  /** Conflicts detected on the beam states expanded this depth, summed. */
  expandedStateConflicts: number
  expandedStateConflictsByKind: PlannerSearchConflictKindCounts
  /** Route-operation attempts whose primary unit is a shareable physical action. */
  shareablePrimaryAttempts: number
  /** Generated successors whose one physical action progressed 2+ Entries. */
  sharedPhysicalActionSuccessors: number
  /** Extra Entries those shared actions progressed (progressed count - 1, summed). */
  sharedProgressedEntries: number
  /** Units silently fast-forwarded inside the generated successors. */
  fastForwardedUnits: PlannerSearchStreamLaneCounts
  /** (successor, Entry) pairs in which at least one unit was fast-forwarded. */
  fastForwardedEntries: number
  diagnosticProjections: PlannerSearchDiagnosticProjections | null
  /** `null` unless `PlannerSearchInstrumentation.now` was given. */
  phaseMs: PlannerSearchPhaseTimes | null
  /** Whether the search stopped during this depth, and why. */
  stoppedBy: PlannerSearchDepthStop
  /** `expandedStates` after this depth. */
  cumulativeExpandedStates: number
}

export interface PlannerSearchEntryMetrics {
  buildListEntryId: BuildListEntryId
  targetWeaponId: TargetWeaponId
  routeKind: RouteKind
  unitCounts: { base: number; bonus: number; skill: number }
  /** Generated successors whose primary action belongs to this Entry. */
  generatedSuccessors: PlannerSearchLaneCounts
  rejectedAttempts: number
  /** Generated successors in which this Entry was progressed as a secondary. */
  progressedAsSharedSecondary: number
  fastForwardedUnits: PlannerSearchStreamLaneCounts
  reserveAttempts: number
  reserveSuccesses: number
}

export interface PlannerSearchRunMetrics {
  /** `false` for an input that never reached a Beam Search depth. */
  reachedBeamSearch: boolean
  depthCount: number
  planningTargetCount: number
  searchEntryCount: number
  beamWidth: number
  maxExpandedStates: number
  maxPlanSteps: number
  expandedStates: number
  terminationStatus: PlannerSearchTerminationStatus
  completedTargetCount: number
  totals: {
    attemptedActions: number
    rejectedAttempts: number
    generatedSuccessors: number
    generatedSuccessorsByLane: PlannerSearchLaneCounts
    successorsBeforeSemanticDedup: number
    successorsAfterSemanticDedup: number
    statesAfterBeamTrim: number
    prunedDominatedSkippableUnits: number
    conflictBlockedUnits: number
    shareablePrimaryAttempts: number
    sharedPhysicalActionSuccessors: number
    sharedProgressedEntries: number
    fastForwardedUnits: PlannerSearchStreamLaneCounts
    fastForwardedEntries: number
    reserveAttempts: number
    reserveSuccesses: number
    /** Successors completing more planning Targets than the state they came from. */
    targetCompletionSuccessors: number
  }
  /**
   * Rejections by reason, counted every time an attempt returned one. The
   * Beam Search result keeps each distinct rejection only once, so this is
   * *not* `PlannerBeamSearchResult.rejections` grouped by reason.
   */
  rejectionOccurrencesByReason: PlannerSearchRejectionReasonCounts
  /** Distinct conflicts the search discovered, the result's `conflicts` by kind. */
  uniqueConflictsByKind: PlannerSearchConflictKindCounts
  /** Conflicts detected on expanded beam states, summed over every depth. */
  expandedStateConflictsByKind: PlannerSearchConflictKindCounts
  /** Highest completed Target count of any generated successor. */
  maxCompletedTargetCountEverObserved: number
  /**
   * Index = completed Target count, value = the first depth at which a
   * generated successor reached it (`null` when never reached).
   */
  firstDepthByCompletedTargetCount: Array<number | null>
  entries: PlannerSearchEntryMetrics[]
}

export interface PlannerSearchMetricsContext {
  instrumentation: PlannerSearchInstrumentation
  entries: readonly BuildListEntry[]
  unitCountsByEntryId: ReadonlyMap<
    BuildListEntryId,
    { base: number; bonus: number; skill: number }
  >
  planningTargetCount: number
  options: { beamWidth: number; maxExpandedStates: number; maxPlanSteps: number }
  countCompletedTargets: (state: PlannerSearchState) => number
}

function emptyLaneCounts(): PlannerSearchLaneCounts {
  return { base: 0, bonus: 0, skill: 0, reserve: 0 }
}

function emptyStreamLaneCounts(): PlannerSearchStreamLaneCounts {
  return { bonus: 0, skill: 0 }
}

export function emptyPlannerSearchConflictKindCounts(): PlannerSearchConflictKindCounts {
  return {
    same_gogma_counter: 0,
    same_skill_counter: 0,
    same_normal_counter: 0,
    same_owned_weapon_consumed: 0,
  }
}

function laneOfActionType(
  actionType: PlannerSearchRejection['actionType'],
): PlannerSearchInstrumentationLane {
  switch (actionType) {
    case 'create_normal_artian':
    case 'convert_normal_to_gogma':
      return 'base'
    case 'reset_bonuses':
    case 'keep_bonuses':
      return 'bonus'
    case 'reset_skills':
      return 'skill'
    case 'reserve_weapon':
      return 'reserve'
  }
}

function lastAction(state: PlannerSearchState): PlannerSearchAction | undefined {
  return state.trace[state.trace.length - 1]
}

function progressProjectionKey(state: PlannerSearchState): string {
  return stableStringify({
    gogmaCounter: state.currentRngState.gogmaCounter.value,
    skillCounter: state.currentRngState.skillCounter.value,
    normalCounters: state.currentNormalCounters
      .map(({ id, counter }) => ({ id, counter }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    routeProgressByEntryId: state.routeProgressByEntryId,
    reachedCheckpointByEntryId: state.reachedCheckpointByEntryId,
    selectedBuildListEntryIds: [...state.selectedBuildListEntryIds].sort(),
    targetSatisfaction: state.targetSatisfaction,
  })
}

function traceFreeProjectionKey(state: PlannerSearchState): string {
  // The semantic key authority itself, read over a shallow view whose trace is
  // empty. The view is a new object; the state is never touched.
  return createPlannerSearchStateSemanticKey({ ...state, trace: [] })
}

interface DepthAccumulator {
  depth: number
  beamInputStates: number
  visitedBeamStates: number
  expandedBeamStates: number
  completeBeamStates: number
  stepLimitBeamStates: number
  attemptedActions: number
  rejectedAttempts: number
  prunedDominatedSkippableUnits: number
  conflictBlockedUnits: number
  generatedSuccessors: number
  generatedSuccessorsByLane: PlannerSearchLaneCounts
  expandedStateConflicts: number
  expandedStateConflictsByKind: PlannerSearchConflictKindCounts
  shareablePrimaryAttempts: number
  sharedPhysicalActionSuccessors: number
  sharedProgressedEntries: number
  fastForwardedUnits: PlannerSearchStreamLaneCounts
  fastForwardedEntries: number
  phaseMs: PlannerSearchPhaseTimes
}

function emptyPhaseTimes(): PlannerSearchPhaseTimes {
  return { beamStateSetup: 0, applyAction: 0, successorEvaluation: 0, dedupAndTrim: 0 }
}

function newDepth(depth: number, beamInputStates: number): DepthAccumulator {
  return {
    depth,
    beamInputStates,
    visitedBeamStates: 0,
    expandedBeamStates: 0,
    completeBeamStates: 0,
    stepLimitBeamStates: 0,
    attemptedActions: 0,
    rejectedAttempts: 0,
    prunedDominatedSkippableUnits: 0,
    conflictBlockedUnits: 0,
    generatedSuccessors: 0,
    generatedSuccessorsByLane: emptyLaneCounts(),
    expandedStateConflicts: 0,
    expandedStateConflictsByKind: emptyPlannerSearchConflictKindCounts(),
    shareablePrimaryAttempts: 0,
    sharedPhysicalActionSuccessors: 0,
    sharedProgressedEntries: 0,
    fastForwardedUnits: emptyStreamLaneCounts(),
    fastForwardedEntries: 0,
    phaseMs: emptyPhaseTimes(),
  }
}

function addLaneCounts(
  total: PlannerSearchLaneCounts,
  value: PlannerSearchLaneCounts,
) {
  total.base += value.base
  total.bonus += value.bonus
  total.skill += value.skill
  total.reserve += value.reserve
}

function addConflictCounts(
  total: PlannerSearchConflictKindCounts,
  value: PlannerSearchConflictKindCounts,
) {
  ;(Object.keys(total) as ConflictKind[]).forEach((kind) => {
    total[kind] += value[kind]
  })
}

/**
 * The Beam Search side of `PlannerSearchInstrumentation`. The Beam Search holds
 * `null` instead of one when no instrumentation was supplied, so every hook is a
 * single optional call that does nothing.
 */
export class PlannerSearchMetricsCollector {
  private readonly context: PlannerSearchMetricsContext
  private readonly completedCache = new WeakMap<PlannerSearchState, number>()
  private readonly entryMetrics = new Map<BuildListEntryId, PlannerSearchEntryMetrics>()
  private current: DepthAccumulator | null = null
  private depthCount = 0
  private readonly totals: PlannerSearchRunMetrics['totals'] = {
    attemptedActions: 0,
    rejectedAttempts: 0,
    generatedSuccessors: 0,
    generatedSuccessorsByLane: emptyLaneCounts(),
    successorsBeforeSemanticDedup: 0,
    successorsAfterSemanticDedup: 0,
    statesAfterBeamTrim: 0,
    prunedDominatedSkippableUnits: 0,
    conflictBlockedUnits: 0,
    shareablePrimaryAttempts: 0,
    sharedPhysicalActionSuccessors: 0,
    sharedProgressedEntries: 0,
    fastForwardedUnits: emptyStreamLaneCounts(),
    fastForwardedEntries: 0,
    reserveAttempts: 0,
    reserveSuccesses: 0,
    targetCompletionSuccessors: 0,
  }
  private readonly rejectionOccurrencesByReason: PlannerSearchRejectionReasonCounts = {}
  private readonly expandedStateConflictsByKind = emptyPlannerSearchConflictKindCounts()
  private maxCompletedEver = 0
  private readonly firstDepthByCompletedCount: Array<number | null>

  constructor(context: PlannerSearchMetricsContext) {
    this.context = context
    this.firstDepthByCompletedCount = Array.from(
      { length: context.planningTargetCount + 1 },
      () => null,
    )
    context.entries.forEach((entry) => {
      this.entryMetrics.set(entry.id, {
        buildListEntryId: entry.id,
        targetWeaponId: entry.targetWeaponId,
        routeKind: entry.candidateSnapshot.route.kind,
        unitCounts: context.unitCountsByEntryId.get(entry.id) ?? {
          base: 0,
          bonus: 0,
          skill: 0,
        },
        generatedSuccessors: emptyLaneCounts(),
        rejectedAttempts: 0,
        progressedAsSharedSecondary: 0,
        fastForwardedUnits: emptyStreamLaneCounts(),
        reserveAttempts: 0,
        reserveSuccesses: 0,
      })
    })
  }

  private completed(state: PlannerSearchState): number {
    const cached = this.completedCache.get(state)
    if (cached !== undefined) return cached
    const value = this.context.countCompletedTargets(state)
    this.completedCache.set(state, value)
    return value
  }

  private depth(): DepthAccumulator {
    if (this.current === null) {
      throw new Error('PlannerSearchMetricsCollector: no depth is open.')
    }
    return this.current
  }

  /** The optional clock reading, or `undefined` when none was given. */
  mark(): number | undefined {
    return this.context.instrumentation.now?.()
  }

  addPhaseTime(phase: PlannerSearchPhase, startedAt: number | undefined): void {
    const now = this.context.instrumentation.now
    if (startedAt === undefined || now === undefined || this.current === null) return
    this.current.phaseMs[phase] += now() - startedAt
  }

  beginDepth(beamInputStates: number): void {
    this.current = newDepth(this.depthCount, beamInputStates)
  }

  visitBeamState(): void {
    this.depth().visitedBeamStates += 1
  }

  completeBeamState(): void {
    this.depth().completeBeamStates += 1
  }

  stepLimitBeamState(): void {
    this.depth().stepLimitBeamStates += 1
  }

  expandBeamState(conflicts: readonly PlanConflict[]): void {
    const depth = this.depth()
    depth.expandedBeamStates += 1
    depth.expandedStateConflicts += conflicts.length
    conflicts.forEach(({ kind }) => {
      depth.expandedStateConflictsByKind[kind] += 1
    })
  }

  conflictBlockedUnit(): void {
    this.depth().conflictBlockedUnits += 1
  }

  prunedDominatedSkippableUnit(): void {
    this.depth().prunedDominatedSkippableUnits += 1
  }

  routeAttempt(unit: PlannerRouteUnit): void {
    const depth = this.depth()
    depth.attemptedActions += 1
    if (unit.shareable) depth.shareablePrimaryAttempts += 1
  }

  reserveAttempt(entryId: BuildListEntryId): void {
    this.depth().attemptedActions += 1
    this.totals.reserveAttempts += 1
    const entry = this.entryMetrics.get(entryId)
    if (entry) entry.reserveAttempts += 1
  }

  rejectedAttempt(value: PlannerSearchRejection): void {
    this.depth().rejectedAttempts += 1
    this.rejectionOccurrencesByReason[value.reason] =
      (this.rejectionOccurrencesByReason[value.reason] ?? 0) + 1
    const entry = this.entryMetrics.get(value.buildListEntryId)
    if (entry) entry.rejectedAttempts += 1
  }

  /** One pushed successor; `source` is the beam state it was generated from. */
  successor(source: PlannerSearchState, successor: PlannerSearchState): void {
    const depth = this.depth()
    depth.generatedSuccessors += 1
    const action = lastAction(successor)
    if (action === undefined) return
    const lane: PlannerSearchInstrumentationLane =
      action.kind === 'reserve_candidate'
        ? 'reserve'
        : laneOfActionType(action.actionType)
    depth.generatedSuccessorsByLane[lane] += 1
    const primary = this.entryMetrics.get(action.primaryBuildListEntryId)
    if (primary) primary.generatedSuccessors[lane] += 1
    if (action.kind === 'reserve_candidate') {
      this.totals.reserveSuccesses += 1
      if (primary) primary.reserveSuccesses += 1
    } else {
      const progressed = action.progressedBuildListEntryIds
      if (progressed.length > 1) {
        depth.sharedPhysicalActionSuccessors += 1
        depth.sharedProgressedEntries += progressed.length - 1
        progressed.forEach((entryId) => {
          if (entryId === action.primaryBuildListEntryId) return
          const secondary = this.entryMetrics.get(entryId)
          if (secondary) secondary.progressedAsSharedSecondary += 1
        })
      }
      this.recordFastForward(source, successor, action, lane, depth)
    }
    const completed = this.completed(successor)
    if (completed > this.completed(source)) this.totals.targetCompletionSuccessors += 1
    if (completed > this.maxCompletedEver) this.maxCompletedEver = completed
    for (let count = 0; count <= completed; count += 1) {
      if (this.firstDepthByCompletedCount[count] === null) {
        this.firstDepthByCompletedCount[count] = depth.depth
      }
    }
  }

  /**
   * Fast-forwarded units are read off the progress difference: whatever lane
   * progress moved beyond the one unit each progressed Entry executed was
   * passed silently by `fastForwardPlannerRouteProgress()`. Nothing about the
   * fast-forward itself is re-derived here.
   */
  private recordFastForward(
    source: PlannerSearchState,
    successor: PlannerSearchState,
    action: PlannerSearchAction,
    lane: PlannerSearchInstrumentationLane,
    depth: DepthAccumulator,
  ) {
    const progressed = new Set<string>(action.progressedBuildListEntryIds)
    Object.entries(successor.routeProgressByEntryId).forEach(([entryId, after]) => {
      const before = source.routeProgressByEntryId[entryId] ?? {
        base: 0,
        bonus: 0,
        skill: 0,
      }
      if (after === before) return
      const executed = progressed.has(entryId) ? 1 : 0
      const bonus = after.bonus - before.bonus - (lane === 'bonus' ? executed : 0)
      const skill = after.skill - before.skill - (lane === 'skill' ? executed : 0)
      if (bonus <= 0 && skill <= 0) return
      depth.fastForwardedEntries += 1
      depth.fastForwardedUnits.bonus += Math.max(bonus, 0)
      depth.fastForwardedUnits.skill += Math.max(skill, 0)
      const entry = this.entryMetrics.get(entryId as BuildListEntryId)
      if (entry) {
        entry.fastForwardedUnits.bonus += Math.max(bonus, 0)
        entry.fastForwardedUnits.skill += Math.max(skill, 0)
      }
    })
  }

  endDepth(input: {
    successorsBeforeDedup: readonly PlannerSearchState[]
    deduplicated: readonly PlannerSearchState[]
    keptBeam: readonly PlannerSearchState[]
    stoppedBy: PlannerSearchDepthStop
    cumulativeExpandedStates: number
  }): void {
    const depth = this.depth()
    const kept = new Set(input.keptBeam)
    const trimmed = input.deduplicated.filter((state) => !kept.has(state))
    const keptCompleted = input.keptBeam.map((state) => this.completed(state))
    const trimmedCompleted = trimmed.map((state) => this.completed(state))
    const bestKept = keptCompleted.length > 0 ? Math.max(...keptCompleted) : 0
    const distribution = Array.from(
      { length: this.context.planningTargetCount + 1 },
      () => 0,
    )
    keptCompleted.forEach((count) => {
      distribution[count] += 1
    })
    const maxTrimmed = trimmedCompleted.length > 0 ? Math.max(...trimmedCompleted) : null
    const scores = input.keptBeam.map(({ evaluationScore }) => evaluationScore)
    const trimmedScores = trimmed.map(({ evaluationScore }) => evaluationScore)
    let diagnosticProjections: PlannerSearchDiagnosticProjections | null = null
    if (this.context.instrumentation.collectDiagnosticProjections === true) {
      diagnosticProjections = {
        successorsAfterTraceFreeKey: new Set(
          input.successorsBeforeDedup.map(traceFreeProjectionKey),
        ).size,
        successorsAfterProgressKey: new Set(
          input.successorsBeforeDedup.map(progressProjectionKey),
        ).size,
        keptBeamDistinctProgressKeys: new Set(
          input.keptBeam.map(progressProjectionKey),
        ).size,
      }
    }
    const metrics: PlannerSearchDepthMetrics = {
      depth: depth.depth,
      beamInputStates: depth.beamInputStates,
      expandedBeamStates: depth.expandedBeamStates,
      completeBeamStates: depth.completeBeamStates,
      stepLimitBeamStates: depth.stepLimitBeamStates,
      unvisitedBeamStates: depth.beamInputStates - depth.visitedBeamStates,
      attemptedActions: depth.attemptedActions,
      rejectedAttempts: depth.rejectedAttempts,
      prunedDominatedSkippableUnits: depth.prunedDominatedSkippableUnits,
      conflictBlockedUnits: depth.conflictBlockedUnits,
      generatedSuccessors: depth.generatedSuccessors,
      generatedSuccessorsByLane: depth.generatedSuccessorsByLane,
      successorsBeforeSemanticDedup: input.successorsBeforeDedup.length,
      successorsAfterSemanticDedup: input.deduplicated.length,
      semanticDuplicatesRemoved:
        input.successorsBeforeDedup.length - input.deduplicated.length,
      statesBeforeBeamTrim: input.deduplicated.length,
      statesAfterBeamTrim: input.keptBeam.length,
      beamTrimmedStates: input.deduplicated.length - input.keptBeam.length,
      bestCompletedTargetCount: bestKept,
      worstCompletedTargetCount:
        keptCompleted.length > 0 ? Math.min(...keptCompleted) : 0,
      completedTargetCountDistribution: distribution,
      topRankedCompletedTargetCount: keptCompleted[0] ?? 0,
      maxCompletedTargetCountBeforeTrim: Math.max(bestKept, maxTrimmed ?? 0),
      maxCompletedTargetCountAmongTrimmed: maxTrimmed,
      trimmedStatesAboveKeptBest: trimmedCompleted.filter((count) => count > bestKept)
        .length,
      bestEvaluationScore: scores.length > 0 ? Math.max(...scores) : null,
      lowestKeptEvaluationScore: scores.length > 0 ? Math.min(...scores) : null,
      bestTrimmedEvaluationScore:
        trimmedScores.length > 0 ? Math.max(...trimmedScores) : null,
      maxKeptTraceLength: input.keptBeam.reduce(
        (max, state) => Math.max(max, state.trace.length),
        0,
      ),
      expandedStateConflicts: depth.expandedStateConflicts,
      expandedStateConflictsByKind: depth.expandedStateConflictsByKind,
      shareablePrimaryAttempts: depth.shareablePrimaryAttempts,
      sharedPhysicalActionSuccessors: depth.sharedPhysicalActionSuccessors,
      sharedProgressedEntries: depth.sharedProgressedEntries,
      fastForwardedUnits: depth.fastForwardedUnits,
      fastForwardedEntries: depth.fastForwardedEntries,
      diagnosticProjections,
      phaseMs: this.context.instrumentation.now === undefined ? null : depth.phaseMs,
      stoppedBy: input.stoppedBy,
      cumulativeExpandedStates: input.cumulativeExpandedStates,
    }
    this.accumulate(depth, metrics)
    this.current = null
    this.depthCount += 1
    this.context.instrumentation.onDepth?.(metrics)
  }

  private accumulate(depth: DepthAccumulator, metrics: PlannerSearchDepthMetrics) {
    const totals = this.totals
    totals.attemptedActions += depth.attemptedActions
    totals.rejectedAttempts += depth.rejectedAttempts
    totals.generatedSuccessors += depth.generatedSuccessors
    addLaneCounts(totals.generatedSuccessorsByLane, depth.generatedSuccessorsByLane)
    totals.successorsBeforeSemanticDedup += metrics.successorsBeforeSemanticDedup
    totals.successorsAfterSemanticDedup += metrics.successorsAfterSemanticDedup
    totals.statesAfterBeamTrim += metrics.statesAfterBeamTrim
    totals.prunedDominatedSkippableUnits += depth.prunedDominatedSkippableUnits
    totals.conflictBlockedUnits += depth.conflictBlockedUnits
    totals.shareablePrimaryAttempts += depth.shareablePrimaryAttempts
    totals.sharedPhysicalActionSuccessors += depth.sharedPhysicalActionSuccessors
    totals.sharedProgressedEntries += depth.sharedProgressedEntries
    totals.fastForwardedUnits.bonus += depth.fastForwardedUnits.bonus
    totals.fastForwardedUnits.skill += depth.fastForwardedUnits.skill
    totals.fastForwardedEntries += depth.fastForwardedEntries
    addConflictCounts(this.expandedStateConflictsByKind, depth.expandedStateConflictsByKind)
  }

  finish(input: {
    reachedBeamSearch: boolean
    expandedStates: number
    terminationStatus: PlannerSearchTerminationStatus
    completedTargetCount: number
    conflicts: readonly PlanConflict[]
  }): void {
    const uniqueConflictsByKind = emptyPlannerSearchConflictKindCounts()
    input.conflicts.forEach(({ kind }) => {
      uniqueConflictsByKind[kind] += 1
    })
    this.context.instrumentation.onSearchEnd?.({
      reachedBeamSearch: input.reachedBeamSearch,
      depthCount: this.depthCount,
      planningTargetCount: this.context.planningTargetCount,
      searchEntryCount: this.context.entries.length,
      beamWidth: this.context.options.beamWidth,
      maxExpandedStates: this.context.options.maxExpandedStates,
      maxPlanSteps: this.context.options.maxPlanSteps,
      expandedStates: input.expandedStates,
      terminationStatus: input.terminationStatus,
      completedTargetCount: input.completedTargetCount,
      totals: this.totals,
      rejectionOccurrencesByReason: this.rejectionOccurrencesByReason,
      uniqueConflictsByKind,
      expandedStateConflictsByKind: this.expandedStateConflictsByKind,
      maxCompletedTargetCountEverObserved: this.maxCompletedEver,
      firstDepthByCompletedTargetCount: this.firstDepthByCompletedCount,
      entries: [...this.entryMetrics.values()],
    })
  }
}

/**
 * `null` when no instrumentation was supplied; the context is then never
 * built, so an uninstrumented search does no extra work at all.
 */
export function createPlannerSearchMetricsCollector(
  instrumentation: PlannerSearchInstrumentation | undefined,
  context: () => Omit<PlannerSearchMetricsContext, 'instrumentation'>,
): PlannerSearchMetricsCollector | null {
  if (instrumentation === undefined) return null
  return new PlannerSearchMetricsCollector({ ...context(), instrumentation })
}
