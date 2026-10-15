import { afterEach, describe, expect, it } from 'vitest'
import { hashStableValue, stableStringify } from '../../domain/models/publicTypes'
import type { BuildListEntry, PlanStep, TargetWeapon } from '../../domain/models/publicTypes'
import * as production from '../../domain/planner/buildListOptimization'
import { derivePlannerAlternativeReservation } from '../../domain/planner/alternative/plannerAlternativeReservation'
import { PlannerPlanGenerationError } from '../../domain/planner/plannerPlanGenerationError'
import type { OwnedWeaponId, PlanStepId, ProductionPlanId } from '../../domain/models/publicTypes'
import type { PlannerDependencies, PlannerInput } from '../../domain/planner/plannerTypes'
import { createPlanningBuildListEntriesHash, createPlanningTargetWeaponsHash, createProductionPlanWithObserver } from '../../domain/planner/productionPlanGeneration'
import { emptyPlannerAlternativeReservation } from '../../domain/search/alternative'
import { conversion, NONE, reset } from './coverageTestFixture'
import { materializeStructuralCandidate } from './materialize'
import {
  ELEMENT_B, materializationScenario, newNormalSource, ownedSource, scenarioConversionFallback, scenarioHeldCrossing, scenarioSkillDependency, SERIES_IDEAL,
  TARGET, type MaterializationScenario, type ScenarioWithCandidate,
} from './materializationTestFixture'
import type { StructuralCandidateMaterialization } from './materializationTypes'
import { OPEN_SHAPE_SETTINGS, routeText, scenarioG1Continuation, scenarioG3Lower, shapeCapturingPort, shapeInputs } from './shapeMaterializationTestFixture'
import { createGlobalAssignmentFixture, IDEAL_BONUSES, ownedGogma } from './testFixture'
import { productionReachTableOf } from './types'

/*
 * Issue #260 PR-3: the Build List global optimization's Stage D (route generation), Stage D' (the final verification by the ordinary
 * Planner) and the whole calculation (`runBuildListOptimization()`), on the Research synthetic fixtures (a deterministic table Engine;
 * no real Export, no oracle). The Stage D calculation is the one the Research rule `d0a2-v2` now runs through its adapter, so the
 * Research tests keep exercising its classification (gates, budgets, support categories, contract violations); here the Production
 * identity, the Research parity, the D' conditions of `docs/PLANNER_SPEC.md` 17.7 and the result classes of 17.8 are fixed.
 */

const TEST_TIME = '2026-10-15T00:00:00.000Z'
const identity: production.RouteGenerationIdentity = { ...production.BUILD_LIST_OPTIMIZATION_ROUTE_IDENTITY, clock: { now: () => TEST_TIME } }
const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const RESEARCH_TOKENS = /research|global-assignment|globalAssignment/

/** The serialization without the fixture Engine's own version label (`fake-fixture:global-research`, no identity token). */
function withoutFixtureEngineLabel(value: unknown, input: PlannerInput): string {
  return stableStringify(value).replaceAll(input.calculationContext.rngEngineVersion, '')
}

function routeInputs(scene: MaterializationScenario, overrides: Partial<production.RouteGenerationInputs> = {}): production.RouteGenerationInputs {
  return { context: scene.context, table: productionReachTableOf(scene.table), engine: scene.engine, settings: OPEN_SHAPE_SETTINGS, identity, ...overrides }
}

/** Production-shaped dependencies with recognizable IDs (a UUID / Clock stand-in: never the Research `research.global.*` factory). */
function testDependencies(scene: Pick<MaterializationScenario, 'engine'>, tag = 'run'): PlannerDependencies {
  let plan = 0, step = 0, weapon = 0
  return {
    rngEngine: scene.engine,
    clock: { now: () => TEST_TIME },
    idFactory: {
      productionPlanId: () => `plan.${tag}.${++plan}` as ProductionPlanId,
      planStepId: () => `step.${tag}.${++step}` as PlanStepId,
      ownedWeaponId: () => `weapon.${tag}.${++weapon}` as OwnedWeaponId,
    },
  }
}

function bounds(overrides: Partial<production.BuildListOptimizationBounds> = {}): production.BuildListOptimizationBounds {
  return { window: { ...WINDOW }, nodeBudget: 2000, mrvLookahead: 8, maxStructuralCandidates: 10, maxPlannerVerifications: 10, routeGeneration: OPEN_SHAPE_SETTINGS, ...overrides }
}

async function generated(scenario: ScenarioWithCandidate, overrides: Partial<production.RouteGenerationInputs> = {}) {
  return production.generateStructuralCandidateRoutes(scenario.candidate, routeInputs(scenario.scene, overrides))
}

function materialized(result: Awaited<ReturnType<typeof materializeStructuralCandidate>>): StructuralCandidateMaterialization {
  if (result.kind !== 'materialization') throw new Error(`${result.reason}: ${result.detail}`)
  return result
}

