import type { MasterDataRoot } from '../../domain/master/masterTypes'

export function createValidMasterDataFixture(): MasterDataRoot {
  return {
    manifest: {
      gameTitle: 'Monster Hunter Wilds',
      appDataKind: 'gogma-artian-planner-master',
      gameVersion: 'fixture-only',
      dataVersion: 1,
      generatedAt: null,
      notes: 'Validation-only fixture. This is not verified game data.',
    },
    weaponTypes: [
      {
        id: 'weapon.fixture.disabled',
        displayNameJa: '無効fixture',
        displayNameEn: 'Disabled fixture',
        sortOrder: 0,
        category: 'melee',
        supportsElement: false,
        supportsSharpness: false,
        isEnabled: false,
      },
      {
        id: 'weapon.fixture.first',
        displayNameJa: '先頭fixture',
        displayNameEn: 'First fixture',
        sortOrder: 5,
        category: 'melee',
        supportsElement: true,
        supportsSharpness: true,
        isEnabled: true,
      },
      {
        id: 'weapon.fixture.a',
        displayNameJa: 'A fixture',
        displayNameEn: 'A fixture',
        sortOrder: 10,
        category: 'melee',
        supportsElement: true,
        supportsSharpness: true,
        isEnabled: true,
      },
      {
        id: 'weapon.fixture.b',
        displayNameJa: 'B fixture',
        displayNameEn: 'B fixture',
        sortOrder: 10,
        category: 'ranged',
        supportsElement: true,
        supportsSharpness: false,
        isEnabled: true,
      },
    ],
    elements: [
      {
        id: 'element.fixture.disabled',
        displayNameJa: '無効fixture',
        displayNameEn: 'Disabled fixture',
        sortOrder: 0,
        allowsElementBonus: false,
        isEnabled: false,
      },
      {
        id: 'element.fixture.a',
        displayNameJa: '属性A fixture',
        displayNameEn: 'Element A fixture',
        sortOrder: 10,
        allowsElementBonus: true,
        isEnabled: true,
      },
    ],
    bonusTypes: [
      {
        id: 'bonus_type.fixture.attack',
        displayNameJa: '攻撃fixture',
        displayNameEn: 'Attack fixture',
        sortOrder: 10,
        category: 'offense',
        isEnabled: true,
      },
      {
        id: 'bonus_type.fixture.unused',
        displayNameJa: '未使用fixture',
        displayNameEn: 'Unused fixture',
        sortOrder: 20,
        category: 'utility',
        isEnabled: true,
      },
    ],
    bonusRanks: [
      {
        id: 'bonus_rank.fixture.high',
        displayNameJa: 'High fixture',
        displayNameEn: 'High fixture',
        order: 2,
        isEx: false,
        isEnabled: true,
      },
      {
        id: 'bonus_rank.fixture.special',
        displayNameJa: 'Special fixture',
        displayNameEn: 'Special fixture',
        order: 4,
        isEx: true,
        isEnabled: true,
      },
      {
        id: 'bonus_rank.fixture.unused',
        displayNameJa: 'Unused fixture',
        displayNameEn: 'Unused fixture',
        order: 1,
        isEx: false,
        isEnabled: true,
      },
    ],
    weaponBonusDefinitions: [
      {
        id: 'weapon_bonus.fixture.a.attack.special',
        weaponTypeId: 'weapon.fixture.a',
        bonusTypeId: 'bonus_type.fixture.attack',
        bonusRankId: 'bonus_rank.fixture.special',
        scope: 'gogma_artian',
        displayNameJa: '攻撃Special fixture',
        displayNameEn: 'Attack Special fixture',
        effectValue: 'fixture-only',
        sortOrder: 20,
        isEnabled: true,
      },
      {
        id: 'weapon_bonus.fixture.a.attack.high',
        weaponTypeId: 'weapon.fixture.a',
        bonusTypeId: 'bonus_type.fixture.attack',
        bonusRankId: 'bonus_rank.fixture.high',
        scope: 'gogma_artian',
        displayNameJa: '攻撃High fixture',
        displayNameEn: 'Attack High fixture',
        effectValue: 'fixture-only',
        sortOrder: 10,
        isEnabled: true,
      },
      {
        id: 'weapon_bonus.fixture.b.attack.high',
        weaponTypeId: 'weapon.fixture.b',
        bonusTypeId: 'bonus_type.fixture.attack',
        bonusRankId: 'bonus_rank.fixture.high',
        scope: 'gogma_artian',
        displayNameJa: 'B攻撃High fixture',
        displayNameEn: 'B Attack High fixture',
        effectValue: 'fixture-only',
        sortOrder: 10,
        isEnabled: true,
      },
      {
        id: 'weapon_bonus.fixture.normal.a.attack.high',
        weaponTypeId: 'weapon.fixture.a',
        bonusTypeId: 'bonus_type.fixture.attack',
        bonusRankId: 'bonus_rank.fixture.high',
        scope: 'normal_artian',
        displayNameJa: '通常攻撃fixture',
        displayNameEn: 'Normal attack fixture',
        effectValue: 'fixture-only',
        sortOrder: 10,
        isEnabled: true,
      },
    ],
    artianBonusTypeMappings: [
      {
        id: 'artian_bonus_mapping.fixture.attack',
        normalBonusTypeId: 'bonus_type.fixture.attack',
        gogmaBonusTypeId: 'bonus_type.fixture.attack',
      },
    ],
    seriesSkills: [
      {
        id: 'series_skill.fixture.enabled',
        displayNameJa: 'シリーズfixture',
        displayNameEn: 'Series fixture',
        sortOrder: 10,
        isEnabled: true,
      },
      {
        id: 'series_skill.fixture.disabled',
        displayNameJa: '無効シリーズfixture',
        displayNameEn: 'Disabled series fixture',
        sortOrder: 1,
        isEnabled: false,
      },
    ],
    groupSkills: [
      {
        id: 'group_skill.fixture.enabled',
        displayNameJa: 'グループfixture',
        displayNameEn: 'Group fixture',
        sortOrder: 10,
        isEnabled: true,
      },
      {
        id: 'group_skill.fixture.disabled',
        displayNameJa: '無効グループfixture',
        displayNameEn: 'Disabled group fixture',
        sortOrder: 1,
        isEnabled: false,
      },
    ],
    lotteries: [
      {
        id: 'lottery.fixture.a.bonus',
        lotteryKind: 'gogma_bonus',
        weaponTypeId: 'weapon.fixture.a',
        rarity: 8,
        resultType: 'bonus',
        bonusTypeId: 'bonus_type.fixture.attack',
        bonusRankId: 'bonus_rank.fixture.high',
        seriesSkillId: null,
        groupSkillId: null,
        internalValue: 'fixture-only',
        weight: 1,
        sortOrder: 10,
        isEnabled: true,
      },
      {
        id: 'lottery.fixture.b.bonus',
        lotteryKind: 'gogma_bonus',
        weaponTypeId: 'weapon.fixture.b',
        rarity: 8,
        resultType: 'bonus',
        bonusTypeId: 'bonus_type.fixture.attack',
        bonusRankId: 'bonus_rank.fixture.high',
        seriesSkillId: null,
        groupSkillId: null,
        internalValue: 'fixture-only',
        weight: 1,
        sortOrder: 10,
        isEnabled: true,
      },
      {
        id: 'lottery.fixture.series',
        lotteryKind: 'series_skill',
        weaponTypeId: null,
        rarity: null,
        resultType: 'series_skill',
        bonusTypeId: null,
        bonusRankId: null,
        seriesSkillId: 'series_skill.fixture.enabled',
        groupSkillId: null,
        internalValue: 'fixture-only',
        weight: 1,
        sortOrder: 10,
        isEnabled: true,
      },
    ],
    materials: [
      {
        id: 'material.fixture.active',
        displayNameJa: '素材fixture',
        displayNameEn: 'Material fixture',
        sortOrder: 10,
        isEnabled: true,
      },
    ],
    materialCosts: [
      {
        id: 'material_cost.fixture.common',
        operationType: 'reset_skills',
        weaponTypeId: null,
        materialId: 'material.fixture.active',
        quantity: 1,
        isEnabled: true,
      },
      {
        id: 'material_cost.fixture.weapon_a',
        operationType: 'reset_skills',
        weaponTypeId: 'weapon.fixture.a',
        materialId: 'material.fixture.active',
        quantity: 2,
        isEnabled: true,
      },
      {
        id: 'material_cost.fixture.other_operation',
        operationType: 'reset_bonuses',
        weaponTypeId: null,
        materialId: 'material.fixture.active',
        quantity: 3,
        isEnabled: true,
      },
      {
        id: 'material_cost.fixture.disabled',
        operationType: 'reset_skills',
        weaponTypeId: null,
        materialId: 'material.fixture.active',
        quantity: 4,
        isEnabled: false,
      },
    ],
  }
}

export function createDuplicateIdMasterFixture(): MasterDataRoot {
  const master = createValidMasterDataFixture()
  master.weaponTypes.push({ ...master.weaponTypes[1] })
  return master
}

export function createBrokenReferenceMasterFixture(): MasterDataRoot {
  const master = createValidMasterDataFixture()
  master.weaponBonusDefinitions[0].bonusRankId = 'bonus_rank.fixture.missing'
  return master
}

export function createInvalidLotteryMasterFixture(): MasterDataRoot {
  const master = createValidMasterDataFixture()
  master.lotteries[0].bonusRankId = null
  return master
}

export function createInvalidMaterialCostMasterFixture(): MasterDataRoot {
  const master = createValidMasterDataFixture()
  master.materialCosts[0].quantity = 0
  return master
}
