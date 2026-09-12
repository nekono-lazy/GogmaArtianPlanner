import { createBuildCandidateMeaningFingerprint } from '../../buildList'
import type {
  BuildListEntry,
  BuildListEntryId,
  DomainValidationIssue,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  preparePlannerInitialContext,
  type PlannerInitialContext,
} from '../plannerInitialContext'
import type {
  ExcludedBuildListEntry,
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
  PlannerWarning,
} from '../plannerTypes'
import {
  createPlannerConstrainedConflictContexts,
  plannerConflictResourceKey,
  samePlannerConflictResource,
  type PlannerConflictResourceIdentity,
  type PlannerConstrainedConflictContext,
  type PlannerFixedConflictConstraint,
} from './plannerConflictContext'

/**
 * The B8-C3b initial conflict preflight (PLANNER_SPEC 9.2.3.1).
 *
 * It runs the ordinary Planner's own validation / initial state / Route unit
 * plan / conflict detection path over an augmented `PlannerInput`, then re-maps
 * every transient `PlannerFixedConflictConstraint` onto the conflicts detected
 * right now, rebuilding a complete `PlannerConflictResolution[]` whose
 * `conflictKey` is the *current* `PlanConflict.id`.
 *
 * It deliberately runs no Beam Search, no Trace Replay, and no Candidate trial
 * loop: coexistence and Candidate adoption stay with the full rerun (9.2.11),
 * and this preflight never counts against `maxPlannerReruns` (9.2.16).
 */

/** Why one fixed constraint could not be re-associated; never a message string. */
export type PlannerConstraintReassociationFailureReason =
  /** The fixed Entry is not in the augmented `validBuildListEntries`. */
  | 'fixed_entry_not_valid'
  /** Several currently valid Entries carry the fixed BuildListEntry ID. */
  | 'fixed_entry_ambiguous'
  /** The current fixed Entry belongs to a different TargetWeapon. */
  | 'fixed_target_mismatch'
  /** The current fixed Entry carries a different Candidate semantic meaning. */
  | 'fixed_candidate_fingerprint_mismatch'
  /** No currently detected conflict matches the resource plus the fixed Entry. */
  | 'current_conflict_not_found'
  /** Several currently detected conflicts match; the mapping is unknown. */
  | 'current_conflict_ambiguous'
  /** The matched conflict carries inconsistent semantics for the fixed Entry. */
  | 'participant_context_mismatch'
  /** Two rebuilt resolutions would share one current `conflictKey`. */
  | 'resolution_key_collision'
  /**
   * The current conflict now involves a selected compromise checkpoint, so the
   * re-mapped resolution would drop a hard constraint (`docs/PLANNER_SPEC.md`
   * 9.5). Nothing is guessed: the trial fails closed.
   */
  | 'checkpoint_conflict'

export interface PlannerConstraintReassociationFailure {
  /** Diagnostic only; it is never reused as the current `conflictKey`. */
  originalConflictId: string
  resourceIdentity: PlannerConflictResourceIdentity
  fixedBuildListEntryId: BuildListEntryId
  fixedTargetWeaponId: TargetWeaponId
  reason: PlannerConstraintReassociationFailureReason
  detail: string
}

/**
 * The re-association step alone, without the preflight that produced the
 * conflicts. All-or-nothing by contract, exactly like the whole preflight.
 */
export type PlannerConstraintReassociationResult =
  | { status: 'ready'; conflictResolutions: PlannerConflictResolution[] }
  | {
      status: 'unresolved'
      conflictResolutions: []
      failures: PlannerConstraintReassociationFailure[]
    }

