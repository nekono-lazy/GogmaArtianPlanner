import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  PlannerWhatIfCalculationResult,
  PlannerWhatIfInvalidFixedResolutionReason,
  PlannerWhatIfOutcome,
} from '../../domain/planner'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidTargetWeapon,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { ProductionPlanWhatIfComparison } from './ProductionPlanWhatIfComparison'

function found(
  estimatedOperationCount: number,
  estimatedNormalAdvance: number | null,
): PlannerWhatIfOutcome {
  return {
    status: 'found',
    distance: {
      estimatedOperationCount,
      estimatedGogmaAdvance: 4,
      estimatedSkillAdvance: 3,
      estimatedNormalAdvance,
    },
  }
}

describe('ProductionPlanWhatIfComparison', () => {
  it('keeps alternative order and presents Practical and Ideal independently', () => {
    const firstTarget = createValidTargetWeapon()
    firstTarget.id = targetWeaponId('target.what-if.first')
    firstTarget.name = 'First alternative'
    const secondTarget = structuredClone(firstTarget)
    secondTarget.id = targetWeaponId('target.what-if.second')
    secondTarget.name = 'Second alternative'
    const result: PlannerWhatIfCalculationResult = {
      status: 'completed',
      comparison: {
        conflictKey: 'conflict.what-if',
        fixedBuildListEntryId: buildListEntryId('build-list.fixed'),
        fixedTargetWeaponId: targetWeaponId('target.fixed'),
        alternatives: [
          {
            targetWeaponId: secondTarget.id,
            practical: found(12, null),
            ideal: { status: 'stopped_by_candidate_trial_bound' },
          },
          {
            targetWeaponId: firstTarget.id,
            practical: { status: 'not_found_within_search_extent' },
            ideal: found(21, 5),
          },
        ],
      },
    }

    render(
      <ProductionPlanWhatIfComparison
        result={result}
        targetWeapons={[firstTarget, secondTarget]}
      />,
    )

    expect(screen.getAllByRole('heading', { level: 5 }).map(({ textContent }) =>
      textContent)).toEqual(['Second alternative', 'First alternative'])
    const targetCards = screen.getAllByRole('heading', { level: 5 })
      .map((heading) => heading.parentElement)
    expect(targetCards[0]).not.toBeNull()
    expect(within(targetCards[0]!).getByText('Practical')).toBeInTheDocument()
    expect(within(targetCards[0]!).getByText('Ideal')).toBeInTheDocument()
    expect(within(targetCards[0]!).getByText('必要操作数: 12')).toBeInTheDocument()
    expect(within(targetCards[0]!).getByText('巨戟進行量: +4')).toBeInTheDocument()
    expect(within(targetCards[0]!).getByText('スキル進行量: +3')).toBeInTheDocument()
    expect(within(targetCards[0]!).getByText('通常進行量: 対象外')).toBeInTheDocument()
    expect(within(targetCards[1]!).getByText('必要操作数: 21')).toBeInTheDocument()
    expect(within(targetCards[1]!).getByText('通常進行量: +5')).toBeInTheDocument()
  })

  it('shows all four no-result statuses with distinct wording', () => {
    const firstTarget = createValidTargetWeapon()
    firstTarget.id = targetWeaponId('target.no-result.first')
    const secondTarget = structuredClone(firstTarget)
    secondTarget.id = targetWeaponId('target.no-result.second')
    const result: PlannerWhatIfCalculationResult = {
      status: 'completed',
      comparison: {
        conflictKey: 'conflict.no-result',
        fixedBuildListEntryId: buildListEntryId('build-list.fixed'),
        fixedTargetWeaponId: targetWeaponId('target.fixed'),
        alternatives: [
          {
            targetWeaponId: firstTarget.id,
            practical: { status: 'not_found_within_search_extent' },
            ideal: { status: 'stopped_by_enumeration_bound' },
          },
          {
            targetWeaponId: secondTarget.id,
            practical: { status: 'stopped_by_candidate_trial_bound' },
            ideal: { status: 'stopped_by_planner_rerun_bound' },
          },
        ],
      },
    }

    render(
      <ProductionPlanWhatIfComparison
        result={result}
        targetWeapons={[firstTarget, secondTarget]}
      />,
    )

    expect(screen.getByText('探索範囲内に実行可能な候補なし')).toBeInTheDocument()
    expect(screen.getByText('探索範囲上限のため未確認')).toBeInTheDocument()
    expect(screen.getByText('候補試行上限のため未確認')).toBeInTheDocument()
    expect(screen.getByText('Planner再計算上限のため未確認')).toBeInTheDocument()
  })

  it('shows planner_input_not_ready diagnostics as a typed failure', () => {
    const excluded = createValidBuildListEntry()
    const result: PlannerWhatIfCalculationResult = {
      status: 'planner_input_not_ready',
      issues: [{
        path: 'what-if.input',
        code: 'invalid_integer',
        message: 'Typed input issue',
      }],
      warnings: [{
        kind: 'build_list_entry_stale',
        message: 'Typed input warning',
      }],
      excludedBuildListEntries: [{
        entry: excluded,
        reason: 'Typed exclusion reason',
      }],
    }

    render(
      <ProductionPlanWhatIfComparison result={result} targetWeapons={[]} />,
    )

    expect(screen.getByText('Planner入力を準備できませんでした')).toBeInTheDocument()
    expect(screen.getByText('Typed input issue')).toBeInTheDocument()
    expect(screen.getByText('Typed input warning')).toBeInTheDocument()
    expect(screen.getByText('Typed exclusion reason')).toBeInTheDocument()
  })

  it.each<[PlannerWhatIfInvalidFixedResolutionReason, string]>([
    [
      'scenario_resolution_not_valid',
      '比較対象の候補は現在のPlanner入力では有効ではありません。',
    ],
    [
      'fixed_constraints_unresolved',
      '既存の明示選択を含む固定条件を解決できません。',
    ],
    [
      'scenario_constraint_missing',
      '比較対象の競合を現在の状態へ一意に対応付けできません。',
    ],
  ])('branches invalid_fixed_resolution on reason %s', (reason, message) => {
    const result: PlannerWhatIfCalculationResult = {
      status: 'invalid_fixed_resolution',
      reason,
      conflictKey: 'conflict.invalid',
      selectedBuildListEntryId: buildListEntryId('build-list.invalid'),
      detail: 'Diagnostics only: deliberately unrelated wording',
    }

    render(
      <ProductionPlanWhatIfComparison result={result} targetWeapons={[]} />,
    )

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByText('Diagnostics only: deliberately unrelated wording'))
      .toBeInTheDocument()
  })
})
