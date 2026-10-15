import type { BuildListOptimizationPreviewStartContext } from '../../components/planner/buildListOptimizationPresentation'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { ProductionPlan } from '../../domain/models/publicTypes'
import { createProductionPlan, type PlannerInput } from '../../domain/planner'
import type { BuildListOptimizationDiagnostics, BuildListOptimizationResult } from '../../domain/planner/buildListOptimization'
import { createBuildListOptimizationAdoptionFixture, type BuildListOptimizationAdoptionFixture } from './buildListOptimizationAdoptionFixtures'
import { createDeterministicPlannerDependencies } from './plannerSchedulerWorkloads'

/**
 * Fixtures of the Build List optimization presentation tests (Issue #260 PR-6B2). The `optimized` artifacts are the real ones of
 * `createBuildListOptimizationAdoptionFixture()` (calculated by `runBuildListOptimization()`, never hand-built), so the Preview is
 * tested against what the calculation returns. The start context is the very input the artifact was calculated from, as the
 * screen passes it.
 */

export function presentationTestMaster(): MasterDataRoot {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('The static Master Data failed validation.')
  return loaded.data
}

export function startContextOf(input: PlannerInput): BuildListOptimizationPreviewStartContext {
  return { buildListEntries: input.buildListEntries, targetWeapons: input.targetWeapons, ownedWeapons: input.ownedWeapons }
}

export async function optimizedPresentationFixture(
  variant: 'scoped' | 'unchanged' | 'plain' = 'scoped',
): Promise<BuildListOptimizationAdoptionFixture & { result: Extract<BuildListOptimizationResult, { status: 'optimized' }> }> {
  const fixture = await createBuildListOptimizationAdoptionFixture(variant)
  return { ...fixture, result: { status: 'optimized', artifact: fixture.artifact } }
}

/** The Draft the ordinary Planner makes from the very input of the optimization: made from the same input state (17.9). */
export async function ordinaryDraftFromSameInput(fixture: BuildListOptimizationAdoptionFixture): Promise<ProductionPlan> {
  const result = await createProductionPlan(structuredClone(fixture.input), createDeterministicPlannerDependencies(fixture.engine))
  if (result.plan === null) throw new Error('The ordinary Planner made no Draft from the fixture input.')
  return result.plan
}

/** Empty diagnostics for the hand-made `not_found` / `search_bound_reached` results of the display tests. */
export const BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS: BuildListOptimizationDiagnostics = Object.freeze({
  reachTable: null,
  structuralSearch: null,
  candidates: [],
  plannerVerifications: 0,
  elapsedMs: null,
})
