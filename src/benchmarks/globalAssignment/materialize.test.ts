import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../../domain/models/publicTypes'
import { validateBuildListEntry } from '../../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../../domain/planner/alternative/plannerAlternativeReservation'
import { createPlannerStartSearchOrigin } from '../../domain/planner/replacement/plannerSearchOrigin'
import { emptyPlannerAlternativeReservation, PlannerAlternativeSearchError, type PlannerAlternativeCandidate } from '../../domain/search/alternative'
import { extractIntermediateStateGroups } from '../../domain/search'
import type { CandidateSearchResult } from '../../domain/search/searchTypes'
import { conversion, reset } from './coverageTestFixture'
import type { StructuralCandidate } from './coverageTypes'
import {
  buildPlannerAlternativeRequest, buildProjectedRequest, executeMaterializationRequest, materializeStructuralCandidate, materializeTarget,
  productionMaterializationSearchPort, type MaterializationSearchPort,
} from './materialize'
import { matchExpectedShape } from './materializationShape'
import {
  capturingPort, ELEMENT_B, materializationScenario, newNormalSource, OPEN_GATE, OPEN_SETTINGS, replayAlternativeSearch, scenarioAlternativeFirst,
  scenarioConversionFallback, scenarioHeldCrossing, scenarioSkillDependency, TARGET,
} from './materializationTestFixture'
import { IDEAL_BONUSES } from './testFixture'
import {
  GlobalAssignmentMaterializationError, type MaterializationOutcome, type PlannerAlternativeAttempt, type ProjectedAttempt, type StructuralCandidateMaterialization,
  type StructuralCandidateMaterializationResult,
} from './materializationTypes'

/*
 * Issue #154 Global Assignment Phase D-0A (design 4.5 / 9.1 - 9.7 / 13.1 Phase D): one structural candidate
 * materialized through the Production Planner Alternative Search and Candidate Search over a synthetic
 * fixture and a deterministic table Engine. No Planner run, no Trace Replay, no oracle, no real Export.
 */

function materialized(result: StructuralCandidateMaterializationResult): StructuralCandidateMaterialization {
  if (result.kind !== 'materialization') throw new Error(`${result.reason}: ${result.detail}`)
  return result
}

function entryOf(outcome: MaterializationOutcome): BuildListEntry {
  if (outcome.kind !== 'materialized') throw new Error(`Not materialized: ${JSON.stringify(outcome)}`)
  return outcome.entry
}

const gogmaPositions = (entry: BuildListEntry) => entry.candidateSnapshot.route.operations.flatMap(operation => (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses' ? [operation.gogmaCounterBefore] : []))
const skillPositions = (entry: BuildListEntry) => entry.candidateSnapshot.route.operations.flatMap(operation => (operation.type === 'reset_skills' || operation.type === 'convert_normal_to_gogma' ? [operation.skillCounterBefore] : []))

async function rejection(promise: Promise<unknown>): Promise<GlobalAssignmentMaterializationError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) return error
    throw error
  }
  throw new Error('Expected a GlobalAssignmentMaterializationError.')
}

/** Delegates to the Production Search except for one Target's Searches. */
function overridePort(targetWeaponId: string, override: Partial<MaterializationSearchPort>): MaterializationSearchPort {
  return {
    visitPlannerAlternativeCandidates: (input, engine, onCandidate, options) => (input.targetWeaponId === targetWeaponId && override.visitPlannerAlternativeCandidates
      ? override.visitPlannerAlternativeCandidates(input, engine, onCandidate, options)
      : productionMaterializationSearchPort.visitPlannerAlternativeCandidates(input, engine, onCandidate, options)),
    searchCandidates: (input, engine, options) => (input.targetWeaponId === targetWeaponId && override.searchCandidates
      ? override.searchCandidates(input, engine, options)
      : productionMaterializationSearchPort.searchCandidates(input, engine, options)),
  }
}

