import type {
  BuildListEntryId,
  BuildRoute,
  CandidateBonusAmendmentStep,
  CandidateConversionSkillStep,
  CandidateSkillAmendmentStep,
  ConflictKind,
  GroupSkillId,
  PlanConflict,
  RestorationBonusScope,
  RestorationBonusSet,
  SeriesSkillId,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  normalizePlannerAlternativeExcludedRouteKeys,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchExtent,
} from '../../search'
import { preparePlannerAugmentedConflictPreflight, preparePlannerReplacementConflictPreflight } from '../constrained/plannerAugmentedPreflight'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
} from '../plannerTypes'
import {
  createPlannerAlternativeFullRunner,
  type PlannerAlternativeFullRun,
  type PlannerAlternativeFullRunner,
} from './plannerAlternativeFullRun'
import {
  preparePlannerAlternativeKernel,
  runPreparedPlannerAlternativeKernel,
  type PlannerAlternativeFound,
  type PlannerAlternativeKernelCompletedResult,
  type PlannerAlternativeKernelPreparationFailure,
  type PlannerAlternativeKernelTargetResult,
  type PlannerAlternativeRouteExclusion,
  type PreparedPlannerAlternativeKernel,
} from './plannerAlternativeKernel'
import {
  createPlannerAlternativeFullRunBudget,
  judgePlannerAlternativeTrial,
  type PlannerAlternativeTrialBounds,
} from './plannerAlternativeTrial'

/**
 * The Planner Alternative What-if Calculation: B9 「比較する」 on the Planner
 * Alternative kernel (`docs/PLANNER_SPEC.md` 9.2.19.7 / 9.2.19.8.1 / 9.2.19.9 /
 * 9.2.19.12 / 9.2.19.13, Phase 4-B).
 *
 * ```text
 * preparePlannerAlternativeKernel()           the scenarioResolution merged in
 *   -> runPreparedPlannerAlternativeKernel()   every non-fixed Target, independently
 *   -> scenario composition (9.2.19.8.1)       found replacements, stable order,
 *                                              monotonic adoption
 *   -> final scenario result                   reused, or one new run only for
 *                                              zero found replacements
 *   -> typed comparison (9.2.19.13)            Route summaries, scenario Plan
 *                                              step count, Conflict classification
 * ```
 *
 * One `PlannerAlternativeFullRunBudget` is created per request and shared by
 * the kernel's individual trials, every adoption run, the final run and every
 * runtime-unsupported retry inside them (request-global `maxPlannerReruns`).
 *
 * It is transient: it persists no BuildListEntry, ProductionPlan, resolution,
 * comparison or repair lineage, and it never re-searches a Conflict the
 * scenario introduces (one-step preview). It is a separate calculation from the
 * legacy B9 `createPlannerWhatIfComparison()`, which stays the Production UI
 * path until Phase 5.
 */

/**
 * What a Planner Alternative what-if request carries across the Worker
 * boundary: everything except the extent and the trial bounds, which the
 * Production Worker adapter supplies inside the Worker (9.2.19.12).
 */
export interface PlannerAlternativeWhatIfInput {
  /**
   * The fresh baseline input with the existing explicit resolutions restored
   * and `options` already the Application's Conflict resolution Planner options
   * (9.2.19.7). It is never mutated.
   */
  plannerInput: PlannerInput
  /** The virtual fixed choice of this comparison (9.2.4.5). */
  scenarioResolution: PlannerConflictResolution
  /** Still valid fixed Entries of earlier decisions (repair lineage, 9.2.19.11), filtered by the caller. */
  priorFixedBuildListEntryIds: readonly BuildListEntryId[]
  /** Routes earlier decisions invalidated, per Target (still valid repair lineage, 9.2.19.10). */
  priorExcludedRoutes: readonly PlannerAlternativeRouteExclusion[]
}

/**
 * The Domain request. `extent` and `bounds` are caller-required: the Domain
 * performs no default substitution, fallback, clamp or field-wise completion.
 */
export interface PlannerAlternativeWhatIfRequest extends PlannerAlternativeWhatIfInput {
  extent: PlannerAlternativeSearchExtent
  bounds: PlannerAlternativeTrialBounds
}

export interface PlannerAlternativeWhatIfOptions {
  executionOptions?: PlannerExecutionOptions
}

/** The distance of one found alternative, from the Planner-start origin (9.2.4.1 / 9.2.19.13). */
export interface PlannerAlternativeDistance {
  /** The alternative Route's own operation units (held positions are not counted). */
  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  /** `null`: the Route represents no Normal Counter advance (blind). */
  estimatedNormalAdvance: number | null
}

