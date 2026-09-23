import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet } from '../models/publicTypes'
import { loadMasterData } from '../master/loadMasterData'
import {
  keepFamilyBonusTypeId,
  keepFamilyLayout,
  keepFamilyLayoutKey,
  keepFamilyMultisetKey,
  keepFamilyOfBonus,
  type KeepFamilyMasterSubset,
} from './gogmaBonusFamily'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  referenceGogmaBonusFamily,
} from './production/referenceGogmaBonuses'

function master(): KeepFamilyMasterSubset {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

/** Synthetic types with no Master mapping entry are their own Gogma family. */
const fixtureMaster: KeepFamilyMasterSubset = {
  artianBonusTypeMappings: [
    {
      id: 'artian_bonus_mapping.fixture.n',
      normalBonusTypeId: 'n',
      gogmaBonusTypeId: 'b',
    },
  ],
}

function bonuses(...types: string[]): RestorationBonusSet {
  return types.map((bonusTypeId, index) => ({
    bonusTypeId,
    bonusRankId: index % 2 === 0 ? 'bonus_rank.fixture.low' : 'bonus_rank.fixture.high',
  })) as unknown as RestorationBonusSet
}

describe('Keep family resolution', () => {
  it('maps every Master Normal-side bonus type to its Gogma family through ArtianBonusTypeMapping', () => {
    const keepMaster = master()
    expect(keepFamilyBonusTypeId('bonus_type.attack', keepMaster)).toBe('bonus_type.attack')
    expect(keepFamilyBonusTypeId('bonus_type.affinity', keepMaster)).toBe('bonus_type.affinity')
    expect(keepFamilyBonusTypeId('bonus_type.element', keepMaster)).toBe('bonus_type.element')
    expect(keepFamilyBonusTypeId('bonus_type.normal_sharpness', keepMaster)).toBe('bonus_type.gogma_sharpness_capacity')
    expect(keepFamilyBonusTypeId('bonus_type.normal_capacity', keepMaster)).toBe('bonus_type.gogma_sharpness_capacity')
    // A Gogma-side type is already a family and maps to itself.
    expect(keepFamilyBonusTypeId('bonus_type.gogma_sharpness_capacity', keepMaster)).toBe('bonus_type.gogma_sharpness_capacity')
  })

  it('reads the family from the bonus type alone and never from the rank', () => {
    for (const bonusRankId of ['bonus_rank.base', 'bonus_rank.ii', 'bonus_rank.ex', 'bonus_rank.fixture.unknown']) {
      expect(keepFamilyOfBonus({ bonusTypeId: 'bonus_type.attack', bonusRankId }, master())).toBe('bonus_type.attack')
      expect(keepFamilyOfBonus({ bonusTypeId: 'bonus_type.normal_capacity', bonusRankId }, master())).toBe('bonus_type.gogma_sharpness_capacity')
    }
  })

  it('treats a tier difference as the same layout', () => {
    const low = bonuses('a', 'b', 'a', 'b', 'a')
    const high = low.map(({ bonusTypeId }) => ({
      bonusTypeId,
      bonusRankId: 'bonus_rank.fixture.special',
    })) as unknown as RestorationBonusSet
    expect(keepFamilyLayoutKey(high, fixtureMaster)).toBe(keepFamilyLayoutKey(low, fixtureMaster))
  })

  it('treats a Normal-side spelling of a family as the same layout as its Gogma-side spelling', () => {
    expect(keepFamilyLayout(bonuses('n', 'a', 'n', 'a', 'b'), fixtureMaster)).toEqual(['b', 'a', 'b', 'a', 'b'])
    expect(keepFamilyLayoutKey(bonuses('n', 'a', 'n', 'a', 'b'), fixtureMaster))
      .toBe(keepFamilyLayoutKey(bonuses('b', 'a', 'b', 'a', 'b'), fixtureMaster))
    // The real Master: inherited normal-scope slots and their Gogma-tier counterparts share one layout.
    expect(keepFamilyLayoutKey(bonuses(
      'bonus_type.normal_sharpness', 'bonus_type.element', 'bonus_type.element', 'bonus_type.attack', 'bonus_type.attack',
    ), master())).toBe(keepFamilyLayoutKey(bonuses(
      'bonus_type.gogma_sharpness_capacity', 'bonus_type.element', 'bonus_type.element', 'bonus_type.attack', 'bonus_type.attack',
    ), master()))
  })

  it('keeps slot order semantic instead of sorting into a multiset', () => {
    expect(keepFamilyLayoutKey(bonuses('a', 'b', 'a', 'b', 'a'), fixtureMaster))
      .not.toBe(keepFamilyLayoutKey(bonuses('b', 'a', 'a', 'b', 'a'), fixtureMaster))
    expect(keepFamilyLayoutKey(bonuses('n', 'a', 'a', 'b', 'a'), fixtureMaster))
      .not.toBe(keepFamilyLayoutKey(bonuses('a', 'n', 'a', 'b', 'a'), fixtureMaster))
  })

  it('compares unordered family multiplicities while preserving ordered stream identities', () => {
    const first = bonuses('a', 'a', 'a', 'b', 'b')
    const second = bonuses('n', 'a', 'b', 'a', 'a')
    expect(keepFamilyMultisetKey(first, fixtureMaster)).toBe(keepFamilyMultisetKey(second, fixtureMaster))
    expect(keepFamilyLayoutKey(first, fixtureMaster)).not.toBe(keepFamilyLayoutKey(second, fixtureMaster))
    expect(keepFamilyMultisetKey(first, fixtureMaster)).not.toBe(keepFamilyMultisetKey(bonuses('a', 'a', 'b', 'b', 'b'), fixtureMaster))
    expect(first.map(slot => slot.bonusTypeId)).toEqual(['a', 'a', 'a', 'b', 'b'])
  })

  it('normalizes both Sharpness and Capacity to the same multiset through Master', () => {
    const normal = bonuses('bonus_type.attack', 'bonus_type.normal_sharpness', 'bonus_type.attack', 'bonus_type.normal_capacity', 'bonus_type.attack')
    const gogma = bonuses('bonus_type.gogma_sharpness_capacity', 'bonus_type.attack', 'bonus_type.attack', 'bonus_type.attack', 'bonus_type.gogma_sharpness_capacity')
    expect(keepFamilyMultisetKey(normal, master())).toBe(keepFamilyMultisetKey(gogma, master()))
  })

  it('matches the pinned reference Keep family grouping for Gogma-tier bonuses', () => {
    // The Domain derivation is only sound while the reference Keep family table
    // groups exactly by semantic bonus type. A split family would break it.
    const familyByType = new Map<string, string>()
    for (const candidate of REFERENCE_GOGMA_RESET_CANDIDATES) {
      const family = referenceGogmaBonusFamily(candidate.referenceId)
      const semanticFamily = keepFamilyOfBonus(candidate.bonus, master())
      const known = familyByType.get(semanticFamily)
      if (known === undefined) familyByType.set(semanticFamily, family)
      else expect(family).toBe(known)
    }
    expect(new Set(familyByType.values()).size).toBe(familyByType.size)
  })
})
