import { findBuildListTargetDuplicates } from '../domain/buildList/buildListCardinality'
import type {
  BuildListEntryId,
  ConflictKind,
  PlanConflict,
  RejectedBuildListEntry,
  TargetWeaponId,
} from '../domain/models/publicTypes'
import { hashStableValue } from '../domain/models/publicTypes'
import { isPlannerTargetComplete } from '../domain/planner/plannerEntryRelevance'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import { runPlannerBeamSearch } from '../domain/planner/plannerBeamSearch'
import {
  createPlannerBeamSearchInput,
  plannerRunInputOf,
  type PlannerBeamSearchInput,
  type PlannerBeamSearchOptions,
  type PlannerBeamSearchResult,
  type PlannerBeamSearchTermination,
} from '../domain/planner/plannerBeamSearchTypes'
import { runPlannerDeterministicSchedule } from '../domain/planner/plannerDeterministicScheduler'
import type {
  PlannerSchedulerDropRecord,
  PlannerSchedulerProvisionalOutcome,
  PlannerSchedulerRunMetrics,
} from '../domain/planner/plannerSchedulerInstrumentation'
import { replayPlannerSearchTrace } from '../domain/planner/plannerTraceReplay'
import {
  createRejectedBuildListEntries,
  generatePlanFromFullRun,
  type PlannerAnyRunTermination,
  type PlannerFullRunOf,
} from '../domain/planner/productionPlanGeneration'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerRunBuildListContext,
  PlannerRunResult,
  PlannerRunResultOf,
  PlannerSearchRejectionReason,
  PlannerRunTerminationStatus,
} from '../domain/planner/plannerTypes'
import { PERSISTED_PLANNER_BUILD_LIST_CONTEXT } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'

/**
 * Issue #103 Phase B: Beam Search versus deterministic scheduler parity
 * (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 17 Phase B).
 *
 * The two strategies are *not* expected to return the same result: Step order,
 * the executor of a passable position, weapon switches, preference violations,
 * `expandedStates`, `evaluationScore`, the preferred source progress, the
 * conflicts the Beam Search found only on discarded branches and the rejected
 * Build List mapping all legitimately differ. So nothing here compares whole
 * results. Every comparison is one of three kinds:
 *
 * - **mandatory**: a contract both must keep - Trace Replay validity, the
 *   planning Target set, the completion / termination meaning, required
 *   checkpoint semantics, a valid Production projection, and the same
 *   fail-closed input validation. A violation blocked Phase C and is a
 *   regression now.
 * - **completion regression**: the scheduler completes fewer Targets than the
 *   Beam Search. It is reported with the data needed to classify it; it is
 *   never concluded to be a scheduler bug automatically.
 * - **allowed differences**: recorded values, never a failure.
 *
 * Every value returned is plain structured-clone data.
 *
 * Since Issue #103 Phase D-2b this is the retained Beam Search oracle
 * regression, run by Vitest only (the acceptance catalogue, `sanity-3`,
 * `representative-12`); the Phase B Browser benchmark harness that also ran it
 * was removed after the redesign was validated.
 */

export type PlannerBenchmarkStrategy = 'beam' | 'scheduler'

export interface PlannerParityConflict {
  id: string
  kind: ConflictKind
  buildListEntryIds: BuildListEntryId[]
  recommendedBuildListEntryId: BuildListEntryId | null
  selectedBuildListEntryId: BuildListEntryId | null
}

export interface PlannerParityRejection {
  buildListEntryId: BuildListEntryId
  reason: PlannerSearchRejectionReason
  actionType: string
}

export interface PlannerParityRejectedEntry {
  buildListEntryId: BuildListEntryId
  reason: RejectedBuildListEntry['reason']
}

export interface PlannerParityMilestone {
  buildListEntryId: BuildListEntryId
  skillOpportunityId: string | null
  bonusOpportunityId: string | null
}

export interface PlannerParityReplay {
  isValid: boolean
  issueCodes: string[]
  /** At most the first 20 issues, for the report. */
  issues: Array<{ code: string; message: string; actionIndex: number | null }>
  unsupportedInput: {
    buildListEntryId: BuildListEntryId
    operationType: string
    reason: string
    actionIndex: number
  } | null
  draftCount: number
}

export interface PlannerParityProjection {
  /**
   * `valid`: `createProductionPlanWithSearchRunner()` built a Plan.
   * `no_plan`: the ordinary `plan: null` (cancelled / empty trace).
   * `failed`: Plan generation threw (Trace Replay, projection or the
   * checkpoint requirement defence).
   */
  status: 'valid' | 'no_plan' | 'failed'
  failure: string | null
  planStepCount: number
  stepsWithoutExecutionEffects: number
  /** Each Step's `expectedStateAfter` equals the next Step's `expectedStateBefore`. */
  expectedStateChainClosed: boolean
  milestones: PlannerParityMilestone[]
  finalExpectedState: {
    rngStateHash: string
    normalCountersHash: string
    ownedWeaponsHash: string
    targetExecutionStateHash: string | null
  } | null
  selectedBuildListEntryIds: BuildListEntryId[]
  rejectedBuildListEntries: PlannerParityRejectedEntry[]
  terminationStatus: PlannerRunTerminationStatus | null
  /**
   * The projected run's own `reachedLimits`, unconverted: the Beam Search
   * oracle's may name `max_expanded_states` (Issue #103 Phase D-2a).
   */
  terminationReachedLimits: string[] | null
}

