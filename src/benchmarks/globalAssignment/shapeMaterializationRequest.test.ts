import { describe, expect, it } from 'vitest'
import { conversion, keep, NONE, reset, resetSkills, resetThenKeep } from './coverageTestFixture'
import type { ExpectedRouteShape } from './coverageTypes'
import { buildProjectedRequest, buildShapeConstrainedRequest, materializeStructuralCandidate } from './materialize'
import { searchPolicyShapeOf, shapeOwnPositions } from './materializationShape'
import { ELEMENT_A, ELEMENT_B, materializationScenario, newNormalSource, ownedSource, REORDERED_GOGMA, scenarioHeldCrossing, scenarioSkillDependency, SERIES_IDEAL, TARGET } from './materializationTestFixture'
import { GlobalAssignmentMaterializationError } from './materializationTypes'
import {
  checkMinimalRoutePremises, CONTINUATION_SHAPE_DETECTORS, continuationShapeOf, normalizeRouteShapeConstraint, selectShapeMaterializationMethods, shapeConstrainedSearchIdentity,
  toRouteShapeConstraint,
} from './shapeMaterializationRequest'
import {
  exceededShapeSearchBudget, exceededShapeSearchScaleGate, isValidShapeSearchBudget, isValidShapeSearchScaleGate, predictShapeSearchScale,
} from './shapeMaterializationScale'
import { OPEN_SHAPE_BUDGET, OPEN_SHAPE_GATE, scenarioG1Continuation, shapeInputs } from './shapeMaterializationTestFixture'
import type { ShapeSearchScale } from './shapeMaterializationTypes'
import { IDEAL_BONUSES, ownedGogma, ownedNormal } from './testFixture'

/*
 * Issue #154 Global Assignment Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.2 / 5.4 / 9.1 / 10.3 / 11): the
 * request side - the shape conversion from the option alone, the search identity, the premise check, the scale predicted from
 * positions alone, the gate / budget contracts, the continuation boundary and the rule d0a2-v2. Nothing here searches.
 */

const WINDOW = { skill: 3, gogma: 5, normal: 2 }

async function invalid(run: () => unknown): Promise<GlobalAssignmentMaterializationError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) return error
    throw error
  }
  throw new Error('Expected a GlobalAssignmentMaterializationError.')
}

describe('Phase D-0A-2b shape conversion (design 5.2 / 5.4 step 3)', () => {
  it('reads one seam shape per option, from the option alone', async () => {
    const scene = await materializationScenario({
      targets: ['a', 'b'],
      owned: [ownedGogma('owned.g1', { restorationBonuses: structuredClone(REORDERED_GOGMA) }), ownedNormal('owned.n1', { elementId: ELEMENT_B })],
      skillIdeal: { [ELEMENT_A]: [8], [ELEMENT_B]: [7, 9] },
      reset: { [ELEMENT_A]: { 11: REORDERED_GOGMA, 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: IDEAL_BONUSES } },
      keepIdeal: [14],
      window: WINDOW,
    })
    const shapeOf = (option: ReturnType<typeof scene.option>) => ({ targetWeaponId: option.targetWeaponId, option } as ExpectedRouteShape)
    const g1 = ownedSource('owned.g1')
    expect(toRouteShapeConstraint(shapeOf(scene.option(TARGET.a, g1, resetSkills(8), reset(12))))).toEqual({ base: { kind: 'owned_gogma', ownedWeaponId: 'owned.g1' }, skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: { kind: 'reset', finalPosition: 12 } })
    expect(toRouteShapeConstraint(shapeOf(scene.option(TARGET.a, g1, resetSkills(8), keep(14))))).toEqual({ base: { kind: 'owned_gogma', ownedWeaponId: 'owned.g1' }, skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: { kind: 'keep', finalPosition: 14 } })
    expect(toRouteShapeConstraint(shapeOf(scene.option(TARGET.a, g1, resetSkills(8), resetThenKeep(11, 14))))).toEqual({ base: { kind: 'owned_gogma', ownedWeaponId: 'owned.g1' }, skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 14 } })
    expect(toRouteShapeConstraint(shapeOf(scene.option(TARGET.b, ownedSource('owned.n1'), conversion(7, 7), reset(11))))).toEqual({ base: { kind: 'owned_normal', ownedWeaponId: 'owned.n1', conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 11 } })
    expect(toRouteShapeConstraint(shapeOf(scene.option(TARGET.b, newNormalSource(5), conversion(7, 9), reset(11))))).toEqual({ base: { kind: 'new_normal', counterId: 'weapon.fixture.a:8', productionTargetPosition: 5, conversionSkillPosition: 7 }, skill: { kind: 'reset_skills', finalPosition: 9 }, bonus: { kind: 'reset', finalPosition: 11 } })
    // A combination Phase A never builds is an internal inconsistency, never a guessed shape.
    const base = scene.option(TARGET.b, newNormalSource(5), conversion(7, 7), reset(11))
    for (const option of [
      { ...base, bonusRequired: NONE },
      { ...base, skillRequired: NONE },
      { ...base, normalRequired: { counterId: 'weapon.fixture.a:8', position: 4 } },
      { ...scene.option(TARGET.a, g1, NONE, reset(12)), skillRequired: conversion(7, 7) },
      { ...base, skillRequired: conversion(9, 7) },
    ]) {
      expect((await invalid(() => toRouteShapeConstraint(shapeOf(option)))).code).toBe('invalid_shape')
    }
    // The identity reads the semantic fields only.
    const shape = toRouteShapeConstraint(shapeOf(base))
    expect(normalizeRouteShapeConstraint({ ...shape, extra: 1, base: { ...shape.base, extra: 2 } } as never)).toEqual(shape)
  }, 30_000)
})

