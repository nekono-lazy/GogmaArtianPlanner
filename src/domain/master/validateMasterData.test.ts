import { describe, expect, it } from 'vitest'
import {
  createBrokenReferenceMasterFixture,
  createDuplicateIdMasterFixture,
  createInvalidLotteryMasterFixture,
  createInvalidMaterialCostMasterFixture,
  createValidMasterDataFixture,
} from '../../test/fixtures/masterData'
import { validateMasterData } from './validateMasterData'

describe('validateMasterData', () => {
  it('accepts the validation-only valid fixture', () => {
    expect(validateMasterData(createValidMasterDataFixture())).toEqual({
      isValid: true,
      issues: [],
    })
  })

  it('detects duplicate master IDs', () => {
    const result = validateMasterData(createDuplicateIdMasterFixture())
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate_id' }),
    )
  })

  it('detects missing reference IDs', () => {
    const result = validateMasterData(createBrokenReferenceMasterFixture())
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing_reference',
        path: 'weaponBonusDefinitions[0].bonusRankId',
      }),
    )
  })

  it('detects duplicate weapon bonus composite keys', () => {
    const master = createValidMasterDataFixture()
    master.weaponBonusDefinitions.push({
      ...master.weaponBonusDefinitions[0],
      id: 'weapon_bonus.fixture.duplicate_composite',
    })
    const result = validateMasterData(master)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate_weapon_bonus_definition' }),
    )
  })

  it('allows the same weapon/type/rank key in different Artian scopes', () => {
    const master = createValidMasterDataFixture()
    const normalDefinition = master.weaponBonusDefinitions.find(
      ({ scope }) => scope === 'normal_artian',
    )
    const gogmaDefinition = master.weaponBonusDefinitions.find(
      ({ scope, weaponTypeId, bonusTypeId, bonusRankId }) =>
        scope === 'gogma_artian' &&
        weaponTypeId === normalDefinition?.weaponTypeId &&
        bonusTypeId === normalDefinition.bonusTypeId &&
        bonusRankId === normalDefinition.bonusRankId,
    )
    expect(normalDefinition).toBeDefined()
    expect(gogmaDefinition).toBeDefined()
    expect(validateMasterData(master).issues).not.toContainEqual(
      expect.objectContaining({ code: 'duplicate_weapon_bonus_definition' }),
    )
  })

  it('rejects an invalid Artian bonus scope', () => {
    const master = createValidMasterDataFixture()
    master.weaponBonusDefinitions[0].scope = 'invalid_scope' as never
    expect(validateMasterData(master).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_artian_bonus_scope' }),
    )
  })

  it('rejects multiple mapping targets for the same normal Bonus Type', () => {
    const master = createValidMasterDataFixture()
    master.artianBonusTypeMappings.push({
      ...master.artianBonusTypeMappings[0],
      id: 'artian_bonus_mapping.fixture.duplicate',
    })
    expect(validateMasterData(master).issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate_bonus_type_mapping' }),
    )
  })

  it('rejects mappings whose target is not used in Gogma scope', () => {
    const master = createValidMasterDataFixture()
    master.artianBonusTypeMappings[0].gogmaBonusTypeId =
      'bonus_type.fixture.unused'
    expect(validateMasterData(master).issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid_bonus_type_mapping',
        path: 'artianBonusTypeMappings[0].gogmaBonusTypeId',
      }),
    )
  })

  it('detects result-specific invalid Lottery fields', () => {
    const result = validateMasterData(createInvalidLotteryMasterFixture())
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_lottery_result' }),
    )
  })

  it('detects negative Lottery weights', () => {
    const master = createValidMasterDataFixture()
    master.lotteries[0].weight = -1
    const result = validateMasterData(master)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_lottery_weight' }),
    )
  })

  it('detects MaterialCost quantities below one', () => {
    const result = validateMasterData(createInvalidMaterialCostMasterFixture())
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_material_quantity' }),
    )
  })

  it('detects non-positive dataVersion', () => {
    const master = createValidMasterDataFixture()
    master.manifest.dataVersion = 0
    const result = validateMasterData(master)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_data_version' }),
    )
  })
})
