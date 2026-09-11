import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import type {
  CandidateScore,
  PlannerSearchState,
} from './plannerTypes'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function scoreCandidate(
  state: PlannerSearchState,
  target: TargetWeapon,
  entry: BuildListEntry,
  conflictCount = 0,
): CandidateScore {
  const satisfaction = state.targetSatisfaction[target.id] ?? {
    hasPractical: false,
    hasIdeal: false,
  }
  const candidate = entry.candidateSnapshot
  const targetPriorityScore = target.priority * 10_000
  const satisfactionScore = !satisfaction.hasPractical
    ? 50_000
    : candidate.category === 'ideal' && !satisfaction.hasIdeal
      ? 20_000
      : 0
  const categoryScore = candidate.category === 'ideal' ? 20_000 : 10_000
  const distancePenalty = candidate.estimatedOperationCount * 100
  const conflictPenalty = conflictCount * 5_000
  return {
    targetPriorityScore,
    satisfactionScore,
    categoryScore,
    distancePenalty,
    conflictPenalty,
    total:
      targetPriorityScore +
      satisfactionScore +
      categoryScore -
      distancePenalty -
      conflictPenalty,
  }
}

function achievedSatisfactionScore(
  state: PlannerSearchState,
  targets: readonly TargetWeapon[],
): number {
  return targets.reduce((total, target) => {
    const satisfaction = state.targetSatisfaction[target.id]
    if (!satisfaction) return total
    const practical =
      satisfaction.hasPractical ? 1_000_000 + target.priority * 100_000 : 0
    const ideal =
      satisfaction.hasIdeal ? 200_000 + target.priority * 20_000 : 0
    return total + practical + ideal
  }, 0)
}

function progressPotentialScore(
  state: PlannerSearchState,
  entries: readonly BuildListEntry[],
  targetsById: ReadonlyMap<TargetWeaponId, TargetWeapon>,
  routeUnitCountByEntryId: ReadonlyMap<BuildListEntryId, number>,
  conflictCountByEntryId: ReadonlyMap<BuildListEntryId, number>,
): number {
  const bestByTarget = new Map<TargetWeaponId, number>()
  entries.forEach((entry) => {
    if (state.selectedBuildListEntryIds.includes(entry.id)) return
    const target = targetsById.get(entry.targetWeaponId)
    if (!target) return
    const satisfaction = state.targetSatisfaction[target.id]
    if (
      satisfaction?.hasIdeal ||
      (satisfaction?.hasPractical && entry.candidateSnapshot.category !== 'ideal')
    ) {
      return
    }
    const unitCount = routeUnitCountByEntryId.get(entry.id) ?? 0
    const progress = state.routeProgressByEntryId[entry.id] ?? 0
    if (unitCount <= 0 || progress <= 0) return
    const candidateScore = scoreCandidate(
      state,
      target,
      entry,
      conflictCountByEntryId.get(entry.id) ?? 0,
    ).total
    const progressBonus = Math.trunc((progress * 1_000) / (unitCount + 1))
    const value = candidateScore + progressBonus
    const current = bestByTarget.get(target.id)
    if (current === undefined || value > current) {
      bestByTarget.set(target.id, value)
    }
  })
  return [...bestByTarget.values()].reduce((total, value) => total + value, 0)
}

export interface StateScoreContext {
  entries: readonly BuildListEntry[]
  targetsById: ReadonlyMap<TargetWeaponId, TargetWeapon>
  routeUnitCountByEntryId: ReadonlyMap<BuildListEntryId, number>
  conflictCountByEntryId: ReadonlyMap<BuildListEntryId, number>
}

export function evaluatePlannerSearchState(
  state: PlannerSearchState,
  context: StateScoreContext,
): number {
  const targets = [...context.targetsById.values()].filter(
    ({ isEnabled }) => isEnabled,
  )
  const achieved = achievedSatisfactionScore(state, targets)
  const progress = progressPotentialScore(
    state,
    context.entries,
    context.targetsById,
    context.routeUnitCountByEntryId,
    context.conflictCountByEntryId,
  )
  const actionPenalty = state.trace.length * 100
  return achieved + progress - actionPenalty
}

function normalizedOwnedWeapons(state: PlannerSearchState) {
  const generatedOriginById = new Map(
    Object.entries(state.securedOwnedWeaponIdByEntryId).map(
      ([entryId, ownedWeaponId]) => [ownedWeaponId, entryId],
    ),
  )
  return state.simulatedInventory.ownedWeapons
    .map((weapon) => ({
      id: generatedOriginById.get(weapon.id) ?? weapon.id,
      kind: weapon.kind,
      weaponTypeId: weapon.weaponTypeId,
      elementId: weapon.elementId,
      restorationBonuses: weapon.restorationBonuses,
      isProtected: weapon.isProtected,
      // `status` is deliberately absent: it is a user-facing organisation label
      // that decides nothing in the Planner, so two branches differing only in
      // it are the same search state (`docs/DATA_MODEL.md` 3.2).
      ...(weapon.kind === 'gogma'
        ? {
            seriesSkillId: weapon.seriesSkillId,
            groupSkillId: weapon.groupSkillId,
          }
        : { rarity: weapon.rarity }),
    }))
    .sort((left, right) => compareStableStrings(left.id, right.id))
}

