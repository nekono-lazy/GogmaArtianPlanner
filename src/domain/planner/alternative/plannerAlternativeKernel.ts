import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  resolveBuildListEntryReplacement,
  type BuildListEntryReplacement,
} from '../../buildList'
import {
  candidateStableKey,
  CandidateSearchError,
  normalizePlannerAlternativeExcludedRouteKeys,
  visitPlannerAlternativeCandidates,
} from '../../search'
import type {
  PlannerAlternativeCandidate,
  PlannerAlternativeReservation,
  PlannerAlternativeSearchExtent,
  PlannerAlternativeSearchSummary,
} from '../../search'
import { createProductionPlanWithObserver } from '../productionPlanGeneration'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
  PlannerRouteCommitmentEvidence,
  PlannerRunBuildListContext,
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import type { GeneratedBuildListEntryResult } from '../constrained/constrainedMaterializer'
import { preparePlannerReplacementConflictPreflight } from '../constrained/plannerAugmentedPreflight'
import type { PlannerConflictWork } from '../constrained/plannerConstrainedOrchestration'
import {
  preparePlannerWhatIfScenario,
  type PreparedPlannerWhatIfScenario,
} from '../constrained/plannerWhatIfScenario'
import type { PlannerWhatIfFailureResult } from '../constrained/plannerWhatIfTypes'
import {
  createPlannerAlternativeMaterializer,
  type PlannerAlternativeMaterializer,
} from './plannerAlternativeMaterializer'
import { derivePlannerAlternativeReservation } from './plannerAlternativeReservation'
import {
  assertPlannerAlternativeTrialBounds,
  createPlannerAlternativeFullRunBudget,
  judgePlannerAlternativeTrial,
  PlannerAlternativeRerunLimitError,
  type PlannerAlternativeTrialBounds,
  type PlannerAlternativeTrialRejectionReason,
} from './plannerAlternativeTrial'

/**
 * The Phase 2 Planner Alternative kernel (`docs/PLANNER_SPEC.md` 9.2.19.2 -
 * 9.2.19.6 / 9.2.19.10 / 9.2.19.12): one Route-level decision, then for every
 * non-fixed direct participant Target of its conflict, independently and from
 * the same baseline,
 *
 * ```text
 * fixed Route set  -> resource reservation      (Planner authority only)
 *   -> Planner Alternative Search               (Search Domain, neutral input)
 *   -> deterministic materializer -> temporary Entry G
 *   -> O + G augmented preflight, -O + G replacement preflight
 *   -> full Production Plan run + Trace Replay  (createProductionPlanWithObserver)
 *   -> found (9.2.19.6), or the next Candidate
 * ```
 *
 * It is the shared calculation the Phase 4 what-if and the Phase 5 actual
 * repair both stand on; it composes no scenario Plan, persists nothing, and
 * has no Production routing, Worker message or default of its own.
 */

/** Earlier decisions' Route exclusions of one Target (the repair lineage, Phase 5). */
export interface PlannerAlternativeRouteExclusion {
  targetWeaponId: TargetWeaponId
  /** `candidateStableKey()` values of Routes an earlier decision invalidated. */
  routeKeys: readonly string[]
}

export interface PlannerAlternativeKernelRequest {
  /**
   * The fresh baseline input with the existing explicit resolutions already
   * restored. The decision is merged into it (9.2.4.5); it is never mutated.
   */
  plannerInput: PlannerInput
  /** This decision: its conflict and the Entry the user fixed. */
  decision: PlannerConflictResolution
  /**
   * Fixed Entries of earlier decisions that are still valid (repair lineage,
   * 9.2.19.11), filtered by the caller. Each must be a valid Entry of the
   * current input; none is inferred or substituted.
   */
  priorFixedBuildListEntryIds: readonly BuildListEntryId[]
  /** Routes earlier decisions invalidated, per Target (9.2.19.10). */
  priorExcludedRoutes: readonly PlannerAlternativeRouteExclusion[]
  extent: PlannerAlternativeSearchExtent
  bounds: PlannerAlternativeTrialBounds
}

export interface PlannerAlternativeKernelOptions {
  executionOptions?: PlannerExecutionOptions
}

