import type {
  PlannerOptions,
  PlannerSearchLimitKind,
  PlannerSearchTermination,
} from '../../domain/planner'

/**
 * Presentation for the Planner bounds and for a full Planner run that a bound
 * truncated (UI_FLOW 10.0, 10.1, PLANNER_SPEC 7.2.1).
 *
 * Every string here is derived from the typed `PlannerSearchTermination`. No
 * function in this module reads a `PlannerWarning`, and none parses a warning
 * message to decide what to show.
 */

export interface PlannerOptionFieldPresentation {
  key: keyof PlannerOptions
  label: string
  helperText: string
}

/**
 * The Build List detail settings, in display order.
 *
 * `beamWidth` is deliberately last: the Production deterministic scheduler
 * never reads it (Issue #103 Phase C), so its text says so instead of
 * describing a search quality trade-off. The field and its validation stay
 * until Phase D decides its removal. Raising the two bounds is the ordinary
 * answer to a truncated run.
 */
export const plannerOptionFields: readonly PlannerOptionFieldPresentation[] = [
  {
    key: 'maxPlanSteps',
    label: '最大計画ステップ数',
    helperText:
      '作成ルートとして許可する最大ステップ数です。長いルートで上限に達した場合は増やしてください。',
  },
  {
    key: 'maxExpandedStates',
    label: '最大探索状態数',
    helperText:
      'Plannerが構築する状態数の上限です。計画が上限に達した場合は、この値を増やして再実行してください。',
  },
  {
    key: 'beamWidth',
    label: 'Beam幅',
    helperText:
      '現在の通常Plannerでは使用しません。互換性のため設定項目を残しています。',
  },
]

export const plannerOptionInvalidMessage = '1以上の整数を入力してください。'

export const plannerSearchLimitLabels: Record<PlannerSearchLimitKind, string> = {
  max_expanded_states: '最大探索状態数',
  max_plan_steps: '最大計画ステップ数',
}

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP')
}

export const plannerIncompleteSearchTitle = '生産計画の探索が完了していません'

/**
 * One line per reached bound, naming the bound, the value it ran with, and
 * which detail setting to raise.
 *
 * Both bounds can be reached in one search, so every reached bound is listed
 * rather than only the first.
 */
export function createPlannerReachedLimitMessages(
  termination: PlannerSearchTermination,
): string[] {
  return termination.reachedLimits.map((limit) =>
    limit === 'max_expanded_states'
      ? `最大探索状態数 ${formatCount(termination.limits.maxExpandedStates)} に到達しました。すべての目標武器を含む完成計画を作成できませんでした。「詳細設定」の「最大探索状態数」を増やして、もう一度生産計画を作成してください。`
      : `最大計画ステップ数 ${formatCount(termination.limits.maxPlanSteps)} に到達しました。より長い作成ルートが必要な可能性があります。「詳細設定」の「最大計画ステップ数」を増やして、もう一度生産計画を作成してください。`,
  )
}

export function createPlannerExpandedStatesText(
  termination: PlannerSearchTermination,
): string {
  return `探索状態数: ${formatCount(termination.expandedStates)} / ${formatCount(termination.limits.maxExpandedStates)}`
}

export function createPlannerCompletedTargetsText(
  termination: PlannerSearchTermination,
): string {
  return `完成した目標武器: ${formatCount(termination.completedTargetCount)} / ${formatCount(termination.totalTargetCount)}`
}
