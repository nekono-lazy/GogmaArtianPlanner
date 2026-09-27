import { hashStableValue } from '../../models/publicTypes'
import type {
  CalculationContext,
  TargetWeaponId,
} from '../../models/publicTypes'
import type {
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
} from '../../search'
import {
  normalizePlannerSearchOrigin,
  resolvePlannerSearchOriginTarget,
} from '../replacement/plannerSearchOrigin'

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

function normalizeCalculationContext(context: CalculationContext) {
  return {
    gameVersion: context.gameVersion,
    masterDataVersion: context.masterDataVersion,
    rngEngineVersion: context.rngEngineVersion,
    appSchemaVersion: context.appSchemaVersion,
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
 *
 * The origin normalization and Target resolution are the shared Planner Domain
 * primitives of `../replacement/plannerSearchOrigin` (Phase 6-B2a); only the
 * B8 route policy token and the B8 bounds are this legacy identity's own.
 */
export function createConstrainedSearchIdentity(
  input: ConstrainedSearchIdentityInput,
): string {
  const target = resolvePlannerSearchOriginTarget(input.origin, input.targetWeaponId)
  const suffix = hashStableValue({
    targetWeaponId: target.id,
    origin: normalizePlannerSearchOrigin(input.origin, target),
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
