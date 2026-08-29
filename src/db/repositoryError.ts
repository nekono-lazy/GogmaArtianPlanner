import type {
  DomainValidationIssue,
  DomainValidationResult,
} from '../domain/models/validation'

export type RepositoryErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'reference_conflict'
  | 'active_plan_conflict'
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
