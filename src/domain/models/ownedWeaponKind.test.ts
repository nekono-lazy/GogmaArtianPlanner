import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../master/loadMasterData'
import { validateOwnedWeaponMasterReferences } from '../master/entityMasterValidation'
import {
  createOwnedWeapon,
  validateOwnedWeapon,
  type OwnedGogmaArtianWeapon,
  type OwnedNormalArtianWeapon,
  type OwnedWeapon,
} from './publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  ownedWeaponId,
} from '../../test/fixtures/domainData'

function normalWeapon(): OwnedNormalArtianWeapon {
  return {
    id: ownedWeaponId('owned.normal.fixture'),
    kind: 'normal',
    rarity: 8,
    name: '通常fixture',
    weaponTypeId: 'weapon.great_sword',
    elementId: 'element.thunder',
    restorationBonuses: Array.from({ length: 5 }, () => ({
      bonusTypeId: 'bonus_type.attack',
      bonusRankId: 'bonus_rank.base',
    })) as OwnedNormalArtianWeapon['restorationBonuses'],
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    relatedTargetWeaponIds: [],
    memo: null,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

function gogmaWeapon(): OwnedGogmaArtianWeapon {
  const { rarity: _rarity, ...normal } = normalWeapon()
  void _rarity
  return {
    ...normal,
    id: ownedWeaponId('owned.gogma.fixture'),
    kind: 'gogma',
    restorationBonuses: Array.from({ length: 5 }, () => ({
      bonusTypeId: 'bonus_type.attack',
      bonusRankId: 'bonus_rank.i',
    })) as OwnedGogmaArtianWeapon['restorationBonuses'],
    status: 'material',
  }
}

function verifiedMaster() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

describe('OwnedWeapon Artian kind', () => {
  it('accepts valid Normal and Gogma unions', () => {
    expect(validateOwnedWeapon(normalWeapon()).isValid).toBe(true)
    expect(validateOwnedWeapon(gogmaWeapon()).isValid).toBe(true)
  })

  it.each([6, 7])('rejects rarity %i owned Normal Artian weapons', (rarity) => {
    const invalid = { ...normalWeapon(), rarity }
    expect(validateOwnedWeapon(invalid as unknown as OwnedWeapon).isValid).toBe(false)
  })

  it.each([
    ['seriesSkillId', 'series_skill.gore_magala'],
    ['groupSkillId', 'group_skill.apex'],
    ['status', 'practical'],
  ] as const)('rejects Normal weapons with %s', (field, value) => {
    const invalid = { ...normalWeapon(), [field]: value }
    expect(
      validateOwnedWeapon(invalid as unknown as OwnedWeapon).isValid,
    ).toBe(false)
  })

  it('uses unprotected as the Normal creation default', () => {
    const {
      isProtected: _isProtected,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...input
    } = normalWeapon()
    void _isProtected
    void _createdAt
    void _updatedAt
    expect(createOwnedWeapon(input, DOMAIN_FIXTURE_TIME).isProtected).toBe(false)
    expect(
      createOwnedWeapon(
        { ...input, isProtected: true },
        DOMAIN_FIXTURE_TIME,
      ).isProtected,
    ).toBe(true)
  })

  it('rejects scope-incompatible bonuses through Master validation', () => {
    const normal = normalWeapon()
    normal.restorationBonuses[0] = {
      bonusTypeId: 'bonus_type.gogma_sharpness_capacity',
      bonusRankId: 'bonus_rank.base',
    }
    const gogma = gogmaWeapon()
    gogma.restorationBonuses[0] = {
      bonusTypeId: 'bonus_type.normal_sharpness',
      bonusRankId: 'bonus_rank.base',
    }
    expect(
      validateOwnedWeaponMasterReferences(normal, verifiedMaster()),
    ).not.toEqual([])
    expect(
      validateOwnedWeaponMasterReferences(gogma, verifiedMaster()),
    ).not.toEqual([])
  })

  it('rejects Element bonuses for element.none through Master validation', () => {
    const weapon = gogmaWeapon()
    weapon.elementId = 'element.none'
    weapon.restorationBonuses[0] = {
      bonusTypeId: 'bonus_type.element',
      bonusRankId: 'bonus_rank.i',
    }
    expect(
      validateOwnedWeaponMasterReferences(weapon, verifiedMaster()),
    ).not.toEqual([])
  })
})
