import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../../domain/models/publicTypes'
import { validateBuildListEntry } from '../../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../../domain/planner/alternative/plannerAlternativeReservation'
import { emptyPlannerAlternativeReservation } from '../../domain/search/alternative'
import { ShapeConstrainedSearchError, visitShapeConstrainedRouteCandidates } from '../../domain/search/research'
import { CandidateSearchError } from '../../domain/search/searchTypes'
import { conversion, NONE, reset } from './coverageTestFixture'
import {
  buildPlannerAlternativeRequest, buildShapeConstrainedRequest, executeMaterializationRequest, executeShapeConstrainedRequest, materializeStructuralCandidate,
  productionShapeMaterializationSearchPort, type ShapeMaterializationSearchPort,
} from './materialize'
import {
  ELEMENT_B, materializationScenario, newNormalSource, OPEN_GATE, ownedSource, scenarioAlternativeFirst, scenarioConversionFallback, scenarioHeldCrossing,
  scenarioSkillDependency, TARGET,
} from './materializationTestFixture'
import {
  GlobalAssignmentMaterializationError, type MaterializationOutcome, type PlannerAlternativeAttempt, type StructuralCandidateMaterialization, type StructuralCandidateMaterializationResult,
} from './materializationTypes'
import {
  OPEN_SHAPE_BUDGET, OPEN_SHAPE_GATE, OPEN_SHAPE_SETTINGS, routeText, scenarioG1Continuation, scenarioG3Lower, scenarioG3Upper, shapeCapturingPort, shapeInputs,
} from './shapeMaterializationTestFixture'
import type { ShapeConstrainedAttempt, ShapeMethodSelection } from './shapeMaterializationTypes'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'

/*
 * Issue #154 Global Assignment Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.4 / 9.1 / 10 / 11): the
 * shape-constrained materialization and the rule `d0a2-v2` over the synthetic fixture and a deterministic table Engine, end to
 * end through the D-0A-2a seam. No Planner run, no Trace Replay, no oracle, no real Export.
 */

function materialized(result: StructuralCandidateMaterializationResult): StructuralCandidateMaterialization {
  if (result.kind !== 'materialization') throw new Error(`${result.reason}: ${result.detail}`)
  return result
}

function entryOf(outcome: MaterializationOutcome): BuildListEntry {
  if (outcome.kind !== 'materialized') throw new Error(`Not materialized: ${JSON.stringify(outcome)}`)
  return outcome.entry
}

async function rejection(promise: Promise<unknown>): Promise<GlobalAssignmentMaterializationError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) return error
    throw error
  }
  throw new Error('Expected a GlobalAssignmentMaterializationError.')
}


