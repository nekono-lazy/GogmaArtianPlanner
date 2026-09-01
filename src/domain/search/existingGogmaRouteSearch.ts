import type { BuildRoute, OwnedGogmaArtianWeapon, RouteOperation } from '../models/publicTypes'
import {

  hasConfirmedGogmaInputs,
  hasConfirmedSkillInputs,
  searchBonusAmendmentVariants,
  searchResetSkillVariants,
  type RouteSearchContext,
  type RouteSearchResult,
} from './routeSearchShared'

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

function kindForAmendment(source: OwnedGogmaArtianWeapon, operations: RouteOperation[]): BuildRoute['kind'] {
  const amendments = operations.filter((operation) => operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses')
  const hasReset = amendments.some((operation) => operation.type === 'reset_bonuses')
  const hasKeep = amendments.some((operation) => operation.type === 'keep_bonuses')
  if (hasReset && !hasKeep) return 'existing_gogma_reset_bonuses'
  if (hasKeep && !hasReset) return 'existing_gogma_keep_bonuses'
  void source
  return 'existing_gogma_mixed'
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
  if (canSkill) {
    result.searchedRoutes.push('existing_gogma_reset_skills')
    for (const source of all) {
      result.candidates.push(...await searchResetSkillVariants(context, {
        bonuses: source.restorationBonuses,
        restorationBonusScope: source.restorationBonusScope,
        operations: [],
        sourceOwnedWeaponId: source.id,
        skillCounterBefore: input.rngState.skillCounter.value!,
        kind: 'existing_gogma_reset_skills',
      }))
    }
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
  if (destructive.length === 0) {
    pushAll(result, destructiveKinds, 'no_unprotected_source_weapon', 'Only protected sources are available for destructive routes.')
    return result
  }
  if (!hasConfirmedGogmaInputs(input) || !engine.capabilities.supportsGogmaPrediction) {
    pushAll(result, destructiveKinds, hasConfirmedGogmaInputs(input) ? 'gogma_prediction_unsupported' : 'rng_state_unconfirmed', hasConfirmedGogmaInputs(input) ? 'The active RNG Engine does not support Gogma prediction.' : 'Confirmed Base Seed and Gogma Counter are required.')
    return result
  }

  const resetSupport = context.predictionSupport.gogmaReset()
  const canReset = resetSupport.supported
  const canKeep = engine.capabilities.supportsKeepBonusesPrediction
  const pureKeepSources = destructive.filter(
    ({ restorationBonusScope }) => restorationBonusScope === 'gogma_artian',
  )
  const searchedAmendmentRoutes = new Set<BuildRoute['kind']>()
  const keepUnsupportedSources = new Set<OwnedGogmaArtianWeapon['id']>()

  for (const source of destructive) {
    const base: RouteOperation[] = []
    const common = {
      bonuses: source.restorationBonuses,
      restorationBonusScope: source.restorationBonusScope,
      operations: base,
      sourceOwnedWeaponId: source.id,
      skillCounterBefore: input.rngState.skillCounter.value ?? undefined,
      kind: 'existing_gogma_mixed' as const,
      seriesSkillId: source.seriesSkillId,
      groupSkillId: source.groupSkillId,
      gogmaCounterBefore: input.rngState.gogmaCounter.value!,
      amendmentSourceOwnedWeaponId: source.id,
      kindForAmendment: (operations: RouteOperation[]) => kindForAmendment(source, operations),
    }
    const amendmentResult = await searchBonusAmendmentVariants(context, common)
    result.candidates.push(...amendmentResult.candidates)
    amendmentResult.searchedRoutes.forEach((route) => searchedAmendmentRoutes.add(route))
    for (const unsupported of amendmentResult.unsupportedPredictions) {
      if (unsupported.type !== 'keep_bonuses') continue
      keepUnsupportedSources.add(source.id)
      const message = `Keep Bonuses branches from OwnedWeapon '${source.id}' were excluded by input support (${unsupported.reason}).`
      if (!result.warnings.some((warning) => warning.message === message)) {
        result.warnings.push({ targetWeaponId: context.target.id, message })
      }
    }
  }

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
