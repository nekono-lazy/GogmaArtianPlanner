import {
  isProductionPlanCalculationCompatible,
  type BuildListEntry,
  type BuildListEntryId,
  type CalculationContext,
  type IntermediateStateOpportunityId,
  type PlanConflict,
  type ProductionPlan,
  type ProductionPlanStatus,
  type TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  derivePlannerConflictDecisionSet,
  plannerConflictEffectiveCheckpointParticipants,
  type PlannerConflictDecisionSetResult,
  type PlannerConflictResolution,
  type PlannerInput,
} from '../../domain/planner'
import type {
  PlannerInteractionPreparationResult,
} from '../../workers/plannerWorkerContracts'

export type ProductionPlanParticipantUnavailableReason =
  | 'entry_not_found'
  | 'preparation_invalid'
  | 'current_conflict_not_found'
  | 'not_current_conflict_participant'
  | 'planner_validation_excluded'
  | 'plan_not_draft'
  /**
   * The current conflict keeps an effective selected compromise checkpoint
   * (`docs/PLANNER_SPEC.md` 9.5.1 / 9.6.2): 「この候補を優先」 cannot settle it -
   * the Domain refuses such a resolution - and the Build List checkpoint
   * selection is the only way out. A conflict whose checkpoint participants
   * another decision of the displayed Draft already excludes is not one.
   */
  | 'checkpoint_conflict'

export interface ProductionPlanParticipantViewModel {
  buildListEntryId: BuildListEntryId
  entry: BuildListEntry | null
  target: TargetWeapon | null
  targetName: string
  /**
   * The selected intermediate state this participant is competing for in the
   * *current* conflict, or `null`.
   *
   * A conflict involving a selected state cannot be resolved by picking a
   * winning Entry: the loser's selection would simply be dropped, which the
   * Planner is never allowed to do. The UI uses this to say that the Build List
   * selection has to change instead (`docs/UI_FLOW.md` 11.1).
   */
  checkpointOpportunityId: IntermediateStateOpportunityId | null
  isRecommended: boolean
  isSelected: boolean
  isAvailable: boolean
  unavailableReason: ProductionPlanParticipantUnavailableReason | null
  unavailableMessage: string | null
}

export interface ProductionPlanConflictViewModel {
  id: string
  reason: string
  /**
   * True when the current conflict keeps an effective selected compromise
   * checkpoint: a checkpoint participant the displayed Draft's earlier
   * decisions do not exclude (`docs/PLANNER_SPEC.md` 9.6.2). Every participant
   * is then unavailable with `checkpoint_conflict`, and the page sends the user
   * to the Build List instead of offering a winner.
   */
  involvesSelectedCheckpoint: boolean
  participants: ProductionPlanParticipantViewModel[]
}

export interface ProductionPlanInteractionViewModel {
  planStatus: ProductionPlanStatus
  isDraft: boolean
  planStatusMessage: string | null
  conflicts: ProductionPlanConflictViewModel[]
}

export type ProductionPlanCalculationCompatibility =
  | { isCompatible: true; recalculationReasons: readonly [] }
  | {
      isCompatible: false
      recalculationReasons: readonly ['calculation_context_changed']
    }

/**
 * Evaluates whether a persisted Plan may enter the current interaction or
 * execution preparation path, through the one Domain authority
 * `isProductionPlanCalculationCompatible()` (`docs/PLANNER_SPEC.md` 9.6.10):
 * the Plan and its audit snapshot are judged by the same rule, and the only
 * Plan exception is the explicit, resolution-free `18 -> 17` one. Build-result
 * compatibility exceptions never apply to a Plan.
 */
export function evaluateProductionPlanCalculationCompatibility(
  plan: ProductionPlan,
  current: CalculationContext,
): ProductionPlanCalculationCompatibility {
  return isProductionPlanCalculationCompatible(plan, current)
    ? { isCompatible: true, recalculationReasons: [] }
    : {
        isCompatible: false,
        recalculationReasons: ['calculation_context_changed'],
      }
}

/**
 * Restores only persisted user choices. Planner recommendation and selected
 * output membership are deliberately not consulted.
 */
export function restorePersistedExplicitResolutions(
  input: PlannerInput,
  plan: ProductionPlan,
): PlannerInput {
  const conflictResolutions: PlannerConflictResolution[] = plan.conflicts
    .flatMap((conflict) => {
      const selectedBuildListEntryId = conflict.selectedBuildListEntryId
      return selectedBuildListEntryId === null
        ? []
        : [{
            conflictKey: conflict.id,
            selectedBuildListEntryId,
          }]
    })

  return { ...input, conflictResolutions }
}

