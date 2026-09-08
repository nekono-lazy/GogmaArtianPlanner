import type { ProductionPlanGenerationObserver } from '../plannerTypes'
import {
  assertPlannerWhatIfBounds,
  type PlannerWhatIfBounds,
} from './plannerWhatIfBounds'

/**
 * The B9 shared `maxPlannerReruns` budget (PLANNER_SPEC 9.2.4.9).
 *
 * It is deliberately a separate type from B8's `PlannerFullBeamBudget` /
 * `PlannerOrchestrationLimitError`. B8 counts an initial ordinary Planner run
 * as well and reports its stop through a `PlannerWarningKind`; B9 starts no
 * Plan-producing run at all and reports its stop through
 * `PlannerWhatIfOutcome`. The two count different things, so neither the type
 * nor the value is shared (9.2.4.12).
 */

/**
 * The B9 rerun budget refused a full Beam Search, as a typed signal.
 *
 * Callers branch on the type, never on message text. Reaching the limit is not
 * this error: only a Beam Search that the limit actually blocks raises it, so
 * `used === limit` on its own is never reported as a truncation.
 */
export class PlannerWhatIfRerunLimitError extends Error {
  /** The configured `PlannerWhatIfBounds.maxPlannerReruns`. */
  readonly limit: number
  /** Executions already consumed. The blocked one is not included. */
  readonly used: number

  constructor(limit: number, used: number) {
    super(
      `Planner what-if bound 'maxPlannerReruns' blocked a full Beam Search (limit ${limit}, used ${used}).`,
    )
    this.name = 'PlannerWhatIfRerunLimitError'
    this.limit = limit
    this.used = used
  }
}

/**
 * The budget shaped as a `ProductionPlanGenerationObserver`, so one what-if
 * request can hand it straight to `createProductionPlanWithObserver()`.
 *
 * It counts every full Beam Search that actually starts inside a Candidate
 * trial, including a runtime-unsupported retry Beam Search. It never counts the
 * initial conflict preflight, `validatePlannerInput()`, conflict context
 * construction, Candidate enumeration, or materialization: none of those runs a
 * Beam Search, so none of them reaches this observer.
 */
export interface PlannerWhatIfFullBeamBudget extends ProductionPlanGenerationObserver {
  readonly limit: number
  readonly used: number
  /**
   * True once every affordable execution has been started.
   *
   * On its own this is not a truncation. It is what PLANNER_SPEC 9.2.4.9 uses
   * to stop starting new what-if work whose only purpose would be a Beam
   * Search that can no longer run.
   */
  readonly exhausted: boolean
  beforeBeamSearch(): void
}

/**
 * Builds the budget from the caller-supplied `PlannerWhatIfBounds`.
 *
 * The Production default is caller-facing only (PLANNER_SPEC 9.2.4.9).
 * Invalid bounds fail closed with `PlannerWhatIfBoundsError` rather than being
 * repaired, clamped, completed field-wise, or replaced with that default.
 */
export function createPlannerWhatIfFullBeamBudget(
  bounds: PlannerWhatIfBounds,
): PlannerWhatIfFullBeamBudget {
  assertPlannerWhatIfBounds(bounds)
  const limit = bounds.maxPlannerReruns
  let used = 0
  return {
    get limit() {
      return limit
    },
    get used() {
      return used
    },
    get exhausted() {
      return used >= limit
    },
    beforeBeamSearch() {
      if (used >= limit) throw new PlannerWhatIfRerunLimitError(limit, used)
      used += 1
    },
  }
}