/**
 * A presentation-neutral description of a found alternative Route
 * (9.2.19.13): a pure projection of the `PlannerAlternativeCandidate` the
 * search delivered. No RNG prediction, no generated BuildCandidate, no
 * `candidateStableKey` is read to build it.
 */
export interface PlannerAlternativeRouteSummary {
  /** The concrete RouteOperation sequence in execution order, source OwnedWeapon IDs included. */
  route: BuildRoute
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  bonusAmendmentTrace: CandidateBonusAmendmentStep[]
  skillAmendmentTrace: CandidateSkillAmendmentStep[]
  conversionSkillTrace: CandidateConversionSkillStep | null
}

/**
 * One non-fixed Target's outcome. `found` means only that the Target's own
 * individual trial succeeded (9.2.19.6); `adoptedInScenario` is its fate in the
 * scenario composition: `true` accepted, `false` evaluated and rejected, `null`
 * not evaluated because the request-global rerun budget stopped the
 * composition first. `cancelled` is never an outcome.
 */
export type PlannerAlternativeOutcome =
  | {
      status: 'found'
      alternative: PlannerAlternativeRouteSummary
      distance: PlannerAlternativeDistance
      adoptedInScenario: boolean | null
    }
  | { status: 'not_found_within_search_extent' }
  | { status: 'stopped_by_search_extent_bound' }
  | { status: 'stopped_by_candidate_trial_bound' }
  | { status: 'stopped_by_planner_rerun_bound' }
  | { status: 'blocked_by_selected_checkpoint' }

export interface PlannerAlternativeTargetOutcome {
  fixedBuildListEntryId: BuildListEntryId
  fixedTargetWeaponId: TargetWeaponId
  alternativeTargetWeaponId: TargetWeaponId
  outcome: PlannerAlternativeOutcome
  /**
   * Candidates this Target's search actually reached and skipped because a
   * still valid prior repair lineage key excludes them. A Candidate excluded
   * only as this decision's invalidated current Route is not counted, a
   * lineage key the search never reached is not counted, and a trial rejection
   * is not counted. It is not the Search summary's total `excludedCandidates`.
   */
  excludedByRepairLineageCount: number
}

export interface PlannerAlternativeConflictSummary {
  kind: ConflictKind
  participantTargetWeaponIds: TargetWeaponId[]
  /** `selectedBuildListEntryId !== null`. The two scenario lists hold unresolved Conflicts only. */
  resolved: boolean
}

/**
 * The whole scenario (this decision, 1-step repaired), from the final scenario
 * result only (9.2.19.8.1 / 9.2.19.13).
 */
export type PlannerAlternativeScenarioOutcome =
  | {
      status: 'evaluated'
      /** `ProductionPlan.steps.length` of the final scenario Plan; never a sum of Route estimates. */
      scenarioOperationCount: number
      /** Planning Targets the scenario Plan does not complete (no Step completes them). */
      unplannedTargetWeaponIds: TargetWeaponId[]
      /** Unresolved Conflicts with an accepted replacement's generated Entry as a participant. */
      introducedConflicts: PlannerAlternativeConflictSummary[]
      /** Unresolved Conflicts without one. */
      remainingConflicts: PlannerAlternativeConflictSummary[]
    }
  | { status: 'no_plan' }
  | { status: 'stopped_by_plan_step_bound'; maxPlanSteps: number }
  | { status: 'stopped_by_planner_rerun_bound' }

export interface PlannerAlternativeComparison {
  conflictKey: string
  fixedBuildListEntryId: BuildListEntryId
  fixedTargetWeaponId: TargetWeaponId
  /** In the Domain's stable Target order (`createPlannerConflictWorks()`). */
  alternatives: PlannerAlternativeTargetOutcome[]
  scenario: PlannerAlternativeScenarioOutcome
}

/** Failures are typed values, never parsed messages. */
export type PlannerAlternativeWhatIfCalculationResult =
  | { status: 'completed'; comparison: PlannerAlternativeComparison }
  | PlannerAlternativeKernelPreparationFailure

/** Pure projection of a delivered Candidate (9.2.19.13); nothing is predicted or reconstructed. */
export function createPlannerAlternativeRouteSummary(
  candidate: PlannerAlternativeCandidate,
): PlannerAlternativeRouteSummary {
  return {
    route: structuredClone(candidate.route),
    finalBonuses: structuredClone(candidate.finalBonuses),
    restorationBonusScope: candidate.restorationBonusScope,
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
    bonusAmendmentTrace: structuredClone(candidate.bonusAmendmentTrace),
    skillAmendmentTrace: structuredClone(candidate.skillAmendmentTrace),
    conversionSkillTrace: candidate.conversionSkillTrace === undefined
      ? null
      : structuredClone(candidate.conversionSkillTrace),
  }
}

