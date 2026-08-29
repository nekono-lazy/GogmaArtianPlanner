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
