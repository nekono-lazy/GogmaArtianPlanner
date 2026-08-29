import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import {
  getBonusDefinitionsForWeapon,
  getBonusRankOrder,
  getEnabledElements,
  getEnabledWeaponTypes,
  getGroupSkillOptions,
  getGogmaBonusTypeForNormalBonus,
  getLotteryEntries,
  getMaterialCosts,
  getNormalBonusTypesForGogmaBonus,
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
      'element.fixture.a',
      'gogma_artian',
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
      'element.fixture.a',
      'bonus_type.fixture.attack',
      'gogma_artian',
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
      8,
    )
    expect(result.map(({ id }) => id)).toEqual(['lottery.fixture.a.bonus'])
  })

  it('throws an explicit Domain Error for an unknown Master ID', () => {
    expect(() =>
      getBonusDefinitionsForWeapon(
        createValidMasterDataFixture(),
        'weapon.fixture.missing',
        'element.fixture.a',
        'gogma_artian',
      ),
    ).toThrow(MasterDataDomainError)
  })

  it('maps a normal bonus type through the explicit mapping master', () => {
    expect(
      getGogmaBonusTypeForNormalBonus(
        createValidMasterDataFixture(),
        'bonus_type.fixture.attack',
      ),
    ).toBe('bonus_type.fixture.attack')
  })

  it('returns reverse mappings as an array', () => {
    expect(
      getNormalBonusTypesForGogmaBonus(
        createValidMasterDataFixture(),
        'bonus_type.fixture.attack',
      ),
    ).toEqual(['bonus_type.fixture.attack'])
  })

  it('throws an explicit error when a normal Bonus Type has no mapping', () => {
    expect(() =>
      getGogmaBonusTypeForNormalBonus(
        createValidMasterDataFixture(),
        'bonus_type.fixture.unused',
      ),
    ).toThrow(MasterDataDomainError)
  })
})
