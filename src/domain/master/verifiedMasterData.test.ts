import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import {
  getBonusDefinitionsForWeapon,
  getGogmaBonusTypeForNormalBonus,
  getGroupSkillOptions,
  getNormalBonusTypesForGogmaBonus,
  getRanksForBonusType,
  getSeriesSkillOptions,
} from './masterSelectors'
import type { ArtianBonusScope, MasterDataRoot } from './masterTypes'

function loadVerifiedMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

function bonusTypeIds(
  master: MasterDataRoot,
  weaponTypeId: string,
  elementId: string,
  scope: ArtianBonusScope,
) {
  return [
    ...new Set(
      getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, scope).map(
        ({ bonusTypeId }) => bonusTypeId,
      ),
    ),
  ]
}

describe('project-owner verified Master Data', () => {
  it('registers the 14 weapon types and 10 elements in confirmed order', () => {
    const master = loadVerifiedMaster()
    expect(master.weaponTypes.map(({ displayNameJa }) => displayNameJa)).toEqual([
      '大剣', '太刀', '片手剣', '双剣', 'ハンマー', '狩猟笛', 'ランス',
      'ガンランス', 'スラッシュアックス', 'チャージアックス', '操虫棍',
      '弓', 'ライトボウガン', 'ヘビィボウガン',
    ])
    expect(master.elements.map(({ displayNameJa }) => displayNameJa)).toEqual([
      '無属性', '火', '水', '雷', '氷', '龍', '毒', '麻痺', '睡眠', '爆破',
    ])
    expect(master.weaponTypes.every(({ isEnabled }) => isEnabled)).toBe(true)
    expect(master.elements.every(({ isEnabled }) => isEnabled)).toBe(true)
  })

  it.each([
    ['weapon.great_sword', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element', 'bonus_type.normal_sharpness']],
    ['weapon.bow', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element']],
    ['weapon.light_bowgun', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.normal_capacity']],
    ['weapon.heavy_bowgun', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.normal_capacity']],
  ])('filters normal Artian bonus types for %s', (weaponTypeId, expected) => {
    expect(bonusTypeIds(loadVerifiedMaster(), weaponTypeId, 'element.thunder', 'normal_artian')).toEqual(expected)
  })

  it.each([
    ['weapon.great_sword', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element', 'bonus_type.gogma_sharpness_capacity']],
    ['weapon.bow', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element']],
    ['weapon.light_bowgun', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.gogma_sharpness_capacity']],
    ['weapon.heavy_bowgun', ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.gogma_sharpness_capacity']],
  ])('filters Gogma Artian bonus types for %s', (weaponTypeId, expected) => {
    expect(bonusTypeIds(loadVerifiedMaster(), weaponTypeId, 'element.thunder', 'gogma_artian')).toEqual(expected)
  })

  it('excludes Element bonuses for none while retaining them for elemental weapons', () => {
    const master = loadVerifiedMaster()
    expect(
      bonusTypeIds(
        master,
        'weapon.great_sword',
        'element.none',
        'gogma_artian',
      ),
    ).not.toContain('bonus_type.element')
    expect(
      bonusTypeIds(
        master,
        'weapon.great_sword',
        'element.thunder',
        'gogma_artian',
      ),
    ).toContain('bonus_type.element')
    expect(
      bonusTypeIds(
        master,
        'weapon.great_sword',
        'element.none',
        'normal_artian',
      ),
    ).not.toContain('bonus_type.element')
  })

  it.each(['weapon.light_bowgun', 'weapon.heavy_bowgun'])(
    'never exposes Element bonuses for %s',
    (weaponTypeId) => {
      expect(
        bonusTypeIds(
          loadVerifiedMaster(),
          weaponTypeId,
          'element.thunder',
          'gogma_artian',
        ),
      ).not.toContain('bonus_type.element')
    },
  )

  it.each([
    ['bonus_type.attack', ['I', 'II', 'III', 'EX']],
    ['bonus_type.affinity', ['I', 'II', 'III', 'EX']],
    ['bonus_type.element', ['I', 'II', 'EX']],
    ['bonus_type.gogma_sharpness_capacity', ['通常', 'EX']],
  ])('returns the confirmed Gogma ranks for %s', (bonusTypeId, expected) => {
    const ranks = getRanksForBonusType(
      loadVerifiedMaster(),
      'weapon.great_sword',
      'element.thunder',
      bonusTypeId,
      'gogma_artian',
    )
    expect(ranks.map(({ displayNameJa }) => displayNameJa)).toEqual(expected)
  })

  it('maps all confirmed normal types and preserves the many-to-one mapping', () => {
    const master = loadVerifiedMaster()
    expect(getGogmaBonusTypeForNormalBonus(master, 'bonus_type.attack')).toBe('bonus_type.attack')
    expect(getGogmaBonusTypeForNormalBonus(master, 'bonus_type.affinity')).toBe('bonus_type.affinity')
    expect(getGogmaBonusTypeForNormalBonus(master, 'bonus_type.element')).toBe('bonus_type.element')
    expect(getGogmaBonusTypeForNormalBonus(master, 'bonus_type.normal_sharpness')).toBe('bonus_type.gogma_sharpness_capacity')
    expect(getGogmaBonusTypeForNormalBonus(master, 'bonus_type.normal_capacity')).toBe('bonus_type.gogma_sharpness_capacity')
    expect(getNormalBonusTypesForGogmaBonus(master, 'bonus_type.gogma_sharpness_capacity')).toEqual([
      'bonus_type.normal_capacity',
      'bonus_type.normal_sharpness',
    ])
  })

  it('keeps all skill IDs while exposing only verified Gogma skill options', () => {
    const master = loadVerifiedMaster()
    expect(master.seriesSkills).toHaveLength(25)
    expect(master.groupSkills).toHaveLength(17)
    expect(getSeriesSkillOptions(master)).toHaveLength(21)
    expect(getGroupSkillOptions(master)).toHaveLength(16)
    expect(getSeriesSkillOptions(master).map(({ displayNameJa }) => displayNameJa)).toContain('巨戟龍の黙示録')
    expect(getGroupSkillOptions(master).map(({ displayNameJa }) => displayNameJa)).not.toContain('拳を極めし者')
  })

  it('keeps Lottery and material cost placeholders disabled', () => {
    const master = loadVerifiedMaster()
    expect(master.lotteries.every(({ isEnabled }) => !isEnabled)).toBe(true)
    expect(master.materials.every(({ isEnabled }) => !isEnabled)).toBe(true)
    expect(master.materialCosts.every(({ isEnabled }) => !isEnabled)).toBe(true)
  })
})
