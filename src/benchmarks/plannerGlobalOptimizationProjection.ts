/** Research only. No persistence, no fabricated blind observations, no RNG scanner. */
import { applyExpectedStepTransition } from '../domain/execution/expectedStepConfirmation'
import { createMutableExecutionState } from '../domain/execution/stepExecution'
import { createActualExecutionState, executionStateMatches } from '../domain/execution/planExecutionState'
import { applyProductionPlanStartTargetLinks, deriveProductionPlanStartTargetLinks } from '../domain/planner/productionPlanStartEffects'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import type { ProductionPlan } from '../domain/models/publicTypes'
import { validateOwnedWeapon } from '../domain/models/publicTypes'

/** Replay the generated execution effects, keeping original weapon IDs and lifecycle semantics. */
export function projectGlobalResearchPlan(input: PlannerInput, plan: ProductionPlan, dependencies: PlannerDependencies): PlannerInput {
  const mutable = createMutableExecutionState({
    ownedWeapons: input.ownedWeapons,
    targetWeapons: applyProductionPlanStartTargetLinks(input.targetWeapons,
      deriveProductionPlanStartTargetLinks(plan.selectedBuildListEntryIds, input.buildListEntries)),
  })
  let counters = { rngState: structuredClone(input.rngState), normalCounters: structuredClone(input.normalCounters) }
  const snapshot = () => ({ ...counters, ownedWeapons: [...mutable.weapons.values()], targetWeapons: [...mutable.targets.values()],
    buildListEntries: input.buildListEntries, planExecutionHistory: [], executionSavePoint: null })
  const entryById = new Map(input.buildListEntries.map(entry => [entry.id, entry]))
  for (const step of plan.steps) {
    const effects = step.executionEffects
    if (!effects || effects.observationBinding !== null) throw new Error('Research projection requires predicted, current-contract Steps; blind observation is unavailable.')
    if (!executionStateMatches(createActualExecutionState(plan, snapshot(), []), step.expectedStateBefore)) {
      throw new Error(`Research projection before-state mismatch: ${step.id}`)
    }
    counters = applyExpectedStepTransition({ plan, now: dependencies.clock.now(), counterAuthority: dependencies.rngEngine,
      observation: null, validateResultingWeapon: weapon => validateOwnedWeapon(weapon).issues.map(issue => issue.message),
    }, { ...step, executionEffects: effects }, { ...counters, mutable, entryById })
    if (!executionStateMatches(createActualExecutionState(plan, snapshot(), []), step.expectedStateAfter)) {
      throw new Error(`Research projection after-state mismatch: ${step.id}`)
    }
  }
  return { ...input, ...counters, ownedWeapons: [...mutable.weapons.values()], targetWeapons: [...mutable.targets.values()], buildListEntries: [], conflictResolutions: [] }
}
