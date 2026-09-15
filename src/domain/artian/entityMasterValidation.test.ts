import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { createValidOwnedWeapon, createValidTargetWeapon } from '../../test/fixtures/domainData'
import { loadMasterData } from '../master/loadMasterData'
import type { MasterDataRoot } from '../master/masterTypes'
import type {
  OwnedWeapon,
  RestorationBonus,
  RestorationBonusScope,
  RestorationBonusSet,
  TargetWeapon,
} from '../models/publicTypes'
import {
  validateOwnedWeaponMasterReferences,
  validateTargetWeaponMasterReferences,
} from './entityMasterValidation'

function verifiedMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

const master = verifiedMaster()
const OUTSIDE_PRODUCTION = /Productionで抽選されない/

const NORMAL_ATTACK: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' }
const NORMAL_ELEMENT: RestorationBonus = { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.base' }
const GOGMA_ATTACK: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }
const GOGMA_ELEMENT: RestorationBonus = { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' }

function firstThenRest(first: RestorationBonus, rest: RestorationBonus): RestorationBonusSet {
  return [{ ...first }, { ...rest }, { ...rest }, { ...rest }, { ...rest }]
}

function normalWeapon(weaponTypeId: string, elementId: string, bonuses: RestorationBonusSet): OwnedWeapon {
  return {
    ...createValidOwnedWeapon(),
    kind: 'normal',
    rarity: 8,
    status: null,
    weaponTypeId,
    elementId,
    restorationBonusScope: 'normal_artian',
    restorationBonuses: bonuses,
    seriesSkillId: null,
    groupSkillId: null,
  } as OwnedWeapon
}

function gogmaWeapon(
  weaponTypeId: string,
  elementId: string,
  scope: RestorationBonusScope,
  bonuses: RestorationBonusSet,
): OwnedWeapon {
  return {
    ...createValidOwnedWeapon(),
    kind: 'gogma',
    weaponTypeId,
    elementId,
    restorationBonusScope: scope,
    restorationBonuses: bonuses,
    seriesSkillId: null,
    groupSkillId: null,
  } as OwnedWeapon
}

function target(weaponTypeId: string, elementId: string, overrides: Partial<TargetWeapon> = {}): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    weaponTypeId,
    elementId,
    preferredOwnedWeaponId: null,
    idealBonuses: firstThenRest(GOGMA_ATTACK, GOGMA_ATTACK),
    practicalBonusConditions: [],
    alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    ...overrides,
  }
}

describe('Owned Weapon entity validation against Production bonus availability', () => {
  it('accepts Element on Switch Axe element.none in normal and gogma scopes', () => {
    expect(validateOwnedWeaponMasterReferences(
      normalWeapon('weapon.switch_axe', 'element.none', firstThenRest(NORMAL_ELEMENT, NORMAL_ATTACK)), master,
    )).toEqual([])
    expect(validateOwnedWeaponMasterReferences(
      gogmaWeapon('weapon.switch_axe', 'element.none', 'normal_artian', firstThenRest(NORMAL_ELEMENT, NORMAL_ATTACK)), master,
    )).toEqual([])
    expect(validateOwnedWeaponMasterReferences(
      gogmaWeapon('weapon.switch_axe', 'element.none', 'gogma_artian', firstThenRest(GOGMA_ELEMENT, GOGMA_ATTACK)), master,
    )).toEqual([])
  })

  it.each(['element.poison', 'element.paralysis', 'element.sleep'])(
    'rejects Element on Bow %s in normal and gogma scopes with a Production availability message',
    (elementId) => {
      const cases = [
        normalWeapon('weapon.bow', elementId, firstThenRest(NORMAL_ELEMENT, NORMAL_ATTACK)),
        gogmaWeapon('weapon.bow', elementId, 'normal_artian', firstThenRest(NORMAL_ELEMENT, NORMAL_ATTACK)),
        gogmaWeapon('weapon.bow', elementId, 'gogma_artian', firstThenRest(GOGMA_ELEMENT, GOGMA_ATTACK)),
      ]
      for (const weapon of cases) {
        const issues = validateOwnedWeaponMasterReferences(weapon, master)
        expect(issues).toHaveLength(1)
        expect(issues[0]).toMatch(/^restorationBonuses\[0\]: /)
        expect(issues[0]).toMatch(OUTSIDE_PRODUCTION)
      }
    },
  )

  it('still accepts Element on Bow Table A', () => {
    expect(validateOwnedWeaponMasterReferences(
      gogmaWeapon('weapon.bow', 'element.fire', 'gogma_artian', firstThenRest(GOGMA_ELEMENT, GOGMA_ATTACK)), master,
    )).toEqual([])
  })

  it('refuses to save a weapon whose Production availability cannot be decided', () => {
    const fixture = createValidMasterDataFixture()
    const bonusIssues = validateOwnedWeaponMasterReferences(createValidOwnedWeapon(), fixture)
      .filter((issue) => issue.startsWith('restorationBonuses['))
    // No Master-only fallback: every slot is refused, none is accepted.
    expect(bonusIssues).toHaveLength(5)
    expect(bonusIssues.every((issue) => issue.includes('判定できない'))).toBe(true)
  })
})

describe('Target Weapon entity validation against Production bonus availability', () => {
  it('accepts Element ideal, practical, and alternative bonuses on Switch Axe element.none', () => {
    const value = target('weapon.switch_axe', 'element.none', {
      idealBonuses: firstThenRest(GOGMA_ELEMENT, GOGMA_ATTACK),
      practicalBonusConditions: [{ id: 'practical', bonusTypeId: 'bonus_type.element', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }],
      alternativeBonusRules: [{
        id: 'alternative',
        sourceBonusTypeId: 'bonus_type.attack',
        maxReplacementCount: 1,
        options: [{ alternativeBonusTypeId: 'bonus_type.element', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }],
      }],
    })
    expect(validateTargetWeaponMasterReferences(value, master)).toEqual([])
  })

  it('rejects an Element ideal bonus on Bow Poison', () => {
    const issues = validateTargetWeaponMasterReferences(
      target('weapon.bow', 'element.poison', { idealBonuses: firstThenRest(GOGMA_ELEMENT, GOGMA_ATTACK) }), master,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^idealBonuses\[0\]: /)
    expect(issues[0]).toMatch(OUTSIDE_PRODUCTION)
  })

  it('rejects an Element practical condition on Bow Poison', () => {
    const issues = validateTargetWeaponMasterReferences(target('weapon.bow', 'element.poison', {
      practicalBonusConditions: [{ id: 'practical', bonusTypeId: 'bonus_type.element', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }],
    }), master)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^practicalBonusConditions\[0\]: /)
    expect(issues[0]).toMatch(OUTSIDE_PRODUCTION)
  })

  it('rejects an Element alternative option on Bow Poison', () => {
    const issues = validateTargetWeaponMasterReferences(target('weapon.bow', 'element.poison', {
      alternativeBonusRules: [{
        id: 'alternative',
        sourceBonusTypeId: 'bonus_type.attack',
        maxReplacementCount: 1,
        options: [{ alternativeBonusTypeId: 'bonus_type.element', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }],
      }],
    }), master)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^alternativeBonusRules\[0\]\.options\[0\]: /)
    expect(issues[0]).toMatch(OUTSIDE_PRODUCTION)
  })
})
