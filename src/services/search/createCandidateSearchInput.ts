import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { CalculationContext, TargetWeaponId } from '../../domain/models/publicTypes'
import type {
  CandidateResultFilter,
  CandidateRouteFilter,
  CandidateSearchInput,
  CandidateSearchSettings,
} from '../../domain/search'
import {
  normalArtianCounterRepository,
  ownedWeaponRepository,
  rngStateRepository,
  targetWeaponRepository,
} from '../../db/repositories'
import { settingsRepository } from '../../db/settingsRepository'

export interface SearchInputRepositories {
  ensureInitialRngState: typeof rngStateRepository.ensureInitialRngState
  getAllNormalArtianCounters: typeof normalArtianCounterRepository.getAllNormalArtianCounters
  getAllOwnedWeapons: typeof ownedWeaponRepository.getAllOwnedWeapons
  getAllTargetWeapons: typeof targetWeaponRepository.getAllTargetWeapons
  ensureSettings: typeof settingsRepository.ensureSettings
}

export const defaultSearchInputRepositories: SearchInputRepositories = {
  ensureInitialRngState: () => rngStateRepository.ensureInitialRngState(),
  getAllNormalArtianCounters: () =>
    normalArtianCounterRepository.getAllNormalArtianCounters(),
  getAllOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
  getAllTargetWeapons: () => targetWeaponRepository.getAllTargetWeapons(),
  ensureSettings: () => settingsRepository.ensureSettings(),
}

export interface CreateCandidateSearchInputOptions {
  searchRunId: string
  targetWeaponIds: TargetWeaponId[]
  routeFilter: CandidateRouteFilter
  resultFilter: CandidateResultFilter
  settings: CandidateSearchSettings
  master: MasterDataRoot
  calculationContext: CalculationContext
}

export async function createCandidateSearchInput(
  options: CreateCandidateSearchInputOptions,
  repositories: SearchInputRepositories = defaultSearchInputRepositories,
): Promise<CandidateSearchInput> {
  const [rngState, normalCounters, ownedWeapons, targetWeapons] =
    await Promise.all([
      repositories.ensureInitialRngState(),
      repositories.getAllNormalArtianCounters(),
      repositories.getAllOwnedWeapons(),
      repositories.getAllTargetWeapons(),
      repositories.ensureSettings(),
    ])
  return {
    searchRunId: options.searchRunId,
    targetWeaponIds: [...options.targetWeaponIds],
    routeFilter: options.routeFilter,
    resultFilter: options.resultFilter,
    rngState,
    normalCounters,
    ownedWeapons,
    targetWeapons,
    settings: { ...options.settings },
    master: {
      weaponBonusDefinitions: options.master.weaponBonusDefinitions,
      weaponTypes: options.master.weaponTypes,
      elements: options.master.elements,
      bonusTypes: options.master.bonusTypes,
      bonusRanks: options.master.bonusRanks,
      lotteries: options.master.lotteries,
      materialCosts: options.master.materialCosts,
    },
    calculationContext: { ...options.calculationContext },
  }
}