describe('Phase D-0A-2b rule d0a2-v2: method choice and end-to-end materialization (design 11)', () => {
  it('materializes every D-0A scenario, a non-continuous shape by the shape-constrained method alone and a continuous one projected first', async () => {
    const held = await scenarioHeldCrossing()
    const spy = shapeCapturingPort()
    const run = materialized(await materializeStructuralCandidate(held.candidate, shapeInputs(held.scene, { search: spy.port })))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    expect(run.materializationOrder).toEqual(held.candidate.materializationOrder)
    expect(run.targets.map(target => target.targetWeaponId)).toEqual(held.candidate.materializationOrder)
    const [aRecord, cRecord] = run.targets
    expect(aRecord!.selection).toMatchObject({ materializationRule: 'd0a2-v2', rule: 'continuous_projected_then_shape_constrained', continuous: true, continuation: null, policyShape: null, order: ['candidate_search_projected', 'shape_constrained'] })
    expect(aRecord!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected'])
    expect(cRecord!.selection).toMatchObject({ rule: 'non_continuous_shape_constrained_only', continuous: false, order: ['shape_constrained'] })
    expect(cRecord!.attempts.map(attempt => attempt.method)).toEqual(['shape_constrained'])
    expect(cRecord!.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', deliveredBeforeMatch: 0, plannerRequired: { skill: [], gogma: [11, 14], normal: null } })
    expect(routeText(entryOf(cRecord!.outcome))).toBe('R10,R11,K13,K14')
    // The seam ran once, for c, under the formal reservation derived from a's Entry alone and c's own shape.
    expect(spy.seamInputs).toHaveLength(1)
    expect(spy.seamInputs[0]!.reservation).toEqual(derivePlannerAlternativeReservation([run.materializedEntries[0]!], held.scene.engine))
    expect(spy.seamInputs[0]!.shape).toEqual({ base: { kind: 'owned_gogma', ownedWeaponId: 'owned.g2' }, skill: { kind: 'zero' }, bonus: { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 14 } })
    for (const entry of run.materializedEntries) expect(validateBuildListEntry(entry).isValid).toBe(true)

    for (const build of [scenarioConversionFallback, scenarioSkillDependency, scenarioAlternativeFirst]) {
      const { scene, candidate } = await build()
      const other = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
      expect(other.outcome, build.name).toEqual({ kind: 'all_materialized' })
      expect(other.targets.map(target => target.targetWeaponId), build.name).toEqual(candidate.materializationOrder)
      // Design 9.1 (Planner Alternative Search) is never part of the rule.
      for (const target of other.targets) for (const attempt of target.attempts) expect(attempt.method, build.name).not.toBe('planner_alternative_reservation')
    }
  }, 60_000)

  it('falls back to the shape-constrained method once after a projected mismatch, and keeps the formal reservation for both attempts', async () => {
    const { scene, candidate } = await scenarioConversionFallback()
    const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
    const bRecord = run.targets[0]!
    expect(bRecord.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'shape_constrained'])
    expect(bRecord.attempts[0]).toMatchObject({ result: { kind: 'canonical_mismatch' } })
    expect(bRecord.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', plannerRequired: { skill: [7], gogma: [11], normal: { counterId: 'weapon.fixture.a:8', position: 5 } } })
    expect(routeText(entryOf(bRecord.outcome))).toBe('n2@4,c7,R10,R11')
    const shape = bRecord.attempts[1] as ShapeConstrainedAttempt
    expect(shape.request.reservation).toEqual(emptyPlannerAlternativeReservation)
    // Pre-base work of a new-Normal base: one Normal prediction (p), one conversion Skill prediction (c); Resets on the stream.
    expect(shape.observed!.searchPredictions).toMatchObject({ normalArtian: 1, skill: 1, gogmaReset: 2, gogmaKeep: 0 })
  }, 30_000)

  it('stops after a projected cancellation, gates each attempt on its own, and runs at most two attempts', async () => {
    const { scene, candidate } = await scenarioConversionFallback()
    // The projected gate refuses b's projected Search: the shape-constrained method still runs (a gate is never a match).
    const gated = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene, { settings: { ...OPEN_SHAPE_SETTINGS, projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } } })))
    expect(gated.targets[0]!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'shape_constrained'])
    expect(gated.targets[0]!.attempts[0]).toMatchObject({ result: { kind: 'not_executed', reason: 'search_scale_gate' } })
    expect(gated.outcome).toEqual({ kind: 'all_materialized' })
    // A cancellation during the projected Search ends the Target as unmeasured: no fallback.
    let cancel = false
    const port: ShapeMaterializationSearchPort = {
      ...productionShapeMaterializationSearchPort,
      searchCandidates: async (...args) => { cancel = true; return productionShapeMaterializationSearchPort.searchCandidates(...args) },
    }
    const spy = shapeCapturingPort(port)
    const cancelled = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene, { search: spy.port, shouldCancel: () => cancel })))
    expect(cancelled.targets[0]!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected'])
    expect(cancelled.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcome: { kind: 'unmeasured', reason: 'cancelled' } })
    expect(spy.seamInputs).toHaveLength(0)
  }, 30_000)

  it('keeps the rule d0a-v1 the default: inputs without a rule run design 9.1 and never the seam', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const v1 = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    expect(v1.targets[1]!.attempts.map(attempt => attempt.method)).toEqual(['planner_alternative_reservation'])
    expect(v1.targets[1]!.selection).toMatchObject({ rule: 'non_continuous_planner_alternative_only' })
    expect('materializationRule' in v1.targets[1]!.selection!).toBe(false)
  }, 30_000)
})

