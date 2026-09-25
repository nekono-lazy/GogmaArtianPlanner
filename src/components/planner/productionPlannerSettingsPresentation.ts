/**
 * Presentation for the Production Planner settings and its running state
 * (UI_FLOW 10.0, PLANNER_SPEC 7.2, Issue #103 Phase D-1).
 *
 * The Production Planner is the deterministic scheduler. Its only bound is
 * `PlannerOptions.maxPlanSteps`, so the Build List detail settings expose that
 * one field. `beamWidth` and `maxExpandedStates` are Beam Search oracle values
 * the scheduler never reads; they are neither shown nor edited here.
 *
 * A running Production Planner is shown as indeterminate. No text here is built
 * from `PlannerProgress`: its `maxExpandedStates` is not a completion
 * denominator, and no single authority knows the final Step count in advance
 * (physical action sharing, silent fast-forward, dynamic release / recommit and
 * deadlock / stall drops all change it while the schedule runs).
 */

export interface ProductionPlannerOptionFieldPresentation {
  key: 'maxPlanSteps'
  label: string
  helperText: string
}

/** The one Production Planner bound the Build List detail settings expose. */
export const productionPlannerMaxPlanStepsField: ProductionPlannerOptionFieldPresentation = {
  key: 'maxPlanSteps',
  label: '最大計画ステップ数',
  helperText:
    '計画で実行する操作数の安全上限です。通常は変更不要です。上限に達して計画が完了しなかった場合は、この値を増やして再実行してください。',
}

export const productionPlannerDetailSettingsDescription =
  '生産計画の作成に使う安全上限です。1以上の整数だけが有効で、この画面を再読み込みすると既定値へ戻ります。'

export const plannerOptionInvalidMessage = '1以上の整数を入力してください。'

/** The running state of each Production Planner entry point, never a ratio. */
export const productionPlannerRunningTitles = {
  plan: '生産計画を作成しています…',
  replanPreview: '再計画を試算しています…',
  recalculation: '再計算しています…',
  whatIf: '比較しています…',
} as const

export const productionPlannerRunningNote =
  '計算が終わると結果を表示します。途中で止める場合は「キャンセル」を押してください。'
