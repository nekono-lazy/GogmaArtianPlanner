import { describe, expect, it } from 'vitest'
import {
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedBowNoneNormalVectors,
  gameVerifiedHeavyBowgunFireNormalVectors,
  gameVerifiedHeavyBowgunNoneNormalVectors,
  gameVerifiedLightBowgunFireNormalVectors,
  gameVerifiedLightBowgunNoneNormalVectors,
  gameVerifiedLongSwordFireNormalVectors,
  gameVerifiedLongSwordNoneNormalVectors,
} from '../../../test/fixtures/gameVerifiedNormalVectors'
import { referenceNormalVectors } from '../../../test/fixtures/referenceNormalVectors'
import {
  GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES,
  GAME_VERIFIED_BOW_NONE_NORMAL_CANDIDATES,
  GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES,
  GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES,
  GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES,
  GAME_VERIFIED_LONG_SWORD_NONE_NORMAL_CANDIDATES,
  gameVerifiedNormalCandidatesForWeaponAndElement,
  mapReferenceNormalResult,
  predictGameVerifiedNormalArtian,
  predictGameVerifiedNormalRaw,
  predictReferenceNormalArtian,
  predictReferenceNormalRaw,
  REFERENCE_NORMAL_ELEMENTAL_CANDIDATES,
  REFERENCE_NORMAL_NONE_CANDIDATES,
  referenceNormalCandidatesForElement,
  selectReferenceNormalLotteryIdsFromRawValues,
  toReferenceNormalFinalAttribute,
  UnsupportedGameVerifiedNormalPredictionError,
} from '.'

/*
 * Game-verified Production limits (docs/RNG_REFERENCE_AUDIT.md 5.3, 2026-09-14):
 * Attack 5 / Element 4 / Sharpness-Capacity family 2 / Affinity 3. These are
 * deliberately not the pinned reference pool's Element 5 / Affinity 5.
 */
const GAME_ATTACK = { referenceId: 6, maximumOccurrences: 5 } as const
const GAME_ELEMENT = { referenceId: 4, maximumOccurrences: 4 } as const
const GAME_FAMILY_7 = { referenceId: 7, maximumOccurrences: 2 } as const
const GAME_AFFINITY = { referenceId: 8, maximumOccurrences: 3 } as const

