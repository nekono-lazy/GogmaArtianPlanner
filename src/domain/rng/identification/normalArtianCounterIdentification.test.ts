import { describe, expect, it, vi } from 'vitest'
import type { ElementId, RestorationBonusSet, WeaponTypeId } from '../../models/publicTypes'
import {
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedHeavyBowgunFireNormalVectors,
  gameVerifiedHeavyBowgunNoneNormalVectors,
  gameVerifiedLongSwordFireNormalVectors,
  gameVerifiedLongSwordNoneNormalVectors,
} from '../../../test/fixtures/gameVerifiedNormalVectors'
import { ProductionRngEngine } from '../production/productionRngEngine'
import { gameVerifiedNormalCandidatesForWeaponAndElement } from '../production/gameNormalBonuses'
import {
  mapReferenceNormalResult,
  referenceNormalIdFromRestorationBonus,
} from '../production/referenceNormalBonuses'
import { REFERENCE_RNG_BLOCK_SIZE } from '../production/referencePrng'
import {
  identifyNormalArtianCounter,
  normalArtianAttributeClassFromElementId,
  normalArtianAttributeClassRepresentativeElementId,
} from './normalArtianCounterIdentification'
import {
  MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER,
  NORMAL_ARTIAN_ATTRIBUTE_CLASSES,
  NormalArtianCounterIdentificationError,
  type NormalArtianAttributeClass,
  type NormalArtianCounterIdentificationInput,
  type NormalArtianCounterObservation,
} from './normalArtianCounterIdentificationTypes'

const ATTRIBUTE_PRESENT_ELEMENTS: readonly ElementId[] = [
  'element.fire', 'element.water', 'element.thunder', 'element.ice', 'element.dragon',
  'element.poison', 'element.paralysis', 'element.sleep', 'element.blast',
]
const SUPPORTED_WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.bow', 'weapon.light_bowgun', 'weapon.heavy_bowgun', 'weapon.long_sword',
]
const HBG_BASE_SEED = String(gameVerifiedHeavyBowgunFireNormalVectors[0].baseSeed)