/** One strategy's result, reduced to the plain data the parity comparison reads. */
export interface PlannerStrategyRunSummary {
  strategy: PlannerBenchmarkStrategy
  /** 1 Target = at most 1 Entry in the input (`docs/DATA_MODEL.md` 9.4.1). */
  buildListCardinalityValid: boolean
  planningTargetIds: TargetWeaponId[]
  requiredCheckpointEntryIds: BuildListEntryId[]
  targetPriorityById: Record<string, number>
  targetIdByEntryId: Record<string, TargetWeaponId>
  termination: {
    status: PlannerRunTerminationStatus
    reachedLimits: string[]
    expandedStates: number
    completedTargetCount: number
    totalTargetCount: number
  }
  cancelled: boolean
  hasBestState: boolean
  /** By `isPlannerTargetComplete()`, never by counting selected Entries. */
  completedTargetIds: TargetWeaponId[]
  selectedBuildListEntryIds: BuildListEntryId[]
  expandedStates: number
  traceLength: number
  routeActionCount: number
  reserveActionCount: number
  /** Hash of the ordered trace identity; equal only when the Step order is equal. */
  stepOrderHash: string | null
  conflicts: PlannerParityConflict[]
  rejections: PlannerParityRejection[]
  rejectionReasonCounts: Record<string, number>
  /** `createRejectedBuildListEntries()` of this result. */
  rejectedBuildListEntries: PlannerParityRejectedEntry[]
  rejectedReasonCounts: Record<string, number>
  warningKinds: string[]
  validationIssues: Array<{ path: string; code: string }>
  weaponSwitchCount: number | null
  improvementPreferenceViolationCount: number | null
  preferredSourceProgressCount: number | null
  evaluationScore: number | null
  replay: PlannerParityReplay | null
  projection: PlannerParityProjection
  /** Scheduler only, from its parity observer (`PlannerSchedulerInstrumentation`); `null` for the Beam Search. */
  schedulerDrops: PlannerSchedulerDropRecord[] | null
  schedulerProvisionalOutcomes: PlannerSchedulerProvisionalOutcome[] | null
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort(compareStableStrings)
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  values.forEach((value) => {
    const name = key(value)
    counts[name] = (counts[name] ?? 0) + 1
  })
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => compareStableStrings(left, right)))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function summarizeConflict(conflict: PlanConflict): PlannerParityConflict {
  return {
    id: conflict.id,
    kind: conflict.kind,
    buildListEntryIds: [...conflict.buildListEntryIds],
    recommendedBuildListEntryId: conflict.recommendedBuildListEntryId,
    selectedBuildListEntryId: conflict.selectedBuildListEntryId,
  }
}

/**
 * The Beam Search oracle as a full run of the shared Plan-generation tail
 * (Issue #103 Phase D-2a): the Production input plus the oracle bounds it ran
 * with. Its result keeps the oracle's own `PlannerBeamSearchTermination`,
 * `max_expanded_states` included; it is never converted into a Production
 * `PlannerRunTermination`, and it is never a `PlannerFullSearchRunner`.
 */
function beamOracleFullRun(
  beamOptions: Pick<PlannerBeamSearchOptions, 'beamWidth' | 'maxExpandedStates'>,
): PlannerFullRunOf<PlannerBeamSearchTermination> {
  return (input, dependencies, options, buildListContext) =>
    runPlannerBeamSearch(
      createPlannerBeamSearchInput(input, beamOptions),
      dependencies,
      options,
      buildListContext,
    )
}

/**
 * The full run the projection runs: the result already computed for the
 * first call (the same input), a real run of the same strategy for every
 * runtime-unsupported retry. So the shared Plan-generation tail
 * (`generatePlanFromFullRun()`) is exercised without running twice, and each
 * strategy keeps its own termination type throughout.
 */
function replayingFullRun<T extends PlannerAnyRunTermination>(
  first: PlannerRunResultOf<T>,
  fullRun: PlannerFullRunOf<T>,
): PlannerFullRunOf<T> {
  let used = false
  return async (input, dependencies, options, buildListContext) => {
    if (!used) {
      used = true
      return structuredClone(first)
    }
    return fullRun(input, dependencies, options, buildListContext)
  }
}

async function summarizeProjection<T extends PlannerAnyRunTermination>(
  fullRun: PlannerFullRunOf<T>,
  input: PlannerInput,
  result: PlannerRunResultOf<T>,
  dependencies: PlannerDependencies,
  buildListContext: PlannerRunBuildListContext,
): Promise<PlannerParityProjection> {
  const empty: PlannerParityProjection = {
    status: 'no_plan',
    failure: null,
    planStepCount: 0,
    stepsWithoutExecutionEffects: 0,
    expectedStateChainClosed: true,
    milestones: [],
    finalExpectedState: null,
    selectedBuildListEntryIds: [],
    rejectedBuildListEntries: [],
    terminationStatus: null,
    terminationReachedLimits: null,
  }
  try {
    const planned = await generatePlanFromFullRun(
      replayingFullRun(result, fullRun),
      input,
      dependencies,
      undefined,
      undefined,
      buildListContext,
    )
    const plan = planned.plan
    // The run's own termination, as the strategy derived it: a Beam Search
    // oracle truncation keeps `max_expanded_states` here.
    const terminationReachedLimits: string[] = [...planned.termination.reachedLimits]
    if (plan === null) {
      return { ...empty, terminationStatus: planned.termination.status, terminationReachedLimits }
    }
    const steps = plan.steps
    // Each After is the next Before. The first Before is deliberately not
    // compared with `baseSnapshot.initialExecutionState`: that is the pre-start
    // premise, and the Plan start effect (existing-weapon Target links) lies
    // between the two (`docs/PLANNER_SPEC.md` 16.2).
    const chainClosed = steps.every(
      (step, index) =>
        index === 0 ||
        hashStableValue(steps[index - 1].expectedStateAfter) ===
          hashStableValue(step.expectedStateBefore),
    )
    const last = steps.at(-1)?.expectedStateAfter ?? null
    return {
      status: 'valid',
      failure: null,
      planStepCount: steps.length,
      stepsWithoutExecutionEffects: steps.filter((step) => step.executionEffects === undefined).length,
      expectedStateChainClosed: chainClosed,
      milestones: steps
        .flatMap((step) => step.checkpointMilestones ?? [])
        .map(({ buildListEntryId, skillOpportunityId, bonusOpportunityId }) => ({
          buildListEntryId,
          skillOpportunityId,
          bonusOpportunityId,
        }))
        .sort((left, right) => compareStableStrings(left.buildListEntryId, right.buildListEntryId)),
      finalExpectedState:
        last === null
          ? null
          : {
              rngStateHash: last.rngStateHash,
              normalCountersHash: last.normalCountersHash,
              ownedWeaponsHash: last.ownedWeaponsHash,
              targetExecutionStateHash: last.targetExecutionStateHash ?? null,
            },
      selectedBuildListEntryIds: [...plan.selectedBuildListEntryIds],
      rejectedBuildListEntries: plan.rejectedBuildListEntries.map(({ buildListEntryId, reason }) => ({
        buildListEntryId,
        reason,
      })),
      terminationStatus: planned.termination.status,
      terminationReachedLimits,
    }
  } catch (error) {
    return { ...empty, status: 'failed', failure: errorMessage(error) }
  }
}

