import { evaluateBuildListEntryStaleness } from '../buildList'
import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  NormalArtianCounter,
  OwnedWeapon,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../models/publicTypes'
import {
  validateBuildListEntry,
  validateProductionPlan,
} from '../models/publicTypes'
import type { DomainValidationResult } from '../models/validation'
import type { PlannerSearchTermination } from './plannerTypes'

/**
 * The pure save-time checks a Planner orchestration result must pass before it
 * is persisted (`docs/PLANNER_SPEC.md` 9.2.15), shared by the ordinary Planner
 * result save and the replan adoption (16.8).
 *
 * Each check returns the first issue it finds, or `null`. It never throws, so
 * each caller maps an issue onto its own error boundary: the ordinary save onto
 * `RepositoryError`, the replan adoption onto `ExecutionRuntimeError`.
 */
export type PlannerResultPersistenceIssue =
  /** The result itself violates an invariant it must satisfy to be persisted. */
  | { kind: 'result_invalid'; message: string }
  /** Domain validation rejected the Plan or a generated Entry. */
  | {
      kind: 'entity_invalid'
      entityName: 'ProductionPlan' | 'BuildListEntry'
      validation: DomainValidationResult
    }
  /** Current persisted state moved under the calculation. */
  | { kind: 'state_changed'; message: string }

function resultInvalid(message: string): PlannerResultPersistenceIssue {
  return { kind: 'result_invalid', message }
}

/**
 * The result-shape invariants that do not depend on current persisted state:
 * a completed / exhausted search, a draft Plan, unique generated Entry IDs, and
 * Domain-valid Plan and Entries.
 */
export function checkPersistablePlannerResultShape(
  plan: ProductionPlan,
  generatedEntries: readonly BuildListEntry[],
  termination: PlannerSearchTermination,
): PlannerResultPersistenceIssue | null {
  // PLANNER_SPEC 7.2.1: a Plan calculated from a Beam Search that a
  // `PlannerOptions` bound truncated is a partial search artifact, not a
  // finished production plan, so it never becomes an executable Draft. The
  // typed termination decides this - never a `PlannerWarning` message, and
  // never the presence of `max_expanded_states_reached`, which a completed
  // search can carry too.
  if (termination.status === 'incomplete') {
    return resultInvalid(
      `The Planner search did not complete: it reached ${termination.reachedLimits.join(', ')} after ${termination.expandedStates} expanded states with ${termination.completedTargetCount} of ${termination.totalTargetCount} target weapons completed. A truncated search result must not be saved as an executable ProductionPlan.`,
    )
  }
  if (plan.status !== 'draft') {
    return resultInvalid(
      `A Planner orchestration result must be saved as a draft ProductionPlan, but its status is '${plan.status}'.`,
    )
  }
  const duplicated = generatedEntries
    .map(({ id }) => id)
    .filter((id, index, all) => all.indexOf(id) !== index)
  if (duplicated.length > 0) {
    return resultInvalid(
      `Generated BuildListEntry IDs must be unique: '${duplicated[0]}' appears more than once.`,
    )
  }
  const planValidation = validateProductionPlan(plan)
  if (!planValidation.isValid) {
    return { kind: 'entity_invalid', entityName: 'ProductionPlan', validation: planValidation }
  }
  for (const entry of generatedEntries) {
    const entryValidation = validateBuildListEntry(entry)
    if (!entryValidation.isValid) {
      return { kind: 'entity_invalid', entityName: 'BuildListEntry', validation: entryValidation }
    }
  }
  return null
}

/**
 * A generated Entry that is already persisted was not the `reusedExisting`
 * case - a reused Entry is never returned as generated - so the same ID
 * appearing now is a save-time race, never a silent reuse or overwrite.
 */
export function findPersistedGeneratedBuildListEntryCollision(
  generatedEntries: readonly BuildListEntry[],
  persistedEntries: readonly BuildListEntry[],
): PlannerResultPersistenceIssue | null {
  const persistedIds = new Set(persistedEntries.map(({ id }) => id))
  const collided = generatedEntries.find(({ id }) => persistedIds.has(id))
  return collided
    ? {
        kind: 'state_changed',
        message: `Generated BuildListEntry '${collided.id}' already exists in persistence; current state changed after the Planner ran.`,
      }
    : null
}

