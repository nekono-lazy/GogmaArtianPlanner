import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { DOMAIN_FIXTURE_TIME, ownedWeaponId, targetWeaponId } from '../../test/fixtures/domainData'
import {
  validateOwnedWeaponMasterReferences,
  validateTargetWeaponMasterReferences,
} from '../artian/entityMasterValidation'
import { isProductionAvailableBonus } from '../artian/productionBonusAvailability'
import { loadMasterData } from '../master/loadMasterData'
import { getEnabledElements, getEnabledWeaponTypes } from '../master/masterSelectors'
import type { MasterDataRoot } from '../master/masterTypes'
import { createOwnedWeapon, createTargetWeapon } from '../models/factories'
import {
  createDefaultBonusSet,
  createOwnedWeaponDraft,
  createTargetWeaponDraft,
  MasterOptionsUnavailableError,
} from './entityDrafts'

function verifiedMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

const master = verifiedMaster()

describe('new entity drafts', () => {
  it.each(['gogma', 'normal'] as const)('creates a %s Owned Weapon draft that already passes save validation', (kind) => {
    const draft = createOwnedWeaponDraft(master, kind)
    // The default weapon type / element selection is unchanged.
    expect(draft.weaponTypeId).toBe('weapon.great_sword')
    expect(draft.elementId).toBe('element.none')
    const weapon = createOwnedWeapon({ ...draft, id: ownedWeaponId('owned.draft') }, DOMAIN_FIXTURE_TIME)
    expect(validateOwnedWeaponMasterReferences(weapon, master)).toEqual([])
  })

  it('creates a Target draft that already passes save validation', () => {
    const draft = createTargetWeaponDraft(master)
    expect(draft.weaponTypeId).toBe('weapon.great_sword')
    expect(draft.elementId).toBe('element.none')
    const target = createTargetWeapon({ ...draft, id: targetWeaponId('target.draft') }, DOMAIN_FIXTURE_TIME)
    expect(validateTargetWeaponMasterReferences(target, master)).toEqual([])
  })

  it('seeds every weapon type x element x scope inside Production availability', () => {
    for (const { id: weaponTypeId } of getEnabledWeaponTypes(master)) {
      for (const { id: elementId } of getEnabledElements(master)) {
        for (const scope of ['normal_artian', 'gogma_artian'] as const) {
          const bonuses = createDefaultBonusSet(master, weaponTypeId, elementId, scope)
          for (const bonus of bonuses) {
            expect(
              isProductionAvailableBonus(master, weaponTypeId, elementId, scope, bonus),
              `${weaponTypeId} / ${elementId} / ${scope}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('does not fall back to Master-only definitions when Production availability cannot be decided', () => {
    const fixture = createValidMasterDataFixture()
    expect(() => createDefaultBonusSet(fixture, 'weapon.fixture.a', 'element.fixture.a')).toThrow(MasterOptionsUnavailableError)
    expect(() => createOwnedWeaponDraft(fixture)).toThrow(MasterOptionsUnavailableError)
    expect(() => createTargetWeaponDraft(fixture)).toThrow(MasterOptionsUnavailableError)
  })
})