describe('Phase D-0A-2b G1 / G3 / G4 end to end', () => {
  it('G1: materializes the lane-start Ideal conversion continuation that d0a-v1 classifies as a Search-policy shape', async () => {
    const { scene, candidate } = await scenarioG1Continuation()
    const v1 = materialized(await materializeStructuralCandidate(candidate, { ...scene.inputs(), searchPolicyPrecheck: true }))
    expect(v1.outcome).toMatchObject({ kind: 'materialization_unconfirmed', outcome: { kind: 'not_executed', reason: 'search_policy_shape' } })
    const v2 = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
    expect(v2.outcome).toEqual({ kind: 'all_materialized' })
    const record = v2.targets[0]!
    const selection = record.selection as ShapeMethodSelection
    expect(selection).toMatchObject({ rule: 'continuation_shape_constrained_only', order: ['shape_constrained'] })
    // The Search-policy shape is kept on the record so the shapes the Search policy never returns are counted (design 6.1).
    expect(selection.policyShape).toEqual({ policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 7, finalPosition: 9 })
    expect(selection.continuation).toEqual(selection.policyShape)
    expect(record.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', plannerRequired: { skill: [7, 9], gogma: [11], normal: { counterId: 'weapon.fixture.a:8', position: 4 } } })
    // The conversion Skill at 7 is Ideal; the Route still resets the Skills at 8 and 9.
    expect(routeText(entryOf(record.outcome))).toBe('n1@4,c7,R10,R11,S8,S9')
    expect((record.attempts[0] as ShapeConstrainedAttempt).routeChecks).toMatchObject({ passed: true, issues: [] })
  }, 30_000)

  it('G3 upper: materializes the Keep chain d0a-v1 leaves unconfirmed', async () => {
    const { scene, candidate } = await scenarioG3Upper()
    const v1 = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    expect(v1.outcome).toMatchObject({ kind: 'materialization_unconfirmed', outcome: { kind: 'unconfirmed', reason: 'stopped_by_extent', closestMismatch: { reasons: ['gogma_required'], plannerRequired: { gogma: [12, 14] } } } })
    const v2 = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
    expect(v2.outcome).toEqual({ kind: 'all_materialized' })
    expect(v2.targets[0]!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'shape_constrained'])
    expect(v2.targets[0]!.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', plannerRequired: { gogma: [14] } })
    expect(routeText(entryOf(v2.targets[0]!.outcome))).toBe('K10,K11,K12,K13,K14')
  }, 30_000)

  it('G3 lower: the minimal Route through g1 is delivered first, where Planner Alternative Search delivers the q history first', async () => {
    const { scene, candidate, shape } = await scenarioG3Lower()
    // a covers 10 .. 12 from the origin (its projected Search is gated, so the shape-constrained method materializes it).
    const settings = { ...OPEN_SHAPE_SETTINGS, projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } }
    const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene, { settings })))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    const [aRecord, cRecord] = run.targets
    expect(routeText(entryOf(aRecord!.outcome))).toBe('R10,R11,R12')
    expect(routeText(entryOf(cRecord!.outcome))).toBe('R11,K13,K14')
    expect(cRecord!.outcome).toMatchObject({ plannerRequired: { gogma: [11, 14] }, deliveredBeforeMatch: 0 })
    // Planner Alternative Search under the same formal reservation: the cheapest delivery keeps the q = 10 history.
    const aEntry = run.materializedEntries[0]!
    const alternative = await buildPlannerAlternativeRequest(shape.c!, [aEntry], scene.inputs())
    const attempt = await executeMaterializationRequest(alternative, [aEntry], scene.inputs()) as PlannerAlternativeAttempt
    expect(attempt.outcome.kind).toBe('materialized')
    const paEntry = entryOf(attempt.outcome)
    expect(attempt.outcome).toMatchObject({ deliveredBeforeMatch: 1 })
    expect(routeText(paEntry)).toBe('R10,R11,K13,K14')
    expect(paEntry.candidateSnapshot.estimatedOperationCount).toBe(entryOf(cRecord!.outcome).candidateSnapshot.estimatedOperationCount + 1)
  }, 30_000)

  it('G4: a protected Ideal source is materialized by a zero-operation shape, and never operated', async () => {
    const scene = await materializationScenario({
      targets: ['a'], owned: [ownedGogma('owned.ideal', { seriesSkillId: 'series_skill.fixture.a', restorationBonuses: structuredClone(IDEAL_BONUSES), isProtected: true })],
      window: { skill: 3, gogma: 5, normal: 2 },
    })
    const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.ideal'), NONE, NONE)])
    const shape = candidate.expectedShapes[0]!
    const request = await buildShapeConstrainedRequest(shape, [], shapeInputs(scene))
    expect(request.routeShape).toEqual({ base: { kind: 'owned_gogma', ownedWeaponId: 'owned.ideal' }, skill: { kind: 'zero' }, bonus: { kind: 'zero' } })
    expect(request.premiseViolations).toEqual([])
    const attempt = await executeShapeConstrainedRequest(request, [], shapeInputs(scene))
    expect(attempt.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', plannerRequired: { skill: [], gogma: [], normal: null } })
    expect(entryOf(attempt.outcome).candidateSnapshot.route.operations).toEqual([])
    expect(attempt.routeChecks).toMatchObject({ passed: true })
    // The same weapon under an operating shape is a broken premise (Phase A never builds such an option): fail closed.
    const operating = structuredClone(shape)
    operating.option = { ...operating.option, bonusRequired: reset(12) }
    const error = await rejection(buildShapeConstrainedRequest(operating, [], shapeInputs(scene)).then(value => executeShapeConstrainedRequest(value, [], shapeInputs(scene))))
    expect(error).toMatchObject({ code: 'shape_base_unavailable', targetWeaponId: TARGET.a })
    expect(error.detail).toMatchObject({ origin: 'premise_check', violations: [{ kind: 'source_protected', ownedWeaponId: 'owned.ideal' }] })
  }, 30_000)
})

