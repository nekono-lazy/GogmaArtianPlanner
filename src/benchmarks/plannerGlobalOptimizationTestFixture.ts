/** Test-only synthetic Global Research fixture (two Targets sharing Counters). Not a benchmark input. */
import { createCandidateSearchInput } from '../test/fixtures/candidateSearch'
import { createRestorationBonusSet, targetWeaponId } from '../test/fixtures/domainData'
import { FakeRngEngine, type FakeRngFixtures } from '../domain/rng/fakeRngEngine'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { createBuildListEntry } from '../domain/buildList'
import { searchCandidates } from '../domain/search/candidateSearch'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'

/** `extraTargets` (Phase 1-E tests) adds Targets c, d, ... of the same weapon type; the default fixture is unchanged. */
export async function globalResearchFixture(options: { extraTargets?: number } = {}) {
  const search = createCandidateSearchInput()
  search.ownedWeapons = []
  search.calculationContext.appSchemaVersion = CURRENT_CALCULATION_APP_SCHEMA_VERSION
  const first = search.targetWeapons[0]
  search.targetWeapons.push({ ...structuredClone(first), id: targetWeaponId('target.fixture.b'), elementId: 'element.fixture.b' })
  for (let i = 0; i < (options.extraTargets ?? 0); i++) {
    const suffix = String.fromCharCode(99 + i)
    search.targetWeapons.push({ ...structuredClone(first), id: targetWeaponId(`target.fixture.${suffix}`), elementId: `element.fixture.${suffix}` })
  }
  const bonuses = createRestorationBonusSet()
  const fixtures: FakeRngFixtures = {
    version: 'global-research', capabilities: { supportsNormalArtianPrediction: true, supportsGogmaPrediction: true, supportsSkillPrediction: true, supportsKeepBonusesPrediction: false },
    normalizedSeeds: [], keepBonusPredictions: [],
    resetBonusPredictions: search.targetWeapons.flatMap(target => [10, 11].map(gogmaCounter => ({
      input: { baseSeed: search.rngState.baseSeed.value!, gogmaCounter, weaponTypeId: target.weaponTypeId, elementId: target.elementId, operation: { type: 'reset_bonuses' as const }, master: search.master }, result: bonuses,
    }))),
    gogmaCounterAdvances: [{ current: 10, operation: { type: 'reset_bonuses' }, result: 11 }, { current: 11, operation: { type: 'reset_bonuses' }, result: 12 }],
    normalArtianPredictions: search.targetWeapons.flatMap(target => [4, 5].map(normalCounter => ({
      input: { baseSeed: search.rngState.baseSeed.value!, weaponTypeId: target.weaponTypeId, elementId: target.elementId, rarity: 8 as const, normalCounter, master: search.master }, result: bonuses,
    }))),
    skillPredictions: search.targetWeapons.flatMap(target => [7, 8, 9].map(skillCounter => ({
      input: { baseSeed: search.rngState.baseSeed.value!, skillCounter, weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: search.master }, result: { seriesSkillId: first.idealSkillCondition.seriesSkillId, groupSkillId: null },
    }))),
    normalCounterAdvances: [{ current: 4, operation: { type: 'create_normal_artian', count: 1 }, result: 5 }, { current: 5, operation: { type: 'create_normal_artian', count: 1 }, result: 6 }],
    skillCounterAdvances: [{ current: 7, operation: { type: 'convert_normal_to_gogma' }, result: 8 }, { current: 8, operation: { type: 'convert_normal_to_gogma' }, result: 9 },
      { current: 7, operation: { type: 'reset_skills' }, result: 8 }, { current: 8, operation: { type: 'reset_skills' }, result: 9 }, { current: 9, operation: { type: 'reset_skills' }, result: 10 }],
  }
  const engine = new FakeRngEngine(fixtures)
  search.calculationContext.rngEngineVersion = engine.version
  const entries = []
  for (const target of search.targetWeapons) {
    const result = await searchCandidates({ ...search, targetWeaponId: target.id }, engine, { now: () => GLOBAL_RESEARCH_TIME })
    if (!result.targetResult.candidate) throw new Error('Fixture Candidate missing')
    entries.push(createBuildListEntry(result.targetResult.candidate!, target, { createdAt: GLOBAL_RESEARCH_TIME }))
  }
  const input: PlannerInput = { ...search, buildListEntries: entries, conflictResolutions: [], options: { maxPlanSteps: 100 } }
  return { search, input, engine }
}
