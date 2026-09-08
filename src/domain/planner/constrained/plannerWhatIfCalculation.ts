import type {
  BuildListEntryId,
  CandidateCategory,
} from '../../models/publicTypes'
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
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import {
  createConstrainedMaterializer,
  type ConstrainedMaterializer,
} from './constrainedMaterializer'
import { preparePlannerAugmentedConflictPreflight } from './plannerAugmentedPreflight'
import type { PlannerFixedConflictConstraint } from './plannerConflictContext'
import type { PlannerConflictWork } from './plannerConstrainedOrchestration'
import {
  createPlannerWhatIfFullBeamBudget,
  PlannerWhatIfRerunLimitError,
  type PlannerWhatIfFullBeamBudget,
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
 * away is each other participating Target's next feasible Practical and Ideal
 * Candidate? It produces no `ProductionPlan`, adopts nothing, and persists
 * nothing (9.2.4.8).
 *
 * The pipeline per Target is fixed:
 *
 * ```text
 * enumerateConstrainedCandidates()   Search Domain, final sorted order
 *   -> practical / ideal split       exclusive CandidateCategory slots
 *   -> deterministic materializer    B8-C2
 *   -> temporary trial Entry
 *   -> augmented conflict preflight  B8-C3, every fixed constraint
 *   -> full Production Plan run      Beam Search + Trace Replay
 *   -> found, or the next Candidate
 * ```
 *
 * It adds no conflict logic of its own: feasibility is decided only by the full
 * rerun plus Trace Replay over the augmented input (9.2.4.7 / 9.2.11), never by
 * a Counter comparison, a `usedCounters` shortcut, a Candidate score, a
 * Candidate category, or `recommendedBuildListEntryId`.
 */

/** A cancelled what-if request. It is never a `PlannerWhatIfOutcome` member. */
export class PlannerWhatIfCancelledError extends Error {
  constructor(message = 'The Planner what-if comparison was cancelled.') {
    super(message)
    this.name = 'PlannerWhatIfCancelledError'
  }
}

/**
 * The category execution order of PLANNER_SPEC 9.2.4.9.
 *
 * This is execution scheduling authority, not Candidate semantic ordering
 * authority: it fixes which category spends the shared `maxPlannerReruns`
 * first. Inside a category the ordering authority stays
 * `compareConstrainedCandidates()`.
 */
const whatIfCategoryOrder: readonly CandidateCategory[] = ['practical', 'ideal']

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
 * `recommendedBuildListEntryId`, not a Beam Search bestState participant, not
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
 * ordinary Candidate Search filters - `CandidateSearchSettings`,
 * `resultFilter`, the similar filter and `maxCandidatesPerTarget` - are not
 * applied and are not consulted.
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
  const budget = createPlannerWhatIfFullBeamBudget(request.bounds)
  const maxTrials = request.bounds.maxCandidateTrialsPerCategoryPerTarget
  const executionOptions = options.executionOptions

  // Reset before every run, so one run can never read another run's Beam.
  let cancelledBeam = false
  /** Declared return type: the assignment below happens inside a callback. */
  const readCancelledBeam = (): boolean => cancelledBeam
  const observer: ProductionPlanGenerationObserver = {
    beforeBeamSearch: () => budget.beforeBeamSearch(),
    afterBeamSearch: (beamResult) => {
      if (beamResult.cancelled) cancelledBeam = true
    },
  }

  const alternatives: PlannerWhatIfTargetComparison[] = []
  for (const work of scenario.works) {
    if (budget.exhausted) {
      // No Beam Search is left to judge anything for this Target, so no
      // enumeration, materialization or preflight is started for it at all
      // (PLANNER_SPEC 9.2.4.9).
      alternatives.push({
        targetWeaponId: work.targetWeaponId,
        practical: rerunBoundOutcome(),
        ideal: rerunBoundOutcome(),
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
    const outcomes = new Map<CandidateCategory, PlannerWhatIfOutcome>()
    for (const category of whatIfCategoryOrder) {
      outcomes.set(
        category,
        await evaluateCategory(
          // The final `compareConstrainedCandidates()` order, filtered in
          // place: the two slots are exclusive `CandidateCategory` values, so
          // an Ideal Candidate never fills the Practical slot and vice versa
          // (PLANNER_SPEC 9.2.4.2 / 9.2.4.3).
          enumeration.candidates.filter(({ category: value }) => value === category),
          enumeration.summary,
          materializer,
          budget,
        ),
      )
    }
    return {
      targetWeaponId: work.targetWeaponId,
      practical: outcomes.get('practical') as PlannerWhatIfOutcome,
      ideal: outcomes.get('ideal') as PlannerWhatIfOutcome,
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

  async function evaluateCategory(
    candidates: readonly ConstrainedCandidate[],
    summary: ConstrainedEnumerationSummary,
    materializer: ConstrainedMaterializer,
    beamBudget: PlannerWhatIfFullBeamBudget,
  ): Promise<PlannerWhatIfOutcome> {
    // No Candidate at all needs no Beam Search, so the enumeration itself
    // already decides this slot even when the rerun budget is spent.
    if (candidates.length === 0) return plannerWhatIfEnumerationOutcome(summary)
    if (beamBudget.exhausted) return rerunBoundOutcome()
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
    const trialInput: PlannerInput = reusedExisting
      ? scenario.mergedInput
      : {
          ...scenario.mergedInput,
          buildListEntries: [...scenario.mergedInput.buildListEntries, entry],
        }
    // Every valid explicit resolution, not only the scenario's own: the other
    // fixed choices stay feasibility constraints, and all of them are re-mapped
    // onto the currently detected conflicts before any Beam Search runs
    // (PLANNER_SPEC 9.2.3.1, 9.2.4.7).
    const preflight = preparePlannerAugmentedConflictPreflight(
      trialInput,
      scenario.fixedConstraints,
      dependencies,
    )
    // A trial-input preflight failure rejects this Candidate only. The scenario
    // fixed constraints themselves were already built safely, so it is never
    // promoted to an `invalid_fixed_resolution` comparison failure.
    if (preflight.status !== 'ready') return 'rejected'

    const run = await runFullPlanner(preflight.resolvedInput)
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

  async function runFullPlanner(
    planInput: PlannerInput,
  ): Promise<
    | { status: 'completed'; result: PlannerResult }
    | { status: 'rerun_budget_reached' }
  > {
    cancelledBeam = false
    let result: PlannerResult
    try {
      result = await createProductionPlanWithObserver(
        planInput,
        dependencies,
        executionOptions,
        observer,
      )
    } catch (error) {
      // A blocked Beam Search is a normal, typed stop. Every other failure -
      // materialization, prediction, Planner or Search invariant - propagates
      // unchanged and is never converted into a rejection.
      if (error instanceof PlannerWhatIfRerunLimitError) {
        return { status: 'rerun_budget_reached' }
      }
      throw error
    }
    // A cancelled Beam Search returns a safe `plan: null` result, which must
    // not be read as "this Candidate is infeasible". The whole request ends
    // instead, and no partial comparison is returned (PLANNER_SPEC 9.2.4.12).
    if (readCancelledBeam()) throw new PlannerWhatIfCancelledError()
    return { status: 'completed', result }
  }
}