async function verified(scenario: ScenarioWithCandidate, generation: production.StructuralCandidateRouteGeneration, overrides: Partial<production.FinalVerificationInputs> = {}) {
  return production.verifyBuildListOptimizationCandidate({
    context: scenario.scene.context, inputExclusions: production.buildListOptimizationInputExclusionsOf(scenario.scene.context.validation),
    generation, dependencies: testDependencies(scenario.scene), ...overrides,
  })
}

function result(run: production.BuildListOptimizationRun): production.BuildListOptimizationResult {
  if (run.kind !== 'result') throw new Error('The calculation was cancelled.')
  return run.result
}

function optimized(run: production.BuildListOptimizationRun): production.BuildListOptimizationArtifact {
  const value = result(run)
  if (value.status !== 'optimized') throw new Error(`Not optimized: ${stableStringify(value)}`)
  return value.artifact
}

const stepSemantics = (step: PlanStep) => ({
  order: step.order, operationType: step.operationType, buildListEntryId: step.buildListEntryId, targetWeaponId: step.targetWeaponId,
  progressedTargetWeaponIds: step.progressedTargetWeaponIds ?? null, rngAdvance: step.rngAdvance,
})

/** Everything of a result that does not come from the Production ID factory or the Clock. */
function semanticOf(run: production.BuildListOptimizationRun) {
  if (run.kind !== 'result') return run
  const value = run.result
  if (value.status !== 'optimized') {
    const rest: Record<string, unknown> = { ...value }
    delete rest.diagnostics
    return rest
  }
  const artifact = value.artifact
  return {
    status: value.status,
    entries: artifact.generatedBuildListEntries.map(entry => ({ id: entry.id, candidateId: entry.candidateId, searchRunId: entry.candidateSnapshot.searchRunId, route: entry.candidateSnapshot.route })),
    replacements: artifact.replacements, unchanged: artifact.unchangedTargetWeaponIds, planning: artifact.planningTargetWeaponIds, exclusions: artifact.inputExclusions,
    token: artifact.inputToken, summary: artifact.summary, steps: artifact.plannerResult.plan!.steps.map(stepSemantics),
    selected: artifact.plannerResult.plan!.selectedBuildListEntryIds, warnings: artifact.plannerResult.warnings,
    candidates: artifact.diagnostics.candidates,
  }
}