/**
 * IDs reserved during search and timestamps are deliberately excluded.
 *
 * `weaponSwitchCount`, `lastWeaponOperationSubjectKey`, and
 * `preferredSourceProgressCount` are deliberately excluded too, and their
 * exclusion loses nothing. All three are pure functions of the trace projection
 * already keyed below: each action's `primaryBuildListEntryId` and
 * `progressedBuildListEntryIds` plus its `progressedRoutePositions` pin the
 * exact saved `RouteOperation`, and therefore its weapon subject and which
 * Entries it progressed. Two states sharing this key therefore always share all
 * three values, so deduplication identity, future switch accounting, the
 * preferred-source preference, and the deterministic tie-break stay consistent
 * without restating them (`docs/PLANNER_SPEC.md` 7.3 / 7.4).
 */
export function createPlannerSearchStateSemanticKey(
  state: PlannerSearchState,
): string {
  return stableStringify({
    rng: {
      gogmaCounter: state.currentRngState.gogmaCounter.value,
      skillCounter: state.currentRngState.skillCounter.value,
    },
    normalCounters: state.currentNormalCounters
      .map(({ id, counter, isConfirmed }) => ({ id, counter, isConfirmed }))
      .sort((left, right) => compareStableStrings(left.id, right.id)),
    inventory: normalizedOwnedWeapons(state),
    consumedInitialWeaponIds: state.simulatedInventory.consumedWeaponIds
      .filter((id) => !state.simulatedInventory.createdWeaponIds.includes(id))
      .sort(compareStableStrings),
    targetSatisfaction: state.targetSatisfaction,
    routeProgressByEntryId: state.routeProgressByEntryId,
    routeRuntimeByEntryId: state.routeRuntimeByEntryId,
    sourceMutationVersionByOwnedWeaponId: state.sourceMutationVersionByOwnedWeaponId,
    candidateReadySourceVersionByEntryId:
      state.candidateReadySourceVersionByEntryId,
    routeSourceVersionByEntryId: state.routeSourceVersionByEntryId,
    inFlightExistingSourceByOwnedWeaponId:
      state.inFlightExistingSourceByOwnedWeaponId,
    practicalFirstProgressTargetIds: [...state.practicalFirstProgressTargetIds]
      .sort(compareStableStrings),
    selectedBuildListEntryIds: [...state.selectedBuildListEntryIds].sort(
      compareStableStrings,
    ),
    trace: state.trace.map((action) => ({
      kind: action.kind,
      actionType: action.actionType,
      primaryBuildListEntryId: action.primaryBuildListEntryId,
      progressedBuildListEntryIds: action.progressedBuildListEntryIds,
      progressedRoutePositions: action.progressedRoutePositions,
    })),
  })
}

function traceTieBreakKey(state: PlannerSearchState): string {
  return stableStringify(
    state.trace.map((action) => ({
      kind: action.kind,
      actionType: action.actionType,
      primaryBuildListEntryId: action.primaryBuildListEntryId,
      progressedBuildListEntryIds: action.progressedBuildListEntryIds,
      progressedRoutePositions: action.progressedRoutePositions,
    })),
  )
}

export function comparePlannerSearchStates(
  left: PlannerSearchState,
  right: PlannerSearchState,
): number {
  const leftHasPracticalFirstProgress =
    left.practicalFirstProgressTargetIds.length > 0
  const rightHasPracticalFirstProgress =
    right.practicalFirstProgressTargetIds.length > 0
  if (leftHasPracticalFirstProgress !== rightHasPracticalFirstProgress) {
    return Number(rightHasPracticalFirstProgress) -
      Number(leftHasPracticalFirstProgress)
  }
  if (left.evaluationScore !== right.evaluationScore) {
    return right.evaluationScore - left.evaluationScore
  }
  // Plan preference, below every correctness, satisfaction, and cost decision:
  // among branches the existing evaluation already rates equally, prefer the
  // one that works from the owned weapon its Target named as the preferred
  // starting point. Never a weight inside evaluationScore, so it can never
  // reverse a cheaper Route (docs/PLANNER_SPEC.md 7.4).
  if (left.preferredSourceProgressCount !== right.preferredSourceProgressCount) {
    return right.preferredSourceProgressCount - left.preferredSourceProgressCount
  }
  // Plan quality, below the preferred-source preference and above the two
  // stable string tie-breaks: among Plans the existing evaluation already rates
  // equally, prefer the one that makes the player swap the weapon in hand fewer
  // times (docs/PLANNER_SPEC.md 7.3).
  if (left.weaponSwitchCount !== right.weaponSwitchCount) {
    return left.weaponSwitchCount - right.weaponSwitchCount
  }
  const semantic = compareStableStrings(
    createPlannerSearchStateSemanticKey(left),
    createPlannerSearchStateSemanticKey(right),
  )
  if (semantic !== 0) return semantic
  return compareStableStrings(traceTieBreakKey(left), traceTieBreakKey(right))
}
