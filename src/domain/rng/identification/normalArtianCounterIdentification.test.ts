import { describe, expect, it, vi } from 'vitest'
import type { ElementId, RestorationBonusSet, WeaponTypeId } from '../../models/publicTypes'
import {
  gameVerifiedBowBlastNormalVectors,
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedBowNoneNormalVectors,
  gameVerifiedBowParalysisNormalVectors,
  gameVerifiedBowPoisonNormalVectors,
  gameVerifiedBowSleepNormalVectors,
  gameVerifiedHeavyBowgunFireNormalVectors,
  gameVerifiedHeavyBowgunNoneNormalVectors,
  gameVerifiedLongSwordFireNormalVectors,
  gameVerifiedLongSwordNoneNormalVectors,
} from '../../../test/fixtures/gameVerifiedNormalVectors'
import type { RngEngine } from '../rngEngine'
import { ProductionRngEngine } from '../production/productionRngEngine'
import {
  gameVerifiedNormalCandidatesForWeaponAndElement,
  gameVerifiedNormalCandidatesForWeaponAndTableClass,
  normalArtianLotteryTableClassForWeaponAndElement,
} from '../production/gameNormalBonuses'
import {
  mapReferenceNormalResult,
  referenceNormalIdFromRestorationBonus,
} from '../production/referenceNormalBonuses'
import { REFERENCE_RNG_BLOCK_SIZE } from '../production/referencePrng'
import {
  getNormalArtianCounterIdentificationSupport,
  identifyNormalArtianCounter,
  normalArtianCounterObservationBonusOptions,
  normalArtianLotteryTableClassSupportQueryElementId,
} from './normalArtianCounterIdentification'
import {
  MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER,
  NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES,
  NormalArtianCounterIdentificationError,
  type NormalArtianCounterIdentificationInput,
  type NormalArtianCounterObservation,
  type NormalArtianLotteryTableClass,
} from './normalArtianCounterIdentificationTypes'

const ATTRIBUTE_PRESENT_ELEMENTS: readonly ElementId[] = [
  'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon',
  'element.poison', 'element.paralysis', 'element.sleep', 'element.blast',
]
const BOW_TABLE_A_ELEMENTS: readonly ElementId[] = [
  'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon', 'element.blast',
]
const BOW_TABLE_B_ELEMENTS: readonly ElementId[] = [
  'element.none', 'element.poison', 'element.paralysis', 'element.sleep',
]
/**
 * Melee category (docs/RNG_REFERENCE_AUDIT.md 14.14): Long Sword and the
 * elemental pool of Great Sword / Dual Blades / Hammer / Charge Blade are
 * directly game-verified; Sword and Shield / Hunting Horn / Lance / Gunlance /
 * Insect Glaive and the elementless pool of those four are category-level
 * Production adoption. Switch Axe is deliberately outside the category.
 */
const DIRECTLY_VERIFIED_MELEE_WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.great_sword', 'weapon.dual_blades', 'weapon.hammer', 'weapon.charge_blade',
]
const CATEGORY_ADOPTED_MELEE_WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.sword_and_shield', 'weapon.hunting_horn', 'weapon.lance', 'weapon.gunlance',
  'weapon.insect_glaive',
]
const MELEE_WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.long_sword', ...DIRECTLY_VERIFIED_MELEE_WEAPON_TYPES, ...CATEGORY_ADOPTED_MELEE_WEAPON_TYPES,
]
const SUPPORTED_WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.bow', 'weapon.light_bowgun', 'weapon.heavy_bowgun', ...MELEE_WEAPON_TYPES,
]
const HBG_BASE_SEED = String(gameVerifiedHeavyBowgunFireNormalVectors[0].baseSeed)
const BOW_BASE_SEED = String(gameVerifiedBowElementalNormalVectors[0].baseSeed)

/** Reuses game-observed fixture rows as ordered consecutive observations. */
function fixtureObservations(
  vectors: readonly {
    readonly weaponTypeId: WeaponTypeId
    readonly elementId: ElementId
    readonly bonuses: RestorationBonusSet
  }[],
): NormalArtianCounterObservation[] {
  return vectors.map((vector) => ({
    tableClass: normalArtianLotteryTableClassForWeaponAndElement(vector.weaponTypeId, vector.elementId),
    bonuses: vector.bonuses,
  }))
}

function hbgInput(
  observations: readonly NormalArtianCounterObservation[] = fixtureObservations(
    gameVerifiedHeavyBowgunFireNormalVectors,
  ),
  startInclusive = 0,
  endInclusive = 5_000,
): NormalArtianCounterIdentificationInput {
  return {
    baseSeed: HBG_BASE_SEED,
    weaponTypeId: 'weapon.heavy_bowgun',
    rarity: 8,
    observations,
    normalCounterRange: { startInclusive, endInclusive },
  }
}

function bowInput(
  observations: readonly NormalArtianCounterObservation[],
  startInclusive = 0,
  endInclusive = 5_000,
): NormalArtianCounterIdentificationInput {
  return {
    baseSeed: BOW_BASE_SEED,
    weaponTypeId: 'weapon.bow',
    rarity: 8,
    observations,
    normalCounterRange: { startInclusive, endInclusive },
  }
}

/** Builds observations from the Production authority itself at consecutive Counters. */
function predictedObservations(
  engine: ProductionRngEngine,
  baseSeed: string,
  weaponTypeId: WeaponTypeId,
  elementIds: readonly ElementId[],
  startCounter: number,
): NormalArtianCounterObservation[] {
  return elementIds.map((elementId, offset) => ({
    tableClass: normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, elementId),
    bonuses: engine.predictNormalArtian({
      baseSeed,
      weaponTypeId,
      elementId,
      rarity: 8,
      normalCounter: startCounter + offset,
      master: { weaponBonusDefinitions: [], bonusRanks: [] },
    }),
  }))
}

