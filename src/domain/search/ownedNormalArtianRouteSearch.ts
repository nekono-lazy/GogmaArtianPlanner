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

export async function searchOwnedNormalArtianRoutes(
  context: RouteSearchContext,
): Promise<RouteSearchResult> {
  const { engine, execution, input, target } = context
  const result: RouteSearchResult = { candidates: [], searchedRoutes: [], skippedRoutes: [], warnings: [] }
  const compatible = input.ownedWeapons.filter((weapon) => weapon.kind === 'normal'
    && weapon.rarity === V1_NORMAL_ARTIAN_RARITY
    && weapon.weaponTypeId === target.weaponTypeId
    && weapon.elementId === target.elementId)
  const sources = compatible.filter((weapon) => !weapon.isProtected).sort((left, right) => left.id.localeCompare(right.id))

  if (sources.length === 0) {
    result.skippedRoutes.push({
      route: 'owned_normal_artian_to_gogma',
      reason: compatible.length > 0 ? 'no_unprotected_source_weapon' : 'no_owned_weapon_available',
      detail: compatible.length > 0 ? 'Only protected owned Normal Artian sources are available.' : 'No compatible owned Normal Artian weapon is available.',
    })
    return result
  }
  if (!hasConfirmedSkillInputs(input)) {
    result.skippedRoutes.push({ route: 'owned_normal_artian_to_gogma', reason: 'rng_state_unconfirmed', detail: 'Confirmed Base Seed and Skill Counter are required for conversion.' })
    return result
  }
  if (!engine.capabilities.supportsSkillPrediction) {
    result.skippedRoutes.push({ route: 'owned_normal_artian_to_gogma', reason: 'skill_prediction_unsupported', detail: 'The active RNG Engine does not support Skill prediction required for conversion.' })
    return result
  }
  const skillSupport = context.predictionSupport.skill()
  if (!skillSupport.supported) {
    result.skippedRoutes.push({ route: 'owned_normal_artian_to_gogma', reason: 'skill_prediction_unsupported', detail: `The active RNG Engine does not support this Skill input (${skillSupport.reason}).` })
    return result
  }
  const skillCounter = input.rngState.skillCounter.value!
  let canSearchAmendments = hasConfirmedGogmaInputs(input) && engine.capabilities.supportsGogmaPrediction
  if (canSearchAmendments) {
    const resetSupport = context.predictionSupport.gogmaReset()
    if (!resetSupport.supported) {
      result.warnings.push({
        targetWeaponId: target.id,
        message: `Reset Bonuses was excluded from owned Normal Artian routes by input support (${resetSupport.reason}).`,
      })
      canSearchAmendments = false
    }
  }
  result.searchedRoutes.push('owned_normal_artian_to_gogma')

  // The conversion Skill assignment and the post-conversion Reset Skills
  // solutions come from the Target's shared Skill stream, so adding source
  // weapons never adds a Skill prediction. When the conversion Skill already
  // satisfies the Ideal Skill condition, this Route's Skill stream is finished
  // and Reset Skills is not searched; the Bonus stream continues.
  const skillCounterAfter = engine.advanceSkillCounter(skillCounter, { type: 'convert_normal_to_gogma' })
  const skills = context.skillStream.predictAt(skillCounter)
  // The Skill solutions do not depend on the source weapon, so they are built
  // once and shared by every owned Normal Route base.
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

  for (const source of sources) {
    await execution.checkpoint()
    const operations: RouteOperation[] = [{ type: 'convert_normal_to_gogma', weaponTypeId: target.weaponTypeId, skillCounterBefore: skillCounter, skillCounterAfter }]
    // Inherited five slots that already match `idealBonuses` finish this Route
    // base's Bonus stream, so no amendment is searched for it.
    const amendmentResult =
      canSearchAmendments && !bonusesSatisfyIdeal(context, source.restorationBonuses)
        ? await context.bonusStream.solve({
            startGogmaCounter: input.rngState.gogmaCounter.value!,
            bonuses: source.restorationBonuses,
            restorationBonusScope: 'normal_artian',
          })
        : null

    result.candidates.push(...await composeRouteCandidates(context, {
      kindResolution: { type: 'fixed', kind: 'owned_normal_artian_to_gogma' },
      sourceOwnedWeaponId: source.id,
      baseOperations: operations,
      bonusSolutions: routeBonusSolutions(
        amendmentResult,
        {
          gogmaAdvance: 0,
          lastResetDepth: 0,
          finalBonuses: source.restorationBonuses,
          restorationBonusScope: 'normal_artian',
          operations: [],
        },
        null,
      ),
      skillSolutions,
    }))

    for (const unsupported of amendmentResult?.unsupportedPredictions ?? []) {
      const message = `${unsupported.type} was excluded after converting OwnedWeapon '${source.id}' by input support (${unsupported.reason}).`
      if (!result.warnings.some((warning) => warning.message === message)) {
        result.warnings.push({ targetWeaponId: target.id, message })
      }
    }
  }
  return result
}
