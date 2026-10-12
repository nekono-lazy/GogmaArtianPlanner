import { describe, expect, it } from 'vitest'
import { createPlannerStartSearchOrigin } from '../../domain/planner/replacement/plannerSearchOrigin'
import type { PlannerAlternativeCandidate, PlannerAlternativeReservation } from '../../domain/search/alternative'
import { buildPlannerAlternativeRequest, materializeStructuralCandidate, productionMaterializationSearchPort, selectMaterializationMethods } from './materialize'
import { exceededSearchScaleGate, isSmallerSearchScale, isValidSearchScaleGate, predictSearchScale, type SearchScaleInput } from './materializationScale'
import { shapeOwnPositions } from './materializationShape'
import { scenarioHeldCrossing, scenarioSkillDependency } from './materializationTestFixture'
import type { PlannerAlternativeMaterializationRequest, PredictedSearchScale } from './materializationTypes'

/*
 * Issue #154 Global Assignment Phase D-0A (design 9.7): the Search scale predicted from a reservation and an
 * extent, checked against an independent position-by-position re-implementation of the legal-position rule
 * (SEARCH_SPEC 5.6.8 coverage condition, PLANNER_SPEC 9.2.19.4 held prefix) and against the positions a real
 * Planner Alternative Search actually used. Small held / blocked fixtures only.
 */

/** A deterministic pseudo-random stream (no Math.random). */
function lcg(seed: number) {
  let state = seed >>> 0
  return (bound: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % bound
  }
}

/** The legal-position rule written out on its own, position by position. */
function bruteForce(input: SearchScaleInput): { scale: PredictedSearchScale; conversions: number[]; beyond: boolean } {
  const { reservation, origins, extent } = input
  const skillHeld = new Set(reservation.skill.held)
  const skillBlocked = new Set(reservation.skill.blocked)
  const conversions: number[] = []
  let beyond = false
  if (input.routeBase === 'conversion') {
    const limit = origins.skill + extent.maxSkillAdvance + 1
    for (let position = origins.skill; ; position++) {
      if (position >= limit) { beyond = true; break }
      if (!skillBlocked.has(position)) conversions.push(position)
      if (!skillHeld.has(position)) break
    }
  }
  const skillLast = origins.skill + extent.maxSkillAdvance - (input.routeBase === 'conversion' ? 0 : 1)
  let skillWidth = 0
  for (let position = origins.skill; position <= skillLast; position++) if (!skillBlocked.has(position)) skillWidth += 1
  const gogmaBlocked = new Set(reservation.gogma.blocked)
  let gogmaWidth = 0
  for (let position = origins.gogma; position < origins.gogma + extent.maxGogmaAdvance; position++) if (!gogmaBlocked.has(position)) gogmaWidth += 1
  let forges = 0
  if (input.normal !== null) {
    const held = new Set(reservation.normal.find(entry => entry.counterId === input.normal!.counterId)?.held ?? [])
    let start = input.normal.origin
    while (start < input.normal.productionTarget && held.has(start)) start += 1
    forges = input.normal.productionTarget - start + 1
  }
  return { scale: { conversionPositions: conversions.length, gogmaLegalWidth: gogmaWidth, skillLegalWidth: skillWidth, normalForgeCount: forges }, conversions, beyond }
}

function randomReservation(next: (bound: number) => number, counterId: string): PlannerAlternativeReservation {
  const stream = (from: number, span: number) => {
    const held = [...new Set(Array.from({ length: next(span) }, () => from + next(span)))].sort((left, right) => left - right)
    const blocked = held.filter(() => next(3) === 0)
    return { held, blocked }
  }
  return { normal: next(4) === 0 ? [] : [{ counterId, ...stream(0, 12) }], skill: stream(5, 14), gogma: stream(20, 14), exclusiveOwnedWeaponIds: [] }
}