function distanceOf(candidate: PlannerAlternativeCandidate): PlannerAlternativeDistance {
  return {
    estimatedOperationCount: candidate.estimatedOperationCount,
    estimatedGogmaAdvance: candidate.estimatedGogmaAdvance,
    estimatedSkillAdvance: candidate.estimatedSkillAdvance,
    estimatedNormalAdvance: candidate.estimatedNormalAdvance,
  }
}

/**
 * Candidates the search skipped for a still valid prior lineage key of this
 * Target (9.2.19.13). The skipped keys are the Search Domain's neutral record;
 * only here are they told apart from the current invalidated Route.
 */
export function countPlannerAlternativeLineageExclusions(
  target: Pick<PlannerAlternativeKernelTargetResult, 'targetWeaponId' | 'skippedExcludedRouteKeys'>,
  priorExcludedRoutes: readonly PlannerAlternativeRouteExclusion[],
): number {
  const lineageKeys = new Set(normalizePlannerAlternativeExcludedRouteKeys(
    priorExcludedRoutes
      .filter(({ targetWeaponId }) => targetWeaponId === target.targetWeaponId)
      .flatMap(({ routeKeys }) => routeKeys),
  ))
  return new Set(target.skippedExcludedRouteKeys.filter((key) => lineageKeys.has(key))).size
}

/**
 * The scenario composition of 9.2.19.8.1 and its bookkeeping. The kernel's
 * individual trials are over when it starts.
 */
interface ScenarioComposition {
  /** `null` when the rerun budget stopped the composition before a final result existed. */
  final: PlannerAlternativeFullRun | null
  accepted: PlannerAlternativeFound[]
  adoptedByTargetWeaponId: ReadonlyMap<TargetWeaponId, boolean | null>
}

/**
 * Runs one Planner Alternative what-if comparison.
 *
 * Invalid bounds or extent throw; every other failure is typed. Cancellation
 * throws `PlannerAlternativeCancelledError` and returns no partial result.
 */
export async function createPlannerAlternativeWhatIfComparison(
  request: PlannerAlternativeWhatIfRequest,
  dependencies: PlannerDependencies,
  options: PlannerAlternativeWhatIfOptions = {},
): Promise<PlannerAlternativeWhatIfCalculationResult> {
  const kernelRequest = {
    plannerInput: request.plannerInput,
    decision: request.scenarioResolution,
    priorFixedBuildListEntryIds: request.priorFixedBuildListEntryIds,
    priorExcludedRoutes: request.priorExcludedRoutes,
    extent: request.extent,
    bounds: request.bounds,
  }
  const preparation = preparePlannerAlternativeKernel(kernelRequest, dependencies)
  if (preparation.status !== 'ready') return preparation
  const prepared = preparation.prepared
  // The one request-global budget (9.2.19.12).
  const budget = createPlannerAlternativeFullRunBudget(request.bounds)
  const kernel = await runPreparedPlannerAlternativeKernel(prepared, kernelRequest, dependencies, {
    executionOptions: options.executionOptions,
    fullRunBudget: budget,
  })
  const runner = createPlannerAlternativeFullRunner(budget, dependencies, options.executionOptions)
  const composition = await composeScenario(prepared, kernel, runner, dependencies)

  const alternatives: PlannerAlternativeTargetOutcome[] = kernel.targets.map((target) => ({
    fixedBuildListEntryId: kernel.fixedBuildListEntryId,
    fixedTargetWeaponId: kernel.fixedTargetWeaponId,
    alternativeTargetWeaponId: target.targetWeaponId,
    outcome: target.outcome.status === 'found'
      ? {
          status: 'found',
          alternative: createPlannerAlternativeRouteSummary(target.outcome.candidate),
          distance: distanceOf(target.outcome.candidate),
          adoptedInScenario: composition.adoptedByTargetWeaponId.get(target.targetWeaponId) ?? null,
        }
      : { ...target.outcome },
    excludedByRepairLineageCount: countPlannerAlternativeLineageExclusions(target, request.priorExcludedRoutes),
  }))
  return {
    status: 'completed',
    comparison: {
      conflictKey: kernel.conflictKey,
      fixedBuildListEntryId: kernel.fixedBuildListEntryId,
      fixedTargetWeaponId: kernel.fixedTargetWeaponId,
      alternatives,
      scenario: projectScenarioOutcome(prepared, kernel, composition),
    },
  }
}

