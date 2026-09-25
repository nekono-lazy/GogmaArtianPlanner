import type { TargetWeapon } from '../../models/publicTypes'
import {
  collectConstrainedSearchOriginIssues,
  type ConstrainedSearchValidationIssue,
} from '../constrained/constrainedValidation'
import {
  PlannerAlternativeSearchError,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
  type PlannerAlternativeSearchInput,
  type PlannerAlternativeStreamReservation,
} from './plannerAlternativeTypes'

function positiveIntegerIssue(
  value: number,
  path: string,
): ConstrainedSearchValidationIssue | null {
  return Number.isInteger(value) && value >= 1
    ? null
    : { path, message: `${path} must be an integer greater than or equal to 1.` }
}

/**
 * Every extent value is a caller-supplied integer of at least 1
 * (`docs/PLANNER_SPEC.md` 9.2.19.12). No default substitution, fallback, clamp
 * or field-wise completion happens here.
 */
export function validatePlannerAlternativeSearchExtent(
  extent: PlannerAlternativeSearchExtent,
): ConstrainedSearchValidationIssue[] {
  return [
    positiveIntegerIssue(extent.maxNormalAdvance, 'extent.maxNormalAdvance'),
    positiveIntegerIssue(extent.maxGogmaAdvance, 'extent.maxGogmaAdvance'),
    positiveIntegerIssue(extent.maxSkillAdvance, 'extent.maxSkillAdvance'),
  ].filter((issue): issue is ConstrainedSearchValidationIssue => issue !== null)
}

function streamReservesNothing(
  reservation: PlannerAlternativeStreamReservation,
): boolean {
  return reservation.held.length === 0 && reservation.blocked.length === 0
}

/**
 * Whether the reservation reserves nothing at all: no held or blocked position
 * on any stream and no exclusive OwnedWeapon. That is the "no fixed Route" case
 * (`docs/SEARCH_SPEC.md` 5.6.8).
 */
export function isEmptyPlannerAlternativeReservation(
  reservation: PlannerAlternativeReservation,
): boolean {
  return (
    reservation.normal.every(streamReservesNothing) &&
    streamReservesNothing(reservation.skill) &&
    streamReservesNothing(reservation.gogma) &&
    reservation.exclusiveOwnedWeaponIds.length === 0
  )
}

/**
 * Fails closed on an invalid origin, Target selection or extent, refuses a
 * reservation Phase 1 cannot search yet, and returns the searched Target.
 *
 * A non-empty reservation is refused with `unsupported_reservation` rather than
 * searched as if it were empty: ignoring it would return Routes that use the
 * very positions and weapons the fixed Routes hold. Held / blocked traversal
 * and exclusive OwnedWeapons are Phase 2 (`docs/PLANNER_SPEC.md` 9.2.19.16).
 */
export function assertPlannerAlternativeSearchInput(
  input: PlannerAlternativeSearchInput,
): TargetWeapon {
  const issues = validatePlannerAlternativeSearchExtent(input.extent)
  const origin = collectConstrainedSearchOriginIssues(
    input.origin,
    input.targetWeaponId,
  )
  issues.push(...origin.issues)
  if (issues.length > 0 || !origin.target) {
    throw new PlannerAlternativeSearchError(
      'invalid_input',
      issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    )
  }
  if (!isEmptyPlannerAlternativeReservation(input.reservation)) {
    throw new PlannerAlternativeSearchError(
      'unsupported_reservation',
      'Planner Alternative Search does not support a non-empty resource reservation yet; ' +
        'held / blocked positions and exclusive OwnedWeapons are not searched in this phase.',
    )
  }
  return origin.target
}
