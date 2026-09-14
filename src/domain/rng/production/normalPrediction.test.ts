import { describe, expect, it } from 'vitest'
import {
  gameVerifiedBowBlastNormalVectors,
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedBowNoneNormalVectors,
  gameVerifiedBowParalysisNormalVectors,
  gameVerifiedBowPoisonNormalVectors,
  gameVerifiedBowSleepNormalVectors,
  gameVerifiedHeavyBowgunFireNormalVectors,
  gameVerifiedHeavyBowgunNoneNormalVectors,
  gameVerifiedLightBowgunFireNormalVectors,
  gameVerifiedLightBowgunNoneNormalVectors,
  gameVerifiedLongSwordFireNormalVectors,
  gameVerifiedLongSwordNoneNormalVectors,
  gameVerifiedSwitchAxeFireNormalVectors,
  gameVerifiedSwitchAxeNoneNormalVectors,
} from '../../../test/fixtures/gameVerifiedNormalVectors'
import { referenceNormalVectors } from '../../../test/fixtures/referenceNormalVectors'
import {
  GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES,
  GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES,
  GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES,
  GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES,
  GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES,
  GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES,
  GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES,
  deriveNormalArtianSeed,
  gameVerifiedNormalCandidatesForWeaponAndElement,
  gameVerifiedNormalCandidatesForWeaponAndTableClass,
  isProductionMeleeNormalPoolWeaponType,
  normalArtianLotteryTableClassElementIds,
  normalArtianLotteryTableClassForWeaponAndElement,
  PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS,
  mapReferenceNormalResult,
  readReferenceRngBlock,
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
    expect(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES.find((c) => c.referenceId === 4)?.maximumOccurrences).toBe(4)
    expect(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES.find((c) => c.referenceId === 8)?.maximumOccurrences).toBe(3)
  })

  it('fixes the exact game-verified Production limits: Attack 5 / Element 4 / family 7 2 / Affinity 3', () => {
    const everyGamePool = [
      GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES,
      GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES,
      GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES,
      GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES,
      GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES,
      GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES,
      GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES,
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
      GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES,
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
      GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES,
    )).toEqual([4, 4, 4, 4, 7])
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [1, 1, 1, 1, 1],
      REFERENCE_NORMAL_ELEMENTAL_CANDIDATES,
    )).toEqual([4, 4, 4, 4, 4])

    // Attack still fills all five slots, and family 7 is still removed after its second draw.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [0, 0, 0, 0, 0],
      GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES,
    )).toEqual([6, 6, 6, 6, 6])
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      [2, 2, 2, 2, 2],
      GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES,
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
    expect(GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_AFFINITY])
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
    expect(GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_AFFINITY])
    expect(GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_FAMILY_7, GAME_AFFINITY])
    expect(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_FAMILY_7, GAME_AFFINITY])
    expect(GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_FAMILY_7, GAME_AFFINITY])
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.bow', 'element.none'))
      .toBe(GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.light_bowgun', 'element.fire'))
      .toBe(GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.light_bowgun', 'element.none'))
      .toBe(GAME_VERIFIED_LIGHT_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.heavy_bowgun', 'element.fire'))
      .toBe(GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.heavy_bowgun', 'element.none'))
      .toBe(GAME_VERIFIED_HEAVY_BOWGUN_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.long_sword', 'element.fire'))
      .toBe(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.long_sword', 'element.none'))
      .toBe(GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES)
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

  /*
   * Bow Table A / Table B (docs/RNG_REFERENCE_AUDIT.md 14.15). Fire, Blast,
   * Poison, Paralysis, Sleep, and none are direct game observations at Base
   * Seed 51231782 / Counter 0; Water / Thunder / Ice / Dragon sit on Table A
   * by category-level Production adoption and have no fixture.
   */
  const BOW_TABLE_A_ELEMENTS = [
    'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon', 'element.blast',
  ] as const
  const BOW_TABLE_B_ELEMENTS = ['element.none', 'element.poison', 'element.paralysis', 'element.sleep'] as const

  it('classifies every Bow element exhaustively into Table A or Table B and selects that table pool', () => {
    for (const elementId of BOW_TABLE_A_ELEMENTS) {
      expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.bow', elementId)).toBe('table_a')
      expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.bow', elementId))
        .toBe(GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES)
    }
    for (const elementId of BOW_TABLE_B_ELEMENTS) {
      expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.bow', elementId)).toBe('table_b')
      expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.bow', elementId))
        .toBe(GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES)
    }
    // The two sets partition the ten known elements; nothing is left unclassified.
    expect([...BOW_TABLE_A_ELEMENTS, ...BOW_TABLE_B_ELEMENTS].sort()).toEqual([
      'element.blast', 'element.dragon', 'element.fire', 'element.ice', 'element.none', 'element.paralysis',
      'element.poison', 'element.sleep', 'element.thunder', 'element.water',
    ])
    expect(normalArtianLotteryTableClassElementIds('weapon.bow', 'table_a')).toEqual([...BOW_TABLE_A_ELEMENTS])
    expect(normalArtianLotteryTableClassElementIds('weapon.bow', 'table_b')).toEqual([...BOW_TABLE_B_ELEMENTS])
    expect(GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_AFFINITY])
    expect(GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_AFFINITY])
    expect(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.bow', 'table_a')).toBe(GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.bow', 'table_b')).toBe(GAME_VERIFIED_BOW_TABLE_B_NORMAL_CANDIDATES)
    expect(() => normalArtianLotteryTableClassForWeaponAndElement('weapon.bow', 'element.unknown')).toThrow(RangeError)
    expect(() => gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.bow', 'table_c' as never)).toThrow(RangeError)
  })

  it('reproduces every direct Bow Table A / Table B game observation at Counter 0 (Fire / Blast on A, Poison / Paralysis / Sleep / none on B)', () => {
    const fire = gameVerifiedBowElementalNormalVectors[0]
    const none = gameVerifiedBowNoneNormalVectors[0]
    expect(fire.gameLotteryIds).toEqual([6, 6, 8, 4, 4])
    expect(none.gameLotteryIds).toEqual([8, 8, 6, 6, 8])
    const tableA = [fire, ...gameVerifiedBowBlastNormalVectors]
    const tableB = [none, ...gameVerifiedBowPoisonNormalVectors, ...gameVerifiedBowParalysisNormalVectors, ...gameVerifiedBowSleepNormalVectors]
    expect(tableA.map((vector) => vector.elementId)).toEqual(['element.fire', 'element.blast'])
    expect(tableB.map((vector) => vector.elementId)).toEqual(['element.none', 'element.poison', 'element.paralysis', 'element.sleep'])
    for (const vector of tableA) {
      expect(vector.normalCounter).toBe(0)
      expect(vector.gameLotteryIds).toEqual([6, 6, 8, 4, 4])
      expect(normalArtianLotteryTableClassForWeaponAndElement(vector.weaponTypeId, vector.elementId)).toBe('table_a')
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
      expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
    }
    for (const vector of tableB) {
      expect(vector.normalCounter).toBe(0)
      expect(vector.gameLotteryIds).toEqual([8, 8, 6, 6, 8])
      expect(normalArtianLotteryTableClassForWeaponAndElement(vector.weaponTypeId, vector.elementId)).toBe('table_b')
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
      expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).not.toContain(4)
    }
    // The former single elemental pool would have drawn Element for Poison at
    // this Counter; the same raw block against the Table A pool shows the
    // defect the Table B classification corrects.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      readReferenceRngBlock(deriveNormalArtianSeed(51231782, 'weapon.bow', 8), 0).values,
      GAME_VERIFIED_BOW_TABLE_A_NORMAL_CANDIDATES,
    )).toEqual([6, 6, 8, 4, 4])
  })

  it('keeps the Normal seed element-free: every Bow element shares one Counter and differs only by table pool', () => {
    for (let normalCounter = 0; normalCounter < 50; normalCounter += 1) {
      const at = (elementId: string) => predictGameVerifiedNormalRaw({
        baseSeed: 51231782, weaponTypeId: 'weapon.bow', elementId, rarity: 8, normalCounter,
      }).referenceIds
      const tableA = at('element.fire')
      const tableB = at('element.none')
      for (const elementId of BOW_TABLE_A_ELEMENTS) expect(at(elementId)).toEqual(tableA)
      for (const elementId of BOW_TABLE_B_ELEMENTS) expect(at(elementId)).toEqual(tableB)
    }
  })

  it('keeps the Melee and Bowgun table classification at none versus any attribute, untouched by the Bow split', () => {
    const attributes = [
      'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon',
      'element.poison', 'element.paralysis', 'element.sleep', 'element.blast',
    ] as const
    for (const weaponTypeId of ['weapon.light_bowgun', 'weapon.heavy_bowgun', 'weapon.long_sword', 'weapon.great_sword', 'weapon.insect_glaive'] as const) {
      expect(normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, 'element.none')).toBe('table_b')
      for (const elementId of attributes) {
        expect(normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, elementId)).toBe('table_a')
      }
      expect(normalArtianLotteryTableClassElementIds(weaponTypeId, 'table_b')).toEqual(['element.none'])
    }
    // Both Bowgun tables draw the same pool, so the class changes nothing there.
    for (const weaponTypeId of ['weapon.light_bowgun', 'weapon.heavy_bowgun'] as const) {
      expect(gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, 'table_a'))
        .toBe(gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, 'table_b'))
    }
    expect(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.long_sword', 'table_a')).toBe(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES)
    expect(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.long_sword', 'table_b')).toBe(GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES)
    // Switch Axe classifies the same way as an observation adapter, but both
    // classes read its one single pool (docs/RNG_REFERENCE_AUDIT.md 14.16).
    expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.switch_axe', 'element.none')).toBe('table_b')
    expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.switch_axe', 'element.poison')).toBe('table_a')
    expect(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.switch_axe', 'table_a'))
      .toBe(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.switch_axe', 'table_b'))
    expect(() => normalArtianLotteryTableClassForWeaponAndElement('weapon.unknown', 'element.fire')).toThrow(RangeError)
  })

  /*
   * Melee category (docs/RNG_REFERENCE_AUDIT.md 14.14). Long Sword and the
   * elemental pool of Great Sword / Dual Blades / Hammer / Charge Blade are
   * directly game-verified; the other five melee weapons and the elementless
   * pool of those four are category-level Production adoption. Switch Axe is
   * deliberately not in the category.
   */
  const MELEE_WEAPON_TYPES = [
    'weapon.great_sword', 'weapon.sword_and_shield', 'weapon.dual_blades', 'weapon.long_sword',
    'weapon.hammer', 'weapon.hunting_horn', 'weapon.lance', 'weapon.gunlance',
    'weapon.charge_blade', 'weapon.insect_glaive',
  ] as const
  const ATTRIBUTE_PRESENT_ELEMENTS = [
    'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon',
    'element.poison', 'element.paralysis', 'element.sleep', 'element.blast',
  ] as const

  it('defines the Melee allow-list as exactly the ten melee weapon types without Switch Axe', () => {
    expect([...PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS].sort()).toEqual([...MELEE_WEAPON_TYPES].sort())
    for (const weaponTypeId of MELEE_WEAPON_TYPES) expect(isProductionMeleeNormalPoolWeaponType(weaponTypeId)).toBe(true)
    for (const weaponTypeId of ['weapon.switch_axe', 'weapon.bow', 'weapon.light_bowgun', 'weapon.heavy_bowgun', 'weapon.unknown']) {
      expect(isProductionMeleeNormalPoolWeaponType(weaponTypeId)).toBe(false)
    }
  })

  it('draws every Melee weapon type from the shared [6, 4, 7, 8] elemental and [6, 7, 8] elementless pools', () => {
    expect(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_FAMILY_7, GAME_AFFINITY])
    expect(GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_FAMILY_7, GAME_AFFINITY])
    for (const weaponTypeId of MELEE_WEAPON_TYPES) {
      for (const elementId of ATTRIBUTE_PRESENT_ELEMENTS) {
        expect(gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, elementId))
          .toBe(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES)
      }
      expect(gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, 'element.none'))
        .toBe(GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES)
    }
  })

  it('keeps the Melee pools distinct from the reference parity pools for every Melee weapon type', () => {
    // Same PRNG, seed derivation, and block; only the occurrence limits differ
    // (Element 4 / Affinity 3 versus the reference Element 5 / Affinity 5).
    // While the reference block stays below the Production limits the two
    // pools never shrink differently, so the results agree; once a block
    // reaches a third Affinity or a fourth Element with a draw still to come,
    // the Production pool has already dropped that candidate and the results
    // diverge. Every Melee weapon type must show both regions.
    for (const weaponTypeId of MELEE_WEAPON_TYPES) {
      let diverged = false
      let agreed = false
      for (let normalCounter = 0; normalCounter < 400; normalCounter += 1) {
        const input = { baseSeed: 51231782, weaponTypeId, elementId: 'element.fire', rarity: 8 as const, normalCounter }
        const reference = predictReferenceNormalRaw(input).referenceIds
        const production = predictGameVerifiedNormalRaw(input).referenceIds
        expect(production.filter((id) => id === 4).length).toBeLessThanOrEqual(4)
        expect(production.filter((id) => id === 8).length).toBeLessThanOrEqual(3)
        const belowLimits = reference.filter((id) => id === 4).length <= 3 && reference.filter((id) => id === 8).length <= 2
        if (belowLimits) {
          expect(production).toEqual(reference)
          agreed = true
        } else if (production.join(',') !== reference.join(',')) {
          diverged = true
        }
      }
      expect(agreed).toBe(true)
      expect(diverged).toBe(true)
    }
  })

  it('rejects unknown weapon types and unknown table classes instead of returning a reference fallback as game-verified', () => {
    // An unknown weapon type is the adapter's RangeError, never an implicit Melee member.
    expect(() => gameVerifiedNormalCandidatesForWeaponAndElement('weapon.unknown', 'element.fire')).toThrow(RangeError)
    expect(() => predictGameVerifiedNormalRaw({ ...gameVerifiedBowElementalNormalVectors[0], weaponTypeId: 'weapon.unknown' })).toThrow(RangeError)
    expect(() => gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.switch_axe', 'table_c' as never)).toThrow(RangeError)
    // The fail-closed error type stays in place for a future weapon type without a Production pool.
    expect(new UnsupportedGameVerifiedNormalPredictionError('weapon.future', 'table_a')).toBeInstanceOf(Error)
  })

  /*
   * Switch Axe single pool (docs/RNG_REFERENCE_AUDIT.md 14.16, 2026-09-15).
   * Direct game observation at Base Seed 51231782: Fire Counter 0 and the
   * all-different-parts (none) Counter 0 both drew [7, 7, 8, 6, 4], and the
   * consecutive none Counter 1 drew [8, 6, 4, 4, 6]. Pool membership and
   * configuration independence are direct observations; the occurrence
   * limits are category-level adoption.
   */
  const SWITCH_AXE_EVERY_ELEMENT = ['element.none', ...ATTRIBUTE_PRESENT_ELEMENTS] as const

  it('keeps Switch Axe out of the Melee allow-list while drawing its own single pool [6, 4, 7, 8] on both table classes', () => {
    expect(GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES).toEqual([GAME_ATTACK, GAME_ELEMENT, GAME_FAMILY_7, GAME_AFFINITY])
    // Equal values, separate contract: the Switch Axe pool is never the Melee Table A constant.
    expect(GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES).not.toBe(GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES)
    expect(isProductionMeleeNormalPoolWeaponType('weapon.switch_axe')).toBe(false)
    expect(PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS.has('weapon.switch_axe')).toBe(false)
    for (const tableClass of ['table_a', 'table_b'] as const) {
      expect(gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.switch_axe', tableClass))
        .toBe(GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES)
    }
    // Every exact element is supported and classified as an observation adapter only:
    // none is Table B, every attribute is Table A, and both read the one pool.
    for (const elementId of SWITCH_AXE_EVERY_ELEMENT) {
      expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.switch_axe', elementId))
        .toBe(elementId === 'element.none' ? 'table_b' : 'table_a')
      expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.switch_axe', elementId))
        .toBe(GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES)
    }
    expect(normalArtianLotteryTableClassElementIds('weapon.switch_axe', 'table_b')).toEqual(['element.none'])
    expect(normalArtianLotteryTableClassElementIds('weapon.switch_axe', 'table_a')).toEqual([...ATTRIBUTE_PRESENT_ELEMENTS])
  })

  it('reproduces the direct Switch Axe game observations: Fire C0 [7, 7, 8, 6, 4], none C0 [7, 7, 8, 6, 4], none C1 [8, 6, 4, 4, 6]', () => {
    const fire = gameVerifiedSwitchAxeFireNormalVectors[0]
    const [noneC0, noneC1] = gameVerifiedSwitchAxeNoneNormalVectors
    expect(fire.normalCounter).toBe(0)
    expect(noneC0.normalCounter).toBe(0)
    expect(noneC1.normalCounter).toBe(1)
    expect(fire.gameLotteryIds).toEqual([7, 7, 8, 6, 4])
    expect(noneC0.gameLotteryIds).toEqual([7, 7, 8, 6, 4])
    expect(noneC1.gameLotteryIds).toEqual([8, 6, 4, 4, 6])
    for (const vector of [fire, noneC0, noneC1]) {
      expect(predictGameVerifiedNormalRaw(vector).referenceIds).toEqual(vector.gameLotteryIds)
      expect(predictGameVerifiedNormalArtian(vector)).toEqual(vector.bonuses)
    }
    // The elementless configuration drew Element: a Melee Table B pool [6, 7, 8]
    // could never have produced it, which is what rules the Melee split out.
    expect(selectReferenceNormalLotteryIdsFromRawValues(
      readReferenceRngBlock(deriveNormalArtianSeed(51231782, 'weapon.switch_axe', 8), 0).values,
      GAME_VERIFIED_MELEE_NONE_NORMAL_CANDIDATES,
    )).not.toEqual(noneC0.gameLotteryIds)
    expect(noneC0.gameLotteryIds).toContain(4)
  })

  it('keeps the Normal seed element-free for Switch Axe: every configuration shares one raw result at every Counter', () => {
    for (let normalCounter = 0; normalCounter < 50; normalCounter += 1) {
      const at = (elementId: string) => predictGameVerifiedNormalRaw({
        baseSeed: 51231782, weaponTypeId: 'weapon.switch_axe', elementId, rarity: 8, normalCounter,
      }).referenceIds
      const fire = at('element.fire')
      for (const elementId of SWITCH_AXE_EVERY_ELEMENT) expect(at(elementId)).toEqual(fire)
      for (const id of fire) expect([6, 4, 7, 8]).toContain(id)
      expect(fire.filter((id) => id === 4).length).toBeLessThanOrEqual(4)
      expect(fire.filter((id) => id === 7).length).toBeLessThanOrEqual(2)
      expect(fire.filter((id) => id === 8).length).toBeLessThanOrEqual(3)
    }
  })

  it('keeps the Switch Axe Production pool distinct from the reference parity pools', () => {
    // The reference none / non-none split stays the pinned parity contract and
    // is never consulted for the Switch Axe Production pool: the reference
    // none pool has no Element, and the reference elemental pool caps Element
    // and Affinity at 5 instead of 4 / 3.
    expect(REFERENCE_NORMAL_NONE_CANDIDATES.map(({ referenceId }) => referenceId)).not.toContain(4)
    expect(referenceNormalCandidatesForElement('element.none')).toBe(REFERENCE_NORMAL_NONE_CANDIDATES)
    const none = gameVerifiedSwitchAxeNoneNormalVectors[0]
    expect(predictReferenceNormalRaw(none).referenceIds).not.toEqual(none.gameLotteryIds)
    expect(GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES).not.toEqual(REFERENCE_NORMAL_ELEMENTAL_CANDIDATES)
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
