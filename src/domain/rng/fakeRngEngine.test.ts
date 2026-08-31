import { describe, expect, it } from 'vitest'
import { FakeRngEngine, type FakeRngFixtures } from './fakeRngEngine'
import { UnsupportedRngOperationError } from './rngEngine'

function fixtures(): FakeRngFixtures {
  return {
    version: 'test-v1',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: false,
      supportsGogmaPrediction: false,
      supportsSkillPrediction: false,
      supportsKeepBonusesPrediction: false,
    },
    normalizedSeeds: [{ input: 'fixture-seed', result: 'normalized-fixture-seed' }],
    resetBonusPredictions: [],
    skillPredictions: [],
    normalArtianPredictions: [],
    keepBonusPredictions: [],
    gogmaCounterAdvances: [],
    skillCounterAdvances: [],
    normalCounterAdvances: [],
  }
}

describe('FakeRngEngine', () => {
  it('returns only explicitly configured fixture results', () => {
    const engine = new FakeRngEngine(fixtures())

    expect(engine.normalizeSeed('fixture-seed')).toBe('normalized-fixture-seed')
    expect(engine.version).toBe('fake-fixture:test-v1')
  })

  it('does not infer unsupported RNG behavior', () => {
    const engine = new FakeRngEngine(fixtures())

    expect(() => engine.normalizeSeed('unknown')).toThrow(UnsupportedRngOperationError)
    expect(() => engine.advanceGogmaCounter(0, { type: 'reset_bonuses' })).toThrow(
      UnsupportedRngOperationError,
    )
  })

  it('reports prediction support from fixture capabilities without modeling production coverage', () => {
    const engine = new FakeRngEngine({
      ...fixtures(),
      capabilities: { supportsSeedSearch: false, supportsNormalArtianPrediction: true, supportsGogmaPrediction: true, supportsSkillPrediction: false, supportsKeepBonusesPrediction: false },
    })
    expect(engine.getPredictionSupport({ type: 'normal_artian', weaponTypeId: 'weapon.unknown', elementId: 'element.unknown', rarity: 8 })).toEqual({ supported: true })
    expect(engine.getPredictionSupport({ type: 'skill', weaponTypeId: 'weapon.unknown', elementId: 'element.unknown' })).toEqual({ supported: false, reason: 'engine_capability_unavailable' })
    expect(engine.getPredictionSupport({ type: 'gogma_reset', weaponTypeId: 'weapon.unknown', elementId: 'element.unknown', master: { weaponBonusDefinitions: [], bonusRanks: [], lotteries: [] } })).toEqual({ supported: true })
    expect(engine.getPredictionSupport({ type: 'gogma_keep', weaponTypeId: 'weapon.unknown', elementId: 'element.unknown', currentBonuses: [] as never })).toEqual({ supported: false, reason: 'engine_capability_unavailable' })
  })
})
