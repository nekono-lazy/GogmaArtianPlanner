import { describe, expect, it } from 'vitest'
import type { PlannerResult } from '../planner'
import {
  createValidProductionPlan,
  planStepId,
  productionPlanId,
} from '../../test/fixtures/domainData'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../../test/fixtures/plannerTermination'
import { describeReplanPreviewAdoptability, type ProductionPlanReplanPreview } from './replanAdoption'

/**
 * The replan Preview adoptability classification (`docs/PLANNER_SPEC.md` 16.8):
 * the typed termination of 7.2.1 is judged first, so an incomplete search is an
 * incomplete search whether or not a partial Plan exists; only a finished search
 * with no Plan is the ordinary no-Plan result. The Preview holds an ordinary
 * `PlannerResult` (Phase 6-A): no generated Entry or replacement exists on it.
 */

function draftPlan() {
  const base = createValidProductionPlan()
  return {
    ...base,
    id: productionPlanId('plan.replan.preview'),
    status: 'draft' as const,
    steps: base.steps.map((step) => ({
      ...step,
      progressedTargetWeaponIds: step.targetWeaponId === null ? [] : [step.targetWeaponId],
    })),
    conflicts: [],
  }
}

function previewOf(result: Partial<PlannerResult>): ProductionPlanReplanPreview {
  const plan = draftPlan()
  return {
    runningPlanToken: { planId: productionPlanId('plan.replan.running'), status: 'active', currentStepId: planStepId('step.running') },
    result: {
      plan,
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
      ...result,
    },
    calculationContext: { ...plan.calculationContext },
  }
}

describe('describeReplanPreviewAdoptability', () => {
  it('classifies a no-Plan incomplete search as incomplete, never as the ordinary no-Plan result', () => {
    const adoptability = describeReplanPreviewAdoptability(
      previewOf({ plan: null, termination: incompletePlannerTermination() }),
    )
    expect(adoptability).toMatchObject({ adoptable: false, reason: 'incomplete_search' })
  })

  it('classifies a finished search with no Plan as the ordinary no-Plan result', () => {
    const adoptability = describeReplanPreviewAdoptability(
      previewOf({ plan: null, termination: exhaustedPlannerTermination() }),
    )
    expect(adoptability).toMatchObject({ adoptable: false, reason: 'no_plan' })
  })

  it('classifies a partial Plan of an incomplete search as incomplete', () => {
    const adoptability = describeReplanPreviewAdoptability(previewOf({ termination: incompletePlannerTermination() }))
    expect(adoptability).toMatchObject({ adoptable: false, reason: 'incomplete_search' })
  })

  it('accepts a persistable draft Plan of a finished search', () => {
    const completed = describeReplanPreviewAdoptability(previewOf({}))
    expect(completed.adoptable).toBe(true)
    if (completed.adoptable) expect(completed.plan.id).toBe(productionPlanId('plan.replan.preview'))
    const exhausted = describeReplanPreviewAdoptability(previewOf({ termination: exhaustedPlannerTermination() }))
    expect(exhausted.adoptable).toBe(true)
  })

  it('classifies a Plan that fails the save-time shape checks as invalid', () => {
    const active = describeReplanPreviewAdoptability(previewOf({ plan: { ...draftPlan(), status: 'active' } }))
    expect(active).toMatchObject({ adoptable: false, reason: 'invalid_result' })
  })

  it('classifies an ordinary Plan carrying a repair lineage as invalid', () => {
    const withLineage = describeReplanPreviewAdoptability(
      previewOf({ plan: { ...draftPlan(), conflictRepairLineage: { decisions: [] } } }),
    )
    expect(withLineage).toMatchObject({ adoptable: false, reason: 'invalid_result' })
  })
})
