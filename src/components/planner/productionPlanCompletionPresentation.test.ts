import { describe, expect, it } from 'vitest'
import type { RejectedBuildListEntry, TargetWeaponId } from '../../domain/models/publicTypes'
import type {
  ProductionPlanCompletionRatioUndeterminableReason,
  ProductionPlanCompletionSummary,
} from '../../domain/planner/productionPlanCompletionSummary'
import {
  PLAN_COMPLETION_DENOMINATOR_EXPLANATION,
  planCompletionExplanation,
  planCompletionFigure,
  planConflictNote,
  rejectedBuildListEntryLabel,
  UNKNOWN_REJECTED_REASON_LABEL,
} from './productionPlanCompletionPresentation'

/** The overview words of Issue #121 (`docs/UI_FLOW.md` 11.0) over hand-made Domain summaries. */

const ids = (count: number): TargetWeaponId[] =>
  Array.from({ length: count }, (_, index) => `target.figure.${index}` as TargetWeaponId)

function determined(completed: number, notCreated: number, isProvisional = false): ProductionPlanCompletionSummary {
  return {
    status: 'ratio_determined',
    completedTargetWeaponIds: ids(completed),
    completedCount: completed,
    causeBreakdown: { conflictNotCreatedTargetWeaponIds: ids(notCreated), unestablishedNotCreatedTargetWeaponIds: [] },
    conflictNotCreatedCount: notCreated,
    isProvisional,
  }
}

function undeterminable(
  completed: number,
  reason: ProductionPlanCompletionRatioUndeterminableReason,
  isProvisional = false,
): ProductionPlanCompletionSummary {
  return {
    status: 'ratio_undeterminable',
    reason,
    completedTargetWeaponIds: ids(completed),
    completedCount: completed,
    causeBreakdown: null,
    isProvisional,
  }
}

describe('planCompletionFigure (UI_FLOW 11.0)', () => {
  it('shows N / (N + M) with the conflict count in the detail and the meaning in words for a screen reader', () => {
    expect(planCompletionFigure(determined(17, 18))).toEqual({
      value: '17 / 35本',
      numeric: true,
      accessibleValue: '完成予定17本、競合のため今回作成しない18本を含めて合計35本',
      detail: '競合のため今回作成しない18本を含む',
    })
  })

  it('shows N / N when no conflict leaves a Target out', () => {
    expect(planCompletionFigure(determined(3, 0))).toEqual({
      value: '3 / 3本',
      numeric: true,
      accessibleValue: '完成予定3本、合計3本',
      detail: '競合のため作成しない目標武器はありません',
    })
  })

  it('shows 0本 when the Plan completes nothing and no conflict leaves anything out', () => {
    expect(planCompletionFigure(determined(0, 0))).toEqual({
      value: '0本',
      numeric: true,
      accessibleValue: null,
      detail: '競合のため作成しない目標武器はありません',
    })
  })

  it('says 暫定 in text first while a Conflict has no decision', () => {
    expect(planCompletionFigure(determined(1, 2, true)).detail).toBe('暫定・競合のため今回作成しない2本を含む')
    expect(planCompletionFigure(determined(0, 0, true)).detail).toBe('暫定・競合のため作成しない目標武器はありません')
    expect(planCompletionFigure(undeterminable(4, 'conflict_cause_not_established', true)).detail)
      .toBe('暫定・競合による未完成数：確認できません')
  })

  it('shows N only, never a guessed ratio, when the records cannot tell M', () => {
    expect(planCompletionFigure(undeterminable(4, 'rejection_details_not_recorded'))).toEqual({
      value: '4本',
      numeric: true,
      accessibleValue: null,
      detail: '競合による未完成数：確認できません',
    })
  })

  it('keeps the legacy unknown, provisional or not', () => {
    expect(planCompletionFigure({ status: 'completion_unknown', isProvisional: true })).toEqual({
      value: '不明（旧形式の計画）',
      numeric: false,
      accessibleValue: null,
      detail: null,
    })
  })

  it('groups three-digit and larger numbers', () => {
    expect(planCompletionFigure(determined(999, 1001)).value).toBe('999 / 2,000本')
  })
})