export type PlannerAugmentedConflictPreflightResult =
  | {
      status: 'ready'
      preflightContext: PlannerInitialContext
      conflictContexts: PlannerConstrainedConflictContext[]
      /** Complete, and rebuilt against the current `PlanConflict.id`s. */
      conflictResolutions: PlannerConflictResolution[]
      /** A clone of the augmented input carrying those resolutions. */
      resolvedInput: PlannerInput
    }
  | {
      status: 'invalid'
      warnings: PlannerWarning[]
      issues: DomainValidationIssue[]
      excludedBuildListEntries: ExcludedBuildListEntry[]
    }
  | {
      status: 'unresolved'
      conflictResolutions: []
      failures: PlannerConstraintReassociationFailure[]
    }

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** A run-independent processing order; the caller's array order is irrelevant. */
function constraintOrderKey(constraint: PlannerFixedConflictConstraint): string {
  return [
    plannerConflictResourceKey(constraint.resourceIdentity),
    constraint.fixedBuildListEntryId,
    constraint.fixedTargetWeaponId,
    constraint.originalConflictId,
  ].join('\u0000')
}

function failure(
  constraint: PlannerFixedConflictConstraint,
  reason: PlannerConstraintReassociationFailureReason,
  detail: string,
): PlannerConstraintReassociationFailure {
  return {
    originalConflictId: constraint.originalConflictId,
    resourceIdentity: constraint.resourceIdentity,
    fixedBuildListEntryId: constraint.fixedBuildListEntryId,
    fixedTargetWeaponId: constraint.fixedTargetWeaponId,
    reason,
    detail,
  }
}

function failureOrderKey(entry: PlannerConstraintReassociationFailure): string {
  return [
    plannerConflictResourceKey(entry.resourceIdentity),
    entry.fixedBuildListEntryId,
    entry.fixedTargetWeaponId,
    entry.originalConflictId,
    entry.reason,
  ].join('\u0000')
}

interface ResolvedConstraint {
  constraint: PlannerFixedConflictConstraint
  resolution: PlannerConflictResolution
}

type FixedEntryLookup =
  | { entry: BuildListEntry }
  | { reason: 'fixed_entry_not_valid' | 'fixed_entry_ambiguous' }

/**
 * The current fixed Entry, taken from the preflight's own
 * `validBuildListEntries`.
 *
 * PLANNER_SPEC 9.2.3.1 forbids resolving it from the raw
 * `PlannerInput.buildListEntries`: an Entry that validation excluded for
 * staleness, capability, prediction support, protection, or CalculationContext
 * incompatibility must not be revived on the fixed side.
 */
function currentFixedEntry(
  context: PlannerInitialContext,
  constraint: PlannerFixedConflictConstraint,
): FixedEntryLookup {
  const matching = context.validBuildListEntries.filter(
    ({ entry }) => entry.id === constraint.fixedBuildListEntryId,
  )
  if (matching.length === 0) return { reason: 'fixed_entry_not_valid' }
  if (matching.length > 1) return { reason: 'fixed_entry_ambiguous' }
  return { entry: matching[0].entry }
}

/**
 * Re-maps one fixed constraint onto the conflicts detected right now.
 *
 * The match condition is exactly the two of PLANNER_SPEC 9.2.3.1: the conflict
 * resource identity is equal, and the current participant set contains the
 * fixed BuildListEntry ID. The original `PlanConflict.id` is never part of it,
 * because adding a generated Entry changes the id of the same physical
 * conflict.
 */