/** Replace only this explicit choice, retaining all other explicit resolutions. */
export function mergeExplicitConflictResolution(
  input: PlannerInput,
  resolution: PlannerConflictResolution,
): PlannerInput {
  const exists = input.conflictResolutions.some(
    ({ conflictKey }) => conflictKey === resolution.conflictKey,
  )
  return {
    ...input,
    conflictResolutions: exists
      ? input.conflictResolutions.map((existing) =>
          existing.conflictKey === resolution.conflictKey
            ? { ...resolution }
            : existing,
        )
      : [...input.conflictResolutions, { ...resolution }],
  }
}

export const CHECKPOINT_CONFLICT_MESSAGE =
  'この競合には途中採用する状態の選択が関係しています。作成リストで途中採用する状態を変更または解除してください。'

function planStatusMessage(status: ProductionPlanStatus): string | null {
  switch (status) {
    case 'draft':
      return null
    case 'stale':
      return 'この生産計画は現在の状態と一致しません。ビルドリストから再計算してください。'
    case 'active':
      return '実行中の生産計画では競合候補を変更できません。'
    case 'completed':
      return '完了した生産計画では競合候補を変更できません。'
    case 'abandoned':
      return '破棄した生産計画では競合候補を変更できません。'
  }
}

function unavailable(
  reason: ProductionPlanParticipantUnavailableReason,
  message: string,
): Pick<
  ProductionPlanParticipantViewModel,
  'isAvailable' | 'unavailableReason' | 'unavailableMessage'
> {
  return {
    isAvailable: false,
    unavailableReason: reason,
    unavailableMessage: message,
  }
}

const AVAILABLE: Pick<
  ProductionPlanParticipantViewModel,
  'isAvailable' | 'unavailableReason' | 'unavailableMessage'
> = { isAvailable: true, unavailableReason: null, unavailableMessage: null }

/**
 * The Entries the displayed Draft's earlier decisions still exclude over the
 * current preparation (`derivePlannerConflictDecisionSet()` with no new
 * decision). A refused reading - a non-draft or an inconsistent Draft - excludes
 * nothing, so every checkpoint participant counts as effective: the
 * conservative reading.
 */
function carriedExcludedEntryIds(
  plan: ProductionPlan,
  input: PlannerInput,
  preparation: PlannerInteractionPreparationResult,
): BuildListEntryId[] {
  if (preparation.status !== 'ready') return []
  const carried = derivePlannerConflictDecisionSet({
    displayedPlan: plan,
    currentCalculationContext: input.calculationContext,
    preparation,
    decision: null,
  })
  return carried.status === 'ready' ? carried.excludedBuildListEntryIds : []
}

function participantAvailability(
  plan: ProductionPlan,
  input: PlannerInput,
  conflict: PlanConflict,
  entry: BuildListEntry | undefined,
  preparation: PlannerInteractionPreparationResult,
  carriedExcluded: readonly BuildListEntryId[],
): Pick<
  ProductionPlanParticipantViewModel,
  'isAvailable' | 'unavailableReason' | 'unavailableMessage'
> {
  const planStatus = plan.status
  if (!entry) {
    return unavailable(
      'entry_not_found',
      'この候補は削除済み、または現在のビルドリストに存在しません。',
    )
  }
  if (preparation.status === 'invalid') {
    return unavailable(
      'preparation_invalid',
      '現在のPlanner入力を準備できないため、再計算が必要です。',
    )
  }
  if (!preparation.validBuildListEntryIds.includes(entry.id)) {
    const excluded = preparation.excludedBuildListEntries.find(
      ({ buildListEntryId }) => buildListEntryId === entry.id,
    )
    return unavailable(
      'planner_validation_excluded',
      excluded?.reason ?? 'Planner validationにより現在の候補から除外されました。',
    )
  }
  const currentConflict = preparation.currentConflicts.find(
    ({ id }) => id === conflict.id,
  )
  if (!currentConflict) {
    return unavailable(
      'current_conflict_not_found',
      '現在のPlanner入力ではこの競合を再現できません。',
    )
  }
  if (!currentConflict.buildListEntryIds.includes(entry.id)) {
    return unavailable(
      'not_current_conflict_participant',
      'この候補は現在の競合参加者ではありません。',
    )
  }
  if (plannerConflictEffectiveCheckpointParticipants(currentConflict, carriedExcluded).length > 0) {
    // Conservative by contract: a conflict an effective selected checkpoint
    // takes part in is out of scope for winner selection, whichever side it
    // sits on (`docs/PLANNER_SPEC.md` 9.5.1 / 9.6.2).
    return unavailable(
      'checkpoint_conflict',
      CHECKPOINT_CONFLICT_MESSAGE,
    )
  }
  if (planStatus !== 'draft') {
    return unavailable(
      'plan_not_draft',
      planStatusMessage(planStatus) ?? 'この生産計画は編集できません。',
    )
  }
  // The same Domain authority the press runs (9.6.3 rule 1). The set-level
  // refusals (an inconsistent set, two preferred Entries in an undecided
  // conflict) are explained when the user presses, so they stay available.
  const decisionSet = derivePlannerConflictDecisionSet({
    displayedPlan: plan,
    currentCalculationContext: input.calculationContext,
    preparation,
    decision: { conflictKey: conflict.id, selectedBuildListEntryId: entry.id },
  })
  if (decisionSet.status === 'refused') {
    switch (decisionSet.refusal.reason) {
      case 'checkpoint_conflict':
        return unavailable('checkpoint_conflict', CHECKPOINT_CONFLICT_MESSAGE)
      case 'plan_not_editable':
        return unavailable('plan_not_draft', 'この生産計画は編集できません。')
      case 'conflict_not_current':
        return unavailable('current_conflict_not_found', '現在のPlanner入力ではこの競合を再現できません。')
      case 'entry_not_participant':
        return unavailable('not_current_conflict_participant', 'この候補は現在の競合参加者ではありません。')
      case 'entry_not_valid':
        return unavailable('planner_validation_excluded', 'Planner validationにより現在の候補から除外されました。')
      case 'inconsistent_decision_set':
      case 'preferred_entries_conflict':
        return AVAILABLE
    }
  }
  return AVAILABLE
}

