import { describe, expect, it } from 'vitest'
import { RepositoryError, type RepositoryErrorCode } from '../../db/repositoryError'
import { ExecutionRuntimeError } from '../../domain/execution'
import type { PlanCreationNotStartedReason } from '../../services/planner/planCreationService'
import {
  ordinaryPlannerRetryAction,
  planCreationOptimizationLines,
  presentBuildListOptimizationAdoptionRefusal,
  presentPlanCreationNotStarted,
} from './planCreationPresentation'

/** Issue #260 PR-6C: the Build List plan creation texts, chosen by typed values only. */
describe('plan creation presentation', () => {
  it('describes the global optimization without promising the shortest plan or saving before the adoption', () => {
    const text = planCreationOptimizationLines(3).join('\n')
    expect(text).toContain('有効な候補が3件あります。')
    expect(text).toContain('採用するまで、作成リストと生産計画は変更されません。')
    expect(text).toContain('最短であることは保証しません。')
    expect(text).not.toMatch(/最適解|最短です|すべての目標武器が完成/)
  })

  it('says why a press started nothing for every typed reason, naming the operation that was pressed', () => {
    const selection = { kind: 'ordinary_planner', validation: {} } as never
    const reasons: PlanCreationNotStartedReason[] = [
      { kind: 'start_read_failed', code: 'transaction_failed', message: 'x' },
      { kind: 'judgement_failed', message: 'x' },
      { kind: 'running_plan_exists', runningPlanId: 'plan.running' as never },
      { kind: 'invalid_planner_input', validation: {} as never },
      { kind: 'no_valid_build_list_entry', validation: {} as never },
      { kind: 'build_list_optimization_unsupported', validation: {} as never, reasons: [], ordinaryPlannerAuxiliary: false },
      { kind: 'ordinary_planner_auxiliary_not_offered', selection },
      { kind: 'planner_options_invalid' },
    ]
    for (const reason of reasons) {
      const primary = presentPlanCreationNotStarted('primary', reason)
      expect(primary.message.length, reason.kind).toBeGreaterThan(0)
      // Never a raw reason literal in the user's text.
      expect(primary.message, reason.kind).not.toContain(reason.kind)
    }
    expect(presentPlanCreationNotStarted('primary', { kind: 'start_read_failed', code: 'x', message: 'x' }).severity).toBe('error')
    expect(presentPlanCreationNotStarted('ordinary_planner_auxiliary', { kind: 'no_valid_build_list_entry', validation: {} as never }).message)
      .toContain('「登録済みの候補で生産計画を作成」')
    expect(presentPlanCreationNotStarted('primary', { kind: 'planner_options_invalid' }).message).toContain('「詳細設定（通常Planner用）」の「最大計画ステップ数」が無効')
  })

  it('points an incomplete ordinary run back at the operation that ran it (UI_FLOW 10.1)', () => {
    expect(ordinaryPlannerRetryAction('primary')).toBe('生産計画を作成')
    expect(ordinaryPlannerRetryAction('ordinary_planner_auxiliary')).toBe('「登録済みの候補で生産計画を作成」を実行')
  })

  it('tells the refusal causes apart by typed code only, and asks for a calculation the user starts', () => {
    const cases: [RepositoryErrorCode, string][] = [
      ['planner_state_changed', 'state_changed'],
      ['draft_plan_conflict', 'state_changed'],
      ['planner_result_invalid', 'not_persistable'],
      ['validation_failed', 'not_persistable'],
      ['transaction_failed', 'save_failed'],
      ['production_plan_id_conflict', 'save_failed'],
    ]
    for (const [code, cause] of cases) {
      const refusal = presentBuildListOptimizationAdoptionRefusal(new RepositoryError(code, 'a message never shown'))
      expect(refusal.cause, code).toBe(cause)
      expect(refusal.messages, code).toContain('作成リストと生産計画は変更されていません。')
      expect(refusal.messages.join(''), code).toContain('自動では計算しません')
      expect(refusal.messages.join(''), code).not.toContain('a message never shown')
    }
    expect(presentBuildListOptimizationAdoptionRefusal(new ExecutionRuntimeError('running_plan_invariant_violated', 'x')).cause).toBe('state_changed')
  })

  it('never claims nothing changed for an error that is not a typed refusal', () => {
    const refusal = presentBuildListOptimizationAdoptionRefusal(new Error('unexpected'))
    expect(refusal.cause).toBe('unknown')
    expect(refusal.messages).not.toContain('作成リストと生産計画は変更されていません。')
    expect(refusal.messages.join('')).toContain('現在の状態を確認してください')
  })
})