function summarizeReplay(
  input: PlannerInput,
  bestState: PlannerRunResult['bestState'],
  engine: RngEngine,
): PlannerParityReplay | null {
  if (bestState === null || bestState.trace.length === 0) return null
  try {
    const replay = replayPlannerSearchTrace(input, bestState, engine)
    return {
      isValid: replay.isValid,
      issueCodes: sorted(replay.issues.map(({ code }) => code)),
      issues: replay.issues.slice(0, 20).map(({ code, message, actionIndex }) => ({
        code,
        message,
        actionIndex,
      })),
      unsupportedInput:
        replay.unsupportedInput === null
          ? null
          : {
              buildListEntryId: replay.unsupportedInput.buildListEntryId,
              operationType: replay.unsupportedInput.operationType,
              reason: replay.unsupportedInput.reason,
              actionIndex: replay.unsupportedInput.actionIndex,
            },
      draftCount: replay.drafts.length,
    }
  } catch (error) {
    return {
      isValid: false,
      issueCodes: ['replay_threw'],
      issues: [{ code: 'replay_threw', message: errorMessage(error), actionIndex: null }],
      unsupportedInput: null,
      draftCount: 0,
    }
  }
}

interface SummarizePlannerStrategyRunRequestBase {
  engine: RngEngine
  /** The very dependencies the run used; the projection continues them. */
  dependencies: PlannerDependencies
  buildListContext?: PlannerRunBuildListContext
}

/**
 * One finished run to summarize, typed by its strategy (Issue #103 Phase
 * D-2a): the Beam Search oracle with its own input and result, or the
 * scheduler with the Production ones. Neither is cast to the other; the
 * summary normalizes both into `PlannerStrategyRunSummary`.
 */
export type SummarizePlannerStrategyRunRequest =
  | (SummarizePlannerStrategyRunRequestBase & {
      strategy: 'beam'
      input: PlannerBeamSearchInput
      result: PlannerBeamSearchResult
    })
  | (SummarizePlannerStrategyRunRequestBase & {
      strategy: 'scheduler'
      input: PlannerInput
      result: PlannerRunResult
      /** The scheduler's own instrumentation of the same run, when it has one. */
      schedulerMetrics?: PlannerSchedulerRunMetrics | null
    })

/**
 * Reduces one finished search to a `PlannerStrategyRunSummary`, running the
 * unchanged Trace Replay and the shared Production projection over it.
 */
