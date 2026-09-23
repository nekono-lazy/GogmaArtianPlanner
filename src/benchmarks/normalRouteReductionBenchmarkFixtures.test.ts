import { describe, expect, it } from 'vitest'
import { createNormalRouteReductionBenchmarkInput, NORMAL_ROUTE_REDUCTION_MEASUREMENT_SETTINGS } from './normalRouteReductionBenchmarkFixtures'
import { B5_MEASUREMENT_SETTINGS } from './candidateSearchBenchmarkFixtures'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { evaluateSkillCondition, validateTargetIdealImpliesPractical } from '../domain/target'
import { searchCandidates } from '../domain/search/candidateSearch'
import { measureNormalRouteSearch } from '../test/fixtures/normalRouteReduction'

describe('Issue #104 benchmark fixtures', () => {
  it('pins its preset separately from historical B5', () => {
    expect(NORMAL_ROUTE_REDUCTION_MEASUREMENT_SETTINGS).toEqual({ maxNormalAdvance: 500, maxGogmaAdvance: 350, maxSkillAdvance: 1500 })
    expect(B5_MEASUREMENT_SETTINGS).toEqual({ maxNormalAdvance: 5000, maxGogmaAdvance: 5000, maxSkillAdvance: 5000 })
    for (const scenario of ['no_ideal', 'near_ideal', 'deep_skill'] as const) {
      const input = createNormalRouteReductionBenchmarkInput(scenario)
      expect(validateTargetIdealImpliesPractical(input.targetWeapons[0], input.master).isValid).toBe(true)
    }
  })
  it('first reaches the deep Skill pair at offset 1084, beyond the former default', async () => {
    const input = createNormalRouteReductionBenchmarkInput('deep_skill', {maxNormalAdvance:1,maxGogmaAdvance:1,maxSkillAdvance:1000})
    const engine = new ProductionRngEngine(), target = input.targetWeapons[0]
    for (let offset = 0; offset <= 1084; offset++) {
      const skills = engine.predictSkills({baseSeed: input.rngState.baseSeed.value!, skillCounter:341+offset,
        weaponTypeId:target.weaponTypeId,elementId:target.elementId,master:input.master})
      expect(evaluateSkillCondition(target.idealSkillCondition,skills.seriesSkillId,skills.groupSkillId)).toBe(offset===1084)
    }
    expect((await searchCandidates(input, engine)).targetResult.candidate).toBeNull()
    input.settings.maxSkillAdvance=1500
    expect((await searchCandidates(input, engine)).targetResult.candidate).toMatchObject({estimatedOperationCount:1087,estimatedSkillAdvance:1085})
  })
  it.each((['no_ideal', 'near_ideal', 'deep_skill'] as const).flatMap(scenario => [100, 500].map(n => [scenario, n] as const)))('Production parity with the old per-offset oracle: %s, Normal %i', async (scenario, n) => {
    const input=createNormalRouteReductionBenchmarkInput(scenario,{maxNormalAdvance:n,maxGogmaAdvance:8,maxSkillAdvance:1500})
    const before=await measureNormalRouteSearch(input,new ProductionRngEngine(),false)
    const after=await measureNormalRouteSearch(input,new ProductionRngEngine(),true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.metrics.normalBases).toBeLessThanOrEqual(after.metrics.compatibleUniqueLayouts + 1)
    if (scenario !== 'near_ideal') {
      expect(after.metrics).toMatchObject(n === 500
        ? { normalPredictions: 500, familyCompatibleNormals: 52, compatibleUniqueLayouts: 19, uniqueLayouts: 202, normalBases: 20, bonusChannels: 20 }
        : { normalPredictions: 100, familyCompatibleNormals: 11, compatibleUniqueLayouts: 9, uniqueLayouts: 76, normalBases: 10, bonusChannels: 10 })
      expect(after.metrics.familyCompatibleNormals).toBeLessThan(after.metrics.normalPredictions)
      expect(after.metrics.normalBases).toBeLessThan(before.metrics.normalBases)
      expect(after.metrics.bonusStates).toBeLessThan(before.metrics.bonusStates)
      expect(after.metrics.settledWork).toBeLessThan(before.metrics.settledWork)
    }
  }, 20000)
})
