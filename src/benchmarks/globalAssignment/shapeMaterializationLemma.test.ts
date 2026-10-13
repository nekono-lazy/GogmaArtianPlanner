import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../../domain/planner/alternative/plannerAlternativeReservation'
import { emptyPlannerAlternativeReservation } from '../../domain/search/alternative'
import { buildShapeConstrainedRequest, executeShapeConstrainedRequest, materializeStructuralCandidate } from './materialize'
import { materializationScenario, scenarioConversionFallback, scenarioHeldCrossing, scenarioSkillDependency, TARGET } from './materializationTestFixture'
import { searchPolicyShapeOf, shapeOwnPositions } from './materializationShape'
import { GlobalAssignmentMaterializationError } from './materializationTypes'
import { checkMinimalRoutePremises } from './shapeMaterializationRequest'
import { randomShapeScenarioSpec, shapeInputs } from './shapeMaterializationTestFixture'
import { collectStructuralCandidates } from './structuralSearch'
import type { StructuralCandidate } from './coverageTypes'
import type { MaterializationScenario } from './materializationTestFixture'

/*
 * Issue #154 Global Assignment Phase D-0A-2b: the minimal Route lemma of `docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.5,
 * fixed by a property test. Seeded random synthetic scenarios (`randomShapeScenarioSpec()`) go through the real Phase A
 * ReachTable and the Phase C-2 structural candidate search; every structural candidate's own assignment, expected shapes,
 * materialization order, dependencies and coverage are used as Phase C built them (nothing is edited to match). In that
 * order, every Target is materialized by the shape-constrained method alone: the first delivered Candidate must match its
 * shape and pass the independent Route checks, with the formal reservation of the Entries before it, deterministically.
 * Broken premises (order, reservation, source, production target, positions, support, the Engine) end as their own
 * fail-closed classification, never as "no Route". The lemma is checked here, never assumed by the implementation.
 */

const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1)
const STRUCTURAL = { nodeBudget: 2_000, mrvLookahead: 4, coverageDrivenOrdering: true }

async function rejection(promise: Promise<unknown>): Promise<GlobalAssignmentMaterializationError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) return error
    throw error
  }
  throw new Error('Expected a GlobalAssignmentMaterializationError.')
}

/** Materializes the candidate in its own order by the shape-constrained method alone, checking the lemma's claims per Target. */
async function materializeByShapeAlone(scene: MaterializationScenario, candidate: StructuralCandidate, seen: Record<string, number>): Promise<BuildListEntry[]> {
  const entries: BuildListEntry[] = []
  const count = (key: string) => { seen[key] = (seen[key] ?? 0) + 1 }
  for (const targetWeaponId of candidate.materializationOrder) {
    const shape = candidate.expectedShapes.find(value => value.targetWeaponId === targetWeaponId)!
    const request = await buildShapeConstrainedRequest(shape, entries, shapeInputs(scene))
    // P3: the reservation is the formal one of the Entries before it.
    expect(request.reservation).toEqual(entries.length === 0 ? emptyPlannerAlternativeReservation : derivePlannerAlternativeReservation(entries, scene.engine))
    expect(request.reservationSourceEntryIds).toEqual(entries.map(entry => entry.id))
    // The position premises of the proof hold under the Phase C order.
    expect(request.premiseViolations).toEqual([])
    const attempt = await executeShapeConstrainedRequest(request, entries, shapeInputs(scene))
    // The claim: the shape's Route is delivered first, matches its shape and passes every independent check.
    expect(attempt.outcome.kind).toBe('materialized')
    if (attempt.outcome.kind !== 'materialized') throw new Error('unreachable')
    expect(attempt.observed!.deliveredCandidates).toBe(1)
    expect(attempt.observed!.stop.by).toBe('consumer')
    expect(attempt.routeChecks).toMatchObject({ passed: true, issues: [] })
    expect(attempt.outcome.plannerRequired).toEqual(shape.match.required)
    expect(attempt.outcome.entry.candidateSnapshot.route.sourceOwnedWeaponId).toBe(shape.match.sourceOwnedWeaponId)
    count(`base:${request.routeShape.base.kind}`)
    count(`skill:${request.routeShape.skill.kind}`)
    count(`bonus:${request.routeShape.bonus.kind}`)
    if (!shapeOwnPositions(shape).continuous) count('non_continuous')
    if (request.reservation.gogma.held.length + request.reservation.skill.held.length + request.reservation.normal.length > 0) count('with_held')
    if (searchPolicyShapeOf(shape.option, scene.table) !== null) count('g1_continuation')
    entries.push(attempt.outcome.entry)
  }
  return entries
}