export async function summarizePlannerStrategyRun(
  request: SummarizePlannerStrategyRunRequest,
): Promise<PlannerStrategyRunSummary> {
  const { strategy, result, engine, dependencies } = request
  const buildListContext = request.buildListContext ?? PERSISTED_PLANNER_BUILD_LIST_CONTEXT
  // Everything past the run itself reads the Production input view (the same
  // input with `maxPlanSteps` only). Each strategy's result keeps its own
  // termination type: the shared tail reads it through its generic entry, so a
  // Beam Search oracle termination is never turned into a Production one.
  const input = request.strategy === 'beam' ? plannerRunInputOf(request.input) : request.input
  const projection =
    request.strategy === 'beam'
      ? summarizeProjection(
          beamOracleFullRun(request.input.options),
          input,
          request.result,
          dependencies,
          buildListContext,
        )
      : summarizeProjection(
          runPlannerDeterministicSchedule,
          input,
          request.result,
          dependencies,
          buildListContext,
        )
  const schedulerMetrics = request.strategy === 'scheduler' ? request.schedulerMetrics : null
  const prepared = preparePlannerInitialContext(input, dependencies, buildListContext)
  const planningTargetIds =
    prepared.status === 'ready'
      ? [...prepared.context.planningTargetIds]
      : [...prepared.planningTargetIds]
  const requiredEntryIdByTargetId =
    prepared.status === 'ready'
      ? prepared.context.checkpointRequirements.requiredEntryIdByTargetId
      : new Map<TargetWeaponId, BuildListEntryId>()
  const best = result.bestState
  const completedTargetIds =
    best === null || prepared.status !== 'ready'
      ? []
      : planningTargetIds.filter((targetId) =>
          isPlannerTargetComplete(best, targetId, prepared.context.checkpointRequirements),
        )
  const selectedBuildListEntryIds = sorted(best?.selectedBuildListEntryIds ?? [])
  const rejectedBuildListEntries = createRejectedBuildListEntries(
    input,
    result,
    selectedBuildListEntryIds,
  ).map(({ buildListEntryId, reason }) => ({ buildListEntryId, reason }))
  const rejections = result.rejections.map(({ buildListEntryId, reason, actionType }) => ({
    buildListEntryId,
    reason,
    actionType,
  }))
  const trace = best?.trace ?? []
  return {
    strategy,
    buildListCardinalityValid: findBuildListTargetDuplicates(input.buildListEntries).length === 0,
    planningTargetIds: sorted(planningTargetIds),
    requiredCheckpointEntryIds: sorted(requiredEntryIdByTargetId.values()),
    targetPriorityById: Object.fromEntries(
      input.targetWeapons.map(({ id, priority }) => [id, priority]),
    ),
    targetIdByEntryId: Object.fromEntries(
      input.buildListEntries.map(({ id, targetWeaponId }) => [id, targetWeaponId]),
    ),
    termination: {
      status: result.termination.status,
      reachedLimits: [...result.termination.reachedLimits],
      expandedStates: result.termination.expandedStates,
      completedTargetCount: result.termination.completedTargetCount,
      totalTargetCount: result.termination.totalTargetCount,
    },
    cancelled: result.cancelled,
    hasBestState: best !== null,
    completedTargetIds: sorted(completedTargetIds),
    selectedBuildListEntryIds,
    expandedStates: result.expandedStates,
    traceLength: trace.length,
    routeActionCount: trace.filter(({ kind }) => kind === 'route_operation').length,
    reserveActionCount: trace.filter(({ kind }) => kind === 'reserve_candidate').length,
    stepOrderHash:
      best === null
        ? null
        : hashStableValue(
            trace.map((action) => ({
              kind: action.kind,
              actionType: action.actionType,
              primary: action.primaryBuildListEntryId,
              progressed: action.progressedBuildListEntryIds,
              rngBefore: action.rngBefore,
            })),
          ),
    conflicts: result.conflicts
      .map(summarizeConflict)
      .sort((left, right) => compareStableStrings(left.id, right.id)),
    rejections,
    rejectionReasonCounts: countBy(rejections, ({ reason }) => reason),
    rejectedBuildListEntries,
    rejectedReasonCounts: countBy(rejectedBuildListEntries, ({ reason }) => reason),
    warningKinds: sorted(result.warnings.map(({ kind }) => kind)),
    validationIssues: result.validationIssues.map(({ path, code }) => ({ path, code })),
    weaponSwitchCount: best?.weaponSwitchCount ?? null,
    improvementPreferenceViolationCount: best?.improvementPreferenceViolationCount ?? null,
    preferredSourceProgressCount: best?.preferredSourceProgressCount ?? null,
    evaluationScore: best?.evaluationScore ?? null,
    replay: summarizeReplay(input, result.bestState, engine),
    projection: await projection,
    schedulerDrops: schedulerMetrics?.drops.map((drop) => ({ ...drop })) ?? null,
    schedulerProvisionalOutcomes:
      schedulerMetrics?.provisionalOutcomes.map((outcome) => ({
        ...outcome,
        loserBuildListEntryIds: [...outcome.loserBuildListEntryIds],
      })) ?? null,
  }
}

// --- comparison -----------------------------------------------------------

export type PlannerParityViolationCode =
  | 'trace_replay_invalid'
  | 'projection_failed'
  | 'projection_missing_execution_effects'
  | 'expected_state_chain_broken'
  | 'planning_targets_differ'
  | 'termination_inconsistent'
  | 'required_checkpoint_not_secured'
  | 'checkpoint_milestone_differs'
  | 'input_validation_differs'

export interface PlannerParityViolation {
  code: PlannerParityViolationCode
  strategy: PlannerBenchmarkStrategy | null
  detail: string
}

/**
 * The suspected cause of one Target the Beam Search completed and the
 * scheduler did not (Phase B classification, never a verdict):
 *
 * - `beam_branch_combination` (A): the scheduler's provisional outcome dropped
 *   it for a winner whose Target the Beam Search completed too - the Beam
 *   Search found a combination completing both
 * - `provisional_priority_outcome` (B): dropped by the provisional outcome for
 *   a winner the Beam Search did not complete - the intended priority choice
 * - `deadlock_or_stall` (C): dropped by the 7.8 deadlock / stall rule
 * - `fixture_cardinality` (E): the input breaks 1 Target = 1 Entry
 * - `unexplained` (D candidate): none of the above; needs investigation
 */
export type PlannerCompletionLossCategory =
  | 'beam_branch_combination'
  | 'provisional_priority_outcome'
  | 'deadlock_or_stall'
  | 'fixture_cardinality'
  | 'unexplained'

/**
 * How a loss reads against the design (never a verdict that the scheduler is
 * right or wrong):
 *
 * - `expected_semantic_difference`: the intended provisional outcome (6.5):
 *   the scheduler completed a higher-ranked Target the Beam Search did not
 * - `known_limitation`: a `beam_branch_combination` loss while the scheduler
 *   also completed a Target the Beam Search did not: the greedy provisional
 *   outcome is not a maximum independent set (19.2 Can defer)
 * - `unexpected_regression`: the Beam Search completed every Target the
 *   scheduler completed and more, so the scheduler traded nothing for this
 *   loss - whatever the category (fixture cardinality aside), including a
 *   `beam_branch_combination` one; for a deadlock / stall drop, the Beam
 *   Search proved the wait was not a true deadlock
 * - `undetermined`: nothing above applies; needs investigation, never allowed
 *   by default
 */
export type PlannerCompletionLossAssessment =
  | 'expected_semantic_difference'
  | 'known_limitation'
  | 'unexpected_regression'
  | 'undetermined'

