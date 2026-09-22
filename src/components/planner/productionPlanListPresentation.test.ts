import { describe, expect, it } from 'vitest'
import type {
  PlanStep,
  ProductionPlan,
  ProductionPlanAbandonmentReason,
  ProductionPlanStatus,
  RecalculationReason,
} from '../../domain/models/publicTypes'
import { productionPlanAbandonmentReasons } from '../../domain/models/publicTypes'
import {
  createValidProductionPlan,
  DOMAIN_FIXTURE_TIME,
  planStepId,
  productionPlanId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  productionPlanAbandonmentReasonLabels,
  productionPlanRecalculationReasonLabels,
  productionPlanStatusLabels,
} from '../../presentation/labels'
import {
  createProductionPlanListItemPresentation,
  formatProductionPlanListDateTime,
  productionPlanStatusTones,
  sortProductionPlansForList,
} from './productionPlanListPresentation'

function steps(count: number, completed: number): PlanStep[] {
  const template = createValidProductionPlan().steps[0]
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: planStepId(`step.list.${index + 1}`),
    order: index + 1,
    isCompleted: index < completed,
    completedAt: index < completed ? DOMAIN_FIXTURE_TIME : null,
  }))
}

function plan(
  id: string,
  overrides: Partial<ProductionPlan> = {},
): ProductionPlan {
  return {
    ...createValidProductionPlan(),
    id: productionPlanId(id),
    ...overrides,
  }
}

const allRecalculationReasons: RecalculationReason[] = [
  'rng_state_changed',
  'normal_counter_changed',
  'target_changed',
  'build_list_changed',
  'owned_weapon_changed',
  'calculation_context_changed',
  'unexpected_result',
  'execution_operation_uncertain',
  'planned_candidate_not_secured',
  'different_candidate_secured',
  'manual_recalculate',
]

describe('sortProductionPlansForList', () => {
  it('orders by updatedAt descending, then createdAt descending, then id, without mutating the input', () => {
    const input = [
      plan('plan.c', { updatedAt: '2026-09-20T00:00:00.000Z', createdAt: '2026-09-19T00:00:00.000Z' }),
      plan('plan.b', { updatedAt: '2026-09-22T00:00:00.000Z', createdAt: '2026-09-18T00:00:00.000Z' }),
      plan('plan.a', { updatedAt: '2026-09-22T00:00:00.000Z', createdAt: '2026-09-18T00:00:00.000Z' }),
      plan('plan.d', { updatedAt: '2026-09-22T00:00:00.000Z', createdAt: '2026-09-21T00:00:00.000Z' }),
    ]
    const snapshot = structuredClone(input)

    expect(sortProductionPlansForList(input).map(({ id }) => id)).toEqual([
      'plan.d',
      'plan.a',
      'plan.b',
      'plan.c',
    ])
    expect(input).toEqual(snapshot)
  })
})

