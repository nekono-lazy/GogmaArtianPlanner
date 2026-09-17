import type { DomainValidationIssue } from '../models/validation'

/**
 * Why an Execution runtime operation refused to change anything
 * (`docs/PLANNER_SPEC.md` 16.1 / 16.2).
 *
 * Every code means nothing was written: the Plan, its current Step, and every
 * persisted entity keep their state from before the call.
 */
export type ExecutionRuntimeErrorCode =
  /** The requested ProductionPlan does not exist. */
  | 'plan_not_found'
  /** Only a draft Plan with at least one Step can start. */
  | 'plan_not_startable'
  /** Another Plan is already running (`active` or `stale`). */
  | 'running_plan_conflict'
  /** Step confirmation requires an `active` Plan. */
  | 'plan_not_active'
  /**
   * The Plan is not an executable current Execution contract Plan: it fails
   * Domain validation, predates calculation schema 12, or carries a legacy Step.
   */
  | 'plan_not_executable'
  /** The current CalculationContext is incompatible with the Plan. */
  | 'calculation_context_changed'
  /** The requested Step is not the Plan's current incomplete Step. */
  | 'step_not_current'
  /** A Plan-dependent Target definition or BuildListEntry changed. */
  | 'plan_dependency_changed'
  /** The persisted state differs from the current Step's `expectedStateBefore`. */
  | 'execution_state_mismatch'
  /** A blind production-target Normal needs the user's observed five slots. */
  | 'observation_required'
  /** The Step has no observation binding, so no observation may be supplied. */
  | 'observation_not_expected'
  /** The observed five slots fail OwnedWeapon validation. */
  | 'observation_invalid'
  /**
   * The Step has no result that can differ from a prediction: an owned Ideal
   * confirmation, or a blind observation that is `confirmed_expected`.
   */
  | 'actual_result_not_applicable'
  /** The actual result does not fit the operation or fails entity validation. */
  | 'actual_result_invalid'
  /** The actual result equals the expected result, so it is `confirmed_expected`. */
  | 'actual_result_matches_expected'
  /** The Step's recorded Counter advance or Execution effects cannot apply to the state. */
  | 'execution_effect_inconsistent'
  /** The resulting state differs from the Step's `expectedStateAfter`. */
  | 'expected_state_after_mismatch'
  /** The resulting Target preference collection is invalid. */
  | 'collection_validation_failed'
  /** A resulting entity fails Domain validation. */
  | 'entity_validation_failed'
  /**
   * The Plan has no selected compromise checkpoint the request can finish at:
   * the named BuildListEntry is not a selected Entry of the Plan, no longer
   * exists, plans another Target, selected no intermediate state, or holds its
   * checkpoint with another weapon (`docs/PLANNER_SPEC.md` 16.12).
   */
  | 'compromise_finish_not_applicable'
  /** The Entry's selected compromise checkpoint is not reached yet (16.12). */
  | 'compromise_checkpoint_not_reached'
  /** The ExecutionHistory to undo does not exist or belongs to another Plan. */
  | 'undo_history_not_found'
  /** The ExecutionHistory to undo is not the Plan's latest ExecutionHistory. */
  | 'undo_history_not_latest'
  /**
   * The Plan's status, or the terminal transition the ExecutionHistory did not
   * cause, or a legacy action does not allow Undo (`docs/PLANNER_SPEC.md` 16.16).
   */
  | 'undo_not_allowed'
  /** The ExecutionHistory or its ExecutionUndoSnapshot cannot restore the Step exactly. */
  | 'undo_snapshot_invalid'
  /** The state restored from the snapshot fails entity, collection or reference validation. */
  | 'undo_result_invalid'
  /** A game save point is recorded only for an active Plan (`docs/PLANNER_SPEC.md` 16.9). */
  | 'save_point_record_not_allowed'
  /** A game save point is restored only for an active or stale Plan (16.9). */
  | 'save_point_restore_not_allowed'
  /** The Plan has no game save point to restore. */
  | 'save_point_not_found'
  /** The Plan's game save point is not the one the user saw (it was recorded again). */
  | 'save_point_changed'
  /**
   * The game save point cannot be restored exactly: it fails Domain validation,
   * its ExecutionHistory boundary is missing or foreign, its snapshot Plan is not
   * active, or it does not cover its execution scope.
   */
  | 'save_point_snapshot_invalid'
  /**
   * An entity the Plan needs no longer exists: a snapshot OwnedWeapon, a selected
   * BuildListEntry or a Plan-dependent Target. It is never revived.
   */
  | 'save_point_required_entity_missing'
  /** The state restored from the save point fails entity, collection or reference validation. */
  | 'save_point_restore_invalid'

export class ExecutionRuntimeError extends Error {
  readonly code: ExecutionRuntimeErrorCode
  readonly validationIssues: readonly DomainValidationIssue[]

  constructor(
    code: ExecutionRuntimeErrorCode,
    message: string,
    validationIssues: readonly DomainValidationIssue[] = [],
  ) {
    super(message)
    this.name = 'ExecutionRuntimeError'
    this.code = code
    this.validationIssues = validationIssues
  }
}

export function executionFailure(
  code: ExecutionRuntimeErrorCode,
  message: string,
  validationIssues: readonly DomainValidationIssue[] = [],
): never {
  throw new ExecutionRuntimeError(code, message, validationIssues)
}