/** A cancelled kernel request. It is never an outcome. */
export class PlannerAlternativeCancelledError extends Error {
  constructor(message = 'The Planner Alternative calculation was cancelled.') {
    super(message)
    this.name = 'PlannerAlternativeCancelledError'
  }
}

export interface PlannerAlternativeFound {
  status: 'found'
  /** The transient Search result, observational traces included. */
  candidate: PlannerAlternativeCandidate
  /** The deterministic temporary Entry `G` and its `BuildCandidate` snapshot. */
  generated: GeneratedBuildListEntryResult
  /** `O -> G` for this Target (9.2.18). */
  replacement: BuildListEntryReplacement
  /** The trial's own full run over the replacement set, Trace Replay included. */
  trialResult: PlannerResult
  /**
   * The route commitment evidence of that run (runtime-only, never persisted):
   * the provisional outcomes and each Entry's final commitment state.
   */
  trialRouteCommitment: PlannerRouteCommitmentEvidence | null
  /** False when `G` lost only a provisional outcome to an Entry outside the fixed Route set. */
  generatedSelected: boolean
}

/**
 * How one non-fixed Target ended (the 9.2.19.13 outcome statuses). Search
 * termination and trial termination stay apart: `not_found_within_search_extent`
 * means the extent was searched completely without a found Candidate,
 * `stopped_by_search_extent_bound` that the extent left reachable work
 * unchecked, and the two trial bounds that a bound stopped the trials first.
 */
export type PlannerAlternativeKernelOutcome =
  | PlannerAlternativeFound
  | { status: 'not_found_within_search_extent' }
  | { status: 'stopped_by_search_extent_bound' }
  | { status: 'stopped_by_candidate_trial_bound' }
  | { status: 'stopped_by_planner_rerun_bound' }
  /** A required checkpoint Entry of this Target: no alternative is searched (9.5.2). */
  | { status: 'blocked_by_selected_checkpoint' }

export interface PlannerAlternativeKernelTrialRecord {
  candidateKey: string
  generatedBuildListEntryId: BuildListEntryId
  result:
    | { status: 'found'; generatedSelected: boolean }
    | { status: 'rejected'; reason: PlannerAlternativeTrialRejectionReason | 'reused_existing_entry' | 'preflight_refused' }
}

export interface PlannerAlternativeKernelTargetResult {
  targetWeaponId: TargetWeaponId
  /** The Target's current Entry `O`, whose Route this decision invalidates. */
  invalidatedBuildListEntryId: BuildListEntryId
  /** The fixed Route set reserved against: explicit decision and prior fixed Entries, without `O`. */
  fixedRouteBuildListEntryIds: BuildListEntryId[]
  /** `null` when the Target was not searched. */
  reservation: PlannerAlternativeReservation | null
  /** `O`'s Route plus the Target's prior exclusions, as a normalized set. */
  excludedRouteKeys: string[]
  outcome: PlannerAlternativeKernelOutcome
  /** The Search summary; `null` when the Target was not searched. */
  search: (PlannerAlternativeSearchSummary & { stoppedByConsumer: boolean }) | null
  /** Every trial in order; a rejected Candidate is never recorded as a lineage exclusion. */
  trials: PlannerAlternativeKernelTrialRecord[]
}

export type PlannerAlternativeKernelResult =
  | {
      status: 'completed'
      conflictKey: string
      fixedBuildListEntryId: BuildListEntryId
      fixedTargetWeaponId: TargetWeaponId
      /** This decision's fixed Entry and every Entry a valid explicit resolution selects. */
      explicitDecisionBuildListEntryIds: BuildListEntryId[]
      /** In the stable `createPlannerConflictWorks()` order. */
      targets: PlannerAlternativeKernelTargetResult[]
      /** Full Planner runs started. */
      plannerRerunsUsed: number
    }
  | PlannerWhatIfFailureResult
  | {
      status: 'invalid_prior_fixed_entry'
      buildListEntryId: BuildListEntryId
      detail: string
    }

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStableStrings)
}

