import type {
  CalculationContext,
  CandidateCategory,
  GroupSkillId,
  IdealDifference,
  MaterialRequirement,
  NormalArtianCounter,
  OwnedWeapon,
  RestorationBonusScope,
  RestorationBonusSet,
  RngState,
  BuildRoute,
  SeriesSkillId,
  TargetWeapon,
  TargetWeaponId,
} from '../../models/publicTypes'
import type { SearchMasterSubset } from '../searchTypes'

/**
 * Planner-driven constrained candidate enumeration types (SEARCH_SPEC 5.6.7,
 * PLANNER_SPEC 9.2.9).
 *
 * This is a separate Search Domain boundary from `searchCandidates()`. It never
 * receives a Planner conflict DTO, never receives the Planner orchestration
 * bounds, and never applies the ordinary Search's UI filters.
 */

/**
 * The only authority for how far constrained enumeration searches.
 *
 * `CandidateSearchSettings` is neither the filter authority nor the extent
 * authority here. The first three bounds keep their SEARCH_SPEC 3.1 meanings;
 * `maxOffAxisPairEvaluations` is new in B8 and caps how many off-axis Cross
 * pairs (`i > 0` and `j > 0`) may be evaluated. B8-B1 takes every bound from
 * the caller: no Production default exists until the B8-B2 benchmark.
 */
export interface ConstrainedEnumerationBounds {
  /** Maximum `create_normal_artian` forge count, never the maximum offset. */
  maxNormalForgeCount: number
  /** Gogma Counter positions covered, never the Engine call count. */
  maxGogmaAdvance: number
  /** Maximum Reset Skills count. */
  maxSkillResetCount: number
  /** Off-axis Cross pair evaluation cap; `0` disables off-axis evaluation. */
  maxOffAxisPairEvaluations: number
}

/**
 * The Planner-start current validated Search / RNG snapshot.
 *
 * It is deliberately NOT a `CandidateSearchInput`: no `searchRunId`, no
 * `routeFilter`, no `resultFilter`, and no `settings`. A historical UI
 * Candidate Search request is not persisted and must never be required here.
 */
export interface ConstrainedSearchOrigin {
  rngState: RngState
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  /** The validated Target set, which must contain the enumerated Target. */
  targetWeapons: TargetWeapon[]
  master: SearchMasterSubset
  calculationContext: CalculationContext
}

export interface ConstrainedCandidateSearchInput {
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
  bounds: ConstrainedEnumerationBounds
}

/**
 * One transient Search Domain semantic result.
 *
 * It is not a `BuildCandidate`: `id`, `searchRunId`, `createdAt` and
 * `isSimilarToIdeal` are run / persistence metadata that only the B8-C
 * deterministic materializer may add. No random ID, Clock value, or enumeration
 * ordinal is folded into anything here.
 */
export interface ConstrainedCandidate {
  targetWeaponId: TargetWeaponId
  category: CandidateCategory
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  route: BuildRoute

  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  estimatedNormalAdvance: number | null
  requiredMaterials: MaterialRequirement[]

  idealDifference: IdealDifference
  /** The existing SEARCH_SPEC 5.3 formula, with no threshold applied. */
  similarityScore: number | null

  searchStateHash: string
  referencedOwnedWeaponsHash: string | null
  calculationContext: CalculationContext
}

export interface ConstrainedEnumerationSummary {
  /**
   * Completed Candidate semantic combinations carried through Target condition
   * evaluation, including combinations that satisfied neither condition.
   */
  examinedCandidates: number
  /** Off-axis Cross pairs evaluated. B8-B1a evaluates none, so this is `0`. */
  evaluatedOffAxisPairs: number
  /**
   * True only when nothing was left uncovered: no bound truncated the search
   * and no reachable Cross cell went unevaluated. Reaching a bound is never
   * reported as exhaustion.
   *
   * The two flags are not complements. Both are false while B8-B1a leaves the
   * off-axis Cross cells (`i > 0` and `j > 0`) unevaluated without any bound
   * having been reached, so a caller is never told the space is exhausted over
   * a scope the current phase has not covered. That "neither" state is a
   * B8-B1a-only interim: once B8-B1b evaluates off-axis cells, reachable cells
   * left unevaluated because of `maxOffAxisPairEvaluations` (including the
   * still-valid value `0`) become an off-axis bound stop, so
   * `stoppedByBound = true` and `exhausted = false`.
   */
  exhausted: boolean
  /** True when at least one `ConstrainedEnumerationBounds` value truncated it. */
  stoppedByBound: boolean
}

/**
 * The B8-B1a collector shape.
 *
 * `candidates` is fully materialized before the caller sees anything, which is
 * a checkpoint-only shape: B8-A's architecture has the enumerator present
 * Candidates in deterministic semantic order while Planner orchestration trials
 * them. B8-B1b replaces this as the Production entry point with an incremental
 * sequential delivery (AsyncIterator/AsyncGenerator, or an ordered async
 * visitor plus a completion summary) so B8-C need not drive the enumeration to
 * completion before receiving its first Candidate. This collector may then
 * survive as a test/helper. See `docs/CANDIDATE_SEARCH_REDESIGN.md` 4.3.
 */
export interface ConstrainedEnumerationResult {
  targetWeaponId: TargetWeaponId
  /**
   * Every yielded Candidate in the deterministic enumeration order. The order
   * depends only on the input, the Engine, and the bounds.
   */
  candidates: ConstrainedCandidate[]
  summary: ConstrainedEnumerationSummary
}

export type ConstrainedSearchErrorCode =
  | 'invalid_input'
  | 'invalid_candidate'
  | 'calculation_context_incompatible'

export class ConstrainedSearchError extends Error {
  readonly code: ConstrainedSearchErrorCode

  constructor(code: ConstrainedSearchErrorCode, message: string) {
    super(message)
    this.name = 'ConstrainedSearchError'
    this.code = code
  }
}
