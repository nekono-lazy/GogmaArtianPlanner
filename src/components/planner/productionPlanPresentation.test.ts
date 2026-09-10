import { describe, expect, it } from 'vitest'
import type {
  PlanStep,
  ProductionPlan,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import {
  createValidProductionPlan,
  planStepId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  createProductionPlanSummary,
  getPlanStepRelatedTargetWeaponIds,
  groupPlanStepsByTargetWeapon,
  isLegacyProductionPlan,
  isSharedPlanStep,
  orderPlanSteps,
} from './productionPlanPresentation'

const targetA = targetWeaponId('target.presentation.a')
const targetB = targetWeaponId('target.presentation.b')

function step(
  id: string,
  order: number,
  primary: TargetWeaponId | null,
  progressed: TargetWeaponId[] | undefined,
  shouldSecure = false,
): PlanStep {
  const base = createValidProductionPlan().steps[0]
  const next: PlanStep = {
    ...base,
    id: planStepId(id),
    order,
    targetWeaponId: primary,
    expectedResult: base.expectedResult
      ? { ...base.expectedResult, shouldSecure }
      : null,
  }
  if (progressed === undefined) delete next.progressedTargetWeaponIds
  else next.progressedTargetWeaponIds = progressed
  return next
}

function planWith(steps: PlanStep[]): ProductionPlan {
  return { ...createValidProductionPlan(), steps }
}

describe('productionPlanPresentation', () => {
  it('orders the persisted steps by order without mutating the Plan', () => {
    const plan = planWith([
      step('step.second', 2, targetA, []),
      step('step.first', 1, targetA, []),
    ])

    expect(orderPlanSteps(plan).map(({ order }) => order)).toEqual([1, 2])
    expect(plan.steps.map(({ order }) => order)).toEqual([2, 1])
  })

  it('unions the shared and primary attribution without duplicating a Target', () => {
    const shared = step('step.shared', 1, targetA, [targetA, targetB])

    expect(getPlanStepRelatedTargetWeaponIds(shared)).toEqual([targetA, targetB])
    expect(isSharedPlanStep(shared)).toBe(true)
  })

  it('keeps a Route-progressing shared Step in every progressed Target route and once in the timeline', () => {
    const shared = step('step.shared', 1, targetA, [targetA, targetB])
    const plan = planWith([shared])

    expect(groupPlanStepsByTargetWeapon(plan)).toEqual([
      { targetWeaponId: targetA, steps: [shared] },
      { targetWeaponId: targetB, steps: [shared] },
    ])
    expect(orderPlanSteps(plan)).toEqual([shared])
  })

  it('keeps a primary Step with no Route progression in its own Target route', () => {
    const primaryOnly = step('step.primary', 1, targetA, [])
    const plan = planWith([primaryOnly])

    expect(isSharedPlanStep(primaryOnly)).toBe(false)
    expect(groupPlanStepsByTargetWeapon(plan)).toEqual([
      { targetWeaponId: targetA, steps: [primaryOnly] },
    ])
  })

  it('excludes a Target-independent Step from the Target routes but not the timeline', () => {
    const independent = step('step.independent', 1, null, [])
    const plan = planWith([independent])

    expect(getPlanStepRelatedTargetWeaponIds(independent)).toEqual([])
    expect(groupPlanStepsByTargetWeapon(plan)).toEqual([])
    expect(orderPlanSteps(plan)).toEqual([independent])
  })

  it('keeps only the primary attribution of a legacy Step and infers no shared Target', () => {
    const legacy = step('step.legacy', 1, targetA, undefined)
    const plan = planWith([legacy])

    expect(isLegacyProductionPlan(plan)).toBe(true)
    expect(legacy.progressedTargetWeaponIds).toBeUndefined()
    expect(getPlanStepRelatedTargetWeaponIds(legacy)).toEqual([targetA])
    expect(groupPlanStepsByTargetWeapon(plan)).toEqual([
      { targetWeaponId: targetA, steps: [legacy] },
    ])
  })

  it('treats a Plan whose every Step carries the field as non-legacy', () => {
    expect(isLegacyProductionPlan(planWith([step('step.a', 1, targetA, [])])))
      .toBe(false)
  })

  it('groups Target routes in global step order', () => {
    const first = step('step.first', 1, targetB, [targetB])
    const second = step('step.second', 2, targetA, [targetA, targetB])
    const plan = planWith([second, first])

    expect(groupPlanStepsByTargetWeapon(plan)).toEqual([
      { targetWeaponId: targetB, steps: [first, second] },
      { targetWeaponId: targetA, steps: [second] },
    ])
  })

  it('summarizes distinct Targets and only the Plan-declared secured steps', () => {
    const plan = planWith([
      step('step.a', 1, targetA, [targetA, targetB], true),
      step('step.b', 2, targetA, [], false),
      step('step.c', 3, null, [], true),
    ])
    plan.selectedBuildListEntryIds = []

    const summary = createProductionPlanSummary(plan)
    expect(summary.planId).toBe(plan.id)
    expect(summary.status).toBe(plan.status)
    expect(summary.createdAt).toBe(plan.createdAt)
    expect(summary.totalStepCount).toBe(3)
    expect(summary.targetWeaponCount).toBe(2)
    expect(summary.securedStepCount).toBe(2)
    expect(summary.isLegacy).toBe(false)
  })

  it('never counts a Step without an expected result as secured', () => {
    const withoutResult = step('step.a', 1, targetA, [])
    withoutResult.expectedResult = null

    expect(createProductionPlanSummary(planWith([withoutResult])).securedStepCount)
      .toBe(0)
  })
})
