import { getBonusRank } from '../master/masterSelectors'
import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type {
  BuildRoute,
  OwnedWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../models/publicTypes'
import { deriveRngCapabilities } from '../rng/capabilities'
import { evaluatePracticalBonusConditions } from '../target'
import {
  createBaseCandidate,
  searchResetSkillVariants,
  type RouteSearchContext,
  type RouteSearchResult,
} from './routeSearchShared'

function compatibleWeapons(context: RouteSearchContext): OwnedWeapon[] {
  return context.input.ownedWeapons
    .filter(
      (weapon) =>
        weapon.weaponTypeId === context.target.weaponTypeId &&
        weapon.elementId === context.target.elementId,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

function bonusesCanMeetTarget(
  context: RouteSearchContext,
  weapon: OwnedWeapon,
): boolean {
  return (
    areRestorationBonusSetsEqual(
      weapon.restorationBonuses,
      context.target.idealBonuses,
    ) ||
    evaluatePracticalBonusConditions(
      context.target.practicalBonusConditions,
      context.target.practicalAlternativeGroups,
      weapon.restorationBonuses,
      context.input.master,
    )
  )
}

function hasUsefulKeepBonus(
  context: RouteSearchContext,
  weapon: OwnedWeapon,
): boolean {
  return weapon.restorationBonuses.some((bonus) => {
    if (
      context.target.idealBonuses.some(
        (ideal) =>
          ideal.bonusTypeId === bonus.bonusTypeId &&
          ideal.bonusRankId === bonus.bonusRankId,
      )
    ) {
      return true
    }
    const rankOrder = getBonusRank(
      context.input.master,
      bonus.bonusRankId,
    ).order
    return (
      context.target.practicalBonusConditions.some(
        (condition) =>
          condition.bonusTypeId === bonus.bonusTypeId &&
          rankOrder >=
            getBonusRank(context.input.master, condition.minimumRankId).order,
      ) ||
      context.target.practicalAlternativeGroups.some((group) =>
        group.options.some(
          (option) =>
            option.bonusTypeId === bonus.bonusTypeId &&
            rankOrder >=
              getBonusRank(
                context.input.master,
                option.minimumRankId,
              ).order,
        ),
      )
    )
  })
}

async function searchResetSkillsOnly(
  context: RouteSearchContext,
  sources: readonly OwnedWeapon[],
  result: RouteSearchResult,
): Promise<void> {
  const sourceCandidates = sources.filter((source) =>
    bonusesCanMeetTarget(context, source),
  )
  if (sourceCandidates.length === 0) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'no_owned_weapon_available',
      detail: 'No compatible OwnedWeapon has bonuses that can meet the Target.',
    })
    return
  }
  const sampleSource = sourceCandidates[0]
  const sampleOperation: RouteOperation = {
    type: 'reset_skills',
    sourceOwnedWeaponId: sampleSource.id,
    skillCounterBefore: context.input.rngState.skillCounter.value ?? 0,
    skillCounterAfter: context.input.rngState.skillCounter.value ?? 0,
  }
  const capability = deriveRngCapabilities(
    context.input.rngState,
    context.input.normalCounters,
    [sampleOperation],
    context.engine.capabilities,
  )
  if (!capability.canPredictSkills) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'skill_capability_missing',
      detail: 'Skill prediction capability is unavailable.',
    })
    return
  }

  result.searchedRoutes.push('existing_gogma_reset_skills')
  for (const source of sourceCandidates) {
    result.candidates.push(
      ...(await searchResetSkillVariants(context, {
        bonuses: source.restorationBonuses,
        operations: [],
        sourceOwnedWeaponId: source.id,
        kind: 'existing_gogma_reset_skills',
      })),
    )
  }
}

