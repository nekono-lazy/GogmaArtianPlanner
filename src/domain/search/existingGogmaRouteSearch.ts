import type {
  BuildRoute,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
} from '../models/publicTypes'
import type { BonusStreamSolution, BonusStreamSolutionSet } from './bonusStream'
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
import type { RouteBonusSolution, RouteSkillSolution } from './streamSolutions'

const destructiveKinds = ['existing_gogma_reset_bonuses', 'existing_gogma_keep_bonuses', 'existing_gogma_mixed'] as const

function compatibleSources(context: RouteSearchContext): OwnedGogmaArtianWeapon[] {
  return context.input.ownedWeapons
    .filter((weapon): weapon is OwnedGogmaArtianWeapon => weapon.kind === 'gogma'
      && weapon.weaponTypeId === context.target.weaponTypeId
      && weapon.elementId === context.target.elementId)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function pushAll(result: RouteSearchResult, routes: readonly BuildRoute['kind'][], reason: Parameters<RouteSearchResult['skippedRoutes']['push']>[0]['reason'], detail: string) {
  routes.forEach((route) => result.skippedRoutes.push({ route, reason, detail }))
}

/**
 * The canonical amendment history is Reset for depths `1 ... lastResetDepth`
 * and Keep afterwards, so the RouteKind follows from those two numbers alone.
 * This is the Bonus-only reporting kind; the composed RouteKind of a pair that
 * also contains Reset Skills is decided by `existingGogmaRouteKind()`.
 */
function kindForAmendment(solution: BonusStreamSolution): BuildRoute['kind'] {
  if (solution.lastResetDepth === solution.depth) return 'existing_gogma_reset_bonuses'
  if (solution.lastResetDepth === 0) return 'existing_gogma_keep_bonuses'
  return 'existing_gogma_mixed'
}

/** The `resetCount = 0` Skill solution of one owned Gogma Route base. */
function zeroSkillSolution(source: OwnedGogmaArtianWeapon): RouteSkillSolution {
  return {
    resetCount: 0,
    seriesSkillId: source.seriesSkillId,
    groupSkillId: source.groupSkillId,
    estimatedSkillAdvance: 0,
    operations: [],
  }
}

/** The `gogmaAdvance = 0` Bonus solution of one owned Gogma Route base. */
function zeroBonusSolution(source: OwnedGogmaArtianWeapon): RouteBonusSolution {
  return {
    gogmaAdvance: 0,
    lastResetDepth: 0,
    finalBonuses: source.restorationBonuses,
    restorationBonusScope: source.restorationBonusScope,
    operations: [],
  }
}

export async function searchExistingGogmaRoutes(context: RouteSearchContext): Promise<RouteSearchResult> {
  const { engine, input } = context
  const result: RouteSearchResult = { candidates: [], searchedRoutes: [], skippedRoutes: [], warnings: [] }
  const all = compatibleSources(context)
  if (all.length === 0) {
    pushAll(result, ['existing_gogma_reset_bonuses', 'existing_gogma_keep_bonuses', 'existing_gogma_reset_skills', 'existing_gogma_mixed'], 'no_owned_weapon_available', 'No compatible owned Gogma weapon is available.')
    return result
  }

  const hasSkillInputs = hasConfirmedSkillInputs(input)
  let skillInputUnsupportedReason: string | null = null
  let canSkill = false
  if (hasSkillInputs && engine.capabilities.supportsSkillPrediction) {
    const skillSupport = context.predictionSupport.skill()
    canSkill = skillSupport.supported
    if (!skillSupport.supported) skillInputUnsupportedReason = skillSupport.reason
  }

  // The Skill stream is solved at most once for this Target, from the confirmed
  // starting Skill Counter, and shared by every source and every Bonus state.
  const startSkillCounter = input.rngState.skillCounter.value
  const skillSolutionsFor = async (
    source: OwnedGogmaArtianWeapon,
  ): Promise<RouteSkillSolution[]> => {
    const zero = zeroSkillSolution(source)
    if (!canSkill || startSkillCounter === null) return [zero]
    if (skillsSatisfyIdeal(context, source.seriesSkillId, source.groupSkillId)) {
      return [zero]
    }
    return routeSkillSolutions(
      await context.skillStream.solve(startSkillCounter),
      zero,
      source.id,
      0,
    )
  }

  if (canSkill) {
    result.searchedRoutes.push('existing_gogma_reset_skills')
  } else {
    result.skippedRoutes.push({
      route: 'existing_gogma_reset_skills',
      reason: hasSkillInputs ? 'skill_prediction_unsupported' : 'rng_state_unconfirmed',
      detail: !hasSkillInputs
        ? 'Confirmed Base Seed and Skill Counter are required.'
        : skillInputUnsupportedReason
          ? `The active RNG Engine does not support this Skill input (${skillInputUnsupportedReason}).`
          : 'The active RNG Engine does not support Skill prediction.',
    })
  }

  const destructive = all.filter((weapon) => !weapon.isProtected)
  const gogmaInputsConfirmed = hasConfirmedGogmaInputs(input)
  const canAmend = destructive.length > 0
    && gogmaInputsConfirmed
    && engine.capabilities.supportsGogmaPrediction
  const canKeep = engine.capabilities.supportsKeepBonusesPrediction
  const pureKeepSources = destructive.filter(
    ({ restorationBonusScope }) => restorationBonusScope === 'gogma_artian',
  )
  const searchedAmendmentRoutes = new Set<BuildRoute['kind']>()
  const keepUnsupportedSources = new Set<OwnedWeaponId>()

  // One pass over every compatible source. A protected source contributes only
  // its `gogmaAdvance = 0` Bonus solution, which keeps its non-destructive
  // Reset Skills Candidates available without ever generating an amendment.
  for (const source of all) {
    const skillSolutions = await skillSolutionsFor(source)
    let amendmentResult: BonusStreamSolutionSet | null = null
    // A source whose current five slots already match `idealBonuses` has a
    // finished Bonus stream: no amendment is searched and no Gogma prediction
    // is made for it. Its Skill stream is unaffected.
    if (
      canAmend &&
      !source.isProtected &&
      !bonusesSatisfyIdeal(context, source.restorationBonuses)
    ) {
      amendmentResult = await context.bonusStream.solve({
        startGogmaCounter: input.rngState.gogmaCounter.value!,
        bonuses: source.restorationBonuses,
        restorationBonusScope: source.restorationBonusScope,
      })
      for (const solution of amendmentResult.solutions) {
        searchedAmendmentRoutes.add(kindForAmendment(solution))
        if (canSkill) searchedAmendmentRoutes.add('existing_gogma_mixed')
      }
      for (const unsupported of amendmentResult.unsupportedPredictions) {
        if (unsupported.type !== 'keep_bonuses') continue
        keepUnsupportedSources.add(source.id)
        const message = `Keep Bonuses branches from OwnedWeapon '${source.id}' were excluded by input support (${unsupported.reason}).`
        if (!result.warnings.some((warning) => warning.message === message)) {
          result.warnings.push({ targetWeaponId: context.target.id, message })
        }
      }
    }

    result.candidates.push(...await composeRouteCandidates(context, {
      kindResolution: { type: 'existing_gogma' },
      sourceOwnedWeaponId: source.id,
      baseOperations: [],
      bonusSolutions: routeBonusSolutions(
        amendmentResult,
        zeroBonusSolution(source),
        source.id,
      ),
      skillSolutions,
    }))
  }

  if (destructive.length === 0) {
    pushAll(result, destructiveKinds, 'no_unprotected_source_weapon', 'Only protected sources are available for destructive routes.')
    return result
  }
  if (!gogmaInputsConfirmed || !engine.capabilities.supportsGogmaPrediction) {
    pushAll(result, destructiveKinds, gogmaInputsConfirmed ? 'gogma_prediction_unsupported' : 'rng_state_unconfirmed', gogmaInputsConfirmed ? 'The active RNG Engine does not support Gogma prediction.' : 'Confirmed Base Seed and Gogma Counter are required.')
    return result
  }

  // Queried only once the destructive preconditions hold, so an unavailable
  // source or unconfirmed Gogma input never triggers a support query.
  const resetSupport = context.predictionSupport.gogmaReset()
  const canReset = resetSupport.supported

  if (searchedAmendmentRoutes.has('existing_gogma_reset_bonuses')) {
    result.searchedRoutes.push('existing_gogma_reset_bonuses')
  } else {
    result.skippedRoutes.push({
      route: 'existing_gogma_reset_bonuses',
      reason: !canReset && resetSupport.reason === 'master_data_unavailable'
        ? 'master_data_unavailable'
        : 'gogma_prediction_unsupported',
      detail: canReset
        ? 'No Reset Bonuses branch was searchable for the available sources.'
        : `Reset Bonuses input is unsupported (${resetSupport.reason}).`,
    })
  }

  if (searchedAmendmentRoutes.has('existing_gogma_keep_bonuses')) {
    result.searchedRoutes.push('existing_gogma_keep_bonuses')
  } else if (pureKeepSources.length === 0) {
    result.skippedRoutes.push({ route: 'existing_gogma_keep_bonuses', reason: 'normal_scope_requires_reset', detail: 'Keep Bonuses cannot be the first amendment of inherited Normal-scope bonuses.' })
  } else {
    result.skippedRoutes.push({
      route: 'existing_gogma_keep_bonuses',
      reason: 'keep_prediction_unsupported',
      detail: canKeep
        ? `Keep Bonuses input is unsupported for ${keepUnsupportedSources.size || pureKeepSources.length} available source(s).`
        : 'The active RNG Engine does not support Keep Bonuses prediction.',
    })
  }

  if (searchedAmendmentRoutes.has('existing_gogma_mixed')) {
    result.searchedRoutes.push('existing_gogma_mixed')
  } else {
    result.skippedRoutes.push({
      route: 'existing_gogma_mixed',
      reason: !canReset && resetSupport.reason === 'master_data_unavailable'
        ? 'master_data_unavailable'
        : hasSkillInputs && !canSkill
          ? 'skill_prediction_unsupported'
          : !hasSkillInputs
            ? 'rng_state_unconfirmed'
            : !canKeep
              ? 'keep_prediction_unsupported'
              : 'gogma_prediction_unsupported',
      detail: 'No supported mixed operation combination was searchable.',
    })
  }
  return result
}
