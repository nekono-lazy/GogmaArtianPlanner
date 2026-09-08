import type {
  DomainValidationIssue,
  DomainValidationResult,
} from '../../models/publicTypes'

/**
 * The B9 what-if bounds of PLANNER_SPEC 9.2.4.9.
 *
 * They are a separate type from B8's `PlannerOrchestrationBounds` on purpose.
 * `maxPlannerReruns` carries the same name in both, but B8 counts the initial
 * ordinary Planner run as well, while B9 starts no Plan-producing run at all:
 * a what-if request compares feasibility distances, so the two values count
 * different things and neither default may be reused for the other.
 *
 * They are also never crossed with the Search Domain's
 * `ConstrainedEnumerationBounds`: these two fields must never appear in a
 * `ConstrainedCandidateSearchInput`, and enumeration extent never comes from
 * here. `CandidateSearchSettings` is not reused for either.
 */
export interface PlannerWhatIfBounds {
  /**
   * Candidate trials attempted per `(conflict scenario, targetWeaponId,
   * CandidateCategory)` triple before that category stops.
   *
   * The three axes are independent: a category that has spent its budget never
   * stops the other category of the same Target, nor another Target.
   */
  maxCandidateTrialsPerCategoryPerTarget: number
  /**
   * Full Beam Searches one whole what-if request may start.
   *
   * It counts every Candidate trial's full Beam Search and every
   * runtime-unsupported retry Beam Search started inside Production Plan
   * generation. It does not count the initial conflict preflight, validation,
   * conflict context construction, Candidate enumeration, or materialization,
   * none of which run a Beam Search.
   */
  maxPlannerReruns: number
}

/**
 * The caller-facing Production default, decided in B9-B2c from the dedicated
 * B9-B2b real Browser Worker benchmark (PLANNER_SPEC 9.2.4.9;
 * docs/B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md 9-11).
 *
 * Two trials are the smallest measured value that finds the needed Practical
 * in two_targets / dual_category; higher values showed no semantic gain.
 * Eight reruns let all four combined-workload slots reach those two trials,
 * whereas six left one slot stopped by the rerun bound. The finalist combined
 * median cost increased by about 1.8%. Combined still found no feasible result;
 * a bound stop does not prove Candidate absence or coverage for arbitrary inputs.
 *
 * This is independent of B8's 2 / 1 / 4 orchestration default and the Search
 * Domain's enumeration bounds. Callers explicitly choose and pass this value;
 * request bounds remain required. It is never an implicit Domain, Worker
 * adapter, or Worker Client fallback, nor a repair or field-completion target.
 */
export const defaultPlannerWhatIfBounds: PlannerWhatIfBounds = {
  maxCandidateTrialsPerCategoryPerTarget: 2,
  maxPlannerReruns: 8,
}

function issue(
  path: string,
  code: DomainValidationIssue['code'],
  message: string,
): DomainValidationIssue {
  return { path, code, message }
}

/**
 * Both bounds require a finite integer greater than or equal to 1, exactly like
 * `validatePlannerOrchestrationBounds()`.
 *
 * `Number.isInteger()` already rejects `NaN`, `Infinity`, and fractions, so a
 * non-finite value can never pass as a bound.
 */
function positiveIntegerIssue(value: number, path: string) {
  return Number.isInteger(value) && value >= 1
    ? null
    : issue(path, 'invalid_integer', `${path} must be an integer greater than or equal to 1.`)
}

/**
 * Pure validation. It never mutates the input, never clamps, never completes a
 * missing field, and never repairs a value towards a default. The caller-facing
 * Production constant is not a repair target (PLANNER_SPEC 9.2.4.9).
 */
export function validatePlannerWhatIfBounds(
  bounds: PlannerWhatIfBounds,
): DomainValidationResult {
  const issues = [
    positiveIntegerIssue(
      bounds.maxCandidateTrialsPerCategoryPerTarget,
      'maxCandidateTrialsPerCategoryPerTarget',
    ),
    positiveIntegerIssue(bounds.maxPlannerReruns, 'maxPlannerReruns'),
  ].filter((entry): entry is DomainValidationIssue => entry !== null)
  return { isValid: issues.length === 0, issues }
}

/**
 * An invalid `PlannerWhatIfBounds`, i.e. a caller contract violation. Reaching
 * a bound is a normal what-if outcome and is reported through
 * `PlannerWhatIfOutcome`, never through this error.
 */
export class PlannerWhatIfBoundsError extends Error {
  readonly issues: DomainValidationIssue[]

  constructor(issues: DomainValidationIssue[]) {
    super(
      `Invalid PlannerWhatIfBounds: ${issues
        .map(({ path, message }) => `${path}: ${message}`)
        .join(' ')}`,
    )
    this.name = 'PlannerWhatIfBoundsError'
    this.issues = issues
  }
}

/** Fails closed on invalid bounds instead of substituting any default value. */
export function assertPlannerWhatIfBounds(bounds: PlannerWhatIfBounds): void {
  const validation = validatePlannerWhatIfBounds(bounds)
  if (!validation.isValid) {
    throw new PlannerWhatIfBoundsError(validation.issues)
  }
}
