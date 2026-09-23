import { createCandidateSearchBenchmarkInput } from './candidateSearchBenchmarkFixtures'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import type { CandidateSearchInput, CandidateSearchSettings } from '../domain/search'

/** Issue #104 presets are independent of the historical B5 workloads. */
export const NORMAL_ROUTE_REDUCTION_MEASUREMENT_SETTINGS: CandidateSearchSettings = {
  maxNormalAdvance: 500,
  maxGogmaAdvance: 350,
  maxSkillAdvance: 1500,
}

export type NormalRouteReductionScenario = 'no_ideal' | 'near_ideal' | 'deep_skill'

export function createNormalRouteReductionBenchmarkInput(
  scenario: NormalRouteReductionScenario,
  settings: CandidateSearchSettings = NORMAL_ROUTE_REDUCTION_MEASUREMENT_SETTINGS,
): CandidateSearchInput {
  const { input } = createCandidateSearchBenchmarkInput(
    scenario === 'no_ideal' ? 'no_ideal_default_bounds' : 'near_ideal_default_bounds',
    'issue104-fixed-run',
  )
  input.settings = { ...settings }
  if (scenario === 'deep_skill') {
    // Production-generated anchor, not a fabricated prediction. First arrival
    // is asserted separately; this fixture never changes the historical B5 set.
    const engine = new ProductionRngEngine()
    const skills = engine.predictSkills({
      baseSeed: input.rngState.baseSeed.value!,
      skillCounter: input.rngState.skillCounter.value! + 1084,
      weaponTypeId: input.targetWeapons[0].weaponTypeId,
      elementId: input.targetWeapons[0].elementId,
      master: input.master,
    })
    input.targetWeapons[0].idealSkillCondition = { ...skills, matchMode: 'all' }
    input.targetWeapons[0].practicalSkillCondition = { ...skills, matchMode: 'all' }
  }
  return input
}

/** Selectable through the existing Browser Worker harness, without changing B5. */
export const normalRouteReductionBenchmarkWorkloads = [
  ...[1, 100, 500, 1000].map(n => ({
    id: `issue104_deep_normal_${n}`, label: `#104 Deep Skill, Normal ${n}`,
    scenario: 'deep_skill' as const,
    settings: { maxNormalAdvance: n, maxGogmaAdvance: 200, maxSkillAdvance: 1500 },
    expectedIdealOperationCount: 1087,
  })),
  ...[200, 350, 500].map(g => ({
    id: `issue104_no_ideal_gogma_${g}`, label: `#104 No Ideal, Gogma ${g}`,
    scenario: 'no_ideal' as const,
    settings: { maxNormalAdvance: 500, maxGogmaAdvance: g, maxSkillAdvance: 1500 },
    expectedIdealOperationCount: null,
  })),
  ...(['near_ideal', 'deep_skill'] as const).map(scenario => ({
    id: `issue104_${scenario}_default`, label: `#104 ${scenario}, proposed defaults`, scenario,
    settings: { ...NORMAL_ROUTE_REDUCTION_MEASUREMENT_SETTINGS },
    expectedIdealOperationCount: scenario === 'near_ideal' ? 3 : 1087,
  })),
]