/**
 * The explicit decision set of one 「この候補を優先」 over the current
 * preparation (`docs/PLANNER_SPEC.md` 9.6.3): the Domain function the press and
 * the availability share, with the displayed Draft and the fresh input's
 * CalculationContext. `null` while no `ready` preparation exists.
 */
export function prepareProductionPlanConflictDecision(
  plan: ProductionPlan,
  input: PlannerInput,
  preparation: PlannerInteractionPreparationResult,
  decision: PlannerConflictResolution,
): PlannerConflictDecisionSetResult | null {
  if (preparation.status !== 'ready') return null
  return derivePlannerConflictDecisionSet({
    displayedPlan: plan,
    currentCalculationContext: input.calculationContext,
    preparation,
    decision,
  })
}

/** Builds presentation state without adding a new Domain validity rule. */
export function createProductionPlanInteractionViewModel(
  plan: ProductionPlan,
  input: PlannerInput,
  preparation: PlannerInteractionPreparationResult,
): ProductionPlanInteractionViewModel {
  const entriesById = new Map(
    input.buildListEntries.map((entry) => [entry.id, entry]),
  )
  const targetsById = new Map(
    input.targetWeapons.map((target) => [target.id, target]),
  )
  const carriedExcluded = carriedExcludedEntryIds(plan, input, preparation)

  return {
    planStatus: plan.status,
    isDraft: plan.status === 'draft',
    planStatusMessage: planStatusMessage(plan.status),
    conflicts: plan.conflicts.map((conflict) => {
      // The current preparation is the authority for checkpoint involvement:
      // the persisted Plan's own metadata may predate a Build List change. A
      // checkpoint participant an earlier decision excludes is not effective.
      const currentConflict =
        preparation.status === 'ready'
          ? preparation.currentConflicts.find(({ id }) => id === conflict.id)
          : undefined
      const currentCheckpointParticipants = currentConflict
        ? plannerConflictEffectiveCheckpointParticipants(currentConflict, carriedExcluded)
        : []
      return {
        id: conflict.id,
        reason: conflict.reason,
        involvesSelectedCheckpoint: currentCheckpointParticipants.length > 0,
        participants: conflict.buildListEntryIds.map((buildListEntryId) => {
          const entry = entriesById.get(buildListEntryId)
          const target = entry
            ? targetsById.get(entry.targetWeaponId) ?? null
            : null
          return {
            buildListEntryId,
            entry: entry ?? null,
            target,
            targetName: entry
              ? target?.name ?? '削除済みまたは現在存在しない目標武器'
              : '削除済みまたは現在存在しない候補',
            checkpointOpportunityId:
              currentCheckpointParticipants.find(
                (participant) => participant.buildListEntryId === buildListEntryId,
              )?.opportunityId ?? null,
            isRecommended:
              conflict.recommendedBuildListEntryId === buildListEntryId,
            isSelected: conflict.selectedBuildListEntryId === buildListEntryId,
            ...participantAvailability(
              plan,
              input,
              conflict,
              entry,
              preparation,
              carriedExcluded,
            ),
          }
        }),
      }
    }),
  }
}
