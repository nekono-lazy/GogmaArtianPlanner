import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet } from '../../models/publicTypes'
import { loadMasterData } from '../../master/loadMasterData'
import { referenceGogmaVectors } from '../../../test/fixtures/referenceGogmaVectors'
import {
  gameVerifiedDualBladesDragonKeepChain,
  gameVerifiedGogmaCounterIdentificationVector,
  gameVerifiedGogmaKeepVector,
  gameVerifiedGogmaResetVectors,
  gameVerifiedProductionGogmaResetObservationProvenance,
  gameVerifiedProductionGogmaResetVectors,
} from '../../../test/fixtures/gameVerifiedGogmaVectors'
import {
  REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD,
  predictProductionGogmaReset,
  predictProductionGogmaResetSlotsFromRawValues,
  predictReferenceGogmaKeep,
  predictReferenceGogmaReset,
} from './gogmaPrediction'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  type ReferenceGogmaBonus,
  referenceGogmaIdFromRestorationBonus,
  referenceGogmaKeepFamilyCandidates,
  referenceGogmaKeepFamilyForBonusType,
  restorationBonusFromReferenceGogmaId,
} from './referenceGogmaBonuses'
import {
  PRODUCTION_GOGMA_RESET_SHARPNESS_CAPACITY_FAMILY_LIMIT,
  buildProductionWeightedGogmaResetPool,
  keepCurrentBonusFamily,
  productionGogmaResetCandidatesForWeaponAndElement,
  productionGogmaResetFamiliesForWeaponAndElement,
  toReferenceKeepCurrentBonuses,
} from './gameGogmaBonuses'
import {
  UnsupportedGameVerifiedNormalPredictionError,
  gameVerifiedNormalCandidatesForWeaponAndElement,
} from './gameNormalBonuses'
import { readReferenceRngBlock } from './referencePrng'
import { deriveGogmaSeed } from './seedDerivation'
import { buildReferenceWeightedGogmaPool, drawReferenceWeightedGogmaBonus } from './weightedDraw'

/**
 * Reads the ordered slot families of any known five-slot value through the
 * Keep current-input authority (bonus type only, Normal-side types through the
 * Master mapping), never through the reference result namespace.
 */
function familyLayout(bonuses: RestorationBonusSet): Array<string | null> {
  const keepMaster = master()
  return bonuses.map((bonus) => keepCurrentBonusFamily(bonus, keepMaster))
}

function bonus(bonusTypeId: string, bonusRankId: string) {
  return { bonusTypeId, bonusRankId }
}

function fiveSlots(
  ...slots: [unknown, unknown, unknown, unknown, unknown]
): RestorationBonusSet {
  return slots as unknown as RestorationBonusSet
}

function master() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