describe('Stage D route generation: the Research rule d0a2-v2 under Production identities', () => {
  it('generates the very Routes and Entry IDs the Research materialization does, with Production Candidate IDs and search identities only', async () => {
    for (const make of [scenarioHeldCrossing, scenarioConversionFallback, scenarioSkillDependency, scenarioG1Continuation, scenarioG3Lower]) {
      const scenario = await make()
      const productionRun = await generated(scenario)
      const researchRun = materialized(await materializeStructuralCandidate(scenario.candidate, shapeInputs(scenario.scene)))
      expect(productionRun.outcome, make.name).toEqual({ kind: 'all_generated' })
      expect(researchRun.outcome, make.name).toEqual({ kind: 'all_materialized' })
      // Entry IDs depend on the Candidate meaning, the Target and both Search hashes only: the same under either identity.
      expect(productionRun.generatedEntries.map(entry => entry.id), make.name).toEqual(researchRun.materializedEntries.map(entry => entry.id))
      expect(productionRun.generatedEntries.map(routeText), make.name).toEqual(researchRun.materializedEntries.map(routeText))
      expect(productionRun.targets.map(record => [record.selection?.rule, record.outcome.kind === 'materialized' ? record.outcome.method : null]), make.name)
        .toEqual(researchRun.targets.map(record => [record.selection?.rule, record.outcome.kind === 'materialized' ? record.outcome.method : null]))
      for (const entry of productionRun.generatedEntries) {
        expect(entry.id).toMatch(/^build-list\.constrained\./)
        expect(entry.candidateId).toMatch(/^candidate\.build-list-optimization\.(?:shape\.)?fnv1a32-[0-9a-f]{8}$/)
        expect(entry.candidateSnapshot.searchRunId).toMatch(/^build-list-optimization-search\.(?:origin|shape)\./)
        expect(entry.createdAt).toBe(TEST_TIME)
        // A generated Entry selects no intermediate state and leaves the improvement order to the Planner.
        expect(entry.intermediateStateSelection).toEqual({ skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'planner' })
      }
      expect(withoutFixtureEngineLabel(productionRun, scenario.scene.input)).not.toMatch(RESEARCH_TOKENS)
      for (const entry of researchRun.materializedEntries) expect(entry.candidateId).toMatch(/^candidate\.research\.global/)
    }
  }, 60_000)

  it('projects a continuous shape first and moves to the shape-constrained Search once when the projected canonical Ideal is another shape', async () => {
    const scenario = await scenarioConversionFallback()
    const run = await generated(scenario)
    const a = run.targets.find(record => record.targetWeaponId === TARGET.a)!
    const b = run.targets.find(record => record.targetWeaponId === TARGET.b)!
    expect(a.selection?.rule).toBe('continuous_projected_then_shape_constrained')
    expect(a.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected'])
    expect(a.outcome).toMatchObject({ kind: 'materialized', method: 'candidate_search_projected' })
    expect(b.attempts.map(attempt => [attempt.method, attempt.method === 'candidate_search_projected' ? attempt.result.kind : attempt.outcome.kind]))
      .toEqual([['candidate_search_projected', 'canonical_mismatch'], ['shape_constrained', 'materialized']])
    const projected = b.attempts[0]!
    expect(projected.method === 'candidate_search_projected' && projected.request.searchRunId).toMatch(/^build-list-optimization-search\.projected\./)
  }, 30_000)

  it('uses the shape-constrained Search alone for a continuation shape and a non-continuous shape, under the formal reservation of the earlier Entries', async () => {
    const continuation = await generated(await scenarioG1Continuation())
    expect(continuation.targets[0]!.selection).toMatchObject({ rule: 'continuation_shape_constrained_only', continuation: { policy: 'lane_start_ideal_skill_continuation' } })
    const held = await scenarioHeldCrossing()
    const spy = shapeCapturingPort()
    const run = await generated(held, { search: spy.port })
    const c = run.targets.find(record => record.targetWeaponId === TARGET.c)!
    expect(c.selection?.rule).toBe('non_continuous_shape_constrained_only')
    expect(c.attempts.map(attempt => attempt.method)).toEqual(['shape_constrained'])
    // The first Target reads the empty reservation, every later one the formal reservation of the Entries generated before it.
    const requests = run.targets.flatMap(record => record.attempts.filter((attempt): attempt is production.ShapeConstrainedAttempt => attempt.method === 'shape_constrained'))
    expect(spy.seamInputs.map(input => input.targetWeaponId)).toEqual(requests.map(attempt => attempt.request.targetWeaponId))
    const cAttempt = requests.find(attempt => attempt.request.targetWeaponId === TARGET.c)!
    const before = run.generatedEntries.slice(0, run.materializationOrder.indexOf(TARGET.c))
    expect(cAttempt.request.reservation).toEqual(before.length === 0 ? emptyPlannerAlternativeReservation : derivePlannerAlternativeReservation(before, held.scene.engine))
    expect(cAttempt.routeChecks).toMatchObject({ passed: true, issues: [] })
    expect(cAttempt.request.searchIdentity).toMatch(/^build-list-optimization-search\.shape\./)
  }, 30_000)

  it('fails closed when the independent Route checks reject a delivery, and when a held Entry ID carries other content', async () => {
    const held = await scenarioHeldCrossing()
    const tampered = shapeCapturingPort()
    const failing = await generated(held, {
      search: {
        ...tampered.port,
        visitShapeConstrainedRouteCandidates: (input, engine, onCandidate, options) => tampered.port.visitShapeConstrainedRouteCandidates(input, engine, candidate => {
          const edited = structuredClone(candidate)
          // The trace of the last Bonus operation no longer is the prediction.
          const last = edited.bonusAmendmentTrace?.at(-1)
          if (last) last.restorationBonuses = structuredClone(IDEAL_BONUSES).reverse() as typeof last.restorationBonuses
          return onCandidate(edited)
        }, options),
      },
    }).catch(error => error)
    // A delivery whose trace is not the prediction is refused by the deterministic materializer's own validation.
    expect(failing).toBeInstanceOf(production.BuildListOptimizationMaterializationError)
    expect(failing).toMatchObject({ code: 'entry_materialization_refused' })
    // A request whose reservation is not the formal reservation of the Entries generated before it: the independent checks
    // derive that reservation again and fail the delivery closed.
    const run = await generated(held)
    const attempt = run.targets.flatMap(record => record.attempts)
      .find((value): value is production.ShapeConstrainedAttempt => value.method === 'shape_constrained' && stableStringify(value.request.reservation) !== stableStringify(emptyPlannerAlternativeReservation))
    if (attempt === undefined) throw new Error('No shape-constrained attempt read a non-empty reservation.')
    await expect(production.executeShapeConstrainedRoute(attempt.request, {
      context: held.scene.context, table: productionReachTableOf(held.scene.table), engine: held.scene.engine, settings: OPEN_SHAPE_SETTINGS,
      materializedEntries: [], collisionCheckEntries: held.scene.context.plannerInput.buildListEntries, clock: identity.clock,
      candidateIdPrefix: identity.shapeCandidateIdPrefix,
    })).rejects.toMatchObject({ code: 'route_verification_failed', detail: { routeChecks: { passed: false, issues: expect.arrayContaining([expect.objectContaining({ code: 'reservation_mismatch' })]) } } })
    // An Entry ID the deterministic materializer would produce, already held with other content: an ID collision, never a reuse.
    const first = await generated(held)
    const clash = structuredClone(first.generatedEntries[0]!)
    clash.searchStateHash = 'fnv1a32:00000000'
    const context = { ...held.scene.context, plannerInput: { ...held.scene.context.plannerInput, buildListEntries: [...held.scene.context.plannerInput.buildListEntries, clash] } }
    await expect(generated(held, { context })).rejects.toMatchObject({ code: 'entry_materialization_refused' })
  }, 30_000)

  it('stops at a shape-constrained gate or budget as unconfirmed, at a cancellation as unmeasured, and refuses invalid settings', async () => {
    const held = await scenarioHeldCrossing()
    const gated = await generated(held, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchScaleGate: { maxDepthUpperBound: 0, maxGogmaGeneratedStateUpperBound: 0, maxNormalForgeCount: 0, maxConversionWalkPositions: 0 } } })
    expect(gated.outcome).toMatchObject({ kind: 'generation_unconfirmed', outcome: { kind: 'not_executed', reason: 'search_scale_gate', method: 'shape_constrained' } })
    const budget = await generated(held, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: { maxGogmaGeneratedStates: 0, maxSkillStates: 0, maxSettledWork: 0, maxPredictions: { normalArtian: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 } } } })
    expect(budget.outcome).toMatchObject({ kind: 'generation_unconfirmed', outcome: { kind: 'unconfirmed', reason: 'shape_search_budget_reached' } })
    const cancelled = await generated(held, { shouldCancel: () => true })
    expect(cancelled.outcome).toMatchObject({ kind: 'generation_unconfirmed', outcome: { kind: 'unmeasured', reason: 'cancelled' } })
    expect(cancelled.notAttemptedTargetWeaponIds).toHaveLength(1)
    await expect(generated(held, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: { ...OPEN_SHAPE_SETTINGS.shapeSearchBudget, maxSettledWork: -1 } } }))
      .rejects.toMatchObject({ code: 'invalid_settings' })
  }, 30_000)
})

