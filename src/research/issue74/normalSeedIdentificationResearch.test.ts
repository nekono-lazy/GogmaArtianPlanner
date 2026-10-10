import { describe, expect, it } from 'vitest'
import type { ElementId, RestorationBonusSet, WeaponTypeId } from '../../domain/models/publicTypes'
import { loadMasterData } from '../../domain/master/loadMasterData'
import {
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedBowNoneNormalVectors,
  gameVerifiedHeavyBowgunFireNormalVectors,
  gameVerifiedLongSwordFireNormalVectors,
  gameVerifiedSwitchAxeFireNormalVectors,
  gameVerifiedSwitchAxeNoneNormalVectors,
} from '../../test/fixtures/gameVerifiedNormalVectors'
import { NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES } from '../../domain/rng/normalArtianLotteryTable'
import { ProductionRngEngine } from '../../domain/rng/production/productionRngEngine'
import {
  gameVerifiedNormalCandidatesForWeaponAndTableClass,
  normalArtianLotteryTableClassForWeaponAndElement,
} from '../../domain/rng/production/gameNormalBonuses'
import { selectReferenceNormalLotteryIdsFromRawValues } from '../../domain/rng/production/normalPrediction'
import { initializeReferencePrng, nextReferencePrngState } from '../../domain/rng/production/referencePrng'
import { deriveNormalArtianSeed, REFERENCE_RNG_SEED_SALT } from '../../domain/rng/production/seedDerivation'
import type { NormalArtianCounterObservation } from '../../domain/rng/identification/normalArtianCounterIdentificationTypes'
import {
  classifyNormalSeedResearchResult,
  compileNormalObservationConstraint,
  identifyNormalSeedAndCounterCompiled,
  identifyNormalSeedAndCounterWithCounterKernel,
  normalSeedDerivationTerm,
  NormalSeedIdentificationResearchError,
  researchInitializePrng,
  researchPrngStep,
  type NormalSeedIdentificationResearchInput,
  type NormalSeedIdentificationResearchResult,
  type NormalSeedIdentificationResearchStatistics,
} from './normalSeedIdentificationResearch'

const KNOWN_SEED = 51_231_782
const SUPPORTED_WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.great_sword', 'weapon.sword_and_shield', 'weapon.dual_blades', 'weapon.long_sword',
  'weapon.hammer', 'weapon.hunting_horn', 'weapon.lance', 'weapon.gunlance', 'weapon.switch_axe',
  'weapon.charge_blade', 'weapon.insect_glaive', 'weapon.bow', 'weapon.heavy_bowgun', 'weapon.light_bowgun',
]

/** Deterministic xorshift32 for test sampling only (not the game PRNG). */
function sampler(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state
  }
}

function observationsOf(
  vectors: readonly { readonly weaponTypeId: WeaponTypeId; readonly elementId: ElementId; readonly bonuses: RestorationBonusSet }[],
): NormalArtianCounterObservation[] {
  return vectors.map((vector) => ({
    tableClass: normalArtianLotteryTableClassForWeaponAndElement(vector.weaponTypeId, vector.elementId),
    bonuses: vector.bonuses,
  }))
}

function input(
  weaponTypeId: WeaponTypeId,
  observations: readonly NormalArtianCounterObservation[],
  seedRange: { startInclusive: number; endInclusive: number },
  normalCounterRange: { startInclusive: number; endInclusive: number },
  maxMatches?: number,
): NormalSeedIdentificationResearchInput {
  return { weaponTypeId, rarity: 8, observations, seedRange, normalCounterRange, maxMatches }
}

function window(radius: number): { startInclusive: number; endInclusive: number } {
  return { startInclusive: KNOWN_SEED - radius, endInclusive: KNOWN_SEED + radius }
}

function master() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return {
    weaponBonusDefinitions: result.data.weaponBonusDefinitions,
    weaponTypes: result.data.weaponTypes,
    bonusRanks: result.data.bonusRanks,
    elements: result.data.elements,
    bonusTypes: result.data.bonusTypes,
    artianBonusTypeMappings: result.data.artianBonusTypeMappings,
  }
}