export interface PlannerCompletionLoss {
  targetWeaponId: TargetWeaponId
  priority: number | null
  buildListEntryIds: BuildListEntryId[]
  schedulerRejections: PlannerParityRejection[]
  schedulerDrops: PlannerSchedulerDropRecord[]
  relatedConflictIds: string[]
  provisionalWinnerBuildListEntryIds: BuildListEntryId[]
  provisionalWinnerTargetIds: TargetWeaponId[]
  provisionalWinnerTargetsCompletedByBeam: boolean
  deadlockOrStall: boolean
  suspectedCategory: PlannerCompletionLossCategory
  assessment: PlannerCompletionLossAssessment
}

export type PlannerParityVerdict =
  | 'parity'
  | 'needs_review'
  | 'completion_regression'
  | 'mandatory_violation'

export interface PlannerSchedulerParityReport {
  verdict: PlannerParityVerdict
  mandatory: { passed: boolean; violations: PlannerParityViolation[] }
  completion: {
    beamCompletedTargetIds: TargetWeaponId[]
    schedulerCompletedTargetIds: TargetWeaponId[]
    beamOnlyCompletedTargetIds: TargetWeaponId[]
    schedulerOnlyCompletedTargetIds: TargetWeaponId[]
    beamCompletedCount: number
    schedulerCompletedCount: number
    totalTargetCount: number
    /** `scheduler completed < beam completed`. */
    regression: boolean
    /** Every lost Target has a classified (not `unexplained`) suspected cause. */
    regressionExplained: boolean
    /** Every lost Target is an `expected_semantic_difference`; `true` without a regression. */
    regressionAcceptable: boolean
    /** The Beam Search completed every Target the scheduler completed. */
    beamCompletedSuperset: boolean
    losses: PlannerCompletionLoss[]
  }
  conflicts: {
    beamIds: string[]
    schedulerIds: string[]
    intersection: string[]
    /** Allowed: the Beam Search also reports conflicts of discarded branches. */
    beamOnly: string[]
    /** Not allowed automatically: listed for review. */
    schedulerOnly: string[]
  }
  rejections: {
    beam: {
      selectedBuildListEntryIds: BuildListEntryId[]
      rejectedBuildListEntries: PlannerParityRejectedEntry[]
      rejectionReasonCounts: Record<string, number>
    }
    scheduler: {
      selectedBuildListEntryIds: BuildListEntryId[]
      rejectedBuildListEntries: PlannerParityRejectedEntry[]
      rejectionReasonCounts: Record<string, number>
    }
  }
  allowedDifferences: {
    stepOrderIdentical: boolean
    traceLength: { beam: number; scheduler: number }
    routeActionCount: { beam: number; scheduler: number }
    expandedStates: { beam: number; scheduler: number }
    weaponSwitchCount: { beam: number | null; scheduler: number | null }
    improvementPreferenceViolationCount: { beam: number | null; scheduler: number | null }
    preferredSourceProgressCount: { beam: number | null; scheduler: number | null }
    evaluationScore: { beam: number | null; scheduler: number | null }
    rejectedBuildListEntriesIdentical: boolean
    /** Only meaningful when both selected the same Entries; `null` otherwise. */
    finalCountersIdentical: boolean | null
  }
  reviewItems: string[]
}

function difference<T>(left: readonly T[], right: readonly T[]): T[] {
  const set = new Set(right)
  return left.filter((value) => !set.has(value))
}

function intersection<T>(left: readonly T[], right: readonly T[]): T[] {
  const set = new Set(right)
  return left.filter((value) => set.has(value))
}

function checkStrategy(
  summary: PlannerStrategyRunSummary,
  violations: PlannerParityViolation[],
) {
  const strategy = summary.strategy
  const violation = (code: PlannerParityViolationCode, detail: string) =>
    violations.push({ code, strategy, detail })
  if (summary.replay !== null && !summary.replay.isValid) {
    violation(
      'trace_replay_invalid',
      summary.replay.issues.map(({ code, message }) => `[${code}] ${message}`).join('; ') ||
        'Trace Replay reported an invalid trace.',
    )
  }
  if (summary.projection.status === 'failed') {
    violation('projection_failed', summary.projection.failure ?? 'Plan generation failed.')
  }
  if (summary.projection.stepsWithoutExecutionEffects > 0) {
    violation(
      'projection_missing_execution_effects',
      `${summary.projection.stepsWithoutExecutionEffects} PlanStep(s) carry no executionEffects.`,
    )
  }
  if (!summary.projection.expectedStateChainClosed) {
    violation('expected_state_chain_broken', 'The expected state chain of the projected Plan does not close.')
  }
  // The typed termination means what its authority says.
  const { termination } = summary
  const complete =
    summary.hasBestState &&
    termination.totalTargetCount > 0 &&
    summary.completedTargetIds.length === termination.totalTargetCount
  if (termination.completedTargetCount !== summary.completedTargetIds.length) {
    violation(
      'termination_inconsistent',
      `termination.completedTargetCount ${termination.completedTargetCount} differs from isPlannerTargetComplete() ${summary.completedTargetIds.length}.`,
    )
  }
  const expectedStatus: PlannerRunTerminationStatus = summary.cancelled
    ? 'cancelled'
    : complete
      ? 'completed'
      : termination.reachedLimits.length > 0
        ? 'incomplete'
        : 'exhausted'
  if (termination.status !== expectedStatus) {
    violation(
      'termination_inconsistent',
      `termination.status '${termination.status}' where the result means '${expectedStatus}'.`,
    )
  }
  // A Target with a required checkpoint Entry is complete only through it.
  const selected = new Set(summary.selectedBuildListEntryIds)
  summary.requiredCheckpointEntryIds.forEach((entryId) => {
    const targetId = summary.targetIdByEntryId[entryId]
    if (targetId !== undefined && summary.completedTargetIds.includes(targetId) && !selected.has(entryId)) {
      violation(
        'required_checkpoint_not_secured',
        `Target '${targetId}' counts as complete without its required checkpoint Entry '${entryId}'.`,
      )
    }
  })
}