/** b = new Normal at 5 converting at 7 and Resetting at 11, a = owned Gogma Reset at 12, plus Targets a2 (completed) and z (Entry stale). */
async function scenarioWithExclusions(): Promise<{ scenario: ScenarioWithCandidate; input: PlannerInput; extra: { completed: TargetWeapon; stale: TargetWeapon; staleEntry: BuildListEntry; completedEntry: BuildListEntry } }> {
  const scenario = await scenarioConversionFallback()
  const fixture = await createGlobalAssignmentFixture({ sameElementTarget: true })
  const cTarget = fixture.input.targetWeapons.find(value => value.id === TARGET.c)!
  const cEntry = fixture.input.buildListEntries.find(entry => entry.targetWeaponId === TARGET.c)!
  const completed: TargetWeapon = { ...structuredClone(cTarget), lifecycleStatus: 'completed', completedAt: TEST_TIME, completedByProductionPlanId: null }
  const stale: TargetWeapon = { ...structuredClone(cTarget), id: 'target.fixture.z' as TargetWeapon['id'] }
  const staleEntry: BuildListEntry = { ...structuredClone(cEntry), id: 'build-list.fixture.z' as BuildListEntry['id'], targetWeaponId: stale.id, searchStateHash: 'fnv1a32:00000000' }
  staleEntry.candidateSnapshot.targetWeaponId = stale.id
  const input: PlannerInput = {
    ...scenario.scene.input,
    targetWeapons: [...scenario.scene.input.targetWeapons, completed, stale],
    buildListEntries: [...scenario.scene.input.buildListEntries, structuredClone(cEntry), staleEntry],
  }
  return { scenario, input, extra: { completed, stale, staleEntry, completedEntry: cEntry } }
}

