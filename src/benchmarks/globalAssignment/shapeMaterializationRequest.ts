/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research only; never imported by the app).
 *
 * The request side of the shape-constrained materialization (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.2 / 5.4 / 9.1 /
 * 11): the conversion of an `ExpectedRouteShape` into the D-0A-2a seam's `RouteShapeConstraint`, the deterministic search
 * identity, the position premises of the minimal Route lemma (5.5), the assembly of one request from a formal reservation,
 * and the method rule `d0a2-v2`.
 *
 * Every function is pure and reads the shape, the formal reservation and the Planner-start PlannerInput only: no prediction,
 * no Search, no Clock, no UUID, no enumeration ordinal and no delivery order. The formal reservation itself is derived by the
 * caller (`materialize.ts`, the one D-0A place that derives it) and is never edited here: the expected source, conversion
 * position and production target restrict the seam's Route base through the shape, never through held / blocked.
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import type { BuildListEntryId } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { createPlannerStartSearchOrigin, normalizePlannerSearchOrigin, resolvePlannerSearchOriginTarget } from '../../domain/planner/replacement/plannerSearchOrigin'
import { normalizePlannerAlternativeReservation, type PlannerAlternativeReservation } from '../../domain/search/alternative'
import { createCounterReservation } from '../../domain/search/counterReservation'
import { SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION, type RouteShapeConstraint } from '../../domain/search/research'
import type { ExpectedRouteShape } from './coverageTypes'
import { plannerStartOrigins, searchPolicyShapeOf, shapeSearchExtent, type ShapeOwnPositions } from './materializationShape'
import { GlobalAssignmentMaterializationError, type PredictedSearchScale } from './materializationTypes'
import { predictShapeSearchScale } from './shapeMaterializationScale'
import {
  GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM,
  type ContinuationShape, type MinimalRoutePremiseViolation, type ShapeConstrainedMaterializationRequest, type ShapeMethodSelection, type ShapeSearchScale,
} from './shapeMaterializationTypes'
import type { GlobalAssignmentContext, ReachOption, ReachTable } from './types'

function invalidShape(shape: ExpectedRouteShape, message: string): never {
  throw new GlobalAssignmentMaterializationError('invalid_shape', shape.targetWeaponId, `Target ${shape.targetWeaponId}: ${message}`)
}

/**
 * Design 5.2 / 5.4 step 3: the seam's shape, read from `shape.option` alone (one value per option, no game state and no
 * expected prediction is made up):
 *
 *   source owned_gogma -> base owned_gogma; owned_normal -> base owned_normal (c); new_normal -> base new_normal (Counter, p, c)
 *   Skill  none -> zero; reset_skills(s*) -> reset_skills(s*); conversion(c, c) -> zero; conversion(c, s*), c < s* -> reset_skills(s*)
 *   Bonus  none -> zero; reset(g*) -> reset(g*); keep_from_source(g*) -> keep(g*); reset_then_keep(g1, g*) -> reset_then_keep(g1, g*)
 *
 * A combination Phase A never builds (a conversion without a conversion source, a Normal source without a conversion or with
 * a zero Bonus lane, a production target that is not the source's) is an internal inconsistency: `invalid_shape`.
 */