async function searchResetBonuses(
  context: RouteSearchContext,
  sources: readonly OwnedWeapon[],
  result: RouteSearchResult,
): Promise<void> {
  const sample = sources[0]
  const sampleOperation: RouteOperation = {
    type: 'reset_bonuses',
    sourceOwnedWeaponId: sample.id,
    gogmaCounterBefore: context.input.rngState.gogmaCounter.value ?? 0,
    gogmaCounterAfter: context.input.rngState.gogmaCounter.value ?? 0,
  }
  const capabilities = deriveRngCapabilities(
    context.input.rngState,
    context.input.normalCounters,
    [sampleOperation],
    context.engine.capabilities,
  )
  if (!capabilities.canPredictGogma) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'gogma_capability_missing',
      detail: 'Gogma prediction capability is unavailable.',
    })
    return
  }
  const baseSeed = context.input.rngState.baseSeed.value
  const initialCounter = context.input.rngState.gogmaCounter.value
  const counterGate = context.input.rngState.counterGate.value
  if (baseSeed === null || initialCounter === null || counterGate === null) return

  result.searchedRoutes.push('existing_gogma_reset_bonuses')
  if (capabilities.canPredictSkills) {
    result.searchedRoutes.push('existing_gogma_mixed')
  }
  for (const source of sources) {
    let currentCounter = initialCounter
    const operations: RouteOperation[] = []
    for (
      let index = 0;
      index < context.input.settings.maxGogmaAdvance;
      index += 1
    ) {
      await context.execution.checkpoint()
      const bonuses = context.engine.predictGogmaBonus({
        baseSeed,
        gogmaCounter: currentCounter,
        counterGate,
        weaponTypeId: context.target.weaponTypeId,
        elementId: context.target.elementId,
        operation: { type: 'reset_bonuses' },
        master: context.input.master,
      })
      const nextCounter = context.engine.advanceGogmaCounter(currentCounter, {
        type: 'reset_bonuses',
      })
      operations.push({
        type: 'reset_bonuses',
        sourceOwnedWeaponId: source.id,
        gogmaCounterBefore: currentCounter,
        gogmaCounterAfter: nextCounter,
      })
      const route: BuildRoute = {
        kind: 'existing_gogma_reset_bonuses',
        sourceOwnedWeaponId: source.id,
        operations: [...operations],
      }
      const baseCandidate = createBaseCandidate(
        context,
        bonuses,
        source.seriesSkillId,
        source.groupSkillId,
        route,
      )
      if (baseCandidate) result.candidates.push(baseCandidate)
      if (capabilities.canPredictSkills) {
        result.candidates.push(
          ...(await searchResetSkillVariants(context, {
            bonuses,
            operations: [...operations],
            sourceOwnedWeaponId: source.id,
            kind: 'existing_gogma_mixed',
          })),
        )
      }
      currentCounter = nextCounter
    }
  }
}