describe('Stage D\' final verification by the ordinary Planner (PLANNER_SPEC 17.7)', () => {
  it('accepts a candidate whose every condition holds: completed, every Target counted and selected, no Conflict, no rejection, the physical identity', async () => {
    const scenario = await scenarioConversionFallback()
    const generation = await generated(scenario)
    const verdict = await verified(scenario, generation)
    if (verdict.kind !== 'optimized') throw new Error(stableStringify(verdict))
    const plan = verdict.plannerResult.plan!
    expect(verdict.plannerResult.termination).toMatchObject({ status: 'completed', completedTargetCount: 2, totalTargetCount: 2 })
    expect(plan.status).toBe('draft')
    expect(plan.conflictRepairLineage).toBeNull()
    expect(plan.id).toBe('plan.run.1')
    expect([...plan.selectedBuildListEntryIds].sort()).toEqual(generation.generatedEntries.map(entry => entry.id).sort())
    expect(verdict.physical.physicalOperations).toBe(generation.objective)
    expect(verdict.physical.planSteps).toBe(generation.objective)
    expect(verdict.maxPlanSteps).toBe(production.deriveBuildListOptimizationMaxPlanSteps(generation.objective, 2))
    expect(verdict.finalInput.input.options).toEqual({ maxPlanSteps: verdict.maxPlanSteps })
    expect(verdict.finalInput.input.conflictResolutions).toEqual([])
    expect(verdict.fullPlannerRuns).toBe(1)
  }, 30_000)

  it('counts a confirm_owned_ideal Step as a non-physical Step of the identity and in the bound\'s required actions', async () => {
    const idealWeapon = ownedGogma('owned.ideal.a', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(IDEAL_BONUSES) })
    const scene = await materializationScenario({ targets: ['a', 'b'], owned: [idealWeapon], skillIdeal: { [ELEMENT_B]: [7] }, reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES } }, window: WINDOW })
    const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.ideal.a'), NONE, NONE), scene.option(TARGET.b, newNormalSource(5), conversion(7, 7), reset(11))])
    const scenario: ScenarioWithCandidate = { scene, candidate, shape: {} }
    const generation = await generated(scenario)
    const verdict = await verified(scenario, generation)
    if (verdict.kind !== 'optimized') throw new Error(stableStringify(verdict))
    expect(verdict.nonPhysicalStepCount).toBe(1)
    expect(verdict.physical.nonPhysicalSteps).toEqual({ confirm_owned_ideal: 1 })
    expect(verdict.physical.physicalOperations).toBe(generation.objective)
    expect(verdict.physical.planSteps).toBe(generation.objective + 1)
    // requiredActions = objective + 2 planning Targets (b's reserve and a's confirm_owned_ideal); the run used at most that many.
    expect(verdict.plannerResult.termination.expandedStates).toBeLessThanOrEqual(generation.objective + 2)
    expect(verdict.maxPlanSteps).toBe(production.deriveBuildListOptimizationMaxPlanSteps(generation.objective, 2))
  }, 30_000)

  it('rejects, never resolves, a Planner result that breaks a condition: each one typed', async () => {
    const scenario = await scenarioConversionFallback()
    const generation = await generated(scenario)
    const edited = (edit: (value: Awaited<ReturnType<typeof createProductionPlanWithObserver>>) => void): typeof createProductionPlanWithObserver => async (...args) => {
      const value = await createProductionPlanWithObserver(...args)
      edit(value)
      return value
    }
    const cases: [string, typeof createProductionPlanWithObserver][] = [
      ['termination_not_completed', edited(value => { value.termination = { ...value.termination, status: 'incomplete', reachedLimits: ['max_plan_steps'] } })],
      ['completed_target_count_mismatch', edited(value => { value.termination = { ...value.termination, completedTargetCount: 1 } })],
      ['total_target_count_mismatch', edited(value => { value.termination = { ...value.termination, totalTargetCount: 3 } })],
      ['selected_entries_mismatch', edited(value => { value.plan!.selectedBuildListEntryIds = value.plan!.selectedBuildListEntryIds.slice(1) })],
      ['conflicts', edited(value => { value.conflicts = [{ ...structuredClone(value.conflicts[0] ?? ({} as never)), id: 'conflict.test' } as never] })],
      ['rejected_entries', edited(value => { value.plan!.rejectedBuildListEntries = [{ buildListEntryId: value.plan!.selectedBuildListEntryIds[0]!, reason: 'resource_conflict', detail: 'test' }] as never })],
      ['unexpected_warnings', edited(value => { value.warnings = [...value.warnings, { kind: 'rng_prediction_unsupported', message: 'BuildListEntry \'x\' requires unsupported RNG input.' }] })],
      ['plan_missing', edited(value => { value.plan = null })],
    ]
    for (const [code, planner] of cases) {
      const verdict = await verified(scenario, generation, { planner })
      expect(verdict.kind, code).toBe('rejected')
      expect(verdict.kind === 'rejected' && verdict.rejections.map(rejection => rejection.code), code).toContain(code)
    }
  }, 30_000)

  it('fails closed on a broken physical identity, propagates a Planner error, and reports the Planner\'s own cancel', async () => {
    const scenario = await scenarioConversionFallback()
    const generation = await generated(scenario)
    await expect(verified(scenario, { ...generation, objective: generation.objective + 1 })).rejects.toMatchObject({ name: 'BuildListOptimizationInvariantError', code: 'objective_mismatch' })
    // A failed Trace Replay inside Plan generation is the Planner's own error: never a rejected candidate or "not found".
    const failing: typeof createProductionPlanWithObserver = async () => { throw new PlannerPlanGenerationError('Planner trace replay failed: test') }
    await expect(verified(scenario, generation, { planner: failing })).rejects.toBeInstanceOf(PlannerPlanGenerationError)
    expect(await verified(scenario, generation, { shouldCancel: () => true })).toEqual({ kind: 'cancelled' })
    // Stage D' verifies an all_generated candidate covering every planning Target only.
    await expect(verified(scenario, { ...generation, generatedEntries: generation.generatedEntries.slice(1) })).rejects.toMatchObject({ code: 'stage_contract_violation' })
  }, 30_000)

  it('accepts the excluded Entries of Stage 0 and their warnings, and rejects a changed exclusion set or an excluded generated Entry', async () => {
    const { scenario, input, extra } = await scenarioWithExclusions()
    const context = production.createBuildListOptimizationContext(input, testDependencies(scenario.scene))
    if (context.kind !== 'context') throw new Error(context.detail)
    const exclusions = production.buildListOptimizationInputExclusionsOf(context.context.validation)
    expect(exclusions.map(value => [value.buildListEntryId, value.warningKind]).sort()).toEqual([
      [extra.completedEntry.id, 'completed_target_excluded'], [extra.staleEntry.id, 'build_list_entry_stale'],
    ].sort())
    const sceneWith = { ...scenario, scene: { ...scenario.scene, context: context.context } }
    const generation = await production.generateStructuralCandidateRoutes(scenario.candidate, routeInputs(sceneWith.scene))
    const accepted = await verified(sceneWith, generation)
    expect(accepted.kind).toBe('optimized')
    // The exclusion warnings stay in the result; nothing else does.
    expect(accepted.kind === 'optimized' && accepted.plannerResult.warnings.map(warning => warning.kind).sort()).toEqual(['build_list_entry_stale', 'completed_target_excluded'])
    // Stage 0 recorded another exclusion set than the final input's: rejected before any Planner run.
    const changed = await verified(sceneWith, generation, { inputExclusions: exclusions.slice(1) })
    expect(changed).toMatchObject({ kind: 'rejected', fullPlannerRuns: 0, rejections: [{ code: 'input_exclusions_changed' }] })
    // A generated Entry the final input's validation excludes (stale against the Planner-start state).
    const staleGenerated = { ...generation, generatedEntries: generation.generatedEntries.map((entry, index) => (index === 0 ? { ...entry, searchStateHash: 'fnv1a32:00000000' } : entry)) }
    const excluded = await verified(sceneWith, staleGenerated)
    expect(excluded.kind === 'rejected' && excluded.rejections.map(rejection => rejection.code)).toEqual(expect.arrayContaining(['planning_target_set_changed', 'generated_entry_excluded']))
  }, 30_000)
})