/**
 * 9.2.19.8.1: the found replacements, in the kernel's stable Target order, are
 * added to the accepted set monotonically.
 *
 * - The first found replacement's individual trial already evaluated
 *   `{ first }` under the composition's own conditions, so it is reused as the
 *   first accepted scenario result; it is never rejected and never re-run.
 * - Every later one is one adoption run over `accepted + it`. A preflight or
 *   re-association failure rejects it before any run (no budget); a run that
 *   fails the accepted judgement rejects it alone and keeps what was accepted.
 * - With no found replacement, the one new run is the scenario input with no
 *   replacement at all. Otherwise the latest accepted result already evaluated
 *   the final accepted set and is reused; no final run is added.
 * - When the budget cannot start a run the composition needs, it stops there:
 *   every replacement it never judged is `null`, and there is no final result.
 */
async function composeScenario(
  prepared: PreparedPlannerAlternativeKernel,
  kernel: PlannerAlternativeKernelCompletedResult,
  runner: PlannerAlternativeFullRunner,
  dependencies: PlannerDependencies,
): Promise<ScenarioComposition> {
  const { scenario } = prepared
  const targetById = new Map(kernel.targets.map((target) => [target.targetWeaponId, target]))
  const found = kernel.targets.flatMap((target) =>
    target.outcome.status === 'found' ? [target.outcome] : [])
  const adopted = new Map<TargetWeaponId, boolean | null>()
  const accepted: PlannerAlternativeFound[] = []
  let current: PlannerAlternativeFullRun | null = null
  let stopped = false

  for (const replacement of found) {
    const targetWeaponId = replacement.replacement.targetWeaponId
    if (accepted.length === 0) {
      accepted.push(replacement)
      current = { result: replacement.trialResult, routeCommitment: replacement.trialRouteCommitment }
      adopted.set(targetWeaponId, true)
      continue
    }
    // Nothing is preflighted without a run to judge it.
    if (stopped || runner.budget.exhausted) {
      stopped = true
      adopted.set(targetWeaponId, null)
      continue
    }
    const candidateSet = [...accepted, replacement]
    const run = await adoptionRun(candidateSet)
    if (run === 'rerun_budget_reached') {
      stopped = true
      adopted.set(targetWeaponId, null)
      continue
    }
    if (run === 'preflight_refused' || !isAccepted(run, candidateSet)) {
      adopted.set(targetWeaponId, false)
      continue
    }
    accepted.push(replacement)
    current = run
    adopted.set(targetWeaponId, true)
  }

  if (found.length === 0) {
    if (runner.budget.exhausted) {
      stopped = true
    } else {
      const run = await scenarioRunWithoutReplacement()
      if (run === 'rerun_budget_reached') stopped = true
      else current = run
    }
  }
  return { final: stopped ? null : current, accepted, adoptedByTargetWeaponId: adopted }

  /** 9.2.19.6 over every replacement of the set at once, through the one judgement authority. */
  function isAccepted(run: PlannerAlternativeFullRun, set: readonly PlannerAlternativeFound[]): boolean {
    return set.every((replacement) => {
      const target = targetById.get(replacement.replacement.targetWeaponId)
      if (!target) throw new Error('Planner Alternative invariant violated: a found replacement has no kernel Target.')
      return judgePlannerAlternativeTrial(run.result, {
        generatedBuildListEntryId: replacement.generated.entry.id,
        explicitDecisionBuildListEntryIds: kernel.explicitDecisionBuildListEntryIds,
        fixedRouteBuildListEntryIds: target.fixedRouteBuildListEntryIds,
        routeCommitment: run.routeCommitment,
      }).status === 'found'
    })
  }

  async function adoptionRun(
    set: readonly PlannerAlternativeFound[],
  ): Promise<PlannerAlternativeFullRun | 'rerun_budget_reached' | 'preflight_refused'> {
    const replacements = set.map(({ replacement }) => ({ ...replacement }))
    const preflight = preparePlannerReplacementConflictPreflight(
      {
        ...scenario.mergedInput,
        buildListEntries: [...scenario.mergedInput.buildListEntries, ...set.map(({ generated }) => generated.entry)],
      },
      replacements,
      scenario.fixedConstraints,
      scenario.conflictContexts,
      dependencies,
    )
    if (preflight.status !== 'ready') return 'preflight_refused'
    return runner.run(preflight.resolvedInput, { kind: 'temporary_replacement', replacements })
  }

  /** Case A: the decision merged in, no replacement, every explicit resolution re-mapped. */
  async function scenarioRunWithoutReplacement(): Promise<PlannerAlternativeFullRun | 'rerun_budget_reached'> {
    const preflight = preparePlannerAugmentedConflictPreflight(
      scenario.mergedInput,
      scenario.fixedConstraints,
      dependencies,
    )
    if (preflight.status !== 'ready') {
      // The fixed constraints were built from exactly these conflicts; a
      // failure here is no scenario outcome to invent.
      throw new Error(
        `Planner Alternative invariant violated: the scenario input without replacement failed its conflict preflight (${preflight.status}).`,
      )
    }
    return runner.run(preflight.resolvedInput, { kind: 'persisted' })
  }
}

