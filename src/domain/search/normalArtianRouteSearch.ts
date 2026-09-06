import type { TargetSearchScheduler } from './targetSearchScheduler'
import type { RouteOperation } from '../models/publicTypes'
import {
  hasConfirmedGogmaInputs,
  hasConfirmedSkillInputs,
  type RouteSearchContext,
  type RouteSearchResult,
} from './routeSearchShared'
import { selectSearchableNormalCounters } from './routeEligibility'

export async function searchNormalArtianRoutes(
  context: RouteSearchContext,
  scheduler: TargetSearchScheduler,
): Promise<RouteSearchResult> {
  const { engine, input, target } = context
  const result: RouteSearchResult = {
    candidates: [],
    searchedRoutes: [],
    skippedRoutes: [],
    warnings: [],
  }
  const counters = selectSearchableNormalCounters(target, input.normalCounters)

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
  const normalSupport = context.predictionSupport.normalArtian()
  if (!normalSupport.supported) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'normal_prediction_unsupported',
      detail: `The active RNG Engine does not support this Normal Artian input (${normalSupport.reason}).`,
    })
    return result
  }
  if (!hasConfirmedSkillInputs(input)) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'rng_state_unconfirmed',
      detail: 'Confirmed Base Seed and Skill Counter are required for conversion.',
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
  const skillSupport = context.predictionSupport.skill()
  if (!skillSupport.supported) {
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      reason: 'skill_prediction_unsupported',
      detail: `The active RNG Engine does not support this Skill input (${skillSupport.reason}).`,
    })
    return result
  }

  const baseSeed = input.rngState.baseSeed.value
  const skillCounter = input.rngState.skillCounter.value
  if (baseSeed === null || skillCounter === null) return result
  let canSearchAmendments = hasConfirmedGogmaInputs(input) && engine.capabilities.supportsGogmaPrediction
  if (canSearchAmendments) {
    const resetSupport = context.predictionSupport.gogmaReset()
    if (!resetSupport.supported) {
      result.warnings.push({
        targetWeaponId: target.id,
        message: `Reset Bonuses was excluded from the Normal Artian route by input support (${resetSupport.reason}).`,
      })
      canSearchAmendments = false
    }
  }
  result.searchedRoutes.push('normal_artian_to_gogma')
  for (const counter of counters) {
    if (counter.counter === null) continue
    const start = counter.counter
    const scheduleOffset = (offset: number): void => {
      if (offset >= input.settings.maxNormalAdvance) return
      const forgeCount = offset + 1
      scheduler.queue.enqueue({
        lowerBound: forgeCount + 1,
        async settle() {
          const skillCounterAfter = engine.advanceSkillCounter(skillCounter, { type: 'convert_normal_to_gogma' })
          const skills = context.skillStream.predictAt(skillCounter)
          const candidateCounter = start + offset
          const bonuses = context.normalPredictions?.get(candidateCounter) ?? engine.predictNormalArtian({
            baseSeed, weaponTypeId: target.weaponTypeId, elementId: target.elementId,
            rarity: counter.rarity, normalCounter: candidateCounter, master: input.master,
          })
          context.normalPredictions?.set(candidateCounter, bonuses)
          const normalCounterAfter = engine.advanceNormalCounter(start, { type: 'create_normal_artian', count: forgeCount })
          const operations: RouteOperation[] = [
            { type: 'create_normal_artian', weaponTypeId: target.weaponTypeId, rarity: counter.rarity, count: forgeCount, normalCounterBefore: start, normalCounterAfter },
            { type: 'convert_normal_to_gogma', weaponTypeId: target.weaponTypeId, skillCounterBefore: skillCounter, skillCounterAfter },
          ]
          scheduler.addBase({
            kindResolution: { type: 'fixed', kind: 'normal_artian_to_gogma' },
            sourceOwnedWeaponId: null,
            baseOperations: operations,
            zeroBonus: { gogmaAdvance: 0, lastResetDepth: 0, finalBonuses: bonuses, restorationBonusScope: 'normal_artian', operations: [] },
            zeroSkill: { resetCount: 0, seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId, estimatedSkillAdvance: 1, operations: [] },
            startSkillCounter: skillCounterAfter,
            bonusBase: canSearchAmendments ? { startGogmaCounter: input.rngState.gogmaCounter.value!, bonuses, restorationBonusScope: 'normal_artian' } : null,
            onCandidate: (candidate) => result.candidates.push(candidate),
            onBonusNotice(notice) {
              if (notice.type !== 'unsupported') return
              const unsupported = notice.prediction
              const message = `${unsupported.type} was excluded from the Normal Artian route by input support (${unsupported.reason}).`
              if (!result.warnings.some((warning) => warning.message === message)) result.warnings.push({ targetWeaponId: target.id, message })
            },
          })
          // This cursor advances once; no previous offset is registered again.
          scheduleOffset(offset + 1)
        },
      })
    }
    scheduleOffset(0)
  }
  return result
}