/** Every match must reproduce every observation through the Production Engine. */
function expectProductionPredictionsMatch(
  research: NormalSeedIdentificationResearchInput,
  result: NormalSeedIdentificationResearchResult,
  elementByTableClass: Record<'table_a' | 'table_b', ElementId>,
): void {
  const engine = new ProductionRngEngine()
  const inputMaster = master()
  for (const match of result.matches) {
    research.observations.forEach((observation, index) => {
      expect(engine.predictNormalArtian({
        baseSeed: String(match.baseSeed),
        weaponTypeId: research.weaponTypeId,
        elementId: elementByTableClass[observation.tableClass],
        rarity: 8,
        normalCounter: match.startNormalCounter + index,
        master: inputMaster,
      })).toEqual(observation.bonuses)
    })
  }
}

const hbgObservations = observationsOf(gameVerifiedHeavyBowgunFireNormalVectors)
const switchAxeLiveMixed = observationsOf([
  gameVerifiedSwitchAxeFireNormalVectors[0],
  gameVerifiedSwitchAxeNoneNormalVectors[1],
])
const bowComposedMixed = observationsOf([
  gameVerifiedBowElementalNormalVectors[0],
  gameVerifiedBowNoneNormalVectors[1],
  gameVerifiedBowElementalNormalVectors[2],
])
const ELEMENT_BY_TABLE = { table_a: 'element.fire', table_b: 'element.none' } as const

describe('Issue #74 research: exact compiled primitives', () => {
  it('reproduces the Production one-step PRNG transition', () => {
    const next = sampler(0x1234_5678)
    for (let sample = 0; sample < 2_000; sample += 1) {
      const state = { x: next(), y: next(), z: next(), w: next() }
      expect(researchPrngStep(state)).toEqual(nextReferencePrngState(state))
    }
  })

  it('reproduces the Production seed derivation and 100-round initialization bit for bit', () => {
    const next = sampler(0x0bad_cafe)
    const out = new Int32Array(4)
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      const term = normalSeedDerivationTerm(weaponTypeId, 8)
      for (const baseSeed of [0, 1, KNOWN_SEED, 99_999_999, ...Array.from({ length: 50 }, () => next() % 100_000_000)]) {
        const derived = deriveNormalArtianSeed(baseSeed, weaponTypeId, 8)
        expect(((baseSeed + term) ^ REFERENCE_RNG_SEED_SALT) >>> 0).toBe(derived)
        researchInitializePrng((baseSeed + term) ^ REFERENCE_RNG_SEED_SALT, out)
        const expected = initializeReferencePrng(derived)
        expect([out[0]! >>> 0, out[1]! >>> 0, out[2]! >>> 0, out[3]! >>> 0]).toEqual([expected.x, expected.y, expected.z, expected.w])
      }
    }
  })

  it('accepts raw words if and only if the Production pool step draws the observation', () => {
    const next = sampler(0x9e37_79b9)
    for (const weaponTypeId of SUPPORTED_WEAPON_TYPES) {
      for (const tableClass of NORMAL_ARTIAN_LOTTERY_TABLE_CLASSES) {
        const candidates = gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, tableClass)
        const target = compileNormalObservationConstraint(
          selectReferenceNormalLotteryIdsFromRawValues([0, 0, 0, 0, 0], candidates),
          candidates,
        )
        const targetIds = selectReferenceNormalLotteryIdsFromRawValues([0, 0, 0, 0, 0], candidates)
        for (let sample = 0; sample < 400; sample += 1) {
          const raw = [next(), next(), next(), next(), next()]
          const drawn = selectReferenceNormalLotteryIdsFromRawValues(raw, candidates)
          const own = compileNormalObservationConstraint(drawn, candidates)
          expect(raw.every((value, slot) => value % own.moduli[slot]! === own.indices[slot]!)).toBe(true)
          const satisfiesTarget = raw.every((value, slot) => value % target.moduli[slot]! === target.indices[slot]!)
          expect(satisfiesTarget).toBe(drawn.every((id, slot) => id === targetIds[slot]))
        }
      }
    }
  })

  it('refuses an observation the pool can never draw', () => {
    const melee = gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.long_sword', 'table_b')
    expect(() => compileNormalObservationConstraint([4, 6, 6, 6, 6], melee)).toThrow(NormalSeedIdentificationResearchError)
    const meleeA = gameVerifiedNormalCandidatesForWeaponAndTableClass('weapon.long_sword', 'table_a')
    // Sharpness (7) is capped at 2.
    expect(() => compileNormalObservationConstraint([7, 7, 7, 6, 6], meleeA)).toThrow(NormalSeedIdentificationResearchError)
  })
})