function isValidationFailure(summary: PlannerStrategyRunSummary): boolean {
  return !summary.hasBestState || summary.validationIssues.length > 0
}

function checkInputValidation(
  beam: PlannerStrategyRunSummary,
  scheduler: PlannerStrategyRunSummary,
  violations: PlannerParityViolation[],
) {
  if (!isValidationFailure(beam) && !isValidationFailure(scheduler)) return
  const shape = (summary: PlannerStrategyRunSummary) =>
    JSON.stringify({
      hasBestState: summary.hasBestState,
      validationIssues: summary.validationIssues,
      status: summary.termination.status,
      // Bound diagnostics are not part of the fail-closed contract.
      warningKinds: summary.warningKinds.filter((kind) => kind !== 'max_steps_reached'),
    })
  if (shape(beam) !== shape(scheduler)) {
    violations.push({
      code: 'input_validation_differs',
      strategy: null,
      detail: `Beam ${shape(beam)} / scheduler ${shape(scheduler)}`,
    })
  }
}

function classifyLosses(
  beam: PlannerStrategyRunSummary,
  scheduler: PlannerStrategyRunSummary,
  lostTargetIds: readonly TargetWeaponId[],
  beamSuperset: boolean,
): PlannerCompletionLoss[] {
  const beamCompleted = new Set(beam.completedTargetIds)
  return lostTargetIds.map((targetWeaponId) => {
    const entryIds = sorted(
      Object.entries(scheduler.targetIdByEntryId)
        .filter(([, target]) => target === targetWeaponId)
        .map(([entryId]) => entryId as BuildListEntryId),
    )
    const entrySet = new Set<string>(entryIds)
    const drops = (scheduler.schedulerDrops ?? []).filter(({ buildListEntryId }) =>
      entrySet.has(buildListEntryId),
    )
    const winners = sorted(
      drops.flatMap(({ winnerBuildListEntryId }) =>
        winnerBuildListEntryId === null ? [] : [winnerBuildListEntryId],
      ),
    )
    const winnerTargets = sorted(
      winners.flatMap((entryId) => {
        const target = scheduler.targetIdByEntryId[entryId]
        return target === undefined ? [] : [target]
      }),
    )
    const deadlockOrStall = drops.some(({ cause }) => cause === 'deadlock' || cause === 'stall')
    const provisional = drops.some(({ cause }) => cause === 'provisional_outcome')
    const winnersCompletedByBeam =
      winnerTargets.length > 0 && winnerTargets.every((target) => beamCompleted.has(target))
    const suspectedCategory: PlannerCompletionLossCategory = !scheduler.buildListCardinalityValid
      ? 'fixture_cardinality'
      : deadlockOrStall
        ? 'deadlock_or_stall'
        : provisional
          ? winnersCompletedByBeam
            ? 'beam_branch_combination'
            : 'provisional_priority_outcome'
          : 'unexplained'
    const assessment: PlannerCompletionLossAssessment =
      suspectedCategory === 'provisional_priority_outcome' && !beamSuperset
        ? 'expected_semantic_difference'
        : beamSuperset && suspectedCategory !== 'fixture_cardinality'
          ? 'unexpected_regression'
          : suspectedCategory === 'beam_branch_combination'
            ? 'known_limitation'
            : 'undetermined'
    return {
      targetWeaponId,
      priority: scheduler.targetPriorityById[targetWeaponId] ?? null,
      buildListEntryIds: entryIds,
      schedulerRejections: scheduler.rejections.filter(({ buildListEntryId }) =>
        entrySet.has(buildListEntryId),
      ),
      schedulerDrops: drops,
      relatedConflictIds: scheduler.conflicts
        .filter(({ buildListEntryIds }) => buildListEntryIds.some((id) => entrySet.has(id)))
        .map(({ id }) => id),
      provisionalWinnerBuildListEntryIds: winners,
      provisionalWinnerTargetIds: winnerTargets,
      provisionalWinnerTargetsCompletedByBeam: winnersCompletedByBeam,
      deadlockOrStall,
      suspectedCategory,
      assessment,
    }
  })
}