describe('Phase D-0A Planner Alternative materialization (design 9.1)', () => {
  it('materializes the first Target under the formal empty reservation, passing the Planner-start origin and an empty excludedRouteKeys', async () => {
    const { scene, shape } = await scenarioHeldCrossing()
    const request = await buildPlannerAlternativeRequest(shape.a!, [], scene.inputs())
    expect(request.reservation).toEqual(emptyPlannerAlternativeReservation)
    expect(request.reservationSourceEntryIds).toEqual([])
    expect(request.excludedRouteKeys).toEqual([])
    // Design 9.1 extentFor: the Gogma window ends at the last required position 12; no Normal / Skill operation.
    expect(request.extent).toEqual({ maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 1 })
    const spy = capturingPort()
    const attempt = await executeMaterializationRequest(request, [], scene.inputs({ search: spy.port })) as PlannerAlternativeAttempt
    expect(spy.alternativeInputs).toHaveLength(1)
    expect(spy.searchInputs).toHaveLength(0)
    const input = spy.alternativeInputs[0]!
    expect(input.reservation).toEqual(emptyPlannerAlternativeReservation)
    expect(input.excludedRouteKeys).toEqual([])
    expect(input.extent).toEqual(request.extent)
    expect(input.origin).toEqual(createPlannerStartSearchOrigin(scene.input))
    expect(attempt.outcome).toMatchObject({ kind: 'materialized', method: 'planner_alternative_reservation', deliveredBeforeMatch: 0, plannerRequired: { skill: [], gogma: [12], normal: null } })
    const entry = entryOf(attempt.outcome)
    // Nothing is held, so the Route covers the Gogma origin itself: a continuous Reset chain ending at 12.
    expect(gogmaPositions(entry)).toEqual([10, 11, 12])
    expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(entry.id.startsWith('build-list.constrained.')).toBe(true)
    expect(entry.candidateSnapshot.id.startsWith('candidate.research.global-assignment.')).toBe(true)
    expect(entry.candidateSnapshot.searchRunId).toBe(request.searchIdentity)
    expect(attempt.observed).toMatchObject({ deliveredCandidates: 1, stoppedByConsumer: true, exhausted: false, stoppedByExtent: false })
  }, 30_000)

  it('derives a later Target\'s reservation from the materialized Entries only and passes it to the Search unchanged', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const spy = capturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: spy.port })))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    const [aEntry] = run.materializedEntries
    const derived = derivePlannerAlternativeReservation([aEntry!], scene.engine)
    // a materialized a single Reset at 12: only that position is held / blocked and only its weapon is exclusive.
    expect(derived).toEqual({ normal: [], skill: { held: [], blocked: [] }, gogma: { held: [12], blocked: [12] }, exclusiveOwnedWeaponIds: ['owned.g1'] })
    const cAttempt = run.targets[1]!.attempts[0] as PlannerAlternativeAttempt
    expect(cAttempt.method).toBe('planner_alternative_reservation')
    expect(cAttempt.request.reservation).toEqual(derived)
    expect(cAttempt.request.reservationSourceEntryIds).toEqual([aEntry!.id])
    expect(spy.alternativeInputs).toHaveLength(1)
    expect(spy.alternativeInputs[0]!.reservation).toEqual(derived)
    // c's own planned positions (10, 11, 13, 14) were never pre-registered as held or blocked.
    for (const position of [10, 11, 13, 14]) expect(spy.alternativeInputs[0]!.reservation.gogma.held).not.toContain(position)
  }, 30_000)

  it('materializes a later Target whose Route crosses a held position (a non-continuous Route), never through the projected Search', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const spy = capturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: spy.port })))
    expect(run.materializationOrder).toEqual([TARGET.a, TARGET.c])
    const [aRecord, cRecord] = run.targets
    expect(aRecord!.selection!.rule).toBe('continuous_owned_gogma_projected_first')
    expect(gogmaPositions(entryOf(aRecord!.outcome))).toEqual([12])
    expect(cRecord!.selection).toMatchObject({ continuous: false, rule: 'non_continuous_planner_alternative_only', order: ['planner_alternative_reservation'] })
    expect(cRecord!.attempts.map(attempt => attempt.method)).toEqual(['planner_alternative_reservation'])
    // Only a's projected Search ran; c, being non-continuous, never reaches searchCandidates().
    expect(spy.searchInputs.map(input => input.targetWeaponId)).toEqual([TARGET.a])
    const cEntry = entryOf(cRecord!.outcome)
    expect(gogmaPositions(cEntry)).toEqual([10, 11, 13, 14])
    expect(cRecord!.outcome).toMatchObject({ plannerRequired: { skill: [], gogma: [11, 14], normal: null } })
    for (const entry of run.materializedEntries) expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(run.materializedTargetCount).toBe(2)
    expect(run.notAttemptedTargetWeaponIds).toEqual([])
  }, 30_000)

  it('gives a match priority over the delivery cap and reports a cap stop as unconfirmed(delivery_cap_reached)', async () => {
    const { scene, shape } = await scenarioHeldCrossing()
    // With nothing held, c's cheapest Ideal Routes end with a Reset at 12 (another shape), so the match comes later.
    const request = await buildPlannerAlternativeRequest(shape.c!, [], scene.inputs())
    const open = await executeMaterializationRequest(request, [], scene.inputs()) as PlannerAlternativeAttempt
    if (open.outcome.kind !== 'materialized') throw new Error(open.outcome.kind)
    const k = open.outcome.deliveredBeforeMatch
    expect(k).toBeGreaterThanOrEqual(1)
    const capped = (deliveryCap: number) => executeMaterializationRequest(request, [], scene.inputs({ settings: { ...OPEN_SETTINGS, deliveryCap } })) as Promise<PlannerAlternativeAttempt>
    const atCap = await capped(k + 1)
    expect(atCap.outcome).toMatchObject({ kind: 'materialized', deliveredBeforeMatch: k })
    const beforeMatch = await capped(k)
    expect(beforeMatch.outcome).toMatchObject({ kind: 'unconfirmed', reason: 'delivery_cap_reached', delivered: k })
    expect(beforeMatch.observed).toMatchObject({ stoppedByConsumer: true, exhausted: false, stoppedByExtent: false })
    if (beforeMatch.outcome.kind !== 'unconfirmed') throw new Error('unreachable')
    expect(beforeMatch.outcome.closestMismatch!.reasons).toContain('gogma_required')
  }, 30_000)

  it('reads shape_mismatch only from an exhausted Search; stoppedByExtent stays unconfirmed even with every expected position in the extent', async () => {
    const { scene, shape } = await scenarioHeldCrossing()
    const request = await buildPlannerAlternativeRequest(shape.c!, [], scene.inputs())
    // The first delivered Candidates of c (all of another shape), recorded from the real Search under a cap.
    const spy = capturingPort()
    const open = await executeMaterializationRequest(request, [], scene.inputs()) as PlannerAlternativeAttempt
    const k = (open.outcome as Extract<MaterializationOutcome, { kind: 'materialized' }>).deliveredBeforeMatch
    await executeMaterializationRequest(request, [], scene.inputs({ search: spy.port, settings: { ...OPEN_SETTINGS, deliveryCap: k } }))
    const mismatching = spy.delivered[0]!
    expect(mismatching).toHaveLength(k)
    const replay = (report: { exhausted: boolean; stoppedByExtent: boolean }) => executeMaterializationRequest(request, [], scene.inputs({
      search: { ...productionMaterializationSearchPort, visitPlannerAlternativeCandidates: replayAlternativeSearch(mismatching, report) },
    })) as Promise<PlannerAlternativeAttempt>
    // The expected required positions 11 and 14 lie inside the extent window 10..14.
    expect(request.scaleDetail.gogmaWindow).toEqual({ from: 10, to: 14 })
    const exhausted = await replay({ exhausted: true, stoppedByExtent: false })
    expect(exhausted.outcome).toMatchObject({ kind: 'shape_mismatch', delivered: k })
    if (exhausted.outcome.kind !== 'shape_mismatch') throw new Error('unreachable')
    expect(exhausted.outcome.closestMismatch).not.toBeNull()
    const extent = await replay({ exhausted: false, stoppedByExtent: true })
    expect(extent.outcome).toMatchObject({ kind: 'unconfirmed', reason: 'stopped_by_extent', delivered: k })
    // A report outside the Search contract fails closed instead of being classified.
    for (const report of [{ exhausted: false, stoppedByExtent: false }, { exhausted: true, stoppedByExtent: true }]) {
      expect((await rejection(replay(report))).code).toBe('search_contract_violation')
    }
  }, 30_000)

  it('ends a cancelled Target as unmeasured(cancelled) and stops the run, before or during a Search', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const before = capturingPort()
    const early = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: before.port, shouldCancel: () => true })))
    expect(early.targets).toHaveLength(1)
    expect(early.targets[0]).toMatchObject({ targetWeaponId: TARGET.a, selection: null, attempts: [], outcome: { kind: 'unmeasured', reason: 'cancelled' } })
    expect(early.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.a, outcome: { kind: 'unmeasured', reason: 'cancelled' } })
    expect(early.notAttemptedTargetWeaponIds).toEqual([TARGET.c])
    expect(before.alternativeInputs.length + before.searchInputs.length).toBe(0)

    let cancel = false
    const during = capturingPort(productionMaterializationSearchPort, () => { cancel = true })
    const late = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: during.port, shouldCancel: () => cancel })))
    // a's projected Search rejected with the Search's own cancellation: no fallback Search ran.
    expect(late.targets[0]!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected'])
    expect((late.targets[0]!.attempts[0] as ProjectedAttempt).result).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
    expect(late.outcome).toMatchObject({ kind: 'materialization_unconfirmed', outcome: { kind: 'unmeasured', reason: 'cancelled' } })
    expect(late.materializedEntries).toEqual([])
  }, 30_000)
})

