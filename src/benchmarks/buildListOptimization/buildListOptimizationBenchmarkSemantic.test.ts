import { describe, expect, it } from 'vitest'
import type { BuildListEntryId, OwnedWeaponId, PlanStep, PlanStepExecutionEffects, PlanStepId, PlanStepNormalCreationRole, ProductionPlanId, TargetWeaponId } from '../../domain/models/publicTypes'
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

  it('compares the Execution effects of every Step by meaning, with registered weapons by registration order', async () => {
    const base = await result('synthetic.open')
    if (base.status !== 'optimized') throw new Error('not optimized')
    const steps = base.artifact.plannerResult.plan!.steps
    expect(steps.every(step => step.executionEffects !== undefined)).toBe(true)
    const entry = steps[0]!.buildListEntryId!
    const target = steps[0]!.targetWeaponId!
    const otherTarget = steps.find(step => step.targetWeaponId !== target)!.targetWeaponId!
    const stepsOf = async (edit: (copy: PlanStep[]) => void) => {
      const copy = structuredClone(base)
      edit(copy.artifact.plannerResult.plan!.steps)
      return (await bloSemanticFingerprint(copy, testSha256)).components.steps
    }
    const effects = (copy: PlanStep[], index: number) => copy[index]!.executionEffects!
    const unchanged = await stepsOf(() => undefined)
    expect(unchanged).toBe((await bloSemanticFingerprint(base, testSha256)).components.steps)

    // Each field of the effects is semantics.
    const role = async (value: PlanStepNormalCreationRole | null) => stepsOf(copy => { effects(copy, 0).normalCreationRole = value })
    expect(await role('counter_advance')).not.toBe(await role('production_target'))
    expect(await stepsOf(copy => { effects(copy, 0).registersTrackedWeapon = !effects(copy, 0).registersTrackedWeapon })).not.toBe(unchanged)
    expect(await stepsOf(copy => { effects(copy, 0).observationBinding = { kind: 'normal_restoration_bonuses' } })).not.toBe(await stepsOf(copy => { effects(copy, 0).observationBinding = null }))
    const link = async (targetWeaponId: TargetWeaponId) => stepsOf(copy => { effects(copy, 0).targetLinks = [{ buildListEntryId: entry, targetWeaponId }] })
    expect(await link(target)).not.toBe(await link(otherTarget))
    expect(await link(target)).not.toBe(await stepsOf(copy => { effects(copy, 0).targetLinks = [] }))
    const completion = async (targetWeaponId: TargetWeaponId) => stepsOf(copy => {
      effects(copy, 0).targetCompletions = [{ buildListEntryId: entry, targetWeaponId, ownedWeaponId: 'weapon.input.a' as OwnedWeaponId }]
    })
    expect(await completion(target)).not.toBe(await completion(otherTarget))
    const label = async (buildListEntryId: BuildListEntryId) => stepsOf(copy => { effects(copy, 0).compromiseLabels = [{ buildListEntryId, ownedWeaponId: 'weapon.input.a' as OwnedWeaponId }] })
    expect(await label(entry)).not.toBe(await label('build-list.other' as BuildListEntryId))
    // Absent effects (a legacy Step) are never the same as present ones, empty or not.
    const empty: PlanStepExecutionEffects = { trackedOwnedWeaponId: null, normalCreationRole: null, registersTrackedWeapon: false, observationBinding: null, targetLinks: [], compromiseLabels: [], targetCompletions: [] }
    expect(await stepsOf(copy => { delete copy[0]!.executionEffects })).not.toBe(await stepsOf(copy => { copy[0]!.executionEffects = structuredClone(empty) }))

    // A weapon the Plan registers: the reserved ID itself never counts, the relation between the Steps naming it does.
    const registered = async (registration: string, later: string) => stepsOf(copy => {
      copy[0]!.executionEffects = { ...structuredClone(empty), trackedOwnedWeaponId: registration as OwnedWeaponId, normalCreationRole: 'production_target', registersTrackedWeapon: true }
      copy[0]!.ownedWeaponId = registration as OwnedWeaponId
      copy[1]!.executionEffects = { ...structuredClone(empty), trackedOwnedWeaponId: later as OwnedWeaponId, targetCompletions: [{ buildListEntryId: entry, targetWeaponId: target, ownedWeaponId: later as OwnedWeaponId }] }
      copy[1]!.ownedWeaponId = later as OwnedWeaponId
    })
    const sameWeapon = await registered('0f8fad5b-d9cb-469f-a165-70867728950e', '0f8fad5b-d9cb-469f-a165-70867728950e')
    expect(await registered('7c9e6679-7425-40de-944b-e07fc1f90ae7', '7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(sameWeapon)
    // The later Step names another weapon: an input weapon, or another reserved ID nothing registered.
    const inputWeapon = steps.find(step => step.ownedWeaponId !== null)!.ownedWeaponId!
    expect(await registered('0f8fad5b-d9cb-469f-a165-70867728950e', inputWeapon)).not.toBe(sameWeapon)
    expect(await registered('0f8fad5b-d9cb-469f-a165-70867728950e', '7c9e6679-7425-40de-944b-e07fc1f90ae7')).not.toBe(sameWeapon)
    // An input weapon's ID is kept as it is: another input weapon is another Step meaning.
    expect(await stepsOf(copy => { copy[0]!.ownedWeaponId = 'weapon.input.a' as OwnedWeaponId })).not.toBe(await stepsOf(copy => { copy[0]!.ownedWeaponId = 'weapon.input.b' as OwnedWeaponId }))
  }, 60_000)

  it('gives one fingerprint to two real runs of a Plan that registers weapons, whose reserved IDs and times differ', async () => {
    // representative-12 has new Normal Routes: under this test window the optimized Plan registers production-target Normals.
    const bounds = { ...bloSyntheticBounds('synthetic.open').bounds, window: { normal: 10, gogma: 400, skill: 400 } }
    const runWith = async (dependencies: PlannerDependencies) => {
      const run = await runBuildListOptimization(createPlannerSchedulerWorkloadInput('representative-12').input, dependencies, structuredClone(bounds))
      if (run.kind !== 'result' || run.result.status !== 'optimized') throw new Error('not optimized')
      return run.result
    }
    const first = await runWith(taggedDependencies('one', '2026-10-15T00:00:00.000Z'))
    const registrations = first.artifact.plannerResult.plan!.steps.filter(step => step.executionEffects?.registersTrackedWeapon)
    expect(registrations.length).toBeGreaterThan(0)
    expect(registrations.every(step => step.executionEffects!.trackedOwnedWeaponId!.startsWith('weapon.one.'))).toBe(true)
    const second = await runWith(createProductionBuildListOptimizationWorkerDependencies())
    expect(await bloSemanticFingerprint(second, testSha256)).toEqual(await bloSemanticFingerprint(first, testSha256))
    const text = JSON.stringify(bloSemanticComponents(first))
    expect(text).toContain('registered-weapon#1')
    expect(text).not.toMatch(/weapon\.one\./)
  }, 120_000)

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