/** Compares one Beam Search summary with one scheduler summary of the same input. */
export function comparePlannerStrategyRuns(
  beam: PlannerStrategyRunSummary,
  scheduler: PlannerStrategyRunSummary,
): PlannerSchedulerParityReport {
  if (beam.strategy !== 'beam' || scheduler.strategy !== 'scheduler') {
    throw new Error('comparePlannerStrategyRuns() expects a Beam Search and a scheduler summary.')
  }
  const violations: PlannerParityViolation[] = []
  checkStrategy(beam, violations)
  checkStrategy(scheduler, violations)
  checkInputValidation(beam, scheduler, violations)
  if (
    JSON.stringify(beam.planningTargetIds) !== JSON.stringify(scheduler.planningTargetIds) ||
    beam.termination.totalTargetCount !== scheduler.termination.totalTargetCount
  ) {
    violations.push({
      code: 'planning_targets_differ',
      strategy: null,
      detail: `Beam ${beam.termination.totalTargetCount} [${beam.planningTargetIds.join(', ')}] / scheduler ${scheduler.termination.totalTargetCount} [${scheduler.planningTargetIds.join(', ')}]`,
    })
  }
  // The same selected checkpoint reached by both must be the same milestone.
  const bothSelected = new Set(
    intersection(beam.selectedBuildListEntryIds, scheduler.selectedBuildListEntryIds),
  )
  const milestoneKey = (summary: PlannerStrategyRunSummary) =>
    JSON.stringify(
      summary.projection.milestones.filter(({ buildListEntryId }) => bothSelected.has(buildListEntryId)),
    )
  if (
    beam.projection.status === 'valid' &&
    scheduler.projection.status === 'valid' &&
    milestoneKey(beam) !== milestoneKey(scheduler)
  ) {
    violations.push({
      code: 'checkpoint_milestone_differs',
      strategy: null,
      detail: `Beam ${milestoneKey(beam)} / scheduler ${milestoneKey(scheduler)}`,
    })
  }

  const beamOnlyCompleted = difference(beam.completedTargetIds, scheduler.completedTargetIds)
  const regression = scheduler.completedTargetIds.length < beam.completedTargetIds.length
  const schedulerCompletedByBeam = difference(scheduler.completedTargetIds, beam.completedTargetIds).length === 0
  const losses = regression
    ? classifyLosses(beam, scheduler, beamOnlyCompleted, schedulerCompletedByBeam)
    : []
  const regressionExplained = losses.every(({ suspectedCategory }) => suspectedCategory !== 'unexplained')
  const regressionAcceptable = losses.every(
    ({ assessment }) => assessment === 'expected_semantic_difference',
  )

  const beamConflictIds = beam.conflicts.map(({ id }) => id)
  const schedulerConflictIds = scheduler.conflicts.map(({ id }) => id)
  const schedulerOnlyConflicts = difference(schedulerConflictIds, beamConflictIds)
  const reviewItems = schedulerOnlyConflicts.map(
    (id) => `scheduler-only conflict '${id}' (not reported by the Beam Search)`,
  )

  const sameSelection =
    JSON.stringify(beam.selectedBuildListEntryIds) === JSON.stringify(scheduler.selectedBuildListEntryIds)
  const finalCounters = (summary: PlannerStrategyRunSummary) => {
    const state = summary.projection.finalExpectedState
    return state === null ? null : `${state.rngStateHash}/${state.normalCountersHash}`
  }

  const verdict: PlannerParityVerdict =
    violations.length > 0
      ? 'mandatory_violation'
      : regression
        ? 'completion_regression'
        : reviewItems.length > 0
          ? 'needs_review'
          : 'parity'
  return {
    verdict,
    mandatory: { passed: violations.length === 0, violations },
    completion: {
      beamCompletedTargetIds: [...beam.completedTargetIds],
      schedulerCompletedTargetIds: [...scheduler.completedTargetIds],
      beamOnlyCompletedTargetIds: beamOnlyCompleted,
      schedulerOnlyCompletedTargetIds: difference(scheduler.completedTargetIds, beam.completedTargetIds),
      beamCompletedCount: beam.completedTargetIds.length,
      schedulerCompletedCount: scheduler.completedTargetIds.length,
      totalTargetCount: scheduler.termination.totalTargetCount,
      regression,
      regressionExplained,
      regressionAcceptable,
      beamCompletedSuperset: schedulerCompletedByBeam,
      losses,
    },
    conflicts: {
      beamIds: beamConflictIds,
      schedulerIds: schedulerConflictIds,
      intersection: intersection(beamConflictIds, schedulerConflictIds),
      beamOnly: difference(beamConflictIds, schedulerConflictIds),
      schedulerOnly: schedulerOnlyConflicts,
    },
    rejections: {
      beam: {
        selectedBuildListEntryIds: [...beam.selectedBuildListEntryIds],
        rejectedBuildListEntries: beam.rejectedBuildListEntries.map((entry) => ({ ...entry })),
        rejectionReasonCounts: { ...beam.rejectionReasonCounts },
      },
      scheduler: {
        selectedBuildListEntryIds: [...scheduler.selectedBuildListEntryIds],
        rejectedBuildListEntries: scheduler.rejectedBuildListEntries.map((entry) => ({ ...entry })),
        rejectionReasonCounts: { ...scheduler.rejectionReasonCounts },
      },
    },
    allowedDifferences: {
      stepOrderIdentical: beam.stepOrderHash !== null && beam.stepOrderHash === scheduler.stepOrderHash,
      traceLength: { beam: beam.traceLength, scheduler: scheduler.traceLength },
      routeActionCount: { beam: beam.routeActionCount, scheduler: scheduler.routeActionCount },
      expandedStates: { beam: beam.expandedStates, scheduler: scheduler.expandedStates },
      weaponSwitchCount: { beam: beam.weaponSwitchCount, scheduler: scheduler.weaponSwitchCount },
      improvementPreferenceViolationCount: {
        beam: beam.improvementPreferenceViolationCount,
        scheduler: scheduler.improvementPreferenceViolationCount,
      },
      preferredSourceProgressCount: {
        beam: beam.preferredSourceProgressCount,
        scheduler: scheduler.preferredSourceProgressCount,
      },
      evaluationScore: { beam: beam.evaluationScore, scheduler: scheduler.evaluationScore },
      rejectedBuildListEntriesIdentical:
        JSON.stringify(beam.rejectedBuildListEntries) === JSON.stringify(scheduler.rejectedBuildListEntries),
      finalCountersIdentical: sameSelection
        ? finalCounters(beam) !== null && finalCounters(beam) === finalCounters(scheduler)
        : null,
    },
    reviewItems,
  }
}

// --- one-shot runner --------------------------------------------------------

