import type {
  PlannerRunLimitKind,
  PlannerRunTermination,
} from '../../domain/planner'

/**
 * Presentation for a Production full Planner run that its bound truncated
 * (UI_FLOW 10.1, PLANNER_SPEC 7.2.1). The Production settings and running
 * state live in `productionPlannerSettingsPresentation.ts`.
 *
 * Every string here is derived from the typed `PlannerRunTermination`. No
 * function in this module reads a `PlannerWarning`, and none parses a warning
 * message to decide what to show.
 *
 * The Production deterministic scheduler's one bound is `maxPlanSteps`, so
 * `max_plan_steps` is the only limit kind a Production termination can carry
 * (Issue #103 Phase D-2a). The Beam Search oracle's own limit kinds are shown
 * by its benchmark page only, never through this module.
 */

export const plannerSearchLimitLabels: Record<PlannerRunLimitKind, string> = {
  max_plan_steps: '最大計画ステップ数',
}

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP')
}

export const plannerIncompleteSearchTitle = '生産計画の探索が完了していません'

/**
 * One line per reached bound, naming the bound, the value it ran with, and
 * the detail setting to raise.
 */
export function createPlannerReachedLimitMessages(
  termination: PlannerRunTermination,
): string[] {
  return termination.reachedLimits.map(
    () =>
      `最大計画ステップ数 ${formatCount(termination.limits.maxPlanSteps)} に到達しました。すべての目標武器を含む完成計画を作成できませんでした。「詳細設定」の「最大計画ステップ数」を増やして、もう一度生産計画を作成してください。`,
  )
}

export function createPlannerCompletedTargetsText(
  termination: PlannerRunTermination,
): string {
  return `完成した目標武器: ${formatCount(termination.completedTargetCount)} / ${formatCount(termination.totalTargetCount)}`
}
