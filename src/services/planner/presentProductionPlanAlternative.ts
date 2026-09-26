import type {
  PlannerAlternativeOutcome,
  PlannerAlternativeRepairNotPersistableReason,
  PlannerWhatIfInvalidFixedResolutionReason,
} from '../../domain/planner'

/**
 * Japanese wording for the Planner Alternative typed results the Production
 * Plan screen shows (`docs/PLANNER_SPEC.md` 9.2.19.13, `docs/UI_FLOW.md`
 * 11.3 / 11.4.1). Every branch is chosen by a typed status; no message or
 * detail text is parsed. It is the minimal Phase 5-B presentation; the full
 * Conflict repair Presentation is Issue #122.
 */

function assertNever(value: never): never {
  throw new Error(`Unexpected Planner Alternative value: ${String(value)}`)
}

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP')
}

/** One no-result status each; none of them is folded into "no candidate". */
export function presentPlannerAlternativeNoResult(
  outcome: Exclude<PlannerAlternativeOutcome, { status: 'found' }>,
): string {
  switch (outcome.status) {
    case 'not_found_within_search_extent':
      return '探索範囲内に実行可能な候補なし'
    case 'stopped_by_search_extent_bound':
      return '探索範囲上限のため未確認'
    case 'stopped_by_candidate_trial_bound':
      return '候補試行上限のため未確認'
    case 'stopped_by_planner_rerun_bound':
      return 'Planner再計算上限のため未確認'
    case 'blocked_by_selected_checkpoint':
      return '途中採用する状態が選択されているため代替ルートを探索しません。作成リストで途中採用する状態を変更または解除してください'
    default:
      return assertNever(outcome)
  }
}

/**
 * A found alternative's fate in the whole scenario. `null` - not evaluated,
 * because the request's Planner rerun budget ran out first - is never shown as
 * "not adopted".
 */
export function presentPlannerAlternativeAdoption(adoptedInScenario: boolean | null): string {
  if (adoptedInScenario === true) return '計画全体: 採用'
  if (adoptedInScenario === false) return '計画全体: 不採用（他の代替と合わせると成立しません）'
  return '計画全体: 未評価（Planner再計算上限のため採否を確認できませんでした）'
}

export function presentPlannerAlternativeInvalidResolution(
  reason: PlannerWhatIfInvalidFixedResolutionReason,
): string {
  switch (reason) {
    case 'scenario_resolution_not_valid':
      return 'この候補は現在のPlanner入力では有効ではありません。'
    case 'fixed_constraints_unresolved':
      return '既存の明示選択を含む固定条件を解決できません。'
    case 'scenario_constraint_missing':
      return 'この競合を現在の状態へ一意に対応付けできません。'
    default:
      return assertNever(reason)
  }
}

export const plannerAlternativeInvalidPriorFixedEntryMessage =
  '以前の競合解決で優先した候補を、現在のPlanner入力では固定できません。ビルドリストから生産計画を作り直してください。'

/**
 * Why an actual repair saved nothing (`docs/PLANNER_SPEC.md` 9.2.19.8): the
 * displayed Draft and the Build List are unchanged in every case.
 */
export function presentPlannerAlternativeRepairNotSaved(
  reason: Exclude<PlannerAlternativeRepairNotPersistableReason, 'invalid_conflict_resolution'>,
  maxPlanSteps: number | null,
): string {
  switch (reason) {
    case 'no_plan':
      return 'この候補を優先すると、現在の入力から生産計画を作成できませんでした。生産計画と作成リストは変更されていません。'
    case 'stopped_by_plan_step_bound':
      return maxPlanSteps === null
        ? '競合解決の再計算が最大計画ステップ数に到達したため、完成した生産計画を作成できませんでした。生産計画と作成リストは変更されていません。'
        : `競合解決の再計算が最大計画ステップ数 ${formatCount(maxPlanSteps)} に到達したため、完成した生産計画を作成できませんでした。この上限は表示中の生産計画のステップ数から自動で決まります。ビルドリスト画面から生産計画を作り直してください。`
    case 'stopped_by_planner_rerun_bound':
      return 'Planner再計算上限に到達したため、この候補を優先した生産計画を確定できませんでした。生産計画と作成リストは変更されていません。'
    default:
      return assertNever(reason)
  }
}
