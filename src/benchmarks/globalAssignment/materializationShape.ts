/**
 * Issue #154 Global Assignment Phase D-0A (Research only; never imported by the app).
 *
 * The Route-shape side of the materialization (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 8.3 / 9.1 - 9.3):
 * the shape's own Counter positions per stream, whether they are continuous (design 9.2 / 9.3), the
 * Search extent a shape needs, and `matchExpectedShape()` (design 9.1).
 *
 * The match reads a materialized Entry only through the existing authorities: the required positions are
 * the `counterBefore` of every unit `createPlannerRouteUnitPlans()` marks `canSkipWhenCounterPassed = false`,
 * the source is `BuildRoute.sourceOwnedWeaponId`, and the final weapon is the Candidate's own result
 * (bonus multiset by `areRestorationBonusSetsEqual()`, scope, Series and Group Skill). The skippable chain,
 * the Route operation count and the RouteKind are never compared: the predicted chain is a hint for the
 * method choice, the Search scale and diagnostics, not a Production Route (design 4.4 / 8.3).
 */
import { areRestorationBonusSetsEqual, type BuildListEntry } from '../../domain/models/publicTypes'
import { createPlannerRouteUnitPlans } from '../../domain/planner/plannerRouteProgress'
import type { RngEngine } from '../../domain/rng/rngEngine'
import type { RequiredPositions } from './assignmentTypes'
import type { ExpectedRouteShape } from './coverageTypes'
import {
  GlobalAssignmentMaterializationError,
  type ConversionSkillContinuationShape, type OwnedGogmaContinuationShape, type SearchPolicyShape, type ShapeMatchResult, type ShapeMismatchReason,
} from './materializationTypes'
import type { InclusiveRange, ReachOption, ReachTable } from './types'

export type ShapeStream = 'skill' | 'gogma' | 'normal'

export interface OwnStreamPositions {
  /** The shape's own positions of the stream (required and predicted chain) as maximal inclusive runs, ascending. */
  runs: InclusiveRange[]
  /** The first own position, or null when the shape has no operation on the stream. */
  first: number | null
  /** The last own position: always the stream's last required position. */
  last: number | null
}

export interface ShapeOwnPositions {
  skill: OwnStreamPositions
  gogma: OwnStreamPositions
  normal: OwnStreamPositions
  /** Design 9.2: on every stream the own positions form at most one run (no held position between them). */
  continuous: boolean
}

function invalidShape(shape: ExpectedRouteShape, message: string): never {
  throw new GlobalAssignmentMaterializationError('invalid_shape', shape.targetWeaponId, `Target ${shape.targetWeaponId}: ${message}`)
}

function streamPositions(shape: ExpectedRouteShape, stream: ShapeStream): OwnStreamPositions {
  const { required } = shape.match
  const requiredPositions = stream === 'skill' ? required.skill : stream === 'gogma' ? required.gogma : required.normal === null ? [] : [required.normal.position]
  const chains = shape.predicted.chainSegments.filter(segment => segment.stream.kind === stream)
  for (const chain of chains) {
    if (chain.stream.kind === 'normal' && (required.normal === null || chain.stream.counterId !== required.normal.counterId)) {
      invalidShape(shape, `a Normal chain ${chain.from}..${chain.to} on ${chain.stream.counterId} without its own production target on that Counter.`)
    }
  }
  const intervals: InclusiveRange[] = [
    ...requiredPositions.map(position => ({ from: position, to: position })),
    ...chains.map(chain => ({ from: chain.from, to: chain.to })),
  ].sort((left, right) => left.from - right.from)
  const runs: InclusiveRange[] = []
  for (const interval of intervals) {
    if (!Number.isSafeInteger(interval.from) || !Number.isSafeInteger(interval.to) || interval.from > interval.to) invalidShape(shape, `${stream} interval ${interval.from}..${interval.to} is not an inclusive integer range.`)
    const previous = runs[runs.length - 1]
    if (previous !== undefined && interval.from <= previous.to) invalidShape(shape, `${stream} positions ${interval.from}..${interval.to} overlap ${previous.from}..${previous.to}.`)
    if (previous !== undefined && interval.from === previous.to + 1) previous.to = interval.to
    else runs.push({ ...interval })
  }
  if (runs.length === 0) return { runs, first: null, last: null }
  const last = runs[runs.length - 1]!.to
  if (requiredPositions.length === 0 || last !== Math.max(...requiredPositions)) invalidShape(shape, `the last ${stream} position ${last} is not a required position.`)
  return { runs, first: runs[0]!.from, last }
}

/** The shape's own positions per stream and whether they are continuous (design 9.2 / 9.3). */
export function shapeOwnPositions(shape: ExpectedRouteShape): ShapeOwnPositions {
  const skill = streamPositions(shape, 'skill')
  const gogma = streamPositions(shape, 'gogma')
  const normal = streamPositions(shape, 'normal')
  return { skill, gogma, normal, continuous: skill.runs.length <= 1 && gogma.runs.length <= 1 && normal.runs.length <= 1 }
}