describe('Phase D-0A-2b identity, request re-derivation and determinism (design 9.1)', () => {
  it('derives the search identity from the token, the policy, the Target, the origin, the context, the extent, the reservation and the shape only', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
    const aEntry = run.materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    expect(request.searchIdentity.startsWith('research.global-assignment.shape.fnv1a32-')).toBe(true)
    expect((await buildShapeConstrainedRequest(structuredClone(shape.c!), [structuredClone(aEntry)], shapeInputs(scene))).searchIdentity).toBe(request.searchIdentity)
    expect((await buildShapeConstrainedRequest(shape.c!, [], shapeInputs(scene))).searchIdentity).not.toBe(request.searchIdentity)
    const cEntry = entryOf(run.targets[1]!.outcome)
    expect(cEntry.candidateSnapshot.searchRunId).toBe(request.searchIdentity)
    expect(cEntry.candidateSnapshot.id.startsWith('candidate.research.global-assignment.shape.')).toBe(true)
    // The D-0A identity, prefix and Entry ID rule are unchanged: the same Route of c has the same Entry ID under both rules.
    const v1 = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const v1Entry = v1.materializedEntries[1]!
    expect(routeText(v1Entry)).toBe(routeText(cEntry))
    expect(v1Entry.id).toBe(cEntry.id)
    expect(v1Entry.candidateId).not.toBe(cEntry.candidateId)
    expect(v1Entry.candidateSnapshot.searchRunId.startsWith('research.global-assignment.alternative.')).toBe(true)
  }, 30_000)

  it('fails closed on a request that differs from its re-derivation, before any Search', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const aEntry = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene))).materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    const spy = shapeCapturingPort()
    const tampered = [
      { ...request, reservation: { ...request.reservation, gogma: { held: [10, 11, 12], blocked: [12] } } },
      { ...request, reservation: { ...request.reservation, exclusiveOwnedWeaponIds: [] } },
      { ...request, reservationSourceEntryIds: [] },
      { ...request, extent: { ...request.extent, maxGogmaAdvance: request.extent.maxGogmaAdvance + 1 } },
      { ...request, routeShape: { ...request.routeShape, bonus: { kind: 'reset_then_keep' as const, resetPosition: 13, finalPosition: 14 } } },
      { ...request, origins: { ...request.origins, gogma: 11 } },
      { ...request, searchIdentity: 'research.global-assignment.shape.other' },
      { ...request, predictedScale: { ...request.predictedScale, depthUpperBound: 0 } },
      { ...request, premiseViolations: [] as typeof request.premiseViolations },
      { ...request, targetWeaponId: TARGET.a },
    ]
    tampered[8]!.premiseViolations = [{ kind: 'required_position_blocked', stream: 'gogma', position: 14 }]
    for (const value of tampered) {
      expect((await rejection(executeShapeConstrainedRequest(value, [aEntry], shapeInputs(scene, { search: spy.port })))).code).toBe('request_mismatch')
    }
    // The same request against other materialized Entries is another derivation.
    expect((await rejection(executeShapeConstrainedRequest(request, [], shapeInputs(scene, { search: spy.port })))).code).toBe('request_mismatch')
    expect(spy.seamInputs.length + spy.searchInputs.length).toBe(0)
    // The untouched request runs.
    expect((await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene))).outcome.kind).toBe('materialized')
  }, 30_000)

  it('returns the same requests, Entries and outcomes for the same input, and refuses invalid settings', async () => {
    for (const build of [scenarioHeldCrossing, scenarioConversionFallback, scenarioG1Continuation, scenarioG3Upper]) {
      const { scene, candidate } = await build()
      const first = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
      const second = materialized(await materializeStructuralCandidate(structuredClone(candidate), shapeInputs(scene)))
      expect(second, build.name).toEqual(first)
      expect(JSON.stringify(second), build.name).toBe(JSON.stringify(first))
    }
    const { scene, candidate } = await scenarioHeldCrossing()
    for (const settings of [
      { ...OPEN_SHAPE_SETTINGS, shapeSearchScaleGate: { ...OPEN_SHAPE_GATE, maxDepthUpperBound: -1 } },
      { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: { ...OPEN_SHAPE_BUDGET, maxSettledWork: 1.5 } },
      { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: { ...OPEN_SHAPE_BUDGET, maxPredictions: { ...OPEN_SHAPE_BUDGET.maxPredictions, gogmaKeep: Number.NaN } } },
      { ...OPEN_SHAPE_SETTINGS, projectedSearchScaleGate: { ...OPEN_GATE, maxConversionPositions: -1 } },
      { projectedSearchScaleGate: OPEN_GATE, shapeSearchScaleGate: OPEN_SHAPE_GATE } as never,
    ]) {
      expect(await materializeStructuralCandidate(candidate, shapeInputs(scene, { settings }))).toMatchObject({ kind: 'invalid_input', reason: 'invalid_settings' })
    }
  }, 60_000)
})