describe('Phase D-0A shape matching (design 8.3 / 9.1)', () => {
  it('accepts Entries whose chains differ when the source, the required positions and the final weapon match', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const crossing = run.materializedEntries[1]!
    const request = await buildPlannerAlternativeRequest(shape.c!, [], scene.inputs())
    const covering = entryOf((await executeMaterializationRequest(request, [], scene.inputs()) as PlannerAlternativeAttempt).outcome)
    expect(gogmaPositions(crossing)).toEqual([10, 11, 13, 14])
    expect(gogmaPositions(covering)).toContain(12)
    for (const entry of [crossing, covering]) {
      expect(matchExpectedShape(entry, shape.c!, scene.engine)).toEqual({ matches: true, plannerRequired: { skill: [], gogma: [11, 14], normal: null } })
    }
  }, 30_000)

  it('rejects a different source, required position or final weapon, a blind creation and an unplannable Route', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const [aEntry, cEntry] = run.materializedEntries
    const other = matchExpectedShape(aEntry!, shape.c!, scene.engine)
    expect(other.matches).toBe(false)
    if (other.matches) throw new Error('unreachable')
    // Same final weapon (the Ideal), other source and other required positions.
    expect(other.reasons).toEqual(expect.arrayContaining(['target', 'source', 'gogma_required']))
    expect(other.reasons).not.toContain('final_bonuses')

    const lowered: BuildListEntry = structuredClone(cEntry!)
    lowered.candidateSnapshot.finalBonuses[0] = { ...lowered.candidateSnapshot.finalBonuses[0]!, bonusRankId: 'bonus_rank.fixture.low' }
    expect(matchExpectedShape(lowered, shape.c!, scene.engine)).toEqual({ matches: false, reasons: ['final_bonuses'], plannerRequired: { skill: [], gogma: [11, 14], normal: null } })
    const reordered: BuildListEntry = structuredClone(cEntry!)
    reordered.candidateSnapshot.finalBonuses.reverse()
    expect(matchExpectedShape(reordered, shape.c!, scene.engine).matches).toBe(true)
    const shapeWith = (edit: (value: NonNullable<typeof shape.c>) => void) => {
      const copy = structuredClone(shape.c!)
      edit(copy)
      return copy
    }
    const reasonsOf = (value: ReturnType<typeof matchExpectedShape>) => (value.matches ? [] : value.reasons)
    expect(reasonsOf(matchExpectedShape(cEntry!, shapeWith(value => { value.match.restorationBonusScope = 'normal_artian' }), scene.engine))).toEqual(['restoration_bonus_scope'])
    expect(reasonsOf(matchExpectedShape(cEntry!, shapeWith(value => { value.match.seriesSkillId = 'series_skill.fixture.other' }), scene.engine))).toEqual(['series_skill'])
    expect(reasonsOf(matchExpectedShape(cEntry!, shapeWith(value => { value.match.groupSkillId = 'group_skill.fixture.a' }), scene.engine))).toEqual(['group_skill'])
    expect(reasonsOf(matchExpectedShape(cEntry!, shapeWith(value => { value.match.required.gogma = [11, 13] }), scene.engine))).toEqual(['gogma_required'])
    expect(reasonsOf(matchExpectedShape(cEntry!, shapeWith(value => { value.match.required.skill = [7] }), scene.engine))).toEqual(['skill_required'])
    expect(reasonsOf(matchExpectedShape(cEntry!, shapeWith(value => { value.match.sourceOwnedWeaponId = 'owned.g1' as never }), scene.engine))).toEqual(['source'])

    // A Route the Planner cannot unit-plan has no required position to compare.
    const unplannable: BuildListEntry = structuredClone(cEntry!)
    const last = unplannable.candidateSnapshot.route.operations.at(-1)!
    if (last.type !== 'keep_bonuses') throw new Error(last.type)
    last.gogmaCounterAfter = last.gogmaCounterBefore + 3
    expect(reasonsOf(matchExpectedShape(unplannable, shape.c!, scene.engine))).toEqual(['unit_plan_rejected'])

    // A blind creation (no Counter position) is a required unit no expected shape has.
    const conversionScene = await scenarioConversionFallback()
    const conversionRun = materialized(await materializeStructuralCandidate(conversionScene.candidate, conversionScene.scene.inputs()))
    const bEntry = conversionRun.materializedEntries.find(entry => entry.targetWeaponId === TARGET.b)!
    const blind: BuildListEntry = structuredClone(bEntry)
    const forge = blind.candidateSnapshot.route.operations[0]!
    if (forge.type !== 'create_normal_artian') throw new Error(forge.type)
    blind.candidateSnapshot.route.operations[0] = { ...forge, count: 1, normalCounterBefore: null, normalCounterAfter: null }
    expect(reasonsOf(matchExpectedShape(blind, conversionScene.shape.b!, conversionScene.scene.engine))).toEqual(['unpositioned_required_unit', 'normal_required'])
  }, 30_000)
})