export interface PlannerSchedulerParityRunOptions {
  engine: RngEngine
  /** Fresh deterministic dependencies per strategy (their ID counters are per run). */
  createDependencies: () => PlannerDependencies
  buildListContext?: PlannerRunBuildListContext
  /**
   * The Beam Search oracle's own bounds for this comparison; the oracle
   * defaults (`defaultPlannerBeamSearchOptions`) where omitted. The scheduler
   * never receives them.
   */
  beamSearchOptions?: Partial<Pick<PlannerBeamSearchOptions, 'beamWidth' | 'maxExpandedStates'>>
}

export interface PlannerSchedulerParityRun {
  beam: PlannerStrategyRunSummary
  scheduler: PlannerStrategyRunSummary
  schedulerMetrics: PlannerSchedulerRunMetrics | null
  report: PlannerSchedulerParityReport
}

/**
 * Runs `runPlannerBeamSearch()` and `runPlannerDeterministicSchedule()` once
 * each over the same Production input, engine and fresh deterministic
 * dependencies, and compares them. The oracle alone also gets its own bounds
 * (`beamSearchOptions`). The scheduler runs with its parity observer, which is
 * semantics-neutral, so its drops can explain a completion difference.
 */
export async function runPlannerSchedulerParity(
  input: PlannerInput,
  options: PlannerSchedulerParityRunOptions,
): Promise<PlannerSchedulerParityRun> {
  const buildListContext = options.buildListContext ?? PERSISTED_PLANNER_BUILD_LIST_CONTEXT
  const beamInput = createPlannerBeamSearchInput(structuredClone(input), options.beamSearchOptions)
  const beamDependencies = options.createDependencies()
  const beamResult = await runPlannerBeamSearch(
    structuredClone(beamInput),
    beamDependencies,
    {},
    buildListContext,
  )
  const schedulerDependencies = options.createDependencies()
  let schedulerMetrics: PlannerSchedulerRunMetrics | null = null
  const schedulerResult = await runPlannerDeterministicSchedule(
    structuredClone(input),
    schedulerDependencies,
    {
      schedulerInstrumentation: {
        onScheduleEnd: (metrics) => {
          schedulerMetrics = metrics
        },
      },
    },
    buildListContext,
  )
  const beam = await summarizePlannerStrategyRun({
    strategy: 'beam',
    input: beamInput,
    result: beamResult,
    engine: options.engine,
    dependencies: beamDependencies,
    buildListContext,
  })
  const scheduler = await summarizePlannerStrategyRun({
    strategy: 'scheduler',
    input,
    result: schedulerResult,
    engine: options.engine,
    dependencies: schedulerDependencies,
    buildListContext,
    schedulerMetrics,
  })
  return { beam, scheduler, schedulerMetrics, report: comparePlannerStrategyRuns(beam, scheduler) }
}

/** A short text rendering of a parity report, for a failing test's output and the record. */
export function formatPlannerSchedulerParityReport(report: PlannerSchedulerParityReport): string {
  const { completion, conflicts, allowedDifferences: allowed } = report
  const lines = [
    `parity verdict: ${report.verdict}`,
    `mandatory: ${report.mandatory.passed ? 'passed' : 'FAILED'}`,
    ...report.mandatory.violations.map(
      ({ code, strategy, detail }) => `  - ${code}${strategy === null ? '' : ` (${strategy})`}: ${detail}`,
    ),
    `completed Targets: Beam ${completion.beamCompletedCount} / scheduler ${completion.schedulerCompletedCount} / total ${completion.totalTargetCount}`,
    `  Beam only: ${completion.beamOnlyCompletedTargetIds.join(', ') || '-'}`,
    `  scheduler only: ${completion.schedulerOnlyCompletedTargetIds.join(', ') || '-'}`,
    `completion regression: ${completion.regression ? `yes (${completion.regressionExplained ? 'classified' : 'UNEXPLAINED'}, ${completion.regressionAcceptable ? 'expected semantic difference' : 'NOT ACCEPTABLE AS IS'})` : 'no'}`,
    ...completion.losses.map(
      (loss) =>
        `  - ${loss.targetWeaponId} (priority ${loss.priority ?? '-'}): ${loss.suspectedCategory} / ${loss.assessment}; winners ${loss.provisionalWinnerBuildListEntryIds.join(', ') || '-'}; conflicts ${loss.relatedConflictIds.join(', ') || '-'}; drops ${loss.schedulerDrops.map(({ cause, reason }) => `${cause}:${reason}`).join(', ') || '-'}`,
    ),
    `conflicts: Beam ${conflicts.beamIds.length} / scheduler ${conflicts.schedulerIds.length} / both ${conflicts.intersection.length} / Beam only ${conflicts.beamOnly.length} / scheduler only ${conflicts.schedulerOnly.length}`,
    `rejected entries: Beam ${JSON.stringify(report.rejections.beam.rejectedBuildListEntries.length)} ${JSON.stringify(countRejected(report.rejections.beam.rejectedBuildListEntries))} / scheduler ${report.rejections.scheduler.rejectedBuildListEntries.length} ${JSON.stringify(countRejected(report.rejections.scheduler.rejectedBuildListEntries))}`,
    `allowed: step order identical ${allowed.stepOrderIdentical}; trace ${allowed.traceLength.beam} / ${allowed.traceLength.scheduler}; expandedStates ${allowed.expandedStates.beam} / ${allowed.expandedStates.scheduler}; weapon switches ${allowed.weaponSwitchCount.beam} / ${allowed.weaponSwitchCount.scheduler}; preference violations ${allowed.improvementPreferenceViolationCount.beam} / ${allowed.improvementPreferenceViolationCount.scheduler}`,
    ...report.reviewItems.map((item) => `review: ${item}`),
  ]
  return lines.join('\n')
}

function countRejected(entries: readonly PlannerParityRejectedEntry[]): Record<string, number> {
  return countBy(entries, ({ reason }) => reason)
}