export function toRouteShapeConstraint(shape: ExpectedRouteShape): RouteShapeConstraint {
  const option = shape.option
  const { source, skillRequired: skill, bonusRequired: bonus } = option
  let base: RouteShapeConstraint['base']
  let skillLane: RouteShapeConstraint['skill']
  if (source.kind === 'owned_gogma') {
    if (skill.kind === 'conversion') invalidShape(shape, 'an owned Gogma source has no conversion.')
    if (option.normalRequired !== null) invalidShape(shape, 'an owned Gogma source has no Normal production target.')
    base = { kind: 'owned_gogma', ownedWeaponId: source.ownedWeaponId }
    skillLane = skill.kind === 'none' ? { kind: 'zero' } : { kind: 'reset_skills', finalPosition: skill.finalPosition }
  } else {
    if (skill.kind !== 'conversion') invalidShape(shape, `a ${source.kind} source needs a conversion (got ${skill.kind}).`)
    if (skill.conversionPosition > skill.finalPosition) invalidShape(shape, `conversion ${skill.conversionPosition} follows its final Skill ${skill.finalPosition}.`)
    if (bonus.kind === 'none') invalidShape(shape, `a ${source.kind} source has no zero Bonus lane (its slots are normal_artian scope).`)
    skillLane = skill.conversionPosition === skill.finalPosition ? { kind: 'zero' } : { kind: 'reset_skills', finalPosition: skill.finalPosition }
    if (source.kind === 'owned_normal') {
      if (option.normalRequired !== null) invalidShape(shape, 'an owned Normal source has no Normal production target.')
      base = { kind: 'owned_normal', ownedWeaponId: source.ownedWeaponId, conversionSkillPosition: skill.conversionPosition }
    } else {
      const forge = option.normalRequired
      if (forge === null || forge.counterId !== source.counterId || forge.position !== source.position) {
        invalidShape(shape, 'a new Normal source needs its own production target on its own Counter.')
      }
      base = { kind: 'new_normal', counterId: source.counterId, productionTargetPosition: source.position, conversionSkillPosition: skill.conversionPosition }
    }
  }
  let bonusLane: RouteShapeConstraint['bonus']
  switch (bonus.kind) {
    case 'none': bonusLane = { kind: 'zero' }; break
    case 'reset': bonusLane = { kind: 'reset', finalPosition: bonus.finalPosition }; break
    case 'keep_from_source': bonusLane = { kind: 'keep', finalPosition: bonus.finalPosition }; break
    case 'reset_then_keep': bonusLane = { kind: 'reset_then_keep', resetPosition: bonus.resetPosition, finalPosition: bonus.finalPosition }; break
  }
  return { base, skill: skillLane, bonus: bonusLane }
}

/** The shape as a plain value with only its semantic fields (the identity's input). */
export function normalizeRouteShapeConstraint(shape: RouteShapeConstraint): RouteShapeConstraint {
  const base = shape.base
  return {
    base: base.kind === 'owned_gogma' ? { kind: base.kind, ownedWeaponId: base.ownedWeaponId }
      : base.kind === 'owned_normal' ? { kind: base.kind, ownedWeaponId: base.ownedWeaponId, conversionSkillPosition: base.conversionSkillPosition }
        : { kind: base.kind, counterId: base.counterId, productionTargetPosition: base.productionTargetPosition, conversionSkillPosition: base.conversionSkillPosition },
    skill: shape.skill.kind === 'zero' ? { kind: 'zero' } : { kind: 'reset_skills', finalPosition: shape.skill.finalPosition },
    bonus: shape.bonus.kind === 'zero' ? { kind: 'zero' }
      : shape.bonus.kind === 'reset_then_keep' ? { kind: 'reset_then_keep', resetPosition: shape.bonus.resetPosition, finalPosition: shape.bonus.finalPosition }
        : { kind: shape.bonus.kind, finalPosition: shape.bonus.finalPosition },
  }
}

/**
 * Design 9.1: the deterministic search identity (also every Candidate's `searchRunId`): the algorithm token, the seam's route
 * policy version, the Target, the normalized Planner-start origin, the CalculationContext, the extent, the normalized formal
 * reservation and the normalized shape. No Clock, UUID, ordinal, delivery order or attempt count.
 */
export function shapeConstrainedSearchIdentity(input: {
  plannerInput: PlannerInput
  targetWeaponId: ShapeConstrainedMaterializationRequest['targetWeaponId']
  extent: ShapeConstrainedMaterializationRequest['extent']
  reservation: PlannerAlternativeReservation
  routeShape: RouteShapeConstraint
}): string {
  const origin = createPlannerStartSearchOrigin(input.plannerInput)
  const target = resolvePlannerSearchOriginTarget(origin, input.targetWeaponId)
  const context = origin.calculationContext
  return `research.global-assignment.shape.${hashStableValue({
    algorithm: GLOBAL_ASSIGNMENT_SHAPE_CONSTRAINED_ALGORITHM,
    routePolicy: SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION,
    targetWeaponId: target.id,
    origin: normalizePlannerSearchOrigin(origin, target),
    calculationContext: { gameVersion: context.gameVersion, masterDataVersion: context.masterDataVersion, rngEngineVersion: context.rngEngineVersion, appSchemaVersion: context.appSchemaVersion },
    extent: { maxNormalAdvance: input.extent.maxNormalAdvance, maxGogmaAdvance: input.extent.maxGogmaAdvance, maxSkillAdvance: input.extent.maxSkillAdvance },
    reservation: normalizePlannerAlternativeReservation(input.reservation),
    shape: normalizeRouteShapeConstraint(input.routeShape),
  }).replace(':', '-')}`
}

