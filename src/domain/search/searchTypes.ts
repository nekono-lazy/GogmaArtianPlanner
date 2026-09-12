import type {
  BuildCandidate,
  CalculationContext,
  NormalArtianCounter,
  OwnedWeapon,
  RngState,
  RouteKind,
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

/**
 * The three stream extents of one Candidate Search.
 *
 * There is no result filter, no output cap, and no similarity threshold: a
 * Search produces at most one canonical Ideal Candidate, so nothing needs to
 * bound a retained Practical set or rank results by closeness
 * (`docs/SEARCH_SPEC.md` 4.2).
 */
export interface CandidateSearchSettings {
  maxNormalAdvance: number
  maxGogmaAdvance: number
  maxSkillAdvance: number
}

/**
 * B6 defaults, chosen from the real Browser Worker measurements recorded in
 * `docs/B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md`: Normal 1000 ~ 256 ms,
 * Skill 1000 ~ 325 ms, Gogma 200 ~ 1961 ms. These are defaults, not caps: the
 * Search UI still lets the user raise every bound.
 */
export const defaultCandidateSearchSettings: CandidateSearchSettings = {
  maxNormalAdvance: 1000,
  maxGogmaAdvance: 200,
  maxSkillAdvance: 1000,
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

/**
 * One Candidate Search request, for exactly one TargetWeapon.
 *
 * Multi-Target search was removed with the canonical Ideal Route model: the
 * Search decides one Target's Ideal Route and the checkpoints on it, while
 * reconciling several Targets is the Production Planner's job
 * (`docs/SEARCH_SPEC.md` 4.1).
 */
export interface CandidateSearchInput {
  searchRunId: string
  targetWeaponId: TargetWeaponId
  routeFilter: CandidateRouteFilter
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

/**
 * The searched Target's result: at most one canonical Ideal Candidate.
 *
 * `candidate === null` means no Ideal was found inside the configured search
 * extent. It never means an Ideal does not exist, and compromise states found
 * on the way are deliberately not returned: only a strict prefix of an actual
 * Ideal Route can be offered as a checkpoint (`docs/SEARCH_SPEC.md` 5.7).
 */
export interface TargetCandidateSearchResult {
  targetWeaponId: TargetWeaponId
  candidate: BuildCandidate | null
  searchedRoutes: RouteKind[]
  skippedRoutes: SkippedRoute[]
}

export interface CandidateSearchResult {
  searchRunId: string
  calculationContext: CalculationContext
  targetResult: TargetCandidateSearchResult
  warnings: CandidateSearchWarning[]
  elapsedMs: number
}

/**
 * `preparing` is emitted when the search starts, `searching` while the
 * scheduler settles work, and `finalizing` once the Target is done.
 */
export type CandidateSearchProgressPhase = 'preparing' | 'searching' | 'finalizing'

export interface CandidateSearchProgress {
  targetWeaponId: TargetWeaponId
  phase: CandidateSearchProgressPhase
  /**
   * Scheduler work items settled so far. Total work is discovered while
   * searching, so this is an activity signal only and must never be presented
   * as a completion percent.
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
