import type {
  BuildListEntryId,
  TargetWeaponId,
} from '../../models/publicTypes'
import type { ConstrainedEnumerationBounds } from '../../search'
import type {
  PlannerConflictResolution,
  PlannerExecutionOptions,
  PlannerInput,
} from '../plannerTypes'
import type {
  PlannerConflictScenarioFailureResult,
  PlannerConflictScenarioInputNotReadyResult,
  PlannerConflictScenarioInvalidFixedResolutionReason,
  PlannerConflictScenarioInvalidFixedResolutionResult,
} from '../replacement/plannerConflictScenario'
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
 * `PlannerConflictResolution`, so a caller never assembles a transient DTO
 * such as `PlannerConflictContext` or `PlannerFixedConflictConstraint`.
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
 * substitution, fallback, clamp, or field-wise completion; until Phase 6-B1
 * the Production Worker adapter was what passed
 * `defaultConstrainedEnumerationBounds` explicitly inside the Worker boundary.
 * Phase 6-B1 removed that adapter; the remaining callers are tests and
 * benchmarks, which pass their own bounds.
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
  /** This Target spent `maxCandidateTrialsPerTarget`. */
  | { status: 'stopped_by_candidate_trial_bound' }
  /** The request spent `maxPlannerReruns` before deciding this Target. */
  | { status: 'stopped_by_planner_rerun_bound' }
  /**
   * This Target's participant BuildListEntry carries a selected compromise
   * checkpoint, so no alternate Route may replace it and nothing is enumerated
   * (PLANNER_SPEC 9.5.2). The Build List selection is where this is settled.
   */
  | { status: 'blocked_by_selected_checkpoint' }

/**
 * One non-fixed Target's what-if answer.
 *
 * There is one outcome per Target, not one per Candidate category: Candidate
 * Search produces canonical Ideal Candidates only, so the question this answers
 * is how far away this Target's next feasible Ideal Candidate is
 * (`docs/PLANNER_SPEC.md` 9.2.4.2).
 */
export interface PlannerWhatIfTargetComparison {
  targetWeaponId: TargetWeaponId
  outcome: PlannerWhatIfOutcome
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
 * The preparation failures the legacy B9 what-if shares with the Planner
 * Alternative (PLANNER_SPEC 9.2.4.11). Since Phase 6-B2a they are defined once,
 * by the shared scenario preparation of `../replacement/plannerConflictScenario`
 * (`PlannerConflictScenario*`); these legacy names are aliases of the very
 * same types, with the same literals, so no B9 result changes.
 */
export type PlannerWhatIfInvalidFixedResolutionReason =
  PlannerConflictScenarioInvalidFixedResolutionReason
export type PlannerWhatIfInputNotReadyResult = PlannerConflictScenarioInputNotReadyResult
export type PlannerWhatIfInvalidFixedResolutionResult =
  PlannerConflictScenarioInvalidFixedResolutionResult
export type PlannerWhatIfFailureResult = PlannerConflictScenarioFailureResult

/**
 * The whole what-if calculation result. Failures are typed values, not thrown
 * errors and not parsed messages (PLANNER_SPEC 9.2.4.11).
 */
export type PlannerWhatIfCalculationResult =
  | { status: 'completed'; comparison: PlannerWhatIfComparison }
  | PlannerWhatIfFailureResult
