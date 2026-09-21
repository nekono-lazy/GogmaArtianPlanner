import type {
  PlanBreakingChangeApproval,
  PlanBreakingChangeInspection,
  PlanBreakingReason,
} from '../../domain/execution'
import type { PlanStepId, ProductionPlanId } from '../../domain/models/publicTypes'

/** The inspection of a change that needs the breaking-change approval. */
export type RequiredPlanBreakingInspection = Extract<PlanBreakingChangeInspection, { approvalRequired: true }>

export const PLAN_BREAKING_FIXTURE_PLAN_ID = 'plan.fixture.active' as ProductionPlanId
export const PLAN_BREAKING_FIXTURE_RECORDED_AT = '2026-09-18T01:00:00.000Z'

/**
 * A breaking-change inspection as the runtime returns it (`docs/UI_FLOW.md`
 * 16.3), for UI tests that mock the guarded dependencies: the reasons, the
 * observed Plan token and, when asked for, the 16.10 save point choice.
 */
export function planBreakingInspection(
  options: { reasons?: PlanBreakingReason[]; savePoint?: boolean; currentStepId?: PlanStepId | null } = {},
): RequiredPlanBreakingInspection {
  const base = {
    approvalRequired: true as const,
    reasons: options.reasons ?? ['rng_state_changed' as const],
    observedPlan: {
      planId: PLAN_BREAKING_FIXTURE_PLAN_ID,
      status: 'active' as const,
      currentStepId: options.currentStepId === undefined ? ('step.fixture.2' as PlanStepId) : options.currentStepId,
      updatedAt: '2026-09-18T00:00:00.000Z',
    },
  }
  return options.savePoint
    ? {
        ...base,
        savePointChoiceRequired: true,
        savePointRecordedAt: PLAN_BREAKING_FIXTURE_RECORDED_AT,
        savePointLastExecutionHistoryId: null,
        savePointCurrentStepId: 'step.fixture.1' as PlanStepId,
      }
    : { ...base, savePointChoiceRequired: false }
}

/** The approval the screens must hand to the save for that inspection. */
export function planBreakingApproval(
  inspection: RequiredPlanBreakingInspection,
  decision: 'keep_current' | 'restore_save_point' | null = null,
): PlanBreakingChangeApproval {
  return {
    observedPlan: inspection.observedPlan,
    savePointDecision:
      inspection.savePointChoiceRequired && decision !== null
        ? { kind: decision, recordedAt: inspection.savePointRecordedAt }
        : null,
  }
}
