import { describe, expect, it } from 'vitest'
import { ownedWeaponId } from '../../../test/fixtures/domainData'
import { orchestrationEntry, orchestrationTarget } from '../../../test/fixtures/plannerConstrainedOrchestration'
import type { BuildListEntry, BuildRoute } from '../../models/publicTypes'
import type { RngEngine } from '../../rng/rngEngine'
import {
  derivePlannerAlternativeReservation,
  PlannerAlternativeReservationError,
} from './plannerAlternativeReservation'

/*
 * PLANNER_SPEC 9.2.19.3: the fixed Route set -> resource reservation, derived
 * from `createPlannerRouteUnitPlans()` and `collectReferencedOwnedWeaponIds()`
 * alone. Every Counter advances by one per unit, like the Production Engine.
 */

const engine = {
  advanceNormalCounter: (counter: number, operation: { count: number }) => counter + operation.count,
  advanceSkillCounter: (counter: number) => counter + 1,
  advanceGogmaCounter: (counter: number) => counter + 1,
} as unknown as RngEngine

const target = orchestrationTarget('target.reservation.fixed')
const SOURCE_GOGMA = ownedWeaponId('owned.reservation.gogma')
const SOURCE_NORMAL = ownedWeaponId('owned.reservation.normal')

function entry(id: string, route: BuildRoute): BuildListEntry {
  return orchestrationEntry(id, target, route)
}

/** Forges Normal 4..6 (6 = production target), converts at Skill 7, Resets at Gogma 10 and 11. */
function normalRouteEntry(id = 'build-list.reservation.normal'): BuildListEntry {
  return entry(id, {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      { type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.a', rarity: 8, count: 3, normalCounterBefore: 4, normalCounterAfter: 7 },
      { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 7, skillCounterAfter: 8 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 10, gogmaCounterAfter: 11 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 11, gogmaCounterAfter: 12 },
    ],
  })
}

/** An owned Gogma: Keep at 13, Keep at 14, Reset Skills at 9 and 10. */
function existingRouteEntry(id = 'build-list.reservation.existing'): BuildListEntry {
  return entry(id, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: SOURCE_GOGMA,
    operations: [
      { type: 'keep_bonuses', sourceOwnedWeaponId: SOURCE_GOGMA, gogmaCounterBefore: 13, gogmaCounterAfter: 14 },
      { type: 'keep_bonuses', sourceOwnedWeaponId: SOURCE_GOGMA, gogmaCounterBefore: 14, gogmaCounterAfter: 15 },
      { type: 'reset_skills', sourceOwnedWeaponId: SOURCE_GOGMA, skillCounterBefore: 9, skillCounterAfter: 10 },
      { type: 'reset_skills', sourceOwnedWeaponId: SOURCE_GOGMA, skillCounterBefore: 10, skillCounterAfter: 11 },
    ],
  })
}

function ownedNormalRouteEntry(): BuildListEntry {
  return entry('build-list.reservation.owned-normal', {
    kind: 'owned_normal_artian_to_gogma',
    sourceOwnedWeaponId: SOURCE_NORMAL,
    operations: [
      { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 12, skillCounterAfter: 13 },
    ],
  })
}

function blindRouteEntry(): BuildListEntry {
  return entry('build-list.reservation.blind', {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      { type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.a', rarity: 8, count: 1, normalCounterBefore: null, normalCounterAfter: null },
      { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 20, skillCounterAfter: 21 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 20, gogmaCounterAfter: 21 },
    ],
  })
}

describe('derivePlannerAlternativeReservation (PLANNER_SPEC 9.2.19.3)', () => {
  it('holds every fixed unit position and blocks only the required ones', () => {
    expect(derivePlannerAlternativeReservation([normalRouteEntry()], engine)).toEqual({
      // Counter-advance forges 4, 5 are held but not blocked; the production target 6 is both.
      normal: [{ counterId: 'weapon.fixture.a:8', held: [4, 5, 6], blocked: [6] }],
      skill: { held: [7], blocked: [7] },
      // The Reset at 10 is followed by a Reset, so it is skippable; the final Reset at 11 is required.
      gogma: { held: [10, 11], blocked: [11] },
      exclusiveOwnedWeaponIds: [],
    })
  })

  it('treats Keep then Keep and Reset Skills then Reset Skills as skippable, and reserves the owned source', () => {
    expect(derivePlannerAlternativeReservation([existingRouteEntry()], engine)).toEqual({
      normal: [],
      skill: { held: [9, 10], blocked: [10] },
      gogma: { held: [13, 14], blocked: [14] },
      exclusiveOwnedWeaponIds: [SOURCE_GOGMA],
    })
  })

  it('reserves an owned Normal a fixed conversion consumes, and nothing for a blind creation', () => {
    const owned = derivePlannerAlternativeReservation([ownedNormalRouteEntry()], engine)
    expect(owned.exclusiveOwnedWeaponIds).toEqual([SOURCE_NORMAL])
    expect(owned.skill).toEqual({ held: [12], blocked: [12] })
    const blind = derivePlannerAlternativeReservation([blindRouteEntry()], engine)
    expect(blind.normal).toEqual([])
    expect(blind.skill).toEqual({ held: [20], blocked: [20] })
  })

  it('keeps Normal Counters apart per counterId', () => {
    const other = normalRouteEntry('build-list.reservation.other')
    other.candidateSnapshot.route.operations[0] = {
      type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.b', rarity: 8, count: 1, normalCounterBefore: 0, normalCounterAfter: 1,
    }
    const reservation = derivePlannerAlternativeReservation([normalRouteEntry(), other], engine)
    expect(reservation.normal).toEqual([
      { counterId: 'weapon.fixture.a:8', held: [4, 5, 6], blocked: [6] },
      { counterId: 'weapon.fixture.b:8', held: [0], blocked: [0] },
    ])
  })

  it('is a semantic set: overlapping and repeated fixed Routes in any order give one value', () => {
    const forward = derivePlannerAlternativeReservation(
      [normalRouteEntry(), existingRouteEntry(), ownedNormalRouteEntry()],
      engine,
    )
    const reversed = derivePlannerAlternativeReservation(
      [ownedNormalRouteEntry(), existingRouteEntry(), normalRouteEntry(), normalRouteEntry()],
      engine,
    )
    expect(reversed).toEqual(forward)
    expect(forward.gogma).toEqual({ held: [10, 11, 13, 14], blocked: [11, 14] })
    expect(forward.exclusiveOwnedWeaponIds).toEqual([SOURCE_GOGMA, SOURCE_NORMAL].sort())
  })

  it('is empty without a fixed Route', () => {
    expect(derivePlannerAlternativeReservation([], engine)).toEqual({
      normal: [],
      skill: { held: [], blocked: [] },
      gogma: { held: [], blocked: [] },
      exclusiveOwnedWeaponIds: [],
    })
  })

  it('fails closed on a fixed Route without a unit plan and on two different Entries of one ID', () => {
    const rewinding = normalRouteEntry()
    rewinding.candidateSnapshot.route.operations[2] = {
      type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 10, gogmaCounterAfter: 9,
    }
    expect(() => derivePlannerAlternativeReservation([rewinding], engine))
      .toThrow(expect.objectContaining({ code: 'fixed_route_unplannable' }))
    const changed = normalRouteEntry()
    changed.candidateSnapshot.estimatedOperationCount += 1
    expect(() => derivePlannerAlternativeReservation([normalRouteEntry(), changed], engine))
      .toThrow(PlannerAlternativeReservationError)
  })
})