describe('Phase D-0A-2b scale gate, budget and cancellation (design 10.3 / 10.4)', () => {
  it('never calls the seam above the gate, names every exceeded component, and runs at the gate', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const aEntry = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene))).materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    const scale = request.predictedScale
    const spy = shapeCapturingPort()
    const gate = { maxDepthUpperBound: scale.depthUpperBound - 1, maxGogmaGeneratedStateUpperBound: scale.gogma.generatedStateUpperBound - 1, maxNormalForgeCount: scale.normalForgeCount, maxConversionWalkPositions: scale.preBase.conversionWalkPositions }
    const gated = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { search: spy.port, settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchScaleGate: gate } }))
    expect(gated.outcome).toEqual({ kind: 'not_executed', reason: 'search_scale_gate', method: 'shape_constrained', predicted: scale, exceeded: ['depthUpperBound', 'gogmaGeneratedStateUpperBound'] })
    expect(gated.observed).toBeNull()
    expect(spy.seamInputs).toHaveLength(0)
    const atGate = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchScaleGate: { ...gate, maxDepthUpperBound: scale.depthUpperBound, maxGogmaGeneratedStateUpperBound: scale.gogma.generatedStateUpperBound } } }))
    expect(atGate.outcome.kind).toBe('materialized')
    // A whole run stops at the gated Target as not executed (never a failure).
    const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchScaleGate: { ...OPEN_SHAPE_GATE, maxDepthUpperBound: 0 } } })))
    expect(run.outcome).toMatchObject({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.c, outcome: { kind: 'not_executed', reason: 'search_scale_gate', method: 'shape_constrained', exceeded: ['depthUpperBound'] } })
  }, 30_000)

  it('stops at the Research budget as unconfirmed, apart from a cancellation, and records what decided the stop', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const aEntry = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene))).materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    const open = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene))
    const used = open.observed!
    expect(used.stop).toEqual({ by: 'consumer', budgetExceeded: [] })
    expect(used.deliveredCandidates).toBe(1)
    // Exactly the budget the Search used: it completes.
    const exact = { maxGogmaGeneratedStates: used.instrumentation.gogmaGeneratedStates, maxSkillStates: used.instrumentation.skillStates, maxSettledWork: used.instrumentation.workSettled,
      maxPredictions: { normalArtian: used.searchPredictions.normalArtian, skill: used.searchPredictions.skill, gogmaReset: used.searchPredictions.gogmaReset, gogmaKeep: used.searchPredictions.gogmaKeep } }
    expect((await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: exact } }))).outcome.kind).toBe('materialized')
    // One unit less of the settled work: a budget stop, never a mismatch, an absence or a support question.
    const tight = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: { ...exact, maxSettledWork: exact.maxSettledWork - 1 } } }))
    expect(tight.outcome).toEqual({ kind: 'unconfirmed', reason: 'shape_search_budget_reached', budgetExceeded: ['settledWork'], delivered: 0, closestMismatch: null })
    expect(tight.observed).toMatchObject({ execution: null, deliveredCandidates: 0, stop: { by: 'budget', budgetExceeded: ['settledWork'] } })
    // The Route checks' re-predictions never count against the Search budget: the exact prediction budget still passes above.
    expect(open.routeChecks!.predictions.gogmaReset + open.routeChecks!.predictions.gogmaKeep).toBeGreaterThan(0)
    // A user / runner cancellation is unmeasured; when it coincides with the budget, the cancellation decided it and the budget is recorded.
    const cancelled = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { shouldCancel: () => true }))
    expect(cancelled.outcome).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
    expect(cancelled.observed!.stop).toEqual({ by: 'cancel', budgetExceeded: [] })
    const both = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { shouldCancel: () => true, settings: { ...OPEN_SHAPE_SETTINGS, shapeSearchBudget: { ...exact, maxPredictions: { ...exact.maxPredictions, gogmaReset: 0 } } } }))
    expect(both.outcome).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
  }, 30_000)

  it('gives the same outcome and Entry with and without the Search instrumentation, and counts the Search predictions apart from the checks', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const aEntry = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene))).materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    const withObservers = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene))
    const stripped: ShapeMaterializationSearchPort = {
      ...productionShapeMaterializationSearchPort,
      visitShapeConstrainedRouteCandidates: (input, engine, onCandidate, options) => visitShapeConstrainedRouteCandidates(input, engine, onCandidate, { shouldCancel: options?.shouldCancel, yieldControl: options?.yieldControl }),
    }
    const withoutObservers = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { search: stripped }))
    expect(withoutObservers.outcome).toEqual(withObservers.outcome)
    expect(withoutObservers.routeChecks).toEqual(withObservers.routeChecks)
    expect(withoutObservers.observed!.searchPredictions).toEqual(withObservers.observed!.searchPredictions)
    // The counting wrapper sees every Search prediction (its own count equals the table Engine's raw calls during the Search).
    const before = { ...scene.calls }
    const counted = await executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene))
    const raw = { reset: scene.calls.reset - before.reset, keep: scene.calls.keep - before.keep, skill: scene.calls.skill - before.skill, normal: scene.calls.normal - before.normal }
    const search = counted.observed!.searchPredictions
    const checks = counted.routeChecks!.predictions
    expect({ reset: search.gogmaReset + checks.gogmaReset, keep: search.gogmaKeep + checks.gogmaKeep, skill: search.skill + checks.skill, normal: search.normalArtian + checks.normalArtian }).toEqual(raw)
  }, 30_000)
})