/**
 * The final scenario result as the typed `scenario` (9.2.19.13), its Conflicts
 * after the decision expansion of 9.2.19.9.
 */
function projectScenarioOutcome(
  prepared: PreparedPlannerAlternativeKernel,
  kernel: PlannerAlternativeKernelCompletedResult,
  composition: ScenarioComposition,
): PlannerAlternativeScenarioOutcome {
  const final = composition.final
  if (final === null) return { status: 'stopped_by_planner_rerun_bound' }
  const { result } = final
  if (result.termination.status === 'incomplete') {
    return { status: 'stopped_by_plan_step_bound', maxPlanSteps: result.termination.limits.maxPlanSteps }
  }
  const plan = result.plan
  if (plan === null) return { status: 'no_plan' }

  const { scenario } = prepared
  const acceptedGeneratedIds = new Set(composition.accepted.map(({ generated }) => generated.entry.id))
  const acceptedTargetIds = new Set(composition.accepted.map(({ replacement }) => replacement.targetWeaponId))
  // Invalidated Entries this decision left in place: no replacement was accepted for their Target.
  const remainingInvalidatedIds = new Set(kernel.targets
    .filter(({ targetWeaponId }) => !acceptedTargetIds.has(targetWeaponId))
    .map(({ invalidatedBuildListEntryId }) => invalidatedBuildListEntryId))
  const targetByEntryId = new Map<BuildListEntryId, TargetWeaponId>([
    ...scenario.mergedInput.buildListEntries.map((entry) => [entry.id, entry.targetWeaponId] as const),
    ...composition.accepted.map(({ generated }) => [generated.entry.id, generated.entry.targetWeaponId] as const),
  ])

  const unresolved = result.conflicts.filter((conflict) =>
    conflict.selectedBuildListEntryId === null &&
    !isExpandedToFixed(conflict, kernel.fixedBuildListEntryId, remainingInvalidatedIds))
  const summarize = (conflict: PlanConflict): PlannerAlternativeConflictSummary => ({
    kind: conflict.kind,
    participantTargetWeaponIds: [...new Set(conflict.buildListEntryIds.map((id) => {
      const targetWeaponId = targetByEntryId.get(id)
      if (targetWeaponId === undefined) {
        throw new Error(`Planner Alternative invariant violated: conflict participant '${id}' is no Entry of the scenario.`)
      }
      return targetWeaponId
    }))].sort(),
    resolved: conflict.selectedBuildListEntryId !== null,
  })
  const introduces = (conflict: PlanConflict) =>
    conflict.buildListEntryIds.some((id) => acceptedGeneratedIds.has(id))

  const completedTargetIds = new Set(plan.steps.flatMap((step) =>
    step.executionEffects?.targetCompletions.map(({ targetWeaponId }) => targetWeaponId) ?? []))
  return {
    status: 'evaluated',
    scenarioOperationCount: plan.steps.length,
    unplannedTargetWeaponIds: scenario.initialContext.planningTargetIds
      .filter((targetWeaponId) => !completedTargetIds.has(targetWeaponId)),
    introducedConflicts: unresolved.filter(introduces).map(summarize),
    remainingConflicts: unresolved.filter((conflict) => !introduces(conflict)).map(summarize),
  }
}

/**
 * The decision expansion of 9.2.19.9: an unresolved Conflict whose participants
 * are this decision's fixed Entry and invalidated Entries left in place only is
 * read as resolved for the fixed Entry. A Conflict of a selected checkpoint is
 * never resolved by a winner choice (9.5), so it is never expanded; nor is one
 * whose checkpoint judgement is unknown.
 */
function isExpandedToFixed(
  conflict: PlanConflict,
  fixedBuildListEntryId: BuildListEntryId,
  remainingInvalidatedIds: ReadonlySet<BuildListEntryId>,
): boolean {
  if (conflict.checkpointParticipants === undefined || conflict.checkpointParticipants.length > 0) return false
  if (!conflict.buildListEntryIds.includes(fixedBuildListEntryId)) return false
  return conflict.buildListEntryIds.every((id) =>
    id === fixedBuildListEntryId || remainingInvalidatedIds.has(id))
}
