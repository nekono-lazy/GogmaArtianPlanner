import type {
  BuildListEntryId,
  DomainValidationIssue,
  DomainValidationResult,
} from '../../models/publicTypes'
import type { PlannerResult, ProductionPlanGenerationObserver } from '../plannerTypes'

/**
 * The caller-supplied trial bounds of one Planner Alternative kernel request
 * (`docs/PLANNER_SPEC.md` 9.2.19.12): the what-if `PlannerWhatIfBounds`
 * meanings, shared by the what-if and the actual repair kernel. There is no
 * Production default yet (Phase 3): the Domain never substitutes, clamps or
 * completes a value.
 */
export interface PlannerAlternativeTrialBounds {
  /** Candidate trials per non-fixed Target before that Target stops. */
  maxCandidateTrialsPerTarget: number
  /**
   * Full Planner runs one request may start - every Candidate trial's run and
   * every runtime-unsupported retry inside Production Plan generation. Search,
   * reservation derivation, materialization, preflight and validation are
   * never counted.
   */
  maxPlannerReruns: number
}

function positiveIntegerIssue(value: number, path: string): DomainValidationIssue | null {
  return Number.isInteger(value) && value >= 1
    ? null
    : { path, code: 'invalid_integer', message: `${path} must be an integer greater than or equal to 1.` }
}

export function validatePlannerAlternativeTrialBounds(
  bounds: PlannerAlternativeTrialBounds,
): DomainValidationResult {
  const issues = [
    positiveIntegerIssue(bounds.maxCandidateTrialsPerTarget, 'maxCandidateTrialsPerTarget'),
    positiveIntegerIssue(bounds.maxPlannerReruns, 'maxPlannerReruns'),
  ].filter((issue): issue is DomainValidationIssue => issue !== null)
  return { isValid: issues.length === 0, issues }
}

/** An invalid `PlannerAlternativeTrialBounds`: a caller contract violation, never an outcome. */
export class PlannerAlternativeTrialBoundsError extends Error {
  readonly issues: DomainValidationIssue[]

  constructor(issues: DomainValidationIssue[]) {
    super(`Invalid PlannerAlternativeTrialBounds: ${issues.map(({ path, message }) => `${path}: ${message}`).join(' ')}`)
    this.name = 'PlannerAlternativeTrialBoundsError'
    this.issues = issues
  }
}

export function assertPlannerAlternativeTrialBounds(bounds: PlannerAlternativeTrialBounds): void {
  const validation = validatePlannerAlternativeTrialBounds(bounds)
  if (!validation.isValid) throw new PlannerAlternativeTrialBoundsError(validation.issues)
}

/** The rerun budget refused a full Planner run: a typed stop, never a rejection. */
export class PlannerAlternativeRerunLimitError extends Error {
  readonly limit: number
  readonly used: number

  constructor(limit: number, used: number) {
    super(`Planner Alternative bound 'maxPlannerReruns' blocked a full Planner run (limit ${limit}, used ${used}).`)
    this.name = 'PlannerAlternativeRerunLimitError'
    this.limit = limit
    this.used = used
  }
}

/**
 * The shared `maxPlannerReruns` budget of one request, shaped as the
 * `ProductionPlanGenerationObserver` that `createProductionPlanWithObserver()`
 * calls before every full Planner run it starts - and only then.
 */
export interface PlannerAlternativeFullRunBudget extends ProductionPlanGenerationObserver {
  readonly limit: number
  readonly used: number
  /** Every affordable full run has been started. On its own this is no truncation. */
  readonly exhausted: boolean
}

export function createPlannerAlternativeFullRunBudget(
  bounds: PlannerAlternativeTrialBounds,
): PlannerAlternativeFullRunBudget {
  assertPlannerAlternativeTrialBounds(bounds)
  const limit = bounds.maxPlannerReruns
  let used = 0
  return {
    get limit() { return limit },
    get used() { return used },
    get exhausted() { return used >= limit },
    beforePlannerRun() {
      if (used >= limit) throw new PlannerAlternativeRerunLimitError(limit, used)
      used += 1
    },
  }
}

export interface PlannerAlternativeTrialJudgeContext {
  /** The temporary Entry `G` of the trial. */
  generatedBuildListEntryId: BuildListEntryId
  /**
   * The explicit decision Entries: this decision's fixed Entry and every Entry
   * a valid explicit resolution of the merged input selects. Each must stay
   * selected.
   */
  explicitDecisionBuildListEntryIds: readonly BuildListEntryId[]
  /**
   * The fixed Route set of this Target's search: the explicit decision
   * Entries plus the still valid repair-lineage fixed Entries, without the
   * invalidated Entry. `G` must not conflict with any of them.
   */
  fixedRouteBuildListEntryIds: readonly BuildListEntryId[]
  /**
   * The `PlanConflict.id`s the trial input's initial conflict detection found
   * (`preparePlannerInitialContext()` over the replacement set): the only
   * conflicts a provisional outcome of route commitment settles.
   */
  initialConflictIds: readonly string[]
}