describe('Issue #74 research: Method B equals Method A (the unchanged Counter kernel)', () => {
  const engine = new ProductionRngEngine()
  const cases: readonly { name: string; research: NormalSeedIdentificationResearchInput }[] = [
    { name: 'HBG 1 observation', research: input('weapon.heavy_bowgun', hbgObservations.slice(0, 1), window(150), { startInclusive: 0, endInclusive: 12 }) },
    { name: 'HBG 3 observations, non-zero Counter start', research: input('weapon.heavy_bowgun', hbgObservations, window(150), { startInclusive: 3, endInclusive: 9 }) },
    { name: 'Bow Table B 1 observation (many matches)', research: input('weapon.bow', observationsOf(gameVerifiedBowNoneNormalVectors).slice(0, 1), window(60), { startInclusive: 0, endInclusive: 10 }) },
    { name: 'Switch Axe live Table A -> B pair', research: input('weapon.switch_axe', switchAxeLiveMixed, window(150), { startInclusive: 0, endInclusive: 12 }) },
    { name: 'Long Sword 2 observations', research: input('weapon.long_sword', observationsOf(gameVerifiedLongSwordFireNormalVectors).slice(0, 2), window(150), { startInclusive: 0, endInclusive: 12 }) },
  ]
  for (const { name, research } of cases) {
    it(name, async () => {
      const baseline = await identifyNormalSeedAndCounterWithCounterKernel(research, engine)
      const compiled = await identifyNormalSeedAndCounterCompiled(research, engine, { seedChunkSize: 37 })
      const fullFirst = await identifyNormalSeedAndCounterCompiled(research, engine, { earlyRejection: false })
      expect(compiled).toEqual(baseline)
      expect(fullFirst).toEqual(baseline)
      expectProductionPredictionsMatch(research, compiled, ELEMENT_BY_TABLE)
    })
  }
})

