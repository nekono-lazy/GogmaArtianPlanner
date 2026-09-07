import { describe, expect, it } from 'vitest'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  areRestorationBonusSetsEqual,
} from '../domain/models/publicTypes'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import {
  assertConstrainedCandidateSearchInput,
  enumerateConstrainedCandidates,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import {
  CONSTRAINED_BENCHMARK_BASE_SEED,
  CONSTRAINED_BENCHMARK_GOGMA_COUNTER,
  CONSTRAINED_BENCHMARK_NORMAL_COUNTER,
  CONSTRAINED_BENCHMARK_SKILL_COUNTER,
  constrainedEnumerationBenchmarkWorkloads,
  createConstrainedEnumerationBenchmarkInput,
} from './constrainedEnumerationBenchmarkFixtures'
import {
  CANDIDATE_SEARCH_BENCHMARK_BASE_SEED,
  CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER,
  CANDIDATE_SEARCH_BENCHMARK_NORMAL_COUNTER,
  CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER,
} from './candidateSearchBenchmarkFixtures'

describe('B8 constrained enumeration benchmark fixtures', () => {
  it('reuses the B5 Production-verified RNG starting point', () => {
    expect(CONSTRAINED_BENCHMARK_BASE_SEED).toBe(CANDIDATE_SEARCH_BENCHMARK_BASE_SEED)
    expect(CONSTRAINED_BENCHMARK_NORMAL_COUNTER).toBe(
      CANDIDATE_SEARCH_BENCHMARK_NORMAL_COUNTER,
    )
    expect(CONSTRAINED_BENCHMARK_SKILL_COUNTER).toBe(
      CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER,
    )
    expect(CONSTRAINED_BENCHMARK_GOGMA_COUNTER).toBe(
      CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER,
    )
  })

  it('builds every workload as a valid constrained search input', () => {
    for (const workload of constrainedEnumerationBenchmarkWorkloads) {
      const { input } = createConstrainedEnumerationBenchmarkInput(workload.id)
      expect(() => assertConstrainedCandidateSearchInput(input)).not.toThrow()
      expect(input.bounds).toEqual(workload.bounds)
    }
  })

  it('carries a Production CalculationContext on every workload', () => {
    const engineVersion = new ProductionRngEngine().version
    expect(engineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
    for (const workload of constrainedEnumerationBenchmarkWorkloads) {
      const { input } = createConstrainedEnumerationBenchmarkInput(workload.id)
      expect(input.origin.calculationContext.rngEngineVersion).toBe(engineVersion)
      expect(input.origin.calculationContext.appSchemaVersion).toBe(
        CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      )
    }
  })

  it('builds a ConstrainedSearchOrigin without any ordinary Search request field', () => {
    const { input } = createConstrainedEnumerationBenchmarkInput(
      'constrained_combined_10_10_25_25',
    )
    expect(Object.keys(input.origin).sort()).toEqual([
      'calculationContext',
      'master',
      'normalCounters',
      'ownedWeapons',
      'rngState',
      'targetWeapons',
    ])
    expect(Object.keys(input).sort()).toEqual(['bounds', 'origin', 'targetWeaponId'])
  })

  it('satisfies the Ideal implies Practical containment on every workload', () => {
    for (const workload of constrainedEnumerationBenchmarkWorkloads) {
      const { input } = createConstrainedEnumerationBenchmarkInput(workload.id)
      const target = input.origin.targetWeapons.find(
        (candidate) => candidate.id === input.targetWeaponId,
      )
      expect(target).toBeDefined()
      expect(
        validateTargetIdealImpliesPractical(target!, input.origin.master).isValid,
      ).toBe(true)
    }
  })

  it('anchors the Ideal halves so each single-axis sweep isolates one stream', () => {
    const skill = createConstrainedEnumerationBenchmarkInput('constrained_skill_10').input
    const gogma = createConstrainedEnumerationBenchmarkInput('constrained_gogma_10').input
    const source = skill.origin.ownedWeapons[0]
    expect(source.kind).toBe('gogma')
    expect(source.restorationBonusScope).toBe('gogma_artian')
    expect(source.isProtected).toBe(false)
    // The Skill sweep pins the Bonus stream shut with the source's own slots.
    expect(
      areRestorationBonusSetsEqual(
        skill.origin.targetWeapons[0].idealBonuses,
        source.restorationBonuses,
      ),
    ).toBe(true)
    // The Gogma sweep pins the Skill stream shut with the source's own Skills.
    expect(gogma.origin.targetWeapons[0].idealSkillCondition).toEqual({
      seriesSkillId: source.seriesSkillId,
      groupSkillId: source.groupSkillId,
      matchMode: 'all',
    })
  })
})

describe('B8 constrained enumeration benchmark workloads under the Production Engine', () => {
  const run = (id: string) =>
    enumerateConstrainedCandidates(
      createConstrainedEnumerationBenchmarkInput(id).input,
      new ProductionRngEngine(),
    )

  it('reaches only the Normal conversion Route in the Normal sweep', async () => {
    const result = await run('constrained_normal_10')
    expect([...new Set(result.candidates.map((c) => c.route.kind))]).toEqual([
      'normal_artian_to_gogma',
    ])
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.summary.evaluatedOffAxisPairs).toBe(0)
    // The Normal stream never ends on its own, so covering the forge counts is
    // always a bound stop rather than exhaustion.
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('advances only the Skill stream in the Skill sweep', async () => {
    const result = await run('constrained_skill_10')
    expect([...new Set(result.candidates.map((c) => c.route.kind))]).toEqual([
      'existing_gogma_reset_skills',
    ])
    expect(result.candidates.every((c) => c.estimatedGogmaAdvance === 0)).toBe(true)
    expect(result.candidates.some((c) => c.estimatedSkillAdvance > 0)).toBe(true)
  })

  it('advances only the Bonus stream in the Gogma sweep', async () => {
    const result = await run('constrained_gogma_10')
    expect(result.candidates.every((c) => c.estimatedSkillAdvance === 0)).toBe(true)
    expect(result.candidates.some((c) => c.estimatedGogmaAdvance > 0)).toBe(true)
    // A gogma-scope unprotected source supports both amendments.
    expect([...new Set(result.candidates.map((c) => c.route.kind))].sort()).toContain(
      'existing_gogma_keep_bonuses',
    )
  })

  it('keeps every off-axis evaluation inside its budget and grows with it', async () => {
    const none = await run('constrained_off_axis_10_0')
    const some = await run('constrained_off_axis_10_100')
    expect(none.summary.evaluatedOffAxisPairs).toBe(0)
    expect(some.summary.evaluatedOffAxisPairs).toBeLessThanOrEqual(100)
    expect(some.summary.evaluatedOffAxisPairs).toBeGreaterThan(0)
    expect(some.candidates.length).toBeGreaterThan(none.candidates.length)
  })

  it('reaches every currently legal Route base family in the combined workload', async () => {
    const result = await run('constrained_combined_10_10_25_25')
    expect([...new Set(result.candidates.map((c) => c.route.kind))].sort()).toEqual([
      'existing_gogma_keep_bonuses',
      'existing_gogma_mixed',
      'existing_gogma_reset_bonuses',
      'existing_gogma_reset_skills',
      'normal_artian_to_gogma',
      'owned_normal_artian_to_gogma',
    ])
  })

  it('yields only Ideal or Practical Candidates', async () => {
    const result = await run('constrained_combined_10_10_25_25')
    expect(
      result.candidates.every(
        (candidate) =>
          candidate.category === 'ideal' || candidate.category === 'practical',
      ),
    ).toBe(true)
  })
})