describe('runBuildListOptimization: Stage 0 - D\' and the result classes (PLANNER_SPEC 17.8)', () => {
  const originalLocaleCompare = String.prototype.localeCompare
  afterEach(() => { String.prototype.localeCompare = originalLocaleCompare })

  it('returns an optimized runtime-only artifact: replacements, unchanged Targets, exclusions, the input token and the summary', async () => {
    const { scenario, input, extra } = await scenarioWithExclusions()
    // The input's own maxPlanSteps is never the final verification bound, and a non-default improvement preference is no refusal.
    const entryA = input.buildListEntries.find(entry => entry.targetWeaponId === TARGET.a)!
    const userInput: PlannerInput = {
      ...input, options: { maxPlanSteps: 1 },
      buildListEntries: input.buildListEntries.map(entry => (entry.id === entryA.id ? { ...entry, intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'bonus_first' } } : entry)),
    }
    const before = stableStringify(userInput)
    const stages: production.BuildListOptimizationStage[] = []
    const artifact = optimized(await production.runBuildListOptimization(userInput, testDependencies(scenario.scene), bounds(), { onStage: stage => stages.push(stage) }))
    expect(stableStringify(userInput)).toBe(before)
    expect(stages.slice(0, 3)).toEqual(['input_check', 'reach_table', 'assignment_search'])
    expect(stages).toContain('plan_verification')
    const plan = artifact.plannerResult.plan!
    expect(artifact.planningTargetWeaponIds).toEqual([TARGET.a, TARGET.b])
    expect(artifact.summary).toMatchObject({
      physicalOperationCount: artifact.summary.structuralObjective, planStepCount: artifact.summary.structuralObjective, nonPhysicalStepCount: 0,
      completedTargetCount: 2, totalTargetCount: 2, outOfScopeTargetCounts: { noEntry: 0, excludedEntryOnly: 1, disabled: 0, completed: 1 },
    })
    expect(artifact.summary.maxPlanSteps).toBe(production.deriveBuildListOptimizationMaxPlanSteps(artifact.summary.structuralObjective, 2))
    expect(artifact.inputExclusions.map(value => value.buildListEntryId).sort()).toEqual([extra.completedEntry.id, extra.staleEntry.id].sort())
    // Every generated Entry replaces its Target's one Entry; the replaced Entry's improvement preference is not carried over.
    expect(artifact.replacements.map(value => value.generatedBuildListEntryId)).toEqual(artifact.generatedBuildListEntries.map(entry => entry.id))
    for (const replacement of artifact.replacements) {
      expect(input.buildListEntries.filter(entry => entry.targetWeaponId === replacement.targetWeaponId).map(entry => entry.id)).toEqual([replacement.replacedBuildListEntryId])
    }
    for (const entry of artifact.generatedBuildListEntries) expect(entry.intermediateStateSelection?.improvementPreference).toBe('planner')
    expect([...artifact.unchangedTargetWeaponIds, ...artifact.replacements.map(value => value.targetWeaponId)].sort()).toEqual([TARGET.a, TARGET.b])
    // The out-of-scope Entries are kept; the token names the input, the Plan the replaced Build List.
    expect(artifact.inputToken).toEqual({
      initialExecutionState: plan.baseSnapshot.initialExecutionState, targetWeaponsHash: createPlanningTargetWeaponsHash(userInput.targetWeapons),
      inputBuildListEntriesHash: createPlanningBuildListEntriesHash(userInput.buildListEntries), calculationContext: userInput.calculationContext,
    })
    expect(plan.baseSnapshot.targetWeaponsHash).toBe(artifact.inputToken.targetWeaponsHash)
    expect(plan.baseSnapshot.buildListEntriesHash).not.toBe(artifact.inputToken.inputBuildListEntriesHash)
    expect(plan.id).toBe('plan.run.1')
    expect(artifact.diagnostics.plannerVerifications).toBe(1)
    expect(withoutFixtureEngineLabel(artifact, userInput)).not.toMatch(RESEARCH_TOKENS)
  }, 60_000)

  it('reuses a Target\'s Entry of the same semantic content as unchanged, keeping its settings', async () => {
    const { scene } = await scenarioConversionFallback()
    const first = optimized(await production.runBuildListOptimization(scene.input, testDependencies(scene), bounds()))
    // Adopt the first result's Entries by hand, with a user preference on one of them, and optimize again.
    const replaced = production.buildBuildListOptimizationFinalInput(scene.input, first.generatedBuildListEntries, 1000).input.buildListEntries
      .map((entry, index) => (index === 0 ? { ...entry, intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'skill_first' as const } } : entry))
    const second = optimized(await production.runBuildListOptimization({ ...scene.input, buildListEntries: replaced }, testDependencies(scene), bounds()))
    expect(second.replacements).toEqual([])
    expect(second.generatedBuildListEntries).toEqual([])
    expect([...second.unchangedTargetWeaponIds].sort()).toEqual([TARGET.a, TARGET.b])
    expect(second.plannerResult.plan!.selectedBuildListEntryIds.slice().sort()).toEqual(replaced.map(entry => entry.id).sort())
  }, 60_000)

  it('classifies the other ends: not found, search bound reached and unsupported - never as one another', async () => {
    // Every structural candidate is rejected by the Planner (the same Ideal makes a and c satisfy each other), and the search is exhausted.
    const held = await scenarioHeldCrossing()
    const rejected = result(await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene), bounds()))
    expect(rejected).toMatchObject({ status: 'not_found', reason: 'candidates_rejected' })
    expect(rejected.status === 'not_found' && rejected.diagnostics.structuralSearch?.completeness).toBe('exhausted')
    // The same input stopped by each bound is never "not found".
    expect(result(await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene), bounds({ maxStructuralCandidates: 1 }))))
      .toMatchObject({ status: 'search_bound_reached', bounds: [{ kind: 'structural_candidate_limit', maxStructuralCandidates: 1 }] })
    expect(result(await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene), bounds({ maxPlannerVerifications: 2 }))))
      .toMatchObject({ status: 'search_bound_reached', bounds: [{ kind: 'planner_verification_budget', maxPlannerVerifications: 2 }] })
    expect(result(await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene), bounds({ nodeBudget: 1 }))))
      .toMatchObject({ status: 'search_bound_reached', bounds: [{ kind: 'structural_search_node_budget', nodeBudget: 1 }] })
    const gate = { maxDepthUpperBound: 0, maxGogmaGeneratedStateUpperBound: 0, maxNormalForgeCount: 0, maxConversionWalkPositions: 0 }
    const gated = result(await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene), bounds({ routeGeneration: { ...OPEN_SHAPE_SETTINGS, shapeSearchScaleGate: gate } })))
    expect(gated.status).toBe('search_bound_reached')
    expect(gated.status === 'search_bound_reached' && gated.bounds.every(bound => bound.kind === 'shape_search_scale_gate')).toBe(true)
    // A window in which a Target has no reach option: the exhausted search delivers no structural candidate.
    const none = result(await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene), bounds({ window: { skill: 1, gogma: 1, normal: 1 } })))
    expect(none).toMatchObject({ status: 'not_found', reason: 'no_structural_candidate', diagnostics: { structuralSearch: { noStructuralCandidateReason: 'target_without_option' } } })
  }, 120_000)

  it('reports every Stage 0 unsupported reason, and refuses invalid bounds and an input carrying conflict resolutions', async () => {
    const { scene } = await scenarioConversionFallback()
    const run = (input: PlannerInput) => production.runBuildListOptimization(input, testDependencies(scene), bounds())
    // Two Entries of one planning Target: the whole input fails closed (invalid_planner_input).
    const duplicate = structuredClone(scene.input.buildListEntries[0]!)
    duplicate.id = 'build-list.fixture.duplicate' as BuildListEntry['id']
    expect(result(await run({ ...scene.input, buildListEntries: [...scene.input.buildListEntries, duplicate] }))).toMatchObject({ status: 'unsupported', reasons: [{ kind: 'invalid_planner_input' }] })
    // No valid Entry at all.
    expect(result(await run({ ...scene.input, buildListEntries: scene.input.buildListEntries.map(entry => ({ ...entry, searchStateHash: 'fnv1a32:00000000' })) })))
      .toEqual({ status: 'unsupported', reasons: [{ kind: 'no_planning_target' }] })
    // The precondition collection names every reason at once (here a selected intermediate state and an unconfirmed Gogma Counter).
    const created = production.createBuildListOptimizationContext(scene.input, testDependencies(scene))
    if (created.kind !== 'context') throw new Error(created.detail)
    const pinned = { ...created.context, plannerInput: { ...created.context.plannerInput, rngState: { ...created.context.plannerInput.rngState, gogmaCounter: { value: 10, isConfirmed: false, source: 'manual' as const } } },
      validation: { ...created.context.validation, validBuildListEntries: created.context.validation.validBuildListEntries.map(({ entry, missingRngRequirements }, index) => ({
        missingRngRequirements, entry: index === 0 ? { ...entry, intermediateStateSelection: { skillOpportunityId: 'opportunity.fixture.skill', bonusOpportunityId: null, improvementPreference: 'planner' } as BuildListEntry['intermediateStateSelection'] } : entry })) } }
    const violations = production.collectReachTablePreconditionViolations(pinned, scene.engine, { all: true })
    expect(violations.map(value => value.reason)).toEqual(['unconfirmed_rng_state', 'checkpoint_selection'])
    expect(production.collectReachTablePreconditionViolations(pinned, scene.engine, { all: false }).map(value => value.reason)).toEqual(['unconfirmed_rng_state'])
    // The caller's contract.
    await expect(production.runBuildListOptimization({ ...scene.input, conflictResolutions: [{ conflictKey: 'x', selectedBuildListEntryId: scene.input.buildListEntries[0]!.id }] }, testDependencies(scene), bounds()))
      .rejects.toThrow(RangeError)
    for (const invalid of [bounds({ nodeBudget: 0 }), bounds({ maxStructuralCandidates: 1.5 }), bounds({ maxPlannerVerifications: Number.NaN }), bounds({ window: { ...WINDOW, gogma: 0 } }),
      bounds({ routeGeneration: { ...OPEN_SHAPE_SETTINGS, projectedSearchScaleGate: { ...OPEN_SHAPE_SETTINGS.projectedSearchScaleGate, maxGogmaLegalWidth: -1 } } })]) {
      await expect(production.runBuildListOptimization(scene.input, testDependencies(scene), invalid)).rejects.toThrow(RangeError)
    }
  }, 60_000)

  it('returns cancelled, never a result, when the caller cancels at any stage', async () => {
    const { scene } = await scenarioConversionFallback()
    for (const stopAt of ['input_check', 'reach_table', 'assignment_search', 'route_generation', 'plan_verification'] as const) {
      let stop = false
      const run = await production.runBuildListOptimization(scene.input, testDependencies(scene), bounds(), {
        onStage: stage => { if (stage === stopAt) stop = true }, shouldCancel: () => stop,
      })
      expect(run, stopAt).toEqual({ kind: 'cancelled' })
    }
  }, 60_000)

  it('is deterministic: two calculations and calculations under other collations agree on every semantic value (IDs and times apart)', async () => {
    const { scenario, input } = await scenarioWithExclusions()
    const first = await production.runBuildListOptimization(input, testDependencies(scenario.scene, 'first'), bounds())
    const second = await production.runBuildListOptimization(input, testDependencies(scenario.scene, 'second'), bounds())
    expect(optimized(first).plannerResult.plan!.id).not.toBe(optimized(second).plannerResult.plan!.id)
    expect(hashStableValue(semanticOf(second))).toBe(hashStableValue(semanticOf(first)))
    // Danish (`aa` after `z`), Czech (`ch` after `h`) and Hawaiian (vowels first) reorder IDs a locale-dependent order would reach.
    for (const locale of ['da', 'cs', 'haw']) {
      String.prototype.localeCompare = function localeCompare(this: string, that: string, locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
        return originalLocaleCompare.call(this, that, locales ?? locale, options)
      }
      const forced = await production.runBuildListOptimization(input, testDependencies(scenario.scene, locale), bounds())
      String.prototype.localeCompare = originalLocaleCompare
      expect(hashStableValue(semanticOf(forced)), locale).toBe(hashStableValue(semanticOf(first)))
    }
    // The other result classes are deterministic too.
    const held = await scenarioHeldCrossing()
    const a = await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene, 'a'), bounds())
    const b = await production.runBuildListOptimization(held.scene.input, testDependencies(held.scene, 'b'), bounds())
    expect(stableStringify(semanticOf(b))).toBe(stableStringify(semanticOf(a)))
  }, 120_000)

  it('reports the Research tokens nowhere and the Production ones everywhere an identity is built', () => {
    const tokens = production.BUILD_LIST_OPTIMIZATION_ROUTE_IDENTITY
    expect(tokens.routePolicy).toBe('shape-constrained-route-policy:v1')
    expect(stableStringify(tokens)).not.toMatch(RESEARCH_TOKENS)
    expect(Object.isFrozen(tokens)).toBe(true)
  })
})
