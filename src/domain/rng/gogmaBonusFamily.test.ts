import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet } from '../models/publicTypes'
import { gogmaKeepFamilyId, gogmaKeepFamilyLayoutKey } from './gogmaBonusFamily'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  referenceGogmaBonusFamily,
} from './production/referenceGogmaBonuses'

function bonuses(...types: string[]): RestorationBonusSet {
  return types.map((bonusTypeId, index) => ({
    bonusTypeId,
    bonusRankId: index % 2 === 0 ? 'bonus_rank.fixture.low' : 'bonus_rank.fixture.high',
  })) as unknown as RestorationBonusSet
}

describe('Gogma Keep family layout', () => {
  it('reads the family of one slot from the semantic bonus type', () => {
    expect(gogmaKeepFamilyId({
      bonusTypeId: 'bonus_type.attack',
      bonusRankId: 'bonus_rank.ii',
    })).toBe('bonus_type.attack')
    expect(gogmaKeepFamilyId({
      bonusTypeId: 'bonus_type.attack',
      bonusRankId: 'bonus_rank.ex',
    })).toBe('bonus_type.attack')
  })

  it('treats a tier difference as the same layout', () => {
    const low = bonuses('a', 'b', 'a', 'b', 'a')
    const high = low.map(({ bonusTypeId }) => ({
      bonusTypeId,
      bonusRankId: 'bonus_rank.fixture.special',
    })) as unknown as RestorationBonusSet
    expect(gogmaKeepFamilyLayoutKey(high)).toBe(gogmaKeepFamilyLayoutKey(low))
  })

  it('keeps slot order semantic instead of sorting into a multiset', () => {
    expect(gogmaKeepFamilyLayoutKey(bonuses('a', 'b', 'a', 'b', 'a')))
      .not.toBe(gogmaKeepFamilyLayoutKey(bonuses('b', 'a', 'a', 'b', 'a')))
  })

  it('matches the pinned reference Keep family grouping for Gogma-tier bonuses', () => {
    // The Domain derivation is only sound while the reference Keep family table
    // groups exactly by semantic bonus type. A split family would break it.
    const familyByType = new Map<string, string>()
    for (const candidate of REFERENCE_GOGMA_RESET_CANDIDATES) {
      const family = referenceGogmaBonusFamily(candidate.referenceId)
      const semanticFamily = gogmaKeepFamilyId(candidate.bonus)
      const known = familyByType.get(semanticFamily)
      if (known === undefined) familyByType.set(semanticFamily, family)
      else expect(family).toBe(known)
    }
    expect(new Set(familyByType.values()).size).toBe(familyByType.size)
  })
})
