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

  it('rejects a protected existing weapon for Reset Skills', () => {
    const weapon = createValidOwnedWeapon()
    expect(weapon.isProtected).toBe(true)
    expect(validateBuildRoute(resetSkillsRoute(), [weapon]).issues).toContainEqual(
      expect.objectContaining({ code: 'protected_destructive_use' }),
    )
  })

  it('allows an unprotected existing weapon for Reset Skills', () => {
    const weapon = { ...createValidOwnedWeapon(), isProtected: false }
    expect(validateBuildRoute(resetSkillsRoute(), [weapon]).isValid).toBe(true)
  })

  it('accepts only an empty zero-operation current route', () => {
    const weapon = createValidOwnedWeapon()
    const route: BuildRoute = {
      kind: 'existing_gogma_current',
      sourceOwnedWeaponId: weapon.id,
      operations: [],
    }
    expect(validateBuildRoute(route, [weapon]).isValid).toBe(true)
    route.operations.push(resetSkillsRoute().operations[0])
    expect(validateBuildRoute(route, [weapon]).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_route_operation' }),
    )
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

describe('Existing Gogma route-local bonus scope', () => {
  const sourceId = ownedWeaponId('owned.fixture.inherited')

  function inheritedSource(overrides: Record<string, unknown> = {}) {
    return {
      ...createValidOwnedWeapon(sourceId),
      restorationBonusScope: 'normal_artian' as const,
      isProtected: false,
      ...overrides,
    }
  }

  function amendmentRoute(
    kind: BuildRoute['kind'],
    types: Array<'reset_bonuses' | 'keep_bonuses'>,
  ): BuildRoute {
    return {
      kind,
      sourceOwnedWeaponId: sourceId,
      operations: types.map((type, index) => ({
        type,
        sourceOwnedWeaponId: sourceId,
        gogmaCounterBefore: 10 + index,
        gogmaCounterAfter: 11 + index,
      })),
    }
  }

  it('accepts Reset Bonuses followed by Keep Bonuses from an inherited normal scope', () => {
    // AGENTS.md Existing Gogma Mixed: the Reset moves the route-local scope to
    // gogma_artian, so the following Keep reads Gogma-tier current bonuses.
    const validation = validateBuildRoute(
      amendmentRoute('existing_gogma_mixed', ['reset_bonuses', 'keep_bonuses']),
      [inheritedSource()],
    )
    expect(validation.issues).toEqual([])
    expect(validation.isValid).toBe(true)
  })

  it('rejects Keep Bonuses as the first amendment of an inherited normal scope', () => {
    const validation = validateBuildRoute(
      amendmentRoute('existing_gogma_keep_bonuses', ['keep_bonuses']),
      [inheritedSource()],
    )
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: 'protected_destructive_use' }),
    )
    // The reason is missing Production Keep prediction support, not a game rule.
    expect(validation.issues[0].message).toMatch(/Keep prediction/)
  })

  it('rejects Reset Bonuses followed by Keep Bonuses on a protected source', () => {
    const validation = validateBuildRoute(
      amendmentRoute('existing_gogma_mixed', ['reset_bonuses', 'keep_bonuses']),
      [inheritedSource({ isProtected: true })],
    )
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: 'protected_destructive_use' }),
    )
  })

  it('still accepts Keep Bonuses directly from a gogma scope source', () => {
    const validation = validateBuildRoute(
      amendmentRoute('existing_gogma_keep_bonuses', ['keep_bonuses']),
      [inheritedSource({ restorationBonusScope: 'gogma_artian' })],
    )
    expect(validation.isValid).toBe(true)
  })

  it('does not let Reset Skills change the route-local bonus scope', () => {
    const route = amendmentRoute('existing_gogma_mixed', ['keep_bonuses'])
    route.operations.unshift({
      type: 'reset_skills',
      sourceOwnedWeaponId: sourceId,
      skillCounterBefore: 7,
      skillCounterAfter: 8,
    })
    expect(validateBuildRoute(route, [inheritedSource()]).isValid).toBe(false)
  })
})

describe('blind Normal Artian route validation', () => {
  function blindRoute(): BuildRoute {
    return {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        {
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 1,
          normalCounterBefore: null,
          normalCounterAfter: null,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        },
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: null,
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        },
      ],
    }
  }

  it('accepts create, convert, and a forced Reset Bonuses', () => {
    expect(validateBuildRoute(blindRoute()).isValid).toBe(true)
  })

  it('accepts Keep Bonuses and Reset Skills after the forced Reset', () => {
    const route = blindRoute()
    route.operations.push(
      {
        type: 'keep_bonuses',
        sourceOwnedWeaponId: null,
        gogmaCounterBefore: 11,
        gogmaCounterAfter: 12,
      },
      {
        type: 'reset_skills',
        sourceOwnedWeaponId: null,
        skillCounterBefore: 8,
        skillCounterAfter: 9,
      },
    )
    expect(validateBuildRoute(route).isValid).toBe(true)
  })

  it('rejects a route that completes right after the conversion', () => {
    const route = blindRoute()
    route.operations = route.operations.slice(0, 2)
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_route_operation' }),
    )
  })

  it('rejects Keep Bonuses as the first bonus amendment', () => {
    const route = blindRoute()
    route.operations[2] = {
      type: 'keep_bonuses',
      sourceOwnedWeaponId: null,
      gogmaCounterBefore: 10,
      gogmaCounterAfter: 11,
    }
    expect(validateBuildRoute(route).isValid).toBe(false)
  })

  it('rejects a Reset Skills only route', () => {
    const route = blindRoute()
    route.operations[2] = {
      type: 'reset_skills',
      sourceOwnedWeaponId: null,
      skillCounterBefore: 8,
      skillCounterAfter: 9,
    }
    expect(validateBuildRoute(route).isValid).toBe(false)
  })

  it('rejects more than one Normal Artian creation', () => {
    const route = blindRoute()
    route.operations.unshift(structuredClone(route.operations[0]))
    expect(validateBuildRoute(route).isValid).toBe(false)
  })

  it('rejects a blind creation whose count is not one', () => {
    const route = blindRoute()
    const create = route.operations[0]
    if (create.type !== 'create_normal_artian') throw new Error('fixture')
    route.operations[0] = { ...create, count: 2 } as typeof create
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ path: 'operations[0].count' }),
    )
  })

  it('rejects a half-filled Normal Counter pair', () => {
    const route = blindRoute()
    const create = route.operations[0]
    if (create.type !== 'create_normal_artian') throw new Error('fixture')
    route.operations[0] = { ...create, normalCounterAfter: 5 } as typeof create
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ path: 'operations[0].normalCounterBefore' }),
    )
  })

  it('leaves the predicted Normal route contract unchanged', () => {
    const route = normalRoute()
    expect(validateBuildRoute(route).isValid).toBe(true)
    expect(route.operations[0]).toEqual(
      expect.objectContaining({ normalCounterBefore: 4, normalCounterAfter: 5 }),
    )
  })
})
