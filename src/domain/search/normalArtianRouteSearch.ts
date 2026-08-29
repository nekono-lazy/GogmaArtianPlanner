import type {
  CreateNormalArtianOperation,
  RouteOperation,
} from '../models/publicTypes'
import { deriveRngCapabilities } from '../rng/capabilities'
import type { RouteSearchContext, RouteSearchResult } from './routeSearchShared'
import { searchResetSkillVariants } from './routeSearchShared'

function hasNormalArtianLottery(
  context: RouteSearchContext,
  rarity: CreateNormalArtianOperation['rarity'],
): boolean {
  return context.input.master.lotteries.some(
    (entry) =>
      entry.isEnabled &&
      entry.lotteryKind === 'normal_artian_bonus' &&
      entry.weaponTypeId === context.target.weaponTypeId &&
      entry.rarity === rarity,
  )
}

export async function searchNormalArtianRoutes(
  context: RouteSearchContext,
): Promise<RouteSearchResult> {
  const { target, input, engine, execution } = context
  const result: RouteSearchResult = {
    candidates: [],
    searchedRoutes: [],
    skippedRoutes: [],
    warnings: [],
  }
  const matchingCounters = input.normalCounters
    .filter(
      (counter) =>
        counter.weaponTypeId === target.weaponTypeId &&
        counter.isConfirmed &&
        counter.counter !== null,
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  if (matchingCounters.length === 0) {
    result.skippedRoutes.push({
      route: 'normal_artian',
      reason: 'normal_counter_unconfirmed',
      detail: `No confirmed Normal Artian Counter is available for '${target.weaponTypeId}'.`,
    })
    return result
  }

  const usableCounters = matchingCounters.filter((counter) => {
    if (hasNormalArtianLottery(context, counter.rarity)) return true
    result.skippedRoutes.push({
      route: 'normal_artian',
      reason: 'master_data_unavailable',
      detail: `Normal Artian Lottery master data is unavailable for '${counter.id}'.`,
    })
    return false
  })
  if (usableCounters.length === 0) return result

  const sampleCounter = usableCounters[0]
  const createOperation: CreateNormalArtianOperation = {
    type: 'create_normal_artian',
    weaponTypeId: target.weaponTypeId,
    rarity: sampleCounter.rarity,
    count: 1,
    normalCounterBefore: sampleCounter.counter as number,
    normalCounterAfter: sampleCounter.counter as number,
  }
  const requiredOperations: RouteOperation[] = [
    createOperation,
    {
      type: 'convert_normal_to_gogma',
      weaponTypeId: target.weaponTypeId,
      gogmaCounterBefore: input.rngState.gogmaCounter.value ?? 0,
      gogmaCounterAfter: input.rngState.gogmaCounter.value ?? 0,
    },
    {
      type: 'reset_skills',
      sourceOwnedWeaponId: null,
      skillCounterBefore: input.rngState.skillCounter.value ?? 0,
      skillCounterAfter: input.rngState.skillCounter.value ?? 0,
    },
  ]
  const capabilities = deriveRngCapabilities(
    input.rngState,
    input.normalCounters,
    requiredOperations,
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
  if (!capabilities.canPredictSkills) {
    result.skippedRoutes.push({
      route: 'normal_artian',
      reason: 'skill_capability_missing',
      detail: 'Skill prediction capability is required for a completed normal route.',
    })
    return result
  }

  const baseSeed = input.rngState.baseSeed.value
  const initialGogmaCounter = input.rngState.gogmaCounter.value
  const counterGate = input.rngState.counterGate.value
  if (baseSeed === null || initialGogmaCounter === null || counterGate === null) {
    return result
  }

  result.searchedRoutes.push('normal_artian_to_gogma')
  const maximumPairedAdvance = Math.min(
    input.settings.maxNormalAdvance,
    input.settings.maxGogmaAdvance,
  )
  for (const normalCounter of usableCounters) {
    let currentNormalCounter = normalCounter.counter as number
    let currentGogmaCounter = initialGogmaCounter
    const convertOperations: RouteOperation[] = []

    for (let index = 0; index < maximumPairedAdvance; index += 1) {
      await execution.checkpoint()
      engine.predictNormalArtian({
        baseSeed,
        weaponTypeId: target.weaponTypeId,
        rarity: normalCounter.rarity,
        normalCounter: currentNormalCounter,
        master: input.master,
      })
      const nextNormalCounter = engine.advanceNormalCounter(
        currentNormalCounter,
        { type: 'create_normal_artian', count: 1 },
      )
      const finalBonuses = engine.predictGogmaBonus({
        baseSeed,
        gogmaCounter: currentGogmaCounter,
        counterGate,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'new_gogma' },
        master: input.master,
      })
      const nextGogmaCounter = engine.advanceGogmaCounter(
        currentGogmaCounter,
        { type: 'create_gogma_from_normal' },
      )
      convertOperations.push({
        type: 'convert_normal_to_gogma',
        weaponTypeId: target.weaponTypeId,
        gogmaCounterBefore: currentGogmaCounter,
        gogmaCounterAfter: nextGogmaCounter,
      })
      const operations: RouteOperation[] = [
        {
          type: 'create_normal_artian',
          weaponTypeId: target.weaponTypeId,
          rarity: normalCounter.rarity,
          count: index + 1,
          normalCounterBefore: normalCounter.counter as number,
          normalCounterAfter: nextNormalCounter,
        },
        ...convertOperations,
      ]
      result.candidates.push(
        ...(await searchResetSkillVariants(context, {
          bonuses: finalBonuses,
          operations,
          sourceOwnedWeaponId: null,
          kind: 'normal_artian_to_gogma',
        })),
      )
      currentNormalCounter = nextNormalCounter
      currentGogmaCounter = nextGogmaCounter
    }
  }
  return result
}