describe('Phase D-0A-2b minimal Route lemma (design 5.5): property test over seeded random Phase A / C candidates', () => {
  it('materializes every Target of every structural candidate, in its order, by the first delivery, deterministically', async () => {
    const seen: Record<string, number> = {}
    let candidates = 0
    let targets = 0
    for (const seed of SEEDS) {
      const scene = await materializationScenario(randomShapeScenarioSpec(seed))
      const collected = collectStructuralCandidates({ table: scene.table, context: scene.context, engine: scene.engine }, STRUCTURAL, 3)
      // A seed without a structural candidate decides nothing here (no option, or no coverage-feasible assignment); a node budget
      // stop keeps the candidates it found before it.
      if (collected.status === 'no_structural_candidate') continue
      if (collected.status !== 'candidates_found' && collected.status !== 'search_incomplete') throw new Error(`seed ${seed}: ${collected.status}`)
      for (const candidate of collected.candidates) {
        candidates += 1
        targets += candidate.materializationOrder.length
        if (candidate.materializationOrder.length >= 3) seen.three_targets = (seen.three_targets ?? 0) + 1
        const first = await materializeByShapeAlone(scene, candidate, seen)
        const again = await materializeByShapeAlone(scene, structuredClone(candidate), {})
        expect(JSON.stringify(again), `seed ${seed}`).toBe(JSON.stringify(first))
        // The whole rule d0a2-v2 (projected first for continuous shapes) materializes the same candidate too.
        const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
        expect(run.kind === 'materialization' ? run.outcome : run, `seed ${seed}`).toEqual({ kind: 'all_materialized' })
      }
    }
    // The fixture is not degenerate: every base kind and lane, held crossings and G1 continuations are exercised.
    expect(candidates).toBeGreaterThanOrEqual(400)
    expect(targets).toBeGreaterThanOrEqual(800)
    for (const key of ['base:owned_gogma', 'base:owned_normal', 'base:new_normal', 'skill:zero', 'skill:reset_skills', 'bonus:zero', 'bonus:reset', 'bonus:keep', 'bonus:reset_then_keep']) {
      expect(seen[key] ?? 0, key).toBeGreaterThanOrEqual(20)
    }
    expect(seen.non_continuous ?? 0).toBeGreaterThanOrEqual(100)
    expect(seen.with_held ?? 0).toBeGreaterThanOrEqual(300)
    expect(seen.g1_continuation ?? 0).toBeGreaterThanOrEqual(10)
    expect(seen.three_targets ?? 0).toBeGreaterThanOrEqual(50)
  }, 300_000)
})

