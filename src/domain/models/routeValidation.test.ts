import { describe, expect, it } from 'vitest'
import type { BuildRoute } from './publicTypes'
import { validateBuildRoute } from './validation'
import {
  createRestorationBonusSet,
  createValidBuildCandidate,
  createValidOwnedWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'

function normalRoute(): BuildRoute {
  return createValidBuildCandidate().route
}

function ownedNormalRoute(): BuildRoute {
  const sourceId = ownedWeaponId('owned.fixture.normal')
  return {
    kind: 'owned_normal_artian_to_gogma',
    sourceOwnedWeaponId: sourceId,
    operations: [
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore: 1,
        skillCounterAfter: 2,
      },
      {
        type: 'reset_skills',
        sourceOwnedWeaponId: null,
        skillCounterBefore: 1,
        skillCounterAfter: 2,
      },
    ],
  }
}

function resetSkillsRoute(): BuildRoute {
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

describe('BuildRoute validation', () => {
  it('requires normal_artian_to_gogma sourceOwnedWeaponId to be null', () => {
    const route = normalRoute()
    route.sourceOwnedWeaponId = ownedWeaponId('owned.fixture.a')
    expect(validateBuildRoute(route).isValid).toBe(false)
  })

  it('rejects Keep Bonuses before the first Reset inside a normal route', () => {
    const route = normalRoute()
    route.operations.push({
      type: 'keep_bonuses',
      sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
      gogmaCounterBefore: 1,
      gogmaCounterAfter: 2,
    })
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_route_operation' }),
    )
  })

  it('allows Reset then Keep on a converted normal route', () => {
    const route = normalRoute()
    route.operations.push(
      {
        type: 'reset_bonuses',
        sourceOwnedWeaponId: null,
        gogmaCounterBefore: 1,
        gogmaCounterAfter: 2,
      },
      {
        type: 'keep_bonuses',
        sourceOwnedWeaponId: null,
        gogmaCounterBefore: 2,
        gogmaCounterAfter: 3,
      },
    )
    expect(validateBuildRoute(route).isValid).toBe(true)
  })

  it('allows a normal-route Reset Skills operation with null source', () => {
    expect(validateBuildRoute(normalRoute()).isValid).toBe(true)
  })

  it('rejects an unknown RouteOperation instead of treating it as material use', () => {
    const route = normalRoute()
    route.operations.push({ type: 'unknown_operation' } as never)
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({
        path: 'operations[3].type',
        code: 'invalid_literal',
      }),
    )
  })

  it('requires existing_gogma_reset_skills to have a source', () => {
    const route = resetSkillsRoute()
    route.sourceOwnedWeaponId = null
    expect(validateBuildRoute(route).isValid).toBe(false)
  })

  it('requires Reset Skills source to equal the route source', () => {
    const route = resetSkillsRoute()
    const operation = route.operations[0]
    if (operation.type === 'reset_skills') {
      operation.sourceOwnedWeaponId = ownedWeaponId('owned.fixture.other')
    }
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_reference' }),
    )
  })

  it('rejects Reset Bonuses in existing_gogma_reset_skills', () => {
    const route = resetSkillsRoute()
    route.operations.push({
      type: 'reset_bonuses',
      sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
      gogmaCounterBefore: 1,
      gogmaCounterAfter: 2,
    })
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_route_operation' }),
    )
  })

  it('allows a protected existing weapon for Reset Skills only', () => {
    const weapon = createValidOwnedWeapon()
    expect(weapon.isProtected).toBe(true)
    expect(validateBuildRoute(resetSkillsRoute(), [weapon]).isValid).toBe(true)
  })

  it('rejects protected weapons in destructive operations', () => {
    const weapon = createValidOwnedWeapon()
    const route: BuildRoute = {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: weapon.id,
      operations: [
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: weapon.id,
          gogmaCounterBefore: 1,
          gogmaCounterAfter: 2,
        },
      ],
    }
    expect(validateBuildRoute(route, [weapon]).issues).toContainEqual(
      expect.objectContaining({ code: 'protected_destructive_use' }),
    )
  })

  it('accepts an unprotected owned Normal conversion without create operation', () => {
    const source = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.fixture.normal')),
      kind: 'normal' as const,
      rarity: 8 as const,
      restorationBonuses: createRestorationBonusSet(),
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }
    const validation = validateBuildRoute(ownedNormalRoute(), [source])
    expect(validation.isValid).toBe(true)
    expect(ownedNormalRoute().operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create_normal_artian' }),
      ]),
    )
  })

  it('rejects protected or non-Normal sources for owned Normal conversion', () => {
    const source = createValidOwnedWeapon(ownedWeaponId('owned.fixture.normal'))
    expect(validateBuildRoute(ownedNormalRoute(), [source]).isValid).toBe(false)
    const protectedNormal = {
      ...source,
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: true,
    }
    expect(
      validateBuildRoute(ownedNormalRoute(), [protectedNormal]).issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'protected_destructive_use' }),
    )
  })
})
