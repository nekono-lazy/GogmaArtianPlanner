import { describe, expect, it } from 'vitest'
import {
  normalizeBaseSeed,
  readReferenceRngBlock,
  ReferencePrng,
  REFERENCE_RNG_BLOCK_SIZE,
  UINT64_MAX,
  toReferenceAttributeForce,
  toReferenceNormalInternalRarity,
  toReferenceWeaponType,
  toUint32,
} from '.'
import {
  deriveGogmaSeed,
  deriveNormalArtianSeed,
  deriveSkillSeed,
} from './seedDerivation'
import { referenceRngVectors } from '../../../test/fixtures/referenceRngVectors'

describe('reference-verified production RNG foundation', () => {
  it('normalizes raw bigint base seeds with the Lua modulo boundary behavior', () => {
    expect(normalizeBaseSeed(0n)).toBe(0)
    expect(normalizeBaseSeed(99999999n)).toBe(99999999)
    expect(normalizeBaseSeed(100000000n)).toBe(0)
    expect(normalizeBaseSeed(9007199254740993n)).toBe(54740993)
    expect(normalizeBaseSeed(18446744073709551614n)).toBe(9551614)
    expect(normalizeBaseSeed(UINT64_MAX)).toBe(9551615)
    expect(() => normalizeBaseSeed(-1n)).toThrow(RangeError)
    expect(() => normalizeBaseSeed(UINT64_MAX + 1n)).toThrow(RangeError)
  })

  it('uses every explicit reference weapon type mapping rather than Master order', () => {
    expect([
      ['weapon.great_sword', 0],
      ['weapon.sword_and_shield', 1],
      ['weapon.dual_blades', 2],
      ['weapon.long_sword', 3],
      ['weapon.hammer', 4],
      ['weapon.hunting_horn', 5],
      ['weapon.lance', 6],
      ['weapon.gunlance', 7],
      ['weapon.switch_axe', 8],
      ['weapon.charge_blade', 9],
      ['weapon.insect_glaive', 10],
      ['weapon.bow', 11],
      ['weapon.heavy_bowgun', 12],
      ['weapon.light_bowgun', 13],
    ].map(([id]) => [id, toReferenceWeaponType(id as string)])).toEqual([
      ['weapon.great_sword', 0],
      ['weapon.sword_and_shield', 1],
      ['weapon.dual_blades', 2],
      ['weapon.long_sword', 3],
      ['weapon.hammer', 4],
      ['weapon.hunting_horn', 5],
      ['weapon.lance', 6],
      ['weapon.gunlance', 7],
      ['weapon.switch_axe', 8],
      ['weapon.charge_blade', 9],
      ['weapon.insect_glaive', 10],
      ['weapon.bow', 11],
      ['weapon.heavy_bowgun', 12],
      ['weapon.light_bowgun', 13],
    ])
  })

  it('uses every explicit element attributeForce mapping including the Ice/Thunder swap', () => {
    expect([
      ['element.none', 0],
      ['element.fire', 1],
      ['element.water', 2],
      ['element.ice', 3],
      ['element.thunder', 4],
      ['element.dragon', 5],
      ['element.poison', 6],
      ['element.paralysis', 7],
      ['element.sleep', 8],
      ['element.blast', 9],
    ].map(([id]) => [id, toReferenceAttributeForce(id as string)])).toEqual([
      ['element.none', 0],
      ['element.fire', 1],
      ['element.water', 2],
      ['element.ice', 3],
      ['element.thunder', 4],
      ['element.dragon', 5],
      ['element.poison', 6],
      ['element.paralysis', 7],
      ['element.sleep', 8],
      ['element.blast', 9],
    ])
    expect(toReferenceAttributeForce('element.thunder')).toBe(4)
    expect(toReferenceAttributeForce('element.ice')).toBe(3)
  })

  it('rejects unmapped semantic IDs instead of silently selecting a numeric default', () => {
    expect(() => toReferenceWeaponType('weapon.unknown')).toThrow(RangeError)
    expect(() => toReferenceAttributeForce('element.unknown')).toThrow(RangeError)
  })

  it('maps only visible rarity 8 to the reference internal rarity 7', () => {
    expect(toReferenceNormalInternalRarity(8)).toBe(7)
    expect(() => toReferenceNormalInternalRarity(7)).toThrow(RangeError)
    expect(() => toReferenceNormalInternalRarity(9)).toThrow(RangeError)
  })

  it('matches Normal stream seed golden vectors from the pinned reference implementation', () => {
    for (const vector of referenceRngVectors.normalSeeds) {
      expect(deriveNormalArtianSeed(vector.baseSeed, vector.weaponTypeId, 8)).toBe(vector.seed)
    }
  })

  it('matches Skill and Gogma seed golden vectors from the pinned reference implementation', () => {
    for (const vector of referenceRngVectors.attributeSeeds) {
      expect(deriveSkillSeed(vector.baseSeed, vector.weaponTypeId, vector.elementId)).toBe(vector.seed)
      expect(deriveGogmaSeed(vector.baseSeed, vector.weaponTypeId, vector.elementId)).toBe(vector.seed)
    }
  })

  it('keeps Skill and Gogma counters independent despite their identical seed material', () => {
    const seed = deriveSkillSeed(8524433, 'weapon.insect_glaive', 'element.thunder')
    const skillBlock = readReferenceRngBlock(seed, 0)
    const gogmaBlock = readReferenceRngBlock(seed, 1)

    expect(skillBlock.values).not.toEqual(gogmaBlock.values)
    expect(skillBlock.blockIndex).toBe(0)
    expect(gogmaBlock.blockIndex).toBe(1)
  })

  it('matches the reference PRNG initialization and first raw nextUint32 result', () => {
    const rng = new ReferencePrng(0)
    expect(rng.state).toEqual(referenceRngVectors.prng.seed0InitialState)
    expect(rng.nextUint32()).toBe(referenceRngVectors.prng.seed0Block0[0])
  })

  it('matches additional seed 1 and uint32-max PRNG initialization golden vectors', () => {
    for (const vector of referenceRngVectors.prng.additionalInitialStates) {
      const rng = new ReferencePrng(vector.seed)
      expect(rng.state).toEqual(vector.initialState)
      expect(rng.nextUint32()).toBe(vector.firstStep)
    }
  })

  it('matches the reference multi-step raw PRNG sequence', () => {
    const rng = new ReferencePrng(0)
    const firstFive = Array.from({ length: 5 }, () => rng.nextUint32())
    expect(firstFive).toEqual(referenceRngVectors.prng.seed0Block0.slice(0, 5))
  })

  it('reads zero-based block 0 and block 1 without an off-by-one shift', () => {
    expect(REFERENCE_RNG_BLOCK_SIZE).toBe(10)
    expect(readReferenceRngBlock(0, 0).values).toEqual(referenceRngVectors.prng.seed0Block0)
    expect(readReferenceRngBlock(0, 1).values).toEqual(referenceRngVectors.prng.seed0Block1)
  })

  it('uses exactly ten raw steps between adjacent blocks', () => {
    const rng = new ReferencePrng(8524433)
    rng.advance(REFERENCE_RNG_BLOCK_SIZE)
    expect(rng.nextUint32()).toBe(referenceRngVectors.prng.seed8524433Block1[0])
    expect(readReferenceRngBlock(8524433, 0).values).toEqual(referenceRngVectors.prng.seed8524433Block0)
    expect(readReferenceRngBlock(8524433, 1).values).toEqual(referenceRngVectors.prng.seed8524433Block1)
  })

  it('preserves uint32 wrap semantics and is deterministic', () => {
    expect(toUint32(-1)).toBe(4294967295)
    expect(toUint32(4294967296)).toBe(0)
    expect(readReferenceRngBlock(4294967295, 0)).toEqual(readReferenceRngBlock(4294967295, 0))
  })
})