describe('Phase D-0A-2b classification of support and seam ends (design 10.1)', () => {
  /** b = new Normal at 4, conversion at 7, Reset at 11 (the D-0A conversion scenario); `state` flips a support answer after Phase A. */
  async function supportScene() {
    const state = { reset: true, keep: true, normal: true, skill: true }
    const scene = await materializationScenario({
      targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [7] }, reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES } }, window: { skill: 3, gogma: 5, normal: 2 },
      support: input => {
        const supported = input.type === 'gogma_reset' ? state.reset : input.type === 'gogma_keep' ? state.keep : input.type === 'normal_artian' ? state.normal : state.skill
        return supported ? null : { supported: false, reason: 'unsupported_current_bonus' }
      },
    })
    const candidate = scene.candidate([scene.option(TARGET.b, newNormalSource(4), conversion(7, 7), reset(11))])
    return { scene, candidate, shape: candidate.expectedShapes[0]!, state }
  }

  it('category 4: a needed prediction Phase A judged supported and the seam answers unsupported fails closed as prediction_support_inconsistent', async () => {
    for (const kind of ['reset', 'normal', 'skill'] as const) {
      const { scene, shape, state } = await supportScene()
      state[kind] = false
      const request = await buildShapeConstrainedRequest(shape, [], shapeInputs(scene))
      const error = await rejection(executeShapeConstrainedRequest(request, [], shapeInputs(scene)))
      expect(error.code, kind).toBe('prediction_support_inconsistent')
      expect(error.detail, kind).toMatchObject({ origin: 'base_diagnosis', unavailable: { kind: 'prediction_unsupported' }, questions: [{ phaseA: 'supported' }] })
    }
  }, 30_000)

  it('categories 1 / 3: an Engine capability Phase A never reads is unsupported(capability_unavailable), never fail closed or a mismatch', async () => {
    const { scene, shape } = await supportScene()
    const request = await buildShapeConstrainedRequest(shape, [], shapeInputs(scene))
    ;(scene.engine.capabilities as { supportsGogmaPrediction: boolean }).supportsGogmaPrediction = false
    const attempt = await executeShapeConstrainedRequest(request, [], shapeInputs(scene))
    expect(attempt.outcome).toMatchObject({ kind: 'unsupported', reason: 'capability_unavailable', detail: { origin: 'base_diagnosis', unavailable: { kind: 'capability_unavailable', capability: 'gogma', cause: 'engine_capability_unavailable' }, questions: [] } })
    expect(attempt.observed!.execution).toMatchObject({ base: { admitted: false }, summary: { deliveredCandidates: 0 } })
  }, 30_000)

  it('category 2: the unsupported Keep of a Reset-only shape is never asked and never classified', async () => {
    const { scene, shape, state } = await supportScene()
    state.keep = false
    const request = await buildShapeConstrainedRequest(shape, [], shapeInputs(scene))
    const attempt = await executeShapeConstrainedRequest(request, [], shapeInputs(scene))
    expect(attempt.outcome.kind).toBe('materialized')
    expect(attempt.observed!.execution).toMatchObject({ requiredUnsupportedPredictions: [], forbiddenOperationNotices: 0 })
  }, 30_000)

  it('category 5: a broken position premise fails closed as shape_base_unavailable before any Search (an Entry using the source again)', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
    const cEntry = run.materializedEntries[1]!
    const spy = shapeCapturingPort()
    // c again after its own Entry: its source is exclusive and its required positions are blocked.
    const request = await buildShapeConstrainedRequest(shape.c!, [run.materializedEntries[0]!, cEntry], shapeInputs(scene))
    expect(request.premiseViolations).toEqual(expect.arrayContaining([{ kind: 'source_exclusive', ownedWeaponId: 'owned.g2' }, { kind: 'required_position_blocked', stream: 'gogma', position: 11 }]))
    const error = await rejection(executeShapeConstrainedRequest(request, [run.materializedEntries[0]!, cEntry], shapeInputs(scene, { search: spy.port })))
    expect(error).toMatchObject({ code: 'shape_base_unavailable', targetWeaponId: TARGET.c, detail: { origin: 'premise_check' } })
    expect(spy.seamInputs).toHaveLength(0)
  }, 30_000)

  it('fails closed on the seam\'s own contract violation, a refused input, an unexpected cancellation and an undelivered end', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const aEntry = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene))).materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    const visitWith = (visit: ShapeMaterializationSearchPort['visitShapeConstrainedRouteCandidates']) => executeShapeConstrainedRequest(request, [aEntry], shapeInputs(scene, { search: { ...productionShapeMaterializationSearchPort, visitShapeConstrainedRouteCandidates: visit } }))
    const report = (summary: { exhausted: boolean; stoppedByExtent: boolean }, requiredUnsupportedPredictions: { type: 'reset_bonuses' | 'keep_bonuses'; reason: 'unsupported_current_bonus' }[] = []) => async () => ({
      targetWeaponId: TARGET.c, summary: { deliveredCandidates: 0, ...summary }, stoppedByConsumer: false, base: { admitted: true, unavailable: null }, requiredUnsupportedPredictions, forbiddenOperationNotices: 0,
    })
    expect((await rejection(visitWith(async () => { throw new ShapeConstrainedSearchError('shape_search_contract_violation', 'x') }))).code).toBe('shape_search_contract_violation')
    expect((await rejection(visitWith(async () => { throw new ShapeConstrainedSearchError('invalid_reservation', 'x') }))).code).toBe('search_refused')
    expect((await rejection(visitWith(async () => { throw new CandidateSearchError('cancelled', 'x') }))).code).toBe('shape_search_contract_violation')
    expect((await rejection(visitWith(report({ exhausted: false, stoppedByExtent: false })))).code).toBe('shape_search_contract_violation')
    // The base was admitted, nothing needed was unsupported, and nothing was delivered: the lemma's premises broke (never "no Route").
    for (const summary of [{ exhausted: true, stoppedByExtent: false }, { exhausted: false, stoppedByExtent: true }]) {
      const error = await rejection(visitWith(report(summary)))
      expect(error.code).toBe('shape_constrained_unreachable')
      expect(error.message).toMatch(/never "no Route"/)
    }
    // A needed Keep unsupported by the stream, which Phase A judged supported (the Reset at 11's layout): inconsistent, never unreachable.
    const error = await rejection(visitWith(report({ exhausted: true, stoppedByExtent: false }, [{ type: 'keep_bonuses', reason: 'unsupported_current_bonus' }])))
    expect(error.code).toBe('prediction_support_inconsistent')
    expect(error.detail).toMatchObject({ origin: 'bonus_stream', questions: [{ question: { prediction: 'gogma_keep' }, phaseA: 'supported' }] })
    // A consumer stop without an accepted Candidate is a seam contract violation.
    const unacceptedStop: ShapeMaterializationSearchPort['visitShapeConstrainedRouteCandidates'] = async (input, engine, _onCandidate, options) => {
      const real = await shapeCapturingPort().port.visitShapeConstrainedRouteCandidates(input, engine, () => 'stop', options)
      return real
    }
    expect((await visitWith(unacceptedStop).catch(value => value)).code).toBe('shape_search_contract_violation')
  }, 30_000)

  it('reports a needed prediction Phase A never judged as unsupported(required_prediction_unsupported)', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const aEntry = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene))).materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.c!, [aEntry], shapeInputs(scene))
    // A ReachTable copy whose row never judged the Keep layout of the Reset at g1 (Phase A asks it for every layout of interest).
    const table = structuredClone(scene.table)
    const row = table.targets.find(value => value.targetWeaponId === TARGET.c)!
    row.bonus.keepIdealPositionsByLayout = new Map()
    row.bonus.keepUnsupportedLayouts = []
    const { runShapeConstrainedRequest } = await import('./shapeMaterializationRun')
    const attempt = await runShapeConstrainedRequest(request, {
      context: scene.context, table, engine: scene.engine, settings: OPEN_SHAPE_SETTINGS, materializedEntries: [aEntry], collisionCheckEntries: [], researchTime: '2026-01-01T00:00:00.000Z',
      visit: async () => ({ targetWeaponId: TARGET.c, summary: { deliveredCandidates: 0, exhausted: true, stoppedByExtent: false }, stoppedByConsumer: false, base: { admitted: true, unavailable: null }, requiredUnsupportedPredictions: [{ type: 'keep_bonuses', reason: 'unsupported_current_bonus' }], forbiddenOperationNotices: 0 }),
    })
    expect(attempt.outcome).toMatchObject({ kind: 'unsupported', reason: 'required_prediction_unsupported', detail: { origin: 'bonus_stream', questions: [{ phaseA: 'not_judged' }] } })
  }, 30_000)
})
