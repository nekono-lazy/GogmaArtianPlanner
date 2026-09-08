import type {
  BuildListEntryId,
  DomainValidationIssue,
  TargetWeaponId,
} from '../../models/publicTypes'
import type { ConstrainedEnumerationBounds } from '../../search'
import type {
  ExcludedBuildListEntry,
  PlannerConflictResolution,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerWarning,
} from '../plannerTypes'
import type { PlannerWhatIfBounds } from './plannerWhatIfBounds'

/**
 * The B9 what-if comparison Domain contract (PLANNER_SPEC 9.2.4 - 9.2.4.13).
 *
 * Everything here is transient. B9 persists nothing: no `BuildListEntry`, no
 * `ProductionPlan`, no what-if result, and no call into an Application or
 * Persistence save service (9.2.4.8). It adds no `PlannerWarningKind`, changes
 * no B8 orchestration semantics, and changes no schema or RNG version.
 */

/**
 * The public what-if request (PLANNER_SPEC 9.2.4.5).
 *
 * `scenarioResolution` is the single virtual fixed authority. It is a plain
 * `PlannerConflictResolution`, so a caller never assembles a B8 transient DTO
 * such as `PlannerConstrainedConflictContext` or
 * `PlannerFixedConflictConstraint`.
 *
 * `ConstrainedEnumerationBounds` is deliberately absent: the only bounds an
 * Application or Worker request carries are `PlannerWhatIfBounds`. The Search
 * Domain extent is supplied separately through
 * `PlannerWhatIfCalculationOptions`, the same responsibility split B8-D1 /
 * B8-E2b already use.
 */
export interface PlannerWhatIfRequest {
  plannerInput: PlannerInput
  scenarioResolution: PlannerConflictResolution
  bounds: PlannerWhatIfBounds
}

/**
 * The Domain-calculation options of PLANNER_SPEC 9.2.4.5 / 9.2.4.10.
 *
 * `enumerationBounds` is caller-required. The Domain performs no default
 * substitution, fallback, clamp, or field-wise completion; the Production
 * Worker adapter is what passes `defaultConstrainedEnumerationBounds`
 * explicitly inside the Worker boundary.
 */
export interface PlannerWhatIfCalculationOptions {
  enumerationBounds: ConstrainedEnumerationBounds
  executionOptions?: PlannerExecutionOptions
}

/**
 * The distance of one what-if answer (PLANNER_SPEC 9.2.4.1).
 *
 * The baseline is only the Planner-start `ConstrainedSearchOrigin`, so these
 * are the enumerator's own origin-relative estimates, used unchanged. They are
 * never a delta from the conflicting Counter position, never a delta from the
 * state after the fixed Candidate runs, and never a new B9 distance measure.
 */
export interface PlannerWhatIfDistance {
  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  estimatedNormalAdvance: number | null
}

/**
 * One category's answer for one alternative Target (PLANNER_SPEC 9.2.4.11).
 *
 * "Not found" and "unverified because a bound was reached" are separate
 * statuses on purpose: 9.2.16's rule that a bound stop is never silently
 * reported as exhaustion holds in B9 too.
 *
 * `cancelled` is deliberately not a member. Cancellation is a Worker / client
 * request concern (9.2.4.12), and a cancelled request's partial comparison is
 * never returned as a normal result.
 */
export type PlannerWhatIfOutcome =
  /** Planner feasibility was proven for a Candidate within the bounds. */
  | { status: 'found'; distance: PlannerWhatIfDistance }
  /** Enumeration ended exhausted with no feasible Candidate in that category. */
  | { status: 'not_found_within_search_extent' }
  /** A `ConstrainedEnumerationBounds` value left reachable work unchecked. */
  | { status: 'stopped_by_enumeration_bound' }
  /** That category spent `maxCandidateTrialsPerCategoryPerTarget`. */
  | { status: 'stopped_by_candidate_trial_bound' }
  /** The request spent `maxPlannerReruns` before deciding this category. */
  | { status: 'stopped_by_planner_rerun_bound' }