/**
 * Design 5.4 step 4 `checkMinimalRoutePremises()`: the position premises the lemma's proof uses (5.5), from positions and the
 * PlannerInput alone - the source exists, is not exclusive and, when operated, not protected; `c` is a formal legal
 * conversion position; `p` lies in the Normal extent and is not blocked; every required Skill / Gogma position lies in its
 * window and is not blocked. Compatibility and convertibility are the seam's base diagnosis.
 */
export function checkMinimalRoutePremises(input: {
  routeShape: RouteShapeConstraint
  reservation: PlannerAlternativeReservation
  origins: ShapeConstrainedMaterializationRequest['origins']
  extent: ShapeConstrainedMaterializationRequest['extent']
  scale: ShapeSearchScale
  plannerInput: PlannerInput
}): MinimalRoutePremiseViolation[] {
  const { routeShape, reservation, origins, extent, scale } = input
  const violations: MinimalRoutePremiseViolation[] = []
  const base = routeShape.base
  const operatesSource = base.kind !== 'owned_gogma' || routeShape.skill.kind !== 'zero' || routeShape.bonus.kind !== 'zero'
  if (base.kind !== 'new_normal') {
    const weapon = input.plannerInput.ownedWeapons.find(value => value.id === base.ownedWeaponId)
    if (weapon === undefined) violations.push({ kind: 'source_not_found', ownedWeaponId: base.ownedWeaponId })
    else {
      if (reservation.exclusiveOwnedWeaponIds.includes(weapon.id)) violations.push({ kind: 'source_exclusive', ownedWeaponId: weapon.id })
      if (weapon.isProtected && operatesSource) violations.push({ kind: 'source_protected', ownedWeaponId: weapon.id })
    }
  }
  if (base.kind !== 'owned_gogma' && !scale.conversionLegal) {
    violations.push({ kind: 'conversion_position_not_legal', position: base.conversionSkillPosition, legalPositions: [...scale.conversionLegalPositions] })
  }
  if (base.kind === 'new_normal') {
    if (origins.normal === null) violations.push({ kind: 'normal_counter_origin_missing', counterId: base.counterId })
    else {
      const offset = base.productionTargetPosition - origins.normal.position
      if (offset < 0 || offset >= extent.maxNormalAdvance) violations.push({ kind: 'production_target_outside_extent', counterId: base.counterId, position: base.productionTargetPosition })
      const normal = reservation.normal.find(value => value.counterId === base.counterId)
      if (normal !== undefined && normal.blocked.includes(base.productionTargetPosition)) violations.push({ kind: 'production_target_blocked', counterId: base.counterId, position: base.productionTargetPosition })
    }
  }
  const skillReservation = createCounterReservation(reservation.skill.held, reservation.skill.blocked)
  const gogmaReservation = createCounterReservation(reservation.gogma.held, reservation.gogma.blocked)
  if (routeShape.skill.kind === 'reset_skills') {
    const position = routeShape.skill.finalPosition
    const window = { from: base.kind === 'owned_gogma' ? origins.skill : base.conversionSkillPosition + 1, to: origins.skill + extent.maxSkillAdvance - (base.kind === 'owned_gogma' ? 1 : 0) }
    if (position < window.from || position > window.to) violations.push({ kind: 'required_position_outside_extent', stream: 'skill', position, window })
    if (skillReservation.isBlocked(position)) violations.push({ kind: 'required_position_blocked', stream: 'skill', position })
  }
  if (routeShape.bonus.kind !== 'zero') {
    const window = { from: origins.gogma, to: origins.gogma + extent.maxGogmaAdvance - 1 }
    const positions = routeShape.bonus.kind === 'reset_then_keep' ? [routeShape.bonus.resetPosition, routeShape.bonus.finalPosition] : [routeShape.bonus.finalPosition]
    for (const position of positions) {
      if (position < window.from || position > window.to) violations.push({ kind: 'required_position_outside_extent', stream: 'gogma', position, window })
      if (gogmaReservation.isBlocked(position)) violations.push({ kind: 'required_position_blocked', stream: 'gogma', position })
    }
  }
  return violations
}

/**
 * Design 5.4 steps 2 - 5: one shape-constrained request from the shape and the formal reservation of the Entries the caller
 * materialized before it (`reservationSourceEntryIds`, in materialization order). The extent is design 9.1 `extentFor(shape)`
 * from the Planner-start origins, exactly as the D-0A Planner Alternative request's.
 */
