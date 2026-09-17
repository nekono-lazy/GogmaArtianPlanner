import type {
  CalculationContext,
  ISODateTimeString,
  ProductionPlan,
} from '../models/publicTypes'
import { validateProductionPlan } from '../models/publicTypes'
import { executionFailure } from './executionRuntimeError'
import {
  assertExecutableProductionPlan,
  assertPlanDependenciesUnchanged,
  collectPlanObservationBindings,
  createActualExecutionState,
  executionStateMatches,
  requireCurrentPlanStep,
  type ExecutionPersistedState,
} from './planExecutionState'

export interface ProductionPlanStartInput {
  plan: ProductionPlan
  /** Every persisted Plan whose status is `active` or `stale`. */
  runningPlans: readonly ProductionPlan[]
  state: ExecutionPersistedState
  currentCalculationContext: CalculationContext
  now: ISODateTimeString
}

/**
 * Starts executing a draft Plan (`docs/PLANNER_SPEC.md` 16.2).
 *
 * Starting performs no game operation, so the only change is
 * `draft -> active`: no Counter advances, no OwnedWeapon or Target changes, no
 * weapon becomes in progress, and no ExecutionHistory is recorded. It is
 * refused unless the Plan is an executable current Plan, no other Plan is
 * running, its Plan-dependent premises are unchanged, and the persisted state
 * equals its first Step's `expectedStateBefore`.
 */
export function prepareProductionPlanStart(input: ProductionPlanStartInput): ProductionPlan {
  const { plan, state, now } = input
  if (plan.status !== 'draft') {
    executionFailure(
      'plan_not_startable',
      `ProductionPlan '${plan.id}' is '${plan.status}'; only a draft Plan can start.`,
    )
  }
  if (plan.steps.length === 0 || plan.currentStepId === null) {
    executionFailure(
      'plan_not_startable',
      `ProductionPlan '${plan.id}' has no Step to execute.`,
    )
  }
  assertExecutableProductionPlan(plan, input.currentCalculationContext)
  const otherRunning = input.runningPlans.filter(({ id }) => id !== plan.id)
  if (otherRunning.length > 0) {
    executionFailure(
      'running_plan_conflict',
      `ProductionPlan '${otherRunning[0].id}' is already running (${otherRunning[0].status}).`,
    )
  }
  const step = requireCurrentPlanStep(plan, plan.currentStepId)
  assertPlanDependenciesUnchanged(plan, state.targetWeapons, state.buildListEntries)
  const actual = createActualExecutionState(
    plan,
    state,
    collectPlanObservationBindings(plan, state.planExecutionHistory),
  )
  if (!executionStateMatches(actual, step.expectedStateBefore)) {
    executionFailure(
      'execution_state_mismatch',
      `The current RNG, Normal Counter, OwnedWeapon or Plan-dependent Target state differs from the expected state before PlanStep '${step.id}'.`,
    )
  }
  const started: ProductionPlan = { ...structuredClone(plan), status: 'active', updatedAt: now }
  const validation = validateProductionPlan(started)
  if (!validation.isValid) {
    executionFailure(
      'entity_validation_failed',
      `The started ProductionPlan '${plan.id}' fails Domain validation.`,
      validation.issues,
    )
  }
  return started
}