describe('Phase D-0A method selection and fallback (design 9.2 / 9.3)', () => {
  it('tries the projected Search first for a continuous conversion Target and falls back to design 9.1 once when it returns another shape', async () => {
    const { scene, candidate } = await scenarioConversionFallback()
    const spy = capturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: spy.port })))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    expect(run.materializationOrder).toEqual([TARGET.b, TARGET.a])
    const bRecord = run.targets[0]!
    expect(bRecord.selection).toMatchObject({ continuous: true, rule: 'continuous_conversion_projected_first', order: ['candidate_search_projected', 'planner_alternative_reservation'] })
    expect(bRecord.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'planner_alternative_reservation'])
    const projected = bRecord.attempts[0] as ProjectedAttempt
    // The canonical Ideal from the projected Normal start forges only 4: this method's limit, not the Target outcome.
    expect(projected.result).toMatchObject({ kind: 'canonical_mismatch', mismatch: { reasons: ['normal_required'] } })
    expect(projected.request.projection).toMatchObject({ skillCounter: 7, gogmaCounter: 10, normal: { counterId: 'weapon.fixture.a:8', counter: 4 }, routeFilter: 'normal_artian', ownedWeaponIds: [] })
    expect(projected.request.extent).toEqual({ maxNormalAdvance: 2, maxGogmaAdvance: 2, maxSkillAdvance: 1 })
    expect(bRecord.outcome).toMatchObject({ kind: 'materialized', method: 'planner_alternative_reservation', deliveredBeforeMatch: 1, plannerRequired: { skill: [7], gogma: [11], normal: { counterId: 'weapon.fixture.a:8', position: 5 } } })
    const bForge = entryOf(bRecord.outcome).candidateSnapshot.route.operations[0]!
    expect(bForge).toMatchObject({ type: 'create_normal_artian', normalCounterBefore: 4, normalCounterAfter: 6, count: 2 })
    // a: projected first (Pareto tie-break), matched; its Search ran from its own first Gogma position.
    expect(run.targets[1]!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected'])
    expect(spy.searchInputs.map(input => [input.targetWeaponId, input.rngState.gogmaCounter.value])).toEqual([[TARGET.b, 10], [TARGET.a, 12]])
  }, 30_000)

  it('runs design 9.1 first when its scale is Pareto-smaller and switches to the projected Search only after a shape_mismatch', async () => {
    const { scene, candidate } = await scenarioAlternativeFirst()
    const plain = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const aRecord = plain.targets.find(record => record.targetWeaponId === TARGET.a)!
    expect(aRecord.selection!.rule).toBe('continuous_owned_gogma_planner_alternative_first')
    expect(aRecord.selection!.predictedSearchScale).toEqual({
      plannerAlternative: { conversionPositions: 0, gogmaLegalWidth: 3, skillLegalWidth: 0, normalForgeCount: 0 },
      projected: { conversionPositions: 0, gogmaLegalWidth: 3, skillLegalWidth: 1, normalForgeCount: 0 },
    })
    expect(aRecord.attempts.map(attempt => attempt.method)).toEqual(['planner_alternative_reservation'])
    expect(aRecord.outcome).toMatchObject({ kind: 'materialized', method: 'planner_alternative_reservation' })

    const exhaustedEmpty = replayAlternativeSearch([], { exhausted: true, stoppedByExtent: false })
    // Design 9.1 exhausted without the shape -> the projected Search once, which matches.
    const viaProjected = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: overridePort(TARGET.a, { visitPlannerAlternativeCandidates: exhaustedEmpty }) })))
    const switched = viaProjected.targets.find(record => record.targetWeaponId === TARGET.a)!
    expect(switched.attempts.map(attempt => attempt.method)).toEqual(['planner_alternative_reservation', 'candidate_search_projected'])
    expect((switched.attempts[0] as PlannerAlternativeAttempt).outcome).toMatchObject({ kind: 'shape_mismatch', delivered: 0, closestMismatch: null })
    expect(switched.outcome).toMatchObject({ kind: 'materialized', method: 'candidate_search_projected', deliveredBeforeMatch: 0 })
    expect(viaProjected.outcome).toEqual({ kind: 'all_materialized' })

    // The projected Search finds nothing either: the Target outcome stays design 9.1's shape_mismatch.
    const noCandidate = async (...args: Parameters<MaterializationSearchPort['searchCandidates']>): Promise<CandidateSearchResult> => {
      const result = await productionMaterializationSearchPort.searchCandidates(...args)
      return { ...result, targetResult: { ...result.targetResult, candidate: null } }
    }
    const failed = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: overridePort(TARGET.a, { visitPlannerAlternativeCandidates: exhaustedEmpty, searchCandidates: noCandidate }) })))
    const failedRecord = failed.targets.find(record => record.targetWeaponId === TARGET.a)!
    expect((failedRecord.attempts[1] as ProjectedAttempt).result).toEqual({ kind: 'no_candidate' })
    expect(failedRecord.outcome).toEqual({ kind: 'shape_mismatch', delivered: 0, closestMismatch: null })
    expect(failed.outcome).toEqual({ kind: 'materialization_failed', targetWeaponId: TARGET.a, outcome: failedRecord.outcome })

    // An unconfirmed design 9.1 result never switches: the projected Search is not a substitute for a stop.
    const stopped = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: overridePort(TARGET.a, { visitPlannerAlternativeCandidates: replayAlternativeSearch([], { exhausted: false, stoppedByExtent: true }) }) })))
    const stoppedRecord = stopped.targets.find(record => record.targetWeaponId === TARGET.a)!
    expect(stoppedRecord.attempts.map(attempt => attempt.method)).toEqual(['planner_alternative_reservation'])
    expect(stopped.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.a, outcome: { kind: 'unconfirmed', reason: 'stopped_by_extent', delivered: 0, closestMismatch: null } })
  }, 30_000)

  it('decides the Target outcome by design 9.1 when the projected Search does not match and design 9.1 is not confirmed', async () => {
    const { scene, candidate } = await scenarioConversionFallback()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs({
      search: overridePort(TARGET.b, { visitPlannerAlternativeCandidates: replayAlternativeSearch([], { exhausted: false, stoppedByExtent: true }) }),
    })))
    expect(run.targets).toHaveLength(1)
    expect(run.targets[0]!.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'planner_alternative_reservation'])
    expect(run.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcome: { kind: 'unconfirmed', reason: 'stopped_by_extent', delivered: 0, closestMismatch: null } })
    expect(run.notAttemptedTargetWeaponIds).toEqual([TARGET.a])
  }, 30_000)
})

