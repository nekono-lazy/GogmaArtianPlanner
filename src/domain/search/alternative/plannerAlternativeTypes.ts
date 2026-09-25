import type {
  CandidateBonusAmendmentStep,
  CandidateConversionSkillStep,
  CandidateSkillAmendmentStep,
  NormalArtianCounter,
  OwnedWeaponId,
  TargetWeaponId,
} from '../../models/publicTypes'
import type {
  ConstrainedCandidate,
  ConstrainedSearchOrigin,
} from '../constrained/constrainedTypes'

/**
 * Planner Alternative Search types (`docs/SEARCH_SPEC.md` 5.6.8,
 * `docs/PLANNER_SPEC.md` 9.2.19).
 *
 * A separate Search Domain consumer policy from `searchCandidates()` and from
 * the constrained enumerator of 5.6.7. It never receives a Planner conflict
 * DTO, a `PlannerConflictResolution`, a Planner trial bound, or any Planner
 * shareability / inventory / source-version judgement.
 *
 * Phase 1-B status: the API shape is the 5.6.8 one, but only an empty
 * reservation is searched, and the search runs over the current modern
 * Candidate Search frontier. It is not yet the complete 5.6.8 search: later
 * same-result Counter positions, lazy off-axis Cross pairs, a Normal
 * enumeration without the #104 reduction, held-position traversal and the
 * exhausted / stopped-by-extent distinction are Phase 1-C / Phase 2.
 */

/**
 * The Counter position window of one Planner Alternative Search
 * (`docs/PLANNER_SPEC.md` 9.2.19.12).
 *
 * The three values carry the SEARCH_SPEC 3.1 meanings of the Candidate Search
 * settings of the same names, but this type and its values are Planner
 * Alternative Search's own authority: they are never read from
 * `CandidateSearchSettings`, `AppSettings.candidateSearchDefaults`,
 * `recommendedCandidateSearchDefaults` or `defaultConstrainedEnumerationBounds`.
 * Every value is caller-supplied; there is no Production default yet (Phase 3).
 */
export interface PlannerAlternativeSearchExtent {
  /** Maximum `create_normal_artian` forge count, never the maximum offset. */
  maxNormalAdvance: number
  /** Gogma Counter positions covered, never the Engine call count. */
  maxGogmaAdvance: number
  /** Maximum Reset Skills count (a conversion Route covers one more Skill position). */
  maxSkillAdvance: number
}

/** The held and blocked positions of one Counter stream (`blocked ⊆ held`). */
export interface PlannerAlternativeStreamReservation {
  held: readonly number[]
  blocked: readonly number[]
}

export interface PlannerAlternativeNormalReservation
  extends PlannerAlternativeStreamReservation {
  counterId: NormalArtianCounter['id']
}

/**
 * The fixed Route set's resource reservation, as the Planner derived it
 * (`docs/PLANNER_SPEC.md` 9.2.19.3). The Search Domain only consumes it and
 * never re-derives required / skippable or shareability.
 *
 * An empty reservation means "no fixed Route". Phase 1-B searches only that
 * case and refuses any other reservation explicitly rather than ignoring it.
 */
export interface PlannerAlternativeReservation {
  normal: readonly PlannerAlternativeNormalReservation[]
  skill: PlannerAlternativeStreamReservation
  gogma: PlannerAlternativeStreamReservation
  exclusiveOwnedWeaponIds: readonly OwnedWeaponId[]
}

export const emptyPlannerAlternativeReservation: PlannerAlternativeReservation = {
  normal: [],
  skill: { held: [], blocked: [] },
  gogma: { held: [], blocked: [] },
  exclusiveOwnedWeaponIds: [],
}

export interface PlannerAlternativeSearchInput {
  /** The Planner-start current validated snapshot (same meaning as 5.6.7). */
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
  extent: PlannerAlternativeSearchExtent
  reservation: PlannerAlternativeReservation
  /** `candidateStableKey()` values of Routes that must not be returned. */
  excludedRouteKeys: readonly string[]
}

/**
 * One transient Planner Alternative Search result.
 *
 * The same semantic result as `ConstrainedCandidate` - no `BuildCandidate.id`,
 * `searchRunId`, `createdAt`, random ID, Clock value or enumeration ordinal -
 * plus the ordinary Candidate Search observational traces
 * (`docs/SEARCH_SPEC.md` 5.5.3.1 / 5.5.2.1 / 5.5.2.2). The traces record
 * predictions the streams already made; they add no prediction call and take
 * no part in identity, hashes, ordering or classification.
 *
 * `conversionSkillTrace` is present exactly when the Route has its one
 * `convert_normal_to_gogma`, as on a Search-generated `BuildCandidate`.
 * Intermediate state groups are not part of it: the deterministic materializer
 * derives them (`docs/PLANNER_SPEC.md` 9.2.13).
 */
export interface PlannerAlternativeCandidate extends ConstrainedCandidate {
  bonusAmendmentTrace: CandidateBonusAmendmentStep[]
  skillAmendmentTrace: CandidateSkillAmendmentStep[]
  conversionSkillTrace?: CandidateConversionSkillStep
}

/** Whether the consumer wants the next Candidate or no further work at all. */
export type PlannerAlternativeCandidateDecision = 'continue' | 'stop'

/**
 * Called once per delivered Candidate, before the search continues. The Search
 * Domain never learns why the consumer stopped.
 */
export type PlannerAlternativeCandidateVisitor = (
  candidate: PlannerAlternativeCandidate,
) => PlannerAlternativeCandidateDecision | Promise<PlannerAlternativeCandidateDecision>

export interface PlannerAlternativeSearchSummary {
  /** Candidates handed to the visitor. */
  deliveredCandidates: number
  /**
   * Ideal Candidates skipped because their `candidateStableKey` is in
   * `excludedRouteKeys`. Exclusion happens after the Candidate is built, by its
   * semantic Route identity; it prunes no search work.
   */
  excludedCandidates: number
}

/**
 * The completion report of one sequential search.
 *
 * `stoppedByConsumer` is a normal outcome and is not cancellation, which
 * rejects with `CandidateSearchError('cancelled')` instead. When it is false
 * the current Phase 1-B frontier simply ran out of work: that is NOT the
 * SEARCH_SPEC 5.6.8 `exhausted`, because the frontier still carries the
 * initial Search's retention, Cross-only composition and #104 Normal
 * reduction. Phase 1-C adds the exhausted / stopped-by-extent distinction.
 */
export interface PlannerAlternativeSearchExecution {
  targetWeaponId: TargetWeaponId
  summary: PlannerAlternativeSearchSummary
  stoppedByConsumer: boolean
}

export type PlannerAlternativeSearchErrorCode =
  | 'invalid_input'
  | 'calculation_context_incompatible'
  | 'unsupported_reservation'

export class PlannerAlternativeSearchError extends Error {
  readonly code: PlannerAlternativeSearchErrorCode

  constructor(code: PlannerAlternativeSearchErrorCode, message: string) {
    super(message)
    this.name = 'PlannerAlternativeSearchError'
    this.code = code
  }
}
