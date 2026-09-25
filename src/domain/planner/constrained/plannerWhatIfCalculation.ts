import type { BuildListEntryId } from '../../models/publicTypes'
import { resolveBuildListEntryReplacement } from '../../buildList'
import { CandidateSearchError, enumerateConstrainedCandidates } from '../../search'
import type {
  ConstrainedCandidate,
  ConstrainedEnumerationSummary,
} from '../../search'
import { createProductionPlanWithObserver } from '../productionPlanGeneration'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerResult,
  PlannerRunBuildListContext,
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import {
  createConstrainedMaterializer,
  type ConstrainedMaterializer,
} from './constrainedMaterializer'
import {
  preparePlannerAugmentedConflictPreflight,
  preparePlannerReplacementConflictPreflight,
} from './plannerAugmentedPreflight'
import type { PlannerFixedConflictConstraint } from './plannerConflictContext'
import type { PlannerConflictWork } from './plannerConstrainedOrchestration'
import {
  createPlannerWhatIfFullRunBudget,
  PlannerWhatIfRerunLimitError,
  type PlannerWhatIfFullRunBudget,
} from './plannerWhatIfRerunBudget'
import {
  preparePlannerWhatIfScenario,
  type PreparedPlannerWhatIfScenario,
} from './plannerWhatIfScenario'
import type {
  PlannerWhatIfCalculationOptions,
  PlannerWhatIfCalculationResult,
  PlannerWhatIfDistance,
  PlannerWhatIfOutcome,
  PlannerWhatIfRequest,
  PlannerWhatIfTargetComparison,
} from './plannerWhatIfTypes'

/**
 * The B9-B1b what-if Domain calculation (PLANNER_SPEC 9.2.4.1 - 9.2.4.13).
 *
 * It answers one question only: with the scenario Candidate held fixed, how far
 * away is each other participating Target's next feasible Ideal Candidate? It
 * produces no `ProductionPlan`, adopts nothing, and persists nothing (9.2.4.8).
 *
 * The pipeline per Target is fixed:
 *
 * ```text
 * enumerateConstrainedCandidates()   Search Domain, final sorted order
 *   -> deterministic materializer    B8-C2
 *   -> temporary trial Entry G, replacing the Target's baseline Entry O
 *   -> conflict preflight            B8-C3, every fixed constraint, over O + G
 *                                    and then over the replacement set -O + G
 *   -> full Production Plan run      Planner run + Trace Replay, over -O + G
 *   -> found, or the next Candidate
 * ```
 *
 * It adds no conflict logic of its own: feasibility is decided only by the full
 * rerun plus Trace Replay over the trial's replacement set (9.2.4.7 / 9.2.11 /
 * 9.2.18) - the same replacement semantics a B8 adoption is calculated with -
 * never by a Counter comparison, a `usedCounters` shortcut, a Candidate score,
 * a Candidate category, or `recommendedBuildListEntryId`. It persists nothing
 * and returns no replacement metadata.
 */

/** A cancelled what-if request. It is never a `PlannerWhatIfOutcome` member. */
export class PlannerWhatIfCancelledError extends Error {
  constructor(message = 'The Planner what-if comparison was cancelled.') {
    super(message)
    this.name = 'PlannerWhatIfCancelledError'
  }
}

/** How one Candidate trial ended. */
type CandidateTrialOutcome = 'found' | 'rejected' | 'rerun_bound'

function rerunBoundOutcome(): PlannerWhatIfOutcome {
  return { status: 'stopped_by_planner_rerun_bound' }
}

/**
 * The distance of PLANNER_SPEC 9.2.4.1: the enumerator's own origin-relative
 * estimates, carried over unchanged.
 */
function distanceOf(candidate: ConstrainedCandidate): PlannerWhatIfDistance {
  return {
    estimatedOperationCount: candidate.estimatedOperationCount,
    estimatedGogmaAdvance: candidate.estimatedGogmaAdvance,
    estimatedSkillAdvance: candidate.estimatedSkillAdvance,
    estimatedNormalAdvance: candidate.estimatedNormalAdvance,
  }
}

/**
 * The whole feasibility condition of PLANNER_SPEC 9.2.4.7.
 *
 * The trial Entry and every fixed Entry must all be selected by the rerun's
 * Plan. Nothing else is consulted: not `completed`, not
 * `recommendedBuildListEntryId`, not a full Planner run bestState participant, not
 * Target priority, and not the Candidate's score or category. B9 adopts
 * nothing, so B8's extra "every previously adopted generated Entry is still
 * selected" condition has no counterpart here.
 */
