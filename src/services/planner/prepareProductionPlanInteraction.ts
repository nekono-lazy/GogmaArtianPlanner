import type {
  BuildListEntry,
  BuildListEntryId,
  CandidateCategory,
  PlanConflict,
  ProductionPlan,
  ProductionPlanStatus,
  TargetWeapon,
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

export interface ProductionPlanParticipantViewModel {
  buildListEntryId: BuildListEntryId
  entry: BuildListEntry | null
  target: TargetWeapon | null
  targetName: string
  candidateCategory: CandidateCategory | null
  isRecommended: boolean
  isSelected: boolean
  isAvailable: boolean
  unavailableReason: ProductionPlanParticipantUnavailableReason | null
  unavailableMessage: string | null
}

export interface ProductionPlanConflictViewModel {
  id: string
  reason: string
  participants: ProductionPlanParticipantViewModel[]
}

export interface ProductionPlanInteractionViewModel {
  planStatus: ProductionPlanStatus
  isDraft: boolean
  planStatusMessage: string | null
  conflicts: ProductionPlanConflictViewModel[]
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
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      reason: conflict.reason,
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
          candidateCategory: entry?.candidateSnapshot.category ?? null,
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
    })),
  }
}
