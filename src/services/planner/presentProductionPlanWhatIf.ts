import type {
  PlannerWhatIfInvalidFixedResolutionReason,
  PlannerWhatIfOutcome,
} from '../../domain/planner'

function assertNever(value: never): never {
  throw new Error(`Unexpected what-if value: ${String(value)}`)
}

export function presentPlannerWhatIfNoResult(
  outcome: Exclude<PlannerWhatIfOutcome, { status: 'found' }>,
): string {
  switch (outcome.status) {
    case 'not_found_within_search_extent':
      return '探索範囲内に実行可能な候補なし'
    case 'stopped_by_enumeration_bound':
      return '探索範囲上限のため未確認'
    case 'stopped_by_candidate_trial_bound':
      return '候補試行上限のため未確認'
    case 'stopped_by_planner_rerun_bound':
      return 'Planner再計算上限のため未確認'
    default:
      return assertNever(outcome)
  }
}

export function presentPlannerWhatIfInvalidResolution(
  reason: PlannerWhatIfInvalidFixedResolutionReason,
): string {
  switch (reason) {
    case 'scenario_resolution_not_valid':
      return '比較対象の候補は現在のPlanner入力では有効ではありません。'
    case 'fixed_constraints_unresolved':
      return '既存の明示選択を含む固定条件を解決できません。'
    case 'scenario_constraint_missing':
      return '比較対象の競合を現在の状態へ一意に対応付けできません。'
    default:
      return assertNever(reason)
  }
}
