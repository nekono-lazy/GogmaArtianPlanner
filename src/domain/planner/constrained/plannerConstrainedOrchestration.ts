import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  resolveBuildListEntryReplacement,
  sortBuildListEntryReplacements,
  type BuildListEntryReplacement,
} from '../../buildList'
import { visitConstrainedCandidates } from '../../search'
import type { ConstrainedEnumerationBounds } from '../../search'
import {
  preparePlannerInitialContext,
} from '../plannerInitialContext'
import { createProductionPlanWithObserver } from '../productionPlanGeneration'
import { createUnsearchedPlannerTermination, plannerRunLimits } from '../plannerTermination'
import type {
  PlannerRunResult,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
  PlannerRunBuildListContext,
  PlannerWarning,
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import { preparePlannerReplacementConflictPreflight } from '../replacement/plannerAugmentedPreflight'
import {
  createPlannerConflictContexts,
  preparePlannerFixedConflictConstraints,
  type PlannerFixedConflictConstraint,
  type PlannerFixedConstraintFailure,
} from '../replacement/plannerConflictContext'
import {
  createPlannerConflictWorks,
  type PlannerConflictWork,
} from '../replacement/plannerConflictWork'
import { createPlannerStartSearchOrigin } from '../replacement/plannerSearchOrigin'
import { createConstrainedMaterializer } from './constrainedMaterializer'
import type { PlannerOrchestrationBounds } from './plannerOrchestrationBounds'
import {
  createPlannerFullRunBudget,
  PlannerOrchestrationLimitError,
} from './plannerRerunBudget'

/**
 * The B8-C4b Planner-driven constrained re-search orchestration
 * (PLANNER_SPEC 9.2.6 - 9.2.16).
 *
 * It is the piece that connects everything B8-B1/B2 and B8-C1..C4a already
 * built, in exactly the fixed order:
 *
 * ```text
 * visitConstrainedCandidates()      Search Domain, sequential, Target-local
 *   -> deterministic materializer   B8-C2
 *   -> temporary generated Entry G, replacing the Target's persisted Entry O
 *   -> conflict preflight           B8-C3, over O + G, then over -O + G
 *   -> full Production Plan run     B8-C4a observed boundary, over -O + G
 *   -> adoption, or the next Candidate
 * ```
 *
 * It adds no conflict logic of its own. Coexistence is decided only by the full
 * full Planner run plus Trace Replay of `createProductionPlanWithObserver()` over the
 * trial's **replacement set** (PLANNER_SPEC 9.2.11 / 9.2.18): `O` stays only in
 * the preflight that re-associates the user's fixed constraints, so the Plan a
 * trial produces - its Steps, conflicts, rejections and PlanningInputSnapshot -
 * never records an Entry the adoption deletes. Nothing here writes to
 * persistence, touches a Worker, or reads React state: B8-D owns all of that.
 *
 * Since Phase 6-B2a (PLANNER_SPEC 9.2.19.16) the conflict contexts, fixed
 * constraints, preflight, conflict works and Planner-start Search origin it
 * uses are the shared Planner Domain primitives of `../replacement/`; this
 * module keeps only the legacy B8 orchestration itself. No normal Application
 * runtime path calls it any more (Phase 6-A / 6-B1); its remaining consumers
 * are tests and benchmarks.
 */

export interface PlannerConstrainedOrchestrationOptions {
  /** The Search Domain extent authority; never `CandidateSearchSettings`. */
  enumerationBounds: ConstrainedEnumerationBounds
  /** The Planner-side bounds; never passed across the Search boundary. */
  orchestrationBounds: PlannerOrchestrationBounds
  executionOptions?: PlannerExecutionOptions
}

/**
 * The orchestration result of PLANNER_SPEC 9.2.14. `plan`, `conflicts` and
 * `warnings` keep their ordinary `PlannerResult` meaning.
 */
export interface PlannerOrchestrationResult extends PlannerResult {
  /**
   * Only Entries adopted into the final replacement set *and* selected by the
   * final Plan. It is empty whenever `plan === null`, and it never contains a
   * trial-rejected Entry or a reused existing Entry.
   */
  generatedBuildListEntries: BuildListEntry[]
  /**
   * The persisted Entry each generated Entry replaces (`docs/PLANNER_SPEC.md`
   * 9.2.18): exactly one per generated Entry, for its own Target, in stable
   * order. It is runtime result metadata only - never a `BuildListEntry` or
   * `ProductionPlan` field - carried through the Worker so the save-time
   * transaction deletes that very `O`, and nothing else, once it confirmed
   * `O` is still the Target's one persisted Entry. Empty with `plan === null`.
   */
  generatedBuildListEntryReplacements: BuildListEntryReplacement[]
}

/**
 * The constrained counterpart of `CreateProductionPlanCalculation`.
 *
 * Up to Phase 6-B1 the Planner Worker controller depended on this signature
 * rather than on `createProductionPlanWithConstrainedSearch()` itself, so the
 * controller stayed pure message routing and reimplemented none of the B8-C
 * orchestration. Phase 6-B1 removed that Worker branch and its Production
 * adapter; the signature has no Production consumer left.
 *
 * `PlannerOrchestrationBounds` is an explicit parameter because it is
 * caller-required (PLANNER_SPEC 9.2.16). `ConstrainedEnumerationBounds` is
 * deliberately absent: the adapter that fulfils this signature chooses it - the
 * Production adapter did so, until Phase 6-B1, by passing
 * `defaultConstrainedEnumerationBounds` explicitly.
 */
export type CreateConstrainedProductionPlanCalculation = (
  input: PlannerInput,
  orchestrationBounds: PlannerOrchestrationBounds,
  dependencies: PlannerDependencies,
  options?: PlannerExecutionOptions,
) => Promise<PlannerOrchestrationResult>

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function dedupeWarnings(warnings: readonly PlannerWarning[]): PlannerWarning[] {
  return warnings.filter(
    (warning, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.kind === warning.kind && candidate.message === warning.message,
      ) === index,
  )
}

/**
 * Whether the current Plan already secures this work's Target alongside its
 * fixed Entry (PLANNER_SPEC 9.2.10).
 *
 * The authority is the current `ProductionPlan.selectedBuildListEntryIds` plus
 * the current augmented input's Entry-to-Target mapping. Candidate score,
 * category, and `recommendedBuildListEntryId` decide nothing here. A null
 * selection - no Plan at all - satisfies nothing.
 *
 * It is re-evaluated before every work item, because one adopted Candidate can
 * settle several conflicts at once.
 */
export function isPlannerConflictWorkSatisfied(
  work: PlannerConflictWork,
  selectedBuildListEntryIds: readonly BuildListEntryId[] | null,
  entries: readonly BuildListEntry[],
): boolean {
  if (selectedBuildListEntryIds === null) return false
  const selected = new Set(selectedBuildListEntryIds)
  if (!selected.has(work.constraint.fixedBuildListEntryId)) return false
  return entries.some(
    (entry) =>
      selected.has(entry.id) && entry.targetWeaponId === work.targetWeaponId,
  )
}

/**
 * The Candidate adoption condition of PLANNER_SPEC 9.2.11 / 9.2.14.
 *
 * Adoption is monotonic: the trial Entry, every fixed Entry, and every
 * previously adopted generated Entry must all still be selected by the rerun's
 * Plan. A trial whose Plan keeps the new Entry by dropping a fixed Entry, or by
 * dropping an Entry adopted earlier, is rejected. `recommendedBuildListEntryId`,
 * a bestState participant, Target priority, Candidate score, and Candidate
 * category are never consulted, and `completed === true` is not required, so a
 * partial Plan that still selects all of them is adoptable.
 */
export function isConstrainedTrialAdoptable(
  selectedBuildListEntryIds: readonly BuildListEntryId[],
  trialBuildListEntryId: BuildListEntryId,
  fixedConstraints: readonly PlannerFixedConflictConstraint[],
  adoptedBuildListEntryIds: readonly BuildListEntryId[],
): boolean {
  const selected = new Set(selectedBuildListEntryIds)
  return (
    selected.has(trialBuildListEntryId) &&
    fixedConstraints.every(({ fixedBuildListEntryId }) =>
      selected.has(fixedBuildListEntryId),
    ) &&
    adoptedBuildListEntryIds.every((id) => selected.has(id))
  )
}

/**
 * The planning Targets of an input whose full Planner run never ran, read from the
 * same `preparePlannerInitialContext()` authority a searched run counts, so an
 * unsearched termination never falls back to every active Target.
 */
function unsearchedPlanningTargetIds(
  input: PlannerInput,
  dependencies: PlannerDependencies,
): readonly TargetWeaponId[] {
  const prepared = preparePlannerInitialContext(input, dependencies)
  return prepared.status === 'ready'
    ? prepared.context.planningTargetIds
    : prepared.planningTargetIds
}

function fixedConstraintFailureWarning(
  failure: PlannerFixedConstraintFailure,
): PlannerWarning {
  return {
    kind: 'invalid_conflict_resolution',
    message: `Conflict resolution '${failure.conflictKey}' cannot fix BuildListEntry '${failure.selectedBuildListEntryId}' (${failure.reason}): ${failure.detail}`,
  }
}

/**
 * How one full Production Plan generation ended.
 *
 * `cancelled` is a normal ordinary-Planner outcome, not an error: a cancelled
 * full Planner run already returns a safe `PlannerResult` with `plan: null`. It is
 * kept as its own status so orchestration stops right there instead of walking
 * on into the Search Domain, where the very same `shouldCancel` would raise a
 * `CandidateSearchError('cancelled')` and turn a handled cancellation into a
 * rejected Promise.
 */
type FullPlannerRun =
  | { status: 'completed'; result: PlannerResult }
  | { status: 'cancelled'; result: PlannerResult }
  | { status: 'rerun_budget_reached' }

/** How one delivered Candidate ended. */
type CandidateOutcome = 'adopted' | 'rejected' | 'stop'

/**
 * Runs the whole Planner-driven constrained re-search (PLANNER_SPEC 9.2.6).
 *
 * Both bounds sets stay caller-supplied: neither Production default is applied
 * here. B8-D passes `defaultConstrainedEnumerationBounds` explicitly, and the
 * B8-E2b `defaultPlannerOrchestrationBounds` is likewise chosen by the caller
 * rather than substituted by this function.
 *
 * The Search Domain never learns anything about the Planner side: the
 * enumerator receives only the origin, a TargetWeapon ID, and
 * `ConstrainedEnumerationBounds`. No conflict DTO, fixed constraint,
 * orchestration bound, conflict resolution, or Planner state crosses that
 * boundary.
 */
export async function createProductionPlanWithConstrainedSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options: PlannerConstrainedOrchestrationOptions,
): Promise<PlannerOrchestrationResult> {
  const { enumerationBounds, orchestrationBounds, executionOptions } = options
  // One shared budget for every full Planner run this orchestration starts:
  // the initial ordinary one, every Candidate trial, and every
  // runtime-unsupported retry inside Production Plan generation.
  const budget = createPlannerFullRunBudget(orchestrationBounds)
  const orchestrationWarnings: PlannerWarning[] = []
  // Scoped to one `runFullPlanner()` call and reset at its start, so a later
  // run can never read a previous run's full Planner run result.
  let lastCompletedPlannerRun: PlannerRunResult | null = null
  const observer: ProductionPlanGenerationObserver = {
    beforePlannerRun: () => budget.beforePlannerRun(),
    afterPlannerRun: (runResult) => {
      lastCompletedPlannerRun = runResult
    },
  }
  /**
   * Read through a declared return type: the assignment above happens inside a
   * callback, so a direct read would be narrowed to the initial `null`.
   */
  const readLastCompletedPlannerRun = (): PlannerRunResult | null =>
    lastCompletedPlannerRun

  /**
   * Whether every affordable full Planner run has already been started.
   *
   * Checked before any further orchestration work, because reaching
   * `maxPlannerReruns` must stop enumeration, materialization and preflight
   * too - not merely fail the next `beforePlannerRun()` (PLANNER_SPEC 9.2.16).
   */
  const isRerunBudgetExhausted = (): boolean => budget.used >= budget.limit

  function warn(kind: PlannerWarning['kind'], message: string): void {
    orchestrationWarnings.push({ kind, message })
  }

  function rerunBudgetWarning(): void {
    warn(
      'max_planner_reruns_reached',
      `Planner constrained re-search stopped: maxPlannerReruns (${budget.limit}) full Planner run executions were used.`,
    )
  }

  async function runFullPlanner(
    planInput: PlannerInput,
    buildListContext: PlannerRunBuildListContext,
  ): Promise<FullPlannerRun> {
    lastCompletedPlannerRun = null
    try {
      const result = await createProductionPlanWithObserver(
        planInput,
        dependencies,
        executionOptions,
        observer,
        buildListContext,
      )
      // This run's own last full Planner run, never a previous run's.
      return readLastCompletedPlannerRun()?.cancelled === true
        ? { status: 'cancelled', result }
        : { status: 'completed', result }
    } catch (error) {
      // A reached bound is a normal, typed stop. Every other failure - a
      // materialization invariant, a Search input invariant, a Prediction
      // failure, a Planner invariant - propagates unchanged.
      if (
        error instanceof PlannerOrchestrationLimitError &&
        error.code === 'max_planner_reruns'
      ) {
        return { status: 'rerun_budget_reached' }
      }
      throw error
    }
  }

  function finish(
    result: PlannerResult,
    adopted: readonly BuildListEntry[],
    replacements: readonly BuildListEntryReplacement[],
  ) {
    // A Plan is the only thing that can carry a generated Entry, so a null Plan
    // returns none of them and no replacement either (PLANNER_SPEC 9.2.14).
    const generatedBuildListEntries =
      result.plan === null
        ? []
        : [...adopted]
            .sort((left, right) => compareStableStrings(left.id, right.id))
            .map((entry) => structuredClone(entry))
    return {
      plan: result.plan,
      conflicts: result.conflicts,
      warnings: dedupeWarnings([...result.warnings, ...orchestrationWarnings]),
      // The adopted run's own typed termination, carried through unchanged.
      // It is never rebuilt from a warning and never merged across trials.
      termination: result.termination,
      generatedBuildListEntries,
      generatedBuildListEntryReplacements:
        result.plan === null ? [] : sortBuildListEntryReplacements(replacements),
    } satisfies PlannerOrchestrationResult
  }

  // --- the initial ordinary Planner run ---------------------------------
  // It uses the same shared Production path and the same shared budget, so the
  // first full Planner run already consumes `maxPlannerReruns`.
  // The caller's input is the ordinary persisted one, so the Build List
  // cardinality check applies (`docs/PLANNER_SPEC.md` 4.1); only a Candidate
  // trial below is a temporary augmented input (9.2.18).
  const initialRun = await runFullPlanner(input, { kind: 'persisted' })
  if (initialRun.status === 'rerun_budget_reached') {
    rerunBudgetWarning()
    // The budget refused a retry inside the very first Production Plan
    // generation. Its last completed full Planner run never passed Trace Replay, so
    // no Plan may be assembled from it; only its conflicts and warnings are
    // reported, with `plan: null`.
    const lastRun = readLastCompletedPlannerRun()
    return finish(
      {
        plan: null,
        conflicts: lastRun === null ? [] : structuredClone(lastRun.conflicts),
        warnings: lastRun === null ? [] : structuredClone(lastRun.warnings),
        // `maxPlannerReruns` is an orchestration bound, not a `PlannerOptions`
        // bound, so it is reported by its own warning above. When no full
        // Planner run ran at all, no `PlannerOptions` bound was touched either.
        termination:
          lastRun === null
            ? createUnsearchedPlannerTermination(
                plannerRunLimits(input.options),
                unsearchedPlanningTargetIds(input, dependencies),
              )
            : structuredClone(lastRun.termination),
      },
      [],
      [],
    )
  }
  if (initialRun.status === 'cancelled') {
    // The ordinary Planner already handled the cancellation and returned a
    // safe `plan: null` result. Starting constrained enumeration now would hand
    // the same `shouldCancel` to the Search Domain, which raises
    // `CandidateSearchError('cancelled')` instead. No new warning kind is
    // needed: this is the ordinary cancellation outcome, unchanged.
    return finish(initialRun.result, [], [])
  }
  let currentPlannerResult = initialRun.result
  // The adopted replacement set: the original input with every adopted
  // replacement applied (`O` removed, `G` in its place) and the resolutions
  // re-mapped onto it. It never accumulates `O`, `G1`, `G2` for one Target.
  let currentAugmentedInput = input
  const adoptedEntries: BuildListEntry[] = []
  const adoptedReplacements: BuildListEntryReplacement[] = []

  // --- the original fixed constraints, built exactly once ---------------
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') {
    return finish(currentPlannerResult, adoptedEntries, adoptedReplacements)
  }
  const originalContexts = createPlannerConflictContexts(prepared.context)
  const fixedPreparation = preparePlannerFixedConflictConstraints(
    prepared.context,
    originalContexts,
  )
  if (fixedPreparation.status !== 'ready') {
    // The fixed side is unknown, so nothing is guessed and no enumeration is
    // started (PLANNER_SPEC 9.2.7). The structured failures become warnings;
    // the caller never parses a message to learn this.
    fixedPreparation.failures.forEach((failure) => {
      orchestrationWarnings.push(fixedConstraintFailureWarning(failure))
    })
    return finish(currentPlannerResult, adoptedEntries, adoptedReplacements)
  }
  const fixedConstraints = fixedPreparation.constraints
  if (fixedConstraints.length === 0) {
    // No explicit `PlannerConflictResolution` means no fixed side, so B8
    // constrained re-search never runs automatically.
    return finish(currentPlannerResult, adoptedEntries, adoptedReplacements)
  }

  const origin = createPlannerStartSearchOrigin(input)
  const works = createPlannerConflictWorks(
    fixedConstraints,
    originalContexts,
    prepared.context.checkpointRequirements,
  )

  const trialsUsedByConflictId = new Map<string, number>()
  const trialStoppedConflictIds = new Set<string>()
  let rerunBudgetReached = false
  let generatedCapReached = false
  let cancelled = false

  for (const work of works) {
    if (rerunBudgetReached || generatedCapReached || cancelled) break
    if (trialStoppedConflictIds.has(work.originalConflictId)) continue
    if (work.blockedBySelectedCheckpoint) {
      // The user's selected checkpoint is a hard constraint on this Target's
      // current Route. Enumerating a replacement Route would only ever offer
      // one that drops it, so nothing is enumerated, materialized, or tried:
      // the conflict is returned as it is (PLANNER_SPEC 9.5.2).
      warn(
        'selected_checkpoint_blocks_constrained_search',
        `Planner constrained re-search skipped TargetWeapon '${work.targetWeaponId}' of conflict '${work.originalConflictId}': a BuildListEntry of that Target carries a selected compromise checkpoint, which an alternate Route would bypass. Change or clear the checkpoint in the Build List and run the Planner again.`,
      )
      continue
    }
    // Re-checked before every work item: one generated Candidate can settle
    // several conflicts at once (PLANNER_SPEC 9.2.10). An adoption that spent
    // the last affordable full Planner run is therefore a normal completion when it
    // leaves no unresolved work behind.
    if (
      isPlannerConflictWorkSatisfied(
        work,
        currentPlannerResult.plan?.selectedBuildListEntryIds ?? null,
        currentAugmentedInput.buildListEntries,
      )
    ) {
      continue
    }
    if (isRerunBudgetExhausted()) {
      // This work is genuinely unresolved and no full Planner run is left to judge
      // a Candidate for it, so nothing is enumerated, materialized or
      // preflighted: the bound is reported here instead. The loop ends right
      // away, so `rerunBudgetReached` - which only guards later iterations -
      // is not set again here.
      rerunBudgetWarning()
      break
    }

    const materializer = createConstrainedMaterializer({
      origin,
      targetWeaponId: work.targetWeaponId,
      bounds: enumerationBounds,
      clock: dependencies.clock,
    })
    let adoptedForWork = false
    let trialCapStop = false

    async function handleCandidate(
      candidate: Parameters<typeof materializer.materializeBuildListEntry>[0],
    ): Promise<CandidateOutcome> {
      const { entry, reusedExisting } = materializer.materializeBuildListEntry(
        candidate,
        currentAugmentedInput.buildListEntries,
      )
      // The current input already carries this exact semantic Entry, so a
      // rerun would repeat an identical input. The trial is spent, but no
      // duplicate Entry and no full Planner run follow.
      if (reusedExisting) return 'rejected'

      if (adoptedEntries.length >= orchestrationBounds.maxGeneratedBuildListEntries) {
        // A new Entry is needed while the adoption cap is already full, and
        // this work is still unsatisfied, so no rerun is worth starting.
        generatedCapReached = true
        warn(
          'max_generated_build_list_entries_reached',
          `Planner constrained re-search stopped: maxGeneratedBuildListEntries (${orchestrationBounds.maxGeneratedBuildListEntries}) adopted Entries were reached while TargetWeapon '${work.targetWeaponId}' of conflict '${work.originalConflictId}' was still unresolved.`,
        )
        return 'stop'
      }

      // The persisted Entry this trial's Entry replaces: the Target's one
      // Entry of the original input (PLANNER_SPEC 9.2.18). A work Target never
      // holds an adopted temporary Entry already - an adopted Entry keeps its
      // Target secured, so every later work on it is satisfied above - and a
      // second temporary Entry of one Target is never guessed into place.
      const resolved = resolveBuildListEntryReplacement(input.buildListEntries, entry)
      if (resolved.status !== 'ready') {
        throw new Error(
          `Planner constrained re-search invariant violated: ${resolved.detail}`,
        )
      }
      if (
        adoptedReplacements.some(
          ({ targetWeaponId }) => targetWeaponId === resolved.replacement.targetWeaponId,
        )
      ) {
        throw new Error(
          `Planner constrained re-search invariant violated: TargetWeapon '${resolved.replacement.targetWeaponId}' already holds an adopted temporary BuildListEntry.`,
        )
      }
      const trialReplacements = [...adoptedReplacements, resolved.replacement]
      // The augmented trial input keeps every replaced persisted Entry `O`
      // beside its temporary `G`, so the preflight can re-associate the user's
      // fixed constraints; the full Planner run then gets the replacement set.
      const trialInput: PlannerInput = {
        ...input,
        buildListEntries: [...input.buildListEntries, ...adoptedEntries, entry],
      }
      // Every explicit resolution is re-mapped here, before any full Planner run.
      const preflight = preparePlannerReplacementConflictPreflight(
        trialInput,
        trialReplacements,
        fixedConstraints,
        originalContexts,
        dependencies,
      )
      if (preflight.status !== 'ready') return 'rejected'

      const trialRun = await runFullPlanner(preflight.resolvedInput, {
        kind: 'temporary_replacement',
        replacements: trialReplacements,
      })
      if (trialRun.status === 'rerun_budget_reached') {
        rerunBudgetReached = true
        rerunBudgetWarning()
        return 'stop'
      }
      if (trialRun.status === 'cancelled') {
        // The ordinary Planner handled the cancellation. This trial is not
        // rejected in favour of the next Candidate: the whole orchestration
        // ends, so the enumerator is never asked to reach its next checkpoint.
        cancelled = true
        return 'stop'
      }
      const trialResult = trialRun.result
      if (trialResult.plan === null) return 'rejected'

      if (
        !isConstrainedTrialAdoptable(
          trialResult.plan.selectedBuildListEntryIds,
          entry.id,
          fixedConstraints,
          adoptedEntries.map(({ id }) => id),
        )
      ) {
        return 'rejected'
      }

      currentAugmentedInput = preflight.resolvedInput
      currentPlannerResult = trialResult
      adoptedEntries.push(entry)
      adoptedReplacements.push(resolved.replacement)
      return 'adopted'
    }

    const execution = await visitConstrainedCandidates(
      {
        origin,
        targetWeaponId: work.targetWeaponId,
        bounds: enumerationBounds,
      },
      dependencies.rngEngine,
      async (candidate) => {
        const used = trialsUsedByConflictId.get(work.originalConflictId) ?? 0
        // The trial budget belongs to the original conflict, not to the
        // Target, so several non-fixed Targets of one conflict share it.
        if (used >= orchestrationBounds.maxCandidateTrialsPerConflict) {
          // Only this delivery - the `limit + 1`-th - proves the enumeration
          // had more to offer. Stopping right after processing the limit-th
          // Candidate would report a truncation that did not happen.
          trialCapStop = true
          return 'stop'
        }
        trialsUsedByConflictId.set(work.originalConflictId, used + 1)
        const outcome = await handleCandidate(candidate)
        if (outcome === 'adopted') {
          adoptedForWork = true
          return 'stop'
        }
        if (outcome === 'stop') return 'stop'
        if (isRerunBudgetExhausted()) {
          // The rejected trial spent the last affordable full Planner run while this
          // work stayed unresolved, so the next Candidate is never requested,
          // delivered or materialized.
          rerunBudgetReached = true
          rerunBudgetWarning()
          return 'stop'
        }
        return 'continue'
      },
      {
        shouldCancel: executionOptions?.shouldCancel,
        yieldControl: executionOptions?.yieldControl,
      },
    )

    if (trialCapStop) {
      trialStoppedConflictIds.add(work.originalConflictId)
      warn(
        'max_candidate_trials_per_conflict_reached',
        `Planner constrained re-search stopped conflict '${work.originalConflictId}': maxCandidateTrialsPerConflict (${orchestrationBounds.maxCandidateTrialsPerConflict}) Candidates were processed.`,
      )
      continue
    }
    if (
      !adoptedForWork &&
      !execution.stoppedByConsumer &&
      execution.summary.stoppedByBound
    ) {
      // The enumeration ended because a bound truncated reachable work, not
      // because this orchestration stopped it. That is a stop, never silent
      // exhaustion (PLANNER_SPEC 9.2.16), and it ends only this work.
      warn(
        'constrained_enumeration_bound_reached',
        `Constrained enumeration for TargetWeapon '${work.targetWeaponId}' of conflict '${work.originalConflictId}' reached a ConstrainedEnumerationBounds limit before a usable Candidate was found.`,
      )
    }
  }

  return finish(currentPlannerResult, adoptedEntries, adoptedReplacements)
}
