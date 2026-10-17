import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/common'
import type { PlanConflict, PlanStep, ProductionPlan, RejectedBuildListEntry } from '../../domain/models/publicTypes'
import {
  buildListEntryId,
  createValidProductionPlan,
  planStepId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { ProductionPlanSummary } from './ProductionPlanSummary'

/**
 * The Plan overview's 「完成予定の目標武器数」 (Issue #121, `docs/UI_FLOW.md`
 * 11.0): `N / (N + M)本` from the shared Domain summary, its detail line, the
 * screen reader wording of the ratio, the explanation under the figures and
 * the Conflict note.
 */

const entry = (index: number) => buildListEntryId(`build-list.overview.${index}`)
const target = (index: number) => targetWeaponId(`target.overview.${index}`)

/** A current-schema Plan completing `completed` Targets and leaving `lost` out through provisional conflict outcomes. */
function overviewPlan(completed: number, lost: number, options: { decided?: boolean } = {}): ProductionPlan {
  const base = createValidProductionPlan()
  const steps: PlanStep[] = Array.from({ length: Math.max(completed, 1) }, (_, index) => ({
    ...structuredClone(base.steps[0]),
    id: planStepId(`step.overview.${index}`),
    order: index + 1,
    progressedTargetWeaponIds: index < completed ? [target(index)] : [],
    executionEffects: {
      trackedOwnedWeaponId: null,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: index < completed
        ? [{ buildListEntryId: entry(index), targetWeaponId: target(index), ownedWeaponId: 'owned.overview' as never }]
        : [],
    },
  }))
  const conflicts: PlanConflict[] = Array.from({ length: lost }, (_, index) => ({
    id: `conflict.overview.${index}`,
    kind: 'same_gogma_counter',
    buildListEntryIds: [entry(index % Math.max(completed, 1)), entry(1000 + index)],
    reason: 'internal',
    recommendedBuildListEntryId: entry(index % Math.max(completed, 1)),
    selectedBuildListEntryId: options.decided ? entry(index % Math.max(completed, 1)) : null,
    resolutionNote: null,
    checkpointParticipants: [],
  }))
  const rejectedBuildListEntries: RejectedBuildListEntry[] = Array.from({ length: lost }, (_, index) => ({
    buildListEntryId: entry(1000 + index),
    targetWeaponId: target(1000 + index),
    reason: 'resource_conflict',
    resourceConflictCause: options.decided ? 'explicit_resolution_not_selected' : 'provisional_outcome_not_committed',
    detail: 'internal',
  }))
  return {
    ...base,
    calculationContext: { ...base.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION },
    steps,
    conflicts,
    rejectedBuildListEntries,
    selectedBuildListEntryIds: Array.from({ length: completed }, (_, index) => entry(index)),
  }
}

function completionFigure(): HTMLElement {
  const value = screen.getByText('完成予定の目標武器数').nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error('Missing the completion figure value.')
  return value
}

describe('ProductionPlanSummary completion figure (Issue #121)', () => {
  it('shows 17 / 35本, says what each side means in words, and explains the denominator', () => {
    render(<ProductionPlanSummary plan={overviewPlan(17, 18)} conflictPreferenceAvailable />)
    const figure = completionFigure()
    // The `/` value is visual; a screen reader reads the sentence instead.
    expect(within(figure).getByText('17 / 35本')).toHaveAttribute('aria-hidden', 'true')
    expect(within(figure).getByText('完成予定17本、競合のため今回作成しない18本を含めて合計35本')).toBeInTheDocument()
    expect(within(figure).getByText('暫定・競合のため今回作成しない18本を含む')).toBeInTheDocument()
    expect(screen.getByText(/^完成予定の目標武器数の「\/」の右側は、完成予定の本数と、競合のため今回作成しない本数の合計です。/))
      .toBeInTheDocument()

    const overview = screen.getByRole('region', { name: '計画の概要' })
    const note = within(overview).getByRole('note')
    expect(note).toHaveTextContent('この計画には競合が18件記録されています。')
    expect(note).toHaveTextContent('競合のため、この計画では18本の目標武器を作成しません')
    expect(note).toHaveTextContent('「競合と解決」で優先する候補を選ぶと変わる場合があります。')
    // The Conflict record count stays its own figure, in 件.
    expect(within(overview).getByText('競合（記録件数）').nextElementSibling).toHaveTextContent('18件')
  })

  it('says the Planner made the provisional choice where nothing can be preferred', () => {
    render(<ProductionPlanSummary plan={{ ...overviewPlan(2, 1), status: 'active' }} />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Plannerが暫定的に作成する候補を決めた結果です（優先する候補をユーザーが選んだ結果ではありません）。')
    expect(note).not.toHaveTextContent('選ぶと変わる場合があります')
  })

  it.each(['active', 'completed', 'stale', 'abandoned'] as const)(
    'reads the same planned contents for a %s Plan, never its execution progress',
    (status) => {
      const plan: ProductionPlan = { ...overviewPlan(2, 1), status }
      plan.steps[0].isCompleted = true
      render(<ProductionPlanSummary plan={plan} />)
      const figure = completionFigure()
      expect(within(figure).getByText('2 / 3本')).toBeInTheDocument()
      expect(within(figure).getByText('暫定・競合のため今回作成しない1本を含む')).toBeInTheDocument()
      expect(screen.getByRole('note')).toHaveTextContent('Plannerが暫定的に作成する候補を決めた結果です')
    },
  )

  it('shows N / N with no provisional marker when every Conflict is decided', () => {
    const plan = overviewPlan(3, 0)
    render(<ProductionPlanSummary plan={plan} />)
    const figure = completionFigure()
    expect(within(figure).getByText('3 / 3本')).toBeInTheDocument()
    expect(within(figure).getByText('完成予定3本、合計3本')).toBeInTheDocument()
    expect(within(figure).getByText('競合のため作成しない目標武器はありません')).toBeInTheDocument()
    expect(figure.textContent).not.toContain('暫定')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows N only with the typed reason when the records cannot tell the conflict count', () => {
    const plan = overviewPlan(4, 2)
    delete plan.rejectedBuildListEntries[0].resourceConflictCause
    render(<ProductionPlanSummary plan={plan} />)
    const figure = completionFigure()
    expect(figure).toHaveTextContent('4本暫定・競合による未完成数：確認できません')
    expect(figure.textContent).not.toContain('/')
    expect(screen.getByText(/^この計画は、競合のため作成しない目標武器とその原因を記録する前に保存されたため、その数を確認できません。/))
      .toBeInTheDocument()
    expect(screen.getByRole('note').textContent).not.toMatch(/\d+本/)
  })

  it('keeps a legacy Plan unknown', () => {
    const plan = overviewPlan(1, 1)
    delete (plan.steps[0] as Partial<PlanStep>).executionEffects
    render(<ProductionPlanSummary plan={plan} />)
    expect(completionFigure().textContent).toBe('不明（旧形式の計画）')
    expect(screen.queryByText(/「\/」の右側/)).not.toBeInTheDocument()
  })

  it('keeps three-digit figures in text that can wrap', () => {
    render(<ProductionPlanSummary plan={overviewPlan(120, 130, { decided: true })} />)
    const figure = completionFigure()
    expect(within(figure).getByText('120 / 250本')).toBeInTheDocument()
    expect(within(figure).getByText('競合のため今回作成しない130本を含む')).toBeInTheDocument()
    expect(figure.textContent).not.toContain('暫定')
  })
})