describe('Issue #74 research: Base Seed + starting Counter behaviour on game-verified fixtures', () => {
  const engine = new ProductionRngEngine()

  it('finds the known (Seed, non-zero Counter) pair of the HBG Counter 4 / 5 / 6 forges', async () => {
    const research = input('weapon.heavy_bowgun', hbgObservations, window(2_000), { startInclusive: 0, endInclusive: 20 })
    const result = await identifyNormalSeedAndCounterCompiled(research, engine)
    expect(result.matches).toContainEqual({ baseSeed: KNOWN_SEED, startNormalCounter: 4 })
    expect(result.isTruncated).toBe(false)
    expect(classifyNormalSeedResearchResult(result)).toBe('unique')
  })

  it('narrows the candidates monotonically as consecutive observations are added', async () => {
    const counts: number[] = []
    let previous: readonly { baseSeed: number; startNormalCounter: number }[] | null = null
    for (let count = 1; count <= 3; count += 1) {
      const result = await identifyNormalSeedAndCounterCompiled(
        input('weapon.heavy_bowgun', hbgObservations.slice(0, count), window(2_000), { startInclusive: 0, endInclusive: 20 }),
        engine,
      )
      expect(result.matches).toContainEqual({ baseSeed: KNOWN_SEED, startNormalCounter: 4 })
      if (previous !== null) {
        for (const match of result.matches) expect(previous).toContainEqual(match)
      }
      counts.push(result.matches.length)
      previous = result.matches
    }
    expect(counts[0]!).toBeGreaterThan(counts[1]!)
    expect(counts[1]!).toBeGreaterThanOrEqual(counts[2]!)
    expect(counts[2]).toBe(1)
  })

  it('reflects observation order', async () => {
    const reversed = [...hbgObservations].reverse()
    const result = await identifyNormalSeedAndCounterCompiled(
      input('weapon.heavy_bowgun', reversed, window(2_000), { startInclusive: 0, endInclusive: 20 }),
      engine,
    )
    expect(result.matches).not.toContainEqual({ baseSeed: KNOWN_SEED, startNormalCounter: 4 })
  })

  it('walks one Counter across Table A and Table B observations', async () => {
    const switchAxe = await identifyNormalSeedAndCounterCompiled(
      input('weapon.switch_axe', switchAxeLiveMixed, window(2_000), { startInclusive: 0, endInclusive: 20 }),
      engine,
    )
    expect(switchAxe.matches).toContainEqual({ baseSeed: KNOWN_SEED, startNormalCounter: 0 })

    const bowResearch = input('weapon.bow', bowComposedMixed, window(2_000), { startInclusive: 0, endInclusive: 20 })
    const bow = await identifyNormalSeedAndCounterCompiled(bowResearch, engine)
    expect(bow.matches).toContainEqual({ baseSeed: KNOWN_SEED, startNormalCounter: 0 })
    expectProductionPredictionsMatch(bowResearch, bow, ELEMENT_BY_TABLE)
  })

  it('distinguishes zero matches, an out-of-range Counter and an out-of-range Seed', async () => {
    const counterOutside = await identifyNormalSeedAndCounterCompiled(
      input('weapon.heavy_bowgun', hbgObservations, window(2_000), { startInclusive: 5, endInclusive: 20 }),
      engine,
    )
    expect(counterOutside.matches).not.toContainEqual({ baseSeed: KNOWN_SEED, startNormalCounter: 4 })
    const seedOutside = await identifyNormalSeedAndCounterCompiled(
      input('weapon.heavy_bowgun', hbgObservations, { startInclusive: KNOWN_SEED + 1, endInclusive: KNOWN_SEED + 2_000 }, { startInclusive: 0, endInclusive: 20 }),
      engine,
    )
    expect(classifyNormalSeedResearchResult(seedOutside)).toBe('zero')
    expect(seedOutside.isTruncated).toBe(false)
  })

  it('never classifies a truncated search as unique', async () => {
    const result = await identifyNormalSeedAndCounterCompiled(
      input('weapon.heavy_bowgun', hbgObservations.slice(0, 1), window(2_000), { startInclusive: 0, endInclusive: 20 }, 1),
      engine,
    )
    expect(result.matches.length).toBeGreaterThanOrEqual(1)
    expect(result.isTruncated).toBe(true)
    expect(result.searchedSeedRange.endInclusive).toBeLessThan(KNOWN_SEED + 2_000)
    expect(classifyNormalSeedResearchResult(result)).toBe('incomplete')
  })

  it('evaluates every (Seed, Counter) pair with or without early rejection and counts observation-1 passes', async () => {
    const research = input('weapon.heavy_bowgun', hbgObservations, window(300), { startInclusive: 0, endInclusive: 50 })
    const early: NormalSeedIdentificationResearchStatistics = { seedsEvaluated: 0, countersEvaluated: 0, firstObservationPasses: 0 }
    const full: NormalSeedIdentificationResearchStatistics = { seedsEvaluated: 0, countersEvaluated: 0, firstObservationPasses: 0 }
    const withEarly = await identifyNormalSeedAndCounterCompiled(research, engine, { statistics: early })
    const withoutEarly = await identifyNormalSeedAndCounterCompiled(research, engine, { statistics: full, earlyRejection: false })
    expect(withEarly).toEqual(withoutEarly)
    expect(early).toEqual(full)
    expect(early.seedsEvaluated).toBe(601)
    expect(early.countersEvaluated).toBe(601 * 51)
    const firstOnly = await identifyNormalSeedAndCounterCompiled(
      { ...research, observations: hbgObservations.slice(0, 1) },
      engine,
    )
    expect(early.firstObservationPasses).toBe(firstOnly.matches.length)
    expect(withEarly.matches.length).toBeLessThanOrEqual(early.firstObservationPasses)
  })

  it('refuses invalid and unsupported research input before searching', async () => {
    const meleeTableBElement: NormalArtianCounterObservation = {
      tableClass: 'table_b',
      bonuses: gameVerifiedLongSwordFireNormalVectors[0].bonuses,
    }
    await expect(identifyNormalSeedAndCounterCompiled(
      input('weapon.long_sword', [meleeTableBElement], window(10), { startInclusive: 0, endInclusive: 1 }),
      engine,
    )).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyNormalSeedAndCounterCompiled(
      input('weapon.heavy_bowgun', hbgObservations, { startInclusive: 0, endInclusive: 100_000_000 }, { startInclusive: 0, endInclusive: 1 }),
      engine,
    )).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(identifyNormalSeedAndCounterCompiled(
      { ...input('weapon.heavy_bowgun', hbgObservations, window(10), { startInclusive: 0, endInclusive: 1 }), rarity: 7 as never },
      engine,
    )).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

const production = {
  ...import.meta.glob('../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

describe('Issue #74 research isolation', () => {
  it('is imported by no Production module', () => {
    const paths = Object.keys(production).filter((path) => !/\.test\.tsx?$/.test(path))
    expect(paths.length).toBeGreaterThan(100)
    const offenders = paths.filter((path) => /research\/issue74|normalSeedIdentificationResearch/.test(production[path]!))
    expect(offenders).toEqual([])
  })
})
