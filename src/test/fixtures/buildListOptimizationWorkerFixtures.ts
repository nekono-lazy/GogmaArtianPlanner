import {
  runBuildListOptimization,
  type BuildListOptimizationBounds,
  type BuildListOptimizationResult,
} from '../../domain/planner/buildListOptimization'
import type { PlannerInput } from '../../domain/planner'
import {
  createDeterministicPlannerDependencies,
  createPlannerSchedulerWorkloadInput,
} from './plannerSchedulerWorkloads'

/**
 * Explicit search bounds for the Build List global optimization Worker / Client tests (Issue #260 PR-4).
 *
 * Test values only: they are neither the Production bounds (undecided until PR-5, `docs/PLANNER_SPEC.md` 17.19 U2) nor a Research
 * registered value. The gates and budgets are open so that no synthetic run stops on them.
 */
export const BUILD_LIST_OPTIMIZATION_TEST_BOUNDS: BuildListOptimizationBounds = Object.freeze({
  window: { normal: 2, gogma: 8, skill: 8 },
  nodeBudget: 500,
  mrvLookahead: 4,
  maxStructuralCandidates: 3,
  maxPlannerVerifications: 3,
  routeGeneration: {
    projectedSearchScaleGate: { maxConversionPositions: 100_000, maxGogmaLegalWidth: 100_000, maxSkillLegalWidth: 100_000, maxNormalForgeCount: 100_000 },
    shapeSearchScaleGate: { maxDepthUpperBound: 1_000_000, maxGogmaGeneratedStateUpperBound: 1_000_000_000, maxNormalForgeCount: 1_000_000, maxConversionWalkPositions: 1_000_000 },
    shapeSearchBudget: {
      maxGogmaGeneratedStates: 1_000_000_000, maxSkillStates: 1_000_000_000, maxSettledWork: 1_000_000_000,
      maxPredictions: { normalArtian: 1_000_000_000, skill: 1_000_000_000, gogmaReset: 1_000_000_000, gogmaKeep: 1_000_000_000 },
    },
  },
}) as BuildListOptimizationBounds

/**
 * A Production-valid synthetic input (the `sanity-3` scheduler workload: three Targets with owned Gogma sources, the real Master and
 * `ProductionRngEngine`) on which the optimization is `optimized` within the test bounds.
 */
export function createBuildListOptimizationTestInput(): PlannerInput {
  return createPlannerSchedulerWorkloadInput('sanity-3').input
}

/** One `optimized` result of the test input, calculated directly with deterministic IDs and Clock (no Worker). */
export async function createOptimizedBuildListOptimizationTestResult(): Promise<Extract<BuildListOptimizationResult, { status: 'optimized' }>> {
  const fixture = createPlannerSchedulerWorkloadInput('sanity-3')
  const run = await runBuildListOptimization(fixture.input, createDeterministicPlannerDependencies(fixture.engine), structuredClone(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS))
  if (run.kind !== 'result' || run.result.status !== 'optimized') throw new Error(`The test input was not optimized: ${JSON.stringify(run)}`)
  return run.result
}
