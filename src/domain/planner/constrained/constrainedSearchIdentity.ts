import { createTargetDefinitionHash } from '../../buildList'
import {
  hashStableValue,
  normalizeKnownValue,
  normalizeReferencedOwnedWeapon,
  V1_NORMAL_ARTIAN_RARITY,
} from '../../models/publicTypes'
import type {
  CalculationContext,
  TargetWeapon,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  selectCompatibleOwnedGogmaWeapons,
  selectConvertibleOwnedNormalArtianWeapons,
} from '../../search'
import type {
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
} from '../../search'
import { ConstrainedMaterializationError } from './constrainedMaterializationErrors'

/**
 * The fixed constrained route policy of SEARCH_SPEC 5.6.7, as one stable token.
 *
 * ```text
 * route scope     = every currently legal Search route
 * UI filters      = none (no routeFilter, no CandidateSearchSettings)
 * extent          = ConstrainedEnumerationBounds only
 * off-axis        = B8-B1 lazy constrained evaluation
 * ```
 *
 * It is versioned so a future policy change produces a different constrained
 * search identity instead of silently reusing the old one. It is unrelated to
 * `PRODUCTION_RNG_ENGINE_VERSION`, which this task does not touch.
 */
export const CONSTRAINED_ROUTE_POLICY_VERSION = 'b8-constrained-route-policy:v1'

export interface ConstrainedSearchIdentityInput {
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
  bounds: ConstrainedEnumerationBounds
}

export function resolveConstrainedTarget(
  origin: ConstrainedSearchOrigin,
  targetWeaponId: TargetWeaponId,
): TargetWeapon {
  const target = origin.targetWeapons.find(({ id }) => id === targetWeaponId)
  if (!target) {
    throw new ConstrainedMaterializationError(
      'target_mismatch',
      `TargetWeapon '${targetWeaponId}' is not part of the constrained search origin.`,
    )
  }
  return target
}

function normalizeCalculationContext(context: CalculationContext) {
  return {
    gameVersion: context.gameVersion,
    masterDataVersion: context.masterDataVersion,
    rngEngineVersion: context.rngEngineVersion,
    appSchemaVersion: context.appSchemaVersion,
  }
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The Planner-start Search / RNG semantic origin, normalized for a stable value.
 *
 * PLANNER_SPEC 9.2.13 names its constituents: Base Seed, the relevant Counter
 * group, the referenced OwnedWeapon semantics, and the Target definition. Every
 * collection here is set-shaped, so it is sorted by ID; the five restoration
 * bonus slots inside a weapon stay in stored order, because Keep preserves the
 * family at each slot position, which makes that order semantic.
 *
 * Deliberately absent:
 *
 * - Legacy `RngState.counterGate`, which is not Production prediction authority
 * - `KnownValue.source`, notes, and observation timestamps
 * - The `SearchMasterSubset` itself. Master identity reaches the value through
 *   `CalculationContext.masterDataVersion`, which is the versioning authority;
 *   hashing the loaded Master subset would make the identity depend on how the
 *   subset happened to be assembled.
 * - Every other Target in the snapshot, and every OwnedWeapon that cannot be a
 *   Route source for this Target - including a protected Owned Normal Artian
 *   weapon, which no automatic conversion Route may consume. Both are decided
 *   with the same shared eligibility selectors the constrained enumerator uses,
 *   never with a second B8-only rule.
 */
export function normalizeConstrainedSearchOrigin(
  origin: ConstrainedSearchOrigin,
  target: TargetWeapon,
) {
  const relevantNormalCounters = origin.normalCounters
    .filter(
      (counter) =>
        counter.weaponTypeId === target.weaponTypeId &&
        counter.rarity === V1_NORMAL_ARTIAN_RARITY,
    )
    .map(({ id, counter, isConfirmed }) => ({ id, counter, isConfirmed }))
    .sort((left, right) => compareIds(left.id, right.id))

  // The very selectors the B8-B1 enumerator builds its Route bases with, so
  // the identity covers exactly the sources a constrained enumeration can use.
  // A protected Owned Normal is never an automatic conversion source, so it is
  // absent here; an Owned Gogma stays in scope while protected, because
  // `existing_gogma_reset_skills` may use it, and its protection state is part
  // of the normalized semantics.
  const relevantOwnedWeapons = [
    ...selectConvertibleOwnedNormalArtianWeapons(target, origin.ownedWeapons),
    ...selectCompatibleOwnedGogmaWeapons(target, origin.ownedWeapons),
  ]
    .sort((left, right) => compareIds(left.id, right.id))
    .map(normalizeReferencedOwnedWeapon)

  return {
    baseSeed: normalizeKnownValue(origin.rngState.baseSeed),
    gogmaCounter: normalizeKnownValue(origin.rngState.gogmaCounter),
    skillCounter: normalizeKnownValue(origin.rngState.skillCounter),
    normalCounters: relevantNormalCounters,
    ownedWeapons: relevantOwnedWeapons,
    targetDefinitionHash: createTargetDefinitionHash(target),
  }
}

/**
 * The deterministic constrained search identity (PLANNER_SPEC 9.2.13).
 *
 * It is composed, not merely named: the TargetWeapon ID, the normalized
 * Planner-start Search / RNG origin, the `CalculationContext`, the
 * `ConstrainedEnumerationBounds`, and the route policy token. No random UUID,
 * Clock value, request UUID, enumeration ordinal, or historical UI
 * `searchRunId` participates, so two Planner runs over the same current state
 * derive the same identity.
 */
export function createConstrainedSearchIdentity(
  input: ConstrainedSearchIdentityInput,
): string {
  const target = resolveConstrainedTarget(input.origin, input.targetWeaponId)
  const suffix = hashStableValue({
    targetWeaponId: target.id,
    origin: normalizeConstrainedSearchOrigin(input.origin, target),
    calculationContext: normalizeCalculationContext(
      input.origin.calculationContext,
    ),
    bounds: {
      maxNormalForgeCount: input.bounds.maxNormalForgeCount,
      maxGogmaAdvance: input.bounds.maxGogmaAdvance,
      maxSkillResetCount: input.bounds.maxSkillResetCount,
      maxOffAxisPairEvaluations: input.bounds.maxOffAxisPairEvaluations,
    },
    routePolicy: CONSTRAINED_ROUTE_POLICY_VERSION,
  }).replace(':', '-')
  return `constrained-search.${suffix}`
}