describe('Phase D-0A shapes the current Search policy does not return', () => {
  it('reports a conversion whose Skill is already Ideal before a later final Skill as not confirmed, never as a mismatch it did not prove', async () => {
    // Phase A lists every c <= s*; with Ideal Skills at 7 and 8, (c 7, s* 8) is an option. The Production Search attaches
    // no Reset Skills channel to a Route base whose conversion Skill is already Ideal, so it never returns that shape.
    const scene = await materializationScenario({
      targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [7, 8] }, reset: { [ELEMENT_B]: { 10: IDEAL_BONUSES } }, window: { skill: 3, gogma: 5, normal: 2 },
    })
    const candidate = scene.candidate([scene.option(TARGET.b, newNormalSource(4), conversion(7, 8), reset(10))])
    const spy = capturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: spy.port })))
    const record = run.targets[0]!
    expect(record.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'planner_alternative_reservation'])
    expect((record.attempts[0] as ProjectedAttempt).result).toMatchObject({ kind: 'canonical_mismatch', mismatch: { reasons: ['skill_required'] } })
    expect(record.outcome).toMatchObject({ kind: 'unconfirmed', reason: 'stopped_by_extent' })
    expect(run.outcome).toMatchObject({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b })
    // Every delivered Route converts at 7 and stops there: no Reset Skills after an Ideal conversion Skill.
    expect(spy.delivered[0]!.length).toBeGreaterThan(0)
    for (const value of spy.delivered[0]!) expect(value.route.operations.some(operation => operation.type === 'reset_skills')).toBe(false)
  }, 30_000)
})