function reassociateConstraint(
  context: PlannerInitialContext,
  conflictContexts: readonly PlannerConstrainedConflictContext[],
  constraint: PlannerFixedConflictConstraint,
): ResolvedConstraint | PlannerConstraintReassociationFailure {
  const found = currentFixedEntry(context, constraint)
  if (!('entry' in found)) {
    return failure(
      constraint,
      found.reason,
      found.reason === 'fixed_entry_ambiguous'
        ? `Several currently valid BuildListEntries carry the fixed id '${constraint.fixedBuildListEntryId}'.`
        : `Fixed BuildListEntry '${constraint.fixedBuildListEntryId}' is not valid in the augmented Planner input.`,
    )
  }
  const entry = found.entry
  if (entry.targetWeaponId !== constraint.fixedTargetWeaponId) {
    return failure(
      constraint,
      'fixed_target_mismatch',
      `Fixed BuildListEntry '${constraint.fixedBuildListEntryId}' now targets '${entry.targetWeaponId}' instead of '${constraint.fixedTargetWeaponId}'.`,
    )
  }
  const fingerprint = createBuildCandidateMeaningFingerprint(
    entry.candidateSnapshot,
  )
  if (fingerprint !== constraint.fixedCandidateFingerprint) {
    return failure(
      constraint,
      'fixed_candidate_fingerprint_mismatch',
      `Fixed BuildListEntry '${constraint.fixedBuildListEntryId}' now carries a different Candidate semantic meaning.`,
    )
  }
  const matching = conflictContexts.filter(
    (conflictContext) =>
      samePlannerConflictResource(
        conflictContext.resourceIdentity,
        constraint.resourceIdentity,
      ) &&
      conflictContext.participants.some(
        ({ buildListEntryId }) =>
          buildListEntryId === constraint.fixedBuildListEntryId,
      ),
  )
  if (matching.length === 0) {
    return failure(
      constraint,
      'current_conflict_not_found',
      `No currently detected conflict carries this resource together with BuildListEntry '${constraint.fixedBuildListEntryId}'.`,
    )
  }
  if (matching.length > 1) {
    return failure(
      constraint,
      'current_conflict_ambiguous',
      `${matching.length} currently detected conflicts carry this resource together with BuildListEntry '${constraint.fixedBuildListEntryId}'.`,
    )
  }
  const current = matching[0]
  if (current.involvesSelectedCheckpoint) {
    return failure(
      constraint,
      'checkpoint_conflict',
      `Conflict '${current.conflictId}' involves a selected compromise checkpoint, so BuildListEntry '${constraint.fixedBuildListEntryId}' cannot be fixed over it.`,
    )
  }
  // One Entry may legitimately participate through several Route units, so unit
  // count is never the authority. Only a mixed semantic participant context is
  // a mismatch (PLANNER_SPEC 9.2.3.1).
  const inconsistent = current.participants.some(
    ({ buildListEntryId, targetWeaponId, candidateFingerprint }) =>
      buildListEntryId === constraint.fixedBuildListEntryId &&
      (targetWeaponId !== constraint.fixedTargetWeaponId ||
        candidateFingerprint !== constraint.fixedCandidateFingerprint),
  )
  if (inconsistent) {
    return failure(
      constraint,
      'participant_context_mismatch',
      `Conflict '${current.conflictId}' carries inconsistent participant semantics for BuildListEntry '${constraint.fixedBuildListEntryId}'.`,
    )
  }
  return {
    constraint,
    resolution: {
      conflictKey: current.conflictId,
      selectedBuildListEntryId: constraint.fixedBuildListEntryId,
    },
  }
}

/**
 * Rejects a rebuilt array in which two constraints landed on one current
 * `conflictKey`.
 *
 * `validatePlannerInput()` requires unique conflict keys, so a silent dedupe
 * would either drop a user's explicit choice or make the next Beam Search input
 * invalid. Neither is guessable, so this fails closed like every other
 * re-association failure.
 */
function keyCollisionFailures(
  resolved: readonly ResolvedConstraint[],
): PlannerConstraintReassociationFailure[] {
  const countByKey = new Map<string, number>()
  resolved.forEach(({ resolution }) => {
    countByKey.set(
      resolution.conflictKey,
      (countByKey.get(resolution.conflictKey) ?? 0) + 1,
    )
  })
  return resolved
    .filter(({ resolution }) => (countByKey.get(resolution.conflictKey) ?? 0) > 1)
    .map(({ constraint, resolution }) =>
      failure(
        constraint,
        'resolution_key_collision',
        `Several fixed constraints re-associate to conflict '${resolution.conflictKey}'.`,
      ),
    )
}

