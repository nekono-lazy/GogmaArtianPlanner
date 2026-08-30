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

  const canSkill = hasConfirmedSkillInputs(input) && engine.capabilities.supportsSkillPrediction
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
    result.skippedRoutes.push({ route: 'existing_gogma_reset_skills', reason: hasConfirmedSkillInputs(input) ? 'skill_prediction_unsupported' : 'rng_state_unconfirmed', detail: hasConfirmedSkillInputs(input) ? 'The active RNG Engine does not support Skill prediction.' : 'Confirmed Base Seed, Skill Counter, and Counter Gate are required.' })
  }

  const destructive = all.filter((weapon) => !weapon.isProtected)
  if (destructive.length === 0) {
    pushAll(result, destructiveKinds, 'no_unprotected_source_weapon', 'Only protected sources are available for destructive routes.')
    return result
  }
  if (!hasConfirmedGogmaInputs(input) || !engine.capabilities.supportsGogmaPrediction) {
    pushAll(result, destructiveKinds, hasConfirmedGogmaInputs(input) ? 'gogma_prediction_unsupported' : 'rng_state_unconfirmed', hasConfirmedGogmaInputs(input) ? 'The active RNG Engine does not support Gogma prediction.' : 'Confirmed Base Seed, Gogma Counter, and Counter Gate are required.')
    return result
  }

  const canKeep = engine.capabilities.supportsKeepBonusesPrediction
  const canMixed = canSkill || canKeep
  result.searchedRoutes.push('existing_gogma_reset_bonuses')
  if (canMixed) {
    result.searchedRoutes.push('existing_gogma_mixed')
  } else {
    result.skippedRoutes.push({
      route: 'existing_gogma_mixed',
      reason: hasConfirmedSkillInputs(input)
        ? 'skill_prediction_unsupported'
        : 'rng_state_unconfirmed',
      detail: hasConfirmedSkillInputs(input)
        ? 'Mixed routes require Skill prediction or Keep Bonuses prediction.'
        : 'Mixed routes require confirmed Skill inputs or Keep Bonuses prediction.',
    })
  }
  const pureKeepSources = destructive.filter(
    ({ restorationBonusScope }) => restorationBonusScope === 'gogma_artian',
  )
  if (canKeep && pureKeepSources.length > 0) {
    result.searchedRoutes.push('existing_gogma_keep_bonuses')
  }

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
    result.candidates.push(...await searchBonusAmendmentVariants(context, common))
    if (!canKeep && source.restorationBonusScope === 'gogma_artian') {
      result.skippedRoutes.push({ route: 'existing_gogma_keep_bonuses', reason: 'keep_prediction_unsupported', detail: 'The active RNG Engine does not support Keep Bonuses prediction.' })
    }
    if (source.restorationBonusScope === 'normal_artian') {
      result.skippedRoutes.push({ route: 'existing_gogma_keep_bonuses', reason: 'normal_scope_requires_reset', detail: 'Keep Bonuses cannot be the first amendment of inherited Normal-scope bonuses.' })
    }
  }
  result.skippedRoutes = result.skippedRoutes.filter((skipped) => !result.searchedRoutes.includes(skipped.route))
  return result
}
