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
  BonusTypeMaster,
  BonusRankMaster,
  ElementMaster,
  LotteryMaster,
  MaterialCostMaster,
  WeaponBonusDefinition,
  WeaponTypeMaster,
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

/**
 * B6 defaults, chosen from the real Browser Worker measurements recorded in
 * `docs/B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md`: Normal 1000 ~ 256 ms,
 * Skill 1000 ~ 325 ms, Gogma 200 ~ 1961 ms. The former `5000 / 5000 / 5000`
 * finished quickly when an Ideal was near but did not complete within 60 s
 * when none existed. These are defaults, not caps: the Search UI still lets the
 * user raise every bound.
 */
export const defaultCandidateSearchSettings: CandidateSearchSettings = {
  maxNormalAdvance: 1000,
  maxGogmaAdvance: 200,
  maxSkillAdvance: 1000,
  maxCandidatesPerTarget: 200,
  similarityThreshold: 0.6,
}

export interface SearchMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[]
  weaponTypes: WeaponTypeMaster[]
  elements: ElementMaster[]
  bonusTypes: BonusTypeMaster[]
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
  | 'rng_state_unconfirmed'
  | 'normal_prediction_unsupported'
  | 'skill_prediction_unsupported'
  | 'gogma_prediction_unsupported'
  | 'normal_scope_keep_prediction_unsupported'
  | 'calculation_context_incompatible'
  | 'disabled_by_filter'

export interface SkippedRoute {
  route: RouteKind
  reason: SkippedRouteReason
  detail: string
}

/**
 * How a Candidate Search notice should be presented.
 *
 * `info` is a search that succeeded under a narrower method than usual, which
 * is neither an error nor a degraded result. `warning` is a genuine capability
 * gap or an exclusion the user should weigh when reading the result.
 */
export type CandidateSearchNoticeSeverity = 'info' | 'warning'

export interface CandidateSearchWarning {
  targetWeaponId: TargetWeaponId | null
  severity: CandidateSearchNoticeSeverity
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

/**
 * `preparing` is emitted when a Target's search starts, `searching` while the
 * Target's scheduler settles work, and `finalizing` once that Target is done.
 */
export type CandidateSearchProgressPhase = 'preparing' | 'searching' | 'finalizing'

export interface CandidateSearchProgress {
  completedTargets: number
  totalTargets: number
  currentTargetWeaponId: TargetWeaponId | null
  phase: CandidateSearchProgressPhase
  /**
   * Scheduler work items settled for the current Target, restarting at 0 for
   * each Target. Total work is discovered while searching, so this is an
   * activity signal only and must never be presented as a completion percent.
   */
  processedWorkItems: number
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