export type PlannerAlternativeTrialRejectionReason =
  /** The trial run produced no Plan. */
  | 'no_plan'
  /** A trial Plan leaves an explicit decision Entry unselected. */
  | 'explicit_decision_not_selected'
  /** A trial conflict has `G` and a fixed Route Entry as participants. */
  | 'conflicts_with_fixed_route'
  /**
   * `G` is not selected, and the Plan's own record does not name the
   * provisional outcome of an unresolved conflict with a selected Entry
   * outside the fixed Route set as the only reason: a stall / deadlock drop, a
   * precondition, validation, source, protection or checkpoint failure.
   */
  | 'not_selected'

export type PlannerAlternativeTrialVerdict =
  | { status: 'found'; generatedSelected: boolean }
  | { status: 'rejected'; reason: PlannerAlternativeTrialRejectionReason }

/**
 * The formal found judgement of `docs/PLANNER_SPEC.md` 9.2.19.6 over one trial
 * run's `PlannerResult` from the Production path (`createProductionPlanWithObserver()`,
 * whose Plan exists only after its Trace Replay passed; a replay failure
 * throws instead of returning a Plan). `G` is found when all of these hold:
 *
 * 1. `plan !== null`
 * 2. every explicit decision Entry is selected
 * 3. no trial conflict has `G` and a fixed Route Entry as participants
 * 4. `G` is selected, or `G` was left out only as the non-adopted side of an
 *    unresolved conflict (`selectedBuildListEntryId === null`) with an Entry
 *    outside the fixed Route set
 *
 * Condition 4's second branch reads only the existing Planner results: `G`
 * appears in `plan.rejectedBuildListEntries` as `resource_conflict` and
 * nothing else, and an unresolved conflict of the trial's *initial* conflict
 * detection - the conflicts route commitment settles by provisional outcome -
 * pairs `G` with an Entry outside the fixed Route set that the Plan did select,
 * the side that outcome adopted. Route commitment never keeps two colliding
 * Entries committed and never commits a dropped Entry again, so such a
 * selected partner exists only when the provisional outcome decided `G`. A
 * stall / deadlock drop is recorded as `resource_conflict` too, but it drops an
 * Entry commitment had kept, whose initial collision partners were therefore
 * dropped and not selected; a precondition, source, protection or checkpoint
 * failure records another reason or none. Anything else is not found.
 *
 * Nothing else is consulted: no Counter comparison, no `usedCounters`
 * shortcut, no Candidate score, no `recommendedBuildListEntryId`, and
 * `completed === true` is not required.
 */
export function judgePlannerAlternativeTrial(
  result: PlannerResult,
  context: PlannerAlternativeTrialJudgeContext,
): PlannerAlternativeTrialVerdict {
  const plan = result.plan
  if (plan === null) return { status: 'rejected', reason: 'no_plan' }
  const generated = context.generatedBuildListEntryId
  const selected = new Set(plan.selectedBuildListEntryIds)
  if (!context.explicitDecisionBuildListEntryIds.every((id) => selected.has(id))) {
    return { status: 'rejected', reason: 'explicit_decision_not_selected' }
  }
  const fixed = new Set(context.fixedRouteBuildListEntryIds)
  if (result.conflicts.some(({ buildListEntryIds }) =>
    buildListEntryIds.includes(generated) && buildListEntryIds.some((id) => fixed.has(id)))) {
    return { status: 'rejected', reason: 'conflicts_with_fixed_route' }
  }
  if (selected.has(generated)) return { status: 'found', generatedSelected: true }
  const recorded = plan.rejectedBuildListEntries.filter(({ buildListEntryId }) => buildListEntryId === generated)
  const initial = new Set(context.initialConflictIds)
  const provisionalLoss = recorded.length > 0 &&
    recorded.every(({ reason }) => reason === 'resource_conflict') &&
    result.conflicts.some(({ id, buildListEntryIds, selectedBuildListEntryId }) =>
      initial.has(id) &&
      selectedBuildListEntryId === null &&
      buildListEntryIds.includes(generated) &&
      buildListEntryIds.some((id) => id !== generated && !fixed.has(id) && selected.has(id)))
  return provisionalLoss
    ? { status: 'found', generatedSelected: false }
    : { status: 'rejected', reason: 'not_selected' }
}
