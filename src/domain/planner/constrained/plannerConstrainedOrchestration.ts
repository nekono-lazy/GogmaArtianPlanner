import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeaponId,
} from '../../models/publicTypes'
import { visitConstrainedCandidates } from '../../search'
import type {
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
} from '../../search'
import {
  preparePlannerInitialContext,
} from '../plannerInitialContext'
import { createProductionPlanWithObserver } from '../productionPlanGeneration'
import { createUnsearchedPlannerTermination } from '../plannerTermination'
import type {
  PlannerBeamSearchResult,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
  PlannerWarning,
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import { preparePlannerAugmentedConflictPreflight } from './plannerAugmentedPreflight'
import {
  createPlannerConstrainedConflictContexts,
  plannerConflictResourceKey,
  preparePlannerFixedConflictConstraints,
  type PlannerConstrainedConflictContext,
  type PlannerFixedConflictConstraint,
  type PlannerFixedConstraintFailure,
} from './plannerConflictContext'
import { createConstrainedMaterializer } from './constrainedMaterializer'
import type { PlannerOrchestrationBounds } from './plannerOrchestrationBounds'
import {
  createPlannerFullBeamBudget,
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
 *   -> temporary generated Entry
 *   -> augmented conflict preflight B8-C3
 *   -> full Production Plan run     B8-C4a observed boundary
 *   -> adoption, or the next Candidate
 * ```
 *
 * It adds no conflict logic of its own. Coexistence is decided only by the full
 * Beam Search plus Trace Replay of `createProductionPlanWithObserver()` over an
 * augmented input, exactly as PLANNER_SPEC 9.2.11 requires. Nothing here writes
 * to persistence, touches a Worker, or reads React state: B8-D owns all of
 * that.
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
   * Only Entries adopted into the final augmented PlannerInput *and* selected
   * by the final Plan. It is empty whenever `plan === null`, and it never
   * contains a trial-rejected Entry or a reused existing Entry.
   */
  generatedBuildListEntries: BuildListEntry[]
}

/**
 * The constrained counterpart of `CreateProductionPlanCalculation`.
 *
 * The Planner Worker controller depends on this signature rather than on
 * `createProductionPlanWithConstrainedSearch()` itself, so the controller stays
 * pure message routing and reimplements none of the B8-C orchestration.
 *
 * `PlannerOrchestrationBounds` is an explicit parameter because it is
 * caller-required (PLANNER_SPEC 9.2.16). `ConstrainedEnumerationBounds` is
 * deliberately absent: the adapter that fulfils this signature chooses it - the
 * Production one passes `defaultConstrainedEnumerationBounds` explicitly.
 */
export type CreateConstrainedProductionPlanCalculation = (
  input: PlannerInput,
  orchestrationBounds: PlannerOrchestrationBounds,
  dependencies: PlannerDependencies,
  options?: PlannerExecutionOptions,
) => Promise<PlannerOrchestrationResult>

/** One Target that must be re-searched because of one fixed conflict choice. */
export interface PlannerConflictWork {
  /** The `PlanConflict.id` of the original input; a diagnostic and budget key. */
  originalConflictId: string
  constraint: PlannerFixedConflictConstraint
  targetWeaponId: TargetWeaponId
  /**
   * The participant BuildListEntry of this Target carries a selected
   * compromise checkpoint. No constrained Route replacement is attempted for
   * it: an alternate Route would drop that checkpoint, and the Planner never
   * drops, moves, or empties a selection (`docs/PLANNER_SPEC.md` 9.5.2). The
   * conflict stays a conflict until the Build List selection changes.
   */
  blockedBySelectedCheckpoint: boolean
  orderKey: string
}

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
 * The Planner-start Search / RNG snapshot (PLANNER_SPEC 9.2.1, 9.2.9).
 *
 * It is built once, from the *original* Planner input, and reused by every
 * enumeration. It is never rebuilt from an adopted Planner state, from a Beam
 * Search bestState, or from `conflictingCounter + 1`, and it needs no
 * historical UI Candidate Search request: it carries no `searchRunId`,
 * `routeFilter`, or `settings`.
 */
export function createConstrainedSearchOriginFromPlannerInput(
  input: PlannerInput,
): ConstrainedSearchOrigin {
  return {
    rngState: structuredClone(input.rngState),
    normalCounters: structuredClone(input.normalCounters),
    ownedWeapons: structuredClone(input.ownedWeapons),
    targetWeapons: structuredClone(input.targetWeapons),
    master: structuredClone(input.master),
    calculationContext: structuredClone(input.calculationContext),
  }
}

/**
 * The Targets a constrained re-search may work on, one per
 * `(fixed constraint, non-fixed participant Target)` pair.
 *
 * The fixed side never yields: a participant carrying the fixed BuildListEntry
 * ID, and any participant of the fixed Target itself, is excluded. One Target
 * participating through several Route units or several Entries produces one
 * work item. The order is a stable semantic key, so the caller's array order,
 * the participant order, and Map insertion order cannot change the outcome.
 */
export function createPlannerConflictWorks(
  constraints: readonly PlannerFixedConflictConstraint[],
  conflictContexts: readonly PlannerConstrainedConflictContext[],
): PlannerConflictWork[] {
  const contextById = new Map(
    conflictContexts.map((context) => [context.conflictId, context]),
  )
  const works: PlannerConflictWork[] = []
  const seen = new Set<string>()
  constraints.forEach((constraint) => {
    const context = contextById.get(constraint.originalConflictId)
    if (context === undefined) return
    context.participants.forEach((participant) => {
      if (participant.buildListEntryId === constraint.fixedBuildListEntryId) return
      if (participant.targetWeaponId === constraint.fixedTargetWeaponId) return
      const dedupeKey = `${constraint.originalConflictId}\u0000${participant.targetWeaponId}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      works.push({
        originalConflictId: constraint.originalConflictId,
        constraint,
        targetWeaponId: participant.targetWeaponId,
        // Any participant Entry of this Target with a selection blocks the
        // whole Target: its Route may not be replaced behind the user's back.
        blockedBySelectedCheckpoint: context.participants.some(
          (other) =>
            other.targetWeaponId === participant.targetWeaponId &&
            other.hasSelectedCheckpoints,
        ),
        orderKey: [
          plannerConflictResourceKey(constraint.resourceIdentity),
          constraint.fixedBuildListEntryId,
          participant.targetWeaponId,
          constraint.originalConflictId,
        ].join('\u0000'),
      })
    })
  })
  return works.sort((left, right) =>
    compareStableStrings(left.orderKey, right.orderKey),
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
 * Beam Search already returns a safe `PlannerResult` with `plan: null`. It is
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
 * orchestration bound, conflict resolution, or Beam state crosses that
 * boundary.
 */
export async function createProductionPlanWithConstrainedSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options: PlannerConstrainedOrchestrationOptions,
): Promise<PlannerOrchestrationResult> {
  const { enumerationBounds, orchestrationBounds, executionOptions } = options
  // One shared budget for every full Beam Search this orchestration starts:
  // the initial ordinary one, every Candidate trial, and every
  // runtime-unsupported retry inside Production Plan generation.
  const budget = createPlannerFullBeamBudget(orchestrationBounds)
  const orchestrationWarnings: PlannerWarning[] = []
  // Scoped to one `runFullPlanner()` call and reset at its start, so a later
  // run can never read a previous run's Beam Search result.
  let lastCompletedBeam: PlannerBeamSearchResult | null = null
  const observer: ProductionPlanGenerationObserver = {
    beforeBeamSearch: () => budget.beforeBeamSearch(),
    afterBeamSearch: (beamResult) => {
      lastCompletedBeam = beamResult
    },
  }
  /**
   * Read through a declared return type: the assignment above happens inside a
   * callback, so a direct read would be narrowed to the initial `null`.
   */
  const readLastCompletedBeam = (): PlannerBeamSearchResult | null =>
    lastCompletedBeam

  /**
   * Whether every affordable full Beam Search has already been started.
   *
   * Checked before any further orchestration work, because reaching
   * `maxPlannerReruns` must stop enumeration, materialization and preflight
   * too - not merely fail the next `beforeBeamSearch()` (PLANNER_SPEC 9.2.16).
   */
  const isRerunBudgetExhausted = (): boolean => budget.used >= budget.limit

  function warn(kind: PlannerWarning['kind'], message: string): void {
    orchestrationWarnings.push({ kind, message })
  }

  function rerunBudgetWarning(): void {
    warn(
      'max_planner_reruns_reached',
      `Planner constrained re-search stopped: maxPlannerReruns (${budget.limit}) full Beam Search executions were used.`,
    )
  }

  async function runFullPlanner(planInput: PlannerInput): Promise<FullPlannerRun> {
    lastCompletedBeam = null
    try {
      const result = await createProductionPlanWithObserver(
        planInput,
        dependencies,
        executionOptions,
        observer,
      )
      // This run's own last Beam Search, never a previous run's.
      return readLastCompletedBeam()?.cancelled === true
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

  function finish(result: PlannerResult, adopted: readonly BuildListEntry[]) {
    // A Plan is the only thing that can carry a generated Entry, so a null Plan
    // returns none of them (PLANNER_SPEC 9.2.14).
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
    } satisfies PlannerOrchestrationResult
  }

  // --- the initial ordinary Planner run ---------------------------------
  // It uses the same shared Production path and the same shared budget, so the
  // first full Beam Search already consumes `maxPlannerReruns`.
  const initialRun = await runFullPlanner(input)
  if (initialRun.status === 'rerun_budget_reached') {
    rerunBudgetWarning()
    // The budget refused a retry inside the very first Production Plan
    // generation. Its last completed Beam Search never passed Trace Replay, so
    // no Plan may be assembled from it; only its conflicts and warnings are
    // reported, with `plan: null`.
    const beam = readLastCompletedBeam()
    return finish(
      {
        plan: null,
        conflicts: beam === null ? [] : structuredClone(beam.conflicts),
        warnings: beam === null ? [] : structuredClone(beam.warnings),
        // `maxPlannerReruns` is an orchestration bound, not a `PlannerOptions`
        // bound, so it is reported by its own warning above. When no Beam
        // Search ran at all, no `PlannerOptions` bound was touched either.
        termination:
          beam === null
            ? createUnsearchedPlannerTermination(
                input.options,
                input.targetWeapons,
              )
            : structuredClone(beam.termination),
      },
      [],
    )
  }
  if (initialRun.status === 'cancelled') {
    // The ordinary Planner already handled the cancellation and returned a
    // safe `plan: null` result. Starting constrained enumeration now would hand
    // the same `shouldCancel` to the Search Domain, which raises
    // `CandidateSearchError('cancelled')` instead. No new warning kind is
    // needed: this is the ordinary cancellation outcome, unchanged.
    return finish(initialRun.result, [])
  }
  let currentPlannerResult = initialRun.result
  let currentAugmentedInput = input
  const adoptedEntries: BuildListEntry[] = []

  // --- the original fixed constraints, built exactly once ---------------
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') {
    return finish(currentPlannerResult, adoptedEntries)
  }
  const originalContexts = createPlannerConstrainedConflictContexts(prepared.context)
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
    return finish(currentPlannerResult, adoptedEntries)
  }
  const fixedConstraints = fixedPreparation.constraints
  if (fixedConstraints.length === 0) {
    // No explicit `PlannerConflictResolution` means no fixed side, so B8
    // constrained re-search never runs automatically.
    return finish(currentPlannerResult, adoptedEntries)
  }

  const origin = createConstrainedSearchOriginFromPlannerInput(input)
  const works = createPlannerConflictWorks(fixedConstraints, originalContexts)

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
        `Planner constrained re-search skipped TargetWeapon '${work.targetWeaponId}' of conflict '${work.originalConflictId}': its BuildListEntry carries a selected compromise checkpoint, which an alternate Route would drop. Change or clear the checkpoint in the Build List and run the Planner again.`,
      )
      continue
    }
    // Re-checked before every work item: one generated Candidate can settle
    // several conflicts at once (PLANNER_SPEC 9.2.10). An adoption that spent
    // the last affordable Beam Search is therefore a normal completion when it
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
      // This work is genuinely unresolved and no Beam Search is left to judge
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
      // duplicate Entry and no Beam Search follow.
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

      const trialInput: PlannerInput = {
        ...currentAugmentedInput,
        buildListEntries: [...currentAugmentedInput.buildListEntries, entry],
      }
      // Every explicit resolution is re-mapped here, before any Beam Search.
      const preflight = preparePlannerAugmentedConflictPreflight(
        trialInput,
        fixedConstraints,
        dependencies,
      )
      if (preflight.status !== 'ready') return 'rejected'

      const trialRun = await runFullPlanner(preflight.resolvedInput)
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
          // The rejected trial spent the last affordable Beam Search while this
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

  return finish(currentPlannerResult, adoptedEntries)
}