describe('Normal Artian lottery table class', () => {
  it('classifies the Bow into Table A (fire / water / thunder / ice / dragon / blast) and Table B (none / poison / paralysis / sleep)', () => {
    expect(NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES).toEqual(['table_a', 'table_b'])
    for (const elementId of BOW_TABLE_A_ELEMENTS) {
      expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.bow', elementId)).toBe('table_a')
    }
    for (const elementId of BOW_TABLE_B_ELEMENTS) {
      expect(normalArtianLotteryTableClassForWeaponAndElement('weapon.bow', elementId)).toBe('table_b')
    }
    expect([...BOW_TABLE_A_ELEMENTS, ...BOW_TABLE_B_ELEMENTS]).toHaveLength(10)
    expect(() => normalArtianLotteryTableClassForWeaponAndElement('weapon.bow', 'element.unknown')).toThrow(RangeError)
  })

  it('keeps Melee and Bowgun classification at none versus any attribute', () => {
    for (const weaponTypeId of ['weapon.light_bowgun', 'weapon.heavy_bowgun', ...MELEE_WEAPON_TYPES]) {
      expect(normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, 'element.none')).toBe('table_b')
      for (const elementId of ATTRIBUTE_PRESENT_ELEMENTS) {
        expect(normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, elementId)).toBe('table_a')
      }
    }
  })

  it('selects, for every supported weapon type and element, exactly the pool of that element\'s table class', () => {
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      for (const elementId of ['element.none', ...ATTRIBUTE_PRESENT_ELEMENTS]) {
        const tableClass = normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, elementId)
        expect(gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, elementId))
          .toBe(gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, tableClass))
      }
      // The support-query representative of each table selects that same table's pool.
      for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
        const representative = normalArtianLotteryTableClassSupportQueryElementId(tableClass)
        expect(normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, representative)).toBe(tableClass)
        expect(gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, representative))
          .toBe(gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, tableClass))
      }
    }
    expect(normalArtianLotteryTableClassSupportQueryElementId('table_a')).toBe('element.fire')
    expect(normalArtianLotteryTableClassSupportQueryElementId('table_b')).toBe('element.none')
  })

  it('keeps the support-query representative element out of the input, result, and observation contract', async () => {
    const input = hbgInput()
    expect(input).not.toHaveProperty('elementId')
    for (const observation of input.observations) expect(observation).not.toHaveProperty('elementId')
    const result = await identifyNormalArtianCounter(input, new ProductionRngEngine())
    expect(JSON.stringify(result)).not.toContain('element.')
    expect(JSON.stringify(input)).not.toContain('element.')
  })
})

