import type {
  DomainValidationIssue,
  DomainValidationResult,
} from '../domain/models/validation'

export type RepositoryErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'reference_conflict'
  | 'active_plan_conflict'
  /**
   * Save-time current state no longer matches the Planner calculation's own
   * snapshot (PLANNER_SPEC 9.2.15). Nothing was written, and the caller can
   * recover by re-running the Planner over the current state.
   */
  | 'planner_state_changed'
  /**
   * The Planner orchestration result itself violates an invariant it must
   * satisfy before it can be persisted. Re-running the Planner over unchanged
   * state would produce the same failure, so this is not retryable.
   */
  | 'planner_result_invalid'
  | 'transaction_failed'

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode
  readonly validationIssues: readonly DomainValidationIssue[]

  constructor(
    code: RepositoryErrorCode,
    message: string,
    options?: {
      cause?: unknown
      validationIssues?: readonly DomainValidationIssue[]
    },
  ) {
    super(message, { cause: options?.cause })
    this.name = 'RepositoryError'
    this.code = code
    this.validationIssues = options?.validationIssues ?? []
  }
}

export function assertRepositoryValidation(
  entityName: string,
  validation: DomainValidationResult,
) {
  if (!validation.isValid) {
    throw new RepositoryError(
      'validation_failed',
      `${entityName} failed Domain validation.`,
      { validationIssues: validation.issues },
    )
  }
}