/** The stream start one Search counts its extent from. */
export interface StreamOrigins {
  skill: number
  gogma: number
  /** The Normal Counter start of a new Normal source; null for an owned source. */
  normal: number | null
}

export interface ShapeSearchExtent {
  maxNormalAdvance: number
  maxGogmaAdvance: number
  maxSkillAdvance: number
}

/**
 * Design 9.1 `extentFor(shape)`: the window ends at the shape's last required position of each stream,
 * counted from `origins` (the Planner-start Counters for design 9.1, the projected starts for design 9.2):
 *   Normal  p − origin + 1 for a new Normal source, otherwise 1
 *   Gogma   last Bonus position − origin + 1, or 1 without a Bonus operation
 *   Skill   last Skill position − origin + (owned Gogma ? 1 : 0), at least 1 (SEARCH_SPEC 3.1: an existing
 *           Gogma's Reset Skills window is origin .. origin + M − 1, a conversion Route's origin .. origin + M)
 */
export function shapeSearchExtent(shape: ExpectedRouteShape, origins: StreamOrigins): ShapeSearchExtent {
  const option: ReachOption = shape.option
  const lastSkill = option.skillRequired.kind === 'none' ? origins.skill : option.skillRequired.finalPosition
  const extent: ShapeSearchExtent = {
    maxNormalAdvance: option.normalRequired === null ? 1 : option.normalRequired.position - (origins.normal ?? Number.NaN) + 1,
    maxGogmaAdvance: option.bonusRequired.kind === 'none' ? 1 : option.bonusRequired.finalPosition - origins.gogma + 1,
    maxSkillAdvance: Math.max(1, lastSkill - origins.skill + (option.source.kind === 'owned_gogma' ? 1 : 0)),
  }
  for (const [key, value] of Object.entries(extent)) {
    if (!Number.isSafeInteger(value) || value < 1) invalidShape(shape, `extent ${key} ${String(value)} is not a positive integer (origins ${JSON.stringify(origins)}).`)
  }
  return extent
}

function rowOf(option: ReachOption, table: ReachTable) {
  const row = table.targets.find(value => value.targetWeaponId === option.targetWeaponId)
  if (!row) throw new GlobalAssignmentMaterializationError('invalid_shape', option.targetWeaponId, `Target ${option.targetWeaponId} has no ReachTable row.`)
  return row
}

/**
 * Design 19.3 G1 (Phase D-0B): the conversion continuation of one option, or null. A `conversion (c, s*)` with
 * `c < s*` whose conversion position `c` is one of the Target's Ideal Skill positions in the ReachTable (the same
 * `evaluateSkillCondition()` judgement the Search's lane-start check reads; conversion and Reset Skills draw the same
 * Skills at one position) is never returned by the Production Search, whose Route base with an Ideal lane-start Skill
 * opens no Reset Skills channel. Decided from the ReachTable alone: no prediction, no Search, no reservation.
 */
export function conversionSkillContinuationShapeOf(option: ReachOption, table: ReachTable): ConversionSkillContinuationShape | null {
  const skill = option.skillRequired
  if (skill.kind !== 'conversion' || skill.conversionPosition >= skill.finalPosition) return null
  if (!rowOf(option, table).skill.idealPositions.includes(skill.conversionPosition)) return null
  return { policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: skill.conversionPosition, finalPosition: skill.finalPosition }
}

/**
 * A-2 G2: the owned-Gogma current-Ideal lane continuation of one option, or null. The source's current Skills / Bonuses (its
 * Route base's lane start) are Ideal for the Target - the ReachTable's `currentSkillIdeal` / `currentBonusIdeal`, judged by the
 * same `evaluateSkillCondition()` / `satisfiesIdealBonuses()` the Search's lane-start check reads - and the option still
 * operates that lane (S2: `reset_skills`; B1 / B2: `reset`, `keep_from_source` or `reset_then_keep`). The Production Search
 * opens no channel on such a lane, so neither design 9.1 nor 9.2 delivers it. Decided from the option and its row alone.
 */
export function ownedGogmaContinuationShapeOf(option: ReachOption, table: ReachTable): OwnedGogmaContinuationShape | null {
  const source = option.source
  if (source.kind !== 'owned_gogma') return null
  rowOf(option, table)
  const skillRequired = option.skillRequired
  const bonusRequired = option.bonusRequired
  const skill = source.currentSkillIdeal && skillRequired.kind === 'reset_skills' ? { finalPosition: skillRequired.finalPosition } : null
  const bonus = source.currentBonusIdeal && bonusRequired.kind !== 'none'
    ? { requirement: bonusRequired.kind, resetPosition: bonusRequired.kind === 'reset_then_keep' ? bonusRequired.resetPosition : null, finalPosition: bonusRequired.finalPosition }
    : null
  if (skill === null && bonus === null) return null
  return { policy: 'lane_start_ideal_owned_gogma_continuation', ownedWeaponId: source.ownedWeaponId, skill, bonus }
}

