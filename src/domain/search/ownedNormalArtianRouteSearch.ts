import type { RouteOperation } from '../models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../models/publicTypes'
import { deriveRngCapabilities } from '../rng/capabilities'
import type { RouteSearchContext, RouteSearchResult } from './routeSearchShared'
import {
  createBaseCandidate,
  searchResetSkillVariants,
} from './routeSearchShared'

/**
 * Searches only explicitly registered Normal Artian weapons.
 *
 * The conversion result is always supplied by RngEngine. The explicit Master
 * mapping is not a rank conversion algorithm and is deliberately not used here.
 */
export async function searchOwnedNormalArtianRoutes(
  context: RouteSearchContext,
): Promise<RouteSearchResult> {
  const { target, input, engine, execution } = context
  const result: RouteSearchResult = {
    candidates: [],
    searchedRoutes: [],
    skippedRoutes: [],
    warnings: [],
  }
  const compatible = input.ownedWeapons
    .filter(
      (weapon) =>
        weapon.kind === 'normal' &&
        weapon.rarity === V1_NORMAL_ARTIAN_RARITY &&
        weapon.weaponTypeId === target.weaponTypeId &&
        weapon.elementId === target.elementId,
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  if (compatible.length === 0) {
    result.skippedRoutes.push({
      route: 'normal_artian',
      reason: 'no_owned_weapon_available',
      detail: 'No compatible owned Normal Artian weapon is available.',
    })
    return result
  }

  const sources = compatible.filter(({ isProtected }) => !isProtected)
  if (sources.length === 0) {
    result.skippedRoutes.push({
      route: 'normal_artian',
      reason: 'no_unprotected_source_weapon',
      detail: 'Only protected owned Normal Artian sources are available.',
    })
    return result
  }

  const sampleOperation: RouteOperation = {
    type: 'convert_normal_to_gogma',
    weaponTypeId: target.weaponTypeId,
    gogmaCounterBefore: input.rngState.gogmaCounter.value ?? 0,
    gogmaCounterAfter: input.rngState.gogmaCounter.value ?? 0,
  }
  const capabilities = deriveRngCapabilities(
    input.rngState,
    input.normalCounters,
    [sampleOperation],
    engine.capabilities,
  )
  if (!capabilities.canPredictGogma) {
    result.skippedRoutes.push({
      route: 'normal_artian',
      reason: 'gogma_capability_missing',
      detail: 'Gogma prediction capability is required for conversion.',
    })
    return result
  }

  const baseSeed = input.rngState.baseSeed.value
  const currentCounter = input.rngState.gogmaCounter.value
  const counterGate = input.rngState.counterGate.value
  if (baseSeed === null || currentCounter === null || counterGate === null) {
    return result
  }

  result.searchedRoutes.push('owned_normal_artian_to_gogma')
  for (const source of sources) {
    await execution.checkpoint()
    const finalBonuses = engine.predictGogmaBonus({
      baseSeed,
      gogmaCounter: currentCounter,
      counterGate,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      operation: {
        type: 'new_gogma',
        sourceNormalBonuses: source.restorationBonuses,
      },
      master: input.master,
    })
    const nextCounter = engine.advanceGogmaCounter(currentCounter, {
      type: 'create_gogma_from_normal',
    })
    const operations: RouteOperation[] = [
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId: target.weaponTypeId,
        gogmaCounterBefore: currentCounter,
        gogmaCounterAfter: nextCounter,
      },
    ]
    const baseCandidate = createBaseCandidate(
      context,
      finalBonuses,
      null,
      null,
      {
        kind: 'owned_normal_artian_to_gogma',
        sourceOwnedWeaponId: source.id,
        operations,
      },
    )
    if (baseCandidate) result.candidates.push(baseCandidate)

    if (capabilities.canPredictSkills) {
      result.candidates.push(
        ...(await searchResetSkillVariants(context, {
          bonuses: finalBonuses,
          operations,
          sourceOwnedWeaponId: source.id,
          resetSkillsSourceOwnedWeaponId: null,
          kind: 'owned_normal_artian_to_gogma',
        })),
      )
    }
  }
  return result
}
