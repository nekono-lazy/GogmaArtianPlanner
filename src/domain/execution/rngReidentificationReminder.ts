import type {
  ExecutionHistory,
  ISODateTimeString,
  PlanStep,
  ProductionPlan,
  RngState,
} from '../models/publicTypes'
import { compareExecutionHistoryOrder } from '../models/publicTypes'

/**
 * Where the RNG re-identification of a diverged operation happens
 * (`docs/PLANNER_SPEC.md` 16.15): a Normal Artian creation is re-identified in
 * Normal Counter Setup, every Gogma / Skill operation in RNG Setup
 * (Identification Wizard). The one destination authority of the stale Plan
 * guidance and the RNG re-identification reminder.
 */
export type ReidentificationDestination = 'normal_counters' | 'rng'

export function executionReidentificationDestination(
  step: Pick<PlanStep, 'operationType'>,
): ReidentificationDestination {
  return step.operationType === 'create_normal_artian' ? 'normal_counters' : 'rng'
}

/**
 * Whether the user must still re-identify the RNG state because of a Plan's
 * `actual_result_different` record (`docs/PLANNER_SPEC.md` 16.15 「RNG再同定を
 * 促す継続表示」). Display only and derived from persisted state alone: no flag is
 * persisted, and nothing here writes the RngState.
 *
 * `operation_uncertain` is recovered inside the Execution Navigator and keeps its
 * own guidance; it is not decided here.
 */
export type ExecutionRngReidentificationReminder =
  | { kind: 'none' }
  | {
      kind: 'actual_result_different'
      /** The unresolved record. */
      executionHistoryId: ExecutionHistory['id']
      planStepId: PlanStep['id']
      destination: ReidentificationDestination
    }

/** A canonical UTC ISO date-time exactly as `Date.prototype.toISOString()` writes it. */
function isCanonicalIsoDateTime(value: string): boolean {
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

/**
 * Whether `updatedAt` is strictly later than `createdAt`. Both are compared only
 * as canonical UTC ISO strings, whose lexicographic order is chronological, the
 * same string order `compareExecutionHistoryOrder()` uses; no locale conversion.
 * Anything that cannot be decided safely - an equal instant or a non-canonical
 * value - is "not later", so an unresolved divergence is never taken as resolved.
 */
function isStrictlyLater(updatedAt: ISODateTimeString, createdAt: ISODateTimeString): boolean {
  if (!isCanonicalIsoDateTime(updatedAt) || !isCanonicalIsoDateTime(createdAt)) return false
  return updatedAt > createdAt
}

/**
 * Derives the RNG re-identification reminder of one Plan from its persisted
 * ExecutionHistory and the current RngState (16.15): the Plan's latest
 * `actual_result_different` record, by `compareExecutionHistoryOrder()`, stays
 * unresolved until the RngState is updated strictly after it.
 *
 * - The record is searched among all of the Plan's records, not only the latest
 *   one, so a later record of another action never hides it. Only the latest
 *   `actual_result_different` counts: an RngState update after it also comes
 *   after every earlier one.
 * - Ending the Plan (abandonment, replan adoption) resolves nothing: the record
 *   stays and the reminder with it.
 * - A save point restore or an Undo that deleted the record resolves it, simply
 *   because the record no longer exists; no earlier state is remembered.
 * - A missing RngState cannot show a re-identification, so the reminder stays.
 *
 * The resolution test is the RngState update 16.15 names, for every operation.
 * A Normal Counter Setup save updates the NormalArtianCounter only, so a Normal
 * Artian creation divergence keeps being reminded after it until the RngState
 * is updated too - the fail-safe side, never an early "resolved".
 */
export function deriveExecutionRngReidentificationReminder(input: {
  plan: Pick<ProductionPlan, 'id' | 'steps'>
  planExecutionHistory: readonly ExecutionHistory[]
  rngState: Pick<RngState, 'updatedAt'> | null
}): ExecutionRngReidentificationReminder {
  const latest = input.planExecutionHistory
    .filter(({ planId, action }) => planId === input.plan.id && action === 'actual_result_different')
    .sort(compareExecutionHistoryOrder)
    .at(-1)
  if (latest === undefined) return { kind: 'none' }
  if (input.rngState !== null && isStrictlyLater(input.rngState.updatedAt, latest.createdAt)) {
    return { kind: 'none' }
  }
  const step = input.plan.steps.find(({ id }) => id === latest.planStepId)
  // A record whose Step cannot be resolved names no Normal Counter, so the
  // general RNG Setup is the safe destination.
  return {
    kind: 'actual_result_different',
    executionHistoryId: latest.id,
    planStepId: latest.planStepId,
    destination: step === undefined ? 'rng' : executionReidentificationDestination(step),
  }
}