describe('planCompletionExplanation (UI_FLOW 11.0)', () => {
  it('explains the denominator whenever a ratio is shown', () => {
    expect(planCompletionExplanation(determined(17, 18), 'draft')).toBe(PLAN_COMPLETION_DENOMINATOR_EXPLANATION)
    expect(planCompletionExplanation(determined(2, 0), 'completed')).toBe(PLAN_COMPLETION_DENOMINATOR_EXPLANATION)
    expect(PLAN_COMPLETION_DENOMINATOR_EXPLANATION).toContain('作成リストの登録数ではなく')
    expect(PLAN_COMPLETION_DENOMINATOR_EXPLANATION).toContain('競合以外の理由')
  })

  it('says nothing for 0本 or a legacy Plan', () => {
    expect(planCompletionExplanation(determined(0, 0), 'draft')).toBeNull()
    expect(planCompletionExplanation({ status: 'completion_unknown', isProvisional: false }, 'draft')).toBeNull()
  })

  it.each([
    ['calculation_version_unsupported', 'この計画は以前の計算方式で作成されたため、競合のため作成しない目標武器の数を確認できません。'],
    ['rejection_details_not_recorded', 'この計画は、競合のため作成しない目標武器とその原因を記録する前に保存されたため、その数を確認できません。'],
    ['conflict_cause_not_established', '計画の途中で作成手順が行き詰まったため作成しない目標武器があり、ほかの目標武器との競合によるものか確認できないため、競合のため作成しない目標武器の数を確認できません。'],
    ['unknown_rejection_reason', '採用されなかった理由を確認できない候補があるため、競合のため作成しない目標武器の数を確認できません。'],
  ] as const)('says why %s shows no ratio', (reason, text) => {
    expect(planCompletionExplanation(undeterminable(1, reason), 'active')).toBe(text)
  })

  it('points a draft without recorded details to making it again', () => {
    expect(planCompletionExplanation(undeterminable(1, 'rejection_details_not_recorded'), 'draft'))
      .toMatch(/作成リスト画面から生産計画を作り直すと確認できます。$/)
  })
})

describe('planConflictNote (UI_FLOW 11.0)', () => {
  it('keeps the record count apart from the number of Targets left out', () => {
    const note = planConflictNote(determined(17, 18), 3, false)
    expect(note).toContain('この計画には競合が3件記録されています。')
    expect(note).toContain('件数は競合の記録数で、作成できない目標武器の数ではありません。')
    expect(note).toContain('競合のため、この計画では18本の目標武器を作成しません（競合の件数と同じ数になるとは限りません）。')
    expect(note).not.toContain('暫定')
  })

  it('never names a number when the records cannot tell it', () => {
    for (const summary of [undeterminable(2, 'conflict_cause_not_established'), { status: 'completion_unknown', isProvisional: false } as const]) {
      const note = planConflictNote(summary, 2, false)
      expect(note).toContain('競合の扱いによっては、この計画では完成しない目標武器がある場合があります。')
      expect(note).not.toMatch(/\d+本/)
    }
  })

  it('says a provisional result can change in a draft that can still be decided', () => {
    expect(planConflictNote(determined(1, 1, true), 1, true)).toContain(
      '未選択の競合があるため、完成予定数は暫定的な結果です。「競合と解決」で優先する候補を選ぶと変わる場合があります。',
    )
  })

  it('says the Planner made the provisional choice everywhere else', () => {
    const note = planConflictNote(determined(1, 1, true), 1, false)
    expect(note).toContain('未選択の競合は、計画を作成したときにPlannerが暫定的に作成する候補を決めた結果です（優先する候補をユーザーが選んだ結果ではありません）。')
    expect(note).not.toContain('選ぶと変わる場合があります')
  })

  it('adds no provisional wording to a legacy Plan whose count is unknown', () => {
    expect(planConflictNote({ status: 'completion_unknown', isProvisional: true }, 1, true)).not.toContain('暫定')
  })
})

describe('rejectedBuildListEntryLabel (UI_FLOW 11.6.5)', () => {
  const record = (fields: Partial<RejectedBuildListEntry>): RejectedBuildListEntry => ({
    buildListEntryId: 'build-list.label' as never,
    reason: 'resource_conflict',
    detail: 'internal',
    ...fields,
  })

  it('says a recorded resource_conflict by its cause and never calls a stuck drop a conflict', () => {
    expect(rejectedBuildListEntryLabel(record({ resourceConflictCause: 'explicit_resolution_not_selected' })))
      .toBe('競合で別の候補を優先したため、採用されませんでした')
    expect(rejectedBuildListEntryLabel(record({ resourceConflictCause: 'provisional_outcome_not_committed' })))
      .toContain('暫定的に別の候補を作成予定にした')
    for (const cause of ['stuck_drop_without_other_routes', 'stuck_drop_with_other_routes'] as const) {
      const label = rejectedBuildListEntryLabel(record({ resourceConflictCause: cause }))
      expect(label).toContain('計画の途中')
      expect(label).not.toContain('資源')
    }
    expect(rejectedBuildListEntryLabel(record({ resourceConflictCause: 'stuck_drop_with_other_routes' })))
      .toContain('競合によるものかは確認できません')
  })

  it('keeps the reason label of a record saved before the cause, and never guesses an unknown literal', () => {
    expect(rejectedBuildListEntryLabel(record({}))).toBe('他の候補と資源（RNG位置または所持武器）が競合しました')
    expect(rejectedBuildListEntryLabel(record({ reason: 'already_satisfied' }))).toBe('目標武器はすでに満たされています')
    expect(rejectedBuildListEntryLabel(record({ resourceConflictCause: 'future_cause' as never }))).toBe(UNKNOWN_REJECTED_REASON_LABEL)
    expect(rejectedBuildListEntryLabel(record({ reason: 'future_reason' as never }))).toBe(UNKNOWN_REJECTED_REASON_LABEL)
  })
})
