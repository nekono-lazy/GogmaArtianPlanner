import { describe, expect, it } from 'vitest'
import { createValidOwnedWeapon } from '../../test/fixtures/domainData'
import { normalizeOwnedWeaponRestorationBonusScope } from './persistenceCompatibility'
import { validateOwnedWeapon } from './validation'

describe('OwnedWeapon persistence compatibility', () => {
  it.each([
    ['normal', 'normal_artian'],
    ['gogma', 'gogma_artian'],
  ] as const)('fills missing %s scope at the read/import boundary', (kind, scope) => {
    const weapon = createValidOwnedWeapon()
    const legacy = { ...weapon, kind }
    if (kind === 'normal') {
      Object.assign(legacy, {
        rarity: 8,
        seriesSkillId: null,
        groupSkillId: null,
        status: null,
      })
    }
    delete (legacy as { restorationBonusScope?: unknown }).restorationBonusScope

    expect(normalizeOwnedWeaponRestorationBonusScope(legacy).restorationBonusScope).toBe(scope)
  })

  it.each(['normal_artian', 'gogma_artian'] as const)(
    'preserves explicit %s scope',
    (scope) => {
      const weapon = { ...createValidOwnedWeapon(), restorationBonusScope: scope }
      expect(normalizeOwnedWeaponRestorationBonusScope(weapon).restorationBonusScope).toBe(scope)
    },
  )

  it('rejects invalid explicit scope in the current Domain entity', () => {
    const weapon = {
      ...createValidOwnedWeapon(),
      restorationBonusScope: 'invalid_scope',
    }
    expect(validateOwnedWeapon(weapon as never).isValid).toBe(false)
  })
})
