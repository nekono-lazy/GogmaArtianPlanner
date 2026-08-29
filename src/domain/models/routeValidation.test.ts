import { describe, expect, it } from 'vitest'
import type { BuildRoute } from './publicTypes'
import { validateBuildRoute } from './validation'
import {
  createValidBuildCandidate,
  createValidOwnedWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'

function normalRoute(): BuildRoute {
  return createValidBuildCandidate().route
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

  it('rejects Keep Bonuses inside a normal route', () => {
    const route = normalRoute()
    route.operations.push({
      type: 'keep_bonuses',
      sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
      selection: { mode: 'engine_defined', engineParameters: {} },
      gogmaCounterBefore: 1,
      gogmaCounterAfter: 2,
    })
    expect(validateBuildRoute(route).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_route_operation' }),
    )
  })

  it('allows a normal-route Reset Skills operation with null source', () => {
    expect(validateBuildRoute(normalRoute()).isValid).toBe(true)
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
})
