/**
 * Test-only helpers of the Phase D-1A Phase D' verification (Issue #154): handoffs of real materializations of the synthetic
 * scenarios (the runner's own handoff constructor over `materializeStructuralCandidate()`), a scenario whose two Entries come from two
 * real materializations and need one Gogma position (a Planner conflict), Planner ports that alter one aspect of the Production
 * result, and a tick clock. No oracle, no real Export, no real Target or weapon ID.
 */
import type { BuildListEntry } from '../../domain/models/publicTypes'
import type { PlannerDependencies } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { NONE, reset, resetThenKeep } from './coverageTestFixture'
import { materializeStructuralCandidate } from './materialize'
import { materializedEntriesHandoff, type MaterializedEntriesHandoff } from './materializationRunner'
import {
  ELEMENT_A, materializationScenario, ownedSource, REORDERED_GOGMA, scenarioHeldCrossing, SERIES_IDEAL, TARGET, type MaterializationScenario, type ScenarioWithCandidate,
} from './materializationTestFixture'
import { shapeInputs } from './shapeMaterializationTestFixture'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'
import { productionPlannerVerificationPort, type PlannerVerificationConditions, type PlannerVerificationExecution, type PlannerVerificationPort } from './verify'

/** A test value, never a registered or default condition. */
export const TEST_CONDITIONS: PlannerVerificationConditions = { researchMaxPlanSteps: 1_000 }

export function tickClock(): () => number {
  let tick = 0
  return () => (tick += 1)
}

export function execution(overrides: Partial<PlannerVerificationExecution> = {}): PlannerVerificationExecution {
  return { now: tickClock(), ...overrides }
}

/** Fresh Planner dependencies of the scene (the Plan's IDs never depend on an earlier run). */
export function plannerDependencies(scene: MaterializationScenario): PlannerDependencies {
  return globalResearchDependencies(scene.engine)
}

/** The runner's handoff of a real materialization (rule d0a2-v2) of the scenario's structural candidate. */
export async function materializedHandoff(scenario: ScenarioWithCandidate, candidateIndex = 0): Promise<MaterializedEntriesHandoff> {
  const result = await materializeStructuralCandidate(scenario.candidate, shapeInputs(scenario.scene))
  if (result.kind !== 'materialization') throw new Error(`The scenario did not materialize: ${result.detail}`)
  return materializedEntriesHandoff(candidateIndex, scenario.candidate, scenario.scene.context, scenario.scene.table, result)
}

/** S1 (two owned Gogma; a Resets at 12, c Resets at 11 and Keeps at 14): every Gogma position 10 .. 14 is one physical operation. */
export async function heldCrossingHandoff(): Promise<{ scenario: ScenarioWithCandidate; handoff: MaterializedEntriesHandoff }> {
  const scenario = await scenarioHeldCrossing()
  return { scenario, handoff: await materializedHandoff(scenario) }
}

/**
 * Two real materializations of one scene: X (a Resets at 12, c Resets at 11 and Keeps at 14) and Y (a Resets at 11 and Keeps at 14,
 * c Resets at 12). The handoff takes a from X and c from Y, so both Entries need Gogma position 12 as a required unit: Phase B would
 * never assign it (C2), the Production Planner reports the conflict.
 */
export async function conflictingHandoff(): Promise<{ scene: MaterializationScenario; handoff: MaterializedEntriesHandoff; entries: { x: BuildListEntry[]; y: BuildListEntry[] } }> {
  const scene = await materializationScenario({
    targets: ['a', 'c'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL }), ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL })],
    reset: { [ELEMENT_A]: { 11: REORDERED_GOGMA, 12: IDEAL_BONUSES } },
    keepIdeal: [14],
    window: { skill: 3, gogma: 5, normal: 2 },
  })
  const x = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, reset(12)), scene.option(TARGET.c, ownedSource('owned.g2'), NONE, resetThenKeep(11, 14))])
  const y = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, resetThenKeep(11, 14)), scene.option(TARGET.c, ownedSource('owned.g2'), NONE, reset(12))])
  const hx = await materializedHandoff({ scene, candidate: x, shape: {} })
  const hy = await materializedHandoff({ scene, candidate: y, shape: {} })
  const handoff = structuredClone(hx)
  handoff.materializedEntries = handoff.materializedEntries.map(row => (row.targetWeaponId === TARGET.c ? structuredClone(hy.materializedEntries.find(other => other.targetWeaponId === TARGET.c)!) : row))
  return { scene, handoff, entries: { x: hx.materializedEntries.map(row => row.entry), y: hy.materializedEntries.map(row => row.entry) } }
}

/** The Production port with the Plan generation result edited after the real run (the Trace Replay stays the real one). */
export function editedResultPort(edit: (result: Awaited<ReturnType<PlannerVerificationPort['createProductionPlanWithObserver']>>) => void): PlannerVerificationPort {
  return {
    ...productionPlannerVerificationPort,
    createProductionPlanWithObserver: async (...args) => {
      const result = await productionPlannerVerificationPort.createProductionPlanWithObserver(...args)
      edit(result)
      return result
    },
  }
}