describe('Phase D-0A Search scale prediction (design 9.7)', () => {
  it('matches an independent position-by-position walk of the legal-position rule on random held / blocked sets', async () => {
    const next = lcg(154)
    for (let index = 0; index < 400; index++) {
      const reservation = randomReservation(next, 'weapon.fixture.a:8')
      const routeBase = next(2) === 0 ? 'conversion' as const : 'owned_gogma' as const
      const normalOrigin = next(4)
      const input: SearchScaleInput = {
        routeBase,
        reservation,
        origins: { skill: 5 + next(4), gogma: 20 + next(4) },
        normal: routeBase === 'conversion' && next(3) !== 0 ? { counterId: 'weapon.fixture.a:8', origin: normalOrigin, productionTarget: normalOrigin + next(10) } : null,
        extent: { maxNormalAdvance: 1 + next(10), maxGogmaAdvance: 1 + next(12), maxSkillAdvance: 1 + next(12) },
      }
      const predicted = await predictSearchScale(input)
      const expected = bruteForce(input)
      expect(predicted.scale, JSON.stringify(input)).toEqual(expected.scale)
      expect(predicted.detail.conversionSkillPositions).toEqual(expected.conversions)
      expect(predicted.detail.conversionBeyondExtent).toBe(expected.beyond)
    }
  })

  it('predicts the positions a real Planner Alternative Search uses under a held / blocked Skill reservation', async () => {
    const { scene, candidate, shape } = await scenarioSkillDependency()
    const run = await materializeStructuralCandidate(candidate, scene.inputs())
    if (run.kind !== 'materialization') throw new Error(run.reason)
    const aEntry = run.materializedEntries[0]!
    for (const prior of [[aEntry], []]) {
      const request = await buildPlannerAlternativeRequest(shape.b!, prior, scene.inputs())
      const all = await deliverAll(request, scene)
      expect(all.length).toBeGreaterThan(0)
      // Every conversion position the Search used is a predicted one, and every predicted one was used.
      const converted = [...new Set(all.flatMap(value => value.route.operations.flatMap(operation => (operation.type === 'convert_normal_to_gogma' ? [operation.skillCounterBefore] : []))))].sort((left, right) => left - right)
      expect(converted).toEqual(request.scaleDetail.conversionSkillPositions)
      expect(request.predictedSearchScale.conversionPositions).toBe(converted.length)
      // Every own operation stands on a legal position of the predicted windows.
      const legal = (window: { from: number; to: number }, blocked: readonly number[]) => Array.from({ length: window.to - window.from + 1 }, (_, offset) => window.from + offset).filter(position => !blocked.includes(position))
      const legalSkill = legal(request.scaleDetail.skillWindow, request.reservation.skill.blocked)
      const legalGogma = legal(request.scaleDetail.gogmaWindow, request.reservation.gogma.blocked)
      expect(legalSkill.length).toBe(request.predictedSearchScale.skillLegalWidth)
      expect(legalGogma.length).toBe(request.predictedSearchScale.gogmaLegalWidth)
      for (const value of all) {
        for (const operation of value.route.operations) {
          if (operation.type === 'convert_normal_to_gogma' || operation.type === 'reset_skills') expect(legalSkill).toContain(operation.skillCounterBefore)
          if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') expect(legalGogma).toContain(operation.gogmaCounterBefore)
          if (operation.type === 'create_normal_artian') {
            expect({ before: operation.normalCounterBefore, count: operation.count }).toEqual({ before: request.scaleDetail.normalCreation!.normalCounterBefore, count: request.predictedSearchScale.normalForgeCount })
          }
        }
      }
    }
  }, 30_000)

  it('keeps every own Gogma operation of a crossing Route off the blocked positions it predicted', async () => {
    const { scene, candidate, shape } = await scenarioHeldCrossing()
    const run = await materializeStructuralCandidate(candidate, scene.inputs())
    if (run.kind !== 'materialization') throw new Error(run.reason)
    const request = await buildPlannerAlternativeRequest(shape.c!, [run.materializedEntries[0]!], scene.inputs())
    expect(request.predictedSearchScale).toEqual({ conversionPositions: 0, gogmaLegalWidth: 4, skillLegalWidth: 1, normalForgeCount: 0 })
    const all = await deliverAll(request, scene)
    expect(all.length).toBeGreaterThan(0)
    for (const value of all) {
      const gogma = value.route.operations.flatMap(operation => (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses' ? [operation.gogmaCounterBefore] : []))
      expect(gogma).not.toContain(12)
      expect(gogma.every(position => position >= 10 && position <= 14)).toBe(true)
    }
  }, 30_000)

  it('gates on any component above its limit, accepts the limit itself, and needs every limit stated', () => {
    const scale: PredictedSearchScale = { conversionPositions: 2, gogmaLegalWidth: 5, skillLegalWidth: 3, normalForgeCount: 1 }
    const exact = { maxConversionPositions: 2, maxGogmaLegalWidth: 5, maxSkillLegalWidth: 3, maxNormalForgeCount: 1 }
    expect(exceededSearchScaleGate(scale, exact)).toEqual([])
    expect(exceededSearchScaleGate(scale, { ...exact, maxConversionPositions: 1, maxNormalForgeCount: 0 })).toEqual(['conversionPositions', 'normalForgeCount'])
    expect(isValidSearchScaleGate(exact)).toBe(true)
    expect(isValidSearchScaleGate({ ...exact, maxGogmaLegalWidth: 0 })).toBe(true)
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(isValidSearchScaleGate({ ...exact, maxSkillLegalWidth: bad })).toBe(false)
    expect(isValidSearchScaleGate({ maxConversionPositions: 1 } as never)).toBe(false)
  })
})

describe('Phase D-0A method choice (design 9.3)', () => {
  const scale = (conversionPositions: number, skillLegalWidth: number, gogmaLegalWidth: number, normalForgeCount = 0): PredictedSearchScale => ({ conversionPositions, skillLegalWidth, gogmaLegalWidth, normalForgeCount })

  it('calls a scale smaller only when it is no larger everywhere and smaller somewhere', () => {
    expect(isSmallerSearchScale(scale(0, 0, 3), scale(0, 1, 3))).toBe(true)
    expect(isSmallerSearchScale(scale(0, 1, 3), scale(0, 1, 3))).toBe(false)
    // Incomparable: neither is smaller.
    expect(isSmallerSearchScale(scale(0, 0, 4), scale(0, 1, 3))).toBe(false)
    expect(isSmallerSearchScale(scale(0, 1, 3), scale(0, 0, 4))).toBe(false)
  })

  it('orders the methods by continuity, route base and the Pareto rule, a tie going to the projected Search', async () => {
    const { shape } = await scenarioHeldCrossing()
    const a = shape.a!
    const c = shape.c!
    expect(selectMaterializationMethods(c, shapeOwnPositions(c), scale(0, 1, 4), null)).toMatchObject({ continuous: false, rule: 'non_continuous_planner_alternative_only', order: ['planner_alternative_reservation'] })
    const own = shapeOwnPositions(a)
    expect(selectMaterializationMethods(a, own, scale(0, 1, 3), scale(0, 1, 1))).toMatchObject({ rule: 'continuous_owned_gogma_projected_first', order: ['candidate_search_projected', 'planner_alternative_reservation'] })
    expect(selectMaterializationMethods(a, own, scale(0, 1, 1), scale(0, 1, 1)).rule).toBe('continuous_owned_gogma_projected_first')
    expect(selectMaterializationMethods(a, own, scale(0, 0, 2), scale(0, 1, 1)).rule).toBe('continuous_owned_gogma_projected_first')
    expect(selectMaterializationMethods(a, own, scale(0, 0, 1), scale(0, 1, 1))).toMatchObject({ rule: 'continuous_owned_gogma_planner_alternative_first', order: ['planner_alternative_reservation', 'candidate_search_projected'] })
    // A conversion Target tries the projected Search first whatever the scales.
    const { shape: dependency } = await scenarioSkillDependency()
    const b = dependency.b!
    expect(selectMaterializationMethods(b, shapeOwnPositions(b), scale(1, 1, 1), scale(1, 2, 2))).toMatchObject({ rule: 'continuous_conversion_projected_first', order: ['candidate_search_projected', 'planner_alternative_reservation'] })
  }, 30_000)
})

async function deliverAll(request: PlannerAlternativeMaterializationRequest, scene: Awaited<ReturnType<typeof scenarioHeldCrossing>>['scene']): Promise<PlannerAlternativeCandidate[]> {
  const all: PlannerAlternativeCandidate[] = []
  await productionMaterializationSearchPort.visitPlannerAlternativeCandidates(
    { origin: createPlannerStartSearchOrigin(scene.input), targetWeaponId: request.targetWeaponId, extent: request.extent, reservation: request.reservation, excludedRouteKeys: [] },
    scene.engine,
    value => { all.push(value); return 'continue' },
  )
  return all
}