/** Reuses the existing HBG fixture rows as ordered consecutive observations. */
function fixtureObservations(
  vectors: readonly { readonly elementId: ElementId; readonly bonuses: RestorationBonusSet }[],
): NormalArtianCounterObservation[] {
  return vectors.map((vector) => ({
    attributeClass: normalArtianAttributeClassFromElementId(vector.elementId),
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

/** Builds observations from the Production authority itself at consecutive Counters. */
function predictedObservations(
  engine: ProductionRngEngine,
  baseSeed: string,
  weaponTypeId: WeaponTypeId,
  elementIds: readonly ElementId[],
  startCounter: number,
): NormalArtianCounterObservation[] {
  return elementIds.map((elementId, offset) => ({
    attributeClass: normalArtianAttributeClassFromElementId(elementId),
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

describe('Normal Artian attribute class', () => {
  it('collapses every attribute-present element into one class and keeps none separate', () => {
    expect(NORMAL_ARTIAN_ATTRIBUTE_CLASSES).toEqual(['none', 'attribute_present'])
    expect(normalArtianAttributeClassFromElementId('element.none')).toBe('none')
    for (const elementId of ATTRIBUTE_PRESENT_ELEMENTS) {
      expect(normalArtianAttributeClassFromElementId(elementId)).toBe('attribute_present')
    }
    expect(() => normalArtianAttributeClassFromElementId('element.unknown')).toThrow(RangeError)
  })

  it('selects, for every supported weapon type, the same game-verified pool as any concrete element of the class', () => {
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      const presentPool = gameVerifiedNormalCandidatesForWeaponAndElement(
        weaponTypeId,
        normalArtianAttributeClassRepresentativeElementId('attribute_present'),
      )
      for (const elementId of ATTRIBUTE_PRESENT_ELEMENTS) {
        expect(gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, elementId)).toBe(presentPool)
      }
      expect(gameVerifiedNormalCandidatesForWeaponAndElement(
        weaponTypeId,
        normalArtianAttributeClassRepresentativeElementId('none'),
      )).toBe(gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, 'element.none'))
    }
  })

  it('keeps the representative element out of the input, result, and observation contract', async () => {
    const input = hbgInput()
    expect(input).not.toHaveProperty('elementId')
    for (const observation of input.observations) expect(observation).not.toHaveProperty('elementId')
    const result = await identifyNormalArtianCounter(input, new ProductionRngEngine())
    expect(JSON.stringify(result)).not.toContain('element.')
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

  it('reaches the same unique Counter 4 from the elementless HBG fixture with attribute class none', async () => {
    const observations = fixtureObservations(gameVerifiedHeavyBowgunNoneNormalVectors)
    expect(observations.map((observation) => observation.attributeClass)).toEqual(['none', 'none', 'none'])
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

describe('Normal Artian Counter Identification kernel', () => {
  it('matches Production predictNormalArtian across supported weapons, elements, and Counter positions', async () => {
    const engine = new ProductionRngEngine()
    const scenarios = [
      { weaponTypeId: 'weapon.bow', elementIds: ['element.thunder', 'element.thunder', 'element.thunder'], baseSeed: '51231782' },
      { weaponTypeId: 'weapon.bow', elementIds: ['element.none', 'element.none'], baseSeed: '12345678' },
      { weaponTypeId: 'weapon.light_bowgun', elementIds: ['element.blast', 'element.none', 'element.water'], baseSeed: '99999999' },
      { weaponTypeId: 'weapon.heavy_bowgun', elementIds: ['element.none', 'element.dragon'], baseSeed: '0' },
      { weaponTypeId: 'weapon.long_sword', elementIds: ['element.poison', 'element.sleep', 'element.ice'], baseSeed: '8524433' },
      { weaponTypeId: 'weapon.long_sword', elementIds: ['element.none', 'element.fire'], baseSeed: '51231782' },
    ] as const
    for (let sample = 0; sample < 36; sample += 1) {
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
      observations: [{ attributeClass: 'attribute_present', bonuses: reordered }],
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

  it('draws each observation from the pool of its own attribute class', async () => {
    const engine = new ProductionRngEngine()
    const mixed = predictedObservations(
      engine, '51231782', 'weapon.long_sword', ['element.fire', 'element.none', 'element.fire'], 0,
    )
    expect(mixed.map((observation) => observation.attributeClass))
      .toEqual(['attribute_present', 'none', 'attribute_present'])
    expect(mixed[1]!.bonuses).toEqual(gameVerifiedLongSwordNoneNormalVectors[1].bonuses)
    const result = await identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: mixed,
      normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
    }, engine)
    expect(result.matches).toEqual([{ startNormalCounter: 0 }])

    // The Fire slots contain Element, which the none pool cannot draw: declaring
    // them elementless is impossible input, not a zero-match search.
    const misclassified = mixed.map((observation) => ({ ...observation, attributeClass: 'none' as const }))
    await expect(identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: misclassified,
      normalCounterRange: { startInclusive: 0, endInclusive: 0 },
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })

    // The none slots are producible by both pools, so declaring them
    // attribute-present is legal input that selects the other pool and no longer matches.
    expect(mixed[1]!.bonuses.some((bonus) => bonus.bonusTypeId === 'bonus_type.element')).toBe(false)
    expect(mixed[1]!.bonuses).not.toEqual(gameVerifiedLongSwordFireNormalVectors[1].bonuses)
    const otherPool = await identifyNormalArtianCounter({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.long_sword',
      rarity: 8,
      observations: [{ ...mixed[1]!, attributeClass: 'attribute_present' }],
      normalCounterRange: { startInclusive: 1, endInclusive: 1 },
    }, engine)
    expect(otherPool.matches).toEqual([])
  })

  it('needs no concrete element for attribute-present observations of any element', async () => {
    const engine = new ProductionRngEngine()
    for (const elementId of ATTRIBUTE_PRESENT_ELEMENTS) {
      const observations = predictedObservations(engine, '51231782', 'weapon.bow', [elementId, elementId], 3)
      expect(observations[0]!.bonuses).toEqual(
        engine.predictNormalArtian({
          baseSeed: '51231782',
          weaponTypeId: 'weapon.bow',
          elementId: 'element.fire',
          rarity: 8,
          normalCounter: 3,
          master: { weaponBonusDefinitions: [], bonusRanks: [] },
        }),
      )
      const result = await identifyNormalArtianCounter({
        baseSeed: '51231782',
        weaponTypeId: 'weapon.bow',
        rarity: 8,
        observations,
        normalCounterRange: { startInclusive: 0, endInclusive: 50 },
      }, engine)
      expect(result.matches).toEqual([{ startNormalCounter: 3 }])
    }
    expect(gameVerifiedBowElementalNormalVectors[0].elementId).toBe('element.fire')
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
      [{ ...valid, attributeClass: 'elemental' }],
      [{ ...valid, attributeClass: 'element.fire' }],
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
      attributeClass: NormalArtianAttributeClass,
      bonuses: RestorationBonusSet,
    ): NormalArtianCounterIdentificationInput => ({
      baseSeed: HBG_BASE_SEED,
      weaponTypeId,
      rarity: 8,
      observations: [{ attributeClass, bonuses }],
      normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
    })

    // Element is a legal Domain bonus, but absent from these pools: the input is impossible, not unmatched.
    const impossible: readonly [WeaponTypeId, NormalArtianAttributeClass, RestorationBonusSet][] = [
      ['weapon.heavy_bowgun', 'attribute_present', [element, attack, capacity, attack, attack]],
      ['weapon.heavy_bowgun', 'none', [attack, element, capacity, attack, affinity]],
      ['weapon.light_bowgun', 'attribute_present', [attack, attack, capacity, element, affinity]],
      ['weapon.long_sword', 'none', [sharpness, attack, element, sharpness, affinity]],
      ['weapon.bow', 'none', [affinity, affinity, attack, element, affinity]],
    ]
    for (const [weaponTypeId, attributeClass, bonuses] of impossible) {
      const error = await identifyNormalArtianCounter(at(weaponTypeId, attributeClass, bonuses), engine)
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
      expect(error).toMatchObject({ code: 'invalid_input', unsupportedReason: null })
      expect((error as Error).message).toContain(attributeClass)
    }

    // The same Element slots are producible by the pools that do contain Element.
    await expect(identifyNormalArtianCounter(
      at('weapon.long_sword', 'attribute_present', [sharpness, attack, element, sharpness, affinity]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    await expect(identifyNormalArtianCounter(
      at('weapon.bow', 'attribute_present', [affinity, affinity, attack, element, affinity]),
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
      attributeClass: NormalArtianAttributeClass,
      bonuses: RestorationBonusSet,
    ): NormalArtianCounterIdentificationInput => ({
      baseSeed: HBG_BASE_SEED,
      weaponTypeId,
      rarity: 8,
      observations: [{ attributeClass, bonuses }],
      normalCounterRange: { startInclusive: 0, endInclusive: 5_000 },
    })
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.heavy_bowgun', 'element.none'))
      .toContainEqual({ referenceId: 7, maximumOccurrences: 2 })

    // Capacity (family 7) is capped at 2 in every Bowgun pool; a third is impossible.
    for (const weaponTypeId of ['weapon.heavy_bowgun', 'weapon.light_bowgun'] as const) {
      for (const attributeClass of ['none', 'attribute_present'] as const) {
        const error = await identifyNormalArtianCounter(
          at(weaponTypeId, attributeClass, [capacity, attack, capacity, affinity, capacity]),
          engine,
        ).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(NormalArtianCounterIdentificationError)
        expect(error).toMatchObject({ code: 'invalid_input', unsupportedReason: null })
        expect((error as Error).message).toContain('more than 2')
      }
    }
    await expect(identifyNormalArtianCounter(
      at('weapon.long_sword', 'none', [sharpness, sharpness, attack, sharpness, affinity]),
      engine,
    )).rejects.toMatchObject({ code: 'invalid_input' })

    // Exactly two of family 7, and five of a maximum-5 candidate, stay within the pool limits.
    await expect(identifyNormalArtianCounter(
      at('weapon.heavy_bowgun', 'none', [capacity, attack, capacity, affinity, attack]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    await expect(identifyNormalArtianCounter(
      at('weapon.heavy_bowgun', 'attribute_present', [attack, attack, attack, attack, attack]),
      engine,
    )).resolves.toMatchObject({ isTruncated: false })
    await expect(identifyNormalArtianCounter(
      at('weapon.long_sword', 'none', [sharpness, sharpness, attack, attack, affinity]),
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
      attributeClass: NormalArtianAttributeClass,
      bonuses: RestorationBonusSet,
    ): NormalArtianCounterIdentificationInput => ({
      baseSeed: HBG_BASE_SEED,
      weaponTypeId,
      rarity: 8,
      observations: [{ attributeClass, bonuses }],
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

    // Long Sword / attribute_present: Element 4 valid, 5 impossible; Affinity 3 valid, 4 impossible;
    // Sharpness 2 valid, 3 impossible.
    await expectProducible(at('weapon.long_sword', 'attribute_present', [element, element, element, element, attack]))
    await expectImpossible(at('weapon.long_sword', 'attribute_present', [element, element, element, element, element]), 4)
    await expectProducible(at('weapon.long_sword', 'attribute_present', [affinity, affinity, affinity, attack, element]))
    await expectImpossible(at('weapon.long_sword', 'attribute_present', [affinity, affinity, affinity, affinity, attack]), 3)
    await expectProducible(at('weapon.long_sword', 'attribute_present', [sharpness, sharpness, attack, element, affinity]))
    await expectImpossible(at('weapon.long_sword', 'attribute_present', [sharpness, sharpness, sharpness, attack, element]), 2)
    // Long Sword / none keeps the same Affinity and Sharpness limits.
    await expectProducible(at('weapon.long_sword', 'none', [affinity, affinity, affinity, attack, attack]))
    await expectImpossible(at('weapon.long_sword', 'none', [affinity, affinity, affinity, affinity, attack]), 3)

    // Bow: Element 4 valid, 5 impossible; Affinity 3 valid, 4 impossible.
    await expectProducible(at('weapon.bow', 'attribute_present', [element, element, element, element, affinity]))
    await expectImpossible(at('weapon.bow', 'attribute_present', [element, element, element, element, element]), 4)
    await expectProducible(at('weapon.bow', 'attribute_present', [affinity, affinity, affinity, attack, element]))
    await expectImpossible(at('weapon.bow', 'attribute_present', [affinity, affinity, affinity, affinity, element]), 3)
    await expectProducible(at('weapon.bow', 'none', [affinity, affinity, affinity, attack, attack]))
    await expectImpossible(at('weapon.bow', 'none', [affinity, affinity, affinity, affinity, attack]), 3)

    // Bowguns: Capacity 2 valid, 3 impossible; Affinity 3 valid, 4 impossible.
    for (const weaponTypeId of ['weapon.light_bowgun', 'weapon.heavy_bowgun'] as const) {
      for (const attributeClass of ['none', 'attribute_present'] as const) {
        await expectProducible(at(weaponTypeId, attributeClass, [capacity, capacity, attack, affinity, attack]))
        await expectImpossible(at(weaponTypeId, attributeClass, [capacity, capacity, capacity, attack, affinity]), 2)
        await expectProducible(at(weaponTypeId, attributeClass, [affinity, affinity, affinity, attack, capacity]))
        await expectImpossible(at(weaponTypeId, attributeClass, [affinity, affinity, affinity, affinity, attack]), 3)
      }
    }

    // Attack alone may still fill all five slots in every pool.
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      for (const attributeClass of NORMAL_ARTIAN_ATTRIBUTE_CLASSES) {
        await expectProducible(at(weaponTypeId, attributeClass, [attack, attack, attack, attack, attack]))
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

  it('fails closed with normal_pool_unverified for weapon types without a game-verified pool', async () => {
    const engine = new ProductionRngEngine()
    const observations = fixtureObservations(gameVerifiedLongSwordFireNormalVectors)
    for (const weaponTypeId of [
      'weapon.great_sword', 'weapon.sword_and_shield', 'weapon.dual_blades', 'weapon.hammer',
      'weapon.hunting_horn', 'weapon.lance', 'weapon.gunlance', 'weapon.switch_axe',
      'weapon.charge_blade', 'weapon.insect_glaive',
    ]) {
      await expect(identifyNormalArtianCounter({
        ...hbgInput(observations),
        weaponTypeId,
      }, engine)).rejects.toMatchObject({
        code: 'unsupported_input',
        unsupportedReason: 'normal_pool_unverified',
      })
    }
    await expect(identifyNormalArtianCounter({
      ...hbgInput(observations),
      weaponTypeId: 'weapon.unknown',
    }, engine)).rejects.toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'reference_adapter_unsupported',
    })
  })

  it('queries support once per attribute class and distinguishes capability gaps from fatal errors', async () => {
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
      .toEqual(['element.none', 'element.fire'])

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
    expect(predict).not.toHaveBeenCalled()
  })

  it('accepts each attribute class as a plain structured-clone string', () => {
    const classes: NormalArtianAttributeClass[] = ['none', 'attribute_present']
    expect(structuredClone(hbgInput()).observations.map((observation) => observation.attributeClass))
      .toEqual(['attribute_present', 'attribute_present', 'attribute_present'])
    expect(classes.every((attributeClass) => typeof attributeClass === 'string')).toBe(true)
  })
})