export interface GeneratedBuildListEntryStalenessState {
  rngState: RngState
  normalCounters: readonly NormalArtianCounter[]
  ownedWeapons: readonly OwnedWeapon[]
  targetWeapons: readonly TargetWeapon[]
}

/**
 * Every generated Entry is fresh against current state, recomputed from that
 * state and never read off the persisted flags.
 */
export function checkGeneratedBuildListEntriesFresh(
  generatedEntries: readonly BuildListEntry[],
  current: GeneratedBuildListEntryStalenessState,
  currentCalculationContext: CalculationContext,
): PlannerResultPersistenceIssue | null {
  const targetById = new Map(current.targetWeapons.map((target) => [target.id, target]))
  for (const entry of generatedEntries) {
    const staleness = evaluateBuildListEntryStaleness(entry, {
      target: targetById.get(entry.targetWeaponId) ?? null,
      rngState: current.rngState,
      normalCounters: [...current.normalCounters],
      ownedWeapons: [...current.ownedWeapons],
      calculationContext: currentCalculationContext,
    })
    if (staleness.isStale) {
      return {
        kind: 'state_changed',
        message: `Generated BuildListEntry '${entry.id}' is stale against current state (${staleness.staleReasons.join(', ')}).`,
      }
    }
  }
  return null
}

/**
 * Every BuildListEntry the Plan references exists in the final augmented Build
 * List, each Candidate-derived Step carries its Entry Snapshot's Candidate ID,
 * and every generated Entry is selected by the final Plan (PLANNER_SPEC
 * 9.2.14).
 */
export function checkProductionPlanBuildListReferences(
  plan: ProductionPlan,
  generatedEntries: readonly BuildListEntry[],
  augmentedEntries: readonly BuildListEntry[],
): PlannerResultPersistenceIssue | null {
  const entryById = new Map(augmentedEntries.map((entry) => [entry.id, entry]))
  const missing = (id: BuildListEntryId, path: string) =>
    entryById.has(id)
      ? null
      : resultInvalid(
          `${path} references BuildListEntry '${id}', which is not part of the final augmented Build List.`,
        )

  for (const [index, id] of plan.selectedBuildListEntryIds.entries()) {
    const issue = missing(id, `selectedBuildListEntryIds[${index}]`)
    if (issue) return issue
  }
  for (const [index, conflict] of plan.conflicts.entries()) {
    for (const [participant, id] of conflict.buildListEntryIds.entries()) {
      const issue = missing(id, `conflicts[${index}].buildListEntryIds[${participant}]`)
      if (issue) return issue
    }
    if (conflict.recommendedBuildListEntryId !== null) {
      const issue = missing(
        conflict.recommendedBuildListEntryId,
        `conflicts[${index}].recommendedBuildListEntryId`,
      )
      if (issue) return issue
    }
    if (conflict.selectedBuildListEntryId !== null) {
      const issue = missing(
        conflict.selectedBuildListEntryId,
        `conflicts[${index}].selectedBuildListEntryId`,
      )
      if (issue) return issue
    }
  }
  for (const [index, rejected] of plan.rejectedBuildListEntries.entries()) {
    const issue = missing(
      rejected.buildListEntryId,
      `rejectedBuildListEntries[${index}].buildListEntryId`,
    )
    if (issue) return issue
  }
  for (const [index, step] of plan.steps.entries()) {
    if (step.buildListEntryId === null) continue
    const issue = missing(step.buildListEntryId, `steps[${index}].buildListEntryId`)
    if (issue) return issue
    const entry = entryById.get(step.buildListEntryId) as BuildListEntry
    // A Candidate-derived Step carries that Entry Snapshot's Candidate ID.
    if (step.candidateId !== entry.candidateSnapshot.id) {
      return resultInvalid(
        `steps[${index}].candidateId '${step.candidateId}' does not match the candidate Snapshot '${entry.candidateSnapshot.id}' of BuildListEntry '${entry.id}'.`,
      )
    }
  }

  const selected = new Set(plan.selectedBuildListEntryIds)
  const unselected = generatedEntries.find(({ id }) => !selected.has(id))
  if (unselected) {
    return resultInvalid(
      `Generated BuildListEntry '${unselected.id}' is not selected by the final ProductionPlan.`,
    )
  }
  return null
}