/**
 * The Search-policy shape of one option (design 19.3 G1, A-2 G2), or null: the conversion continuation first, then the
 * owned-Gogma continuation (an option is at most one of them: G1 needs a Normal source, G2 an owned Gogma). The rule
 * `d0a-v1` classifies it `not_executed(search_policy_shape)` before any Search; the G1 value and its serialization are the
 * D-0B ones. A G2 shape exists only in an a2 table's options.
 */
export function searchPolicyShapeOf(option: ReachOption, table: ReachTable): SearchPolicyShape | null {
  return conversionSkillContinuationShapeOf(option, table) ?? ownedGogmaContinuationShapeOf(option, table)
}

/** The Planner-start origins of a shape's streams (design 9.1). */
export function plannerStartOrigins(shape: ExpectedRouteShape, table: ReachTable): StreamOrigins {
  const forge = shape.option.normalRequired
  if (forge !== null && table.originNormal[forge.counterId] === undefined) invalidShape(shape, `the table holds no Normal Counter ${forge.counterId}.`)
  return { skill: table.originSkill, gogma: table.originGogma, normal: forge === null ? null : table.originNormal[forge.counterId]! }
}

export interface PlannedRequiredPositions {
  required: RequiredPositions
  /** Required units without a Counter position (a blind creation). */
  unpositionedRequiredUnits: number
  /** Required Normal units (a Route forging two production targets would have two). */
  normalRequiredUnits: number
}

/**
 * The required positions of one Entry by the one Production authority (`createPlannerRouteUnitPlans()`):
 * the `counterBefore` of each unit that is not `canSkipWhenCounterPassed`, per stream (Normal with its
 * Counter ID), or null when the Planner rejects the Route's unit plan.
 */
export function plannerRequiredPositions(entry: BuildListEntry, engine: RngEngine): PlannedRequiredPositions | null {
  const plans = createPlannerRouteUnitPlans([entry], engine)
  const units = plans.unitPlans.get(entry.id)
  if (plans.rejections.length > 0 || units === undefined) return null
  const skill: number[] = []
  const gogma: number[] = []
  const normal: { counterId: string; position: number }[] = []
  let unpositionedRequiredUnits = 0
  for (const unit of units) {
    if (unit.canSkipWhenCounterPassed) continue
    if (unit.counterStream === null || unit.counterBefore === null) unpositionedRequiredUnits += 1
    else if (unit.counterStream === 'skill') skill.push(unit.counterBefore)
    else if (unit.counterStream === 'gogma') gogma.push(unit.counterBefore)
    else normal.push({ counterId: unit.counterId ?? '', position: unit.counterBefore })
  }
  const ascending = (values: number[]) => [...values].sort((left, right) => left - right)
  return {
    required: { skill: ascending(skill), gogma: ascending(gogma), normal: normal.length === 1 ? normal[0]! : null },
    unpositionedRequiredUnits,
    normalRequiredUnits: normal.length,
  }
}

const sameNumbers = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index])

/**
 * Design 9.1 `matchesExpectedShape()`: the Entry matches when its Target, source, required positions per
 * stream and final weapon equal the shape's `match` (design 8.3). Chain positions, operation count and
 * RouteKind are deliberately not compared.
 */
export function matchExpectedShape(entry: BuildListEntry, shape: ExpectedRouteShape, engine: RngEngine): ShapeMatchResult {
  const reasons: ShapeMismatchReason[] = []
  const expected = shape.match
  const candidate = entry.candidateSnapshot
  if (entry.targetWeaponId !== shape.targetWeaponId || candidate.targetWeaponId !== shape.targetWeaponId) reasons.push('target')
  const planned = plannerRequiredPositions(entry, engine)
  if (planned === null) {
    reasons.push('unit_plan_rejected')
  } else {
    if (planned.unpositionedRequiredUnits > 0) reasons.push('unpositioned_required_unit')
    if (!sameNumbers(planned.required.skill, expected.required.skill)) reasons.push('skill_required')
    if (!sameNumbers(planned.required.gogma, expected.required.gogma)) reasons.push('gogma_required')
    const actualNormal = planned.required.normal
    const expectedNormal = expected.required.normal
    const normalMatches = planned.normalRequiredUnits <= 1 && (actualNormal === null
      ? expectedNormal === null
      : expectedNormal !== null && actualNormal.counterId === expectedNormal.counterId && actualNormal.position === expectedNormal.position)
    if (!normalMatches) reasons.push('normal_required')
  }
  if (candidate.route.sourceOwnedWeaponId !== expected.sourceOwnedWeaponId) reasons.push('source')
  if (!areRestorationBonusSetsEqual(candidate.finalBonuses, expected.finalBonuses)) reasons.push('final_bonuses')
  if (candidate.restorationBonusScope !== expected.restorationBonusScope) reasons.push('restoration_bonus_scope')
  if (candidate.seriesSkillId !== expected.seriesSkillId) reasons.push('series_skill')
  if (candidate.groupSkillId !== expected.groupSkillId) reasons.push('group_skill')
  if (reasons.length === 0 && planned !== null) return { matches: true, plannerRequired: planned.required }
  return { matches: false, reasons, plannerRequired: planned?.required ?? null }
}
