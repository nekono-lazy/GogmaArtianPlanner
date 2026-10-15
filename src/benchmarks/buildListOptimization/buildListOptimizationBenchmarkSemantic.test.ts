import { describe, expect, it } from 'vitest'
import type { OwnedWeaponId, PlanStepId, ProductionPlanId } from '../../domain/models/publicTypes'
import type { PlannerDependencies } from '../../domain/planner'
import { runBuildListOptimization, type BuildListOptimizationResult } from '../../domain/planner/buildListOptimization'
import { createProductionBuildListOptimizationWorkerDependencies } from '../../workers/buildListOptimization.worker.production'
import { createPlannerSchedulerWorkloadInput } from '../../test/fixtures/plannerSchedulerWorkloads'
import { bloResultView, bloSemanticComponents, bloSemanticFingerprint } from './buildListOptimizationBenchmarkSemantic'
import { bloSyntheticBounds } from './buildListOptimizationBenchmarkSynthetic'
import { testSha256 } from './buildListOptimizationBenchmarkTestFixture'

/*
 * Issue #260 PR-5A: the semantic fingerprint compares two runs by meaning (PLANNER_SPEC 17.6): the Plan ID, Step IDs, reserved
 * OwnedWeapon IDs and times of the Production ID factory and Clock never enter it, and every component a run decides does.
 */

function taggedDependencies(tag: string, time: string): PlannerDependencies {
  const base = createProductionBuildListOptimizationWorkerDependencies()
  let plan = 0, step = 0, weapon = 0
  return {
    ...base,
    clock: { now: () => time },
    idFactory: {
      productionPlanId: () => `plan.${tag}.${++plan}` as ProductionPlanId,
      planStepId: () => `step.${tag}.${++step}` as PlanStepId,
      ownedWeaponId: () => `weapon.${tag}.${++weapon}` as OwnedWeaponId,
    },
  }
}

async function result(boundsId: string, dependencies: PlannerDependencies = createProductionBuildListOptimizationWorkerDependencies()): Promise<BuildListOptimizationResult> {
  const run = await runBuildListOptimization(createPlannerSchedulerWorkloadInput('sanity-3').input, dependencies, bloSyntheticBounds(boundsId).bounds, { now: () => performance.now() })
  if (run.kind !== 'result') throw new Error('cancelled')
  return run.result
}

describe('Build List optimization semantic fingerprint (Issue #260 PR-5A)', () => {
  it('is the same for two runs whose IDs and times differ, and excludes them from every component', async () => {
    const first = await result('synthetic.open', taggedDependencies('one', '2026-10-15T00:00:00.000Z'))
    const second = await result('synthetic.open', taggedDependencies('two', '2027-01-01T12:00:00.000Z'))
    expect(first.status).toBe('optimized')
    const a = await bloSemanticFingerprint(first, testSha256)
    const b = await bloSemanticFingerprint(second, testSha256)
    expect(b).toEqual(a)
    const text = JSON.stringify(bloSemanticComponents(first))
    expect(text).not.toMatch(/plan\.one|step\.one|weapon\.one|2026-10-15T00:00:00/)
    // The Production ID factory and Clock (UUIDs, now) give the very same fingerprint.
    expect(await bloSemanticFingerprint(await result('synthetic.open'), testSha256)).toEqual(a)
    expect(Object.keys(a.components)).toEqual(['status', 'generatedEntries', 'replacements', 'unchangedTargets', 'planningTargets', 'inputExclusions', 'inputToken', 'summary', 'termination', 'conflicts', 'warnings', 'plan', 'steps', 'diagnostics'])
  }, 60_000)

  it('separates what differs: another window changes the diagnostics, another result class changes the status', async () => {
    const open = await bloSemanticFingerprint(await result('synthetic.open'), testSha256)
    const wide = await bloSemanticFingerprint(await result('synthetic.wide-window'), testSha256)
    expect(wide.sha256).not.toBe(open.sha256)
    expect(wide.components.diagnostics).not.toBe(open.components.diagnostics)
    expect(wide.components.steps).toBe(open.components.steps)
    const bound = await result('synthetic.node-budget-1')
    expect(bound.status).toBe('search_bound_reached')
    expect(Object.keys((await bloSemanticFingerprint(bound, testSha256)).components)).toEqual(['status', 'bounds', 'diagnostics'])
  }, 60_000)

  it('keeps counts and classifications in the result view, and no identity', async () => {
    const optimized = await result('synthetic.open')
    const view = await bloResultView(optimized, testSha256)
    expect(view).toMatchObject({ status: 'optimized', planningTargetCount: 3, completedTargetCount: 3, physicalOperationCount: 7, planStepCount: 7, nonPhysicalStepCount: 0, structuralObjective: 7, maxPlanSteps: 1000, conflictCount: 0, rejectedEntryCount: 0, warningCount: 0 })
    expect(view.diagnostics!.candidates[0]!.routeGeneration.methods).toEqual(expect.objectContaining({ candidate_search_projected: expect.any(Number), shape_constrained: expect.any(Number) }))
    expect(JSON.stringify(view)).not.toMatch(/target\.issue103|build-list\.|candidate\.|owned\.|51231782/)
    const bound = await bloResultView(await result('synthetic.node-budget-1'), testSha256)
    expect(bound).toMatchObject({ status: 'search_bound_reached', boundKinds: ['structural_search_node_budget'], physicalOperationCount: null })
  }, 60_000)
})
