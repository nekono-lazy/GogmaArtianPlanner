import { describe, expect, it, vi } from 'vitest'
import type { ElementId, WeaponTypeId } from '../../models/publicTypes'
import { ProductionRngEngine } from '../production/productionRngEngine'
import {
  REFERENCE_GROUP_SKILL_POOL,
  referenceSkillCombinationFromIndex,
} from '../production/referenceSkillPools'
import { predictReferenceSkills } from '../production/skillPrediction'
import { UnavailableRngEngine } from '../unavailableRngEngine'
import {
  identifySkillSeedAndCounter,
  mergeSkillIdentificationChunkResults,
} from './skillIdentification'
import {
  SKILL_IDENTIFICATION_ACTIVE_GATE_REPRESENTATIVE,
  SkillIdentificationError,
  type CompleteSkillObservation,
  type SkillIdentificationInput,
} from './skillIdentificationTypes'

const EMPTY_RNG_MASTER = {
  weaponBonusDefinitions: [],
  lotteries: [],
  bonusRanks: [],
}

const goldenObservations = [275, 255, 245, 243]
  .map(referenceSkillCombinationFromIndex)
  .map(({ seriesSkillId, groupSkillId }) => ({ seriesSkillId, groupSkillId }))

function productionObservations(
  engine: ProductionRngEngine,
  baseSeed: number,
  startSkillCounter: number,
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
): CompleteSkillObservation[] {
  return Array.from({ length: 4 }, (_, offset) => {
    const prediction = engine.predictSkills({
      baseSeed: String(baseSeed),
      skillCounter: startSkillCounter + offset,
      weaponTypeId,
      elementId,
      master: EMPTY_RNG_MASTER,
    })
    if (prediction.seriesSkillId === null || prediction.groupSkillId === null) {
      throw new Error('Production Skill prediction must be complete')
    }
    return {
      seriesSkillId: prediction.seriesSkillId,
      groupSkillId: prediction.groupSkillId,
    }
  })
}

function exactInput(
  baseSeed: number,
  startSkillCounter: number,
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
  observations: readonly CompleteSkillObservation[],
): SkillIdentificationInput {
  return {
    weaponTypeId,
    elementId,
    observations,
    seedRange: { startInclusive: baseSeed, endInclusive: baseSeed },
    skillCounterRange: {
      startInclusive: startSkillCounter,
      endInclusive: startSkillCounter,
    },
  }
}

