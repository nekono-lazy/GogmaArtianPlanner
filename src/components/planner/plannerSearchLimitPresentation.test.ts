import { describe, expect, it } from 'vitest'
import { defaultPlannerOptions, type PlannerRunTermination } from '../../domain/planner'
import {
  createPlannerCompletedTargetsText,
  createPlannerReachedLimitMessages,
  plannerIncompleteSearchTitle,
  plannerSearchLimitLabels,
} from './plannerSearchLimitPresentation'
import {
  plannerOptionInvalidMessage,
  productionPlannerDetailSettingsDescriptionLines,
  productionPlannerDetailSettingsTitle,
  productionPlannerMaxPlanStepsField,
  productionPlannerOptionsInvalidMessage,
  productionPlannerRunningNote,
  productionPlannerRunningTitles,
} from './productionPlannerSettingsPresentation'

function incomplete(reachedLimits: PlannerRunTermination['reachedLimits']): PlannerRunTermination {
  return {
    status: 'incomplete',
    reachedLimits,
    limits: { ...defaultPlannerOptions },
    expandedStates: 1_000,
    completedTargetCount: 1,
    totalTargetCount: 2,
  }
}

const RETIRED_CONCEPTS = /Beam|探索状態|候補状態/

describe('Production Planner settings presentation (Issue #103 Phase D-1)', () => {
  it('exposes maxPlanSteps as the only Production bound', () => {
    expect(productionPlannerMaxPlanStepsField.key).toBe('maxPlanSteps')
    expect(productionPlannerMaxPlanStepsField.label).toBe('最大計画ステップ数')
  })

  it('describes maxPlanSteps as a safety limit without the retired Beam concepts', () => {
    expect(productionPlannerMaxPlanStepsField.helperText).toBe(
      '計画で実行する操作数の安全上限です。通常は変更不要です。上限に達して計画が完了しなかった場合は、この値を増やして再実行してください。',
    )
    expect(productionPlannerMaxPlanStepsField.helperText).not.toMatch(RETIRED_CONCEPTS)
    const description = productionPlannerDetailSettingsDescriptionLines.join('')
    expect(description).not.toMatch(RETIRED_CONCEPTS)
    expect(description).not.toMatch(/3項目/)
    expect(plannerOptionInvalidMessage).toBe('1以上の整数を入力してください。')
  })

  it('names the detail settings as the ordinary Planner settings that the global optimization does not use (U7)', () => {
    expect(productionPlannerDetailSettingsTitle).toBe('詳細設定（通常Planner用）')
    const description = productionPlannerDetailSettingsDescriptionLines.join('\n')
    // The operations that use it, the one that does not, and the existing rules (UI_FLOW 10.0).
    expect(description).toContain('有効な候補が1件のときの「生産計画を作成」')
    expect(description).toContain('「登録済みの候補で生産計画を作成」')
    expect(description).toContain('「現在地点から再計画を試算」')
    expect(description).toContain('有効な候補が2件以上のときの「生産計画を作成」（全体最適化）には適用されません。')
    expect(description).toContain('1以上の整数だけが有効で、この画面を再読み込みすると既定値へ戻ります。')
    expect(description).toContain('500刻み')
    // No optimization bound, window or value is exposed.
    expect(description).not.toMatch(/探索範囲|window|node|structural|2,500|350|1,500|Beam/u)
    expect(productionPlannerOptionsInvalidMessage).toContain('通常Plannerの詳細設定の「最大計画ステップ数」が無効なため')
  })

  it('names the running state without a numeric ratio', () => {
    Object.values(productionPlannerRunningTitles).forEach((title) => {
      expect(title).not.toMatch(/\d|\//)
      expect(title).not.toMatch(RETIRED_CONCEPTS)
    })
    expect(productionPlannerRunningNote).not.toMatch(RETIRED_CONCEPTS)
  })
})

describe('incomplete Planner run presentation', () => {
  it('reads only the typed termination and names the Production maxPlanSteps bound', () => {
    expect(plannerIncompleteSearchTitle).toBe('生産計画の探索が完了していません')
    expect(createPlannerReachedLimitMessages(incomplete(['max_plan_steps']))).toEqual([
      '最大計画ステップ数 1,000 に到達しました。すべての目標武器を含む完成計画を作成できませんでした。「詳細設定」の「最大計画ステップ数」を増やして、もう一度生産計画を作成してください。',
    ])
    expect(createPlannerCompletedTargetsText(incomplete(['max_plan_steps']))).toBe('完成した目標武器: 1 / 2')
  })

  it('names the Build List settings heading and the operation to run again when the caller says so (UI_FLOW 10.1)', () => {
    expect(createPlannerReachedLimitMessages(incomplete(['max_plan_steps']), {
      settingsHeading: '詳細設定（通常Planner用）',
      retryAction: '「登録済みの候補で生産計画を作成」を実行',
    })).toEqual([
      '最大計画ステップ数 1,000 に到達しました。すべての目標武器を含む完成計画を作成できませんでした。「詳細設定（通常Planner用）」の「最大計画ステップ数」を増やして、もう一度「登録済みの候補で生産計画を作成」を実行してください。',
    ])
  })

  it('knows the Production max_plan_steps bound only (Phase D-2a)', () => {
    expect(Object.keys(plannerSearchLimitLabels)).toEqual(['max_plan_steps'])
    expect(Object.values(plannerSearchLimitLabels).join('')).not.toMatch(RETIRED_CONCEPTS)
    // @ts-expect-error a Production termination cannot name the Beam Search oracle bound.
    const oracleOnly = incomplete(['max_expanded_states'])
    expect(oracleOnly.status).toBe('incomplete')
  })
})
