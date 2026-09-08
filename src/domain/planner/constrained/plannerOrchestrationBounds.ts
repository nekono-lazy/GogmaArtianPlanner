import type {
  DomainValidationIssue,
  DomainValidationResult,
} from '../../models/publicTypes'

/**
 * The Planner orchestration bounds of PLANNER_SPEC 9.2.16.
 *
 * They bound what B8 constrained-search *orchestration* consumes, and are a
 * completely separate type from the Search Domain's
 * `ConstrainedEnumerationBounds`, which bounds what the enumerator consumes.
 * Neither set is ever passed across that boundary: these three fields must
 * never appear in `ConstrainedCandidateSearchInput`, and
 * `CandidateSearchSettings` is not reused for either.
 *
 * The cost of one Planner rerun cannot be measured before the orchestration
 * that performs it exists, so B8-C kept them caller-required and B8-E decided
 * their Production default from a real Browser / Planner benchmark. That
 * default is `defaultPlannerOrchestrationBounds` below. It is still not derived
 * from `CandidateSearchSettings` or from `defaultConstrainedEnumerationBounds`,
 * and it is never applied implicitly: every API here keeps the bounds
 * caller-supplied, and an Application caller decides when to pass the default.
 */
export interface PlannerOrchestrationBounds {
  /** Candidate trials attempted for one conflict before the trial loop stops. */
  maxCandidateTrialsPerConflict: number
  /** Generated BuildListEntries adopted into the final augmented PlannerInput. */
  maxGeneratedBuildListEntries: number
  /**
   * Full `runPlannerBeamSearch()` executions started by B8 orchestration.
   *
   * It counts the first ordinary Planner full Beam Search, every Candidate
   * trial's full Beam Search, and every runtime-unsupported retry Beam Search
   * performed inside Production Plan generation. It does not count
   * `preparePlannerInitialContext()`, the initial conflict preflight, conflict
   * context construction, materialization, or Candidate enumeration, none of
   * which run a Beam Search.
   */
  maxPlannerReruns: number
}

/**
 * The Production `PlannerOrchestrationBounds`, decided in B8-E2b from the
 * B8-E2a real Browser measurement of the Production Planner Worker
 * (`docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md` 10-11).
 *
 * ```text
 * maxCandidateTrialsPerConflict = 2
 * maxGeneratedBuildListEntries  = 1
 * maxPlannerReruns              = 4
 * ```
 *
 * `2` is the smallest measured trial count that adopted a generated Entry in
 * workloads B and C; both adopt nothing at `1`. Above `2`, neither workload
 * produced a better semantic outcome. Workload C's isolated trial sweep, with
 * the other two bounds held fixed, showed latency growing as the trial budget
 * grew, while workload B's timings above `2` were non-monotonic within
 * measurement noise. The decision rests on the absent semantic gain, not on a
 * uniform latency increase.
 *
 * `4` is not an independent per-field minimum. `maxPlannerReruns` counts the
 * first ordinary Beam Search as well, so it is not comparable field-for-field
 * with the trial count. The measured authority is the finalist tuple
 * `2 / 1 / 4` as a whole, which reached the same semantic outcome as the far
 * larger bounds on workloads B, C, D and E, and had the lowest aggregate median
 * latency across those four workloads among the three finalists. It is not the
 * fastest on every workload taken alone: `4 / 1 / 8` had a lower median on
 * B and on C.
 *
 * `maxGeneratedBuildListEntries = 1` is **not** the Domain maximum number of
 * generated BuildListEntries. It is the measured Production default: B8-E1 and
 * B8-E2a never observed a Production-valid two-Entry adoption, and raising the
 * cap to 2 or 4 on workload D adopted no additional Entry while nearly doubling
 * the latency. If a Production-valid two-Entry adoption is ever observed, this
 * value becomes a re-benchmark target - it is not a Domain rule to defend.
 *
 * This constant is data for callers. It is never substituted for an invalid
 * caller value, never clamped towards, and never applied implicitly inside the
 * Domain, the Planner Worker adapter, or the Planner Worker client.
 */
export const defaultPlannerOrchestrationBounds: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 2,
  maxGeneratedBuildListEntries: 1,
  maxPlannerReruns: 4,
}

function issue(
  path: string,
  code: DomainValidationIssue['code'],
  message: string,
): DomainValidationIssue {
  return { path, code, message }
}

/**
 * All three bounds require a finite integer greater than or equal to 1, exactly
 * like `validatePlannerOptions()`.
 *
 * The zero-disable semantics of `maxOffAxisPairEvaluations` are specific to
 * Search enumeration — zero off-axis evaluations is the meaningful Cross-only
 * policy — and are deliberately not carried over here: zero Beam Searches,
 * zero trials, or zero adoptable Entries would make orchestration meaningless
 * rather than configure it.
 */
function positiveIntegerIssue(value: number, path: string) {
  return Number.isInteger(value) && value >= 1
    ? null
    : issue(path, 'invalid_integer', `${path} must be an integer greater than or equal to 1.`)
}

/**
 * Pure validation. It never mutates the input and never repairs a value to a
 * default: `defaultPlannerOrchestrationBounds` is a caller-facing Production
 * value, not a repair target for a malformed bound.
 */
export function validatePlannerOrchestrationBounds(
  bounds: PlannerOrchestrationBounds,
): DomainValidationResult {
  const issues = [
    positiveIntegerIssue(
      bounds.maxCandidateTrialsPerConflict,
      'maxCandidateTrialsPerConflict',
    ),
    positiveIntegerIssue(
      bounds.maxGeneratedBuildListEntries,
      'maxGeneratedBuildListEntries',
    ),
    positiveIntegerIssue(bounds.maxPlannerReruns, 'maxPlannerReruns'),
  ].filter((entry): entry is DomainValidationIssue => entry !== null)
  return { isValid: issues.length === 0, issues }
}

/**
 * An invalid `PlannerOrchestrationBounds`. It is distinct from
 * `PlannerOrchestrationLimitError`: a malformed bound is a caller contract
 * violation, while reaching a bound is a normal orchestration outcome.
 */
export class PlannerOrchestrationBoundsError extends Error {
  readonly issues: DomainValidationIssue[]

  constructor(issues: DomainValidationIssue[]) {
    super(
      `Invalid PlannerOrchestrationBounds: ${issues
        .map(({ path, message }) => `${path}: ${message}`)
        .join(' ')}`,
    )
    this.name = 'PlannerOrchestrationBoundsError'
    this.issues = issues
  }
}

/** Fails closed on invalid bounds instead of substituting any default value. */
export function assertPlannerOrchestrationBounds(
  bounds: PlannerOrchestrationBounds,
): void {
  const validation = validatePlannerOrchestrationBounds(bounds)
  if (!validation.isValid) {
    throw new PlannerOrchestrationBoundsError(validation.issues)
  }
}
