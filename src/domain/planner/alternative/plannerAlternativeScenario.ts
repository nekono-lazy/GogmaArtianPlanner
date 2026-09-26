import type {
  BuildListEntryId,
  PlanConflict,
  TargetWeaponId,
} from '../../models/publicTypes'
import { preparePlannerAugmentedConflictPreflight, preparePlannerReplacementConflictPreflight } from '../constrained/plannerAugmentedPreflight'
import type {
  PlannerDependencies,
  PlannerExecutionOptions,
} from '../plannerTypes'
import {
  countPlannerAlternativeLineageExclusions,
  createPlannerAlternativeDistance,
  createPlannerAlternativeRouteSummary,
  type PlannerAlternativeComparison,
  type PlannerAlternativeConflictSummary,
  type PlannerAlternativeScenarioOutcome,
  type PlannerAlternativeTargetOutcome,
} from './plannerAlternativeComparison'
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
  type PlannerAlternativeKernelRequest,
  type PreparedPlannerAlternativeKernel,
} from './plannerAlternativeKernel'
import {
  createPlannerAlternativeFullRunBudget,
  judgePlannerAlternativeTrial,
} from './plannerAlternativeTrial'

/**
 * The one Planner Alternative scenario calculation shared by the what-if
 * (「比較する」, 9.2.19.7) and the actual repair (「この候補を優先」, 9.2.19.8)
 * (`docs/PLANNER_SPEC.md` 9.2.19.8.1 / 9.2.19.9 / 9.2.19.12 / 9.2.19.13):
 *
 * ```text
 * preparePlannerAlternativeKernel()           the decision merged in
 *   -> runPreparedPlannerAlternativeKernel()   every non-fixed Target, independently
 *   -> scenario composition (9.2.19.8.1)       found replacements, stable order,
 *                                              monotonic adoption
 *   -> final scenario result                   reused, or one new run only for
 *                                              zero found replacements
 *   -> decision expansion (9.2.19.9)           the one expansion authority
 *   -> typed comparison (9.2.19.13)
 * ```
 *
 * One `PlannerAlternativeFullRunBudget` is created per request and shared by
 * the kernel's individual trials, every adoption run, the final run and every
 * runtime-unsupported retry inside them (request-global `maxPlannerReruns`).
 * The what-if projects only the comparison; the actual repair also builds its
 * persistence artifact from the same calculation, so neither reimplements the
 * composition. Nothing here persists anything.
 */

/**
 * The scenario composition of 9.2.19.8.1 and its bookkeeping. The kernel's
 * individual trials are over when it starts.
 */
export interface PlannerAlternativeScenarioComposition {
  /** `null` when the rerun budget stopped the composition before a final result existed. */
  final: PlannerAlternativeFullRun | null
  /**
   * The accepted replacement set, in the kernel's stable Target order. It is
   * the authority on which replacements the scenario adopts - never the final
   * Plan's `selectedBuildListEntryIds`: an accepted `G` may be the non-adopted
   * side of a provisional outcome against an Entry outside the fixed Route set
   * (9.2.19.6).
   */
  accepted: PlannerAlternativeFound[]
  /** `true` accepted, `false` rejected, `null` not evaluated (only found Targets are keys). */
  adoptedByTargetWeaponId: ReadonlyMap<TargetWeaponId, boolean | null>
}

/**
 * What the decision expansion of 9.2.19.9 reads: this decision's fixed Entry
 * and the Entries it invalidated that no accepted replacement took the place of.
 */
export interface PlannerAlternativeDecisionExpansion {
  fixedBuildListEntryId: BuildListEntryId
  remainingInvalidatedBuildListEntryIds: ReadonlySet<BuildListEntryId>
}

export interface PlannerAlternativeScenarioCalculation {
  prepared: PreparedPlannerAlternativeKernel
  kernel: PlannerAlternativeKernelCompletedResult
  composition: PlannerAlternativeScenarioComposition
  expansion: PlannerAlternativeDecisionExpansion
  comparison: PlannerAlternativeComparison
}

export type PlannerAlternativeScenarioCalculationResult =
  | { status: 'completed'; calculation: PlannerAlternativeScenarioCalculation }
  | PlannerAlternativeKernelPreparationFailure

export interface PlannerAlternativeScenarioOptions {
  executionOptions?: PlannerExecutionOptions
}

/**
 * Runs the whole scenario calculation for one decision.
 *
 * Invalid bounds or extent throw; every other preparation failure is typed.
 * Cancellation throws `PlannerAlternativeCancelledError` and returns no partial
 * result.
 */
export async function runPlannerAlternativeScenario(
  request: PlannerAlternativeKernelRequest,
  dependencies: PlannerDependencies,
  options: PlannerAlternativeScenarioOptions = {},
): Promise<PlannerAlternativeScenarioCalculationResult> {
  const preparation = preparePlannerAlternativeKernel(request, dependencies)
  if (preparation.status !== 'ready') return preparation
  const prepared = preparation.prepared
  // The one request-global budget (9.2.19.12).
  const budget = createPlannerAlternativeFullRunBudget(request.bounds)
  const kernel = await runPreparedPlannerAlternativeKernel(prepared, request, dependencies, {
    executionOptions: options.executionOptions,
    fullRunBudget: budget,
  })
  const runner = createPlannerAlternativeFullRunner(budget, dependencies, options.executionOptions)
  const composition = await composePlannerAlternativeScenario(prepared, kernel, runner, dependencies)
  const expansion = derivePlannerAlternativeDecisionExpansion(kernel, composition)
  return {
    status: 'completed',
    calculation: {
      prepared,
      kernel,
      composition,
      expansion,
      comparison: {
        conflictKey: kernel.conflictKey,
        fixedBuildListEntryId: kernel.fixedBuildListEntryId,
        fixedTargetWeaponId: kernel.fixedTargetWeaponId,
        alternatives: createPlannerAlternativeTargetOutcomes(kernel, composition, request),
        scenario: projectPlannerAlternativeScenarioOutcome(prepared, composition, expansion),
      },
    },
  }
}

