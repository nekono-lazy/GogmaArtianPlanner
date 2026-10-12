/**
 * Issue #154 Global Assignment Phase D-0A (Research only; never imported by the app).
 *
 * Design 9.7: the Search scale of one materialization request, computed from the reservation and the
 * extent before any Search runs, with the very Production primitives the Search walks with
 * (`createCounterReservation()`, `nextOperationPositions()`, `heldPrefixNormalCreation()`), so the
 * prediction cannot drift from the Search's legal-position rule:
 *
 *   conversionPositions  `nextOperationPositions(skill reservation, origin, origin + M + 1)` - the
 *                        `conversionSkillPositions()` walk: `[origin, first non-held] \ blocked` inside the
 *                        conversion window. An owned Gogma has no conversion: 0.
 *   skillLegalWidth      non-blocked positions of the Skill window (`origin .. origin + M - 1`; a
 *                        conversion Route's `origin .. origin + M`, SEARCH_SPEC 3.1).
 *   gogmaLegalWidth      non-blocked positions of `origin .. origin + N - 1`.
 *   normalForgeCount     own forges of the canonical held-prefix creation (PLANNER_SPEC 9.2.19.4) up to the
 *                        production target; 0 for an owned source.
 *
 * A projected Candidate Search has no reservation, so it is predicted with the empty reservation from the
 * projected starts (one conversion position, full windows, `p - start + 1` forges).
 *
 * The values are Research diagnostics and the gate's input. They are not a formal Search work unit (G8),
 * and the gate's limits are always the caller's: nothing here holds a default threshold.
 */
import { createCounterReservation, heldPrefixNormalCreation, nextOperationPositions } from '../../domain/search/counterReservation'
import type { PlannerAlternativeReservation } from '../../domain/search/alternative'
import type { PredictedSearchScale, SearchScaleDetail, SearchScaleGate } from './materializationTypes'
import type { ShapeSearchExtent } from './materializationShape'
import type { NormalArtianCounterId } from './types'

export interface SearchScaleInput {
  /** A conversion Route (new / owned Normal source) or an existing Gogma Route. */
  routeBase: 'conversion' | 'owned_gogma'
  /** The reservation the Search reads (the empty reservation for a projected Candidate Search). */
  reservation: PlannerAlternativeReservation
  origins: { skill: number; gogma: number }
  /** A new Normal source's Counter, its start and production target; null for an owned source. */
  normal: { counterId: NormalArtianCounterId; origin: number; productionTarget: number } | null
  extent: ShapeSearchExtent
}

function legalWidth(blocked: readonly number[], from: number, to: number): number {
  const blockedSet = new Set(blocked)
  let width = 0
  for (let position = from; position <= to; position++) if (!blockedSet.has(position)) width += 1
  return width
}

export async function predictSearchScale(input: SearchScaleInput): Promise<{ scale: PredictedSearchScale; detail: SearchScaleDetail }> {
  const { reservation, origins, extent } = input
  const skillWindow = {
    from: origins.skill,
    to: origins.skill + extent.maxSkillAdvance - (input.routeBase === 'conversion' ? 0 : 1),
  }
  const gogmaWindow = { from: origins.gogma, to: origins.gogma + extent.maxGogmaAdvance - 1 }
  let conversionSkillPositions: number[] = []
  let conversionBeyondExtent = false
  if (input.routeBase === 'conversion') {
    const walk = await nextOperationPositions(
      createCounterReservation(reservation.skill.held, reservation.skill.blocked),
      origins.skill,
      origins.skill + extent.maxSkillAdvance + 1,
      async () => {},
    )
    conversionSkillPositions = walk.positions
    conversionBeyondExtent = walk.beyondLimit
  }
  let normalCreation: SearchScaleDetail['normalCreation'] = null
  if (input.normal !== null) {
    const { counterId, origin, productionTarget } = input.normal
    const counterReservation = reservation.normal.find(entry => entry.counterId === counterId)
    normalCreation = heldPrefixNormalCreation(
      createCounterReservation(counterReservation?.held ?? [], counterReservation?.blocked ?? []),
      origin,
      productionTarget,
    )
  }
  return {
    scale: {
      conversionPositions: conversionSkillPositions.length,
      gogmaLegalWidth: legalWidth(reservation.gogma.blocked, gogmaWindow.from, gogmaWindow.to),
      skillLegalWidth: legalWidth(reservation.skill.blocked, skillWindow.from, skillWindow.to),
      normalForgeCount: normalCreation?.count ?? 0,
    },
    detail: {
      origins: { skill: origins.skill, gogma: origins.gogma, normal: input.normal === null ? null : { counterId: input.normal.counterId, position: input.normal.origin } },
      conversionSkillPositions,
      conversionBeyondExtent,
      skillWindow,
      gogmaWindow,
      normalCreation,
    },
  }
}

const SCALE_KEYS = ['conversionPositions', 'gogmaLegalWidth', 'skillLegalWidth', 'normalForgeCount'] as const

/** The components of `scale` above the caller's gate (design 9.7); empty means the request may run. */
export function exceededSearchScaleGate(scale: PredictedSearchScale, gate: SearchScaleGate): (keyof PredictedSearchScale)[] {
  const limit: Record<keyof PredictedSearchScale, number> = {
    conversionPositions: gate.maxConversionPositions,
    gogmaLegalWidth: gate.maxGogmaLegalWidth,
    skillLegalWidth: gate.maxSkillLegalWidth,
    normalForgeCount: gate.maxNormalForgeCount,
  }
  return SCALE_KEYS.filter(key => scale[key] > limit[key])
}

/** Whether every gate limit is a non-negative safe integer (the caller states each one explicitly). */
export function isValidSearchScaleGate(gate: SearchScaleGate): boolean {
  return gate !== null && typeof gate === 'object'
    && [gate.maxConversionPositions, gate.maxGogmaLegalWidth, gate.maxSkillLegalWidth, gate.maxNormalForgeCount]
      .every(value => Number.isSafeInteger(value) && value >= 0)
}

/**
 * The design 9.3 "smaller predicted scale" for the method choice: `left` is smaller only when it is no
 * larger in every component and strictly smaller in one (Pareto dominance). The components measure
 * different Search dimensions, so no weighting or component order is invented; a tie and an incomparable
 * pair are both "not smaller", which the design resolves to the projected Candidate Search. A D-0A
 * decision recorded in the design (9.9).
 */
export function isSmallerSearchScale(left: PredictedSearchScale, right: PredictedSearchScale): boolean {
  return SCALE_KEYS.every(key => left[key] <= right[key]) && SCALE_KEYS.some(key => left[key] < right[key])
}
