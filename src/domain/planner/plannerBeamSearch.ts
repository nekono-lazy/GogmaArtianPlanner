import type {
  BuildListEntry,
  BuildListEntryId,
  DomainValidationIssue,
  PlanConflict,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import {
  conflictResolutionRefusalReason,
  detectPlannerConflicts,
  isUnitBlockedByConflictResolution,
} from './plannerConflictDetection'
import type { PlannerRouteUnit } from './plannerRouteProgress'
import {
  comparePlannerSearchStates,
  createPlannerSearchStateSemanticKey,
  evaluatePlannerSearchState,
} from './plannerScoring'
import {
  entryIsRelevantForState,
  isPlannerSearchStateComplete,
  isPlannerTargetComplete,
} from './plannerEntryRelevance'
import type { PlannerCheckpointRequirements } from './plannerCheckpoints'
import {
  initialPlannerLaneProgress,
  isPlannerLaneRouteComplete,
  nextPlannerLaneUnits,
  remainingPlannerLaneUnits,
  type PlannerEntryLanes,
} from './plannerRouteLanes'
import { collectPreferredSourceEntryIds } from './plannerPreferredSource'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { createPlannerSearchMetricsCollector } from './plannerSearchInstrumentation'
import {
  createPlannerSearchTermination,
  createUnsearchedPlannerTermination,
} from './plannerTermination'
import {
  applyPlannerReserveAction,
  applyPlannerRouteAction,
  createPlannerSearchRejection,
  executablePlannerRequiredUnitsByCounterPosition,
  isSkippablePlannerUnitDominatedByRequiredUnit,
  type PlannerAppliedActionResult,
  type PlannerReserveActionContext,
  type PlannerRouteActionContext,
} from './plannerStateTransitions'
import type {
  ExcludedBuildListEntry,
  PlannerBeamSearchResult,
  PlannerDependencies,
  PlannerRunBuildListContext,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerSearchRejection,
  PlannerSearchState,
  PlannerWarning,
  PlannerConflictResolution,
} from './plannerTypes'
import { PERSISTED_PLANNER_BUILD_LIST_CONTEXT } from './plannerTypes'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function rejectionKey(value: PlannerSearchRejection): string {
  return stableStringify(value)
}

function appendUniqueRejection(
  rejections: PlannerSearchRejection[],
  rejectionKeys: Set<string>,
  value: PlannerSearchRejection,
) {
  const key = rejectionKey(value)
  if (rejectionKeys.has(key)) return
  rejectionKeys.add(key)
  rejections.push(value)
}

function targetCanUseEntry(
  state: PlannerSearchState,
  entry: BuildListEntry,
  requirements: PlannerCheckpointRequirements,
): boolean {
  return entryIsRelevantForState(state, entry, requirements)
}

/**
 * The Entries whose internal reserve must be applied before any other action
 * (`docs/PLANNER_SPEC.md` 16.3).
 *
 * The execution projection completes a Target on the Entry's last physical
 * Step, so the search secures a Candidate right after that unit, with nothing
 * but other such reserves in between: these are the Entries the most recent
 * physical action progressed, provided only reserves followed it, whose Route
 * is now complete and whose Target can still use them. An Entry that misses
 * this moment is never reserved later.
 */
function pendingReserveEntries(
  state: PlannerSearchState,
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>,
  lanePlans: ReadonlyMap<BuildListEntryId, PlannerEntryLanes>,
  requirements: PlannerCheckpointRequirements,
): BuildListEntry[] {
  let index = state.trace.length - 1
  while (index >= 0 && state.trace[index].kind === 'reserve_candidate') index -= 1
  const physical = index >= 0 ? state.trace[index] : undefined
  if (physical?.kind !== 'route_operation') return []
  return [...physical.progressedBuildListEntryIds]
    .sort(compareStableStrings)
    .flatMap((entryId) => {
      const entry = entriesById.get(entryId)
      const lanes = lanePlans.get(entryId)
      if (!entry || !lanes) return []
      if (state.selectedBuildListEntryIds.includes(entryId)) return []
      const progress = state.routeProgressByEntryId[entryId] ?? initialPlannerLaneProgress()
      if (!isPlannerLaneRouteComplete(lanes, progress)) return []
      return targetCanUseEntry(state, entry, requirements) ? [entry] : []
    })
}

function betterState(
  current: PlannerSearchState | null,
  candidate: PlannerSearchState,
): PlannerSearchState {
  if (current === null) return candidate
  return comparePlannerSearchStates(candidate, current) < 0
    ? candidate
    : current
}

function addWarning(
  warnings: PlannerWarning[],
  kind: PlannerWarning['kind'],
  message: string,
) {
  if (warnings.some((warning) => warning.kind === kind && warning.message === message)) {
    return
  }
  warnings.push({ kind, message })
}

function detectCurrentPlannerConflicts(
  state: PlannerSearchState,
  allSearchEntries: readonly BuildListEntry[],
  allLanePlans: ReadonlyMap<BuildListEntryId, PlannerEntryLanes>,
  targets: readonly TargetWeapon[],
  resolutions: readonly PlannerConflictResolution[],
  requirements: PlannerCheckpointRequirements,
) {
  const entries = allSearchEntries.filter((entry) =>
    entryIsRelevantForState(state, entry, requirements),
  )
  const unitPlans = new Map(
    entries.flatMap((entry) => {
      const lanes = allLanePlans.get(entry.id)
      if (!lanes) return []
      const progress = state.routeProgressByEntryId[entry.id] ?? initialPlannerLaneProgress()
      return [[entry.id, remainingPlannerLaneUnits(lanes, progress)] as const]
    }),
  )
  return detectPlannerConflicts(entries, unitPlans, targets, resolutions, false)
}

function conflictCountByEntryId(
  conflicts: readonly PlanConflict[],
): Map<BuildListEntryId, number> {
  const counts = new Map<BuildListEntryId, number>()
  conflicts.forEach((conflict) => {
    conflict.buildListEntryIds.forEach((entryId) => {
      counts.set(entryId, (counts.get(entryId) ?? 0) + 1)
    })
  })
  return counts
}

function conflictResolutionWarnings(
  resolutions: readonly PlannerConflictResolution[],
  conflictsById: ReadonlyMap<string, PlanConflict>,
): PlannerWarning[] {
  return resolutions.flatMap((resolution) => {
    // The same refusal authority the detection applied, so a resolution that
    // targets a selected-checkpoint conflict is reported here too.
    const reason = conflictResolutionRefusalReason(
      resolution,
      conflictsById.get(resolution.conflictKey),
    )
    return reason === null
      ? []
      : [{ kind: 'invalid_conflict_resolution' as const, message: reason }]
  })
}

function initialFailureResult(
  input: PlannerInput,
  warnings: PlannerWarning[],
  issues: DomainValidationIssue[],
  excludedBuildListEntries: ExcludedBuildListEntry[],
  planningTargetIds: readonly TargetWeaponId[],
): PlannerBeamSearchResult {
  return {
    bestState: null,
    conflicts: [],
    warnings,
    validationIssues: issues,
    excludedBuildListEntries,
    rejections: [],
    expandedStates: 0,
    completed: false,
    cancelled: false,
    // No expansion ran, so no `PlannerOptions` bound was touched. The reason
    // the input was rejected is reported by its own validation warnings.
    termination: createUnsearchedPlannerTermination(
      input.options,
      planningTargetIds,
    ),
  }
}

export async function runPlannerBeamSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  executionOptions: PlannerExecutionOptions = {},
  buildListContext: PlannerRunBuildListContext = PERSISTED_PLANNER_BUILD_LIST_CONTEXT,
): Promise<PlannerBeamSearchResult> {
  const prepared = preparePlannerInitialContext(input, dependencies, buildListContext)
  if (prepared.status === 'invalid') {
    const failure = initialFailureResult(
      input,
      prepared.warnings,
      prepared.issues,
      prepared.excludedBuildListEntries,
      prepared.planningTargetIds,
    )
    createPlannerSearchMetricsCollector(executionOptions.searchInstrumentation, () => ({
      entries: [],
      unitCountsByEntryId: new Map(),
      planningTargetCount: prepared.planningTargetIds.length,
      options: input.options,
      countCompletedTargets: () => 0,
    }))?.finish({
      reachedBeamSearch: false,
      expandedStates: 0,
      terminationStatus: failure.termination.status,
      completedTargetCount: failure.termination.completedTargetCount,
      conflicts: [],
    })
    return failure
  }
  const {
    allSearchEntries,
    allLanePlans,
    entriesById,
    excludedBuildListEntries,
    initialConflictDetection,
    initialState: preparedInitialState,
    routeUnitCountByEntryId,
    planningTargets,
    planningTargetIds,
    planningTargetsById,
    validConflictResolutions,
    warnings,
    checkpointRequirements,
  } = prepared.context
  // Completion is one authority: every planning Target (a Target with a valid
  // BuildListEntry, never every active Target) Ideal *and* every required
  // checkpoint Entry secured (PLANNER_SPEC 7.2.1 / 7.5.6).
  const isComplete = (state: PlannerSearchState) =>
    isPlannerSearchStateComplete(state, planningTargetIds, checkpointRequirements)
  // Issue #103 measurement only: `null` unless the caller supplied an
  // instrumentation, and every hook below is then a no-op optional call. The
  // collector reads states the search already built and decides nothing.
  const metrics = createPlannerSearchMetricsCollector(executionOptions.searchInstrumentation, () => ({
    entries: allSearchEntries,
    unitCountsByEntryId: new Map(
      [...allLanePlans].map(([entryId, lanes]) => [
        entryId,
        {
          base: lanes.base.length,
          bonus: lanes.bonus.length,
          skill: lanes.skill.length,
        },
      ]),
    ),
    planningTargetCount: planningTargetIds.length,
    options: input.options,
    countCompletedTargets: (state) =>
      planningTargetIds.filter((targetId) =>
        isPlannerTargetComplete(state, targetId, checkpointRequirements),
      ).length,
  }))
  if (planningTargetIds.length === 0) {
    // No valid BuildListEntry, so this run has no goal: the Build List is the
    // Planner input (REQUIREMENTS 18 / 19), and no active Target outside it is
    // ever substituted. Nothing can be expanded, so no Beam Search starts. The
    // validation already reported `no_build_list_entries` and each excluded
    // Entry; the termination is an ordinary `exhausted` over zero Targets.
    metrics?.finish({
      reachedBeamSearch: false,
      expandedStates: 0,
      terminationStatus: 'exhausted',
      completedTargetCount: 0,
      conflicts: [],
    })
    return {
      bestState: preparedInitialState,
      conflicts: [],
      warnings,
      validationIssues: [],
      excludedBuildListEntries,
      rejections: [...prepared.context.routePlanRejections],
      expandedStates: 0,
      completed: false,
      cancelled: false,
      termination: createPlannerSearchTermination({
        options: input.options,
        planningTargetIds,
        checkpointRequirements,
        bestState: preparedInitialState,
        expandedStates: 0,
        cancelled: false,
        reachedStepLimit: false,
        reachedExpandedLimit: false,
      }),
    }
  }
  const rejections = [...prepared.context.routePlanRejections]
  const rejectionKeys = new Set(rejections.map(rejectionKey))
  // Static Planner input, so it is derived once instead of per expansion.
  const preferredSourceEntryIds = collectPreferredSourceEntryIds(
    allSearchEntries,
    planningTargetsById,
  )
  // Every Beam successor is built on a clone of its source state; the shared
  // transition authority never decides which actions are tried.
  const reserveActionContext: PlannerReserveActionContext = {
    dependencies,
    targets: planningTargets,
    master: input.master,
    preferredSourceEntryIds,
    requirements: checkpointRequirements,
  }
  const scoreContext = {
    entries: allSearchEntries,
    targetsById: planningTargetsById,
    routeUnitCountByEntryId,
    conflictCountByEntryId: new Map<BuildListEntryId, number>(),
    checkpointRequirements,
  }
  const discoveredConflictsById = new Map<string, PlanConflict>()
  const recordDetectedConflicts = (
    detection: ReturnType<typeof detectPlannerConflicts>,
  ) => {
    detection.conflicts.forEach((conflict) => {
      if (!discoveredConflictsById.has(conflict.id)) {
        discoveredConflictsById.set(conflict.id, conflict)
      }
    })
  }
  recordDetectedConflicts(initialConflictDetection)
  // A zero-operation Candidate whose owned Gogma already satisfies its active
  // Target is confirmed, not silently dropped as already satisfied: it becomes
  // one `confirm_owned_ideal` Step that advances no Counter and completes the
  // Target (`docs/PLANNER_SPEC.md` 16.3). It changes no RNG state, so it is
  // applied before any expansion, one Entry per Target in stable ID order.
  let initialState = preparedInitialState
  const confirmedZeroOperationTargetIds = new Set<TargetWeaponId>()
  for (const entry of allSearchEntries) {
    const lanes = allLanePlans.get(entry.id)
    if (
      lanes === undefined ||
      lanes.unitCount !== 0 ||
      entry.candidateSnapshot.route.kind !== 'existing_gogma_current'
    ) continue
    const required = checkpointRequirements.requiredEntryIdByTargetId.get(entry.targetWeaponId)
    if (required !== undefined && required !== entry.id) continue
    const target = planningTargetsById.get(entry.targetWeaponId)
    if (!target || confirmedZeroOperationTargetIds.has(target.id)) continue
    if (initialState.targetSatisfaction[target.id]?.hasIdeal !== true) continue
    const confirmed = applyPlannerReserveAction(
      initialState,
      entry,
      target,
      reserveActionContext,
      { mode: 'clone', zeroOperationConfirm: true },
    )
    if (confirmed.rejection) {
      appendUniqueRejection(rejections, rejectionKeys, confirmed.rejection)
    }
    if (confirmed.state) {
      initialState = confirmed.state
      confirmedZeroOperationTargetIds.add(target.id)
    }
  }
  initialState.evaluationScore = evaluatePlannerSearchState(
    initialState,
    {
      ...scoreContext,
      conflictCountByEntryId: conflictCountByEntryId(
        initialConflictDetection.conflicts,
      ),
    },
  )
  if (isComplete(initialState)) {
    conflictResolutionWarnings(
      validConflictResolutions,
      discoveredConflictsById,
    ).forEach(({ kind, message }) => addWarning(warnings, kind, message))
    metrics?.finish({
      reachedBeamSearch: false,
      expandedStates: 0,
      terminationStatus: 'completed',
      completedTargetCount: planningTargetIds.length,
      conflicts: [...discoveredConflictsById.values()],
    })
    return {
      bestState: initialState,
      conflicts: [...discoveredConflictsById.values()].sort((left, right) =>
        compareStableStrings(left.id, right.id),
      ),
      warnings,
      validationIssues: [],
      excludedBuildListEntries,
      rejections,
      expandedStates: 0,
      completed: true,
      cancelled: false,
      termination: createPlannerSearchTermination({
        options: input.options,
        planningTargetIds,
        checkpointRequirements,
        bestState: initialState,
        expandedStates: 0,
        cancelled: false,
        reachedStepLimit: false,
        reachedExpandedLimit: false,
      }),
    }
  }

  let beam: PlannerSearchState[] = [initialState]
  let bestPartial: PlannerSearchState | null = initialState
  let bestComplete: PlannerSearchState | null = null
  let expandedStates = 0
  let reachedExpandedLimit = false
  let reachedStepLimit = false
  let cancelled = false
  let stop = false

  while (beam.length > 0 && !stop) {
    const successors: PlannerSearchState[] = []
    metrics?.beginDepth(beam.length)
    for (const state of beam.sort(comparePlannerSearchStates)) {
      if (executionOptions.shouldCancel?.()) {
        cancelled = true
        stop = true
        break
      }
      metrics?.visitBeamState()
      if (isComplete(state)) {
        metrics?.completeBeamState()
        bestComplete = betterState(bestComplete, state)
        continue
      }
      if (state.trace.length >= input.options.maxPlanSteps) {
        metrics?.stepLimitBeamState()
        reachedStepLimit = true
        continue
      }
      const setupStartedAt = metrics?.mark()
      const stateConflictDetection = detectCurrentPlannerConflicts(
        state,
        allSearchEntries,
        allLanePlans,
        planningTargets,
        validConflictResolutions,
        checkpointRequirements,
      )
      recordDetectedConflicts(stateConflictDetection)
      metrics?.expandBeamState(stateConflictDetection.conflicts)
      const conflictsById = new Map(
        stateConflictDetection.conflicts.map((conflict) => [conflict.id, conflict]),
      )
      const routeActionContext: PlannerRouteActionContext = {
        entriesById,
        lanePlans: allLanePlans,
        conflictsById,
        conflictIdsByUnitKey: stateConflictDetection.conflictIdsByUnitKey,
        selectedPhysicalActionKeysByConflictId:
          stateConflictDetection.selectedPhysicalActionKeysByConflictId,
        targets: planningTargets,
        master: input.master,
        engine: dependencies.rngEngine,
        preferredSourceEntryIds,
        requirements: checkpointRequirements,
      }
      const isBlockedByConflictResolution = (unit: PlannerRouteUnit) =>
        isUnitBlockedByConflictResolution(
          unit,
          conflictsById,
          stateConflictDetection.conflictIdsByUnitKey,
          stateConflictDetection.selectedPhysicalActionKeysByConflictId,
          (entryId) => {
            const selected = entriesById.get(entryId)
            return (
              selected !== undefined &&
              entryIsRelevantForState(state, selected, checkpointRequirements)
            )
          },
        )
      const requiredUnitsByCounterPosition =
        executablePlannerRequiredUnitsByCounterPosition(
          state,
          allSearchEntries,
          allLanePlans,
          isBlockedByConflictResolution,
          checkpointRequirements,
        )
      // A just-finished Route can be secured only now, before any other action
      // (docs/PLANNER_SPEC.md 16.3). Not securing it is a branch of its own: the
      // ordinary successors below leave that Entry unsecured for good, which is
      // how a shared physical action serves another Entry that keeps operating
      // on the same weapon.
      const pendingReserveAttempts = pendingReserveEntries(
        state,
        entriesById,
        allLanePlans,
        checkpointRequirements,
      ).flatMap((entry) => {
        const target = planningTargetsById.get(entry.targetWeaponId)
        if (target) metrics?.reserveAttempt(entry.id)
        return target
          ? [{
              entry,
              applied: applyPlannerReserveAction(
                state,
                entry,
                target,
                reserveActionContext,
                { mode: 'clone' },
              ),
            }]
          : []
      })
      metrics?.addPhaseTime('beamStateSetup', setupStartedAt)
      const expansionSources: { entry: BuildListEntry; reserveAttempt: PlannerAppliedActionResult | null }[] = [
        ...pendingReserveAttempts.map(({ entry, applied }) => ({ entry, reserveAttempt: applied })),
        ...allSearchEntries.map((entry) => ({ entry, reserveAttempt: null })),
      ]
      for (const { entry, reserveAttempt } of expansionSources) {
        const attempts: PlannerAppliedActionResult[] = []
        const lanes = allLanePlans.get(entry.id)
        const progress = state.routeProgressByEntryId[entry.id] ?? initialPlannerLaneProgress()
        if (reserveAttempt !== null) {
          attempts.push(reserveAttempt)
        } else if (
          state.selectedBuildListEntryIds.includes(entry.id) ||
          !lanes ||
          !targetCanUseEntry(state, entry, checkpointRequirements)
        ) {
          continue
        } else if (!isPlannerLaneRouteComplete(lanes, progress)) {
          // After the base prefix, the Bonus lane and the Skill lane are both
          // candidates: the Planner, not the Route, decides their interleaving
          // (docs/PLANNER_SPEC.md 7.0.4), subject to the checkpoint pin. Every
          // lane that can run here becomes a successor, so a Skill-first and a
          // Bonus-first branch both survive; the improvement preference is a
          // soft ranking term of the comparator (7.6), never a branch filter.
          for (const unit of nextPlannerLaneUnits(lanes, progress)) {
            if (isBlockedByConflictResolution(unit)) {
              metrics?.conflictBlockedUnit()
              appendUniqueRejection(
                rejections,
                rejectionKeys,
                createPlannerSearchRejection(
                  entry.id,
                  unit.operation.type,
                  'conflict_resolution_not_selected',
                  'A valid local conflict resolution selected another BuildListEntry.',
                ),
              )
              continue
            }
            // Execution eligibility, not a conflict and not a score: another
            // Entry must physically run at this Counter position, and this unit
            // can fast-forward once it has (docs/PLANNER_SPEC.md 7.0.2). Running
            // this one first would only push the Counter past a required unit,
            // so the branch is never generated and no rejection is recorded.
            if (
              isSkippablePlannerUnitDominatedByRequiredUnit(
                unit,
                requiredUnitsByCounterPosition,
              )
            ) {
              metrics?.prunedDominatedSkippableUnit()
              continue
            }
            metrics?.routeAttempt(unit)
            const applyStartedAt = metrics?.mark()
            attempts.push(applyPlannerRouteAction(
              state,
              unit,
              routeActionContext,
              { mode: 'clone' },
            ))
            metrics?.addPhaseTime('applyAction', applyStartedAt)
          }
        } else if (lanes.unitCount === 0) {
          // A Route with physical units is secured only right after its last
          // unit (pendingReserveEntries); only a Route without any unit reaches
          // its reserve here.
          const target = planningTargetsById.get(entry.targetWeaponId)
          if (!target) continue
          metrics?.reserveAttempt(entry.id)
          attempts.push(applyPlannerReserveAction(
            state,
            entry,
            target,
            reserveActionContext,
            { mode: 'clone' },
          ))
        }
        for (const applied of attempts) {
          if (applied.rejection) {
            metrics?.rejectedAttempt(applied.rejection)
            appendUniqueRejection(
              rejections,
              rejectionKeys,
              applied.rejection,
            )
            continue
          }
          if (applied.state === null) continue
          if (expandedStates >= input.options.maxExpandedStates) {
            reachedExpandedLimit = true
            stop = true
            break
          }
          const evaluationStartedAt = metrics?.mark()
          const successorConflictDetection = detectCurrentPlannerConflicts(
            applied.state,
            allSearchEntries,
            allLanePlans,
            planningTargets,
            validConflictResolutions,
            checkpointRequirements,
          )
          recordDetectedConflicts(successorConflictDetection)
          applied.state.evaluationScore = evaluatePlannerSearchState(applied.state, {
            ...scoreContext,
            conflictCountByEntryId: conflictCountByEntryId(
              successorConflictDetection.conflicts,
            ),
          })
          metrics?.addPhaseTime('successorEvaluation', evaluationStartedAt)
          if (applied.state.trace.length >= input.options.maxPlanSteps) {
            reachedStepLimit = true
          }
          successors.push(applied.state)
          expandedStates += 1
          metrics?.successor(state, applied.state)
          executionOptions.onProgress?.({
            expandedStates,
            maxExpandedStates: input.options.maxExpandedStates,
          })
          bestPartial = betterState(bestPartial, applied.state)
          if (isComplete(applied.state)) {
            bestComplete = betterState(bestComplete, applied.state)
          }
          if (expandedStates >= input.options.maxExpandedStates) {
            reachedExpandedLimit = true
            stop = true
            break
          }
          if (executionOptions.shouldCancel?.()) {
            cancelled = true
            stop = true
            break
          }
        }
        if (stop) break
      }
      if (stop) break
    }
    const dedupStartedAt = metrics?.mark()
    const deduplicated = new Map<string, PlannerSearchState>()
    successors.forEach((state) => {
      const key = createPlannerSearchStateSemanticKey(state)
      const current = deduplicated.get(key)
      if (!current || comparePlannerSearchStates(state, current) < 0) {
        deduplicated.set(key, state)
      }
    })
    const ranked = [...deduplicated.values()].sort(comparePlannerSearchStates)
    beam = ranked.slice(0, input.options.beamWidth)
    metrics?.addPhaseTime('dedupAndTrim', dedupStartedAt)
    // Read after the trim, over the same ranked array the trim sliced.
    metrics?.endDepth({
      successorsBeforeDedup: successors,
      deduplicated: ranked,
      keptBeam: beam,
      stoppedBy: !stop
        ? null
        : cancelled
          ? 'cancelled'
          : reachedExpandedLimit
            ? 'max_expanded_states'
            : null,
      cumulativeExpandedStates: expandedStates,
    })
    if (beam.length === 0) break
    await executionOptions.yieldControl?.()
    if (executionOptions.shouldCancel?.()) {
      cancelled = true
      break
    }
  }

  if (reachedStepLimit) {
    addWarning(
      warnings,
      'max_steps_reached',
      `Planner reached maxPlanSteps (${input.options.maxPlanSteps}).`,
    )
  }
  if (reachedExpandedLimit) {
    addWarning(
      warnings,
      'max_expanded_states_reached',
      `Planner reached maxExpandedStates (${input.options.maxExpandedStates}).`,
    )
  }
  if (
    rejections.some(({ reason }) => reason === 'protected_destructive_use')
  ) {
    addWarning(
      warnings,
      'protected_weapon_required',
      'One or more destructive branches require a protected weapon and were not generated.',
    )
  }
  const bestState = bestComplete ?? bestPartial
  conflictResolutionWarnings(
    validConflictResolutions,
    discoveredConflictsById,
  ).forEach(({ kind, message }) => addWarning(warnings, kind, message))
  const termination = createPlannerSearchTermination({
    options: input.options,
    planningTargetIds,
    checkpointRequirements,
    bestState,
    expandedStates,
    cancelled,
    reachedStepLimit,
    reachedExpandedLimit,
  })
  metrics?.finish({
    reachedBeamSearch: true,
    expandedStates,
    terminationStatus: termination.status,
    completedTargetCount: termination.completedTargetCount,
    conflicts: [...discoveredConflictsById.values()],
  })
  return {
    bestState,
    conflicts: [...discoveredConflictsById.values()].sort((left, right) =>
      compareStableStrings(left.id, right.id),
    ),
    warnings,
    validationIssues: [],
    excludedBuildListEntries,
    rejections: rejections.sort((left, right) =>
      compareStableStrings(rejectionKey(left), rejectionKey(right)),
    ),
    expandedStates,
    completed: bestState !== null && isComplete(bestState),
    cancelled,
    termination,
  }
}