describe('Phase D-0A-2b minimal Route lemma: broken premises fail closed, never "no Route"', () => {
  it('a conversion materialized before its Skill prerequisite (order swapped, or the prerequisite\'s Entry missing)', async () => {
    const { scene, shape } = await scenarioSkillDependency()
    const request = await buildShapeConstrainedRequest(shape.b!, [], shapeInputs(scene))
    expect(request.premiseViolations).toEqual([{ kind: 'conversion_position_not_legal', position: 9, legalPositions: [7] }])
    const error = await rejection(executeShapeConstrainedRequest(request, [], shapeInputs(scene)))
    expect(error).toMatchObject({ code: 'shape_base_unavailable', targetWeaponId: TARGET.b, detail: { origin: 'premise_check' } })
  }, 30_000)

  it('an exclusive source, a blocked production target and blocked required positions (a Target materialized twice)', async () => {
    const { scene, candidate, shape } = await scenarioConversionFallback()
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const bEntry = run.materializedEntries.find(entry => entry.targetWeaponId === TARGET.b)!
    const twice = await buildShapeConstrainedRequest(shape.b!, [bEntry], shapeInputs(scene))
    expect(twice.premiseViolations).toEqual(expect.arrayContaining([
      { kind: 'conversion_position_not_legal', position: 7, legalPositions: expect.any(Array) },
      { kind: 'production_target_blocked', counterId: 'weapon.fixture.a:8', position: 5 },
      { kind: 'required_position_blocked', stream: 'gogma', position: 11 },
    ]))
    expect((await rejection(executeShapeConstrainedRequest(twice, [bEntry], shapeInputs(scene)))).code).toBe('shape_base_unavailable')
    const held = await scenarioHeldCrossing()
    const heldRun = await materializeStructuralCandidate(held.candidate, shapeInputs(held.scene))
    if (heldRun.kind !== 'materialization') throw new Error(heldRun.kind)
    const again = await buildShapeConstrainedRequest(held.shape.c!, heldRun.materializedEntries, shapeInputs(held.scene))
    expect(again.premiseViolations).toEqual(expect.arrayContaining([{ kind: 'source_exclusive', ownedWeaponId: 'owned.g2' }]))
  }, 30_000)

  it('an extent that does not reach a required position or the production target (the premise check itself)', async () => {
    const { scene, shape } = await scenarioConversionFallback()
    const request = await buildShapeConstrainedRequest(shape.b!, [], shapeInputs(scene))
    expect(checkMinimalRoutePremises({ ...request, extent: { ...request.extent, maxGogmaAdvance: 1 }, scale: request.predictedScale, plannerInput: scene.input }))
      .toEqual([{ kind: 'required_position_outside_extent', stream: 'gogma', position: 11, window: { from: 10, to: 10 } }])
    expect(checkMinimalRoutePremises({ ...request, extent: { ...request.extent, maxNormalAdvance: 1 }, scale: request.predictedScale, plannerInput: scene.input }))
      .toEqual([{ kind: 'production_target_outside_extent', counterId: 'weapon.fixture.a:8', position: 5 }])
  }, 30_000)

  it('an Engine that no longer reaches the Ideal Phase A replayed (P1 / P5 broken): the base is admitted, nothing is delivered, unreachable', async () => {
    const held = await scenarioHeldCrossing()
    const run = await materializeStructuralCandidate(held.candidate, shapeInputs(held.scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const aEntry = run.materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(held.shape.c!, [aEntry], shapeInputs(held.scene))
    // The same request against an Engine whose Keep at 14 no longer rerolls to the Ideal ranks.
    const engine = { ...held.scene.engine, version: held.scene.engine.version, capabilities: held.scene.engine.capabilities,
      predictGogmaBonus: (input: Parameters<typeof held.scene.engine.predictGogmaBonus>[0]) => {
        const result = held.scene.engine.predictGogmaBonus(input)
        return input.operation.type === 'keep_bonuses' && input.gogmaCounter === 14 ? result.map(bonus => ({ ...bonus, bonusRankId: 'bonus_rank.fixture.low' })) as typeof result : result
      } }
    const error = await rejection(executeShapeConstrainedRequest(request, [aEntry], { ...shapeInputs(held.scene), engine }))
    expect(error.code).toBe('shape_constrained_unreachable')
    expect(error.message).toMatch(/premise of the minimal Route lemma/)
    expect(error.detail).toMatchObject({ observed: { execution: { base: { admitted: true }, requiredUnsupportedPredictions: [] }, deliveredCandidates: 0 } })
  }, 30_000)
})