export function isPlannerWhatIfCandidateFeasible(
  selectedBuildListEntryIds: readonly BuildListEntryId[],
  trialBuildListEntryId: BuildListEntryId,
  fixedConstraints: readonly PlannerFixedConflictConstraint[],
): boolean {
  const selected = new Set(selectedBuildListEntryIds)
  return (
    selected.has(trialBuildListEntryId) &&
    fixedConstraints.every(({ fixedBuildListEntryId }) =>
      selected.has(fixedBuildListEntryId),
    )
  )
}

/**
 * The outcome of a category that tried every Candidate the enumeration offered
 * without proving one feasible.
 *
 * A bound stop and exhaustion stay separate statuses (PLANNER_SPEC 9.2.4.11,
 * 9.2.16). The two flags are complements here because the collector never stops
 * by consumer; a run that is neither is an invariant violation and is
 * propagated as an error rather than mapped to a plausible-looking status.
 */
export function plannerWhatIfEnumerationOutcome(
  summary: ConstrainedEnumerationSummary,
): PlannerWhatIfOutcome {
  if (summary.stoppedByBound) return { status: 'stopped_by_enumeration_bound' }
  if (summary.exhausted) return { status: 'not_found_within_search_extent' }
  throw new Error(
    'Constrained enumeration ended neither exhausted nor stopped by a bound.',
  )
}

/**
 * Runs one what-if comparison.
 *
 * `options.enumerationBounds` is used exactly as supplied: no default
 * substitution, fallback, clamp, or field-wise completion (9.2.4.10). The
 * ordinary Candidate Search request fields - `CandidateSearchSettings` and
 * `routeFilter` - are not applied and are not consulted.
 *
 * Every Target and every Candidate trial starts from the same baseline: the
 * Planner-start origin, the merged input, and every valid explicit resolution
 * as a fixed constraint (9.2.4.4). Nothing a trial produced is carried into the
 * next trial or the next Target.
 */