describe('Phase D-0A Search scale gate (design 9.7)', () => {
  it('never calls a Search above the gate, executes at the gate, and keeps no exclusion for a later run', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const gatedSpy = capturingPort()
    const gated = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: gatedSpy.port, settings: { deliveryCap: 1_000, searchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } } })))
    expect(gatedSpy.alternativeInputs.length + gatedSpy.searchInputs.length).toBe(0)
    const aRecord = gated.targets[0]!
    expect(aRecord.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'planner_alternative_reservation'])
    expect((aRecord.attempts[0] as ProjectedAttempt).result).toMatchObject({ kind: 'not_executed', reason: 'search_scale_gate', exceeded: ['gogmaLegalWidth'] })
    expect(aRecord.outcome).toEqual({ kind: 'not_executed', reason: 'search_scale_gate', predictedSearchScale: { conversionPositions: 0, gogmaLegalWidth: 3, skillLegalWidth: 1, normalForgeCount: 0 }, exceeded: ['gogmaLegalWidth'] })
    expect(gated.outcome).toMatchObject({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.a, outcome: { kind: 'not_executed' } })
    expect(gated.notAttemptedTargetWeaponIds).toEqual([TARGET.c])

    // A gate equal to a's projected scale lets it run; c's design 9.1 request (Gogma width 4) stays above it.
    const boundarySpy = capturingPort()
    const boundary = materialized(await materializeStructuralCandidate(candidate, scene.inputs({
      search: boundarySpy.port,
      settings: { deliveryCap: 1_000, searchScaleGate: { maxConversionPositions: 0, maxGogmaLegalWidth: 1, maxSkillLegalWidth: 1, maxNormalForgeCount: 0 } },
    })))
    expect(boundary.targets[0]!.outcome).toMatchObject({ kind: 'materialized', method: 'candidate_search_projected' })
    expect(boundary.targets[1]!.outcome).toEqual({ kind: 'not_executed', reason: 'search_scale_gate', predictedSearchScale: { conversionPositions: 0, gogmaLegalWidth: 4, skillLegalWidth: 1, normalForgeCount: 0 }, exceeded: ['gogmaLegalWidth'] })
    expect(boundarySpy.alternativeInputs).toHaveLength(0)
    expect(boundary.materializedTargetCount).toBe(1)

    // An unexecuted or unconfirmed Target is never excluded: the same candidate materializes under an open gate.
    expect(materialized(await materializeStructuralCandidate(candidate, scene.inputs())).outcome).toEqual({ kind: 'all_materialized' })
  }, 30_000)
})

describe('Phase D-0A materialization order (design 8.2)', () => {
  it('materializes the Skill coverer before the conversion that needs its held positions, and stops at the first unresolved Target', async () => {
    const { scene, candidate, shape } = await scenarioSkillDependency()
    expect(candidate.materializationOrder).toEqual([TARGET.a, TARGET.b])
    expect(candidate.materializationDependencies).toEqual([{ targetWeaponId: TARGET.b, conversionPosition: 9, prerequisiteTargetWeaponIds: [TARGET.a] }])
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    expect(run.targets.map(record => record.targetWeaponId)).toEqual([TARGET.a, TARGET.b])
    const aEntry = run.materializedEntries[0]!
    expect(skillPositions(aEntry)).toEqual([7, 8])

    // Design 9.1 for b: after a, the held Skill 7 / 8 (8 blocked) let b convert at 9; without a, it cannot.
    const after = await buildPlannerAlternativeRequest(shape.b!, [aEntry], scene.inputs())
    expect(after.reservation.skill).toEqual({ held: [7, 8], blocked: [8] })
    expect(after.scaleDetail.conversionSkillPositions).toEqual([7, 9])
    const afterAttempt = await executeMaterializationRequest(after, [aEntry], scene.inputs()) as PlannerAlternativeAttempt
    expect(afterAttempt.outcome).toMatchObject({ kind: 'materialized', plannerRequired: { skill: [9], gogma: [11], normal: { counterId: 'weapon.fixture.a:8', position: 4 } } })
    const alone = await buildPlannerAlternativeRequest(shape.b!, [], scene.inputs())
    expect(alone.scaleDetail.conversionSkillPositions).toEqual([7])
    const aloneAttempt = await executeMaterializationRequest(alone, [], scene.inputs()) as PlannerAlternativeAttempt
    expect(aloneAttempt.outcome.kind).not.toBe('materialized')
    expect(aloneAttempt.observed!.deliveredConversionSkillPositions).toEqual([7])

    // a unresolved: b is never attempted, and nothing is materialized.
    const stuck = materialized(await materializeStructuralCandidate(candidate, scene.inputs({
      search: overridePort(TARGET.a, {
        visitPlannerAlternativeCandidates: replayAlternativeSearch([], { exhausted: false, stoppedByExtent: true }),
        searchCandidates: async (...args) => {
          const result = await productionMaterializationSearchPort.searchCandidates(...args)
          return { ...result, targetResult: { ...result.targetResult, candidate: null } }
        },
      }),
    })))
    expect(stuck.targets.map(record => record.targetWeaponId)).toEqual([TARGET.a])
    expect(stuck.notAttemptedTargetWeaponIds).toEqual([TARGET.b])
    expect(stuck.materializedEntries).toEqual([])
    expect(stuck.materializedTargetCount).toBe(0)
  }, 30_000)
})

