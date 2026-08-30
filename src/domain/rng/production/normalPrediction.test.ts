import { describe, expect, it } from 'vitest'
import { gameVerifiedBowElementalNormalVectors } from '../../../test/fixtures/gameVerifiedNormalVectors'
import { referenceNormalVectors } from '../../../test/fixtures/referenceNormalVectors'
import {
  GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES,
  gameVerifiedNormalCandidatesForWeaponAndElement,
  mapReferenceNormalResult,
  predictGameVerifiedNormalArtian,
  predictGameVerifiedNormalRaw,
  predictReferenceNormalArtian,
  predictReferenceNormalRaw,
  REFERENCE_NORMAL_ELEMENTAL_CANDIDATES,
  REFERENCE_NORMAL_NONE_CANDIDATES,
  referenceNormalCandidatesForElement,
  toReferenceNormalFinalAttribute,
  UnsupportedGameVerifiedNormalPredictionError,
} from '.'

describe('reference-verified Production Normal Artian prediction', () => {
  it('keeps the exact raw Normal pool IDs, order, and family limits', () => {
    expect(REFERENCE_NORMAL_NONE_CANDIDATES).toEqual([
      { referenceId: 6, maximumOccurrences: 5 },
      { referenceId: 7, maximumOccurrences: 2 },
      { referenceId: 8, maximumOccurrences: 5 },
    ])
    expect(REFERENCE_NORMAL_ELEMENTAL_CANDIDATES).toEqual([
      { referenceId: 6, maximumOccurrences: 5 },
      { referenceId: 4, maximumOccurrences: 5 },
      { referenceId: 7, maximumOccurrences: 2 },
      { referenceId: 8, maximumOccurrences: 5 },
    ])
    expect(referenceNormalCandidatesForElement('element.none')).toBe(REFERENCE_NORMAL_NONE_CANDIDATES)
    expect(referenceNormalCandidatesForElement('element.thunder')).toBe(REFERENCE_NORMAL_ELEMENTAL_CANDIDATES)
  })

  it('matches every independent raw five-slot golden from the pinned reference app.js', () => {
    for (const vector of referenceNormalVectors.raw) {
      expect(predictReferenceNormalRaw(vector)).toEqual({
        referenceIds: vector.referenceIds,
        blockIndex: vector.normalCounter,
      })
    }
  })

  it('keeps the reference raw Bow sequence separate from the game-adjusted predictor', () => {
    for (const vector of gameVerifiedBowElementalNormalVectors) {
      expect(predictReferenceNormalRaw(vector).referenceIds).toEqual(vector.referenceIds)
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
    }
  })

  it('matches the game-observed elemental Bow 15-slot sequence with pool [6, 4, 8]', () => {
    expect(GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES).toEqual([
      { referenceId: 6, maximumOccurrences: 5 },
      { referenceId: 4, maximumOccurrences: 5 },
      { referenceId: 8, maximumOccurrences: 5 },
    ])
    for (const vector of gameVerifiedBowElementalNormalVectors) {
      expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).not.toContain(7)
    }
  })

  it('uses one game-verified candidate pool for every attribute-present Bow element', () => {
    for (const elementId of [
      'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon',
      'element.poison', 'element.paralysis', 'element.sleep', 'element.blast',
    ]) {
      expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.bow', elementId))
        .toBe(GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES)
    }
  })

  it('rejects attribute-none Bow and LBG/HBG instead of returning a reference fallback as game-verified', () => {
    const input = gameVerifiedBowElementalNormalVectors[0]
    expect(() => predictGameVerifiedNormalRaw({ ...input, elementId: 'element.none' }))
      .toThrow(UnsupportedGameVerifiedNormalPredictionError)
    expect(() => predictGameVerifiedNormalRaw({ ...input, weaponTypeId: 'weapon.light_bowgun' }))
      .toThrow(UnsupportedGameVerifiedNormalPredictionError)
    expect(() => predictGameVerifiedNormalRaw({ ...input, weaponTypeId: 'weapon.heavy_bowgun' }))
      .toThrow(UnsupportedGameVerifiedNormalPredictionError)
  })

  it('matches a raw reference golden for every weapon type without changing the shared pool', () => {
    for (const vector of referenceNormalVectors.allWeaponTypes) {
      expect(predictReferenceNormalRaw({
        baseSeed: 7654321,
        weaponTypeId: vector.weaponTypeId,
        elementId: 'element.poison',
        rarity: 8,
        normalCounter: 6,
      }).referenceIds).toEqual(vector.referenceIds)
    }
  })

  it('uses the Normal final-attribute adapter rather than attributeForce or Master order', () => {
    expect([
      ['element.none', 1], ['element.fire', 2], ['element.water', 3], ['element.thunder', 4],
      ['element.ice', 5], ['element.dragon', 6], ['element.poison', 7], ['element.paralysis', 8],
      ['element.sleep', 9], ['element.blast', 10],
    ].map(([elementId]) => [elementId, toReferenceNormalFinalAttribute(elementId as string)])).toEqual([
      ['element.none', 1], ['element.fire', 2], ['element.water', 3], ['element.thunder', 4],
      ['element.ice', 5], ['element.dragon', 6], ['element.poison', 7], ['element.paralysis', 8],
      ['element.sleep', 9], ['element.blast', 10],
    ])
  })

  it('uses consecutive ten-step blocks for consecutive Normal forges', () => {
    const chain = referenceNormalVectors.raw.slice(1, 4)
    expect(chain.map((vector) => predictReferenceNormalRaw(vector).referenceIds)).toEqual([
      [6, 6, 8, 8, 7],
      [6, 7, 8, 6, 6],
      [7, 6, 6, 8, 6],
    ])
    expect(chain.map((vector) => predictReferenceNormalRaw(vector).blockIndex)).toEqual([0, 1, 2])
  })

  it('maps every raw Normal candidate explicitly for melee, LBG, and HBG', () => {
    const raw = [6, 4, 7, 8, 6]
    const meleeExpected = [
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.normal_sharpness', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
    ]
    const gunnerExpected = [
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.normal_capacity', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
    ]
    expect(mapReferenceNormalResult('weapon.great_sword', raw)).toEqual({ kind: 'mapped', bonuses: meleeExpected })
    expect(mapReferenceNormalResult('weapon.light_bowgun', raw)).toEqual({ kind: 'mapped', bonuses: gunnerExpected })
    expect(mapReferenceNormalResult('weapon.heavy_bowgun', raw)).toEqual({ kind: 'mapped', bonuses: gunnerExpected })
  })

  it('returns full ordered semantic parity for every unambiguous golden result', () => {
    for (const vector of referenceNormalVectors.raw) {
      if (!('semanticBonuses' in vector)) continue
      const result = predictReferenceNormalArtian(vector)
      expect(result.semanticResult).toEqual({ kind: 'mapped', bonuses: vector.semanticBonuses })
    }
  })

  it('retains Bow raw parity but explicitly leaves family 7 unmappable', () => {
    const bow = referenceNormalVectors.raw[4]
    const first = predictReferenceNormalArtian(bow)
    expect(first.referenceIds).toEqual([4, 8, 7, 4, 7])
    expect(first.semanticResult).toEqual({
      kind: 'unmappable',
      reason: 'bow_normal_family_7_has_no_domain_mapping',
      referenceIds: [4, 8, 7, 4, 7],
    })
    expect(predictReferenceNormalArtian(bow)).toEqual(first)
  })

  it('maps a Bow raw result only when it contains no unmappable family 7', () => {
    const bow = referenceNormalVectors.raw[5]
    expect(predictReferenceNormalArtian(bow).semanticResult).toEqual({
      kind: 'mapped', bonuses: bow.semanticBonuses,
    })
  })

  it('uses the rarity-8 to internal-rarity-7 adapter and rejects unsupported rarity', () => {
    const input = referenceNormalVectors.raw[0]
    expect(predictReferenceNormalRaw(input).referenceIds).toEqual([6, 4, 6, 8, 4])
    expect(() => predictReferenceNormalRaw({ ...input, rarity: 7 as 8 })).toThrow(RangeError)
  })

  it('rejects invalid counters, unknown semantic IDs, and unknown raw mapping IDs', () => {
    const input = referenceNormalVectors.raw[0]
    expect(() => predictReferenceNormalRaw({ ...input, normalCounter: -1 })).toThrow(RangeError)
    expect(() => predictReferenceNormalRaw({ ...input, normalCounter: 1.5 })).toThrow(RangeError)
    expect(() => predictReferenceNormalRaw({ ...input, normalCounter: Number.MAX_SAFE_INTEGER + 1 })).toThrow(RangeError)
    expect(() => predictReferenceNormalRaw({ ...input, weaponTypeId: 'weapon.unknown' })).toThrow(RangeError)
    expect(() => predictReferenceNormalRaw({ ...input, elementId: 'element.unknown' })).toThrow(RangeError)
    expect(() => mapReferenceNormalResult('weapon.great_sword', [6, 4, 7, 8, 99])).toThrow(RangeError)
  })

  it('is deterministic at a large Normal counter without retaining prior blocks', () => {
    const input = { ...referenceNormalVectors.raw[0], normalCounter: 5000 }
    expect(predictReferenceNormalRaw(input)).toEqual(predictReferenceNormalRaw(input))
    expect(predictReferenceNormalRaw(input).blockIndex).toBe(5000)
  })
})
