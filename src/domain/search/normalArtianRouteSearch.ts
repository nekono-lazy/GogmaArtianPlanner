import type { RouteOperation } from '../models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../models/publicTypes'
import {
  bonusesSatisfyIdeal,
  composeRouteCandidates,
  hasConfirmedGogmaInputs,
  hasConfirmedSkillInputs,
  routeBonusSolutions,
  routeSkillSolutions,
  skillsSatisfyIdeal,
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

  // The conversion Skill assignment and the post-conversion Reset Skills
  // solutions come from the Target's shared Skill stream, so repeating the
  // Normal offset loop never repeats a Skill prediction. When the conversion
  // Skill already satisfies the Ideal Skill condition, this Route's Skill stream
  // is finished and Reset Skills is not searched; the Bonus stream continues.
  const skillCounterAfter = engine.advanceSkillCounter(skillCounter, {
    type: 'convert_normal_to_gogma',
  })
  const skills = context.skillStream.predictAt(skillCounter)
  // `resetCount = 0` is the conversion's own initial Skill assignment, whose
  // Skill advance is already 1 (SEARCH_SPEC 5.5.2). The Skill solutions do not
  // depend on the Normal offset, so they are built once for every Route base.
  const skillSolutions = routeSkillSolutions(
    skillsSatisfyIdeal(context, skills.seriesSkillId, skills.groupSkillId)
      ? null
      : await context.skillStream.solve(skillCounterAfter),
    {
      resetCount: 0,
      seriesSkillId: skills.seriesSkillId,
      groupSkillId: skills.groupSkillId,
      estimatedSkillAdvance: 1,
      operations: [],
    },
    null,
    1,
  )

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
      const operations: RouteOperation[] = [
        { type: 'create_normal_artian', weaponTypeId: target.weaponTypeId, rarity: counter.rarity, count: forgeCount, normalCounterBefore: start, normalCounterAfter },
        { type: 'convert_normal_to_gogma', weaponTypeId: target.weaponTypeId, skillCounterBefore: skillCounter, skillCounterAfter },
      ]
      // Inherited five slots that already match `idealBonuses` finish this
      // Route base's Bonus stream, so no amendment is searched for it.
      const amendmentResult =
        canSearchAmendments && !bonusesSatisfyIdeal(context, bonuses)
          ? await context.bonusStream.solve({
              startGogmaCounter: input.rngState.gogmaCounter.value!,
              bonuses,
              restorationBonusScope: 'normal_artian',
            })
          : null

      result.candidates.push(...await composeRouteCandidates(context, {
        kindResolution: { type: 'fixed', kind: 'normal_artian_to_gogma' },
        sourceOwnedWeaponId: null,
        baseOperations: operations,
        bonusSolutions: routeBonusSolutions(
          amendmentResult,
          {
            gogmaAdvance: 0,
            lastResetDepth: 0,
            finalBonuses: bonuses,
            restorationBonusScope: 'normal_artian',
            operations: [],
          },
          null,
        ),
        skillSolutions,
      }))

      for (const unsupported of amendmentResult?.unsupportedPredictions ?? []) {
        const message = `${unsupported.type} was excluded from the Normal Artian route by input support (${unsupported.reason}).`
        if (!result.warnings.some((warning) => warning.message === message)) {
          result.warnings.push({ targetWeaponId: target.id, message })
        }
      }
    }
  }
  return result
}