describe('reference Normal lottery ID reverse mapping', () => {
  it('inverts mapReferenceNormalResult per slot for melee, Bowgun, and Bow', () => {
    for (const [weaponTypeId, referenceIds] of [
      ['weapon.long_sword', [6, 4, 7, 8, 6]],
      ['weapon.heavy_bowgun', [6, 4, 7, 8, 6]],
      ['weapon.bow', [6, 4, 8, 4, 6]],
    ] as const) {
      const mapped = mapReferenceNormalResult(weaponTypeId, referenceIds)
      if (mapped.kind !== 'mapped') throw new Error('expected a mapped result')
      expect(mapped.bonuses.map((bonus) => referenceNormalIdFromRestorationBonus(weaponTypeId, bonus)))
        .toEqual(referenceIds)
    }
  })

  it('rejects bonuses the Normal lottery of that weapon type can never produce', () => {
    const base = { bonusRankId: 'bonus_rank.base' }
    expect(() => referenceNormalIdFromRestorationBonus('weapon.bow', { bonusTypeId: 'bonus_type.normal_sharpness', ...base })).toThrow(RangeError)
    expect(() => referenceNormalIdFromRestorationBonus('weapon.long_sword', { bonusTypeId: 'bonus_type.normal_capacity', ...base })).toThrow(RangeError)
    expect(() => referenceNormalIdFromRestorationBonus('weapon.heavy_bowgun', { bonusTypeId: 'bonus_type.normal_sharpness', ...base })).toThrow(RangeError)
    expect(() => referenceNormalIdFromRestorationBonus('weapon.long_sword', { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' })).toThrow(RangeError)
    expect(() => referenceNormalIdFromRestorationBonus('weapon.long_sword', { bonusTypeId: 'bonus_type.unknown', ...base })).toThrow(RangeError)
    expect(() => referenceNormalIdFromRestorationBonus('weapon.unknown', { bonusTypeId: 'bonus_type.attack', ...base })).toThrow(RangeError)
  })
})

describe('Normal Artian Counter Identification HBG live golden', () => {
  it('identifies the audited unique start Counter 4 from the three live HBG forges over 0..5000', async () => {
    expect(gameVerifiedHeavyBowgunFireNormalVectors.map((vector) => vector.normalCounter)).toEqual([4, 5, 6])
    await expect(identifyNormalArtianCounter(hbgInput(), new ProductionRngEngine())).resolves.toEqual({
      matches: [{ startNormalCounter: 4 }],
      searchedCounterRange: { startInclusive: 0, endInclusive: 5_000 },
      isTruncated: false,
    })
  })

  it('reaches the same unique Counter 4 from the elementless HBG fixture with Table B', async () => {
    const observations = fixtureObservations(gameVerifiedHeavyBowgunNoneNormalVectors)
    expect(observations.map((observation) => observation.tableClass)).toEqual(['table_b', 'table_b', 'table_b'])
    await expect(identifyNormalArtianCounter(hbgInput(observations), new ProductionRngEngine())).resolves.toEqual({
      matches: [{ startNormalCounter: 4 }],
      searchedCounterRange: { startInclusive: 0, endInclusive: 5_000 },
      isTruncated: false,
    })
  })

  it('narrows from many candidates with one observation to Counter 4 alone with two or three', async () => {
    const engine = new ProductionRngEngine()
    const fire = fixtureObservations(gameVerifiedHeavyBowgunFireNormalVectors)
    const one = await identifyNormalArtianCounter(hbgInput(fire.slice(0, 1)), engine)
    expect(one.matches.slice(0, 3)).toEqual([
      { startNormalCounter: 4 },
      { startNormalCounter: 189 },
      { startNormalCounter: 227 },
    ])
    expect(one.matches).toHaveLength(19)
    for (const observationCount of [2, 3]) {
      const result = await identifyNormalArtianCounter(hbgInput(fire.slice(0, observationCount)), engine)
      expect(result.matches).toEqual([{ startNormalCounter: 4 }])
    }
    const twoWide = await identifyNormalArtianCounter(hbgInput(fire.slice(0, 2), 0, 100_000), engine)
    expect(twoWide.matches.map((match) => match.startNormalCounter))
      .toEqual([4, 23_662, 36_383, 59_681, 64_966, 65_023])
    const threeWide = await identifyNormalArtianCounter(hbgInput(fire, 0, 100_000), engine)
    expect(threeWide.matches).toEqual([{ startNormalCounter: 4 }])
  })
})

describe('Normal Artian Counter Identification Bow Table A / Table B golden', () => {
  it('matches the direct Table A Counter 0 observation [Attack, Attack, Affinity, Element, Element] at C = 0', async () => {
    const [blast] = fixtureObservations(gameVerifiedBowBlastNormalVectors)
    expect(blast!.tableClass).toBe('table_a')
    expect(blast!.bonuses.map((bonus) => bonus.bonusTypeId)).toEqual([
      'bonus_type.attack', 'bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element', 'bonus_type.element',
    ])
    // Blast and Fire are the same Table A observation at Counter 0.
    expect(blast!.bonuses).toEqual(gameVerifiedBowElementalNormalVectors[0].bonuses)
    const result = await identifyNormalArtianCounter(bowInput([blast!]), new ProductionRngEngine())
    expect(result.matches[0]).toEqual({ startNormalCounter: 0 })
    expect(result.isTruncated).toBe(false)
    await expect(identifyNormalArtianCounter(bowInput([blast!], 0, 0), new ProductionRngEngine()))
      .resolves.toMatchObject({ matches: [{ startNormalCounter: 0 }] })
  })

  it('matches the direct Table B Counter 0 observation [Affinity, Affinity, Attack, Attack, Affinity] at C = 0 for poison, paralysis, sleep, and none', async () => {
    const engine = new ProductionRngEngine()
    for (const vectors of [
      gameVerifiedBowPoisonNormalVectors,
      gameVerifiedBowParalysisNormalVectors,
      gameVerifiedBowSleepNormalVectors,
      gameVerifiedBowNoneNormalVectors.slice(0, 1),
    ]) {
      const [observation] = fixtureObservations(vectors)
      expect(observation!.tableClass).toBe('table_b')
      expect(observation!.bonuses.map((bonus) => bonus.bonusTypeId)).toEqual([
        'bonus_type.affinity', 'bonus_type.affinity', 'bonus_type.attack', 'bonus_type.attack', 'bonus_type.affinity',
      ])
      const result = await identifyNormalArtianCounter(bowInput([observation!]), engine)
      expect(result.matches[0]).toEqual({ startNormalCounter: 0 })
      await expect(identifyNormalArtianCounter(bowInput([observation!], 0, 0), engine))
        .resolves.toMatchObject({ matches: [{ startNormalCounter: 0 }] })
    }
    // Declaring the same five slots as Table A selects the [6, 4, 8] pool, which
    // does not draw them at Counter 0: legal input, no match there.
    const [poison] = fixtureObservations(gameVerifiedBowPoisonNormalVectors)
    await expect(identifyNormalArtianCounter(bowInput([{ ...poison!, tableClass: 'table_a' }], 0, 0), engine))
      .resolves.toEqual({ matches: [], searchedCounterRange: { startInclusive: 0, endInclusive: 0 }, isTruncated: false })
  })

  it('accepts Table A and Table B observations mixed in one Bow identification on the one shared Counter', async () => {
    const engine = new ProductionRngEngine()
    // Direct game observations at consecutive Counters of the one Bow stream:
    // Blast (Table A) at 0, none (Table B) at 1, Fire (Table A) at 2.
    const mixedFixture = fixtureObservations([
      gameVerifiedBowBlastNormalVectors[0],
      gameVerifiedBowNoneNormalVectors[1],
      gameVerifiedBowElementalNormalVectors[2],
    ])
    expect(mixedFixture.map((observation) => observation.tableClass)).toEqual(['table_a', 'table_b', 'table_a'])
    const fromFixture = await identifyNormalArtianCounter(bowInput(mixedFixture), engine)
    expect(fromFixture.matches[0]).toEqual({ startNormalCounter: 0 })
    expect(fromFixture.isTruncated).toBe(false)

    // The same sequence generated by the Production authority at another Counter,
    // Table A / Table B / Table A / Table B, is identified there and only there.
    const start = 37
    const mixed = predictedObservations(
      engine, BOW_BASE_SEED, 'weapon.bow', ['element.thunder', 'element.paralysis', 'element.blast', 'element.sleep'], start,
    )
    expect(mixed.map((observation) => observation.tableClass)).toEqual(['table_a', 'table_b', 'table_a', 'table_b'])
    expect(mixed[1]!.bonuses).toEqual(engine.predictNormalArtian({
      baseSeed: BOW_BASE_SEED, weaponTypeId: 'weapon.bow', elementId: 'element.none', rarity: 8, normalCounter: start + 1,
      master: { weaponBonusDefinitions: [], bonusRanks: [] },
    }))
    const result = await identifyNormalArtianCounter(bowInput(mixed, 0, 500), engine)
    expect(result.matches).toEqual([{ startNormalCounter: start }])
    // Shifting the Table B observation by one Counter breaks the chain: one stream, no second Counter.
    const shifted = [mixed[0]!, predictedObservations(engine, BOW_BASE_SEED, 'weapon.bow', ['element.paralysis'], start + 2)[0]!, mixed[2]!, mixed[3]!]
    expect((await identifyNormalArtianCounter(bowInput(shifted, start, start), engine)).matches).toEqual([])
  })

  it('needs no concrete element: every Table A element of the Bow identifies the same Counter, and so does every Table B element', async () => {
    const engine = new ProductionRngEngine()
    for (const [tableClass, elementIds] of [['table_a', BOW_TABLE_A_ELEMENTS], ['table_b', BOW_TABLE_B_ELEMENTS]] as const) {
      const representative = normalArtianLotteryTableClassSupportQueryElementId(tableClass)
      for (const elementId of elementIds) {
        const observations = predictedObservations(engine, BOW_BASE_SEED, 'weapon.bow', [elementId, elementId], 3)
        expect(observations.every((observation) => observation.tableClass === tableClass)).toBe(true)
        expect(observations[0]!.bonuses).toEqual(
          engine.predictNormalArtian({
            baseSeed: BOW_BASE_SEED, weaponTypeId: 'weapon.bow', elementId: representative, rarity: 8, normalCounter: 3,
            master: { weaponBonusDefinitions: [], bonusRanks: [] },
          }),
        )
        const result = await identifyNormalArtianCounter(bowInput(observations, 0, 50), engine)
        expect(result.matches).toEqual([{ startNormalCounter: 3 }])
      }
    }
  })

  it('rejects a Bow Table B observation containing Element as invalid_input', async () => {
    const engine = new ProductionRngEngine()
    const base = { bonusRankId: 'bonus_rank.base' }
    const attack = { bonusTypeId: 'bonus_type.attack', ...base }
    const affinity = { bonusTypeId: 'bonus_type.affinity', ...base }
    const element = { bonusTypeId: 'bonus_type.element', ...base }
    const error = await identifyNormalArtianCounter(
      bowInput([{ tableClass: 'table_b', bonuses: [affinity, affinity, attack, element, affinity] }]),
      engine,
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
    expect(error).toMatchObject({ code: 'invalid_input', unsupportedReason: null })
    expect((error as Error).message).toContain('table_b')
    // The same slots are a legitimate Table A search.
    await expect(identifyNormalArtianCounter(
      bowInput([{ tableClass: 'table_a', bonuses: [affinity, affinity, attack, element, affinity] }]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
  })
})

describe('Normal Artian Counter Identification kernel', () => {
  it('matches Production predictNormalArtian across supported weapons, elements, and Counter positions', async () => {
    const engine = new ProductionRngEngine()
    const scenarios = [
      { weaponTypeId: 'weapon.bow', elementIds: ['element.thunder', 'element.thunder', 'element.thunder'], baseSeed: '51231782' },
      { weaponTypeId: 'weapon.bow', elementIds: ['element.none', 'element.poison'], baseSeed: '12345678' },
      { weaponTypeId: 'weapon.bow', elementIds: ['element.sleep', 'element.blast', 'element.paralysis'], baseSeed: '424242' },
      { weaponTypeId: 'weapon.light_bowgun', elementIds: ['element.blast', 'element.none', 'element.water'], baseSeed: '99999999' },
      { weaponTypeId: 'weapon.heavy_bowgun', elementIds: ['element.none', 'element.dragon'], baseSeed: '0' },
      { weaponTypeId: 'weapon.long_sword', elementIds: ['element.poison', 'element.sleep', 'element.ice'], baseSeed: '8524433' },
      { weaponTypeId: 'weapon.long_sword', elementIds: ['element.none', 'element.fire'], baseSeed: '51231782' },
    ] as const
    for (let sample = 0; sample < 42; sample += 1) {
      const scenario = scenarios[sample % scenarios.length]!
      const counter = sample * 337
      const observations = predictedObservations(
        engine, scenario.baseSeed, scenario.weaponTypeId, scenario.elementIds, counter,
      )
      const result = await identifyNormalArtianCounter({
        baseSeed: scenario.baseSeed,
        weaponTypeId: scenario.weaponTypeId,
        rarity: 8,
        observations,
        normalCounterRange: { startInclusive: counter, endInclusive: counter },
      }, engine)
      expect(result.matches).toEqual([{ startNormalCounter: counter }])
    }
  })

  it('requires the exact ordered five slots and treats a reordered result as no match', async () => {
    const engine = new ProductionRngEngine()
    const [observation] = predictedObservations(engine, '51231782', 'weapon.long_sword', ['element.fire'], 0)
    const exact = await identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: [observation!],
      normalCounterRange: { startInclusive: 0, endInclusive: 0 },
    }, engine)
    expect(exact.matches).toEqual([{ startNormalCounter: 0 }])
    expect(observation!.bonuses).toEqual(gameVerifiedLongSwordFireNormalVectors[0].bonuses)

    const slots = observation!.bonuses
    expect(slots[0]).not.toEqual(slots[1])
    const reordered = [slots[1], slots[0], slots[2], slots[3], slots[4]] as RestorationBonusSet
    const swapped = await identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: [{ tableClass: 'table_a', bonuses: reordered }],
      normalCounterRange: { startInclusive: 0, endInclusive: 0 },
    }, engine)
    expect(swapped).toEqual({
      matches: [],
      searchedCounterRange: { startInclusive: 0, endInclusive: 0 },
      isTruncated: false,
    })
  })

  it('maps consecutive observations to C, C + 1, C + 2 without sorting them', async () => {
    const engine = new ProductionRngEngine()
    const elements = ['element.fire', 'element.fire', 'element.fire'] as const
    const consecutive = predictedObservations(engine, '51231782', 'weapon.long_sword', elements, 10)
    const input = (observations: readonly NormalArtianCounterObservation[], start: number, end: number) => ({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword' as const,
      rarity: 8 as const,
      observations,
      normalCounterRange: { startInclusive: start, endInclusive: end },
    })
    expect((await identifyNormalArtianCounter(input(consecutive, 0, 20), engine)).matches)
      .toEqual([{ startNormalCounter: 10 }])
    const shifted = predictedObservations(engine, '51231782', 'weapon.long_sword', elements, 11)
    expect((await identifyNormalArtianCounter(input(shifted, 10, 10), engine)).matches).toEqual([])
    expect((await identifyNormalArtianCounter(input(shifted, 10, 11), engine)).matches)
      .toEqual([{ startNormalCounter: 11 }])
    const reversed = [consecutive[2]!, consecutive[1]!, consecutive[0]!]
    expect((await identifyNormalArtianCounter(input(reversed, 0, 20), engine)).matches).toEqual([])
  })

  it('draws each observation from the pool of its own table class', async () => {
    const engine = new ProductionRngEngine()
    const mixed = predictedObservations(
      engine, '51231782', 'weapon.long_sword', ['element.fire', 'element.none', 'element.fire'], 0,
    )
    expect(mixed.map((observation) => observation.tableClass))
      .toEqual(['table_a', 'table_b', 'table_a'])
    expect(mixed[1]!.bonuses).toEqual(gameVerifiedLongSwordNoneNormalVectors[1].bonuses)
    const result = await identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: mixed,
      normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
    }, engine)
    expect(result.matches).toEqual([{ startNormalCounter: 0 }])

    // The Fire slots contain Element, which the Table B pool cannot draw:
    // declaring them Table B is impossible input, not a zero-match search.
    const misclassified = mixed.map((observation) => ({ ...observation, tableClass: 'table_b' as const }))
    await expect(identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: misclassified,
      normalCounterRange: { startInclusive: 0, endInclusive: 0 },
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })

    // The Table B slots are producible by both pools, so declaring them Table A
    // is legal input that selects the other pool and no longer matches.
    expect(mixed[1]!.bonuses.some((bonus) => bonus.bonusTypeId === 'bonus_type.element')).toBe(false)
    expect(mixed[1]!.bonuses).not.toEqual(gameVerifiedLongSwordFireNormalVectors[1].bonuses)
    const otherPool = await identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: [{ ...mixed[1]!, tableClass: 'table_a' }],
      normalCounterRange: { startInclusive: 1, endInclusive: 1 },
    }, engine)
    expect(otherPool.matches).toEqual([])
  })

  it('needs no concrete element for Melee Table A observations of any attribute', async () => {
    const engine = new ProductionRngEngine()
    for (const elementId of ATTRIBUTE_PRESENT_ELEMENTS) {
      const observations = predictedObservations(engine, '51231782', 'weapon.long_sword', [elementId, elementId], 3)
      expect(observations.every((observation) => observation.tableClass === 'table_a')).toBe(true)
      expect(observations[0]!.bonuses).toEqual(
        engine.predictNormalArtian({
          baseSeed: '51231782',
          weaponTypeId: 'weapon.long_sword',
          elementId: 'element.fire',
          rarity: 8,
          normalCounter: 3,
          master: { weaponBonusDefinitions: [], bonusRanks: [] },
        }),
      )
      const result = await identifyNormalArtianCounter({
        baseSeed: '51231782',
        weaponTypeId: 'weapon.long_sword',
        rarity: 8,
        observations,
        normalCounterRange: { startInclusive: 0, endInclusive: 50 },
      }, engine)
      expect(result.matches).toEqual([{ startNormalCounter: 3 }])
    }
  })

  it('returns matches in ascending Counter order and identically across runs', async () => {
    const engine = new ProductionRngEngine()
    const observations = fixtureObservations(gameVerifiedHeavyBowgunFireNormalVectors).slice(0, 1)
    const first = await identifyNormalArtianCounter(hbgInput(observations, 0, 20_000), engine)
    const second = await identifyNormalArtianCounter(hbgInput(observations, 0, 20_000), engine)
    expect(second).toEqual(first)
    const counters = first.matches.map((match) => match.startNormalCounter)
    expect(counters).toEqual([...counters].sort((left, right) => left - right))
    expect(new Set(counters).size).toBe(counters.length)
    expect(first.matches.length).toBeGreaterThan(19)
  })

  it('stops at maxMatches, reports the completed prefix, and marks truncation only when Counters remain', async () => {
    const engine = new ProductionRngEngine()
    const one = fixtureObservations(gameVerifiedHeavyBowgunFireNormalVectors).slice(0, 1)
    await expect(identifyNormalArtianCounter({ ...hbgInput(one), maxMatches: 2 }, engine)).resolves.toEqual({
      matches: [{ startNormalCounter: 4 }, { startNormalCounter: 189 }],
      searchedCounterRange: { startInclusive: 0, endInclusive: 189 },
      isTruncated: true,
    })
    await expect(identifyNormalArtianCounter({ ...hbgInput(one, 0, 189), maxMatches: 2 }, engine)).resolves.toEqual({
      matches: [{ startNormalCounter: 4 }, { startNormalCounter: 189 }],
      searchedCounterRange: { startInclusive: 0, endInclusive: 189 },
      isTruncated: false,
    })
    await expect(identifyNormalArtianCounter({ ...hbgInput(one), maxMatches: 100 }, engine)).resolves.toMatchObject({
      searchedCounterRange: { startInclusive: 0, endInclusive: 5_000 },
      isTruncated: false,
    })
  })

  it('reports progress per completed chunk in starting Counters, not prediction calls', async () => {
    const onProgress = vi.fn()
    const result = await identifyNormalArtianCounter(hbgInput(), new ProductionRngEngine(), {
      onProgress,
      counterChunkSize: 1_000,
    })
    expect(result.matches).toEqual([{ startNormalCounter: 4 }])
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { searchedCounters: 1_000, totalCounters: 5_001, matchesFound: 1 },
      { searchedCounters: 2_000, totalCounters: 5_001, matchesFound: 1 },
      { searchedCounters: 3_000, totalCounters: 5_001, matchesFound: 1 },
      { searchedCounters: 4_000, totalCounters: 5_001, matchesFound: 1 },
      { searchedCounters: 5_000, totalCounters: 5_001, matchesFound: 1 },
      { searchedCounters: 5_001, totalCounters: 5_001, matchesFound: 1 },
    ])
  })

  it('yields between chunks and preserves typed cancellation', async () => {
    const yieldControl = vi.fn(() => Promise.resolve())
    await identifyNormalArtianCounter(hbgInput(), new ProductionRngEngine(), {
      yieldControl,
      counterChunkSize: 2_500,
    })
    expect(yieldControl).toHaveBeenCalledTimes(3)

    const error = await identifyNormalArtianCounter(hbgInput(), new ProductionRngEngine(), {
      shouldCancel: () => true,
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
    expect(error).toMatchObject({ code: 'cancelled', unsupportedReason: null })

    let chunks = 0
    const midway = await identifyNormalArtianCounter(hbgInput(), new ProductionRngEngine(), {
      counterChunkSize: 1_000,
      yieldControl: () => {
        chunks += 1
        return Promise.resolve()
      },
      shouldCancel: () => chunks >= 2,
    }).catch((caught: unknown) => caught)
    expect(midway).toMatchObject({ code: 'cancelled' })
  })

  it('rejects non-canonical Base Seeds and Counter ranges as invalid_input', async () => {
    const engine = new ProductionRngEngine()
    for (const baseSeed of ['051231782', '0x30DB2E6', '51231782 ', 'abc', '']) {
      await expect(identifyNormalArtianCounter({ ...hbgInput(), baseSeed }, engine))
        .rejects.toMatchObject({ code: 'invalid_input' })
    }
    for (const normalCounterRange of [
      { startInclusive: 5, endInclusive: 4 },
      { startInclusive: -1, endInclusive: 4 },
      { startInclusive: 0.5, endInclusive: 4 },
      { startInclusive: 0, endInclusive: Number.NaN },
      { startInclusive: 0, endInclusive: Number.MAX_SAFE_INTEGER + 2 },
      { startInclusive: 0, endInclusive: MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER + 1 },
    ]) {
      await expect(identifyNormalArtianCounter({ ...hbgInput(), normalCounterRange }, engine))
        .rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER)
      .toBe(Math.floor(Number.MAX_SAFE_INTEGER / REFERENCE_RNG_BLOCK_SIZE))
  })

  it('rejects empty, malformed, and impossible observations as invalid_input', async () => {
    const engine = new ProductionRngEngine()
    const valid = fixtureObservations(gameVerifiedHeavyBowgunFireNormalVectors)[0]!
    const base = { bonusRankId: 'bonus_rank.base' }
    const cases: readonly unknown[][] = [
      [],
      [{ ...valid, bonuses: valid.bonuses.slice(0, 4) }],
      [{ ...valid, bonuses: [...valid.bonuses, valid.bonuses[0]] }],
      [{ ...valid, bonuses: [{ bonusTypeId: 'bonus_type.attack' }, ...valid.bonuses.slice(1)] }],
      [{ ...valid, bonuses: [{ bonusTypeId: 'bonus_type.unknown', ...base }, ...valid.bonuses.slice(1)] }],
      [{ ...valid, bonuses: [{ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }, ...valid.bonuses.slice(1)] }],
      [{ ...valid, bonuses: [{ bonusTypeId: 'bonus_type.normal_sharpness', ...base }, ...valid.bonuses.slice(1)] }],
      [{ ...valid, tableClass: 'elemental' }],
      [{ ...valid, tableClass: 'attribute_present' }],
      [{ ...valid, tableClass: 'none' }],
      [{ ...valid, tableClass: 'element.fire' }],
      [{ bonuses: valid.bonuses }],
      [null],
    ]
    for (const observations of cases) {
      await expect(identifyNormalArtianCounter({
        ...hbgInput(),
        observations: observations as unknown as NormalArtianCounterObservation[],
      }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
    }
    await expect(identifyNormalArtianCounter({ ...hbgInput(), maxMatches: 0 }, engine))
      .rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyNormalArtianCounter({ ...hbgInput(), maxMatches: 1.5 }, engine))
      .rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rejects an observation the selected game-verified pool can never draw as invalid_input, not as zero matches', async () => {
    const engine = new ProductionRngEngine()
    const base = { bonusRankId: 'bonus_rank.base' }
    const attack = { bonusTypeId: 'bonus_type.attack', ...base }
    const affinity = { bonusTypeId: 'bonus_type.affinity', ...base }
    const element = { bonusTypeId: 'bonus_type.element', ...base }
    const capacity = { bonusTypeId: 'bonus_type.normal_capacity', ...base }
    const sharpness = { bonusTypeId: 'bonus_type.normal_sharpness', ...base }
    const at = (
      weaponTypeId: WeaponTypeId,
      tableClass: NormalArtianLotteryTableClass,
      bonuses: RestorationBonusSet,
    ): NormalArtianCounterIdentificationInput => ({
      baseSeed: HBG_BASE_SEED,
      weaponTypeId,
      rarity: 8,
      observations: [{ tableClass, bonuses }],
      normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
    })

    // Element is a legal Domain bonus, but absent from these pools: the input is impossible, not unmatched.
    const impossible: readonly [WeaponTypeId, NormalArtianLotteryTableClass, RestorationBonusSet][] = [
      ['weapon.heavy_bowgun', 'table_a', [element, attack, capacity, attack, attack]],
      ['weapon.heavy_bowgun', 'table_b', [attack, element, capacity, attack, affinity]],
      ['weapon.light_bowgun', 'table_a', [attack, attack, capacity, element, affinity]],
      ['weapon.long_sword', 'table_b', [sharpness, attack, element, sharpness, affinity]],
      ['weapon.bow', 'table_b', [affinity, affinity, attack, element, affinity]],
    ]
    for (const [weaponTypeId, tableClass, bonuses] of impossible) {
      const error = await identifyNormalArtianCounter(at(weaponTypeId, tableClass, bonuses), engine)
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
      expect(error).toMatchObject({ code: 'invalid_input', unsupportedReason: null })
      expect((error as Error).message).toContain(tableClass)
    }

    // The same Element slots are producible by the pools that do contain Element.
    await expect(identifyNormalArtianCounter(
      at('weapon.long_sword', 'table_a', [sharpness, attack, element, sharpness, affinity]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    await expect(identifyNormalArtianCounter(
      at('weapon.bow', 'table_a', [affinity, affinity, attack, element, affinity]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    expect(gameVerifiedLongSwordFireNormalVectors[0].bonuses).toEqual([sharpness, attack, affinity, attack, element])
  })

  it('rejects more occurrences of one candidate than its pool maximum, and accepts counts within it', async () => {
    const engine = new ProductionRngEngine()
    const base = { bonusRankId: 'bonus_rank.base' }
    const attack = { bonusTypeId: 'bonus_type.attack', ...base }
    const affinity = { bonusTypeId: 'bonus_type.affinity', ...base }
    const capacity = { bonusTypeId: 'bonus_type.normal_capacity', ...base }
    const sharpness = { bonusTypeId: 'bonus_type.normal_sharpness', ...base }
    const at = (
      weaponTypeId: WeaponTypeId,
      tableClass: NormalArtianLotteryTableClass,
      bonuses: RestorationBonusSet,
    ): NormalArtianCounterIdentificationInput => ({
      baseSeed: HBG_BASE_SEED,
      weaponTypeId,
      rarity: 8,
      observations: [{ tableClass, bonuses }],
      normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
    })
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.heavy_bowgun', 'element.none'))
      .toContainEqual({ referenceId: 7, maximumOccurrences: 2 })

    // Capacity (family 7) is capped at 2 in every Bowgun pool; a third is impossible.
    for (const weaponTypeId of ['weapon.heavy_bowgun', 'weapon.light_bowgun'] as const) {
      for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
        const error = await identifyNormalArtianCounter(
          at(weaponTypeId, tableClass, [capacity, attack, capacity, affinity, capacity]),
          engine,
        ).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
        expect(error).toMatchObject({ code: 'invalid_input', unsupportedReason: null })
        expect((error as Error).message).toContain('more than 2')
      }
    }
    await expect(identifyNormalArtianCounter(
      at('weapon.long_sword', 'table_b', [sharpness, sharpness, attack, sharpness, affinity]),
      engine,
    )).rejects.toMatchObject({ code: 'invalid_input' })

    // Exactly two of family 7, and five of a maximum-5 candidate, stay within the pool limits.
    await expect(identifyNormalArtianCounter(
      at('weapon.heavy_bowgun', 'table_b', [capacity, attack, capacity, affinity, attack]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    await expect(identifyNormalArtianCounter(
      at('weapon.heavy_bowgun', 'table_a', [attack, attack, attack, attack, attack]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    await expect(identifyNormalArtianCounter(
      at('weapon.long_sword', 'table_b', [sharpness, sharpness, attack, attack, affinity]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
  })

  it('applies the game-verified occurrence limits (Attack 5 / Element 4 / family 7 2 / Affinity 3) per weapon type', async () => {
    const engine = new ProductionRngEngine()
    const base = { bonusRankId: 'bonus_rank.base' }
    const attack = { bonusTypeId: 'bonus_type.attack', ...base }
    const affinity = { bonusTypeId: 'bonus_type.affinity', ...base }
    const element = { bonusTypeId: 'bonus_type.element', ...base }
    const capacity = { bonusTypeId: 'bonus_type.normal_capacity', ...base }
    const sharpness = { bonusTypeId: 'bonus_type.normal_sharpness', ...base }
    const at = (
      weaponTypeId: WeaponTypeId,
      tableClass: NormalArtianLotteryTableClass,
      bonuses: RestorationBonusSet,
    ): NormalArtianCounterIdentificationInput => ({
      baseSeed: HBG_BASE_SEED,
      weaponTypeId,
      rarity: 8,
      observations: [{ tableClass, bonuses }],
      normalCounterRange: { startInclusive: 0, endInclusive: 500 },
    })
    const expectProducible = async (input: NormalArtianCounterIdentificationInput): Promise<void> => {
      // Producible input is a legitimate search, whether or not any Counter in range matches.
      await expect(identifyNormalArtianCounter(input, engine)).resolves.toMatchObject({ isTruncated: false })
    }
    const expectImpossible = async (input: NormalArtianCounterIdentificationInput, limit: number): Promise<void> => {
      const error = await identifyNormalArtianCounter(input, engine).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
      expect(error).toMatchObject({ code: 'invalid_input', unsupportedReason: null })
      expect((error as Error).message).toContain(`more than ${limit}`)
    }

    // Long Sword / Table A: Element 4 valid, 5 impossible; Affinity 3 valid, 4 impossible;
    // Sharpness 2 valid, 3 impossible.
    await expectProducible(at('weapon.long_sword', 'table_a', [element, element, element, element, attack]))
    await expectImpossible(at('weapon.long_sword', 'table_a', [element, element, element, element, element]), 4)
    await expectProducible(at('weapon.long_sword', 'table_a', [affinity, affinity, affinity, attack, element]))
    await expectImpossible(at('weapon.long_sword', 'table_a', [affinity, affinity, affinity, affinity, attack]), 3)
    await expectProducible(at('weapon.long_sword', 'table_a', [sharpness, sharpness, attack, element, affinity]))
    await expectImpossible(at('weapon.long_sword', 'table_a', [sharpness, sharpness, sharpness, attack, element]), 2)
    // Long Sword / Table B keeps the same Affinity and Sharpness limits.
    await expectProducible(at('weapon.long_sword', 'table_b', [affinity, affinity, affinity, attack, attack]))
    await expectImpossible(at('weapon.long_sword', 'table_b', [affinity, affinity, affinity, affinity, attack]), 3)
    // Every other Melee weapon type shares the PR #33 limits through the same Melee pool.
    for (const weaponTypeId of MELEE_WEAPON_TYPES) {
      await expectProducible(at(weaponTypeId, 'table_a', [element, element, element, element, attack]))
      await expectImpossible(at(weaponTypeId, 'table_a', [element, element, element, element, element]), 4)
      await expectImpossible(at(weaponTypeId, 'table_a', [affinity, affinity, affinity, affinity, attack]), 3)
      await expectImpossible(at(weaponTypeId, 'table_a', [sharpness, sharpness, sharpness, attack, element]), 2)
      await expectProducible(at(weaponTypeId, 'table_b', [sharpness, sharpness, affinity, affinity, affinity]))
      await expectImpossible(at(weaponTypeId, 'table_b', [sharpness, sharpness, sharpness, attack, attack]), 2)
      await expectImpossible(at(weaponTypeId, 'table_b', [affinity, affinity, affinity, affinity, attack]), 3)
    }

    // Bow Table A: Element 4 valid, 5 impossible; Affinity 3 valid, 4 impossible.
    // Bow Table B: Affinity 3 valid, 4 impossible; Element never.
    await expectProducible(at('weapon.bow', 'table_a', [element, element, element, element, affinity]))
    await expectImpossible(at('weapon.bow', 'table_a', [element, element, element, element, element]), 4)
    await expectProducible(at('weapon.bow', 'table_a', [affinity, affinity, affinity, attack, element]))
    await expectImpossible(at('weapon.bow', 'table_a', [affinity, affinity, affinity, affinity, element]), 3)
    await expectProducible(at('weapon.bow', 'table_b', [affinity, affinity, affinity, attack, attack]))
    await expectImpossible(at('weapon.bow', 'table_b', [affinity, affinity, affinity, affinity, attack]), 3)

    // Bowguns: Capacity 2 valid, 3 impossible; Affinity 3 valid, 4 impossible.
    for (const weaponTypeId of ['weapon.light_bowgun', 'weapon.heavy_bowgun'] as const) {
      for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
        await expectProducible(at(weaponTypeId, tableClass, [capacity, capacity, attack, affinity, attack]))
        await expectImpossible(at(weaponTypeId, tableClass, [capacity, capacity, capacity, attack, affinity]), 2)
        await expectProducible(at(weaponTypeId, tableClass, [affinity, affinity, affinity, attack, capacity]))
        await expectImpossible(at(weaponTypeId, tableClass, [affinity, affinity, affinity, affinity, attack]), 3)
      }
    }

    // Attack alone may still fill all five slots in every pool.
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
        await expectProducible(at(weaponTypeId, tableClass, [attack, attack, attack, attack, attack]))
      }
    }
  })

  it('rejects any rarity other than 8 before touching the Engine', async () => {
    const engine = new ProductionRngEngine()
    const support = vi.spyOn(engine, 'getPredictionSupport')
    for (const rarity of [6, 7, 9]) {
      await expect(identifyNormalArtianCounter({ ...hbgInput(), rarity: rarity as 8 }, engine))
        .rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(support).not.toHaveBeenCalled()
  })

  it('rejects consecutive observations that would overflow the supported Counter range', async () => {
    const engine = new ProductionRngEngine()
    const two = fixtureObservations(gameVerifiedHeavyBowgunFireNormalVectors).slice(0, 2)
    const max = MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER
    await expect(identifyNormalArtianCounter(hbgInput(two, max, max), engine))
      .rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyNormalArtianCounter(hbgInput(two, max - 1, max - 1), engine))
      .resolves.toMatchObject({
        searchedCounterRange: { startInclusive: max - 1, endInclusive: max - 1 },
        isTruncated: false,
      })
    await expect(identifyNormalArtianCounter(hbgInput(two.slice(0, 1), max, max), engine))
      .resolves.toMatchObject({ searchedCounterRange: { startInclusive: max, endInclusive: max } })
  })

  it('accepts every Melee weapon type as searchable input for both table classes', async () => {
    const engine = new ProductionRngEngine()
    // Directly verified elemental streams: Great Sword / Dual Blades / Hammer /
    // Charge Blade at the Counters the 2026-09-14 audit recorded as current
    // (156 / 349 / 24 / 0). The repository holds no per-weapon slot sequence
    // fixture, so the observations come from the Production authority itself;
    // the test fixes the support boundary and the kernel / Engine agreement,
    // not a game-observed golden.
    const audited = [
      { weaponTypeId: 'weapon.great_sword', counter: 156 },
      { weaponTypeId: 'weapon.dual_blades', counter: 349 },
      { weaponTypeId: 'weapon.hammer', counter: 24 },
      { weaponTypeId: 'weapon.charge_blade', counter: 0 },
    ] as const
    for (const { weaponTypeId, counter } of audited) {
      const observations = predictedObservations(
        engine, HBG_BASE_SEED, weaponTypeId, ['element.fire', 'element.fire', 'element.fire'], counter,
      )
      expect(observations.every((observation) => observation.tableClass === 'table_a')).toBe(true)
      await expect(identifyNormalArtianCounter({
        ...hbgInput(observations),
        weaponTypeId,
      }, engine)).resolves.toMatchObject({
        matches: expect.arrayContaining([{ startNormalCounter: counter }]),
        isTruncated: false,
      })
    }
    // Category-level adoption: the remaining Melee weapons pass input support
    // for Table A and Table B alike, and Poison / Blast stay on the Melee Table A.
    for (const weaponTypeId of CATEGORY_ADOPTED_MELEE_WEAPON_TYPES) {
      for (const elementIds of [['element.thunder', 'element.ice'], ['element.poison', 'element.blast'], ['element.none', 'element.none']] as const) {
        const observations = predictedObservations(engine, '8524433', weaponTypeId, elementIds, 12)
        await expect(identifyNormalArtianCounter({
          baseSeed: '8524433',
          weaponTypeId,
          rarity: 8,
          observations,
          normalCounterRange: { startInclusive: 0, endInclusive: 200 },
        }, engine)).resolves.toMatchObject({
          matches: expect.arrayContaining([{ startNormalCounter: 12 }]),
          isTruncated: false,
        })
      }
    }
    // The Long Sword fixture rows are producible by the shared Melee pool of
    // every other Melee weapon type, so they are a legitimate search there.
    const longSwordRows = fixtureObservations(gameVerifiedLongSwordFireNormalVectors)
    for (const weaponTypeId of MELEE_WEAPON_TYPES) {
      await expect(identifyNormalArtianCounter({ ...hbgInput(longSwordRows), weaponTypeId }, engine))
        .resolves.toMatchObject({ isTruncated: false })
    }
  })

  it('fails closed with normal_pool_unverified for Switch Axe only, never treating it as Melee', async () => {
    const engine = new ProductionRngEngine()
    const observations = fixtureObservations(gameVerifiedLongSwordFireNormalVectors)
    const support = vi.spyOn(engine, 'getPredictionSupport')
    for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
      await expect(identifyNormalArtianCounter({
        ...hbgInput(observations.map((observation) => ({ ...observation, tableClass }))),
        weaponTypeId: 'weapon.switch_axe',
      }, engine)).rejects.toMatchObject({
        code: 'unsupported_input',
        unsupportedReason: 'normal_pool_unverified',
      })
    }
    expect(support).toHaveBeenCalledTimes(2)
    await expect(identifyNormalArtianCounter({
      ...hbgInput(observations),
      weaponTypeId: 'weapon.unknown',
    }, engine)).rejects.toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'reference_adapter_unsupported',
    })
  })

  it('queries support once per table class and distinguishes capability gaps from fatal errors', async () => {
    const engine = new ProductionRngEngine()
    const support = vi.spyOn(engine, 'getPredictionSupport')
    await identifyNormalArtianCounter(hbgInput(), engine)
    expect(support).toHaveBeenCalledOnce()
    expect(support.mock.calls[0]![0]).toEqual({
      type: 'normal_artian',
      weaponTypeId: 'weapon.heavy_bowgun',
      elementId: 'element.fire',
      rarity: 8,
    })
    const mixed = predictedObservations(engine, '51231782', 'weapon.long_sword', ['element.fire', 'element.none'], 0)
    support.mockClear()
    await identifyNormalArtianCounter({ ...hbgInput(mixed), weaponTypeId: 'weapon.long_sword' }, engine)
    expect(support).toHaveBeenCalledTimes(2)
    expect(support.mock.calls.map(([query]) => (query as { elementId: ElementId }).elementId))
      .toEqual(['element.fire', 'element.none'])

    const incapable = new ProductionRngEngine()
    incapable.capabilities.supportsNormalArtianPrediction = false
    await expect(identifyNormalArtianCounter(hbgInput(), incapable)).rejects.toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'engine_capability_unavailable',
    })

    const fatalEngine = new ProductionRngEngine()
    vi.spyOn(fatalEngine, 'getPredictionSupport').mockImplementation(() => {
      throw new Error('unexpected support failure')
    })
    await expect(identifyNormalArtianCounter(hbgInput(), fatalEngine)).rejects.toThrow(
      'unexpected support failure',
    )
  })

  it('never advances Counter identification through predictNormalArtian calls', async () => {
    const engine = new ProductionRngEngine()
    const predict = vi.spyOn(engine, 'predictNormalArtian')
    await identifyNormalArtianCounter(hbgInput(), engine)
    await identifyNormalArtianCounter(bowInput(fixtureObservations(gameVerifiedBowPoisonNormalVectors), 0, 100), engine)
    expect(predict).not.toHaveBeenCalled()
  })

  it('accepts each table class as a plain structured-clone string', () => {
    const classes: NormalArtianLotteryTableClass[] = ['table_a', 'table_b']
    expect(structuredClone(hbgInput()).observations.map((observation) => observation.tableClass))
      .toEqual(['table_a', 'table_a', 'table_a'])
    expect(classes.every((tableClass) => typeof tableClass === 'string')).toBe(true)
  })
})

describe('Normal Artian Counter Identification UI helpers', () => {
  const engine = new ProductionRngEngine()
  const base = (bonusTypeId: string) => ({ bonusTypeId, bonusRankId: 'bonus_rank.base' })

  it('derives the observation options from the Production pool of the weapon type and table class', () => {
    // Melee: Attack / Element / Sharpness / Affinity on Table A, no Element on Table B.
    expect(normalArtianCounterObservationBonusOptions('weapon.dual_blades', 'table_a')).toEqual([
      base('bonus_type.attack'), base('bonus_type.element'), base('bonus_type.normal_sharpness'), base('bonus_type.affinity'),
    ])
    expect(normalArtianCounterObservationBonusOptions('weapon.dual_blades', 'table_b')).toEqual([
      base('bonus_type.attack'), base('bonus_type.normal_sharpness'), base('bonus_type.affinity'),
    ])
    // Bowguns draw Capacity, never Sharpness, and never Element on either table.
    for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
      expect(normalArtianCounterObservationBonusOptions('weapon.heavy_bowgun', tableClass)).toEqual([
        base('bonus_type.attack'), base('bonus_type.normal_capacity'), base('bonus_type.affinity'),
      ])
    }
    // Bow Table A: Attack / Element / Affinity; Bow Table B: Attack / Affinity.
    // Bow family 7 has no Domain mapping, so it is absent rather than guessed.
    expect(normalArtianCounterObservationBonusOptions('weapon.bow', 'table_a')).toEqual([
      base('bonus_type.attack'), base('bonus_type.element'), base('bonus_type.affinity'),
    ])
    expect(normalArtianCounterObservationBonusOptions('weapon.bow', 'table_b')).toEqual([
      base('bonus_type.attack'), base('bonus_type.affinity'),
    ])
  })

  it('offers exactly the bonuses the pool can draw, so every option maps back into the pool', () => {
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
        const pool = gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, tableClass)
        const options = normalArtianCounterObservationBonusOptions(weaponTypeId, tableClass)
        const mappedIds = options.map((bonus) => referenceNormalIdFromRestorationBonus(weaponTypeId, bonus))
        expect(mappedIds).toEqual(
          pool.map(({ referenceId }) => referenceId).filter((id) => !(weaponTypeId === 'weapon.bow' && id === 7)),
        )
      }
    }
  })

  it('fails closed for Switch Axe instead of falling back to a reference pool', () => {
    for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
      expect(() => normalArtianCounterObservationBonusOptions('weapon.switch_axe', tableClass)).toThrow(
        /unsupported for weapon\.switch_axe/,
      )
    }
  })

  it('judges identification support the way the kernel does: both tables of every supported weapon pass, Switch Axe is normal_pool_unverified', () => {
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      expect(getNormalArtianCounterIdentificationSupport(weaponTypeId, 8, engine)).toEqual({ supported: true })
    }
    expect(getNormalArtianCounterIdentificationSupport('weapon.switch_axe', 8, engine)).toEqual({
      supported: false, reason: 'normal_pool_unverified',
    })
    // The Production Engine with only its Normal capability switched off;
    // every method still resolves through the prototype.
    const noNormal = Object.create(engine, {
      capabilities: { value: { ...engine.capabilities, supportsNormalArtianPrediction: false } },
    }) as RngEngine
    expect(getNormalArtianCounterIdentificationSupport('weapon.dual_blades', 8, noNormal)).toEqual({
      supported: false, reason: 'engine_capability_unavailable',
    })
  })
})
