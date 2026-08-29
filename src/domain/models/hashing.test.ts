import { describe, expect, it } from 'vitest'
import type { BuildRoute } from './publicTypes'
import {
  createExpectedPlanState,
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
  hashStableValue,
  stableStringify,
} from './hashing'
import {
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  ownedWeaponId,
} from '../../test/fixtures/domainData'

function referencedRoute(): BuildRoute {
  const sourceId = ownedWeaponId('owned.fixture.a')
  return {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: sourceId,
    operations: [
      {
        type: 'reset_skills',
        sourceOwnedWeaponId: sourceId,
        skillCounterBefore: 1,
        skillCounterAfter: 2,
      },
    ],
  }
}

describe('stable hashing', () => {
  it('produces the same serialization and hash for the same meaning', () => {
    const left = { z: [2, 1], a: { y: true, x: null } }
    const right = { a: { x: null, y: true }, z: [2, 1] }
    expect(stableStringify(left)).toBe(stableStringify(right))
    expect(hashStableValue(left)).toBe(hashStableValue(right))
  })
})

describe('searchStateHash', () => {
  it('is unchanged by RNG source-only changes', () => {
    const route = createValidBuildCandidate().route
    const state = createValidRngState()
    const counters = [createValidNormalArtianCounter()]
    const before = createSearchStateHash(route, state, counters)
    state.baseSeed.source = 'observation'
    state.gogmaCounter.source = 'manual'
    expect(createSearchStateHash(route, state, counters)).toBe(before)
  })

  it('is unchanged by RNG notes-only changes', () => {
    const route = createValidBuildCandidate().route
    const state = createValidRngState()
    const counters = [createValidNormalArtianCounter()]
    const before = createSearchStateHash(route, state, counters)
    state.notes = 'Changed display-only note.'
    expect(createSearchStateHash(route, state, counters)).toBe(before)
  })

  it('changes when the relevant NormalArtianCounter changes', () => {
    const route = createValidBuildCandidate().route
    const state = createValidRngState()
    const counter = createValidNormalArtianCounter()
    const before = createSearchStateHash(route, state, [counter])
    counter.counter = 5
    expect(createSearchStateHash(route, state, [counter])).not.toBe(before)
  })
})

describe('referencedOwnedWeaponsHash', () => {
  it('returns null for a route without OwnedWeapon references', () => {
    expect(
      createReferencedOwnedWeaponsHash(createValidBuildCandidate().route, [
        createValidOwnedWeapon(),
      ]),
    ).toBeNull()
  })

  it('ignores changes to unrelated OwnedWeapons', () => {
    const route = referencedRoute()
    const source = createValidOwnedWeapon()
    const unrelated = createValidOwnedWeapon(ownedWeaponId('owned.fixture.b'))
    const before = createReferencedOwnedWeaponsHash(route, [source, unrelated])
    unrelated.status = 'ideal'
    unrelated.restorationBonuses[0].bonusRankId = 'bonus_rank.fixture.changed'
    expect(createReferencedOwnedWeaponsHash(route, [source, unrelated])).toBe(before)
  })

  it('changes when a referenced bonus changes', () => {
    const route = referencedRoute()
    const source = createValidOwnedWeapon()
    const before = createReferencedOwnedWeaponsHash(route, [source])
    source.restorationBonuses[0].bonusRankId = 'bonus_rank.fixture.changed'
    expect(createReferencedOwnedWeaponsHash(route, [source])).not.toBe(before)
  })

  it('changes when a referenced status changes', () => {
    const route = referencedRoute()
    const source = createValidOwnedWeapon()
    const before = createReferencedOwnedWeaponsHash(route, [source])
    source.status = 'ideal'
    expect(createReferencedOwnedWeaponsHash(route, [source])).not.toBe(before)
  })

  it('ignores referenced name, memo, and timestamps', () => {
    const route = referencedRoute()
    const source = createValidOwnedWeapon()
    const before = createReferencedOwnedWeaponsHash(route, [source])
    source.name = 'Renamed'
    source.memo = 'Changed memo'
    source.updatedAt = '2026-08-30T00:00:00.000Z'
    expect(createReferencedOwnedWeaponsHash(route, [source])).toBe(before)
  })

  it('does not depend on OwnedWeapon input order', () => {
    const sourceA = createValidOwnedWeapon()
    const sourceB = createValidOwnedWeapon(ownedWeaponId('owned.fixture.b'))
    const route = referencedRoute()
    route.operations.push({
      type: 'use_weapon_as_material',
      ownedWeaponId: sourceB.id,
    })
    expect(createReferencedOwnedWeaponsHash(route, [sourceA, sourceB])).toBe(
      createReferencedOwnedWeaponsHash(route, [sourceB, sourceA]),
    )
  })

  it('preserves stored restoration bonus slot order', () => {
    const route = referencedRoute()
    const source = createValidOwnedWeapon()
    const before = createReferencedOwnedWeaponsHash(route, [source])
    ;[source.restorationBonuses[0], source.restorationBonuses[2]] = [
      source.restorationBonuses[2],
      source.restorationBonuses[0],
    ]
    expect(createReferencedOwnedWeaponsHash(route, [source])).not.toBe(before)
  })
})

describe('ExpectedPlanState hashing', () => {
  it('excludes notes and timestamps while retaining semantic state', () => {
    const state = createValidRngState()
    const counter = createValidNormalArtianCounter()
    const weapon = createValidOwnedWeapon()
    const before = createExpectedPlanState(state, [counter], [weapon])
    state.notes = 'Changed'
    state.updatedAt = '2026-08-30T00:00:00.000Z'
    counter.lastObservedAt = null
    weapon.memo = 'Changed'
    weapon.updatedAt = '2026-08-30T00:00:00.000Z'
    expect(createExpectedPlanState(state, [counter], [weapon])).toEqual(before)
  })
})