type TrialOutcome =
  | { status: 'found'; found: PlannerAlternativeFound }
  | {
      status: 'rejected'
      generatedBuildListEntryId: BuildListEntryId
      record: PlannerAlternativeKernelTrialRecord['result']
    }
  | { status: 'rerun_bound' }

/**
 * Runs the kernel for one decision.
 *
 * Preparation reuses the what-if preparation unchanged (`preparePlannerWhatIfScenario()`:
 * the 9.2.4.5 merge, `preparePlannerInitialContext()`, every valid explicit
 * resolution as a fixed constraint, the decision's own constraint, and the
 * scenario-only `createPlannerConflictWorks()`), so the fixed side is only ever
 * an explicit choice - never a recommendation, a priority or a score.
 *
 * Invalid bounds or extent throw; every other failure is typed. Cancellation
 * throws `PlannerAlternativeCancelledError` and returns no partial result.
 */
export async function runPlannerAlternativeKernel(
  request: PlannerAlternativeKernelRequest,
  dependencies: PlannerDependencies,
  options: PlannerAlternativeKernelOptions = {},
): Promise<PlannerAlternativeKernelResult> {
  assertPlannerAlternativeTrialBounds(request.bounds)
  const prepared = preparePlannerWhatIfScenario(
    {
      plannerInput: request.plannerInput,
      scenarioResolution: request.decision,
      bounds: request.bounds,
    },
    dependencies,
  )
  if (prepared.status !== 'ready') return prepared
  const scenario: PreparedPlannerWhatIfScenario = prepared.scenario
  const { entriesById } = scenario.initialContext

  // A prior fixed Entry is used only as it is: it must be a valid Entry of the
  // current input, never inferred, re-targeted or completed.
  for (const id of sortedUnique(request.priorFixedBuildListEntryIds)) {
    if (!entriesById.has(id)) {
      return {
        status: 'invalid_prior_fixed_entry',
        buildListEntryId: id,
        detail: `Prior fixed BuildListEntry '${id}' is not a valid Entry of the current Planner input.`,
      }
    }
  }

  const explicitDecisionBuildListEntryIds = sortedUnique(
    scenario.fixedConstraints.map(({ fixedBuildListEntryId }) => fixedBuildListEntryId),
  )
  const budget = createPlannerAlternativeFullRunBudget(request.bounds)
  const executionOptions = options.executionOptions
  let cancelledPlannerRun = false
  const readCancelledPlannerRun = (): boolean => cancelledPlannerRun
  // The route commitment evidence of the last full run of one Plan
  // generation: the run the Plan (after any runtime-unsupported retry) is
  // built from. Reset before every generation.
  let lastRouteCommitment: PlannerRouteCommitmentEvidence | null = null
  const readLastRouteCommitment = (): PlannerRouteCommitmentEvidence | null => lastRouteCommitment
  const observer: ProductionPlanGenerationObserver = {
    beforePlannerRun: () => budget.beforePlannerRun(),
    afterPlannerRun: (runResult) => {
      if (runResult.cancelled) cancelledPlannerRun = true
      lastRouteCommitment = runResult.routeCommitment ?? null
    },
  }

  const targets: PlannerAlternativeKernelTargetResult[] = []
  for (const work of scenario.works) targets.push(await runTarget(work))
  return {
    status: 'completed',
    conflictKey: scenario.scenarioConstraint.originalConflictId,
    fixedBuildListEntryId: scenario.scenarioConstraint.fixedBuildListEntryId,
    fixedTargetWeaponId: scenario.scenarioConstraint.fixedTargetWeaponId,
    explicitDecisionBuildListEntryIds,
    targets,
    plannerRerunsUsed: budget.used,
  }

  function invalidatedEntryOf(targetWeaponId: TargetWeaponId): BuildListEntry {
    const entries = scenario.initialContext.allSearchEntries.filter(
      (entry) => entry.targetWeaponId === targetWeaponId,
    )
    if (entries.length !== 1) {
      throw new Error(
        `Planner Alternative invariant violated: TargetWeapon '${targetWeaponId}' holds ${entries.length} searchable BuildListEntries; exactly one is its current Route.`,
      )
    }
    return entries[0]
  }

  async function runTarget(work: PlannerConflictWork): Promise<PlannerAlternativeKernelTargetResult> {
    const invalidated = invalidatedEntryOf(work.targetWeaponId)
    const fixedRouteBuildListEntryIds = sortedUnique([
      ...explicitDecisionBuildListEntryIds,
      ...request.priorFixedBuildListEntryIds,
    ]).filter((id) => id !== invalidated.id)
    const excludedRouteKeys = normalizePlannerAlternativeExcludedRouteKeys([
      candidateStableKey(invalidated.candidateSnapshot),
      ...request.priorExcludedRoutes
        .filter(({ targetWeaponId }) => targetWeaponId === work.targetWeaponId)
        .flatMap(({ routeKeys }) => routeKeys),
    ])
    const base = {
      targetWeaponId: work.targetWeaponId,
      invalidatedBuildListEntryId: invalidated.id,
      fixedRouteBuildListEntryIds,
      excludedRouteKeys,
    }
    if (work.blockedBySelectedCheckpoint) {
      // A selected checkpoint is a hard constraint on this Target's Route: no
      // alternative is searched, materialized or trialled (9.5.2).
      return { ...base, reservation: null, outcome: { status: 'blocked_by_selected_checkpoint' }, search: null, trials: [] }
    }
    if (budget.exhausted) {
      // No full Planner run is left to judge anything for this Target.
      return { ...base, reservation: null, outcome: { status: 'stopped_by_planner_rerun_bound' }, search: null, trials: [] }
    }
    const reservation = derivePlannerAlternativeReservation(
      fixedRouteBuildListEntryIds.map((id) => entriesById.get(id) as BuildListEntry),
      dependencies.rngEngine,
    )
    const materializer = createPlannerAlternativeMaterializer({
      origin: scenario.origin,
      targetWeaponId: work.targetWeaponId,
      extent: request.extent,
      reservation,
      excludedRouteKeys,
      clock: dependencies.clock,
    })
    const trials: PlannerAlternativeKernelTrialRecord[] = []
    let outcome: PlannerAlternativeKernelOutcome | null = null
    let execution
    try {
      execution = await visitPlannerAlternativeCandidates(
        {
          origin: scenario.origin,
          targetWeaponId: work.targetWeaponId,
          extent: request.extent,
          reservation,
          excludedRouteKeys,
        },
        dependencies.rngEngine,
        async (candidate) => {
          // Only a further Candidate proves the trial cap truncated something.
          if (trials.length >= request.bounds.maxCandidateTrialsPerTarget) {
            outcome = { status: 'stopped_by_candidate_trial_bound' }
            return 'stop'
          }
          // Nothing is materialized or preflighted without a run to judge it.
          if (budget.exhausted) {
            outcome = { status: 'stopped_by_planner_rerun_bound' }
            return 'stop'
          }
          const trial = await tryCandidate(candidate, invalidated, materializer, fixedRouteBuildListEntryIds)
          if (trial.status === 'rerun_bound') {
            outcome = { status: 'stopped_by_planner_rerun_bound' }
            return 'stop'
          }
          if (trial.status === 'found') {
            trials.push({
              candidateKey: candidateStableKey(candidate),
              generatedBuildListEntryId: trial.found.generated.entry.id,
              result: { status: 'found', generatedSelected: trial.found.generatedSelected },
            })
            outcome = trial.found
            return 'stop'
          }
          // A rejected trial is a judgement against this fixed Route set, not
          // a decision: it never becomes a lineage exclusion (9.2.19.10).
          trials.push({
            candidateKey: candidateStableKey(candidate),
            generatedBuildListEntryId: trial.generatedBuildListEntryId,
            result: trial.record,
          })
          return 'continue'
        },
        {
          shouldCancel: executionOptions?.shouldCancel,
          yieldControl: executionOptions?.yieldControl,
        },
      )
    } catch (error) {
      if (error instanceof CandidateSearchError && error.code === 'cancelled') {
        throw new PlannerAlternativeCancelledError()
      }
      throw error
    }
    const settled: PlannerAlternativeKernelOutcome = outcome ?? (
      execution.summary.stoppedByExtent
        ? { status: 'stopped_by_search_extent_bound' }
        : { status: 'not_found_within_search_extent' }
    )
    return {
      ...base,
      reservation,
      outcome: settled,
      search: { ...execution.summary, stoppedByConsumer: execution.stoppedByConsumer },
      trials,
    }
  }

  /**
   * One Candidate's trial (9.2.19.6): `G` replaces `O` (9.2.18), every
   * explicit resolution is re-mapped over `O + G` and again over `-O + G`
   * (9.2.3.1), and the full Production Plan run over the replacement set -
   * Trace Replay included - is the only coexistence authority. A refused
   * preflight rejects this Candidate only.
   */
  async function tryCandidate(
    candidate: PlannerAlternativeCandidate,
    invalidated: BuildListEntry,
    materializer: PlannerAlternativeMaterializer,
    fixedRouteBuildListEntryIds: readonly BuildListEntryId[],
  ): Promise<TrialOutcome> {
    const generated = materializer.materializeBuildListEntry(candidate, scenario.mergedInput.buildListEntries)
    // A current Entry with this exact semantic content is already in the
    // input: for this Target that is its own Entry `O`, which the decision
    // invalidates, so it is no alternative.
    if (generated.reusedExisting) {
      return { status: 'rejected', generatedBuildListEntryId: generated.entry.id, record: { status: 'rejected', reason: 'reused_existing_entry' } }
    }
    const resolved = resolveBuildListEntryReplacement(scenario.mergedInput.buildListEntries, generated.entry)
    if (resolved.status !== 'ready' || resolved.replacement.replacedBuildListEntryId !== invalidated.id) {
      throw new Error(
        `Planner Alternative invariant violated: the temporary Entry of TargetWeapon '${invalidated.targetWeaponId}' does not replace its current Entry '${invalidated.id}'.`,
      )
    }
    const replacements = [resolved.replacement]
    const preflight = preparePlannerReplacementConflictPreflight(
      {
        ...scenario.mergedInput,
        buildListEntries: [...scenario.mergedInput.buildListEntries, generated.entry],
      },
      replacements,
      scenario.fixedConstraints,
      scenario.conflictContexts,
      dependencies,
    )
    if (preflight.status !== 'ready') {
      return { status: 'rejected', generatedBuildListEntryId: generated.entry.id, record: { status: 'rejected', reason: 'preflight_refused' } }
    }
    const runContext: PlannerRunBuildListContext = { kind: 'temporary_replacement', replacements }
    const run = await runFullPlanner(preflight.resolvedInput, runContext)
    if (run === 'rerun_budget_reached') return { status: 'rerun_bound' }
    const routeCommitment = readLastRouteCommitment()
    const verdict = judgePlannerAlternativeTrial(run, {
      generatedBuildListEntryId: generated.entry.id,
      explicitDecisionBuildListEntryIds,
      fixedRouteBuildListEntryIds,
      routeCommitment,
    })
    if (verdict.status === 'rejected') {
      return { status: 'rejected', generatedBuildListEntryId: generated.entry.id, record: verdict }
    }
    return {
      status: 'found',
      found: {
        status: 'found',
        candidate,
        generated,
        replacement: resolved.replacement,
        trialResult: run,
        trialRouteCommitment: routeCommitment,
        generatedSelected: verdict.generatedSelected,
      },
    }
  }

  async function runFullPlanner(
    planInput: PlannerInput,
    buildListContext: PlannerRunBuildListContext,
  ): Promise<PlannerResult | 'rerun_budget_reached'> {
    cancelledPlannerRun = false
    lastRouteCommitment = null
    let result: PlannerResult
    try {
      result = await createProductionPlanWithObserver(
        planInput,
        dependencies,
        executionOptions,
        observer,
        buildListContext,
      )
    } catch (error) {
      // A blocked full run is a typed stop. Every other failure - Plan
      // generation (a Trace Replay failure included), prediction, Planner or
      // Search invariant - propagates unchanged, never becoming a rejection.
      if (error instanceof PlannerAlternativeRerunLimitError) return 'rerun_budget_reached'
      throw error
    }
    // A cancelled run returns a safe `plan: null` result, which is no verdict.
    if (readCancelledPlannerRun()) throw new PlannerAlternativeCancelledError()
    return result
  }
}