describe('Phase D-0A-2b search identity (design 9.1)', () => {
  it('is deterministic, ignores array order and changes with the Target, the extent, the reservation and the shape', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const request = await buildShapeConstrainedRequest(shape.c!, [run.materializedEntries[0]!], shapeInputs(scene))
    const base = { plannerInput: scene.input, targetWeaponId: request.targetWeaponId, extent: request.extent, reservation: request.reservation, routeShape: request.routeShape }
    expect(shapeConstrainedSearchIdentity(base)).toBe(request.searchIdentity)
    expect(shapeConstrainedSearchIdentity(structuredClone(base))).toBe(request.searchIdentity)
    const reordered = { ...base.reservation, gogma: { held: [...base.reservation.gogma.held].reverse(), blocked: [...base.reservation.gogma.blocked] }, exclusiveOwnedWeaponIds: [...base.reservation.exclusiveOwnedWeaponIds, ...base.reservation.exclusiveOwnedWeaponIds] }
    expect(shapeConstrainedSearchIdentity({ ...base, reservation: reordered })).toBe(request.searchIdentity)
    const changed = [
      { ...base, targetWeaponId: TARGET.a },
      { ...base, extent: { ...base.extent, maxSkillAdvance: base.extent.maxSkillAdvance + 1 } },
      { ...base, reservation: { ...base.reservation, gogma: { held: [12, 13], blocked: [12] } } },
      { ...base, routeShape: { ...base.routeShape, bonus: { kind: 'keep' as const, finalPosition: 14 } } },
      { ...base, plannerInput: { ...scene.input, calculationContext: { ...scene.input.calculationContext, masterDataVersion: scene.input.calculationContext.masterDataVersion + 1 } } },
    ]
    for (const value of changed) expect(shapeConstrainedSearchIdentity(value)).not.toBe(request.searchIdentity)
    // The D-0A token and the Planner Alternative identity are not part of it (a different algorithm token).
    expect(request.searchIdentity.startsWith('research.global-assignment.shape.fnv1a32-')).toBe(true)
  }, 30_000)
})

