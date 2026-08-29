import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import {
  getBonusDefinitionsForWeapon,
  getBonusRankOrder,
  getEnabledElements,
  getEnabledWeaponTypes,
  getGroupSkillOptions,
  getLotteryEntries,
  getMaterialCosts,
  getRanksForBonusType,
  getSeriesSkillOptions,
  isExRank,
  MasterDataDomainError,
} from './masterSelectors'

describe('Master Data selectors', () => {
  it('returns only enabled WeaponTypes in sortOrder/id order', () => {
    const result = getEnabledWeaponTypes(createValidMasterDataFixture())
    expect(result.map(({ id }) => id)).toEqual([
      'weapon.fixture.first',
      'weapon.fixture.a',
      'weapon.fixture.b',
    ])
  })

  it('returns only enabled Elements', () => {
    const result = getEnabledElements(createValidMasterDataFixture())
    expect(result.map(({ id }) => id)).toEqual(['element.fixture.a'])
  })

  it('returns enabled Bonus Definitions for one weapon', () => {
    const result = getBonusDefinitionsForWeapon(
      createValidMasterDataFixture(),
      'weapon.fixture.a',
    )
    expect(result.map(({ id }) => id)).toEqual([
      'weapon_bonus.fixture.a.attack.high',
      'weapon_bonus.fixture.a.attack.special',
    ])
  })

  it('returns only ranks defined for the weapon and Bonus Type in rank order', () => {
    const result = getRanksForBonusType(
      createValidMasterDataFixture(),
      'weapon.fixture.a',
      'bonus_type.fixture.attack',
    )
    expect(result.map(({ id }) => id)).toEqual([
      'bonus_rank.fixture.high',
      'bonus_rank.fixture.special',
    ])
  })

  it('returns rank order', () => {
    expect(
      getBonusRankOrder(
        createValidMasterDataFixture(),
        'bonus_rank.fixture.high',
      ),
    ).toBe(2)
  })

  it('uses isEx rather than an ID naming convention', () => {
    expect(
      isExRank(
        createValidMasterDataFixture(),
        'bonus_rank.fixture.special',
      ),
    ).toBe(true)
  })

  it('returns enabled Series Skill options', () => {
    const result = getSeriesSkillOptions(createValidMasterDataFixture())
    expect(result.map(({ id }) => id)).toEqual([
      'series_skill.fixture.enabled',
    ])
  })

  it('returns enabled Group Skill options', () => {
    const result = getGroupSkillOptions(createValidMasterDataFixture())
    expect(result.map(({ id }) => id)).toEqual(['group_skill.fixture.enabled'])
  })

  it('returns common and weapon-specific Material Costs', () => {
    const result = getMaterialCosts(
      createValidMasterDataFixture(),
      'reset_skills',
      'weapon.fixture.a',
    )
    expect(result.map(({ id }) => id)).toEqual([
      'material_cost.fixture.common',
      'material_cost.fixture.weapon_a',
    ])
  })

  it('filters Lottery entries without performing a lottery', () => {
    const result = getLotteryEntries(
      createValidMasterDataFixture(),
      'gogma_bonus',
      'weapon.fixture.a',
      'rare7',
    )
    expect(result.map(({ id }) => id)).toEqual(['lottery.fixture.a.bonus'])
  })

  it('throws an explicit Domain Error for an unknown Master ID', () => {
    expect(() =>
      getBonusDefinitionsForWeapon(
        createValidMasterDataFixture(),
        'weapon.fixture.missing',
      ),
    ).toThrow(MasterDataDomainError)
  })
})