export async function createPlannerWhatIfComparison(
  request: PlannerWhatIfRequest,
  dependencies: PlannerDependencies,
  options: PlannerWhatIfCalculationOptions,
): Promise<PlannerWhatIfCalculationResult> {
  const prepared = preparePlannerWhatIfScenario(request, dependencies)
  if (prepared.status !== 'ready') return prepared
  const scenario: PreparedPlannerWhatIfScenario = prepared.scenario
  const budget = createPlannerWhatIfFullRunBudget(request.bounds)
  const maxTrials = request.bounds.maxCandidateTrialsPerTarget
  const executionOptions = options.executionOptions

  // Reset before every run, so one run can never read another run's result.
  let cancelledPlannerRun = false
  /** Declared return type: the assignment below happens inside a callback. */
  const readCancelledPlannerRun = (): boolean => cancelledPlannerRun
  const observer: ProductionPlanGenerationObserver = {
    beforePlannerRun: () => budget.beforePlannerRun(),
    afterPlannerRun: (runResult) => {
      if (runResult.cancelled) cancelledPlannerRun = true
    },
  }

  const alternatives: PlannerWhatIfTargetComparison[] = []
  for (const work of scenario.works) {
    if (work.blockedBySelectedCheckpoint) {
      // A selected checkpoint is a hard constraint on this Target's current
      // Route, so no alternate Route is a valid answer and none is enumerated,
      // materialized, preflighted, or trialled (PLANNER_SPEC 9.5.2).
      alternatives.push({
        targetWeaponId: work.targetWeaponId,
        outcome: { status: 'blocked_by_selected_checkpoint' },
      })
      continue
    }
    if (budget.exhausted) {
      // No full Planner run is left to judge anything for this Target, so no
      // enumeration, materialization or preflight is started for it at all
      // (PLANNER_SPEC 9.2.4.9).
      alternatives.push({
        targetWeaponId: work.targetWeaponId,
        outcome: rerunBoundOutcome(),
      })
      continue
    }
    alternatives.push(await compareTarget(work))
  }

  return {
    status: 'completed',
    comparison: {
      conflictKey: scenario.scenarioConstraint.originalConflictId,
      fixedBuildListEntryId: scenario.scenarioConstraint.fixedBuildListEntryId,
      fixedTargetWeaponId: scenario.scenarioConstraint.fixedTargetWeaponId,
      alternatives,
    },
  }

  async function compareTarget(
    work: PlannerConflictWork,
  ): Promise<PlannerWhatIfTargetComparison> {
    const enumeration = await enumerateTarget(work)
    const materializer = createConstrainedMaterializer({
      origin: scenario.origin,
      targetWeaponId: work.targetWeaponId,
      bounds: options.enumerationBounds,
      clock: dependencies.clock,
    })
    return {
      targetWeaponId: work.targetWeaponId,
      // The final `compareConstrainedCandidates()` order, taken whole: every
      // enumerated Candidate is an Ideal Candidate, so there is nothing to
      // split by category (PLANNER_SPEC 9.2.4.2 / 9.2.4.3).
      outcome: await evaluateTargetOutcome(
        enumeration.candidates,
        enumeration.summary,
        materializer,
        budget,
      ),
    }
  }

  /**
   * The collector form is used deliberately: the final sorted order is the B9
   * ordering authority, and the incremental delivery order of
   * `visitConstrainedCandidates()` need not equal it (PLANNER_SPEC 9.2.4.3).
   */
  async function enumerateTarget(work: PlannerConflictWork) {
    try {
      return await enumerateConstrainedCandidates(
        {
          origin: scenario.origin,
          targetWeaponId: work.targetWeaponId,
          bounds: options.enumerationBounds,
        },
        dependencies.rngEngine,
        {
          shouldCancel: executionOptions?.shouldCancel,
          yieldControl: executionOptions?.yieldControl,
        },
      )
    } catch (error) {
      // Only the Search Domain's own cancellation becomes a cancelled request.
      // Every other Search, RNG, materialization or invariant failure keeps its
      // own error path.
      if (error instanceof CandidateSearchError && error.code === 'cancelled') {
        throw new PlannerWhatIfCancelledError()
      }
      throw error
    }
  }

  async function evaluateTargetOutcome(
    candidates: readonly ConstrainedCandidate[],
    summary: ConstrainedEnumerationSummary,
    materializer: ConstrainedMaterializer,
    runBudget: PlannerWhatIfFullRunBudget,
  ): Promise<PlannerWhatIfOutcome> {
    // No Candidate at all needs no full Planner run, so the enumeration itself
    // already decides this slot even when the rerun budget is spent.
    if (candidates.length === 0) return plannerWhatIfEnumerationOutcome(summary)
    if (runBudget.exhausted) return rerunBoundOutcome()
    let trialsUsed = 0
    for (const candidate of candidates) {
      // Only reaching a further Candidate proves the trial cap truncated
      // something. Spending exactly the last trial on the last Candidate is not
      // a truncation. This check precedes the trial, so when the trial cap and
      // the rerun budget would block the same next Candidate, the trial cap
      // wins: raising `maxPlannerReruns` alone would not get past it.
      if (trialsUsed >= maxTrials) {
        return { status: 'stopped_by_candidate_trial_bound' }
      }
      // A Candidate taken up for feasibility spends its trial here, before
      // materialization - not after a successful one (PLANNER_SPEC 9.2.4.9).
      trialsUsed += 1
      const outcome = await tryCandidate(candidate, materializer)
      if (outcome === 'found') {
        return { status: 'found', distance: distanceOf(candidate) }
      }
      if (outcome === 'rerun_bound') return rerunBoundOutcome()
    }
    return plannerWhatIfEnumerationOutcome(summary)
  }

  /**
   * One Candidate's feasibility, decided only by the full Planner rerun.
   *
   * A `reusedExisting` Candidate is judged exactly like any other: no duplicate
   * Entry is added, but the preflight and the full rerun still run, and being
   * an existing Entry is never on its own a rejection (PLANNER_SPEC 9.2.4.6).
   */
  async function tryCandidate(
    candidate: ConstrainedCandidate,
    materializer: ConstrainedMaterializer,
  ): Promise<CandidateTrialOutcome> {
    // Always the baseline Entries, never a previous trial's or a previous
    // Target's augmented set (PLANNER_SPEC 9.2.4.4).
    const { entry, reusedExisting } = materializer.materializeBuildListEntry(
      candidate,
      scenario.mergedInput.buildListEntries,
    )
    const trial = prepareTrial(entry, reusedExisting)
    // A trial-input preflight failure rejects this Candidate only. The scenario
    // fixed constraints themselves were already built safely, so it is never
    // promoted to an `invalid_fixed_resolution` comparison failure.
    if (trial === null) return 'rejected'

    const run = await runFullPlanner(trial.input, trial.buildListContext)
    if (run.status === 'rerun_budget_reached') return 'rerun_bound'
    const plan = run.result.plan
    if (plan === null) return 'rejected'
    // `completed === true` is deliberately not required: a partial Plan that
    // still selects the trial Entry and every fixed Entry proves coexistence.
    return isPlannerWhatIfCandidateFeasible(
      plan.selectedBuildListEntryIds,
      entry.id,
      scenario.fixedConstraints,
    )
      ? 'found'
      : 'rejected'
  }

  /**
   * The trial's preflight and full-run input, always from the baseline
   * (PLANNER_SPEC 9.2.4.4); `null` rejects the Candidate.
   *
   * Every valid explicit resolution, not only the scenario's own, stays a
   * feasibility constraint and is re-mapped onto the currently detected
   * conflicts before any full Planner run starts (PLANNER_SPEC 9.2.3.1, 9.2.4.7).
   *
   * - a `reusedExisting` Candidate adds no Entry: the baseline itself is judged,
   *   as an ordinary persisted input, exactly as before
   * - otherwise the trial Entry `G` replaces its Target's baseline Entry `O`
   *   (9.2.18): the preflight re-associates over `O` + `G` and again over the
   *   replacement set, and the full run gets the replacement set only
   */
  function prepareTrial(
    entry: ReturnType<ConstrainedMaterializer['materializeBuildListEntry']>['entry'],
    reusedExisting: boolean,
  ): { input: PlannerInput; buildListContext: PlannerRunBuildListContext } | null {
    if (reusedExisting) {
      const preflight = preparePlannerAugmentedConflictPreflight(
        scenario.mergedInput,
        scenario.fixedConstraints,
        dependencies,
      )
      return preflight.status === 'ready'
        ? { input: preflight.resolvedInput, buildListContext: { kind: 'persisted' } }
        : null
    }
    const resolved = resolveBuildListEntryReplacement(scenario.mergedInput.buildListEntries, entry)
    if (resolved.status !== 'ready') {
      throw new Error(`Planner what-if invariant violated: ${resolved.detail}`)
    }
    const replacements = [resolved.replacement]
    const preflight = preparePlannerReplacementConflictPreflight(
      {
        ...scenario.mergedInput,
        buildListEntries: [...scenario.mergedInput.buildListEntries, entry],
      },
      replacements,
      scenario.fixedConstraints,
      scenario.conflictContexts,
      dependencies,
    )
    return preflight.status === 'ready'
      ? {
          input: preflight.resolvedInput,
          buildListContext: { kind: 'temporary_replacement', replacements },
        }
      : null
  }

  async function runFullPlanner(
    planInput: PlannerInput,
    buildListContext: PlannerRunBuildListContext,
  ): Promise<
    | { status: 'completed'; result: PlannerResult }
    | { status: 'rerun_budget_reached' }
  > {
    cancelledPlannerRun = false
    let result: PlannerResult
    try {
      // A Candidate trial runs over its replacement set
      // (`docs/PLANNER_SPEC.md` 9.2.18), a reused existing Entry over the
      // baseline as an ordinary persisted input.
      result = await createProductionPlanWithObserver(
        planInput,
        dependencies,
        executionOptions,
        observer,
        buildListContext,
      )
    } catch (error) {
      // A blocked full Planner run is a normal, typed stop. Every other failure -
      // materialization, prediction, Planner or Search invariant - propagates
      // unchanged and is never converted into a rejection.
      if (error instanceof PlannerWhatIfRerunLimitError) {
        return { status: 'rerun_budget_reached' }
      }
      throw error
    }
    // A cancelled full Planner run returns a safe `plan: null` result, which must
    // not be read as "this Candidate is infeasible". The whole request ends
    // instead, and no partial comparison is returned (PLANNER_SPEC 9.2.4.12).
    if (readCancelledPlannerRun()) throw new PlannerWhatIfCancelledError()
    return { status: 'completed', result }
  }
}
