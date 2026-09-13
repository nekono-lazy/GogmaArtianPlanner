import { describe, expect, it, vi } from 'vitest'
import type { RestorationBonusSet } from '../../models/publicTypes'
import { loadMasterData } from '../../master/loadMasterData'
import type { WeaponBonusDefinitionsMasterSubset } from '../../master/masterSelectors'
import { gameVerifiedGogmaCounterIdentificationVector as live } from '../../../test/fixtures/gameVerifiedGogmaVectors'
import { ProductionRngEngine } from '../production/productionRngEngine'
import { toReferenceAttributeForce, toReferenceWeaponType } from '../production/referenceAdapters'
import { predictGameAdjustedGogmaReset } from '../production/gogmaPrediction'
import { referenceGogmaIdFromRestorationBonus } from '../production/referenceGogmaBonuses'
import { identifyGogmaCounter } from './gogmaCounterIdentification'
import {
  GOGMA_IDENTIFICATION_ACTIVE_GATE_REPRESENTATIVE,
  GogmaCounterIdentificationError,
  MAX_GOGMA_IDENTIFICATION_COUNTER,
  type GogmaCounterIdentificationInput,
} from './gogmaCounterIdentificationTypes'

function loadedMaster() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

function masterSubset(): WeaponBonusDefinitionsMasterSubset {
  const master = loadedMaster()
  return {
    weaponTypes: master.weaponTypes,
    elements: master.elements,
    bonusTypes: master.bonusTypes,
    weaponBonusDefinitions: master.weaponBonusDefinitions,
  }
}

function input(
  observations: GogmaCounterIdentificationInput['observations'] = live.observations,
  startInclusive = 50,
  endInclusive = 65,
): GogmaCounterIdentificationInput {
  return {
    baseSeed: String(live.baseSeed),
    weaponTypeId: live.weaponTypeId,
    elementId: live.elementId,
    observations,
    gogmaCounterRange: { startInclusive, endInclusive },
    master: masterSubset(),
  }
}

describe('Gogma Counter Identification live Production parity', () => {
  it('matches all six live Reset observations and all thirty ordered slots', () => {
    const engine = new ProductionRngEngine()
    const master = loadedMaster()
    expect(live.provenance).toMatchObject({
      status: 'game-verified',
      liveObservationDate: '2026-09-13',
      timeZone: 'Asia/Tokyo',
      observationSource: 'GogmaArtianPlanner user live-game observation',
    })
    expect(live.observations).toHaveLength(6)
    expect(live.observations.flat()).toHaveLength(30)
    expect(toReferenceWeaponType(live.weaponTypeId)).toBe(4)
    expect(toReferenceAttributeForce(live.elementId)).toBe(7)
    for (let offset = 0; offset < live.observations.length; offset += 1) {
      const shared = {
        baseSeed: String(live.baseSeed),
        weaponTypeId: live.weaponTypeId,
        elementId: live.elementId,
        gogmaCounter: live.startGogmaCounter + offset,
        operation: { type: 'reset_bonuses' } as const,
        master,
      }
      const representative = engine.predictGogmaBonus({
        ...shared,
      })
      expect(representative).toEqual(live.observations[offset])
      expect(representative.map(referenceGogmaIdFromRestorationBonus)).toEqual(
        live.referenceIds[offset],
      )
      expect(representative).toEqual(predictGameAdjustedGogmaReset({
        ...shared,
        baseSeed: live.baseSeed,
        counterGate: live.actualCounterGate,
      }, master).bonuses)
    }
  })

  it('uses Gate 35 only as the active-branch representative', () => {
    const engine = new ProductionRngEngine()
    const master = loadedMaster()
    const shared = {
      baseSeed: String(live.baseSeed),
      weaponTypeId: live.weaponTypeId,
      elementId: live.elementId,
      gogmaCounter: live.startGogmaCounter,
      operation: { type: 'reset_bonuses' } as const,
      master,
    }
    const expected = engine.predictGogmaBonus(shared)
    expect(GOGMA_IDENTIFICATION_ACTIVE_GATE_REPRESENTATIVE).toBe(35)
    for (const counterGate of [36, 54, 200]) {
      expect(predictGameAdjustedGogmaReset({
        ...shared,
        baseSeed: live.baseSeed,
        counterGate,
      }, master).bonuses).toEqual(expected)
    }
  })
})