describe('Phase D-0A-2b scale prediction, gate and budget (design 10.3 / 10.4)', () => {
  it('predicts the pre-base work and the stream bounds of an owned Gogma shape across a held position', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const request = await buildShapeConstrainedRequest(shape.c!, [run.materializedEntries[0]!], shapeInputs(scene))
    // a's Entry holds and blocks Gogma 12; c's window is 10 .. 14.
    expect(request.predictedScale).toEqual({
      preBase: { primitive: 'owned_gogma', conversionWalkPositions: 0, requiredPredictions: { normalArtian: 0, skill: 0 }, baseWorkItems: 0, supportQueries: ['gogma_reset', 'gogma_keep'] },
      normalForgeCount: 0, conversionLegal: true, conversionLegalPositions: [],
      skill: { window: null, minOwnOperations: 0, maxOwnOperations: 0, maxHeldRun: 0 },
      gogma: { window: { from: 10, to: 14 }, minOwnOperations: 4, maxOwnOperations: 4, maxHeldRun: 1, policy: 'reset_then_keep', frontierUpperBound: 4, generatedStateUpperBound: 48 },
      depthUpperBound: 4,
    } satisfies ShapeSearchScale)
  }, 30_000)

  it('walks the formal conversion positions across held Skill positions, and counts the canonical forges', async () => {
    const { scene, candidate, shape } = await scenarioSkillDependency()
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const aEntry = run.materializedEntries[0]!
    const request = await buildShapeConstrainedRequest(shape.b!, [aEntry], shapeInputs(scene))
    // Skill 7 / 8 held (8 blocked): the walk inspects 7, 8 and 9 and finds 7 and 9 legal; b converts at 9.
    expect(request.predictedScale.preBase).toEqual({ primitive: 'new_normal', conversionWalkPositions: 3, requiredPredictions: { normalArtian: 1, skill: 1 }, baseWorkItems: 1, supportQueries: ['normal_artian', 'skill', 'gogma_reset'] })
    expect(request.predictedScale).toMatchObject({ conversionLegal: true, conversionLegalPositions: [7, 9], normalForgeCount: 1, skill: { window: null } })
    // The predicted scale never runs a Search or a prediction.
    const before = { ...scene.calls }
    await predictShapeSearchScale({ routeShape: request.routeShape, reservation: request.reservation, origins: request.origins, extent: request.extent })
    expect(scene.calls).toEqual(before)
  }, 30_000)

  it('gates on any component above its limit, accepts a limit equal to the value, and validates every value as a non-negative safe integer', () => {
    const scale = { depthUpperBound: 5, normalForgeCount: 2, preBase: { conversionWalkPositions: 3 }, gogma: { generatedStateUpperBound: 40 } } as ShapeSearchScale
    expect(exceededShapeSearchScaleGate(scale, { maxDepthUpperBound: 5, maxGogmaGeneratedStateUpperBound: 40, maxNormalForgeCount: 2, maxConversionWalkPositions: 3 })).toEqual([])
    expect(exceededShapeSearchScaleGate(scale, { maxDepthUpperBound: 4, maxGogmaGeneratedStateUpperBound: 39, maxNormalForgeCount: 1, maxConversionWalkPositions: 2 }))
      .toEqual(['depthUpperBound', 'gogmaGeneratedStateUpperBound', 'normalForgeCount', 'conversionWalkPositions'])
    expect(isValidShapeSearchScaleGate(OPEN_SHAPE_GATE)).toBe(true)
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3']) {
      expect(isValidShapeSearchScaleGate({ ...OPEN_SHAPE_GATE, maxConversionWalkPositions: value as number })).toBe(false)
      expect(isValidShapeSearchBudget({ ...OPEN_SHAPE_BUDGET, maxSkillStates: value as number })).toBe(false)
      expect(isValidShapeSearchBudget({ ...OPEN_SHAPE_BUDGET, maxPredictions: { ...OPEN_SHAPE_BUDGET.maxPredictions, normalArtian: value as number } })).toBe(false)
    }
    expect(isValidShapeSearchBudget({ ...OPEN_SHAPE_BUDGET, maxPredictions: undefined as never })).toBe(false)
    const usage = { gogmaGeneratedStates: 10, skillStates: 3, settledWork: 7, predictions: { normalArtian: 1, skill: 2, gogmaReset: 3, gogmaKeep: 4, supportQueries: 99 } }
    const exact = { maxGogmaGeneratedStates: 10, maxSkillStates: 3, maxSettledWork: 7, maxPredictions: { normalArtian: 1, skill: 2, gogmaReset: 3, gogmaKeep: 4 } }
    expect(exceededShapeSearchBudget(usage, exact)).toEqual([])
    expect(exceededShapeSearchBudget(usage, { maxGogmaGeneratedStates: 9, maxSkillStates: 2, maxSettledWork: 6, maxPredictions: { normalArtian: 0, skill: 1, gogmaReset: 2, gogmaKeep: 3 } }))
      .toEqual(['gogmaGeneratedStates', 'skillStates', 'settledWork', 'normalArtianPredictions', 'skillPredictions', 'gogmaResetPredictions', 'gogmaKeepPredictions'])
  })
})

