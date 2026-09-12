import {
  isCalculationContextCompatible,
  type BuildListEntry,
  type BuildListEntryId,
  type CalculationContext,
  type CompromiseCheckpointOpportunityId,
  type PlanConflict,
  type ProductionPlan,
  type ProductionPlanStatus,
  type TargetWeapon,
} from '../../domain/models/publicTypes'
import type {
  PlannerConflictResolution,
  PlannerInput,
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
   * The current conflict involves a selected compromise checkpoint. Neither
   * 「比較する」 nor 「この候補を優先」 can settle it: the Domain refuses such a
   * resolution, and the Build List checkpoint selection is the only way out
   * (`docs/PLANNER_SPEC.md` 9.5).
   */
  | 'checkpoint_conflict'

export interface ProductionPlanParticipantViewModel {
  buildListEntryId: BuildListEntryId
  entry: BuildListEntry | null
  target: TargetWeapon | null
  targetName: string
  /**
   * The compromise checkpoint this participant is competing for in the
   * *current* conflict, or `null`.
   *
   * A conflict involving a selected checkpoint cannot be resolved by picking a
   * winning Entry: the loser's checkpoint would simply be dropped, which the
   * Planner is never allowed to do. The UI uses this to say that the Build List
   * checkpoint selection has to change instead (`docs/UI_FLOW.md` 11.1).
   */
  checkpointOpportunityId: CompromiseCheckpointOpportunityId | null
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
   * True when the current conflict involves a selected compromise checkpoint.
   * Every participant is then unavailable with `checkpoint_conflict`, and the
   * page sends the user to the Build List instead of offering a winner.
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
 * execution preparation path. Both the Plan and its audit snapshot must match
 * exactly. Build-result compatibility exceptions never apply to a Plan.
 */
export function evaluateProductionPlanCalculationCompatibility(
  plan: ProductionPlan,
  current: CalculationContext,
): ProductionPlanCalculationCompatibility {
  const isCompatible =
    isCalculationContextCompatible(plan.calculationContext, current) &&
    isCalculationContextCompatible(
      plan.baseSnapshot.calculationContext,
      current,
    )
  return isCompatible
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
  'この競合には選択済みチェックポイントが関係しています。作成リストでチェックポイントを変更または解除してください。'

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

function participantAvailability(
  planStatus: ProductionPlanStatus,
  conflict: PlanConflict,
  entry: BuildListEntry | undefined,
  preparation: PlannerInteractionPreparationResult,
): Pick<
  ProductionPlanParticipantViewModel,
  'isAvailable' | 'unavailableReason' | 'unavailableMessage'
> {
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
  if (currentConflict.checkpointParticipants.length > 0) {
    // Conservative by contract: any conflict a selected checkpoint takes part
    // in is out of scope for winner selection, whichever side it sits on.
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
  return {
    isAvailable: true,
    unavailableReason: null,
    unavailableMessage: null,
  }
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

  return {
    planStatus: plan.status,
    isDraft: plan.status === 'draft',
    planStatusMessage: planStatusMessage(plan.status),
    conflicts: plan.conflicts.map((conflict) => {
      // The current preparation is the authority for checkpoint involvement:
      // the persisted Plan's own metadata may predate a Build List change.
      const currentConflict =
        preparation.status === 'ready'
          ? preparation.currentConflicts.find(({ id }) => id === conflict.id)
          : undefined
      const currentCheckpointParticipants =
        currentConflict?.checkpointParticipants ?? []
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
              )?.checkpointOpportunityId ?? null,
            isRecommended:
              conflict.recommendedBuildListEntryId === buildListEntryId,
            isSelected: conflict.selectedBuildListEntryId === buildListEntryId,
            ...participantAvailability(
              plan.status,
              conflict,
              entry,
              preparation,
            ),
          }
        }),
      }
    }),
  }
}
