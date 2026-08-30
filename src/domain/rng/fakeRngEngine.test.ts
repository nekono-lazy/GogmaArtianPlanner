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
})