export async function assembleShapeConstrainedRequest(input: {
  shape: ExpectedRouteShape
  reservation: PlannerAlternativeReservation
  reservationSourceEntryIds: BuildListEntryId[]
  context: GlobalAssignmentContext
  table: ReachTable
}): Promise<ShapeConstrainedMaterializationRequest> {
  const { shape, reservation, context, table } = input
  const routeShape = toRouteShapeConstraint(shape)
  const streamOrigins = plannerStartOrigins(shape, table)
  const forge = shape.option.normalRequired
  const origins: ShapeConstrainedMaterializationRequest['origins'] = {
    skill: streamOrigins.skill,
    gogma: streamOrigins.gogma,
    normal: forge === null ? null : { counterId: forge.counterId, position: streamOrigins.normal! },
  }
  const extent = { ...shapeSearchExtent(shape, streamOrigins) }
  const predictedScale = await predictShapeSearchScale({ routeShape, reservation, origins, extent })
  return {
    method: 'shape_constrained',
    rule: 'd0a2-v2',
    targetWeaponId: shape.targetWeaponId,
    shape,
    routeShape,
    reservation,
    reservationSourceEntryIds: [...input.reservationSourceEntryIds],
    origins,
    extent,
    searchIdentity: shapeConstrainedSearchIdentity({ plannerInput: context.plannerInput, targetWeaponId: shape.targetWeaponId, extent, reservation, routeShape }),
    predictedScale,
    premiseViolations: checkMinimalRoutePremises({ routeShape, reservation, origins, extent, scale: predictedScale, plannerInput: context.plannerInput }),
  }
}

// ------------------------------------------------------------------------------------------------ the rule d0a2-v2

/** One detector of a continuation shape (design 11): the shapes whose lane continues past an already Ideal lane start. */
export type ContinuationShapeDetector = (option: ReachOption, table: ReachTable) => ContinuationShape | null

/**
 * The detectors `continuationShapeOf()` asks, in order. Until A-2 the one detector is G1 (`searchPolicyShapeOf()`: a
 * conversion whose Skill at `c` is already Ideal, continued to `s* > c`). A-2 adds the owned-Gogma current-Ideal lane
 * continuations (G2) here and widens `ContinuationShape`; nothing else changes.
 */
export const CONTINUATION_SHAPE_DETECTORS: readonly ContinuationShapeDetector[] = Object.freeze([searchPolicyShapeOf])

/** Design 11 `continuationShapeOf()`: the first detector's continuation shape, or null. Decided from the ReachTable alone. */
export function continuationShapeOf(option: ReachOption, table: ReachTable): ContinuationShape | null {
  for (const detect of CONTINUATION_SHAPE_DETECTORS) {
    const found = detect(option, table)
    if (found !== null) return found
  }
  return null
}

/**
 * Design 11: the deterministic method order of one Target under the rule `d0a2-v2`, from the ReachTable, the shape and its
 * own positions only (never a delivery order, a timing or an earlier result):
 *
 *   continuation shape (G1; G2 after A-2)  -> shape_constrained
 *   continuous (one run per stream)        -> candidate_search_projected, then shape_constrained once when it does not match
 *   non-continuous (crosses held positions) -> shape_constrained
 *
 * Planner Alternative Search (design 9.1) is never part of this rule; it stays in `d0a-v1` and in the parity tests.
 */
export function selectShapeMaterializationMethods(
  shape: ExpectedRouteShape,
  own: ShapeOwnPositions,
  table: ReachTable,
  predicted: { shapeConstrained: ShapeSearchScale; projected: PredictedSearchScale | null },
): ShapeMethodSelection {
  const continuation = continuationShapeOf(shape.option, table)
  const policyShape = searchPolicyShapeOf(shape.option, table)
  const common = {
    materializationRule: 'd0a2-v2' as const, continuous: own.continuous, continuation, policyShape,
    predictedSearchScale: { shapeConstrained: structuredClone(predicted.shapeConstrained), projected: predicted.projected === null ? null : { ...predicted.projected } },
  }
  if (continuation !== null) return { ...common, rule: 'continuation_shape_constrained_only', order: ['shape_constrained'] }
  if (own.continuous) {
    if (predicted.projected === null) invalidShape(shape, 'a continuous shape needs its projected request (design 11).')
    return { ...common, rule: 'continuous_projected_then_shape_constrained', order: ['candidate_search_projected', 'shape_constrained'] }
  }
  return { ...common, rule: 'non_continuous_shape_constrained_only', order: ['shape_constrained'] }
}