describe('reference-verified Production Normal Artian prediction', () => {
  it('keeps the exact raw Normal pool IDs, order, and family limits of the pinned reference (Element 5 / Affinity 5)', () => {
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

  it('keeps reference parity limits distinct from the game-verified Production limits', () => {
    // Reference parity is the pinned GARP.lua behavior, not the real game's limits.
    const referenceById = new Map(REFERENCE_NORMAL_ELEMENTAL_CANDIDATES.map((c) => [c.referenceId, c.maximumOccurrences]))
    expect(referenceById.get(4)).toBe(5)
    expect(referenceById.get(8)).toBe(5)
    // Production game-verified pools carry the real-game limits instead.
    expect(GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES.find((c) => c.referenceId === 4)?.maximumOccurrences).toBe(4)
    expect(GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES.find((c) => c.referenceId === 8)?.maximumOccurrences).toBe(3)
  })

  it('fixes the exact game-verified Production limits: Attack 5 / Element 4 / family 7 2 / Affinity 3', () => {
    const everyGamePool = [
      GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES,
      GAME_VERIFIED_BOW_NONE_NORMAL_CANDIDATES,
      GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES,
      GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES,
      GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES,
      GAME_VERIFIED_LONG_SWORD_NONE_NORMAL_CANDIDATES,
    ]
    const expectedByReferenceId: Record<number, number> = { 6: 5, 4: 4, 7: 2, 8: 3 }
    for (const pool of everyGamePool) {
      for (const candidate of pool) {
        expect(candidate.maximumOccurrences).toBe(expectedByReferenceId[candidate.referenceId])
      }
    }
  })

  it('removes a game-verified candidate from the pool after its third Affinity or fourth Element', () => {
    // Long Sword elemental pool [6, 4, 7, 8]: raw values are chosen so each slot picks a known index.
    // Slots 1..3 pick Affinity (index 3 of a 4-candidate pool); the 3rd Affinity removes it, so slot 4
    // with raw value 3 now wraps onto a 3-candidate pool and selects index 0 (Attack), never Affinity.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [3, 3, 3, 3, 3],
      GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES,
    )).toEqual([8, 8, 8, 6, 6])
    // The same raw values against the pinned reference pool keep Affinity at 5 and draw it five times.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [3, 3, 3, 3, 3],
      REFERENCE_NORMAL_ELEMENTAL_CANDIDATES,
    )).toEqual([8, 8, 8, 8, 8])

    // Slots 1..4 pick Element (index 1); the 4th Element removes it, so slot 5 with raw value 1
    // selects index 1 of the remaining [6, 7, 8] pool, which is family 7, never a fifth Element.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [1, 1, 1, 1, 1],
      GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES,
    )).toEqual([4, 4, 4, 4, 7])
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [1, 1, 1, 1, 1],
      REFERENCE_NORMAL_ELEMENTAL_CANDIDATES,
    )).toEqual([4, 4, 4, 4, 4])

    // Attack still fills all five slots, and family 7 is still removed after its second draw.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [0, 0, 0, 0, 0],
      GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES,
    )).toEqual([6, 6, 6, 6, 6])
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [2, 2, 2, 2, 2],
      GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES,
    )).toEqual([7, 7, 8, 8, 8])
  })

  it('matches every independent raw five-slot golden from the pinned GARP.lua reference', () => {
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
    expect(GAME_VERIFIED_BOW_ELEMENTAL_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_AFFINITY])
    for (const vector of gameVerifiedBowElementalNormalVectors) {
      expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).not.toContain(7)
    }
  })

  it('matches every C4-C game-observed Normal result with no RNG change beyond the candidate pool', () => {
    for (const vectors of [
      gameVerifiedBowNoneNormalVectors,
      gameVerifiedLightBowgunFireNormalVectors,
      gameVerifiedLightBowgunNoneNormalVectors,
      gameVerifiedHeavyBowgunFireNormalVectors,
      gameVerifiedHeavyBowgunNoneNormalVectors,
      gameVerifiedLongSwordFireNormalVectors,
      gameVerifiedLongSwordNoneNormalVectors,
    ]) {
      for (const vector of vectors) {
        expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
        expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
      }
    }
  })

  it('uses exactly the eight observed game-verified pool contracts', () => {
    expect(GAME_VERIFIED_BOW_NONE_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_AFFINITY])
    expect(GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_FAMILY_7, GAME_AFFINITY])
    expect(GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_FAMILY_7, GAME_AFFINITY])
    expect(GAME_VERIFIED_LONG_SWORD_NONE_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_FAMILY_7, GAME_AFFINITY])
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.bow', 'element.none'))
      .toBe(GAME_VERIFIED_BOW_NONE_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.light_bowgun', 'element.fire'))
      .toBe(GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.light_bowgun', 'element.none'))
      .toBe(GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.heavy_bowgun', 'element.fire'))
      .toBe(GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.heavy_bowgun', 'element.none'))
      .toBe(GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.long_sword', 'element.fire'))
      .toBe(GAME_VERIFIED_LONG_SWORD_ELEMENTAL_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.long_sword', 'element.none'))
      .toBe(GAME_VERIFIED_LONG_SWORD_NONE_NORMAL_CANDIDATES)
  })

  it('keeps Light Bowgun Fire and none identical, with no Element family', () => {
    expect(gameVerifiedLightBowgunFireNormalVectors.map((vector) => vector.gameLotteryIds))
      .toEqual(gameVerifiedLightBowgunNoneNormalVectors.map((vector) => vector.gameLotteryIds))
    for (const vector of [...gameVerifiedLightBowgunFireNormalVectors, ...gameVerifiedLightBowgunNoneNormalVectors]) {
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).not.toContain(4)
    }
  })

  it('matches the HBG Fire/none counter 4-6 observations with no Element family', () => {
    expect(GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_FAMILY_7, GAME_AFFINITY])
    expect(gameVerifiedHeavyBowgunFireNormalVectors.map((vector) => vector.gameLotteryIds))
      .toEqual(gameVerifiedHeavyBowgunNoneNormalVectors.map((vector) => vector.gameLotteryIds))
    for (const vector of [...gameVerifiedHeavyBowgunFireNormalVectors, ...gameVerifiedHeavyBowgunNoneNormalVectors]) {
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
      expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).not.toContain(4)
    }
  })

  it('keeps HBG Fire reference elemental parity distinct from its game-verified pool', () => {
    for (const vector of gameVerifiedHeavyBowgunFireNormalVectors) {
      expect(predictReferenceNormalRaw(vector).referenceIds).not.toEqual(vector.gameLotteryIds)
    }
  })

  it('keeps Bow none free from Element and family 7', () => {
    for (const vector of gameVerifiedBowNoneNormalVectors) {
      const result = predictGameVerifiedNormalRaw(vector).referenceIds
      expect(result).not.toContain(4)
      expect(result).not.toContain(7)
    }
  })

  it('keeps both Long Sword conditions in reference parity', () => {
    for (const vector of [...gameVerifiedLongSwordFireNormalVectors, ...gameVerifiedLongSwordNoneNormalVectors]) {
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
      expect(predictReferenceNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
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

  it('rejects unobserved weapon types instead of returning a reference fallback as game-verified', () => {
    const input = gameVerifiedBowElementalNormalVectors[0]
    expect(() => predictGameVerifiedNormalRaw({ ...input, weaponTypeId: 'weapon.great_sword' }))
      .toThrow(UnsupportedGameVerifiedNormalPredictionError)
    expect(() => predictGameVerifiedNormalRaw({ ...input, weaponTypeId: 'weapon.sword_and_shield' }))
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
