import type {
  AlternativeBonusConditionGroup,
  BonusCondition,
  BuildCandidate,
  CalculationContext,
  NormalArtianCounter,
  OwnedWeapon,
  RngState,
  RouteKind,
  SkillCondition,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import type {
  BonusRankMaster,
  LotteryMaster,
  MaterialCostMaster,
  WeaponBonusDefinition,
} from '../master/masterTypes'

export type CandidateRouteFilter = 'all' | 'normal_artian' | 'existing_gogma'
export type CandidateResultFilter = 'all' | 'ideal' | 'practical' | 'similar'

export interface CandidateSearchSettings {
  maxNormalAdvance: number
  maxGogmaAdvance: number
  maxSkillAdvance: number
  maxCandidatesPerTarget: number
  similarityThreshold: number
}

export const defaultCandidateSearchSettings: CandidateSearchSettings = {
  maxNormalAdvance: 5000,
  maxGogmaAdvance: 5000,
  maxSkillAdvance: 5000,
  maxCandidatesPerTarget: 200,
  similarityThreshold: 0.6,
}

export interface SearchMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[]
  bonusRanks: BonusRankMaster[]
  lotteries: LotteryMaster[]
  materialCosts: MaterialCostMaster[]
}

export interface CandidateSearchInput {
  searchRunId: string
  targetWeaponIds: TargetWeaponId[]
  routeFilter: CandidateRouteFilter
  resultFilter: CandidateResultFilter
  rngState: RngState
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  settings: CandidateSearchSettings
  master: SearchMasterSubset
  calculationContext: CalculationContext
}

export type SkippedRouteReason =
  | 'normal_counter_unconfirmed'
  | 'no_owned_weapon_available'
  | 'no_unprotected_source_weapon'
  | 'gogma_capability_missing'
  | 'skill_capability_missing'
  | 'keep_prediction_unsupported'
  | 'master_data_unavailable'
  | 'calculation_context_incompatible'
  | 'disabled_by_filter'

export interface SkippedRoute {
  route: CandidateRouteFilter
  reason: SkippedRouteReason
  detail: string
}

export interface CandidateSearchWarning {
  targetWeaponId: TargetWeaponId | null
  message: string
}

export interface TargetCandidateSearchResult {
  targetWeaponId: TargetWeaponId
  candidates: BuildCandidate[]
  searchedRoutes: RouteKind[]
  skippedRoutes: SkippedRoute[]
}

export interface TargetWeaponRelaxationPatch {
  practicalBonusConditions?: BonusCondition[]
  practicalAlternativeGroups?: AlternativeBonusConditionGroup[]
  practicalSkillCondition?: SkillCondition
}

export interface RelaxationSuggestion {
  id: string
  targetWeaponId: TargetWeaponId
  kind:
    | 'lower_minimum_rank'
    | 'remove_required_ex'
    | 'lower_required_count'
    | 'relax_skill_series'
    | 'relax_skill_group'
    | 'skill_match_all_to_any'
  description: string
  patch: TargetWeaponRelaxationPatch
  nearestCandidateDistance: number | null
}

export interface CandidateSearchResult {
  searchRunId: string
  calculationContext: CalculationContext
  targetResults: TargetCandidateSearchResult[]
  relaxationSuggestions: RelaxationSuggestion[]
  warnings: CandidateSearchWarning[]
  elapsedMs: number
  isTruncated: boolean
}

export interface CandidateSearchProgress {
  completedTargets: number
  totalTargets: number
  currentTargetWeaponId: TargetWeaponId | null
}

export type SearchWorkerRequest =
  | { type: 'candidate_search'; requestId: string; input: CandidateSearchInput }
  | { type: 'cancel'; requestId: string }

export type SearchWorkerResponse =
  | {
      type: 'candidate_search_result'
      requestId: string
      result: CandidateSearchResult
    }
  | ({ type: 'progress'; requestId: string } & CandidateSearchProgress)
  | { type: 'error'; requestId: string; message: string }

export type CandidateSearchErrorCode =
  | 'invalid_input'
  | 'invalid_candidate'
  | 'calculation_context_incompatible'
  | 'cancelled'

export class CandidateSearchError extends Error {
  readonly code: CandidateSearchErrorCode

  constructor(code: CandidateSearchErrorCode, message: string) {
    super(message)
    this.name = 'CandidateSearchError'
    this.code = code
  }
}
