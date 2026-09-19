import { describe, expect, it } from 'vitest'
import type { PlannerOrchestrationResult } from '../planner'
import {
  createValidBuildListEntry,
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
 * with no Plan and nothing to persist is the ordinary no-Plan result.
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

function previewOf(result: Partial<PlannerOrchestrationResult>): ProductionPlanReplanPreview {
  const plan = draftPlan()
  return {
    runningPlanToken: { planId: productionPlanId('plan.replan.running'), status: 'active', currentStepId: planStepId('step.running') },
    result: {
      plan,
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
      generatedBuildListEntries: [],
      ...result,
    },
    calculationContext: { ...plan.calculationContext },
  }
}

describe('describeReplanPreviewAdoptability', () => {
  it('classifies a no-Plan incomplete search as incomplete, never as the ordinary no-Plan result', () => {
    const adoptability = describeReplanPreviewAdoptability(
      previewOf({ plan: null, generatedBuildListEntries: [], termination: incompletePlannerTermination() }),
    )
    expect(adoptability).toMatchObject({ adoptable: false, reason: 'incomplete_search' })
  })

  it('classifies a finished search with no Plan and nothing to persist as the ordinary no-Plan result', () => {
    const adoptability = describeReplanPreviewAdoptability(
      previewOf({ plan: null, generatedBuildListEntries: [], termination: exhaustedPlannerTermination() }),
    )
    expect(adoptability).toMatchObject({ adoptable: false, reason: 'no_plan' })
  })

  it('classifies a no-Plan result that still carries generated Entries as invalid', () => {
    const adoptability = describeReplanPreviewAdoptability(
      previewOf({ plan: null, generatedBuildListEntries: [createValidBuildListEntry()], termination: exhaustedPlannerTermination() }),
    )
    expect(adoptability).toMatchObject({ adoptable: false, reason: 'invalid_result' })
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
})