describe('Phase D-0A determinism, identity, fail closed and traces (design 9.4)', () => {
  it('returns the same requests, Entries and outcomes for the same input', async () => {
    for (const build of [scenarioHeldCrossing, scenarioConversionFallback, scenarioSkillDependency, scenarioAlternativeFirst]) {
      const { scene, candidate } = await build()
      const first = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
      const second = materialized(await materializeStructuralCandidate(structuredClone(candidate), scene.inputs()))
      expect(second).toEqual(first)
      expect(first.outcome).toEqual({ kind: 'all_materialized' })
    }
    // A fresh scenario (a new context, table and Engine of the same definition) gives the same Entry IDs.
    const one = await scenarioConversionFallback()
    const two = await scenarioConversionFallback()
    const ids = async (value: typeof one) => materialized(await materializeStructuralCandidate(value.candidate, value.scene.inputs())).materializedEntries.map(entry => [entry.id, entry.candidateId])
    expect(await ids(two)).toEqual(await ids(one))
  }, 60_000)

  it('derives the search identity from the origin, context, extent, reservation and algorithm token only', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const aEntry = run.materializedEntries[0]!
    const withPrior = await buildPlannerAlternativeRequest(shape.c!, [aEntry], scene.inputs())
    const again = await buildPlannerAlternativeRequest(structuredClone(shape.c!), [structuredClone(aEntry)], scene.inputs())
    const alone = await buildPlannerAlternativeRequest(shape.c!, [], scene.inputs())
    expect(withPrior.searchIdentity.startsWith('research.global-assignment.alternative.fnv1a32-')).toBe(true)
    expect(again.searchIdentity).toBe(withPrior.searchIdentity)
    expect(alone.searchIdentity).not.toBe(withPrior.searchIdentity)
    const projected = await buildProjectedRequest(shape.a!, scene.inputs())
    expect(projected.searchRunId.startsWith('research.global-assignment.projected.fnv1a32-')).toBe(true)
    // The projected Entry is rebuilt at the origin by the existing adapter (its own Research identity).
    expect(aEntry.candidateSnapshot.searchRunId.startsWith('research.global.')).toBe(true)
  }, 30_000)

  it('fails closed on a tampered request before any Search', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const aEntry = run.materializedEntries[0]!
    const request = await buildPlannerAlternativeRequest(shape.c!, [aEntry], scene.inputs())
    const spy = capturingPort()
    const tampered = [
      { ...request, reservation: { ...request.reservation, gogma: { held: [12, 13], blocked: [12, 13] } } },
      { ...request, reservation: { ...request.reservation, exclusiveOwnedWeaponIds: [] } },
      { ...request, extent: { ...request.extent, maxGogmaAdvance: request.extent.maxGogmaAdvance + 1 } },
      { ...request, predictedSearchScale: { ...request.predictedSearchScale, gogmaLegalWidth: 0 } },
      { ...request, reservationSourceEntryIds: [] },
      { ...request, excludedRouteKeys: ['candidate-stable-key'] as never },
      { ...request, searchIdentity: 'research.global-assignment.alternative.other' },
    ]
    for (const value of tampered) {
      expect((await rejection(executeMaterializationRequest(value, [aEntry], scene.inputs({ search: spy.port })))).code).toBe('request_mismatch')
    }
    // The same request against other materialized Entries is a different derivation.
    expect((await rejection(executeMaterializationRequest(request, [], scene.inputs({ search: spy.port })))).code).toBe('request_mismatch')
    const projected = await buildProjectedRequest(shape.a!, scene.inputs())
    const wrongStart = { ...projected, projection: { ...projected.projection, gogmaCounter: 11 } }
    expect((await rejection(executeMaterializationRequest(wrongStart, [], scene.inputs({ search: spy.port })))).code).toBe('request_mismatch')
    expect(spy.alternativeInputs.length + spy.searchInputs.length).toBe(0)
    // A non-continuous shape has no projected request at all.
    expect((await rejection(buildProjectedRequest(shape.c!, scene.inputs()))).code).toBe('invalid_shape')
  }, 30_000)

  it('refuses invalid settings, a foreign table and an edited structural candidate before any Search', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const spy = capturingPort()
    const inputs = scene.inputs({ search: spy.port })
    for (const settings of [
      { deliveryCap: 0, searchScaleGate: OPEN_GATE },
      { deliveryCap: 1.5, searchScaleGate: OPEN_GATE },
      { deliveryCap: 10, searchScaleGate: { ...OPEN_GATE, maxSkillLegalWidth: -1 } },
      { deliveryCap: 10, searchScaleGate: { ...OPEN_GATE, maxNormalForgeCount: Number.POSITIVE_INFINITY } },
    ]) {
      expect(await materializeStructuralCandidate(candidate, { ...inputs, settings })).toMatchObject({ kind: 'invalid_input', reason: 'invalid_settings' })
      expect((await rejection(materializeTarget(candidate.expectedShapes[0]!, [], { ...inputs, settings }))).code).toBe('invalid_settings')
    }
    expect(await materializeStructuralCandidate(candidate, { ...inputs, table: { ...scene.table, originGogma: 11 } })).toMatchObject({ kind: 'invalid_input', reason: 'context_mismatch' })
    const edits: ((value: StructuralCandidate) => void)[] = [
      value => { value.materializationOrder.reverse() },
      value => { value.expectedShapes[1]!.match.sourceOwnedWeaponId = 'owned.g1' as never },
      value => { value.expectedShapes[1]!.match.required.gogma = [11, 13] },
      value => { value.expectedShapes[1]!.predicted.chainSegments = [] },
      value => { value.ordinal = 3 },
      value => {
        const option = value.assignment.chosen.get(TARGET.c)!
        value.assignment.chosen.set(TARGET.c, { ...option, source: { ...option.source, ownedWeaponId: 'owned.unknown' } as never })
      },
    ]
    for (const edit of edits) {
      const edited = structuredClone(candidate)
      edit(edited)
      expect(await materializeStructuralCandidate(edited, inputs)).toMatchObject({ kind: 'invalid_input', reason: 'structural_candidate_mismatch' })
    }
    expect(spy.alternativeInputs.length + spy.searchInputs.length).toBe(0)
  }, 30_000)

  it('fails closed on a refused reservation derivation, a refused Search input and a deterministic-ID collision', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const [aEntry, cEntry] = run.materializedEntries
    // Two "materialized" Entries sharing one ID with different content.
    const conflicting = { ...structuredClone(aEntry!), createdAt: '2026-01-01T00:00:00.000Z' }
    expect((await rejection(buildPlannerAlternativeRequest(shape.c!, [aEntry!, conflicting], scene.inputs()))).code).toBe('reservation_derivation_failed')
    // A Search refusing its input is an error of the run, never an outcome.
    const refusing = await rejection(materializeStructuralCandidate(candidate, scene.inputs({
      search: overridePort(TARGET.c, { visitPlannerAlternativeCandidates: async () => { throw new PlannerAlternativeSearchError('invalid_reservation', 'refused') } }),
    })))
    expect(refusing).toMatchObject({ code: 'search_refused', targetWeaponId: TARGET.c })
    // An existing Entry holding a generated ID with other content fails the run closed (both methods).
    for (const [entry, targetWeaponId] of [[cEntry!, TARGET.c], [aEntry!, TARGET.a]] as const) {
      const colliding: BuildListEntry = { ...structuredClone(entry), targetDefinitionHash: 'fnv1a32:00000000' }
      const context = { ...scene.context, plannerInput: { ...scene.input, buildListEntries: [...scene.input.buildListEntries, colliding] } }
      const error = await rejection(materializeStructuralCandidate(candidate, { ...scene.inputs(), context }))
      expect(error).toMatchObject({ code: 'entry_materialization_refused', targetWeaponId })
      expect(error.message).toMatch(/collision|already exists/)
    }
  }, 30_000)

  it('keeps the Search Candidate\'s observational traces and predicts nothing while materializing', async () => {
    const { scene, candidate, shape } = await scenarioConversionFallback()
    const spy = capturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs({ search: spy.port })))
    const bRecord = run.targets[0]!
    const bAttempt = bRecord.attempts[1] as PlannerAlternativeAttempt
    if (bAttempt.outcome.kind !== 'materialized') throw new Error(bAttempt.outcome.kind)
    const delivered = spy.delivered[0]!
    const matched: PlannerAlternativeCandidate = delivered[bAttempt.outcome.deliveredBeforeMatch]!
    const bEntry = bAttempt.outcome.entry
    expect(bEntry.candidateSnapshot.bonusAmendmentTrace).toEqual(matched.bonusAmendmentTrace)
    expect(bEntry.candidateSnapshot.skillAmendmentTrace).toEqual(matched.skillAmendmentTrace)
    expect(bEntry.candidateSnapshot.conversionSkillTrace).toEqual(matched.conversionSkillTrace)
    expect(bEntry.candidateSnapshot.route).toEqual(matched.route)
    // The intermediate state groups are the formal extraction of the materialized Candidate (no selection, no pin).
    const bTarget = scene.input.targetWeapons.find(target => target.id === TARGET.b)!
    expect(bEntry.candidateSnapshot.intermediateStateGroups).toEqual(extractIntermediateStateGroups(bEntry.candidateSnapshot, { target: bTarget, master: scene.input.master, ownedWeapons: scene.input.ownedWeapons }))
    expect(bEntry.intermediateStateSelection).toMatchObject({ skillOpportunityId: null, bonusOpportunityId: null })
    const aEntry = run.materializedEntries.find(entry => entry.targetWeaponId === TARGET.a)!
    const aSearched = spy.searchResults.find(result => result.targetResult.targetWeaponId === TARGET.a)!.targetResult.candidate!
    expect(aEntry.candidateSnapshot.bonusAmendmentTrace).toEqual(aSearched.bonusAmendmentTrace)
    expect(aEntry.candidateSnapshot.skillAmendmentTrace).toEqual(aSearched.skillAmendmentTrace)
    expect(aEntry.candidateSnapshot.route).toEqual(aSearched.route)

    // Replaying the delivered Candidates without a Search: the materialization itself makes no prediction.
    const request = await buildPlannerAlternativeRequest(shape.b!, [], scene.inputs())
    const before = { ...scene.calls }
    const replayed = await executeMaterializationRequest(request, [], scene.inputs({
      search: { ...productionMaterializationSearchPort, visitPlannerAlternativeCandidates: replayAlternativeSearch(delivered, { exhausted: false, stoppedByExtent: true }) },
    })) as PlannerAlternativeAttempt
    expect(replayed.outcome).toEqual(bAttempt.outcome)
    expect({ skill: scene.calls.skill, reset: scene.calls.reset, keep: scene.calls.keep, normal: scene.calls.normal })
      .toEqual({ skill: before.skill, reset: before.reset, keep: before.keep, normal: before.normal })
  }, 30_000)
})
