import { describe, expect, it } from 'vitest'
import type { BuildRoute, NormalArtianCounter } from './publicTypes'
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

  it('hashes only the target weapon type rarity 8 Counter', () => {
    const route = createValidBuildCandidate().route
    const state = createValidRngState()
    const rarity8 = createValidNormalArtianCounter()
    const before = createSearchStateHash(route, state, [rarity8])
    const outOfScopeCounters = [6, 7].map((rarity) => ({
      ...rarity8,
      id: `${rarity8.weaponTypeId}:${rarity}`,
      rarity,
      counter: 999,
    }))
    expect(
      createSearchStateHash(route, state, [
        rarity8,
        ...(outOfScopeCounters as unknown as NormalArtianCounter[]),
      ]),
    ).toBe(before)
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

  it('hashes Normal bonus and protection but ignores its name', () => {
    const source = {
      ...createValidOwnedWeapon(),
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }
    const route: BuildRoute = {
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: source.id,
      operations: [
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: source.weaponTypeId,
          skillCounterBefore: 1,
          skillCounterAfter: 2,
        },
      ],
    }
    const before = createReferencedOwnedWeaponsHash(route, [source])
    source.name = '表示名だけ変更'
    expect(createReferencedOwnedWeaponsHash(route, [source])).toBe(before)
    source.isProtected = true
    expect(createReferencedOwnedWeaponsHash(route, [source])).not.toBe(before)
    source.isProtected = false
    source.restorationBonuses[0].bonusRankId = 'bonus_rank.fixture.changed'
    expect(createReferencedOwnedWeaponsHash(route, [source])).not.toBe(before)
  })

  it('changes when the referenced weapon kind changes', () => {
    const gogma = createValidOwnedWeapon()
    const route = referencedRoute()
    const before = createReferencedOwnedWeaponsHash(route, [gogma])
    const normal = {
      ...gogma,
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
    }
    expect(createReferencedOwnedWeaponsHash(route, [normal])).not.toBe(before)
  })
})

describe('ExpectedPlanState hashing', () => {
  it('keeps referenced-weapon hashing independent from Normal rarity', () => {
    const route = referencedRoute()
    const normal = {
      ...createValidOwnedWeapon(), kind: 'normal' as const, rarity: 8 as const,
      seriesSkillId: null, groupSkillId: null, status: null,
    }
    const alteredRarity = { ...normal, rarity: 7 as 8 }
    expect(createReferencedOwnedWeaponsHash(route, [alteredRarity])).toBe(
      createReferencedOwnedWeaponsHash(route, [normal]),
    )
  })

  it('includes Normal rarity only in ExpectedPlanState owned weapons', () => {
    const state = createValidRngState(); const counter = createValidNormalArtianCounter()
    const normal = { ...createValidOwnedWeapon(), kind: 'normal' as const, rarity: 8 as const, seriesSkillId: null, groupSkillId: null, status: null }
    const alteredRarity = { ...normal, rarity: 7 as 8 }
    expect(createExpectedPlanState(state, [counter], [alteredRarity]).ownedWeaponsHash)
      .not.toBe(createExpectedPlanState(state, [counter], [normal]).ownedWeaponsHash)
  })

  it('includes related Targets only in ExpectedPlanState', () => {
    const state = createValidRngState(); const counter = createValidNormalArtianCounter(); const route = referencedRoute()
    const weapon = createValidOwnedWeapon()
    const changed = { ...weapon, relatedTargetWeaponIds: ['target.changed' as never] }
    expect(createExpectedPlanState(state, [counter], [changed]).ownedWeaponsHash)
      .not.toBe(createExpectedPlanState(state, [counter], [weapon]).ownedWeaponsHash)
    expect(createReferencedOwnedWeaponsHash(route, [changed])).toBe(
      createReferencedOwnedWeaponsHash(route, [weapon]),
    )
  })

  it('excludes name, memo, and timestamps from both weapon hash contracts', () => {
    const state = createValidRngState(); const counter = createValidNormalArtianCounter(); const route = referencedRoute(); const weapon = createValidOwnedWeapon()
    const changed = { ...weapon, name: 'Renamed', memo: 'Changed', createdAt: '2027-01-01T00:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z' }
    expect(createExpectedPlanState(state, [counter], [changed])).toEqual(createExpectedPlanState(state, [counter], [weapon]))
    expect(createReferencedOwnedWeaponsHash(route, [changed])).toBe(createReferencedOwnedWeaponsHash(route, [weapon]))
  })

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

  it('includes kind while excluding OwnedWeapon name and memo', () => {
    const state = createValidRngState()
    const counter = createValidNormalArtianCounter()
    const gogma = createValidOwnedWeapon()
    const before = createExpectedPlanState(state, [counter], [gogma])

    gogma.name = '表示名だけ変更'
    gogma.memo = 'メモだけ変更'
    expect(createExpectedPlanState(state, [counter], [gogma])).toEqual(before)

    const normal = {
      ...gogma,
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
    }
    expect(createExpectedPlanState(state, [counter], [normal])).not.toEqual(
      before,
    )
  })
})