describe('createProductionPlanListItemPresentation', () => {
  it('names every status with its user-facing label and tone, and reads abandoned as 終了', () => {
    const statuses: ProductionPlanStatus[] = ['draft', 'active', 'stale', 'completed', 'abandoned']
    for (const status of statuses) {
      const item = createProductionPlanListItemPresentation(plan(`plan.${status}`, {
        status,
        abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
        abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
      }))
      expect(item.statusLabel).toBe(productionPlanStatusLabels[status])
      expect(item.statusTone).toBe(productionPlanStatusTones[status])
    }
    expect(productionPlanStatusLabels.abandoned).toBe('終了')
    expect(productionPlanStatusTones).toEqual({
      draft: 'info',
      active: 'positive',
      stale: 'caution',
      completed: 'positive',
      abandoned: 'neutral',
    })
  })

  it('marks only the Draft as the current Draft, deletable, and only an active Plan as resumable', () => {
    const draft = createProductionPlanListItemPresentation(plan('plan.draft'))
    expect(draft.statusNote).toBe('現在の下書き')
    expect(draft.canDeleteDraft).toBe(true)
    expect(draft.canResumeExecution).toBe(false)

    const active = createProductionPlanListItemPresentation(plan('plan.active', { status: 'active' }))
    expect(active.statusNote).toBeNull()
    expect(active.canDeleteDraft).toBe(false)
    expect(active.canResumeExecution).toBe(true)

    for (const status of ['stale', 'completed', 'abandoned'] as const) {
      const item = createProductionPlanListItemPresentation(plan(`plan.${status}`, {
        status,
        abandonmentReason: status === 'abandoned' ? 'replan_adopted' : null,
        abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
      }))
      expect(item.canDeleteDraft).toBe(false)
      expect(item.canResumeExecution).toBe(false)
    }
  })

  it('shows every recalculation reason of a stale Plan as typed text, deduplicated, never as a raw enum', () => {
    const item = createProductionPlanListItemPresentation(plan('plan.stale', {
      status: 'stale',
      recalculationReasons: [...allRecalculationReasons, 'unexpected_result'],
    }))
    expect(item.reasonLabels).toEqual(
      allRecalculationReasons.map((reason) => productionPlanRecalculationReasonLabels[reason]),
    )
    for (const reason of allRecalculationReasons) {
      expect(item.reasonLabels).not.toContain(reason)
      expect(productionPlanRecalculationReasonLabels[reason]).not.toMatch(/_/)
    }
  })

  it('says so when a stale Plan carries no recorded reason', () => {
    const item = createProductionPlanListItemPresentation(plan('plan.stale.none', {
      status: 'stale',
      recalculationReasons: [],
    }))
    expect(item.reasonLabels).toEqual(['再計算理由の記録がありません'])
  })

  it('shows every abandonment reason as its typed label', () => {
    const reasons: readonly ProductionPlanAbandonmentReason[] = productionPlanAbandonmentReasons
    expect(reasons).toHaveLength(4)
    for (const reason of reasons) {
      const item = createProductionPlanListItemPresentation(plan(`plan.abandoned.${reason}`, {
        status: 'abandoned',
        abandonmentReason: reason,
        abandonedAt: DOMAIN_FIXTURE_TIME,
      }))
      expect(item.reasonLabels).toEqual([productionPlanAbandonmentReasonLabels[reason]])
      expect(item.reasonLabels[0]).not.toBe(reason)
    }
  })

  it('shows no reason for a draft, active or completed Plan', () => {
    for (const status of ['draft', 'active', 'completed'] as const) {
      const item = createProductionPlanListItemPresentation(plan(`plan.${status}`, {
        status,
        // A stale reason left on a non-stale Plan is not shown as its reason.
        recalculationReasons: ['rng_state_changed'],
      }))
      expect(item.reasonLabels).toEqual([])
    }
  })

  it('counts the completed and total Steps from the persisted Steps', () => {
    const item = createProductionPlanListItemPresentation(plan('plan.progress', {
      status: 'active',
      steps: steps(24, 8),
      currentStepId: planStepId('step.list.9'),
    }))
    expect(item.completedStepCount).toBe(8)
    expect(item.totalStepCount).toBe(24)
  })

  it('takes the Target count from the Plan summary, not from selectedBuildListEntryIds', () => {
    const [first, second, third] = steps(3, 0)
    const item = createProductionPlanListItemPresentation(plan('plan.targets', {
      steps: [
        { ...first, targetWeaponId: targetWeaponId('target.list.a') },
        { ...second, targetWeaponId: targetWeaponId('target.list.b') },
        { ...third, targetWeaponId: targetWeaponId('target.list.a') },
      ],
      currentStepId: first.id,
      selectedBuildListEntryIds: [],
    }))
    expect(item.targetWeaponCount).toBe(2)
  })

  it('keeps the persisted timestamps and formats them for reading, leaving an unparseable value as stored', () => {
    const item = createProductionPlanListItemPresentation(plan('plan.time', {
      createdAt: '2026-09-18T20:00:00.000Z',
      updatedAt: '2026-09-22T08:00:00.000Z',
    }))
    expect(item.createdAt).toBe('2026-09-18T20:00:00.000Z')
    expect(item.updatedAt).toBe('2026-09-22T08:00:00.000Z')
    expect(item.createdAtLabel).toBe(formatProductionPlanListDateTime('2026-09-18T20:00:00.000Z'))
    expect(item.updatedAtLabel).toBe(formatProductionPlanListDateTime('2026-09-22T08:00:00.000Z'))
    expect(item.updatedAtLabel).toMatch(/2026/)
    expect(item.updatedAtLabel).not.toBe(item.updatedAt)
    expect(formatProductionPlanListDateTime('not-a-date')).toBe('not-a-date')
  })
})
