import type { RouteOperation } from '../models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../models/publicTypes'
import {
  createBaseCandidate,
  hasConfirmedGogmaInputs,
  hasConfirmedSkillInputs,
  searchBonusAmendmentVariants,
  searchResetSkillVariants,
  type RouteSearchContext,
  type RouteSearchResult,
} from './routeSearchShared'

export async function searchNormalArtianRoutes(
  context: RouteSearchContext,
): Promise<RouteSearchResult> {
  const { engine, execution, input, target } = context
  const result: RouteSearchResult = {
    candidates: [],
    searchedRoutes: [],
    skippedRoutes: [],
    warnings: [],
  }
  const counters = input.normalCounters
    .filter(
      (counter) =>
        counter.weaponTypeId === target.weaponTypeId &&
        counter.rarity === V1_NORMAL_ARTIAN_RARITY &&
        counter.isConfirmed &&
        counter.counter !== null,
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  if (counters.length === 0) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'normal_counter_unconfirmed',
      detail: `No confirmed Normal Artian Counter is available for '${target.weaponTypeId}'.`,
    })
    return result
  }
  if (!input.rngState.baseSeed.isConfirmed || input.rngState.baseSeed.value === null) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'rng_state_unconfirmed',
      detail: 'A confirmed Base Seed is required for Normal prediction.',
    })
    return result
  }
  if (!engine.capabilities.supportsNormalArtianPrediction) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'normal_prediction_unsupported',
      detail: 'The active RNG Engine does not support Normal Artian prediction.',
    })
    return result
  }
  if (!hasConfirmedSkillInputs(input)) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'rng_state_unconfirmed',
      detail: 'Confirmed Base Seed, Skill Counter, and Counter Gate are required for conversion.',
    })
    return result
  }
  if (!engine.capabilities.supportsSkillPrediction) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'skill_prediction_unsupported',
      detail: 'The active RNG Engine does not support Skill prediction required for conversion.',
    })
    return result
  }

  const baseSeed = input.rngState.baseSeed.value
  const skillCounter = input.rngState.skillCounter.value
  const counterGate = input.rngState.counterGate.value
  if (baseSeed === null || skillCounter === null || counterGate === null) return result
  result.searchedRoutes.push('normal_artian_to_gogma')

  for (const counter of counters) {
    if (counter.counter === null) continue
    const start = counter.counter
    for (let offset = 0; offset < input.settings.maxNormalAdvance; offset += 1) {
      await execution.checkpoint()
      const forgeCount = offset + 1
      const candidateCounter = start + offset
      const bonuses = engine.predictNormalArtian({
        baseSeed,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        rarity: counter.rarity,
        normalCounter: candidateCounter,
        master: input.master,
      })
      const normalCounterAfter = engine.advanceNormalCounter(start, {
        type: 'create_normal_artian',
        count: forgeCount,
      })
      const skillCounterAfter = engine.advanceSkillCounter(skillCounter, {
        type: 'convert_normal_to_gogma',
      })
      const skills = engine.predictSkills({
        baseSeed,
        skillCounter,
        counterGate,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master: input.master,
      })
      const operations: RouteOperation[] = [
        { type: 'create_normal_artian', weaponTypeId: target.weaponTypeId, rarity: counter.rarity, count: forgeCount, normalCounterBefore: start, normalCounterAfter },
        { type: 'convert_normal_to_gogma', weaponTypeId: target.weaponTypeId, skillCounterBefore: skillCounter, skillCounterAfter },
      ]
      const base = {
        bonuses,
        restorationBonusScope: 'normal_artian' as const,
        operations,
        sourceOwnedWeaponId: null,
        resetSkillsSourceOwnedWeaponId: null,
        skillCounterBefore: skillCounterAfter,
        kind: 'normal_artian_to_gogma' as const,
      }
      const candidate = createBaseCandidate(context, bonuses, 'normal_artian', skills.seriesSkillId, skills.groupSkillId, { kind: base.kind, sourceOwnedWeaponId: null, operations })
      if (candidate) result.candidates.push(candidate)
      result.candidates.push(...await searchResetSkillVariants(context, base))
      if (hasConfirmedGogmaInputs(input) && engine.capabilities.supportsGogmaPrediction) {
        result.candidates.push(...await searchBonusAmendmentVariants(context, {
          ...base,
          seriesSkillId: skills.seriesSkillId,
          groupSkillId: skills.groupSkillId,
          gogmaCounterBefore: input.rngState.gogmaCounter.value!,
          amendmentSourceOwnedWeaponId: null,
        }))
      }
    }
  }
  return result
}
