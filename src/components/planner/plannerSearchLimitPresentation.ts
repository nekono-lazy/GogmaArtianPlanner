import type {
  PlannerSearchLimitKind,
  PlannerSearchTermination,
} from '../../domain/planner'

/**
 * Presentation for a full Planner run that a bound truncated (UI_FLOW 10.1,
 * PLANNER_SPEC 7.2.1). The Production settings and running state live in
 * `productionPlannerSettingsPresentation.ts`.
 *
 * Every string here is derived from the typed `PlannerSearchTermination`. No
 * function in this module reads a `PlannerWarning`, and none parses a warning
 * message to decide what to show.
 *
 * The Production deterministic scheduler reaches `max_plan_steps` only (Issue
 * #103 Phase D-1). The `max_expanded_states` text stays for the Beam Search
 * oracle and the shared `PlannerSearchLimitKind` until Phase D-2; no ordinary
 * Production screen reaches it.
 */

export const plannerSearchLimitLabels: Record<PlannerSearchLimitKind, string> = {
  max_expanded_states: '最大探索状態数',
  max_plan_steps: '最大計画ステップ数',
}

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP')
}

export const plannerIncompleteSearchTitle = '生産計画の探索が完了していません'

/**
 * One line per reached bound, naming the bound, the value it ran with, and -
 * for `max_plan_steps` - the detail setting to raise.
 *
 * Every reached bound is listed rather than only the first. The Beam Search
 * oracle can reach both; the Production scheduler reaches `max_plan_steps` only.
 */
export function createPlannerReachedLimitMessages(
  termination: PlannerSearchTermination,
): string[] {
  return termination.reachedLimits.map((limit) =>
    limit === 'max_expanded_states'
      ? // Beam Search oracle only: no detail setting exposes this bound.
        `最大探索状態数 ${formatCount(termination.limits.maxExpandedStates)} に到達しました。すべての目標武器を含む完成計画を作成できませんでした。`
      : `最大計画ステップ数 ${formatCount(termination.limits.maxPlanSteps)} に到達しました。すべての目標武器を含む完成計画を作成できませんでした。「詳細設定」の「最大計画ステップ数」を増やして、もう一度生産計画を作成してください。`,
  )
}

export function createPlannerCompletedTargetsText(
  termination: PlannerSearchTermination,
): string {
  return `完成した目標武器: ${formatCount(termination.completedTargetCount)} / ${formatCount(termination.totalTargetCount)}`
}
