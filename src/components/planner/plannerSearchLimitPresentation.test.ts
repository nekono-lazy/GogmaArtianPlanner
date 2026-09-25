import { describe, expect, it } from 'vitest'
import { defaultPlannerOptions, type PlannerSearchTermination } from '../../domain/planner'
import {
  createPlannerCompletedTargetsText,
  createPlannerExpandedStatesText,
  createPlannerReachedLimitMessages,
  plannerIncompleteSearchTitle,
  plannerOptionFields,
} from './plannerSearchLimitPresentation'

function incomplete(reachedLimits: PlannerSearchTermination['reachedLimits']): PlannerSearchTermination {
  return {
    status: 'incomplete',
    reachedLimits,
    limits: { ...defaultPlannerOptions },
    expandedStates: 10_000,
    completedTargetCount: 1,
    totalTargetCount: 2,
  }
}

describe('Planner detail settings presentation (Issue #103 Phase C)', () => {
  it('keeps all three PlannerOptions fields in their display order', () => {
    expect(plannerOptionFields.map(({ key, label }) => [key, label])).toEqual([
      ['maxPlanSteps', '最大計画ステップ数'],
      ['maxExpandedStates', '最大探索状態数'],
      ['beamWidth', 'Beam幅'],
    ])
  })

  it('describes maxExpandedStates as the number of states the Planner builds', () => {
    const field = plannerOptionFields.find(({ key }) => key === 'maxExpandedStates')
    expect(field?.helperText).toBe(
      'Plannerが構築する状態数の上限です。計画が上限に達した場合は、この値を増やして再実行してください。',
    )
    expect(field?.helperText).not.toMatch(/評価/)
  })

  it('says Beam幅 is not used by the current ordinary Planner, never a search-quality trade-off', () => {
    const field = plannerOptionFields.find(({ key }) => key === 'beamWidth')
    expect(field?.helperText).toBe('現在の通常Plannerでは使用しません。互換性のため設定項目を残しています。')
    expect(field?.helperText).not.toMatch(/探索品質|候補状態/)
  })
})

describe('incomplete Planner run presentation', () => {
  it('reads only the typed termination and names each reached bound', () => {
    expect(plannerIncompleteSearchTitle).toBe('生産計画の探索が完了していません')
    expect(createPlannerReachedLimitMessages(incomplete(['max_expanded_states', 'max_plan_steps']))).toEqual([
      '最大探索状態数 10,000 に到達しました。すべての目標武器を含む完成計画を作成できませんでした。「詳細設定」の「最大探索状態数」を増やして、もう一度生産計画を作成してください。',
      '最大計画ステップ数 300 に到達しました。より長い作成ルートが必要な可能性があります。「詳細設定」の「最大計画ステップ数」を増やして、もう一度生産計画を作成してください。',
    ])
    expect(createPlannerExpandedStatesText(incomplete(['max_expanded_states']))).toBe('探索状態数: 10,000 / 10,000')
    expect(createPlannerCompletedTargetsText(incomplete(['max_expanded_states']))).toBe('完成した目標武器: 1 / 2')
  })
})