/**
 * One non-fixed Target's what-if answer.
 *
 * `practical` and `ideal` are the exclusive `CandidateCategory` slots of
 * SEARCH_SPEC 5.1 / 5.2 (PLANNER_SPEC 9.2.4.2), so they are filled and stopped
 * independently and one Candidate never fills both.
 */
export interface PlannerWhatIfTargetComparison {
  targetWeaponId: TargetWeaponId
  practical: PlannerWhatIfOutcome
  ideal: PlannerWhatIfOutcome
}

/**
 * The comparison for one fixed choice (PLANNER_SPEC 9.2.4.11).
 *
 * `alternatives` holds one entry per unique non-fixed participant Target, each
 * evaluated from the same premise - the Planner-start origin, the scenario
 * fixed constraint, and the other explicit resolutions - so the Target
 * evaluation order cannot change a distance (9.2.4.4).
 *
 * It carries no `ProductionPlan`, and no Candidate or generated BuildListEntry
 * ID is a required field: the product requirement is the distance comparison,
 * not a persistent Candidate identity (9.2.4.8).
 */
export interface PlannerWhatIfComparison {
  conflictKey: string
  fixedBuildListEntryId: BuildListEntryId
  fixedTargetWeaponId: TargetWeaponId
  alternatives: PlannerWhatIfTargetComparison[]
}

/**
 * Why the scenario fixed constraint could not be built safely
 * (PLANNER_SPEC 9.2.4.11).
 *
 * These are control authority. A caller branches on `status` and `reason`, and
 * never on message text.
 */
export type PlannerWhatIfInvalidFixedResolutionReason =
  /**
   * `validatePlannerInput()` did not keep the scenario resolution's exact
   * (conflictKey, selectedBuildListEntryId) pair among its valid resolutions,
   * e.g. because the selected Entry is missing, stale, or otherwise excluded.
   */
  | 'scenario_resolution_not_valid'
  /**
   * At least one valid explicit resolution - the scenario's own included -
   * could not be turned into a fixed constraint. All-or-nothing, exactly like
   * B8: a partial fixed set is never used.
   */
  | 'fixed_constraints_unresolved'
  /**
   * The prepared constraints carry no unique constraint matching the scenario
   * resolution, so the what-if subject is unknown. No substitute is chosen.
   */
  | 'scenario_constraint_missing'

/** The Planner input itself is not usable, before any what-if work starts. */
export interface PlannerWhatIfInputNotReadyResult {
  status: 'planner_input_not_ready'
  issues: DomainValidationIssue[]
  warnings: PlannerWarning[]
  excludedBuildListEntries: ExcludedBuildListEntry[]
}

/**
 * The scenario fixed constraint is unknown, so no comparison is started.
 *
 * No alternative fixed Entry is ever inferred from
 * `PlanConflict.recommendedBuildListEntryId`, a Beam Search bestState
 * participant, Target priority, Candidate score, Candidate category, or
 * Candidate similarity (PLANNER_SPEC 9.2.7).
 *
 * `conflictKey` and `selectedBuildListEntryId` identify the resolution that
 * failed; for `fixed_constraints_unresolved` they name the first failure in the
 * stable conflictKey order the fixed-constraint preparation reports. `detail`
 * is human-readable diagnostics only and is never a control authority.
 */
export interface PlannerWhatIfInvalidFixedResolutionResult {
  status: 'invalid_fixed_resolution'
  reason: PlannerWhatIfInvalidFixedResolutionReason
  conflictKey: string
  selectedBuildListEntryId: BuildListEntryId
  detail: string
}

export type PlannerWhatIfFailureResult =
  | PlannerWhatIfInputNotReadyResult
  | PlannerWhatIfInvalidFixedResolutionResult

/**
 * The whole what-if calculation result. Failures are typed values, not thrown
 * errors and not parsed messages (PLANNER_SPEC 9.2.4.11).
 */
export type PlannerWhatIfCalculationResult =
  | { status: 'completed'; comparison: PlannerWhatIfComparison }
  | PlannerWhatIfFailureResult