/**
 * Re-maps every fixed constraint onto `conflictContexts` and rebuilds the
 * complete `PlannerConflictResolution[]` against the current `PlanConflict.id`s.
 *
 * `context` supplies the current fixed-Entry authority, so it must be the
 * preflight context those `conflictContexts` were built from.
 */
export function reassociatePlannerFixedConstraints(
  context: PlannerInitialContext,
  conflictContexts: readonly PlannerConstrainedConflictContext[],
  fixedConstraints: readonly PlannerFixedConflictConstraint[],
): PlannerConstraintReassociationResult {
  const ordered = [...fixedConstraints].sort((left, right) =>
    compareStableStrings(constraintOrderKey(left), constraintOrderKey(right)),
  )
  const resolved: ResolvedConstraint[] = []
  const failures: PlannerConstraintReassociationFailure[] = []
  ordered.forEach((constraint) => {
    const outcome = reassociateConstraint(context, conflictContexts, constraint)
    if ('reason' in outcome) {
      failures.push(outcome)
      return
    }
    resolved.push(outcome)
  })
  failures.push(...keyCollisionFailures(resolved))
  if (failures.length > 0) {
    return {
      status: 'unresolved',
      conflictResolutions: [],
      failures: failures.sort((left, right) =>
        compareStableStrings(failureOrderKey(left), failureOrderKey(right)),
      ),
    }
  }
  return {
    status: 'ready',
    conflictResolutions: resolved
      .map(({ resolution }) => resolution)
      .sort(
        (left, right) =>
          compareStableStrings(left.conflictKey, right.conflictKey) ||
          compareStableStrings(
            left.selectedBuildListEntryId,
            right.selectedBuildListEntryId,
          ),
      ),
  }
}

/**
 * Runs the augmented initial conflict preflight and rebuilds the complete
 * `PlannerConflictResolution[]` for the caller's next full Beam Search.
 *
 * `fixedConstraints` come from `preparePlannerFixedConflictConstraints()` over
 * the *original* validated Planner input (PLANNER_SPEC 9.2.3.1). This function
 * creates no constraint of its own, so a generated Entry that joins a current
 * conflict is never promoted to the fixed side (9.2.7), and a conflict without
 * an explicit resolution is never fixed from `recommendedBuildListEntryId`, a
 * Beam Search bestState participant, Target priority, or Candidate score.
 *
 * It is all-or-nothing: one failure yields `status: 'unresolved'` with no
 * resolutions at all, so a partially rebuilt array can never reach Beam Search.
 */
export function preparePlannerAugmentedConflictPreflight(
  augmentedInput: PlannerInput,
  fixedConstraints: readonly PlannerFixedConflictConstraint[],
  dependencies: PlannerDependencies,
): PlannerAugmentedConflictPreflightResult {
  // The original `conflictKey`s no longer match once the participant set
  // changed, so applying them here would raise a false
  // `invalid_conflict_resolution` (PLANNER_SPEC 9.2.3.1).
  const preflightInput: PlannerInput = {
    ...augmentedInput,
    conflictResolutions: [],
  }
  const prepared = preparePlannerInitialContext(preflightInput, dependencies)
  if (prepared.status !== 'ready') {
    return {
      status: 'invalid',
      warnings: prepared.warnings,
      issues: prepared.issues,
      excludedBuildListEntries: prepared.excludedBuildListEntries,
    }
  }
  const context = prepared.context
  const conflictContexts = createPlannerConstrainedConflictContexts(context)
  const reassociated = reassociatePlannerFixedConstraints(
    context,
    conflictContexts,
    fixedConstraints,
  )
  if (reassociated.status !== 'ready') return reassociated
  const conflictResolutions = reassociated.conflictResolutions
  return {
    status: 'ready',
    preflightContext: context,
    conflictContexts,
    conflictResolutions,
    resolvedInput: { ...augmentedInput, conflictResolutions },
  }
}