describe('reference-verified Production Gogma Reset / Keep prediction', () => {
  it('keeps the exact ten-entry Reset candidate order and semantic mapping', () => {
    expect(REFERENCE_GOGMA_RESET_CANDIDATES.map((entry) => entry.referenceId)).toEqual([
      8, 12, 15, 9, 13, 16, 11, 14, 6, 10,
    ])
    expect(REFERENCE_GOGMA_RESET_CANDIDATES.map((entry) => restorationBonusFromReferenceGogmaId(entry.referenceId))).toEqual([
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.iii' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' },
      { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.iii' },
      { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.ex' },
      { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
      { bonusTypeId: 'bonus_type.gogma_sharpness_capacity', bonusRankId: 'bonus_rank.base' },
      { bonusTypeId: 'bonus_type.gogma_sharpness_capacity', bonusRankId: 'bonus_rank.ex' },
    ])
  })

  it('maps every Keep family explicitly and preserves reference candidate order', () => {
    expect(REFERENCE_GOGMA_RESET_CANDIDATES.map((entry) => [entry.referenceId, entry.family])).toEqual([
      [8, 'attack'], [12, 'attack'], [15, 'attack'], [9, 'affinity'], [13, 'affinity'],
      [16, 'affinity'], [11, 'element'], [14, 'element'], [6, 'sharpness_capacity'], [10, 'sharpness_capacity'],
    ])
    expect(referenceGogmaKeepFamilyCandidates(8).map((entry) => entry.referenceId)).toEqual([8, 12, 15])
    expect(referenceGogmaKeepFamilyCandidates(9).map((entry) => entry.referenceId)).toEqual([9, 13, 16])
    expect(referenceGogmaKeepFamilyCandidates(11).map((entry) => entry.referenceId)).toEqual([11, 14])
    expect(referenceGogmaKeepFamilyCandidates(6).map((entry) => entry.referenceId)).toEqual([6, 10])
  })

  it('applies the reference repeat penalties to exact IDs, including removal at two occurrences', () => {
    const poolAfterOne = buildReferenceWeightedGogmaPool(REFERENCE_GOGMA_RESET_CANDIDATES, [8, 15])
    expect(poolAfterOne.find((entry) => entry.bonus.referenceId === 8)?.weight).toBe(50)
    expect(poolAfterOne.find((entry) => entry.bonus.referenceId === 15)?.weight).toBe(20)
    const poolAfterTwo = buildReferenceWeightedGogmaPool(REFERENCE_GOGMA_RESET_CANDIDATES, [8, 8, 15, 15])
    expect(poolAfterTwo.some((entry) => entry.bonus.referenceId === 8)).toBe(false)
    expect(poolAfterTwo.some((entry) => entry.bonus.referenceId === 15)).toBe(false)
  })

  it('matches independent Reset golden vectors, including repeat and non-repeat results', () => {
    for (const vector of referenceGogmaVectors.resets) {
      expect(predictReferenceGogmaReset(vector)).toEqual({
        bonuses: vector.bonuses,
        effectiveBlock: vector.counterGate < 35 ? 0 : vector.gogmaCounter,
      })
    }
  })

  it('matches every earlier game-observed Reset through Production family availability before weighted draws', () => {
    for (const vector of gameVerifiedGogmaResetVectors) {
      expect(productionGogmaResetCandidatesForWeaponAndElement(vector.weaponTypeId, vector.elementId)
        .map((candidate) => candidate.referenceId)).toEqual(vector.candidateIds)
      const result = predictProductionGogmaReset(vector)
      expect(result.bonuses).toEqual(vector.bonuses)
      expect(result.bonuses.map(referenceGogmaIdFromRestorationBonus)).toEqual(vector.referenceIds)
      expect(result.effectiveBlock).toBe(vector.gogmaCounter)
    }
  })

  it('still matches the Hammer Paralysis Counter 55..60 live Reset chain through the Production Reset', () => {
    const live = gameVerifiedGogmaCounterIdentificationVector
    live.observations.forEach((observation, offset) => {
      const result = predictProductionGogmaReset({
        baseSeed: live.baseSeed,
        weaponTypeId: live.weaponTypeId,
        elementId: live.elementId,
        gogmaCounter: live.startGogmaCounter + offset,
        counterGate: live.actualCounterGate,
      })
      expect(result.bonuses).toEqual(observation)
      expect(result.bonuses.map(referenceGogmaIdFromRestorationBonus)).toEqual(live.referenceIds[offset])
    })
  })

  it('preserves reference candidate order and applies exact-ID penalties after availability filtering', () => {
    const candidates = productionGogmaResetCandidatesForWeaponAndElement('weapon.light_bowgun', 'element.fire')
    expect(candidates.map((candidate) => candidate.referenceId)).toEqual([8, 12, 15, 9, 13, 16, 6, 10])
    const afterOne = buildProductionWeightedGogmaResetPool(candidates, [8, 15])
    expect(afterOne.find((entry) => entry.bonus.referenceId === 8)?.weight).toBe(50)
    expect(afterOne.find((entry) => entry.bonus.referenceId === 15)?.weight).toBe(20)
    expect(afterOne.some((entry) => entry.bonus.referenceId === 11 || entry.bonus.referenceId === 14)).toBe(false)
  })

  it('matches independent Keep golden vectors with preserved ordered families', () => {
    for (const vector of referenceGogmaVectors.keeps) {
      const result = predictReferenceGogmaKeep(vector)
      expect(result).toEqual({
        bonuses: vector.bonuses,
        effectiveBlock: vector.counterGate < 35 ? 0 : vector.gogmaCounter,
      })
      expect(familyLayout(result.bonuses)).toEqual(familyLayout(vector.currentBonuses))
    }
  })

  it('matches the game-observed Bow Fire Keep without changing C3 Keep semantics', () => {
    const vector = gameVerifiedGogmaKeepVector
    const result = predictReferenceGogmaKeep(vector)
    expect(result.bonuses).toEqual(vector.bonuses)
    expect(result.bonuses.map(referenceGogmaIdFromRestorationBonus)).toEqual(vector.referenceIds)
    expect(familyLayout(result.bonuses)).toEqual(familyLayout(vector.currentBonuses))
    expect(result.effectiveBlock).toBe(56)
  })

  it.each([0, 34])('uses Gogma block zero below Gate %i for Reset and Keep', (counterGate) => {
    const reset = referenceGogmaVectors.resets[3]
    const keep = referenceGogmaVectors.keeps[3]
    expect(predictReferenceGogmaReset({ ...reset, counterGate, gogmaCounter: 999 }))
      .toEqual(predictReferenceGogmaReset({ ...reset, counterGate: 35, gogmaCounter: 0 }))
    expect(predictReferenceGogmaKeep({ ...keep, counterGate, gogmaCounter: 999 }))
      .toEqual(predictReferenceGogmaKeep({ ...keep, counterGate: 35, gogmaCounter: 0 }))
  })

  it.each([35, 36])('uses the Domain Gogma Counter at and above Gate %i', (counterGate) => {
    const reset = predictReferenceGogmaReset({ ...referenceGogmaVectors.resets[3], counterGate })
    const keep = predictReferenceGogmaKeep({ ...referenceGogmaVectors.keeps[3], counterGate })
    expect(reset.effectiveBlock).toBe(999)
    expect(keep.effectiveBlock).toBe(999)
  })

  it('keeps the counter gate threshold separate from the persisted Domain counter', () => {
    expect(REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD).toBe(35)
    expect(predictReferenceGogmaReset(referenceGogmaVectors.resets[2]).effectiveBlock).toBe(0)
    expect(predictReferenceGogmaReset(referenceGogmaVectors.resets[3]).effectiveBlock).toBe(999)
  })

  it('is deterministic and consumes only the five leading raw values of one ten-step block', () => {
    const input = { ...referenceGogmaVectors.resets[4], gogmaCounter: 5000 }
    expect(predictReferenceGogmaReset(input)).toEqual(predictReferenceGogmaReset(input))
    expect(predictReferenceGogmaReset(input).effectiveBlock).toBe(5000)
  })

  it('chains Keep from its immediate prior five-slot result', () => {
    const { input, reset, firstKeep, secondKeep } = referenceGogmaVectors.chains
    expect(predictReferenceGogmaReset(input).bonuses).toEqual(reset)
    const first = predictReferenceGogmaKeep({ ...input, gogmaCounter: 45, currentBonuses: reset })
    expect(first.bonuses).toEqual(firstKeep)
    const second = predictReferenceGogmaKeep({ ...input, gogmaCounter: 46, currentBonuses: first.bonuses })
    expect(second.bonuses).toEqual(secondKeep)
  })

  it('matches Reset followed by Keep parity at the next Gogma counter', () => {
    const { input, reset, secondKeep } = referenceGogmaVectors.chains
    const resetResult = predictReferenceGogmaReset(input)
    expect(resetResult.bonuses).toEqual(reset)
    expect(predictReferenceGogmaKeep({ ...input, gogmaCounter: 46, currentBonuses: resetResult.bonuses }).bonuses)
      .toEqual(secondKeep)
  })

  it('rejects invalid counters and unknown semantic stream IDs', () => {
    const input = referenceGogmaVectors.resets[0]
    expect(() => predictReferenceGogmaReset({ ...input, gogmaCounter: -1 })).toThrow(RangeError)
    expect(() => predictReferenceGogmaReset({ ...input, gogmaCounter: 1.5 })).toThrow(RangeError)
    expect(() => predictReferenceGogmaReset({ ...input, gogmaCounter: Number.MAX_SAFE_INTEGER + 1 })).toThrow(RangeError)
    expect(() => predictReferenceGogmaReset({ ...input, weaponTypeId: 'weapon.unknown' })).toThrow(RangeError)
    expect(() => predictReferenceGogmaReset({ ...input, elementId: 'element.unknown' })).toThrow(RangeError)
  })

  it('rejects malformed or non-Gogma Keep bonus inputs without a fallback', () => {
    const input = referenceGogmaVectors.keeps[0]
    const withFirstSlot = (first: unknown) => ({
      ...input,
      currentBonuses: [first, ...input.currentBonuses.slice(1)] as unknown as RestorationBonusSet,
    })
    expect(() => predictReferenceGogmaKeep({ ...input, currentBonuses: input.currentBonuses.slice(0, 4) as unknown as RestorationBonusSet })).toThrow(RangeError)
    // The reference layer reads Gogma-side bonus types only. A Normal-side
    // type is normalized by the Production adapter before it reaches here, so
    // it is unreadable at this level, exactly like an unknown type.
    expect(() => predictReferenceGogmaKeep(withFirstSlot(bonus('bonus_type.normal_sharpness', 'bonus_rank.base')))).toThrow(RangeError)
    expect(() => predictReferenceGogmaKeep(withFirstSlot(bonus('bonus_type.normal_capacity', 'bonus_rank.base')))).toThrow(RangeError)
    expect(() => predictReferenceGogmaKeep(withFirstSlot(bonus('bonus_type.unknown', 'bonus_rank.ex')))).toThrow(RangeError)
    // The tier is never consulted: any rank of a Gogma-side family is readable
    // here, and whether that rank is a legal persisted value is Master /
    // Domain validation, not Keep RNG.
    const expected = predictReferenceGogmaKeep(input)
    expect(predictReferenceGogmaKeep(withFirstSlot(bonus(input.currentBonuses[0].bonusTypeId, 'bonus_rank.base')))).toEqual(expected)
    expect(predictReferenceGogmaKeep(withFirstSlot(bonus(input.currentBonuses[0].bonusTypeId, 'bonus_rank.unknown')))).toEqual(expected)
  })
})

/**
 * A Keep current slot only selects its family, read from its bonus type alone:
 * a Normal-side type is normalized through the Master mapping and the tier is
 * never consulted (`docs/RNG_SPEC.md` 6.1, `docs/RNG_REFERENCE_AUDIT.md` 11).
 */
describe('Keep current input family resolution', () => {
  it('resolves Gogma-side and Normal-side bonus types to the reference families through the Master mapping', () => {
    const keepMaster = master()
    for (const [bonusTypeId, family] of [
      ['bonus_type.attack', 'attack'],
      ['bonus_type.affinity', 'affinity'],
      ['bonus_type.element', 'element'],
      ['bonus_type.gogma_sharpness_capacity', 'sharpness_capacity'],
      ['bonus_type.normal_sharpness', 'sharpness_capacity'],
      ['bonus_type.normal_capacity', 'sharpness_capacity'],
    ] as const) {
      expect(keepCurrentBonusFamily(bonus(bonusTypeId, 'bonus_rank.base'), keepMaster)).toBe(family)
    }
    expect(keepCurrentBonusFamily(bonus('bonus_type.unknown', 'bonus_rank.ex'), keepMaster)).toBeNull()
  })

  it('ignores the tier entirely, including ranks the reference lottery never draws', () => {
    const keepMaster = master()
    for (const bonusRankId of ['bonus_rank.base', 'bonus_rank.ii', 'bonus_rank.ex', 'bonus_rank.fixture.unknown']) {
      expect(keepCurrentBonusFamily(bonus('bonus_type.attack', bonusRankId), keepMaster)).toBe('attack')
      expect(keepCurrentBonusFamily(bonus('bonus_type.normal_capacity', bonusRankId), keepMaster)).toBe('sharpness_capacity')
    }
  })

  it('separates the Reset/Keep result namespace from the Keep current input', () => {
    expect(REFERENCE_GOGMA_RESET_CANDIDATES.some((entry) => entry.bonus.bonusRankId === 'bonus_rank.base' && entry.bonus.bonusTypeId !== 'bonus_type.gogma_sharpness_capacity')).toBe(false)
    // A Normal-side current slot resolves a family but never gains a reference ID.
    expect(() => referenceGogmaIdFromRestorationBonus(bonus('bonus_type.normal_sharpness', 'bonus_rank.base'))).toThrow(RangeError)
    expect(() => referenceGogmaIdFromRestorationBonus(bonus('bonus_type.attack', 'bonus_rank.base'))).toThrow(RangeError)
    expect(referenceGogmaKeepFamilyForBonusType('bonus_type.normal_sharpness')).toBeNull()
  })

  it('produces the reference result of the same family layout from normalized normal-scope slots', () => {
    const vector = referenceGogmaVectors.keeps[1]
    expect(familyLayout(vector.currentBonuses)).toEqual(['attack', 'affinity', 'element', 'sharpness_capacity', 'attack'])
    const normalScopeCurrent = fiveSlots(
      bonus('bonus_type.attack', 'bonus_rank.base'),
      bonus('bonus_type.affinity', 'bonus_rank.base'),
      bonus('bonus_type.element', 'bonus_rank.base'),
      bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
      bonus('bonus_type.attack', 'bonus_rank.base'),
    )
    const normalized = toReferenceKeepCurrentBonuses(normalScopeCurrent, master())
    expect(normalized.map(({ bonusTypeId }) => bonusTypeId)).toEqual([
      'bonus_type.attack',
      'bonus_type.affinity',
      'bonus_type.element',
      'bonus_type.gogma_sharpness_capacity',
      'bonus_type.attack',
    ])
    expect(normalized.map(({ bonusRankId }) => bonusRankId)).toEqual(Array.from({ length: 5 }, () => 'bonus_rank.base'))
    const result = predictReferenceGogmaKeep({ ...vector, currentBonuses: normalized })
    expect(result.bonuses).toEqual(vector.bonuses)
    expect(familyLayout(result.bonuses)).toEqual(familyLayout(normalScopeCurrent))
  })

  it('depends on the ordered family layout rather than the current tier or spelling', () => {
    const { baseSeed, weaponTypeId, elementId, counterGate, gogmaCounter } = referenceGogmaVectors.keeps[1]
    const input = { baseSeed, weaponTypeId, elementId, counterGate, gogmaCounter }
    const keepMaster = master()
    // Inherited normal-scope layout: sharpness / element / element / attack / attack.
    const inherited = toReferenceKeepCurrentBonuses(fiveSlots(
      bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
      bonus('bonus_type.element', 'bonus_rank.base'),
      bonus('bonus_type.element', 'bonus_rank.base'),
      bonus('bonus_type.attack', 'bonus_rank.base'),
      bonus('bonus_type.attack', 'bonus_rank.base'),
    ), keepMaster)
    const higherTiers = fiveSlots(
      bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.ex'),
      bonus('bonus_type.element', 'bonus_rank.ii'),
      bonus('bonus_type.element', 'bonus_rank.ex'),
      bonus('bonus_type.attack', 'bonus_rank.ii'),
      bonus('bonus_type.attack', 'bonus_rank.ex'),
    )
    expect(predictReferenceGogmaKeep({ ...input, currentBonuses: inherited }))
      .toEqual(predictReferenceGogmaKeep({ ...input, currentBonuses: higherTiers }))

    const affinity = (bonusRankId: string) => fiveSlots(
      bonus('bonus_type.affinity', bonusRankId),
      bonus('bonus_type.affinity', bonusRankId),
      bonus('bonus_type.affinity', bonusRankId),
      bonus('bonus_type.affinity', bonusRankId),
      bonus('bonus_type.affinity', bonusRankId),
    )
    expect(predictReferenceGogmaKeep({ ...input, currentBonuses: affinity('bonus_rank.base') }))
      .toEqual(predictReferenceGogmaKeep({ ...input, currentBonuses: affinity('bonus_rank.iii') }))
  })

  it('keeps the reference layer free of the Master mapping', () => {
    // The reference predictor reads Gogma-side bonus types only; the Production
    // adapter normalizes Normal-side types before calling it.
    const vector = referenceGogmaVectors.keeps[1]
    expect(() => predictReferenceGogmaKeep({
      ...vector,
      currentBonuses: fiveSlots(
        bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
        bonus('bonus_type.element', 'bonus_rank.base'),
        bonus('bonus_type.element', 'bonus_rank.base'),
        bonus('bonus_type.attack', 'bonus_rank.base'),
        bonus('bonus_type.attack', 'bonus_rank.base'),
      ),
    })).toThrow(RangeError)
    expect(() => toReferenceKeepCurrentBonuses(fiveSlots(
      bonus('bonus_type.unknown', 'bonus_rank.base'),
      bonus('bonus_type.element', 'bonus_rank.base'),
      bonus('bonus_type.element', 'bonus_rank.base'),
      bonus('bonus_type.attack', 'bonus_rank.base'),
      bonus('bonus_type.attack', 'bonus_rank.base'),
    ), master())).toThrow(RangeError)
  })

  it('leaves every existing supported Keep golden vector unchanged', () => {
    for (const vector of referenceGogmaVectors.keeps) {
      expect(predictReferenceGogmaKeep(vector).bonuses).toEqual(vector.bonuses)
    }
    expect(predictReferenceGogmaKeep(gameVerifiedGogmaKeepVector).bonuses)
      .toEqual(gameVerifiedGogmaKeepVector.bonuses)
  })
})

/** The Production active-branch representative; these observations carry no actual Gate value. */
const ACTIVE_GOGMA_GATE = REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD

/** Exact-ID-repeat-penalty-only draw (the GARP parity pool) over the same candidates and raw values. */
function exactIdOnlyResetIds(
  vector: { baseSeed: number; weaponTypeId: string; elementId: string; gogmaCounter: number },
  candidates: readonly ReferenceGogmaBonus[],
): number[] {
  const rawValues = readReferenceRngBlock(
    deriveGogmaSeed(vector.baseSeed, vector.weaponTypeId, vector.elementId),
    vector.gogmaCounter,
  ).values
  const selected: number[] = []
  for (let slot = 0; slot < 5; slot += 1) {
    selected.push(drawReferenceWeightedGogmaBonus(rawValues[slot]!, buildReferenceWeightedGogmaPool(candidates, selected)))
  }
  return selected
}

/**
 * Production Gogma Reset family availability and the Sharpness/Capacity family
 * limit (`docs/RNG_SPEC.md` 6.1.1, `docs/RNG_REFERENCE_AUDIT.md` 14.17).
 */
describe('Production Gogma Reset family availability and family limit', () => {
  /** Independent expectation of the Normal lottery ID -> Gogma family correspondence. */
  const expectedFamilyByNormalLotteryId: Readonly<Record<number, string>> = {
    6: 'attack',
    4: 'element',
    7: 'sharpness_capacity',
    8: 'affinity',
  }

  it('matches every 2026-09-15 game-observed Reset slot for slot', () => {
    expect(gameVerifiedProductionGogmaResetObservationProvenance).toEqual({
      status: 'game-verified',
      liveObservationDate: '2026-09-15',
      timeZone: 'Asia/Tokyo',
      observationSource: 'GogmaArtianPlanner user live-game observation',
    })
    expect(gameVerifiedProductionGogmaResetVectors.map(({ weaponTypeId, elementId, gogmaCounter }) => [weaponTypeId, elementId, gogmaCounter])).toEqual([
      ['weapon.bow', 'element.poison', 55],
      ['weapon.switch_axe', 'element.none', 55],
      ['weapon.hammer', 'element.paralysis', 104],
      ['weapon.hammer', 'element.paralysis', 160],
      ['weapon.bow', 'element.poison', 179],
      ['weapon.lance', 'element.dragon', 197],
    ])
    for (const vector of gameVerifiedProductionGogmaResetVectors) {
      expect(vector.bonuses.map(referenceGogmaIdFromRestorationBonus)).toEqual(vector.referenceIds)
      expect(productionGogmaResetCandidatesForWeaponAndElement(vector.weaponTypeId, vector.elementId)
        .map((candidate) => candidate.referenceId)).toEqual(vector.candidateIds)
      const result = predictProductionGogmaReset({ ...vector, counterGate: ACTIVE_GOGMA_GATE })
      expect(result.bonuses).toEqual(vector.bonuses)
      expect(result.effectiveBlock).toBe(vector.gogmaCounter)
    }
  })

  it('reproduces Hammer Paralysis Counter 104 only with the Sharpness/Capacity family limit of two', () => {
    const vector = gameVerifiedProductionGogmaResetVectors.find(({ evidence }) => evidence === 'sharpness_capacity_family_limit_two')!
    const candidates = productionGogmaResetCandidatesForWeaponAndElement(vector.weaponTypeId, vector.elementId)
    // The exact-ID-only draw keeps ID 10 once ID 6 reaches weight 0.
    expect(exactIdOnlyResetIds(vector, candidates)).toEqual(vector.exactIdOnlyReferenceIds)
    expect(exactIdOnlyResetIds(vector, candidates)).not.toEqual(vector.referenceIds)
    const rawValues = readReferenceRngBlock(deriveGogmaSeed(vector.baseSeed, vector.weaponTypeId, vector.elementId), vector.gogmaCounter).values
    expect(predictProductionGogmaResetSlotsFromRawValues(rawValues, candidates).map(referenceGogmaIdFromRestorationBonus))
      .toEqual(vector.referenceIds)
  })

  it('draws Affinity in four and five slots and Element as II x2 + EX x2 without any Normal occurrence limit', () => {
    const familyCount = (referenceIds: readonly number[], family: string) =>
      referenceIds.filter((id) => REFERENCE_GOGMA_RESET_CANDIDATES.find((entry) => entry.referenceId === id)!.family === family).length
    const byEvidence = (evidence: string) => gameVerifiedProductionGogmaResetVectors.find((vector) => vector.evidence === evidence)!
    expect(familyCount(byEvidence('affinity_four_slots').referenceIds, 'affinity')).toBe(4)
    expect(familyCount(byEvidence('affinity_five_slots').referenceIds, 'affinity')).toBe(5)
    const element = byEvidence('element_two_ii_two_ex').referenceIds
    expect(element.filter((id) => id === 11)).toHaveLength(2)
    expect(element.filter((id) => id === 14)).toHaveLength(2)
    // Normal Affinity is capped at 3; that limit is never shared with Gogma.
    expect(gameVerifiedNormalCandidatesForWeaponAndElement('weapon.bow', 'element.poison')
      .find((candidate) => candidate.referenceId === 8)?.maximumOccurrences).toBe(3)
  })

  it('derives the Reset family set from the Production Normal pool of every weapon type and element', () => {
    const loaded = master()
    let checked = 0
    for (const { id: weaponTypeId } of loaded.weaponTypes) {
      for (const { id: elementId } of loaded.elements) {
        const normalPool = gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, elementId)
        const expectedFamilies = new Set(normalPool.map((candidate) => expectedFamilyByNormalLotteryId[candidate.referenceId]))
        expect(new Set(productionGogmaResetFamiliesForWeaponAndElement(weaponTypeId, elementId))).toEqual(expectedFamilies)
        // A pre-draw filter only: the fixed reference order with non-family candidates removed.
        expect(productionGogmaResetCandidatesForWeaponAndElement(weaponTypeId, elementId))
          .toEqual(REFERENCE_GOGMA_RESET_CANDIDATES.filter((candidate) => expectedFamilies.has(candidate.family)))
        checked += 1
      }
    }
    expect(checked).toBe(loaded.weaponTypes.length * loaded.elements.length)
    expect(loaded.weaponTypes).toHaveLength(14)
  })

  it('draws Element on Switch Axe element.none and no Element on Bow Poison / Paralysis / Sleep', () => {
    const families = (weaponTypeId: string, elementId: string) =>
      [...productionGogmaResetFamiliesForWeaponAndElement(weaponTypeId, elementId)].sort()
    expect(families('weapon.switch_axe', 'element.none')).toEqual(['affinity', 'attack', 'element', 'sharpness_capacity'])
    for (const elementId of ['element.poison', 'element.paralysis', 'element.sleep']) {
      expect(families('weapon.bow', elementId)).toEqual(['affinity', 'attack'])
    }
  })

  it('fails closed for inputs outside the Production Normal pool authority instead of guessing', () => {
    expect(() => productionGogmaResetCandidatesForWeaponAndElement('weapon.unknown', 'element.fire')).toThrow(RangeError)
    expect(() => productionGogmaResetCandidatesForWeaponAndElement('weapon.bow', 'element.unknown')).toThrow(RangeError)
    expect(new UnsupportedGameVerifiedNormalPredictionError('weapon.bow', 'element.fire')).not.toBeInstanceOf(RangeError)
  })

  it('removes both ID 6 and ID 10 once the Sharpness/Capacity family fills two slots, and nothing else', () => {
    const all = REFERENCE_GOGMA_RESET_CANDIDATES
    const ids = (pool: ReturnType<typeof buildProductionWeightedGogmaResetPool>) => pool.map((entry) => entry.bonus.referenceId)
    expect(PRODUCTION_GOGMA_RESET_SHARPNESS_CAPACITY_FAMILY_LIMIT).toBe(2)
    // One slot: only the exact-ID penalty applies.
    const afterOne = buildProductionWeightedGogmaResetPool(all, [6])
    expect(afterOne.find((entry) => entry.bonus.referenceId === 6)?.weight).toBe(50)
    expect(afterOne.find((entry) => entry.bonus.referenceId === 10)?.weight).toBe(100)
    // Two slots, by the same ID or by different IDs: the whole family leaves the pool.
    for (const selected of [[6, 6], [6, 10], [10, 6]]) {
      expect(ids(buildProductionWeightedGogmaResetPool(all, selected))).not.toContain(6)
      expect(ids(buildProductionWeightedGogmaResetPool(all, selected))).not.toContain(10)
    }
    // The reference parity pool keeps ID 10 after [6, 6]: that pool is never changed.
    expect(buildReferenceWeightedGogmaPool(all, [6, 6]).find((entry) => entry.bonus.referenceId === 10)?.weight).toBe(100)
    // Remaining candidates keep exact-ID penalties.
    const afterFamilyLimit = buildProductionWeightedGogmaResetPool(all, [6, 10, 8, 15])
    expect(afterFamilyLimit.find((entry) => entry.bonus.referenceId === 8)?.weight).toBe(50)
    expect(afterFamilyLimit.find((entry) => entry.bonus.referenceId === 15)?.weight).toBe(20)
    // No explicit Attack / Affinity / Element family limit.
    expect(buildProductionWeightedGogmaResetPool(all, [9, 13, 16, 9])).toEqual(buildReferenceWeightedGogmaPool(all, [9, 13, 16, 9]))
    expect(buildProductionWeightedGogmaResetPool(all, [8, 12, 15, 8])).toEqual(buildReferenceWeightedGogmaPool(all, [8, 12, 15, 8]))
    expect(buildProductionWeightedGogmaResetPool(all, [11, 14, 11])).toEqual(buildReferenceWeightedGogmaPool(all, [11, 14, 11]))
  })

  it('leaves the reference parity Reset unchanged where the Production contract differs', () => {
    const vector = gameVerifiedProductionGogmaResetVectors.find(({ evidence }) => evidence === 'sharpness_capacity_family_limit_two')!
    expect(predictReferenceGogmaReset({ ...vector, counterGate: ACTIVE_GOGMA_GATE }).bonuses.map(referenceGogmaIdFromRestorationBonus))
      .toEqual(exactIdOnlyResetIds(vector, REFERENCE_GOGMA_RESET_CANDIDATES))
  })
})

/**
 * Keep is unchanged by the Production Reset corrections (`docs/RNG_SPEC.md`
 * 6.1.1 item 4): no family availability filter, no family limit.
 */
describe('Keep stays the reference family-preserving draw', () => {
  const chain = gameVerifiedDualBladesDragonKeepChain
  const shared = {
    baseSeed: chain.baseSeed,
    weaponTypeId: chain.weaponTypeId,
    elementId: chain.elementId,
    counterGate: ACTIVE_GOGMA_GATE,
  }

  it('matches all five consecutive Dual Blades Dragon Keeps at Gogma Counters 55..59', () => {
    expect(chain.provenance).toMatchObject({ status: 'game-verified', liveObservationDate: '2026-09-15', timeZone: 'Asia/Tokyo' })
    expect(chain.results.map(({ gogmaCounter }) => gogmaCounter)).toEqual([55, 56, 57, 58, 59])
    expect(familyLayout(chain.testEncodingCurrentBonuses)).toEqual(chain.currentFamilyLayout)
    let current: RestorationBonusSet = chain.testEncodingCurrentBonuses
    for (const observed of chain.results) {
      expect(observed.bonuses.map(referenceGogmaIdFromRestorationBonus)).toEqual(observed.referenceIds)
      // From the layout alone, and chained from the immediately prior result.
      expect(predictReferenceGogmaKeep({ ...shared, gogmaCounter: observed.gogmaCounter, currentBonuses: chain.testEncodingCurrentBonuses }).bonuses)
        .toEqual(observed.bonuses)
      const result = predictReferenceGogmaKeep({ ...shared, gogmaCounter: observed.gogmaCounter, currentBonuses: current })
      expect(result.bonuses).toEqual(observed.bonuses)
      expect(familyLayout(result.bonuses)).toEqual(chain.currentFamilyLayout)
      current = result.bonuses
    }
  })

  it('applies neither the family availability filter nor the Sharpness/Capacity limit', () => {
    const sharpnessEx = bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.ex')
    const threeSharpness = fiveSlots(sharpnessEx, sharpnessEx, sharpnessEx, bonus('bonus_type.attack', 'bonus_rank.ii'), bonus('bonus_type.affinity', 'bonus_rank.ii'))
    const result = predictReferenceGogmaKeep({ ...shared, weaponTypeId: 'weapon.hammer', elementId: 'element.paralysis', gogmaCounter: 104, currentBonuses: threeSharpness })
    expect(familyLayout(result.bonuses)).toEqual(['sharpness_capacity', 'sharpness_capacity', 'sharpness_capacity', 'attack', 'affinity'])
    // An Element slot on Bow Poison keeps its family; Keep reads no Production family set.
    const elementOnBowPoison = fiveSlots(bonus('bonus_type.element', 'bonus_rank.ii'), bonus('bonus_type.attack', 'bonus_rank.ii'), bonus('bonus_type.attack', 'bonus_rank.ii'), bonus('bonus_type.affinity', 'bonus_rank.ii'), bonus('bonus_type.affinity', 'bonus_rank.ii'))
    expect(familyLayout(predictReferenceGogmaKeep({ ...shared, weaponTypeId: 'weapon.bow', elementId: 'element.poison', gogmaCounter: 55, currentBonuses: elementOnBowPoison }).bonuses))
      .toEqual(['element', 'attack', 'attack', 'affinity', 'affinity'])
  })
})