describe('Gogma Counter Identification kernel', () => {
  it('reproduces the live known-Seed bounded Counter golden', async () => {
    await expect(identifyGogmaCounter(input(), new ProductionRngEngine())).resolves.toEqual({
      matches: [{ startGogmaCounter: 55 }],
      searchedCounterRange: { startInclusive: 50, endInclusive: 65 },
      isTruncated: false,
    })
  })

  it('matches Production across deterministic semantic inputs and Counter positions', async () => {
    const engine = new ProductionRngEngine()
    const master = loadedMaster()
    const scenarios = [
      { weaponTypeId: 'weapon.bow', elementId: 'element.fire', baseSeed: 51_231_782 },
      { weaponTypeId: 'weapon.long_sword', elementId: 'element.none', baseSeed: 12_345_678 },
      { weaponTypeId: 'weapon.hammer', elementId: 'element.paralysis', baseSeed: 51_231_782 },
    ] as const
    for (let sample = 0; sample < 30; sample += 1) {
      const scenario = scenarios[sample % scenarios.length]!
      const counter = sample * 337
      const observations = Array.from({ length: 3 }, (_, offset) =>
        engine.predictGogmaBonus({
          ...scenario,
          baseSeed: String(scenario.baseSeed),
          gogmaCounter: counter + offset,
          operation: { type: 'reset_bonuses' },
          master,
        }))
      const result = await identifyGogmaCounter({
        ...scenario,
        baseSeed: String(scenario.baseSeed),
        observations,
        gogmaCounterRange: { startInclusive: counter, endInclusive: counter },
        master: {
          weaponTypes: master.weaponTypes,
          elements: master.elements,
          bonusTypes: master.bonusTypes,
          weaponBonusDefinitions: master.weaponBonusDefinitions,
        },
      }, engine)
      expect(result.matches).toEqual([{ startGogmaCounter: counter }])
    }
  })

  it('returns multiple matches in Counter order and truncates at the first N matches', async () => {
    const expectedCounters = [55, 31_237, 51_953, 84_602, 91_845]
    const oneObservation = input(live.observations.slice(0, 1), 0, 100_000)
    const engine = new ProductionRngEngine()
    const complete = await identifyGogmaCounter(oneObservation, engine)
    expect(complete.matches).toEqual(
      expectedCounters.map((startGogmaCounter) => ({ startGogmaCounter })),
    )
    const limited = await identifyGogmaCounter({ ...oneObservation, maxMatches: 2 }, engine)
    expect(limited).toEqual({
      matches: [
        { startGogmaCounter: 55 },
        { startGogmaCounter: 31_237 },
      ],
      searchedCounterRange: { startInclusive: 0, endInclusive: 31_237 },
      isTruncated: true,
    })
  })

  it('keeps the live bounded range unique for every observation prefix', async () => {
    const engine = new ProductionRngEngine()
    for (let observationCount = 1; observationCount <= live.observations.length; observationCount += 1) {
      const result = await identifyGogmaCounter(
        input(live.observations.slice(0, observationCount)),
        engine,
      )
      expect(result.matches).toEqual([{ startGogmaCounter: 55 }])
    }
  })

  it('reduces this live 0..100,000 fixture to one candidate from two observations onward', async () => {
    const engine = new ProductionRngEngine()
    for (let observationCount = 2; observationCount <= live.observations.length; observationCount += 1) {
      const result = await identifyGogmaCounter(
        input(live.observations.slice(0, observationCount), 0, 100_000),
        engine,
      )
      expect(result.matches).toEqual([{ startGogmaCounter: 55 }])
    }
  })

  it('compares ordered slots and returns no match without converting it to an error', async () => {
    const first = live.observations[0]!
    const reordered = [first[1], first[0], first[2], first[3], first[4]] as RestorationBonusSet
    const result = await identifyGogmaCounter(
      input([reordered], live.startGogmaCounter, live.startGogmaCounter),
      new ProductionRngEngine(),
    )
    expect(result.matches).toEqual([])
    expect(result.isTruncated).toBe(false)
  })

  it('rejects invalid Seed, Counter, observation, and maxMatches inputs', async () => {
    const engine = new ProductionRngEngine()
    await expect(identifyGogmaCounter({
      ...input(),
      baseSeed: '051231782',
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyGogmaCounter({
      ...input(),
      gogmaCounterRange: { startInclusive: 5, endInclusive: 4 },
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyGogmaCounter({
      ...input(),
      observations: [live.observations[0]!.slice(0, 4) as unknown as RestorationBonusSet],
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyGogmaCounter({
      ...input(),
      maxMatches: 0,
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyGogmaCounter({
      ...input(),
      gogmaCounterRange: {
        startInclusive: MAX_GOGMA_IDENTIFICATION_COUNTER + 1,
        endInclusive: MAX_GOGMA_IDENTIFICATION_COUNTER + 1,
      },
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyGogmaCounter({
      ...input(),
      observations: [[
        { bonusTypeId: 'bonus_type.unknown', bonusRankId: 'bonus_rank.ii' },
        ...live.observations[0]!.slice(1),
      ] as RestorationBonusSet],
    }, engine)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('queries semantic support once and distinguishes known unsupported from fatal errors', async () => {
    const engine = new ProductionRngEngine()
    const support = vi.spyOn(engine, 'getPredictionSupport')
    await identifyGogmaCounter(input(live.observations.slice(0, 1)), engine)
    expect(support).toHaveBeenCalledOnce()

    await expect(identifyGogmaCounter({
      ...input(),
      master: { weaponTypes: [], elements: [], bonusTypes: [], weaponBonusDefinitions: [] },
    }, new ProductionRngEngine())).rejects.toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'master_data_unavailable',
    })
    for (const unsupported of [
      { weaponTypeId: 'weapon.unknown' },
      { elementId: 'element.unknown' },
    ]) {
      await expect(identifyGogmaCounter({
        ...input(),
        ...unsupported,
      }, new ProductionRngEngine())).rejects.toMatchObject({
        code: 'unsupported_input',
        unsupportedReason: 'reference_adapter_unsupported',
      })
    }

    const fatalEngine = new ProductionRngEngine()
    vi.spyOn(fatalEngine, 'getPredictionSupport').mockImplementation(() => {
      throw new Error('unexpected support failure')
    })
    await expect(identifyGogmaCounter(input(), fatalEngine)).rejects.toThrow(
      'unexpected support failure',
    )
  })

  it('preserves typed cancellation', async () => {
    await expect(identifyGogmaCounter(input(), new ProductionRngEngine(), {
      shouldCancel: () => true,
    })).rejects.toBeInstanceOf(GogmaCounterIdentificationError)
  })
})