describe('Skill Identification kernel', () => {
  it('matches 2,000 consecutive Production predictions across deterministic inputs', async () => {
    const engine = new ProductionRngEngine()
    const weapons = [
      'weapon.great_sword',
      'weapon.long_sword',
      'weapon.insect_glaive',
      'weapon.bow',
      'weapon.light_bowgun',
    ] as const satisfies readonly WeaponTypeId[]
    const elements = [
      'element.none',
      'element.fire',
      'element.ice',
      'element.thunder',
      'element.blast',
    ] as const satisfies readonly ElementId[]
    let randomState = 0x05eeda11
    let comparedObservations = 0

    for (let sample = 0; sample < 500; sample += 1) {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0
      const baseSeed = randomState % 100_000_000
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0
      const counter = randomState % 501
      const weaponTypeId = weapons[sample % weapons.length]!
      const elementId = elements[(sample * 3) % elements.length]!
      const observations = productionObservations(
        engine,
        baseSeed,
        counter,
        weaponTypeId,
        elementId,
      )
      const result = await identifySkillSeedAndCounter(
        exactInput(baseSeed, counter, weaponTypeId, elementId, observations),
        engine,
      )
      expect(result.matches).toEqual([{ baseSeed, startSkillCounter: counter }])
      comparedObservations += observations.length
    }

    expect(comparedObservations).toBe(2_000)
  }, 30_000)

  it('matches Production after a large bounded-range start jump', async () => {
    const engine = new ProductionRngEngine()
    const baseSeed = 8_524_433
    const counter = 10_000
    const observations = productionObservations(
      engine,
      baseSeed,
      counter,
      'weapon.insect_glaive',
      'element.thunder',
    )

    const result = await identifySkillSeedAndCounter(
      exactInput(
        baseSeed,
        counter,
        'weapon.insect_glaive',
        'element.thunder',
        observations,
      ),
      engine,
    )

    expect(result.matches).toEqual([{ baseSeed, startSkillCounter: counter }])
  })

  it('reproduces the reference-generated bounded Cartesian golden with semantic IDs', async () => {
    const result = await identifySkillSeedAndCounter(
      {
        weaponTypeId: 'weapon.insect_glaive',
        elementId: 'element.thunder',
        observations: goldenObservations,
        seedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
        skillCounterRange: { startInclusive: 180, endInclusive: 190 },
      },
      new ProductionRngEngine(),
    )

    expect(result).toEqual({
      matches: [{ baseSeed: 8_524_433, startSkillCounter: 186 }],
      searchedSeedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
      isTruncated: false,
    })
  })

  it('returns no match without converting it to an error', async () => {
    const engine = new ProductionRngEngine()
    const actual = productionObservations(
      engine,
      0,
      0,
      'weapon.great_sword',
      'element.none',
    )
    const differentGroup = REFERENCE_GROUP_SKILL_POOL.find(
      (groupSkillId) => groupSkillId !== actual[0]!.groupSkillId,
    )!
    const result = await identifySkillSeedAndCounter(
      exactInput(0, 0, 'weapon.great_sword', 'element.none', [
        { ...actual[0]!, groupSkillId: differentGroup },
      ]),
      engine,
    )
    expect(result.matches).toEqual([])
    expect(result.isTruncated).toBe(false)
  })

  it('orders multiple matches and applies maxMatches only to a completed Seed prefix', async () => {
    const engine = new ProductionRngEngine()
    const input: SkillIdentificationInput = {
      weaponTypeId: 'weapon.insect_glaive',
      elementId: 'element.thunder',
      observations: goldenObservations.slice(0, 1),
      seedRange: { startInclusive: 8_500_000, endInclusive: 8_505_000 },
      skillCounterRange: { startInclusive: 180, endInclusive: 190 },
    }
    const complete = await identifySkillSeedAndCounter(input, engine)
    const limited = await identifySkillSeedAndCounter({ ...input, maxMatches: 2 }, engine)

    expect(complete.matches.length).toBeGreaterThan(2)
    expect(complete.matches).toEqual(
      [...complete.matches].sort(
        (left, right) =>
          left.baseSeed - right.baseSeed ||
          left.startSkillCounter - right.startSkillCounter,
      ),
    )
    expect(limited.matches).toEqual(complete.matches.slice(0, 2))
    expect(limited.isTruncated).toBe(true)
    expect(limited.searchedSeedRange.endInclusive).toBeLessThan(
      input.seedRange!.endInclusive,
    )
  })

  it.each([
    {
      name: 'descending Seed range',
      patch: { seedRange: { startInclusive: 2, endInclusive: 1 } },
    },
    {
      name: 'Seed outside the canonical range',
      patch: { seedRange: { startInclusive: 0, endInclusive: 100_000_000 } },
    },
    {
      name: 'descending Counter range',
      patch: { skillCounterRange: { startInclusive: 2, endInclusive: 1 } },
    },
  ])('rejects $name', async ({ patch }) => {
    const input: SkillIdentificationInput = {
      weaponTypeId: 'weapon.insect_glaive',
      elementId: 'element.thunder',
      observations: goldenObservations,
      seedRange: { startInclusive: 0, endInclusive: 1 },
      skillCounterRange: { startInclusive: 0, endInclusive: 1 },
      ...patch,
    }
    await expect(
      identifySkillSeedAndCounter(input, new ProductionRngEngine()),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rejects semantic Skill IDs outside the Production table', async () => {
    const input: SkillIdentificationInput = {
      weaponTypeId: 'weapon.insect_glaive',
      elementId: 'element.thunder',
      observations: [{
        seriesSkillId: 'series_skill.not_supported',
        groupSkillId: 'group_skill.not_supported',
      } as CompleteSkillObservation],
      seedRange: { startInclusive: 0, endInclusive: 0 },
      skillCounterRange: { startInclusive: 0, endInclusive: 0 },
    }
    await expect(
      identifySkillSeedAndCounter(input, new ProductionRngEngine()),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('queries semantic support once before searching', async () => {
    const engine = new ProductionRngEngine()
    const support = vi.spyOn(engine, 'getPredictionSupport')
    await identifySkillSeedAndCounter(
      {
        weaponTypeId: 'weapon.insect_glaive',
        elementId: 'element.thunder',
        observations: goldenObservations,
        seedRange: { startInclusive: 8_524_433, endInclusive: 8_524_443 },
        skillCounterRange: { startInclusive: 186, endInclusive: 186 },
      },
      engine,
    )
    expect(support).toHaveBeenCalledOnce()
  })

  it('keeps known unsupported and unexpected support errors distinct', async () => {
    const input = exactInput(
      8_524_433,
      186,
      'weapon.insect_glaive',
      'element.thunder',
      goldenObservations,
    )
    await expect(
      identifySkillSeedAndCounter(input, new UnavailableRngEngine()),
    ).rejects.toMatchObject({
      code: 'unsupported_input',
      unsupportedReason: 'engine_capability_unavailable',
    })

    const engine = new ProductionRngEngine()
    vi.spyOn(engine, 'getPredictionSupport').mockImplementation(() => {
      throw new Error('unexpected support failure')
    })
    await expect(identifySkillSeedAndCounter(input, engine)).rejects.toThrow(
      'unexpected support failure',
    )
  })

  it('uses Gate 54 only as the active-branch representative', () => {
    const engine = new ProductionRngEngine()
    const base = {
      baseSeed: '8524433',
      skillCounter: 186,
      weaponTypeId: 'weapon.insect_glaive' as const,
      elementId: 'element.thunder' as const,
      master: EMPTY_RNG_MASTER,
    }
    expect(SKILL_IDENTIFICATION_ACTIVE_GATE_REPRESENTATIVE).toBe(54)
    const reference = predictReferenceSkills({
      ...base,
      baseSeed: Number(base.baseSeed),
      counterGate: SKILL_IDENTIFICATION_ACTIVE_GATE_REPRESENTATIVE,
    })
    expect(engine.predictSkills(base)).toEqual({
      seriesSkillId: reference.seriesSkillId,
      groupSkillId: reference.groupSkillId,
    })
  })
})

describe('parallel Skill Identification merge', () => {
  it('sorts completion-order-independent chunks before applying the global limit', () => {
    const result = mergeSkillIdentificationChunkResults(
      [
        {
          matches: [
            { baseSeed: 3, startSkillCounter: 2 },
            { baseSeed: 2, startSkillCounter: 4 },
          ],
          searchedSeedRange: { startInclusive: 2, endInclusive: 3 },
          isTruncated: false,
        },
        {
          matches: [
            { baseSeed: 1, startSkillCounter: 5 },
            { baseSeed: 1, startSkillCounter: 3 },
          ],
          searchedSeedRange: { startInclusive: 0, endInclusive: 1 },
          isTruncated: false,
        },
      ],
      3,
    )
    expect(result).toEqual({
      matches: [
        { baseSeed: 1, startSkillCounter: 3 },
        { baseSeed: 1, startSkillCounter: 5 },
        { baseSeed: 2, startSkillCounter: 4 },
      ],
      searchedSeedRange: { startInclusive: 0, endInclusive: 3 },
      isTruncated: true,
    })
  })

  it('rejects truncated or non-contiguous parallel chunks', () => {
    expect(() => mergeSkillIdentificationChunkResults([{
      matches: [],
      searchedSeedRange: { startInclusive: 0, endInclusive: 1 },
      isTruncated: true,
    }])).toThrow(SkillIdentificationError)
    expect(() => mergeSkillIdentificationChunkResults([
      {
        matches: [],
        searchedSeedRange: { startInclusive: 0, endInclusive: 1 },
        isTruncated: false,
      },
      {
        matches: [],
        searchedSeedRange: { startInclusive: 3, endInclusive: 4 },
        isTruncated: false,
      },
    ])).toThrow(SkillIdentificationError)
  })
})