async function searchKeepBonuses(
  context: RouteSearchContext,
  sources: readonly OwnedWeapon[],
  result: RouteSearchResult,
): Promise<void> {
  interface KeepSearchState {
    bonuses: RestorationBonusSet
    counter: number
    operations: RouteOperation[]
  }
  if (!context.engine.capabilities.supportsKeepBonusesPrediction) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'keep_prediction_unsupported',
      detail: 'The active RNG Engine does not support Keep Bonuses prediction.',
    })
    return
  }
  const usefulSources = sources.filter((source) =>
    hasUsefulKeepBonus(context, source),
  )
  if (usefulSources.length === 0) return
  const sample: RouteOperation = {
    type: 'keep_bonuses',
    sourceOwnedWeaponId: usefulSources[0].id,
    selection: { mode: 'engine_defined', engineParameters: {} },
    gogmaCounterBefore: context.input.rngState.gogmaCounter.value ?? 0,
    gogmaCounterAfter: context.input.rngState.gogmaCounter.value ?? 0,
  }
  const capabilities = deriveRngCapabilities(
    context.input.rngState,
    context.input.normalCounters,
    [sample],
    context.engine.capabilities,
  )
  if (!capabilities.canPredictGogma) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'gogma_capability_missing',
      detail: 'Gogma prediction capability is unavailable for Keep Bonuses.',
    })
    return
  }
  const baseSeed = context.input.rngState.baseSeed.value
  const gogmaCounter = context.input.rngState.gogmaCounter.value
  const counterGate = context.input.rngState.counterGate.value
  if (baseSeed === null || gogmaCounter === null || counterGate === null) return

  result.searchedRoutes.push('existing_gogma_keep_bonuses')
  if (capabilities.canPredictSkills) {
    if (!result.searchedRoutes.includes('existing_gogma_mixed')) {
      result.searchedRoutes.push('existing_gogma_mixed')
    }
  }
  for (const source of usefulSources) {
    let frontier: KeepSearchState[] = [
      {
        bonuses: source.restorationBonuses,
        counter: gogmaCounter,
        operations: [] as RouteOperation[],
      },
    ]
    for (
      let depth = 0;
      depth < context.input.settings.maxGogmaAdvance && frontier.length > 0;
      depth += 1
    ) {
      const nextFrontier: KeepSearchState[] = []
      for (const state of frontier) {
        await context.execution.checkpoint()
        const selections = context.engine.enumerateKeepSelections({
          sourceBonuses: state.bonuses,
          weaponTypeId: context.target.weaponTypeId,
          elementId: context.target.elementId,
          master: context.input.master,
        })
        for (const selection of selections) {
          await context.execution.checkpoint()
          const bonuses = context.engine.predictGogmaBonus({
            baseSeed,
            gogmaCounter: state.counter,
            counterGate,
            weaponTypeId: context.target.weaponTypeId,
            elementId: context.target.elementId,
            operation: { type: 'keep_bonuses', selection },
            master: context.input.master,
          })
          const nextCounter = context.engine.advanceGogmaCounter(
            state.counter,
            { type: 'keep_bonuses', selection },
          )
          const operation: RouteOperation = {
            type: 'keep_bonuses',
            sourceOwnedWeaponId: source.id,
            selection,
            gogmaCounterBefore: state.counter,
            gogmaCounterAfter: nextCounter,
          }
          const operations = [...state.operations, operation]
          const baseCandidate = createBaseCandidate(
            context,
            bonuses,
            source.seriesSkillId,
            source.groupSkillId,
            {
              kind: 'existing_gogma_keep_bonuses',
              sourceOwnedWeaponId: source.id,
              operations,
            },
          )
          if (baseCandidate) result.candidates.push(baseCandidate)
          if (capabilities.canPredictSkills) {
            result.candidates.push(
              ...(await searchResetSkillVariants(context, {
                bonuses,
                operations,
                sourceOwnedWeaponId: source.id,
                kind: 'existing_gogma_mixed',
              })),
            )
          }
          nextFrontier.push({ bonuses, counter: nextCounter, operations })
        }
      }
      frontier = nextFrontier
    }
  }
}

export async function searchExistingGogmaRoutes(
  context: RouteSearchContext,
): Promise<RouteSearchResult> {
  const result: RouteSearchResult = {
    candidates: [],
    searchedRoutes: [],
    skippedRoutes: [],
    warnings: [],
  }
  const compatible = compatibleWeapons(context)
  if (compatible.length === 0) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'no_owned_weapon_available',
      detail: 'No OwnedWeapon matches the Target weapon type and element.',
    })
    return result
  }

  await searchResetSkillsOnly(context, compatible, result)
  const unprotected = compatible.filter((weapon) => !weapon.isProtected)
  if (unprotected.length === 0) {
    result.skippedRoutes.push({
      route: 'existing_gogma',
      reason: 'no_unprotected_source_weapon',
      detail: 'Only protected sources are available for destructive routes.',
    })
    return result
  }
  await searchResetBonuses(context, unprotected, result)
  await searchKeepBonuses(context, unprotected, result)
  return result
}