function createPlannerAlternativeTargetOutcomes(
  kernel: PlannerAlternativeKernelCompletedResult,
  composition: PlannerAlternativeScenarioComposition,
  request: Pick<PlannerAlternativeKernelRequest, 'priorExcludedRoutes'>,
): PlannerAlternativeTargetOutcome[] {
  return kernel.targets.map((target) => ({
    fixedBuildListEntryId: kernel.fixedBuildListEntryId,
    fixedTargetWeaponId: kernel.fixedTargetWeaponId,
    alternativeTargetWeaponId: target.targetWeaponId,
    outcome: target.outcome.status === 'found'
      ? {
          status: 'found',
          alternative: createPlannerAlternativeRouteSummary(target.outcome.candidate),
          distance: createPlannerAlternativeDistance(target.outcome.candidate),
          adoptedInScenario: composition.adoptedByTargetWeaponId.get(target.targetWeaponId) ?? null,
        }
      : { ...target.outcome },
    excludedByRepairLineageCount: countPlannerAlternativeLineageExclusions(target, request.priorExcludedRoutes),
  }))
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
async function composePlannerAlternativeScenario(
  prepared: PreparedPlannerAlternativeKernel,
  kernel: PlannerAlternativeKernelCompletedResult,
  runner: PlannerAlternativeFullRunner,
  dependencies: PlannerDependencies,
): Promise<PlannerAlternativeScenarioComposition> {
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

/** The Entries the decision expansion may cover (9.2.19.9): invalidated Entries left in place. */
export function derivePlannerAlternativeDecisionExpansion(
  kernel: Pick<PlannerAlternativeKernelCompletedResult, 'fixedBuildListEntryId' | 'targets'>,
  composition: Pick<PlannerAlternativeScenarioComposition, 'accepted'>,
): PlannerAlternativeDecisionExpansion {
  const acceptedTargetIds = new Set(composition.accepted.map(({ replacement }) => replacement.targetWeaponId))
  return {
    fixedBuildListEntryId: kernel.fixedBuildListEntryId,
    remainingInvalidatedBuildListEntryIds: new Set(kernel.targets
      .filter(({ targetWeaponId }) => !acceptedTargetIds.has(targetWeaponId))
      .map(({ invalidatedBuildListEntryId }) => invalidatedBuildListEntryId)),
  }
}

/**
 * The decision expansion of 9.2.19.9, as the one judgement: an unresolved
 * Conflict whose participants are this decision's fixed Entry and invalidated
 * Entries left in place only is resolved for the fixed Entry. A Conflict of a
 * selected checkpoint is never resolved by a winner choice (9.5.1), so it is
 * never expanded; nor is one whose checkpoint judgement is unknown.
 */
export function isPlannerAlternativeConflictExpandedToFixed(
  conflict: PlanConflict,
  expansion: PlannerAlternativeDecisionExpansion,
): boolean {
  if (conflict.selectedBuildListEntryId !== null) return false
  if (conflict.checkpointParticipants === undefined || conflict.checkpointParticipants.length > 0) return false
  const fixed = expansion.fixedBuildListEntryId
  if (!conflict.buildListEntryIds.includes(fixed)) return false
  return conflict.buildListEntryIds.every((id) =>
    id === fixed || expansion.remainingInvalidatedBuildListEntryIds.has(id))
}

/**
 * The final scenario Conflicts with the decision expanded (9.2.19.9): each
 * expanded Conflict is saved as decided for the fixed Entry; every other
 * Conflict is returned unchanged. The input is not mutated, and no full
 * Planner run is involved. What-if classification and the actual repair's
 * saved Plan both read this one list.
 */
export function expandPlannerAlternativeDecision(
  conflicts: readonly PlanConflict[],
  expansion: PlannerAlternativeDecisionExpansion,
): PlanConflict[] {
  return conflicts.map((conflict) => isPlannerAlternativeConflictExpandedToFixed(conflict, expansion)
    ? {
        ...structuredClone(conflict),
        selectedBuildListEntryId: expansion.fixedBuildListEntryId,
        resolutionNote: `Expanded the conflict repair decision for BuildListEntry '${expansion.fixedBuildListEntryId}'.`,
      }
    : structuredClone(conflict))
}

/**
 * The final scenario result as the typed `scenario` (9.2.19.13), its Conflicts
 * after the decision expansion of 9.2.19.9.
 */
function projectPlannerAlternativeScenarioOutcome(
  prepared: PreparedPlannerAlternativeKernel,
  composition: PlannerAlternativeScenarioComposition,
  expansion: PlannerAlternativeDecisionExpansion,
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
  const targetByEntryId = new Map<BuildListEntryId, TargetWeaponId>([
    ...scenario.mergedInput.buildListEntries.map((entry) => [entry.id, entry.targetWeaponId] as const),
    ...composition.accepted.map(({ generated }) => [generated.entry.id, generated.entry.targetWeaponId] as const),
  ])

  const unresolved = expandPlannerAlternativeDecision(result.conflicts, expansion)
    .filter((conflict) => conflict.selectedBuildListEntryId === null)
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
