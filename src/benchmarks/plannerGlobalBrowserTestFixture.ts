/**
 * Test-only Phase 2-A fixture: a tiny Global Research input on the real Production RNG Engine and Master
 * (two Bow / Fire Targets and two owned Gogma weapons, the Phase 1-B raw block test setup),
 * so the benchmark Worker controller can run `ProductionRngEngine` + the real raw block Research cache.
 * Synthetic: not a game observation and not a benchmark input.
 */
import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { searchCandidates } from '../domain/search/candidateSearch'
import { gameVerifiedGogmaResetVectors } from '../test/fixtures/gameVerifiedGogmaVectors'
import { createCandidateSearchInput } from '../test/fixtures/candidateSearch'
import { createValidOwnedWeapon, ownedWeaponId, targetWeaponId } from '../test/fixtures/domainData'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'

export async function plannerGlobalBrowserRealFixture(maxPlanSteps = 1000): Promise<PlannerInput> {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('Missing master')
  const data = loaded.data, engine = new ProductionRngEngine(), search = createCandidateSearchInput()
  search.master = data
  search.calculationContext = { gameVersion: data.manifest.gameVersion, masterDataVersion: data.manifest.dataVersion,
    rngEngineVersion: engine.version, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
  search.rngState.baseSeed.value = '51231782'
  search.rngState.gogmaCounter.value = 55
  search.settings = { maxNormalAdvance: 2, maxGogmaAdvance: 8, maxSkillAdvance: 200 }
  const target = search.targetWeapons[0]
  target.weaponTypeId = 'weapon.bow'; target.elementId = 'element.fire'
  target.idealBonuses = structuredClone(gameVerifiedGogmaResetVectors[0].bonuses)
  target.practicalBonusConditions = []; target.alternativeBonusRules = []
  target.practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
  const skills = Array.from({ length: 100 }, (_, i) => engine.predictSkills({ baseSeed: '51231782', skillCounter: 15 + i,
    weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: data })).find(value => value.seriesSkillId !== null)!
  target.idealSkillCondition = { seriesSkillId: skills.seriesSkillId, groupSkillId: null, matchMode: 'all' }
  search.normalCounters[0].weaponTypeId = target.weaponTypeId
  search.normalCounters[0].id = `${target.weaponTypeId}:8`
  search.ownedWeapons = [0, 1].map(i => ({ ...createValidOwnedWeapon(ownedWeaponId(`owned.pg2a.${i}`)),
    weaponTypeId: target.weaponTypeId, elementId: target.elementId, isProtected: false,
    restorationBonuses: structuredClone(target.idealBonuses), seriesSkillId: null, groupSkillId: null }))
  target.preferredOwnedWeaponId = search.ownedWeapons[0].id
  search.targetWeapons.push({ ...structuredClone(target), id: targetWeaponId('target.pg2a.b'), preferredOwnedWeaponId: search.ownedWeapons[1].id })
  const secondBonuses = engine.predictGogmaBonus({ baseSeed: '51231782', gogmaCounter: 56, weaponTypeId: target.weaponTypeId,
    elementId: target.elementId, master: data, operation: { type: 'reset_bonuses' } })
  search.targetWeapons[1].idealBonuses = secondBonuses
  search.ownedWeapons[1].restorationBonuses = structuredClone(secondBonuses)
  const entries = []
  for (const t of search.targetWeapons) {
    const result = await searchCandidates({ ...search, targetWeaponId: t.id }, engine, { now: () => GLOBAL_RESEARCH_TIME })
    if (!result.targetResult.candidate) throw new Error('Phase 2-A fixture Candidate missing')
    entries.push(createBuildListEntry(result.targetResult.candidate, t, { createdAt: GLOBAL_RESEARCH_TIME }))
  }
  return { ...search, buildListEntries: entries, conflictResolutions: [], options: { maxPlanSteps } }
}