describe('Phase D-0A-2b premise check (design 5.4 step 4 / 5.5)', () => {
  it('names a missing, exclusive or protected source and a blocked required Skill position, from positions and the PlannerInput alone', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const request = await buildShapeConstrainedRequest(shape.c!, [run.materializedEntries[0]!], shapeInputs(scene))
    const check = (edit: Partial<Parameters<typeof checkMinimalRoutePremises>[0]>) => checkMinimalRoutePremises({ ...request, scale: request.predictedScale, plannerInput: scene.input, ...edit })
    expect(check({})).toEqual([])
    expect(check({ plannerInput: { ...scene.input, ownedWeapons: scene.input.ownedWeapons.filter(weapon => weapon.id !== 'owned.g2') } })).toEqual([{ kind: 'source_not_found', ownedWeaponId: 'owned.g2' }])
    expect(check({ reservation: { ...request.reservation, exclusiveOwnedWeaponIds: ['owned.g2' as never] } })).toEqual([{ kind: 'source_exclusive', ownedWeaponId: 'owned.g2' }])
    expect(check({ plannerInput: { ...scene.input, ownedWeapons: scene.input.ownedWeapons.map(weapon => ({ ...weapon, isProtected: true })) } })).toEqual([{ kind: 'source_protected', ownedWeaponId: 'owned.g2' }])
    expect(check({ reservation: { ...request.reservation, gogma: { held: [12, 14], blocked: [12, 14] } } })).toEqual([{ kind: 'required_position_blocked', stream: 'gogma', position: 14 }])
    const skillShape = { ...request.routeShape, skill: { kind: 'reset_skills' as const, finalPosition: 8 } }
    expect(check({ routeShape: skillShape, extent: { ...request.extent, maxSkillAdvance: 2 }, reservation: { ...request.reservation, skill: { held: [8], blocked: [8] } } })).toEqual([{ kind: 'required_position_blocked', stream: 'skill', position: 8 }])
  }, 30_000)
})

describe('Phase D-0A-2b method rule d0a2-v2 (design 11)', () => {
  it('detects continuation shapes through one extensible detector list (G1 until A-2)', async () => {
    expect(CONTINUATION_SHAPE_DETECTORS).toEqual([searchPolicyShapeOf])
    expect(Object.isFrozen(CONTINUATION_SHAPE_DETECTORS)).toBe(true)
    const { scene, candidate } = await scenarioG1Continuation()
    const option = candidate.expectedShapes[0]!.option
    expect(continuationShapeOf(option, scene.table)).toEqual({ policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 7, finalPosition: 9 })
    const held = await scenarioHeldCrossing()
    for (const shape of held.candidate.expectedShapes) expect(continuationShapeOf(shape.option, held.scene.table)).toBeNull()
  }, 30_000)

  it('orders the methods from the ReachTable and the shape alone, never from the predicted scale', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const aRequest = await buildShapeConstrainedRequest(shape.a!, [], shapeInputs(scene))
    const projected = await buildProjectedRequest(shape.a!, scene.inputs())
    const continuous = selectShapeMaterializationMethods(shape.a!, shapeOwnPositions(shape.a!), scene.table, { shapeConstrained: aRequest.predictedScale, projected: projected.predictedSearchScale })
    expect(continuous).toMatchObject({ materializationRule: 'd0a2-v2', rule: 'continuous_projected_then_shape_constrained', continuous: true, order: ['candidate_search_projected', 'shape_constrained'], continuation: null, policyShape: null })
    // A larger or smaller projected scale changes nothing (no scale comparison in d0a2-v2).
    const huge = { ...projected.predictedSearchScale, gogmaLegalWidth: 1_000_000 }
    expect(selectShapeMaterializationMethods(shape.a!, shapeOwnPositions(shape.a!), scene.table, { shapeConstrained: aRequest.predictedScale, projected: huge })).toMatchObject({ rule: continuous.rule, order: continuous.order })
    const cRequest = await buildShapeConstrainedRequest(shape.c!, [run.materializedEntries[0]!], shapeInputs(scene))
    expect(selectShapeMaterializationMethods(shape.c!, shapeOwnPositions(shape.c!), scene.table, { shapeConstrained: cRequest.predictedScale, projected: null }))
      .toMatchObject({ rule: 'non_continuous_shape_constrained_only', continuous: false, order: ['shape_constrained'] })
    // A continuous shape without its projected request is an internal inconsistency.
    expect((await invalid(() => selectShapeMaterializationMethods(shape.a!, shapeOwnPositions(shape.a!), scene.table, { shapeConstrained: aRequest.predictedScale, projected: null }))).code).toBe('invalid_shape')
    // A continuation shape is the shape-constrained method's alone, even when it is continuous.
    const g1 = await scenarioG1Continuation()
    const g1Shape = g1.candidate.expectedShapes[0]!
    expect(shapeOwnPositions(g1Shape).continuous).toBe(true)
    const g1Request = await buildShapeConstrainedRequest(g1Shape, [], shapeInputs(g1.scene))
    const g1Projected = await buildProjectedRequest(g1Shape, g1.scene.inputs())
    expect(selectShapeMaterializationMethods(g1Shape, shapeOwnPositions(g1Shape), g1.scene.table, { shapeConstrained: g1Request.predictedScale, projected: g1Projected.predictedSearchScale }))
      .toMatchObject({ rule: 'continuation_shape_constrained_only', order: ['shape_constrained'], policyShape: { conversionPosition: 7, finalPosition: 9 } })
    expect(SERIES_IDEAL).toBe('series_skill.fixture.a')
  }, 30_000)
})
