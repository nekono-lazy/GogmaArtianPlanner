import type {
  DomainValidationIssue,
  DomainValidationResult,
  TargetWeapon,
} from '../../models/publicTypes'
import {
  validateCalculationContext,
  validateNormalArtianCounter,
  validateOwnedWeapon,
  validateRngState,
  validateTargetWeapon,
} from '../../models/publicTypes'
import { validateTargetIdealImpliesPractical } from '../../target'
import {
  ConstrainedSearchError,
  type ConstrainedCandidateSearchInput,
  type ConstrainedEnumerationBounds,
} from './constrainedTypes'

export interface ConstrainedSearchValidationIssue {
  path: string
  message: string
}

function positiveIntegerIssue(
  value: number,
  path: string,
): ConstrainedSearchValidationIssue | null {
  return Number.isInteger(value) && value >= 1
    ? null
    : { path, message: `${path} must be an integer greater than or equal to 1.` }
}

/**
 * `maxOffAxisPairEvaluations` is the only bound that may legitimately be zero:
 * zero off-axis evaluations is exactly the Cross-only policy of SEARCH_SPEC
 * 5.5.4, so forbidding it would forbid a meaningful configuration. The other
 * three keep the existing `validateCandidateSearchSettings()` minimum of 1.
 */
function nonNegativeIntegerIssue(
  value: number,
  path: string,
): ConstrainedSearchValidationIssue | null {
  return Number.isInteger(value) && value >= 0
    ? null
    : { path, message: `${path} must be an integer greater than or equal to 0.` }
}

export function validateConstrainedEnumerationBounds(
  bounds: ConstrainedEnumerationBounds,
): ConstrainedSearchValidationIssue[] {
  return [
    positiveIntegerIssue(bounds.maxNormalForgeCount, 'bounds.maxNormalForgeCount'),
    positiveIntegerIssue(bounds.maxGogmaAdvance, 'bounds.maxGogmaAdvance'),
    positiveIntegerIssue(bounds.maxSkillResetCount, 'bounds.maxSkillResetCount'),
    nonNegativeIntegerIssue(
      bounds.maxOffAxisPairEvaluations,
      'bounds.maxOffAxisPairEvaluations',
    ),
  ].filter((issue): issue is ConstrainedSearchValidationIssue => issue !== null)
}

/** Re-prefixes an existing Domain validator result onto the origin's path. */
function collect(
  prefix: string,
  validation: DomainValidationResult,
): ConstrainedSearchValidationIssue[] {
  return validation.issues.map(({ path, message }) => ({
    path: path ? `${prefix}.${path}` : prefix,
    message,
  }))
}

/**
 * Fails closed on an invalid Target reference, origin, bounds, or
 * CalculationContext, and returns the enumerated TargetWeapon.
 *
 * `origin` is documented as the Planner-start current validated snapshot, but
 * this is a public Search Domain boundary, so it re-checks the snapshot with
 * the existing Domain validators rather than trusting the caller. A broken
 * snapshot must never reach an Engine prediction. No new Domain constraint is
 * introduced here: every issue comes from `validateRngState`,
 * `validateNormalArtianCounter`, `validateOwnedWeapon`, `validateTargetWeapon`,
 * `validateCalculationContext`, or `validateTargetIdealImpliesPractical`, and
 * no Master Data or persistence validation is added.
 */
export function assertConstrainedCandidateSearchInput(
  input: ConstrainedCandidateSearchInput,
): TargetWeapon {
  const issues = validateConstrainedEnumerationBounds(input.bounds)
  const { origin } = input

  const contextIssues: DomainValidationIssue[] = []
  validateCalculationContext(
    origin.calculationContext,
    'origin.calculationContext',
    contextIssues,
  )
  issues.push(...contextIssues.map(({ path, message }) => ({ path, message })))

  issues.push(...collect('origin.rngState', validateRngState(origin.rngState)))
  origin.normalCounters.forEach((counter, index) => {
    issues.push(
      ...collect(
        `origin.normalCounters[${index}]`,
        validateNormalArtianCounter(counter),
      ),
    )
  })
  origin.ownedWeapons.forEach((weapon, index) => {
    issues.push(
      ...collect(`origin.ownedWeapons[${index}]`, validateOwnedWeapon(weapon)),
    )
  })
  // The whole snapshot is re-checked, not just the enumerated Target, because
  // `ConstrainedSearchOrigin` is a public Search Domain boundary. Only the
  // structural `validateTargetWeapon()` runs for every Target; the Ideal implies
  // Practical containment stays scoped to the enumerated Target below.
  origin.targetWeapons.forEach((weapon, index) => {
    issues.push(
      ...collect(`origin.targetWeapons[${index}]`, validateTargetWeapon(weapon)),
    )
  })

  const target = origin.targetWeapons.find(
    (candidate) => candidate.id === input.targetWeaponId,
  )
  if (!target) {
    issues.push({
      path: 'targetWeaponId',
      message: `TargetWeapon '${input.targetWeaponId}' is not part of the constrained search origin.`,
    })
  } else if (!target.isEnabled) {
    issues.push({
      path: 'targetWeaponId',
      message: `TargetWeapon '${input.targetWeaponId}' is disabled.`,
    })
  } else {
    // The structural check already ran over every Target above, so only the
    // selection-scoped rule is left here. The SEARCH_SPEC 5.6.1
    // Ideal-already-satisfied continuation rule depends on this containment, so
    // a violating Target is rejected rather than repaired.
    const containment = validateTargetIdealImpliesPractical(target, origin.master)
    if (!containment.isValid) {
      issues.push({
        path: 'targetWeaponId',
        message: `TargetWeapon '${input.targetWeaponId}' violates the Ideal implies Practical containment invariant: ${containment.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join(' / ')}`,
      })
    }
  }

  if (issues.length > 0 || !target) {
    throw new ConstrainedSearchError(
      'invalid_input',
      issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    )
  }
  return target
}
